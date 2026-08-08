import { useState, useRef, useEffect } from 'react'
import { getAllStaff } from '../../lib/localDb.js'
import { supabase, isSupabaseReady } from '../../lib/supabase.js'
import { useApp } from '../../context/AppContext.jsx'
import DiscountEditor from '../shared/DiscountEditor.jsx'
import { hasPerm } from '../../lib/permissions.js'
import { buildDisplayRows } from '../../lib/itemGrouping.js'
import './PaymentModal.css'

const MODES = [
  { id: 'single', label: 'Tek' },
  { id: 'split',  label: 'Eşit Böl' },
  { id: 'custom', label: 'Tutar Gir' },
]

const METHODS = [
  { id: 'cash', label: 'Nakit' },
  { id: 'card', label: 'Kart' },
  { id: 'iban', label: 'IBAN' },
]

const NUMPAD_KEYS = ['1','2','3','4','5','6','7','8','9','C','0','⌫']

function fmt(n) { return `₺${Number(n || 0).toFixed(2)}` }

function MethodIcon({ id }) {
  if (id === 'cash') return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>
    </svg>
  )
  if (id === 'card') return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  )
  // iban — bank / transfer
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18"/><path d="M4 18v-7M8 18v-7M12 18v-7M16 18v-7M20 18v-7"/>
      <path d="M12 3l9 5H3l9-5z"/>
    </svg>
  )
}

