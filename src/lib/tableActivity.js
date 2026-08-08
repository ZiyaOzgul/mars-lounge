// Idle-time thresholds for the Masalar table cards — single source of truth
// so both Tables.jsx (computation) and TableCard.jsx (styling) agree.
export const IDLE_WARN_MIN = 30   // sarı
export const IDLE_ALERT_MIN = 60  // kırmızı

// En son eklenen ürünün zamanı; hiç ürün yoksa masanın açılış zamanı.
export function lastActivityAt({ items, openedAt }) {
  const itemTimes = (items ?? [])
    .map(i => i?.addedAt ? new Date(i.addedAt).getTime() : null)
    .filter(t => t != null && !Number.isNaN(t))

  if (itemTimes.length > 0) return Math.max(...itemTimes)

  if (openedAt) {
    const t = new Date(openedAt).getTime()
    return Number.isNaN(t) ? null : t
  }

  return null
}

export function idleMinutes({ items, openedAt }, now = Date.now()) {
  const last = lastActivityAt({ items, openedAt })
  if (last == null) return 0
  return Math.max(0, Math.floor((now - last) / 60000))
}

export function idleLevel(minutes) {
  if (minutes >= IDLE_ALERT_MIN) return 'alert'
  if (minutes >= IDLE_WARN_MIN) return 'warn'
  return 'ok'
}
