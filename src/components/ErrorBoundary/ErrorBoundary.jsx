import { Component } from 'react'
import { pushErrorLog } from './errorLog.js'
import './ErrorBoundary.css'

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
    this.state = { hasError: false, error: null, componentStack: null, copied: false }
    this.handleReset = this.handleReset.bind(this)
    this.handleCopy = this.handleCopy.bind(this)
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
    this.setState({ componentStack })
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

    const { error, componentStack, copied } = this.state

    return (
      <div className="error-boundary">
        <div className="error-boundary__card">
          <div className="error-boundary__icon">⚠</div>
          <h1 className="error-boundary__title">Bir şeyler ters gitti</h1>
          <p className="error-boundary__desc">
            Uygulamada beklenmeyen bir hata oluştu. Hata bu ekranla sınırlı tutuldu —
            yerel verileriniz (masalar, siparişler, ürünler) güvende, hiçbir kayıt
            silinmedi. Aşağıdaki "Yeniden Dene" ile devam edebilir, sorun sürerse
            hata ayrıntılarını kopyalayıp destek ekibine iletebilirsiniz.
          </p>
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
            <button
              type="button"
              className="error-boundary__btn error-boundary__btn--primary"
              onClick={this.handleReset}
            >
              Yeniden Dene
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
