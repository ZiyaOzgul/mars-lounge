const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const fs   = require('fs')
// Yedekleme async fs kullaniyor: kopyalama ana sureci bloklamamali —
// senkron disk islemleri tam olarak kacindigimiz donma sebebi.
const fsp  = require('fs').promises

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

// İndirilmiş ama henüz kurulmamış sürüm. electron-updater güncellemeyi
// YALNIZCA uygulama kapanırken kuruyor (autoInstallOnAppQuit). Bu kasa hiç
// kapatılmıyor — uygulama günlerce açık kalıyor — ve "Şimdi Yeniden Başlat"
// penceresi servis sırasında çıktığında doğal olarak "Daha Sonra"
// seçiliyor. Sonuç: yayınlanan sürüm aylarca kurulmayabiliyor.
//
// Bu gerçek bir vakadır: v1.3.2 12 Eylül'de yayınlandı, müşteri 15 Eylül'de
// hâlâ v1.3.1 kullanıyordu (userData'da logs/ klasörünün hiç oluşmamış
// olmasından anlaşıldı — dosya loglaması v1.3.2 ile gelmişti).
//
// Çözüm: gece bakım penceresinde, kasiyer onay verdiğinde, bekleyen bir
// güncelleme varsa reload yerine kurulum yapılıyor.
let pendingUpdate = null

// Ayarlar ekranindaki "Guncelleme Kontrol Et" bu durumu okuyor. O buton
// eskiden onClick'i olmayan bir suslemeydi ve yaninda sabit "v1.0.0"
// yaziyordu — musteri oraya bakarak yanlis surumde oldugunu sanabilirdi.
const updateState = {
  checking: false,
  pending: null,        // indirilmis, kurulmayi bekleyen surum
  upToDate: false,      // son kontrolde guncel oldugu dogrulandi
  error: null,
  lastCheckedAt: null,
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app-image', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, stream: true } },
])

const IMAGES_DIR = () => path.join(app.getPath('userData'), 'images')
const LOCAL_DIR  = () => path.join(IMAGES_DIR(), 'local')
const CACHE_DIR  = () => path.join(IMAGES_DIR(), 'cache')

function imageFilename(ref) {
  if (!ref) return null
  try {
    if (String(ref).startsWith('app-image://')) {
      return path.basename(decodeURIComponent(new URL(ref).pathname))
    }
  } catch {}
  return path.basename(String(ref))
}

function legacyProductPath(filename) {
  return path.join(__dirname, '..', 'public', 'products', filename)
}

// Window/taskbar icon. public/ is not in the electron-builder `files`
// allowlist — Vite copies it into dist/, which is what ships.
function appIconPath() {
  const dir = app.isPackaged ? 'dist' : 'public'
  return path.join(__dirname, '..', dir, 'icon.ico')
}

function checkForUpdates() {
  if (!app.isPackaged) return
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[auto-updater] check failed:', err)
  })
}

function setupAutoUpdater() {
  if (!app.isPackaged) return

  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    updateState.checking = true
    updateState.error = null
  })

  autoUpdater.on('update-not-available', () => {
    updateState.checking = false
    updateState.upToDate = true
    updateState.lastCheckedAt = Date.now()
  })

  autoUpdater.on('update-available', (info) => {
    updateState.checking = false
    updateState.upToDate = false
    updateState.lastCheckedAt = Date.now()
    logLine(`[auto-updater] v${info?.version} bulundu — indiriliyor`)
  })

  autoUpdater.on('update-downloaded', async (info) => {
    // Gece bakımı bunu görüp kurulumu kendisi tamamlayacak — bkz.
    // pendingUpdate ve requestMaintenanceReload.
    pendingUpdate = info.version || 'bilinmiyor'
    updateState.checking = false
    updateState.pending = pendingUpdate
    updateState.upToDate = false
    updateState.lastCheckedAt = Date.now()
    logLine(`[auto-updater] v${pendingUpdate} indirildi — kurulum yeniden baslatmayi bekliyor`)
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Güncelleme Hazır',
      message: `Yeni sürüm indirildi (v${info.version}). Şimdi yeniden başlatmak ister misiniz?`,
      buttons: ['Şimdi Yeniden Başlat', 'Daha Sonra'],
      defaultId: 0,
      cancelId: 1,
    })

    if (response === 0) {
      autoUpdater.quitAndInstall()
    } else {
      logLine('[auto-updater] kullanici "Daha Sonra" dedi — gece bakiminda otomatik kurulacak')
    }
  })

  autoUpdater.on('error', (err) => {
    updateState.checking = false
    updateState.error = String((err && err.message) || err)
    logLine(`[auto-updater] hata: ${updateState.error}`, 'error')
  })

  checkForUpdates()
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS)
}

