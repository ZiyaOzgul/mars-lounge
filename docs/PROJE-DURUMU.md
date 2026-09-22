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

## Mimari: yerel çalışma alanı, Supabase kayıt defteri (14 Eylül 2026)

Uygulama **local-first** kalıyor ve bu bilinçli bir tercih: kasa, internet
takıldı diye satışı durduramaz ve sql.js anlık, Supabase her yazmada
gidip gelen bir tur demek. Sunucu-öncelikliye geçmek çevrimdışı gereksinimini
ortadan kaldırmadığı için karmaşıklığı azaltmaz, sadece yön değiştirir —
üstüne 4.400 satırlık veri katmanının canlı sistemde yeniden yazılması gelir.

Değişen şey konvansiyon: eskiden "yerel kaynak, Supabase kopya" idi. Artık:

- **Yazma önce yerele gider** (hız + çevrimdışı).
- **Çelişkide uzak taraf kazanır.** Sipariş durumu/kapanışı için Supabase
  yetkili; `sync.js` içindeki uzlaştırma adımı yerelde açık kalmış ama uzakta
  kapanmış siparişleri kapatıyor.
- **Yerel dosya yeniden kurulabilir olmalı**, yeri doldurulamaz değil.

### Neden 30 günlük pencere kaldırıldı

`COMPLETED_PULL_WINDOW_DAYS = 30` yüzünden yerel dosya bozulup sıfırdan
kurulduğunda 30 günden eski geçmiş **bir daha geri gelmiyordu**. Bugün bu 5
günlük kayıp (ilk sipariş 10 Ağustos); altı ay sonra aynı kaza beş aylık
geçmişi siler. Artık `meta` tablosundaki `completed-backfill-v1` bayrağı
yoksa geçmişin tamamı bir kez çekiliyor; sonraki turlar 30 günlük pencereyle
devam ediyor. Bayrak yalnızca çekim eksiksiz tamamlanırsa yazılıyor.

### Bu sırada bulunan canlı hata: PostgREST 1000 satır sınırı

Kapanmış siparişlerin id listesi tek istekte çekiliyordu. Canlı projede
ölçüldü:

```
GET /rest/v1/orders?select=id&status=eq.completed
→ HTTP 206 · Content-Range: 0-999/1443
```

1.443 siparişin **1.000'i** dönüyordu; kalan 443'ü liste hiç görmüyordu.
Kendi kasasında oluşan siparişler zaten yerelde olduğu için etkisi sınırlı
kaldı, ama başka cihazdan (QR/mobil) kapanan bir satış bu eşiğin ötesine
düşerse raporlara hiç girmiyordu. Artık `.range()` ile sayfalanıyor.

Ayrıca `.in('id', …)` filtresi binlerce id'yi sorgu dizesine koyup isteği
uzunluk sınırında düşürebiliyordu — 100'lük parçalara bölündü. Ve
`insertRemoteCompletedOrder` artık `persist: false` kabul ediyor: geri
dolumda sipariş başına tam veritabanı yazımı uygulamayı dakikalarca
dondururdu, şimdi parça başına bir kez yazılıyor.

### Yedekleme (14 Eylül 2026)

`.bak` tek kuşak tutuyor ve her yazmada üzerine yazılıyor — bozulma iki kez
diske inerse sağlam kopya kalmıyor. Buna ek olarak tarihli anlık görüntüler
alınıyor: `%APPDATA%Mars Lounge Cafeackupssan-lucas-YYYY-MM-DD_HHmm.db`

- **Ne zaman:** açılıştan 90 sn sonra, 6 saatte bir kontrol (en fazla 12
  saatte bir dosya), ve gece bakımında reload'dan ÖNCE (zorla).
  Periyodik olan asıl iş yapan tetikleyici — bu PC hiç yeniden başlatılmıyor.
- **Saklama:** 14 gün, ama en yeni 3 tanesi yaşına bakılmadan korunur.
  Uzun kapalı kalma sonrası "hepsi eski" diye her şeyin silinmesini engeller.
