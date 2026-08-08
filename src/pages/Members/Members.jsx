import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { listMembers, setMemberPoints, deleteMember } from '../../lib/supabase.js'
import ConfirmModal from '../../components/ConfirmModal/ConfirmModal.jsx'
import './Members.css'

// ── Icons ──────────────────────────────────────────────────────────

const IconSearch = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)
const IconRefresh = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
  </svg>
)
const IconPencil = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)
const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/>
  </svg>
)
const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)
const IconX = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const IconStar = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
)

// ── Helpers ────────────────────────────────────────────────────────

function fmtCurrency(n) {
  return '₺' + Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtJoinDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ── Main Component ─────────────────────────────────────────────────

function Members() {
  const { pointRate } = useApp()
  const [members,     setMembers]     = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [isOnline,    setIsOnline]    = useState(navigator.onLine)

  const [editingUid, setEditingUid] = useState(null)
  const [editValue,  setEditValue]  = useState('')
  const [savingUid,  setSavingUid]  = useState(null)
  const [rowError,   setRowError]   = useState({}) // uid -> message

  const [confirmTarget, setConfirmTarget] = useState(null) // member object
  const [deletingUid,   setDeletingUid]   = useState(null)

  const loadMembers = useCallback(async () => {
    if (!navigator.onLine) return
    setLoading(true)
    setError('')
    try {
      const data = await listMembers()
      setMembers(data)
    } catch (e) {
      setError(e.message || 'Üyeler yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [])

  // İlk yükleme — sadece çevrimiçiyken
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Edge Function üzerinden ilk fetch
  useEffect(() => { if (navigator.onLine) loadMembers() }, [loadMembers])

  // Çevrimiçi/çevrimdışı geçişlerini izle
  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); loadMembers() }
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [loadMembers])

  const filtered = searchQuery.trim()
    ? members.filter(m =>
        (m.fullName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.email || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : members

  function startEdit(member) {
    setEditingUid(member.uid)
    setEditValue(String(member.points ?? 0))
    setRowError(prev => ({ ...prev, [member.uid]: '' }))
  }

  function cancelEdit() {
    setEditingUid(null)
    setEditValue('')
  }

  async function saveEdit(member) {
    const parsed = Number(editValue)
    if (!Number.isInteger(parsed) || parsed < 0) {
      setRowError(prev => ({ ...prev, [member.uid]: 'Geçerli bir tam sayı girin (0 veya üzeri).' }))
      return
    }
    const prevPoints = member.points
    setEditingUid(null)
    setSavingUid(member.uid)
    setMembers(list => list.map(m => (m.uid === member.uid ? { ...m, points: parsed } : m)))
    try {
      await setMemberPoints(member.uid, parsed)
      setRowError(prev => ({ ...prev, [member.uid]: '' }))
    } catch (e) {
      setMembers(list => list.map(m => (m.uid === member.uid ? { ...m, points: prevPoints } : m)))
      setRowError(prev => ({ ...prev, [member.uid]: e.message || 'Puan güncellenemedi.' }))
    } finally {
      setSavingUid(null)
    }
  }

  async function handleDeleteConfirm() {
    if (!confirmTarget) return
    const target = confirmTarget
    setDeletingUid(target.uid)
    setConfirmTarget(null)
    try {
      await deleteMember(target.uid)
      setMembers(list => list.filter(m => m.uid !== target.uid))
    } catch (e) {
      setRowError(prev => ({ ...prev, [target.uid]: e.message || 'Üye silinemedi.' }))
    } finally {
      setDeletingUid(null)
    }
  }

  return (
    <div className="page mm-page">
      {/* ── Header ── */}
      <div className="mm-header">
        <div className="mm-header__left">
          <h1 className="mm-title">Üyeler</h1>
          <span className="mm-count">{members.length} kayıtlı üye</span>
        </div>
        <div className="mm-header__right">
          <div className="mm-search-wrap">
            <IconSearch />
            <input
              className="mm-search"
              placeholder="İsim veya e-posta ara…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              disabled={!isOnline}
            />
          </div>
          <button
            className="mm-refresh-btn"
            title="Yenile"
            onClick={loadMembers}
            disabled={!isOnline || loading}
          >
            <IconRefresh />
          </button>
        </div>
      </div>

      {!isOnline ? (
        /* ── Offline notice ── */
        <div className="mm-offline">
          <div className="mm-offline__title">Bu sayfa çevrimiçi bağlantı gerektirir</div>
          <p className="mm-offline__sub">
            Üye listesi ve puan işlemleri sunucudaki bir Edge Function üzerinden yürütülür.
            Bağlantı kurulduğunda liste otomatik olarak yüklenecektir.
          </p>
        </div>
      ) : (
        <div className="mm-card">
          {error && (
            <div className="mm-error-banner">
              <span>{error}</span>
              <button className="mm-retry-btn" onClick={loadMembers}>Tekrar Dene</button>
            </div>
          )}

          <div className="mm-table">
            <div className="mm-table__head">
              <span>ÜYE</span>
              <span>KAYIT TARİHİ</span>
              <span>PUAN</span>
              <span>İŞLEMLER</span>
            </div>

            {loading ? (
              <div className="mm-table__empty">Yükleniyor…</div>
            ) : filtered.length === 0 ? (
              <div className="mm-table__empty">
                {searchQuery ? 'Sonuç bulunamadı.' : 'Henüz kayıtlı üye yok.'}
              </div>
            ) : (
              filtered.map(member => {
                const initials = (member.fullName || member.email || '?').charAt(0).toUpperCase()
                const isEditing = editingUid === member.uid
                const points = member.points ?? 0

                return (
                  <div key={member.uid} className="mm-table__row">
                    <div className="mm-table__cell mm-table__cell--person">
                      <div className="mm-avatar">{initials}</div>
                      <div>
                        <div className="mm-table__name">{member.fullName || 'İsimsiz Üye'}</div>
                        <div className="mm-table__email">{member.email || '—'}</div>
                      </div>
                    </div>

                    <div className="mm-table__cell mm-table__cell--date">
                      {fmtJoinDate(member.createdAt)}
                    </div>

                    <div className="mm-table__cell mm-table__cell--points">
                      {isEditing ? (
                        <div className="mm-points-edit">
                          <input
                            className="mm-points-input"
                            type="number"
                            min="0"
                            step="1"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveEdit(member)
                              if (e.key === 'Escape') cancelEdit()
                            }}
                          />
                          <button className="mm-points-btn mm-points-btn--save" title="Kaydet" onClick={() => saveEdit(member)}>
                            <IconCheck />
                          </button>
                          <button className="mm-points-btn mm-points-btn--cancel" title="İptal" onClick={cancelEdit}>
                            <IconX />
                          </button>
                        </div>
                      ) : (
                        <div className="mm-points-display">
                          <div className="mm-points-info">
                            <span className="mm-points-badge">
                              <IconStar /> {points}
                            </span>
                            <span className="mm-points-value">≈ {fmtCurrency(points * pointRate)}</span>
                          </div>
                          <button
                            className="mm-action-btn"
                            title="Puanı Düzenle"
                            onClick={() => startEdit(member)}
                            disabled={savingUid === member.uid}
                          >
                            <IconPencil />
                          </button>
                        </div>
                      )}
                      {rowError[member.uid] && <div className="mm-row-error">{rowError[member.uid]}</div>}
                    </div>

                    <div className="mm-table__cell mm-table__cell--actions">
                      <button
                        className="mm-action-btn mm-action-btn--danger"
                        title="Üyeliği Sil"
                        onClick={() => setConfirmTarget(member)}
                        disabled={deletingUid === member.uid}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      <ConfirmModal
        open={!!confirmTarget}
        title="Üyeliği Sil"
        message={
          confirmTarget
            ? `"${confirmTarget.fullName || confirmTarget.email}" adlı üyenin üyeliği ve giriş hesabı kalıcı olarak silinir; geçmiş siparişleri etkilenmez.`
            : ''
        }
        confirmText="Sil"
        cancelText="İptal"
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  )
}

export default Members
