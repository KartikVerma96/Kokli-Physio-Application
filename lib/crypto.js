import crypto from 'node:crypto'

/**
 * ============================================================================
 *  ENCRYPTION AT REST — for other people's payment secrets
 * ============================================================================
 *
 *  WHY THIS FILE EXISTS
 *  --------------------
 *  Each clinic connects their own Razorpay account, which means we store their
 *  API secret. That secret can move money out of their business.
 *
 *  A password can be HASHED — bcrypt, one-way, never recovered. We only ever
 *  need to check whether a guess matches, so one-way is perfect.
 *
 *  An API secret is different: we have to send the real value to Razorpay on
 *  every request, so it must be recoverable. That means ENCRYPTION, not hashing,
 *  and the two are not interchangeable. Confusing them is one of the most common
 *  serious mistakes in application security.
 *
 *  WHAT THIS PROTECTS AGAINST
 *  --------------------------
 *  A stolen database dump. Backups get copied to laptops, a read replica gets
 *  exposed, someone finds an SQL injection. In all of those, the attacker gets
 *  ciphertext and nothing else, because the key lives in the environment, not in
 *  the database.
 *
 *  It does NOT protect against an attacker who has your server AND your
 *  environment variables — at that point they can decrypt exactly as we do.
 *  Encryption at rest raises the cost of a breach; it does not make one
 *  survivable. Be honest about which threat you are defending against.
 *
 *  WHY AES-256-GCM
 *  ---------------
 *  GCM is "authenticated" encryption: as well as hiding the value it produces an
 *  auth tag that proves the ciphertext was not altered. Without that (plain
 *  AES-CBC, say) an attacker who can write to the database could flip bits in
 *  the stored secret and you would decrypt to a corrupted value with no
 *  indication anything was wrong. With GCM, tampering makes decryption throw.
 *
 *  A fresh random IV is generated per encryption. Reusing an IV with the same
 *  key in GCM is catastrophic — it leaks the key stream — so it is generated
 *  here rather than ever being configurable.
 *
 *  STORAGE FORMAT
 *  --------------
 *      v1.<iv-base64>.<authTag-base64>.<ciphertext-base64>
 *
 *  The version prefix costs four bytes and means that if you ever need to rotate
 *  the key or change algorithm, old values can still be recognised and migrated
 *  instead of becoming undecryptable noise.
 * ============================================================================
 */

const ALGORITHM = 'aes-256-gcm'
const VERSION = 'v1'
const IV_LENGTH = 12 // 96 bits — the size GCM is designed around

/**
 * Read the key from the environment and validate it properly.
 *
 * Generate one with:   openssl rand -base64 32
 */
function getKey() {
  const raw = process.env.PLATFORM_ENCRYPTION_KEY

  if (!raw) {
    throw new Error(
      'PLATFORM_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32'
    )
  }

  const key = Buffer.from(raw, 'base64')

  // AES-256 needs exactly 32 bytes. A short key would either throw deep inside
  // Node with a confusing message, or — worse in other languages — be silently
  // padded, giving encryption far weaker than it appears.
  if (key.length !== 32) {
    throw new Error(
      `PLATFORM_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}. ` +
        'Generate a correct one with: openssl rand -base64 32'
    )
  }

  return key
}

/** True if a usable key is configured. Used to warn during onboarding. */
export function isEncryptionConfigured() {
  try {
    getKey()
    return true
  } catch {
    return false
  }
}

/**
 * Encrypt a secret for storage.
 * Returns null for empty input, so a clinic that has not connected Razorpay
 * stores a clean NULL rather than the ciphertext of an empty string.
 */
export function encryptSecret(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null

  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)

  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ])

  // Must be read AFTER final() — it is computed over the whole message.
  const authTag = cipher.getAuthTag()

  return [
    VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.')
}

/**
 * Decrypt a stored secret.
 *
 * Returns null rather than throwing on anything malformed. A clinic with a
 * corrupted key should see "payments not connected" and be asked to reconnect —
 * not a 500 error on every page of their site.
 */
export function decryptSecret(stored) {
  if (!stored) return null

  try {
    const [version, ivB64, tagB64, dataB64] = String(stored).split('.')
    if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) return null

    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      getKey(),
      Buffer.from(ivB64, 'base64')
    )
    // Set the expected tag before finalising; final() is what verifies it and
    // throws if the ciphertext was tampered with.
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))

    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch (error) {
    console.error('[crypto] could not decrypt a stored secret:', error.message)
    return null
  }
}

/**
 * Show a secret safely in the UI: `rzp_test_••••••••4821`.
 *
 * Enough for the clinic to confirm they pasted the right key, useless to anyone
 * reading over their shoulder or watching a support screen-share.
 */
export function maskSecret(value, visible = 4) {
  if (!value) return ''
  const text = String(value)
  if (text.length <= visible) return '•'.repeat(text.length)
  return '•'.repeat(Math.min(12, text.length - visible)) + text.slice(-visible)
}