- **Bozuk dosya yedeklenmez:** SQLite başlık imzası + boyut kontrolü. Bozuk
  bir dosyayı yedeklemek sağlam kuşakları emekliye ayırdığı için hiç yedek
  almamaktan kötüdür.
- **Atomik:** `.tmp` + rename, yani yarım yazılmış dosya asla `.db` olarak
  listeye girmez.
- **Arayüz:** Ayarlar → Sistem → Veritabanı Yedekleri. Elle yedek, klasörü
  açma ve log dosyasını gösterme buradan.

**Kapsam sınırı:** Bu yedekler yerel diskte. Dosya bozulmasına karşı korur,
PC'nin komple gitmesine karşı DEĞİL. Satış verisi (siparişler, kalemler,
ödemeler) zaten Supabase'de ve artık tam geri dolumla geri gelebiliyor;
yerel yedeğin asıl değeri sadece yerelde yaşayan şeyler (masa tanımları,
masa adları, çevrimdışı kimlik bilgileri, meta bayrakları) ve sunucuya
henüz gitmemiş kayıtlar.

### 22P02: ödeme senkronunu kilitleyen UUID hatası (15 Eylül 2026)

Belirti: `[Sync] ✗ Ödeme yüklenemedi — code=22P02 | msg=invalid input syntax
for type uuid: "USMAN"`

Kök neden: Supabase'de `payments.processed_by` **uuid** tipinde, ama
`Tables.jsx` oraya garson ADINI gönderiyordu. Postgres satırı reddediyor,
ödeme `is_synced = 0` kalıyor ve HER senkron turunda aynı hatayla yeniden
deneniyor — yani sonsuza kadar kuyrukta.

Neden geç fark edildi: garson seçilmeyen ödemelerde alan `null` gidiyor ve
sorun çıkmıyor. Müşterinin veritabanında 1.533 ödemenin `processed_by`'ı
null, yalnızca 2 tanesi "USMAN" — ve o ikisi de senkronlanmamıştı.

Üç katmanlı düzeltme:
1. `localDb.isUuid()` — tek doğru kaynak.
2. `orderOperations.addPayments` ve `sync.js` push'u: UUID olmayan değer
   `null` olarak gider. Ödemenin sunucuya ulaşması, personel eşleşmesinden
   önemli.
3. `Tables.jsx` artık `getStaffUidByName()` ile gerçek `staff.supabase_uid`
   değerini gönderiyor. Ad zaten `orders.waiter_name`'de duruyordu.

Ayrıca tek seferlik göç (`payments-processed-by-uuid-v1`): kuyrukta kalmış
satırlar personel kimliğine çevriliyor, çözülemezse boşaltılıyor. Müşterinin
gerçek veritabanı kopyasında test edildi — 2 kayıt da null'lanmadan doğru
uid'ye çevrildi.

**Not:** `staff` tablosunda `supabase_uid` kolonu zaten vardı, ödeme yolunda
hiç kullanılmıyordu.

### ⚠️ Yayınlanan sürüm kurulmuyor olabilir (16 Eylül 2026)

**v1.3.2 12 Eylül'de yayınlandı ama müşteri 15 Eylül'de hâlâ v1.3.1
kullanıyordu.** Kanıt: müşterinin userData klasöründe `logs/` hiç
oluşmamıştı — dosya loglaması (`logLine`) v1.3.2 ile gelmişti ve 15
dakikada bir yazıyor.

Sebep: `autoUpdater.autoInstallOnAppQuit = true` — güncelleme YALNIZCA
uygulama kapanırken kuruluyor. Bu kasa hiç kapatılmıyor, uygulama günlerce
açık kalıyor. "Şimdi Yeniden Başlat / Daha Sonra" penceresi servis sırasında
çıkınca doğal olarak "Daha Sonra" seçiliyor. Sonuç: sürüm süresiz olarak
kurulmadan bekliyor.

