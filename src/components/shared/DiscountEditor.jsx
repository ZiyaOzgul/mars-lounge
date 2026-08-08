import { useState } from 'react'
import './DiscountEditor.css'

const QUICK_PERCENTS = [5, 10, 20]

// Compact inline discount entry — reused by OrderPanel and PaymentModal
// totals areas. Caller decides where to render it (usually right under the
// "Ara Toplam" row) and handles persisting the result.
function DiscountEditor({ subtotal, initialAmount, initialLabel, onApply, onCancel }) {
  const [amount, setAmount] = useState(initialAmount != null ? String(initialAmount) : '')
  const [label,  setLabel]  = useState(initialLabel ?? '')

  const numAmount = parseFloat(String(amount).replace(',', '.')) || 0
  const valid = numAmount > 0 && subtotal > 0 && numAmount < subtotal

  const applyPercent = (pct) => {
    const amt = Math.round(subtotal * (pct / 100) * 100) / 100
    setAmount(String(amt))
  }

  const handleApply = () => {
    if (!valid) return
    onApply({ amount: Math.round(numAmount * 100) / 100, label: label.trim() || 'İndirim' })
  }

  return (
    <div className="de-editor" onClick={e => e.stopPropagation()}>
      <div className="de-editor__amount-row">
        <span className="de-editor__prefix">₺</span>
        <input
          className="de-editor__amount"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0.00"
          autoFocus
        />
      </div>
      <div className="de-editor__quick">
        {QUICK_PERCENTS.map(p => (
          <button
            key={p}
            type="button"
            className="de-editor__quick-btn"
            onClick={() => applyPercent(p)}
          >
            %{p}
          </button>
        ))}
      </div>
      <input
        className="de-editor__label"
        type="text"
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="İndirim"
        maxLength={40}
      />
      {numAmount > 0 && !valid && (
        <p className="de-editor__error">Tutar ara toplamdan küçük olmalı.</p>
      )}
      <div className="de-editor__actions">
        <button type="button" className="de-editor__btn de-editor__btn--ghost" onClick={onCancel}>
          Vazgeç
        </button>
        <button
          type="button"
          className="de-editor__btn de-editor__btn--primary"
          disabled={!valid}
          onClick={handleApply}
        >
          Uygula
        </button>
      </div>
    </div>
  )
}

export default DiscountEditor
