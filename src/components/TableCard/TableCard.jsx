import './TableCard.css'
import { idleLevel } from '../../lib/tableActivity.js'

function formatTime(minutes) {
  if (minutes < 60) return `${minutes} dk`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}s ${m} dk` : `${h}s`
}

function ClockIcon({ color }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function TableCard({ table, isSelected, onClick }) {
  const { name, status, type, openMinutes, itemCount, total, idleMinutes } = table

  if (status === 'empty') {
    return (
      <div className="table-card table-card--empty" onClick={onClick}>
        <div className="table-card__top-row">
          <span className="table-card__name-empty">{name}</span>
          <span className="badge badge--muted">BOŞ</span>
        </div>
        <div className="table-card__bos-label">BOŞ</div>
      </div>
    )
  }

  const cardClass =
    type === 'qr' ? 'table-card--qr'
    : type === 'alert' ? 'table-card--alert'
    : 'table-card--active'

  // Idle-time warning — additive to cardClass, does not replace QR/alert meaning.
  const idleLvl = idleLevel(idleMinutes)
  const idleClass =
    idleLvl === 'alert' ? 'table-card--idle-alert'
    : idleLvl === 'warn' ? 'table-card--idle-warn'
    : ''

  const clockColor =
    type === 'qr' ? 'var(--color-qr)'
    : type === 'alert' ? 'var(--color-danger)'
    : 'var(--color-accent)'

  // Split name into prefix "T-" and number "04"
  const dashIdx = name.indexOf('-')
  const prefix = dashIdx !== -1 ? name.slice(0, dashIdx + 1) : ''
  const number = dashIdx !== -1 ? name.slice(dashIdx + 1) : name

  return (
    <div
      className={`table-card ${cardClass} ${idleClass} ${isSelected ? 'table-card--selected' : ''}`}
      onClick={onClick}
    >
      {/* Top badge row */}
      <div className="table-card__top-row">
        <div className="table-card__badges-left">
          {type === 'alert' ? (
            <span className="badge badge--warning">ALERT</span>
          ) : isSelected ? (
            <span className="badge badge--accent">SEÇİLİ</span>
          ) : (
            <span className="badge badge--success">DOLU</span>
          )}
        </div>
        <div className="table-card__badges-right">
          {type === 'qr' && (
            <span className="badge badge--qr">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 3 }}>
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                <line x1="12" y1="18" x2="12.01" y2="18" />
              </svg>
              QR/Online
            </span>
          )}
          {type === 'alert' && (
            <span className="badge badge--danger">
              ▲ ALERT
            </span>
          )}
          {type === 'normal' && (
            <span className="badge badge--success">DOLU</span>
          )}
        </div>
      </div>

      {/* Table name */}
      <div className="table-card__name-wrap">
        <span className="table-card__prefix">{prefix}</span>
        <span className="table-card__number">{number}</span>
      </div>

      {/* Time row */}
      <div className="table-card__time-row">
        <ClockIcon color={clockColor} />
        <span className="table-card__time" style={{ color: clockColor }}>
          {formatTime(openMinutes)}
        </span>
      </div>
      {/* Yalnızca eşik aşılınca göster — mobil masa kartıyla aynı davranış,
          normal masalarda gereksiz gürültü yapmasın. */}
      {idleLvl !== 'ok' && (
        <div className="table-card__idle-label">
          {formatTime(idleMinutes)} sipariş yok
        </div>
      )}

      {/* Body */}
      {type === 'qr' ? (
        <div className="table-card__qr-body">
          <span className="table-card__qr-label">QR Siparişi</span>
          <span className="table-card__qr-status">Onay Bekliyor</span>
        </div>
      ) : (
        <div className="table-card__order-body">
          <span className="table-card__item-count">{itemCount} ürün</span>
          <div className="table-card__price-row">
            <span className="table-card__price">₺{total?.toLocaleString('tr-TR')}</span>
            {isSelected && <span className="table-card__arrow">→</span>}
          </div>
        </div>
      )}
    </div>
  )
}

export default TableCard
