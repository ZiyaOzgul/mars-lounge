import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import {
  getAllStaff,
  insertStaff,
  updateStaff,
  deleteStaff,
  getStaffItemBreakdown,
  getStaffPerformance,
} from '../../lib/localDb.js'
import {
  createStaffUser,
  updateStaffPermissions,
  deleteStaffUser,
} from '../../lib/supabase.js'
import './Staff.css'

// ── Icons ──────────────────────────────────────────────────────────

const IconPlus = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)
const IconPencil = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)
const IconEye = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
)
const IconSearch = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)
const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/>
  </svg>
)

// ── Helpers ────────────────────────────────────────────────────────

const ROLE_OPTIONS = ['Garson', 'Kasiyer', 'Barista', 'Mutfak', 'Yönetici']

const AVATAR_COLORS = [
  '#e8975a', '#22c55e', '#3b82f6', '#a855f7',
  '#ef4444', '#f59e0b', '#06b6d4', '#ec4899',
]

function avatarColor(name) {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function fmtCurrency(n) {
  return '₺' + Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function todayRange() {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const t = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return [t, t]
}

// ── Toggle Switch ──────────────────────────────────────────────────

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`sm-toggle${checked ? ' sm-toggle--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="sm-toggle__thumb" />
    </button>
  )
}

// ── Permission config ──────────────────────────────────────────────

// Tek kaynak: src/lib/permissions.js — yeni izin anahtarları oraya eklenir,
// bu modal otomatik gösterir.
import { PERMISSION_GROUPS, DEFAULT_PERMISSIONS } from '../../lib/permissions.js'

// ── Add / Edit Modal ───────────────────────────────────────────────

const MOBILE_PERMISSIONS = [
  { key: 'canTakeOrders',     label: 'Sipariş Al',     desc: 'Masaya ürün ekleyebilir' },
  { key: 'canCloseTables',    label: 'Masa Kapat',      desc: 'Ödeme alıp masayı kapatabilir' },
  { key: 'canManageProducts', label: 'Ürün Yönetimi',   desc: 'Ürün ekleyip düzenleyebilir' },
]

const DEFAULT_MOBILE_PERMISSIONS = { canTakeOrders: true, canCloseTables: false, canManageProducts: false }

function StaffModal({ staff, onSave, onDelete, onClose }) {
  const isEdit = !!staff
  const [name,     setName]     = useState(staff?.name    ?? '')
  const [role,     setRole]     = useState(staff?.role    ?? 'Garson')
  const [contact,  setContact]  = useState(staff?.contact ?? '')
  const [email,    setEmail]    = useState(staff?.email   ?? '')
  const [password, setPassword] = useState('')
  const [active,   setActive]   = useState(staff?.isActive ?? true)
  const [perms,    setPerms]    = useState(staff?.permissions ?? { ...DEFAULT_PERMISSIONS })
  const [mobilePerms, setMobilePerms] = useState({
    canTakeOrders:     staff?.permissions?.canTakeOrders     ?? true,
    canCloseTables:    staff?.permissions?.canCloseTables     ?? false,
    canManageProducts: staff?.permissions?.canManageProducts  ?? false,
  })
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  function togglePerm(key) { setPerms(p => ({ ...p, [key]: !p[key] })) }
  function toggleMobile(key) { setMobilePerms(p => ({ ...p, [key]: !p[key] })) }

  async function handleSave() {
    if (!name.trim()) return
    if (!isEdit && !email.trim()) { setError('Mobil uygulama için e-posta gereklidir.'); return }
    if (!isEdit && !password.trim()) { setError('Mobil uygulama için şifre gereklidir.'); return }
    setSaving(true)
    setError('')
    try {
      await onSave({
        id: staff?.id,
        name, role, contact, email, password,
        isActive: active,
        permissions: { ...perms, ...mobilePerms },
        supabaseUid: staff?.supabaseUid ?? null,
      })
    } catch (e) {
      setError(e.message || 'Bir hata oluştu.')
      setSaving(false)
    }
  }

  async function handleDeleteConfirm() {
    setSaving(true)
    try { await onDelete(staff.id, staff.supabaseUid) }
    catch (e) { setError(e.message || 'Silinemedi.'); setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal sm-modal">
        <div className="modal__header">
          <h2 className="modal__title">{isEdit ? 'Personeli Düzenle' : 'Yeni Personel Ekle'}</h2>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="sm-modal__body">
          <section className="sm-modal__section">
            <h3 className="sm-modal__section-title">Bilgiler</h3>
            <div className="sm-modal__fields">
              <div className="sm-modal__field">
                <label className="sm-modal__label">Ad Soyad</label>
                <input className="sm-modal__input" value={name} onChange={e => setName(e.target.value)} placeholder="Çalışan adı" />
              </div>
              <div className="sm-modal__field">
                <label className="sm-modal__label">Rol</label>
                <select className="sm-modal__input" value={role} onChange={e => setRole(e.target.value)}>
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="sm-modal__field">
                <label className="sm-modal__label">İletişim</label>
                <input className="sm-modal__input" value={contact} onChange={e => setContact(e.target.value)} placeholder="Telefon numarası" />
              </div>
              {isEdit && (
                <div className="sm-modal__field sm-modal__field--inline">
                  <div>
                    <label className="sm-modal__label">Durum</label>
                    <span className="sm-modal__sub">Çalışan aktif olarak görünsün mü?</span>
                  </div>
                  <Toggle checked={active} onChange={setActive} />
                </div>
              )}
            </div>
          </section>

          <section className="sm-modal__section">
            <h3 className="sm-modal__section-title">Mobil Uygulama Girişi</h3>
            <div className="sm-modal__fields">
              <div className="sm-modal__field">
                <label className="sm-modal__label">E-posta</label>
                <input
                  className="sm-modal__input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="calisan@email.com"
                  disabled={isEdit && !!staff?.supabaseUid}
                />
                {isEdit && staff?.supabaseUid && (
                  <span className="sm-modal__sub">E-posta değiştirmek için Supabase panelini kullanın.</span>
                )}
              </div>
              <div className="sm-modal__field">
                <label className="sm-modal__label">{isEdit ? 'Yeni Şifre (opsiyonel)' : 'Şifre'}</label>
                <input
                  className="sm-modal__input"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={isEdit ? 'Değiştirmek için girin' : 'Şifre girin'}
                />
              </div>
            </div>
          </section>

          <section className="sm-modal__section">
            <h3 className="sm-modal__section-title">Mobil İzinler</h3>
            <div className="sm-perm-group">
              {MOBILE_PERMISSIONS.map(item => (
                <div key={item.key} className="sm-perm-row">
                  <div className="sm-perm-row__info">
                    <span className="sm-perm-row__name">{item.label}</span>
                    <span className="sm-perm-row__desc">{item.desc}</span>
                  </div>
                  <Toggle checked={!!mobilePerms[item.key]} onChange={() => toggleMobile(item.key)} />
                </div>
              ))}
            </div>
          </section>

          <section className="sm-modal__section">
            <h3 className="sm-modal__section-title">Masaüstü İzinler</h3>
            {PERMISSION_GROUPS.map(group => (
              <div key={group.label} className="sm-perm-group">
                <div className="sm-perm-group__label">{group.label}</div>
                {group.items.map(item => (
                  <div key={item.key} className="sm-perm-row">
                    <div className="sm-perm-row__info">
                      <span className="sm-perm-row__name">{item.label}</span>
                      <span className="sm-perm-row__desc">{item.desc}</span>
                    </div>
                    <Toggle checked={!!perms[item.key]} onChange={() => togglePerm(item.key)} />
                  </div>
                ))}
              </div>
            ))}
          </section>
        </div>

        {error && <p className="sm-modal__error">{error}</p>}

        <div className="sm-modal__footer">
          {isEdit && !confirmDelete && (
            <button className="sm-modal__delete" onClick={() => setConfirmDelete(true)} disabled={saving}>
              <IconTrash /> Sil
            </button>
          )}
          {isEdit && confirmDelete && (
            <button className="sm-modal__delete sm-modal__delete--confirm" onClick={handleDeleteConfirm} disabled={saving}>
              <IconTrash /> Emin misiniz?
            </button>
          )}
          <div className="sm-modal__footer-right">
            <button className="sm-modal__cancel" onClick={onClose} disabled={saving}>İptal</button>
            <button className="sm-modal__save" onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Today's Sales Modal ────────────────────────────────────────────

function TodaySalesModal({ staff, onClose }) {
  const [start, end] = todayRange()
  const items = getStaffItemBreakdown(staff.name, start, end)
  const perf = getStaffPerformance(start, end).find(s => s.name === staff.name) ?? { orderCount: 0, revenue: 0 }
  const color = avatarColor(staff.name)

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal sm-sales-modal">
        <div className="modal__header">
          <div className="sm-sales-modal__staff">
            <div className="sm-avatar" style={{ background: color, width: 38, height: 38, fontSize: 16 }}>
              {staff.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="sm-sales-modal__name">{staff.name}</div>
              <div className="sm-sales-modal__role">{staff.role}</div>
            </div>
          </div>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="sm-sales-modal__body">
          <div className="sm-sales-modal__kpis">
            <div className="sm-sales-kpi">
              <span className="sm-sales-kpi__label">Sipariş Sayısı</span>
              <span className="sm-sales-kpi__value">{perf.orderCount}</span>
            </div>
            <div className="sm-sales-kpi">
              <span className="sm-sales-kpi__label">Toplam Ciro</span>
              <span className="sm-sales-kpi__value">{fmtCurrency(perf.revenue)}</span>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="sm-sales-modal__empty">Bugün henüz satış yok.</div>
          ) : (
            <div className="sm-sales-table">
              <div className="sm-sales-table__head">
                <span>Ürün</span>
                <span>Adet</span>
                <span>Tutar</span>
              </div>
              {items.map((item, i) => (
                <div key={i} className="sm-sales-table__row">
                  <span className="sm-sales-table__name">{item.name}</span>
                  <span className="sm-sales-table__qty">×{item.qty}</span>
                  <span className="sm-sales-table__rev">{fmtCurrency(item.revenue)}</span>
                </div>
              ))}
              <div className="sm-sales-table__total">
                <span>Toplam</span>
                <span />
                <span>{fmtCurrency(perf.revenue)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────

function Staff() {
  const { dbReady } = useApp()
  const [staffList,   setStaffList]   = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [editModal,   setEditModal]   = useState(null) // null | 'new' | staff object
  const [salesModal,  setSalesModal]  = useState(null) // null | staff object
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const loadStaff = useCallback(() => {
    if (!dbReady) return
    setStaffList(getAllStaff())
  }, [dbReady])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the external sql.js store into state
  useEffect(() => { loadStaff() }, [loadStaff])

  const filtered = searchQuery.trim()
    ? staffList.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.role.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : staffList

  async function handleSave({ id, name, role, contact, email, password, isActive, permissions, supabaseUid }) {
    if (id) {
      // Edit existing staff
      await updateStaff({ id, name, role, contact, isActive, permissions })
      if (supabaseUid) {
        await updateStaffPermissions(supabaseUid, permissions)
      }
    } else {
      // Create new staff — also creates Supabase auth user
      const uid = await createStaffUser(email, password, name, permissions)
      await insertStaff({ name, role, contact, email, supabaseUid: uid, permissions })
    }
    loadStaff()
    setEditModal(null)
  }

  async function handleDelete(id, supabaseUid) {
    if (supabaseUid) await deleteStaffUser(supabaseUid)
    await deleteStaff(id)
    loadStaff()
    setEditModal(null)
    setConfirmDeleteId(null)
  }

  return (
    <div className="page sm-page">
      {/* ── Header ── */}
      <div className="sm-header">
        <div className="sm-header__left">
          <h1 className="sm-title">Personel</h1>
          <span className="sm-count">{staffList.filter(s => s.isActive).length} aktif</span>
        </div>
        <div className="sm-header__right">
          <div className="sm-search-wrap">
            <IconSearch />
            <input
              className="sm-search"
              placeholder="İsim veya rol ara…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <button className="sm-add-btn" onClick={() => setEditModal('new')}>
            <IconPlus />
            Personel Ekle
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="sm-card">
        <div className="sm-table">
          <div className="sm-table__head">
            <span>PERSONEL</span>
            <span>ROL</span>
            <span>İLETİŞİM</span>
            <span>DURUM</span>
            <span>İŞLEMLER</span>
          </div>

          {!dbReady ? (
            <div className="sm-table__empty">Yükleniyor…</div>
          ) : filtered.length === 0 ? (
            <div className="sm-table__empty">
              {searchQuery ? 'Sonuç bulunamadı.' : 'Henüz personel eklenmedi.'}
            </div>
          ) : (
            filtered.map(staff => {
              const color = avatarColor(staff.name)
              return (
                <div key={staff.id} className="sm-table__row">
                  <div className="sm-table__cell sm-table__cell--person">
                    <div className="sm-avatar" style={{ background: color, width: 38, height: 38, fontSize: 16 }}>
                      {staff.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="sm-table__name">{staff.name}</div>
                      <div className="sm-table__id">#{String(staff.id).padStart(4, '0')}</div>
                    </div>
                  </div>

                  <div className="sm-table__cell">
                    <span className="sm-role-badge">{staff.role}</span>
                  </div>

                  <div className="sm-table__cell sm-table__cell--contact">
                    {staff.contact || <span className="sm-table__muted">—</span>}
                  </div>

                  <div className="sm-table__cell">
                    {staff.isActive
                      ? <span className="sm-status sm-status--active">● Aktif</span>
                      : <span className="sm-status sm-status--inactive">● İzinli</span>
                    }
                  </div>

                  <div className="sm-table__cell sm-table__cell--actions">
                    <button className="sm-action-btn" title="Düzenle" onClick={() => setEditModal(staff)}>
                      <IconPencil />
                    </button>
                    <button className="sm-action-btn" title="Bugünkü satışlar" onClick={() => setSalesModal(staff)}>
                      <IconEye />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Add / Edit Modal ── */}
      {editModal && (
        <StaffModal
          staff={editModal === 'new' ? null : editModal}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditModal(null)}
        />
      )}

      {/* ── Today's Sales Modal ── */}
      {salesModal && (
        <TodaySalesModal
          staff={salesModal}
          onClose={() => setSalesModal(null)}
        />
      )}

      {/* ── Confirm delete ── */}
      {confirmDeleteId && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteId(null)}>
          <div className="modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">Personeli Sil</h2>
            </div>
            <p style={{ padding: '16px 24px', color: 'var(--color-text-secondary)' }}>
              Bu personeli silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.
            </p>
            <div style={{ display: 'flex', gap: 10, padding: '0 24px 20px', justifyContent: 'flex-end' }}>
              <button className="sm-modal__cancel" onClick={() => setConfirmDeleteId(null)}>İptal</button>
              <button className="sm-modal__delete sm-modal__delete--confirm" onClick={() => handleDelete(confirmDeleteId)}>Sil</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Staff