function createWindow() {
  Menu.setApplicationMenu(null)

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Bu kasa hicbir zaman kapatilmiyor ve gun icinde sik sik kucultuluyor.
      // Chromium, gorunmeyen bir sayfanin zamanlayicilarini once saniyede
      // birden dakikada bire dusuruyor, 5 dakika sonra "yogun kisitlama"ya
      // geciyor. Bu uygulamada zamanlayiciya bagli UC kritik is var:
      //   * Supabase JWT'sinin otomatik yenilenmesi (supabase-js tick'i)
      //   * 60 saniyelik periyodik senkron turu
      //   * acik masalari diske yazan 1 saniyelik debounce
      // Bogulduklarinda oturum sessizce dusuyor, sonrasinda okuma ve ekleme
      // anon olarak calismaya devam ederken guncelleme ve silme RLS'e
      // takiliyor — masalar kapanmiyor, silinenler geri geliyor.
      backgroundThrottling: false,
    },
  })

  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // F11 toggles fullscreen / windowed
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen())
    }
  })

  // ── Renderer crash recovery ───────────────────────────────────────
  // Bu PC hiç yeniden başlatılmıyor — uygulama günlerce açık kalıyor. Uzun
  // süre çalışan bir Electron uygulamasında en klasik arıza şekli, Chromium
  // renderer sürecinin (OOM, GPU çökmesi vb. sebeplerle) tamamen ölmesidir.
  // Bu durumda pencere beyaz/boş kalır ve JS seviyesindeki hiçbir koruma
  // (ErrorBoundary dahil) devreye giremez, çünkü JS context'in kendisi ölmüş
  // olur. Otomatik olarak reload ederek toparlanmayı deniyoruz, ama art arda
  // çöküyorsa (crash loop) sonsuza kadar reload etmeye devam etmiyoruz.
  const CRASH_LOOP_WINDOW_MS = 5 * 60 * 1000
  const CRASH_LOOP_MAX = 3
  let recoveryTimestamps = []

  win.webContents.on('render-process-gone', (event, details) => {
    const now = Date.now()
    logLine(`[render-process-gone] renderer coktu — reason: ${details.reason}, exitCode: ${details.exitCode}`, 'error')

    recoveryTimestamps = recoveryTimestamps.filter((t) => now - t < CRASH_LOOP_WINDOW_MS)

    if (recoveryTimestamps.length >= CRASH_LOOP_MAX) {
      logLine(
        `[render-process-gone] son ${CRASH_LOOP_WINDOW_MS / 60000} dakika icinde ${CRASH_LOOP_MAX}'ten fazla cokus oldu — crash loop korumasi devrede, otomatik yeniden yukleme durduruldu`,
        'error'
      )
      return
    }

    recoveryTimestamps.push(now)
    logLine('[render-process-gone] pencere otomatik olarak yeniden yukleniyor', 'error')
    try {
      win.reload()
    } catch (err) {
      logLine(`[render-process-gone] reload basarisiz: ${err && err.message}`, 'error')
    }
  })

  // Unresponsive genelde kendiliğinden düzelir (uzun senkron bir işlem
  // sürüyor olabilir) — burada zorla reload/kill YAPMIYORUZ, çünkü bu
  // kaydedilmemiş bir işlemi yok edebilir. Sadece logluyoruz; responsive
  // ile birlikte süresi loglardan görülebilir.
  // Donma suresini olcebilmek icin baslangici sakliyoruz — log dosyasinda
  // "5 dakika dondu" ile "200 ms takildi" ayirt edilebilsin.
  let unresponsiveSince = null

  win.on('unresponsive', () => {
    unresponsiveSince = Date.now()
    logLine('[unresponsive] pencere yanit vermiyor — otomatik mudahale yapilmiyor', 'error')
  })

  win.on('responsive', () => {
    const ms = unresponsiveSince ? Date.now() - unresponsiveSince : null
    unresponsiveSince = null
    logLine(`[responsive] pencere tekrar yanit veriyor${ms !== null ? ` — ${(ms / 1000).toFixed(1)} sn donuk kaldi` : ''}`, 'error')
  })

  // ── Gece bakım reload'u (05:00) ────────────────────────────────────
  // Kök sorun sürecin hiç yeniden başlatılmamasıdır. Günde bir kez, güvenli
  // olduğunda kontrollü bir reload yapıyoruz. Main, kasiyerin sipariş
  // ortasında olup olmadığını bilemez — bu yüzden karar vermek yerine
  // renderer'a soruyor ve sadece açık onay gelirse reload ediyor.
  scheduleMaintenanceReload(win, msUntilNextMaintenance())

  // ── Periyodik renderer bellek loglaması ────────────────────────────
  // Tanı amaçlı: günler içinde bellek büyümesinin renderer çökmesine sebep
  // olup olmadığını (render-process-gone yukarıda) bir sonraki olayda teyit
  // ya da çürütmek için kullanılır.
  const memoryTimer = setInterval(() => logRendererMemory(win), MEMORY_LOG_INTERVAL_MS)
  win.once('closed', () => clearInterval(memoryTimer))

  // ── Otomatik yedekler ────────────────────────────────────────────
  // Bu PC hiç yeniden başlatılmıyor — uygulama günlerce açık kalıyor. Bu
  // yüzden asıl iş yapan tetikleyici periyodik olan; açılıştaki yedek
  // yalnızca kurulum/güncelleme sonrası ilk turu yakalıyor.
  // takeBackup kendi aralık kontrolünü yapıyor (12 saat), o yüzden bu
  // timer'ın sık çalışması fazladan dosya üretmiyor.
  const BACKUP_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
  const backupTimer = setInterval(() => {
    takeBackup('periyodik').catch((e) => logLine(`[backup] periyodik yedek hatasi: ${e && e.message}`, 'error'))
  }, BACKUP_CHECK_INTERVAL_MS)
  win.once('closed', () => clearInterval(backupTimer))

  // (Açılış yedeği artık whenReady içinde, renderer başlamadan önce alınıyor.)
  // Ilk olcum renderer sureci ayaga kalktiktan SONRA alinmali —
  // createWindow icinde hemen cagrilirsa surec henuz getAppMetrics'te
  // gorunmez ve 'bilinmiyor' yazar.
  win.webContents.once('did-finish-load', () => logRendererMemory(win))

  // En yaygın kapatma yolu (pencerenin X butonu) 'window-all-closed' →
  // app.quit() → 'before-quit' zincirini tetikler, ama o noktada pencere
  // zaten yok edilmiş olur ve renderer'a flush isteği gönderilemez. Bu yüzden
  // flush'u burada, pencere hâlâ canlıyken, kendi 'close' olayında yapıyoruz.
  // İlk 'close' engellenir ve flush beklenir; flush bitince win.__forceClose
  // işaretlenip win.close() tekrar çağrılır — bu ikinci çağrı engellenmez ve
  // pencere gerçekten kapanır. Böylece pencere asla kapanmaz hâle gelmez.
  win.on('close', (event) => {
    if (win.__forceClose || allowQuit || flushDone) return // zaten flush edildi/onaylandı — gerçek kapanışa izin ver

    event.preventDefault()
    if (flushInProgress) return // before-quit tarafından başlatılan flush zaten sürüyor, onu bekle

    beginFlush(win, () => {
      win.__forceClose = true
      win.close()
    })
  })
}

