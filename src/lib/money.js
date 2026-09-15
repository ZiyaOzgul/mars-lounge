/**
 * money.js
 * Para karşılaştırmaları için tek doğru kaynak.
 *
 * Neden ayrı bir dosya: "tamamen ödendi mi?" kararı iki ayrı yerde,
 * iki ayrı sihirli sayıyla veriliyordu — `PaymentModal.jsx` butonun
 * "Tahsil Et" mi "Tahsil & Kapat" mı yazacağına, `orderOperations.js`
 * siparişin kapanıp kapanmayacağına. İkisi de `+ 0.001` kullanıyordu ve
 * ikisinin de aynı kalması hiçbir şeyle garanti altında değildi.
 */

// Kapanışa engel sayılmayacak en büyük fark: 5 kuruş.
//
// Bu bir "borç affı" değil, yuvarlama payı. Gerekçesi iki tane:
//  1. Dolaşımdaki en küçük madenî para 5 kuruş — bunun altındaki bir
//     tutar hiçbir müşterinin ödemeyi kastedebileceği bir miktar değil,
//     ancak hesaplama artığı olabilir.
//  2. Hesabı N kişiye bölerken her parça kuruşa yuvarlanıyor; parçalar
//     aşağı yuvarlanırsa toplam, kişi başına 1 kuruşa kadar eksik
//     kalabiliyor. 5 kuruş, 5 kişiye kadar bölmeyi güvenle karşılıyor.
//
// Eski değer 0,001 TL idi (kuruşun onda biri) — yani üç kişilik bir
// hesapta 2 kuruşluk yuvarlama artığı bile siparişi açık bırakıyor,
// masa da kalıcı olarak dolu görünüyordu.
export const PAYMENT_TOLERANCE = 0.05

/** Ödenen tutar, toplamı yuvarlama payı içinde karşılıyor mu? */
export function isFullyPaid(paid, total) {
  return Number(paid) >= Number(total) - PAYMENT_TOLERANCE
}

/**
 * Kalan borç. Yuvarlama payının altındaki artıklar 0 sayılır, böylece
 * arayüzde "0,00 ₺ kaldı" gibi anlamsız bir satır görünmez.
 */
export function remainingOf(paid, total) {
  const left = Number(total) - Number(paid)
  return left <= PAYMENT_TOLERANCE ? 0 : Math.round(left * 100) / 100
}

/** Tahsilat toplamı sipariş tutarını aşıyor mu? */
export function isOverpaid(paid, total) {
  return Number(paid) > Number(total) + PAYMENT_TOLERANCE
}
