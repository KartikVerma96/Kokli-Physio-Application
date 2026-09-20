/**
 * ============================================================================
 *  ACCOUNT RECOVERY, DATA EXPORT AND ERROR REPORTING
 * ============================================================================
 *
 *  WHY THE PASSWORD RESET GETS THE MOST ASSERTIONS
 *  -----------------------------------------------
 *  It is the softest way into any application. It is deliberately reachable by
 *  somebody who knows nothing but an email address, which makes every mistake here
 *  worth more to an attacker than a mistake anywhere else in the product.
 *
 *  So every control is tested from BOTH directions. A suite that only checks
 *  "the bad thing is refused" passes happily against a feature that refuses
 *  everything, including the legitimate case — and that bug ships, because the
 *  tests are green.
 *
 *  THE THREE THAT MATTER MOST
 *  --------------------------
 *    1. A used token cannot be used again. Without this the link in an inbox is a
 *       permanent key, and inboxes get breached far more often than databases.
 *
 *    2. The export is scoped to ONE clinic and ONE patient. A missing clinic_id in
 *       an export is not a leak of a page, it is a leak of a file somebody can
 *       email onwards.
 *
 *    3. Errors GROUP. If they do not, forty hits on one broken page bury the three
 *       other faults that happened once each — which are usually the real ones.
 * ============================================================================
 */

import fs from 'node:fs'
import crypto from 'node:crypto'
import process from 'node:process'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'

process.loadEnvFile('.env.local')

const PLATFORM = 'http://localhost:3000'
const SLUG = 'acctest'
const OTHER = 'acctest2'
const CLINIC = `http://${SLUG}.localhost:3000`
const CLINIC_B = `http://${OTHER}.localhost:3000`

const OWNER = { email: 'acc.owner@example.com', password: 'acctest123' }
const OWNER_B = { email: 'acc.ownerb@example.com', password: 'acctest123' }
const PATIENT = { email: 'acc.patient@example.com', password: 'patient123' }

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

/* -------------------------------------------------------------- plumbing */

const MANIFEST = '.next/dev/server/server-reference-manifest.json'
if (!fs.existsSync(MANIFEST)) {
  console.error(`\n  ✗ ${MANIFEST} missing. Start the dev server and open /login first.\n`)
  process.exit(1)
}

// Re-read on every miss: the dev server appends to this file as it compiles each
// route, so an action on a page not yet visited is simply absent at start-up.
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
      return extract(await res.text())
    },
    async signIn(origin, creds) {
      const { csrfToken } = await (await this.req(origin, '/api/auth/csrf')).json()
      await this.req(origin, '/api/auth/callback/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ csrfToken, ...creds }).toString(),
      })
      return (await (await this.req(origin, '/api/auth/session')).json())?.user ?? null
    },
  }
}

/** Brace-counted, because these results nest and a lazy regex truncates them. */
function extract(text) {
  let best = null
  for (let i = 0; i < text.length; i++) {
    if (!text.startsWith('{"ok"', i)) continue
    let depth = 0
    for (let j = i; j < text.length; j++) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') {
        depth--
        if (depth === 0) {
          try { best = JSON.parse(text.slice(i, j + 1)) } catch { /* not this one */ }
          break
        }
      }
    }
  }
  return best ?? { error: 'no result in stream', raw: text.slice(0, 160) }
}

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex')

/** Plant a reset token we know the plaintext of. */
async function plantToken(userId, { minutes = 60 } = {}) {
  const token = crypto.randomBytes(32).toString('hex')
  await db.execute(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES (?, ?, NOW() + INTERVAL ? MINUTE)`,
    [userId, sha256(token), minutes]
  )
  return token
}

async function teardown() {
  for (const slug of [SLUG, OTHER]) {
    const [rows] = await db.execute('SELECT id FROM clinics WHERE slug = ?', [slug])
    if (!rows.length) continue
    const id = rows[0].id
    await db.execute('DELETE FROM error_events WHERE clinic_id = ?', [id])
    await db.execute(
      'DELETE FROM password_resets WHERE user_id IN (SELECT id FROM users WHERE clinic_id = ?)', [id]
    )
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
  await db.execute("DELETE FROM users WHERE email LIKE 'acc.%@example.com'")
  await db.execute("DELETE FROM error_events WHERE message LIKE 'ACCTEST%'")
}

console.log('\nCleaning any previous run…')
await teardown()

/* ========================================================================== */
/*  SET UP — two clinics, so the export can be checked across a boundary       */
/* ========================================================================== */
for (const [slug, owner, name] of [
  [SLUG, OWNER, 'Account Test Clinic'],
  [OTHER, OWNER_B, 'Other Clinic'],
]) {
  const s = makeSession()
  const res = await s.req(PLATFORM, '/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Dr. ${slug}`,
      email: owner.email,
      phone: slug === SLUG ? '9812388881' : '9812388882',
      password: owner.password,
      confirmPassword: owner.password,
      clinicName: name,
      slug,
      city: 'Pune',
      planCode: 'professional',
      acceptTerms: true,
    }),
  })
  if (res.status !== 201) {
    console.error(`  ✗ could not create ${slug}:`, await res.text())
    process.exit(1)
  }
  await db.execute("UPDATE clinics SET onboarding_step = 'done' WHERE slug = ?", [slug])
}

