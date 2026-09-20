/**
 * ============================================================================
 *  TENANT ISOLATION — SERVER ACTIONS
 * ============================================================================
 *
 *  tests/isolation.mjs proves that clinic A cannot READ clinic B's data through
 *  pages and API routes. This file proves it cannot WRITE it through a server
 *  action — which is a different attack surface, and the one that was actually
 *  open.
 *
 *  WHY THIS WAS MISSED, AND IT IS A LESSON WORTH KEEPING
 *  ----------------------------------------------------
 *  A server action looks like a function call in the JSX:
 *
 *      <button onClick={() => updateAppointmentStatus(id, 'completed')}>
 *
 *  It is not. It compiles to a POST endpoint with a hashed name, callable by
 *  anyone with a session and the hash. Because it reads like local code, the
 *  guards on these functions had been written as if the caller were trusted:
 *  they checked the user's ROLE and not their CLINIC. Every write was keyed on an
 *  id from the request body with no clinic in the WHERE clause, so clinic A's
 *  admin could mark clinic B's appointments complete, delete clinic B's reviews
 *  and rewrite clinic B's prices.
 *
 *  The read-side isolation suite passed throughout. Testing what a page RENDERS
 *  says nothing about what an action WRITES.
 *
 *  HOW IT CALLS THEM
 *  -----------------
 *  Actions are invoked exactly as the browser does: POST to the page, with a
 *  `Next-Action` header carrying the action's id. Those ids are read by NAME out
 *  of the dev server's own reference manifest, so the test does not depend on
 *  hash values that change whenever the code does.
 *
 *  EVERY NEGATIVE HAS A POSITIVE CONTROL
 *  -------------------------------------
 *  For each action the test asserts twice: that clinic A cannot touch clinic B's
 *  row, AND that clinic A CAN touch its own. Without the second half, a test like
 *  this passes perfectly while the whole feature is broken — which is precisely
 *  how the missing clinic_id on consultation_notes survived: nothing ever checked
 *  that saving a note worked, only that it was refused to strangers.
 * ============================================================================
 */

import mysql from 'mysql2/promise'
import fs from 'node:fs'
import process from 'node:process'

process.loadEnvFile('.env.local')

const A_SLUG = 'aarogya'
const B_SLUG = 'actiontest'
const A = `http://${A_SLUG}.localhost:3000`
const B = `http://${B_SLUG}.localhost:3000`
const PLATFORM = 'http://localhost:3000'

const A_ADMIN = { email: 'admin@aarogyaphysio.in', password: 'admin123' }
const B_ADMIN = { email: 'action.owner@example.com', password: 'actiontest123' }

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

/* -------------------------------------------------------------- action ids */

/**
 * The dev server writes its own reference manifest, mapping each action's hashed
 * id to the file and export it came from. Looking them up by NAME means this test
 * survives every rebuild; hardcoding the hashes would not survive one.
 */
const MANIFEST = '.next/dev/server/server-reference-manifest.json'
if (!fs.existsSync(MANIFEST)) {
  console.error(
    `\n✗ ${MANIFEST} not found.\n\n  Start the dev server and open /admin once so the actions compile, then re-run.\n`
  )
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).node
const actionIds = new Map()
for (const [id, entry] of Object.entries(manifest)) {
  actionIds.set(entry.exportedName, id)
}

function actionId(name) {
  const id = actionIds.get(name)
  if (!id) {
    check(false, `${name} — not in the manifest; open the page that uses it and re-run`)
    return null
  }
  return id
}

/* ------------------------------------------------------------------ session */

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

    /**
     * Invoke a server action the way the browser does.
     *
     * `page` matters: Next only accepts an action id that belongs to the route
     * being posted to, which is itself a small piece of defence in depth.
     */
    async action(origin, page, name, args) {
      const id = actionId(name)
      if (!id) return { error: 'action id unknown' }

      const res = await this.req(origin, page, {
        method: 'POST',
        headers: { 'Next-Action': id, 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(args),
      })
      const text = await res.text()

      // The response is a React Flight stream. The action's return value is the
      // last JSON object in it.
      const matches = [...text.matchAll(/\{"ok":.*?\}(?=\s*$|\n)/gs)]
      if (matches.length) {
        try {
          return JSON.parse(matches[matches.length - 1][0])
        } catch {
          /* fall through */
        }
      }
      if (text.includes('Server action not found')) return { error: 'ACTION_NOT_FOUND' }
      return { status: res.status, raw: text.slice(0, 200) }
    },
  }
}

