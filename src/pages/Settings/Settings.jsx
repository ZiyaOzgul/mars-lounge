import { useState, useRef, useEffect } from "react";
import { useApp } from "../../context/AppContext.jsx";
import useOnlineStatus from "../../hooks/useOnlineStatus.js";
import ConfirmModal from "../../components/ConfirmModal/ConfirmModal.jsx";
import { imageSrc } from "../../lib/imageSrc.js";
import "./Settings.css";

// ── Icons ────────────────────────────────────────────────────────
const IconBriefcase = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
);
const IconGrid = () => (
  <img src="./icons/tables.png" alt="" className="settings-subnav__icon-img" />
);
const IconTag = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);
const IconGear = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const IconPencil = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const IconTrash = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);
const IconAlertTriangle = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const IconCoffee = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
    <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
    <line x1="6" y1="1" x2="6" y2="4" />
    <line x1="10" y1="1" x2="10" y2="4" />
    <line x1="14" y1="1" x2="14" y2="4" />
  </svg>
);
const IconCake = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8" />
    <path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2 1 2 1" />
    <path d="M2 21h20" />
    <path d="M7 8v2" />
    <path d="M12 8v2" />
    <path d="M17 8v2" />
    <path d="M7 4h.01" />
    <path d="M12 4h.01" />
    <path d="M17 4h.01" />
  </svg>
);
const IconCocktail = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8 22h8" />
    <path d="M12 11v11" />
    <path d="M20 2H4l8 9.46L20 2z" />
  </svg>
);
const IconFood = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
    <path d="M7 2v20" />
    <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />
  </svg>
);

const IconTea = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 8h1a4 4 0 0 1 0 8h-1" />
    <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z" />
    <line x1="6" y1="2" x2="6" y2="5" />
    <line x1="10" y1="2" x2="10" y2="5" />
    <line x1="14" y1="2" x2="14" y2="5" />
  </svg>
);
const IconJuice = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8 2h8l1 6H7L8 2z" />
    <path d="M7 8l1 13h8l1-13" />
    <line x1="6" y1="12" x2="18" y2="12" />
  </svg>
);
const IconSandwich = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 11l19-9-9 19-2-8-8-2z" />
    <path d="M3 6h18" />
    <path d="M3 18h18" />
  </svg>
);
const IconDessert = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7 11l5-9 5 9" />
    <path d="M12 2v20" />
    <path d="M5 21h14" />
    <circle cx="12" cy="14" r="3" />
  </svg>
);
const IconBreakfast = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="4" />
    <line x1="12" y1="2" x2="12" y2="4" />
    <line x1="12" y1="20" x2="12" y2="22" />
    <line x1="2" y1="12" x2="4" y2="12" />
    <line x1="20" y1="12" x2="22" y2="12" />
    <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
    <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
    <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
    <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
  </svg>
);
const IconPizza = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2L2 22h20L12 2z" />
    <path d="M12 2v20" />
    <circle cx="9" cy="14" r="1.5" fill="currentColor" />
    <circle cx="15" cy="10" r="1.5" fill="currentColor" />
  </svg>
);

const CATEGORY_ICONS = {
  coffee: IconCoffee,
  cake: IconCake,
  cocktail: IconCocktail,
  food: IconFood,
  tea: IconTea,
  juice: IconJuice,
  sandwich: IconSandwich,
  dessert: IconDessert,
  breakfast: IconBreakfast,
  pizza: IconPizza,
};
const COLOR_PALETTE = [
  "#e8975a",
  "#14b8a6",
  "#6366f1",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
];

const IconWifi = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
);

const SUB_NAV = [
  { id: "cafe", label: "Cafe Bilgileri", Icon: IconBriefcase },
  { id: "tables", label: "Masa Yönetimi", Icon: IconGrid },
  { id: "categories", label: "Menü Kategorileri", Icon: IconTag },
  { id: "connection", label: "Bağlantı Durumu", Icon: IconWifi },
  { id: "system", label: "Sistem", Icon: IconGear },
];

