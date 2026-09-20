/**
 * ============================================================================
 *  SMOKE TEST: does every page actually render?
 * ============================================================================
 *
 *  Signs in as each role and requests every page that role can reach, asserting
 *  a 200 and no error markup in the response.
 *
 *  WHY THIS EXISTS — AND IT IS NOT A NICE-TO-HAVE
 *  ---------------------------------------------
 *  Turning this app multi-tenant changed the signature of ~24 query functions to
 *  take `clinicId` first. Four call sites were missed. Every one of them was a
 *  page that threw the moment it was opened:
 *
 *      getAllServices()   → /admin/services      crashed
 *      getAdminStats()    → /admin/payments      crashed
 *      createOrder({...}) → every booking        502
 *      register           → no patient could sign up
 *
 *  None was caught by `next build`, because a page that compiles can still throw
 *  at request time. None was caught by lint, because passing too few arguments to
 *  a JavaScript function is legal. And none was caught by the end-to-end suites,
 *  because those drive the flows they were written for and nothing else.
 *
 *  A crawl is the cheapest possible net for that: it does not know what a page is
 *  supposed to say, only that opening it does not fall over. Most bugs of this
 *  kind are not subtle, they are just unnoticed.
 *
 *  THE COMPANION CHECK
 *  -------------------
 *  tests/scoping.mjs greps for the same mistake statically, and will find it in a
 *  page nobody thought to list here. The two are complementary: one proves the
 *  pages work, the other proves the pattern is followed.
 * ============================================================================
 */

import mysql from 'mysql2/promise'
import process from 'node:process'

process.loadEnvFile('.env.local')

const PLATFORM = 'http://localhost:3000'
const SLUG = process.env.TEST_CLINIC_SLUG || 'aarogya'
const CLINIC = `http://${SLUG}.localhost:3000`

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

/**
 * Request a page and decide whether it really rendered.
 *
 * A 200 is not enough on its own. Next.js serves its error overlay with a 200 in
 * development, so a page that threw halfway through still looks fine to anything
 * only reading the status line. The body has to be checked too.
 */
async function renders(session, origin, path) {
  const res = await session.req(origin, path)
  const body = await res.text()

  if (res.status !== 200) {
    return { ok: false, why: `status ${res.status}${res.headers.get('location') ? ` → ${res.headers.get('location')}` : ''}` }
  }

  const markers = [
    'Runtime TypeError',
    'Runtime Error',
    'Unhandled Runtime Error',
    'Internal Server Error',
    'Bind parameters must not contain undefined',
    'is not a function',
    'Cannot read properties of undefined',
  ]
  const hit = markers.find((marker) => body.includes(marker))
  if (hit) return { ok: false, why: `error in the page: “${hit}”` }

  // A page that renders its shell and nothing else is usually a swallowed throw.
  if (body.length < 1000) return { ok: false, why: `suspiciously short (${body.length} bytes)` }

  return { ok: true }
}

async function crawl(label, session, origin, paths) {
  console.log(`\n${label}`)
  for (const path of paths) {
    const result = await renders(session, origin, path)
    check(result.ok, path, result.why || '')
  }
}

/* ========================================================================== */

const [[clinic]] = await db.execute('SELECT id FROM clinics WHERE slug = ?', [SLUG])
if (!clinic) {
  console.error(`\n✗ No clinic with slug "${SLUG}". Run npm run db:setup first.\n`)
  process.exit(1)
}

const [[patient]] = await db.execute(
  "SELECT id FROM users WHERE clinic_id = ? AND role = 'patient' ORDER BY id LIMIT 1", [clinic.id]
)
const [[service]] = await db.execute(
  'SELECT id, slug FROM services WHERE clinic_id = ? AND available_online = 1 LIMIT 1', [clinic.id]
)

/**
 * An appointment to open the detail pages on.
 *
 * Booked through the real endpoints rather than INSERTed, because the detail
 * pages join across appointments, services, payments and consultation_notes, and
 * a hand-written row is exactly the kind of half-populated record that makes a
 * page pass here and fail in production.
 *
 * The first run of this crawl silently skipped three pages — the admin
 * appointment detail, the patient's own view of it and the consultation room —
 * because the demo database happened to contain no appointments at all. A test
 * that quietly covers less than it appears to is worse than one that fails.
 */
