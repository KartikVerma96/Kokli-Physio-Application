/**
 * ============================================================================
 *  PHONE NUMBER SIGN-IN
 * ============================================================================
 *
 *  WHY THIS SUITE IS LONG
 *  ----------------------
 *  An OTP is a password that lives five minutes, and it is very easy to build one
 *  that is weaker than the password it replaces. Six digits is a million
 *  possibilities — nothing to a script — so almost every control in lib/otp.js is
 *  the only thing standing between a phone number and somebody's medical records.
 *
 *  A control nobody tests is a control nobody has. So each one gets an assertion
 *  from BOTH directions where that is possible: it must refuse the bad case AND
 *  allow the good one. A gate that blocks everything passes a negative-only suite
 *  while being completely broken.
 *
 *  THE TWO ASSERTIONS THAT MATTER MOST
 *  -----------------------------------
 *    1. An unknown number produces the same answer as a known one, and writes
 *       nothing. Otherwise this login form is a tool for checking who attends a
 *       physiotherapy clinic, which is private medical information.
 *
 *    2. A tampered ticket cannot select an account it does not name. That is the
 *       whole security of the handoff: without it, proving you hold ONE number at
 *       a clinic would let you sign in as ANYONE at that clinic, owner included.
 *
 *  HOW THE CODE IS KNOWN
 *  ---------------------
 *  It cannot be read back — it is bcrypt-hashed, which is the point. So the
 *  request path is checked by its side effects (a row appears, the hash is a
 *  hash, the message is logged) and the verify path is driven by inserting a row
 *  whose code this file chose. Both halves are real; neither needs a back door in
 *  production code.
 * ============================================================================
 */

import fs from 'node:fs'
import process from 'node:process'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'

process.loadEnvFile('.env.local')

const PLATFORM = 'http://localhost:3000'
const SLUG = 'otptest'
const CLINIC = `http://${SLUG}.localhost:3000`
const OWNER = { email: 'otp.owner@example.com', password: 'otptest123' }

// Distinct numbers so one test's rate limit never leaks into another's.
const SOLO = '9812390001'
const FAMILY = '9812390002'
const INACTIVE = '9812390003'
const UNKNOWN = '9812390009'

