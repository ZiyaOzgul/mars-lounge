/**
 * localDb.js
 * SQLite database via sql.js (WASM), persisted to Electron userData/san-lucas.db.
 *
 * Data ownership:
 *   table_defs                → LOCAL ONLY (never synced to Supabase)
 *   categories                → LOCAL + SUPABASE  (is_synced flag, synced via sync.js when online)
 *   products                  → LOCAL + SUPABASE  (is_synced flag, synced via sync.js when online)
 *   ingredients               → LOCAL + SUPABASE  (is_synced flag)
 *   product_variants          → LOCAL + SUPABASE  (is_synced flag)
 *   product_variant_ingredients → LOCAL ONLY (rebuilt from variants on sync)
 */

import initSqlJs from 'sql.js'

let db = null

function requireDb() {
  if (!db) throw new Error('[localDb] Database not initialized — call initDb() first')
}

// Monotonic local id generator. Raw Date.now() (+ a small random offset)
// collides when many rows are created in the same millisecond — pull loops
// then silently drop rows via INSERT OR IGNORE, and multi-item order saves
// throw on the UNIQUE constraint and lose the sale.
let _lastLocalId = 0
function newLocalId() {
  let id = Date.now()
  if (id <= _lastLocalId) id = _lastLocalId + 1
  _lastLocalId = id
  return id
}

export function isDbInitialized() { return db !== null }

// ── Seed data (inserted once on first run) ────────────────────────
const SEED_TABLE_DEFS = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Masa-${i + 1}` }))


// ── Schema ────────────────────────────────────────────────────────
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS table_defs (
    id   INTEGER PRIMARY KEY,
    name TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    color      TEXT    NOT NULL,
    icon       TEXT    NOT NULL DEFAULT 'tag',
    is_synced  INTEGER NOT NULL DEFAULT 0,
    remote_id  TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    price       REAL    NOT NULL,
    stock       INTEGER NOT NULL DEFAULT 0,
    category_id INTEGER NOT NULL,
    image_url   TEXT,
    is_synced   INTEGER NOT NULL DEFAULT 0,
    remote_id   TEXT,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY,
    local_id       TEXT    UNIQUE NOT NULL,
    table_id       INTEGER NOT NULL,
    table_name     TEXT    NOT NULL,
    status         TEXT    NOT NULL DEFAULT 'completed',
    payment_method TEXT    NOT NULL,
    subtotal       REAL    NOT NULL DEFAULT 0,
    tax            REAL    NOT NULL DEFAULT 0,
    discount       REAL    NOT NULL DEFAULT 0,
    total          REAL    NOT NULL DEFAULT 0,
    is_synced      INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL,
    closed_at      TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id         INTEGER PRIMARY KEY,
    local_id   TEXT    UNIQUE NOT NULL,
    order_id   INTEGER NOT NULL,
    product_id INTEGER,
    name       TEXT    NOT NULL,
    quantity   INTEGER NOT NULL,
    unit_price REAL    NOT NULL,
    note       TEXT,
    added_at   TEXT,
    is_synced  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id              INTEGER PRIMARY KEY,
    local_id        TEXT    UNIQUE NOT NULL,
    order_id        INTEGER NOT NULL,
    amount          REAL    NOT NULL,
    payment_method  TEXT    NOT NULL,
    payer_label     TEXT,
    processed_by    TEXT,
    device          TEXT    NOT NULL DEFAULT 'desktop',
    is_synced       INTEGER NOT NULL DEFAULT 0,
    remote_id       TEXT,
    created_at      TEXT    NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS payment_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id    INTEGER NOT NULL,
    order_item_id INTEGER NOT NULL,
    is_synced     INTEGER NOT NULL DEFAULT 0,
    UNIQUE (order_item_id),
    FOREIGN KEY (payment_id)    REFERENCES payments(id)    ON DELETE CASCADE,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pending_deletes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT    NOT NULL,
    remote_id   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ingredients (
    id               INTEGER PRIMARY KEY,
    name             TEXT    NOT NULL,
    unit             TEXT    NOT NULL DEFAULT 'adet',
    stock_amount     REAL    NOT NULL DEFAULT 0,
    min_stock_alert  REAL    NOT NULL DEFAULT 0,
    created_at       TEXT    NOT NULL,
    is_synced        INTEGER NOT NULL DEFAULT 0,
    remote_id        TEXT
  );

  CREATE TABLE IF NOT EXISTS product_variants (
    id         INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL,
    name       TEXT    NOT NULL,
    price      REAL    NOT NULL,
    created_at TEXT    NOT NULL,
    is_synced  INTEGER NOT NULL DEFAULT 0,
    remote_id  TEXT,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS product_variant_ingredients (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id    INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL,
    amount_used   REAL    NOT NULL,
    FOREIGN KEY (variant_id)    REFERENCES product_variants(id) ON DELETE CASCADE,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS staff (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'Garson',
    is_active   INTEGER NOT NULL DEFAULT 1,
    permissions TEXT    NOT NULL DEFAULT '{}',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    email    TEXT    NOT NULL UNIQUE,
    password TEXT    NOT NULL,
    role     TEXT    NOT NULL DEFAULT 'admin'
  );

  CREATE TABLE IF NOT EXISTS modifiers (
    id          INTEGER PRIMARY KEY,
    local_id    TEXT    UNIQUE NOT NULL,
    category_id INTEGER,
    product_id  INTEGER,
    name        TEXT    NOT NULL,
    price_delta REAL    NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    is_synced   INTEGER NOT NULL DEFAULT 0,
    remote_id   TEXT,
    CHECK ((category_id IS NULL) <> (product_id IS NULL)),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id)  REFERENCES products(id)   ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS product_modifier_excludes (
    product_id  INTEGER NOT NULL,
    modifier_id INTEGER NOT NULL,
    is_synced   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, modifier_id),
    FOREIGN KEY (product_id)  REFERENCES products(id)  ON DELETE CASCADE,
    FOREIGN KEY (modifier_id) REFERENCES modifiers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS order_item_modifiers (
    id            INTEGER PRIMARY KEY,
    local_id      TEXT    UNIQUE NOT NULL,
    order_item_id INTEGER NOT NULL,
    modifier_id   INTEGER,
    name          TEXT    NOT NULL,
    price_delta   REAL    NOT NULL,
    quantity      INTEGER NOT NULL DEFAULT 1,
    is_synced     INTEGER NOT NULL DEFAULT 0,
    remote_id     TEXT,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
  );
`

// ── Init ──────────────────────────────────────────────────────────
export async function initDb() {
  if (db) return db

  const SQL = await initSqlJs({
    locateFile: () => './sql-wasm.wasm',
  })

  // Load existing db file from Electron userData (null on first run)
  let loaded = null
  if (window.electronAPI?.db?.read) {
    try { loaded = await window.electronAPI.db.read() } catch (e) {
      console.warn('[localDb] Could not read DB file from disk', e)
    }
  }
  try {
    db = loaded ? new SQL.Database(new Uint8Array(loaded)) : new SQL.Database()
  } catch (e) {
    console.warn('[localDb] Existing DB unreadable — starting fresh', e)
    db = new SQL.Database()
  }

  db.run(SCHEMA)

  // Migrations — idempotent, no-op if column already exists
  const migrations = [
    `ALTER TABLE categories ADD COLUMN icon      TEXT    NOT NULL DEFAULT 'tag'`,
    `ALTER TABLE categories ADD COLUMN is_synced INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE categories ADD COLUMN remote_id TEXT`,
    `ALTER TABLE products   ADD COLUMN is_synced  INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE products   ADD COLUMN remote_id  TEXT`,
    `ALTER TABLE products   ADD COLUMN image_url  TEXT`,
    `ALTER TABLE products   ADD COLUMN recipe     TEXT`,
    // orders / order_items tables added in schema; these cover old DBs that ran schema before orders existed
    `ALTER TABLE orders ADD COLUMN subtotal REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE orders ADD COLUMN tax      REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE orders ADD COLUMN discount REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE orders ADD COLUMN table_name TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE order_items ADD COLUMN name TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE orders ADD COLUMN cash_amount REAL`,
    `ALTER TABLE orders ADD COLUMN card_amount REAL`,
    `ALTER TABLE orders ADD COLUMN iban_amount REAL`,
    `ALTER TABLE orders ADD COLUMN remote_id   TEXT`,
    `ALTER TABLE order_items ADD COLUMN variant_id INTEGER`,
    `ALTER TABLE ingredients ADD COLUMN container_name TEXT`,
    `ALTER TABLE ingredients ADD COLUMN container_size REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE ingredients ADD COLUMN image_url TEXT`,
    `ALTER TABLE orders ADD COLUMN waiter_name TEXT`,
    `ALTER TABLE staff ADD COLUMN contact TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE staff ADD COLUMN email TEXT`,
    `ALTER TABLE staff ADD COLUMN supabase_uid TEXT`,
    `ALTER TABLE categories ADD COLUMN image_url TEXT`,
    `CREATE TABLE IF NOT EXISTS product_ingredients (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id    INTEGER NOT NULL,
      ingredient_id INTEGER NOT NULL,
      amount_used   REAL    NOT NULL,
      FOREIGN KEY (product_id)    REFERENCES products(id)    ON DELETE CASCADE,
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
    )`,
    // Per-item note + timestamp (parity with Supabase migration 2026-06-26)
    `ALTER TABLE order_items ADD COLUMN note TEXT`,
    `ALTER TABLE order_items ADD COLUMN added_at TEXT`,
    // Mobile parity: active orders live in Supabase, status='active' on Windows too
    // (existing rows default to 'completed' — no change needed)
    // payments table — split payment support, mirrors Supabase
    `CREATE TABLE IF NOT EXISTS payments (
      id              INTEGER PRIMARY KEY,
      local_id        TEXT    UNIQUE NOT NULL,
      order_id        INTEGER NOT NULL,
      amount          REAL    NOT NULL,
      payment_method  TEXT    NOT NULL,
      payer_label     TEXT,
      processed_by    TEXT,
      device          TEXT    NOT NULL DEFAULT 'desktop',
      is_synced       INTEGER NOT NULL DEFAULT 0,
      remote_id       TEXT,
      created_at      TEXT    NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )`,
    `CREATE TABLE IF NOT EXISTS payment_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id    INTEGER NOT NULL,
      order_item_id INTEGER NOT NULL,
      is_synced     INTEGER NOT NULL DEFAULT 0,
      UNIQUE (order_item_id),
      FOREIGN KEY (payment_id)    REFERENCES payments(id)    ON DELETE CASCADE,
      FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_payments_order_id        ON payments(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payment_items_payment_id ON payment_items(payment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_items_order_id     ON order_items(order_id)`,
    `ALTER TABLE order_items ADD COLUMN remote_id TEXT`,
    `ALTER TABLE products ADD COLUMN points_value INTEGER NOT NULL DEFAULT 0`,
    // Modifiers (cafe owner defines per-category/per-product priced extras)
    `CREATE INDEX IF NOT EXISTS idx_modifiers_category_id          ON modifiers(category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_modifiers_product_id           ON modifiers(product_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pmod_excludes_product_id       ON product_modifier_excludes(product_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_item_id   ON order_item_modifiers(order_item_id)`,
    // Small key/value store for one-time maintenance flags (travels with the DB file)
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
    // Offline login fallback: PBKDF2 salt+hash per email, saved on every
    // successful online login so the same account can log in with no
    // internet on this device. Never stores the plaintext password.
    `CREATE TABLE IF NOT EXISTS offline_credentials (
      email      TEXT PRIMARY KEY,
      salt       TEXT NOT NULL,
      hash       TEXT NOT NULL,
      iterations INTEGER NOT NULL,
      user_json  TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ]
  for (const sql of migrations) {
    try { db.run(sql) } catch { /* column already exists — ignore */ }
  }

  // Seed on first run (empty tables)
  const isEmpty = db.exec('SELECT COUNT(*) as c FROM table_defs')[0]?.values[0][0] === 0
  if (isEmpty) {
    for (const t of SEED_TABLE_DEFS) {
      db.run('INSERT INTO table_defs (id, name) VALUES (?, ?)', [t.id, t.name])
    }
    await persistDb()
  }

  // Seed default admin user if no users exist
  const noUsers = db.exec('SELECT COUNT(*) FROM users')[0]?.values[0][0] === 0
  if (noUsers) {
    db.run(`INSERT INTO users (email, password, role) VALUES (?, ?, 'admin')`,
      ['marsadmin@marslounge.com', '123456789'])
    await persistDb()
  }

  // One-time migration: replace old zero-padded / incomplete table list with Masa-1..20
  const hasOldNames = db.exec("SELECT COUNT(*) FROM table_defs WHERE name LIKE 'Masa-0%'")?.[0]?.values?.[0]?.[0] > 0
  const tableCount  = db.exec('SELECT COUNT(*) FROM table_defs WHERE id BETWEEN 1 AND 20')?.[0]?.values?.[0]?.[0]
  if (hasOldNames || tableCount < 20) {
    db.run('DELETE FROM table_defs WHERE id BETWEEN 1 AND 20')
    for (let i = 1; i <= 20; i++) {
      db.run('INSERT INTO table_defs (id, name) VALUES (?, ?)', [i, `Masa-${i}`])
    }
    await persistDb()
  }

  // One-time migration: move locally-stored images from the old '/products/…'
  // path (served over HTTP by the dev/Vite server) to the 'app-image://local/…'
  // scheme (served by the app-image:// protocol handler). Skipped entirely
  // under a browser dev session (no window.electronAPI) so it can run later
  // under Electron instead of silently marking itself done.
  const migrateLegacyImage = window.electronAPI?.images?.migrateLegacy
  if (migrateLegacyImage) {
    const imgDoneRes = db.exec("SELECT value FROM meta WHERE key = 'image-path-migration-v1'")
    const imgDone = imgDoneRes.length && imgDoneRes[0].values.length
    if (!imgDone) {
      for (const table of ['products', 'categories', 'ingredients']) {
        const rows = db.exec(`SELECT id, image_url, remote_id FROM ${table} WHERE image_url LIKE '/products/%'`)
        if (!rows.length) continue
        for (const [id, image_url, remote_id] of rows[0].values) {
          const filename = image_url.split('/').pop()
          const migrated = await migrateLegacyImage(filename)
          if (migrated) {
            db.run(`UPDATE ${table} SET image_url = ? WHERE id = ?`, [`app-image://local/${filename}`, id])
          } else if (remote_id) {
            // Leave unchanged — the next pull will overwrite with the https URL
          } else {
            db.run(`UPDATE ${table} SET image_url = NULL WHERE id = ?`, [id])
          }
        }
      }
      db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('image-path-migration-v1', '1')", [])
      await persistDb()
    }
  }

  return db
}

// ── Persist to disk ───────────────────────────────────────────────
export async function persistDb() {
  if (!db || !window.electronAPI?.db?.write) return
  const data = db.export()
  await window.electronAPI.db.write(data)
}

