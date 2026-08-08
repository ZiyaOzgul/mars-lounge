import { useState, useEffect, useRef } from 'react'
import { supabase, isSupabaseReady } from '../lib/supabase.js'

function useOnlineStatus({ onReconnect } = {}) {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const onReconnectRef = useRef(onReconnect)
  useEffect(() => { onReconnectRef.current = onReconnect }) // latest-ref pattern

  useEffect(() => {
    console.log(`[Online] hook init — navigator.onLine=${navigator.onLine}, supabaseReady=${isSupabaseReady}`)
    const handleOnline = async () => {
      console.log('[Online] browser online event — Supabase erişilebilirliği test ediliyor…')
      if (isSupabaseReady) {
        try {
          const { error } = await supabase.from('categories').select('id').limit(1)
          if (error) {
            console.warn('[Online] Supabase erişilemez — online işaretlemiyoruz', error)
            return
          }
        } catch (e) {
          console.warn('[Online] Supabase ping atılamadı — online işaretlemiyoruz', e)
          return
        }
      }
      console.log('[Online] ✓ online doğrulandı, onReconnect tetikleniyor')
      setIsOnline(true)
      onReconnectRef.current?.()
    }
    const handleOffline = () => { console.log('[Online] browser offline event'); setIsOnline(false) }

    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { isOnline }
}

export default useOnlineStatus