let appointment = null
const patientSession = makeSession()
await signIn(patientSession, CLINIC, 'patient@example.com', 'patient123')

if (service) {
  /**
   * Find a day that genuinely HAS a slot, rather than the first open one.
   *
   * Run this after the clinic's closing time and today is "open" but has nothing
   * left, so the booking silently fails and three detail pages go uncovered while
   * the suite still reports success. The same assumption had already been fixed
   * in signup-journey.mjs and email-journey.mjs — it is worth grepping for.
   */
  const dates = await (await patientSession.req(CLINIC, '/api/slots?days=21&mode=online')).json()
  let firstOpen = null
  let slots = { slots: [] }

  for (const day of (dates.dates || []).filter((d) => d.isOpen)) {
    const found = await (
      await patientSession.req(
        CLINIC,
        `/api/slots?serviceId=${service.id}&date=${day.date}&mode=online`
      )
    ).json()
    if (found.slots?.length) {
      firstOpen = day
      slots = found
      break
    }
  }

  if (firstOpen) {
    {
      const held = await (
        await patientSession.req(CLINIC, '/api/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceId: service.id,
            date: firstOpen.date,
            startTime: slots.slots[0].startTime,
            mode: 'online',
          }),
        })
      ).json()

      if (held.appointment) {
        await patientSession.req(CLINIC, '/api/payments/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointmentId: held.appointment.id,
            razorpay_order_id: held.order.id,
            razorpay_payment_id: 'pay_demo_crawl',
            razorpay_signature: 'demo',
          }),
        })
        appointment = held.appointment
      }
    }
  }
}

check(Boolean(appointment), 'a test appointment was booked, so the detail pages are covered')

/* -------------------------------------------------------- the public site */
{
  const guest = makeSession()
  await crawl('PUBLIC — the clinic website', guest, CLINIC, [
    '/',
    '/services',
    ...(service ? [`/services/${service.slug}`] : []),
    '/about',
    '/contact',
    '/privacy',
    '/terms',
    '/login',
    '/register',
    '/forgot-password',
    // A dead token on purpose: the page must say so rather than throw.
    '/reset-password?token=0000000000000000000000000000000000000000000000000000000000000000',
    '/book',
  ])

  await crawl('PUBLIC — the platform website', guest, PLATFORM, [
    '/',
    '/pricing',
    '/signup',
  ])
}

/* ----------------------------------------------------------- clinic admin */
{
  const admin = makeSession()
  const user = await signIn(admin, CLINIC, 'admin@aarogyaphysio.in', 'admin123')
  check(user?.role === 'admin', 'the clinic admin signs in', `role=${user?.role}`)

  await crawl('SIGNED IN AS THE CLINIC ADMIN', admin, CLINIC, [
    '/admin',
    '/admin/appointments',
    ...(appointment ? [`/admin/appointments/${appointment.id}`] : []),
    '/admin/patients',
    ...(patient ? [`/admin/patients/${patient.id}`] : []),
    '/admin/availability',
    '/admin/services',
    '/admin/payments',
    '/admin/reviews',
    '/admin/appointments/new',
    '/admin/packages',
    '/admin/recalls',
    '/admin/onboarding',
    '/admin/billing',
    '/admin/settings/team',
    '/admin/settings/payments',
    '/admin/settings/branding',
    '/admin/settings/whatsapp',
    '/admin/settings/policies',
    '/admin/settings/data',
    '/admin/settings/account',
  ])
}

