import './ConfirmModal.css'

function ConfirmModal({
  open,
  title = 'Emin misiniz?',
  message,
  confirmText = 'Sil',
  cancelText = 'İptal',
  danger = true,
  onConfirm,
  onCancel,
}) {
  if (!open) return null

  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="confirm-modal__header">
          <h2 className="confirm-modal__title">{title}</h2>
        </div>
        <div className="confirm-modal__body">
          {typeof message === 'string'
            ? <p className="confirm-modal__text">{message}</p>
            : message}
        </div>
        <div className="confirm-modal__footer">
          <button className="confirm-modal__cancel" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            className={`confirm-modal__confirm ${danger ? 'confirm-modal__confirm--danger' : ''}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmModal
