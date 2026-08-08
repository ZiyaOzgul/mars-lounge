import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import './styles/layout.css'
import { AppProvider, useApp } from './context/AppContext.jsx'
import { hasPerm, firstAllowedRoute } from './lib/permissions.js'
import Navbar from './components/Navbar/Navbar.jsx'
import useOnlineStatus from './hooks/useOnlineStatus.js'
import Tables from './pages/Tables/Tables.jsx'
import Orders from './pages/Orders/Orders.jsx'
import Products from './pages/Products/Products.jsx'
import Ingredients from './pages/Ingredients/Ingredients.jsx'
import Reports from './pages/Reports/Reports.jsx'
import Staff from './pages/Staff/Staff.jsx'
import Members from './pages/Members/Members.jsx'
import Settings from './pages/Settings/Settings.jsx'
import Login from './pages/Login/Login.jsx'
import ClosedTables from './pages/ClosedTables/ClosedTables.jsx'

// Rota koruması: izin yoksa kullanıcının erişebildiği ilk sayfaya yönlendir.
// permKey null → sadece admin (Personel sayfası).
function RequireP({ permKey, children }) {
  const { currentUser } = useApp()
  const location = useLocation()
  const allowed = permKey === null
    ? currentUser?.role === 'admin'
    : hasPerm(currentUser, permKey)
  if (!allowed) {
    const target = firstAllowedRoute(currentUser)
    // Hiçbir sayfaya izni yoksa yönlendirme döngüsüne girme — mesaj göster
    if (target === location.pathname) {
      return <div className="db-loading">Bu sayfaya erişim yetkiniz yok. Yöneticinizle iletişime geçin.</div>
    }
    return <Navigate to={target} replace />
  }
  return children
}

function AppShell() {
  const { dbReady, dbError, triggerSync } = useApp()
  const { isOnline } = useOnlineStatus({ onReconnect: triggerSync })

  // Sync once on startup if online and DB is ready
  useEffect(() => {
    if (dbReady && navigator.onLine) triggerSync()
  }, [dbReady]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!dbReady) {
    return (
      <div className="app-layout">
        <div className="db-loading">
          <span className="db-loading__dot" />
          Veritabanı yükleniyor…
        </div>
      </div>
    )
  }

  return (
    <div className="app-layout">
      <Navbar />
      <div className="page-content">
        {dbError && (
          <div className="db-error-banner">
            ⚠ Veritabanı hatası: {dbError}
          </div>
        )}
        {!isOnline && (
          <div className="offline-banner">
            <span className="offline-banner__dot" />
            Çevrimdışı — Değişiklikler yerel olarak kaydedilecek ve bağlantı kurulduğunda senkronize edilecek.
          </div>
        )}
        <Routes>
          <Route path="/"         element={<RequireP permKey="tables"><Tables /></RequireP>} />
          <Route path="/orders"   element={<RequireP permKey="orders"><Orders /></RequireP>} />
          <Route path="/closed-tables" element={<RequireP permKey="closed_tables"><ClosedTables /></RequireP>} />
          <Route path="/products"    element={<RequireP permKey="products_view"><Products /></RequireP>} />
          <Route path="/ingredients" element={<RequireP permKey="ingredients"><Ingredients /></RequireP>} />
          <Route path="/reports"     element={<RequireP permKey="reports"><Reports /></RequireP>} />
          <Route path="/staff"       element={<RequireP permKey={null}><Staff /></RequireP>} />
          <Route path="/members"     element={<RequireP permKey={null}><Members /></RequireP>} />
          <Route path="/settings" element={<RequireP permKey="settings"><Settings /></RequireP>} />
        </Routes>
      </div>
    </div>
  )
}

function AppContent() {
  const { currentUser, loginUser, authReady } = useApp()
  if (!authReady) {
    return (
      <div className="app-layout">
        <div className="db-loading">
          <span className="db-loading__dot" />
          Sunucuya bağlanılıyor…
        </div>
      </div>
    )
  }
  return currentUser ? <AppShell /> : <Login onLogin={loginUser} />
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  )
}

export default App
