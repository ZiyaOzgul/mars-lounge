# Proje Durumu ve Devir Notları

> Bu dosya, canlı sistemin **kod dışında kalan** bilgisini taşır: ne yapıldı, ne bilerek
> yapılmadı, hangi kararlar kullanıcıyı bekliyor. Yeni bir oturum ya da yeni bir makine
> bu dosyayı okuyarak kaldığı yerden devam edebilir.
>
> **Son güncelleme: 13 Eylül 2026 — sürüm v1.3.2**

## Sistem özeti

Kafede **tek bir Windows PC** üzerinde çalışan canlı bir POS. Operatör bilgisayarı
**hiç kapatmıyor** — uygulama günlerce açık kalıyor. Bu yüzden uzun çalışma süresine
bağlı hatalar (bellek büyümesi, renderer çökmesi, oturum yenileme) burada günlük
olaydır, kenar durum değil.

- Supabase projesi: `bhxqjrocctiqoaxvooho` (eu-north-1, Postgres 17)
- Release: **yalnızca `v*` tag'i** CI'ı tetikler. `main`'e push tek başına release üretmez.
- Uygulama **kendini günceller**: açılışta ve 4 saatte bir kontrol eder, indirince
  kullanıcıya sorar, "Daha Sonra" dense bile `autoInstallOnAppQuit = true` sayesinde
  sonraki kapanışta kurulur. Yani **tag atmak = güncelleme canlı kasaya gider.**
- Yerel geliştirme için `.env` gerekir (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
  Değerler Supabase panelinden veya GitHub Actions secrets'tan alınır. **Repoya girmez.**
- Ana süreç logu: `%APPDATA%\Mars Lounge Cafe\logs\main.log`
- Yerel veritabanı: `%APPDATA%\Mars Lounge Cafe\san-lucas.db`

## Bilinmesi şart olan iki mimari gerçek

### 1. Yerel veritabanı kaynak, Supabase kopya

Raporlar yerel sql.js üzerinden okur. `sync.js` yalnızca yerelde bilinmeyen siparişleri
çeker (`filterUnknownRemoteOrders`), mevcut satırların üzerine asla yazmaz.
Sonuç: **yerel dosyanın kaybı, geri dönüşü olmayan geçmiş kaybıdır.**

`COMPLETED_PULL_WINDOW_DAYS = 30` (`src/lib/sync.js:50`) — boş bir yerel veritabanı
sunucudan yalnızca son 30 günü çeker.

Bazı veriler **yalnızca yerelde** yaşar, sunucuda karşılığı yoktur:
`table_defs` (masa isimleri), personel izinleri, `offline_credentials`,
`product_variant_ingredients`, ve `cash_amount` / `card_amount` / `iban_amount` /
`veresiye_amount`.

**Hedef mimari:** Supabase kaynak, yerel = çevrimdışı tamponu ve önbellek.
Sırayla: (a) boş yerelde tüm geçmişi çek, (b) eksik kolonları push et,
(c) local-only tabloları senkronize et.
Uzun vade: `better-sqlite3` — sql.js her değişiklikte tüm dosyayı yeniden yazıyor,
bu bir ana veri deposu için doğası gereği kırılgan.

### 2. Tanı logları olmadan üretimde kör kalınır

Paketlenmiş uygulamada `console.log` hiçbir yere gitmez. v1.3.2'de dosya loglaması
eklendi. Yeni tanı eklerken mutlaka `logLine()` kullan.

## Yapılanlar (v1.3.1 + v1.3.2)

| Alan | Değişiklik |
|---|---|
| Veri dayanıklılığı | `db-write` atomik (tmp → `.bak` → rename); yazma hatası `{ok, error}` dönüyor ve ekranda kalıcı kırmızı banner çıkıyor. Önceden tamamen sessizdi — saatlerce süren veri kaybının muhtemel sebebi buydu |
| Bozuk veritabanı | Sessiz sıfırlama kaldırıldı; `.bak`'tan kurtarma denenir, olmazsa görünür uyarı |
| Kapanış | Pencere `close` ve `before-quit`'te bekleyen yazma flush ediliyor (3 sn timeout; uygulama asla kapanamaz duruma düşmez) |
| Çökme | `render-process-gone` → otomatik reload + crash-loop koruması (5 dakikada 3); `unresponsive` / `responsive` loglanıyor |
| Bakım | 05:00–07:00 arası reload, **yalnızca renderer onaylarsa**; açık masa, süren senkron veya bekleyen veri varsa onaylamaz, onaydan önce flush eder |
| Hata görünürlüğü | ErrorBoundary + global `error` / `unhandledrejection`; ana süreçte `uncaughtException` yakalanıp dosyaya yazılıyor |
| Senkron | FK ihlali (23503) alan silme istekleri kuyruktan düşüyor — dakikalık sonsuz döngü durdu |
| Yarış | Silinen ürün, 1 sn'lik debounce içinde gelen senkronla geri gelmiyor (8 sn TTL'li koruma listesi) |
| Para | İndirim, ürün silinince yeniden sınırlanıyor (hesap sıfıra düşemiyor); tahsilat hatası görünür, çift tahsilat kilitli |
| Yeni özellik | **Masayı İptal Et** — tüm masa veya tek grup, onay zorunlu, ödeme almış masada devre dışı, uzak siparişler silinmez `cancelled` işaretlenir. `cancel_order` iznine bağlı ve bu izin **varsayılan kapalı** |
| Güvenlik | Sıfırlama: admin + yazılı onay (`SIFIRLA` / `TUM VERILERI SIL`) + yerel PBKDF2 şifre kontrolü |
| Veresiye | "Düzeltme" modu, tahsil edilmiş ödemeyi silmeden önce tutar/kim/tarih listeleyen onay istiyor |
| Raporlar | Açık bırakılınca donmuyor, 60 saniyede bir tazeleniyor |