// ── table_defs (LOCAL ONLY) ───────────────────────────────────────
export function getAllTableDefs() {
  requireDb()
  const res = db.exec('SELECT id, name FROM table_defs ORDER BY id')
  if (!res.length) return []
  return res[0].values.map(([id, name]) => ({ id, name }))
}

export async function insertTableDef(name) {
  requireDb()
  const id = newLocalId()
  db.run('INSERT INTO table_defs (id, name) VALUES (?, ?)', [id, name])
  await persistDb()
  return { id, name }
}

export async function updateTableDef(id, name) {
  requireDb()
  db.run('UPDATE table_defs SET name = ? WHERE id = ?', [name, id])
  await persistDb()
}

export async function deleteTableDef(id) {
  requireDb()
  db.run('DELETE FROM table_defs WHERE id = ?', [id])
  await persistDb()
}

// ── categories (LOCAL + SUPABASE) ────────────────────────────────
export function getAllCategories() {
  requireDb()
  const res = db.exec('SELECT id, name, color, icon, is_synced, remote_id, image_url FROM categories ORDER BY id')
  if (!res.length) return []
  return res[0].values.map(([id, name, color, icon, is_synced, remote_id, image_url]) => ({
    id, name, color, icon, is_synced: !!is_synced, remote_id, imageUrl: image_url ?? null,
  }))
}

export async function insertCategory({ name, color, icon = 'tag', imageUrl = null }) {
  requireDb()
  const id = newLocalId()
  db.run(
    'INSERT INTO categories (id, name, color, icon, image_url, is_synced) VALUES (?, ?, ?, ?, ?, 0)',
    [id, name, color, icon, imageUrl]
  )
  await persistDb()
  return { id, name, color, icon, imageUrl, is_synced: false }
}

export async function updateCategory(id, fields) {
  requireDb()
  const { name, color, icon, imageUrl = null } = fields
  db.run(
    'UPDATE categories SET name = ?, color = ?, icon = ?, image_url = ?, is_synced = 0 WHERE id = ?',
    [name, color, icon, imageUrl, id]
  )
  await persistDb()
}

export function getCategoryRemoteId(localId) {
  requireDb()
  const res = db.exec('SELECT remote_id FROM categories WHERE id = ?', [localId])
  return res[0]?.values[0]?.[0] ?? null
}

export async function deleteCategory(id) {
  requireDb()
  const remoteRes = db.exec('SELECT remote_id FROM categories WHERE id = ?', [id])
  const remoteId = remoteRes[0]?.values[0]?.[0]
  db.run('DELETE FROM categories WHERE id = ?', [id])
  if (remoteId) {
    db.run("INSERT INTO pending_deletes (entity_type, remote_id) VALUES ('category', ?)", [remoteId])
  }
  await persistDb()
}

// ── products (LOCAL + SUPABASE) ───────────────────────────────────
export function getAllProducts() {
  requireDb()
  const res = db.exec(
    'SELECT id, name, price, stock, category_id, image_url, recipe, points_value, is_synced, remote_id FROM products ORDER BY id'
  )
  if (!res.length) return []
  return res[0].values.map(([id, name, price, stock, category_id, image_url, recipe, points_value, is_synced, remote_id]) => ({
    id, name, price, stock, categoryId: category_id, imageUrl: image_url ?? null,
    recipe: recipe ?? null, pointsValue: points_value ?? 0, is_synced: !!is_synced, remote_id,
  }))
}

export async function upsertProduct({ id, name, price, stock, categoryId, imageUrl = null, recipe = null, pointsValue = 0 }) {
  requireDb()
  const existing = db.exec('SELECT id FROM products WHERE id = ?', [id])
  if (existing.length && existing[0].values.length) {
    db.run(
      'UPDATE products SET name = ?, price = ?, stock = ?, category_id = ?, image_url = ?, recipe = ?, points_value = ?, is_synced = 0 WHERE id = ?',
      [name, price, stock, categoryId, imageUrl, recipe, pointsValue, id]
    )
  } else {
    db.run(
      'INSERT INTO products (id, name, price, stock, category_id, image_url, recipe, points_value, is_synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
      [id, name, price, stock, categoryId, imageUrl, recipe, pointsValue]
    )
  }
  await persistDb()
}

export async function deleteProduct(id) {
  requireDb()
  const res = db.exec('SELECT image_url, remote_id FROM products WHERE id = ?', [id])
  const imageUrl = res[0]?.values[0]?.[0]
  const remoteId = res[0]?.values[0]?.[1]
  db.run('DELETE FROM products WHERE id = ?', [id])
  if (remoteId) {
    db.run("INSERT INTO pending_deletes (entity_type, remote_id) VALUES ('product', ?)", [remoteId])
  }
  await persistDb()
  return imageUrl
}

export async function clearAllDataExceptTables() {
  requireDb()
  // Children before parents; sql.js doesn't cascade, so clear everything
  // explicitly or orphan rows (variants, recipes, payments…) linger and
  // resurface as ghost data after the next pull.
  const tables = [
    'payment_items', 'payments',
    'order_item_modifiers', 'order_items', 'orders',
    'product_modifier_excludes', 'modifiers',
    'product_variant_ingredients', 'product_ingredients', 'product_variants',
    'products', 'categories', 'ingredients',
    'pending_deletes',
  ]
  for (const t of tables) db.run(`DELETE FROM ${t}`)
  db.run("DELETE FROM meta WHERE key = 'dedupe-v1'")
  await persistDb()
}

// ── ingredients (LOCAL + SUPABASE) ───────────────────────────────
export function getAllIngredients() {
  requireDb()
  const res = db.exec(
    'SELECT id, name, unit, stock_amount, min_stock_alert, created_at, is_synced, remote_id, container_name, container_size, image_url FROM ingredients ORDER BY name'
  )
  if (!res.length) return []
  return res[0].values.map(([id, name, unit, stock_amount, min_stock_alert, created_at, is_synced, remote_id, container_name, container_size, image_url]) => ({
    id, name, unit, stockAmount: stock_amount, minStockAlert: min_stock_alert,
    createdAt: created_at, is_synced: !!is_synced, remote_id,
    containerName: container_name || null, containerSize: container_size || 0, imageUrl: image_url || null,
  }))
}

export async function upsertIngredient({ id, name, unit, stockAmount, minStockAlert, containerName, containerSize, imageUrl }) {
  requireDb()
  const now = new Date().toISOString()
  const cn = containerName || null
  const cs = containerSize || 0
  const img = imageUrl || null
  const existing = db.exec('SELECT id FROM ingredients WHERE id = ?', [id])
  if (existing.length && existing[0].values.length) {
    db.run(
      'UPDATE ingredients SET name=?, unit=?, stock_amount=?, min_stock_alert=?, container_name=?, container_size=?, image_url=?, is_synced=0 WHERE id=?',
      [name, unit, stockAmount, minStockAlert, cn, cs, img, id]
    )
  } else {
    db.run(
      'INSERT INTO ingredients (id, name, unit, stock_amount, min_stock_alert, container_name, container_size, image_url, created_at, is_synced) VALUES (?,?,?,?,?,?,?,?,?,0)',
      [id, name, unit, stockAmount, minStockAlert, cn, cs, img, now]
    )
  }
  await persistDb()
}

export async function deleteIngredient(id) {
  requireDb()
  const res = db.exec('SELECT remote_id FROM ingredients WHERE id = ?', [id])
  const remoteId = res[0]?.values[0]?.[0]
  db.run('DELETE FROM ingredients WHERE id = ?', [id])
  if (remoteId) {
    db.run("INSERT INTO pending_deletes (entity_type, remote_id) VALUES ('ingredient', ?)", [remoteId])
  }
  await persistDb()
}

// ── product_variants + recipes (LOCAL + SUPABASE) ─────────────────
export function getVariantsForProduct(productId) {
  requireDb()
  const vRes = db.exec(
    'SELECT id, product_id, name, price FROM product_variants WHERE product_id = ? ORDER BY id',
    [productId]
  )
  if (!vRes.length) return []
  const variants = vRes[0].values.map(([id, product_id, name, price]) => ({
    id, productId: product_id, name, price, ingredients: [],
  }))
  for (const v of variants) {
    const rRes = db.exec(
      `SELECT pvi.id, pvi.ingredient_id, i.name, i.unit, pvi.amount_used
       FROM product_variant_ingredients pvi
       JOIN ingredients i ON i.id = pvi.ingredient_id
       WHERE pvi.variant_id = ?`,
      [v.id]
    )
    if (rRes.length && rRes[0].values.length) {
      v.ingredients = rRes[0].values.map(([id, ingredientId, ingName, unit, amountUsed]) => ({
        id, ingredientId, name: ingName, unit, amountUsed,
      }))
    }
  }
  return variants
}

export function getAllVariantsAll() {
  requireDb()
  const vRes = db.exec('SELECT id, product_id, name, price FROM product_variants ORDER BY product_id, id')
  if (!vRes.length) return {}
  const map = {}
  const variantObjs = vRes[0].values.map(([id, product_id, name, price]) => {
    if (!map[product_id]) map[product_id] = []
    const v = { id, productId: product_id, name, price, ingredients: [] }
    map[product_id].push(v)
    return v
  })
  const rRes = db.exec(
    `SELECT pvi.variant_id, pvi.ingredient_id, i.name, i.unit, pvi.amount_used
     FROM product_variant_ingredients pvi
     JOIN ingredients i ON i.id = pvi.ingredient_id`
  )
  if (rRes.length && rRes[0].values.length) {
    const byVariant = {}
    variantObjs.forEach(v => { byVariant[v.id] = v })
    for (const [variant_id, ingredientId, ingName, unit, amountUsed] of rRes[0].values) {
      if (byVariant[variant_id]) {
        byVariant[variant_id].ingredients.push({ ingredientId, name: ingName, unit, amountUsed })
      }
    }
  }
  return map
}

export async function replaceVariants(productId, variants) {
  requireDb()
  // Snapshot existing variants so kept rows preserve their remote identity
  // and removed rows leave a tombstone for the remote delete on next sync.
  const oldRes = db.exec('SELECT id, remote_id, created_at FROM product_variants WHERE product_id = ?', [productId])
  const oldById = new Map()
  if (oldRes.length) {
    for (const [oid, oRemote, oCreated] of oldRes[0].values) {
      oldById.set(oid, { remoteId: oRemote ?? null, createdAt: oCreated })
    }
  }

  // Delete existing variants (cascades to product_variant_ingredients)
  db.run('DELETE FROM product_variants WHERE product_id = ?', [productId])
  const now = new Date().toISOString()
  const keptIds = new Set()
  for (const v of variants) {
    const isExisting = v.id && !String(v.id).startsWith('new_')
    const vid = isExisting ? v.id : newLocalId()
    const old = isExisting ? oldById.get(vid) : null
    if (isExisting) keptIds.add(vid)
    db.run(
      'INSERT INTO product_variants (id, product_id, name, price, created_at, is_synced, remote_id) VALUES (?,?,?,?,?,0,?)',
      [vid, productId, v.name, parseFloat(v.price) || 0, old?.createdAt || now, old?.remoteId ?? null]
    )
    for (const ing of (v.ingredients ?? [])) {
      if (!ing.ingredientId) continue
      db.run(
        'INSERT INTO product_variant_ingredients (variant_id, ingredient_id, amount_used) VALUES (?,?,?)',
        [vid, ing.ingredientId, parseFloat(ing.amountUsed) || 0]
      )
    }
  }

  for (const [oid, meta] of oldById) {
    if (!keptIds.has(oid) && meta.remoteId) {
      db.run("INSERT INTO pending_deletes (entity_type, remote_id) VALUES ('variant', ?)", [meta.remoteId])
    }
  }
  await persistDb()
}

export function consumeIngredients(items) {
  requireDb()
  const lowStock = []
  const warned = new Set()

  const checkLowStock = (ingredient_id) => {
    if (warned.has(ingredient_id)) return
    const sRes = db.exec(
      'SELECT name, stock_amount, min_stock_alert FROM ingredients WHERE id = ?',
      [ingredient_id]
    )
    if (sRes.length && sRes[0].values.length) {
      const [name, stock_amount, min_stock_alert] = sRes[0].values[0]
      if (min_stock_alert > 0 && stock_amount <= min_stock_alert) {
        lowStock.push({ id: ingredient_id, name, stockAmount: stock_amount, minStockAlert: min_stock_alert })
        warned.add(ingredient_id)
      }
    }
  }

  for (const item of items) {
    if (!item.variantId) continue
    const rRes = db.exec(
      'SELECT ingredient_id, amount_used FROM product_variant_ingredients WHERE variant_id = ?',
      [item.variantId]
    )
    if (!rRes.length) continue
    for (const [ingredient_id, amount_used] of rRes[0].values) {
      db.run(
        'UPDATE ingredients SET stock_amount = MAX(0, stock_amount - ?), is_synced = 0 WHERE id = ?',
        [amount_used * (item.qty ?? 1), ingredient_id]
      )
      checkLowStock(ingredient_id)
    }
  }

  // Direct product→ingredient recipe (no variant)
  for (const item of items) {
    if (item.variantId) continue
    if (!item.productId) continue
    const rRes = db.exec(
      'SELECT ingredient_id, amount_used FROM product_ingredients WHERE product_id = ?',
      [item.productId]
    )
    if (!rRes.length) continue
    for (const [ingredient_id, amount_used] of rRes[0].values) {
      db.run(
        'UPDATE ingredients SET stock_amount = MAX(0, stock_amount - ?), is_synced = 0 WHERE id = ?',
        [amount_used * (item.qty ?? 1), ingredient_id]
      )
      checkLowStock(ingredient_id)
    }
  }

  return lowStock
}

// ── product_ingredients (direct recipe, no variant) ───────────────
export function getIngredientsForProduct(productId) {
  requireDb()
  const res = db.exec(
    `SELECT pi.id, pi.ingredient_id, i.name, i.unit, pi.amount_used
     FROM product_ingredients pi
     JOIN ingredients i ON i.id = pi.ingredient_id
     WHERE pi.product_id = ? ORDER BY pi.id`,
    [productId]
  )
  if (!res.length) return []
  return res[0].values.map(([id, ingredient_id, name, unit, amount_used]) => ({
    id, ingredientId: ingredient_id, name, unit, amountUsed: amount_used,
  }))
}

export async function replaceProductIngredients(productId, rows) {
  requireDb()
  db.run('DELETE FROM product_ingredients WHERE product_id = ?', [productId])
  for (const row of rows) {
    if (!row.ingredientId || !row.amountUsed) continue
    db.run(
      'INSERT INTO product_ingredients (product_id, ingredient_id, amount_used) VALUES (?,?,?)',
      [productId, Number(row.ingredientId), parseFloat(row.amountUsed)]
    )
  }
  await persistDb()
}

export function getAllProductIngredientsAll() {
  requireDb()
  const res = db.exec(
    `SELECT pi.product_id, pi.ingredient_id, i.name, i.unit, pi.amount_used
     FROM product_ingredients pi
     JOIN ingredients i ON i.id = pi.ingredient_id
     ORDER BY pi.product_id, pi.id`
  )
  if (!res.length) return {}
  const map = {}
  for (const [product_id, ingredient_id, name, unit, amount_used] of res[0].values) {
    if (!map[product_id]) map[product_id] = []
    map[product_id].push({ ingredientId: ingredient_id, name, unit, amountUsed: amount_used })
  }
  return map
}

