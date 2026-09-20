/**
 * ============================================================================
 *  SECURITY — the checks that are not about tenancy
 * ============================================================================
 *
 *  tests/isolation.mjs and tests/actions.mjs cover one clinic reaching another.
 *  This file covers the rest: guessing passwords, one patient reading another,
 *  forged webhooks, and booking times that should be impossible.
 *
 *  WHY THE THROTTLE TEST LOOKS THE WAY IT DOES
 *  -------------------------------------------
 *  The first version measured guesses per second and called it a pass when the
 *  number came down. It went UP after the fix — because a throttled attempt is
 *  rejected immediately without running bcrypt, so the server answers faster
 *  while doing less. Throughput was measuring the wrong thing entirely.
 *
 *  What matters is whether an attempt is CONSIDERED, so that is what is asserted:
 *  after enough failures the correct password stops working, and it starts working
 *  again once the wait has passed.
 * ============================================================================
 */

import mysql from 'mysql2/promise'
import process from 'node:process'

process.loadEnvFile('.env.local')

const A = 'http://aarogya.localhost:3000'
const ADMIN = { email: 'admin@aarogyaphysio.in', password: 'admin123' }

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

function makeSession(ip) {
  const jar = new Map()
  return {
    async req(origin, path, options = {}) {
      const res = await fetch(origin + path, {
        ...options,
        redirect: 'manual',
        headers: {
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
          // Pretend to arrive from a given address, the way a reverse proxy
          // would report it. See clientAddress() in lib/auth.js.
          ...(ip ? { 'x-forwarded-for': ip } : {}),
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
    json(origin, path, body) {
      return this.req(origin, path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    },
  }
}

async function attempt(origin, { email, password }, ip) {
  const s = makeSession(ip)
  const { csrfToken } = await (await s.req(origin, '/api/auth/csrf')).json()
  await s.req(origin, '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, email, password }).toString(),
  })
  const user = (await (await s.req(origin, '/api/auth/session')).json())?.user ?? null
  return { user, session: s }
}

const [[clinic]] = await db.execute("SELECT * FROM clinics WHERE slug = 'aarogya'")

/* ========================================================================== */
console.log('\nPASSWORD GUESSING')
/* ========================================================================== */
{
  const ATTACKER = '203.0.113.9'
  const HONEST = '198.51.100.4'
  await db.execute('DELETE FROM login_attempts')

  // Five wrong guesses is the first rung.
  for (let i = 0; i < 5; i++) {
    await attempt(A, { email: ADMIN.email, password: `wrong-${i}` }, ATTACKER)
  }

  const [[record]] = await db.execute(
    'SELECT failures, blocked_until FROM login_attempts WHERE attempt_key LIKE ?',
    [`${ADMIN.email}|${ATTACKER}%`]
  )
  check(Number(record?.failures) >= 5, 'failures are counted', `${record?.failures ?? 0}`)
  check(Boolean(record?.blocked_until), 'and a wait is imposed')

  /**
   * The assertion that matters: the CORRECT password stops working.
   *
   * If a guesser could still get in with the right password while throttled, the
   * throttle would be decorative — they would simply keep guessing.
   */
  const rightButBlocked = await attempt(A, ADMIN, ATTACKER)
  check(!rightButBlocked.user, 'even the correct password is refused while blocked')

  /**
   * And the half that stops the throttle becoming a weapon: the real owner,
   * signing in from their own address, is unaffected. Keyed on email alone, an
   * attacker could lock a clinic out of its own business from anywhere.
   */
  const owner = await attempt(A, ADMIN, HONEST)
  check(
    Boolean(owner.user),
    'the owner can still sign in from their own address — no lockout weapon',
    owner.user ? `role=${owner.user.role}` : 'REFUSED'
  )

  // Once the wait has passed, the attacker's address works again — a delay, not
  // a ban. Fast-forwarded rather than waiting 30 seconds.
  await db.execute(
    'UPDATE login_attempts SET blocked_until = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE attempt_key LIKE ?',
    [`${ADMIN.email}|${ATTACKER}%`]
  )
  const afterWait = await attempt(A, ADMIN, ATTACKER)
  check(Boolean(afterWait.user), 'and works again once the wait has passed — a delay, not a ban')

  // A successful sign-in clears the record, so the next honest typo starts fresh.
  const [[cleared]] = await db.execute(
    'SELECT COUNT(*) AS n FROM login_attempts WHERE attempt_key LIKE ?',
    [`${ADMIN.email}|${ATTACKER}%`]
  )
  check(Number(cleared.n) === 0, 'a successful sign-in forgets the failures')

  /**
   * The throttle must not become an account-enumeration oracle.
   *
   * If only real accounts were throttled, an attacker could tell who is a patient
   * at a physiotherapy clinic by watching which addresses get slowed down — which
   * is private medical information.
   */
  await db.execute('DELETE FROM login_attempts')
  const PROBER = '203.0.113.77'
  for (let i = 0; i < 5; i++) {
    await attempt(A, { email: 'nobody-here@example.com', password: `x${i}` }, PROBER)
  }
  const [[unknown]] = await db.execute(
    'SELECT failures FROM login_attempts WHERE attempt_key LIKE ?',
    [`nobody-here@example.com|${PROBER}%`]
  )
  check(
    Number(unknown?.failures) >= 5,
    'an email that does not exist is throttled identically',
    'so the throttle cannot be used to check who is a patient here'
  )

  await db.execute('DELETE FROM login_attempts')
}

/* ========================================================================== */
console.log('\nONE PATIENT READING ANOTHER (same clinic)')
/* ========================================================================== */
{
  const [[hash]] = await db.execute(
    "SELECT password_hash FROM users WHERE email = 'patient@example.com'"
  )
  await db.execute(
    "DELETE FROM patient_profiles WHERE user_id IN (SELECT id FROM users WHERE email = 'sec.victim@example.com')"
  )
  await db.execute("DELETE FROM users WHERE email = 'sec.victim@example.com'")

  const [victim] = await db.execute(
    `INSERT INTO users (clinic_id, name, email, password_hash, phone, role, email_verified, is_active)
     VALUES (?, 'Victim Patient', 'sec.victim@example.com', ?, '9812399999', 'patient', 1, 1)`,
    [clinic.id, hash.password_hash]
  )
  await db.execute('INSERT INTO patient_profiles (user_id) VALUES (?)', [victim.insertId])

  const [[svc]] = await db.execute('SELECT id FROM services WHERE clinic_id = ? LIMIT 1', [clinic.id])
  const [[phy]] = await db.execute(
    "SELECT id FROM users WHERE clinic_id = ? AND role = 'physio' LIMIT 1", [clinic.id]
  )
  const [appt] = await db.execute(
    `INSERT INTO appointments (clinic_id, code, patient_id, physio_id, service_id,
                              appointment_date, start_time, end_time, slot_seat, mode, status,
                              amount_paise, patient_notes)
     VALUES (?, 'SEC00001', ?, ?, ?, DATE_ADD(CURDATE(), INTERVAL 5 DAY), '11:00:00', '11:30:00',
             0, 'clinic', 'confirmed', 80000, 'Private: severe depression, on medication')`,
    [clinic.id, victim.insertId, phy.id, svc.id]
  )
  await db.execute(
    `INSERT INTO consultation_notes (clinic_id, appointment_id, physio_id, subjective, assessment, plan)
     VALUES (?, ?, ?, 'Confidential note', 'Sensitive', 'Private plan')`,
    [clinic.id, appt.insertId, phy.id]
  )

  const { session: attacker } = await attempt(
    A, { email: 'patient@example.com', password: 'patient123' }, '198.51.100.55'
  )

  const page = await attacker.req(A, `/dashboard/appointments/${appt.insertId}`)
  const body = page.status === 200 ? await page.text() : ''
  check(
    !(page.status === 200 && body.includes('severe depression')),
    "a patient cannot open another patient's appointment",
    `status ${page.status}`
  )

  await attacker.req(A, `/api/appointments/${appt.insertId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'x' }),
  })
  const [[after]] = await db.execute('SELECT status FROM appointments WHERE id = ?', [appt.insertId])
  check(after.status !== 'cancelled', "nor cancel it", after.status)

  const consult = await attacker.req(A, `/consult/${appt.insertId}`)
  check(consult.status !== 200, "nor enter their video room", `status ${consult.status}`)

  await db.execute('DELETE FROM consultation_notes WHERE appointment_id = ?', [appt.insertId])
  await db.execute('DELETE FROM appointments WHERE id = ?', [appt.insertId])
  await db.execute('DELETE FROM patient_profiles WHERE user_id = ?', [victim.insertId])
  await db.execute('DELETE FROM users WHERE id = ?', [victim.insertId])
}

/* ========================================================================== */
console.log('\nFORGED WEBHOOKS')
/* ========================================================================== */
{
  const patient = await fetch(`${A}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'payment.captured', payload: {} }),
  })
  check(patient.status >= 400, 'an unsigned PATIENT payment webhook is refused', `status ${patient.status}`)

  const platform = await fetch('http://localhost:3000/api/billing/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'subscription.charged', payload: {} }),
  })
  check(platform.status >= 400, 'an unsigned SUBSCRIPTION webhook is refused', `status ${platform.status}`)
}

