// ── İş günü (business day) sınırları ──────────────────────────────
//
// Dükkân bazı geceler 02:00'a kadar açık kalıyor. Takvim gecesine göre
// bölünen raporlarda o saatlerin cirosu ertesi güne düşüyordu. Bunun yerine
// günü personel "Günü Bitir" ile kapatıyor; raporlar bu kapanış anlarını
// sınır olarak kullanıyor.
//
// Zaman çizgisi kapanış anlarıyla ardışık dilimlere ayrılır:
//
//   ...──┬──────────┬──────────┬───────────▶
//        C1         C2         C3        (açık dilim)
//
// Bir dilimin "etiket günü", BAŞLANGICININ yerel takvim tarihidir. Yani
// 5 Eylül 10:00'da başlayıp 6 Eylül 02:00'da kapanan dilim "5 Eylül"dür.
//
// Hiç kapanış kaydı yoksa (yeni kurulum, ya da özelliğin açılmasından önceki
// geçmiş) takvim gününe düşülür — eski davranış korunur.

const pad = (n) => String(n).padStart(2, '0')

/** Yerel takvim tarihi, YYYY-MM-DD. */
export function localDateStr(d) {
  const x = d instanceof Date ? d : new Date(d)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

/** Verilen yerel tarihin 00:00'ı — ISO (UTC) olarak. */
export function localDayStartIso(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString()
}

/** Ertesi günün 00:00'ı — aralıklar üst sınır HARİÇ çalışır. */
export function localDayEndIso(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0).toISOString()
}

/**
 * Kapanış anlarını ardışık dilimlere çevirir.
 * @param {string[]} closuresAsc artan sırada ISO zaman damgaları
 * @returns {{start: string|null, end: string|null}[]} son eleman açık dilim
 */
export function segmentsFrom(closuresAsc) {
  const segs = []
  let prev = null
  for (const c of closuresAsc) {
    segs.push({ start: prev, end: c })
    prev = c
  }
  segs.push({ start: prev, end: null })
  return segs
}

/**
 * Dilimin etiket günü: BAŞLANGICININ yerel tarihi.
 *
 * İlk dilimin (başlangıcı olmayan) etiketi yoktur ve bilerek null döner: o
 * dilim, gün bitirme özelliği kullanılmaya başlamadan önceki tüm geçmişi
 * kapsar. Bitiş tarihiyle etiketlenseydi bir sonraki dilimle çakışır ve o
 * güne ait aralık geçmişin tamamını içine alırdı. Etiketsiz kalınca o
 * tarihler takvim gününe düşer — eski davranış, doğru olan da bu.
 */
export function labelDateOf(seg) {
  if (seg.start) return localDateStr(seg.start)
  return null
}

/**
 * Belirli bir takvim gününe karşılık gelen aralık.
 * O güne ait bir dilim varsa onun sınırları, yoksa takvim günü.
 * @returns {[string|null, string|null]} [başlangıç, bitiş) — null = sınırsız
 */
export function rangeForDate(dateStr, closuresAsc) {
  const segs = segmentsFrom(closuresAsc)
  const matches = segs.filter((s) => labelDateOf(s) === dateStr)
  if (matches.length === 0) {
    return [localDayStartIso(dateStr), localDayEndIso(dateStr)]
  }
  // Aynı gün içinde birden fazla kez gün bitirilmişse hepsini kapsa
  const first = matches[0]
  const last = matches[matches.length - 1]
  return [first.start ?? localDayStartIso(dateStr), last.end]
}

/** Verilen tarihin içinde bulunduğu haftanın Pazartesi–Pazar tarihleri. */
function weekDates(now) {
  const day = now.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const mon = new Date(now)
  mon.setDate(now.getDate() + diffToMon)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon)
    d.setDate(mon.getDate() + i)
    return localDateStr(d)
  })
}

/** Verilen tarihin ayındaki tüm günler. */
function monthDates(now) {
  const y = now.getFullYear()
  const m = now.getMonth()
  const count = new Date(y, m + 1, 0).getDate()
  return Array.from({ length: count }, (_, i) => `${y}-${pad(m + 1)}-${pad(i + 1)}`)
}

/**
 * Birden çok günün aralıklarını tek bir bitişik aralıkta birleştirir.
 * Dilimler ardışık olduğu için min başlangıç / max bitiş doğru sonucu verir.
 */
function mergeRanges(dateList, closuresAsc) {
  let start = null
  let end = null
  let sawOpenEnd = false
  for (const d of dateList) {
    const [s, e] = rangeForDate(d, closuresAsc)
    if (s !== null && (start === null || s < start)) start = s
    if (e === null) sawOpenEnd = true
    else if (end === null || e > end) end = e
  }
  return [start, sawOpenEnd ? null : end]
}

/**
 * Rapor sekmesi için iş günü aralığı.
 * @param {string} tabId today | yesterday | day | week | month | total
 * @param {string[]} closuresAsc artan ISO kapanış anları
 * @param {Date} now
 * @param {string|null} customDay 'day' sekmesi için YYYY-MM-DD
 * @returns {[string|null, string|null]} [başlangıç, bitiş) ISO
 */
export function businessRange(tabId, closuresAsc = [], now = new Date(), customDay = null) {
  const closures = [...closuresAsc].sort()

  if (tabId === 'total') return [null, null]

  if (tabId === 'today') {
    const last = closures.length ? closures[closures.length - 1] : null
    // Kapanış yoksa takvim gününe düş
    return [last ?? localDayStartIso(localDateStr(now)), null]
  }

  if (tabId === 'yesterday') {
    if (closures.length === 0) {
      const y = new Date(now)
      y.setDate(now.getDate() - 1)
      const ds = localDateStr(y)
      return [localDayStartIso(ds), localDayEndIso(ds)]
    }
    const last = closures[closures.length - 1]
    const prev = closures.length > 1 ? closures[closures.length - 2] : null
    // Tek kapanış varsa, önceki gün o kapanışın gününün başından itibarendir
    return [prev ?? localDayStartIso(localDateStr(last)), last]
  }

  if (tabId === 'day') {
    const ds = customDay || localDateStr(now)
    return rangeForDate(ds, closures)
  }

  if (tabId === 'week') return mergeRanges(weekDates(now), closures)
  if (tabId === 'month') return mergeRanges(monthDates(now), closures)

  return [null, null]
}

/** Son kapanıştan bu yana geçen saat. Kapanış yoksa null. */
export function hoursSinceLastClosure(closuresAsc = [], now = new Date()) {
  if (!closuresAsc.length) return null
  const last = new Date(closuresAsc[closuresAsc.length - 1])
  return (now.getTime() - last.getTime()) / 3_600_000
}

/**
 * Bir satisin ait oldugu is gununun etiket tarihi.
 * Kapanis yoksa ya da satis ilk kapanistan onceyse takvim gunune duser.
 */
export function businessDayOf(iso, closuresAsc = []) {
  const closures = [...closuresAsc].sort()
  if (!closures.length || iso < closures[0]) return localDateStr(iso)
  // iso >= closures[0]: kendisinden kucuk-esit son kapanis dilimin baslangicidir
  let start = closures[0]
  for (const c of closures) {
    if (c <= iso) start = c
    else break
  }
  return localDateStr(start)
}
