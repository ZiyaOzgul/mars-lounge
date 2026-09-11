const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion:      () => ipcRenderer.sendSync('get-version'),
  getUserDataPath: () => ipcRenderer.sendSync('get-user-data-path'),
  db: {
    read:       ()     => ipcRenderer.invoke('db-read'),
    readBackup: ()     => ipcRenderer.invoke('db-read-backup'),
    write:      (data) => ipcRenderer.invoke('db-write', data),
  },
  images: {
    pickAndSave: async () => {
      const srcPath = await ipcRenderer.invoke('images:pick')
      if (!srcPath) return null
      return ipcRenderer.invoke('images:save', srcPath)
    },
    readFileBytes: (relativePath) => ipcRenderer.invoke('images:readFileBytes', relativePath),
    deleteFile:    (relativePath) => ipcRenderer.invoke('images:delete', relativePath),
    cacheRemote:   (httpsUrl) => ipcRenderer.invoke('images:cacheRemote', httpsUrl),
    migrateLegacy: (filename) => ipcRenderer.invoke('images:migrateLegacy', filename),
  },
  printers: {
    list:         () => ipcRenderer.invoke('printers:list'),
    printReceipt: (printerName, html) => ipcRenderer.invoke('printers:printReceipt', { printerName, html }),
  },
  lifecycle: {
    // Main asks the renderer to flush its pending debounced DB write before
    // quitting. Returns an unsubscribe function, matching the other
    // listener-style APIs in this file.
    onFlushBeforeQuit: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('flush-before-quit', handler)
      return () => ipcRenderer.removeListener('flush-before-quit', handler)
    },
    ackFlushBeforeQuit: () => ipcRenderer.send('flush-before-quit-ack'),
  },
})