/* ========================================================================== */
console.log('\nIMPOSSIBLE BOOKINGS')
/* ========================================================================== */
{
  const { session: patient } = await attempt(
    A, { email: 'patient@example.com', password: 'patient123' }, '198.51.100.56'
  )
  const [[service]] = await db.execute(
    'SELECT id FROM services WHERE clinic_id = ? AND is_active = 1 LIMIT 1', [clinic.id]
  )

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const past = await patient.json(A, '/api/appointments', {
    serviceId: service.id, date: yesterday, startTime: '10:00:00', mode: 'clinic',
  })
  check(past.status >= 400, 'a slot in the past is refused', `status ${past.status}`)

  const farOff = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10)
  const far = await patient.json(A, '/api/appointments', {
    serviceId: service.id, date: farOff, startTime: '10:00:00', mode: 'clinic',
  })
  check(far.status >= 400, 'a slot beyond the booking horizon is refused', `status ${far.status}`)

  const dates = await (await patient.req(A, '/api/slots?days=14&mode=clinic')).json()
  const openDay = (dates.dates || []).filter((d) => d.isOpen).pop()
  const odd = await patient.json(A, '/api/appointments', {
    serviceId: service.id, date: openDay.date, startTime: '10:07:00', mode: 'clinic',
  })
  check(odd.status >= 400, 'an off-grid start time is refused', `status ${odd.status}`)
}

