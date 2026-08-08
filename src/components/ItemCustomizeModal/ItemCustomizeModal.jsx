import { useMemo, useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import './ItemCustomizeModal.css'

// Picks the modifier list for a product (category-inherited minus excluded,
// plus product-specific). Re-computed when the modifiers store changes so the
// modal stays live while the cafe owner edits modifiers in another tab.
function useEffectiveModifiers(productId, categoryId) {
  const { modifiers, effectiveModifiersForProduct } = useApp()
  return useMemo(() => {
    if (!productId) return []
    return effectiveModifiersForProduct(productId, categoryId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, categoryId, modifiers])
}

function ItemCustomizeModal({
  open,
  product,            // { id, name, price, categoryId, ... }  — required for 'add' mode
  variants,           // optional [{ id, name, price }] — variant picker shown when non-empty (add mode only)
  basePrice,          // resolved unit price fallback (used when no variants, e.g. edit mode)
  initialModifiers,   // [{ modifierId, name, priceDelta, quantity }]
  mode = 'add',       // 'add' | 'edit'
  onSubmit,           // (modifiers[], qty, variant|null) => void
  onClose,
}) {
  const effective = useEffectiveModifiers(product?.id, product?.categoryId)
  const hasVariants = mode === 'add' && !!variants?.length

  // selected: { [modifierId]: quantity }
  const [selected, setSelected] = useState({})
  const [qty, setQty] = useState(1)
  const [selectedVariantId, setSelectedVariantId] = useState(null)

  // Seed the selection when the modal transitions to open (adjust-during-render).
  // The old effect re-seeded on every parent re-render too, wiping in-progress picks.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      const initial = {}
      if (initialModifiers?.length) {
        for (const m of initialModifiers) {
          const key = m.modifierId ?? m.id
          if (key != null) initial[key] = m.quantity || 1
        }
      }
      setSelected(initial)
      setQty(1)
      setSelectedVariantId(variants?.length ? variants[0].id : null)
    }
  }

  if (!open || !product) return null

  const selectedVariant = hasVariants
    ? (variants.find(v => v.id === selectedVariantId) ?? variants[0])
    : null
  const qtyNum = Math.min(99, Math.max(1, Number(qty) || 1))
  const unitPrice = Number(hasVariants ? (selectedVariant?.price ?? 0) : (basePrice ?? product.price ?? 0))
  const modifiersTotal = effective.reduce((sum, m) => {
    const q = selected[m.id] || 0
    return sum + q * (Number(m.priceDelta) || 0)
  }, 0)
  const lineTotal = unitPrice + modifiersTotal
  const grandTotal = qtyNum * lineTotal

  const inc = (m) => setSelected(prev => ({ ...prev, [m.id]: (prev[m.id] || 0) + 1 }))
  const dec = (m) => setSelected(prev => {
    const next = { ...prev }
    const v = (next[m.id] || 0) - 1
    if (v <= 0) delete next[m.id]
    else next[m.id] = v
    return next
  })

  const decQty = () => setQty(q => Math.max(1, (Number(q) || 1) - 1))
  const incQty = () => setQty(q => Math.min(99, (Number(q) || 1) + 1))
  const onQtyChange = (e) => {
    const raw = e.target.value
    if (raw === '') { setQty(''); return }
    const n = parseInt(raw, 10)
    if (Number.isNaN(n)) return
    setQty(Math.min(99, Math.max(1, n)))
  }
  const onQtyBlur = () => {
    if (qty === '' || Number(qty) < 1) setQty(1)
  }

  const submit = () => {
    const out = []
    for (const m of effective) {
      const q = selected[m.id]
      if (!q || q <= 0) continue
      out.push({
        modifierId: m.id,
        name: m.name,
        priceDelta: Number(m.priceDelta) || 0,
        quantity: q,
      })
    }
    onSubmit(out, qtyNum, hasVariants ? selectedVariant : null)
  }

  return (
    <div className="icm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="icm-modal">

        <div className="icm-header">
          <div className="icm-header__text">
            <div className="icm-title">{product.name}</div>
            {!hasVariants && (
              <div className="icm-subtitle">
                {mode === 'edit' ? 'Ekstraları düzenle' : 'Ekstra ister misiniz?'}
              </div>
            )}
          </div>
          <button className="icm-close-btn" onClick={onClose} aria-label="Kapat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {hasVariants && (
          <div className="icm-variants">
            <div className="icm-section-label">Seçenek</div>
            <div className="icm-variant-list">
              {variants.map(v => (
                <button
                  key={v.id}
                  type="button"
                  className={`icm-variant-item ${selectedVariant?.id === v.id ? 'icm-variant-item--active' : ''}`}
                  onClick={() => setSelectedVariantId(v.id)}
                >
                  <span className="icm-variant-item__name">{v.name}</span>
                  <span className="icm-variant-item__price">₺{v.price.toLocaleString('tr-TR')}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {effective.length === 0 ? (
          <div className="icm-empty">
            Bu ürün için tanımlı ekstra yok.
            <div className="icm-empty__hint">Ayarlar → Kategoriler ekranından ekstra tanımlayabilirsiniz.</div>
          </div>
        ) : (
          <div className="icm-list">
            {effective.map(m => {
              const qty = selected[m.id] || 0
              const active = qty > 0
              const deltaLabel = m.priceDelta > 0
                ? `+₺${Number(m.priceDelta).toLocaleString('tr-TR')}`
                : m.priceDelta < 0
                  ? `–₺${Math.abs(Number(m.priceDelta)).toLocaleString('tr-TR')}`
                  : null
              return (
                <div key={m.id} className={`icm-row ${active ? 'icm-row--active' : ''}`}>
                  <div className="icm-row__text">
                    <div className="icm-row__name">{m.name}</div>
                    {deltaLabel && <div className="icm-row__delta">{deltaLabel}</div>}
                  </div>
                  <div className="icm-qty">
                    <button
                      className="icm-qty__btn"
                      onClick={() => dec(m)}
                      disabled={qty === 0}
                      aria-label="Azalt"
                    >−</button>
                    <span className="icm-qty__value">{qty}</span>
                    <button
                      className="icm-qty__btn icm-qty__btn--plus"
                      onClick={() => inc(m)}
                      aria-label="Artır"
                    >+</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {mode === 'add' && (
          <div className="icm-qty-section">
            <div className="icm-section-label">Adet</div>
            <div className="icm-qty-stepper">
              <button
                type="button"
                className="icm-qty-stepper__btn"
                onClick={decQty}
                disabled={qtyNum <= 1}
                aria-label="Azalt"
              >−</button>
              <input
                className="icm-qty-stepper__input"
                type="number"
                min={1}
                max={99}
                value={qty}
                onChange={onQtyChange}
                onBlur={onQtyBlur}
              />
              <button
                type="button"
                className="icm-qty-stepper__btn icm-qty-stepper__btn--plus"
                onClick={incQty}
                disabled={qtyNum >= 99}
                aria-label="Artır"
              >+</button>
            </div>
          </div>
        )}

        <div className="icm-footer">
          <div className="icm-total">
            <span className="icm-total__label">Birim</span>
            <span className="icm-total__value">₺{lineTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="icm-actions">
            <button className="icm-btn icm-btn--ghost" onClick={onClose}>Vazgeç</button>
            <button
              className="icm-btn icm-btn--primary"
              onClick={submit}
              disabled={hasVariants && !selectedVariant}
            >
              {mode === 'edit'
                ? 'Kaydet'
                : `Ekle (${qtyNum}× — ₺${grandTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ItemCustomizeModal
