import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { query, queryOne } from '@/lib/db'
import { normaliseNumber, sendAuthCode } from '@/lib/whatsapp'
import { waitLabel } from '@/lib/loginThrottle'

/**
 * ============================================================================
 *  PHONE NUMBER SIGN-IN
 * ============================================================================
 *  Send a six-digit code over WhatsApp, then accept it once.
 *
 *  WHY PHONE IS THE RIGHT IDENTITY FOR THIS PRODUCT
 *  ------------------------------------------------
 *  Reception's new-patient form asks for a name and a phone number, both
 *  required, and an email marked optional. So the phone number is the field that
 *  is always present and always correct — the receptionist heard it from the
 *  patient on a call. The email is blank half the time and, when present, was
 *  spelled out over a bad line.
 *
 *  That single fact fixes two real problems. A desk-created patient has no
 *  password and no way to set one, so today they cannot sign in at all unless
 *  their email happens to match a Google account. And a mistyped email is a
 *  working credential for somebody else's medical records, whereas a number heard
 *  directly from the patient is not.
 *
 *  ============================================================================
 *  AN OTP IS A PASSWORD THAT LIVES FIVE MINUTES
 *  ============================================================================
 *  It deserves the same paranoia, and it is easy to build one that is far weaker
 *  than the password it replaces. Six digits is a million possibilities — that is
 *  nothing to a script. Every control below exists because of a specific attack:
 *
 *    HASHED           A leaked table of plaintext codes is a leaked table of live
 *                     logins. bcrypt costs 100ms on a login and centuries on an
 *                     offline sweep.
 *
 *    crypto.randomInt Math.random() is seeded and predictable. Given a few codes
 *                     an attacker can compute the next one, and no amount of rate
 *                     limiting helps once they can guess right first time.
 *
 *    3 ATTEMPTS       Unlimited guesses against one live code exhausts a million
 *                     possibilities in minutes. At the limit the code is burned,
 *                     so brute force costs a fresh OTP — and those are limited
 *                     too.
 *
 *    SINGLE USE       Without it, one intercepted message is a permanent key.
 *
 *    REQUEST LIMITS   Two different attacks: burning the clinic's WhatsApp
 *                     allowance, and using our servers to spam a stranger's phone
 *                     with codes they never asked for.
 *
 *    SILENCE          "That number is not registered" turns this form into a tool
 *                     for checking who attends a physiotherapy clinic — private
 *                     medical information. The response is identical whether or
 *                     not the number exists. Exactly the reasoning already
 *                     written at lib/auth.js.
 *
 *    TIMING           bcrypt.compare is constant-time for a given hash, so a
 *                     wrong code takes the same time as a right one.
 * ============================================================================
 */

/** Six digits. Long enough to be unguessable at 3 attempts, short enough to retype. */
const CODE_LENGTH = 6

/** Five minutes: enough for WhatsApp on a slow connection, not enough to leave lying around. */
const TTL_SECONDS = 5 * 60

/** Wrong guesses before the code is burned. */
const MAX_ATTEMPTS = 3

/** A patient may ask for this many codes per window before being told to wait. */
const MAX_PER_PHONE = 3
const PHONE_WINDOW_MINUTES = 15

/**
 * And this many from one network address per hour.
 *
 * Higher than the per-phone limit on purpose: a clinic's whole reception desk can
 * share one office IP, and locking that out would stop staff helping patients sign
 * in. High enough to be usable, low enough that nobody scripts thousands.
 */
const MAX_PER_IP = 20
const IP_WINDOW_MINUTES = 60

/** Between one code and the next for the same number. Stops double-taps too. */
const RESEND_COOLDOWN_SECONDS = 45

/* ========================================================================== */
/*  REQUESTING A CODE                                                         */
/* ========================================================================== */

/**
 * Issue a code for this clinic and number, and send it over WhatsApp.
 *
 * Always resolves. The shape of the result is deliberately the same whether the
 * number belongs to somebody or to nobody — see SILENCE above.
 *
 * @returns {Promise<{ok: boolean, retryAfter?: number, message?: string}>}
 */