// ── Gece bakım reload'u — yardımcı fonksiyonlar ─────────────────────
// Her gün yerel saatle 05:00'te bir kez tetiklenir. Naif bir 24 saatlik
// setInterval yerine, bir sonraki 05:00'e kalan süreyi hesaplayıp her
// tetiklemeden sonra yeniden kuruyoruz — böylece saat kayması (drift) veya
// DST geçişleri birikmiyor.
const MAINTENANCE_HOUR = 5
const MAINTENANCE_APPROVAL_TIMEOUT_MS = 60 * 1000
const MAINTENANCE_RETRY_MS = 30 * 60 * 1000
// Onay alinamazsa sadece bu saat araliginda tekrar denenir (05:00-07:00).
const MAINTENANCE_WINDOW_HOURS = 2

function msUntilNextMaintenance() {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), MAINTENANCE_HOUR, 0, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

function scheduleMaintenanceReload(win, delayMs) {
  setTimeout(() => requestMaintenanceReload(win), delayMs)
}

// Main, kasiyerin sipariş ortasında olup olmadığını bilemez — bu yüzden
// asla kendiliğinden reload etmez. Renderer'a sorar ve sadece açık onay
// ('maintenance-reload-approved') gelirse reload eder. 60 saniye içinde
// onay gelmezse bakım o gün için atlanır ve 30 dakika sonra tekrar denenir.
function requestMaintenanceReload(win) {
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
    scheduleMaintenanceReload(win, msUntilNextMaintenance())
    return
  }

  // Bakim yalnizca sabahin erken saatlerinde yapilir. Onay alinamadiginda 30
  // dakikada bir tekrar deniyoruz, ama bu pencere disina tasmamali: aksi
  // halde gun ortasinda masalar bir an bosaldiginda servis sirasinda reload
  // tetiklenebilirdi. Pencere kapandiysa yarina birakiyoruz.
  const hour = new Date().getHours()
  if (hour < MAINTENANCE_HOUR || hour >= MAINTENANCE_HOUR + MAINTENANCE_WINDOW_HOURS) {
    logLine(`[maintenance] bakim penceresi disinda (saat ${hour}) — yarin 0${MAINTENANCE_HOUR}:00'e erteleniyor`)
    scheduleMaintenanceReload(win, msUntilNextMaintenance())
    return
  }

  // Reload'dan ÖNCE yedek: bakım penceresi günün en sakin anı ve reload
  // her zaman sorunsuz geçmeyebilir — sağlam bir kuşak diskte dursun.
  takeBackup('gece bakimi', { force: true })
    .catch((e) => logLine(`[backup] gece yedegi hatasi: ${e && e.message}`, 'error'))

  logLine("[maintenance] gece bakim reload'u isteniyor")

  let settled = false
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    ipcMain.removeAllListeners('maintenance-reload-approved')
    logLine('[maintenance] onay alinamadi (60sn) — bakim bu sefer atlandi, 30 dk sonra tekrar denenecek')
    scheduleMaintenanceReload(win, MAINTENANCE_RETRY_MS)
  }, MAINTENANCE_APPROVAL_TIMEOUT_MS)

  ipcMain.once('maintenance-reload-approved', () => {
    if (settled) return
    settled = true
    clearTimeout(timer)

    // Bekleyen güncelleme varsa bakım penceresi onu kurmak için en güvenli
    // an: kasiyer onay verdi, masalar boş, gün kapandı. quitAndInstall
    // uygulamayı kapatıp yeni sürümle yeniden açar.
    if (pendingUpdate) {
      logLine(`[maintenance] onaylandi — bekleyen guncelleme v${pendingUpdate} kuruluyor`)
      try {
        // isSilent=true, isForceRunAfter=true → sessiz kurulum, sonra
        // uygulamayi otomatik baslat. Kasiyerin hicbir sey yapmasi gerekmez.
        autoUpdater.quitAndInstall(true, true)
        return
      } catch (err) {
        logLine(`[maintenance] guncelleme kurulamadi, normal reload'a donuluyor: ${err && err.message}`, 'error')
      }
    }

    logLine('[maintenance] onaylandi — pencere yeniden yukleniyor')
    try {
      win.reload()
    } catch (err) {
      logLine(`[maintenance] reload basarisiz: ${err && err.message}`, 'error')
    }
    scheduleMaintenanceReload(win, msUntilNextMaintenance())
  })

  try {
    win.webContents.send('maintenance-reload-request')
  } catch (err) {
    logLine(`[maintenance] istek renderer'a gonderilemedi: ${err && err.message}`, 'error')
    settled = true
    clearTimeout(timer)
    ipcMain.removeAllListeners('maintenance-reload-approved')
    scheduleMaintenanceReload(win, msUntilNextMaintenance())
  }
}

