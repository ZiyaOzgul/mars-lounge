/**
 * permissions.js
 * Tek doğruluk kaynağı: personel izin anahtarları + denetim yardımcıları.
 * Staff sayfası bu tanımlardan düzenleme arayüzünü üretir; Navbar/rotalar
 * ve eylem butonları hasPerm() ile denetler. role === 'admin' her şeyi geçer.
 */

export const PERMISSION_GROUPS = [
  {
    label: 'Sayfalar',
    items: [
      { key: 'tables',        label: 'Masalar',            desc: 'Masa görüntüleme ve yönetimi' },
      { key: 'orders',        label: 'Siparişler',         desc: 'Sipariş geçmişini görüntüle' },
      { key: 'closed_tables', label: 'Kapananlar',         desc: 'Kapanan masaları görüntüle' },
      { key: 'products_view', label: 'Ürünleri Görüntüle', desc: 'Ürün listesine erişim' },
      { key: 'products_edit', label: 'Ürünleri Düzenle',   desc: 'Ürün ekle, güncelle, sil' },
      { key: 'ingredients',   label: 'Malzemeler',         desc: 'Malzeme/stok sayfasına erişim' },
      { key: 'reports',       label: 'Raporlar',           desc: 'Satış ve performans raporları' },
      { key: 'settings',      label: 'Ayarlar',            desc: 'Sistem ayarlarına erişim' },
    ],
  },
  {
    label: 'İşlemler',
    items: [
      { key: 'close_table',    label: 'Masa Kapat / Ödeme Al', desc: 'Hesap al ve masayı kapat' },
      { key: 'apply_discount', label: 'İndirim Uygula',        desc: 'Sipariş üzerine indirim ekle' },
      { key: 'cancel_order',   label: 'Sipariş İptal',         desc: 'Aktif siparişi iptal et' },
      { key: 'reopen_table',   label: 'Masa Yeniden Aç',       desc: 'Kapanan masayı geri açabilir (Düzeltme / Yeni Sipariş)' },
    ],
  },
]

export const DEFAULT_PERMISSIONS = {
  tables: true, orders: true, closed_tables: true,
  products_view: true, products_edit: false, ingredients: true,
  reports: false, settings: false,
  close_table: true, apply_discount: false, cancel_order: false, reopen_table: false,
}

export function hasPerm(user, key) {
  if (!user) return false
  if (user.role === 'admin') return true
  return user.permissions?.[key] ?? DEFAULT_PERMISSIONS[key] ?? false
}

// Yetkisiz bir rotaya düşen kullanıcıyı erişebildiği ilk sayfaya yönlendirir.
const ROUTE_ORDER = [
  ['tables', '/'],
  ['orders', '/orders'],
  ['closed_tables', '/closed-tables'],
  ['products_view', '/products'],
  ['ingredients', '/ingredients'],
  ['reports', '/reports'],
  ['settings', '/settings'],
]

export function firstAllowedRoute(user) {
  for (const [key, route] of ROUTE_ORDER) {
    if (hasPerm(user, key)) return route
  }
  return '/'
}
