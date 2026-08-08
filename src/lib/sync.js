/**
 * sync.js
 * Pushes locally-created/updated records (is_synced = 0) up to Supabase.
 * Called after network reconnection or on a periodic interval.
 *
 * Only categories and products are synced — table_defs are local-only.
 */

import { supabase, isSupabaseReady, uploadProductImage, uploadCategoryImage } from './supabase.js'
import {
  getUnsyncedCategories, markCategorySynced,
  getUnsyncedProducts,   markProductSynced,
  getUnsyncedOrders,     markOrderSynced,
  getUnsyncedOrderItems,
  upsertCategoryFromRemote, upsertProductFromRemote, upsertIngredientFromRemote,
  upsertModifierFromRemote, upsertProductModifierExcludeFromRemote,
  upsertVariantFromRemote,
  reconcileRemoteDeletions,
  getActiveRemoteOrders, upsertPaymentFromRemote, upsertPaymentItemFromRemote,
  mirrorRemoteOrderStatus, upsertRemoteActiveOrder,
  filterUnknownRemoteOrders, insertRemoteCompletedOrder,
  getAllIngredients, markIngredientSynced,
  getUnsyncedVariants, markVariantSynced,
  getUnsyncedModifiers, markModifierSynced,
  getUnsyncedProductModifierExcludes, markProductModifierExcludeSynced,
  getUnsyncedOrderItemModifiers, markOrderItemModifierSynced,
  getPendingDeletes, clearPendingDelete,
  getCategoryRemoteId,
  getUnsyncedPayments, markPaymentSynced,
  getUnsyncedPaymentItems, markPaymentItemSynced,
  setOrderItemRemoteId,
  persistDb,
} from './localDb.js'

function fmtErr(e) {
  if (!e) return '(boş hata)'
  // Supabase / PostgREST error shape: { code, message, details, hint }
  const parts = []
  if (e.code) parts.push(`code=${e.code}`)
  if (e.message) parts.push(`msg=${e.message}`)
  if (e.details) parts.push(`details=${e.details}`)
  if (e.hint) parts.push(`hint=${e.hint}`)
  if (e.status) parts.push(`status=${e.status}`)
  return parts.length ? parts.join(' | ') : String(e)
}

// Başka cihazlarda kapatılmış satışların geriye dönük çekileceği pencere.
// Raporlar bu aralıktaki mobil satışları da görür; daha eskisi zaten yereldedir.
const COMPLETED_PULL_WINDOW_DAYS = 30

// Supabase'de order_items.name kolonu yok — görünen ad, gömülü ürün/varyant
// ilişkisinden masaüstüyle aynı biçimde ("Ürün (Varyant)") kurulur.
function remoteItemName(oi) {
  const base = oi.products?.name ?? 'Ürün'
  const variant = oi.product_variants?.name
  return variant ? `${base} (${variant})` : base
}