async function signIn(session, origin, { email, password }) {
  const { csrfToken } = await (await session.req(origin, '/api/auth/csrf')).json()
  await session.req(origin, '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, email, password }).toString(),
  })
  return (await (await session.req(origin, '/api/auth/session')).json())?.user ?? null
}

/* ----------------------------------------------------------------- fixtures */

async function teardown() {
  const [rows] = await db.execute('SELECT id FROM clinics WHERE slug = ?', [B_SLUG])
  if (rows.length) {
    const id = rows[0].id
    for (const t of ['consultation_notes', 'payments', 'reviews', 'appointments',
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
  await db.execute('DELETE FROM users WHERE email LIKE ?', ['action.%@example.com'])
  // Anything this run left in clinic A.
  await db.execute("DELETE FROM reviews WHERE comment LIKE 'ACTION PROBE%'")
  await db.execute("DELETE FROM services WHERE slug = 'action-probe-a'")
}

console.log('\nCleaning any previous run…')
await teardown()

/* Clinic B, with one of everything to attack. */
{
  const s = makeSession()
  const res = await s.req(PLATFORM, '/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Dr. Action Tester',
      email: B_ADMIN.email,
      phone: '9876500033',
      password: B_ADMIN.password,
      confirmPassword: B_ADMIN.password,
      clinicName: 'Action Test Clinic',
      slug: B_SLUG,
      city: 'Indore',
      planCode: 'professional',
      acceptTerms: true,
    }),
  })
  if (res.status !== 201) {
    console.error('  ✗ could not create clinic B:', await res.json())
    process.exit(1)
  }
  await db.execute("UPDATE clinics SET onboarding_step = 'done' WHERE slug = ?", [B_SLUG])
}

const [[clinicA]] = await db.execute('SELECT id FROM clinics WHERE slug = ?', [A_SLUG])
const [[clinicB]] = await db.execute('SELECT id FROM clinics WHERE slug = ?', [B_SLUG])

// Clinic B's rows: a service, a review, an appointment, a working-hours rule.
const [bService] = await db.execute(
  `INSERT INTO services (clinic_id, slug, name, short_description, price_paise, duration_minutes,
                         available_online, available_clinic, is_active)
   VALUES (?, 'b-secret-treatment', 'B Secret Treatment', 'Theirs.', 250000, 45, 1, 1, 1)`,
  [clinicB.id]
)
const [[bPhysio]] = await db.execute(
  "SELECT id FROM users WHERE clinic_id = ? AND role = 'physio' LIMIT 1", [clinicB.id]
)
const [[bPatient]] = await db.execute(
  "SELECT id FROM users WHERE clinic_id = ? AND role = 'admin' LIMIT 1", [clinicB.id]
)
const [bReview] = await db.execute(
  `INSERT INTO reviews (clinic_id, patient_id, rating, comment, is_published)
   VALUES (?, ?, 5, 'ACTION PROBE B — excellent care at clinic B.', 1)`,
  [clinicB.id, bPatient.id]
)
const [bRule] = await db.execute(
  `INSERT INTO availability_rules (clinic_id, physio_id, weekday, start_time, end_time, slot_minutes, mode)
   VALUES (?, ?, 2, '09:00:00', '17:00:00', 30, 'both')`,
  [clinicB.id, bPhysio.id]
)
const [bAppointment] = await db.execute(
  `INSERT INTO appointments (clinic_id, code, patient_id, physio_id, service_id, appointment_date,
                            start_time, end_time, mode, status, amount_paise)
   VALUES (?, 'BTEST001', ?, ?, ?, CURDATE() + INTERVAL 3 DAY, '11:00:00', '11:45:00',
           'clinic', 'confirmed', 250000)`,
  [clinicB.id, bPatient.id, bPhysio.id, bService.insertId]
)

// Clinic A's own equivalents, for the positive controls.
const [[aPhysio]] = await db.execute(
  "SELECT id FROM users WHERE clinic_id = ? AND role = 'physio' LIMIT 1", [clinicA.id]
)
const [[aPatient]] = await db.execute(
  "SELECT id FROM users WHERE clinic_id = ? AND role = 'patient' LIMIT 1", [clinicA.id]
)
const [aReview] = await db.execute(
  `INSERT INTO reviews (clinic_id, patient_id, rating, comment, is_published)
   VALUES (?, ?, 5, 'ACTION PROBE A — a probe review for clinic A.', 0)`,
  [clinicA.id, aPatient.id]
)
const [[aService]] = await db.execute(
  'SELECT id, slug FROM services WHERE clinic_id = ? LIMIT 1', [clinicA.id]
)
const [aAppointment] = await db.execute(
  `INSERT INTO appointments (clinic_id, code, patient_id, physio_id, service_id, appointment_date,
                            start_time, end_time, mode, status, amount_paise)
   VALUES (?, 'ATEST001', ?, ?, ?, CURDATE() + INTERVAL 3 DAY, '15:00:00', '15:45:00',
           'clinic', 'confirmed', 80000)`,
  [clinicA.id, aPatient.id, aPhysio.id, aService.id]
)