**Bunun bedeli somut:** v1.3.1'de `webContents.getProcessMemoryInfo()`
çağrılıyordu — bu API Electron 29'da yok, senkron TypeError fırlatıyor ve
`setInterval` içinden fırladığı için Electron'un "A JavaScript error
occurred in the main process" penceresi **15 dakikada bir** kasiyerin
karşısına çıkıyordu. `4e5a0eb` bunu düzeltmişti — ama düzeltme hiç
kurulmadığı için müşteri haftalarca bu hatayı yaşamaya devam etti.

Düzeltme: gece bakım penceresinde, kasiyer onay verdiğinde, bekleyen bir
güncelleme varsa `win.reload()` yerine `autoUpdater.quitAndInstall(true, true)`
çalışıyor. Sessiz kurulum + otomatik yeniden başlatma; kasiyerin bir şey
yapması gerekmiyor.

**Kural: bir sürümü yayınlamak, müşteriye ulaştığı anlamına GELMEZ.**
Doğrulamanın tek yolu kurulu sürümü teyit etmek (Ayarlar'daki sürüm bilgisi
ya da userData'da beklenen dosyaların varlığı).

### Her ürün ayrı sipariş grubu açıyordu (22 Eylül 2026)

Kişi bazlı adisyon özelliğini denerken çıktı ve **daha büyük bir hataydı**:
masaya arka arkaya eklenen her ürün AYRI bir sipariş grubu (ve Supabase'de
ayrı bir `orders` satırı) oluşturuyordu.

Kök neden — `Tables.jsx` `handleAddItem`, tek kural:

    const manualIdx = orders.findIndex(o => o.supabaseOrderId === null)
    if (manualIdx === -1) { /* YENİ GRUP AÇ */ }

Kuralın niyeti "QR siparişinin içine elle ürün düşürme" idi. Ama bizim kendi
grubumuz da ~1 saniyelik debounce'tan sonra Supabase'e gidip bir `remote_id`
kazanıyor; o andan itibaren kural onu da QR sanıp her yeni ürün için yeni
grup açıyordu. Yani ayıraç aslında "uzakta var mı" idi, "kim oluşturdu" değil.

Ölçüm (canlı dev oturumu, aralarında 1–4 sn ile 4 ürün):

    Sipariş 1 ₺140 · Sipariş 2 ₺140 · Sipariş 3 ₺140 · Sipariş 4 ₺100
    → Supabase: orders 2136, 2137, 2138, 2141 (tek masa, dört adisyon)

**Müşterinin kendi verisinde de aynısı var** — tek tıkla eklenen adetler tek
grupta, ayrı tıklar ayrı grupta:

    masa 13 → orders 2165 (19:46:15), 2166 (19:46:20), 2167 (19:46:27)
    masa 6  → orders 2170, 2171, 2173, 2174, 2175 (hepsi 1 kalem)
    masa 10 → 2176 (3× OREOLU MILKSHAKE, aynı ms) + 2177 (2× MARS, 4 sn sonra)

Bu, "Masa 4'te 7 ayrı ödenmiş-ama-kapanmamış sipariş" ve "25 tamamlanmış
siparişin payments satırı yok" gibi eski bulguların da muhtemel kaynağı:
tek bir masa oturumu onlarca `orders` satırına bölünüyor.

Düzeltme — hedef grup seçme sırası:
  1. açıkça verilen `targetGroupId`
  2. `activeGroupId` (en son dokunulan grup) — artık ürün eklerken de yazılıyor
  3. henüz gönderilmemiş ilk yerel grup (eski kural)
  4. listedeki son grup — yenisini açmak yerine
Ayırmak artık bilinçli bir hareket: "+ Yeni Sipariş" ya da kişi adı vermek.

### Kişi bazlı adisyon: masaya oturanı adıyla takip etme (22 Eylül 2026)

Masaya verilen ad (`table_labels`, v1.4.0) masanın TAMAMINI adlandırıyordu.
Buna ek olarak artık masadaki her sipariş grubu bir kişiye ad verilerek
takip edilebiliyor ve o kişi, ürünleriyle birlikte başka bir masaya
taşınabiliyor.

- `orders.guest_label` — **YEREL kolon** (migration). Supabase şemasına
  dokunulmadı; push sabit bir kolon listesi gönderdiği için dışarı çıkmaz,
  QR menüyü ve raporları etkilemez. Diske yazıldığı için kapat-aç sonrası ad
  kaybolmuyor.
- Grup `label`'ı ("Sipariş 2") sıra numarası olarak duruyor; `guestLabel`
  onun yerine değil yanında. Ad silinince grup yine numarasıyla görünür.
- Taşıma bir SİLME DEĞİL: var olan siparişin `table_id`'si güncelleniyor.
  `local_id`/`remote_id` sabit kalıyor, `pending_deletes`'e hiçbir şey
  düşmüyor — bu yüzden "sildim, geri geldi" sınıfı sorunlar bu yolda
  oluşamaz (push tarafı zaten `remote_id` ile UPDATE ediyor, DELETE değil).
- Hedef masa dolu olabilir: kişi orada kendi adıyla ayrı bir adisyon olarak
  durur, mevcut siparişin içine karışmaz.

Doğrulama — müşterinin gerçek veritabanı kopyası üzerinde 22 iddia
(`guest_label` eski veriye zarar vermiyor, taşımada satır kaybı yok, ciro ve
ödeme sayısı değişmiyor) ve canlı arayüzde uçtan uca senaryo:
Masa-1'de Ali (3 ürün ₺410) + Ziya (2 ürün ₺250) → Ziya Masa-6'ya taşındı →
Masa-1: Ali, 3 ürün ₺410 · Masa-6: Ziya, 4 ürün ₺420 (masanın kendi ₺170'i
korunarak).

## Canlı veri durumu (13 Eylül 2026)

- **Masa 4** — ✅ **ÇÖZÜLDÜ (14 Eylül 2026).** 20 Ağustos'tan kalma 6 + 12 Eylül'den
  1 sipariş (toplam 7) `completed` yapıldı; `closed_at` paranın alındığı ana yazıldı.
  Ayrıntı, kök neden ve rollback SQL: `docs/masa4-duzeltme-2026-09-14.md`.
  Kök neden `orderOperations.js:67` — tolerans 0,001 TL, ödeme toplamın bir kuruş
  altında kalırsa sipariş hiç kapanmıyor. **Bu hâlâ açık**, bkz. aşağıdaki liste.
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
- [x] ~~Masa 4'ün Ağustos siparişleri `completed` mi `cancelled` mı?~~ → `completed`
      yapıldı (14 Eylül 2026), `docs/masa4-duzeltme-2026-09-14.md`
- [x] ~~**Ödeme toleransı 0,001 TL**~~ → `src/lib/money.js` ile 5 kuruşa çıkarıldı ve
      tek kaynağa taşındı (14 Eylül 2026). Aynı sabit `PaymentModal.jsx` ve
      `orderOperations.js` tarafından paylaşılıyor; eskiden ikisinde ayrı ayrı
      `+ 0.001` yazıyordu ve senkron kalmaları hiçbir şeyle garanti değildi.
- [x] ~~**Ödeme anındaki indirim `orders.discount`'a yazılmıyor**~~ →
      `ensurePersistedActiveOrder` artık `subtotal` ve `discount` alanlarını da yazıyor
      (14 Eylül 2026). Sipariş kapanmasa bile indirim veride görünüyor.
- [x] ~~Yuvarlama payını aşan gerçek kalan masayı kilitliyor~~ → PaymentModal'a
      "kalanı sil, masayı kapat" onayı eklendi. Fark indirim olarak yazılıyor ve
      sipariş tutarı gerçekten alınan paraya çekiliyor, böylece ciro şişmiyor.
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
