// Menü resimlerini yüklemeden önce WebP'ye çevirip küçültür.
//
// NEDEN VAR: 3 Ekim 2026'da Supabase'in ücretsiz plan kotası (cached egress)
// aşıldı ve proje kilitlendi. Kaynağı menü resimleriydi: kategori başına
// ~2,4 MB, ürün başına 2 MB'a varan PNG'ler, QR menüyü açan her müşteriye
// indiriliyordu. Mevcut 70 resim elle dönüştürüldü (54,3 MB → 12,9 MB);
// bu modül YENİ yüklemelerin aynı sorunu geri getirmemesi için.
//
// Yeni bağımlılık yok: Chromium (Electron'un renderer'ı) WebP'yi canvas
// üzerinden kodlayabiliyor. Hedef boyutlar QR menüdeki gerçek gösterime göre
// (bkz. yedek/storage-2026-10-04/2-donustur.cjs ile aynı ayarlar).

export const IMAGE_PROFILES = {
  // Kategori kutucuğu telefonda ~173 CSS px kare → 3x ekranda ~520 px
  category: { maxPx: 800, quality: 0.95 },
  // Ürün detay ekranı ~390 CSS px genişlik → 3x ekranda ~1170 px
  product: { maxPx: 1200, quality: 0.9 },
}

// Dosya uzantısından tür — dönüştürme başarısız olursa orijinali doğru
// türle yüklemek için. Eskiden hiç tür verilmiyordu, storage'daki 70
// dosyanın hepsi "application/octet-stream" görünüyordu.
export function contentTypeForName(name) {
  const ext = String(name).split('.').pop().toLowerCase()
  return {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  }[ext] ?? 'application/octet-stream'
}

/**
 * Resmi WebP'ye çevirir. Orijinal zaten hedeften küçükse büyütmez; sonuç
 * orijinalden büyük çıkarsa (küçük, iyi sıkıştırılmış JPEG'lerde olur) null
 * döner — çağıran orijinali yüklemeli.
 *
 * @param {ArrayBuffer|Uint8Array} bytes
 * @param {{maxPx:number, quality:number}} profile
 * @returns {Promise<{blob: Blob, width: number, height: number} | null>}
 */
export async function compressToWebp(bytes, profile) {
  const src = new Blob([bytes])
  // Önce boyutları öğren (EXIF yönü uygulanmış hâliyle — telefon
  // fotoğrafları yan dönmesin).
  const probe = await createImageBitmap(src, { imageOrientation: 'from-image' })
  const { width: w0, height: h0 } = probe
  probe.close?.()

  const scale = Math.min(1, profile.maxPx / Math.max(w0, h0))
  const width = Math.max(1, Math.round(w0 * scale))
  const height = Math.max(1, Math.round(h0 * scale))

  // Küçültmeyi tarayıcının yüksek kaliteli yeniden örneklemesine bırak:
  // tek adımda drawImage ile 4000 → 1200 px küçültmek tırtıklı kenar bırakıyor.
  const bmp = await createImageBitmap(src, {
    imageOrientation: 'from-image',
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: 'high',
  })
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d').drawImage(bmp, 0, 0)
  bmp.close?.()

  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: profile.quality })
  // Bazı ortamlar desteklemediği türde sessizce PNG döndürür — kontrol et
  if (blob.type !== 'image/webp') return null
  const originalSize = bytes.byteLength ?? bytes.length
  if (blob.size >= originalSize) return null
  return { blob, width, height }
}
