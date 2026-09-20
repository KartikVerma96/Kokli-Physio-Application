/**
 * ============================================================================
 *  END-TO-END: how the clinic actually earns
 * ============================================================================
 *
 *  Covers the two things the application could not represent, both of which
 *  capped what a physiotherapy clinic could bill through it:
 *
 *    PACKAGES     Physiotherapy is a course, not a visit. A frozen shoulder is
 *                 eight to twelve sessions. Selling single appointments capped
 *                 revenue per patient at roughly an eighth of the real figure.
 *
 *    DESK MONEY   Most Indian physio patients telephone or walk in and pay cash
 *                 or UPI at reception. None of that could be recorded, so the
 *                 revenue figure on the admin dashboard showed only the online
 *                 minority — a number that was not incomplete but WRONG.
 *
 *  WHAT IT ASSERTS, IN ORDER OF WHAT IT WOULD COST TO GET WRONG
 *  -----------------------------------------------------------
 *    1. A package session cannot be spent twice, even under a race.
 *    2. A package cannot be spent on the wrong treatment, after it expires, or
 *       by a different patient.
 *    3. A cancelled session RETURNS to the balance.
 *    4. Package money is counted once — when the package is sold, not again when
 *       each session is used.
 *    5. Cash taken at the desk reaches the revenue figure.
 * ============================================================================
 */

import mysql from 'mysql2/promise'
import fs from 'node:fs'
import process from 'node:process'

process.loadEnvFile('.env.local')

const PLATFORM = 'http://localhost:3000'
const SLUG = 'revtest'
const CLINIC = `http://${SLUG}.localhost:3000`
const OWNER = { email: 'rev.owner@example.com', password: 'revtest123' }
const PATIENT = { email: 'rev.patient@example.com', password: 'revtest123' }

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

/* ------------------------------------------------------------- action ids */

const MANIFEST = '.next/dev/server/server-reference-manifest.json'
const manifest = fs.existsSync(MANIFEST)
  ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).node
  : {}
const actionIds = new Map(Object.entries(manifest).map(([id, e]) => [e.exportedName, id]))