// ── modifiers (LOCAL + SUPABASE) ──────────────────────────────────
// A modifier is either category-scoped (applies to every product in the
// category) or product-scoped (applies only to one product). The owner
// defines them in Settings (category) or in the product edit modal.
// product_modifier_excludes lets a single product opt out of an inherited
// category modifier (e.g., this espresso has no "süt seçimi").

export function getAllModifiers() {
  requireDb()
  const res = db.exec(
    `SELECT id, local_id, category_id, product_id, name, price_delta, sort_order, is_active, is_synced, remote_id
     FROM modifiers
     ORDER BY COALESCE(category_id, 0), COALESCE(product_id, 0), sort_order, id`
  )
  if (!res.length) return []
  return res[0].values.map(([id, local_id, category_id, product_id, name, price_delta, sort_order, is_active, is_synced, remote_id]) => ({
    id,
    localId: local_id,
    categoryId: category_id ?? null,
    productId: product_id ?? null,
    name,
    priceDelta: Number(price_delta) || 0,
    sortOrder: sort_order ?? 0,
    isActive: !!is_active,
    is_synced: !!is_synced,
    remote_id: remote_id ?? null,
  }))
}

export function getModifiersForCategory(categoryId) {
  return getAllModifiers().filter(m => m.categoryId === categoryId && m.isActive)
}

// Returns category-inherited modifiers (minus excluded) + product-specific modifiers,
// shaped for the order-add UI. Each entry: { id, name, priceDelta, source: 'category'|'product', sortOrder }
export function getEffectiveModifiersForProduct(productId, categoryId) {
  requireDb()
  const all = getAllModifiers()
  const excluded = new Set()
  const exRes = db.exec('SELECT modifier_id FROM product_modifier_excludes WHERE product_id = ?', [productId])
  if (exRes.length) {
    for (const [mid] of exRes[0].values) excluded.add(mid)
  }
  const result = []
  for (const m of all) {
    if (!m.isActive) continue
    if (m.categoryId != null && m.categoryId === categoryId && !excluded.has(m.id)) {
      result.push({ ...m, source: 'category' })
    } else if (m.productId != null && m.productId === productId) {
      result.push({ ...m, source: 'product' })
    }
  }
  result.sort((a, b) => (a.sortOrder - b.sortOrder) || (a.id - b.id))
  return result
}

export async function upsertModifier({ id, localId, categoryId = null, productId = null, name, priceDelta = 0, sortOrder = 0, isActive = true }) {
  requireDb()
  if ((categoryId == null) === (productId == null)) {
    throw new Error('[localDb.upsertModifier] exactly one of categoryId/productId must be set')
  }
  const lid = localId || crypto.randomUUID()
  if (id) {
    db.run(
      `UPDATE modifiers
       SET category_id = ?, product_id = ?, name = ?, price_delta = ?, sort_order = ?, is_active = ?, is_synced = 0
       WHERE id = ?`,
      [categoryId, productId, name, Number(priceDelta) || 0, sortOrder, isActive ? 1 : 0, id]
    )
    await persistDb()
    return id
  }
  const newId = newLocalId()
  db.run(
    `INSERT INTO modifiers (id, local_id, category_id, product_id, name, price_delta, sort_order, is_active, is_synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [newId, lid, categoryId, productId, name, Number(priceDelta) || 0, sortOrder, isActive ? 1 : 0]
  )
  await persistDb()
  return newId
}

export async function deleteModifier(id) {
  requireDb()
  const res = db.exec('SELECT remote_id FROM modifiers WHERE id = ?', [id])
  const remoteId = res[0]?.values[0]?.[0]
  db.run('DELETE FROM modifiers WHERE id = ?', [id])
  if (remoteId) {
    db.run("INSERT INTO pending_deletes (entity_type, remote_id) VALUES ('modifier', ?)", [remoteId])
  }
  await persistDb()
}

export function getProductModifierExcludes(productId) {
  requireDb()
  const res = db.exec('SELECT modifier_id FROM product_modifier_excludes WHERE product_id = ?', [productId])
  if (!res.length) return []
  return res[0].values.map(([mid]) => mid)
}

export async function setProductModifierExclude(productId, modifierId, excluded) {
  requireDb()
  if (excluded) {
    db.run(
      'INSERT OR IGNORE INTO product_modifier_excludes (product_id, modifier_id, is_synced) VALUES (?, ?, 0)',
      [productId, modifierId]
    )
  } else {
    db.run(
      'DELETE FROM product_modifier_excludes WHERE product_id = ? AND modifier_id = ?',
      [productId, modifierId]
    )
  }
  await persistDb()
}

// ── order_item_modifiers ──────────────────────────────────────────
// Attached to a saved order_items row. Snapshots name + price_delta so
// historical orders stay correct even if the modifier catalog changes.

export async function insertOrderItemModifiers(orderItemId, modifiers) {
  requireDb()
  if (!modifiers || !modifiers.length) return
  for (const m of modifiers) {
    const qty = Math.max(1, Number(m.quantity) || 1)
    db.run(
      `INSERT INTO order_item_modifiers
         (local_id, order_item_id, modifier_id, name, price_delta, quantity, is_synced)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [
        crypto.randomUUID(),
        orderItemId,
        m.modifierId ?? m.id ?? null,
        m.name,
        Number(m.priceDelta) || 0,
        qty,
      ]
    )
  }
  await persistDb()
}

export function getOrderItemModifiers(orderItemId) {
  requireDb()
  const res = db.exec(
    `SELECT id, local_id, modifier_id, name, price_delta, quantity, is_synced, remote_id
     FROM order_item_modifiers
     WHERE order_item_id = ?
     ORDER BY id`,
    [orderItemId]
  )
  if (!res.length) return []
  return res[0].values.map(([id, local_id, modifier_id, name, price_delta, quantity, is_synced, remote_id]) => ({
    id,
    localId: local_id,
    modifierId: modifier_id ?? null,
    name,
    priceDelta: Number(price_delta) || 0,
    quantity: Number(quantity) || 1,
    is_synced: !!is_synced,
    remote_id: remote_id ?? null,
  }))
}

export function getModifiersForOrderItems(orderItemIds) {
  requireDb()
  if (!orderItemIds?.length) return {}
  const placeholders = orderItemIds.map(() => '?').join(',')
  const res = db.exec(
    `SELECT order_item_id, id, local_id, modifier_id, name, price_delta, quantity
     FROM order_item_modifiers
     WHERE order_item_id IN (${placeholders})
     ORDER BY id`,
    orderItemIds
  )
  if (!res.length) return {}
  const map = {}
  for (const [orderItemId, id, local_id, modifier_id, name, price_delta, quantity] of res[0].values) {
    if (!map[orderItemId]) map[orderItemId] = []
    map[orderItemId].push({
      id,
      localId: local_id,
      modifierId: modifier_id ?? null,
      name,
      priceDelta: Number(price_delta) || 0,
      quantity: Number(quantity) || 1,
    })
  }
  return map
}

export async function deleteOrderItemModifiers(orderItemId) {
  requireDb()
  db.run('DELETE FROM order_item_modifiers WHERE order_item_id = ?', [orderItemId])
  await persistDb()
}

// ── orders / order_items ──────────────────────────────────────────

export async function saveCompletedOrder(txData) {
  requireDb()
  const orderId   = newLocalId()
  const localId   = crypto.randomUUID()
  const now       = new Date().toISOString()
  const closedAt  = txData.closedAt ?? now

  // Per-method buckets for the payment breakdown report. The modal's payment
  // rows carry the real method mix (Tutar Gir can mix nakit/kart/iban even
  // though the order's payment_method collapses to 'split').
  const payRows = txData.paymentRows ?? []
  const sumMethod = (m) =>
    Math.round(payRows.filter(r => r.payment_method === m)
      .reduce((s, r) => s + Number(r.amount || 0), 0) * 100) / 100
  let cashAmt = sumMethod('cash')
  let cardAmt = sumMethod('card')
  let ibanAmt = sumMethod('iban')
  if (!payRows.length) {
    cashAmt = txData.paymentMethod === 'cash' ? txData.total : 0
    cardAmt = txData.paymentMethod === 'card' ? txData.total : 0
    ibanAmt = txData.paymentMethod === 'iban' ? txData.total : 0
  }

  // If this was a QR order already in Supabase, mark as pre-synced to avoid duplicate
  const isSynced = txData.supabaseOrderId ? 1 : 0
  const remoteId = txData.supabaseOrderId ?? null

  db.run(
    `INSERT INTO orders
       (id, local_id, table_id, table_name, status, payment_method,
        subtotal, tax, discount, total, cash_amount, card_amount, iban_amount, is_synced, remote_id, created_at, closed_at, waiter_name)
     VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orderId,
      localId,
      txData.tableId,
      txData.tableName ?? '',
      txData.paymentMethod,
      txData.subtotal ?? txData.total,
      txData.tax ?? 0,
      txData.discount ?? 0,
      txData.total,
      cashAmt > 0 ? cashAmt : null,
      cardAmt > 0 ? cardAmt : null,
      ibanAmt > 0 ? ibanAmt : null,
      isSynced,
      remoteId,
      now,
      closedAt,
      txData.waiterName ?? null,
    ]
  )

  for (const item of (txData.items ?? [])) {
    const itemId = newLocalId()
    db.run(
      `INSERT INTO order_items
         (id, local_id, order_id, product_id, variant_id, name, quantity, unit_price, is_synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        itemId,
        crypto.randomUUID(),
        orderId,
        item.productId ?? item.id ?? null,
        item.variantId ?? null,
        item.name,
        item.qty,
        item.unitPrice,
      ]
    )
    if (item.modifiers && item.modifiers.length) {
      for (const m of item.modifiers) {
        db.run(
          `INSERT INTO order_item_modifiers
             (local_id, order_item_id, modifier_id, name, price_delta, quantity, is_synced)
           VALUES (?, ?, ?, ?, ?, ?, 0)`,
          [
            crypto.randomUUID(),
            itemId,
            m.modifierId ?? m.id ?? null,
            m.name,
            Number(m.priceDelta) || 0,
            Math.max(1, Number(m.quantity) || 1),
          ]
        )
      }
    }
  }

  const lowStockWarnings = consumeIngredients(txData.items ?? [])
  await persistDb()
  return { lowStockWarnings }
}

export function getDailyRevenue() {
  requireDb()
  const res = db.exec(
    `SELECT COALESCE(SUM(total), 0)
     FROM orders
     WHERE status = 'completed'
       AND date(closed_at, 'localtime') = date('now', 'localtime')`
  )
  return res[0]?.values[0][0] ?? 0
}

// ── Pull helpers (used by sync.js to write Supabase data into localDb) ───────

// A row deleted locally mid-pull must not be re-inserted from the remote
// snapshot — its tombstone in pending_deletes will delete it remotely on the
// next push. Checked inside every ...FromRemote insert branch because the
// snapshot taken at pull start can race with deletes made while pulling.
function hasPendingDelete(entityType, remoteId) {
  const res = db.exec(
    'SELECT 1 FROM pending_deletes WHERE entity_type = ? AND remote_id = ? LIMIT 1',
    [entityType, Number(remoteId)]
  )
  return res.length > 0 && res[0].values.length > 0
}

export async function upsertCategoryFromRemote({ remoteId, name, color, icon, imageUrl }) {
  requireDb()
  const existing = db.exec('SELECT id, is_synced FROM categories WHERE remote_id = ?', [String(remoteId)])
  if (existing.length && existing[0].values.length) {
    const [localId, isSynced] = existing[0].values[0]
    if (!isSynced) return // local pending edit wins until it has been pushed
    db.run(
      'UPDATE categories SET name=?, color=?, icon=?, image_url=?, is_synced=1 WHERE id=?',
      [name, color, icon ?? 'tag', imageUrl ?? null, localId]
    )
  } else {
    if (hasPendingDelete('category', remoteId)) return
    const localId = newLocalId()
    db.run(
      'INSERT OR IGNORE INTO categories (id, name, color, icon, image_url, is_synced, remote_id) VALUES (?,?,?,?,?,1,?)',
      [localId, name, color, icon ?? 'tag', imageUrl ?? null, String(remoteId)]
    )
  }
}

export async function upsertIngredientFromRemote({ remoteId, name, unit, stockAmount, minStockAlert }) {
  requireDb()
  const existing = db.exec('SELECT id, is_synced FROM ingredients WHERE remote_id = ?', [String(remoteId)])
  if (existing.length && existing[0].values.length) {
    // Update fields — preserve local image and container data
    const [localId, isSynced] = existing[0].values[0]
    if (!isSynced) return // local pending edit/stock change wins until pushed
    db.run(
      'UPDATE ingredients SET name=?, unit=?, stock_amount=?, min_stock_alert=?, is_synced=1 WHERE id=?',
      [name, unit, stockAmount, minStockAlert, localId]
    )
  } else {
    if (hasPendingDelete('ingredient', remoteId)) return
    const localId = newLocalId()
    const now = new Date().toISOString()
    db.run(
      'INSERT OR IGNORE INTO ingredients (id, name, unit, stock_amount, min_stock_alert, created_at, is_synced, remote_id) VALUES (?,?,?,?,?,?,1,?)',
      [localId, name, unit, stockAmount, minStockAlert, now, String(remoteId)]
    )
  }
}

