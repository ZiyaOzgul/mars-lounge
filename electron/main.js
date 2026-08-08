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
}

ipcMain.on('get-user-data-path', (event) => {
  event.returnValue = app.getPath('userData')
})

ipcMain.on('get-version', (event) => {
  event.returnValue = app.getVersion()
})

// ── SQLite file persistence ───────────────────────────────────────
const DB_FILE = () => path.join(app.getPath('userData'), 'san-lucas.db')

ipcMain.handle('db-read', () => {
  try {
    const buf = fs.readFileSync(DB_FILE())
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  } catch {
    return null // first run — no file yet
  }
})

ipcMain.handle('db-write', (event, data) => {
  try {
    fs.writeFileSync(DB_FILE(), Buffer.from(data))
  } catch (err) {
    console.error('[db-write] failed:', err)
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