// ── Periyodik renderer bellek loglaması — yardımcı fonksiyon ────────
const MEMORY_LOG_INTERVAL_MS = 15 * 60 * 1000

// NOT: webContents.getProcessMemoryInfo() Electron 29'da YOKTUR (eski
// surumlerde vardi, kaldirildi). Cagrilmasi senkron TypeError firlatir ve
// setInterval icinden firladigi icin "A JavaScript error occurred in the
// main process" penceresi olarak kasiyerin karsisina cikar. Dogru API
// app.getAppMetrics() — senkron calisir ve tum sureclerin bellegini verir.
//
// Bu bir TANI fonksiyonu: hicbir kosulda uygulamayi dusurmemeli. Bu yuzden
// govdesinin tamami try/catch icinde.
function logRendererMemory(win) {
  try {
    if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return
    const rendererPid = win.webContents.getOSProcessId()
    const metrics = app.getAppMetrics()
    const renderer = metrics.find((m) => m.pid === rendererPid)
    const browser  = metrics.find((m) => m.type === 'Browser')
    const kb = (m) => (m && m.memory ? `${m.memory.workingSetSize}KB` : 'bilinmiyor')
    logLine(`[memory] renderer: ${kb(renderer)} · ana surec: ${kb(browser)}`)
  } catch (err) {
    logLine(`[memory] bellek bilgisi okunamadi: ${err && err.message}`, 'error')
  }
}

ipcMain.on('get-user-data-path', (event) => {
  event.returnValue = app.getPath('userData')
})

ipcMain.on('get-version', (event) => {
  event.returnValue = app.getVersion()
})

// ── Log dosyasi + son savunma hatti ────────────────────────────────
// Paketlenmis bir Windows uygulamasinda console.log HICBIR YERE gitmez:
// kisayoldan baslatilinca stdout yoktur. Tani loglarimizin (cokme sebebi,
// bellek, donma suresi, disk yazma hatasi) uretimde okunabilmesi icin
// dosyaya da yaziyoruz. Kafedeki makineye erisimimiz yok; elimizdeki tek
// kanit bugune kadar ekran fotograflariydi.
const LOG_MAX_BYTES = 2 * 1024 * 1024

function logFilePath() {
  return path.join(app.getPath('userData'), 'logs', 'main.log')
}

function logLine(message, level = 'info') {
  const line = `[${new Date().toISOString()}] ${message}`
  if (level === 'error') console.error(line)
  else console.log(line)
  try {
    const file = logFilePath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // Basit devretme: dosya buyudugunde tek bir .1 kopyasi tutulur.
    try {
      if (fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, file + '.1')
    } catch { /* dosya yok — ilk yazim */ }
    fs.appendFileSync(file, line + '\n')
  } catch {
    // Log yazilamiyorsa sessiz gec — loglama asla uygulamayi etkilememeli.
  }
}

// Son savunma hatti: ana surecte yakalanmamis bir hata, Electron'un
// "A JavaScript error occurred in the main process" penceresini kasiyerin
// karsisina cikarir ve servisi durdurur. Bunlari yakalayip dosyaya
// yaziyoruz — uygulama ayakta kalsin, biz de neyin patladigini gorelim.
process.on('uncaughtException', (err) => {
  logLine(`[uncaught] ana surecte yakalanmamis hata: ${err && err.stack ? err.stack : err}`, 'error')
})
process.on('unhandledRejection', (reason) => {
  logLine(`[unhandled-rejection] ${reason && reason.stack ? reason.stack : reason}`, 'error')
})