// ── Cafe info (device-level, persisted in localStorage) ──────────
const CAFE_INFO_KEY = "san-lucas-cafe-info";
const DEFAULT_CAFE_INFO = {
  name: "Mars Lounge Cafe",
  phone: "0546 933 29 50",
  address:
    "Belkent caddesi üniversite karşısı fonten binaları, a blok altı, 58400 Şarkışla/Sivas",
};
function loadCafeInfo() {
  try {
    return { ...DEFAULT_CAFE_INFO, ...JSON.parse(localStorage.getItem(CAFE_INFO_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_CAFE_INFO };
  }
}

// ── Table mini card (inline editable) ─────────────────────────────
function TableRow({ table, index, onRename, onDelete, autoEdit }) {
  const [editing, setEditing] = useState(!!autoEdit);
  const [draft, setDraft] = useState(table.name);
  const inputRef = useRef(null);

  // Adjust-during-render (React docs pattern) instead of a setState effect
  const [prevAutoEdit, setPrevAutoEdit] = useState(autoEdit);
  if (autoEdit !== prevAutoEdit) {
    setPrevAutoEdit(autoEdit);
    if (autoEdit) setEditing(true);
  }
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed) onRename(table.id, trimmed);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(table.name);
    setEditing(false);
  };

  return (
    <div
      className="st-table-card"
      onDoubleClick={() => !editing && setEditing(true)}
      title="Yeniden adlandırmak için çift tıklayın"
    >
      <span className="st-table-card__num">{index + 1}</span>
      {editing ? (
        <input
          ref={inputRef}
          className="st-inline-input st-inline-input--center"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
        />
      ) : (
        <span className="st-table-card__name">{table.name}</span>
      )}
      <div className="st-table-card__actions">
        <button
          className="st-icon-btn"
          onClick={() => setEditing(true)}
          title="Düzenle"
        >
          <IconPencil />
        </button>
        <button
          className="st-icon-btn st-icon-btn--danger"
          onClick={() => onDelete(table.id)}
          title="Sil"
        >
          <IconTrash />
        </button>
      </div>
    </div>
  );
}

