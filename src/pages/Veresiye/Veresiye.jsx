import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import {
  getVeresiyeLedger,
  getVeresiyeByPerson,
  settleVeresiye,
  unsettleVeresiye,
  isDbInitialized,
} from '../../lib/localDb.js'
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

  const handleSettle = async (id, method) => {
    setBusyId(id)
    try {
      await settleVeresiye(id, method)
      reload(status)
    } catch (e) {
      console.error('[Veresiye] tahsilat başarısız', e)
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
            {filtered.length} kayıt · toplam {fmtTL(shownTotal)}
          </div>
          <div className="vsy-rows">
            {filtered.map((r) => (
              <div key={r.id} className={`vsy-row${r.settledAt ? ' vsy-row--settled' : ''}`}>
                <div className="vsy-row__main">
                  <span className="vsy-row__name">{r.name}</span>
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
                  {r.settledAt ? (
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
                  ) : (
                    <>
                      <span className="vsy-hint">Tahsil et:</span>
                      {SETTLE_METHODS.map((m) => (
                        <button
                          key={m.id}
                          className="vsy-settle"
                          disabled={busyId === r.id}
                          onClick={() => handleSettle(r.id, m.id)}
                        >
                          {m.label}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default Veresiye
