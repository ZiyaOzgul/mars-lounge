import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './styles/global.css'
import './styles/components.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary.jsx'
import { pushErrorLog } from './components/ErrorBoundary/errorLog.js'

// Async errors (rejected promises, timers, event handlers) never reach a
// React ErrorBoundary — it only catches errors thrown during render/lifecycle.
// These global listeners catch the rest so they're at least logged loudly
// instead of vanishing into a white-screen-with-no-clue.
window.addEventListener('error', (event) => {
  const err = event.error
  console.error('[GlobalError]', err ?? event.message, event)
  pushErrorLog({
    source: 'GlobalError',
    message: err?.message ?? event.message ?? String(event),
    stack: err?.stack ?? '',
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  console.error('[UnhandledRejection]', reason)
  pushErrorLog({
    source: 'UnhandledRejection',
    message: reason?.message ?? String(reason),
    stack: reason?.stack ?? '',
  })
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </HashRouter>
  </StrictMode>
)
