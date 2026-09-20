/**
 * END-TO-END: a physiotherapist signs up and gets a working clinic.
 *
 * Drives the real HTTP endpoints in the same order a browser would, then checks
 * the resulting clinic is genuinely live — its own subdomain, its own treatments,
 * its own bookable slots.
 */

import mysql from 'mysql2/promise'
import process from 'node:process'

process.loadEnvFile('.env.local')

const PLATFORM = 'http://localhost:3000'
const SLUG = 'journeytest'
const CLINIC = `http://${SLUG}.localhost:3000`
const OWNER_EMAIL = 'journey.owner@example.com'
const PASSWORD = 'journey123'

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

async function teardown() {
  const [rows] = await db.execute('SELECT id FROM clinics WHERE slug = ?', [SLUG])
  if (rows.length) {
    const id = rows[0].id
    for (const t of ['consultation_notes', 'payments', 'reviews', 'appointments',
                     'availability_rules', 'time_off', 'services', 'subscriptions']) {
      await db.execute(`DELETE FROM ${t} WHERE clinic_id = ?`, [id])
    }
    await db.execute('UPDATE clinics SET owner_user_id = NULL WHERE id = ?', [id])
    await db.execute('DELETE FROM patient_profiles WHERE user_id IN (SELECT id FROM users WHERE clinic_id = ?)', [id])
    await db.execute('DELETE FROM users WHERE clinic_id = ?', [id])
    await db.execute('DELETE FROM clinics WHERE id = ?', [id])
  }
  await db.execute('DELETE FROM users WHERE email = ?', [OWNER_EMAIL])
}

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

/** Server actions are invoked by posting a form to the page with Next-Action. */
async function callAction(session, origin, path, actionId, formData) {
  return session.req(origin, path, {
    method: 'POST',
    headers: { 'Next-Action': actionId },
    body: formData,
  })
}

console.log('\nCleaning any previous run…')
await teardown()

/* ------------------------------------------------------------ 1. availability */
console.log('\nSLUG AVAILABILITY')
{
  const s = makeSession()
  const free = await (await s.req(PLATFORM, `/api/signup?slug=${SLUG}`)).json()
  check(free.available === true, 'a fresh slug is reported available')

  const taken = await (await s.req(PLATFORM, '/api/signup?slug=aarogya')).json()
  check(taken.available === false, 'an existing slug is reported taken')

  const reserved = await (await s.req(PLATFORM, '/api/signup?slug=admin')).json()
  check(reserved.available === false, 'a reserved slug is refused', reserved.reason ?? '')

  const bad = await (await s.req(PLATFORM, '/api/signup?slug=ab')).json()
  check(bad.available === false, 'a too-short slug is refused', bad.reason ?? '')
}

/* ------------------------------------------------------------------ 2. signup */
console.log('\nSIGNUP')
let signupData
{
  const s = makeSession()
  const res = await s.req(PLATFORM, '/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Dr. Journey Tester',
      email: OWNER_EMAIL,
      phone: '9876543210',
      password: PASSWORD,
      confirmPassword: PASSWORD,
      clinicName: 'Journey Test Clinic',
      slug: SLUG,
      city: 'Mumbai',
      planCode: 'professional',
      acceptTerms: true,
    }),
  })
  signupData = await res.json()
  check(res.status === 201, 'signup succeeds', `status ${res.status} ${signupData.error ?? ''}`)
  check(signupData.slug === SLUG, 'it returns the clinic slug')

  // Duplicate slug must be refused, and say WHICH field is wrong.
  const dup = await s.req(PLATFORM, '/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Someone Else', email: 'other@example.com', password: PASSWORD,
      confirmPassword: PASSWORD, clinicName: 'Copycat', slug: SLUG, acceptTerms: true,
    }),
  })
  const dupData = await dup.json()
  check(dup.status === 409, 'a duplicate slug is rejected', `status ${dup.status}`)
  check(Boolean(dupData.errors?.slug), 'and the error is attached to the slug field')
}

/* ----------------------------------------------------- 3. what got created */
console.log('\nWHAT THE TRANSACTION CREATED')
{
  const [[clinic]] = await db.execute('SELECT * FROM clinics WHERE slug = ?', [SLUG])
  check(Boolean(clinic), 'the clinic row exists')
  check(clinic?.status === 'trialing', 'it starts on a trial', clinic?.status)
  check(clinic?.onboarding_step === 'details', 'onboarding starts at step 1', clinic?.onboarding_step)
  check(Boolean(clinic?.owner_user_id), 'the owner is linked back to the clinic')

  const [users] = await db.execute(
    'SELECT role FROM users WHERE clinic_id = ? ORDER BY role', [clinic.id]
  )
  const roles = users.map((u) => u.role)
  check(roles.includes('admin'), 'an admin account was created')
  check(roles.includes('physio'), 'a physio account was created so the diary works')

  const [[sub]] = await db.execute(
    'SELECT s.status, p.code FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.clinic_id = ?',
    [clinic.id]
  )
  check(sub?.status === 'trialing', 'a trial subscription exists', sub?.status)
  check(sub?.code === 'professional', 'on the plan that was chosen', sub?.code)
}

