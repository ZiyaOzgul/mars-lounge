import { useState, useEffect, useCallback, useMemo } from 'react'
import { getOrdersList, getOrderItems, isDbInitialized } from '../../lib/localDb.js'
import { useApp } from '../../context/AppContext.jsx'
import './Orders.css'

// ── Helpers ───────────────────────────────────────────────────────

function getDateRange(preset) {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const today = fmt(now)

  if (preset === 'today') {
    return { start: today, end: today }
  }
  if (preset === 'week') {
    const day = now.getDay()
    const diffToMon = day === 0 ? -6 : 1 - day
    const mon = new Date(now); mon.setDate(now.getDate() + diffToMon)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { start: fmt(mon), end: fmt(sun) }
  }
  if (preset === 'month') {
    const y = now.getFullYear(), m = now.getMonth()
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    return { start: `${y}-${pad(m+1)}-01`, end: `${y}-${pad(m+1)}-${pad(daysInMonth)}` }
  }
  return { start: null, end: null }
}

function modifiersSum(mods) {
  return (mods || []).reduce(
    (s, m) => s + (Number(m.priceDelta) || 0) * (Number(m.quantity) || 1),
    0
  )
}

function formatTime(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatRelative(isoStr) {
  if (!isoStr) return ''
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Az önce'
  if (mins < 60) return `${mins} dk önce`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} saat önce`
  const days = Math.floor(hrs / 24)
  return `${days} gün önce`
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

function paymentIcon(method) {
  if (method === 'cash') return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="5" width="16" height="10" rx="2"/>
      <circle cx="10" cy="10" r="2.5"/>
      <path d="M5 10h1M14 10h1"/>
    </svg>
  )
  if (method === 'card') return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="5" width="16" height="10" rx="2"/>
      <path d="M2 8h16"/>
      <rect x="5" y="11" width="3" height="1.5" rx="0.5" fill="currentColor" stroke="none"/>
    </svg>
  )
  if (method === 'iban') return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 17h14"/>
      <path d="M4 15v-5M8 15v-5M12 15v-5M16 15v-5"/>
      <path d="M10 3l7 4H3l7-4z"/>
    </svg>
  )
  if (method === 'points') return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M10 2.5l2.3 4.7 5.2.8-3.8 3.6.9 5.2L10 14.3l-4.6 2.5.9-5.2L2.5 8l5.2-.8L10 2.5z" strokeLinejoin="round"/>
    </svg>
  )
  // clock icon for active orders
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="10" r="7"/>
      <path d="M10 6v4l2.5 2.5" strokeLinecap="round"/>
    </svg>
  )
}

// ── Main Component ────────────────────────────────────────────────

const DATE_PRESETS = [
  { key: 'today', label: 'Bugün' },
  { key: 'week',  label: 'Bu Hafta' },
  { key: 'month', label: 'Bu Ay' },
]

const STATUS_TABS = [
  { key: 'all',       label: 'Tümü' },
  { key: 'active',    label: 'Aktif' },
  { key: 'completed', label: 'Tamamlandı' },
]

export default function Orders() {
  const { dbReady, isOnline, runtimeStates, setRuntimeStates, tableDefs } = useApp()

  const [completedOrders, setCompletedOrders] = useState([])
  const [loading,         setLoading]         = useState(false)
  const [activeTab,       setActiveTab]       = useState('all')
  const [datePreset,      setDatePreset]      = useState('today')
  const [searchQuery,     setSearchQuery]     = useState('')
  const [selectedOrder,   setSelectedOrder]   = useState(null)
  const [orderItems,      setOrderItems]      = useState([])
  const [modalLoading,    setModalLoading]    = useState(false)
  const [animatingIds,    setAnimatingIds]    = useState(new Set())

  // Load completed orders from local DB
  const loadOrders = useCallback(() => {
    if (!isDbInitialized()) return
    setLoading(true)
    try {
      const { start, end } = getDateRange(datePreset)
      const rows = getOrdersList(start, end)
      setCompletedOrders(rows)
    } catch (err) {
      console.error('[Orders] load error', err)
    } finally {
      setLoading(false)
    }
  }, [datePreset])

  useEffect(() => {
    if (dbReady) loadOrders()
  }, [dbReady, loadOrders])

  // Derive active orders from runtimeStates
  const activeOrders = useMemo(() => {
    return Object.entries(runtimeStates ?? {})
      .filter(([, s]) => s.status === 'occupied' && (s.orders ?? []).some(o => o.items?.length > 0))
      .map(([tableId, s]) => {
        const def = tableDefs?.find(t => t.id === Number(tableId))
        const items = (s.orders ?? []).flatMap(o => o.items ?? [])
        const total = items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0)
        const itemsSummary = items.map(i => `${i.name} ×${i.qty}`).join(', ')
        return {
          id: `active-${tableId}`,
          status: 'active',
          isPrepared: s.isPrepared ?? false,
          _tableId: tableId,
          tableName: def?.name ?? `Masa ${tableId}`,
          total,
          itemsSummary,
          closedAt: s.openedAt ?? new Date().toISOString(),
          paymentMethod: null,
          _activeItems: items,
        }
      })
      .sort((a, b) => {
        // Prepared orders sink to bottom; within each group sort oldest first
        if (a.isPrepared !== b.isPrepared) return a.isPrepared ? 1 : -1
        return new Date(a.closedAt) - new Date(b.closedAt)
      })
  }, [runtimeStates, tableDefs])

  // Active orders on top (oldest first), completed at bottom (newest first)
  const allOrders = useMemo(() => {
    const completed = completedOrders
      .map(o => ({ ...o, status: o.status ?? 'completed' }))
      .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))
    return [...activeOrders, ...completed]
  }, [activeOrders, completedOrders])

  // Apply tab + search filters
  const filtered = useMemo(() => {
    let list = allOrders
    if (activeTab !== 'all') {
      list = list.filter(o => o.status === activeTab)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter(o =>
        o.tableName?.toLowerCase().includes(q) ||
        o.itemsSummary?.toLowerCase().includes(q) ||
        o.waiterName?.toLowerCase().includes(q)
      )
    }
    return list
  }, [allOrders, activeTab, searchQuery])

  // KPI totals (only completed orders count toward revenue)
  const kpi = useMemo(() => {
    const completedFiltered = filtered.filter(o => o.status === 'completed')
    const total = completedFiltered.reduce((s, o) => s + (o.total || 0), 0)
    const count = filtered.length
    const avg   = completedFiltered.length > 0 ? total / completedFiltered.length : 0
    return { total, count, avg, activeCount: activeOrders.length }
  }, [filtered, activeOrders])

  // Open detail modal
  async function openDetail(order) {
    setSelectedOrder(order)
    setOrderItems([])

    if (order.status === 'active') {
      // Items already in memory
      const items = (order._activeItems ?? []).map(i => ({
        name: i.name,
        quantity: i.qty,
        unitPrice: i.unitPrice,
        modifiers: i.modifiers || [],
      }))
      setOrderItems(items)
      return
    }

    // Completed order — fetch from DB
    setModalLoading(true)
    try {
      const items = getOrderItems(order.id)
      setOrderItems(items)
    } catch (err) {
      console.error('[Orders] getOrderItems error', err)
    } finally {
      setModalLoading(false)
    }
  }

  function closeModal() {
    setSelectedOrder(null)
    setOrderItems([])
  }

  function togglePrepared(e, tableId) {
    e.stopPropagation()
    const cur = runtimeStates[tableId]?.isPrepared ?? false
    if (!cur) {
      setAnimatingIds(prev => new Set(prev).add(tableId))
      setTimeout(() => {
        setRuntimeStates(prev => ({
          ...prev,
          [tableId]: { ...prev[tableId], isPrepared: true },
        }))
        setAnimatingIds(prev => { const s = new Set(prev); s.delete(tableId); return s })
      }, 350)
    } else {
      setRuntimeStates(prev => ({
        ...prev,
        [tableId]: { ...prev[tableId], isPrepared: false },
      }))
    }
  }

  return (
    <div className="orders-page">

      {/* Offline banner */}
      {!isOnline && (
        <div className="offline-banner">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3l14 14M8.5 8.7A4 4 0 0114 13M5.5 5.7A7 7 0 0115.5 13" strokeLinecap="round"/>
          </svg>
          Çevrimdışı — yerel veriler gösteriliyor
        </div>
      )}

      {/* Page header */}
      <div className="orders-header">
        <div className="orders-header__title">
          <h1>Siparişler</h1>
          <span className="orders-header__count">{filtered.length} sipariş</span>
          {kpi.activeCount > 0 && (
            <span className="orders-header__active-badge">{kpi.activeCount} açık</span>
          )}
        </div>
        <button className="orders-refresh-btn" onClick={loadOrders} disabled={loading} title="Yenile">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={loading ? 'spinning' : ''}>
            <path d="M16.5 10A6.5 6.5 0 113.5 10" strokeLinecap="round"/>
            <path d="M16.5 4v6h-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Toolbar */}
      <div className="orders-toolbar">
        {/* Status tabs */}
        <div className="orders-tabs">
          {STATUS_TABS.map(t => (
            <button
              key={t.key}
              className={`orders-tab${activeTab === t.key ? ' orders-tab--active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
              {t.key === 'active' && kpi.activeCount > 0 && (
                <span className="orders-tab__dot"/>
              )}
            </button>
          ))}
        </div>

        {/* Date presets */}
        <div className="orders-date-presets">
          {DATE_PRESETS.map(p => (
            <button
              key={p.key}
              className={`orders-date-btn${datePreset === p.key ? ' orders-date-btn--active' : ''}`}
              onClick={() => setDatePreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="orders-search">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="9" cy="9" r="5.5"/>
            <path d="M13.5 13.5l3 3" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder="Masa veya ürün ara…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="orders-search__clear" onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="orders-kpi">
        <div className="orders-kpi__card">
          <span className="orders-kpi__label">Toplam Sipariş</span>
          <span className="orders-kpi__value">{kpi.count}</span>
        </div>
        <div className="orders-kpi__divider"/>
        <div className="orders-kpi__card">
          <span className="orders-kpi__label">Toplam Ciro</span>
          <span className="orders-kpi__value orders-kpi__value--accent">{formatCurrency(kpi.total)}</span>
        </div>
        <div className="orders-kpi__divider"/>
        <div className="orders-kpi__card">
          <span className="orders-kpi__label">Ortalama Sepet</span>
          <span className="orders-kpi__value">{formatCurrency(kpi.avg)}</span>
        </div>
      </div>

      {/* Cards grid */}
      <div className="orders-grid">
        {loading && completedOrders.length === 0 ? (
          <div className="orders-empty">
            <div className="orders-spinner"/>
            <p>Yükleniyor…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="orders-empty">
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="8" y="12" width="32" height="28" rx="3"/>
              <path d="M16 12V9a2 2 0 012-2h12a2 2 0 012 2v3"/>
              <path d="M16 22h16M16 29h10" strokeLinecap="round"/>
            </svg>
            <p>Bu dönem için sipariş bulunamadı</p>
          </div>
        ) : (
          filtered.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              onClick={() => openDetail(order)}
              onTogglePrepared={order.status === 'active' ? (e) => togglePrepared(e, order._tableId) : undefined}
              isSinking={animatingIds.has(order._tableId)}
            />
          ))
        )}
      </div>

      {/* Detail modal */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          items={orderItems}
          loading={modalLoading}
          onClose={closeModal}
        />
      )}
    </div>
  )
}