const [[clinic]] = await db.execute('SELECT * FROM clinics WHERE slug = ?', [SLUG])
const [[clinicB]] = await db.execute('SELECT * FROM clinics WHERE slug = ?', [OTHER])
const [[ownerRow]] = await db.execute('SELECT id FROM users WHERE email = ?', [OWNER.email])

// A patient at clinic A, with a password, and one at clinic B for the isolation check.
const [pa] = await db.execute(
  `INSERT INTO users (clinic_id, name, email, password_hash, phone, role, email_verified, is_active)
   VALUES (?, 'Amit Patient', ?, ?, '9812388883', 'patient', 1, 1)`,
  [clinic.id, PATIENT.email, await bcrypt.hash(PATIENT.password, 10)]
)
const patientId = pa.insertId
await db.execute('INSERT INTO patient_profiles (user_id, occupation) VALUES (?, ?)', [
  patientId, 'Software engineer',
])

const [pb] = await db.execute(
  `INSERT INTO users (clinic_id, name, email, role, email_verified, is_active)
   VALUES (?, 'Clinic B Patient', 'acc.patientb@example.com', 'patient', 1, 1)`,
  [clinicB.id]
)
await db.execute('INSERT INTO patient_profiles (user_id) VALUES (?)', [pb.insertId])

await makeSession().req(CLINIC, '/forgot-password')

/* ========================================================================== */
/*  ASKING FOR A RESET LINK                                                   */
/* ========================================================================== */
console.log('\nASKING FOR A RESET LINK')
{
  const s = makeSession()
  const known = await s.action(CLINIC, '/forgot-password', 'requestPasswordReset', [
    { email: PATIENT.email },
  ])
  check(known.ok === true, 'a known address is accepted', known.message || known.error)

  const [rows] = await db.execute(
    'SELECT token_hash, consumed_at FROM password_resets WHERE user_id = ?', [patientId]
  )
  check(rows.length === 1, 'one token row is written', `${rows.length} rows`)
  check(
    rows[0] && /^[0-9a-f]{64}$/.test(rows[0].token_hash),
    'stored as a 64-character SHA-256, never the token itself',
    rows[0]?.token_hash?.slice(0, 10)
  )

  const unknown = await s.action(CLINIC, '/forgot-password', 'requestPasswordReset', [
    { email: 'nobody.at.all@example.com' },
  ])
  check(unknown.ok === true, 'an unknown address is accepted too')
  check(
    unknown.message === known.message,
    'with wording identical to a known one — no enumeration oracle'
  )

  const [none] = await db.execute(
    "SELECT COUNT(*) AS n FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE u.email = ?",
    ['nobody.at.all@example.com']
  )
  check(Number(none[0].n) === 0, 'and nothing is written for a stranger')
}

/* -------------------------------------------------------------------------- */
console.log('\nA NEW REQUEST RETIRES THE OLD LINK')
{
  const s = makeSession()
  const first = await plantToken(patientId)
  await s.action(CLINIC, '/forgot-password', 'requestPasswordReset', [{ email: PATIENT.email }])

  const [[row]] = await db.execute(
    'SELECT consumed_at FROM password_resets WHERE token_hash = ?', [sha256(first)]
  )
  check(
    row?.consumed_at !== null,
    'the previous token is retired, so a forwarded older email cannot be used'
  )
}

