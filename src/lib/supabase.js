import { createClient } from '@supabase/supabase-js'

const url        = import.meta.env.VITE_SUPABASE_URL
const key        = import.meta.env.VITE_SUPABASE_ANON_KEY

// Single-window Electron desktop app — navigator.locks cross-tab coordination is unnecessary
// and has been observed to deadlock (getSession hangs → all subsequent auth and PostgREST
// calls block because they wait for the JWT). Pass-through lock disables cross-tab queueing.
const noLock = (_name, _acquireTimeout, fn) => fn()

// supabase is null when env vars are not configured (offline / dev without credentials)
export const supabase = url && key
  ? createClient(url, key, { auth: { lock: noLock } })
  : null
export const isSupabaseReady = !!supabase

if (import.meta.env.DEV) {
  console.log('[Supabase] config', {
    urlHost: url ? new URL(url).host : '(missing)',
    anonKeyPrefix: key ? key.slice(0, 12) + '…' : '(missing)',
    isReady: !!(url && key),
  })
}

// Ayrıcalıklı personel işlemleri "staff-admin" Edge Function'ında yaşar —
// service role key artık uygulama paketine girmez. Fonksiyon, çağıranın
// JWT'sinin admin olduğunu sunucuda doğrular.
async function invokeStaffAdmin(payload) {
  if (!supabase) throw new Error('Supabase yapılandırılmamış. .env dosyasını kontrol edin.')
  const { data, error } = await supabase.functions.invoke('staff-admin', { body: payload })
  if (error) {
    // FunctionsHttpError: sunucunun döndürdüğü Türkçe mesajı yüzeye çıkar
    let msg = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) msg = body.error
    } catch { /* gövde okunamadı — genel mesajla devam */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export async function createStaffUser(email, password, fullName, permissions) {
  const data = await invokeStaffAdmin({ action: 'create', email, password, fullName, permissions })
  return data.uid
}

export async function updateStaffPermissions(supabaseUid, permissions) {
  await invokeStaffAdmin({ action: 'update-permissions', uid: supabaseUid, permissions })
}

export async function deleteStaffUser(supabaseUid) {
  await invokeStaffAdmin({ action: 'delete', uid: supabaseUid })
  // profile auto-deletes via ON DELETE CASCADE
}

export async function listMembers() {
  const data = await invokeStaffAdmin({ action: 'list-members' })
  return data.members
}

export async function setMemberPoints(uid, points) {
  const data = await invokeStaffAdmin({ action: 'set-points', uid, points })
  return data.points
}

export async function deleteMember(uid) {
  await invokeStaffAdmin({ action: 'delete', uid })
}

/**
 * Upload product image bytes to Supabase Storage bucket "products".
 * Returns the public URL of the uploaded file.
 * @param {ArrayBuffer} bytes - Raw image bytes
 * @param {string} filename   - Filename e.g. "1774611379896.png"
 * @returns {Promise<string>} Public URL
 */
export async function deleteProductImage(filename) {
  if (!supabase) return
  const { error } = await supabase.storage.from('product-images').remove([filename])
  if (error) console.error('[Supabase] ✗ Failed to delete image', error)
}

export async function uploadProductImage(bytes, filename) {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase.storage
    .from('product-images')
    .upload(filename, new Blob([bytes]), { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('product-images').getPublicUrl(filename)
  return data.publicUrl
}

export async function uploadCategoryImage(bytes, filename) {
  // Storage RLS politikaları category-images'i de kapsıyor — anon+auth yeterli
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase.storage
    .from('category-images')
    .upload(filename, new Blob([bytes]), { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('category-images').getPublicUrl(filename)
  return data.publicUrl
}

export async function resetSupabaseData() {
  if (!supabase) throw new Error('Supabase not configured')
  // Delete in FK-safe order (children before parents). payment_items and
  // order_item_modifiers reference order_items — skipping them makes every
  // parent delete fail on FK and the reset silently half-completes.
  await supabase.from('payment_items').delete().gte('id', 0)
  await supabase.from('payments').delete().gte('id', 0)
  await supabase.from('order_item_modifiers').delete().gte('id', 0)
  await supabase.from('order_items').delete().gte('id', 0)
  await supabase.from('orders').delete().gte('id', 0)
  await supabase.from('product_modifier_excludes').delete().gte('product_id', 0)
  await supabase.from('modifiers').delete().gte('id', 0)
  await supabase.from('product_variants').delete().gte('id', 0)
  await supabase.from('product_ingredients').delete().gte('id', 0)
  await supabase.from('products').delete().gte('id', 0)
  await supabase.from('categories').delete().gte('id', 0)
  await supabase.from('ingredients').delete().gte('id', 0)
}