/* ---------------------------------------------------------------- session */

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
    json(origin, path, body) {
      return this.req(origin, path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    },
    /** Invoke a server action the way the browser does. */
    async action(origin, page, name, args) {
      const id = actionIds.get(name)
      if (!id) return { error: `action ${name} not compiled yet` }
      const res = await this.req(origin, page, {
        method: 'POST',
        headers: { 'Next-Action': id, 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(args),
      })
      const text = await res.text()
      const matches = [...text.matchAll(/\{"ok":.*?\}(?=\s*$|\n)/gs)]
      if (matches.length) {
        try {
          return JSON.parse(matches[matches.length - 1][0])
        } catch {
          /* fall through */
        }
      }
      return { raw: text.slice(0, 200) }
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

/**
 * The first day that genuinely has a free slot for this treatment.
 *
 * NOT "the first open day". Run the suite at four in the afternoon and today is
 * open but past its last bookable time, and every slot assertion in the file
 * explodes as though booking were broken. Two older suites had the same hidden
 * assumption and failed the same way.
 */
async function findBookableDay(session, serviceId, mode = 'clinic', { fromEnd = false } = {}) {
  const dates = await (await session.req(CLINIC, `/api/slots?days=21&mode=${mode}`)).json()
  const open = (dates.dates || []).filter((d) => d.isOpen)
  const order = fromEnd ? [...open].reverse() : open

  for (const day of order) {
    const found =
      (
        await (
          await session.req(
            CLINIC,
            `/api/slots?serviceId=${serviceId}&date=${day.date}&mode=${mode}`
          )
        ).json()
      ).slots || []
    if (found.length) return { date: day.date, slots: found }
  }
  return null
}

async function teardown() {
  const [rows] = await db.execute('SELECT id FROM clinics WHERE slug = ?', [SLUG])
  if (rows.length) {
    const id = rows[0].id
    // patient_packages before payments: payments references it with RESTRICT.
    await db.execute('DELETE FROM payments WHERE clinic_id = ?', [id])
    for (const t of ['consultation_notes', 'appointments', 'patient_packages', 'packages',
                     'reviews', 'availability_rules', 'time_off', 'services',
                     'platform_invoices', 'subscriptions']) {
      await db.execute(`DELETE FROM ${t} WHERE clinic_id = ?`, [id])
    }
    await db.execute('UPDATE clinics SET owner_user_id = NULL WHERE id = ?', [id])
    await db.execute(
      'DELETE FROM patient_profiles WHERE user_id IN (SELECT id FROM users WHERE clinic_id = ?)', [id]
    )
    await db.execute('DELETE FROM users WHERE clinic_id = ?', [id])
    await db.execute('DELETE FROM clinics WHERE id = ?', [id])
  }
  await db.execute('DELETE FROM users WHERE email LIKE ?', ['rev.%@example.com'])
}

console.log('\nCleaning any previous run…')
await teardown()

/* ========================================================================== */
/*  A CLINIC, A TREATMENT, A WORKING WEEK, A PATIENT                          */
/* ========================================================================== */
{
  const s = makeSession()
  const res = await s.json(PLATFORM, '/api/signup', {
    name: 'Dr. Revenue Tester',
    email: OWNER.email,
    phone: '9876500044',
    password: OWNER.password,
    confirmPassword: OWNER.password,
    clinicName: 'Revenue Test Clinic',
    slug: SLUG,
    city: 'Nashik',
    planCode: 'professional',
    acceptTerms: true,
  })
  if (res.status !== 201) {
    console.error('  ✗ could not create the clinic:', await res.json())
    process.exit(1)
  }
  await db.execute("UPDATE clinics SET onboarding_step = 'done' WHERE slug = ?", [SLUG])
}

const [[clinic]] = await db.execute('SELECT * FROM clinics WHERE slug = ?', [SLUG])
const [[physio]] = await db.execute(
  "SELECT id FROM users WHERE clinic_id = ? AND role = 'physio' LIMIT 1", [clinic.id]
)

// ₹800 a visit, and a ten-session package at ₹6,000 — the standard shape.
const VISIT = 80_000
const PACKAGE_PRICE = 600_000

const [service] = await db.execute(
  `INSERT INTO services (clinic_id, slug, name, short_description, price_paise, duration_minutes,
                         available_online, available_clinic, is_active)
   VALUES (?, 'shoulder-rehab', 'Shoulder Rehab', 'A course of rehabilitation.', ?, 30, 1, 1, 1)`,
  [clinic.id, VISIT]
)
const [other] = await db.execute(
  `INSERT INTO services (clinic_id, slug, name, short_description, price_paise, duration_minutes,
                         available_online, available_clinic, is_active)
   VALUES (?, 'sports-massage', 'Sports Massage', 'Something else entirely.', 50000, 30, 0, 1, 1)`,
  [clinic.id]
)
for (let weekday = 0; weekday <= 6; weekday++) {
  await db.execute(
    `INSERT INTO availability_rules (clinic_id, physio_id, weekday, start_time, end_time, slot_minutes, mode)
     VALUES (?, ?, ?, '09:00:00', '18:00:00', 30, 'both')`,
    [clinic.id, physio.id, weekday]
  )
}

const patientSession = makeSession()
await patientSession.json(CLINIC, '/api/register', {
  name: 'Anil Deshmukh',
  email: PATIENT.email,
  phone: '9812300011',
  password: PATIENT.password,
  confirmPassword: PATIENT.password,
  acceptTerms: true,
})
const patientUser = await signIn(patientSession, CLINIC, PATIENT)
const patientId = Number(patientUser?.id)

const admin = makeSession()
await signIn(admin, CLINIC, OWNER)

/* Warm the pages so their actions land in the dev manifest. */
for (const path of ['/admin/packages', `/admin/patients/${patientId}`, '/admin/appointments/new']) {
  await admin.req(CLINIC, path)
}
Object.entries(
  JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).node
).forEach(([id, e]) => actionIds.set(e.exportedName, id))

/* ========================================================================== */
/*  1. THE CLINIC DEFINES A PACKAGE                                           */
/* ========================================================================== */
console.log('\nDEFINING A PACKAGE')
let packageId
{
  const saved = await admin.action(CLINIC, '/admin/packages', 'savePackage', [
    {
      name: 'Shoulder Rehab — 10 sessions',
      serviceId: String(service.insertId),
      sessionsCount: '10',
      priceRupees: String(PACKAGE_PRICE / 100),
      validityDays: '90',
      isActive: true,
    },
  ])
  check(saved.ok === true, 'savePackage succeeds', saved.error || saved.raw || '')

  const [[pkg]] = await db.execute(
    'SELECT * FROM packages WHERE clinic_id = ? ORDER BY id DESC LIMIT 1', [clinic.id]
  )
  check(Boolean(pkg), 'the package is created')
  check(Number(pkg?.sessions_count) === 10, '  …with ten sessions', `${pkg?.sessions_count}`)
  check(Number(pkg?.price_paise) === PACKAGE_PRICE, '  …at ₹6,000', `${pkg?.price_paise}`)
  packageId = pkg?.id

  // ₹6,000 against ₹8,000 paid visit by visit: a fifth off, paid up front.
  check(
    Number(pkg?.price_paise) < VISIT * 10,
    '  …cheaper than ten single visits, which is the whole point'
  )
}

/* ========================================================================== */
/*  2. SOLD AT THE DESK, FOR CASH                                             */
/* ========================================================================== */
console.log('\nSELLING IT FOR CASH')
let patientPackageId
{
  const sold = await admin.action(CLINIC, `/admin/patients/${patientId}`, 'sellPackage', [
    {
      patientId: String(patientId),
      packageId: String(packageId),
      method: 'cash',
      reference: 'Receipt 4471',
      discountRupees: '0',
    },
  ])
  check(sold.ok === true, 'sellPackage succeeds', sold.error || sold.raw || '')

  const [[bought]] = await db.execute(
    'SELECT * FROM patient_packages WHERE clinic_id = ? ORDER BY id DESC LIMIT 1', [clinic.id]
  )
  check(Boolean(bought), 'the patient now holds the package')
  check(Number(bought?.sessions_total) === 10, '  …ten sessions', `${bought?.sessions_total}`)
  check(Boolean(bought?.expires_at), '  …with an expiry date')
  patientPackageId = bought?.id

  const [[payment]] = await db.execute(
    'SELECT * FROM payments WHERE patient_package_id = ?', [patientPackageId]
  )
  check(Boolean(payment), 'the cash is recorded as a payment')
  check(payment?.method === 'cash', '  …as cash', payment?.method)
  check(Number(payment?.amount_paise) === PACKAGE_PRICE, '  …for the full ₹6,000')
  check(Boolean(payment?.collected_by), '  …against the name of whoever took it')
  check(payment?.appointment_id === null, '  …and belongs to the package, not a visit')
}

/* ========================================================================== */
/*  3. THE PATIENT SPENDS SESSIONS                                            */
/* ========================================================================== */
console.log('\nSPENDING SESSIONS')
{
  /**
   * Booked well ahead on purpose.
   *
   * This block asserts that CANCELLING returns the session to the balance, and
   * that is only true outside the clinic's notice window — a late cancellation
   * now forfeits it, which is the point of the policy. Booking the soonest
   * available slot made this a late cancellation and the assertion was quietly
   * testing the opposite of what it said.
   */
  const first = await findBookableDay(patientSession, service.insertId, 'clinic', { fromEnd: true })
  check(first !== null, 'there is a bookable slot to spend a session on')

  const booked = await patientSession.json(CLINIC, '/api/appointments', {
    serviceId: service.insertId,
    date: first.date,
    startTime: first.slots[0].startTime,
    mode: 'clinic',
    patientPackageId,
  })
  const bookedData = await booked.json()

  check(booked.status === 201, 'a session is booked from the package', `status ${booked.status}`)
  check(bookedData.paidFromPackage === true, '  …and the browser is told there is nothing to pay')
  check(!bookedData.order, '  …with no payment order created')

  const [[appointment]] = await db.execute(
    'SELECT * FROM appointments WHERE id = ?', [bookedData.appointment.id]
  )
  check(appointment.status === 'confirmed', '  …confirmed immediately, not held', appointment.status)
  check(appointment.hold_expires_at === null, '  …and it cannot expire')
  check(
    Number(appointment.amount_paise) === 0,
    '  …charged ₹0, because the money came with the package',
    `${appointment.amount_paise}`
  )
  check(
    Number(appointment.patient_package_id) === Number(patientPackageId),
    '  …linked to the package it came from'
  )

  /* ------------------------------------------------- the balance is derived */
  const [[used]] = await db.execute(
    `SELECT COUNT(*) AS n FROM appointments
      WHERE patient_package_id = ?
        AND (status <> 'cancelled' OR package_session_forfeited = 1)`,
    [patientPackageId]
  )
  check(Number(used.n) === 1, 'one of ten sessions is used', `${used.n}`)

  /* --------------------------------- a cancelled session comes BACK */
  const cancel = await patientSession.req(
    CLINIC,
    `/api/appointments/${bookedData.appointment.id}/cancel`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Changed my mind' }),
    }
  )
  check(cancel.status === 200, 'the session is cancelled', `status ${cancel.status}`)

  const [[afterCancel]] = await db.execute(
    `SELECT COUNT(*) AS n FROM appointments
      WHERE patient_package_id = ?
        AND (status <> 'cancelled' OR package_session_forfeited = 1)`,
    [patientPackageId]
  )
  check(
    Number(afterCancel.n) === 0,
    'cancelling in good time returns the session — it is COUNTED, not decremented',
    `${afterCancel.n} used`
  )
}

/* ========================================================================== */
/*  4. WHAT A PACKAGE CANNOT DO                                               */
/* ========================================================================== */
console.log('\nWHAT A PACKAGE CANNOT BE SPENT ON')
{
  const otherDay = await findBookableDay(patientSession, other.insertId)
  const day = { date: otherDay.date }
  const slots = { slots: otherDay.slots }

  // A different treatment. The package names Shoulder Rehab.
  const wrongService = await patientSession.json(CLINIC, '/api/appointments', {
    serviceId: other.insertId,
    date: day.date,
    startTime: slots.slots[0].startTime,
    mode: 'clinic',
    patientPackageId,
  })
  check(wrongService.status >= 400, 'not on a treatment it does not cover', `status ${wrongService.status}`)

  // Somebody else's package.
  const [outsider] = await db.execute(
    `INSERT INTO users (clinic_id, name, email, phone, role, email_verified, is_active)
     VALUES (?, 'Other Patient', 'rev.other@example.com', '9812300099', 'patient', 1, 1)`,
    [clinic.id]
  )
  await db.execute('INSERT INTO patient_profiles (user_id) VALUES (?)', [outsider.insertId])
  const [theirs] = await db.execute(
    `INSERT INTO patient_packages
       (clinic_id, patient_id, package_id, name, service_id, sessions_total, price_paise, status)
     VALUES (?, ?, ?, 'Theirs', ?, 10, ?, 'active')`,
    [clinic.id, outsider.insertId, packageId, service.insertId, PACKAGE_PRICE]
  )
  const stolen = await patientSession.json(CLINIC, '/api/appointments', {
    serviceId: service.insertId,
    date: day.date,
    startTime: slots.slots[0].startTime,
    mode: 'clinic',
    patientPackageId: theirs.insertId,
  })
  check(stolen.status >= 400, 'not somebody else’s package', `status ${stolen.status}`)

  // An expired one.
  await db.execute(
    'UPDATE patient_packages SET expires_at = DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE id = ?',
    [patientPackageId]
  )
  const expired = await patientSession.json(CLINIC, '/api/appointments', {
    serviceId: service.insertId,
    date: day.date,
    startTime: slots.slots[0].startTime,
    mode: 'clinic',
    patientPackageId,
  })
  check(expired.status >= 400, 'not after it has expired', `status ${expired.status}`)
  await db.execute(
    'UPDATE patient_packages SET expires_at = DATE_ADD(CURDATE(), INTERVAL 60 DAY) WHERE id = ?',
    [patientPackageId]
  )
}

/* ========================================================================== */
/*  5. THE LAST SESSION CANNOT BE SPENT TWICE                                 */
/* ========================================================================== */
console.log('\nTHE LAST SESSION, UNDER A RACE')
{
  // Wind the package down to one session left by filling nine directly.
  const [[svc]] = await db.execute('SELECT id FROM services WHERE id = ?', [service.insertId])
  for (let i = 0; i < 9; i++) {
    await db.execute(
      `INSERT INTO appointments (clinic_id, code, patient_id, physio_id, service_id,
                                patient_package_id, appointment_date, start_time, end_time,
                                mode, status, amount_paise)
       VALUES (?, ?, ?, ?, ?, ?, DATE_SUB(CURDATE(), INTERVAL ? DAY), '10:00:00', '10:30:00',
               'clinic', 'completed', 0)`,
      [clinic.id, `FILL${i}${Date.now() % 1000}`, patientId, physio.id, svc.id, patientPackageId, i + 1]
    )
  }

  const [[before]] = await db.execute(
    `SELECT COUNT(*) AS n FROM appointments
      WHERE patient_package_id = ?
        AND (status <> 'cancelled' OR package_session_forfeited = 1)`,
    [patientPackageId]
  )
  check(Number(before.n) === 9, 'nine of ten used, one left', `${before.n}`)

  // Two DIFFERENT free slots, requested simultaneously, both against the last
  // session. Different slots on purpose: if they clashed, the slot lock would
  // reject one and prove nothing about the package.
  // A day well into the future, so the whole working day is still free. Picking
  // "the first open day" can land on today, where the minimum-notice rule has
  // already eaten most of the slots — and a race test needs two of them.
  // A day well into the future, so the whole working day is still free — a race
  // test needs two slots.
  const raceDay = await findBookableDay(patientSession, service.insertId, 'clinic', { fromEnd: true })
  const day = { date: raceDay.date }
  const slots = raceDay.slots

  check(slots.length >= 2, 'two free slots exist to race for', `${slots.length} free`)

  const attempt = (slot) =>
    patientSession.json(CLINIC, '/api/appointments', {
      serviceId: service.insertId,
      date: day.date,
      startTime: slot.startTime,
      mode: 'clinic',
      patientPackageId,
    })

  const [a, b] = await Promise.all([attempt(slots[0]), attempt(slots[1])])
  const statuses = [a.status, b.status].sort()

  const [[after]] = await db.execute(
    `SELECT COUNT(*) AS n FROM appointments
      WHERE patient_package_id = ?
        AND (status <> 'cancelled' OR package_session_forfeited = 1)`,
    [patientPackageId]
  )
  check(
    Number(after.n) === 10,
    'exactly ten sessions used — the eleventh was refused',
    `${after.n} used, statuses ${statuses.join(' & ')}`
  )
  check(statuses[0] === 201 && statuses[1] >= 400, 'one booking succeeded, one was turned away')
}

/* ========================================================================== */
/*  6. THE MONEY IS COUNTED ONCE                                              */
/* ========================================================================== */
console.log('\nTHE REVENUE FIGURE')
{
  const [[revenue]] = await db.execute(
    `SELECT COALESCE(SUM(amount_paise - refunded_paise), 0) AS total
       FROM payments WHERE clinic_id = ? AND status IN ('paid', 'refunded')`,
    [clinic.id]
  )

  check(
    Number(revenue.total) === PACKAGE_PRICE,
    'ten sessions delivered, ₹6,000 counted — not ₹6,000 plus ten visits',
    `₹${Number(revenue.total) / 100}`
  )

  const [[zeroed]] = await db.execute(
    `SELECT COUNT(*) AS n FROM appointments
      WHERE patient_package_id IS NOT NULL AND amount_paise <> 0 AND clinic_id = ?`,
    [clinic.id]
  )
  check(Number(zeroed.n) === 0, 'every package session is charged ₹0, so nothing double-counts')

  /* ------------------------------------- and now a plain cash walk-in */
  const [walkIn] = await db.execute(
    `INSERT INTO appointments (clinic_id, code, patient_id, physio_id, service_id,
                              appointment_date, start_time, end_time, mode, status, amount_paise)
     VALUES (?, 'WALKIN01', ?, ?, ?, CURDATE(), '17:00:00', '17:30:00', 'clinic', 'completed', ?)`,
    [clinic.id, patientId, physio.id, service.insertId, VISIT]
  )

  /**
   * Open the page first.
   *
   * Next only accepts an action id that belongs to the route being posted to, and
   * in development a route's actions are not registered until that route has been
   * compiled. Without this GET the POST comes back "Server action not found" —
   * which looks like a broken action and is really a cold dev server.
   */
  await admin.req(CLINIC, `/admin/appointments/${walkIn.insertId}`)
  Object.entries(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).node).forEach(([id, e]) =>
    actionIds.set(e.exportedName, id)
  )

  const args = [{ appointmentId: String(walkIn.insertId), method: 'upi', reference: 'UPI 88231' }]
  const took = await admin.action(
    CLINIC, `/admin/appointments/${walkIn.insertId}`, 'recordAppointmentPayment', args
  )
  check(took.ok === true, 'the desk payment is accepted', took.error || took.raw || '')

  const [[cash]] = await db.execute(
    'SELECT * FROM payments WHERE appointment_id = ?', [walkIn.insertId]
  )
  check(Boolean(cash), 'a walk-in paying at the desk is recorded')
  check(cash?.method === 'upi', '  …by the method they actually used', cash?.method)

  const [[after]] = await db.execute(
    `SELECT COALESCE(SUM(amount_paise - refunded_paise), 0) AS total
       FROM payments WHERE clinic_id = ? AND status IN ('paid', 'refunded')`,
    [clinic.id]
  )
  check(
    Number(after.total) === PACKAGE_PRICE + VISIT,
    'and it reaches the revenue figure',
    `₹${Number(after.total) / 100}`
  )

  // Taking it twice must be refused.
  const again = await admin.action(
    CLINIC, `/admin/appointments/${walkIn.insertId}`, 'recordAppointmentPayment', args
  )
  check(again.ok === false, 'a second attempt is refused outright', again.error || '')
  const [paidRows] = await db.execute(
    'SELECT id FROM payments WHERE appointment_id = ?', [walkIn.insertId]
  )
  check(paidRows.length === 1, 'and cannot be taken twice', `${paidRows.length} payment rows`)
}

