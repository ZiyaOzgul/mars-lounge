import { useState, useRef, useEffect } from 'react'
import './PrintButton.css'

const LAST_PRINTER_KEY = 'san-lucas-last-printer'

function PrinterIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  )
}

// Reusable "Yazdır" (print receipt) button + printer picker, backed by the
// Electron thermal-printer bridge. Caller supplies buildHtml() so the
// button has no knowledge of where the receipt data comes from.
// - compact: icon-only square button (label moves to the title attribute)
// - dropUp: opens the picker above the button instead of below — needed
//   when the button lives in a bottom footer with no room underneath
function PrintButton({ buildHtml, compact = false, dropUp = false }) {
  const hasPrinterBridge = typeof window !== 'undefined' && !!window.electronAPI?.printers
  const [pickerOpen,   setPickerOpen]   = useState(false)
  const [printerList,  setPrinterList]  = useState([])
  const [loading,      setLoading]      = useState(false)
  const [printStatus,  setPrintStatus]  = useState(null) // { printerName, state: 'printing'|'error', message }
  const [lastPrinter,  setLastPrinter]  = useState(() => {
    try { return localStorage.getItem(LAST_PRINTER_KEY) } catch { return null }
  })
  const anchorRef = useRef(null)

  // Close the picker when clicking outside its anchor
  useEffect(() => {
    if (!pickerOpen) return
    const onDocClick = (e) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [pickerOpen])

  const togglePicker = async () => {
    if (pickerOpen) { setPickerOpen(false); return }
    setPrintStatus(null)
    setPickerOpen(true)
    if (!hasPrinterBridge) return
    setLoading(true)
    try {
      const list = await window.electronAPI.printers.list()
      setPrinterList(Array.isArray(list) ? list : [])
    } catch (e) {
      console.warn('[PrintButton] yazıcı listesi alınamadı', e)
      setPrinterList([])
    } finally {
      setLoading(false)
    }
  }

  const handlePrint = async (printerName) => {
    setPrintStatus({ printerName, state: 'printing' })
    try {
      const html = buildHtml()
      const result = await window.electronAPI.printers.printReceipt(printerName, html)
      if (result?.ok) {
        try { localStorage.setItem(LAST_PRINTER_KEY, printerName) } catch {}
        setLastPrinter(printerName)
        setPrintStatus(null)
        setPickerOpen(false)
      } else {
        setPrintStatus({ printerName, state: 'error', message: `Yazdırılamadı: ${result?.error || 'bilinmeyen hata'}` })
      }
    } catch (e) {
      setPrintStatus({ printerName, state: 'error', message: `Yazdırılamadı: ${e?.message || 'bilinmeyen hata'}` })
    }
  }

  return (
    <div className={`pb-print ${dropUp ? 'pb-print--drop-up' : ''}`} ref={anchorRef}>
      <button
        className={`pb-print__btn ${compact ? 'pb-print__btn--compact' : ''}`}
        onClick={togglePicker}
        title="Fişi Yazdır"
      >
        <PrinterIcon />
        {!compact && <span>Yazdır</span>}
      </button>
      {pickerOpen && (
        <div className="pb-print__picker">
          <div className="pb-print__picker-title">Yazıcı Seç</div>
          {!hasPrinterBridge && (
            <p className="pb-print__note">Yazdırma yalnızca masaüstü uygulamasında.</p>
          )}
          {hasPrinterBridge && loading && (
            <p className="pb-print__note">Yazıcılar aranıyor…</p>
          )}
          {hasPrinterBridge && !loading && printerList.length === 0 && (
            <p className="pb-print__note">Yazıcı bulunamadı.</p>
          )}
          {hasPrinterBridge && !loading && printerList.map((p) => (
            <button
              key={p.name}
              className={`pb-print__row ${p.name === lastPrinter ? 'pb-print__row--last' : ''}`}
              onClick={() => handlePrint(p.name)}
              disabled={printStatus?.state === 'printing'}
            >
              <span className="pb-print__row-name">{p.displayName || p.name}</span>
              <span className="pb-print__row-tags">
                {p.isDefault && <span className="pb-print__chip">varsayılan</span>}
                {p.name === lastPrinter && <span className="pb-print__chip pb-print__chip--last">son kullanılan</span>}
              </span>
            </button>
          ))}
          {printStatus && (
            <p className={`pb-print__status ${printStatus.state === 'error' ? 'pb-print__status--error' : ''}`}>
              {printStatus.state === 'printing' ? 'Yazdırılıyor…' : printStatus.message}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default PrintButton