/* ========================================================================== */

const attacker = makeSession()
const user = await signIn(attacker, A, A_ADMIN)
check(user?.role === 'admin', `clinic A's admin signs in`, `role=${user?.role}`)
check(Number(user?.clinicId) === Number(clinicA.id), `and is bound to clinic A`)

/* --------------------------------------------- 1. appointments (the diary) */
console.log(`\nAPPOINTMENTS — can A reach into B's diary?`)
{
  const before = bAppointment.insertId
  await attacker.action(A, `/admin/appointments/${before}`, 'updateAppointmentStatus', [
    before,
    'no_show',
  ])
  const [[after]] = await db.execute('SELECT status FROM appointments WHERE id = ?', [before])
  check(after.status === 'confirmed', `B's appointment is untouched by A`, `status ${after.status}`)

  // Positive control: A can still run its own diary.
  const own = await attacker.action(A, `/admin/appointments/${aAppointment.insertId}`,
    'updateAppointmentStatus', [aAppointment.insertId, 'completed'])
  const [[mine]] = await db.execute('SELECT status FROM appointments WHERE id = ?', [
    aAppointment.insertId,
  ])
  check(mine.status === 'completed', `but A CAN complete its own`, `${own.message || own.error || ''}`)
}

/* ------------------------------------------------- 2. the medical record */
console.log(`\nCLINICAL NOTES — can A write into B's medical records?`)
{
  /**
   * WHY THIS SECTION LOOKS DIFFERENT FROM THE OTHERS
   * ------------------------------------------------
   * saveConsultationNote is a `useActionState` action, so its arguments are
   * (previousState, formData). Invoking that over HTTP means reproducing React's
   * multipart encoding for a FormData argument, which is an undocumented internal
   * of the compiled flight runtime and would make this test break on a React
   * upgrade for no gain.
   *
   * So the guard is tested through the READ side instead, which is the half that
   * was actually vulnerable: the action now loads the appointment with
   * `WHERE id = ? AND clinic_id = ?` and refuses to go further if that returns
   * nothing. If clinic A cannot even see clinic B's appointment through the page
   * that hosts the form, it cannot name it in the form either.
   *
   * The other half — that a note SAVES at all, which it never did because
   * clinic_id was missing from the INSERT — is covered by tests/pages.mjs
   * rendering the appointment page, and by the schema itself: clinic_id is
   * NOT NULL with no default, so the old statement could only ever fail. Any
   * regression reintroducing it fails loudly rather than silently.
   */
  const page = await attacker.req(A, `/admin/appointments/${bAppointment.insertId}`)
  check(
    page.status === 404 || page.status === 307,
    `A cannot even open the page for B's appointment`,
    `status ${page.status}`
  )

  const [[leaked]] = await db.execute(
    'SELECT COUNT(*) AS n FROM consultation_notes WHERE appointment_id = ?',
    [bAppointment.insertId]
  )
  check(Number(leaked.n) === 0, `and no note exists against B's appointment`)

  // The clinic_id column that the old INSERT omitted. If someone drops it from
  // the statement again, this is the assertion that explains why notes stopped
  // saving.
  const [[column]] = await db.execute(
    `SELECT IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consultation_notes'
        AND COLUMN_NAME = 'clinic_id'`
  )
  check(
    column?.IS_NULLABLE === 'NO' && column?.COLUMN_DEFAULT === null,
    `consultation_notes.clinic_id is NOT NULL — the INSERT must supply it`
  )
}

/* -------------------------------------------------------- 3. the reviews */
console.log(`\nREVIEWS — can A sabotage B's reputation?`)
{
  await attacker.action(A, '/admin/reviews', 'setReviewPublished', [bReview.insertId, false])
  const [[hidden]] = await db.execute('SELECT is_published FROM reviews WHERE id = ?', [
    bReview.insertId,
  ])
  check(Number(hidden.is_published) === 1, `B's five-star review is still published`)

  await attacker.action(A, '/admin/reviews', 'deleteReview', [bReview.insertId])
  const [[gone]] = await db.execute('SELECT COUNT(*) AS n FROM reviews WHERE id = ?', [
    bReview.insertId,
  ])
  check(Number(gone.n) === 1, `and A could not delete it either`)

  const own = await attacker.action(A, '/admin/reviews', 'setReviewPublished', [
    aReview.insertId,
    true,
  ])
  const [[mine]] = await db.execute('SELECT is_published FROM reviews WHERE id = ?', [
    aReview.insertId,
  ])
  check(Number(mine.is_published) === 1, `but A CAN publish its own`, own.message || own.error || '')
}