// Insert/update a modifier coming from Supabase. Resolves remote
// category/product ids back to local ids; if the parent isn't pulled
// yet we skip — the next sync pass will pick it up.
export async function upsertModifierFromRemote({ remoteId, remoteCategoryId, remoteProductId, name, priceDelta, sortOrder, isActive }) {
  requireDb()
  let localCatId = null
  let localProdId = null
  if (remoteCategoryId != null) {
    const r = db.exec('SELECT id FROM categories WHERE remote_id = ?', [String(remoteCategoryId)])
    localCatId = r.length && r[0].values.length ? r[0].values[0][0] : null
    if (localCatId == null) return false
  }
  if (remoteProductId != null) {
    const r = db.exec('SELECT id FROM products WHERE remote_id = ?', [String(remoteProductId)])
    localProdId = r.length && r[0].values.length ? r[0].values[0][0] : null
    if (localProdId == null) return false
  }

  const existing = db.exec('SELECT id, is_synced FROM modifiers WHERE remote_id = ?', [String(remoteId)])
  if (existing.length && existing[0].values.length) {
    const [localId, isSynced] = existing[0].values[0]
    if (!isSynced) return true // local pending edit wins until it has been pushed
    db.run(
      `UPDATE modifiers
       SET category_id = ?, product_id = ?, name = ?, price_delta = ?, sort_order = ?, is_active = ?, is_synced = 1
       WHERE id = ?`,
      [localCatId, localProdId, name, Number(priceDelta) || 0, sortOrder ?? 0, isActive ? 1 : 0, localId]
    )
  } else {
    if (hasPendingDelete('modifier', remoteId)) return true
    const localId = newLocalId()
    db.run(
      `INSERT OR IGNORE INTO modifiers
         (id, local_id, category_id, product_id, name, price_delta, sort_order, is_active, is_synced, remote_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [localId, crypto.randomUUID(), localCatId, localProdId,
       name, Number(priceDelta) || 0, sortOrder ?? 0, isActive ? 1 : 0, String(remoteId)]
    )
  }
  return true
}

// Insert/update a product variant coming from Supabase. Resolves the remote
// product id back to the local product; skips if the parent isn't pulled yet
// (next pass picks it up) or if the product has a pending local variant set
// (replaceVariants marks the whole set unsynced — local state is authoritative
// until pushed).
export async function upsertVariantFromRemote({ remoteId, remoteProductId, localId, name, price }) {
  requireDb()
  const pRes = db.exec('SELECT id FROM products WHERE remote_id = ?', [String(remoteProductId)])
  const localProdId = pRes.length && pRes[0].values.length ? pRes[0].values[0][0] : null
  if (localProdId == null) return false

  const dirty = db.exec('SELECT 1 FROM product_variants WHERE product_id = ? AND is_synced = 0 LIMIT 1', [localProdId])
  if (dirty.length && dirty[0].values.length) return true

  const existing = db.exec('SELECT id FROM product_variants WHERE remote_id = ?', [String(remoteId)])
  if (existing.length && existing[0].values.length) {
    db.run(
      'UPDATE product_variants SET product_id = ?, name = ?, price = ?, is_synced = 1 WHERE id = ?',
      [localProdId, name, Number(price) || 0, existing[0].values[0][0]]
    )
    return true
  }
  if (hasPendingDelete('variant', remoteId)) return true

  // Adopt a row this device pushed earlier: the remote local_id is the
  // integer id we sent at push time.
  const adoptId = Number(localId)
  if (localId != null && Number.isFinite(adoptId)) {
    const own = db.exec('SELECT id FROM product_variants WHERE id = ? AND product_id = ?', [adoptId, localProdId])
    if (own.length && own[0].values.length) {
      db.run(
        'UPDATE product_variants SET name = ?, price = ?, is_synced = 1, remote_id = ? WHERE id = ?',
        [name, Number(price) || 0, String(remoteId), adoptId]
      )
      return true
    }
  }

  const newId = newLocalId()
  db.run(
    'INSERT OR IGNORE INTO product_variants (id, product_id, name, price, created_at, is_synced, remote_id) VALUES (?,?,?,?,?,1,?)',
    [newId, localProdId, name, Number(price) || 0, new Date().toISOString(), String(remoteId)]
  )
  return true
}

export async function upsertProductModifierExcludeFromRemote({ remoteProductId, remoteModifierId }) {
  requireDb()
  const pr = db.exec('SELECT id FROM products WHERE remote_id = ?', [String(remoteProductId)])
  const mr = db.exec('SELECT id FROM modifiers WHERE remote_id = ?', [String(remoteModifierId)])
  const localProd = pr.length && pr[0].values.length ? pr[0].values[0][0] : null
  const localMod  = mr.length && mr[0].values.length ? mr[0].values[0][0] : null
  if (localProd == null || localMod == null) return false
  db.run(
    'INSERT OR IGNORE INTO product_modifier_excludes (product_id, modifier_id, is_synced) VALUES (?, ?, 1)',
    [localProd, localMod]
  )
  // Mark existing rows synced (in case they were inserted offline first)
  db.run('UPDATE product_modifier_excludes SET is_synced = 1 WHERE product_id = ? AND modifier_id = ?',
    [localProd, localMod])
  return true
}

export async function upsertProductFromRemote({ remoteId, name, price, stock, remoteCatId, imageUrl, pointsValue = 0 }) {
  requireDb()
  // Resolve local category id from its remote_id
  const catRes = db.exec('SELECT id FROM categories WHERE remote_id = ?', [String(remoteCatId)])
  const localCatId = catRes.length && catRes[0].values.length ? catRes[0].values[0][0] : remoteCatId

  const existing = db.exec('SELECT id, is_synced FROM products WHERE remote_id = ?', [String(remoteId)])
  if (existing.length && existing[0].values.length) {
    const [localId, isSynced] = existing[0].values[0]
    if (!isSynced) return // local pending edit wins until it has been pushed
    db.run(
      'UPDATE products SET name=?, price=?, stock=?, category_id=?, image_url=?, points_value=?, is_synced=1 WHERE id=?',
      [name, price, stock, localCatId, imageUrl ?? null, pointsValue ?? 0, localId]
    )
  } else {
    if (hasPendingDelete('product', remoteId)) return
    const localId = newLocalId()
    db.run(
      'INSERT OR IGNORE INTO products (id, name, price, stock, category_id, image_url, points_value, is_synced, remote_id) VALUES (?,?,?,?,?,?,?,1,?)',
      [localId, name, price, stock, localCatId, imageUrl ?? null, pointsValue ?? 0, String(remoteId)]
    )
  }
}

// ── One-time duplicate cleanup ────────────────────────────────────
// The old push code upserted categories/ingredients by device-local id, so a
// row pulled from Supabase forked into a duplicate on every edit (color
// change, stock consumption). The push is fixed; this merges the duplicates
// that already exist. Losers are remapped onto a deterministic keeper
// (prefer the oldest remote row), tombstoned in pending_deletes so the
// remote copies get deleted on the next push, then removed locally.
// Idempotent — guarded by a meta flag and safe to run twice.
export async function dedupeSyncedEntities() {
  requireDb()
  const doneRes = db.exec("SELECT value FROM meta WHERE key = 'dedupe-v1'")
  if (doneRes.length && doneRes[0].values.length) return null
  const removed = { categories: 0, ingredients: 0 }

  // Keeper preference: has remote_id (oldest remote row wins), else lowest local id
  const pickKeeper = (rows) => [...rows].sort((a, b) => {
    const ar = a.remoteId != null ? Number(a.remoteId) : Infinity
    const br = b.remoteId != null ? Number(b.remoteId) : Infinity
    if (ar !== br) return ar - br
    return a.id - b.id
  })[0]

  const groupBy = (rows, keyFn) => {
    const groups = new Map()
    for (const r of rows) {
      const k = keyFn(r)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(r)
    }
    return groups
  }

  // ── Categories: group by normalized name ─────────────────────────
  const catRes = db.exec('SELECT id, name, remote_id FROM categories')
  const cats = catRes.length ? catRes[0].values.map(([id, name, remote_id]) => ({ id, name, remoteId: remote_id })) : []
  for (const [, group] of groupBy(cats, c => String(c.name).trim().toLowerCase())) {
    if (group.length < 2) continue
    const keeper = pickKeeper(group)
    for (const loser of group) {
      if (loser.id === keeper.id) continue
      // Remap FKs — flag unsynced so the new category assignment pushes too
      db.run('UPDATE products  SET category_id = ?, is_synced = 0 WHERE category_id = ?', [keeper.id, loser.id])
      db.run('UPDATE modifiers SET category_id = ?, is_synced = 0 WHERE category_id = ?', [keeper.id, loser.id])
      if (loser.remoteId != null) {
        db.run("INSERT INTO pending_deletes (entity_type, remote_id) VALUES ('category', ?)", [loser.remoteId])
      }
      db.run('DELETE FROM categories WHERE id = ?', [loser.id])
      removed.categories++
    }
  }

  // ── Ingredients: group by normalized name + unit ─────────────────
  const ingRes = db.exec('SELECT id, name, unit, stock_amount, remote_id FROM ingredients')
  const ings = ingRes.length ? ingRes[0].values.map(([id, name, unit, stock_amount, remote_id]) =>
    ({ id, name, unit, stockAmount: stock_amount, remoteId: remote_id })) : []
  for (const [, group] of groupBy(ings, i => `${String(i.name).trim().toLowerCase()}|${i.unit}`)) {
    if (group.length < 2) continue
    const keeper = pickKeeper(group)
    // Duplicates fork with independently-decremented stock — keep the max
    // (safest against dupes that were zeroed by double consumption)
    const maxStock = Math.max(...group.map(i => Number(i.stockAmount) || 0))
    if (maxStock !== (Number(keeper.stockAmount) || 0)) {
      db.run('UPDATE ingredients SET stock_amount = ?, is_synced = 0 WHERE id = ?', [maxStock, keeper.id])
    }
    for (const loser of group) {
      if (loser.id === keeper.id) continue
      // Recipe remaps — drop loser rows that would collide with an existing keeper row
      db.run(
        `DELETE FROM product_variant_ingredients WHERE ingredient_id = ?
         AND variant_id IN (SELECT variant_id FROM product_variant_ingredients WHERE ingredient_id = ?)`,
        [loser.id, keeper.id]
      )
      db.run('UPDATE product_variant_ingredients SET ingredient_id = ? WHERE ingredient_id = ?', [keeper.id, loser.id])
      db.run(
        `DELETE FROM product_ingredients WHERE ingredient_id = ?
         AND product_id IN (SELECT product_id FROM product_ingredients WHERE ingredient_id = ?)`,
        [loser.id, keeper.id]
      )
      db.run('UPDATE product_ingredients SET ingredient_id = ? WHERE ingredient_id = ?', [keeper.id, loser.id])
      if (loser.remoteId != null) {
        db.run("INSERT INTO pending_deletes (entity_type, remote_id) VALUES ('ingredient', ?)", [loser.remoteId])
      }
      db.run('DELETE FROM ingredients WHERE id = ?', [loser.id])
      removed.ingredients++
    }
  }

  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('dedupe-v1', ?)", [new Date().toISOString()])
  await persistDb()
  return removed
}

// Remove local rows whose remote counterpart no longer exists (deleted on
// another device, or product deactivated). Only fully-synced rows are touched
// (is_synced = 1 with a remote_id) so pending local work is never dropped.
// The caller must skip this when the remote set came back empty — an empty
// list usually means RLS/auth returned nothing, not an intentional full wipe.
export function reconcileRemoteDeletions(entityType, remoteIds) {
  requireDb()
  if (!remoteIds || remoteIds.length === 0) return 0
  const tableMap = {
    category: 'categories', product: 'products', ingredient: 'ingredients',
    variant: 'product_variants', modifier: 'modifiers',
  }
  const table = tableMap[entityType]
  if (!table) return 0
  const idSet = new Set(remoteIds.map(String))
  const res = db.exec(`SELECT id, remote_id FROM ${table} WHERE remote_id IS NOT NULL AND is_synced = 1`)
  let removed = 0
  if (res.length) {
    for (const [localId, remoteId] of res[0].values) {
      if (!idSet.has(String(remoteId))) {
        db.run(`DELETE FROM ${table} WHERE id = ?`, [localId])
        removed++
      }
    }
  }
  // sql.js doesn't enforce FK cascades — sweep recipe/variant orphans
  if (removed > 0 && (entityType === 'product' || entityType === 'variant')) {
    db.run('DELETE FROM product_variants WHERE product_id NOT IN (SELECT id FROM products)')
    db.run('DELETE FROM product_ingredients WHERE product_id NOT IN (SELECT id FROM products)')
    db.run('DELETE FROM product_variant_ingredients WHERE variant_id NOT IN (SELECT id FROM product_variants)')
  }
  return removed
}

// ── Sync helpers (used by sync.js) ────────────────────────────────
export function getUnsyncedCategories() {
  const res = db.exec('SELECT id, name, color, icon, image_url, remote_id FROM categories WHERE is_synced = 0')
  return res.length ? res[0].values : []
}

export function getUnsyncedProducts() {
  const res = db.exec(
    'SELECT id, name, price, stock, category_id, image_url, recipe, points_value, remote_id FROM products WHERE is_synced = 0'
  )
  return res.length ? res[0].values : []
}

// If the local row was deleted while its push was in flight, marking it
// synced is a no-op — but the freshly-created/updated remote copy would then
// resurrect on the next pull. Tombstone it so the next push deletes it.
function tombstoneIfRowGone(entityType, remoteId) {
  if (db.getRowsModified() === 0) {
    db.run('INSERT INTO pending_deletes (entity_type, remote_id) VALUES (?, ?)', [entityType, remoteId])
  }
}

export async function markCategorySynced(id, remoteId) {
  db.run('UPDATE categories SET is_synced = 1, remote_id = ? WHERE id = ?', [remoteId, id])
  tombstoneIfRowGone('category', remoteId)
  await persistDb()
}

export async function markProductSynced(id, remoteId) {
  db.run('UPDATE products SET is_synced = 1, remote_id = ? WHERE id = ?', [remoteId, id])
  tombstoneIfRowGone('product', remoteId)
  await persistDb()
}

export async function markIngredientSynced(id, remoteId) {
  db.run('UPDATE ingredients SET is_synced = 1, remote_id = ? WHERE id = ?', [remoteId, id])
  tombstoneIfRowGone('ingredient', remoteId)
  await persistDb()
}

export function getUnsyncedVariants() {
  requireDb()
  const res = db.exec(
    `SELECT pv.id, pv.remote_id, p.remote_id as product_remote_id, pv.name, pv.price
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE pv.is_synced = 0 AND p.remote_id IS NOT NULL`
  )
  return res.length ? res[0].values : []
}

export async function markVariantSynced(id, remoteId) {
  db.run('UPDATE product_variants SET is_synced = 1, remote_id = ? WHERE id = ?', [remoteId, id])
  tombstoneIfRowGone('variant', remoteId)
  await persistDb()
}

export function getUnsyncedOrders() {
  const res = db.exec(
    `SELECT id, local_id, table_id, status, payment_method, total, created_at, closed_at, waiter_name, discount, remote_id
     FROM orders WHERE is_synced = 0`
  )
  return res.length ? res[0].values : []
}

export function getUnsyncedOrderItems() {
  const res = db.exec(
    `SELECT oi.id, oi.local_id, o.remote_id as order_remote_id,
            oi.quantity, oi.unit_price, p.remote_id as product_remote_id,
            pv.remote_id as variant_remote_id, oi.note, oi.added_at, oi.remote_id
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN product_variants pv ON pv.id = oi.variant_id
     WHERE oi.is_synced = 0`
  )
  return res.length ? res[0].values : []
}

export async function markOrderSynced(id, remoteId) {
  db.run('UPDATE orders SET is_synced = 1, remote_id = ? WHERE id = ?', [remoteId, id])
  await persistDb()
}

export function markOrderItemSynced(id) {
  db.run('UPDATE order_items SET is_synced = 1 WHERE id = ?', [id])
}

export function getPendingDeletes() {
  if (!db) return []
  const res = db.exec('SELECT id, entity_type, remote_id FROM pending_deletes')
  if (!res.length) return []
  return res[0].values.map(([id, entity_type, remote_id]) => ({ id, entity_type, remote_id }))
}

// ── Modifier sync helpers ─────────────────────────────────────────
// A modifier may have either category_id OR product_id; we resolve the
// corresponding remote_id at push time so the row is FK-correct.
export function getUnsyncedModifiers() {
  requireDb()
  const res = db.exec(
    `SELECT m.id, m.local_id, m.category_id, m.product_id, m.name, m.price_delta,
            m.sort_order, m.is_active, m.remote_id,
            c.remote_id as category_remote_id,
            p.remote_id as product_remote_id
     FROM modifiers m
     LEFT JOIN categories c ON c.id = m.category_id
     LEFT JOIN products   p ON p.id = m.product_id
     WHERE m.is_synced = 0`
  )
  return res.length ? res[0].values : []
}

export async function markModifierSynced(id, remoteId) {
  db.run('UPDATE modifiers SET is_synced = 1, remote_id = ? WHERE id = ?', [String(remoteId), id])
  tombstoneIfRowGone('modifier', remoteId)
  await persistDb()
}

export function getUnsyncedProductModifierExcludes() {
  requireDb()
  const res = db.exec(
    `SELECT pme.product_id, pme.modifier_id,
            p.remote_id as product_remote_id,
            m.remote_id as modifier_remote_id
     FROM product_modifier_excludes pme
     LEFT JOIN products  p ON p.id = pme.product_id
     LEFT JOIN modifiers m ON m.id = pme.modifier_id
     WHERE pme.is_synced = 0`
  )
  return res.length ? res[0].values : []
}

export async function markProductModifierExcludeSynced(productId, modifierId) {
  db.run(
    'UPDATE product_modifier_excludes SET is_synced = 1 WHERE product_id = ? AND modifier_id = ?',
    [productId, modifierId]
  )
  await persistDb()
}

export function getUnsyncedOrderItemModifiers() {
  requireDb()
  const res = db.exec(
    `SELECT oim.id, oim.local_id, oi.remote_id as order_item_remote_id,
            m.remote_id as modifier_remote_id,
            oim.name, oim.price_delta, oim.quantity
     FROM order_item_modifiers oim
     JOIN order_items oi  ON oi.id = oim.order_item_id
     LEFT JOIN modifiers m ON m.id = oim.modifier_id
     WHERE oim.is_synced = 0`
  )
  return res.length ? res[0].values : []
}

export async function markOrderItemModifierSynced(id, remoteId) {
  db.run('UPDATE order_item_modifiers SET is_synced = 1, remote_id = ? WHERE id = ?', [String(remoteId), id])
  await persistDb()
}

export async function clearPendingDelete(id) {
  db.run('DELETE FROM pending_deletes WHERE id = ?', [id])
  await persistDb()
}

// ── offline_credentials (LOCAL ONLY — offline login fallback) ─────
// Upserted on every successful online login (see Login.jsx) so the same
// account can authenticate on this device with no internet. Only a
// PBKDF2 salt+hash is stored — never the plaintext password.
export async function saveOfflineCredential({ email, salt, hash, iterations, user }) {
  requireDb()
  const cleanEmail = email.trim().toLowerCase()
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO offline_credentials (email, salt, hash, iterations, user_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       salt = excluded.salt, hash = excluded.hash, iterations = excluded.iterations,
       user_json = excluded.user_json, updated_at = excluded.updated_at`,
    [cleanEmail, salt, hash, iterations, JSON.stringify(user), now]
  )
  await persistDb()
}

export function getOfflineCredential(email) {
  if (!db) return null
  const cleanEmail = email.trim().toLowerCase()
  const res = db.exec(
    'SELECT salt, hash, iterations, user_json FROM offline_credentials WHERE email = ?',
    [cleanEmail]
  )
  if (!res.length || !res[0].values.length) return null
  const [salt, hash, iterations, userJson] = res[0].values[0]
  let user = null
  try { user = JSON.parse(userJson) } catch { user = null }
  if (!user) return null
  return { salt, hash, iterations, user }
}

export function checkLogin(email, password) {
  requireDb()
  const res = db.exec(
    'SELECT id, email, role FROM users WHERE email = ? AND password = ? LIMIT 1',
    [email.trim().toLowerCase(), password]
  )
  if (!res.length || !res[0].values.length) return null
  const [id, em, role] = res[0].values[0]
  return { id, email: em, role }
}

export function getUnsyncedCount() {
  if (!db) return 0
  const res = db.exec(`
    SELECT
      (SELECT COUNT(*) FROM categories               WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM products                 WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM ingredients              WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM product_variants         WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM orders                   WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM order_items              WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM payments                 WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM payment_items            WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM modifiers                WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM product_modifier_excludes WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM order_item_modifiers     WHERE is_synced = 0) +
      (SELECT COUNT(*) FROM pending_deletes)
    AS total
  `)
  return res[0]?.values[0][0] ?? 0
}

// ── Reporting queries ─────────────────────────────────────────────

function _dateClause(startIso, endIso) {
  if (!startIso && !endIso) return { clause: '', params: [] }
  if (startIso === endIso)  return { clause: "AND date(closed_at,'localtime') = ?", params: [startIso] }
  return {
    clause: "AND date(closed_at,'localtime') >= ? AND date(closed_at,'localtime') <= ?",
    params: [startIso, endIso],
  }
}

export function getReportKpis(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT COALESCE(SUM(total),0), COUNT(*), COALESCE(AVG(total),0)
     FROM orders WHERE status='completed' ${clause}`,
    params
  )
  const [revenue, orderCount, avgOrder] = res[0]?.values[0] ?? [0, 0, 0]
  return { revenue, orderCount, avgOrder }
}

export function getTopProduct(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT oi.name, SUM(oi.quantity) as qty
     FROM order_items oi JOIN orders o ON oi.order_id = o.id
     WHERE o.status='completed' ${clause}
     GROUP BY oi.name ORDER BY qty DESC LIMIT 1`,
    params
  )
  if (!res.length || !res[0].values.length) return { name: '—', qty: 0 }
  const [name, qty] = res[0].values[0]
  return { name, qty }
}

