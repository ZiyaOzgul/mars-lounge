import { Component } from 'react'
import { pushErrorLog } from './errorLog.js'
import { isWasmTrap } from '../../lib/localDb.js'
import './ErrorBoundary.css'

// WASM tuzağından sonra kaç saniye içinde otomatik kurtarılsın.
// Otomatik davranmak burada güvenli: motor zaten ölü, beklenerek
// kurtarılacak bir işlem yok — tek alternatif kasiyerin uygulamayı
// kapatıp açması, ki müşterinin şikâyeti tam olarak bu.
const AUTO_RECOVER_SECONDS = 10

function formatErrorText(error, componentStack) {
  return [
    `Hata: ${error?.message ?? String(error)}`,
    '',
    'Yığın izleme:',
    error?.stack ?? '(yok)',
    ...(componentStack ? ['', 'Bileşen yığını:', componentStack] : []),
  ].join('\n')
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = {
      hasError: false, error: null, componentStack: null, copied: false,
      dbDead: false, countdown: null,
    }
    this.timer = null
    this.handleReset = this.handleReset.bind(this)
    this.handleCopy = this.handleCopy.bind(this)
    this.handleRecover = this.handleRecover.bind(this)
    this.stopCountdown = this.stopCountdown.bind(this)
  }

  // ErrorBoundary YALNIZCA render sırasındaki hataları yakalar. Veritabanı
  // çağrılarının büyük çoğunluğu ise async event handler'ların içinden gelir
  // (masaya ürün ekle, ödeme al, senkron turu) — oradaki bir WASM tuzağı
  // boundary'ye hiç uğramaz, sessizce "unhandled rejection" olur ve ekran
  // öylece donuk kalır. Bu iki dinleyici o boşluğu kapatıyor. Sadece WASM
  // tuzaklarını ele alıyoruz; sıradan ağ/mantık hataları eskisi gibi
  // konsola düşmeye devam etsin diye dokunmuyoruz.
  componentDidMount() {
    this.onRejection = (event) => {
      const reason = event?.reason
      if (!isWasmTrap(reason)) return
      event.preventDefault()
      this.reportAsyncTrap(reason)
    }
    this.onWindowError = (event) => {
      if (!isWasmTrap(event?.error)) return
      this.reportAsyncTrap(event.error)
    }
    window.addEventListener('unhandledrejection', this.onRejection)
    window.addEventListener('error', this.onWindowError)
  }

  reportAsyncTrap(error) {
    if (this.state.hasError) return // zaten kurtarma ekranındayız
    console.error('[ErrorBoundary] async WASM tuzağı yakalandı:', error)
    pushErrorLog({
      source: 'ErrorBoundary/async',
      message: error?.message ?? String(error),
      stack: error?.stack ?? '',
      componentStack: '',
    })
    this.setState({ hasError: true, error, componentStack: '', dbDead: true })
    this.startCountdown()
  }

  componentWillUnmount() {
    if (this.timer) clearInterval(this.timer)
    window.removeEventListener('unhandledrejection', this.onRejection)
    window.removeEventListener('error', this.onWindowError)
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    const componentStack = errorInfo?.componentStack ?? ''
    console.error('[ErrorBoundary] Yakalanan render hatası:', error, componentStack)
    pushErrorLog({
      source: 'ErrorBoundary',
      message: error?.message ?? String(error),
      stack: error?.stack ?? '',
      componentStack,
    })
    // sql.js WASM tuzağı ("memory access out of bounds") diğer hatalardan
    // tamamen farklı: JS sağlam ama veritabanı motoru ÖLDÜ. Bu durumda
    // "Yeniden Dene" hiçbir işe yaramaz — aynı ağaç yeniden render edilir,
    // ilk sorgu yine patlar ve kullanıcı bu ekrana geri döner. Tek çıkış
    // renderer'ı baştan yükleyip veritabanını diskten yeniden kurmak.
    const dbDead = isWasmTrap(error)
    this.setState({ componentStack, dbDead })
    if (dbDead) this.startCountdown()
  }

  startCountdown() {
    this.setState({ countdown: AUTO_RECOVER_SECONDS })
    this.timer = setInterval(() => {
      this.setState(prev => {
        if (prev.countdown === null) return null
        if (prev.countdown <= 1) { this.handleRecover(); return { countdown: 0 } }
        return { countdown: prev.countdown - 1 }
      })
    }, 1000)
  }

  stopCountdown() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    this.setState({ countdown: null })
  }

  // Renderer'ı baştan yükle: initDb diskteki son kayıtlı dosyadan
  // (gerekirse .bak'tan) veritabanını yeniden kurar.
  handleRecover() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    window.location.reload()
  }

  handleReset() {
    this.setState({ hasError: false, error: null, componentStack: null, copied: false })
  }

  async handleCopy() {
    const text = formatErrorText(this.state.error, this.state.componentStack)
    try {
      await navigator.clipboard.writeText(text)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2000)
    } catch (e) {
      console.error('[ErrorBoundary] Panoya kopyalanamadı', e)
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const { error, componentStack, copied, dbDead, countdown } = this.state

    return (
      <div className="error-boundary">
        <div className="error-boundary__card">
          <div className="error-boundary__icon">⚠</div>
          <h1 className="error-boundary__title">
            {dbDead ? 'Veritabanı motoru durdu' : 'Bir şeyler ters gitti'}
          </h1>
          {dbDead ? (
            <p className="error-boundary__desc">
              Veritabanı motoru beklenmedik şekilde durdu. <strong>Diske kaydedilmiş
              veriler güvende</strong> — masalar, siparişler ve ürünler yerinde duruyor.
              Uygulama kendini onaracak; en son yapılan ve henüz kaydedilmemiş tek bir
              işlem kaybolmuş olabilir, onarımdan sonra açık masaları kontrol edin.
            </p>
          ) : (
            <p className="error-boundary__desc">
              Uygulamada beklenmeyen bir hata oluştu. Hata bu ekranla sınırlı tutuldu ve
              diske kaydedilmiş verilere dokunulmadı. Aşağıdaki "Yeniden Dene" ile devam
              edebilir, sorun sürerse hata ayrıntılarını kopyalayıp destek ekibine
              iletebilirsiniz.
            </p>
          )}
          {dbDead && countdown !== null && (
            <p className="error-boundary__countdown">
              {countdown} saniye içinde otomatik olarak onarılacak…
            </p>
          )}
          <details className="error-boundary__details" open>
            <summary className="error-boundary__summary">Hata ayrıntıları</summary>
            <pre className="error-boundary__pre">{formatErrorText(error, componentStack)}</pre>
          </details>
          <div className="error-boundary__actions">
            <button
              type="button"
              className="error-boundary__btn error-boundary__btn--secondary"
              onClick={this.handleCopy}
            >
              {copied ? 'Kopyalandı ✓' : 'Kopyala'}
            </button>
            {dbDead && countdown !== null && (
              <button
                type="button"
                className="error-boundary__btn error-boundary__btn--secondary"
                onClick={this.stopCountdown}
              >
                Beklet
              </button>
            )}
            <button
              type="button"
              className="error-boundary__btn error-boundary__btn--primary"
              onClick={dbDead ? this.handleRecover : this.handleReset}
            >
              {dbDead ? 'Şimdi Onar' : 'Yeniden Dene'}
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
