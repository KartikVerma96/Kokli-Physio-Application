/**
 * ============================================================================
 *  CROSS-TENANT ISOLATION TEST
 * ============================================================================
 *
 *  Run with the dev server up:   npm run test:isolation
 *
 *  Creates a SECOND clinic with its own staff, patient, service and appointment,
 *  then actively tries to read across the tenant boundary in every way a bug or
 *  an attacker would. Cleans up after itself.
 *
 *  WHY THIS IS THE MOST IMPORTANT FILE IN tests/
 *  ---------------------------------------------
 *  Every other feature is something a customer would complain about. This is the
 *  one that ends the business: one clinic reading another clinic's patient
 *  records is a data breach involving medical information.
 *
 *  A single missing `WHERE clinic_id = ?` is all it takes, and no amount of
 *  careful review reliably catches it — the query still returns rows, the page
 *  still renders, and nothing looks wrong until it is on the news. So it is
 *  tested, actively and adversarially, rather than trusted.
 *
 *  ---------------------------------------------------------------------------
 *  A LESSON THAT COST AN HOUR, PRESERVED HERE SO IT IS NOT REPEATED
 *  ---------------------------------------------------------------------------
 *  The first version of this file set a `Host` header to simulate subdomains:
 *
 *      fetch('http://127.0.0.1:3000/', { headers: { Host: 'aarogya.localhost' } })
 *
 *  Node's fetch SILENTLY DROPS it — `Host` is a forbidden header name in the
 *  fetch spec. Every request actually went to the platform origin, so every
 *  isolation check "passed" while testing nothing at all.
 *
 *  A security test that cannot fail is worse than no test, because it converts
 *  ignorance into false confidence. This version uses real origins:
 *  `*.localhost` resolves to 127.0.0.1 natively, so no hosts file is needed.
 * ============================================================================
 */

import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import process from 'node:process'
// Imported rather than hardcoded, so renaming the company does not break a test
// that is really asking "is this OUR page or a customer's?".
import { platform } from '../config/platform.js'

process.loadEnvFile('.env.local')

const PLATFORM = 'http://localhost:3000'
const A = { slug: 'aarogya', origin: 'http://aarogya.localhost:3000' }
const B = { slug: 'isolationtest', origin: 'http://isolationtest.localhost:3000' }

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

/* ---------------------------------------------------------- fixtures ------ */

async function teardown() {
  const [rows] = await db.execute('SELECT id FROM clinics WHERE slug = ?', [B.slug])
  if (!rows.length) return
  const id = rows[0].id
  for (const table of ['consultation_notes', 'payments', 'reviews', 'appointments',
                       'availability_rules', 'time_off', 'services', 'subscriptions']) {
    await db.execute(`DELETE FROM ${table} WHERE clinic_id = ?`, [id])
  }
  await db.execute('UPDATE clinics SET owner_user_id = NULL WHERE id = ?', [id])
  await db.execute(
    'DELETE FROM patient_profiles WHERE user_id IN (SELECT id FROM users WHERE clinic_id = ?)', [id]
  )
  await db.execute('DELETE FROM users WHERE clinic_id = ?', [id])
  await db.execute('DELETE FROM clinics WHERE id = ?', [id])
}

