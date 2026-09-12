/**
 * Small in-renderer log ring, kept as module state so it survives an
 * ErrorBoundary reset/remount and is reachable both from React render errors
 * (ErrorBoundary.componentDidCatch) and from the global window 'error' /
 * 'unhandledrejection' listeners registered in main.jsx — those catch async
 * errors that a boundary structurally cannot. Not persisted to disk; it only
 * needs to outlive the current app session so "Kopyala" has something to grab.
 *
 * Split out of ErrorBoundary.jsx so that file exports only the component
 * (required for React Fast Refresh).
 */
const MAX_LOG_ENTRIES = 20
const errorLogRing = []

export function pushErrorLog(entry) {
  errorLogRing.push({ time: new Date().toISOString(), ...entry })
  if (errorLogRing.length > MAX_LOG_ENTRIES) errorLogRing.shift()
}

export function getErrorLog() {
  return [...errorLogRing]
}
