// ── Grouping (display-only) ─────────────────────────────────────────
// Unpaid items sharing productId + variantId + sorted modifiers + note are
// visually combined into one row. Paid items are never regrouped — they
// keep rendering individually, exactly as before.
// Shared between OrderPanel (order summary) and PaymentModal (payment
// item list) so both surfaces present identical items the same way.

export function modifierSigPart(modifiers) {
  return (modifiers || [])
    .map(m => `${m.modifierId ?? m.id}:${m.quantity || 1}`)
    .sort()
    .join(',')
}

export function itemSignature(item) {
  return [
    item.productId,
    item.variantId ?? '',
    modifierSigPart(item.modifiers),
    (item.note || '').trim(),
  ].join('|')
}

export function buildDisplayRows(items) {
  const rows = []
  const indexBySig = new Map()
  for (const item of items) {
    if (item.paid) {
      rows.push({ kind: 'single', item })
      continue
    }
    const sig = itemSignature(item)
    if (indexBySig.has(sig)) {
      rows[indexBySig.get(sig)].items.push(item)
    } else {
      indexBySig.set(sig, rows.length)
      rows.push({ kind: 'group', sig, items: [item] })
    }
  }
  return rows
}