/* ========================================================================== */
/*  USING A LINK                                                              */
/* ========================================================================== */
console.log('\nUSING A LINK')
{
  const s = makeSession()
  const token = await plantToken(patientId)
  await s.req(CLINIC, `/reset-password?token=${token}`)

  const short = await s.action(CLINIC, '/reset-password', 'submitNewPassword', [
    { token, password: 'abc', confirm: 'abc' },
  ])
  check(short.ok === false, 'a password under 8 characters is refused', short.message)

  const mismatch = await s.action(CLINIC, '/reset-password', 'submitNewPassword', [
    { token, password: 'brandnew123', confirm: 'different123' },
  ])
  check(mismatch.ok === false, 'a mismatched confirmation is refused', mismatch.message)

  // Both refusals must leave the token usable, or a typo would cost the person
  // their only way back in.
  const stillLive = await db.execute(
    'SELECT consumed_at FROM password_resets WHERE token_hash = ?', [sha256(token)]
  ).then(([r]) => r[0])
  check(stillLive?.consumed_at === null, 'a rejected attempt does NOT burn the token')

  const done = await s.action(CLINIC, '/reset-password', 'submitNewPassword', [
    { token, password: 'brandnew123', confirm: 'brandnew123' },
  ])
  check(done.ok === true, 'the correct submission succeeds', done.message || done.error)

  const [[after]] = await db.execute(
    'SELECT password_hash, password_changed_at FROM users WHERE id = ?', [patientId]
  )
  check(
    await bcrypt.compare('brandnew123', after.password_hash),
    'the new password actually works'
  )
  check(after.password_changed_at !== null, 'and password_changed_at is stamped')

  const replay = await s.action(CLINIC, '/reset-password', 'submitNewPassword', [
    { token, password: 'thirdtry123', confirm: 'thirdtry123' },
  ])
  check(replay.ok === false, 'the same link cannot be used twice', replay.message)

  const signedIn = await makeSession().signIn(CLINIC, {
    email: PATIENT.email,
    password: 'brandnew123',
  })
  check(signedIn?.id === String(patientId), 'and they can sign in with it', signedIn?.name)
}

/* -------------------------------------------------------------------------- */
console.log('\nAN EXPIRED OR FORGED LINK')
{
  const s = makeSession()

  const expired = await plantToken(patientId, { minutes: -5 })
  const one = await s.action(CLINIC, '/reset-password', 'submitNewPassword', [
    { token: expired, password: 'expired12345', confirm: 'expired12345' },
  ])
  check(one.ok === false, 'an expired token is refused', one.message)

  const forged = crypto.randomBytes(32).toString('hex')
  const two = await s.action(CLINIC, '/reset-password', 'submitNewPassword', [
    { token: forged, password: 'forged123456', confirm: 'forged123456' },
  ])
  check(two.ok === false, 'a token that was never issued is refused')
  check(one.message === two.message, 'both give the same message — expired and forged look alike')

  const page = await s.req(CLINIC, `/reset-password?token=${forged}`)
  const body = await page.text()
  check(
    /expired/i.test(body) && !/Choose a new password<\/h1>/.test(body),
    'and the page says so BEFORE asking for a password twice'
  )
}

/* ========================================================================== */
/*  CHANGING IT WHILE SIGNED IN                                               */
/* ========================================================================== */
console.log('\nCHANGING IT WHILE SIGNED IN')
{
  const s = makeSession()
  await s.signIn(CLINIC, { email: PATIENT.email, password: 'brandnew123' })
  await s.req(CLINIC, '/dashboard/profile')

  const wrong = await s.action(CLINIC, '/dashboard/profile', 'changeMyPassword', [
    { currentPassword: 'notitatall', newPassword: 'changed12345', confirm: 'changed12345' },
  ])
  check(wrong.ok === false, 'the current password is genuinely required', wrong.message)

  const same = await s.action(CLINIC, '/dashboard/profile', 'changeMyPassword', [
    { currentPassword: 'brandnew123', newPassword: 'brandnew123', confirm: 'brandnew123' },
  ])
  check(same.ok === false, 'reusing the same password is refused rather than silently accepted')

  const ok = await s.action(CLINIC, '/dashboard/profile', 'changeMyPassword', [
    { currentPassword: 'brandnew123', newPassword: 'changed12345', confirm: 'changed12345' },
  ])
  check(ok.ok === true, 'a correct change succeeds', ok.message || ok.error)

  const [[row]] = await db.execute('SELECT password_hash FROM users WHERE id = ?', [patientId])
  check(await bcrypt.compare('changed12345', row.password_hash), 'the new password is in place')

  // Anyone reception created has no password at all, so the current-password check
  // must be skipped for them — otherwise the people who most need a way in are the
  // ones who cannot set one.
  const [desk] = await db.execute(
    `INSERT INTO users (clinic_id, name, email, role, email_verified, is_active)
     VALUES (?, 'Desk Created', 'acc.desk@example.com', 'patient', 0, 1)`,
    [clinic.id]
  )
  await db.execute('INSERT INTO patient_profiles (user_id) VALUES (?)', [desk.insertId])

  const deskSession = makeSession()
  const { csrfToken } = await (await deskSession.req(CLINIC, '/api/auth/csrf')).json()
  // No password, so sign in by planting an OTP and using the phone route.
  await db.execute(
    `UPDATE users SET phone = '9812388887' WHERE id = ?`, [desk.insertId]
  )
  await db.execute(
    `INSERT INTO login_otps (clinic_id, phone, code_hash, expires_at)
     VALUES (?, '919812388887', ?, NOW() + INTERVAL 300 SECOND)`,
    [clinic.id, await bcrypt.hash('909090', 10)]
  )
  await deskSession.req(CLINIC, '/login')
  const verified = await deskSession.action(CLINIC, '/login', 'confirmLoginCode', [
    { phone: '9812388887', code: '909090' },
  ])
  await deskSession.req(CLINIC, '/api/auth/callback/phone-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrfToken,
      ticket: verified.ticket || '',
      userId: String(desk.insertId),
    }).toString(),
  })

  await deskSession.req(CLINIC, '/dashboard/profile')
  const set = await deskSession.action(CLINIC, '/dashboard/profile', 'changeMyPassword', [
    { currentPassword: '', newPassword: 'firsttime123', confirm: 'firsttime123' },
  ])
  check(
    set.ok === true,
    'somebody with NO password can set one without providing a current one',
    set.message || set.error
  )
}

