import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// sql-wasm.wasm'i node_modules'tan public/ altina kopyalar.
//
// Neden böyle: uygulama bu dosyayı `locateFile: () => './sql-wasm.wasm'` ile,
// yani dist kökünden yüklüyor (`localDb.js`). Eskiden dosya iki yerden
// geliyordu ve ikisi de yanlıştı:
//
//   1. vite-plugin-static-copy `node_modules/sql.js/dist/sql-wasm.wasm`'i
//      kopyalıyordu ama kaynak dizin yapısını koruyarak
//      `dist/node_modules/sql.js/dist/` altına bırakıyordu — uygulamanın
//      aradığı yola HİÇ ulaşmıyordu. (`rename` ile de düzelmiyor.)
//   2. Aynı dosyanın elle konmuş bir kopyası `public/` altında duruyordu ve
//      dist köküne gerçekten ulaşan buydu.
//
// Sonuç: `npm install sql.js@yeni-sürüm` çalıştırmak uygulamaya HİÇ
// yansımıyordu — paket güncellenir, çalışan wasm eski kalırdı. Sessiz ve
// bulunması zor bir tuzak.
//
// Artık tek kaynak node_modules. public/ altındaki dosya türetilmiş bir
// çıktı: hem `vite dev` hem `vite build` başlarken tazeleniyor, Vite de
// public/ içeriğini dist köküne kendi güvenilir yoluyla kopyalıyor.
function syncSqlWasm() {
  return {
    name: 'sync-sql-wasm',
    buildStart() {
      const src = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm')
      const dest = path.resolve('public/sql-wasm.wasm')
      if (!fs.existsSync(src)) {
        this.error(`sql.js wasm dosyası bulunamadı: ${src} — "npm install" çalıştırıldı mı?`)
        return
      }
      // Değişmediyse dokunma: dev modda gereksiz dosya olayı tetiklemesin.
      const same = fs.existsSync(dest) &&
        Buffer.compare(fs.readFileSync(src), fs.readFileSync(dest)) === 0
      if (!same) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(src, dest)
        this.warn('sql-wasm.wasm public/ altına güncellendi (kaynak: node_modules/sql.js)')
      }
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [
    react(),
    syncSqlWasm(),
  ],
})