// ── Order Card ────────────────────────────────────────────────────

function parseCompletedItems(itemsSummary) {
  if (!itemsSummary) return []
  // format: "Americano ×2, Tost ×1"
  return itemsSummary.split(', ').map(chunk => {
    const match = chunk.trim().match(/^(.+)\s×(\d+)$/)
    if (match) return { name: match[1].trim(), qty: Number(match[2]) }
    return { name: chunk.trim(), qty: 1 }
  })
}

function OrderCard({ order, onClick, onTogglePrepared, isSinking }) {
  const isActive = order.status === 'active'
  const isPrepared = isActive && order.isPrepared

  // Build item rows depending on source
  const itemRows = isActive
    ? (order._activeItems ?? []).map(i => {
        const mods = i.modifiers || []
        const lineUnit = i.unitPrice + modifiersSum(mods)
        return {
          name: i.name,
          qty: i.qty,
          unitPrice: lineUnit,
          lineTotal: i.qty * lineUnit,
          modifiers: mods,
        }
      })
    : (order.items && order.items.length > 0
        ? order.items.map(i => ({
            name: i.name,
            qty: i.qty,
            unitPrice: i.unitPrice,
            lineTotal: i.qty * i.unitPrice,
            modifiers: i.modifiers || [],
          }))
        : parseCompletedItems(order.itemsSummary).map(i => ({ ...i, modifiers: [] })))

  return (
    <div className={`order-card${isActive ? ' order-card--active' : ''}${isPrepared ? ' order-card--prepared' : ''}${isSinking ? ' order-card--sinking' : ''}`} onClick={onClick}>
      {/* Left accent stripe */}
      <div className={`order-card__stripe order-card__stripe--${isPrepared ? 'prepared' : isActive ? 'active' : 'completed'}`} />

      <div className="order-card__body">
        {/* Header row */}
        <div className="order-card__header">
          <div className="order-card__header-left">
            <span className={`order-card__badge order-card__badge--${isActive ? 'active' : 'completed'}`}>
              {isActive ? 'Aktif' : 'Tamamlandı'}
            </span>
            {isPrepared && (
              <span className="order-card__prepared-badge">✓ Hazırlandı</span>
            )}
            <span className="order-card__table-name">{order.tableName}</span>
          </div>
          <div className="order-card__header-right">
            <span className="order-card__time">{formatTime(order.closedAt)}</span>
            <span className="order-card__relative">{formatRelative(order.closedAt)}</span>
          </div>
        </div>

        {/* Divider */}
        <div className="order-card__divider" />

        {/* Items list */}
        <div className="order-card__items-list">
          {itemRows.length === 0 && (
            <span className="order-card__item-empty">Ürün bilgisi yok</span>
          )}
          {itemRows.map((item, i) => {
            const mods = item.modifiers || []
            return (
              <div key={i} className="order-card__item">
                <div className="order-card__item-row">
                  <span className="order-card__item-qty">{item.qty}×</span>
                  <span className="order-card__item-name">{item.name}</span>
                  {isActive ? (
                    <span className="order-card__item-price">
                      {formatCurrency(item.unitPrice)} × {item.qty}
                      <span className="order-card__item-line-total">{formatCurrency(item.lineTotal)}</span>
                    </span>
                  ) : null}
                </div>
                {mods.length > 0 && (
                  <div className="order-card__item-mods">
                    {mods.map((m, idx) => {
                      const q = m.quantity || 1
                      const deltaTotal = (Number(m.priceDelta ?? m.price_delta) || 0) * q
                      return (
                        <div key={m.modifierId ?? m.id ?? idx} className="order-card__item-mod">
                          <span className="order-card__item-mod-name">
                            + {m.name}{q > 1 ? ` ×${q}` : ''}
                          </span>
                          {deltaTotal !== 0 && (
                            <span className="order-card__item-mod-delta">
                              {deltaTotal > 0 ? '+' : '–'}₺{Math.abs(deltaTotal).toLocaleString('tr-TR')}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Divider */}
        <div className="order-card__divider" />

        {/* Footer row */}
        <div className="order-card__footer">
          <div className="order-card__payment">
            {isActive ? (
              <button
                className={`order-card__prepare-btn${isPrepared ? ' order-card__prepare-btn--done' : ''}`}
                onClick={onTogglePrepared}
                disabled={isSinking}
              >
                {isPrepared ? '✓ Hazırlandı' : '▶ Hazırla'}
              </button>
            ) : (
              <>
                <span className="order-card__payment-icon">{paymentIcon(order.paymentMethod)}</span>
                <span className="order-card__payment-label">{paymentLabel(order.paymentMethod)}</span>
              </>
            )}
          </div>
          <div className="order-card__total">
            <span className="order-card__total-label">Toplam</span>
            <span className="order-card__total-amount">{formatCurrency(order.total)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Detail Modal ──────────────────────────────────────────────────

function OrderDetailModal({ order, items, loading, onClose }) {
  const isActive = order.status === 'active'
  const subtotal = items.reduce(
    (s, it) => s + it.quantity * (it.unitPrice + modifiersSum(it.modifiers)),
    0
  )

  return (
    <div className="order-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="order-modal">

        <div className={`order-modal__header${isActive ? ' order-modal__header--active' : ''}`}>
          <div>
            <h2 className="order-modal__title">{order.tableName}</h2>
            <p className="order-modal__subtitle">
              {isActive
                ? <span className="order-modal__active-label">Aktif sipariş · {formatTime(order.closedAt)} açıldı</span>
                : `${formatDate(order.closedAt)} · ${formatTime(order.closedAt)}`
              }
            </p>
          </div>
          <button className="order-modal__close" onClick={onClose}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="order-modal__body">
          {loading ? (
            <div className="order-modal__loading">
              <div className="orders-spinner"/>
            </div>
          ) : items.length === 0 ? (
            <p className="order-modal__empty">Ürün detayı bulunamadı.</p>
          ) : (
            <div className="order-modal__items">
              <div className="order-modal__items-head">
                <span>Ürün</span>
                <span>Adet</span>
                <span>Birim</span>
                <span>Toplam</span>
              </div>
              {items.map((item, i) => {
                const mods = item.modifiers || []
                const hasMods = mods.length > 0
                const lineUnit = item.unitPrice + modifiersSum(mods)
                return (
                  <div key={i} className="order-modal__item">
                    <div className="order-modal__item-row">
                      <span className="order-modal__item-name">{item.name}</span>
                      <span className="order-modal__item-qty">
                        <span className="order-modal__qty-chip">{item.quantity}</span>
                      </span>
                      <span className="order-modal__item-unit">{formatCurrency(lineUnit)}</span>
                      <span className="order-modal__item-total">{formatCurrency(item.quantity * lineUnit)}</span>
                    </div>
                    {hasMods && (
                      <div className="order-modal__item-mods">
                        {mods.map((m, idx) => {
                          const q = m.quantity || 1
                          const deltaTotal = (Number(m.priceDelta) || 0) * q
                          return (
                            <div key={m.modifierId ?? m.id ?? idx} className="order-modal__item-mod">
                              <span className="order-modal__item-mod-name">
                                + {m.name}{q > 1 ? ` ×${q}` : ''}
                              </span>
                              {deltaTotal !== 0 && (
                                <span className="order-modal__item-mod-delta">
                                  {deltaTotal > 0 ? '+' : '–'}₺{Math.abs(deltaTotal).toLocaleString('tr-TR')}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="order-modal__summary">
          <div className="order-modal__summary-row">
            <span>Ara Toplam</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="order-modal__summary-divider"/>
          <div className="order-modal__summary-row order-modal__summary-row--total">
            <span>Toplam</span>
            <span>{formatCurrency(isActive ? subtotal : order.total)}</span>
          </div>
          {!isActive && (
            <div className="order-modal__payment-badge">
              <span className="order-card__payment-icon">{paymentIcon(order.paymentMethod)}</span>
              {paymentLabel(order.paymentMethod)} ile ödendi
            </div>
          )}
          {isActive && (
            <div className="order-modal__active-note">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="6"/>
                <path d="M8 5v3l2 2" strokeLinecap="round"/>
              </svg>
              Masa hâlâ açık — ödeme bekleniyor
            </div>
          )}
        </div>

        <div className="order-modal__footer">
          <button className="order-modal__close-btn" onClick={onClose}>Kapat</button>
        </div>

      </div>
    </div>
  )
}