export async function syncToSupabase(log = null) {
  const ok  = (msg) => { console.log(msg);        log?.('success', msg) }
  const inf = (msg) => { console.log(msg);        log?.('info',    msg) }
  const err = (msg, e) => { console.error(msg, fmtErr(e), e); log?.('error',  `${msg} — ${fmtErr(e)}`) }

  if (!isSupabaseReady) {
    inf('[Sync] Supabase yapılandırılmamış — senkronizasyon atlandı')
    return { categories: 0, products: 0, orders: 0, orderItems: 0 }
  }

  let synced = { categories: 0, products: 0, ingredients: 0, variants: 0, orders: 0, orderItems: 0, payments: 0, paymentItems: 0 }

  // Snapshot unsynced counts so we know what we *think* needs pushing before we start
  const _preCats   = getUnsyncedCategories().length
  const _preIngs   = getAllIngredients().filter(i => !i.is_synced).length
  const _preProds  = getUnsyncedProducts().length
  const _preVars   = getUnsyncedVariants().length
  const _preOrders = getUnsyncedOrders().length
  const _preItems  = getUnsyncedOrderItems().length
  const _prePays   = getUnsyncedPayments().length
  const _preDel    = getPendingDeletes().length
  inf(`[Sync] ⇧ push başlıyor — kat:${_preCats} malz:${_preIngs} ürün:${_preProds} varyant:${_preVars} sipariş:${_preOrders} kalem:${_preItems} ödeme:${_prePays} sil:${_preDel}`)

  // ── Pending deletes ────────────────────────────────────────────
  const pendingDeletes = getPendingDeletes()
  for (const pd of pendingDeletes) {
    const tableMap = { product: 'products', category: 'categories', ingredient: 'ingredients', modifier: 'modifiers', variant: 'product_variants', payment: 'payments' }
    const table = tableMap[pd.entity_type]
    if (!table) { await clearPendingDelete(pd.id); continue }
    const { error } = await supabase.from(table).delete().eq('id', pd.remote_id)
    if (!error) {
      await clearPendingDelete(pd.id)
      ok(`[Sync] ✓ Silindi: ${pd.entity_type} remote:${pd.remote_id}`)
    } else if (error.code === '23503' && pd.entity_type === 'product') {
      // Product is referenced by order_items — soft-delete instead of hard delete
      const { error: softErr } = await supabase
        .from('products')
        .update({ is_active: false })
        .eq('id', pd.remote_id)
      if (!softErr) {
        await clearPendingDelete(pd.id)
        ok(`[Sync] ✓ Ürün deaktive edildi (siparişlerde kullanıldığı için): remote:${pd.remote_id}`)
      } else {
        err(`[Sync] ✗ Ürün deaktive edilemedi: remote:${pd.remote_id}`, softErr)
      }
    } else {
      err(`[Sync] ✗ Silinemedi: ${pd.entity_type} remote:${pd.remote_id}`, error)
    }
  }

  // ── Categories ─────────────────────────────────────────────────
  const cats = getUnsyncedCategories()
  for (const [id, name, color, icon, image_url, remoteId] of cats) {
    let supabaseCatImageUrl = image_url
    if (image_url && (image_url.startsWith('app-image://local/') || image_url.startsWith('/products/'))) {
      try {
        const filename = image_url.split('/').pop()
        const bytes = await window.electronAPI?.images?.readFileBytes(image_url)
        if (bytes) {
          supabaseCatImageUrl = await uploadCategoryImage(bytes, filename)
          inf(`[Sync] ↑ Kategori görseli yüklendi: ${filename}`)
        }
      } catch (imgErr) {
        err('[Sync] ✗ Kategori görseli yüklenemedi — görselsiz devam ediliyor', imgErr)
        supabaseCatImageUrl = null
      }
    }
    const catPayload = { name, color, icon, image_url: supabaseCatImageUrl ?? null }
    let data, error
    if (remoteId) {
      // Category already exists in Supabase — UPDATE by remote id so rows
      // pulled from another device never fork into duplicates on edit
      ;({ data, error } = await supabase
        .from('categories')
        .update(catPayload)
        .eq('id', Number(remoteId))
        .select('id')
        .single())
      if (error?.code === 'PGRST116') {
        // Remote row was deleted elsewhere — recreate it via local_id upsert
        ;({ data, error } = await supabase
          .from('categories')
          .upsert({ local_id: String(id), ...catPayload }, { onConflict: 'local_id' })
          .select('id')
          .single())
      }
    } else {
      ;({ data, error } = await supabase
        .from('categories')
        .upsert({ local_id: String(id), ...catPayload }, { onConflict: 'local_id' })
        .select('id')
        .single())
    }

    if (!error && data) {
      await markCategorySynced(id, data.id)
      synced.categories++
      ok(`[Sync] ✓ Kategori: "${name}" (local:${id} → remote:${data.id})`)
    } else if (error) {
      err(`[Sync] ✗ Kategori yüklenemedi: "${name}" (local:${id})`, error)
    } else {
      err(`[Sync] ✗ Kategori beklenmedik yanıt: "${name}" (local:${id}) data=null`, { message: 'data ve error ikisi de boş' })
    }
  }

  // ── Ingredients ────────────────────────────────────────────────
  const allIngredients = getAllIngredients()
  const unsyncedIngredients = allIngredients.filter(i => !i.is_synced)
  for (const ing of unsyncedIngredients) {
    const ingPayload = { name: ing.name, unit: ing.unit, stock_amount: ing.stockAmount, min_stock_alert: ing.minStockAlert, container_name: ing.containerName ?? null, container_size: ing.containerSize ?? 0, image_url: ing.imageUrl ?? null }
    let data, error
    if (ing.remote_id) {
      // Ingredient already exists in Supabase — UPDATE by remote id. Critical:
      // consumeIngredients flags pulled rows unsynced on every sale, and the
      // old local_id upsert re-inserted them as duplicates each time.
      ;({ data, error } = await supabase
        .from('ingredients')
        .update(ingPayload)
        .eq('id', Number(ing.remote_id))
        .select('id')
        .single())
      if (error?.code === 'PGRST116') {
        ;({ data, error } = await supabase
          .from('ingredients')
          .upsert({ local_id: String(ing.id), ...ingPayload }, { onConflict: 'local_id' })
          .select('id')
          .single())
      }
    } else {
      ;({ data, error } = await supabase
        .from('ingredients')
        .upsert({ local_id: String(ing.id), ...ingPayload }, { onConflict: 'local_id' })
        .select('id')
        .single())
    }

    if (!error && data) {
      await markIngredientSynced(ing.id, data.id)
      synced.ingredients++
      ok(`[Sync] ✓ Malzeme: "${ing.name}" (local:${ing.id} → remote:${data.id})`)
    } else if (error) {
      err('[Sync] ✗ Malzeme yüklenemedi', error)
    }
  }

  // ── Products ───────────────────────────────────────────────────
  const prods = getUnsyncedProducts()
  for (const [id, name, price, stock, category_id, image_url, recipe, points_value, remoteId] of prods) {
    let supabaseImageUrl = image_url
    if (image_url && (image_url.startsWith('app-image://local/') || image_url.startsWith('/products/'))) {
      try {
        const filename = image_url.split('/').pop()
        const bytes = await window.electronAPI?.images?.readFileBytes(image_url)
        if (bytes) {
          supabaseImageUrl = await uploadProductImage(bytes, filename)
          inf(`[Sync] ↑ Görsel yüklendi: ${filename}`)
        }
      } catch (imgErr) {
        err('[Sync] ✗ Görsel yüklenemedi — görselsiz devam ediliyor', imgErr)
        supabaseImageUrl = null
      }
    }

    const remoteCatId = getCategoryRemoteId(category_id)
    if (!remoteCatId) {
      console.warn(`[Sync] ⚠ Ürün "${name}" (local:${id}) için kategori henüz yüklenmemiş — category_id null gönderiliyor (local cat:${category_id}). FK varsa Supabase reddedebilir.`)
    }
    let data, error

    if (remoteId) {
      // Product already exists in Supabase — UPDATE by remote id to avoid creating duplicates
      // when local_id doesn't match (e.g. product was created in Supabase dashboard)
      ;({ data, error } = await supabase
        .from('products')
        .update({ name, price, stock, category_id: remoteCatId ? Number(remoteCatId) : null, image_url: supabaseImageUrl, recipe, points_value: points_value ?? 0 })
        .eq('id', Number(remoteId))
        .select('id')
        .single())
      if (error?.code === 'PGRST116') {
        // Remote row was deleted elsewhere — recreate it via local_id upsert
        ;({ data, error } = await supabase
          .from('products')
          .upsert(
            { local_id: String(id), name, price, stock, category_id: remoteCatId ? Number(remoteCatId) : null, image_url: supabaseImageUrl, recipe, points_value: points_value ?? 0 },
            { onConflict: 'local_id' }
          )
          .select('id')
          .single())
      }
    } else {
      // New product — upsert by local_id
      ;({ data, error } = await supabase
        .from('products')
        .upsert(
          { local_id: String(id), name, price, stock, category_id: remoteCatId ? Number(remoteCatId) : null, image_url: supabaseImageUrl, recipe, points_value: points_value ?? 0 },
          { onConflict: 'local_id' }
        )
        .select('id')
        .single())
    }

    if (!error && data) {
      await markProductSynced(id, data.id)
      synced.products++
      ok(`[Sync] ✓ Ürün: "${name}" ₺${price} (local:${id} → remote:${data.id})`)
    } else if (error) {
      err(`[Sync] ✗ Ürün yüklenemedi: "${name}" (local:${id}, remoteCat:${remoteCatId ?? 'null'})`, error)
    } else {
      err(`[Sync] ✗ Ürün beklenmedik yanıt: "${name}" (local:${id}) data=null`, { message: 'data ve error ikisi de boş' })
    }
  }

  // ── Product Variants ───────────────────────────────────────────
  const variants = getUnsyncedVariants()
  for (const [id, remoteId, product_remote_id, name, price] of variants) {
    if (!product_remote_id) continue
    let data, error
    if (remoteId) {
      ;({ data, error } = await supabase
        .from('product_variants')
        .update({ product_id: Number(product_remote_id), name, price })
        .eq('id', Number(remoteId))
        .select('id')
        .single())
      if (error?.code === 'PGRST116') {
        ;({ data, error } = await supabase
          .from('product_variants')
          .upsert(
            { local_id: String(id), product_id: Number(product_remote_id), name, price },
            { onConflict: 'local_id' }
          )
          .select('id')
          .single())
      }
    } else {
      ;({ data, error } = await supabase
        .from('product_variants')
        .upsert(
          { local_id: String(id), product_id: Number(product_remote_id), name, price },
          { onConflict: 'local_id' }
        )
        .select('id')
        .single())
    }
    if (!error && data) {
      await markVariantSynced(id, data.id)
      synced.variants++
      ok(`[Sync] ✓ Varyant: "${name}" ₺${price} (local:${id} → remote:${data.id})`)
    } else if (error) {
      err('[Sync] ✗ Varyant yüklenemedi', error)
    }
  }

  // ── Modifiers ──────────────────────────────────────────────────
  // Each modifier belongs to EITHER a category OR a product (CHECK
  // constraint enforces). Skip rows whose parent isn't synced yet —
  // they'll be pushed on the next pass once the parent has a remote_id.
  const mods = getUnsyncedModifiers()
  for (const [id, local_id, category_id, product_id, name, price_delta, sort_order, is_active, mod_remote_id, category_remote_id, product_remote_id] of mods) {
    if (category_id != null && !category_remote_id) continue
    if (product_id  != null && !product_remote_id)  continue
    const modPayload = {
      category_id: category_remote_id ? Number(category_remote_id) : null,
      product_id:  product_remote_id  ? Number(product_remote_id)  : null,
      name,
      price_delta,
      sort_order,
      is_active: !!is_active,
    }
    let data, error
    if (mod_remote_id) {
      // Pulled modifiers carry a different local_id than the remote row —
      // UPDATE by remote id so edits never fork into duplicates
      ;({ data, error } = await supabase
        .from('modifiers')
        .update(modPayload)
        .eq('id', Number(mod_remote_id))
        .select('id')
        .single())
      if (error?.code === 'PGRST116') {
        ;({ data, error } = await supabase
          .from('modifiers')
          .upsert({ local_id, ...modPayload }, { onConflict: 'local_id' })
          .select('id')
          .single())
      }
    } else {
      ;({ data, error } = await supabase
        .from('modifiers')
        .upsert({ local_id, ...modPayload }, { onConflict: 'local_id' })
        .select('id')
        .single())
    }
    if (!error && data) {
      await markModifierSynced(id, data.id)
      ok(`[Sync] ✓ Modifier: "${name}" ₺${price_delta} (local:${id} → remote:${data.id})`)
    } else if (error) {
      err(`[Sync] ✗ Modifier yüklenemedi: "${name}"`, error)
    }
  }

  // ── Product modifier excludes ─────────────────────────────────
  // Junction (product_id, modifier_id) — both must have remote_ids.
  const exRows = getUnsyncedProductModifierExcludes()
  const exPayload = []
  const exKeys = []
  for (const [product_id, modifier_id, product_remote_id, modifier_remote_id] of exRows) {
    if (!product_remote_id || !modifier_remote_id) continue
    exPayload.push({
      product_id:  Number(product_remote_id),
      modifier_id: Number(modifier_remote_id),
    })
    exKeys.push([product_id, modifier_id])
  }
  if (exPayload.length > 0) {
    const { error } = await supabase
      .from('product_modifier_excludes')
      .upsert(exPayload, { onConflict: 'product_id,modifier_id', ignoreDuplicates: true })
    if (!error) {
      for (const [pid, mid] of exKeys) await markProductModifierExcludeSynced(pid, mid)
      ok(`[Sync] ✓ Modifier-exclude: ${exPayload.length} satır`)
    } else {
      err('[Sync] ✗ Modifier-exclude yüklenemedi', error)
    }
  }

  // ── Orders ─────────────────────────────────────────────────────
  const orders = getUnsyncedOrders()
  for (const [id, local_id, table_id, status, payment_method, total, created_at, closed_at, waiter_name, discount, remoteId] of orders) {
    // Active (materialized) orders have closed_at = '' locally — send null
    const orderPayload = {
      table_id, status,
      payment_method: payment_method || null,
      total, created_at,
      closed_at: closed_at || null,
      waiter_name: waiter_name ?? null,
      discount: Number(discount) || 0,
    }
    let data, error
    if (remoteId) {
      // Order already exists in Supabase (QR order or previously-pushed
      // partial-payment order) — UPDATE by remote id, never re-insert
      ;({ data, error } = await supabase
        .from('orders')
        .update(orderPayload)
        .eq('id', Number(remoteId))
        .select('id')
        .single())
      if (error?.code === 'PGRST116') {
        ;({ data, error } = await supabase
          .from('orders')
          .upsert({ local_id, ...orderPayload }, { onConflict: 'local_id' })
          .select('id')
          .single())
      }
    } else {
      ;({ data, error } = await supabase
        .from('orders')
        .upsert({ local_id, ...orderPayload }, { onConflict: 'local_id' })
        .select('id')
        .single())
    }

    if (!error && data) {
      await markOrderSynced(id, data.id)
      synced.orders++
      ok(`[Sync] ✓ Sipariş: ₺${total} | ${payment_method} | ${status} (remote:${data.id})`)
      if (status === 'active' && table_id != null) {
        // Fire-and-forget — a table just gained an active order, flip it to
        // occupied on Supabase without blocking the rest of the push queue.
        void supabase.from('tables').update({ status: 'occupied' }).eq('id', table_id)
          .then(() => {}).catch(() => {})
      }
    } else if (error) {
      err('[Sync] ✗ Sipariş yüklenemedi', error)
    }
  }

  // ── Order items ────────────────────────────────────────────────
  const items = getUnsyncedOrderItems()
  for (const [id, local_id, order_remote_id, quantity, unit_price, product_remote_id, variant_remote_id, note, added_at, item_remote_id] of items) {
    if (!order_remote_id) continue

    const itemPayload = {
      order_id: order_remote_id, quantity, unit_price,
      product_id: product_remote_id ? Number(product_remote_id) : null,
      variant_id: variant_remote_id ? Number(variant_remote_id) : null,
      note: note ?? null,
      added_at: added_at ?? null,
    }
    let data, error
    if (item_remote_id) {
      // Item already exists remotely (QR item edited on desktop) — UPDATE by
      // remote id; upserting by our local_id would fork a duplicate row
      ;({ data, error } = await supabase
        .from('order_items')
        .update(itemPayload)
        .eq('id', Number(item_remote_id))
        .select('id')
        .single())
      if (error?.code === 'PGRST116') {
        ;({ data, error } = await supabase
          .from('order_items')
          .upsert({ local_id, ...itemPayload }, { onConflict: 'local_id' })
          .select('id')
          .single())
      }
    } else {
      ;({ data, error } = await supabase
        .from('order_items')
        .upsert({ local_id, ...itemPayload }, { onConflict: 'local_id' })
        .select('id')
        .single())
    }

    if (!error && data) {
      await setOrderItemRemoteId(id, data.id)
      synced.orderItems++
      ok(`[Sync] ✓ Sipariş kalemi: ${quantity}× ₺${unit_price}${note ? ' (' + note + ')' : ''} → sipariş:${order_remote_id} (remote:${data.id})`)
    } else if (error) {
      err('[Sync] ✗ Sipariş kalemi yüklenemedi', error)
    }
  }

  // ── Order item modifiers ──────────────────────────────────────
  // Each row attaches to a specific order_items row. Skip until that
  // parent item has been pushed (and thus has a remote_id).
  const itemMods = getUnsyncedOrderItemModifiers()
  for (const [oimId, oim_local_id, order_item_remote_id, modifier_remote_id, mod_name, mod_price_delta, mod_quantity] of itemMods) {
    if (!order_item_remote_id) continue
    const { data, error } = await supabase
      .from('order_item_modifiers')
      .upsert(
        {
          local_id: oim_local_id,
          order_item_id: Number(order_item_remote_id),
          modifier_id: modifier_remote_id ? Number(modifier_remote_id) : null,
          name: mod_name,
          price_delta: mod_price_delta,
          quantity: mod_quantity,
        },
        { onConflict: 'local_id' }
      )
      .select('id')
      .single()
    if (!error && data) {
      await markOrderItemModifierSynced(oimId, data.id)
      ok(`[Sync] ✓ Sipariş-modifier: "${mod_name}" ×${mod_quantity} → kalem:${order_item_remote_id} (remote:${data.id})`)
    } else if (error) {
      err('[Sync] ✗ Sipariş-modifier yüklenemedi', error)
    }
  }

  // ── Payments ──────────────────────────────────────────────────
  const payments = getUnsyncedPayments()
  for (const [id, local_id, order_remote_id, amount, payment_method, payer_label, processed_by, device, created_at] of payments) {
    if (!order_remote_id) continue
    const { data, error } = await supabase
      .from('payments')
      .upsert(
        { local_id, order_id: Number(order_remote_id), amount, payment_method,
          payer_label: payer_label || null,
          processed_by: processed_by || null,
          device: device || 'desktop',
          created_at: created_at || new Date().toISOString() },
        { onConflict: 'local_id' }
      )
      .select('id')
      .single()
    if (!error && data) {
      await markPaymentSynced(id, data.id)
      synced.payments++
      ok(`[Sync] ✓ Ödeme: ₺${amount} ${payment_method} → sipariş:${order_remote_id} (remote:${data.id})`)
    } else if (error) {
      err('[Sync] ✗ Ödeme yüklenemedi', error)
    }
  }

  // ── Payment items (junction) ──────────────────────────────────
  // Each row already has BOTH a payment.remote_id AND an order_item.remote_id at this point
  // because payments + order_items were just pushed above.
  const paymentItems = getUnsyncedPaymentItems()
  const junctionPayload = []
  const junctionIds = []
  for (const [pid, payment_remote_id, order_item_remote_id /* , raw_payment_id, raw_order_item_id */] of paymentItems) {
    if (!payment_remote_id || !order_item_remote_id) continue
    junctionPayload.push({
      payment_id: Number(payment_remote_id),
      order_item_id: Number(order_item_remote_id),
    })
    junctionIds.push(pid)
  }
  if (junctionPayload.length > 0) {
    const { error } = await supabase
      .from('payment_items')
      .upsert(junctionPayload, { onConflict: 'order_item_id', ignoreDuplicates: true })
    if (!error) {
      for (const pid of junctionIds) await markPaymentItemSynced(pid)
      synced.paymentItems += junctionPayload.length
      ok(`[Sync] ✓ Ödeme-kalem eşleşmesi: ${junctionPayload.length} satır`)
    } else {
      err('[Sync] ✗ Ödeme-kalem eşleşmesi yüklenemedi', error)
    }
  }

  await persistDb()

  const anyWork = synced.categories + synced.products + synced.ingredients + synced.variants
                + synced.orders + synced.orderItems + synced.payments + synced.paymentItems
  if (anyWork > 0) {
    inf(`[Sync] ── Yükleme tamamlandı ── kat:${synced.categories} ürün:${synced.products} malz:${synced.ingredients} varyant:${synced.variants} sipariş:${synced.orders} kalem:${synced.orderItems} ödeme:${synced.payments} öd-kalem:${synced.paymentItems}`)
  } else {
    inf('[Sync] Yüklenecek yeni kayıt yok')
  }
  return synced
}

