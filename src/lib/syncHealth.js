// Senkron sağlığı — "yazma sunucuya ulaşmadı ve kimse fark etmedi" sınıfını
// görünür kılar.
//
// NEDEN VAR: bu projede aynı aileden üç hata çıktı ve üçü de haftalarca
// sessiz kaldı — silinen ürünün geri gelmesi (PostgREST 0 satırda hata
// dönmüyor), silinen sipariş kaleminin hiç kuyruğa alınmaması, ve ödemesi
// alınmış siparişlerin RLS reddi yüzünden günlerce 'active' kalması.
// Üçünün de ortak yanı: ekran "oldu" diyordu, sunucuya hiçbir şey gitmiyordu.
//
// Buradaki iki sinyal o sessizliği bozar:
//   1. Kuyruk tıkanması — bir şey uzun süredir gönderilemiyorsa söyle
//   2. Yazma reddi — RLS/oturum hatası aldıysak söyle (okuma ve ekleme anon
//      olarak çalışmaya devam ettiği için uygulama sapasağlam görünüyor,
//      yalnızca güncelleme ve silme sessizce reddediliyor)
import { getMeta, setMeta, isDbInitialized } from './localDb.js'

// Kuyrukta bu kadar dakikadan uzun bekleyen varsa uyarı gösterilir.
// 5 dakika: normal bir tur 60 saniyede bir çalışıyor, kısa bir internet
// kesintisi ya da tek bir başarısız tur alarm üretmesin — ama kalıcı bir
// tıkanma servis bitmeden fark edilsin.
export const SYNC_STUCK_MINUTES = 5

const BACKLOG_KEY = 'sync-backlog-since'

let authFailure = null // { code, message, at } | null
const listeners = new Set()

export function onSyncHealthChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit() {
  for (const fn of listeners) {
    try { fn() } catch (e) { console.warn('[syncHealth] dinleyici hatası', e) }
  }
}

// RLS reddi ya da düşmüş oturum mu? Bunlar tekrar denemekle geçmez —
// kasiyerin yeniden giriş yapması gerekir. Ağ hatasıyla karıştırmamak
// önemli: ağ hatası kendiliğinden düzelir, bu düzelmez.
export function isWriteRejection(error) {
  if (!error) return false
  const code = String(error.code ?? '')
  if (code === '42501') return true      // RLS: new row violates row-level security policy
  if (code === 'PGRST301') return true   // JWT expired
  if (code === '401' || code === 'PGRST302') return true
  const msg = String(error.message ?? error)
  return /row-level security|JWT expired|invalid claim|not authenticated|no api key/i.test(msg)
}

export function noteWriteRejected(error, context = '') {
  if (!isWriteRejection(error)) return false
  const next = {
    code: String(error?.code ?? ''),
    message: String(error?.message ?? error),
    context,
    at: new Date().toISOString(),
  }
  const changed = !authFailure || authFailure.code !== next.code || authFailure.context !== next.context
  authFailure = next
  if (changed) emit()
  return true
}

// Bir yazma başarıyla geçtiyse oturum sağlam demektir — uyarıyı kaldır.
export function noteWriteAccepted() {
  if (!authFailure) return
  authFailure = null
  emit()
}

export function getAuthFailure() {
  return authFailure
}

// Kuyruk boş değilse "ne zamandır dolu" bilgisini saklar, boşalınca siler.
// meta tablosunda tutuluyor çünkü tıkanma uygulama yeniden başlatılınca
// kaybolmamalı — asıl tehlikeli senaryo tam olarak günlerce süren tıkanma.
export async function noteBacklog(count) {
  if (!isDbInitialized()) return
  try {
    const since = getMeta(BACKLOG_KEY)
    if (count > 0) {
      if (!since) { await setMeta(BACKLOG_KEY, new Date().toISOString()); emit() }
    } else if (since) {
      await setMeta(BACKLOG_KEY, '')
      emit()
    }
  } catch (e) {
    console.warn('[syncHealth] kuyruk durumu yazılamadı', e)
  }
}

// { stuck, since, minutes, count } — stuck yalnızca eşik aşıldığında true.
export function getSyncHealth(count) {
  if (!isDbInitialized() || !(count > 0)) return { stuck: false, count: count ?? 0 }
  let since = null
  try { since = getMeta(BACKLOG_KEY) } catch { return { stuck: false, count } }
  if (!since) return { stuck: false, count }
  const ms = Date.now() - new Date(since).getTime()
  if (!Number.isFinite(ms) || ms < 0) return { stuck: false, count }
  const minutes = Math.floor(ms / 60000)
  return { stuck: minutes >= SYNC_STUCK_MINUTES, since, minutes, count }
}
