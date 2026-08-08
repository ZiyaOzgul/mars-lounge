/**
 * reopenOperations.js
 * Reopens a closed (completed) order from the "Kapananlar" page.
 *
 * Two modes:
 *   - 'correction'  → the original order is cancelled, its stock deduction
 *                      undone, and its payments removed (cirosu geri alınır).
 *   - 'new'         → the original order is left untouched; the selected
 *                      items are re-added as a fresh order on the target table.
 *
 * Either way, the selected items are handed back as a runtime order group
 * shaped exactly like the groups AppContext hydrates on startup, so the
 * caller can drop it straight into runtimeStates.
 */
import {
  getCompletedOrderDetail,
  restoreIngredients,
  deleteOrderPaymentsCascade,
  setOrderStatus,
  persistDb,
} from './localDb.js'

export async function reopenOrder({ orderId, selectedItemIds, mode }) {
  const detail = getCompletedOrderDetail(orderId)
  const selected = detail.items.filter(i => selectedItemIds.includes(i.id))

  if (mode === 'correction') {
    restoreIngredients(detail.items) // ALL original items — not just the selected ones
    await deleteOrderPaymentsCascade(orderId)
    await setOrderStatus(orderId, 'cancelled')
  }

  const group = {
    localId: crypto.randomUUID(),
    label: 'Sipariş 1',
    supabaseOrderId: null,
    items: selected.map(i => ({
      id: crypto.randomUUID(),
      productId: i.productId ?? null,
      variantId: i.variantId ?? null,
      name: i.name,
      unitPrice: i.unitPrice,
      qty: i.qty,
      note: i.note || '',
      addedAt: new Date().toISOString(),
      modifiers: (i.modifiers ?? []).map(m => ({
        modifierId: m.modifierId,
        name: m.name,
        priceDelta: m.priceDelta,
        quantity: m.quantity,
      })),
      paid: false,
    })),
  }

  await persistDb()
  return group
}
