/**
 * offlineAuth.js
 * PBKDF2 password hashing for the offline login fallback (Web Crypto only,
 * no new dependency). Used to let a previously-online user log in on this
 * device again while there is no internet connection.
 *
 * Passwords are NEVER stored in plaintext — only a random salt + derived
 * hash (both base64) are persisted, via localDb's offline_credentials table.
 */

const ITERATIONS = 150000
const KEY_LENGTH_BITS = 256 // 32 bytes
const SALT_LENGTH_BYTES = 16

function requireSubtle() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Bu ortamda çevrimdışı giriş desteklenmiyor')
  }
}

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBuf(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

async function deriveHash(password, saltBytes, iterations) {
  const subtle = crypto.subtle
  const keyMaterial = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const derived = await subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH_BITS
  )
  return bufToBase64(derived)
}

/**
 * Hashes a password with PBKDF2-SHA256. Generates a random 16-byte salt
 * unless one (base64) is supplied — used both to create a new credential
 * and, internally, to re-derive a hash for comparison during verify.
 */
export async function hashPassword(password, saltB64 = null) {
  requireSubtle()
  const saltBytes = saltB64 ? base64ToBuf(saltB64) : crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES)).buffer
  const salt = saltB64 ?? bufToBase64(saltBytes)
  const hash = await deriveHash(password, saltBytes, ITERATIONS)
  return { salt, hash, iterations: ITERATIONS }
}

// Constant-time-ish comparison — accumulates over the full length instead of
// returning early on the first mismatch, so timing doesn't leak how many
// leading bytes matched.
function safeEqual(a, b) {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0
    const cb = i < b.length ? b.charCodeAt(i) : 0
    diff |= ca ^ cb
  }
  return diff === 0
}

/**
 * Verifies a password against a stored { salt, hash, iterations } record.
 * Returns a boolean — never throws for a mismatch, only for an unsupported
 * environment (see requireSubtle above).
 */
export async function verifyPassword(password, { salt, hash, iterations }) {
  requireSubtle()
  const saltBytes = base64ToBuf(salt)
  const candidate = await deriveHash(password, saltBytes, iterations ?? ITERATIONS)
  return safeEqual(candidate, hash)
}

// ── In-memory last-entered password ────────────────────────────────
// Held only in this module's memory (never persisted to disk/localStorage)
// so AppContext can re-authenticate with Supabase and obtain a real JWT the
// moment the connection returns after an offline login (see
// AppContext.jsx's reconnect effect). Cleared on logout.
let lastPassword = ''
export function setLastPassword(pwd) { lastPassword = pwd }
export function getLastPassword() { return lastPassword }
export function clearLastPassword() { lastPassword = '' }