function MethodPicker({ value, onChange }) {
  return (
    <div className="pm-methods">
      {METHODS.map(m => (
        <button
          key={m.id}
          className={`pm-method ${value === m.id ? 'pm-method--active' : ''}`}
          onClick={() => onChange(m.id)}
        >
          <MethodIcon id={m.id} />
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  )
}

function PaymentModal({ table, partialOrder, alreadyPaid = 0, onClose, onComplete, onSetDiscount }) {
  const { pointRate, currentUser } = useApp()
  const canDiscount = hasPerm(currentUser, 'apply_discount')
  const [mode, setMode] = useState('single')
  const [discountEditorOpen, setDiscountEditorOpen] = useState(false)

  // ── Loyalty customer ───────────────────────────────────────────
  // QR orders carry the member's user_id in Supabase — resolve it to a
  // profile so the cashier can redeem the customer's points at checkout.
  const [customer,    setCustomer]    = useState(null)  // { id, name, points }
  const [pointsUsage, setPointsUsage] = useState(null)  // { points, amount }
  const [pointsInput, setPointsInput] = useState('')
  const remoteOrderIds = (partialOrder
    ? [partialOrder.supabaseOrderId]
    : (table.orders ?? []).map(o => o.supabaseOrderId)
  ).filter(id => id != null)

  useEffect(() => {
    if (!isSupabaseReady || remoteOrderIds.length === 0) return
    let mounted = true
    ;(async () => {
      try {
        const client = supabase // profiles_select RLS'i is_staff() ile okumaya izin verir
        const { data: rows } = await client
          .from('orders').select('user_id').in('id', remoteOrderIds)
        const uid = rows?.find(r => r.user_id)?.user_id
        if (!uid) return
        const { data: prof } = await client
          .from('profiles').select('id, full_name, loyalty_points').eq('id', uid).single()
        if (mounted && prof) {
          setCustomer({ id: prof.id, name: prof.full_name ?? 'Üye', points: prof.loyalty_points ?? 0 })
        }
      } catch (e) {
        console.warn('[PaymentModal] müşteri bilgisi alınamadı', e)
      }
    })()
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remote order ids are fixed for the modal's lifetime
  }, [])

  // Common: cashier — read once from the local db on open
  const [staffList] = useState(() => {
    try { return getAllStaff().filter(s => s.isActive) } catch { return [] }
  })
  const [selectedWaiter, setSelectedWaiter] = useState('')

  // Single mode
  const [singleMethod, setSingleMethod] = useState('cash')
  const [cashInput,    setCashInput]    = useState('')

  // Split mode (N kişi)
  const [splitCount,  setSplitCount]  = useState(2)
  const [splitMethod, setSplitMethod] = useState('cash')

  // Custom mode (drafts)
  const [customDrafts, setCustomDrafts] = useState([])
  const [draftAmount,  setDraftAmount]  = useState('')
  const [draftMethod,  setDraftMethod]  = useState('cash')
  const [draftLabel,   setDraftLabel]   = useState('')

  // Item selection — items picked from the left order summary are charged
  // separately with their own method (one card, one cash, one iban, ...).
  // itemSel maps item id → selected quantity (≤ line qty) so part of a
  // line ("4 çayın 2'si") can be paid on its own. itemParts accumulates
  // selection+method groups so a single transaction can mix methods.
  const [itemSel,    setItemSel]    = useState(new Map())
  const [itemMethod, setItemMethod] = useState('cash')
  const [itemParts,  setItemParts]  = useState([])

  // Display-only grouping of identical unpaid items (same helper OrderPanel
  // uses) — a group row can be expanded to select its members individually.
  const [expandedGroups, setExpandedGroups] = useState(new Set())
  const toggleGroupExpanded = (key) => setExpandedGroups(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const items = partialOrder ? partialOrder.items : (table.orderItems || [])
  const unpaidItems = items.filter(i => !i.paid)
  // Effective unit price = base unit + sum of modifier deltas (each scaled by its own quantity).
  const itemUnit = (i) => i.unitPrice + (i.modifiers?.reduce(
    (s, m) => s + (Number(m.priceDelta) || 0) * (Number(m.quantity) || 1), 0
  ) || 0)
  const subtotal  = items.reduce((s, i) => s + i.qty * itemUnit(i), 0)
  const discount  = table.discount?.amount ?? 0
  const fullTotal = Math.max(0, subtotal - discount)
  // Amount still owed — prior partial payments are already collected
  const paidSoFar = Math.min(Math.max(Number(alreadyPaid) || 0, 0), fullTotal)
  const total     = Math.round(Math.max(0, fullTotal - paidSoFar) * 100) / 100

  // ── Points redemption math ─────────────────────────────────────
  // Item-selection payments do their own per-item accounting, so points
  // are only honored in the mode-tab flows (Tek / Eşit Böl / Tutar Gir).
  const rate = Number(pointRate) > 0 ? Number(pointRate) : 1
  const selectionOn = itemSel.size > 0 || itemParts.length > 0
  const activePointsUsage = selectionOn ? null : pointsUsage
  const pointsAmount = activePointsUsage?.amount ?? 0
  const payableTotal = Math.round(Math.max(0, total - pointsAmount) * 100) / 100
  const maxUsablePoints = customer ? Math.min(customer.points, Math.floor(total / rate)) : 0

  const applyPoints = () => {
    if (!customer) return
    const n = Math.floor(Number(String(pointsInput).replace(',', '.')))
    const pts = Math.min(Number.isFinite(n) && n > 0 ? n : maxUsablePoints, maxUsablePoints)
    if (pts <= 0) return
    setPointsUsage({ points: pts, amount: Math.round(pts * rate * 100) / 100 })
    setPointsInput('')
  }
  // Item mode charges the GROSS item price (proportional discount folded in)
  // so selecting every item adds up to the payable total.
  const grossFactor = subtotal > 0 ? fullTotal / subtotal : 1
  const itemGrossQty = (i, qty) => Math.round(qty * itemUnit(i) * grossFactor * 100) / 100

  // Quantity of an item already locked into pending parts — only the rest
  // is selectable for the next part / the live selection.
  const reservedQty = (id) => itemParts.reduce(
    (s, p) => s + (p.entries.find(e => e.id === id)?.qty || 0), 0
  )
  const availableQty = (i) => i.qty - reservedQty(i.id)

  const entryAmount = (entries) => entries.reduce((s, e) => {
    const it = unpaidItems.find(i => i.id === e.id)
    return it ? s + itemGrossQty(it, e.qty) : s
  }, 0)
  const entryLabel = (entries) => entries.map(e => {
    const it = unpaidItems.find(i => i.id === e.id)
    if (!it) return null
    return e.qty < it.qty ? `${e.qty}× ${it.name}` : it.name
  }).filter(Boolean).join(', ')

  // ── Mode-specific computed values ──────────────────────────────
  const enteredAmount = parseFloat(cashInput) || 0
  const change        = enteredAmount > payableTotal ? enteredAmount - payableTotal : 0

  const splitShare = splitCount > 0 ? payableTotal / splitCount : 0
  const draftsSum  = customDrafts.reduce((s, d) => s + Number(d.amount || 0), 0)

  // Items ticked on the left override the mode tabs — the payment covers
  // exactly the selected items with the method chosen for them.
  const selectionActive = itemSel.size > 0 || itemParts.length > 0

  const computePaymentsToCommit = () => {
    if (selectionActive) {
      const makeRow = (entries, method) => {
        const ids = []
        const item_amounts = {}
        const item_qtys = {}
        const parts = []
        let sum = 0
        for (const it of unpaidItems) {
          const e = entries.find(x => x.id === it.id)
          if (!e || e.qty <= 0) continue
          const amt = itemGrossQty(it, e.qty)
          sum += amt
          ids.push(it.id)
          item_amounts[it.id] = amt
          item_qtys[it.id] = e.qty
          parts.push(e.qty < it.qty ? `${e.qty}× ${it.name}` : it.name)
        }
        if (sum <= 0) return null
        return {
          amount: Math.round(sum * 100) / 100,
          payment_method: method,
          payer_label: parts.join(', ').slice(0, 200) || null,
          order_item_ids: ids,
          item_amounts,
          item_qtys,
        }
      }
      const rows = []
      for (const p of itemParts) {
        const row = makeRow(p.entries, p.method)
        if (row) rows.push(row)
      }
      const selRow = makeRow([...itemSel].map(([id, qty]) => ({ id, qty })), itemMethod)
      if (selRow) rows.push(selRow)
      if (!rows.length) return []
      // Every unpaid quantity covered = closing payment — snap the last row
      // so per-item rounding can't leave a stray kuruş behind
      const everyUnpaidCovered = unpaidItems.length > 0 && unpaidItems.every(it =>
        (reservedQty(it.id) + (itemSel.get(it.id) || 0)) >= it.qty)
      if (everyUnpaidCovered) {
        const others = rows.slice(0, -1).reduce((s, r) => s + r.amount, 0)
        rows[rows.length - 1].amount = Math.round((total - others) * 100) / 100
      }
      return rows
    }
    // Points cover part (or all) of the bill as their own payment row;
    // the mode rows below only need to collect the remainder.
    const pointsRow = activePointsUsage && customer ? {
      amount: activePointsUsage.amount,
      payment_method: 'points',
      payer_label: `Puan — ${customer.name}`.slice(0, 200),
    } : null
    const withPoints = (rows) => (pointsRow ? [pointsRow, ...rows] : rows)
    if (mode === 'single') {
      if (payableTotal <= 0) return withPoints([])
      return withPoints([{ amount: payableTotal, payment_method: singleMethod }])
    }
    if (mode === 'split') {
      if (payableTotal <= 0) return withPoints([])
      if (splitCount <= 0) return []
      const base = Math.floor((payableTotal / splitCount) * 100) / 100
      const rows = []
      let acc = 0
      for (let i = 0; i < splitCount - 1; i++) {
        rows.push({ amount: base, payment_method: splitMethod, payer_label: `Kişi ${i + 1}` })
        acc += base
      }
      rows.push({ amount: Math.round((payableTotal - acc) * 100) / 100, payment_method: splitMethod, payer_label: `Kişi ${splitCount}` })
      return withPoints(rows)
    }
    if (mode === 'custom') {
      return withPoints(customDrafts.map(d => ({
        amount: Number(d.amount),
        payment_method: d.method,
        payer_label: d.label || null,
      })))
    }
    return []
  }
  const paymentsToCommit = computePaymentsToCommit()

  const commitAmount = paymentsToCommit.reduce((s, r) => s + r.amount, 0)
  const commitOverflow = commitAmount > total + 0.001
  const isFullPayment = commitAmount + 0.001 >= total
  const canComplete = !commitOverflow && commitAmount > 0 && (
    selectionActive || mode !== 'single' || singleMethod !== 'cash' || enteredAmount >= payableTotal
  )

  // ── Handlers ───────────────────────────────────────────────────
  const handleNumpad = (key) => {
    if (key === 'C')  { setCashInput(''); return }
    if (key === '⌫') { setCashInput(p => p.slice(0, -1)); return }
    if (cashInput.includes('.')) {
      const parts = cashInput.split('.')
      if (parts[1]?.length >= 2) return
    }
    setCashInput(p => p + key)
  }

  const handleQuick = (amount) => {
    setCashInput(String(amount === 'exact' ? payableTotal.toFixed(2) : amount))
  }

  const addDraft = () => {
    const amt = parseFloat((draftAmount || '').replace(',', '.'))
    if (!amt || amt <= 0) return
    if (draftsSum + amt > payableTotal + 0.001) return
    setCustomDrafts(prev => [...prev, {
      id: Date.now() + Math.random(),
      amount: amt,
      method: draftMethod,
      label: draftLabel.trim(),
    }])
    setDraftAmount('')
    setDraftLabel('')
  }

  const removeDraft = (id) => setCustomDrafts(prev => prev.filter(d => d.id !== id))
  const fillDraftRemaining = () => setDraftAmount(Math.max(payableTotal - draftsSum, 0).toFixed(2))

  const toggleItemSel = (item) => setItemSel(prev => {
    const next = new Map(prev)
    if (next.has(item.id)) {
      next.delete(item.id)
    } else {
      const avail = availableQty(item)
      if (avail <= 0) return prev
      next.set(item.id, avail)
    }
    return next
  })

  const stepItemQty = (item, delta) => setItemSel(prev => {
    const cur = prev.get(item.id)
    if (!cur) return prev
    const nextQty = Math.min(Math.max(cur + delta, 1), availableQty(item))
    if (nextQty === cur) return prev
    const next = new Map(prev)
    next.set(item.id, nextQty)
    return next
  })

  // Group header click — same rule as toggleItemSel, applied to every
  // selectable (unpaid, not-fully-reserved) member at once. If any member
  // is already selected the whole group is cleared; otherwise every
  // member is selected up to its own available quantity. Never touches
  // items outside the group, and never invents ids beyond real item ids.
  const toggleGroupSel = (members) => setItemSel(prev => {
    const next = new Map(prev)
    const anySelected = members.some(m => next.has(m.id))
    if (anySelected) {
      members.forEach(m => next.delete(m.id))
    } else {
      members.forEach(m => {
        const avail = availableQty(m)
        if (avail > 0) next.set(m.id, avail)
      })
    }
    return next
  })

  // Freeze the current selection as a payment part with its own method,
  // then let the user pick more items for the next method.
  const addItemPart = () => {
    if (itemSel.size === 0) return
    const entries = [...itemSel].map(([id, qty]) => ({ id, qty }))
    setItemParts(prev => [...prev, { id: Date.now() + Math.random(), method: itemMethod, entries }])
    setItemSel(new Map())
  }
  const removeItemPart = (id) => setItemParts(prev => prev.filter(p => p.id !== id))
  const clearSelection = () => { setItemSel(new Map()); setItemParts([]) }

  // A double-click on "Tahsil Et" must not record the payment twice —
  // the modal unmounts right after the first call, no reset needed.
  const completedRef = useRef(false)
  const handleComplete = async () => {
    if (!canComplete || completedRef.current) return
    completedRef.current = true

    // Redeeming points: deduct from the member's balance FIRST, with an
    // optimistic lock on the balance we displayed — a concurrent spend from
    // another device makes the update match 0 rows instead of overdrafting.
    if (activePointsUsage && customer) {
      try {
        if (!supabase) throw new Error('Supabase yapılandırılmamış')
        // SECURITY DEFINER RPC — personel yetkisiyle, iyimser kilitle düşer
        // (bakiye ekranda görünenden farklıysa 'bakiye değişti' fırlatır)
        const { error } = await supabase.rpc('redeem_loyalty_points', {
          p_user_id:          customer.id,
          p_points:           activePointsUsage.points,
          p_expected_balance: customer.points,
        })
        if (error) throw error
      } catch (e) {
        console.error('[PaymentModal] puan düşülemedi', e)
        completedRef.current = false
        setPointsUsage(null)
        alert('Puan kullanılamadı — müşteri bakiyesi değişmiş veya bağlantı yok. Puansız devam edebilirsiniz.')
        return
      }
    }

    // Mixed methods (including a points row) collapse to 'split',
    // same as Tutar Gir does.
    const selMethods = new Set(paymentsToCommit.map(r => r.payment_method))
    const selMethod = selMethods.size === 1 ? [...selMethods][0] : 'split'
    onComplete({
      tableId:          table.id,
      tableName:        table.name,
      supabaseOrderId:  partialOrder ? (partialOrder.supabaseOrderId ?? null) : (table.orderId ?? null),
      subOrderLocalId:  partialOrder?.localId ?? null,
      items,
      subtotal,
      tax: 0,
      discount,
      total,
      paymentMethod:    selMethod,
      cashReceived:     !selectionActive && mode === 'single' && singleMethod === 'cash' ? enteredAmount : null,
      change:           !selectionActive && mode === 'single' && singleMethod === 'cash' ? change : 0,
      paymentRows:      paymentsToCommit,
      isFullPayment,
      alreadyPaid:      paidSoFar,
      fullTotal,
      closedAt:         new Date().toISOString(),
      waiterName:       selectedWaiter || null,
    })
  }

  // Minted once per modal open — impure call in render would regenerate it
  const [transactionId] = useState(() => `POS-${Math.floor(10000 + Math.random() * 90000)}-TX`)

  // ── Item row rendering ───────────────────────────────────────────
  // Single line item — identical markup/behavior as before grouping was
  // introduced. Used both for standalone rows and for the expanded
  // children of a multi-item group.
  const renderItemRow = (item, altIdx) => {
    const isPaid = !!item.paid
    const reserved = isPaid ? 0 : reservedQty(item.id)
    const fullyReserved = !isPaid && reserved >= item.qty
    const selQty = isPaid ? 0 : (itemSel.get(item.id) || 0)
    const selected = selQty > 0
    const clickable = !isPaid && !fullyReserved
    return (
      <div
        key={item.id}
        className={`pm-item ${altIdx != null && altIdx % 2 === 1 ? 'pm-item--alt' : ''} ${isPaid ? 'pm-item--paid' : ''} ${fullyReserved ? 'pm-item--reserved' : ''} ${clickable ? 'pm-item--selectable' : ''} ${selected ? 'pm-item--selected' : ''}`}
        onClick={clickable ? () => toggleItemSel(item) : undefined}
      >
        <span className={`pm-item__check ${selected || isPaid || fullyReserved ? 'pm-item__check--on' : ''}`}>
          {isPaid || selected || fullyReserved ? '✓' : ''}
        </span>
        <span className="pm-item__qty">{item.qty}</span>
        <div className="pm-item__name-wrap">
          <span className="pm-item__name">{item.name}{isPaid ? ' — Ödendi' : ''}</span>
          {item.note && <span className="pm-item__note">{item.note}</span>}
          {reserved > 0 && (
            <span className="pm-item__reserved">
              {fullyReserved ? 'Ödemeye eklendi' : `${reserved} adet ödemeye eklendi`}
            </span>
          )}
          {selected && item.qty > 1 && (
            <div className="pm-item__qtysel" onClick={e => e.stopPropagation()}>
              <button onClick={() => stepItemQty(item, -1)}>−</button>
              <span>{selQty} / {item.qty}</span>
              <button onClick={() => stepItemQty(item, +1)}>+</button>
            </div>
          )}
        </div>
        <span className="pm-item__unit">₺{itemUnit(item).toFixed(2)}</span>
        <span className="pm-item__total">₺{(item.qty * itemUnit(item)).toFixed(2)}</span>
      </div>
    )
  }

  // Group header — combined qty + name + modifier summary + combined total,
  // with an expand/collapse chevron revealing the individual rows. Clicking
  // the header (outside the chevron) toggles the whole group's selection;
  // only used for unpaid groups with more than one underlying item.
  const renderGroupRow = (group, altIdx) => {
    const first = group.items[0]
    const totalQty = group.items.reduce((s, i) => s + i.qty, 0)
    const combinedTotal = group.items.reduce((s, i) => s + i.qty * itemUnit(i), 0)
    const groupAvailable = group.items.reduce((s, i) => s + availableQty(i), 0)
    const groupReserved = group.items.reduce((s, i) => s + reservedQty(i.id), 0)
    const groupSelQty = group.items.reduce((s, i) => s + (itemSel.get(i.id) || 0), 0)
    const fullyReserved = groupAvailable === 0
    const clickable = groupAvailable > 0
    const selected = groupSelQty > 0
    const itemMods = first.modifiers || []
    const hasMods = itemMods.length > 0
    const hasNote = !!(first.note && first.note.trim())
    const key = `grp-${group.sig}`
    const expanded = expandedGroups.has(key)
    return (
      <div key={key} className="pm-item-group">
        <div
          className={`pm-item pm-item-group__header ${altIdx != null && altIdx % 2 === 1 ? 'pm-item--alt' : ''} ${fullyReserved ? 'pm-item--reserved' : ''} ${clickable ? 'pm-item--selectable' : ''} ${selected ? 'pm-item--selected' : ''}`}
          onClick={clickable ? () => toggleGroupSel(group.items) : undefined}
        >
          <span className={`pm-item__check ${selected || fullyReserved ? 'pm-item__check--on' : ''}`}>
            {selected || fullyReserved ? '✓' : ''}
          </span>
          <span className="pm-item__qty pm-item-group__qty">
            <button
              className={`pm-item-group__chevron ${expanded ? 'pm-item-group__chevron--open' : ''}`}
              aria-label={expanded ? 'Daralt' : 'Genişlet'}
              onClick={(e) => { e.stopPropagation(); toggleGroupExpanded(key) }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 6 15 12 9 18"/>
              </svg>
            </button>
            {totalQty}
          </span>
          <div className="pm-item__name-wrap">
            <span className="pm-item__name">{first.name}</span>
            {hasMods && (
              <span className="pm-item__mods-summary">
                {itemMods.map(m => `+ ${m.name}${(m.quantity || 1) > 1 ? ` ×${m.quantity}` : ''}`).join(', ')}
              </span>
            )}
            {hasNote && <span className="pm-item__note">{first.note}</span>}
            {groupReserved > 0 && (
              <span className="pm-item__reserved">
                {fullyReserved ? 'Ödemeye eklendi' : `${groupReserved} adet ödemeye eklendi`}
              </span>
            )}
            {selected && (
              <span className="pm-item__reserved">{groupSelQty} / {totalQty} seçili</span>
            )}
          </div>
          <span className="pm-item__unit">₺{itemUnit(first).toFixed(2)}</span>
          <span className="pm-item__total">₺{combinedTotal.toFixed(2)}</span>
        </div>
        {expanded && (
          <div className="pm-item-group__children">
            {group.items.map(item => renderItemRow(item, null))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="pm-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pm-modal">

        {/* ── Header ── */}
        <div className="pm-header">
          <div className="pm-header__left">
            <div className="pm-header__icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div>
              <h2 className="pm-header__title">
                Masa {table.name}{partialOrder ? ` – ${partialOrder.label}` : ' – Ödeme'}
              </h2>
              <p className="pm-header__subtitle">
                Açılış: {table.openTime ?? '—'} • Garson: {table.waiter ?? '—'}
              </p>
            </div>
          </div>
          <button className="pm-header__close" onClick={onClose}>✕</button>
        </div>

        {/* ── Body ── */}
        <div className="pm-body">

          {/* LEFT: Order Summary */}
          <div className="pm-left">
            <div className="pm-section-title">
              <span>Sipariş Özeti</span>
              <span className="pm-item-count">{items.length} Ürün</span>
            </div>
            <p className="pm-select-hint">
              Ürünlere tıklayarak seçin — adet azaltarak bir ürünün yalnızca bir kısmını, "+ Farklı Yöntemle Ayır" ile de parçaları ayrı yöntemlerle (nakit / kart / IBAN) tahsil edebilirsiniz.
            </p>

            <div className="pm-items">
              <div className="pm-items__head">
                <span></span>
                <span>ADET</span>
                <span>ÜRÜN</span>
                <span>BİRİM</span>
                <span>TOPLAM</span>
              </div>
              {buildDisplayRows(items).map((row, idx) => {
                if (row.kind === 'single') return renderItemRow(row.item, idx)
                if (row.items.length === 1) return renderItemRow(row.items[0], idx)
                return renderGroupRow(row, idx)
              })}
            </div>

            <div className="pm-totals">
              <div className="pm-totals__row">
                <span>Ara Toplam</span>
                <span>₺{subtotal.toFixed(2)}</span>
              </div>
              {discount > 0 && !discountEditorOpen && (
                <div className="pm-totals__row pm-totals__row--discount">
                  <button
                    className="pm-totals__discount-label"
                    onClick={canDiscount ? () => setDiscountEditorOpen(true) : undefined}
                    title={canDiscount ? 'İndirimi düzenle' : undefined}
                  >
                    {table.discount?.label ?? 'İndirim'}
                  </button>
                  <span className="pm-totals__discount-value">
                    – ₺{discount.toFixed(2)}
                    {canDiscount && <button
                      className="pm-totals__discount-remove"
                      title="İndirimi kaldır"
                      onClick={() => onSetDiscount?.(table.id, null)}
                    >✕</button>}
                  </span>
                </div>
              )}
              {canDiscount && discount === 0 && !discountEditorOpen && (
                <button className="pm-totals__add-discount" onClick={() => setDiscountEditorOpen(true)}>
                  + İndirim Ekle
                </button>
              )}
              {canDiscount && discountEditorOpen && (
                <DiscountEditor
                  subtotal={subtotal}
                  initialAmount={table.discount?.amount ?? null}
                  initialLabel={table.discount?.label ?? ''}
                  onApply={(d) => { onSetDiscount?.(table.id, d); setDiscountEditorOpen(false) }}
                  onCancel={() => setDiscountEditorOpen(false)}
                />
              )}
              {paidSoFar > 0 && (
                <div className="pm-totals__row pm-totals__row--paid">
                  <span>Ödenen</span>
                  <span>– ₺{paidSoFar.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Payment Panel */}
          <div className="pm-right">
            <div className="pm-amount-card">
              <span className="pm-amount-label">ÖDENECEK TOPLAM</span>
              <span className="pm-amount-value">₺{payableTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
              {pointsAmount > 0 && (
                <span className="pm-amount-points">
                  <s>₺{total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</s>
                  {' '}· {activePointsUsage.points} puan (−{fmt(pointsAmount)})
                </span>
              )}
            </div>

            {/* Üye / puan kullanımı */}
            {customer && (
              <div className="pm-customer">
                <div className="pm-customer__row">
                  <span className="pm-customer__avatar">
                    {(customer.name || 'Ü').charAt(0).toUpperCase()}
                  </span>
                  <div className="pm-customer__info">
                    <strong>{customer.name}</strong>
                    <span>{customer.points} puan · {fmt(customer.points * rate)} değerinde</span>
                  </div>
                  <span className="pm-customer__badge">Üye</span>
                </div>
                {selectionOn ? (
                  <p className="pm-customer__hint">Puan kullanımı ürün seçimiyle birlikte kullanılamaz.</p>
                ) : activePointsUsage ? (
                  <div className="pm-customer__applied">
                    <span>{activePointsUsage.points} puan uygulandı</span>
                    <strong>− {fmt(activePointsUsage.amount)}</strong>
                    <button title="Puan kullanımını kaldır" onClick={() => setPointsUsage(null)}>✕</button>
                  </div>
                ) : maxUsablePoints > 0 ? (
                  <div className="pm-customer__use">
                    <input
                      type="number"
                      min="1"
                      max={maxUsablePoints}
                      value={pointsInput}
                      onChange={e => setPointsInput(e.target.value)}
                      placeholder={String(maxUsablePoints)}
                    />
                    <button className="pm-customer__max" onClick={() => setPointsInput(String(maxUsablePoints))}>
                      Maks
                    </button>
                    <button className="pm-customer__apply" onClick={applyPoints}>
                      Puan Kullan
                    </button>
                  </div>
                ) : (
                  <p className="pm-customer__hint">Kullanılabilir puan yok.</p>
                )}
              </div>
            )}

            {/* Kasiyer */}
            {staffList.length > 0 && (
              <div className="pm-kasiyer">
                <label className="pm-kasiyer__label">Kasiyer</label>
                <select
                  className="pm-kasiyer__select"
                  value={selectedWaiter}
                  onChange={e => setSelectedWaiter(e.target.value)}
                >
                  <option value="">Seçin...</option>
                  {staffList.map(s => (
                    <option key={s.id} value={s.name}>{s.name} — {s.role}</option>
                  ))}
                </select>
              </div>
            )}

            {/* ── SELECTION (items picked from the left) ── */}
            {selectionActive && (
              <div className="pm-mode-panel">
                <div className="pm-sel-summary">
                  <div className="pm-sel-summary__info">
                    <strong>
                      {itemParts.length > 0
                        ? `${itemParts.length} parça${itemSel.size > 0 ? ` + ${itemSel.size} ürün seçili` : ''}`
                        : `${itemSel.size} ürün seçili`}
                    </strong>
                    <span>Sadece seçim tutarı tahsil edilir; masa tüm ürünler ödenince kapanır.</span>
                  </div>
                  <button className="pm-sel-summary__clear" onClick={clearSelection}>
                    Seçimi Temizle
                  </button>
                </div>

                {itemParts.length > 0 && (
                  <div className="pm-drafts">
                    {itemParts.map(p => (
                      <div key={p.id} className="pm-draft">
                        <span className="pm-draft__method">{p.method === 'cash' ? '💵' : p.method === 'iban' ? '🏦' : '💳'}</span>
                        <div className="pm-draft__info">
                          <strong>{fmt(entryAmount(p.entries))} — {METHODS.find(m => m.id === p.method)?.label ?? p.method}</strong>
                          <span>{entryLabel(p.entries)}</span>
                        </div>
                        <button className="pm-draft__remove" onClick={() => removeItemPart(p.id)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {itemSel.size > 0 && (
                  <>
                    <MethodPicker value={itemMethod} onChange={setItemMethod} />
                    <button className="pm-add-draft-btn" onClick={addItemPart}>
                      + Farklı Yöntemle Ayır
                    </button>
                  </>
                )}
                {itemSel.size === 0 && itemParts.length > 0 && (
                  <p className="pm-mode-panel__hint">
                    Başka bir yöntem eklemek için soldan ürün seçin — ya da "Tahsil Et" ile parçaları tek seferde tahsil edin.
                  </p>
                )}
              </div>
            )}

            {/* Mode tabs */}
            {!selectionActive && (
            <div className="pm-mode-tabs">
              {MODES.map(m => (
                <button
                  key={m.id}
                  className={`pm-mode-tab ${mode === m.id ? 'pm-mode-tab--active' : ''}`}
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            )}

            {/* ── SINGLE ── */}
            {!selectionActive && mode === 'single' && (
              <>
                <MethodPicker value={singleMethod} onChange={setSingleMethod} />

                {singleMethod === 'cash' && (
                  <>
                    <div className="pm-quick">
                      <button className="pm-quick__btn" onClick={() => handleQuick(700)}>700 ₺</button>
                      <button className="pm-quick__btn" onClick={() => handleQuick(1000)}>1000 ₺</button>
                      <button className="pm-quick__btn pm-quick__btn--exact" onClick={() => handleQuick('exact')}>Tam Tutar</button>
                    </div>

                    <div className="pm-cash-display">
                      <span className="pm-cash-display__label">Alınan Nakit</span>
                      <span className="pm-cash-display__value">
                        {cashInput ? `₺${cashInput}` : '—'}
                      </span>
                      {change > 0 && (
                        <span className="pm-cash-display__change">Para Üstü: ₺{change.toFixed(2)}</span>
                      )}
                    </div>

                    <div className="pm-numpad">
                      {NUMPAD_KEYS.map(key => (
                        <button
                          key={key}
                          className={`pm-numpad__key ${key === 'C' ? 'pm-numpad__key--clear' : ''} ${key === '⌫' ? 'pm-numpad__key--back' : ''}`}
                          onClick={() => handleNumpad(key)}
                        >
                          {key === '⌫' ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
                              <line x1="18" y1="9" x2="12" y2="15" />
                              <line x1="12" y1="9" x2="18" y2="15" />
                            </svg>
                          ) : key}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {/* ── SPLIT (N kişi) ── */}
            {!selectionActive && mode === 'split' && (
              <div className="pm-mode-panel">
                <p className="pm-mode-panel__hint">
                  Toplamı eşit parçalara böl. Yuvarlama farkı son kişiye eklenir.
                </p>
                <div className="pm-split-stepper">
                  <span className="pm-split-stepper__label">KİŞİ SAYISI</span>
                  <div className="pm-split-stepper__controls">
                    <button onClick={() => setSplitCount(c => Math.max(2, c - 1))}>−</button>
                    <span>{splitCount}</span>
                    <button onClick={() => setSplitCount(c => Math.min(20, c + 1))}>+</button>
                  </div>
                </div>
                <div className="pm-split-share">
                  <span>KİŞİ BAŞI</span>
                  <strong>{fmt(splitShare)}</strong>
                </div>
                <MethodPicker value={splitMethod} onChange={setSplitMethod} />
              </div>
            )}

            {/* ── CUSTOM (Tutar gir) ── */}
            {!selectionActive && mode === 'custom' && (
              <div className="pm-mode-panel">
                <p className="pm-mode-panel__hint">
                  Her kişi/grup için ayrı tutar ekleyin. Toplam ödenecek tutarı geçemez.
                </p>

                {customDrafts.length > 0 && (
                  <div className="pm-drafts">
                    {customDrafts.map(d => (
                      <div key={d.id} className="pm-draft">
                        <span className="pm-draft__method">{d.method === 'cash' ? '💵' : d.method === 'iban' ? '🏦' : '💳'}</span>
                        <div className="pm-draft__info">
                          <strong>{fmt(d.amount)}</strong>
                          <span>{d.label || (METHODS.find(m => m.id === d.method)?.label ?? d.method)}</span>
                        </div>
                        <button className="pm-draft__remove" onClick={() => removeDraft(d.id)}>✕</button>
                      </div>
                    ))}
                    <div className="pm-draft__sum">
                      <span>Toplam:</span>
                      <strong>{fmt(draftsSum)}</strong>
                      <span className="pm-draft__remaining">Kalan: {fmt(Math.max(payableTotal - draftsSum, 0))}</span>
                    </div>
                  </div>
                )}

                <label className="pm-field-label">TUTAR</label>
                <div className="pm-field-row">
                  <input
                    type="number"
                    className="pm-text-input"
                    value={draftAmount}
                    onChange={e => setDraftAmount(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                  />
                  <button className="pm-fill-btn" onClick={fillDraftRemaining}>Kalan</button>
                </div>

                <label className="pm-field-label">ETİKET (OPSİYONEL)</label>
                <input
                  type="text"
                  className="pm-text-input"
                  value={draftLabel}
                  onChange={e => setDraftLabel(e.target.value)}
                  placeholder="Örn. Müşteri 1, Ali"
                />

                <MethodPicker value={draftMethod} onChange={setDraftMethod} />

                <button className="pm-add-draft-btn" onClick={addDraft}>+ Ödemeye Ekle</button>
              </div>
            )}

            {/* Commit summary */}
            <div className="pm-commit-summary">
              <span>TAHSİL EDİLECEK</span>
              <strong className={commitOverflow ? 'pm-commit-summary__error' : ''}>
                {fmt(commitAmount)}{!isFullPayment && commitAmount > 0 ? ' (kısmi)' : ''}
              </strong>
            </div>

            <button
              className={`pm-complete-btn ${!canComplete ? 'pm-complete-btn--disabled' : ''}`}
              onClick={handleComplete}
              disabled={!canComplete}
            >
              {isFullPayment ? 'Tahsil & Kapat' : 'Tahsil Et'}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="pm-footer">
          <span>İŞLEM ID: {transactionId}</span>
          <span>TERMİNAL: 01-FRONT &nbsp; VERSİYON: 1.0.0 MARS LOUNGE</span>
        </div>

      </div>
    </div>
  )
}

export default PaymentModal