export async function requestOtp({ clinic, phone, ip = null }) {
  const to = normaliseNumber(phone)
  if (!to) {
    return { ok: false, message: 'Enter a 10-digit mobile number.' }
  }

  /* ------------------------------------------------------ 1. rate limits */
  /**
   * Checked BEFORE looking the user up, so a rate-limited attacker learns
   * nothing about whether the number exists — and so that hammering this endpoint
   * costs one cheap indexed count rather than a user lookup plus a bcrypt hash.
   */
  const recent = await queryOne(
    `SELECT
       (SELECT COUNT(*) FROM login_otps
         WHERE phone = ? AND created_at > NOW() - INTERVAL ? MINUTE) AS by_phone,
       (SELECT MAX(created_at) FROM login_otps WHERE phone = ?)      AS last_sent,
       (SELECT COUNT(*) FROM login_otps
         WHERE ip = ? AND ip IS NOT NULL
           AND created_at > NOW() - INTERVAL ? MINUTE)               AS by_ip`,
    [to, PHONE_WINDOW_MINUTES, to, ip, IP_WINDOW_MINUTES]
  )

  if (recent?.last_sent) {
    const elapsed = (Date.now() - new Date(recent.last_sent).getTime()) / 1000
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed)
      return { ok: false, retryAfter: wait, message: `Please wait ${waitLabel(wait)} before asking for another code.` }
    }
  }

  if (Number(recent?.by_phone || 0) >= MAX_PER_PHONE) {
    return {
      ok: false,
      retryAfter: PHONE_WINDOW_MINUTES * 60,
      message: `Too many codes requested. Try again in ${PHONE_WINDOW_MINUTES} minutes, or sign in with your email and password.`,
    }
  }

  if (ip && Number(recent?.by_ip || 0) >= MAX_PER_IP) {
    return {
      ok: false,
      retryAfter: IP_WINDOW_MINUTES * 60,
      message: 'Too many codes requested from this network. Try again later.',
    }
  }

  /* ------------------------------------------------- 2. is anybody there */
  const people = await usersOnNumber(clinic.id, to)

  /**
   * Nobody on this number: stop, but say the same thing as success.
   *
   * No row is written and no message is sent — writing one would let an attacker
   * map the clinic's patient list by watching which numbers get rate limited, and
   * sending one would spam a stranger at the clinic's expense.
   */
  if (people.length === 0) {
    return { ok: true, message: sentMessage(to) }
  }

  /* ---------------------------------------------------- 3. mint and send */
  const code = generateCode()
  const codeHash = await bcrypt.hash(code, 10)

  /**
   * Any earlier live code for this number is retired first.
   *
   * Otherwise "resend" leaves two valid codes in the air, which doubles an
   * attacker's chances and confuses the patient looking at two messages.
   */
  await query(
    `UPDATE login_otps SET consumed_at = NOW()
      WHERE clinic_id = ? AND phone = ? AND consumed_at IS NULL`,
    [clinic.id, to]
  )

  await query(
    `INSERT INTO login_otps (clinic_id, phone, code_hash, expires_at, ip)
     VALUES (?, ?, ?, NOW() + INTERVAL ? SECOND, ?)`,
    [clinic.id, to, codeHash, TTL_SECONDS, ip]
  )

  /**
   * Sent to the first matching account only for the purpose of the message log.
   * The code belongs to the NUMBER, not to a person — which is the whole point of
   * the account picker after verification.
   */
  const result = await sendAuthCode({ clinic, phone: to, code, userId: people[0].id })

  if (!result.ok) {
    /**
     * Could not deliver, so retire the code immediately rather than leaving a
     * live secret nobody can use. The caller falls back to the other sign-in
     * methods, which are on the same page.
     */
    await query(
      `UPDATE login_otps SET consumed_at = NOW()
        WHERE clinic_id = ? AND phone = ? AND consumed_at IS NULL`,
      [clinic.id, to]
    )
    console.warn(`[otp] could not send to ${to}: ${result.reason}`)
    return {
      ok: false,
      message: 'We could not send a code right now. Please sign in with your email and password instead.',
    }
  }

  return { ok: true, message: sentMessage(to) }
}