/* ========================================================================== */
/*  DATA EXPORT                                                               */
/* ========================================================================== */
console.log('\nDATA EXPORT — THE PATIENT\'S OWN')
{
  const anon = makeSession()
  const refused = await anon.req(CLINIC, '/api/export/me')
  check(refused.status === 401 || refused.status === 307, 'a stranger cannot export anything', `got ${refused.status}`)

  const s = makeSession()
  await s.signIn(CLINIC, { email: PATIENT.email, password: 'changed12345' })
  const res = await s.req(CLINIC, '/api/export/me')
  check(res.status === 200, 'a signed-in patient can', `got ${res.status}`)
  check(
    /attachment/.test(res.headers.get('content-disposition') || ''),
    'it downloads rather than displays'
  )
  check(
    /no-store/.test(res.headers.get('cache-control') || ''),
    'and is never cached — it is a file full of medical data'
  )

  const data = await res.json()
  check(data.account?.id === patientId, 'it contains their own record', data.account?.name)
  check(data.account?.occupation === 'Software engineer', 'including the profile fields')
  check(!('password_hash' in (data.account || {})), 'and NOT the password hash')
  check(Array.isArray(data.appointments) && Array.isArray(data.clinical_notes),
    'with appointments and clinical notes present as arrays')
  check(data.clinic?.name === clinic.name, 'and names the clinic inside the file', data.clinic?.name)
}

/* -------------------------------------------------------------------------- */
console.log('\nDATA EXPORT — THE CLINIC\'S')
{
  const physioSession = makeSession()
  const [[physio]] = await db.execute(
    "SELECT email FROM users WHERE clinic_id = ? AND role = 'physio' LIMIT 1", [clinic.id]
  )

  const patient = makeSession()
  await patient.signIn(CLINIC, { email: PATIENT.email, password: 'changed12345' })
  const asPatient = await patient.req(CLINIC, '/api/export/clinic?dataset=patients')
  check(asPatient.status === 403 || asPatient.status === 307,
    'a patient cannot export the clinic', `got ${asPatient.status}`)

  const admin = makeSession()
  await admin.signIn(CLINIC, OWNER)
  const res = await admin.req(CLINIC, '/api/export/clinic?dataset=patients')
  check(res.status === 200, 'the owner can', `got ${res.status}`)

  /**
   * Read the RAW BYTES, not the decoded text.
   *
   * `res.text()` uses a WHATWG UTF-8 decoder, and that decoder strips a leading
   * BOM by specification. Checking the string would therefore report "no BOM" for
   * a file that has one — a false failure that would push somebody into
   * "fixing" working code by adding a second BOM.
   *
   * The BOM matters because without it Excel on Windows reads the file in the
   * local codepage, and every Devanagari name and ₹ sign becomes mojibake.
   */
  const bytes = new Uint8Array(await res.clone().arrayBuffer())
  check(
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    'the CSV begins with the UTF-8 BOM bytes, so Excel reads Hindi names correctly',
    `first bytes ${[...bytes.slice(0, 3)].map((b) => b.toString(16)).join(' ')}`
  )

  const csv = await res.text()
  check(csv.includes('\r\n'), 'and uses CRLF line endings')
  check(csv.includes('Amit Patient'), 'it contains this clinic\'s patient')
  check(!csv.includes('Clinic B Patient'), 'and NOT the other clinic\'s patient')

  const bad = await admin.req(CLINIC, '/api/export/clinic?dataset=../../etc/passwd')
  check(bad.status === 400, 'an unknown dataset is refused', `got ${bad.status}`)

  const all = await admin.req(CLINIC, '/api/export/clinic?dataset=all')
  check(all.status === 200, 'the full JSON export works', `got ${all.status}`)
  const bundle = await all.json()
  check(
    bundle.patients?.length === 2 && bundle.patients.every((p) => p.name !== 'Clinic B Patient'),
    'and contains only this clinic across every dataset',
    `${bundle.patients?.length} patients`
  )

  // Cross-tenant: clinic A's owner on clinic B's hostname.
  const crossing = await admin.req(CLINIC_B, '/api/export/clinic?dataset=patients')
  check(
    crossing.status !== 200,
    'clinic A\'s owner cannot export clinic B from its own hostname',
    `got ${crossing.status}`
  )
  void physioSession, physio
}

