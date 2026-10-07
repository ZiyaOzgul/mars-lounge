import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext.jsx'
import TablePickerModal from '../TablePickerModal/TablePickerModal.jsx'
import { hasPerm } from '../../lib/permissions.js'
import { getSettledPaymentsForOrder, getDayClosures, updateOrderSaleDate } from '../../lib/localDb.js'
import { businessDayOf } from '../../lib/businessDay.js'
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

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('tr-TR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ISO → <input type="datetime-local"> degeri (YEREL saat)
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// datetime-local degeri → ISO. Saat dilimi belirtilmemis tarih-saat yerel
// saat olarak yorumlanir (ECMAScript kurali).
function fromLocalInput(v) {
  if (!v) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

// 'YYYY-MM-DD' (is gunu etiketi) → "6 Ekim Pazartesi"
function fmtBusinessDay(dateStr) {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })
}

const PAYMENT_METHOD_LABELS = {
  cash: 'Nakit',
  card: 'Kart',
  iban: 'IBAN',
  veresiye: 'Veresiye',
  split: 'Karma',
  points: 'Puan',
}

function paymentMethodLabel(method) {
  return PAYMENT_METHOD_LABELS[method] ?? (method || '—')
}

function ReopenModal({ order, onClose, onChanged }) {
  const { reopenClosedOrder, tableDefs, runtimeStates, currentUser, triggerSync } = useApp()
  const canReopen = hasPerm(currentUser, 'reopen_table')
  const canEditDate = hasPerm(currentUser, 'edit_sale_date')

  // ── Satis tarihi duzeltme ────────────────────────────────────────
  // Bir hata yuzunden acik kalip ertesi gun kapatilan siparis ertesi gunun
  // cirosuna dusuyor, gercekte odendigi gunun kasasi acik veriyordu. Ciro
  // gun siniri "Gunu Bitir" kapanislarina gore hesaplandigi icin (takvim
  // gunu degil) yeni zamanin HANGI IS GUNUNE dustugunu kaydetmeden once
  // gosteriyoruz — gece yarisindan sonraki bir saat onceki gune ait olabilir.
  const closures = useMemo(() => {
    try { return getDayClosures() } catch { return [] }
  }, [])
  const [dateEditing, setDateEditing] = useState(false)
  const [dateValue, setDateValue] = useState(() => toLocalInput(order.closedAt))
  const [dateSaving, setDateSaving] = useState(false)
  const [dateError, setDateError] = useState(null)
  const currentDay = businessDayOf(order.closedAt, closures)
  const newIso = fromLocalInput(dateValue)
  const newDay = newIso ? businessDayOf(newIso, closures) : null
  const dateChanged = !!newIso && toLocalInput(newIso) !== toLocalInput(order.closedAt)

  const saveSaleDate = async () => {
    if (!newIso || !dateChanged || dateSaving) return
    setDateSaving(true)
    setDateError(null)
    try {
      await updateOrderSaleDate(order.id, newIso)
      // Sunucuya da gitsin; cevrimdisiysa sync kuyrugu sonra gonderir
      try { triggerSync?.() } catch { /* yerel kayit zaten tamam */ }
      onChanged?.()
      onClose()
    } catch (e) {
      console.error('[ReopenModal] satış tarihi değiştirilemedi', e)
      setDateError(e?.message ?? 'Tarih değiştirilemedi')
      setDateSaving(false)
    }
  }
  const navigate = useNavigate()

  const [selectedIds, setSelectedIds] = useState(() => new Set(order.items.map(i => i.id)))
  const [mode, setMode] = useState(null)
  const [targetTableId, setTargetTableId] = useState(order.tableId ?? null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Settled (already-collected) payments on this order — e.g. a veresiye
  // debt paid off weeks after the table closed. "Düzeltme" permanently
  // deletes these rows (local + server), so they must be surfaced and
  // explicitly confirmed before that mode is allowed to proceed.
  const settledPayments = useMemo(() => {
    try {
      return getSettledPaymentsForOrder(order.id)
    } catch (e) {
      console.error('[ReopenModal] settled payments lookup failed', e)
      return []
    }
  }, [order.id])
  const [showDebtConfirm, setShowDebtConfirm] = useState(false)
  const hasSettledDebt = settledPayments.length > 0

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

  const doReopen = async () => {
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

  const handleConfirm = () => {
    if (!canConfirm) return
    // Correction mode deletes every payment row on this order. If any of
    // them was already settled (a debt actually collected), that record —
    // and the cash it represents — vanishes with no trace. Require an
    // explicit, informed second confirmation before that can happen.
    if (mode === 'correction' && hasSettledDebt) {
      setShowDebtConfirm(true)
      return
    }
    doReopen()
  }

  const handleConfirmDebtDeletion = () => {
    setShowDebtConfirm(false)
    doReopen()
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
          {/* Satis zamani — hangi gunun cirosuna yazildigi */}
          <div className="reo-saledate">
            <div className="reo-saledate__row">
              <div className="reo-saledate__info">
                <span className="reo-saledate__label">Satış zamanı</span>
                <span className="reo-saledate__value">{fmtDateTime(order.closedAt)}</span>
                <span className="reo-saledate__day">Ciro günü: {fmtBusinessDay(currentDay)}</span>
                {order.closedAtOriginal && (
                  <span className="reo-saledate__edited" title="Bu siparişin satış tarihi elle değiştirildi">
                    Tarih düzeltildi — asıl: {fmtDateTime(order.closedAtOriginal)}
                  </span>
                )}
              </div>
              {canEditDate && !dateEditing && (
                <button type="button" className="reo-saledate__btn" onClick={() => setDateEditing(true)}>
                  Tarihi Düzelt
                </button>
              )}
            </div>

            {dateEditing && (
              <div className="reo-saledate__editor">
                <label className="reo-saledate__field">
                  <span>Gerçek ödeme zamanı</span>
                  <input
                    type="datetime-local"
                    value={dateValue}
                    min={toLocalInput(order.createdAt)}
                    max={toLocalInput(new Date().toISOString())}
                    onChange={e => { setDateValue(e.target.value); setDateError(null) }}
                  />
                </label>
                {order.createdAt && (
                  <span className="reo-saledate__hint">Masa açılışı: {fmtDateTime(order.createdAt)}</span>
                )}
                {dateChanged && newDay && (
                  newDay !== currentDay ? (
                    <div className="reo-saledate__preview">
                      <strong>{fmt(order.total)}</strong>, {fmtBusinessDay(currentDay)} cirosundan çıkıp{' '}
                      <strong>{fmtBusinessDay(newDay)}</strong> cirosuna yazılacak.
                    </div>
                  ) : (
                    <div className="reo-saledate__preview reo-saledate__preview--same">
                      Saat değişiyor ama ciro günü aynı kalıyor: {fmtBusinessDay(newDay)}.
                    </div>
                  )
                )}
                {dateError && <div className="reo-error">{dateError}</div>}
                <div className="reo-saledate__actions">
                  <button
                    type="button"
                    className="reo-btn reo-btn--cancel"
                    onClick={() => { setDateEditing(false); setDateValue(toLocalInput(order.closedAt)); setDateError(null) }}
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    className={`reo-btn reo-btn--confirm${(!dateChanged || dateSaving) ? ' reo-btn--disabled' : ''}`}
                    disabled={!dateChanged || dateSaving}
                    onClick={saveSaleDate}
                  >
                    {dateSaving ? 'Kaydediliyor…' : 'Tarihi Kaydet'}
                  </button>
                </div>
              </div>
            )}
          </div>

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
                <span className="reo-mode__labelrow">
                  <span className="reo-mode__label">{m.label}</span>
                  {m.id === 'correction' && hasSettledDebt && (
                    <span className="reo-mode__warning">Tahsilat silinir</span>
                  )}
                </span>
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

      {showDebtConfirm && (
        <div className="reo-debt-overlay" onClick={e => e.target === e.currentTarget && setShowDebtConfirm(false)}>
          <div className="reo-debt-modal">
            <h3 className="reo-debt-title">Tahsil Edilmiş Ödemeler Silinecek</h3>
            <p className="reo-debt-text">
              Bu siparişte daha önce tahsil edilmiş ödeme kayıtları var. Düzeltme moduyla devam ederseniz
              aşağıdaki kayıtlar bu cihazdan ve sunucudan <strong>kalıcı olarak silinir</strong>, sipariş iptal
              edilerek ciro dışına alınır. Bu işlem geri alınamaz.
            </p>
            <div className="reo-debt-list">
              {settledPayments.map((p, idx) => (
                <div key={idx} className="reo-debt-item">
                  <span className="reo-debt-item__amount">{fmt(p.amount)}</span>
                  <span className="reo-debt-item__payer">{p.payerLabel || '—'}</span>
                  <span className="reo-debt-item__date">{fmtDateTime(p.settledAt)}</span>
                  <span className="reo-debt-item__method">{paymentMethodLabel(p.settledMethod || p.paymentMethod)}</span>
                </div>
              ))}
            </div>
            <div className="reo-debt-actions">
              <button className="reo-btn reo-btn--cancel" onClick={() => setShowDebtConfirm(false)}>
                Vazgeç
              </button>
              <button className="reo-btn reo-btn--danger" onClick={handleConfirmDebtDeletion}>
                Kayıtları Sil ve Devam Et
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ReopenModal