/* --------------------------------------------------------- the physio role */
{
  const physio = makeSession()
  const user = await signIn(physio, CLINIC, 'doctor@aarogyaphysio.in', 'doctor123')
  check(user?.role === 'physio', 'the physiotherapist signs in', `role=${user?.role}`)

  await crawl('SIGNED IN AS A PHYSIOTHERAPIST', physio, CLINIC, [
    '/admin',
    '/admin/appointments',
    '/admin/patients',
    '/admin/availability',
    '/admin/services',
    '/admin/reviews',
    '/admin/recalls',
    '/admin/packages',
    '/admin/appointments/new',
    // Not adminOnly: every physiotherapist has to be able to change the temporary
    // password their clinic owner typed for them.
    '/admin/settings/account',
  ])

  /**
   * ------------------------------------------------------------------------
   *  THE PAGES A PHYSIOTHERAPIST MUST *NOT* REACH
   * ------------------------------------------------------------------------
   *  Every one below is marked adminOnly in app/admin/layout.js, so the link is
   *  filtered out of their sidebar. That gates NOTHING — the URL is guessable, and
   *  typing it is not hacking.
   *
   *  This block exists because /admin/settings/data shipped without the check and
   *  nothing noticed. It rendered for a physiotherapist, showing how many patients
   *  and clinical notes the clinic holds, with download buttons that only failed
   *  once pressed. The data itself was safe — /api/export/clinic refused with a
   *  403 — but the page should never have drawn at all.
   *
   *  Asserting the redirect, rather than the absence of a link, is the whole point.
   */
  for (const path of [
    '/admin/billing',
    '/admin/settings/team',
    '/admin/settings/payments',
    '/admin/settings/branding',
    '/admin/settings/whatsapp',
    '/admin/settings/policies',
    '/admin/settings/data',
  ]) {
    const res = await physio.req(CLINIC, path)
    check(res.status === 307, `a physiotherapist is turned away from ${path}`, `got ${res.status}`)
  }
}

/* ------------------------------------------------------------- the patient */
{
  const user = await (await patientSession.req(CLINIC, '/api/auth/session')).json()
  check(user?.user?.role === 'patient', 'the patient signs in', `role=${user?.user?.role}`)

  await crawl('SIGNED IN AS A PATIENT', patientSession, CLINIC, [
    '/dashboard',
    '/dashboard/appointments',
    ...(appointment ? [`/dashboard/appointments/${appointment.id}`] : []),
    '/dashboard/exercises',
    '/dashboard/profile',
    '/book',
    // The video room. Renders a waiting state when the appointment is not due
    // yet, which is the state it will be in here.
    ...(appointment ? [`/consult/${appointment.id}`] : []),
  ])
}

/* ------------------------------------------------------ the platform owner */
{
  const boss = makeSession()
  const user = await signIn(boss, PLATFORM, 'owner@physioflow.in', 'owner123')
  check(user?.role === 'platform', 'the platform owner signs in', `role=${user?.role}`)

  await crawl('SIGNED IN AS THE PLATFORM OWNER', boss, PLATFORM, [
    '/platform',
    '/platform/clinics',
    '/platform/revenue',
    '/platform/plans',
    '/platform/errors',
    '/platform/account',
  ])

  // Kokli's own legal pages. Razorpay's KYC review and Meta's business
  // verification both open these, so a 500 here is not cosmetic.
  await crawl('KOKLI\'S OWN LEGAL PAGES', makeSession(), PLATFORM, [
    '/legal/terms',
    '/legal/privacy',
    '/legal/refunds',
    '/legal/contact',
  ])
}

/* ------------------------------------------------------- machine endpoints */
{
  const guest = makeSession()
  console.log('\nMACHINE-READABLE')
  for (const [origin, path, needle] of [
    [CLINIC, '/sitemap.xml', '<urlset'],
    [CLINIC, '/robots.txt', 'Sitemap'],
    [CLINIC, '/opengraph-image', null],
  ]) {
    const res = await guest.req(origin, path)
    const body = needle ? await res.text() : ''
    check(res.status === 200, path, `status ${res.status}`)
    if (needle) check(body.includes(needle), `  …looks like ${path.split('.').pop()}`)
  }
}

/* --------------------------------------------------------------- clean up */
// The booking above is real, and leaving it behind would block that slot and
// quietly change the numbers on the admin dashboard for whoever looks next.
if (appointment) {
  await db.execute('DELETE FROM consultation_notes WHERE appointment_id = ?', [appointment.id])
  await db.execute('DELETE FROM payments WHERE appointment_id = ?', [appointment.id])
  await db.execute('DELETE FROM appointments WHERE id = ?', [appointment.id])
  console.log('\n  ✓ test appointment removed')
}

console.log(`\n${failures === 0 ? '✓ EVERY PAGE RENDERS' : `✗ ${failures} FAILURE(S)`}\n`)
await db.end()
process.exit(failures === 0 ? 0 : 1)