## Açık sorunlar

### Yüksek öncelik

**1. `initDb` sertleştirmesi.** `db.run(SCHEMA)` kurtarma `try/catch`'inin **dışında**
(`src/lib/localDb.js` ~300). sql.js constructor'da dosyayı doğrulamaz; bozukluk ilk
gerçek sorguda `memory access out of bounds` olarak patlar ve kurtarma hiç denenmez.
Ayrıca `src/context/AppContext.jsx:708-709` hata durumunda bile `setDbReady(true)`
diyor, yani uygulama kullanılamaz haldeyken "açık" görünüyor.
Gerekli: şema adımını kurtarma kapsamına al, açılışta `PRAGMA integrity_check` çalıştır,
hata halinde net bir kurtarma ekranı göster. **Bozuk bir dosyayla bilerek test edilmeli.**

**2. Hızlı kapanış ödeme kaydı oluşturmuyor.** `Tables.jsx` fast path →
`saveCompletedOrder` (`localDb.js:1084-1179`) `payments` tablosuna hiç yazmıyor.
Yalnızca masa açıldıktan ~1 saniye içinde ödenirse tetiklenir (vakaların ~%1'i).
Canlı etkisi: 13 kapanmış siparişin ödeme kaydı yok, toplam 3.330 TL.

**3. Stok yarışı.** `Ingredients.jsx:13-19` modal açılışında stoğu bir kez okuyor,
`localDb.js:691-710` mutlak değer yazıyor (fark değil). Modal açıkken yapılan satışlar
kaydedince geri yazılıyor.

### Orta öncelik

4. **Reçete geriye dönük uygulanıyor** — `consumeIngredients` reçeteyi kapanış anında
   okuyor (`localDb.js:1215`). Mesai içinde reçete değişirse, o an masalarda duran
   hazırlanmış ürünler yeni reçeteyle düşülür.
5. **Dolu masa silinebiliyor** — `localDb.js:562-566` kontrolsüz siliyor; Ayarlar'daki
   buton masa doluyken de aktif.
6. **Veresiye tahsil / geri al onaysız** — `Veresiye.jsx:222-245`. Ayrıca
   `settleVeresiye` `settled_at IS NULL` kontrolü yapmıyor, aynı borç iki kez tahsil
   işaretlenebiliyor.
7. **`staff-admin` fail-open** — `supabase/functions/staff-admin/index.ts:99-104`
   admin silme kontrolü sorgu hatasını yok sayıyor. (Ana yetki kontrolü sağlam.)
8. **Reçetede kullanılan malzeme uyarısız silinebiliyor** — `localDb.js:712-721`.
9. **Gün sonu sınırı** — `businessDay.js:74-84`, eşleşen kapanış dilimi yoksa takvim
   gece yarısına düşüyor. `day_closures` 9 Eylül'de başladığı için öncesi ve "Günü Bitir"
   basılmayan geceler takvim sınırıyla hesaplanıyor; hafta/ay sekmeleri iki semantiği
   aynı toplamda karıştırıyor.
10. **Yerel izin blob'u ile yetki yükseltme** — `localDb.js:2412-2434` `insertStaff` /
    `updateStaff` çağıranın rolünü kontrol etmiyor, izinler yerel sqlite'ta düz duruyor.

### Düşük öncelik / bilinçli bırakılan

11. **`anon` INSERT açık** (`orders`, `order_items`, `with_check: true`).
    **Kullanıcı bilerek bıraktı** — QR ileride kullanılacak. QR devreye alınırken
    daraltılmalı: `order_type = 'qr'` ve `status = 'pending'` zorunlu kılınmalı, tutar
    sunucuda hesaplanmalı, tercihen tüm akış bir edge function üzerinden geçmeli.
    *(Bugüne kadar 0 QR siparişi var; şu an hiçbir işlevi korumuyor.)*
12. 13 indekssiz foreign key — en önemlisi `orders.table_id`.
13. Ürün silinince `product_variants` / `product_ingredients` artık satırları kalıyor.
14. Login hatası yanıltıcı: Supabase yapılandırılmamışken "ilk giriş için internet
    gerekli" diyor (`Login.jsx:72` → `:45`). `.env` yokken geliştiriciyi yanıltır.

## Canlı veri durumu (13 Eylül 2026)

- **Masa 4** — 20 Ağustos'tan kalma 6 aktif sipariş: 545 TL fatura, **516,31 TL tahsil
  edilmiş**. Bunlar boş hayalet değil, parası alınmış ama kapatılmamış siparişler.
  **İptal edilmemeli.** Muhtemelen `completed` olmalı, ama bu ciroyu 545 TL artırır.
- **Masa 1 / 3 / 4** — 11-12 Eylül gecesinden kalan 8 sipariş, ödeme yok (1.850 TL).
  Gerçekten unutulmuş mu yoksa hâlâ açık mı, kafedeki kişiye sorulacaktı; cevap gelmedi.
- **Tahsil edilmiş veresiye** — 5 kayıt / 1.580 TL (sipariş 1263, 1307, 1392, 1393, 1394).
  Açık kalan: 1 kayıt / 100 TL (sipariş 1525, "VELİ").
- **28 split sipariş / 16.514 TL** — nakit/kart dağılımı yalnızca yerelde; yeniden
  kurulumda ya da ikinci cihazda sıfır görünür.
- `day_closures` yalnızca 3 kayıt (9, 10, 11 Eylül, ~02:45 civarı).

## Kullanıcı kararı bekleyenler

- [ ] **Veritabanı yedeği alınmadı.** En kritik açık madde.
- [ ] Masa 1/3/4'teki gece kalıntıları iptal edilsin mi?
- [ ] Masa 4'ün Ağustos siparişleri `completed` mi `cancelled` mı? (ciroyu 545 TL etkiler)
- [ ] Düzenli otomatik yedekleme isteniyor mu?

## Bu projede öğrenilen çalışma kuralları

- **Veri değiştiren hiçbir işlemi yedek almadan yapma.** Bu kural bir kez ihlal edildi
  ve güncelleme sırasında veritabanı bozulmasıyla sonuçlandı.
- Şema veya veri değişikliği önce kullanıcıya sorulur; onaysız veritabanına yazılmaz.
- **Bir API'nin var olduğunu doğrulamadan kabul etme.**
  `webContents.getProcessMemoryInfo()` Electron 29'da yok; doğrulanmadan gönderildi ve
  kasiyere 15 dakikada bir hata penceresi çıkardı.
- `electron/` altında değişiklik yaptıysan `node --check` çalıştır. Vite bu klasörü
  paketlemez, yani sözdizimi hatası build'den sorunsuz geçer ve uygulamayı çalışma
  anında bozar.
- Tanı kodu (log, ölçüm) **asla** uygulamayı düşürmemeli — gövdesi tamamen `try/catch`
  içinde olmalı.
- Sürüm yükseltirken `package.json` ve `package-lock.json`'ın **kök** `version` alanı
  (satır 3 ve 9) birlikte güncellenir. Aynı sürüm numarasını taşıyan bağımlılıklara dokunma.
- Doğrulama seti: `npx eslint .` + `npx vite build` + `electron/` için `node --check`.
