import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import {
  getVeresiyeLedger,
  getVeresiyeByPerson,
  settleVeresiyeMany,
  unsettleVeresiye,
  deleteVeresiye,
  isDbInitialized,
} from '../../lib/localDb.js'
import ConfirmModal from '../../components/ConfirmModal/ConfirmModal.jsx'
import './Veresiye.css'

const STATUS_TABS = [
  { id: 'open',    label: 'Ödenmedi' },
  { id: 'settled', label: 'Ödendi' },
  { id: 'all',     label: 'Tümü' },
]

const SETTLE_METHODS = [
  { id: 'cash', label: 'Nakit' },
  { id: 'card', label: 'Kart' },
  { id: 'iban', label: 'IBAN' },
]

const fmtTL = (n) =>
  '₺' + Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString('tr-TR', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '—'

// Yerel takvim tarihi — tarih filtresi input[type=date] ile aynı biçimde olmalı
const pad = (n) => String(n).padStart(2, '0')
const localDate = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function Veresiye() {
  const { dbReady } = useApp()
  const [status, setStatus] = useState('open')
  const [rows, setRows] = useState([])
  const [people, setPeople] = useState([])
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [busyId, setBusyId] = useState(null)
  // Secili borc kayitlari (payment id). Ayni kisinin birden fazla borcu
  // alt alta siralanip kafa karistirmasin diye kisi bazinda gruplanıyor ve
  // tahsilat/silme secim uzerinden yapılıyor.
  const [selected, setSelected] = useState(() => new Set())
  const [deleteTarget, setDeleteTarget] = useState(null)

  const reload = useCallback((nextStatus) => {
    if (!isDbInitialized()) return
    try {
      setRows(getVeresiyeLedger({ status: nextStatus }))
      setPeople(getVeresiyeByPerson())
    } catch (e) {
      console.warn('[Veresiye] defter okunamadı', e)
    }
  }, [])

  useEffect(() => {
    if (!dbReady) return
    reload(status)
  }, [dbReady, status, reload])

  // İsim ve tarih filtreleri liste üzerinde uygulanır — kayıt sayısı düşük,
  // her tuşta veritabanına gitmeye gerek yok.
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR')
    return rows.filter((r) => {
      if (q && !r.name.toLocaleLowerCase('tr-TR').includes(q)) return false
      const d = localDate(r.createdAt)
      if (dateFrom && d < dateFrom) return false
      if (dateTo && d > dateTo) return false
      return true
    })
  }, [rows, search, dateFrom, dateTo])

  const shownTotal = filtered.reduce((s, r) => s + Number(r.amount || 0), 0)
  const openTotal = people.reduce((s, p) => s + Number(p.total || 0), 0)

  // Kisi bazinda grupla. Ayni isimden birden fazla borc varsa tek kart
  // altinda toplanıyor.
  const grouped = useMemo(() => {
    const map = new Map()
    for (const r of filtered) {
      if (!map.has(r.name)) map.set(r.name, [])
      map.get(r.name).push(r)
    }
    return [...map.entries()]
      .map(([name, list]) => {
        const open = list.filter((r) => !r.settledAt)
        return {
          name,
          rows: list,
          total: list.reduce((s, r) => s + Number(r.amount || 0), 0),
          openRows: open,
          openTotal: open.reduce((s, r) => s + Number(r.amount || 0), 0),
        }
      })
      .sort((a, b) => b.openTotal - a.openTotal || a.name.localeCompare(b.name, 'tr'))
  }, [filtered])

  // Filtre/sekme degisince secim gecersiz kalir — ekranda gorunmeyen bir
  // kaydin secili kalmasi ve yanlislikla tahsil edilmesi tehlikeli.
  useEffect(() => { setSelected(new Set()) }, [status, search, dateFrom, dateTo])

  const toggleOne = (id) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const toggleGroup = (g) => setSelected((prev) => {
    const next = new Set(prev)
    const ids = g.openRows.map((r) => r.id)
    const hepsiSecili = ids.length > 0 && ids.every((id) => next.has(id))
    for (const id of ids) { if (hepsiSecili) next.delete(id); else next.add(id) }
    return next
  })

  const groupSelection = (g) => {
    const ids = g.openRows.filter((r) => selected.has(r.id)).map((r) => r.id)
    const tutar = g.openRows
      .filter((r) => selected.has(r.id))
      .reduce((s, r) => s + Number(r.amount || 0), 0)
    return { ids, tutar }
  }

  const handleSettleSelected = async (g, method) => {
    const { ids } = groupSelection(g)
    if (!ids.length) return
    setBusyId(g.name)
    try {
      await settleVeresiyeMany(ids, method)
      setSelected(new Set())
      reload(status)
    } catch (e) {
      console.error('[Veresiye] tahsilat başarısız', e)
    } finally {
      setBusyId(null)
    }
  }

  const requestDelete = (g) => {
    const { ids, tutar } = groupSelection(g)
    if (!ids.length) return
    setDeleteTarget({ name: g.name, ids, tutar })
  }

  const handleDeleteConfirmed = async () => {
    if (!deleteTarget) return
    const { ids } = deleteTarget
    setBusyId(deleteTarget.name)
    try {
      for (const id of ids) {
        const res = await deleteVeresiye(id)
        if (res?.ok === false) console.warn('[Veresiye] silinemedi', id, res.error)
      }
      setSelected(new Set())
      setDeleteTarget(null)
      reload(status)
    } catch (e) {
      console.error('[Veresiye] silme başarısız', e)
    } finally {
      setBusyId(null)
    }
  }

  const handleUnsettle = async (id) => {
    setBusyId(id)
    try {
      await unsettleVeresiye(id)
      reload(status)
    } catch (e) {
      console.error('[Veresiye] geri alma başarısız', e)
    } finally {
      setBusyId(null)
    }
  }

  const clearFilters = () => { setSearch(''); setDateFrom(''); setDateTo('') }
  const hasFilter = search || dateFrom || dateTo

  return (
    <div className="page vsy-page">
      <div className="vsy-header">
        <div>
          <h1 className="vsy-title">Veresiyeler</h1>
          <span className="vsy-subtitle">
            {people.length > 0
              ? `${people.length} kişide toplam ${fmtTL(openTotal)} açık borç`
              : 'Açık veresiye borcu yok'}
          </span>
        </div>
        <div className="vsy-total-chip">
          <span className="vsy-total-chip__label">AÇIK BORÇ</span>
          <strong className="vsy-total-chip__value">{fmtTL(openTotal)}</strong>
        </div>
      </div>

      {/* Kişi özetleri — tıklayınca o kişiye filtreler */}
      {people.length > 0 && (
        <div className="vsy-people">
          {people.map((p) => (
            <button
              key={p.name}
              className={`vsy-person${search === p.name ? ' vsy-person--active' : ''}`}
              onClick={() => setSearch(search === p.name ? '' : p.name)}
            >
              <span className="vsy-person__name">{p.name}</span>
              <span className="vsy-person__count">{p.count} kayıt</span>
              <strong className="vsy-person__total">{fmtTL(p.total)}</strong>
            </button>
          ))}
        </div>
      )}

      {/* Filtreler */}
      <div className="vsy-filters">
        <div className="vsy-tabs">
          {STATUS_TABS.map((t) => (
            <button
              key={t.id}
              className={`vsy-tab${status === t.id ? ' vsy-tab--active' : ''}`}
              onClick={() => setStatus(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <input
          className="vsy-search"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="İsim ara…"
          autoComplete="off"
        />

        <label className="vsy-date">
          <span>Başlangıç</span>
          <input type="date" value={dateFrom} max={dateTo || undefined}
                 onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="vsy-date">
          <span>Bitiş</span>
          <input type="date" value={dateTo} min={dateFrom || undefined}
                 onChange={(e) => setDateTo(e.target.value)} />
        </label>

        {hasFilter && (
          <button className="vsy-clear" onClick={clearFilters}>Filtreleri temizle</button>
        )}
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div className="vsy-empty">
          {hasFilter ? 'Bu filtrelere uyan kayıt yok.' : 'Kayıt yok.'}
        </div>
      ) : (
        <>
          <div className="vsy-count">
            {grouped.length} kişi · {filtered.length} kayıt · toplam {fmtTL(shownTotal)}
          </div>

          <div className="vsy-groups">
            {grouped.map((g) => {
              const { ids: seciliIds, tutar: seciliTutar } = groupSelection(g)
              const hepsiSecili =
                g.openRows.length > 0 && g.openRows.every((r) => selected.has(r.id))
              const grupMesgul = busyId === g.name

              return (
                <div key={g.name} className="vsy-group">
                  {/* Kişi başlığı */}
                  <div className="vsy-group__header">
                    {g.openRows.length > 0 && (
                      <label className="vsy-check vsy-check--all">
                        <input
                          type="checkbox"
                          checked={hepsiSecili}
                          onChange={() => toggleGroup(g)}
                          disabled={grupMesgul}
                        />
                      </label>
                    )}
                    <span className="vsy-group__name">{g.name}</span>
                    <span className="vsy-group__count">
                      {g.rows.length} kayıt
                      {g.openRows.length > 0 && g.openRows.length !== g.rows.length
                        ? ` · ${g.openRows.length} açık`
                        : ''}
                    </span>
                    <strong className="vsy-group__total">
                      {g.openTotal > 0 ? fmtTL(g.openTotal) : fmtTL(g.total)}
                    </strong>
                  </div>

                  {/* Borç satırları */}
                  <div className="vsy-group__rows">
                    {g.rows.map((r) => (
                      <div
                        key={r.id}
                        className={`vsy-row${r.settledAt ? ' vsy-row--settled' : ''}${
                          selected.has(r.id) ? ' vsy-row--selected' : ''
                        }`}
                      >
                        {r.settledAt ? (
                          <span className="vsy-check vsy-check--placeholder" aria-hidden="true" />
                        ) : (
                          <label className="vsy-check">
                            <input
                              type="checkbox"
                              checked={selected.has(r.id)}
                              onChange={() => toggleOne(r.id)}
                              disabled={grupMesgul}
                            />
                          </label>
                        )}

                        <div className="vsy-row__main">
                          <span className="vsy-row__meta">
                            {fmtDateTime(r.createdAt)}
                            {r.tableName ? ` · ${r.tableName}` : ''}
                          </span>
                        </div>

                        <div className="vsy-row__status">
                          {r.settledAt ? (
                            <span className="vsy-badge vsy-badge--paid">Ödendi</span>
                          ) : (
                            <span className="vsy-badge vsy-badge--open">Ödenmedi</span>
                          )}
                        </div>

                        <strong className="vsy-row__amount">{fmtTL(r.amount)}</strong>

                        <div className="vsy-row__actions">
                          {r.settledAt && (
                            <>
                              <span className="vsy-settled-info">
                                {fmtDateTime(r.settledAt)}
                                {r.settledMethod ? ` · ${
                                  SETTLE_METHODS.find((m) => m.id === r.settledMethod)?.label ?? r.settledMethod
                                }` : ''}
                              </span>
                              <button
                                className="vsy-undo"
                                disabled={busyId === r.id}
                                onClick={() => handleUnsettle(r.id)}
                              >
                                Geri al
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Seçime uygulanan işlemler — tek, birkaç ya da hepsi */}
                  {g.openRows.length > 0 && (
                    <div className="vsy-group__actions">
                      <span className="vsy-selinfo">
                        {seciliIds.length > 0
                          ? `${seciliIds.length} kayıt seçili · ${fmtTL(seciliTutar)}`
                          : 'Tahsil etmek için kayıt seçin'}
                      </span>
                      <div className="vsy-group__buttons">
                        {SETTLE_METHODS.map((m) => (
                          <button
                            key={m.id}
                            className="vsy-settle"
                            disabled={seciliIds.length === 0 || grupMesgul}
                            onClick={() => handleSettleSelected(g, m.id)}
                          >
                            {m.label}
                          </button>
                        ))}
                        <button
                          className="vsy-delete"
                          disabled={seciliIds.length === 0 || grupMesgul}
                          onClick={() => requestDelete(g)}
                          title="Yanlışlıkla girilmiş veresiye kaydını sil"
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
      <ConfirmModal
        open={!!deleteTarget}
        title="Veresiye kaydını sil"
        message={deleteTarget
          ? `${deleteTarget.name} adına ${deleteTarget.ids.length} kayıt (${fmtTL(deleteTarget.tutar)}) silinecek. ` +
            'Tamamı veresiye olan siparişler İPTAL olarak işaretlenir; parçalı ödenmiş ' +
            'siparişlerde yalnızca veresiye payı düşülür. Bu tutar hiçbir şekilde ciroya ' +
            'girmez. İşlem geri alınamaz.'
          : ''}
        confirmText="Sil"
        cancelText="Vazgeç"
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

export default Veresiye