/* ========================================================================== */
console.log('\nTHE LEDGER CANNOT DRIFT')
/* ========================================================================== */
{
  const [[orphan]] = await db.execute(
    `SELECT COUNT(*) AS n FROM payments
      WHERE (appointment_id IS NULL AND patient_package_id IS NULL)
         OR (appointment_id IS NOT NULL AND patient_package_id IS NOT NULL)`
  )
  check(Number(orphan.n) === 0, 'no payment belongs to nothing, or to two things', `${orphan.n}`)

  const [[doubled]] = await db.execute(
    `SELECT COUNT(*) AS n FROM appointments
      WHERE patient_package_id IS NOT NULL AND amount_paise <> 0`
  )
  check(Number(doubled.n) === 0, 'no package session is also charged a fee', `${doubled.n}`)

  const [[crossed]] = await db.execute(
    `SELECT COUNT(*) AS n FROM appointments a
       JOIN patient_packages pp ON pp.id = a.patient_package_id
      WHERE pp.clinic_id <> a.clinic_id OR pp.patient_id <> a.patient_id`
  )
  check(Number(crossed.n) === 0, 'no session is drawn from another patient’s package', `${crossed.n}`)
}

console.log(`\n${failures === 0 ? '✓ SECURITY CHECKS PASS' : `✗ ${failures} FAILURE(S)`}\n`)
await db.end()
process.exit(failures === 0 ? 0 : 1)
