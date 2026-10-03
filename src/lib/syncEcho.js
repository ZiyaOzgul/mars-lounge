// Kendi yazdığımız değişikliğin realtime yankısını tanımak için.
//
// NEDEN VAR: masaüstü bir siparişi sunucuya yazıyor → Supabase realtime
// "orders değişti" olayını TÜM dinleyicilere, yazanın kendisi dahil
// gönderiyor → masaüstü kendi yazdığı değişikliği dışarıdan gelmiş sanıp bir
// tam senkron turu daha başlatıyordu. Loglarda periyodik tur saatte 60 olması
// gerekirken saatte 131'e çıkıyordu; farkın büyük kısmı bu yankı döngüsü.
//
// Push başarılı olunca uzak id buraya yazılıyor; realtime olayı aynı id için
// kısa süre içinde gelirse yok sayılıyor. Başka cihazdan (QR, mobil) gelen
// değişikliklerin id'si burada olmadığı için onlar etkilenmiyor.

// Realtime olayı genelde 1 sn içinde gelir; 15 sn yavaş ağda bile yeter,
// ama aynı satırın gerçekten başka cihazdan değişmesini gizleyecek kadar uzun değil.
const ECHO_TTL_MS = 15_000

const recent = new Map() // "tablo:id" -> zaman

export function notePushed(table, id) {
  if (id == null) return
  recent.set(`${table}:${id}`, Date.now())
}

export function isOwnEcho(table, id) {
  if (id == null) return false
  const key = `${table}:${id}`
  const ts = recent.get(key)
  if (ts == null) return false
  if (Date.now() - ts > ECHO_TTL_MS) { recent.delete(key); return false }
  return true
}

// Haritanın bir vardiya boyunca şişmemesi için ara sıra temizlik.
export function pruneEchoes() {
  const now = Date.now()
  for (const [k, ts] of recent) if (now - ts > ECHO_TTL_MS) recent.delete(k)
}