ipcMain.handle('logs:open', () => {
  try {
    shell.showItemInFolder(logFilePath())
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  }
})

// ── SQLite file persistence ───────────────────────────────────────
// Live app, real customer/order data — a write must never leave the file
// half-written (crash / power loss / AV lock mid-write), and there must
// always be one known-good previous generation to fall back to.
const DB_FILE     = () => path.join(app.getPath('userData'), 'san-lucas.db')
const DB_TMP_FILE = () => path.join(app.getPath('userData'), 'san-lucas.db.tmp')
const DB_BAK_FILE = () => path.join(app.getPath('userData'), 'san-lucas.db.bak')

ipcMain.handle('db-read', () => {
  try {
    const buf = fs.readFileSync(DB_FILE())
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  } catch {
    return null // first run — no file yet
  }
})

// Lets the renderer recover from the last known-good generation when the
// live file turns out to be corrupt/truncated (see localDb.js initDb).
ipcMain.handle('db-read-backup', () => {
  try {
    const buf = fs.readFileSync(DB_BAK_FILE())
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  } catch {
    return null // no backup available yet
  }
})

// Dönüş değeri renderer'ın (localDb.js persistDb) başarı/başarısızlığı
// ayırt edebilmesi için bir sonuç nesnesidir: { ok: true } | { ok: true,
// backupFailed: true } | { ok: false, error: string }. Eskiden bu handler
// hatayı yutup undefined döndürüyordu — disk dolu/dosya kilidi/antivirüs gibi
// bir sebeple yazma başarısız olduğunda uygulama normal görünmeye devam
// ediyor ama hiçbir şey diske ulaşmıyordu. Şimdi sonuç her zaman gözlenebilir.
ipcMain.handle('db-write', (event, data) => {
  const dbFile  = DB_FILE()
  const tmpFile = DB_TMP_FILE()
  const bakFile = DB_BAK_FILE()

  try {
    // 1) Write the new bytes to a scratch file first — if this fails or is
    //    interrupted, the live db file is never touched.
    fs.writeFileSync(tmpFile, Buffer.from(data))

    // 2) Roll the current live file into .bak *before* replacing it, so
    //    there is always one previous generation to recover from. A .bak
    //    failure here is NOT a write failure — the actual live write below
    //    is what matters for data safety — so it's surfaced separately via
    //    backupFailed rather than making the whole call fail.
    let backupFailed = false
    try {
      const stat = fs.statSync(dbFile)
      if (stat.size > 0) fs.copyFileSync(dbFile, bakFile)
    } catch (bakErr) {
      if (bakErr && bakErr.code === 'ENOENT') {
        // No existing file yet (first run) — nothing to back up, not a failure.
      } else {
        backupFailed = true
        console.error('[db-write] UYARI: .bak kopyası oluşturulamadı (ana yazma etkilenmedi):', bakErr)
      }
    }

    // 3) Same-volume rename is atomic on NTFS/Windows — the live file either
    //    stays as the previous generation or becomes the new one in full,
    //    never a partial write.
    fs.renameSync(tmpFile, dbFile)

    return backupFailed ? { ok: true, backupFailed: true } : { ok: true }
  } catch (err) {
    logLine(`[db-write] KRITIK: veritabani dosyasi diske yazilamadi: ${err && err.message}`, 'error')
    return { ok: false, error: String((err && err.message) || err) }
  }
})

// ── Tarihli yedekler ───────────────────────────────────────────────
// .bak tek bir kuşak tutuyor ve HER yazmada üzerine yazılıyor: bozulma iki
// kez diske inerse sağlam kopya diye bir şey kalmıyor. Burası tarihli,
// dokunulmayan anlık görüntüler tutuyor.
//
// Kapsam sınırı bilinçli: bu yedekler yerel diskte duruyor, yani dosya
// bozulmasına karşı koruyor — PC'nin komple gitmesine karşı DEĞİL. Satış
// verisi (siparişler, kalemler, ödemeler) zaten Supabase'de; buradaki
// yedeğin asıl değeri yalnızca yerelde yaşayan şeyler (masa tanımları,
// masa adları, çevrimdışı kimlik bilgileri, meta bayrakları) ve sunucuya
// henüz gitmemiş kayıtlar.
const BACKUP_DIR = () => path.join(app.getPath('userData'), 'backups')
const BACKUP_KEEP_DAYS = 14
const BACKUP_KEEP_MIN = 3          // eski olsalar bile son N tanesi hep kalır
const BACKUP_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000
const SQLITE_MAGIC = 'SQLite format 3\u0000'

function backupStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

async function listBackups() {
  try {
    const dir = BACKUP_DIR()
    const names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.db'))
    const rows = []
    for (const name of names) {
      try {
        const st = await fsp.stat(path.join(dir, name))
        rows.push({ name, size: st.size, mtime: st.mtimeMs })
      } catch { /* yaris: dosya az once silinmis olabilir */ }
    }
    return rows.sort((a, b) => b.mtime - a.mtime)
  } catch {
    return [] // klasor henuz yok
  }
}