async function buildClinicB() {
  await teardown()

  const [c] = await db.execute(
    `INSERT INTO clinics (slug, name, legal_name, tagline, description, city, state,
                          phone, email, practitioner_name, practitioner_credentials,
                          status, onboarding_step, onboarding_completed_at)
     VALUES (?, 'Isolation Test Clinic', 'Isolation Test Pvt Ltd', 'Second tenant',
             'A second clinic used to prove tenant isolation.', 'Mumbai', 'Maharashtra',
             '+91 90000 11111', 'b@example.com', 'Dr. B Tester', 'BPT',
             'trialing', 'done', NOW())`,
    [B.slug]
  )
  const clinicB = c.insertId

  const hash = await bcrypt.hash('bpatient123', 10)
  const mk = async (role, name, email) => {
    const [r] = await db.execute(
      `INSERT INTO users (clinic_id, name, email, password_hash, role, email_verified)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [clinicB, name, email, hash, role]
    )
    return r.insertId
  }
  const adminB = await mk('admin', 'B Admin', 'b.admin@example.com')
  const physioB = await mk('physio', 'B Physio', 'b.physio@example.com')
  const patientB = await mk('patient', 'B Patient', 'b.patient@example.com')

  await db.execute('UPDATE clinics SET owner_user_id = ? WHERE id = ?', [adminB, clinicB])

  const [[plan]] = await db.execute(
    "SELECT id, price_paise FROM plans WHERE code = 'professional' LIMIT 1"
  )
  await db.execute(
    `INSERT INTO subscriptions (clinic_id, plan_id, status, price_paise, trial_ends_at)
     VALUES (?, ?, 'trialing', ?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
    [clinicB, plan.id, plan.price_paise]
  )

  // Deliberately the SAME slug as one of clinic A's services.
  const [svc] = await db.execute(
    `INSERT INTO services (clinic_id, slug, name, short_description, price_paise, duration_minutes)
     VALUES (?, 'back-and-neck-pain', 'B Back Pain', 'Clinic B private service', 55500, 30)`,
    [clinicB]
  )

  const [appt] = await db.execute(
    `INSERT INTO appointments (clinic_id, code, patient_id, physio_id, service_id,
                               appointment_date, start_time, end_time, mode, status,
                               amount_paise, patient_notes)
     VALUES (?, 'APT-ISO001', ?, ?, ?, DATE_ADD(CURDATE(), INTERVAL 3 DAY),
             '11:00:00', '11:30:00', 'clinic', 'confirmed', 55500,
             'CLINIC B CONFIDENTIAL NOTE')`,
    [clinicB, patientB, physioB, svc.insertId]
  )

  return { clinicB, serviceB: svc.insertId, appointmentB: appt.insertId }
}

/* ------------------------------------------------------------ http --------- */

function makeSession() {
  const jar = new Map()
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  return {
    async req(origin, path, options = {}) {
      const res = await fetch(origin + path, {
        ...options,
        redirect: 'manual',
        headers: { cookie: cookieHeader(), ...(options.headers || {}) },
      })
      for (const line of res.headers.getSetCookie?.() || []) {
        const pair = line.split(';')[0]
        const i = pair.indexOf('=')
        jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
      }
      return res
    },
  }
}

async function signIn(session, origin, email, password) {
  const { csrfToken } = await (await session.req(origin, '/api/auth/csrf')).json()
  await session.req(origin, '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, email, password }).toString(),
  })
  return (await (await session.req(origin, '/api/auth/session')).json())?.user ?? null
}

/* ------------------------------------------------------------ tests -------- */

console.log('\nBuilding a second clinic…')
const ids = await buildClinicB()
console.log(`  clinic B id=${ids.clinicB}, appointment id=${ids.appointmentB}\n`)

console.log('TENANT RESOLUTION')
{
  const s = makeSession()
  const a = await (await s.req(A.origin, '/')).text()
  const b = await (await s.req(B.origin, '/')).text()
  check(a.includes('Aarogya Physiotherapy'), 'clinic A subdomain serves clinic A')
  check(b.includes('Isolation Test Clinic'), 'clinic B subdomain serves clinic B')
  check(!b.includes('Aarogya Physiotherapy'), 'clinic B page contains NO trace of clinic A')
  check(!a.includes('Isolation Test Clinic'), 'clinic A page contains NO trace of clinic B')

  const unknown = await s.req('http://nope.localhost:3000', '/')
  check(unknown.status === 404, 'an unknown subdomain 404s', `got ${unknown.status}`)
}

console.log('\nSAME SLUG, DIFFERENT CLINICS')
{
  const s = makeSession()
  const a = await (await s.req(A.origin, '/services/back-and-neck-pain')).text()
  const b = await (await s.req(B.origin, '/services/back-and-neck-pain')).text()
  check(
    a.includes('Back &amp; Neck Pain Relief') || a.includes('Back & Neck Pain Relief'),
    'clinic A gets ITS service at that slug'
  )
  check(b.includes('B Back Pain'), 'clinic B gets ITS OWN service at the same slug')
  check(!b.includes('₹800'), "clinic B does not show clinic A's price")
}

console.log('\nA SESSION FROM CLINIC A, PRESENTED TO CLINIC B')
{
  const s = makeSession()
  const user = await signIn(s, A.origin, 'patient@example.com', 'patient123')
  check(user?.clinicSlug === 'aarogya', 'signed in as a clinic A patient', `slug=${user?.clinicSlug}`)

  // The cookie IS sent to clinic B — that is precisely the risk being tested.
  const dash = await s.req(B.origin, '/dashboard')
  check(dash.status === 307, "clinic A's session cannot open clinic B's dashboard",
    `got ${dash.status} → ${dash.headers.get('location') ?? '-'}`)

  const appt = await s.req(B.origin, `/dashboard/appointments/${ids.appointmentB}`)
  check([307, 404].includes(appt.status), "cannot open clinic B's appointment", `got ${appt.status}`)

  const home = await (await s.req(B.origin, '/')).text()
  check(!home.includes('Rohan Deshpande'),
    "clinic B's public page does not render clinic A's signed-in user")
}

console.log('\nCLINIC A STAFF ATTACKING CLINIC B')
{
  const s = makeSession()
  await signIn(s, A.origin, 'admin@aarogyaphysio.in', 'admin123')

  for (const [path, label] of [
    ['/admin', "clinic A admin cannot open clinic B's admin panel"],
    ['/admin/patients', "cannot list clinic B's patients"],
    [`/admin/appointments/${ids.appointmentB}`, "cannot open clinic B's appointment record"],
  ]) {
    const res = await s.req(B.origin, path)
    check(res.status === 307, label, `got ${res.status}`)
  }
}

console.log('\nGUESSING IDs WITHIN YOUR OWN CLINIC')
{
  const s = makeSession()
  await signIn(s, A.origin, 'admin@aarogyaphysio.in', 'admin123')
  // Clinic B's appointment id, on clinic A's host, as clinic A's admin.
  const res = await s.req(A.origin, `/admin/appointments/${ids.appointmentB}`)
  const body = res.status === 200 ? await res.text() : ''
  check(res.status === 404 || !body.includes('CLINIC B CONFIDENTIAL'),
    "clinic A admin cannot read clinic B's appointment by id", `status ${res.status}`)
}

console.log('\nAPI ENDPOINTS')
{
  const s = makeSession()
  const slotsA = await (await s.req(A.origin, '/api/slots?days=7&mode=clinic')).json()
  const slotsB = await (await s.req(B.origin, '/api/slots?days=7&mode=clinic')).json()
  check(Array.isArray(slotsA.dates), 'clinic A slots API responds')
  const bOpen = (slotsB.dates || []).filter((d) => d.isOpen).length
  check(bOpen === 0, 'clinic B has no availability of its own', `${bOpen} open days`)

  await signIn(s, A.origin, 'patient@example.com', 'patient123')
  const booking = await s.req(B.origin, '/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serviceId: ids.serviceB, date: '2099-01-05', startTime: '11:00', mode: 'clinic',
    }),
  })
  check([401, 403].includes(booking.status),
    "clinic A's patient cannot book at clinic B", `got ${booking.status}`)
}

