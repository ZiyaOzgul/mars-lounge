import { useState, useEffect } from 'react'
import { supabase, isSupabaseReady } from '../../lib/supabase.js'
import { isDbInitialized, findStaffForAuth, getOfflineCredential, saveOfflineCredential } from '../../lib/localDb.js'
import { hashPassword, verifyPassword, setLastPassword } from '../../lib/offlineAuth.js'
import './Login.css'

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`[Login] ${label} ${ms}ms içinde yanıt vermedi`)), ms)
    ),
  ])
}

function Login({ onLogin }) {
  const [email,      setEmail]      = useState('')
  const [password,   setPassword]   = useState('')
  const [error,      setError]      = useState('')
  const [loading,    setLoading]    = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [isOffline,  setIsOffline]  = useState(!navigator.onLine)

  useEffect(() => {
    const up = () => setIsOffline(false)
    const dn = () => setIsOffline(true)
    window.addEventListener('online',  up)
    window.addEventListener('offline', dn)
    return () => {
      window.removeEventListener('online',  up)
      window.removeEventListener('offline', dn)
    }
  }, [])

  // Offline fallback: look up a credential saved on this device during a
  // previous online login, verify the password against its PBKDF2 hash,
  // and log in locally — no Supabase call involved.
  async function offlineLogin(cleanEmail, plainPassword) {
    if (!isDbInitialized()) {
      setError('Yerel veritabanı henüz hazır değil. Lütfen birkaç saniye sonra tekrar deneyin.')
      return
    }
    const cred = getOfflineCredential(cleanEmail)
    if (!cred) {
      setError('Bu cihazda daha önce çevrimiçi giriş yapılmamış — ilk giriş için internet gerekli.')
      return
    }
    let ok = false
    try {
      ok = await verifyPassword(plainPassword, cred)
    } catch (e) {
      console.error('[Login] offline verifyPassword hata', e)
      setError(e?.message ?? 'Çevrimdışı giriş desteklenmiyor.')
      return
    }
    if (!ok) {
      setError('E-posta veya şifre hatalı.')
      return
    }
    setLastPassword(plainPassword)
    onLogin({ ...cred.user, offlineAuth: true })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const cleanEmail = email.trim().toLowerCase()
    const t0 = performance.now()
    console.log('[Login] submit →', { email: cleanEmail, isSupabaseReady, isOffline })
    try {
      if (isOffline || !isSupabaseReady) {
        await offlineLogin(cleanEmail, password)
        return
      }

      // Safety net: if signInWithPassword hangs but Supabase fires SIGNED_IN for this email
      // in the background (e.g. lock-contention edge case), we still treat it as success.
      let signedInUser = null
      const sub = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session?.user?.email?.toLowerCase() === cleanEmail) {
          signedInUser = session.user
          console.log('[Login] arka plan SIGNED_IN event yakalandı, user.id =', signedInUser.id)
        }
      })

      console.time('[Login] signInWithPassword')
      let authUser = null
      try {
        const { data, error: signInError } = await withTimeout(
          supabase.auth.signInWithPassword({ email: cleanEmail, password }),
          15000,
          'signInWithPassword',
        )
        console.timeEnd('[Login] signInWithPassword')
        if (signInError) {
          console.warn('[Login] signIn error', signInError)
          throw signInError
        }
        authUser = data.user
      } catch (signInErr) {
        // Timeout? Check if SIGNED_IN fired in the meantime — if so, recover gracefully.
        if (signedInUser) {
          console.log('[Login] signIn timeout, ama SIGNED_IN geldi — kurtarıldı')
          authUser = signedInUser
        } else {
          sub?.data?.subscription?.unsubscribe()
          throw signInErr
        }
      }
      sub?.data?.subscription?.unsubscribe()
      console.log('[Login] signIn ok, user.id =', authUser?.id ?? null)
      if (!authUser) throw new Error('Giriş başarısız.')

      console.time('[Login] profiles select')
      const { data: profile, error: profileError } = await withTimeout(
        supabase
          .from('profiles')
          .select('full_name, role, can_take_orders, can_close_tables, can_manage_products')
          .eq('id', authUser.id)
          .maybeSingle(),
        10000,
        'profiles select',
      )
      console.timeEnd('[Login] profiles select')
      if (profileError) console.warn('[Login] profiles error (devam ediliyor)', profileError)
      console.log('[Login] profile =', profile ?? '(yok)')

      const finalUser = {
        id:                  authUser.id,
        email:               authUser.email,
        full_name:           profile?.full_name ?? null,
        role:                profile?.role ?? 'waiter',
        can_take_orders:     profile?.can_take_orders     ?? true,
        can_close_tables:    profile?.can_close_tables    ?? false,
        can_manage_products: profile?.can_manage_products ?? false,
      }
      // Yerel personel kaydındaki izinleri bağla (izin düzenlemeleri bir
      // sonraki girişte devreye girer; admin hasPerm'de her zaman geçer)
      try {
        if (isDbInitialized()) {
          const staffRow = findStaffForAuth(finalUser.id, finalUser.email)
          if (staffRow) finalUser.permissions = staffRow.permissions
        }
      } catch (e) {
        console.warn('[Login] personel izinleri okunamadı', e)
      }
      console.log('[Login] onLogin →', finalUser)
      try {
        localStorage.setItem('san-lucas-remember-me', rememberMe ? '1' : '0')
        localStorage.setItem('san-lucas-cached-user', JSON.stringify(finalUser))
      } catch (e) {
        console.warn('[Login] localStorage yazılamadı', e)
      }
      // Save an offline-login credential for this device so the same account
      // can sign in with no internet later. Must complete BEFORE onLogin —
      // that call unmounts this screen, and a half-finished save would only
      // surface later as "bu cihazda giriş yapılmamış" during an outage.
      try {
        if (isDbInitialized()) {
          const cred = await hashPassword(password)
          await saveOfflineCredential({ ...cred, email: cleanEmail, user: finalUser })
        }
      } catch (e) {
        console.warn('[Login] çevrimdışı kimlik bilgisi kaydedilemedi', e)
      }
      setLastPassword(password)
      onLogin(finalUser)
    } catch (err) {
      console.error('[Login] hata', err)
      const msg = err?.message ?? String(err)
      if (/invalid login credentials/i.test(msg)) {
        setError('E-posta veya şifre hatalı.')
      } else if (/fetch|network|yanıt vermedi|Failed to fetch|timeout/i.test(msg)) {
        console.warn('[Login] online giriş ağ hatası — çevrimdışı girişe düşülüyor', msg)
        await offlineLogin(cleanEmail, password)
      } else {
        setError(msg)
      }
    } finally {
      console.log(`[Login] akış bitti (${Math.round(performance.now() - t0)}ms)`)
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img
            src="./mars-lounge-logo.png"
            alt="Mars Lounge Cafe"
            className="login-logo__icon"
          />
          <h1 className="login-logo__name">Mars Lounge</h1>
          <p className="login-logo__sub">Cafe Yönetim Sistemi</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label className="login-label">E-posta</label>
            <input
              className="login-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="ornek@email.com"
              autoComplete="email"
              required
            />
          </div>

          <div className="login-field">
            <label className="login-label">Şifre</label>
            <input
              className="login-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          <label className="login-remember">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={e => setRememberMe(e.target.checked)}
            />
            <span>Beni hatırla</span>
          </label>

          {isOffline && (
            <p className="login-offline-notice">
              Çevrimdışı mod — bu cihazda kayıtlı hesapla giriş yapabilirsiniz.
            </p>
          )}

          {error && <p className="login-error">{error}</p>}

          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'Giriş yapılıyor…' : 'Giriş Yap'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login