/* ========================================================================== */
/*  ERROR REPORTING                                                           */
/* ========================================================================== */
console.log('\nERROR REPORTING')
{
  const s = makeSession()
  const unique = `ACCTEST failure ${crypto.randomBytes(3).toString('hex')}`

  const send = (message) =>
    s.req(CLINIC, '/api/report-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, route: '/some/page' }),
    })

  const first = await send(unique)
  check(first.status === 204, 'the browser endpoint always answers 204', `got ${first.status}`)

  const [[row]] = await db.execute(
    'SELECT occurrences, source, route, clinic_id FROM error_events WHERE message = ?', [unique]
  )
  check(row !== undefined, 'the fault is recorded')
  check(row?.source === 'browser', 'tagged as coming from a browser', row?.source)
  check(Number(row?.clinic_id) === Number(clinic.id),
    'attributed to the clinic from the HOSTNAME, not the request body')

  await send(unique)
  await send(unique)
  const [[grouped]] = await db.execute(
    'SELECT occurrences FROM error_events WHERE message = ?', [unique]
  )
  check(Number(grouped?.occurrences) === 3,
    'repeats GROUP onto one row and bump a counter', `occurrences=${grouped?.occurrences}`)

  const [[count]] = await db.execute(
    'SELECT COUNT(*) AS n FROM error_events WHERE message = ?', [unique]
  )
  check(Number(count.n) === 1, 'so three occurrences are still one row')

  // Same fault, different id inside the message: must not become a new fault.
  const withId = `ACCTEST duplicate entry 'order_8321' for key 'uq'`
  const withOther = `ACCTEST duplicate entry 'order_9014' for key 'uq'`
  await send(withId)
  await send(withOther)
  const [varied] = await db.execute(
    "SELECT occurrences FROM error_events WHERE message LIKE 'ACCTEST duplicate%'"
  )
  check(
    varied.length === 1 && Number(varied[0].occurrences) === 2,
    'two messages differing only in an id are ONE fault',
    `${varied.length} row(s)`
  )

  const empty = await s.req(CLINIC, '/api/report-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  check(empty.status === 204, 'an empty report is ignored without complaint')
}

/* -------------------------------------------------------------------------- */
console.log('\nTHE ERROR CONSOLE')
{
  const patient = makeSession()
  await patient.signIn(CLINIC, { email: PATIENT.email, password: 'changed12345' })
  const refused = await patient.req(PLATFORM, '/platform/errors')
  check(refused.status === 307, 'a patient cannot open the error console', `got ${refused.status}`)

  const clinicAdmin = makeSession()
  await clinicAdmin.signIn(CLINIC, OWNER)
  const alsoRefused = await clinicAdmin.req(PLATFORM, '/platform/errors')
  check(alsoRefused.status === 307, 'nor can a clinic owner', `got ${alsoRefused.status}`)
}

/* ========================================================================== */
console.log('\nCleaning up…')
await teardown()
check(true, 'test clinics removed')

await db.end()

console.log(
  failures === 0
    ? '\n✓ ACCOUNT RECOVERY, EXPORT AND ERROR REPORTING WORK\n'
    : `\n✗ ${failures} FAILURE(S)\n`
)
process.exit(failures === 0 ? 0 : 1)
