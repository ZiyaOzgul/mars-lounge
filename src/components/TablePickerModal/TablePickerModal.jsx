import './TablePickerModal.css'

function TablePickerModal({
  open,
  tables = [],
  mode = 'emptyOnly', // 'emptyOnly' | 'occupiedOnly' | 'all'
  excludeTableId = null,
  title = 'Masa Seç',
  subtitle = '',
  onSelect,
  onClose,
}) {
  if (!open) return null

  const filtered = tables.filter(t => {
    if (excludeTableId != null && t.id === excludeTableId) return false
    if (mode === 'emptyOnly') return t.status !== 'occupied'
    if (mode === 'occupiedOnly') return t.status === 'occupied'
    return true
  })

  return (
    <div className="tpm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tpm-modal">
        <div className="tpm-header">
          <div className="tpm-header__text">
            <div className="tpm-title">{title}</div>
            {subtitle && <div className="tpm-subtitle">{subtitle}</div>}
          </div>
          <button className="tpm-close-btn" onClick={onClose} aria-label="Kapat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="tpm-empty">
            {mode === 'emptyOnly'
              ? 'Boş masa bulunamadı.'
              : 'Aktif sipariş olan başka masa yok.'}
          </div>
        ) : (
          <div className="tpm-grid">
            {filtered.map(t => {
              const isOccupied = t.status === 'occupied'
              const itemCount = t.orderItems?.length || 0
              const grpTotal = t.orderItems?.reduce((s, i) => {
                const modSum = (i.modifiers || []).reduce((ms, m) => ms + (Number(m.priceDelta) || 0) * (Number(m.quantity) || 1), 0)
                return s + i.qty * (i.unitPrice + modSum)
              }, 0) || 0
              return (
                <button
                  key={t.id}
                  className={`tpm-tile ${isOccupied ? 'tpm-tile--occupied' : 'tpm-tile--empty'}`}
                  onClick={() => onSelect(t)}
                >
                  <div className="tpm-tile__name">{t.name}</div>
                  {isOccupied && mode === 'all' && (
                    <span className="tpm-tile__badge">Dolu — ayrı adisyon eklenir</span>
                  )}
                  <div className="tpm-tile__status">
                    {isOccupied
                      ? `${itemCount} ürün · ₺${grpTotal.toLocaleString('tr-TR')}`
                      : 'Boş'}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default TablePickerModal