// Bozuk bir dosyayi yedeklemek, saglam yedekleri emekliye ayirdigi icin
// hic yedek almamaktan daha kotu. Tam dogrulama ana surecte mumkun degil
// (sqlite yok), ama ucuz iki kontrol en yaygin bozulmayi eliyor:
// baslik imzasi ve makul boyut.
function looksLikeSqlite(buf) {
  return buf.length >= 512 && buf.slice(0, 16).toString('utf8') === SQLITE_MAGIC
}

async function pruneBackups() {
  const rows = await listBackups()
  const cutoff = Date.now() - BACKUP_KEEP_DAYS * 86400_000
  const stale = rows.slice(BACKUP_KEEP_MIN).filter((r) => r.mtime < cutoff)
  for (const r of stale) {
    try { await fsp.unlink(path.join(BACKUP_DIR(), r.name)) }
    catch (e) { logLine(`[backup] eski yedek silinemedi (${r.name}): ${e && e.message}`, 'error') }
  }
  return stale.length
}

// force=true: kullanici elle istedi, aralik kontrolu atlanir.
async function takeBackup(reason, { force = false } = {}) {
  try {
    const src = DB_FILE()
    let buf
    try { buf = await fsp.readFile(src) }
    catch { return { ok: false, error: 'Veritabani dosyasi henuz yok' } }

    if (!looksLikeSqlite(buf)) {
      logLine('[backup] ATLANDI: veritabani dosyasi gecerli bir SQLite dosyasina benzemiyor', 'error')
      return { ok: false, error: 'Veritabani dosyasi gecersiz gorunuyor — yedek alinmadi' }
    }

    if (!force) {
      const [newest] = await listBackups()
      if (newest && Date.now() - newest.mtime < BACKUP_MIN_INTERVAL_MS) {
        return { ok: true, skipped: true, reason: 'son yedek yeterince yeni' }
      }
    }

    const dir = BACKUP_DIR()
    await fsp.mkdir(dir, { recursive: true })
    const name = `san-lucas-${backupStamp()}.db`
    const dest = path.join(dir, name)
    const tmp = dest + '.tmp'
    // tmp + rename: yarim yazilmis bir dosya asla .db uzantisiyla gorunmez,
    // yani listeye gecerli bir yedekmis gibi girmez.
    await fsp.writeFile(tmp, buf)
    await fsp.rename(tmp, dest)

    const pruned = await pruneBackups()
    logLine(`[backup] ${name} olusturuldu (${(buf.length / 1024).toFixed(0)} KB, sebep: ${reason})${pruned ? ` — ${pruned} eski yedek silindi` : ''}`)
    return { ok: true, name, size: buf.length }
  } catch (e) {
    logLine(`[backup] BASARISIZ: ${e && e.message}`, 'error')
    return { ok: false, error: String((e && e.message) || e) }
  }
}

// ── Guncelleme IPC ────────────────────────────────────────────────
ipcMain.handle('updates:status', () => ({
  version: app.getVersion(),
  packaged: app.isPackaged,
  ...updateState,
}))

ipcMain.handle('updates:check', async () => {
  if (!app.isPackaged) {
    return { ok: false, error: 'Gelistirme modunda guncelleme kontrolu yapilamaz' }
  }
  try {
    updateState.checking = true
    updateState.error = null
    const res = await autoUpdater.checkForUpdates()
    const found = res?.updateInfo?.version
    // checkForUpdates, mevcut surumle ayni surumu de dondurebiliyor;
    // "guncel" karari olaylardan geliyor (update-not-available).
    return { ok: true, found: found || null, ...updateState }
  } catch (e) {
    updateState.checking = false
    updateState.error = String((e && e.message) || e)
    return { ok: false, error: updateState.error }
  }
})

