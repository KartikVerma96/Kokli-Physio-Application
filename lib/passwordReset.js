import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { query, queryOne } from '@/lib/db'
import { clinicUrl, platformUrl } from '@/config/platform'

/**
 * ============================================================================
 *  FORGOTTEN PASSWORDS
 * ============================================================================
 *  Mint a single-use token, email a link containing it, exchange it for a new
 *  password.
 *
 *  WHY THIS EXISTS AT ALL — IT WAS MISSING
 *  ---------------------------------------
 *  Until this file there was no way to change a password in the product, let
 *  alone reset a forgotten one. The team page even promised otherwise: it hands
 *  a clinic owner a "temporary password" box with the hint "share it with them
 *  and ask them to change it", and there was nothing to change it with.
 *
 *  ============================================================================
 *  THE PART EVERYONE GETS WRONG
 *  ============================================================================
 *  A password reset is the SOFTEST way into any application. It is deliberately
 *  reachable by someone who knows nothing but an email address, so every mistake
 *  here is worth more to an attacker than a mistake anywhere else.
 *
 *    STORED HASHED      A leaked table of live reset tokens is a leaked table of
 *                       accounts. Only the SHA-256 is kept; the plaintext exists
 *                       for the length of one email.
 *
 *    32 RANDOM BYTES    2^256 possibilities, so guessing is not a threat model.
 *                       This is also why SHA-256 rather than bcrypt is right —
 *                       see the long note in migration 007.
 *
 *    SINGLE USE         The link sits in an inbox forever otherwise, and inboxes
 *                       get breached far more often than databases.
 *
 *    ONE HOUR           Enough to find it in a spam folder. Not enough for a
 *                       shared or archived mailbox to become a permanent key.
 *
 *    SILENCE            "No account with that email" turns this form into a way
 *                       to check who is a patient at a physiotherapy clinic —
 *                       private medical information. The response never varies.
 *
 *    OLD ONES DIE       Asking again retires the previous token, so a forwarded
 *                       older email cannot be used after the person has already
 *                       reset with the newer one.
 *
 *    NO ROLE EXCEPTION  Unlike phone sign-in, the platform account CAN reset by
 *                       email. It has to be able to: it has no phone on file and
 *                       is excluded from OTP login, so email is its only route
 *                       back in short of the break-glass script.
 * ============================================================================
 */

/** One hour. */
const TTL_MINUTES = 60

/** Per account, per window. Stops an inbox being buried in reset mail. */
const MAX_PER_USER = 3
const USER_WINDOW_MINUTES = 60

/** Minimum for a new password. Matched by the register and signup forms. */
export const MIN_PASSWORD_LENGTH = 8

/* ========================================================================== */
/*  ASKING FOR A LINK                                                         */
/* ========================================================================== */

/**
 * Issue a reset token for this email, if it belongs to anybody.
 *
 * Returns the token and the user ONLY so the caller can send the email — nothing
 * about the result is safe to show the browser. See SILENCE above.
 *
 * @returns {Promise<{token: string, user: object}|null>}
 */