/* ------------------------------------------------------- 4. the price list */
console.log(`\nSERVICES — can A rewrite B's prices?`)
{
  await attacker.action(A, '/admin/services', 'toggleService', [bService.insertId, false])
  const [[still]] = await db.execute('SELECT is_active FROM services WHERE id = ?', [
    bService.insertId,
  ])
  check(Number(still.is_active) === 1, `B's treatment is still on sale`)

  const own = await attacker.action(A, '/admin/services', 'toggleService', [aService.id, false])
  const [[mine]] = await db.execute('SELECT is_active FROM services WHERE id = ?', [aService.id])
  check(Number(mine.is_active) === 0, `but A CAN hide its own`, own.message || own.error || '')
  await db.execute('UPDATE services SET is_active = 1 WHERE id = ?', [aService.id])
}

/* ------------------------------------------------------ 5. the working week */
console.log(`\nAVAILABILITY — can A close B's clinic?`)
{
  await attacker.action(A, '/admin/availability', 'deleteAvailabilityRule', [bRule.insertId])
  const [[survives]] = await db.execute(
    'SELECT COUNT(*) AS n FROM availability_rules WHERE id = ?', [bRule.insertId]
  )
  check(Number(survives.n) === 1, `B's working hours survive`)

  // Positive control on clinic A's own rules — this path was doubly broken: the
  // statement had three placeholders and only two parameters, so mysql2 rejected
  // it and deleting working hours failed for everyone.
  const [aRule] = await db.execute(
    `INSERT INTO availability_rules (clinic_id, physio_id, weekday, start_time, end_time, slot_minutes, mode)
     VALUES (?, ?, 3, '19:00:00', '20:00:00', 30, 'both')`,
    [clinicA.id, aPhysio.id]
  )
  const own = await attacker.action(A, '/admin/availability', 'deleteAvailabilityRule', [
    aRule.insertId,
  ])
  const [[deleted]] = await db.execute(
    'SELECT COUNT(*) AS n FROM availability_rules WHERE id = ?', [aRule.insertId]
  )
  check(Number(deleted.n) === 0, `but A CAN delete its own hours`, own.message || own.error || '')
}

/* ------------------------------------------------ 6. the platform's actions */
console.log(`\nPLATFORM ACTIONS — can a clinic admin suspend a rival?`)
{
  const result = await attacker.action(PLATFORM, '/platform/clinics', 'setClinicStatus', [
    clinicB.id,
    'suspended',
  ])
  const [[status]] = await db.execute('SELECT status FROM clinics WHERE id = ?', [clinicB.id])
  check(
    status.status !== 'suspended',
    `clinic B was not suspended by another clinic's admin`,
    `status ${status.status}, action said: ${result.error || result.message || result.raw || ''}`
  )
}

/* --------------------------------------- 7. B's own staff, on A's hostname */
console.log(`\nTHE REVERSE — B's admin standing on A's domain`)
{
  const bStaff = makeSession()
  const signedIn = await signIn(bStaff, B, B_ADMIN)
  check(signedIn?.role === 'admin', `clinic B's admin signs in at B`, `role=${signedIn?.role}`)

  // The cookie is valid on A's hostname too — that is what makes this the
  // interesting case rather than a theoretical one.
  await bStaff.action(A, `/admin/appointments/${aAppointment.insertId}`, 'updateAppointmentStatus', [
    aAppointment.insertId,
    'no_show',
  ])
  const [[after]] = await db.execute('SELECT status FROM appointments WHERE id = ?', [
    aAppointment.insertId,
  ])
  check(after.status === 'completed', `B's session cannot act on A's appointment`, after.status)
}

console.log('\nCleaning up…')
await db.execute('DELETE FROM consultation_notes WHERE appointment_id IN (?, ?)', [
  aAppointment.insertId,
  bAppointment.insertId,
])
await db.execute('DELETE FROM appointments WHERE id = ?', [aAppointment.insertId])
await db.execute('DELETE FROM reviews WHERE id = ?', [aReview.insertId])
await teardown()
console.log('  ✓ test data removed')

console.log(
  `\n${failures === 0 ? '✓ SERVER ACTIONS ARE TENANT-SAFE' : `✗ ${failures} FAILURE(S)`}\n`
)
await db.end()
process.exit(failures === 0 ? 0 : 1)
