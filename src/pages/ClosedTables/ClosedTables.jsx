import { useState, useEffect, useCallback, useMemo } from 'react'
import { getClosedOrders, isDbInitialized } from '../../lib/localDb.js'
import { useApp } from '../../context/AppContext.jsx'
import ReopenModal from '../../components/ReopenModal/ReopenModal.jsx'
import './ClosedTables.css'

// ── Helpers ───────────────────────────────────────────────────────

function getSinceIso(preset) {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  if (preset === 'today') return fmt(now)
  if (preset === 'week') {
    const day = now.getDay()
    const diffToMon = day === 0 ? -6 : 1 - day
    const mon = new Date(now); mon.setDate(now.getDate() + diffToMon)
    return fmt(mon)
  }
  return null // 'all'
}

function formatTime(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

function formatDayHeader(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function dayKey(isoStr) {
  const d = new Date(isoStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatCurrency(n) {
  return `₺${Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function paymentLabel(method) {
  if (method === 'cash') return 'Nakit'
  if (method === 'card') return 'Kart'
  if (method === 'iban') return 'IBAN'
  if (method === 'split') return 'Karma'
  if (method === 'points') return 'Puan'
  return method || '—'
}

function itemsSummary(items) {
  if (!items?.length) return 'Ürün bilgisi yok'
  const text = items.map(i => `${i.qty}× ${i.name}`).join(', ')
  return text.length > 70 ? `${text.slice(0, 70)}…` : text
}

// ── Main Component ────────────────────────────────────────────────

const DATE_TABS = [
  { key: 'today', label: 'Bugün' },
  { key: 'week',  label: 'Bu Hafta' },
  { key: 'all',   label: 'Tümü' },
]

export default function ClosedTables() {
  const { dbReady } = useApp()
  const [datePreset,   setDatePreset]   = useState('today')
  const [orders,        setOrders]      = useState([])
  const [loading,       setLoading]     = useState(false)
  const [reopenOrder,   setReopenOrder] = useState(null)

  const loadOrders = useCallback(() => {
    if (!isDbInitialized()) return
    setLoading(true)
    try {
      const sinceIso = getSinceIso(datePreset)
      const rows = getClosedOrders({ sinceIso, limit: 200 })
      setOrders(rows)
    } catch (err) {
      console.error('[ClosedTables] load error', err)
    } finally {
      setLoading(false)
    }
  }, [datePreset])

  useEffect(() => {
    if (dbReady) loadOrders()
  }, [dbReady, loadOrders])

  // Group newest-first orders by their local calendar day
  const groups = useMemo(() => {
    const map = new Map()
    for (const o of orders) {
      const key = dayKey(o.closedAt)
      if (!map.has(key)) map.set(key, { header: formatDayHeader(o.closedAt), rows: [] })
      map.get(key).rows.push(o)
    }
    return [...map.values()]
  }, [orders])

  return (
    <div className="closed-tables-page">

      {/* Header */}
      <div className="ct-header">
        <div className="ct-header__title">
          <h1>Kapanan Masalar</h1>
          <span className="ct-header__count">{orders.length} sipariş</span>
        </div>
        <button className="ct-refresh-btn" onClick={loadOrders} disabled={loading} title="Yenile">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={loading ? 'ct-spinning' : ''}>
            <path d="M16.5 10A6.5 6.5 0 113.5 10" strokeLinecap="round"/>
            <path d="M16.5 4v6h-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Date tabs */}
      <div className="ct-tabs">
        {DATE_TABS.map(t => (
          <button
            key={t.key}
            className={`ct-tab${datePreset === t.key ? ' ct-tab--active' : ''}`}
            onClick={() => setDatePreset(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="ct-list">
        {loading && orders.length === 0 ? (
          <div className="ct-empty">
            <div className="ct-spinner"/>
            <p>Yükleniyor…</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="ct-empty">
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 24a16 16 0 1 0 16-16 16.5 16.5 0 0 0-11.4 4.6L8 17"/>
              <path d="M8 8v9h9"/>
            </svg>
            <p>Bu dönem için kapanan masa bulunamadı</p>
          </div>
        ) : (
          groups.map(g => (
            <div key={g.header} className="ct-day-group">
              <div className="ct-day-header">{g.header}</div>
              <div className="ct-rows">
                {g.rows.map(o => (
                  <button key={o.id} className="ct-row" onClick={() => setReopenOrder(o)}>
                    <div className="ct-row__main">
                      <span className="ct-row__table">{o.tableName}</span>
                      <span className="ct-row__time">{formatTime(o.closedAt)}</span>
                      <span className="ct-row__payment">{paymentLabel(o.paymentMethod)}</span>
                    </div>
                    <div className="ct-row__summary">{itemsSummary(o.items)}</div>
                    <div className="ct-row__total">{formatCurrency(o.total)}</div>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {reopenOrder && (
        <ReopenModal order={reopenOrder} onClose={() => setReopenOrder(null)} />
      )}
    </div>
  )
}