export async function pullFromSupabase(log = null) {
  const ok  = (msg) => { console.log(msg);        log?.('success', msg) }
  const err = (msg, e) => { console.error(msg, fmtErr(e), e); log?.('error',  `${msg} — ${fmtErr(e)}`) }

  if (!isSupabaseReady) {
    log?.('info', '[Sync] Supabase yapılandırılmamış — çekme atlandı')
    return { discoveredActiveOrderIds: [] }
  }

  const pendingDeletes = getPendingDeletes()
  const pendingCatIds  = new Set(pendingDeletes.filter(p => p.entity_type === 'category').map(p => p.remote_id))
  const pendingProdIds = new Set(pendingDeletes.filter(p => p.entity_type === 'product').map(p => p.remote_id))
  const pendingIngIds  = new Set(pendingDeletes.filter(p => p.entity_type === 'ingredient').map(p => p.remote_id))

  // ── Pull categories ────────────────────────────────────────────
  const { data: cats, error: catErr } = await supabase
    .from('categories')
    .select('id, name, color, icon, image_url')

  if (catErr) {
    err('[Sync] ✗ Kategoriler çekilemedi', catErr)
  } else if (cats) {
    for (const c of cats) {
      if (pendingCatIds.has(c.id)) continue
      await upsertCategoryFromRemote({ remoteId: c.id, name: c.name, color: c.color, icon: c.icon, imageUrl: c.image_url ?? null })
    }
    const gone = reconcileRemoteDeletions('category', cats.map(c => c.id))
    if (gone) ok(`[Sync] ↓ ${gone} kategori uzakta silinmişti — lokalden kaldırıldı`)
    await persistDb()
    ok(`[Sync] ↓ ${cats.length} kategori çekildi`)
    // Warm the offline image cache in the background (fire-and-forget)
    for (const c of cats) {
      if (c.image_url?.startsWith('http')) window.electronAPI?.images?.cacheRemote(c.image_url)
    }
  }

  // ── Pull ingredients ───────────────────────────────────────────
  const { data: ings, error: ingErr } = await supabase
    .from('ingredients')
    .select('id, name, unit, stock_amount, min_stock_alert')

  if (ingErr) {
    err('[Sync] ✗ Malzemeler çekilemedi', ingErr)
  } else if (ings) {
    for (const ing of ings) {
      if (pendingIngIds.has(ing.id)) continue
      await upsertIngredientFromRemote({
        remoteId:      ing.id,
        name:          ing.name,
        unit:          ing.unit,
        stockAmount:   ing.stock_amount,
        minStockAlert: ing.min_stock_alert,
      })
    }
    const gone = reconcileRemoteDeletions('ingredient', ings.map(i => i.id))
    if (gone) ok(`[Sync] ↓ ${gone} malzeme uzakta silinmişti — lokalden kaldırıldı`)
    await persistDb()
    ok(`[Sync] ↓ ${ings.length} malzeme çekildi`)
  }

  // ── Pull products ──────────────────────────────────────────────
  const { data: prods, error: prodErr } = await supabase
    .from('products')
    .select('id, name, price, stock, category_id, image_url, points_value')
    .eq('is_active', true)

  if (prodErr) {
    err('[Sync] ✗ Ürünler çekilemedi', prodErr)
  } else if (prods) {
    for (const p of prods) {
      if (pendingProdIds.has(p.id)) continue
      await upsertProductFromRemote({
        remoteId: p.id,
        name: p.name,
        price: p.price,
        stock: p.stock,
        remoteCatId: p.category_id,
        imageUrl: p.image_url,
        pointsValue: p.points_value ?? 0,
      })
    }
    // Also removes products deactivated remotely (pull filters is_active=true)
    const gone = reconcileRemoteDeletions('product', prods.map(p => p.id))
    if (gone) ok(`[Sync] ↓ ${gone} ürün uzakta silinmişti — lokalden kaldırıldı`)
    await persistDb()
    ok(`[Sync] ↓ ${prods.length} ürün çekildi`)
    // Warm the offline image cache in the background (fire-and-forget)
    for (const p of prods) {
      if (p.image_url?.startsWith('http')) window.electronAPI?.images?.cacheRemote(p.image_url)
    }
  }

  // ── Pull product variants ──────────────────────────────────────
  // Must run after products (parent FK) and before modifiers so a fresh
  // install receives the full menu incl. variant pricing in one pass.
  const pendingVarIds = new Set(pendingDeletes.filter(p => p.entity_type === 'variant').map(p => p.remote_id))
  const { data: vars, error: varErr } = await supabase
    .from('product_variants')
    .select('id, local_id, product_id, name, price')
  if (varErr) {
    err('[Sync] ✗ Varyantlar çekilemedi', varErr)
  } else if (vars) {
    let pulled = 0
    for (const v of vars) {
      if (pendingVarIds.has(v.id)) continue
      const done = await upsertVariantFromRemote({
        remoteId: v.id,
        remoteProductId: v.product_id,
        localId: v.local_id,
        name: v.name,
        price: v.price,
      })
      if (done) pulled++
    }
    const gone = reconcileRemoteDeletions('variant', vars.map(v => v.id))
    if (gone) ok(`[Sync] ↓ ${gone} varyant uzakta silinmişti — lokalden kaldırıldı`)
    await persistDb()
    ok(`[Sync] ↓ ${pulled}/${vars.length} varyant çekildi`)
  }

  // ── Pull modifiers ─────────────────────────────────────────────
  const { data: mods, error: modErr } = await supabase
    .from('modifiers')
    .select('id, category_id, product_id, name, price_delta, sort_order, is_active')
  if (modErr) {
    err('[Sync] ✗ Modifier\'lar çekilemedi', modErr)
  } else if (mods) {
    for (const m of mods) {
      await upsertModifierFromRemote({
        remoteId: m.id,
        remoteCategoryId: m.category_id,
        remoteProductId: m.product_id,
        name: m.name,
        priceDelta: m.price_delta,
        sortOrder: m.sort_order ?? 0,
        isActive: m.is_active !== false,
      })
    }
    const gone = reconcileRemoteDeletions('modifier', mods.map(m => m.id))
    if (gone) ok(`[Sync] ↓ ${gone} modifier uzakta silinmişti — lokalden kaldırıldı`)
    await persistDb()
    ok(`[Sync] ↓ ${mods.length} modifier çekildi`)
  }

  // ── Pull product modifier excludes ─────────────────────────────
  const { data: exs, error: exErr } = await supabase
    .from('product_modifier_excludes')
    .select('product_id, modifier_id')
  if (exErr) {
    err('[Sync] ✗ Modifier-exclude çekilemedi', exErr)
  } else if (exs) {
    for (const e of exs) {
      await upsertProductModifierExcludeFromRemote({
        remoteProductId: e.product_id,
        remoteModifierId: e.modifier_id,
      })
    }
    await persistDb()
    ok(`[Sync] ↓ ${exs.length} modifier-exclude çekildi`)
  }

  // ── Pull payments + order status for active shared orders ──────
  // Split payments made on another device (mobile) attach to the same
  // Supabase order — pull them so the desktop marks those items paid, and
  // mirror orders that were completed/cancelled elsewhere.
  const activeRemote = getActiveRemoteOrders()
  if (activeRemote.length > 0) {
    const remoteOrderIds = activeRemote.map(o => Number(o.remoteId))
    const localByRemote = new Map(activeRemote.map(o => [String(o.remoteId), o.id]))

    const { data: remoteOrders, error: roErr } = await supabase
      .from('orders')
      .select('id, status, payment_method, closed_at')
      .in('id', remoteOrderIds)
    if (roErr) {
      err('[Sync] ✗ Aktif sipariş durumları çekilemedi', roErr)
    } else if (remoteOrders) {
      for (const ro of remoteOrders) {
        if (ro.status && ro.status !== 'active' && ro.status !== 'pending') {
          await mirrorRemoteOrderStatus(localByRemote.get(String(ro.id)), {
            status: ro.status,
            paymentMethod: ro.payment_method ?? null,
            closedAt: ro.closed_at ?? null,
          })
          ok(`[Sync] ↓ Sipariş uzakta ${ro.status === 'completed' ? 'kapatılmış' : 'iptal edilmiş'} — yerelde de işaretlendi (remote:${ro.id})`)
        }
      }
    }

    const { data: pays, error: payErr } = await supabase
      .from('payments')
      .select('id, local_id, order_id, amount, payment_method, payer_label, processed_by, device, created_at')
      .in('order_id', remoteOrderIds)
    if (payErr) {
      err('[Sync] ✗ Ödemeler çekilemedi', payErr)
    } else if (pays && pays.length > 0) {
      let added = 0
      for (const p of pays) {
        const localOrderId = localByRemote.get(String(p.order_id))
        if (localOrderId == null) continue
        const isNew = await upsertPaymentFromRemote({
          remoteId: p.id,
          localId: p.local_id ?? null,
          localOrderId,
          amount: p.amount,
          paymentMethod: p.payment_method,
          payerLabel: p.payer_label ?? null,
          processedBy: p.processed_by ?? null,
          device: p.device ?? 'remote',
          createdAt: p.created_at ?? null,
        })
        if (isNew) added++
      }
      const { data: pis, error: piErr } = await supabase
        .from('payment_items')
        .select('payment_id, order_item_id')
        .in('payment_id', pays.map(p => p.id))
      if (piErr) {
        err('[Sync] ✗ Ödeme-kalem eşleşmeleri çekilemedi', piErr)
      } else {
        for (const pi of (pis ?? [])) {
          upsertPaymentItemFromRemote({ remotePaymentId: pi.payment_id, remoteOrderItemId: pi.order_item_id })
        }
      }
      await persistDb()
      if (added > 0) ok(`[Sync] ↓ ${added} ödeme çekildi (diğer cihazlardan)`)
    }
  }

  // ── Pull ALL active orders (whole-order live sync) ─────────────
  // Covers every active order sitting at a table on Supabase, not just the
  // ones already known locally (getActiveRemoteOrders above) — this is how a
  // table opened by another device (QR, mobile, another desktop) shows up
  // here without a restart. upsertRemoteActiveOrder is idempotent and safe
  // to call for orders already known too.
  const discoveredActiveOrderIds = []
  // NOTE: Supabase'in orders tablosunda `table_name` YOKTUR (o kolon yalnızca
  // bu cihazın lokal SQLite şemasında var). Onu select etmek PostgREST'te
  // 400/42703 verip TÜM isteği reddediyordu — mobilde açılan hiçbir masa bu
  // yüzden masaüstüne inmiyordu. Masa adı table_id'den yerelde çözülür.
  // Ürün/varyant adları da Supabase'de order_items üzerinde tutulmadığı için
  // gömülü ilişkiden (products/product_variants) okunur.
  const { data: liveOrders, error: liveErr } = await supabase
    .from('orders')
    .select(`
      id, local_id, table_id, total, discount, waiter_name, created_at, status,
      order_items (
        id, local_id, product_id, variant_id, quantity, unit_price, note, added_at,
        products ( name ),
        product_variants ( name ),
        order_item_modifiers ( id, modifier_id, name, price_delta, quantity )
      )
    `)
    .eq('status', 'active')
    .not('table_id', 'is', null)

  if (liveErr) {
    err('[Sync] ✗ Aktif masalar çekilemedi', liveErr)
  } else if (liveOrders) {
    let touched = 0
    for (const o of liveOrders) {
      const { inserted, localOrderId, addedItemIds } = await upsertRemoteActiveOrder({
        remoteId: o.id,
        localId: o.local_id,
        tableId: o.table_id,
        tableName: null, // yerelde table_id'den çözülür
        waiterName: o.waiter_name ?? null,
        total: o.total,
        discount: o.discount,
        createdAt: o.created_at,
        items: (o.order_items ?? []).map(oi => ({
          remoteId: oi.id,
          localId: oi.local_id,
          productRemoteId: oi.product_id,
          variantRemoteId: oi.variant_id,
          name: remoteItemName(oi),
          quantity: oi.quantity,
          unitPrice: oi.unit_price,
          note: oi.note,
          addedAt: oi.added_at,
          modifiers: (oi.order_item_modifiers ?? []).map(m => ({
            remoteId: m.id,
            modifierRemoteId: m.modifier_id,
            name: m.name,
            priceDelta: m.price_delta,
            quantity: m.quantity,
          })),
        })),
      })
      discoveredActiveOrderIds.push(localOrderId)
      if (inserted || addedItemIds.length > 0) touched++
    }
    if (touched > 0) ok(`[Sync] ↓ ${touched} aktif sipariş eklendi/güncellendi (canlı senkron)`)
  }

  // ── Pull completed orders this device never saw ────────────────
  // Mobilde hem açılıp hem kapatılan satışlar (bu cihaz kapalıyken ya da iki
  // tur arasında) yukarıdaki aktif-sipariş yoluna hiç düşmez ve raporlarda
  // eksik kalırdı — ciro, ödeme dağılımı ve personel performansı yanlış olurdu.
  // Önce hafif bir id listesi çekilir, yalnızca yerelde bilinmeyenler
  // tam olarak indirilir; böylece her turda tüm geçmiş yeniden çekilmez.
  const since = new Date(Date.now() - COMPLETED_PULL_WINDOW_DAYS * 86400_000).toISOString()
  const { data: doneIdRows, error: doneIdErr } = await supabase
    .from('orders')
    .select('id, local_id')
    .eq('status', 'completed')
    .gte('closed_at', since)

  if (doneIdErr) {
    err('[Sync] ✗ Kapanan siparişler listelenemedi', doneIdErr)
  } else {
    const unknownIds = filterUnknownRemoteOrders(doneIdRows ?? [])
    if (unknownIds.length > 0) {
      const { data: doneOrders, error: doneErr } = await supabase
        .from('orders')
        .select(`
          id, local_id, table_id, total, discount, payment_method, waiter_name,
          created_at, closed_at,
          order_items (
            id, local_id, product_id, variant_id, quantity, unit_price, note, added_at,
            products ( name ),
            product_variants ( name ),
            order_item_modifiers ( id, modifier_id, name, price_delta, quantity )
          ),
          payments ( id, local_id, amount, payment_method, payer_label, processed_by, device, created_at )
        `)
        .in('id', unknownIds)

      if (doneErr) {
        err('[Sync] ✗ Kapanan siparişler çekilemedi', doneErr)
      } else {
        let added = 0
        for (const o of (doneOrders ?? [])) {
          await insertRemoteCompletedOrder({
            remoteId: o.id,
            localId: o.local_id,
            tableId: o.table_id,
            waiterName: o.waiter_name ?? null,
            total: o.total,
            discount: o.discount,
            paymentMethod: o.payment_method ?? null,
            createdAt: o.created_at,
            closedAt: o.closed_at,
            items: (o.order_items ?? []).map(oi => ({
              remoteId: oi.id,
              localId: oi.local_id,
              productRemoteId: oi.product_id,
              variantRemoteId: oi.variant_id,
              name: remoteItemName(oi),
              quantity: oi.quantity,
              unitPrice: oi.unit_price,
              note: oi.note,
              addedAt: oi.added_at,
              modifiers: (oi.order_item_modifiers ?? []).map(m => ({
                remoteId: m.id,
                modifierRemoteId: m.modifier_id,
                name: m.name,
                priceDelta: m.price_delta,
                quantity: m.quantity,
              })),
            })),
            payments: (o.payments ?? []).map(p => ({
              remoteId: p.id,
              localId: p.local_id,
              amount: p.amount,
              paymentMethod: p.payment_method,
              payerLabel: p.payer_label,
              processedBy: p.processed_by,
              device: p.device,
              createdAt: p.created_at,
            })),
          })
          added++
        }
        if (added > 0) ok(`[Sync] ↓ ${added} kapanan satış çekildi (diğer cihazlardan)`)
      }
    }
  }

  return { discoveredActiveOrderIds }
}
