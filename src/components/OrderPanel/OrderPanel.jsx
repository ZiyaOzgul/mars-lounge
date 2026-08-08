import { useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import ItemCustomizeModal from '../ItemCustomizeModal/ItemCustomizeModal.jsx'
import TablePickerModal from '../TablePickerModal/TablePickerModal.jsx'
import DiscountEditor from '../shared/DiscountEditor.jsx'
import PrintButton from '../shared/PrintButton.jsx'
import { buildDisplayRows } from '../../lib/itemGrouping.js'
import { hasPerm } from '../../lib/permissions.js'
import { buildReceiptHtml } from '../../lib/receipt.js'
import './OrderPanel.css'

// Sum of modifier deltas for one line item, weighted by modifier quantity.
function modifiersSum(modifiers) {
  if (!modifiers?.length) return 0
  return modifiers.reduce((s, m) => s + (Number(m.priceDelta) || 0) * (Number(m.quantity) || 1), 0)
}

// ── Category icons (same set as Settings) ────────────────────────
const IconCoffee = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
    <line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
  </svg>
)
const IconCake = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2 1 2 1"/>
    <path d="M2 21h20"/><path d="M7 8v2"/><path d="M12 8v2"/><path d="M17 8v2"/><path d="M7 4h.01"/><path d="M12 4h.01"/><path d="M17 4h.01"/>
  </svg>
)
const IconCocktail = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 22h8"/><path d="M12 11v11"/><path d="M20 2H4l8 9.46L20 2z"/>
  </svg>
)
const IconFood = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>
  </svg>
)
const IconTea = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z"/><line x1="6" y1="2" x2="6" y2="5"/><line x1="10" y1="2" x2="10" y2="5"/><line x1="14" y1="2" x2="14" y2="5"/>
  </svg>
)
const IconJuice = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2h8l1 6H7L8 2z"/><path d="M7 8l1 13h8l1-13"/><line x1="6" y1="12" x2="18" y2="12"/>
  </svg>
)
const IconSandwich = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 11l19-9-9 19-2-8-8-2z"/><path d="M3 6h18"/><path d="M3 18h18"/>
  </svg>
)
const IconDessert = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 11l5-9 5 9"/><path d="M12 2v20"/><path d="M5 21h14"/><circle cx="12" cy="14" r="3"/>
  </svg>
)
const IconBreakfast = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/>
  </svg>
)
const IconPizza = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 22h20L12 2z"/><path d="M12 2v20"/><circle cx="9" cy="14" r="1.5" fill="currentColor"/><circle cx="15" cy="10" r="1.5" fill="currentColor"/>
  </svg>
)

const CATEGORY_ICONS = {
  coffee: IconCoffee, cake: IconCake, cocktail: IconCocktail, food: IconFood,
  tea: IconTea, juice: IconJuice, sandwich: IconSandwich,
  dessert: IconDessert, breakfast: IconBreakfast, pizza: IconPizza,
}