export function getRevenueByPeriod(mode) {
  requireDb()
  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const now = new Date()

  if (mode === 'today') {
    const today = fmt(now)
    const res = db.exec(
      `SELECT CAST(strftime('%H', closed_at,'localtime') AS INTEGER) as h, COALESCE(SUM(total),0)
       FROM orders WHERE status='completed' AND date(closed_at,'localtime') = ?
       GROUP BY h`,
      [today]
    )
    const map = {}
    if (res.length) res[0].values.forEach(([h, v]) => { map[h] = v })
    // Full 24-hour window (00–23)
    return Array.from({ length: 24 }, (_, h) => (
      { label: `${pad(h)}:00`, value: map[h] ?? 0 }
    ))
  }

  if (mode === 'week') {
    const day = now.getDay()
    const diffToMon = day === 0 ? -6 : 1 - day
    const mon = new Date(now); mon.setDate(now.getDate() + diffToMon)
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon); d.setDate(mon.getDate() + i); return fmt(d)
    })
    const labels = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cts', 'Paz']
    const res = db.exec(
      `SELECT date(closed_at,'localtime'), COALESCE(SUM(total),0)
       FROM orders WHERE status='completed'
         AND date(closed_at,'localtime') >= ? AND date(closed_at,'localtime') <= ?
       GROUP BY date(closed_at,'localtime')`,
      [days[0], days[6]]
    )
    const map = {}
    if (res.length) res[0].values.forEach(([d, v]) => { map[d] = v })
    return days.map((d, i) => ({ label: labels[i], value: map[d] ?? 0 }))
  }

  if (mode === 'month') {
    const y = now.getFullYear(), m = now.getMonth()
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    const start = `${y}-${pad(m+1)}-01`
    const end   = `${y}-${pad(m+1)}-${pad(daysInMonth)}`
    const res = db.exec(
      `SELECT CAST(strftime('%d', closed_at,'localtime') AS INTEGER) as d, COALESCE(SUM(total),0)
       FROM orders WHERE status='completed'
         AND date(closed_at,'localtime') >= ? AND date(closed_at,'localtime') <= ?
       GROUP BY d`,
      [start, end]
    )
    const map = {}
    if (res.length) res[0].values.forEach(([d, v]) => { map[d] = v })
    return Array.from({ length: daysInMonth }, (_, i) => ({ label: String(i+1), value: map[i+1] ?? 0 }))
  }

  // total — group by month
  const TR_MONTHS = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara']
  const res = db.exec(
    `SELECT strftime('%Y-%m', closed_at,'localtime') as mo, COALESCE(SUM(total),0)
     FROM orders WHERE status='completed'
     GROUP BY mo ORDER BY mo`
  )
  if (!res.length || !res[0].values.length) {
    const mo = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
    const [y2, m2] = mo.split('-')
    return [{ label: `${TR_MONTHS[parseInt(m2)-1]} ${y2.slice(2)}`, value: 0 }]
  }
  return res[0].values.map(([mo, v]) => {
    const [y2, m2] = mo.split('-')
    return { label: `${TR_MONTHS[parseInt(m2)-1]} ${y2.slice(2)}`, value: v }
  })
}

export function getPaymentBreakdown(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT
       COALESCE(SUM(CASE WHEN payment_method='cash'  THEN total
                         WHEN payment_method='split' THEN COALESCE(cash_amount,0)
                         ELSE 0 END), 0) as nakit,
       COALESCE(SUM(CASE WHEN payment_method='card'  THEN total
                         WHEN payment_method='split' THEN COALESCE(card_amount,0)
                         ELSE 0 END), 0) as kart,
       COALESCE(SUM(CASE WHEN payment_method='iban'  THEN total
                         WHEN payment_method='split' THEN COALESCE(iban_amount,0)
                         ELSE 0 END), 0) as iban
     FROM orders WHERE status='completed' ${clause}`,
    params
  )
  const [nakit, kart, iban] = res[0]?.values[0] ?? [0, 0, 0]
  return [
    { name: 'Nakit', value: nakit },
    { name: 'Kart',  value: kart },
    { name: 'IBAN',  value: iban },
  ]
}

// Discount + points + gross/net revenue for the Reports payment breakdown card.
// Points redemptions are stored per-payment (not on the order's amount columns),
// so they're summed separately from the `payments` table.
export function getPaymentMethodDetail(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT COALESCE(SUM(discount),0), COALESCE(SUM(total),0)
     FROM orders WHERE status='completed' ${clause}`,
    params
  )
  const [discount, netRevenue] = res[0]?.values[0] ?? [0, 0]

  const pointsRes = db.exec(
    `SELECT COALESCE(SUM(p.amount),0)
     FROM payments p JOIN orders o ON o.id = p.order_id
     WHERE o.status='completed' AND p.payment_method='points' ${clause}`,
    params
  )
  const points = pointsRes[0]?.values[0]?.[0] ?? 0

  return {
    discount,
    points,
    netRevenue,
    grossRevenue: netRevenue + discount,
  }
}

export function getTableRevenue(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT table_name, COALESCE(SUM(total),0) as rev
     FROM orders WHERE status='completed' AND table_name != '' ${clause}
     GROUP BY table_name ORDER BY rev DESC LIMIT 5`,
    params
  )
  if (!res.length) return []
  return res[0].values.map(([name, value]) => ({ name, value }))
}

export function getTopProducts(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT oi.name, SUM(oi.quantity) as qty, SUM(oi.quantity * oi.unit_price) as rev
     FROM order_items oi JOIN orders o ON oi.order_id = o.id
     WHERE o.status='completed' ${clause}
     GROUP BY oi.name ORDER BY qty DESC LIMIT 5`,
    params
  )
  if (!res.length) return []
  return res[0].values.map(([name, qty, revenue]) => ({ name, qty, revenue }))
}

export function getProductSalesDetail(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const daysRes = db.exec(
    `SELECT COUNT(DISTINCT date(closed_at,'localtime'))
     FROM orders WHERE status='completed' ${clause}`,
    params
  )
  const days = daysRes[0]?.values[0][0] || 1
  const res = db.exec(
    `SELECT oi.name,
            COALESCE(c.name, '—') as cat_name,
            SUM(oi.quantity) as qty,
            SUM(oi.quantity * oi.unit_price) as revenue
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     LEFT JOIN products p ON oi.product_id = p.id
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE o.status='completed' ${clause}
     GROUP BY oi.name ORDER BY revenue DESC`,
    params
  )
  if (!res.length) return []
  return res[0].values.map(([name, category, qty, revenue]) => ({
    name, category, qty, revenue,
    dailyAvg: days > 0 ? revenue / days : 0,
  }))
}

export function getTableProductBreakdown(tableName, startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT oi.name, SUM(oi.quantity) as qty, SUM(oi.quantity * oi.unit_price) as revenue
     FROM order_items oi JOIN orders o ON oi.order_id = o.id
     WHERE o.status='completed' AND o.table_name=? ${clause}
     GROUP BY oi.name ORDER BY revenue DESC`,
    [tableName, ...params]
  )
  if (!res.length) return []
  return res[0].values.map(([name, qty, revenue]) => ({ name, qty, revenue }))
}

export function getProductTableBreakdown(productName, startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT o.table_name, SUM(oi.quantity) as qty, SUM(oi.quantity * oi.unit_price) as revenue
     FROM order_items oi JOIN orders o ON oi.order_id = o.id
     WHERE o.status='completed' AND oi.name=? ${clause}
     GROUP BY o.table_name ORDER BY revenue DESC`,
    [productName, ...params]
  )
  if (!res.length) return []
  return res[0].values.map(([table, qty, revenue]) => ({ table, qty, revenue }))
}

// ── Staff performance queries ─────────────────────────────────────

export function getStaffPerformance(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT waiter_name, COUNT(*) as order_count, COALESCE(SUM(total), 0) as revenue
     FROM orders
     WHERE status = 'completed'
       AND waiter_name IS NOT NULL AND waiter_name != '' ${clause}
     GROUP BY waiter_name
     ORDER BY revenue DESC`,
    params
  )
  if (!res.length) return []
  return res[0].values.map(([name, orderCount, revenue]) => ({ name, orderCount, revenue }))
}

export function getStaffItemBreakdown(staffName, startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT oi.name, SUM(oi.quantity) as qty, SUM(oi.quantity * oi.unit_price) as revenue
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     WHERE o.status = 'completed' AND o.waiter_name = ? ${clause}
     GROUP BY oi.name
     ORDER BY revenue DESC`,
    [staffName, ...params]
  )
  if (!res.length) return []
  return res[0].values.map(([name, qty, revenue]) => ({ name, qty, revenue }))
}

export function getStaffHourlySales(staffName, startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT CAST(strftime('%H', closed_at) AS INTEGER) as hour,
            COUNT(*) as orders,
            COALESCE(SUM(total), 0) as revenue
     FROM orders
     WHERE status = 'completed' AND waiter_name = ? ${clause}
     GROUP BY hour
     ORDER BY hour`,
    [staffName, ...params]
  )
  if (!res.length) return []
  return res[0].values.map(([hour, orders, revenue]) => ({ hour, orders, revenue }))
}

// ── Category revenue ──────────────────────────────────────────────

export function getCategoryRevenue(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT COALESCE(c.name, 'Kategorisiz') as category,
            SUM(oi.quantity) as qty,
            SUM(oi.quantity * oi.unit_price) as revenue
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE o.status = 'completed' ${clause}
     GROUP BY c.name
     ORDER BY revenue DESC`,
    params
  )
  if (!res.length || !res[0].values.length) return []
  const rows = res[0].values.map(([category, qty, revenue]) => ({ category, qty, revenue }))
  const total = rows.reduce((s, r) => s + r.revenue, 0) || 1
  return rows.map(r => ({ ...r, pct: Math.round((r.revenue / total) * 100) }))
}