/* ========================================================================== */
/*  6b. RECEPTION BOOKS A WALK-IN AND TAKES CASH                              */
/* ========================================================================== */
console.log('\nRECEPTION BOOKS SOMEBODY WHO TELEPHONED')
{
  // A patient with no email address at all — the case the online-only flow could
  // not represent, and the commonest one at an Indian physiotherapy desk.
  const made = await admin.action(CLINIC, '/admin/appointments/new', 'createDeskPatient', [
    { name: 'Sunita Kale', phone: '9822011223', email: '' },
  ])
  check(made.ok === true, 'a walk-in with no email can be registered', made.error || made.raw || '')

  const [[created]] = await db.execute(
    "SELECT id, email, password_hash FROM users WHERE clinic_id = ? AND name = 'Sunita Kale'",
    [clinic.id]
  )
  check(Boolean(created), '  …and is on file')
  check(
    String(created?.email).endsWith('.invalid'),
    '  …with a placeholder address that can never receive mail',
    created?.email
  )
  check(created?.password_hash === null, '  …and no password, so they cannot sign in')

  // The same phone again must find them rather than duplicate them.
  const dup = await admin.action(CLINIC, '/admin/appointments/new', 'createDeskPatient', [
    { name: 'Sunita Kale', phone: '9822011223', email: '' },
  ])
  check(dup.existing === true, 'booking them a second time reuses the same record')

  /* --------------------------------------------------- book and take cash */
  const deskDay = await findBookableDay(admin, service.insertId, 'clinic', { fromEnd: true })
  const day = { date: deskDay.date }
  const slots = deskDay.slots

  const booked = await admin.action(CLINIC, '/admin/appointments/new', 'createDeskAppointment', [
    {
      patientId: String(created.id),
      serviceId: String(service.insertId),
      date: day.date,
      startTime: slots[0].startTime,
      mode: 'clinic',
      settlement: 'now',
      method: 'cash',
      reference: 'Receipt 4472',
      patientNotes: 'Referred by Dr. Rao — lower back',
    },
  ])
  check(booked.ok === true, 'reception books them and takes cash', booked.error || booked.raw || '')

  const [[appointment]] = await db.execute(
    'SELECT * FROM appointments WHERE id = ?', [booked.appointmentId]
  )
  check(appointment?.status === 'confirmed', '  …confirmed, not held', appointment?.status)
  check(
    appointment?.hold_expires_at === null,
    '  …so it cannot expire while the patient is standing there'
  )
  check(Boolean(appointment?.booked_by), '  …recording who took the booking')
  check(
    Number(appointment?.amount_paise) === VISIT,
    '  …charged the treatment price from the database',
    `${appointment?.amount_paise}`
  )

  const [[cash]] = await db.execute(
    'SELECT * FROM payments WHERE appointment_id = ?', [booked.appointmentId]
  )
  check(cash?.method === 'cash', 'the cash is recorded against the appointment', cash?.method)
  check(cash?.reference === 'Receipt 4472', '  …with the receipt number')

  /* ------------------------------------------- pay-at-the-clinic booking */
  const later = await admin.action(CLINIC, '/admin/appointments/new', 'createDeskAppointment', [
    {
      patientId: String(created.id),
      serviceId: String(service.insertId),
      date: day.date,
      startTime: slots[1].startTime,
      mode: 'clinic',
      settlement: 'later',
    },
  ])
  check(later.ok === true, 'and can book one to be paid on the way out', later.error || '')

  const [[unpaid]] = await db.execute(
    `SELECT a.status, (SELECT COUNT(*) FROM payments p WHERE p.appointment_id = a.id) AS payments
       FROM appointments a WHERE a.id = ?`,
    [later.appointmentId]
  )
  check(unpaid?.status === 'confirmed', '  …confirmed even though nothing is paid', unpaid?.status)
  check(Number(unpaid?.payments) === 0, '  …and shows as outstanding until it is collected')
}

/* ========================================================================== */
/*  7. WHAT THE CLINIC OWNER SEES                                             */
/* ========================================================================== */
console.log('\nTHE ADMIN SCREENS')
{
  for (const [path, needle] of [
    ['/admin/packages', 'Shoulder Rehab'],
    [`/admin/patients/${patientId}`, 'Packages'],
    ['/admin/appointments/new', 'Who is it for'],
    ['/admin/payments', 'Payments'],
  ]) {
    const res = await admin.req(CLINIC, path)
    const body = res.status === 200 ? (await res.text()).replaceAll('<!-- -->', '') : ''
    check(res.status === 200 && body.includes(needle), `${path} shows “${needle}”`, `status ${res.status}`)
  }
}

console.log('\nCleaning up…')
await teardown()
console.log('  ✓ test clinic removed')

console.log(`\n${failures === 0 ? '✓ THE REVENUE MODEL WORKS' : `✗ ${failures} FAILURE(S)`}\n`)
await db.end()
process.exit(failures === 0 ? 0 : 1)
