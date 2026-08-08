import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext.jsx'
import TablePickerModal from '../TablePickerModal/TablePickerModal.jsx'
import { hasPerm } from '../../lib/permissions.js'
import './ReopenModal.css'

const MODES = [
  {
    id: 'correction',
    label: 'Düzeltme',
    hint: 'Orijinal sipariş iptal edilir, ödemeleri ve cirosu geri alınır',
  },
  {
    id: 'new',
    label: 'Yeni Sipariş',
    hint: 'Kapanan sipariş aynen kalır, seçili ürünler yeni adisyon olarak açılır',
  },
]

function modifiersSum(modifiers) {
  if (!modifiers?.length) return 0
  return modifiers.reduce((s, m) => s + (Number(m.priceDelta) || 0) * (Number(m.quantity) || 1), 0)
}

function itemUnit(item) {
  return item.unitPrice + modifiersSum(item.modifiers)
}

function fmt(n) {
  return `₺${Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function ReopenModal({ order, onClose }) {
  const { reopenClosedOrder, tableDefs, runtimeStates, currentUser } = useApp()
  const canReopen = hasPerm(currentUser, 'reopen_table')
  const navigate = useNavigate()

  const [selectedIds, setSelectedIds] = useState(() => new Set(order.items.map(i => i.id)))
  const [mode, setMode] = useState(null)
  const [targetTableId, setTargetTableId] = useState(order.tableId ?? null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const targetTableName = useMemo(() => {
    return tableDefs.find(t => t.id === targetTableId)?.name ?? order.tableName
  }, [tableDefs, targetTableId, order.tableName])

  // Same shape Tables.jsx builds for OrderPanel's table picker.
  const pickerTables = useMemo(() => {
    return tableDefs.map(def => {
      const state = runtimeStates[def.id] ?? { status: 'empty' }
      const orderItems = (state.orders ?? []).flatMap(o => o.items ?? [])
      return { ...def, ...state, orderItems }
    })
  }, [tableDefs, runtimeStates])

  const toggleItem = (id) => setSelectedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const selectedTotal = order.items
    .filter(i => selectedIds.has(i.id))
    .reduce((s, i) => s + i.qty * itemUnit(i), 0)

  const canConfirm = canReopen && !!mode && selectedIds.size > 0 && !submitting

  const handleConfirm = async () => {
    if (!canConfirm) return
    setSubmitting(true)
    setError(null)
    try {
      await reopenClosedOrder({
        orderId: order.id,
        selectedItemIds: [...selectedIds],
        mode,
        targetTableId,
      })
      onClose()
      navigate('/')
    } catch (e) {
      console.error('[ReopenModal] reopen failed', e)
      setError(e?.message ?? 'Sipariş yeniden açılamadı')
      setSubmitting(false)
    }
  }

  return (
    <div className="reo-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="reo-modal">

        <div className="reo-header">
          <div>
            <h2 className="reo-title">{order.tableName} — Kapanan Sipariş</h2>
            <p className="reo-subtitle">{fmt(order.total)} · Yeniden açmak için ürün ve mod seçin</p>
          </div>
          <button className="reo-close" onClick={onClose} aria-label="Kapat">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="reo-body">
          {/* Items */}
          <div className="reo-items">
            {order.items.map(item => {
              const checked = selectedIds.has(item.id)
              const unit = itemUnit(item)
              const mods = item.modifiers || []
              return (
                <label key={item.id} className={`reo-item${checked ? ' reo-item--checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleItem(item.id)}
                  />
                  <div className="reo-item__body">
                    <div className="reo-item__row">
                      <span className="reo-item__qty">{item.qty}×</span>
                      <span className="reo-item__name">{item.name}</span>
                      <span className="reo-item__total">{fmt(item.qty * unit)}</span>
                    </div>
                    {mods.length > 0 && (
                      <div className="reo-item__mods">
                        {mods.map((m, idx) => (
                          <span key={m.modifierId ?? idx} className="reo-item__mod">
                            + {m.name}{(m.quantity || 1) > 1 ? ` ×${m.quantity}` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </label>
              )
            })}
          </div>

          {/* Mode segmented control */}
          <div className="reo-modes">
            {MODES.map(m => (
              <button
                key={m.id}
                type="button"
                className={`reo-mode${mode === m.id ? ' reo-mode--active' : ''}`}
                onClick={() => setMode(m.id)}
              >
                <span className="reo-mode__label">{m.label}</span>
                <span className="reo-mode__hint">{m.hint}</span>
              </button>
            ))}
          </div>

          {/* Target table */}
          <div className="reo-target">
            <div className="reo-target__info">
              <span className="reo-target__label">Hedef Masa</span>
              <span className="reo-target__name">{targetTableName}</span>
            </div>
            <button type="button" className="reo-target__change" onClick={() => setPickerOpen(true)}>
              Masa Değiştir
            </button>
          </div>

          {error && <div className="reo-error">{error}</div>}
        </div>

        <div className="reo-footer">
          <div className="reo-footer__summary">
            <span>{selectedIds.size} ürün seçili</span>
            <strong>{fmt(selectedTotal)}</strong>
          </div>
          <div className="reo-footer__actions">
            {!canReopen && <span className="reo-footer__noperm">Yeniden açma yetkiniz yok</span>}
            <button className="reo-btn reo-btn--cancel" onClick={onClose}>İptal</button>
            <button
              className={`reo-btn reo-btn--confirm${!canConfirm ? ' reo-btn--disabled' : ''}`}
              onClick={handleConfirm}
              disabled={!canConfirm}
            >
              {submitting ? 'Açılıyor…' : 'Yeniden Aç'}
            </button>
          </div>
        </div>
      </div>

      <TablePickerModal
        open={pickerOpen}
        tables={pickerTables}
        mode="all"
        title="Hedef Masa"
        subtitle="Ürünlerin ekleneceği masayı seçin"
        onSelect={(t) => { setTargetTableId(t.id); setPickerOpen(false) }}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  )
}

export default ReopenModal
