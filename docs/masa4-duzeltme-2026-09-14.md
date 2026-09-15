# Masa 4 — takılı kalmış 7 sipariş (14 Eylül 2026)

## Durum

Masa 4, **20 Ağustos 21:40**'tan beri (580 saat) dolu görünüyordu. Sebep: Supabase'de
`status = 'active'`, `closed_at = null` kalmış 7 sipariş. Bunlar hayalet kayıt değil —
paraları alınmış, `payments` satırları mevcut, hepsi `device = 'desktop'` (kasadan girilmiş,
QR değil).

## Kök neden

`src/lib/orderOperations.js:67`:

```js
const completed = paid + 0.001 >= Number(total)
```

Tolerans 0,001 TL. Ödeme sipariş toplamının bir kuruş altında kalırsa sipariş kapanmıyor,
kapanmayan sipariş masayı sonsuza kadar dolu gösteriyor.

İki ayrı sebep aynı sonucu üretmiş:

| Siparişler | Toplam | Tahsil | Açık kalan | `orders.discount` | Sebep |
|---|---|---|---|---|---|
| 277, 288, 289, 290, 294, 295 | 545,00 | 516,31 | 28,69 (%5,26) | 0 | Ödeme anında indirim uygulanmış, `orders.discount`'a yazılmamış |
| 1596 | 35,00 | 34,57 | 0,43 | 0 | Parçalı ödeme yuvarlama artığı |

Altı Ağustos siparişinin ödemesi 20 Ağustos 23:14'te, 1,5 saniye içinde toplu kaydedilmiş —
tek bir "hepsini kapat" hareketi: para kaydı olmuş, kapanış olmamış.

**Hâlâ canlı:** 1596, 12 Eylül'den — v1.3.2'den sonra.

## Yapılan düzeltme

`closed_at` olarak **paranın alındığı an** kullanıldı (siparişin ilk ödeme kaydının
zamanı), bugün değil. Gerekçe: ciro, paranın gerçekten alındığı güne yazılmalı.
`payment_method` ödemelerden türetildi (hepsi `cash`).

## Geri alma (rollback)

Değişiklik yalnızca `orders` tablosunun 3 alanına dokundu. Geri almak için:

```sql
UPDATE orders SET status = 'active', closed_at = NULL, payment_method = NULL
WHERE id IN (277, 288, 289, 290, 294, 295, 1596);
```

Değişiklik öncesi tam durum (`payments` satırlarına dokunulmadı):

| id | local_id | total | created_at (UTC) | ilk ödeme (UTC) |
|---|---|---|---|---|
| 277 | 6131d0f5-42d5-4ee8-9d4e-7a56516441a3 | 20 | 2026-08-20T18:40:51.139Z | 2026-08-20T20:13:59.906Z |
| 288 | ee840601-49a4-45b0-9032-cb25df9cae95 | 60 | 2026-08-20T19:24:17.246Z | 2026-08-20T20:14:00.193Z |
| 289 | e523a393-1931-4eb3-acaf-7a264d996489 | 60 | 2026-08-20T19:24:23.606Z | 2026-08-20T20:14:00.548Z |
| 290 | 46b9b8d6-fa5a-4a78-b04d-085a6fe4c48c | 350 | 2026-08-20T19:24:31.555Z | 2026-08-20T20:14:00.843Z |
| 294 | d2bcbd80-0eef-4da6-9f52-fece05be9f0a | 20 | 2026-08-20T19:56:21.411Z | 2026-08-20T20:14:01.098Z |
| 295 | e09e04c4-a230-4512-9a7d-aedd5252fe3f | 35 | 2026-08-20T19:56:24.567Z | 2026-08-20T20:14:01.367Z |
| 1596 | b5f6747f-b2fd-4441-80cd-86434f194995 | 35 | 2026-09-12T17:13:02.152Z | 2026-09-12T18:36:36.978Z |

Hepsinde değişiklik öncesi: `status = 'active'`, `closed_at = NULL`,
`payment_method = NULL`, `discount = 0`.

## Neden yalnızca Supabase yetmiyor

`filterUnknownRemoteOrders` (`src/lib/localDb.js:2990`) yerelde zaten var olan bir siparişi
**durumuna bakmadan** "biliniyor" sayıp atlıyor. Bu yüzden uzakta `completed` olan bir
sipariş yerelde `active` kalmaya devam ediyordu ve masalar sayfası (yerel `getAllActiveOrders`
üzerinden çalışıyor) masayı dolu göstermeye devam ederdi.

Bunu kapatmak için senkrona uzlaştırma adımı eklendi: yerelde `active` olan ama uzakta artık
`active` olmayan siparişler, uzaktaki durum ve `closed_at` ile yerelde de kapatılıyor.
Bu aynı zamanda "başka cihazda kapatılan sipariş burada açık kalıyor" boşluğunu genel
olarak da kapatıyor.

## Kapanmayan iş

- **Tolerans hâlâ 0,001 TL.** Kuruş altı artık yüzünden masa takılması tekrar olabilir.
- **Ödeme anındaki indirim `orders.discount`'a yazılmıyor.** 20 Ağustos vakasının asıl sebebi bu.

İkisi de para mantığına dokunuyor; ayrı ele alınacak.
