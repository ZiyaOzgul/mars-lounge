const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion:      () => ipcRenderer.sendSync('get-version'),
  getUserDataPath: () => ipcRenderer.sendSync('get-user-data-path'),
  db: {
    read:  ()     => ipcRenderer.invoke('db-read'),
    write: (data) => ipcRenderer.invoke('db-write', data),
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
})