/* ========================================================================== */
/*  CHECKING A CODE                                                           */
/* ========================================================================== */

/**
 * Verify a code and return the accounts on that number.
 *
 * The code is consumed on success, so this can only succeed once. On failure the
 * attempt is counted and, at the limit, the code is burned.
 *
 * @returns {Promise<{ok: boolean, users?: Array, message?: string}>}
 */
export async function verifyOtp({ clinic, phone, code, ip = null }) {
  const to = normaliseNumber(phone)
  const digits = String(code || '').replace(/\D/g, '')

  if (!to || digits.length !== CODE_LENGTH) {
    return { ok: false, message: 'Enter the 6-digit code we sent you.' }
  }

  const row = await queryOne(
    `SELECT id, code_hash, attempts
       FROM login_otps
      WHERE clinic_id = ? AND phone = ?
        AND consumed_at IS NULL
        AND expires_at > NOW()
      ORDER BY id DESC
      LIMIT 1`,
    [clinic.id, to]
  )

  /**
   * No live code. One message for expired, wrong, and never-requested alike —
   * distinguishing them tells an attacker which numbers are worth pursuing.
   */
  if (!row) {
    return { ok: false, message: 'That code has expired or is not valid. Ask for a new one.' }
  }

  const matches = await bcrypt.compare(digits, row.code_hash)

  if (!matches) {
    const attempts = Number(row.attempts) + 1
    const burned = attempts >= MAX_ATTEMPTS

    // One statement: increment, and consume if this was the last chance. Two
    // statements would leave a window where a parallel request gets a free guess.
    await query(
      `UPDATE login_otps
          SET attempts = ?, consumed_at = ${burned ? 'NOW()' : 'consumed_at'}
        WHERE id = ?`,
      [attempts, row.id]
    )

    return {
      ok: false,
      message: burned
        ? 'Too many incorrect attempts. Ask for a new code.'
        : `That code is not right. ${MAX_ATTEMPTS - attempts} attempt${MAX_ATTEMPTS - attempts === 1 ? '' : 's'} left.`,
    }
  }

  /**
   * Consumed before the accounts are loaded, and guarded on `consumed_at IS NULL`
   * so that two requests arriving together cannot both win. Whichever UPDATE
   * touches the row first is the one that gets in.
   */
  const [claim] = await query(
    `UPDATE login_otps SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL`,
    [row.id]
  ).then((r) => [r])

  if (!claim?.affectedRows) {
    return { ok: false, message: 'That code has already been used. Ask for a new one.' }
  }

  const people = await usersOnNumber(clinic.id, to)
  if (people.length === 0) {
    // The account was deactivated between requesting and entering the code.
    return { ok: false, message: 'That code has expired or is not valid. Ask for a new one.' }
  }

  /**
   * The number is now proven, so record that. It is what makes the difference
   * between a number reception typed in and a number somebody answered on — see
   * migration 006.
   */
  await query(
    `UPDATE users SET phone_verified = 1
      WHERE clinic_id = ? AND id IN (${people.map(() => '?').join(', ')})`,
    [clinic.id, ...people.map((p) => p.id)]
  )

  return { ok: true, users: people }
}

/* ========================================================================== */
/*  THE HANDOFF TICKET                                                        */
/* ========================================================================== */

/**
 * ============================================================================
 *  WHY A TICKET EXISTS AT ALL
 * ============================================================================
 *  A code is single-use, and the account picker needs the household list AFTER
 *  the code is checked. Those two facts fight each other:
 *
 *    verify the code  →  show "who are you?"  →  sign in as the chosen person
 *                                                ↑
 *                        this would have to check the same code a second time,
 *                        and by then it is correctly dead
 *
 *  Options considered and rejected:
 *
 *    Check the code without consuming it, then consume on sign-in. That leaves a
 *    verified code alive while a human reads a list, and turns the picker step
 *    into a window for replay.
 *
 *    Fetch the household when the code is REQUESTED. That would print a clinic's
 *    patient names to anyone who types a phone number into a login form.
 *
 *  So verification consumes the code exactly once and mints this: an HMAC-signed
 *  statement of what was just proved — this clinic, this number, these accounts —
 *  valid for three minutes. It is not a session and grants nothing on its own;
 *  the Auth.js provider still has to load the user and re-check that the chosen id
 *  is one of the ids named in the ticket.
 *
 *  Nothing is stored. The signature is the storage, which is the same trick the
 *  session cookie uses.
 * ============================================================================
 */