// ── Ingredient consumption ────────────────────────────────────────

export function getIngredientConsumption(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const consumed = {}

  // Direct product recipe consumption
  const directRes = db.exec(
    `SELECT pi.ingredient_id, SUM(pi.amount_used * oi.quantity)
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN product_ingredients pi ON pi.product_id = oi.product_id
     WHERE o.status = 'completed' AND oi.variant_id IS NULL ${clause}
     GROUP BY pi.ingredient_id`,
    params
  )
  if (directRes.length) directRes[0].values.forEach(([id, c]) => { consumed[id] = (consumed[id] || 0) + c })

  // Variant recipe consumption
  const variantRes = db.exec(
    `SELECT pvi.ingredient_id, SUM(pvi.amount_used * oi.quantity)
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN product_variant_ingredients pvi ON pvi.variant_id = oi.variant_id
     WHERE o.status = 'completed' AND oi.variant_id IS NOT NULL ${clause}
     GROUP BY pvi.ingredient_id`,
    params
  )
  if (variantRes.length) variantRes[0].values.forEach(([id, c]) => { consumed[id] = (consumed[id] || 0) + c })

  const ingRes = db.exec('SELECT id, name, unit, stock_amount, min_stock_alert FROM ingredients ORDER BY name')
  if (!ingRes.length) return []
  return ingRes[0].values.map(([id, name, unit, stock_amount, min_stock_alert]) => ({
    id, name, unit,
    currentStock: stock_amount,
    minStockAlert: min_stock_alert,
    consumed: consumed[id] || 0,
  }))
}

// ── Order history ─────────────────────────────────────────────────

export function getOrdersList(startIso, endIso) {
  requireDb()
  const { clause, params } = _dateClause(startIso, endIso)
  const res = db.exec(
    `SELECT o.id, o.closed_at, o.table_name, o.payment_method, o.total, o.waiter_name,
            GROUP_CONCAT(oi.name || ' ×' || oi.quantity, ', ') as items_summary
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.status = 'completed' ${clause}
     GROUP BY o.id
     ORDER BY o.closed_at DESC`,
    params
  )
  if (!res.length || !res[0].values.length) return []
  const orders = res[0].values.map(([id, closedAt, tableName, paymentMethod, total, waiterName, itemsSummary]) => ({
    id, closedAt, tableName, paymentMethod, total,
    waiterName: waiterName || null,
    itemsSummary: itemsSummary || '',
    items: [],
  }))

  const orderIds = orders.map(o => o.id)
  if (orderIds.length === 0) return orders

  const itemsByOrder = {}
  const allItemIds = []
  const placeholders = orderIds.map(() => '?').join(',')
  const itemsRes = db.exec(
    `SELECT id, order_id, name, quantity, unit_price
     FROM order_items
     WHERE order_id IN (${placeholders})
     ORDER BY id`,
    orderIds
  )
  if (itemsRes.length && itemsRes[0].values.length) {
    for (const [iid, oid, name, qty, unitPrice] of itemsRes[0].values) {
      if (!itemsByOrder[oid]) itemsByOrder[oid] = []
      itemsByOrder[oid].push({ id: iid, name, qty, unitPrice, modifiers: [] })
      allItemIds.push(iid)
    }
  }

  const modsMap = getModifiersForOrderItems(allItemIds)
  for (const items of Object.values(itemsByOrder)) {
    for (const it of items) {
      it.modifiers = modsMap[it.id] || []
    }
  }

  for (const o of orders) {
    o.items = itemsByOrder[o.id] || []
  }
  return orders
}

export function getOrderItems(orderId) {
  requireDb()
  const res = db.exec(
    `SELECT id, name, quantity, unit_price FROM order_items WHERE order_id = ? ORDER BY id`,
    [orderId]
  )
  if (!res.length || !res[0].values.length) return []
  const items = res[0].values.map(([id, name, quantity, unitPrice]) => ({
    id, name, quantity, unitPrice, modifiers: [],
  }))
  const modsMap = getModifiersForOrderItems(items.map(i => i.id))
  for (const it of items) {
    it.modifiers = modsMap[it.id] || []
  }
  return items
}

// ── staff CRUD (LOCAL ONLY) ───────────────────────────────────────

// Tek kaynak: src/lib/permissions.js (yeni anahtarlar otomatik yansır)
import { DEFAULT_PERMISSIONS } from './permissions.js'

export function getAllStaff() {
  requireDb()
  const res = db.exec('SELECT id, name, role, is_active, permissions, created_at, contact, email, supabase_uid FROM staff ORDER BY name')
  if (!res.length) return []
  return res[0].values.map(([id, name, role, is_active, permissions, created_at, contact, email, supabase_uid]) => ({
    id,
    name,
    role,
    contact: contact || '',
    email: email || '',
    supabaseUid: supabase_uid || null,
    isActive: !!is_active,
    permissions: (() => { try { return { ...DEFAULT_PERMISSIONS, ...JSON.parse(permissions || '{}') } } catch { return { ...DEFAULT_PERMISSIONS } } })(),
    createdAt: created_at,
  }))
}

// Giriş yapan Supabase kullanıcısını yerel personel kaydıyla eşler
// (önce supabase_uid, yoksa e-posta). Kayıt yoksa null — çağıran
// önbellek/varsayılan izinlere düşer.
export function findStaffForAuth(supabaseUid, email) {
  if (!db) return null
  const all = getAllStaff()
  return all.find(s => s.supabaseUid && supabaseUid && s.supabaseUid === supabaseUid)
      ?? all.find(s => s.email && email && s.email.toLowerCase() === email.toLowerCase())
      ?? null
}

export async function insertStaff({ name, role = 'Garson', contact = '', email = '', supabaseUid = null, permissions = {} }) {
  requireDb()
  const perms = JSON.stringify({ ...DEFAULT_PERMISSIONS, ...permissions })
  const now   = new Date().toISOString()
  db.run(
    'INSERT INTO staff (name, role, contact, is_active, permissions, created_at, email, supabase_uid) VALUES (?, ?, ?, 1, ?, ?, ?, ?)',
    [name.trim(), role.trim(), contact.trim(), perms, now, email.trim(), supabaseUid]
  )
  await persistDb()
  const res = db.exec('SELECT last_insert_rowid()')
  const id  = res[0].values[0][0]
  return { id, name: name.trim(), role: role.trim(), contact: contact.trim(), email: email.trim(), supabaseUid, isActive: true, permissions: { ...DEFAULT_PERMISSIONS, ...permissions }, createdAt: now }
}

export async function updateStaff({ id, name, role, contact = '', isActive, permissions }) {
  requireDb()
  const perms = JSON.stringify({ ...DEFAULT_PERMISSIONS, ...permissions })
  db.run(
    'UPDATE staff SET name = ?, role = ?, contact = ?, is_active = ?, permissions = ? WHERE id = ?',
    [name.trim(), role.trim(), contact.trim(), isActive ? 1 : 0, perms, id]
  )
  await persistDb()
}

export async function deleteStaff(id) {
  requireDb()
  db.run('DELETE FROM staff WHERE id = ?', [id])
  await persistDb()
}

// ── Active order / order items (parity with mobile) ───────────────
// Active orders are kept in Supabase as the source of truth (mobile model).
// Windows mirrors them locally for offline reads & sync queue.