// Bekleyen guncellemeyi HEMEN kurar. Gece bakim penceresini beklemeden,
// kasiyer/yonetici hazir oldugunda tek tikla. quitAndInstall uygulamayi
// kapatip yeni surumle acar — bu yuzden cagiran taraf once onay almali.
ipcMain.handle('updates:install', () => {
  if (!app.isPackaged) return { ok: false, error: 'Gelistirme modunda kurulum yapilamaz' }
  if (!pendingUpdate) return { ok: false, error: 'Kurulmayi bekleyen bir guncelleme yok' }
  try {
    logLine(`[auto-updater] v${pendingUpdate} elle kuruluyor (Ayarlar)`)
    // Hemen donebilmek icin bir tick sonra kapatiyoruz, yoksa renderer
    // cevabi hic almadan surec oluyor.
    setTimeout(() => {
      try { autoUpdater.quitAndInstall(true, true) }
      catch (err) { logLine(`[auto-updater] elle kurulum basarisiz: ${err && err.message}`, 'error') }
    }, 250)
    return { ok: true, version: pendingUpdate }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

ipcMain.handle('backup:now', (_e, opts) => takeBackup('elle', { force: true, ...(opts || {}) }))
ipcMain.handle('backup:list', () => listBackups())
ipcMain.handle('backup:open', async () => {
  try {
    await fsp.mkdir(BACKUP_DIR(), { recursive: true })
    await shell.openPath(BACKUP_DIR())
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// Log klasoru — donma/cokme incelemesinde kasiyerden dosya istemek icin.
// Handler main.js'te vardi ama preload'da acik degildi, yani hicbir yerden
// cagrilamiyordu.
ipcMain.handle('logs:reveal', async () => {
  try {
    const file = logFilePath()
    await fsp.mkdir(path.dirname(file), { recursive: true })
    shell.showItemInFolder(file)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// ── Product image helpers ─────────────────────────────────────────
ipcMain.handle('images:pick', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Görseller', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  })
  if (canceled || !filePaths.length) return null
  return filePaths[0]
})

ipcMain.handle('images:save', async (_event, sourcePath) => {
  const ext = path.extname(sourcePath)
  const filename = `${Date.now()}${ext}`
  const destDir = LOCAL_DIR()
  await fs.promises.mkdir(destDir, { recursive: true })
  await fs.promises.copyFile(sourcePath, path.join(destDir, filename))
  return `app-image://local/${filename}`
})

ipcMain.handle('images:delete', (_event, ref) => {
  try {
    const filename = imageFilename(ref)
    if (!filename || filename === '.' || filename === '..') return
    const dest = path.join(LOCAL_DIR(), filename)
    if (fs.existsSync(dest)) fs.unlinkSync(dest)
  } catch (err) {
    console.error('[images:delete] failed:', err)
  }
})

ipcMain.handle('images:readFileBytes', (_event, ref) => {
  try {
    const filename = imageFilename(ref)
    if (!filename || filename === '.' || filename === '..') return null
    const candidates = [
      path.join(LOCAL_DIR(), filename),
      legacyProductPath(filename),
    ]
    for (const filePath of candidates) {
      if (!fs.existsSync(filePath)) continue
      const buf = fs.readFileSync(filePath)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    }
    return null
  } catch (err) {
    console.error('[images:readFileBytes] failed:', err)
    return null
  }
})

ipcMain.handle('images:cacheRemote', async (_event, httpsUrl) => {
  try {
    const u = new URL(httpsUrl)
    if (u.protocol !== 'https:') return null
    const filename = path.basename(decodeURIComponent(u.pathname))
    if (!filename || filename === '.' || filename === '..') return null
    await fs.promises.mkdir(CACHE_DIR(), { recursive: true })
    const dest = path.join(CACHE_DIR(), filename)
    if (!fs.existsSync(dest)) {
      const res = await net.fetch(httpsUrl)
      if (!res.ok) return null
      const bytes = Buffer.from(await res.arrayBuffer())
      await fs.promises.writeFile(dest, bytes)
    }
    return `app-image://cache/${filename}`
  } catch {
    return null
  }
})

ipcMain.handle('images:migrateLegacy', async (_event, filename) => {
  try {
    const safeName = path.basename(String(filename || ''))
    if (!safeName || safeName === '.' || safeName === '..') return false
    const dest = path.join(LOCAL_DIR(), safeName)
    if (fs.existsSync(dest)) return true
    const src = legacyProductPath(safeName)
    if (!fs.existsSync(src)) return false
    await fs.promises.mkdir(LOCAL_DIR(), { recursive: true })
    await fs.promises.copyFile(src, dest)
    return true
  } catch {
    return false
  }
})

// ── Thermal receipt printing ──────────────────────────────────────
ipcMain.handle('printers:list', async () => {
  try {
    const wins = BrowserWindow.getAllWindows()
    if (!wins.length) return []
    const printers = await wins[0].webContents.getPrintersAsync()
    return printers.map((p) => ({ name: p.name, displayName: p.displayName, isDefault: !!p.isDefault }))
  } catch (err) {
    console.error('[printers:list] failed:', err)
    return []
  }
})

ipcMain.handle('printers:printReceipt', (_event, { printerName, html } = {}) => {
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    let win
    try {
      win = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true },
      })
    } catch (err) {
      finish({ ok: false, error: String(err?.message || err) })
      return
    }

    timer = setTimeout(() => {
      try { win.destroy() } catch {}
      finish({ ok: false, error: 'timeout' })
    }, 15000)

    win.webContents.on('did-finish-load', () => {
      try {
        win.webContents.print(
          { silent: true, deviceName: printerName, printBackground: true, margins: { marginType: 'none' } },
          (success, reason) => {
            try { win.destroy() } catch {}
            finish(success ? { ok: true } : { ok: false, error: reason })
          }
        )
      } catch (err) {
        try { win.destroy() } catch {}
        finish({ ok: false, error: String(err?.message || err) })
      }
    })

    win.webContents.on('did-fail-load', (_e, code, desc) => {
      try { win.destroy() } catch {}
      finish({ ok: false, error: desc || `load-failed-${code}` })
    })

    try {
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html || ''))
    } catch (err) {
      try { win.destroy() } catch {}
      finish({ ok: false, error: String(err?.message || err) })
    }
  })
})

app.whenReady().then(async () => {
  protocol.handle('app-image', async (request) => {
    try {
      const u = new URL(request.url)
      const bucket = u.hostname === 'cache' ? CACHE_DIR() : LOCAL_DIR()
      const filename = path.basename(decodeURIComponent(u.pathname))
      if (!filename || filename === '.' || filename === '..') return new Response(null, { status: 400 })
      const filePath = path.join(bucket, filename)
      if (!filePath.startsWith(bucket)) return new Response(null, { status: 403 })
      return net.fetch('file://' + filePath.replace(/\\/g, '/'))
    } catch {
      return new Response(null, { status: 404 })
    }
  })

  // ── Açılış öncesi kurtarma noktası ───────────────────────────────
  // Renderer başlamadan ÖNCE, hiçbir şey veritabanına dokunmadan bir kopya
  // alıyoruz. Sıralama önemli: initDb açılışta doğrulama yapıyor ve bozuk
  // bulursa .bak'a düşüyor — yani dosyayı değiştiren ilk işlem o. Periyodik
  // yedek 90 saniye sonra çalışsaydı, riskli adım çoktan geçmiş olurdu.
  //
  // Özellikle bir SÜRÜM GÜNCELLEMESİNDEN sonraki ilk açılışta değerli:
  // yeni sürüm veritabanına ne yaparsa yapsın, öncesinin kopyası diskte
  // durur. force:true — aralık kontrolünü atlıyoruz, bu yedek her açılışta
  // alınmalı.
  // AWAIT şart: createWindow() renderer'ı başlatıyor ve renderer initDb
  // ile veritabanına dokunan ilk şey oluyor. Beklemezsek "hiçbir şey
  // dokunmadan önce kopya al" garantisi garanti olmaktan çıkıp yarışa
  // dönüşür. Maliyeti bir dosya kopyası (~1 MB, birkaç ms).
  try {
    const res = await takeBackup('acilis-oncesi', { force: true })
    if (res?.ok && !res.skipped) logLine('[backup] acilis oncesi kurtarma noktasi hazir')
    else if (!res?.ok) logLine(`[backup] acilis oncesi yedek alinamadi: ${res?.error}`, 'error')
  } catch (e) {
    // Yedek alınamaması uygulamayı açılmaktan alıkoymamalı.
    logLine(`[backup] acilis oncesi yedek hatasi: ${e && e.message}`, 'error')
  }

  createWindow()
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── Flush the debounced local-DB write before quitting ─────────────
// AppContext persists open tables to sql.js on a ~1s debounce. Quitting
// within that window would otherwise lose the write entirely. We hold the
// quit, ask the renderer to flush immediately, and let it through once the
// renderer acks or FLUSH_TIMEOUT_MS elapses — whichever comes first — so the
// app can never become unquittable even if the renderer is gone/unresponsive.
//
// Two paths can trigger this: the window's own 'close' event (the X button —
// the common case, handled in createWindow while the renderer is still
// alive) and app's 'before-quit' (menu/programmatic quit, autoUpdater
// quitAndInstall — cases where a window may still be alive when quit is
// requested). Both share beginFlush()/flushDone/flushInProgress below so
// whichever path runs first "wins" the flush and the other just rides along
// — neither path waits a second FLUSH_TIMEOUT_MS.
const FLUSH_TIMEOUT_MS = 3000
let allowQuit = false
let flushInProgress = false
let flushDone = false // true once a flush round has finished (ack/timeout/dead renderer) for this quit attempt

// Sends 'flush-before-quit' to win and calls onComplete() once the renderer
// acks, FLUSH_TIMEOUT_MS elapses, or the renderer turns out to be
// unreachable — whichever happens first. Always calls onComplete() exactly
// once; never leaves a dangling ipcMain 'flush-before-quit-ack' listener.
function beginFlush(win, onComplete) {
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
    flushDone = true
    onComplete()
    return
  }

  flushInProgress = true

  const finish = () => {
    if (flushDone) return // ack ve timeout aynı anda yarışırsa ikinci kez çalışmasın
    flushDone = true
    flushInProgress = false
    onComplete()
  }

  const timer = setTimeout(() => {
    console.error('[flush] renderer flush zaman aşımına uğradı — kapatma devam ediyor')
    ipcMain.removeAllListeners('flush-before-quit-ack') // sonraki round'u kirletecek sarkan listener bırakma
    finish()
  }, FLUSH_TIMEOUT_MS)

  ipcMain.once('flush-before-quit-ack', () => {
    clearTimeout(timer)
    finish()
  })

  try {
    win.webContents.send('flush-before-quit')
  } catch (err) {
    console.error('[flush] flush isteği renderer’a gönderilemedi:', err)
    clearTimeout(timer)
    ipcMain.removeAllListeners('flush-before-quit-ack')
    finish()
  }
}

app.on('before-quit', (event) => {
  if (allowQuit) return // quit already cleared — let it proceed normally

  if (flushDone) return // 'close' yolu zaten flush'ı tamamladı — ikinci kez bekleme, normal akışa izin ver
  if (flushInProgress) { event.preventDefault(); return } // başka bir round zaten sürüyor, onu bekle

  event.preventDefault()

  const finishQuit = () => {
    if (allowQuit) return
    allowQuit = true
    app.quit()
  }

  const win = BrowserWindow.getAllWindows()[0]
  beginFlush(win, finishQuit)
})