console.log('\nPER-CLINIC SEO')
{
  const s = makeSession()
  const a = await (await s.req(A.origin, '/sitemap.xml')).text()
  const b = await (await s.req(B.origin, '/sitemap.xml')).text()
  check(a.includes('aarogya.localhost') && !a.includes('isolationtest'),
    "clinic A's sitemap lists only clinic A URLs")
  check(b.includes('isolationtest.localhost') && !b.includes('aarogya'),
    "clinic B's sitemap lists only clinic B URLs")

  const robotsB = await (await s.req(B.origin, '/robots.txt')).text()
  check(robotsB.includes('isolationtest.localhost'),
    "clinic B's robots.txt points at its own sitemap")
}

console.log('\nTHE PLATFORM')
{
  const s = makeSession()
  const home = await s.req(PLATFORM, '/')
  const body = await home.text()
  check(home.status === 200, 'the platform homepage renders', `got ${home.status}`)
  check(body.includes(platform.name), 'it shows the platform brand, not a clinic')
  check(!body.includes('Aarogya'), 'it does not leak a customer clinic onto the marketing site')

  const pricing = await s.req(PLATFORM, '/pricing')
  check(pricing.status === 200, 'the pricing page renders', `got ${pricing.status}`)

  const anon = await s.req(PLATFORM, '/platform')
  check(anon.status === 307, 'the platform admin needs a login', `got ${anon.status}`)

  const s2 = makeSession()
  await signIn(s2, A.origin, 'admin@aarogyaphysio.in', 'admin123')
  const asClinic = await s2.req(PLATFORM, '/platform')
  check(asClinic.status === 307, 'a clinic admin is turned away from /platform',
    `got ${asClinic.status}`)

  const s3 = makeSession()
  const owner = await signIn(s3, PLATFORM, 'owner@physioflow.in', 'owner123')
  check(owner?.role === 'platform', 'the platform owner can sign in', `role=${owner?.role}`)
  const console_ = await s3.req(PLATFORM, '/platform')
  check(console_.status === 200, 'and reaches the console', `got ${console_.status}`)
  const onClinic = await s3.req(A.origin, '/platform')
  check(onClinic.status === 307, 'but /platform is not served from a clinic domain',
    `got ${onClinic.status}`)
}

console.log('\nCleaning up…')
await teardown()
console.log('  ✓ test clinic removed')

console.log(`\n${failures === 0 ? '✓ TENANT ISOLATION HOLDS' : `✗ ${failures} ISOLATION FAILURE(S)`}\n`)
await db.end()
process.exit(failures === 0 ? 0 : 1)