/* -------------------------------------------------------- 4. the new site */
console.log('\nTHE NEW CLINIC IS LIVE')
{
  const s = makeSession()
  const res = await s.req(CLINIC, '/')
  const body = await res.text()
  check(res.status === 200, 'its subdomain responds', `status ${res.status}`)
  check(body.includes('Journey Test Clinic'), 'the homepage shows the new clinic name')
  check(!body.includes('Aarogya'), 'with no trace of any other clinic')
}

/* ------------------------------------------------- 5. owner is sent to setup */
console.log('\nTHE OWNER IS SENT TO ONBOARDING')
{
  const s = makeSession()
  const user = await signIn(s, CLINIC, OWNER_EMAIL, PASSWORD)
  check(user?.role === 'admin', 'the owner can sign in at their clinic', `role=${user?.role}`)
  check(user?.clinicSlug === SLUG, 'and their session is bound to it', user?.clinicSlug)

  const dash = await s.req(CLINIC, '/admin')
  check(
    dash.status === 307 && (dash.headers.get('location') || '').includes('/admin/onboarding'),
    'the dashboard redirects to the setup wizard',
    `${dash.status} → ${dash.headers.get('location') ?? '-'}`
  )

  const wizard = await s.req(CLINIC, '/admin/onboarding')
  check(wizard.status === 200, 'the wizard itself renders', `status ${wizard.status}`)
}

/* ------------------------------------ 6. finish setup, straight in the DB */
console.log('\nAFTER SETUP, THE CLINIC TAKES BOOKINGS')
{
  const [[clinic]] = await db.execute('SELECT * FROM clinics WHERE slug = ?', [SLUG])
  const [[physio]] = await db.execute(
    "SELECT id FROM users WHERE clinic_id = ? AND role = 'physio'", [clinic.id]
  )

  // Simulate the wizard's writes: one treatment, and a working week.
  const [svc] = await db.execute(
    `INSERT INTO services (clinic_id, slug, name, short_description, price_paise, duration_minutes,
                           available_online, available_clinic)
     VALUES (?, 'initial-assessment', 'Initial Assessment',
             'A full first visit to work out what is wrong.', 90000, 45, 1, 1)`,
    [clinic.id]
  )
  for (let weekday = 1; weekday <= 6; weekday++) {
    await db.execute(
      `INSERT INTO availability_rules (clinic_id, physio_id, weekday, start_time, end_time, slot_minutes, mode)
       VALUES (?, ?, ?, '09:00:00', '18:00:00', 30, 'both')`,
      [clinic.id, physio.id, weekday]
    )
  }
  await db.execute("UPDATE clinics SET onboarding_step = 'done' WHERE id = ?", [clinic.id])

  const s = makeSession()

  const services = await (await s.req(CLINIC, '/services')).text()
  check(services.includes('Initial Assessment'), 'the treatment appears on the public site')

  const dates = await (await s.req(CLINIC, '/api/slots?days=7&mode=clinic')).json()
  const openDays = (dates.dates || []).filter((d) => d.isOpen).length
  check(openDays > 0, 'the clinic now has bookable days', `${openDays} open in 7`)

  /**
   * Look for a day with slots rather than assuming the FIRST open day has any.
   *
   * The original version checked only the first open day and passed for months,
   * until it was run at four in the afternoon: the clinic closes at six, a
   * 45-minute treatment needs an hour's notice, and today genuinely had nothing
   * left. The app was right and the test was wrong — but it failed as if the
   * booking engine were broken, which is the most expensive kind of false alarm.
   */
  let firstBookable = null
  for (const day of (dates.dates || []).filter((d) => d.isOpen)) {
    const response = await s.req(
      CLINIC,
      `/api/slots?serviceId=${svc.insertId}&date=${day.date}&mode=clinic`
    )
    const found = (await response.json()).slots || []
    if (found.length > 0) {
      firstBookable = { date: day.date, slots: found }
      break
    }
  }

  check(
    firstBookable !== null,
    'and real slots on a working day',
    firstBookable
      ? `${firstBookable.slots.length} on ${firstBookable.date}`
      : 'no day in the next 7 had a free slot'
  )

  const sitemap = await (await s.req(CLINIC, '/sitemap.xml')).text()
  check(sitemap.includes(`${SLUG}.localhost`) && sitemap.includes('initial-assessment'),
    'its sitemap lists its own treatment page')

  // And the owner now lands on a real dashboard rather than the wizard.
  const owner = makeSession()
  await signIn(owner, CLINIC, OWNER_EMAIL, PASSWORD)
  const dash = await owner.req(CLINIC, '/admin')
  check(dash.status === 200, 'the owner now reaches the real dashboard', `status ${dash.status}`)
}

console.log('\nCleaning up…')
await teardown()
console.log('  ✓ test clinic removed')

console.log(`\n${failures === 0 ? '✓ SIGNUP JOURNEY WORKS' : `✗ ${failures} FAILURE(S)`}\n`)
await db.end()
process.exit(failures === 0 ? 0 : 1)
