import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import {
  saveCompletedOrder, getDailyRevenue, isDbInitialized,
  ensurePersistedActiveOrder, getPaidItemIds, getOrderTotalPaid,
  setOrderStatus, consumeIngredients, moveOrderToTable, completeActiveOrder,
  getAllActiveOrders, deleteActiveOrderCascade,
} from '../../lib/localDb.js'
import { addPayments } from '../../lib/orderOperations.js'
import { supabase, isSupabaseReady } from '../../lib/supabase.js'
import { playAlertSound } from '../../lib/alertSound.js'
import { idleMinutes as computeIdleMinutes } from '../../lib/tableActivity.js'
import TableCard from '../../components/TableCard/TableCard.jsx'
import OrderPanel from '../../components/OrderPanel/OrderPanel.jsx'
import PaymentModal from '../../components/PaymentModal/PaymentModal.jsx'
import QRApprovalModal from '../../components/QRApprovalModal/QRApprovalModal.jsx'
import './Tables.css'


function getLiveTime() {
  return new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

function modSum(modifiers) {
  if (!modifiers?.length) return 0
  return modifiers.reduce((s, m) => s + (Number(m.priceDelta) || 0) * (Number(m.quantity) || 1), 0)
}

function groupSubtotal(items) {
  return (items ?? []).reduce((s, i) => s + i.qty * (i.unitPrice + modSum(i.modifiers)), 0)
}

function Tables() {
  const { tableDefs, triggerSync, isOnline, runtimeStates, setRuntimeStates, currentUser, logoutUser } = useApp()
  const [clock,          setClock]          = useState(getLiveTime)
  const [nowTs,          setNowTs]          = useState(() => Date.now())
  const [selectedTableId, setSelectedTableId] = useState(null)
  const [paymentTable,   setPaymentTable]   = useState(null)
  const [paymentOrder,   setPaymentOrder]   = useState(null)
  const [qrTable,        setQrTable]        = useState(null)
  const [qrQueue,        setQrQueue]        = useState([])
  const [profileOpen,    setProfileOpen]    = useState(false)
  const [tableFilter,    setTableFilter]    = useState('all') // 'all' | 'open'
  const [dailyRevenue,   setDailyRevenue]   = useState(() => isDbInitialized() ? getDailyRevenue() : 0)
  const [lowStockAlerts, setLowStockAlerts] = useState([])

  const refreshRevenue = useCallback(() => {
    if (isDbInitialized()) setDailyRevenue(getDailyRevenue())
  }, [])

  useEffect(() => {
    const timer = setInterval(() => { setClock(getLiveTime()); setNowTs(Date.now()) }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Payments/payment_items realtime moved to AppContext's always-on
  // 'desktop-orders-realtime' channel so payment updates propagate app-wide,
  // not just while this page is mounted.

  // ── Realtime QR order subscription ──────────────────────────────
  useEffect(() => {
    if (!isSupabaseReady) return

    const channel = supabase
      .channel('qr-orders-alert')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders', filter: 'status=eq.pending' },
        async (payload) => {
          playAlertSound()
          const newOrder = payload.new
          console.log('[QR-DEBUG] Realtime INSERT received:', newOrder)
          if (!newOrder?.table_id) {
            console.warn('[QR-DEBUG] Aborted: order has no table_id', newOrder)
            return
          }

          const openMinutes = newOrder.created_at
            ? Math.max(0, Math.floor((Date.now() - new Date(newOrder.created_at).getTime()) / 60000))
            : 0

          let orderItems = []
          try {
            const { data, error } = await supabase
              .from('order_items')
              .select('id, quantity, unit_price, products(name), order_item_modifiers(id, modifier_id, name, price_delta, quantity)')
              .eq('order_id', newOrder.id)
            if (error) console.warn('[QR-DEBUG] order_items query error:', error)
            console.log('[QR-DEBUG] order_items fetched:', data)
            if (data) {
              orderItems = data.map(item => ({
                id:        item.id,
                name:      item.products?.name ?? 'Ürün',
                qty:       item.quantity,
                unitPrice: item.unit_price,
                note:      '',
                modifiers: (item.order_item_modifiers ?? []).map(m => ({
                  id:         m.id,
                  modifierId: m.modifier_id ?? null,
                  name:       m.name,
                  priceDelta: Number(m.price_delta) || 0,
                  quantity:   Number(m.quantity) || 1,
                })),
              }))
            }
          } catch (e) {
            console.warn('[QR-DEBUG] Could not fetch QR order items', e)
          }

          console.log('[QR-DEBUG] Pushing to qrQueue:', { tableId: newOrder.table_id, orderId: newOrder.id, itemCount: orderItems.length })
          // Realtime can re-deliver on reconnect — never queue the same order twice
          setQrQueue(prev => prev.some(q => q.orderId === newOrder.id) ? prev : [...prev, {
            tableId:    newOrder.table_id,
            orderId:    newOrder.id,
            openMinutes,
            orderItems,
          }])
          setRuntimeStates(prev => ({
            ...prev,
            [newOrder.table_id]: {
              ...(prev[newOrder.table_id] ?? {}),
              status: 'occupied',
              type:   'qr',
            },
          }))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [setRuntimeStates])

  // Auto-open QR approval modal when a new QR order arrives.
  // Adjust-during-render (guarded) instead of a setState-in-effect.
  if (!qrTable && qrQueue.length > 0) {
    const next = qrQueue[0]
    const def = tableDefs.find(t => t.id === Number(next.tableId))
    if (def) setQrTable({ ...def, ...next })
  }

  // Merge tableDefs with runtime states — new tables from Settings appear as empty
  const displayTables = tableDefs.map(def => {
    const state = runtimeStates[def.id] ?? { status: 'empty' }
    const orderItems = (state.orders ?? []).flatMap(o => o.items)
    const openMinutes = state.openedAt
      ? Math.max(0, Math.floor((nowTs - new Date(state.openedAt).getTime()) / 60000))
      : 0
    // Only meaningful for occupied tables — idle time since the last ordered item.
    const idleMinutes = state.status === 'occupied'
      ? computeIdleMinutes({ items: orderItems, openedAt: state.openedAt }, nowTs)
      : 0
    return { ...def, ...state, orderItems, openMinutes, idleMinutes }
  })

  const visibleTables = tableFilter === 'open'
    ? displayTables.filter(t => t.status === 'occupied')
    : displayTables

  const selectedTable = selectedTableId !== null
    ? displayTables.find(t => t.id === selectedTableId) ?? null
    : null

  const occupied  = displayTables.filter(t => t.status === 'occupied')
  const aktif     = occupied.length
  const bekleyen  = occupied.filter(t => t.type === 'qr').length

  // ── Card click ──────────────────────────────────────────────────
  const handleCardClick = (table) => {
    if (table.type === 'qr') {
      // Pull first queued order for this table to show in approval modal
      const queued = qrQueue.find(q => q.tableId === table.id)
      if (queued) {
        const def = tableDefs.find(t => t.id === Number(queued.tableId))
        if (def) setQrTable({ ...def, ...queued })
      }
      return
    }
    setSelectedTableId(prev => prev === table.id ? null : table.id)
  }

  // ── Item management ─────────────────────────────────────────────
  // Mobile parity model: every unit is its own row (qty always 1).
  // Adding the same product twice creates TWO rows so each can carry its own note.
  const makeLineItem = (product, modifiers = []) => ({
    id:        crypto.randomUUID(),          // unique per row, regardless of product
    productId: product.productId ?? product.id,
    name:      product.name,
    unitPrice: product.price,
    qty:       1,
    note:      '',
    variantId: product.variantId ?? null,
    modifiers: Array.isArray(modifiers) ? modifiers : [],
    addedAt:   new Date().toISOString(),
  })

  const handleAddItem = (tableId, product, targetGroupId = null, modifiers = []) => {
    const newItem = makeLineItem(product, modifiers)
    setRuntimeStates(prev => {
      const existing = prev[tableId]
      if (!existing) {
        return {
          ...prev,
          [tableId]: {
            status: 'occupied',
            type: 'normal',
            openTime: getLiveTime(),
            openedAt: new Date().toISOString(),
            openMinutes: 0,
            waiter: '—',
            orders: [{ localId: crypto.randomUUID(), label: 'Sipariş 1', supabaseOrderId: null, items: [newItem] }],
          },
        }
      }
      const orders = existing.orders ?? []
      if (targetGroupId) {
        const idx = orders.findIndex(o => o.localId === targetGroupId)
        if (idx !== -1) {
          const newOrders = orders.map((o, i) => i === idx ? { ...o, items: [...o.items, newItem] } : o)
          return { ...prev, [tableId]: { ...existing, status: 'occupied', orders: newOrders } }
        }
      }
      // Find first manual group (supabaseOrderId === null), or create new one
      const manualIdx = orders.findIndex(o => o.supabaseOrderId === null)
      let newOrders
      if (manualIdx === -1) {
        const newGroup = { localId: crypto.randomUUID(), label: `Sipariş ${orders.length + 1}`, supabaseOrderId: null, items: [newItem] }
        newOrders = [...orders, newGroup]
      } else {
        newOrders = orders.map((o, idx) => idx === manualIdx ? { ...o, items: [...o.items, newItem] } : o)
      }
      return { ...prev, [tableId]: { ...existing, status: 'occupied', orders: newOrders } }
    })
  }

  // Replace the modifier list on an existing line item (driven by the
  // customize modal in 'edit' mode). The customize flow no longer surfaces
  // a free-text note field, so `note` is left untouched.
  const handleUpdateItemModifiers = (tableId, itemId, modifiers, subOrderLocalId) => {
    setRuntimeStates(prev => {
      const existing = prev[tableId]
      if (!existing) return prev
      const newOrders = (existing.orders ?? []).map(o => {
        if (subOrderLocalId && o.localId !== subOrderLocalId) return o
        return { ...o, items: o.items.map(i => (i.id === itemId && !i.paid) ? { ...i, modifiers: Array.isArray(modifiers) ? modifiers : [] } : i) }
      })
      return { ...prev, [tableId]: { ...existing, orders: newOrders } }
    })
  }

  // Move the whole order group from one table to another (empty) table.
  const handleMoveOrderToTable = (fromTableId, subOrderLocalId, toTableId) => {
    // Keep the materialized order (if any) pointing at the new table
    const movingGroup = (runtimeStates[fromTableId]?.orders ?? []).find(o => o.localId === subOrderLocalId)
    if (movingGroup?.persistedOrderId) {
      const toName = tableDefs.find(t => t.id === toTableId)?.name ?? ''
      moveOrderToTable(movingGroup.persistedOrderId, toTableId, toName)
        .catch(e => console.warn('[Tables] persisted order move failed', e))
    }
    setRuntimeStates(prev => {
      const fromState = prev[fromTableId]
      if (!fromState) return prev
      const group = (fromState.orders ?? []).find(o => o.localId === subOrderLocalId)
      if (!group) return prev
      const remainingOrders = (fromState.orders ?? []).filter(o => o.localId !== subOrderLocalId)
      const next = { ...prev }
      if (remainingOrders.length === 0) delete next[fromTableId]
      else next[fromTableId] = { ...fromState, orders: remainingOrders }

      const toState = prev[toTableId]
      if (!toState) {
        next[toTableId] = {
          status: 'occupied',
          type: 'normal',
          openTime: getLiveTime(),
          openedAt: new Date().toISOString(),
          openMinutes: 0,
          waiter: '—',
          orders: [group],
        }
      } else {
        next[toTableId] = {
          ...toState,
          status: 'occupied',
          orders: [...(toState.orders ?? []), group],
        }
      }
      return next
    })
  }

  // Move selected items from one order group into another table's active group.
  const handleMoveItemsToTable = (fromTableId, subOrderLocalId, itemIds, toTableId, toSubOrderLocalId = null) => {
    if (!itemIds || itemIds.length === 0) return
    // Paid items stay where their payment was recorded
    const srcGroup = (runtimeStates[fromTableId]?.orders ?? []).find(o => o.localId === subOrderLocalId)
    const paidIds = new Set((srcGroup?.items ?? []).filter(i => i.paid).map(i => i.id))
    itemIds = itemIds.filter(id => !paidIds.has(id))
    if (itemIds.length === 0) return
    const idSet = new Set(itemIds)
    setRuntimeStates(prev => {
      const fromState = prev[fromTableId]
      if (!fromState) return prev
      const fromOrders = fromState.orders ?? []
      const fromIdx = fromOrders.findIndex(o => o.localId === subOrderLocalId)
      if (fromIdx === -1) return prev
      const fromGroup = fromOrders[fromIdx]
      const movingItems = fromGroup.items.filter(i => idSet.has(i.id))
      const remainingFromItems = fromGroup.items.filter(i => !idSet.has(i.id))

      const newFromOrders = remainingFromItems.length === 0
        ? fromOrders.filter((_, i) => i !== fromIdx)
        : fromOrders.map((o, i) => i === fromIdx ? { ...o, items: remainingFromItems } : o)

      const next = { ...prev }
      if (newFromOrders.length === 0) delete next[fromTableId]
      else next[fromTableId] = { ...fromState, orders: newFromOrders }

      const toState = prev[toTableId] ?? {
        status: 'occupied',
        type: 'normal',
        openTime: getLiveTime(),
        openedAt: new Date().toISOString(),
        openMinutes: 0,
        waiter: '—',
        orders: [],
      }
      const toOrders = toState.orders ?? []
      let targetIdx = toSubOrderLocalId
        ? toOrders.findIndex(o => o.localId === toSubOrderLocalId)
        : toOrders.findIndex(o => o.supabaseOrderId === null)
      let newToOrders
      if (targetIdx === -1) {
        newToOrders = [...toOrders, { localId: crypto.randomUUID(), label: `Sipariş ${toOrders.length + 1}`, supabaseOrderId: null, items: movingItems }]
      } else {
        newToOrders = toOrders.map((o, i) => i === targetIdx ? { ...o, items: [...o.items, ...movingItems] } : o)
      }
      next[toTableId] = { ...toState, status: 'occupied', orders: newToOrders }
      return next
    })
  }

  const handleNewGroup = (tableId) => {
    setRuntimeStates(prev => {
      const existing = prev[tableId] ?? {}
      const orders = existing.orders ?? []
      const newGroupId = crypto.randomUUID()
      const newGroup = { localId: newGroupId, label: `Sipariş ${orders.length + 1}`, supabaseOrderId: null, items: [] }
      return {
        ...prev,
        [tableId]: { ...existing, orders: [...orders, newGroup], activeGroupId: newGroupId },
      }
    })
  }

  // discount: { amount, label } | null — OrderPanel/PaymentModal totals read table.discount,
  // close flow persists it to orders.discount. paymentTable is a snapshot, so patch it too.
  const handleSetDiscount = (tableId, discount) => {
    setRuntimeStates(prev => {
      const existing = prev[tableId]
      if (!existing) return prev
      return { ...prev, [tableId]: { ...existing, discount: discount ?? undefined } }
    })
    setPaymentTable(prev => (prev && prev.id === tableId) ? { ...prev, discount: discount ?? undefined } : prev)
  }

  const handleUpdateQty = (tableId, itemId, newQty, subOrderLocalId) => {
    if (newQty <= 0) { handleRemoveItem(tableId, itemId, subOrderLocalId); return }
    setRuntimeStates(prev => {
      const existing = prev[tableId]
      if (!existing) return prev
      const newOrders = (existing.orders ?? []).map(o => {
        if (subOrderLocalId && o.localId !== subOrderLocalId) return o
        return { ...o, items: o.items.map(i => (i.id === itemId && !i.paid) ? { ...i, qty: newQty } : i) }
      })
      return { ...prev, [tableId]: { ...existing, orders: newOrders } }
    })
  }

  const handleRemoveItem = (tableId, itemId, subOrderLocalId) => {
    // Paid items are financially committed — never removable
    const state = runtimeStates[tableId]
    const group = (state?.orders ?? []).find(o =>
      subOrderLocalId ? o.localId === subOrderLocalId : o.items.some(i => i.id === itemId))
    const target = group?.items.find(i => i.id === itemId)
    if (target?.paid) return

    // If this empties a group that was materialized for partial payment:
    // block when money was already taken (would orphan the payments),
    // otherwise cancel the persisted order so it doesn't resurrect on restart.
    if (group?.persistedOrderId) {
      const remaining = group.items.filter(i => i.id !== itemId)
      if (remaining.length === 0) {
        if ((group.paidAmount ?? 0) > 0) return
        setOrderStatus(group.persistedOrderId, 'cancelled')
          .catch(e => console.warn('[Tables] persisted order cancel failed', e))
      }
    }

    setRuntimeStates(prev => {
      const existing = prev[tableId]
      if (!existing) return prev
      const newOrders = (existing.orders ?? [])
        .map(o => {
          if (subOrderLocalId && o.localId !== subOrderLocalId) return o
          return { ...o, items: o.items.filter(i => i.id !== itemId || i.paid) }
        })
        .filter(o => o.items.length > 0)
      if (newOrders.length === 0) {
        const next = { ...prev }
        delete next[tableId]
        return next
      }
      return { ...prev, [tableId]: { ...existing, orders: newOrders } }
    })
  }

  // ── Payment / QR ────────────────────────────────────────────────
  // Single entry point for both modals. scopeGroupLocalId = null → whole
  // table (Masayı Kapat), otherwise the sub-order group being paid.
  //
  // Fast path (unchanged behavior): full payment with no prior partial
  // payments → saveCompletedOrder + clear the table/group.
  //
  // Materialized path: any partial payment persists the group(s) as active
  // orders in sql.js, records payments via addPayments and keeps the table
  // OPEN with the covered items marked paid. The table/group only closes
  // once everything is paid.
  const applyPaymentTx = async (transactionData, scopeGroupLocalId) => {
    const tableId = transactionData.tableId
    const state = runtimeStates[tableId]
    const groups = scopeGroupLocalId
      ? (state?.orders ?? []).filter(o => o.localId === scopeGroupLocalId)
      : (state?.orders ?? [])
    const hasPersisted = groups.some(g => g.persistedOrderId)

    setPaymentTable(null)
    setPaymentOrder(null)

    if (transactionData.isFullPayment && !hasPersisted) {
      // ── Fast path ──
      setRuntimeStates(prev => {
        const existing = prev[tableId]
        if (!existing) return prev
        const newOrders = scopeGroupLocalId
          ? (existing.orders ?? []).filter(o => o.localId !== scopeGroupLocalId)
          : []
        if (newOrders.length === 0) {
          const next = { ...prev }
          delete next[tableId]
          return next
        }
        return { ...prev, [tableId]: { ...existing, orders: newOrders } }
      })
      if (!scopeGroupLocalId) setSelectedTableId(null)
      try {
        const { lowStockWarnings } = await saveCompletedOrder(transactionData)
        // The debounced persister may have materialized these groups as ACTIVE
        // local orders. Remove them now — otherwise the ghost-cleanup pass in
        // AppContext flips the remote QR orders we're about to mark completed
        // back to 'cancelled', and the customer loses the loyalty points the
        // completion trigger just awarded.
        try {
          const closedGroupIds = new Set(groups.map(g => String(g.localId)))
          for (const o of getAllActiveOrders()) {
            if (closedGroupIds.has(String(o.local_id))) await deleteActiveOrderCascade(o.id)
          }
        } catch (e) {
          console.warn('[Tables] ghost active-order cleanup failed', e)
        }
        refreshRevenue()
        if (lowStockWarnings?.length) setLowStockAlerts(lowStockWarnings)
        console.log(`[Tables] ✓ Order completed — Masa ${tableId} | ₺${transactionData.total?.toFixed(2)} | ${transactionData.paymentMethod}`)
        if (transactionData.supabaseOrderId && isSupabaseReady) {
          await supabase
            .from('orders')
            .update({ status: 'completed', payment_method: transactionData.paymentMethod, total: transactionData.total, closed_at: transactionData.closedAt })
            .eq('id', transactionData.supabaseOrderId)
        }
        // Whole-table close: QR sub-orders live as their own rows in Supabase —
        // flip them too, otherwise they stay 'active' and reappear on mobile
        if (isSupabaseReady) {
          const remoteGroupIds = groups
            .map(g => g.supabaseOrderId)
            .filter(rid => rid != null && rid !== transactionData.supabaseOrderId)
          for (const rid of remoteGroupIds) {
            await supabase
              .from('orders')
              .update({ status: 'completed', payment_method: transactionData.paymentMethod, closed_at: transactionData.closedAt })
              .eq('id', rid)
          }
        }
        // Table just closed — free it up remotely if nothing else is active there
        if (isSupabaseReady) {
          try {
            const { data: rem } = await supabase.from('orders').select('id').eq('table_id', tableId).eq('status', 'active').limit(1)
            if (!rem?.length) await supabase.from('tables').update({ status: 'empty' }).eq('id', tableId)
          } catch (e) { console.warn('[Tables] masa durumu güncellenemedi', e) }
        }
        if (isOnline) triggerSync()
      } catch (e) {
        console.error('[Tables] Failed to save order to DB', e)
      }
      return
    }

    // ── Materialized path (partial payment, or closing an order that already
    //    has partial payments) ──
    if (groups.length === 0) return
    try {
      const discount = transactionData.discount ?? 0

      // 0. Partial-quantity rows: payment_items marks a whole order_item as
      // paid, so a row covering only part of a line's quantity first splits
      // the runtime item — the paid portion becomes its own line (and its
      // own db row via ensurePersistedActiveOrder below). Rows are cloned so
      // the id remap never leaks back into transactionData.
      const paymentRows = (transactionData.paymentRows ?? []).map(r => ({
        ...r,
        order_item_ids: r.order_item_ids ? [...r.order_item_ids] : r.order_item_ids,
        item_amounts: r.item_amounts ? { ...r.item_amounts } : r.item_amounts,
      }))
      const workGroups = groups.map(g => ({ ...g, items: g.items.map(i => ({ ...i })) }))
      {
        const byId = new Map()
        workGroups.forEach(g => g.items.forEach(i => byId.set(String(i.id), { g, i })))
        for (const row of paymentRows) {
          if (!row.order_item_ids?.length || !row.item_qtys) continue
          row.order_item_ids = row.order_item_ids.map(iid => {
            const hit = byId.get(String(iid))
            const payQty = Math.floor(Number(row.item_qtys[iid]) || 0)
            if (!hit || hit.i.paid || payQty <= 0 || payQty >= hit.i.qty) return iid
            const split = { ...hit.i, id: crypto.randomUUID(), qty: payQty }
            hit.i.qty -= payQty
            hit.g.items.splice(hit.g.items.indexOf(hit.i) + 1, 0, split)
            byId.set(String(split.id), { g: hit.g, i: split })
            if (row.item_amounts?.[iid] != null) {
              row.item_amounts[split.id] = row.item_amounts[iid]
              delete row.item_amounts[iid]
            }
            return split.id
          })
        }
      }
      const allSub = workGroups.reduce((s, g) => s + groupSubtotal(g.items), 0)

      // 1. Persist each involved group as an active order
      const infos = []
      for (const g of workGroups) {
        const gSub = groupSubtotal(g.items)
        const gDiscount = allSub > 0 ? discount * (gSub / allSub) : 0
        const gTotal = Math.round((gSub - gDiscount) * 100) / 100
        const info = await ensurePersistedActiveOrder({
          tableId,
          tableName: transactionData.tableName,
          waiterName: transactionData.waiterName ?? state?.waiter ?? null,
          groupLocalId: g.localId,
          supabaseOrderId: g.supabaseOrderId ?? null,
          items: g.items,
          total: gTotal,
        })
        infos.push({ group: g, gTotal, ...info })
      }

      // 2. Split the modal's payment rows across the involved groups.
      // Item rows follow their items; amount-only rows fill remaining
      // balances in group order.
      const groupOfItem = new Map()
      workGroups.forEach(g => g.items.forEach(i => groupOfItem.set(String(i.id), g.localId)))
      const rowsByGroup = new Map(infos.map(i => [i.group.localId, []]))
      const remainingByGroup = new Map(infos.map(i => [
        i.group.localId,
        Math.max(0, i.gTotal - getOrderTotalPaid(i.orderId)),
      ]))

      for (const row of paymentRows) {
        if (row.order_item_ids?.length) {
          const idsByGroup = new Map()
          for (const itemId of row.order_item_ids) {
            const gid = groupOfItem.get(String(itemId)) ?? infos[0].group.localId
            if (!idsByGroup.has(gid)) idsByGroup.set(gid, [])
            idsByGroup.get(gid).push(itemId)
          }
          const entries = [...idsByGroup.entries()]
          let allocated = 0
          entries.forEach(([gid, ids], idx) => {
            let amount
            if (entries.length === 1) {
              amount = Number(row.amount)
            } else if (idx === entries.length - 1) {
              amount = Math.round((Number(row.amount) - allocated) * 100) / 100
            } else {
              amount = Math.round(ids.reduce((s, iid) => s + (Number(row.item_amounts?.[iid]) || 0), 0) * 100) / 100
              allocated += amount
            }
            rowsByGroup.get(gid)?.push({ ...row, amount, order_item_ids: ids })
            remainingByGroup.set(gid, Math.max(0, (remainingByGroup.get(gid) ?? 0) - amount))
          })
        } else {
          // Amount-only row (Eşit Böl / Tutar Gir / Tek) — waterfall across groups
          let left = Number(row.amount)
          for (const info of infos) {
            if (left <= 0.001) break
            const gid = info.group.localId
            const rem = remainingByGroup.get(gid) ?? 0
            const isLast = info === infos[infos.length - 1]
            const take = isLast ? left : Math.min(left, rem)
            if (take <= 0.001) continue
            const amount = Math.round(take * 100) / 100
            rowsByGroup.get(gid)?.push({ ...row, amount, order_item_ids: undefined })
            remainingByGroup.set(gid, Math.max(0, rem - amount))
            left = Math.round((left - amount) * 100) / 100
          }
        }
      }

      // 3. Record payments per group and decide which groups close
      const coveredByGroup = new Map()
      for (const info of infos) {
        const rows = rowsByGroup.get(info.group.localId) ?? []
        const paidSet = getPaidItemIds(info.orderId)
        const mappedRows = rows
          .map(r => ({
            amount: r.amount,
            payment_method: r.payment_method,
            payer_label: r.payer_label ?? null,
            order_item_ids: (r.order_item_ids ?? [])
              .map(iid => info.itemIdMap[iid])
              .filter(dbId => dbId != null && !paidSet.has(dbId)),
          }))
          .filter(r => Number(r.amount) > 0)
        info.completed = false
        info.paidNow = getOrderTotalPaid(info.orderId)
        if (mappedRows.length) {
          const payRes = await addPayments({
            orderLocalId: info.orderId,
            orderRemoteId: info.remoteId ? Number(info.remoteId) : null,
            tableId,
            total: info.gTotal,
            processedBy: transactionData.waiterName ?? null,
            rows: mappedRows,
          })
          info.completed = payRes.completed
          info.paidNow = payRes.paid
        }
        coveredByGroup.set(
          info.group.localId,
          new Set(rows.flatMap(r => (r.order_item_ids ?? []).map(String)))
        )
      }

      // isFullPayment closes everything in scope even if per-group rounding
      // left a cent behind
      const lowStock = []
      let anyClosed = false
      for (const info of infos) {
        const close = transactionData.isFullPayment || info.completed
        info.close = close
        if (!close) continue
        anyClosed = true
        const gSub = groupSubtotal(info.group.items)
        await completeActiveOrder(info.orderId, {
          subtotal: gSub,
          tax: 0,
          discount: allSub > 0 ? Math.round(discount * (gSub / allSub) * 100) / 100 : 0,
          closedAt: transactionData.closedAt,
        })
        const warnings = consumeIngredients(info.group.items ?? [])
        if (warnings?.length) lowStock.push(...warnings)
      }

      // 4. Update runtime state: mark paid items, drop closed groups
      setRuntimeStates(prev => {
        const existing = prev[tableId]
        if (!existing) return prev
        const newOrders = (existing.orders ?? [])
          .map(o => {
            const info = infos.find(i => i.group.localId === o.localId)
            if (!info) return o
            if (info.close) return null
            const covered = coveredByGroup.get(o.localId) ?? new Set()
            // info.group carries the split-adjusted items — a partially paid
            // line is now two lines, so use it instead of the stale o.items
            return {
              ...o,
              persistedOrderId: info.orderId,
              supabaseOrderId: o.supabaseOrderId ?? (info.remoteId ? Number(info.remoteId) : null),
              paidAmount: info.paidNow,
              items: info.group.items.map(i => covered.has(String(i.id)) ? { ...i, paid: true } : i),
            }
          })
          .filter(Boolean)
        if (newOrders.length === 0) {
          const next = { ...prev }
          delete next[tableId]
          return next
        }
        return { ...prev, [tableId]: { ...existing, orders: newOrders } }
      })
      if (transactionData.isFullPayment && !scopeGroupLocalId) setSelectedTableId(null)

      if (anyClosed) refreshRevenue()
      if (lowStock.length) setLowStockAlerts(lowStock)
      console.log(`[Tables] ✓ ${transactionData.isFullPayment ? 'Order closed' : 'Partial payment'} — Masa ${tableId} | ₺${transactionData.paymentRows?.reduce((s, r) => s + Number(r.amount), 0).toFixed(2)}`)
      // A group just closed — free the table remotely if nothing else is active there
      if (anyClosed && isSupabaseReady) {
        try {
          const { data: rem } = await supabase.from('orders').select('id').eq('table_id', tableId).eq('status', 'active').limit(1)
          if (!rem?.length) await supabase.from('tables').update({ status: 'empty' }).eq('id', tableId)
        } catch (e) { console.warn('[Tables] masa durumu güncellenemedi', e) }
      }
      if (isOnline) triggerSync()
    } catch (e) {
      console.error('[Tables] Failed to record payment', e)
    }
  }

  const handlePaymentComplete = (transactionData) => applyPaymentTx(transactionData, null)
  const handlePartialPaymentComplete = (transactionData) =>
    applyPaymentTx(transactionData, transactionData.subOrderLocalId)

  // Guards a double-click on Onayla/Reddet: both clicks see the same
  // qrQueue[0], so without this the queue gets sliced twice and the NEXT
  // order silently disappears.
  const qrActionRef = useRef(null)

  const handleQRApprove = async () => {
    const current = qrQueue[0]
    if (!current) return
    if (qrActionRef.current === current.orderId) return
    qrActionRef.current = current.orderId
    const moreForSameTable = qrQueue.slice(1).some(o => o.tableId === current.tableId)
    setQrQueue(prev => prev.slice(1))
    setRuntimeStates(prev => {
      const existing = prev[current.tableId] ?? {}
      const prevOrders = existing.orders ?? []
      // Same Supabase order already approved as a group → don't duplicate it
      if (prevOrders.some(o => o.supabaseOrderId === current.orderId)) {
        return { ...prev, [current.tableId]: { ...existing, status: 'occupied', type: moreForSameTable ? 'qr' : 'normal' } }
      }
      const qrCount = prevOrders.filter(o => o.supabaseOrderId !== null).length
      const label = qrCount === 0 ? 'QR Sipariş' : `QR Sipariş ${qrCount + 1}`
      const newGroup = { localId: crypto.randomUUID(), label, supabaseOrderId: current.orderId, items: current.orderItems }
      return {
        ...prev,
        [current.tableId]: {
          ...existing,
          status:   'occupied',
          type:     moreForSameTable ? 'qr' : 'normal',
          openTime: existing.openTime ?? getLiveTime(),
          openedAt: existing.openedAt ?? new Date().toISOString(),
          waiter:   existing.waiter ?? 'Garson',
          orders:   [...prevOrders, newGroup],
        },
      }
    })
    setQrTable(null)
    if (current.orderId && isSupabaseReady) {
      try {
        await supabase.from('orders').update({ status: 'active' }).eq('id', current.orderId)
      } catch (e) {
        console.warn('[Tables] Could not update QR order status to active', e)
      }
    }
  }

  const handleQRReject = async () => {
    const current = qrQueue[0]
    if (!current) return
    if (qrActionRef.current === current.orderId) return
    qrActionRef.current = current.orderId
    const moreForSameTable = qrQueue.slice(1).some(o => o.tableId === current.tableId)
    setQrQueue(prev => prev.slice(1))
    if (!moreForSameTable) {
      setRuntimeStates(prev => {
        const next = { ...prev }
        delete next[current.tableId]
        return next
      })
    }
    setQrTable(null)
    if (current.orderId && isSupabaseReady) {
      try {
        await supabase.from('orders').update({ status: 'cancelled' }).eq('id', current.orderId)
        const { data: rem } = await supabase.from('orders').select('id').eq('table_id', current.tableId).eq('status', 'active').limit(1)
        if (!rem?.length) await supabase.from('tables').update({ status: 'empty' }).eq('id', current.tableId)
      } catch (e) {
        console.warn('[Tables] Could not update QR order status to cancelled', e)
      }
    }
  }

  return (
    <div className="tables-page">
      <div className="tables-main">

        {/* ── Header ── */}
        <div className="tables-header">
          <div className="tables-header__left">
            <h1 className="tables-title">Masalar</h1>
            <span className="tables-subtitle">{aktif} açık masa</span>
          </div>

          <div className="tables-header__right">
            <div className="stats-chip">
              <span className="stats-chip__label">CİRO</span>
              <span className="stats-chip__value">₺{dailyRevenue.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="stats-chip">
              <span className="stats-chip__label">AKTİF</span>
              <span className="stats-chip__value">{aktif}</span>
            </div>
            <div className="stats-chip stats-chip--bordered">
              <span className="stats-chip__label">BEKLEYEN</span>
              <span className="stats-chip__value">{bekleyen}</span>
            </div>
            <div className="stats-clock">
              <span className="stats-clock__label">CANLI SAAT</span>
              <span className="stats-clock__time">{clock}</span>
            </div>
            <button className="icon-btn" aria-label="Bildirimler">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </button>
            <button className="icon-btn icon-btn--user" aria-label="Kullanıcı" onClick={() => setProfileOpen(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Low stock alert ── */}
      {lowStockAlerts.length > 0 && (
        <div className="tables-low-stock-banner">
          <span>⚠ Düşük stok: {lowStockAlerts.map(a => `${a.name} (${a.stockAmount} kaldı)`).join(', ')}</span>
          <button className="tables-low-stock-banner__close" onClick={() => setLowStockAlerts([])}>✕</button>
        </div>
      )}

      {/* ── Filter tabs ── */}
        <div className="tables-filter-tabs">
          <button
            className={`tables-filter-tab ${tableFilter === 'all' ? 'tables-filter-tab--active' : ''}`}
            onClick={() => setTableFilter('all')}
          >
            Tüm Masalar
            <span className="tables-filter-tab__count">{displayTables.length}</span>
          </button>
          <button
            className={`tables-filter-tab ${tableFilter === 'open' ? 'tables-filter-tab--active' : ''}`}
            onClick={() => setTableFilter('open')}
          >
            Açık Masalar
            <span className="tables-filter-tab__count tables-filter-tab__count--open">{aktif}</span>
          </button>
        </div>

        {/* ── Table Grid ── */}
        <div className="tables-grid">
          {visibleTables.map(table => (
            <TableCard
              key={table.id}
              table={{
                ...table,
                itemCount: table.orderItems?.length ?? 0,
                total: table.orderItems
                  ? table.orderItems.reduce((s, i) => {
                      const modSum = (i.modifiers || []).reduce((ms, m) => ms + (Number(m.priceDelta) || 0) * (Number(m.quantity) || 1), 0)
                      return s + i.qty * (i.unitPrice + modSum)
                    }, 0)
                  : 0,
              }}
              isSelected={table.id === selectedTableId}
              onClick={() => handleCardClick(table)}
            />
          ))}
        </div>

      </div>

      {/* ── Order Panel ── */}
      {selectedTable && (
        <OrderPanel
          table={selectedTable}
          tables={displayTables}
          onClose={() => setSelectedTableId(null)}
          onCloseTable={() => setPaymentTable(selectedTable)}
          onAddItem={(tableId, product, modifiers) => handleAddItem(tableId, product, selectedTable.activeGroupId ?? null, modifiers)}
          onUpdateNote={handleUpdateItemModifiers}
          onUpdateQty={handleUpdateQty}
          onRemoveItem={handleRemoveItem}
          onNewGroup={handleNewGroup}
          onMoveOrderToTable={handleMoveOrderToTable}
          onMoveItemsToTable={handleMoveItemsToTable}
          onSetDiscount={handleSetDiscount}
          onPayOrder={(tableId, subOrderLocalId) => {
            const tbl = displayTables.find(t => t.id === tableId)
            const order = (runtimeStates[tableId]?.orders ?? []).find(o => o.localId === subOrderLocalId)
            if (tbl && order) setPaymentOrder({ ...order, tableId })
          }}
        />
      )}

      {paymentOrder && (
        <PaymentModal
          table={displayTables.find(t => t.id === paymentOrder.tableId) ?? {}}
          partialOrder={paymentOrder}
          alreadyPaid={paymentOrder.paidAmount ?? 0}
          onClose={() => setPaymentOrder(null)}
          onComplete={handlePartialPaymentComplete}
          onSetDiscount={handleSetDiscount}
        />
      )}

      {paymentTable && (
        <PaymentModal
          table={paymentTable}
          alreadyPaid={(paymentTable.orders ?? []).reduce((s, o) => s + (o.paidAmount || 0), 0)}
          onClose={() => setPaymentTable(null)}
          onComplete={handlePaymentComplete}
          onSetDiscount={handleSetDiscount}
        />
      )}

      {qrTable && (
        <QRApprovalModal
          table={qrTable}
          onApprove={handleQRApprove}
          onReject={handleQRReject}
        />
      )}

      {profileOpen && (
        <ProfileModal
          user={currentUser}
          onClose={() => setProfileOpen(false)}
          onLogout={() => { setProfileOpen(false); logoutUser() }}
        />
      )}
    </div>
  )
}

// ── Profile Modal ─────────────────────────────────────────────────

function ProfileModal({ user, onClose, onLogout }) {
  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : '?'

  const roleLabel = user?.role === 'admin' ? 'Yönetici' : (user?.role ?? '—')

  const today = new Date().toLocaleDateString('tr-TR', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  return (
    <div className="profile-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="profile-modal">

        <button className="profile-modal__close-x" onClick={onClose} aria-label="Kapat">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Avatar */}
        <div className="profile-modal__avatar">{initials}</div>

        {/* Info */}
        <div className="profile-modal__info">
          <p className="profile-modal__email">{user?.email ?? '—'}</p>
          <span className="profile-modal__role-badge">{roleLabel}</span>
        </div>

        {/* Details */}
        <div className="profile-modal__details">
          <div className="profile-modal__detail-row">
            <span className="profile-modal__detail-label">Oturum tarihi</span>
            <span className="profile-modal__detail-value">{today}</span>
          </div>
          <div className="profile-modal__detail-row">
            <span className="profile-modal__detail-label">Kullanıcı ID</span>
            <span className="profile-modal__detail-value">#{user?.id ?? '—'}</span>
          </div>
        </div>

        {/* Logout */}
        <button className="profile-modal__logout" onClick={onLogout}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Çıkış Yap
        </button>

      </div>
    </div>
  )
}

export default Tables