export async function upsertActiveOrderFromRemote(order) {
  requireDb()
  const existing = db.exec('SELECT id FROM orders WHERE remote_id = ?', [String(order.id)])
  const total = Number(order.total || 0)
  if (existing.length && existing[0].values.length) {
    db.run(
      `UPDATE orders SET status=?, payment_method=?, total=?, table_id=?, table_name=?,
                         closed_at=?, waiter_name=?, is_synced=1 WHERE remote_id=?`,
      [order.status, order.payment_method || '', total, order.table_id, order.table_name || '',
       order.closed_at || '', order.waiter_name || null, String(order.id)]
    )
  } else {
    const localId = newLocalId()
    db.run(
      `INSERT OR IGNORE INTO orders
        (id, local_id, table_id, table_name, status, payment_method, total,
         is_synced, remote_id, created_at, closed_at, waiter_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [localId, order.local_id || crypto.randomUUID(), order.table_id,
       order.table_name || '', order.status, order.payment_method || '',
       total, String(order.id), order.created_at || new Date().toISOString(),
       order.closed_at || '', order.waiter_name || null]
    )
  }
}

// ── payments (LOCAL + SUPABASE) ──────────────────────────────────

export async function insertPayment({ localId, orderId, amount, paymentMethod, payerLabel, processedBy, device = 'desktop', createdAt }) {
  requireDb()
  const id = newLocalId()
  const now = createdAt || new Date().toISOString()
  db.run(
    `INSERT INTO payments
       (id, local_id, order_id, amount, payment_method, payer_label, processed_by, device, is_synced, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [id, localId || crypto.randomUUID(), orderId, Number(amount),
     paymentMethod, payerLabel || null, processedBy || null, device, now]
  )
  await persistDb()
  return id
}

export async function insertPaymentItems(paymentId, orderItemIds) {
  requireDb()
  if (!orderItemIds || orderItemIds.length === 0) return
  for (const oid of orderItemIds) {
    db.run(
      `INSERT OR IGNORE INTO payment_items (payment_id, order_item_id, is_synced) VALUES (?, ?, 0)`,
      [paymentId, oid]
    )
  }
  await persistDb()
}

export function getOrderPayments(orderId) {
  requireDb()
  const pRes = db.exec(
    `SELECT id, local_id, order_id, amount, payment_method, payer_label, processed_by, device, created_at, remote_id
     FROM payments WHERE order_id = ? ORDER BY created_at`,
    [orderId]
  )
  if (!pRes.length) return []
  const payments = pRes[0].values.map(([id, local_id, order_id, amount, payment_method, payer_label, processed_by, device, created_at, remote_id]) => ({
    id, local_id, order_id, amount, payment_method, payer_label, processed_by, device, created_at, remote_id,
    order_item_ids: [],
  }))
  const piRes = db.exec(
    `SELECT payment_id, order_item_id FROM payment_items
     WHERE payment_id IN (SELECT id FROM payments WHERE order_id = ?)`,
    [orderId]
  )
  if (piRes.length) {
    const byId = {}
    payments.forEach(p => { byId[p.id] = p })
    for (const [paymentId, orderItemId] of piRes[0].values) {
      if (byId[paymentId]) byId[paymentId].order_item_ids.push(orderItemId)
    }
  }
  return payments
}

export function getPaidItemIds(orderId) {
  requireDb()
  const res = db.exec(
    `SELECT pi.order_item_id
     FROM payment_items pi
     JOIN payments p ON p.id = pi.payment_id
     WHERE p.order_id = ?`,
    [orderId]
  )
  if (!res.length) return new Set()
  return new Set(res[0].values.map(([id]) => id))
}

export function getOrderTotalPaid(orderId) {
  requireDb()
  const res = db.exec(
    `SELECT COALESCE(SUM(amount), 0) FROM payments WHERE order_id = ?`,
    [orderId]
  )
  return Number(res[0]?.values[0][0] || 0)
}

// ── Active orders local CRUD (one active order per table) ─────────

export async function insertActiveOrder({ tableId, tableName, waiterName }) {
  requireDb()
  const id = newLocalId()
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO orders
       (id, local_id, table_id, table_name, status, payment_method, total,
        is_synced, created_at, closed_at, waiter_name)
     VALUES (?, ?, ?, ?, 'active', '', 0, 0, ?, '', ?)`,
    [id, crypto.randomUUID(), tableId, tableName || '', now, waiterName || null]
  )
  await persistDb()
  return id
}

export function getActiveOrderForTable(tableId) {
  requireDb()
  const res = db.exec(
    `SELECT id, local_id, table_id, table_name, status, payment_method, total,
            is_synced, remote_id, created_at, waiter_name
     FROM orders WHERE table_id = ? AND status = 'active' LIMIT 1`,
    [tableId]
  )
  if (!res.length || !res[0].values.length) return null
  const [id, local_id, table_id, table_name, status, payment_method, total, is_synced, remote_id, created_at, waiter_name] =
    res[0].values[0]
  return {
    id, local_id, table_id, table_name, status, payment_method, total,
    is_synced: !!is_synced, remote_id, created_at, waiter_name,
    order_items: getOrderItemRows(id),
  }
}

export function getOrderItemRows(orderId) {
  requireDb()
  const res = db.exec(
    `SELECT id, local_id, order_id, product_id, variant_id, name, quantity, unit_price, note, added_at, is_synced, remote_id
     FROM order_items WHERE order_id = ? ORDER BY COALESCE(added_at, ''), id`,
    [orderId]
  )
  if (!res.length) return []
  return res[0].values.map(([id, local_id, order_id, product_id, variant_id, name, quantity, unit_price, note, added_at, is_synced, remote_id]) => ({
    id, local_id, order_id, product_id, variant_id, name, quantity, unit_price,
    note: note || null, added_at: added_at || null, is_synced: !!is_synced,
    remote_id: remote_id ?? null,
  }))
}

// Remote ids for a set of local order_items ids — used when pushing
// payment_items junctions immediately after a payment.
export function getOrderItemRemoteIds(itemIds) {
  requireDb()
  if (!itemIds?.length) return {}
  const placeholders = itemIds.map(() => '?').join(',')
  const res = db.exec(`SELECT id, remote_id FROM order_items WHERE id IN (${placeholders})`, itemIds)
  const map = {}
  if (res.length) {
    for (const [id, remote] of res[0].values) {
      if (remote != null) map[id] = remote
    }
  }
  return map
}

// ── Partial payment support ───────────────────────────────────────
// Materialize a runtime order group (Tables.jsx runtimeStates) into the local
// orders/order_items tables so payments have something durable to attach to.
// Idempotent: the order is keyed by the group's runtime localId (uuid), items
// are reconciled by runtime id (manual items → order_items.local_id, QR items
// → order_items.remote_id), and rows dropped from the runtime group are
// deleted unless already paid. QR groups map onto their existing Supabase
// order via remote_id instead of creating a second remote order.
export async function ensurePersistedActiveOrder({ tableId, tableName, waiterName = null, groupLocalId, supabaseOrderId = null, items = [], total = 0 }) {
  requireDb()
  let orderId = null
  let remoteId = supabaseOrderId != null ? String(supabaseOrderId) : null

  let res = db.exec("SELECT id, remote_id FROM orders WHERE local_id = ? AND status = 'active'", [String(groupLocalId)])
  if (!(res.length && res[0].values.length) && supabaseOrderId != null) {
    res = db.exec("SELECT id, remote_id FROM orders WHERE remote_id = ? AND status = 'active'", [String(supabaseOrderId)])
  }
  if (res.length && res[0].values.length) {
    orderId  = res[0].values[0][0]
    remoteId = res[0].values[0][1] != null ? String(res[0].values[0][1]) : remoteId
    // Only flag unsynced when something actually changed — this runs on a
    // debounce for every open table and must not spam the push queue
    db.run(
      `UPDATE orders SET total = ?, table_id = ?, table_name = ?,
              is_synced = CASE WHEN total = ? AND table_id = ? AND table_name = ? THEN is_synced ELSE 0 END
       WHERE id = ?`,
      [Number(total) || 0, tableId, tableName || '',
       Number(total) || 0, tableId, tableName || '', orderId])
  } else {
    orderId = newLocalId()
    db.run(
      `INSERT INTO orders
         (id, local_id, table_id, table_name, status, payment_method, total,
          is_synced, remote_id, created_at, closed_at, waiter_name)
       VALUES (?, ?, ?, ?, 'active', '', ?, ?, ?, ?, '', ?)`,
      [orderId, String(groupLocalId), tableId, tableName || '',
       Number(total) || 0, remoteId ? 1 : 0, remoteId, new Date().toISOString(), waiterName || null]
    )
  }

  const rowsRes = db.exec('SELECT id, local_id, remote_id, quantity, unit_price, note FROM order_items WHERE order_id = ?', [orderId])
  const byLocal = new Map()
  const byRemote = new Map()
  if (rowsRes.length) {
    for (const [rid, rLocal, rRemote, rQty, rPrice, rNote] of rowsRes[0].values) {
      const row = { id: rid, qty: rQty, unitPrice: rPrice, note: rNote ?? null }
      byLocal.set(String(rLocal), row)
      if (rRemote != null) byRemote.set(String(rRemote), row)
    }
  }

  const itemIdMap = {}
  const seen = new Set()
  for (const it of items) {
    const key = String(it.id)
    // QR items carry their Supabase integer id as the runtime id
    const isRemoteItem = supabaseOrderId != null && /^\d+$/.test(key)
    const existing = isRemoteItem ? (byRemote.get(key) ?? byLocal.get(key)) : byLocal.get(key)
    if (existing != null) {
      const qty = Number(it.qty) || 1
      const unitPrice = Number(it.unitPrice) || 0
      const note = it.note || null
      if (existing.qty !== qty || existing.unitPrice !== unitPrice || existing.note !== note) {
        db.run('UPDATE order_items SET quantity = ?, unit_price = ?, note = ?, is_synced = 0 WHERE id = ?',
          [qty, unitPrice, note, existing.id])
      }
      itemIdMap[it.id] = existing.id
      seen.add(existing.id)
      continue
    }
    const newId = newLocalId()
    db.run(
      `INSERT INTO order_items
         (id, local_id, order_id, product_id, variant_id, name, quantity, unit_price, note, added_at, is_synced, remote_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId,
       isRemoteItem ? crypto.randomUUID() : key,
       orderId,
       it.productId ?? null, it.variantId ?? null, it.name,
       Number(it.qty) || 1, Number(it.unitPrice) || 0, it.note || null,
       it.addedAt ?? new Date().toISOString(),
       isRemoteItem ? 1 : 0,
       isRemoteItem ? key : null]
    )
    for (const m of (it.modifiers ?? [])) {
      db.run(
        `INSERT INTO order_item_modifiers (local_id, order_item_id, modifier_id, name, price_delta, quantity, is_synced)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), newId, m.modifierId ?? m.id ?? null, m.name,
         Number(m.priceDelta) || 0, Math.max(1, Number(m.quantity) || 1), isRemoteItem ? 1 : 0]
      )
    }
    itemIdMap[it.id] = newId
    seen.add(newId)
  }

  // Drop persisted rows no longer in the runtime group — unless already paid
  const paidSet = getPaidItemIds(orderId)
  if (rowsRes.length) {
    for (const [rid] of rowsRes[0].values) {
      if (!seen.has(rid) && !paidSet.has(rid)) {
        db.run('DELETE FROM order_item_modifiers WHERE order_item_id = ?', [rid])
        db.run('DELETE FROM order_items WHERE id = ?', [rid])
      }
    }
  }

  await persistDb()
  return { orderId, remoteId, itemIdMap }
}

// Local active orders that also exist on Supabase — the pull uses these to
// fetch payments recorded on other devices (e.g. mobile split payments).
export function getActiveRemoteOrders() {
  requireDb()
  const res = db.exec("SELECT id, remote_id FROM orders WHERE status = 'active' AND remote_id IS NOT NULL")
  if (!res.length) return []
  return res[0].values.map(([id, remote_id]) => ({ id, remoteId: remote_id }))
}

// A payment recorded on another device. Matched by remote_id, then by
// local_id (a payment this device pushed earlier); inserted as pre-synced.
export async function upsertPaymentFromRemote({ remoteId, localId, localOrderId, amount, paymentMethod, payerLabel, processedBy, device, createdAt }) {
  requireDb()
  let res = db.exec('SELECT id FROM payments WHERE remote_id = ?', [String(remoteId)])
  if (res.length && res[0].values.length) return false
  if (localId) {
    res = db.exec('SELECT id FROM payments WHERE local_id = ?', [String(localId)])
    if (res.length && res[0].values.length) {
      db.run('UPDATE payments SET remote_id = ?, is_synced = 1 WHERE id = ?', [String(remoteId), res[0].values[0][0]])
      return false
    }
  }
  const id = newLocalId()
  db.run(
    `INSERT INTO payments
       (id, local_id, order_id, amount, payment_method, payer_label, processed_by, device, is_synced, remote_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, localId || crypto.randomUUID(), localOrderId, Number(amount) || 0,
     paymentMethod || 'cash', payerLabel || null, processedBy || null,
     device || 'remote', String(remoteId), createdAt || new Date().toISOString()]
  )
  return true
}

export function upsertPaymentItemFromRemote({ remotePaymentId, remoteOrderItemId }) {
  requireDb()
  const p  = db.exec('SELECT id FROM payments WHERE remote_id = ?', [String(remotePaymentId)])
  const oi = db.exec('SELECT id FROM order_items WHERE remote_id = ?', [String(remoteOrderItemId)])
  const paymentId = p.length && p[0].values.length ? p[0].values[0][0] : null
  const itemId    = oi.length && oi[0].values.length ? oi[0].values[0][0] : null
  if (paymentId == null || itemId == null) return false
  db.run('INSERT OR IGNORE INTO payment_items (payment_id, order_item_id, is_synced) VALUES (?, ?, 1)', [paymentId, itemId])
  return true
}

// The order was closed (or cancelled) on another device — mirror it locally
// as already-synced so we don't push the status back.
export async function mirrorRemoteOrderStatus(orderId, { status, paymentMethod = null, closedAt = null }) {
  requireDb()
  db.run(
    `UPDATE orders SET status = ?, payment_method = COALESCE(?, payment_method),
            closed_at = COALESCE(NULLIF(?, ''), NULLIF(closed_at, ''), ?), is_synced = 1
     WHERE id = ?`,
    [status, paymentMethod, closedAt ?? '', new Date().toISOString(), orderId]
  )
  await persistDb()
}

// Supabase orders satırı masa adı taşımaz (yalnızca table_id) — yerel
// table_defs'ten çöz. Bulunamazsa çağıran tarafta '' fallback'i kullanılır.
function getTableNameById(tableId) {
  requireDb()
  if (tableId == null) return null
  const res = db.exec('SELECT name FROM table_defs WHERE id = ?', [tableId])
  return res.length && res[0].values.length ? res[0].values[0][0] : null
}

function getLocalProductIdByRemote(remoteId) {
  requireDb()
  if (remoteId == null) return null
  const res = db.exec('SELECT id FROM products WHERE remote_id = ?', [String(remoteId)])
  return res.length && res[0].values.length ? res[0].values[0][0] : null
}

function getLocalVariantIdByRemote(remoteId) {
  requireDb()
  if (remoteId == null) return null
  const res = db.exec('SELECT id FROM product_variants WHERE remote_id = ?', [String(remoteId)])
  return res.length && res[0].values.length ? res[0].values[0][0] : null
}

// A whole active order (with items + modifiers) discovered on Supabase —
// created or grown by another device (QR, mobile, another desktop) since our
// last pull. Idempotent: matched by remote_id, then local_id. A local order
// already closed/cancelled is never resurrected, and existing local items are
// only ever updated (never deleted) — an unsynced local edit always wins.
export async function upsertRemoteActiveOrder({ remoteId, localId, tableId, tableName, waiterName, total, discount = 0, createdAt, items }) {
  requireDb()
  let localOrderId = null
  let inserted = false
  const addedItemIds = []
  // Supabase sipariş satırında masa adı taşınmaz — yerel masa tanımından çöz
  const resolvedTableName = tableName ?? getTableNameById(tableId) ?? ''

  let res = db.exec('SELECT id, status, is_synced FROM orders WHERE remote_id = ?', [String(remoteId)])
  if (!(res.length && res[0].values.length) && localId != null) {
    res = db.exec('SELECT id, status, is_synced FROM orders WHERE local_id = ?', [String(localId)])
  }

  if (res.length && res[0].values.length) {
    const [id, status, isSynced] = res[0].values[0]
    localOrderId = id
    if (status !== 'active') {
      // Locally closed/cancelled wins — never resurrect
      return { localOrderId, inserted: false, addedItemIds: [] }
    }
    if (isSynced) {
      db.run(
        'UPDATE orders SET table_id = ?, table_name = ?, waiter_name = ?, total = ?, discount = ? WHERE id = ?',
        [tableId, resolvedTableName, waiterName ?? null, Number(total) || 0, Number(discount) || 0, localOrderId]
      )
    }
  } else {
    localOrderId = newLocalId()
    const newLocal = localId ?? crypto.randomUUID()
    const net = Number(total) || 0
    const disc = Number(discount) || 0
    db.run(
      `INSERT INTO orders
         (id, local_id, table_id, table_name, status, payment_method,
          subtotal, tax, discount, total, is_synced, remote_id, created_at, closed_at, waiter_name)
       VALUES (?, ?, ?, ?, 'active', '', ?, 0, ?, ?, 1, ?, ?, '', ?)`,
      [localOrderId, String(newLocal), tableId, resolvedTableName,
       net + disc, disc, net, String(remoteId),
       createdAt ?? new Date().toISOString(), waiterName ?? null]
    )
    inserted = true
  }

  addedItemIds.push(..._mergeRemoteOrderItems(localOrderId, items))

  await persistDb()
  return { localOrderId, inserted, addedItemIds }
}

// Remote sipariş kalemlerini yerel siparişe işler. Eşleşme remote_id, sonra
// local_id ile yapılır; is_synced = 0 olan yerel satır (bekleyen düzenleme)
// her zaman kazanır. Yeni eklenen yerel kalem id'lerini döner.
function _mergeRemoteOrderItems(localOrderId, items) {
  const addedItemIds = []
  for (const item of (items ?? [])) {
    const localProductId = getLocalProductIdByRemote(item.productRemoteId)
    const localVariantId = getLocalVariantIdByRemote(item.variantRemoteId)

    let iRes = db.exec('SELECT id, quantity, note, is_synced FROM order_items WHERE remote_id = ?', [String(item.remoteId)])
    if (!(iRes.length && iRes[0].values.length) && item.localId != null) {
      iRes = db.exec('SELECT id, quantity, note, is_synced FROM order_items WHERE local_id = ?', [String(item.localId)])
    }

    if (iRes.length && iRes[0].values.length) {
      const [id, quantity, note, isSynced] = iRes[0].values[0]
      if (isSynced) {
        if (quantity !== item.quantity || (note || null) !== (item.note || null)) {
          db.run('UPDATE order_items SET quantity = ?, note = ? WHERE id = ?',
            [item.quantity, item.note || null, id])
        }
      }
      // is_synced = 0 → local edit pending push — local wins, skip
      continue
    }

    const newItemId = newLocalId()
    db.run(
      `INSERT INTO order_items
         (id, local_id, order_id, product_id, variant_id, name, quantity, unit_price, note, added_at, is_synced, remote_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [newItemId, item.localId ?? crypto.randomUUID(), localOrderId,
       localProductId, localVariantId, item.name, item.quantity, item.unitPrice,
       item.note || null, item.addedAt ?? new Date().toISOString(), String(item.remoteId)]
    )
    for (const m of (item.modifiers ?? [])) {
      db.run(
        `INSERT INTO order_item_modifiers
           (local_id, order_item_id, modifier_id, name, price_delta, quantity, is_synced, remote_id)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [crypto.randomUUID(), newItemId, m.modifierRemoteId ?? null, m.name,
         Number(m.priceDelta) || 0, Math.max(1, Number(m.quantity) || 1), String(m.remoteId)]
      )
    }
    addedItemIds.push(newItemId)
  }
  return addedItemIds
}

// Verilen remote sipariş id'lerinden yerelde HİÇ bilinmeyenleri döner.
// rows: [{ id, local_id }] — Supabase satırları.
export function filterUnknownRemoteOrders(rows) {
  requireDb()
  const unknown = []
  for (const r of (rows ?? [])) {
    let res = db.exec('SELECT id FROM orders WHERE remote_id = ?', [String(r.id)])
    if (res.length && res[0].values.length) continue
    if (r.local_id) {
      res = db.exec('SELECT id FROM orders WHERE local_id = ?', [String(r.local_id)])
      if (res.length && res[0].values.length) continue
    }
    unknown.push(r.id)
  }
  return unknown
}

// Başka bir cihazda (mobil) hem açılıp hem kapatılmış, bu cihazın hiç
// görmediği bir satış. Raporların (ciro, ödeme dağılımı, personel
// performansı) eksik kalmaması için tamamlanmış olarak, ödemeleriyle
// birlikte ve pre-synced (is_synced = 1) yazılır.
export async function insertRemoteCompletedOrder({
  remoteId, localId, tableId, waiterName, total, discount = 0,
  paymentMethod = null, createdAt, closedAt, items, payments,
}) {
  requireDb()
  const localOrderId = newLocalId()
  const net  = Number(total) || 0
  const disc = Number(discount) || 0

  db.run(
    `INSERT INTO orders
       (id, local_id, table_id, table_name, status, payment_method,
        subtotal, tax, discount, total, is_synced, remote_id, created_at, closed_at, waiter_name)
     VALUES (?, ?, ?, ?, 'completed', ?, ?, 0, ?, ?, 1, ?, ?, ?, ?)`,
    [localOrderId, String(localId ?? crypto.randomUUID()), tableId,
     getTableNameById(tableId) ?? '', paymentMethod || '',
     net + disc, disc, net, String(remoteId),
     createdAt ?? new Date().toISOString(),
     closedAt ?? new Date().toISOString(), waiterName ?? null]
  )

  _mergeRemoteOrderItems(localOrderId, items)

  for (const p of (payments ?? [])) {
    await upsertPaymentFromRemote({
      remoteId: p.remoteId, localId: p.localId, localOrderId,
      amount: p.amount, paymentMethod: p.paymentMethod,
      payerLabel: p.payerLabel, processedBy: p.processedBy,
      device: p.device, createdAt: p.createdAt,
    })
  }

  // Ödeme dağılımı raporu order-level tutar kolonlarını okur — masaüstünde
  // completeActiveOrder ne yapıyorsa aynısını uygula.
  const localPayments = getOrderPayments(localOrderId)
  if (localPayments.length > 0) {
    const sumMethod = (pred) => localPayments.filter(pred).reduce((s, p) => s + Number(p.amount), 0)
    const cash   = sumMethod(p => p.payment_method === 'cash')
    const iban   = sumMethod(p => p.payment_method === 'iban')
    const points = sumMethod(p => p.payment_method === 'points')
    const card   = sumMethod(p => !['cash', 'iban', 'points'].includes(p.payment_method))
    const used = [['cash', cash], ['card', card], ['iban', iban], ['points', points]].filter(([, v]) => v > 0)
    const method = used.length > 1 ? 'split' : (used[0]?.[0] ?? paymentMethod ?? 'card')
    db.run(
      `UPDATE orders SET payment_method = ?, cash_amount = ?, card_amount = ?, iban_amount = ?
       WHERE id = ?`,
      [method, cash > 0 ? cash : null, card > 0 ? card : null, iban > 0 ? iban : null, localOrderId]
    )
  }

  await persistDb()
  return localOrderId
}

// Close a materialized order with full financials so the reports
// (payment breakdown, KPIs) see the same columns saveCompletedOrder writes.
export async function completeActiveOrder(orderId, { subtotal, tax, discount, closedAt = null }) {
  requireDb()
  const payments = getOrderPayments(orderId)
  const sumMethod = (pred) => payments.filter(pred).reduce((s, p) => s + Number(p.amount), 0)
  const cash   = sumMethod(p => p.payment_method === 'cash')
  const iban   = sumMethod(p => p.payment_method === 'iban')
  const points = sumMethod(p => p.payment_method === 'points')
  const card   = sumMethod(p => !['cash', 'iban', 'points'].includes(p.payment_method))
  const used = [['cash', cash], ['card', card], ['iban', iban], ['points', points]].filter(([, v]) => v > 0)
  const method = used.length > 1 ? 'split' : (used[0]?.[0] ?? 'card')
  db.run(
    `UPDATE orders SET status = 'completed', payment_method = ?, subtotal = ?, tax = ?, discount = ?,
            cash_amount = ?, card_amount = ?, iban_amount = ?, closed_at = ?, is_synced = 0
     WHERE id = ?`,
    [method, Number(subtotal) || 0, Number(tax) || 0, Number(discount) || 0,
     cash > 0 ? cash : null, card > 0 ? card : null, iban > 0 ? iban : null,
     closedAt || new Date().toISOString(), orderId]
  )
  await persistDb()
  return { method }
}

// Hard-remove a never-synced active order the UI dropped (nothing paid) —
// keeps hydration from resurrecting ghost tables.
export async function deleteActiveOrderCascade(orderId) {
  requireDb()
  db.run('DELETE FROM order_item_modifiers WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)', [orderId])
  db.run('DELETE FROM order_items WHERE order_id = ?', [orderId])
  db.run('DELETE FROM orders WHERE id = ?', [orderId])
  await persistDb()
}

// All active (materialized) orders with their items, modifiers and paid state.
// Used to rebuild runtimeStates after an app restart so partially-paid tables
// survive; tables that never had a partial payment stay volatile as before.
export function getAllActiveOrders() {
  requireDb()
  const res = db.exec(
    `SELECT id, local_id, table_id, table_name, total, remote_id, created_at, waiter_name
     FROM orders WHERE status = 'active' ORDER BY created_at, id`
  )
  if (!res.length) return []
  return res[0].values.map(([id, local_id, table_id, table_name, total, remote_id, created_at, waiter_name]) => {
    const rows = getOrderItemRows(id)
    const modsMap = getModifiersForOrderItems(rows.map(r => r.id))
    const paidSet = getPaidItemIds(id)
    return {
      id, local_id, table_id, table_name, total,
      remote_id: remote_id ?? null, created_at, waiter_name: waiter_name || null,
      totalPaid: getOrderTotalPaid(id),
      items: rows.map(r => ({ ...r, modifiers: modsMap[r.id] || [], paid: paidSet.has(r.id) })),
    }
  })
}

export async function insertOrderItem({ orderId, productId, variantId, name, unitPrice, note, modifiers }) {
  requireDb()
  const id = newLocalId()
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO order_items
       (id, local_id, order_id, product_id, variant_id, name, quantity, unit_price, note, added_at, is_synced)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0)`,
    [id, crypto.randomUUID(), orderId, productId || null, variantId || null,
     name, Number(unitPrice), note || null, now]
  )
  if (modifiers && modifiers.length) {
    await insertOrderItemModifiers(id, modifiers)
  } else {
    await persistDb()
  }
  return id
}

export async function updateOrderItemNote(itemId, note) {
  requireDb()
  db.run('UPDATE order_items SET note = ?, is_synced = 0 WHERE id = ?', [note || null, itemId])
  await persistDb()
}

export async function deleteOrderItemRow(itemId) {
  requireDb()
  // Track delete for sync if it has a remote_id (via order remote)
  db.run('DELETE FROM order_items WHERE id = ?', [itemId])
  await persistDb()
}

export async function updateOrderTotal(orderId, total) {
  requireDb()
  db.run('UPDATE orders SET total = ?, is_synced = 0 WHERE id = ?', [Number(total), orderId])
  await persistDb()
}

export async function setOrderStatus(orderId, status, extra = {}) {
  requireDb()
  const closedAt = extra.closedAt ?? (status === 'completed' || status === 'cancelled' ? new Date().toISOString() : null)
  const paymentMethod = extra.paymentMethod ?? null
  if (paymentMethod !== null) {
    db.run(
      `UPDATE orders SET status = ?, payment_method = ?, closed_at = ?, is_synced = 0 WHERE id = ?`,
      [status, paymentMethod, closedAt || '', orderId]
    )
  } else {
    db.run(
      `UPDATE orders SET status = ?, closed_at = ?, is_synced = 0 WHERE id = ?`,
      [status, closedAt || '', orderId]
    )
  }
  await persistDb()
}

export async function moveOrderToTable(orderId, newTableId, newTableName) {
  requireDb()
  db.run(
    `UPDATE orders SET table_id = ?, table_name = ?, is_synced = 0 WHERE id = ?`,
    [newTableId, newTableName || '', orderId]
  )
  await persistDb()
}

export async function moveOrderItemsToOrder(itemIds, targetOrderId) {
  requireDb()
  if (!itemIds || itemIds.length === 0) return
  const placeholders = itemIds.map(() => '?').join(',')
  db.run(
    `UPDATE order_items SET order_id = ?, is_synced = 0 WHERE id IN (${placeholders})`,
    [targetOrderId, ...itemIds]
  )
  await persistDb()
}

// ── Sync helpers (used by sync.js) ────────────────────────────────

export function getUnsyncedPayments() {
  requireDb()
  const res = db.exec(
    `SELECT p.id, p.local_id, o.remote_id as order_remote_id,
            p.amount, p.payment_method, p.payer_label, p.processed_by, p.device, p.created_at
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE p.is_synced = 0 AND o.remote_id IS NOT NULL`
  )
  return res.length ? res[0].values : []
}

export function getUnsyncedPaymentItems() {
  requireDb()
  const res = db.exec(
    `SELECT pi.id, p.remote_id as payment_remote_id, oi.remote_id as order_item_remote_id, pi.payment_id, pi.order_item_id
     FROM payment_items pi
     JOIN payments p ON p.id = pi.payment_id
     LEFT JOIN order_items oi ON oi.id = pi.order_item_id
     WHERE pi.is_synced = 0 AND p.remote_id IS NOT NULL`
  )
  return res.length ? res[0].values : []
}

export async function markPaymentSynced(id, remoteId) {
  requireDb()
  db.run('UPDATE payments SET is_synced = 1, remote_id = ? WHERE id = ?', [String(remoteId), id])
  await persistDb()
}

export async function markPaymentItemSynced(id) {
  requireDb()
  db.run('UPDATE payment_items SET is_synced = 1 WHERE id = ?', [id])
  await persistDb()
}

// Stamp a freshly-created Supabase remote_id onto an order_item we created
// locally. (The remote_id column is guaranteed by the initDb migrations.)
export async function setOrderItemRemoteId(localItemId, remoteId) {
  requireDb()
  db.run('UPDATE order_items SET remote_id = ?, is_synced = 1 WHERE id = ?', [String(remoteId), localItemId])
  await persistDb()
}

export async function markOrderItemSyncedById(localItemId) {
  requireDb()
  db.run('UPDATE order_items SET is_synced = 1 WHERE id = ?', [localItemId])
  await persistDb()
}

// ── Reopen closed order (correction / new order) ──────────────────
// A completed order can be reopened from the "Kapananlar" page — either to
// correct a mistake (cancel the original + restore stock + delete its
// payments) or to add a follow-up order for a subset of the same items.

// Exact inverse of consumeIngredients. No low-stock warnings — restoring
// stock never needs the low-stock alert path.
export function restoreIngredients(items) {
  requireDb()
  for (const item of items) {
    if (!item.variantId) continue
    const rRes = db.exec(
      'SELECT ingredient_id, amount_used FROM product_variant_ingredients WHERE variant_id = ?',
      [item.variantId]
    )
    if (!rRes.length) continue
    for (const [ingredient_id, amount_used] of rRes[0].values) {
      db.run(
        'UPDATE ingredients SET stock_amount = stock_amount + ?, is_synced = 0 WHERE id = ?',
        [amount_used * (item.qty ?? 1), ingredient_id]
      )
    }
  }

  // Direct product→ingredient recipe (no variant)
  for (const item of items) {
    if (item.variantId) continue
    if (!item.productId) continue
    const rRes = db.exec(
      'SELECT ingredient_id, amount_used FROM product_ingredients WHERE product_id = ?',
      [item.productId]
    )
    if (!rRes.length) continue
    for (const [ingredient_id, amount_used] of rRes[0].values) {
      db.run(
        'UPDATE ingredients SET stock_amount = stock_amount + ?, is_synced = 0 WHERE id = ?',
        [amount_used * (item.qty ?? 1), ingredient_id]
      )
    }
  }
}

// Full snapshot of a completed order for the reopen flow: order header +
// items (with productId/variantId so restoreIngredients / re-adding items
// to a live table has everything it needs) + their modifiers.
export function getCompletedOrderDetail(orderId) {
  requireDb()
  const oRes = db.exec(
    `SELECT id, table_id, table_name, total, closed_at, payment_method, remote_id
     FROM orders WHERE id = ?`,
    [orderId]
  )
  if (!oRes.length || !oRes[0].values.length) return null
  const [id, tableId, tableName, total, closedAt, paymentMethod, remoteId] = oRes[0].values[0]

  const itemsRes = db.exec(
    `SELECT id, product_id, variant_id, name, unit_price, quantity, note
     FROM order_items WHERE order_id = ? ORDER BY id`,
    [orderId]
  )
  const items = itemsRes.length
    ? itemsRes[0].values.map(([iid, productId, variantId, name, unitPrice, qty, note]) => ({
        id: iid,
        productId: productId ?? null,
        variantId: variantId ?? null,
        name,
        unitPrice,
        qty,
        note: note || '',
        modifiers: [],
      }))
    : []

  const modsMap = getModifiersForOrderItems(items.map(i => i.id))
  for (const it of items) {
    it.modifiers = (modsMap[it.id] || []).map(m => ({
      modifierId: m.modifierId,
      name: m.name,
      priceDelta: m.priceDelta,
      quantity: m.quantity,
    }))
  }

  return {
    id,
    tableId,
    tableName,
    total,
    closedAt,
    paymentMethod,
    remoteId: remoteId ?? null,
    items,
  }
}

// Reopening for correction cancels the original order and undoes its
// payments — tombstoning remote payments (if any) and clearing the local
// payment rows so the order carries no stale collected amount.
export async function deleteOrderPaymentsCascade(orderId) {
  requireDb()
  const res = db.exec('SELECT id, remote_id FROM payments WHERE order_id = ?', [orderId])
  if (res.length) {
    for (const [paymentId, remoteId] of res[0].values) {
      if (remoteId) {
        db.run("INSERT INTO pending_deletes (entity_type, remote_id) VALUES ('payment', ?)", [remoteId])
      }
      db.run('DELETE FROM payment_items WHERE payment_id = ?', [paymentId])
    }
  }
  db.run('DELETE FROM payments WHERE order_id = ?', [orderId])
  await persistDb()
}

// Completed orders for the "Kapananlar" page, newest first. Items +
// modifiers are batch-loaded the same way getOrdersList does.
export function getClosedOrders({ sinceIso = null, limit = 200 } = {}) {
  requireDb()
  const clause = sinceIso ? "AND date(closed_at,'localtime') >= ?" : ''
  const params = sinceIso ? [sinceIso] : []
  const res = db.exec(
    `SELECT id, closed_at, table_id, table_name, total, payment_method, waiter_name, remote_id
     FROM orders
     WHERE status = 'completed' ${clause}
     ORDER BY closed_at DESC
     LIMIT ${Number(limit) || 200}`,
    params
  )
  if (!res.length || !res[0].values.length) return []
  const orders = res[0].values.map(([id, closedAt, tableId, tableName, total, paymentMethod, waiterName, remoteId]) => ({
    id,
    closedAt,
    tableId,
    tableName,
    total,
    paymentMethod,
    waiterName: waiterName || null,
    remoteId: remoteId ?? null,
    items: [],
  }))

  const orderIds = orders.map(o => o.id)
  const itemsByOrder = {}
  const allItemIds = []
  const placeholders = orderIds.map(() => '?').join(',')
  const itemsRes = db.exec(
    `SELECT id, order_id, product_id, variant_id, name, quantity, unit_price, note
     FROM order_items
     WHERE order_id IN (${placeholders})
     ORDER BY id`,
    orderIds
  )
  if (itemsRes.length && itemsRes[0].values.length) {
    for (const [iid, oid, productId, variantId, name, qty, unitPrice, note] of itemsRes[0].values) {
      if (!itemsByOrder[oid]) itemsByOrder[oid] = []
      itemsByOrder[oid].push({
        id: iid,
        productId: productId ?? null,
        variantId: variantId ?? null,
        name,
        qty,
        unitPrice,
        note: note || '',
        modifiers: [],
      })
      allItemIds.push(iid)
    }
  }

  const modsMap = getModifiersForOrderItems(allItemIds)
  for (const items of Object.values(itemsByOrder)) {
    for (const it of items) {
      it.modifiers = modsMap[it.id] || []
    }
  }

  for (const o of orders) {
    o.items = itemsByOrder[o.id] || []
  }
  return orders
}