// ── Main component ────────────────────────────────────────────────
function OrderPanel({
  table, tables = [],
  onClose, onCloseTable, onAddItem, onUpdateNote, onRemoveItem,
  onPayOrder, onNewGroup, onMoveOrderToTable, onMoveItemsToTable, onSetDiscount,
}) {
  const { products, categories, productVariants, currentUser } = useApp()
  const canDiscount = hasPerm(currentUser, 'apply_discount')
  const canClose    = hasPerm(currentUser, 'close_table')
  const [search,               setSearch]               = useState('')
  const [activeCatId,          setActiveCatId]          = useState(null)
  const [pickerView,           setPickerView]           = useState('categories')
  const [discountEditorOpen,   setDiscountEditorOpen]   = useState(false)
  const [expandedGroups,       setExpandedGroups]       = useState(new Set())

  // Customize modal flow (variant + modifiers + qty, single combined modal)
  const [customizeModal, setCustomizeModal] = useState(null)
  // customizeModal = { mode:'add'|'edit', product, variants?, basePrice, initialModifiers, editTarget?:{orderId,itemId} }

  // Transfer flow
  const [selectionMode,    setSelectionMode]    = useState(false)
  const [selectedItemIds,  setSelectedItemIds]  = useState(new Set())
  const [tablePicker,      setTablePicker]      = useState(null)
  // tablePicker = { mode:'emptyOnly'|'occupiedOnly', subOrderLocalId, itemIds? }

  const orders     = table.orders ?? []
  const orderItems = orders.flatMap(o => o.items)
  const subtotal   = orderItems.reduce((s, i) => s + i.qty * (i.unitPrice + modifiersSum(i.modifiers)), 0)
  const discount   = table.discount?.amount ?? 0
  const total      = Math.max(0, subtotal - discount)
  const isOccupied = orderItems.length > 0
  // Primary manual order group (first one without supabaseOrderId, or first overall)
  const primaryGroup = orders.find(o => o.supabaseOrderId == null) ?? orders[0]

  // ── Receipt printing (thermal printer, via the shared PrintButton) ──
  // Sipariş No prefers the real persisted order id (Supabase or offline
  // local_id) over a fallback, same preference order PaymentModal used.
  const buildReceiptForPrint = () => buildReceiptHtml({
    tableName: table.name,
    orderNo: orders[0]?.persistedOrderId ?? orders[0]?.supabaseOrderId ?? `POS-${Date.now()}-TX`,
    items: orderItems,
    discount,
    total,
    staffName: currentUser?.full_name ?? currentUser?.email ?? '',
  })

  const filteredProducts = products.filter(p => {
    const matchCat    = activeCatId === null || p.categoryId === activeCatId
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  // ── Product selection ──────────────────────────────────────────
  // Resolves the product object for the customize modal. We pass through
  // categoryId so the modal can look up the right modifier list. Variant
  // choice, extras, and quantity are all handled in one combined modal.
  const handleProductClick = (p) => {
    const variants = productVariants[p.id] ?? []
    setCustomizeModal({
      mode: 'add',
      product: p,
      variants,
      basePrice: p.price,
      initialModifiers: [],
    })
  }

  const handleCustomizeSubmit = (modifiers, qty = 1, variant = null) => {
    if (!customizeModal) return
    if (customizeModal.mode === 'add') {
      const { product } = customizeModal
      const payload = variant
        ? { id: variant.id, productId: product.id, name: `${product.name} (${variant.name})`, price: variant.price, variantId: variant.id }
        : { id: product.id, productId: product.id, name: product.name, price: product.price, variantId: null }
      const n = Math.min(99, Math.max(1, Number(qty) || 1))
      // Mobile parity model: every unit is its own row (see Tables.jsx
      // makeLineItem), so N× add = N calls. These share a signature and
      // render as one grouped row in the panel.
      for (let i = 0; i < n; i++) {
        onAddItem(table.id, payload, modifiers)
      }
    } else if (customizeModal.editTarget) {
      const { orderId, itemId } = customizeModal.editTarget
      onUpdateNote(table.id, itemId, modifiers, orderId)
    }
    setCustomizeModal(null)
  }

  // Edit the modifier set on an existing line item. We resolve the original
  // product so the modal can re-show the currently-effective modifier list.
  const openEditCustomize = (order, item) => {
    const product = products.find(p => p.id === item.productId) || {
      id: item.productId, name: item.name, price: item.unitPrice, categoryId: null,
    }
    setCustomizeModal({
      mode: 'edit',
      product,
      variants: [],
      basePrice: item.unitPrice,
      initialModifiers: item.modifiers || [],
      editTarget: { orderId: order.localId, itemId: item.id },
    })
  }

  // ── Group expand/collapse (display-only grouping) ───────────────
  const toggleGroupExpanded = (key) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ── Search/category navigation ─────────────────────────────────
  const handleSearchChange = (e) => {
    const val = e.target.value
    setSearch(val)
    if (val && pickerView === 'categories') {
      setActiveCatId(null)
      setPickerView('products')
    }
  }

  const handleCategorySelect = (catId) => {
    setActiveCatId(catId)
    setPickerView('products')
  }

  const handleBackToCategories = () => {
    setSearch('')
    setPickerView('categories')
  }

  // ── Transfer flow ─────────────────────────────────────────────
  const toggleSelectItem = (itemId) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const enterTransferMode = () => {
    setSelectionMode(true)
    setSelectedItemIds(new Set())
  }

  const exitTransferMode = () => {
    setSelectionMode(false)
    setSelectedItemIds(new Set())
  }

  const openMoveTablePicker = () => {
    if (!primaryGroup) return
    setTablePicker({ mode: 'emptyOnly', subOrderLocalId: primaryGroup.localId })
  }

  const openMoveItemsPicker = () => {
    if (selectedItemIds.size === 0) return
    setTablePicker({
      mode: 'occupiedOnly',
      subOrderLocalId: primaryGroup?.localId ?? orders[0]?.localId,
      itemIds: Array.from(selectedItemIds),
    })
  }

  const handleTablePicked = (target) => {
    if (!tablePicker) return
    if (tablePicker.mode === 'emptyOnly') {
      onMoveOrderToTable?.(table.id, tablePicker.subOrderLocalId, target.id)
      setTablePicker(null)
      onClose()
    } else {
      onMoveItemsToTable?.(table.id, tablePicker.subOrderLocalId, tablePicker.itemIds, target.id, null)
      setTablePicker(null)
      exitTransferMode()
    }
  }

  // ── Item row rendering ───────────────────────────────────────────
  // Single line item — identical markup/behavior as before grouping was
  // introduced. Used both for standalone rows and for the expanded
  // children of a multi-item group.
  const renderItemRow = (order, item) => {
    const isPaid = !!item.paid
    const selected = !isPaid && selectedItemIds.has(item.id)
    const hasNote = !!(item.note && item.note.trim())
    const itemMods = item.modifiers || []
    const hasMods = itemMods.length > 0
    const lineUnit = item.unitPrice + modifiersSum(itemMods)
    return (
      <div
        key={`${order.localId}-${item.id}`}
        className={`om-item ${selectionMode && !isPaid ? 'om-item--selectable' : ''} ${selected ? 'om-item--selected' : ''} ${isPaid ? 'om-item--paid' : ''}`}
        onClick={selectionMode && !isPaid ? () => toggleSelectItem(item.id) : undefined}
      >
        {selectionMode && (
          <span className="om-item__checkbox" aria-hidden>
            {isPaid ? '✓' : (selected ? '☑' : '☐')}
          </span>
        )}
        {!selectionMode && (
          <span className="om-item__qty-badge">
            {item.qty > 1 ? `×${item.qty}` : '1'}
          </span>
        )}
        <div className="om-item__main">
          <div className="om-item__name">{item.name}</div>
          {hasMods && (
            <div className="om-item__mods">
              {itemMods.map((m, idx) => {
                const q = m.quantity || 1
                const deltaTotal = (Number(m.priceDelta) || 0) * q
                return (
                  <div key={m.modifierId ?? m.id ?? idx} className="om-item__mod">
                    <span className="om-item__mod-name">
                      + {m.name}{q > 1 ? ` ×${q}` : ''}
                    </span>
                    {deltaTotal !== 0 && (
                      <span className="om-item__mod-delta">
                        {deltaTotal > 0 ? '+' : '–'}₺{Math.abs(deltaTotal).toLocaleString('tr-TR')}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {hasNote && (
            <div className="om-item__note">{item.note}</div>
          )}
        </div>
        <span className="om-item__total">₺{(item.qty * lineUnit).toLocaleString('tr-TR')}</span>
        {!selectionMode && isPaid && (
          <span className="om-item__paid-badge">Ödendi</span>
        )}
        {!selectionMode && !isPaid && (
          <>
            <button
              className={`om-item__icon-btn ${hasMods ? 'om-item__icon-btn--note-on' : ''}`}
              title="Ekstraları düzenle"
              onClick={() => openEditCustomize(order, item)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button
              className="om-item__icon-btn om-item__icon-btn--danger"
              title="Kaldır"
              onClick={() => onRemoveItem(table.id, item.id, order.localId)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </>
        )}
      </div>
    )
  }

  // Group header — combined qty chip + name + modifier summary + combined
  // total, with an expand/collapse chevron revealing the individual rows.
  // Only used for unpaid groups with more than one underlying item.
  const renderGroupHeader = (order, group) => {
    const first = group.items[0]
    const totalQty = group.items.reduce((s, i) => s + i.qty, 0)
    const itemMods = first.modifiers || []
    const hasMods = itemMods.length > 0
    const hasNote = !!(first.note && first.note.trim())
    const combinedTotal = group.items.reduce((s, i) => s + i.qty * (i.unitPrice + modifiersSum(i.modifiers)), 0)
    const key = `${order.localId}::${group.sig}`
    const expanded = expandedGroups.has(key)
    return (
      <div key={key} className="om-item-group">
        <div
          className="om-item om-item-group__header"
          onClick={() => toggleGroupExpanded(key)}
        >
          <button
            className={`om-item-group__chevron ${expanded ? 'om-item-group__chevron--open' : ''}`}
            aria-label={expanded ? 'Daralt' : 'Genişlet'}
            onClick={(e) => { e.stopPropagation(); toggleGroupExpanded(key) }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 6 15 12 9 18"/>
            </svg>
          </button>
          <span className="om-item__qty-badge om-item__qty-badge--group">×{totalQty}</span>
          <div className="om-item__main">
            <div className="om-item__name">{first.name}</div>
            {hasMods && (
              <div className="om-item__mods-summary">
                {itemMods.map(m => `+ ${m.name}${(m.quantity || 1) > 1 ? ` ×${m.quantity}` : ''}`).join(', ')}
              </div>
            )}
            {hasNote && (
              <div className="om-item__note">{first.note}</div>
            )}
          </div>
          <span className="om-item__total">₺{combinedTotal.toLocaleString('tr-TR')}</span>
        </div>
        {expanded && (
          <div className="om-item-group__children">
            {group.items.map(item => renderItemRow(order, item))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="om-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="om-modal">

        {/* ── LEFT: Order summary ── */}
        <div className="om-left">

          {/* Header */}
          <div className="om-left__header">
            <div className="om-left__title">
              <span>{table.name}</span>
              <span className={`badge ${isOccupied ? 'badge--success' : 'badge--muted'}`}>
                {isOccupied ? 'Açık' : 'Boş'}
              </span>
            </div>
            <button className="om-close-btn" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Items list — grouped by order */}
          <div className="om-items-scroll">
            {orders.length === 0 ? (
              <div className="om-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 0 1-8 0"/>
                </svg>
                <p>Henüz ürün eklenmedi.</p>
                <p className="om-empty__hint">Sağdan ürün seçin.</p>
              </div>
            ) : (
              <div className="om-items">
                {orders.map(order => {
                  const grpSubtotal = order.items.reduce((s, i) => s + i.qty * (i.unitPrice + modifiersSum(i.modifiers)), 0)
                  const showHeader = orders.length > 1
                  const isActive = table.activeGroupId === order.localId
                  return (
                    <div key={order.localId} className={`${showHeader ? 'om-order-group' : ''} ${isActive ? 'om-order-group--active' : ''}`}>
                      {showHeader && (
                        <div className="om-order-group__header">
                          <span className="om-order-group__label">{order.label}</span>
                          {isActive && <span className="om-order-group__active-dot" />}
                          <span className="om-order-group__subtotal">₺{grpSubtotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                          {canClose && <button
                            className="om-order-group__pay-btn"
                            onClick={() => onPayOrder(table.id, order.localId)}
                          >Öde</button>}
                        </div>
                      )}
                      {selectionMode
                        ? order.items.map(item => renderItemRow(order, item))
                        : buildDisplayRows(order.items).map(row => {
                            if (row.kind === 'single') return renderItemRow(order, row.item)
                            if (row.items.length === 1) return renderItemRow(order, row.items[0])
                            return renderGroupHeader(order, row)
                          })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer: totals + new group + close button */}
          <div className="om-left__footer">
            {isOccupied && !selectionMode && (
              <div className="om-totals">
                <div className="om-totals__row">
                  <span>Ara Toplam</span>
                  <span>₺{subtotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                </div>
                {discount > 0 && !discountEditorOpen && (
                  <div className="om-totals__row om-totals__row--discount">
                    <button
                      className="om-totals__discount-label"
                      onClick={canDiscount ? () => setDiscountEditorOpen(true) : undefined}
                      title={canDiscount ? 'İndirimi düzenle' : undefined}
                    >
                      {table.discount?.label ?? 'İndirim'}
                    </button>
                    <span className="om-totals__discount-value">
                      – ₺{discount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                      {canDiscount && <button
                        className="om-totals__discount-remove"
                        title="İndirimi kaldır"
                        onClick={() => onSetDiscount?.(table.id, null)}
                      >✕</button>}
                    </span>
                  </div>
                )}
                {canDiscount && discount === 0 && !discountEditorOpen && (
                  <button className="om-totals__add-discount" onClick={() => setDiscountEditorOpen(true)}>
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
                <div className="om-totals__row om-totals__row--total">
                  <span>Toplam</span>
                  <strong>₺{total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</strong>
                </div>
              </div>
            )}

            {selectionMode ? (
              <div className="om-transfer-bar">
                <div className="om-transfer-bar__info">
                  <span className="om-transfer-bar__label">SEÇİLEN</span>
                  <span className="om-transfer-bar__count">{selectedItemIds.size} ürün</span>
                </div>
                <button className="om-new-group-btn" onClick={exitTransferMode}>Vazgeç</button>
                <button
                  className="btn btn--primary btn--full"
                  disabled={selectedItemIds.size === 0}
                  onClick={openMoveItemsPicker}
                  style={selectedItemIds.size === 0 ? { opacity: 0.45, cursor: 'not-allowed' } : {}}
                >
                  Hedef Masayı Seç
                </button>
              </div>
            ) : (
              <>
                {isOccupied && (
                  <div className="om-transfer-row">
                    <button className="om-secondary-btn" onClick={openMoveTablePicker}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/>
                        <polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/>
                        <line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>
                      </svg>
                      Masayı Taşı
                    </button>
                    <button className="om-secondary-btn" onClick={enterTransferMode}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>
                        <polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
                        <line x1="4" y1="4" x2="9" y2="9"/>
                      </svg>
                      Ürün Taşı
                    </button>
                  </div>
                )}

                <button
                  className="om-new-group-btn"
                  onClick={() => onNewGroup(table.id)}
                >
                  + Yeni Sipariş
                </button>
                {(canClose || isOccupied) && (
                  <div className="om-close-row">
                    {canClose && <button
                      className="btn btn--primary btn--full"
                      disabled={!isOccupied}
                      onClick={onCloseTable}
                      style={!isOccupied ? { opacity: 0.45, cursor: 'not-allowed' } : {}}
                    >
                      Masayı Kapat
                    </button>}
                    {isOccupied && (
                      <PrintButton compact dropUp buildHtml={buildReceiptForPrint} />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── RIGHT: Product picker ── */}
        <div className="om-right">

          <div className="om-picker-header">
            {pickerView === 'products' && (
              <button className="om-cat-back-btn" onClick={handleBackToCategories}>
                ← Kategoriler
              </button>
            )}
            <input
              className="om-picker__search"
              placeholder="Ürün ara..."
              value={search}
              onChange={handleSearchChange}
            />
          </div>

          {/* Category grid view */}
          {pickerView === 'categories' && (
            <div className="om-cat-grid">
              <button
                className="om-cat-tile om-cat-tile--all"
                onClick={() => handleCategorySelect(null)}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                </svg>
                <span className="om-cat-tile__name">Tümü</span>
              </button>

              {categories.map(c => {
                const CatIcon = CATEGORY_ICONS[c.icon] || IconCoffee
                return (
                  <button
                    key={c.id}
                    className="om-cat-tile"
                    style={c.imageUrl
                      ? { backgroundImage: `url(${c.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                      : { backgroundColor: c.color + '22' }
                    }
                    onClick={() => handleCategorySelect(c.id)}
                  >
                    {!c.imageUrl && (
                      <span style={{ color: c.color }}><CatIcon /></span>
                    )}
                    <span className="om-cat-tile__name">{c.name}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Product grid view */}
          {pickerView === 'products' && (
            <div className="om-picker__grid">
              {filteredProducts.map(p => {
                const variants    = productVariants[p.id] ?? []
                const hasVariants = variants.length > 0
                const orderCount  = hasVariants
                  ? orderItems.filter(i => variants.some(v => v.id === i.variantId)).length
                  : orderItems.filter(i => i.productId === p.id && !i.variantId).length
                const inOrder     = orderCount > 0
                const cat         = categories.find(c => c.id === p.categoryId)
                const catColor    = cat?.color ?? '#e8975a'
                const priceLabel  = hasVariants
                  ? `₺${Math.min(...variants.map(v => v.price)).toLocaleString('tr-TR')} +`
                  : `₺${p.price.toLocaleString('tr-TR')}`

                return (
                  <button
                    key={p.id}
                    className={`op-product ${inOrder ? 'op-product--in-order' : ''}`}
                    style={p.imageUrl
                      ? { backgroundImage: `url(${p.imageUrl})` }
                      : { '--product-bg': catColor }
                    }
                    onClick={() => handleProductClick(p)}
                  >
                    {inOrder && (
                      <span className="op-product__badge">{orderCount}×</span>
                    )}
                    {hasVariants && (
                      <span className="op-product__variant-indicator">▾</span>
                    )}
                    <div className="op-product__overlay">
                      <span className="op-product__name">{p.name}</span>
                      <span className="op-product__price">{priceLabel}</span>
                    </div>
                  </button>
                )
              })}
              {filteredProducts.length === 0 && (
                <p className="om-picker__empty">Ürün bulunamadı.</p>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ── Customize modal (variant + modifiers + qty, single combined step) ── */}
      <ItemCustomizeModal
        open={!!customizeModal}
        product={customizeModal?.product}
        variants={customizeModal?.variants || []}
        basePrice={customizeModal?.basePrice}
        initialModifiers={customizeModal?.initialModifiers || []}
        mode={customizeModal?.mode || 'add'}
        onSubmit={handleCustomizeSubmit}
        onClose={() => setCustomizeModal(null)}
      />

      {/* ── Table picker ── */}
      <TablePickerModal
        open={!!tablePicker}
        tables={tables}
        mode={tablePicker?.mode || 'emptyOnly'}
        excludeTableId={table.id}
        title={tablePicker?.mode === 'emptyOnly' ? 'Masayı Taşı' : 'Hedef Masa'}
        subtitle={
          tablePicker?.mode === 'emptyOnly'
            ? 'Boş bir masa seçin'
            : `${tablePicker?.itemIds?.length || 0} ürün → Dolu masa seçin`
        }
        onSelect={handleTablePicked}
        onClose={() => setTablePicker(null)}
      />
    </div>
  )
}

export default OrderPanel