let failures = 0
const check = (ok, label, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? `  — ${extra}` : ''}`)
}

const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
})

/* ------------------------------------------------------- the action manifest */
/**
 * The dev server writes its own map of exported action names to the hashed ids
 * the browser posts. Reading it by NAME means this file never hardcodes a hash
 * that changes on every edit. Same approach as tests/actions.mjs.
 */
const MANIFEST = '.next/dev/server/server-reference-manifest.json'
if (!fs.existsSync(MANIFEST)) {
  console.error(`\n  ✗ ${MANIFEST} is missing. Start the dev server and load /login first.\n`)
  process.exit(1)
}

/**
 * Re-read on every miss, never cached once.
 *
 * The dev server appends to this file as it compiles each route, so an action on
 * a page this suite has not visited yet is simply absent when the file starts.
 * Reading once at import time silently failed every assertion in the reception
 * block with "not in manifest" — which looks exactly like a broken feature.
 */
let actionIds = readManifest()

function readManifest() {
  const map = new Map()
  for (const [id, entry] of Object.entries(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).node)) {
    map.set(entry.exportedName, id)
  }
  return map
}

function actionId(name) {
  if (!actionIds.has(name)) actionIds = readManifest()
  return actionIds.get(name)
}

function makeSession() {
  const jar = new Map()
  return {
    async req(origin, path, options = {}) {
      const res = await fetch(origin + path, {
        ...options,
        redirect: 'manual',
        headers: {
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
          ...(options.headers || {}),
        },
      })
      for (const line of res.headers.getSetCookie?.() || []) {
        const pair = line.split(';')[0]
        const i = pair.indexOf('=')
        jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
      }
      return res
    },

    async action(origin, page, name, args) {
      const id = actionId(name)
      if (!id) return { error: `${name} not in manifest — load ${page} and re-run` }

      const res = await this.req(origin, page, {
        method: 'POST',
        headers: { 'Next-Action': id, 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(args),
      })
      return extractResult(await res.text())
    },
  }
}

/**
 * Pull the action's return value out of the React Flight stream.
 *
 * Brace-counted rather than matched with a regex, because the results here nest —
 * `accounts` is an array of objects — and a lazy regex stops at the first inner
 * closing brace, silently returning a truncated object that then fails to parse.
 */
function extractResult(text) {
  let best = null
  for (let i = 0; i < text.length; i++) {
    if (!text.startsWith('{"ok"', i)) continue
    let depth = 0
    for (let j = i; j < text.length; j++) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') {
        depth--
        if (depth === 0) {
          try {
            best = JSON.parse(text.slice(i, j + 1))
          } catch { /* not this one */ }
          break
        }
      }
    }
  }
  return best ?? { error: 'no result in stream', raw: text.slice(0, 160) }
}

/** Sign in through the phone-otp provider, exactly as the browser does. */
async function signInWithTicket(session, { ticket, userId }) {
  const { csrfToken } = await (await session.req(CLINIC, '/api/auth/csrf')).json()
  await session.req(CLINIC, '/api/auth/callback/phone-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, ticket, userId: String(userId) }).toString(),
  })
  return (await (await session.req(CLINIC, '/api/auth/session')).json())?.user ?? null
}

/** Put a code of our choosing on a number, and return it. */
async function plantCode(clinicId, phone, { code = '424242', ttl = 300, attempts = 0 } = {}) {
  await db.execute(
    `UPDATE login_otps SET consumed_at = NOW()
      WHERE clinic_id = ? AND phone = ? AND consumed_at IS NULL`,
    [clinicId, `91${phone}`]
  )
  await db.execute(
    `INSERT INTO login_otps (clinic_id, phone, code_hash, attempts, expires_at)
     VALUES (?, ?, ?, ?, NOW() + INTERVAL ? SECOND)`,
    [clinicId, `91${phone}`, await bcrypt.hash(code, 10), attempts, ttl]
  )
  return code
}

const otpRows = (clinicId, phone) =>
  db.execute('SELECT * FROM login_otps WHERE clinic_id = ? AND phone = ? ORDER BY id', [
    clinicId, `91${phone}`,
  ]).then(([r]) => r)

async function teardown() {
  const [rows] = await db.execute('SELECT id FROM clinics WHERE slug = ?', [SLUG])
  if (rows.length) {
    const id = rows[0].id
    for (const t of ['login_otps', 'whatsapp_messages', 'payments', 'consultation_notes',
                     'appointments', 'patient_packages', 'packages', 'reviews',
                     'availability_rules', 'time_off', 'services', 'platform_invoices',
                     'subscriptions']) {
      await db.execute(`DELETE FROM ${t} WHERE clinic_id = ?`, [id])
    }
    await db.execute('UPDATE clinics SET owner_user_id = NULL WHERE id = ?', [id])
    await db.execute(
      'DELETE FROM patient_profiles WHERE user_id IN (SELECT id FROM users WHERE clinic_id = ?)', [id]
    )
    await db.execute('DELETE FROM users WHERE clinic_id = ?', [id])
    await db.execute('DELETE FROM clinics WHERE id = ?', [id])
  }
  await db.execute("DELETE FROM users WHERE email LIKE 'otp.%@example.com'")
}

console.log('\nCleaning any previous run…')
await teardown()

/* ========================================================================== */
/*  SET UP                                                                    */
/* ========================================================================== */
{
  const s = makeSession()
  const res = await s.req(PLATFORM, '/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Dr. OTP Tester',
      email: OWNER.email,
      phone: '9812399999',
      password: OWNER.password,
      confirmPassword: OWNER.password,
      clinicName: 'OTP Test Clinic',
      slug: SLUG,
      city: 'Nashik',
      planCode: 'professional',
      acceptTerms: true,
    }),
  })
  if (res.status !== 201) {
    console.error('  ✗ could not create the clinic:', await res.text())
    process.exit(1)
  }
  await db.execute("UPDATE clinics SET onboarding_step = 'done' WHERE slug = ?", [SLUG])
}

const [[clinic]] = await db.execute('SELECT * FROM clinics WHERE slug = ?', [SLUG])

async function makePatient(name, phone, { active = true } = {}) {
  const [u] = await db.execute(
    `INSERT INTO users (clinic_id, name, email, phone, role, email_verified, is_active)
     VALUES (?, ?, ?, ?, 'patient', 1, ?)`,
    [clinic.id, name, `otp.${name.replace(/\s/g, '').toLowerCase()}@example.com`, phone, active ? 1 : 0]
  )
  await db.execute('INSERT INTO patient_profiles (user_id) VALUES (?)', [u.insertId])
  return u.insertId
}

const priya = await makePatient('Priya Solo', SOLO)
const sunita = await makePatient('Sunita Sharma', FAMILY)
const aarav = await makePatient('Aarav Sharma', FAMILY)
await makePatient('Removed Person', INACTIVE, { active: false })

// Warm the manifest: Next only registers an action once its page has been built.
await makeSession().req(CLINIC, '/login')

/* ========================================================================== */
/*  SENDING A CODE                                                            */
/* ========================================================================== */
console.log('\nSENDING A CODE')
{
  const s = makeSession()
  const sent = await s.action(CLINIC, '/login', 'requestLoginCode', [{ phone: SOLO }])

  check(sent.ok === true, 'a code is issued for a number on file', sent.message || sent.error)
  check(
    typeof sent.message === 'string' && sent.message.includes(SOLO.slice(-4)) && !sent.message.includes(SOLO),
    'the number is masked in the confirmation',
    sent.message
  )

  const rows = await otpRows(clinic.id, SOLO)
  check(rows.length === 1, 'exactly one code row was written', `${rows.length} rows`)
  check(
    rows[0] && /^\$2[aby]\$/.test(rows[0].code_hash),
    'the code is bcrypt-hashed, never stored in plain text',
    rows[0]?.code_hash?.slice(0, 7)
  )
  check(rows[0]?.attempts === 0 && rows[0]?.consumed_at === null, 'it starts unused')

  const [[logged]] = await db.execute(
    `SELECT category, template, to_number FROM whatsapp_messages
      WHERE clinic_id = ? AND template = 'login_code' ORDER BY id DESC LIMIT 1`,
    [clinic.id]
  )
  check(logged?.category === 'authentication', 'logged under the authentication category', logged?.category)
  check(logged?.to_number === `91${SOLO}`, 'to the normalised international number', logged?.to_number)
}

/* -------------------------------------------------------------------------- */
console.log('\nAN UNKNOWN NUMBER GIVES NOTHING AWAY')
{
  const s = makeSession()
  const known = await s.action(CLINIC, '/login', 'requestLoginCode', [{ phone: FAMILY }])
  const unknown = await s.action(CLINIC, '/login', 'requestLoginCode', [{ phone: UNKNOWN }])

  check(unknown.ok === true, 'an unknown number still reports success')
  check(
    unknown.message?.replace(/\d/g, '#') === known.message?.replace(/\d/g, '#'),
    'the wording is identical to a known number — no enumeration oracle'
  )

  const rows = await otpRows(clinic.id, UNKNOWN)
  check(rows.length === 0, 'no code row is written for a stranger', `${rows.length} rows`)

  const [[count]] = await db.execute(
    `SELECT COUNT(*) AS n FROM whatsapp_messages WHERE clinic_id = ? AND to_number = ?`,
    [clinic.id, `91${UNKNOWN}`]
  )
  check(Number(count.n) === 0, 'and no WhatsApp message is sent to them', `${count.n} messages`)
}

/* ========================================================================== */
/*  RATE LIMITING                                                             */
/* ========================================================================== */
console.log('\nRATE LIMITING')
{
  const s = makeSession()
  const again = await s.action(CLINIC, '/login', 'requestLoginCode', [{ phone: SOLO }])

  check(again.ok === false, 'a second code straight away is refused')
  check(Number(again.retryAfter) > 0, 'and says how long to wait', `${again.retryAfter}s`)

  // Age the existing rows past the resend cooldown but keep them inside the
  // 15-minute window, so the next assertion tests the COUNT limit rather than the
  // cooldown that has just been proved.
  await db.execute(
    `UPDATE login_otps SET created_at = NOW() - INTERVAL 3 MINUTE WHERE clinic_id = ? AND phone = ?`,
    [clinic.id, `91${SOLO}`]
  )

  const second = await s.action(CLINIC, '/login', 'requestLoginCode', [{ phone: SOLO }])
  check(second.ok === true, 'after the cooldown another code is allowed')

  await db.execute(
    `UPDATE login_otps SET created_at = NOW() - INTERVAL 2 MINUTE WHERE clinic_id = ? AND phone = ?`,
    [clinic.id, `91${SOLO}`]
  )
  const third = await s.action(CLINIC, '/login', 'requestLoginCode', [{ phone: SOLO }])
  check(third.ok === true, 'and a third')

  await db.execute(
    `UPDATE login_otps SET created_at = NOW() - INTERVAL 1 MINUTE WHERE clinic_id = ? AND phone = ?`,
    [clinic.id, `91${SOLO}`]
  )
  const fourth = await s.action(CLINIC, '/login', 'requestLoginCode', [{ phone: SOLO }])
  check(fourth.ok === false, 'the fourth inside the window is refused', fourth.message)
  check(
    /email and password/i.test(fourth.message || ''),
    'and points at a way in that still works — never a dead end'
  )
}

/* ========================================================================== */
/*  CHECKING A CODE                                                           */
/* ========================================================================== */
console.log('\nCHECKING A CODE')
{
  const s = makeSession()
  await plantCode(clinic.id, SOLO, { code: '111111' })

  const wrong = await s.action(CLINIC, '/login', 'confirmLoginCode', [{ phone: SOLO, code: '999999' }])
  check(wrong.ok === false, 'a wrong code is refused')
  check(/2 attempts left/.test(wrong.message || ''), 'and counts down the attempts', wrong.message)

  const live = (await otpRows(clinic.id, SOLO)).at(-1)
  check(Number(live.attempts) === 1, 'the attempt is recorded on the row', `attempts=${live.attempts}`)

  await s.action(CLINIC, '/login', 'confirmLoginCode', [{ phone: SOLO, code: '888888' }])
  const third = await s.action(CLINIC, '/login', 'confirmLoginCode', [{ phone: SOLO, code: '777777' }])
  check(/Too many incorrect/i.test(third.message || ''), 'the third wrong guess burns the code', third.message)

  const burned = (await otpRows(clinic.id, SOLO)).at(-1)
  check(burned.consumed_at !== null, 'the burned code is consumed, not left alive')

  const afterBurn = await s.action(CLINIC, '/login', 'confirmLoginCode', [{ phone: SOLO, code: '111111' }])
  check(
    afterBurn.ok === false,
    'and the ORIGINALLY CORRECT code no longer works — brute force costs a new OTP'
  )
}

/* -------------------------------------------------------------------------- */
console.log('\nTHE RIGHT CODE, ONCE')
{
  const s = makeSession()
  const code = await plantCode(clinic.id, SOLO, { code: '123456' })

  const ok = await s.action(CLINIC, '/login', 'confirmLoginCode', [{ phone: SOLO, code }])
  check(ok.ok === true, 'the correct code is accepted', ok.message || ok.error)
  check(typeof ok.ticket === 'string' && ok.ticket.includes('.'), 'a signed ticket comes back')
  check(ok.accounts?.length === 1 && ok.accounts[0].id === priya, 'with the one account on that number')
  check(
    ok.accounts?.[0] && !('email' in ok.accounts[0]) && !('phone' in ok.accounts[0]),
    'and no contact details, in case reception mistyped a digit'
  )

  const row = (await otpRows(clinic.id, SOLO)).at(-1)
  check(row.consumed_at !== null, 'the code is spent')

  const replay = await s.action(CLINIC, '/login', 'confirmLoginCode', [{ phone: SOLO, code }])
  check(replay.ok === false, 'replaying it fails — single use', replay.message)

  const [[user]] = await db.execute('SELECT phone_verified FROM users WHERE id = ?', [priya])
  check(Number(user.phone_verified) === 1, 'the number is now recorded as proven')
}

/* -------------------------------------------------------------------------- */
console.log('\nAN EXPIRED CODE')
{
  const s = makeSession()
  const code = await plantCode(clinic.id, SOLO, { code: '654321', ttl: -10 })
  const result = await s.action(CLINIC, '/login', 'confirmLoginCode', [{ phone: SOLO, code }])
  check(result.ok === false, 'an expired code is refused', result.message)
  check(
    /expired or is not valid/i.test(result.message || ''),
    'with the same wording as a wrong one — no hint about which it was'
  )
}

/* ========================================================================== */
/*  ONE NUMBER, A WHOLE FAMILY                                                */
/* ========================================================================== */
console.log('\nONE NUMBER, A WHOLE FAMILY')
{
  const s = makeSession()
  const code = await plantCode(clinic.id, FAMILY, { code: '222222' })
  const result = await s.action(CLINIC, '/login', 'confirmLoginCode', [{ phone: FAMILY, code }])

  check(result.ok === true, 'the shared number verifies')
  check(result.accounts?.length === 2, 'both people on it come back', `${result.accounts?.length} accounts`)
  const ids = (result.accounts || []).map((a) => a.id)
  check(ids.includes(sunita) && ids.includes(aarav), 'the mother AND the child, not just the first row')
}

/* -------------------------------------------------------------------------- */
console.log('\nWHO IS EXCLUDED')
{
  const s = makeSession()
  await plantCode(clinic.id, INACTIVE, { code: '333333' })
  const removed = await s.action(CLINIC, '/login', 'confirmLoginCode', [{ phone: INACTIVE, code: '333333' }])
  check(removed.ok === false, 'a deactivated account cannot sign in by phone', removed.message)

  /**
   * The platform owner is the highest-value target in the whole system — that one
   * account reads every clinic's patient records. SIM swap is common in India, so
   * this role keeps a password and only a password.
   */
  const [[owner]] = await db.execute(
    "SELECT id, phone FROM users WHERE role = 'platform' AND phone IS NOT NULL LIMIT 1"
  )
  if (owner?.phone) {
    const digits = owner.phone.replace(/\D/g, '').slice(-10)
    await db.execute(
      `INSERT INTO login_otps (clinic_id, phone, code_hash, expires_at)
       VALUES (?, ?, ?, NOW() + INTERVAL 300 SECOND)`,
      [clinic.id, `91${digits}`, await bcrypt.hash('444444', 10)]
    )
    const attempt = await s.action(CLINIC, '/login', 'confirmLoginCode', [
      { phone: digits, code: '444444' },
    ])
    check(attempt.ok === false, 'the platform owner cannot be reached by phone login')
  } else {
    check(true, 'the platform owner has no phone on file — nothing to reach', 'skipped')
  }
}

/* ========================================================================== */
/*  THE TICKET IS THE SECURITY                                                */
/* ========================================================================== */
console.log('\nTHE TICKET IS THE SECURITY')
{
  const s = makeSession()
  const code = await plantCode(clinic.id, FAMILY, { code: '555555' })
  const verified = await s.action(CLINIC, '/login', 'confirmLoginCode', [{ phone: FAMILY, code }])
  const ticket = verified.ticket

  /* ---- picking somebody the ticket does not name */
  const impostor = makeSession()
  const stolen = await signInWithTicket(impostor, { ticket, userId: priya })
  check(stolen === null, 'a ticket cannot select an account it does not name', stolen?.name || 'refused')

  /* ---- a tampered signature */
  const forged = makeSession()
  const [body] = ticket.split('.')
  const bad = await signInWithTicket(forged, { ticket: `${body}.notarealsignature`, userId: sunita })
  check(bad === null, 'a forged signature is refused')

  /* ---- a rewritten payload, correctly formatted but unsigned */
  const rewritten = makeSession()
  const payload = Buffer.from(
    JSON.stringify({ c: clinic.id, p: `91${FAMILY}`, u: [priya], exp: Math.floor(Date.now() / 1000) + 120 })
  ).toString('base64url')
  const tampered = await signInWithTicket(rewritten, { ticket: `${payload}.${ticket.split('.')[1]}`, userId: priya })
  check(tampered === null, 'a rewritten payload with a borrowed signature is refused')

  /* ---- and the honest case still works, or the three above prove nothing */
  const honest = makeSession()
  const user = await signInWithTicket(honest, { ticket, userId: aarav })
  check(user?.id === String(aarav), 'the person the ticket names DOES get in', user?.name || 'refused')
  check(user?.role === 'patient', 'as themselves, with their own role', user?.role)
  check(String(user?.clinicId) === String(clinic.id), 'and scoped to their own clinic')

  const dash = await honest.req(CLINIC, '/dashboard')
  check(dash.status === 200, 'and the patient dashboard opens', `got ${dash.status}`)
}

/* ========================================================================== */
/*  RECEPTION AND THE FAMILY NUMBER                                           */
/* ========================================================================== */
console.log('\nRECEPTION AND THE FAMILY NUMBER')
{
  const staff = makeSession()
  const { csrfToken } = await (await staff.req(CLINIC, '/api/auth/csrf')).json()
  await staff.req(CLINIC, '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, ...OWNER }).toString(),
  })
  await staff.req(CLINIC, '/admin/appointments/new')

  const page = '/admin/appointments/new'

  /**
   * The bug this replaces: a phone match was treated as the same person, so a
   * mother booking for her child had the appointment silently filed under her own
   * name and the child never got a record at all.
   */
  const asked = await staff.action(CLINIC, page, 'createDeskPatient', [
    { name: 'Ishaan Sharma', phone: FAMILY, email: '' },
  ])
  check(asked.ok === false && Array.isArray(asked.sharedPhone), 'a shared number asks instead of assuming')
  check(
    (asked.sharedPhone || []).length === 2,
    'and names everyone already on it',
    (asked.sharedPhone || []).map((p) => p.name).join(', ')
  )

  const [[before]] = await db.execute(
    "SELECT COUNT(*) AS n FROM users WHERE clinic_id = ? AND name = 'Ishaan Sharma'", [clinic.id]
  )
  check(Number(before.n) === 0, 'nothing is created while the question is unanswered')

  const created = await staff.action(CLINIC, page, 'createDeskPatient', [
    { name: 'Ishaan Sharma', phone: FAMILY, email: '', allowSharedPhone: true },
  ])
  check(created.ok === true && created.patientId, 'answering "somebody else" creates a separate record')

  const [[after]] = await db.execute(
    'SELECT COUNT(*) AS n FROM users WHERE clinic_id = ? AND phone = ?', [clinic.id, FAMILY]
  )
  check(Number(after.n) === 3, 'so the household now has three files, not one', `${after.n} files`)

  /* ---- an email match is still the same person, and must not ask */
  const same = await staff.action(CLINIC, page, 'createDeskPatient', [
    { name: 'Priya Again', phone: '9812390077', email: 'otp.priyasolo@example.com' },
  ])
  check(
    same.ok === true && same.existing === true && same.patientId === priya,
    'a matching EMAIL is still treated as the same person — no question asked',
    same.message || same.error
  )
}

/* ========================================================================== */
console.log('\nCleaning up…')
await teardown()
check(true, 'test clinic removed')

await db.end()

console.log(
  failures === 0
    ? '\n✓ PHONE SIGN-IN WORKS\n'
    : `\n✗ ${failures} PHONE SIGN-IN FAILURE(S)\n`
)
process.exit(failures === 0 ? 0 : 1)