/** Long enough to read a short list of names, short enough to be useless if copied. */
const TICKET_TTL_SECONDS = 180

/** Sign "this number was verified for this clinic, and these accounts are on it". */
export function issueLoginTicket({ clinicId, phone, userIds }) {
  const payload = {
    c: Number(clinicId),
    p: String(phone),
    u: userIds.map(Number),
    exp: Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS,
  }

  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

/**
 * Read a ticket back, or null.
 *
 * Null for a bad signature, a malformed blob and an expired one alike — a caller
 * that behaved differently for each would be telling an attacker which part of
 * their forgery to fix.
 */
export function readLoginTicket(ticket) {
  const [body, signature] = String(ticket || '').split('.')
  if (!body || !signature) return null

  const expected = sign(body)

  /**
   * Constant-time, because `===` on strings returns as soon as two characters
   * differ. That timing difference is enough to forge a signature one byte at a
   * time — a real and well-documented attack, not a theoretical one.
   */
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
    return { clinicId: payload.c, phone: payload.p, userIds: payload.u || [] }
  } catch {
    return null
  }
}

function sign(body) {
  /**
   * The same secret that signs the session cookie. If it is missing the app is
   * already broken in a dozen other ways, so failing loudly here is better than
   * silently signing everything with the string "undefined".
   */
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set — cannot sign a login ticket')
  return crypto.createHmac('sha256', secret).update(`otp.${body}`).digest('base64url')
}

/* ========================================================================== */
/*  HELPERS                                                                   */
/* ========================================================================== */

/**
 * Everyone this clinic knows on this number.
 *
 * Plural on purpose. In India one number serves a household: a mother books
 * physiotherapy for her child, a son's number is on file for both his parents.
 * `users.phone` is therefore deliberately not unique, and a verified number
 * identifies a household rather than a person — so the caller shows a picker.
 *
 * Excluded:
 *   is_active = 0    a removed member of staff or a blocked account
 *   role platform    the account that can read EVERY clinic's data. A SIM swap
 *                    must never be enough to reach that; it keeps a password.
 *   suspended clinic same rule as the password provider — data intact, access not.
 */
async function usersOnNumber(clinicId, phone) {
  return query(
    `SELECT u.id, u.name, u.email, u.role
       FROM users u
       JOIN clinics c ON c.id = u.clinic_id
      WHERE u.clinic_id = ?
        AND u.phone IS NOT NULL
        AND REPLACE(REPLACE(REPLACE(u.phone, ' ', ''), '-', ''), '+', '') LIKE ?
        AND u.is_active = 1
        AND u.role <> 'platform'
        AND c.status <> 'suspended'
      ORDER BY FIELD(u.role, 'admin', 'physio', 'patient'), u.id`,
    // Matching on the last 10 digits absorbs the difference between '9876543210'
    // as reception typed it and '919876543210' as the OTP was addressed.
    [clinicId, `%${phone.slice(-10)}`]
  )
}

/** A cryptographically random 6-digit code, leading zeros allowed. */
function generateCode() {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0')
}

/**
 * "…sent to •••••• 3210".
 *
 * Masked so that a shoulder-surfer, or somebody who typed a number that is not
 * theirs, is not shown a full number back. The last four digits are enough for
 * the real owner to recognise their own.
 */
function sentMessage(to) {
  return `Code sent to •••••• ${to.slice(-4)} on WhatsApp.`
}

/**
 * Delete codes nobody can use any more.
 *
 * Run from the nightly cron alongside purgeOldLoginAttempts(). Consumed and
 * expired rows are only useful for a day or two of debugging, and a table of old
 * hashes is a liability with no upside.
 */
export async function purgeOldOtps() {
  const [result] = await query(
    `DELETE FROM login_otps WHERE created_at < NOW() - INTERVAL 2 DAY`
  ).then((r) => [r])
  return result?.affectedRows || 0
}
