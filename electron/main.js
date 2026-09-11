const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const fs   = require('fs')

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

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

  autoUpdater.on('update-downloaded', async (info) => {
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
    }
  })

  autoUpdater.on('error', (err) => {
    console.error('[auto-updater] error:', err)
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

ipcMain.on('get-user-data-path', (event) => {
  event.returnValue = app.getPath('userData')
})

ipcMain.on('get-version', (event) => {
  event.returnValue = app.getVersion()
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

ipcMain.handle('db-write', (event, data) => {
  try {
    const dbFile  = DB_FILE()
    const tmpFile = DB_TMP_FILE()
    const bakFile = DB_BAK_FILE()

    // 1) Write the new bytes to a scratch file first — if this fails or is
    //    interrupted, the live db file is never touched.
    fs.writeFileSync(tmpFile, Buffer.from(data))

    // 2) Roll the current live file into .bak *before* replacing it, so
    //    there is always one previous generation to recover from.
    try {
      const stat = fs.statSync(dbFile)
      if (stat.size > 0) fs.copyFileSync(dbFile, bakFile)
    } catch {
      // No existing file yet (first run) — nothing to back up.
    }

    // 3) Same-volume rename is atomic on NTFS/Windows — the live file either
    //    stays as the previous generation or becomes the new one in full,
    //    never a partial write.
    fs.renameSync(tmpFile, dbFile)
  } catch (err) {
    console.error('[db-write] KRİTİK: veritabanı dosyası diske yazılamadı:', err)
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

app.whenReady().then(() => {
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
