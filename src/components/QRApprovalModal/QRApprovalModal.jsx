import './QRApprovalModal.css'

function QRApprovalModal({ table, onApprove, onReject }) {
  const items = table.orderItems || []
  const total = items.reduce((s, i) => s + i.qty * i.unitPrice, 0)

  return (
    <div className="qr-overlay">
      <div className="qr-modal">

        {/* Header */}
        <div className="qr-header">
          <div className="qr-header__badge">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
              <line x1="12" y1="18" x2="12.01" y2="18" />
            </svg>
          </div>
          <div>
            <h2 className="qr-header__title">QR Sipariş Onayı</h2>
            <p className="qr-header__subtitle">Masa {table.name} • {table.openMinutes} dk önce gönderildi</p>
          </div>
          <span className="badge badge--qr qr-header__tag">QR/Online</span>
        </div>

        {/* Order items */}
        <div className="qr-items">
          {items.length > 0 ? (
            items.map((item, idx) => (
              <div key={item.id} className={`qr-item ${idx % 2 === 1 ? 'qr-item--alt' : ''}`}>
                <span className="qr-item__qty">{item.qty}×</span>
                <div className="qr-item__name-wrap">
                  <span className="qr-item__name">{item.name}</span>
                  {item.note && <span className="qr-item__note">{item.note}</span>}
                </div>
                <span className="qr-item__total">₺{(item.qty * item.unitPrice).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <p className="qr-no-items">Sipariş detayları bekleniyor...</p>
          )}
        </div>

        {/* Total */}
        {items.length > 0 && (
          <div className="qr-total">
            <span>Tahmini Toplam</span>
            <strong>₺{total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</strong>
          </div>
        )}

        {/* Actions */}
        <div className="qr-actions">
          <button className="qr-btn qr-btn--reject" onClick={onReject}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Reddet
          </button>
          <button className="qr-btn qr-btn--approve" onClick={onApprove}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Masayı Onayla
          </button>
        </div>

      </div>
    </div>
  )
}

export default QRApprovalModal