export async function createResetToken({ email, ip = null }) {
  const address = String(email || '').trim().toLowerCase()
  if (!address) return null

  const user = await queryOne(
    `SELECT u.id, u.name, u.email, u.role, u.clinic_id,
            c.name AS clinic_name, c.slug AS clinic_slug, c.status AS clinic_status
       FROM users u
       LEFT JOIN clinics c ON c.id = u.clinic_id
      WHERE u.email = ? AND u.is_active = 1`,
    [address]
  )

  // Unknown, deactivated, or belonging to a switched-off clinic. Nothing is
  // written and nothing is sent — the caller still reports success.
  if (!user) return null
  if (user.role !== 'platform' && user.clinic_status === 'suspended') return null

  const recent = await queryOne(
    `SELECT COUNT(*) AS n FROM password_resets
      WHERE user_id = ? AND created_at > NOW() - INTERVAL ? MINUTE`,
    [user.id, USER_WINDOW_MINUTES]
  )
  if (Number(recent?.n || 0) >= MAX_PER_USER) return null

  /**
   * Retire anything still live for this account first.
   *
   * Otherwise two links work at once, and the older email — which may have been
   * forwarded, or may be sitting in a shared inbox — stays valid after the person
   * has already used the newer one.
   */
  await query(
    `UPDATE password_resets SET consumed_at = NOW()
      WHERE user_id = ? AND consumed_at IS NULL`,
    [user.id]
  )

  const token = crypto.randomBytes(32).toString('hex')

  await query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at, ip)
     VALUES (?, ?, NOW() + INTERVAL ? MINUTE, ?)`,
    [user.id, hashToken(token), TTL_MINUTES, ip]
  )

  return { token, user }
}

/* ========================================================================== */
/*  USING A LINK                                                              */
/* ========================================================================== */

/**
 * Is this token good? Does not consume it.
 *
 * Called when the reset page loads, so somebody following a dead link is told so
 * before they type a new password twice.
 */
export async function checkResetToken(token) {
  const row = await liveToken(token)
  if (!row) return null
  return { userId: row.user_id, name: row.name, email: row.email }
}

/**
 * Set the new password, and spend the token.
 *
 * @returns {Promise<{ok: boolean, message?: string, user?: object}>}
 */
export async function consumeResetToken({ token, password }) {
  if (String(password || '').length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }
  }

  const row = await liveToken(token)
  if (!row) {
    return { ok: false, message: 'That link has expired or has already been used. Ask for a new one.' }
  }

  /**
   * Spend it FIRST, guarded on it still being unspent.
   *
   * Two clicks on the same link arriving together would otherwise both pass the
   * check above and both set a password — and the second one wins, which is not
   * necessarily the one the person meant. Whichever UPDATE touches the row first
   * is the only one that proceeds.
   */
  const [claim] = await query(
    `UPDATE password_resets SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL`,
    [row.id]
  ).then((r) => [r])

  if (!claim?.affectedRows) {
    return { ok: false, message: 'That link has already been used. Ask for a new one.' }
  }

  await setPassword(row.user_id, password)

  return {
    ok: true,
    user: { id: row.user_id, email: row.email, name: row.name, clinicSlug: row.clinic_slug },
  }
}

/* ========================================================================== */
/*  CHANGING IT WHILE SIGNED IN                                               */
/* ========================================================================== */

/**
 * The everyday case: somebody who is already signed in sets a new password.
 *
 * WHY THE CURRENT PASSWORD IS ASKED FOR, BUT ONLY IF THERE IS ONE
 * --------------------------------------------------------------
 * Requiring it stops a borrowed laptop or a stolen session from being turned into
 * permanent ownership of the account.
 *
 * But a large share of users in this product have NO password at all — anyone
 * reception created at the desk, and anyone who signed up with Google. For them
 * this is not a change, it is setting one for the first time, and demanding a
 * password they have never had would lock out exactly the people who most need a
 * way in. Their proof of identity was the WhatsApp code or the Google account
 * they signed in with a moment ago.
 */
export async function changePassword({ userId, currentPassword, newPassword }) {
  if (String(newPassword || '').length < MIN_PASSWORD_LENGTH) {
    return { ok: false, field: 'newPassword', message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }
  }

  const user = await queryOne(
    `SELECT id, password_hash FROM users WHERE id = ? AND is_active = 1`,
    [userId]
  )
  if (!user) return { ok: false, message: 'That account is not available.' }

  if (user.password_hash) {
    const matches = await bcrypt.compare(String(currentPassword || ''), user.password_hash)
    if (!matches) {
      return { ok: false, field: 'currentPassword', message: 'That is not your current password.' }
    }
    // Refusing a no-op is kinder than silently accepting it: somebody who thinks
    // they changed their password and did not is worse off than being told.
    if (await bcrypt.compare(String(newPassword), user.password_hash)) {
      return { ok: false, field: 'newPassword', message: 'That is the password you already have.' }
    }
  }

  await setPassword(userId, newPassword)
  return { ok: true, hadPassword: Boolean(user.password_hash) }
}

/* ========================================================================== */
/*  HELPERS                                                                   */
/* ========================================================================== */

/**
 * The reset link that goes in the email.
 *
 * On the CLINIC's hostname for a clinic user, and the platform's for the platform
 * account. It matters: the reset page needs a tenant to render a clinic's branding,
 * and landing a patient on kokli.in to reset their password at Aarogya would be
 * both confusing and off-brand.
 */
export function resetUrl({ token, clinicSlug }) {
  const path = `/reset-password?token=${token}`
  return clinicSlug ? clinicUrl(clinicSlug, path) : platformUrl(path)
}

/**
 * SHA-256 hex.
 *
 * Deterministic, so the token can be found with one indexed lookup. bcrypt salts
 * every hash differently and therefore cannot be indexed at all — the reasoning
 * is written out in full in migration 007.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

/** A token that exists, has not expired and has not been used. */
async function liveToken(token) {
  const value = String(token || '')
  // A token is always 64 hex characters. Checking the shape first avoids a
  // database round trip for the obviously malformed.
  if (!/^[0-9a-f]{64}$/.test(value)) return null

  return queryOne(
    `SELECT pr.id, pr.user_id, u.name, u.email, c.slug AS clinic_slug
       FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
       LEFT JOIN clinics c ON c.id = u.clinic_id
      WHERE pr.token_hash = ?
        AND pr.consumed_at IS NULL
        AND pr.expires_at > NOW()
        AND u.is_active = 1`,
    [hashToken(value)]
  )
}

/**
 * Write the hash, stamp the time, and retire every other live reset token.
 *
 * That last part matters: somebody resetting because they suspect their account
 * was reached should not leave a second valid link behind for whoever else asked.
 */
async function setPassword(userId, password) {
  const hash = await bcrypt.hash(String(password), 10)
  await query(
    `UPDATE users SET password_hash = ?, password_changed_at = NOW() WHERE id = ?`,
    [hash, userId]
  )
  await query(
    `UPDATE password_resets SET consumed_at = NOW()
      WHERE user_id = ? AND consumed_at IS NULL`,
    [userId]
  )
}

/**
 * Delete tokens nobody can use.
 *
 * Runs in the nightly job beside purgeOldOtps(). Two days, not zero: a support
 * question of the form "the link did not work" is answerable for a day or two and
 * unanswerable after that.
 */
export async function purgeOldResets() {
  const [result] = await query(
    `DELETE FROM password_resets WHERE created_at < NOW() - INTERVAL 2 DAY`
  ).then((r) => [r])
  return result?.affectedRows || 0
}

/**
 * What the account page needs to draw itself.
 *
 * `hasPassword` decides whether the form asks for a current one — a desk-created
 * patient or a Google sign-up has none, and demanding one would be an impossible
 * field. Read on the server every time rather than inferred in the browser.
 */
export async function passwordState(userId) {
  const row = await queryOne(
    `SELECT password_hash IS NOT NULL AS has_password, password_changed_at
       FROM users WHERE id = ?`,
    [userId]
  )
  return {
    hasPassword: Boolean(Number(row?.has_password)),
    changedAt: row?.password_changed_at || null,
  }
}
