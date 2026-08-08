// ── Receipt printing helpers ───────────────────────────────────────
// Pure helpers for building the thermal-printer receipt HTML. Extracted
// from PaymentModal so both PaymentModal and OrderPanel (via PrintButton)
// can print a bill without depending on PaymentModal's component state.

const CAFE_INFO_KEY     = 'san-lucas-cafe-info'
const DEFAULT_CAFE_NAME = 'Mars Lounge Cafe'

export function getCafeName() {
  try {
    const raw = JSON.parse(localStorage.getItem(CAFE_INFO_KEY) ?? '{}')
    return (raw?.name && String(raw.name).trim()) || DEFAULT_CAFE_NAME
  } catch {
    return DEFAULT_CAFE_NAME
  }
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

export const RECEIPT_WIDTH_CHARS = 32
export const receiptDivider = () => '-'.repeat(RECEIPT_WIDTH_CHARS)

// Effective unit price = base unit + sum of modifier deltas (each scaled by
// its own quantity) — same math PaymentModal/OrderPanel use for line totals.
function itemUnit(i) {
  return i.unitPrice + (i.modifiers?.reduce(
    (s, m) => s + (Number(m.priceDelta) || 0) * (Number(m.quantity) || 1), 0
  ) || 0)
}

// Pure receipt HTML builder — no component state, no side effects.
// items: [{ name, qty, unitPrice, modifiers?: [{ name, priceDelta, quantity }] }]
export function buildReceiptHtml({ tableName, orderNo, items, discount, total, staffName }) {
  const now      = new Date()
  const dateStr  = now.toLocaleDateString('tr-TR')
  const timeStr  = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  const money    = (n) => `₺${Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const itemLines = (items || []).map((i) => {
    const lineTotal = i.qty * itemUnit(i)
    const modLines = (i.modifiers || []).map((m) =>
      `<div class="r-mod">+ ${escapeHtml(m.name)}${(m.quantity || 1) > 1 ? ` ×${m.quantity}` : ''}</div>`
    ).join('')
    return `<div class="r-item"><span>${i.qty}× ${escapeHtml(i.name)}</span><span>${money(lineTotal)}</span></div>${modLines}`
  }).join('')

  return `<html><head><meta charset="utf-8"><style>
    @page { margin: 0; }
    * { box-sizing: border-box; }
    body {
      width: 72mm;
      margin: 0 auto;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      text-align: center;
      color: #000;
      padding: 6px 4px;
    }
    .r-name { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
    .r-line { font-size: 11px; margin: 2px 0; }
    .r-divider { font-size: 12px; margin: 6px 0; white-space: pre; }
    .r-item { display: flex; justify-content: space-between; gap: 8px; text-align: left; padding: 2px 0; }
    .r-mod { font-size: 10px; color: #333; text-align: left; padding-left: 10px; }
    .r-discount { display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; }
    .r-total { display: flex; justify-content: space-between; font-weight: 700; font-size: 15px; margin-top: 2px; }
    .r-thanks { font-size: 11px; margin-top: 10px; line-height: 1.5; }
  </style></head><body>
    <div class="r-name">${escapeHtml(getCafeName())}</div>
    <div class="r-line">Masa: ${escapeHtml(tableName)}</div>
    <div class="r-line">${dateStr} ${timeStr}</div>
    <div class="r-line">Sipariş No: ${escapeHtml(String(orderNo))}</div>
    <div class="r-divider">${receiptDivider()}</div>
    ${itemLines}
    <div class="r-divider">${receiptDivider()}</div>
    ${discount > 0 ? `<div class="r-discount"><span>İndirim</span><span>-${money(discount)}</span></div>` : ''}
    <div class="r-total"><span>TOPLAM</span><span>${money(total)}</span></div>
    <div class="r-line" style="margin-top:6px;">Çalışan: ${escapeHtml(staffName || '—')}</div>
    <div class="r-thanks">Bizi tercih ettiğiniz için<br/>teşekkür ederiz</div>
    <div class="r-divider">------------ ✂ ------------</div>
  </body></html>`
}