// ── Category card ─────────────────────────────────────────────────
function CategoryCard({
  cat,
  autoEdit,
  onRename,
  onColorChange,
  onIconChange,
  onImageChange,
  onDelete,
}) {
  const [editing, setEditing] = useState(!!autoEdit);
  const [draft, setDraft] = useState(cat.name);
  const [showPicker, setShowPicker] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const inputRef = useRef(null);
  const CatIcon = CATEGORY_ICONS[cat.icon] || IconCoffee;

  const [prevAutoEdit, setPrevAutoEdit] = useState(autoEdit);
  if (autoEdit !== prevAutoEdit) {
    setPrevAutoEdit(autoEdit);
    if (autoEdit) setEditing(true);
  }
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed) onRename(cat.id, trimmed);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(cat.name);
    setEditing(false);
  };

  const handlePickImage = async () => {
    if (!window.electronAPI?.images?.pickAndSave) return;
    try {
      const url = await window.electronAPI.images.pickAndSave();
      if (url) onImageChange(cat.id, url);
    } catch (e) {
      console.error("[CategoryCard] image pick failed", e);
    }
  };

  return (
    <div
      className="st-cat-card"
      onDoubleClick={() => !editing && setEditing(true)}
    >
      {/* Photo / icon area */}
      <div
        className="st-cat-image"
        style={
          cat.imageUrl
            ? {
                backgroundImage: `url(${imageSrc(cat.imageUrl)})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : { backgroundColor: cat.color + "22" }
        }
        onClick={handlePickImage}
        title="Fotoğraf ekle"
      >
        {!cat.imageUrl && <CatIcon style={{ color: cat.color }} />}
        <span className="st-cat-image__hint">📷</span>
      </div>
      {cat.imageUrl && (
        <button
          className="st-cat-image-remove"
          onClick={() => onImageChange(cat.id, null)}
          title="Fotoğrafı kaldır"
        >
          ✕
        </button>
      )}

      {/* Color dot + picker */}
      <div className="st-cat-dot-wrap">
        <button
          className="st-cat-dot"
          style={{ backgroundColor: cat.color }}
          onClick={() => {
            setShowPicker((p) => !p);
            setShowIconPicker(false);
          }}
          title="Rengi değiştir"
        />
        {showPicker && (
          <div className="st-color-picker">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                className={`st-color-swatch ${cat.color === c ? "st-color-swatch--active" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => {
                  onColorChange(cat.id, c);
                  setShowPicker(false);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Icon + picker */}
      <div className="st-cat-icon-wrap">
        <button
          className="st-cat-icon"
          style={{ color: cat.color }}
          onClick={() => {
            setShowIconPicker((p) => !p);
            setShowPicker(false);
          }}
          title="İkonu değiştir"
        >
          <CatIcon />
        </button>
        {showIconPicker && (
          <div className="st-icon-picker">
            {/* eslint-disable-next-line no-unused-vars -- Icon IS used in the JSX below */}
            {Object.entries(CATEGORY_ICONS).map(([key, Icon]) => (
              <button
                key={key}
                className={`st-icon-swatch ${cat.icon === key ? "st-icon-swatch--active" : ""}`}
                style={{
                  color:
                    cat.icon === key ? cat.color : "var(--color-text-muted)",
                }}
                onClick={() => {
                  onIconChange(cat.id, key);
                  setShowIconPicker(false);
                }}
                title={key}
              >
                <Icon />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Name */}
      {editing ? (
        <input
          ref={inputRef}
          className="st-inline-input st-inline-input--center"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
        />
      ) : (
        <span className="st-cat-name">{cat.name}</span>
      )}

      {/* Hover actions */}
      <div className="st-cat-actions">
        <button
          className="st-icon-btn"
          onClick={() => setEditing(true)}
          title="Düzenle"
        >
          <IconPencil />
        </button>
        <button
          className="st-icon-btn st-icon-btn--danger"
          onClick={() => onDelete(cat.id)}
          title="Sil"
        >
          <IconTrash />
        </button>
      </div>
    </div>
  );
}

// ── Category modifier editor ──────────────────────────────────────
// Lets the cafe owner manage priced extras per category. Selected
// category at the top, rows below for each modifier (name + ₺ delta).
// Free options like "Soğansız" use price_delta = 0.
function CategoryModifiersEditor({ categories, modifiers, onSave, onDelete }) {
  const [activeCatId, setActiveCatId] = useState(categories[0]?.id ?? null);
  // Adjust-during-render: pick the first category once one exists
  if (activeCatId == null && categories[0]) setActiveCatId(categories[0].id);

  const list = modifiers
    .filter((m) => m.categoryId === activeCatId && m.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  const handleAdd = async () => {
    if (activeCatId == null) return;
    const nextOrder = list.length ? Math.max(...list.map((m) => m.sortOrder)) + 1 : 0;
    await onSave({
      categoryId: activeCatId,
      productId: null,
      name: "Yeni ekstra",
      priceDelta: 0,
      sortOrder: nextOrder,
      isActive: true,
    });
  };

  return (
    <div className="settings-card">
      <div className="settings-card__header">
        <h2 className="settings-card__title">
          <span className="settings-card__title-icon">
            <IconTag />
          </span>
          Kategori Ekstraları
        </h2>
        <button
          className="st-add-link"
          onClick={handleAdd}
          disabled={activeCatId == null}
          style={activeCatId == null ? { opacity: 0.4, cursor: "not-allowed" } : {}}
        >
          + Ekstra Ekle
        </button>
      </div>

      {categories.length === 0 ? (
        <p className="st-empty-hint">Önce bir kategori ekleyin.</p>
      ) : (
        <>
          <div className="st-mod-cat-tabs">
            {categories.map((c) => (
              <button
                key={c.id}
                className={`st-mod-cat-tab ${c.id === activeCatId ? "st-mod-cat-tab--active" : ""}`}
                style={c.id === activeCatId ? { borderColor: c.color, color: c.color } : {}}
                onClick={() => setActiveCatId(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>

          <p className="st-mod-help">
            Ekstralar bu kategorideki tüm ürünlere uygulanır. Belirli bir üründe gizlemek için Ürünler sayfasından düzenleyin. Fiyat 0 ise ücretsiz tercihtir (örn. "Soğansız").
          </p>

          {list.length === 0 ? (
            <p className="st-empty-hint">Bu kategoride henüz ekstra yok.</p>
          ) : (
            <div className="st-mod-list">
              {list.map((m) => (
                <ModifierRow
                  key={m.id}
                  modifier={m}
                  onSave={onSave}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Single editable row (name + ₺ delta). Saves on blur / Enter.
function ModifierRow({ modifier, onSave, onDelete }) {
  const [name, setName] = useState(modifier.name);
  const [price, setPrice] = useState(String(modifier.priceDelta ?? 0));

  // Adjust-during-render: re-seed drafts when the modifier itself changes
  const [prevMod, setPrevMod] = useState(modifier);
  if (prevMod.id !== modifier.id || prevMod.name !== modifier.name || prevMod.priceDelta !== modifier.priceDelta) {
    setPrevMod(modifier);
    setName(modifier.name);
    setPrice(String(modifier.priceDelta ?? 0));
  }

  const commit = () => {
    const trimmed = name.trim();
    const num = parseFloat(price);
    const priceDelta = Number.isFinite(num) ? num : 0;
    if (!trimmed) {
      setName(modifier.name);
      return;
    }
    if (trimmed === modifier.name && priceDelta === Number(modifier.priceDelta)) return;
    onSave({
      id: modifier.id,
      localId: modifier.localId,
      categoryId: modifier.categoryId,
      productId: modifier.productId,
      name: trimmed,
      priceDelta,
      sortOrder: modifier.sortOrder,
      isActive: modifier.isActive,
    });
  };

  return (
    <div className="st-mod-row">
      <input
        className="st-mod-row__name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setName(modifier.name);
        }}
        placeholder="Ekstra adı"
      />
      <div className="st-mod-row__price-wrap">
        <span className="st-mod-row__price-prefix">₺</span>
        <input
          className="st-mod-row__price"
          type="number"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setPrice(String(modifier.priceDelta ?? 0));
          }}
        />
      </div>
      <button
        className="st-icon-btn st-icon-btn--danger"
        onClick={() => onDelete(modifier.id)}
        title="Sil"
      >
        <IconTrash />
      </button>
    </div>
  );
}

// ── Main Settings page ─────────────────────────────────────────────
function Settings() {
  const {
    tableDefs,
    addTableDef,
    editTableDef,
    removeTableDef,
    categories,
    addCategory,
    editCategory,
    removeCategory,
    modifiers,
    saveModifier,
    removeModifier,
    isSyncing,
    lastSyncAt,
    unsyncedCount,
    triggerSync,
    resetAllData,
    resetOnlineData,
    syncLogs,
    pointRate,
    setPointRatePersist,
  } = useApp();
  const { isOnline } = useOnlineStatus();

  const [activeSection, setActiveSection] = useState("cafe");
  const [autoEditTableId, setAutoEditTableId] = useState(null);
  const [autoEditCatId, setAutoEditCatId] = useState(null);
  const [tableError, setTableError] = useState(null);
  const [resetModal, setResetModal] = useState(null); // null | 'choose' | 'local' | 'online'
  const [resetLoading, setResetLoading] = useState(false);
  const [catError, setCatError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // { kind: 'table'|'category', id, name }

  const sectionRefs = {
    cafe: useRef(null),
    tables: useRef(null),
    categories: useRef(null),
    connection: useRef(null),
    system: useRef(null),
  };
  const contentRef = useRef(null);
  // While a click-triggered smooth scroll is animating, the scroll-spy would
  // briefly highlight every section it passes — suppress it until settled.
  const spyLockRef = useRef(null);

  const scrollTo = (id) => {
    setActiveSection(id);
    clearTimeout(spyLockRef.current);
    spyLockRef.current = setTimeout(() => (spyLockRef.current = null), 800);
    sectionRefs[id]?.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  // ── Scroll-spy: highlight the section currently in view ────────
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onScroll = () => {
      if (spyLockRef.current) return;
      const top = el.getBoundingClientRect().top;
      let current = "cafe";
      for (const [id, ref] of Object.entries(sectionRefs)) {
        const node = ref.current;
        if (!node) continue;
        if (node.getBoundingClientRect().top - top <= 130) current = id;
      }
      setActiveSection((prev) => (prev === current ? prev : current));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable
  }, []);

  // ── Cafe info: auto-save (debounced) + "Kaydedildi" toast ──────
  const [cafeInfo, setCafeInfo] = useState(loadCafeInfo);
  const [savedToast, setSavedToast] = useState(false);
  const saveTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const handleCafeChange = (field, value) => {
    const next = { ...cafeInfo, [field]: value };
    setCafeInfo(next);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      localStorage.setItem(CAFE_INFO_KEY, JSON.stringify(next));
      setSavedToast(true);
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setSavedToast(false), 1800);
    }, 600);
  };
  useEffect(
    () => () => {
      clearTimeout(saveTimerRef.current);
      clearTimeout(toastTimerRef.current);
      clearTimeout(spyLockRef.current);
    },
    []
  );

  // ── Table handlers ─────────────────────────────────────────────
  const handleAddTable = async () => {
    try {
      setTableError(null);
      const row = await addTableDef(`Masa ${tableDefs.length + 1}`);
      setAutoEditTableId(row.id);
    } catch (err) {
      setTableError(`Masa eklenemedi: ${err.message}`);
    }
  };
  const handleRenameTable = async (id, name) => {
    try {
      await editTableDef(id, name);
      setAutoEditTableId(null);
    } catch (err) {
      setTableError(`Kaydedilemedi: ${err.message}`);
    }
  };
  const handleDeleteTable = (id) => {
    const t = tableDefs.find((x) => x.id === id);
    setConfirmDelete({ kind: "table", id, name: t?.name ?? "Masa" });
  };

  // ── Category handlers ──────────────────────────────────────────
  const addCatBusyRef = useRef(false); // double-click creates duplicate categories
  const handleAddCategory = async () => {
    if (addCatBusyRef.current) return;
    addCatBusyRef.current = true;
    try {
      setCatError(null);
      const row = await addCategory({
        name: "Yeni Kategori",
        color: "#e8975a",
        icon: "coffee",
      });
      setAutoEditCatId(row?.id ?? null);
    } catch (err) {
      setCatError(`Kategori eklenemedi: ${err.message}`);
    } finally {
      addCatBusyRef.current = false;
    }
  };
  const handleRenameCategory = async (id, name) => {
    const cat = categories.find((c) => c.id === id);
    if (cat)
      await editCategory(id, {
        name,
        color: cat.color,
        icon: cat.icon,
        imageUrl: cat.imageUrl ?? null,
      });
    setAutoEditCatId(null);
  };
  const handleChangeColor = async (id, color) => {
    const cat = categories.find((c) => c.id === id);
    if (cat)
      await editCategory(id, {
        name: cat.name,
        color,
        icon: cat.icon,
        imageUrl: cat.imageUrl ?? null,
      });
  };
  const handleDeleteCategory = (id) => {
    const c = categories.find((x) => x.id === id);
    setConfirmDelete({ kind: "category", id, name: c?.name ?? "Kategori" });
  };

  const confirmDeleteAction = async () => {
    if (!confirmDelete) return;
    const { kind, id } = confirmDelete;
    try {
      if (kind === "table") {
        await removeTableDef(id);
        setAutoEditTableId(null);
      } else if (kind === "category") {
        await removeCategory(id);
        setAutoEditCatId(null);
      }
    } catch (err) {
      if (kind === "table") setTableError(`Silinemedi: ${err.message}`);
      else setCatError(`Silinemedi: ${err.message}`);
    } finally {
      setConfirmDelete(null);
    }
  };
  const handleIconChange = async (id, icon) => {
    const cat = categories.find((c) => c.id === id);
    if (cat)
      await editCategory(id, {
        name: cat.name,
        color: cat.color,
        icon,
        imageUrl: cat.imageUrl ?? null,
      });
  };
  const handleImageChange = async (id, imageUrl) => {
    const cat = categories.find((c) => c.id === id);
    if (cat)
      await editCategory(id, {
        name: cat.name,
        color: cat.color,
        icon: cat.icon,
        imageUrl: imageUrl ?? null,
      });
  };

  return (
    <>
      <div className="settings-page">
        {/* ── Page header ── */}
        <div className="settings-topbar">
          <h1 className="settings-topbar__title">Ayarlar</h1>
          <div className="settings-topbar__right">
            <div className="settings-search">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input type="text" placeholder="Ayar ara..." />
            </div>
            <button className="settings-icon-btn">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </button>
            <button className="settings-icon-btn settings-icon-btn--user">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="settings-body">
          {/* Sub-nav */}
          <nav className="settings-subnav">
            {/* eslint-disable-next-line no-unused-vars -- Icon IS used in the JSX below */}
            {SUB_NAV.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`settings-subnav__item ${activeSection === id ? "settings-subnav__item--active" : ""}`}
                onClick={() => scrollTo(id)}
              >
                <Icon />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="settings-content" ref={contentRef}>
            {/* ── 1. Cafe Bilgileri ── */}
            <div ref={sectionRefs.cafe} className="settings-card">
              <h2 className="settings-card__title">
                <span className="settings-card__title-icon">
                  <IconBriefcase />
                </span>
                Cafe Bilgileri
              </h2>
              <div className="settings-cafe-grid">
                <div className="settings-cafe-fields">
                  <div className="settings-field">
                    <label className="settings-label">Cafe Adı</label>
                    <input
                      className="settings-input"
                      value={cafeInfo.name}
                      onChange={(e) => handleCafeChange("name", e.target.value)}
                      placeholder="Cafe adı"
                    />
                  </div>
                  <div className="settings-field">
                    <label className="settings-label">Telefon</label>
                    <input
                      className="settings-input"
                      value={cafeInfo.phone}
                      onChange={(e) => handleCafeChange("phone", e.target.value)}
                      placeholder="Telefon"
                    />
                  </div>
                  <div className="settings-field">
                    <label className="settings-label">Adres</label>
                    <textarea
                      className="settings-input settings-textarea"
                      value={cafeInfo.address}
                      onChange={(e) => handleCafeChange("address", e.target.value)}
                      placeholder="Adres"
                    />
                  </div>
                  <p className="settings-autosave-hint">
                    Değişiklikler otomatik kaydedilir ve fiş önizlemesine anında
                    yansır.
                  </p>
                </div>
                <div className="st-receipt-zone">
                  <div className="st-receipt">
                    <img
                      src="./mars-lounge-logo.png"
                      alt=""
                      className="st-receipt__logo"
                    />
                    <span className="st-receipt__name">{cafeInfo.name}</span>
                    <span className="st-receipt__meta">{cafeInfo.address}</span>
                    <span className="st-receipt__meta">Tel: {cafeInfo.phone}</span>
                    <div className="st-receipt__divider" />
                    <div className="st-receipt__line">
                      <span>2× Americano</span>
                      <span>₺170,00</span>
                    </div>
                    <div className="st-receipt__line">
                      <span>1× Cheesecake</span>
                      <span>₺145,00</span>
                    </div>
                    <div className="st-receipt__divider" />
                    <div className="st-receipt__line st-receipt__line--total">
                      <span>TOPLAM</span>
                      <span>₺315,00</span>
                    </div>
                    <div className="st-receipt__divider" />
                    <span className="st-receipt__thanks">
                      Teşekkür ederiz, yine bekleriz ☕
                    </span>
                  </div>
                  <span className="st-receipt-caption">Fiş önizlemesi</span>
                </div>
              </div>
            </div>

            {/* ── 2. Masa Yönetimi ── */}
            <div ref={sectionRefs.tables} className="settings-card">
              <div className="settings-card__header">
                <h2 className="settings-card__title">
                  <span className="settings-card__title-icon">
                    <IconGrid />
                  </span>
                  Masa Yönetimi
                  <span className="settings-card__count">
                    {tableDefs.length} masa
                  </span>
                </h2>
                <button className="st-add-btn" onClick={handleAddTable}>
                  + Yeni Masa Ekle
                </button>
              </div>
              {tableError && <p className="st-error">{tableError}</p>}
              <div className="st-table-list">
                {tableDefs.map((table, idx) => (
                  <TableRow
                    key={table.id}
                    table={table}
                    index={idx}
                    autoEdit={table.id === autoEditTableId}
                    onRename={handleRenameTable}
                    onDelete={handleDeleteTable}
                  />
                ))}
                {tableDefs.length === 0 && (
                  <p className="st-empty-hint">
                    Henüz masa yok. "+ Yeni Masa Ekle" ile başlayın.
                  </p>
                )}
              </div>
            </div>

            {/* ── 3. Menü Kategorileri ── */}
            <div ref={sectionRefs.categories} className="settings-card">
              <div className="settings-card__header">
                <h2 className="settings-card__title">
                  <span className="settings-card__title-icon">
                    <IconTag />
                  </span>
                  Menü Kategorileri
                </h2>
                <button className="st-add-link" onClick={handleAddCategory}>
                  + Kategori Ekle
                </button>
              </div>
              {catError && <p className="st-error">{catError}</p>}
              <div className="st-cat-grid">
                {categories.map((cat) => (
                  <CategoryCard
                    key={cat.id}
                    cat={cat}
                    autoEdit={cat.id === autoEditCatId}
                    onRename={handleRenameCategory}
                    onColorChange={handleChangeColor}
                    onIconChange={handleIconChange}
                    onImageChange={handleImageChange}
                    onDelete={handleDeleteCategory}
                  />
                ))}
              </div>
            </div>

            {/* ── 3b. Kategori Ekstraları (Modifier) ── */}
            <CategoryModifiersEditor
              categories={categories}
              modifiers={modifiers}
              onSave={saveModifier}
              onDelete={removeModifier}
            />

            {/* ── 4. Bağlantı Durumu ── */}
            <div ref={sectionRefs.connection} className="settings-card">
              <h2 className="settings-card__title">
                <span className="settings-card__title-icon">
                  <IconWifi />
                </span>
                Bağlantı Durumu
              </h2>
              <div className="st-connection-grid">
                <div className="st-conn-row">
                  <span className="st-conn-label">İnternet Bağlantısı</span>
                  <span
                    className={`st-conn-badge ${isOnline ? "st-conn-badge--online" : "st-conn-badge--offline"}`}
                  >
                    <span className="st-conn-dot" />
                    {isOnline ? "Çevrimiçi" : "Çevrimdışı"}
                  </span>
                </div>
                <div className="st-conn-row">
                  <span className="st-conn-label">Database Bağlantısı</span>
                  <span
                    className={`st-conn-badge ${isOnline ? "st-conn-badge--online" : "st-conn-badge--offline"}`}
                  >
                    <span className="st-conn-dot" />
                    {isOnline ? "Bağlı" : "Bağlantı Kesildi"}
                  </span>
                </div>
                <div className="st-conn-row">
                  <span className="st-conn-label">Bekleyen Kayıt</span>
                  <span className="st-conn-count">{unsyncedCount} kayıt</span>
                </div>
                <button
                  className="st-sync-btn"
                  onClick={triggerSync}
                  disabled={!isOnline || isSyncing || unsyncedCount === 0}
                >
                  {isSyncing
                    ? "Senkronize Ediliyor…"
                    : lastSyncAt
                      ? `Şimdi Senkronize Et · Son: ${lastSyncAt.toLocaleTimeString("tr-TR")}`
                      : "Şimdi Senkronize Et"}
                </button>
                {syncLogs.length > 0 && (
                  <>
                    <span className="st-sync-log-title">Senkron Geçmişi</span>
                    <div className="st-sync-log">
                      {syncLogs.map((entry) => (
                        <div
                          key={entry.id}
                          className={`st-sync-log-entry st-sync-log-entry--${entry.type}`}
                        >
                          <span className="st-sync-log-time">
                            {entry.time.toLocaleTimeString("tr-TR")}
                          </span>
                          <span className="st-sync-log-text">{entry.text}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── 5. Sistem ── */}
            <div ref={sectionRefs.system} className="settings-card">
              <h2 className="settings-card__title">
                <span className="settings-card__title-icon">
                  <IconGear />
                </span>
                Sistem
              </h2>
              <div className="st-sistem-grid">
                <div>
                  <label className="settings-label">Mars Lounge Puanı</label>
                  <p className="st-point-desc">
                    QR menüden sipariş veren üyeler, siparişleri ödendiğinde
                    ürünlerin puan değeri kadar puan kazanır. Kazanılan puanlar
                    ödeme ekranında indirim olarak kullanılabilir. 1 puanın TL
                    karşılığını buradan belirleyin.
                  </p>
                  <div className="st-point-row">
                    <span className="st-point-label">1 Puan =</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.5"
                      className="settings-input st-point-input"
                      value={pointRate}
                      onChange={(e) => setPointRatePersist(e.target.value)}
                    />
                    <span className="st-point-suffix">₺</span>
                  </div>
                </div>
                <div>
                  <label className="settings-label">Hızlı İşlemler</label>
                  <div className="st-quick-actions">
                    <button className="st-quick-row">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="16 16 12 12 8 16" />
                        <line x1="12" y1="12" x2="12" y2="21" />
                        <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
                      </svg>
                      <span>Verileri Yedekle</span>
                      <svg
                        className="st-quick-row__chevron"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                    <button className="st-quick-row">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="23 4 23 10 17 10" />
                        <polyline points="1 20 1 14 7 14" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                      </svg>
                      <span>Güncelleme Kontrol Et</span>
                      <span className="st-version-badge">v1.0.0</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── 6. Tehlikeli Bölge ── */}
            <div className="settings-card settings-card--danger">
              <h2 className="settings-card__title">
                <span className="settings-card__title-icon settings-card__title-icon--danger">
                  <IconAlertTriangle />
                </span>
                Tehlikeli Bölge
              </h2>
              <div className="st-danger-row">
                <div className="st-danger-row__text">
                  <span className="st-danger-row__title">
                    Tüm Verileri Sıfırla
                  </span>
                  <span className="st-danger-row__desc">
                    Ürünler, kategoriler ve sipariş geçmişi kalıcı olarak
                    silinir. Bu işlem geri alınamaz.
                  </span>
                </div>
                <button
                  className="st-danger-btn"
                  onClick={() => setResetModal("choose")}
                >
                  <IconTrash />
                  Verileri Sıfırla
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Auto-save toast ── */}
      {savedToast && (
        <div className="st-saved-toast">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Kaydedildi
        </div>
      )}

      {/* ── Reset Data Modal ─────────────────────────────────── */}
      {resetModal && (
        <div
          className="st-reset-overlay"
          onClick={() => !resetLoading && setResetModal(null)}
        >
          <div className="st-reset-modal" onClick={(e) => e.stopPropagation()}>
            {resetModal === "choose" && (
              <>
                <div className="st-reset-modal__header">
                  <span className="st-reset-modal__title">
                    Verileri Sıfırla
                  </span>
                  <span className="st-reset-modal__sub">
                    Hangi verileri sıfırlamak istiyorsunuz?
                  </span>
                </div>
                <div className="st-reset-options">
                  <button
                    className="st-reset-option st-reset-option--local"
                    onClick={() => setResetModal("local")}
                  >
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <path d="M8 21h8M12 17v4" />
                    </svg>
                    <span className="st-reset-option__title">Yerel Veri</span>
                    <span className="st-reset-option__desc">
                      Bu cihazdaki SQLite veritabanını temizler. Ürünler,
                      kategoriler ve siparişler silinir.
                    </span>
                  </button>
                  <button
                    className="st-reset-option st-reset-option--online"
                    onClick={() => setResetModal("online")}
                  >
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                    <span className="st-reset-option__title">
                      Çevrimiçi Veri
                    </span>
                    <span className="st-reset-option__desc">
                      Supabase üzerindeki tüm verileri siler. Yerel veri de
                      temizlenir.
                    </span>
                  </button>
                </div>
                <button
                  className="st-reset-cancel"
                  onClick={() => setResetModal(null)}
                >
                  İptal
                </button>
              </>
            )}

            {resetModal === "local" && (
              <>
                <div className="st-reset-modal__header">
                  <span className="st-reset-modal__title">
                    Yerel Verileri Sıfırla
                  </span>
                </div>
                <div className="st-reset-warning">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <p>
                    Bu cihazdaki tüm{" "}
                    <strong>ürünler, kategoriler ve siparişler</strong>{" "}
                    silinecek. Masalar korunacak. Bu işlem geri alınamaz.
                  </p>
                </div>
                <div className="st-reset-actions">
                  <button
                    className="st-reset-cancel"
                    onClick={() => setResetModal(null)}
                    disabled={resetLoading}
                  >
                    İptal
                  </button>
                  <button
                    className="st-reset-confirm-btn"
                    disabled={resetLoading}
                    onClick={async () => {
                      setResetLoading(true);
                      try {
                        await resetAllData();
                      } finally {
                        setResetLoading(false);
                        setResetModal(null);
                      }
                    }}
                  >
                    {resetLoading ? "Sıfırlanıyor…" : "Yerel Sıfırla"}
                  </button>
                </div>
              </>
            )}

            {resetModal === "online" && (
              <>
                <div className="st-reset-modal__header">
                  <span className="st-reset-modal__title">
                    Çevrimiçi Verileri Sıfırla
                  </span>
                </div>
                <div className="st-reset-warning st-reset-warning--online">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <p>
                    Supabase üzerindeki{" "}
                    <strong>tüm veriler kalıcı olarak silinecek</strong>:
                    siparişler, ürünler, kategoriler, malzemeler. Yerel veri de
                    temizlenecek. Bu işlem geri alınamaz.
                  </p>
                </div>
                <div className="st-reset-actions">
                  <button
                    className="st-reset-cancel"
                    onClick={() => setResetModal(null)}
                    disabled={resetLoading}
                  >
                    İptal
                  </button>
                  <button
                    className="st-reset-confirm-btn st-reset-confirm-btn--online"
                    disabled={resetLoading}
                    onClick={async () => {
                      setResetLoading(true);
                      try {
                        await resetOnlineData();
                      } finally {
                        setResetLoading(false);
                        setResetModal(null);
                      }
                    }}
                  >
                    {resetLoading ? "Sıfırlanıyor…" : "Çevrimiçi Sıfırla"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirmDelete}
        title={confirmDelete?.kind === "table" ? "Masayı Sil" : "Kategoriyi Sil"}
        message={
          confirmDelete
            ? `"${confirmDelete.name}" ${
                confirmDelete.kind === "table" ? "masasını" : "kategorisini"
              } silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.`
            : ""
        }
        confirmText="Sil"
        onConfirm={confirmDeleteAction}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}

export default Settings;
