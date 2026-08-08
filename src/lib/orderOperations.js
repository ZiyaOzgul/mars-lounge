/**
 * orderOperations.js
 * Mobile-parity helpers for split payments, table transfers, and item transfers.
 *
 * Local-first: writes go to sql.js immediately so the UI stays responsive offline.
 * If a Supabase remote_id exists for the order, the same change is pushed up.
 * Anything that fails online is left with is_synced=0 for the next sync.js run.
 */

import { supabase, isSupabaseReady } from './supabase.js'
import {
  insertPayment,
  insertPaymentItems,
  markPaymentSynced,
  getOrderPayments as localGetOrderPayments,
  getPaidItemIds as localGetPaidItemIds,
  getOrderTotalPaid,
  getOrderItemRemoteIds,
  persistDb,
} from './localDb.js'

function uuid() {
  return (crypto?.randomUUID?.() ?? `pmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
}

/**
 * Add one or more payments for an active order.
 *
 * rows: [{ amount, payment_method, payer_label?, order_item_ids?: number[] }]
 *   - order_item_ids is used by the "ürün ürün öde" mode to link a payment
 *     to the specific items it covers (writes into payment_items junction).
 *
 * Returns { paid, remaining, completed }.
 */
export async function addPayments({
  orderLocalId,           // local sql.js orders.id
  orderRemoteId,          // supabase orders.id (may be null while offline)
  total,                  // current order total (Number)
  processedBy = null,
  rows = [],
}) {
  if (!rows.length) throw new Error('En az bir ödeme gerekli.')

  // 1) Insert into local sql.js (sync queue picks them up later)
  const localPaymentIds = []
  for (const r of rows) {
    const localId = uuid()
    const id = await insertPayment({
      localId,
      orderId: orderLocalId,
      amount: Number(r.amount),
      paymentMethod: r.payment_method,
      payerLabel: r.payer_label || null,
      processedBy,
      device: 'desktop',
      createdAt: new Date().toISOString(),
    })
    localPaymentIds.push({ id, localId, row: r })
    if (r.order_item_ids?.length) {
      await insertPaymentItems(id, r.order_item_ids)
    }
  }

  // 2) Compute paid/remaining off the local store
  const paid = getOrderTotalPaid(orderLocalId)
  const remaining = Math.max(Number(total) - paid, 0)
  const completed = paid + 0.001 >= Number(total)

  // 3) If online and remote order exists, push payments immediately so mobile sees them live.
  if (isSupabaseReady && orderRemoteId) {
    try {
      for (const { id, localId, row } of localPaymentIds) {
        const { data, error } = await supabase
          .from('payments')
          .upsert(
            {
              local_id: localId,
              order_id: Number(orderRemoteId),
              amount: Number(row.amount),
              payment_method: row.payment_method,
              payer_label: row.payer_label || null,
              processed_by: processedBy || null,
              device: 'desktop',
            },
            { onConflict: 'local_id' }
          )
          .select('id')
          .single()
        if (!error && data) {
          await markPaymentSynced(id, data.id)

          // Push junction rows that have a known order_item.remote_id.
          // order_item_ids are LOCAL sql.js ids — resolve their remote ids
          // from the local store. Items not yet pushed are retried by sync.js.
          if (row.order_item_ids?.length) {
            const remoteMap = getOrderItemRemoteIds(row.order_item_ids.filter(Boolean))
            const junction = Object.values(remoteMap).map(rid => ({
              payment_id: Number(data.id),
              order_item_id: Number(rid),
            }))
            if (junction.length > 0) {
              await supabase
                .from('payment_items')
                .upsert(junction, { onConflict: 'order_item_id', ignoreDuplicates: true })
            }
          }
        }
      }
    } catch (e) {
      // Network hiccup — sync.js will retry later
      console.warn('[orderOperations] payments push deferred to sync.js', e)
    }
  }

  // 4) If fully paid, flip order to completed in Supabase too
  if (completed && isSupabaseReady && orderRemoteId) {
    try {
      // Dominant method = largest sum across rows
      const byMethod = {}
      const allPayments = localGetOrderPayments(orderLocalId)
      for (const p of allPayments) {
        byMethod[p.payment_method] = (byMethod[p.payment_method] || 0) + Number(p.amount)
      }
      const dominant = Object.entries(byMethod).sort((a, b) => b[1] - a[1])[0]?.[0] || null

      await supabase
        .from('orders')
        .update({
          status: 'completed',
          payment_method: dominant,
          closed_at: new Date().toISOString(),
        })
        .eq('id', orderRemoteId)
    } catch (e) {
      console.warn('[orderOperations] order completion push deferred', e)
    }
  }

  await persistDb()
  return { paid, remaining, completed }
}

/**
 * Move a whole active order from one table to another empty table.
 * Local runtime state is updated by the caller — this only syncs Supabase
 * if the order has a remote id.
 */
export async function transferOrder({ orderRemoteId, fromTableId, toTableId }) {
  if (!isSupabaseReady) return
  try {
    if (orderRemoteId) {
      await supabase.from('orders').update({ table_id: toTableId }).eq('id', orderRemoteId)
    }
    await supabase.from('tables').update({ status: 'occupied' }).eq('id', toTableId)
    await supabase.from('tables').update({ status: 'empty' }).eq('id', fromTableId)
  } catch (e) {
    console.warn('[orderOperations] transferOrder remote push failed', e)
  }
}

/**
 * Move selected order_items from one order to another's active order.
 * Caller updates local runtime state; this just syncs Supabase.
 */
export async function transferItemsToOrder({ itemRemoteIds, targetOrderRemoteId }) {
  if (!isSupabaseReady || !targetOrderRemoteId) return
  if (!itemRemoteIds || itemRemoteIds.length === 0) return
  try {
    await supabase
      .from('order_items')
      .update({ order_id: targetOrderRemoteId })
      .in('id', itemRemoteIds)
  } catch (e) {
    console.warn('[orderOperations] transferItemsToOrder remote push failed', e)
  }
}

export function getOrderPayments(orderLocalId) {
  return localGetOrderPayments(orderLocalId)
}

export function getPaidItemIds(orderLocalId) {
  return localGetPaidItemIds(orderLocalId)
}
