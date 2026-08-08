import { useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import ConfirmModal from '../../components/ConfirmModal/ConfirmModal.jsx'
import { imageSrc } from '../../lib/imageSrc.js'
import './Ingredients.css'

const UNITS = ['ml', 'L', 'g', 'kg', 'adet', 'dilim', 'çay kaşığı', 'yemek kaşığı']

function IngredientModal({ ingredient, onSave, onClose }) {
  const isEdit = !!ingredient

  // Derive initial container count from stored base-unit stock
  const initContainerSize = ingredient?.containerSize || 0
  const initContainerCount = initContainerSize > 0
    ? String(ingredient.stockAmount / initContainerSize)
    : ''
  const initMinAlertCount = initContainerSize > 0 && ingredient?.minStockAlert
    ? String(ingredient.minStockAlert / initContainerSize)
    : ''

  const [name,           setName]           = useState(ingredient?.name          ?? '')
  const [unit,           setUnit]           = useState(ingredient?.unit          ?? 'ml')
  const [stockAmount,    setStockAmount]    = useState(initContainerSize > 0 ? initContainerCount : String(ingredient?.stockAmount ?? ''))
  const [minStockAlert,  setMinStockAlert]  = useState(initContainerSize > 0 ? initMinAlertCount  : String(ingredient?.minStockAlert ?? ''))
  const [containerName,  setContainerName]  = useState(ingredient?.containerName ?? '')
  const [containerSize,  setContainerSize]  = useState(ingredient?.containerSize ? String(ingredient.containerSize) : '')
  const [imageUrl,       setImageUrl]       = useState(ingredient?.imageUrl ?? null)

  const hasContainer = containerName.trim() && parseFloat(containerSize) > 0

  const handlePickImage = async () => {
    if (!window.electronAPI?.images?.pickAndSave) return
    try {
      const url = await window.electronAPI.images.pickAndSave()
      if (url) setImageUrl(url)
    } catch (e) {
      console.error('[IngredientModal] image pick failed', e)
    }
  }

  const handleSave = () => {
    if (!name.trim()) return
    const size = parseFloat(containerSize) || 1
    onSave({
      id:            ingredient?.id ?? Date.now(),
      name:          name.trim(),
      unit,
      stockAmount:   hasContainer ? (parseFloat(stockAmount) || 0) * size : parseFloat(stockAmount) || 0,
      minStockAlert: hasContainer ? (parseFloat(minStockAlert) || 0) * size : parseFloat(minStockAlert) || 0,
      containerName: containerName.trim() || null,
      containerSize: parseFloat(containerSize) || 0,
      imageUrl:      imageUrl || null,
    })
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal ingredient-modal">
        <div className="modal__header">
          <h2 className="modal__title">{isEdit ? 'Malzemeyi Düzenle' : 'Yeni Malzeme Ekle'}</h2>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="ingredient-modal__body">
          {/* Image picker */}
          <div className="pm-field">
            <label className="pm-label">Görsel</label>
            <div className="ingredient-image-picker" onClick={handlePickImage}>
              {imageUrl
                ? <img src={imageSrc(imageUrl)} alt="malzeme" className="ingredient-image-picker__img" onError={e => { e.currentTarget.style.display = 'none' }} />
                : <span className="ingredient-image-picker__placeholder">Resim seç (isteğe bağlı)</span>
              }
            </div>
            {imageUrl && (
              <button className="ingredient-image-picker__remove" onClick={() => setImageUrl(null)}>Resmi kaldır</button>
            )}
          </div>

          <div className="pm-field">
            <label className="pm-label">Malzeme Adı</label>
            <input className="pm-input" value={name} onChange={e => setName(e.target.value)} placeholder="ör. Espresso, Süt, Vanilya �?urubu" autoFocus />
          </div>
          <div className="pm-field">
            <label className="pm-label">Birim</label>
            <select className="pm-input" value={unit} onChange={e => setUnit(e.target.value)}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          {/* Container section */}
          <div className="pm-field-row">
            <div className="pm-field">
              <label className="pm-label">Konteyner Adı <span className="pm-label-hint">(isteğe bağlı)</span></label>
              <input
                className="pm-input"
                value={containerName}
                onChange={e => setContainerName(e.target.value)}
                placeholder="ör. şişe, kutu, kova"
              />
            </div>
            <div className="pm-field">
              <label className="pm-label">Konteyner Boyutu ({unit})</label>
              <input
                className="pm-input"
                type="number"
                min="0"
                value={containerSize}
                onChange={e => setContainerSize(e.target.value)}
                placeholder="ör. 700"
              />
            </div>
          </div>

          <div className="pm-field-row">
            <div className="pm-field">
              <label className="pm-label">{hasContainer ? `Mevcut Stok (${containerName.trim()})` : 'Mevcut Stok'}</label>
              <input
                className="pm-input"
                type="number"
                min="0"
                value={stockAmount}
                onChange={e => setStockAmount(e.target.value)}
                placeholder={hasContainer ? 'kaç konteyner?' : '0'}
              />
            </div>
            <div className="pm-field">
              <label className="pm-label">{hasContainer ? `Min. Uyarı (${containerName.trim()})` : 'Min. Uyarı Eşiği'}</label>
              <input
                className="pm-input"
                type="number"
                min="0"
                value={minStockAlert}
                onChange={e => setMinStockAlert(e.target.value)}
                placeholder={hasContainer ? 'kaç konteyner?' : '0'}
              />
            </div>
          </div>

          {hasContainer && (
            <p className="pm-hint">
              {parseFloat(stockAmount) || 0} {containerName.trim()} × {containerSize} {unit} = <strong>{((parseFloat(stockAmount) || 0) * (parseFloat(containerSize) || 0)).toLocaleString('tr-TR')} {unit}</strong> stok
            </p>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn--secondary" onClick={onClose}>İptal</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={!name.trim()}>Kaydet</button>
        </div>
      </div>
    </div>
  )
}

function Ingredients() {
  const { ingredients, saveIngredient, removeIngredient } = useApp()
  const [search,     setSearch]     = useState('')
  const [editItem,   setEditItem]   = useState(undefined) // undefined=closed, null=new, obj=edit
  const [hoveredId,  setHoveredId]  = useState(null)
  const [confirmDel, setConfirmDel] = useState(null) // ingredient object

  const filtered = ingredients.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleSave = async (data) => {
    await saveIngredient(data)
    setEditItem(undefined)
  }

  const lowCount = ingredients.filter(i => i.minStockAlert > 0 && i.stockAmount <= i.minStockAlert).length

  return (
    <div className="page ingredients-page">
      {/* ── Header ── */}
      <div className="ingredients-header">
        <div className="ingredients-header__left">
          <h1 className="ingredients-title">Malzemeler</h1>
          {lowCount > 0 && (
            <span className="ingredients-low-badge">{lowCount} düşük stok</span>
          )}
        </div>
        <div className="ingredients-header__right">
          <div className="ingredients-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Malzeme ara..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button className="btn-add-ingredient" onClick={() => setEditItem(null)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Malzeme Ekle
          </button>
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="ingredients-grid">
        {filtered.map(ing => {
          const isLow = ing.minStockAlert > 0 && ing.stockAmount <= ing.minStockAlert
          const hasContainer = ing.containerSize > 0 && ing.containerName
          const containerCount = hasContainer ? Math.round(ing.stockAmount / ing.containerSize) : null
          const minAlertContainers = hasContainer && ing.minStockAlert > 0 ? Math.round(ing.minStockAlert / ing.containerSize) : null
          return (
            <div
              key={ing.id}
              className={`ingredient-card ${isLow ? 'ingredient-card--low' : ''}`}
              onMouseEnter={() => setHoveredId(ing.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div className="ingredient-card__image">
                {ing.imageUrl ? (
                  <img src={imageSrc(ing.imageUrl)} alt={ing.name} className="ingredient-card__image-img" onError={e => { e.currentTarget.style.display = 'none' }} />
                ) : (
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--color-border)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                )}
              </div>
              <div className="ingredient-card__header">
                <p className="ingredient-card__name">{ing.name}</p>
                <span className="ingredient-card__unit">{ing.unit}</span>
              </div>
              <div className="ingredient-card__stock">
                {hasContainer ? (
                  <>
                    <span className={`ingredient-card__amount ${isLow ? 'ingredient-card__amount--low' : ''}`}>
                      {containerCount}
                    </span>
                    <span className="ingredient-card__stock-label">{ing.containerName}</span>
                  </>
                ) : (
                  <>
                    <span className={`ingredient-card__amount ${isLow ? 'ingredient-card__amount--low' : ''}`}>
                      {ing.stockAmount.toLocaleString('tr-TR')}
                    </span>
                    <span className="ingredient-card__stock-label">{ing.unit}</span>
                  </>
                )}
              </div>
              {hasContainer && (
                <p className="ingredient-card__base-amount">({ing.stockAmount.toLocaleString('tr-TR')} {ing.unit})</p>
              )}
              {ing.minStockAlert > 0 && (
                <p className="ingredient-card__alert-info">
                  {isLow
                    ? <span className="ingredient-card__alert-info--low">
                        Düşük stok! Min: {hasContainer ? `${minAlertContainers} ${ing.containerName}` : `${ing.minStockAlert} ${ing.unit}`}
                      </span>
                    : `Min: ${hasContainer ? `${minAlertContainers} ${ing.containerName}` : `${ing.minStockAlert} ${ing.unit}`}`
                  }
                </p>
              )}

              {hoveredId === ing.id && (
                <div className="ingredient-card__actions" onClick={e => e.stopPropagation()}>
                  <button className="product-card__action-btn" onClick={() => setEditItem(ing)} title="Düzenle">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button className="product-card__action-btn product-card__action-btn--danger" onClick={() => setConfirmDel(ing)} title="Sil">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6"/><path d="M14 11v6"/>
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="ingredients-empty">
            <p>{search ? 'Malzeme bulunamadı.' : 'Henüz malzeme eklenmedi.'}</p>
          </div>
        )}
      </div>

      {editItem !== undefined && (
        <IngredientModal
          ingredient={editItem}
          onSave={handleSave}
          onClose={() => setEditItem(undefined)}
        />
      )}

      <ConfirmModal
        open={!!confirmDel}
        title="Malzemeyi Sil"
        message={confirmDel ? `"${confirmDel.name}" malzemesini silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.` : ''}
        confirmText="Sil"
        onConfirm={async () => {
          const id = confirmDel?.id
          setConfirmDel(null)
          if (id != null) await removeIngredient(id)
        }}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  )
}

export default Ingredients
