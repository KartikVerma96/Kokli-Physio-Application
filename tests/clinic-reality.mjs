/**
 * ============================================================================
 *  END-TO-END: the four ways the diary did not match a real clinic
 * ============================================================================
 *
 *  1. PARALLEL PATIENTS  The diary assumed one patient per therapist per slot.
 *                        A physiotherapy clinic runs two to four at once — one on
 *                        traction, one under ultrasound, one doing hands-on work.
 *                        Assuming 1:1 under-books a busy clinic by two or three
 *                        times, and the fix had to keep the database-level
 *                        guarantee that stops double-booking.
 *
 *  2. HOME VISITS        Two to three times the clinic rate, and the only option
 *                        for post-surgical and elderly patients. `mode` could not
 *                        express it.
 *
 *  3. NO-SHOWS           15–25% of appointments. The status existed and nothing
 *                        financial followed.
 *
 *  4. RECALL             `follow_up_date` was written by the physiotherapist and
 *                        never read by anything.
 *
 *  THE ASSERTION THAT MATTERS MOST
 *  -------------------------------
 *  Capacity 3 must allow exactly three patients at 10:00 and refuse the fourth,
 *  under a race — and capacity 1 must behave exactly as it always did. Getting the
 *  first right by breaking the second would mean every existing clinic silently
 *  starts double-booking.
 * ============================================================================
 */

import mysql from 'mysql2/promise'
import fs from 'node:fs'
import process from 'node:process'

process.loadEnvFile('.env.local')

const PLATFORM = 'http://localhost:3000'
const SLUG = 'realtest'
const CLINIC = `http://${SLUG}.localhost:3000`
const OWNER = { email: 'real.owner@example.com', password: 'realtest123' }
const PATIENT = { email: 'real.patient@example.com', password: 'realtest123' }

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

const MANIFEST = '.next/dev/server/server-reference-manifest.json'
const actionIds = new Map()
function loadActionIds() {
  if (!fs.existsSync(MANIFEST)) return
  for (const [id, entry] of Object.entries(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).node)) {
    actionIds.set(entry.exportedName, id)
  }
}
loadActionIds()

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
    async action(origin, page, name, args) {
      const id = actionIds.get(name)
      if (!id) return { error: `action ${name} not compiled` }
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
      return { raw: text.slice(0, 160) }
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

/** The first day with a free slot — never "the first open day". See tests/revenue.mjs. */
async function findBookableDay(session, serviceId, mode = 'clinic', { fromEnd = false } = {}) {
  const dates = await (await session.req(CLINIC, `/api/slots?days=21&mode=${mode}`)).json()
  const open = (dates.dates || []).filter((d) => d.isOpen)
  for (const day of fromEnd ? [...open].reverse() : open) {
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
  await db.execute('DELETE FROM users WHERE email LIKE ?', ['real.%@example.com'])
}

console.log('\nCleaning any previous run…')
await teardown()

/* ========================================================================== */
/*  SET UP                                                                    */
/* ========================================================================== */
{
  const s = makeSession()
  const res = await s.json(PLATFORM, '/api/signup', {
    name: 'Dr. Reality Tester',
    email: OWNER.email,
    phone: '9876500055',
    password: OWNER.password,
    confirmPassword: OWNER.password,
    clinicName: 'Reality Test Clinic',
    slug: SLUG,
    city: 'Aurangabad',
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

const VISIT = 80_000
const HOME = 150_000

// One treatment offered in the clinic AND at home, at a different price.
const [service] = await db.execute(
  `INSERT INTO services (clinic_id, slug, name, short_description, price_paise, home_price_paise,
                         duration_minutes, available_online, available_clinic, available_home, is_active)
   VALUES (?, 'back-pain', 'Back Pain Treatment', 'Hands-on treatment.', ?, ?, 30, 0, 1, 1, 1)`,
  [clinic.id, VISIT, HOME]
)

const patientSession = makeSession()
await patientSession.json(CLINIC, '/api/register', {
  name: 'Vikram Joshi',
  email: PATIENT.email,
  phone: '9812311122',
  password: PATIENT.password,
  confirmPassword: PATIENT.password,
  acceptTerms: true,
})
const patientUser = await signIn(patientSession, CLINIC, PATIENT)
const patientId = Number(patientUser?.id)

const admin = makeSession()
await signIn(admin, CLINIC, OWNER)

/* ========================================================================== */
/*  1. CAPACITY 1 — NOTHING CHANGES FOR AN EXISTING CLINIC                    */
/* ========================================================================== */
console.log('\nCAPACITY 1 — the old behaviour, unchanged')
{
  for (let weekday = 0; weekday <= 6; weekday++) {
    await db.execute(
      `INSERT INTO availability_rules
         (clinic_id, physio_id, weekday, start_time, end_time, slot_minutes, capacity, mode)
       VALUES (?, ?, ?, '09:00:00', '18:00:00', 30, 1, 'clinic')`,
      [clinic.id, physio.id, weekday]
    )
  }

  const day = await findBookableDay(patientSession, service.insertId, 'clinic', { fromEnd: true })
  check(day !== null, 'the clinic has bookable slots')

  const slot = day.slots[0]
  check(slot.placesLeft === 1, 'a slot reports one place', `${slot.placesLeft}`)

  const book = (session) =>
    session.json(CLINIC, '/api/appointments', {
      serviceId: service.insertId,
      date: day.date,
      startTime: slot.startTime,
      mode: 'clinic',
    })

  const first = await book(patientSession)
  check(first.status === 201, 'the first patient books', `status ${first.status}`)

  // A second patient at the same time must still be refused.
  const other = makeSession()
  await other.json(CLINIC, '/api/register', {
    name: 'Second Patient',
    email: 'real.second@example.com',
    phone: '9812311133',
    password: PATIENT.password,
    confirmPassword: PATIENT.password,
    acceptTerms: true,
  })
  await signIn(other, CLINIC, { email: 'real.second@example.com', password: PATIENT.password })

  const second = await book(other)
  check(second.status === 409, 'the second is refused — no silent double-booking', `status ${second.status}`)

  await db.execute("DELETE FROM payments WHERE clinic_id = ?", [clinic.id])
  await db.execute('DELETE FROM appointments WHERE clinic_id = ?', [clinic.id])
}

/* ========================================================================== */
/*  2. CAPACITY 3 — THREE AT ONCE, AND NOT FOUR                               */
/* ========================================================================== */
console.log('\nCAPACITY 3 — three patients in one slot')
{
  await db.execute('UPDATE availability_rules SET capacity = 3 WHERE clinic_id = ?', [clinic.id])

  const day = await findBookableDay(patientSession, service.insertId, 'clinic', { fromEnd: true })
  const slot = day.slots[0]
  check(slot.placesLeft === 3, 'the slot now reports three places', `${slot.placesLeft}`)

  // Four patients, all racing for the same 10:00. Three should get in.
  const sessions = [patientSession]
  for (let i = 0; i < 3; i++) {
    const s = makeSession()
    const email = `real.p${i}@example.com`
    await s.json(CLINIC, '/api/register', {
      name: `Parallel Patient ${i}`,
      email,
      phone: `981231120${i}`,
      password: PATIENT.password,
      confirmPassword: PATIENT.password,
      acceptTerms: true,
    })
    await signIn(s, CLINIC, { email, password: PATIENT.password })
    sessions.push(s)
  }

  const results = await Promise.all(
    sessions.map((s) =>
      s.json(CLINIC, '/api/appointments', {
        serviceId: service.insertId,
        date: day.date,
        startTime: slot.startTime,
        mode: 'clinic',
      })
    )
  )
  const codes = results.map((r) => r.status).sort()
  const booked = codes.filter((c) => c === 201).length

  check(booked === 3, 'exactly three got in, the fourth was refused', `statuses ${codes.join(',')}`)

  /* --------------------------------------- the seats are what makes it safe */
  const [seats] = await db.execute(
    `SELECT slot_seat FROM appointments
      WHERE clinic_id = ? AND appointment_date = ? AND start_time = ?
        AND status <> 'cancelled'
      ORDER BY slot_seat`,
    [clinic.id, day.date, slot.startTime]
  )
  check(
    seats.map((s) => Number(s.slot_seat)).join(',') === '0,1,2',
    'they hold seats 0, 1 and 2 — which is what the unique index enforces',
    seats.map((s) => s.slot_seat).join(',')
  )

  // And the slot is now full.
  const after = (
    await (
      await patientSession.req(
        CLINIC,
        `/api/slots?serviceId=${service.insertId}&date=${day.date}&mode=clinic`
      )
    ).json()
  ).slots
  const stillThere = after.find((s) => s.startTime === slot.startTime)
  check(!stillThere, 'a full slot disappears from the list')

  /* ------------------------- cancelling frees a seat, and it is REUSED */
  const [[toCancel]] = await db.execute(
    `SELECT id FROM appointments
      WHERE clinic_id = ? AND appointment_date = ? AND start_time = ? AND slot_seat = 1`,
    [clinic.id, day.date, slot.startTime]
  )
  await db.execute("UPDATE appointments SET status = 'cancelled' WHERE id = ?", [toCancel.id])

  const reopened = (
    await (
      await patientSession.req(
        CLINIC,
        `/api/slots?serviceId=${service.insertId}&date=${day.date}&mode=clinic`
      )
    ).json()
  ).slots
  const back = reopened.find((s) => s.startTime === slot.startTime)
  check(Boolean(back) && back.placesLeft === 1, 'a cancellation reopens one place', `${back?.placesLeft}`)

  const refill = makeSession()
  await refill.json(CLINIC, '/api/register', {
    name: 'Refill Patient',
    email: 'real.refill@example.com',
    phone: '9812311144',
    password: PATIENT.password,
    confirmPassword: PATIENT.password,
    acceptTerms: true,
  })
  await signIn(refill, CLINIC, { email: 'real.refill@example.com', password: PATIENT.password })

  const retaken = await refill.json(CLINIC, '/api/appointments', {
    serviceId: service.insertId,
    date: day.date,
    startTime: slot.startTime,
    mode: 'clinic',
  })
  check(retaken.status === 201, 'and somebody else can take it', `status ${retaken.status}`)

  const [[reused]] = await db.execute(
    'SELECT slot_seat FROM appointments WHERE id = ?', [(await retaken.json()).appointment.id]
  )
  check(
    Number(reused.slot_seat) === 1,
    'reusing the freed seat 1, not inventing seat 3',
    `seat ${reused.slot_seat}`
  )

  await db.execute('DELETE FROM payments WHERE clinic_id = ?', [clinic.id])
  await db.execute('DELETE FROM appointments WHERE clinic_id = ?', [clinic.id])
  await db.execute('UPDATE availability_rules SET capacity = 1 WHERE clinic_id = ?', [clinic.id])
}

/* ========================================================================== */
/*  3. HOME VISITS                                                            */
/* ========================================================================== */
console.log('\nHOME VISITS')
{
  // No home window yet, so there should be nothing bookable.
  const none = await (
    await patientSession.req(CLINIC, '/api/slots?days=7&mode=home')
  ).json()
  check(
    (none.dates || []).every((d) => !d.isOpen),
    'with no home-visit hours set, no day is open for one'
  )

  // A morning of home visits, separate from clinic hours because the therapist is
  // out of the building.
  for (let weekday = 0; weekday <= 6; weekday++) {
    await db.execute(
      `INSERT INTO availability_rules
         (clinic_id, physio_id, weekday, start_time, end_time, slot_minutes, capacity, mode)
       VALUES (?, ?, ?, '07:00:00', '09:00:00', 30, 1, 'home')`,
      [clinic.id, physio.id, weekday]
    )
  }

  const day = await findBookableDay(patientSession, service.insertId, 'home', { fromEnd: true })
  check(day !== null, 'home visits become bookable', day ? `${day.slots.length} slots` : 'none')

  // No address → refused.
  const noAddress = await patientSession.json(CLINIC, '/api/appointments', {
    serviceId: service.insertId,
    date: day.date,
    startTime: day.slots[0].startTime,
    mode: 'home',
  })
  check(noAddress.status === 422, 'a home visit without an address is refused', `status ${noAddress.status}`)

  const booked = await patientSession.json(CLINIC, '/api/appointments', {
    serviceId: service.insertId,
    date: day.date,
    startTime: day.slots[0].startTime,
    mode: 'home',
    visitAddress: 'Flat 402, Sai Residency, Baner Road, Pune 411045',
  })
  const data = await booked.json()
  check(booked.status === 201, 'with an address it books', `status ${booked.status} ${data.error ?? ''}`)

  const [[appointment]] = await db.execute(
    'SELECT * FROM appointments WHERE id = ?', [data.appointment.id]
  )
  check(appointment.mode === 'home', '  …as a home visit', appointment.mode)
  check(
    appointment.visit_address?.includes('Baner Road'),
    '  …with the address copied onto the appointment'
  )
  check(
    Number(appointment.amount_paise) === HOME,
    '  …charged the HOME price, not the clinic price',
    `₹${Number(appointment.amount_paise) / 100} (clinic is ₹${VISIT / 100})`
  )

  /* ------------------------------------------- the travel buffer blocks time */
  const buffer = Number(clinic.home_travel_buffer_mins)
  const treatment = 30
  const minutes = (t) => {
    const [h, m] = String(t).split(':').map(Number)
    return h * 60 + m
  }
  check(
    minutes(appointment.end_time) - minutes(appointment.start_time) === treatment + buffer,
    `the diary blocks ${treatment + buffer} minutes for a ${treatment}-minute visit`,
    `${minutes(appointment.end_time) - minutes(appointment.start_time)} min, buffer ${buffer}`
  )

  await db.execute('DELETE FROM payments WHERE clinic_id = ?', [clinic.id])
  await db.execute('DELETE FROM appointments WHERE clinic_id = ?', [clinic.id])
}

/* ========================================================================== */
/*  4. NO-SHOWS COST SOMETHING                                                */
/* ========================================================================== */
console.log('\nNO-SHOWS')
{
  await db.execute(
    `UPDATE clinics SET no_show_fee_paise = 40000, late_cancel_forfeits_session = 1,
                        free_cancellation_hours = 12
      WHERE id = ?`,
    [clinic.id]
  )

  // A package, and a session booked against it.
  const [pkg] = await db.execute(
    `INSERT INTO packages (clinic_id, name, service_id, sessions_count, price_paise, validity_days, is_active)
     VALUES (?, 'Back Course — 5', ?, 5, 300000, 90, 1)`,
    [clinic.id, service.insertId]
  )
  const [bought] = await db.execute(
    `INSERT INTO patient_packages
       (clinic_id, patient_id, package_id, name, service_id, sessions_total, price_paise,
        expires_at, status)
     VALUES (?, ?, ?, 'Back Course — 5', ?, 5, 300000, DATE_ADD(CURDATE(), INTERVAL 90 DAY), 'active')`,
    [clinic.id, patientId, pkg.insertId, service.insertId]
  )

  const day = await findBookableDay(patientSession, service.insertId, 'clinic', { fromEnd: true })
  const booked = await (
    await patientSession.json(CLINIC, '/api/appointments', {
      serviceId: service.insertId,
      date: day.date,
      startTime: day.slots[0].startTime,
      mode: 'clinic',
      patientPackageId: bought.insertId,
    })
  ).json()
  check(Boolean(booked.appointment), 'a package session is booked')

  const used = async () => {
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS n FROM appointments
        WHERE patient_package_id = ?
          AND (status <> 'cancelled' OR package_session_forfeited = 1)`,
      [bought.insertId]
    )
    return Number(row.n)
  }
  check((await used()) === 1, 'one of five sessions used')

  /* ------------------------------------------------- mark it a no-show */
  await admin.req(CLINIC, `/admin/appointments/${booked.appointment.id}`)
  loadActionIds()
  const marked = await admin.action(
    CLINIC,
    `/admin/appointments/${booked.appointment.id}`,
    'updateAppointmentStatus',
    [booked.appointment.id, 'no_show']
  )
  check(marked.ok === true, 'staff mark it as a no-show', marked.error || marked.raw || '')
  check(
    String(marked.message || '').includes('owed'),
    '  …and are told what is owed',
    marked.message || ''
  )

  const [[after]] = await db.execute(
    'SELECT status, no_show_fee_paise, package_session_forfeited FROM appointments WHERE id = ?',
    [booked.appointment.id]
  )
  check(Number(after.no_show_fee_paise) === 40000, '  …the ₹400 fee is stamped on the appointment')
  check(Number(after.package_session_forfeited) === 1, '  …and the session is forfeited')
  check(
    (await used()) === 1,
    '  …so it stays used — a no-show does not hand the session back',
    `${await used()} used`
  )

  /* --------------------------------- a LATE cancellation also forfeits */
  const soon = await db.execute(
    `INSERT INTO appointments (clinic_id, code, patient_id, physio_id, service_id,
                              patient_package_id, appointment_date, start_time, end_time,
                              slot_seat, mode, status, amount_paise)
     VALUES (?, 'LATE0001', ?, ?, ?, ?, CURDATE(), TIME(DATE_ADD(NOW(), INTERVAL 90 MINUTE)),
             TIME(DATE_ADD(NOW(), INTERVAL 120 MINUTE)), 0, 'clinic', 'confirmed', 0)`,
    [clinic.id, patientId, physio.id, service.insertId, bought.insertId]
  )
  const lateId = soon[0].insertId

  const cancelled = await patientSession.req(CLINIC, `/api/appointments/${lateId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Something came up' }),
  })
  const cancelBody = await cancelled.json()
  check(cancelled.status === 200, 'a patient cancels 90 minutes before', `status ${cancelled.status}`)
  check(
    String(cancelBody.message || '').includes('used from your package'),
    '  …and is told the session has been used',
    cancelBody.message || ''
  )

  const [[lateRow]] = await db.execute(
    'SELECT package_session_forfeited FROM appointments WHERE id = ?', [lateId]
  )
  check(Number(lateRow.package_session_forfeited) === 1, '  …the session is forfeited')
  check((await used()) === 2, '  …and two of five are now gone', `${await used()}`)

  /* --------------------- but an EARLY cancellation gives it back */
  const [early] = await db.execute(
    `INSERT INTO appointments (clinic_id, code, patient_id, physio_id, service_id,
                              patient_package_id, appointment_date, start_time, end_time,
                              slot_seat, mode, status, amount_paise)
     VALUES (?, 'EARLY001', ?, ?, ?, ?, DATE_ADD(CURDATE(), INTERVAL 10 DAY), '11:00:00',
             '11:30:00', 0, 'clinic', 'confirmed', 0)`,
    [clinic.id, patientId, physio.id, service.insertId, bought.insertId]
  )
  await patientSession.req(CLINIC, `/api/appointments/${early.insertId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Away that week' }),
  })
  const [[earlyRow]] = await db.execute(
    'SELECT package_session_forfeited FROM appointments WHERE id = ?', [early.insertId]
  )
  check(
    Number(earlyRow.package_session_forfeited) === 0,
    'cancelling ten days ahead does NOT forfeit — the clinic can refill the slot'
  )
  check((await used()) === 2, '  …the balance is unchanged', `${await used()}`)
}

/* ========================================================================== */
/*  5. RECALL                                                                 */
/* ========================================================================== */
console.log('\nRECALL — who to telephone')
{
  const page = async () => {
    const res = await admin.req(CLINIC, '/admin/recalls')
    return { status: res.status, body: (await res.text()).replaceAll('<!-- -->', '') }
  }

  const before = await page()
  check(before.status === 200, 'the recall page renders', `status ${before.status}`)

  // The patient has three unused sessions and nothing booked, so they should be
  // top of the list — money taken for treatment not given.
  check(
    before.body.includes('Vikram') && before.body.includes('sessions left'),
    'a patient with sessions left and nothing booked is listed'
  )

  /* ------------------------------------------ a follow-up the physio asked for */
  const [seen] = await db.execute(
    `INSERT INTO appointments (clinic_id, code, patient_id, physio_id, service_id,
                              appointment_date, start_time, end_time, slot_seat, mode,
                              status, amount_paise)
     VALUES (?, 'SEEN0001', ?, ?, ?, DATE_SUB(CURDATE(), INTERVAL 20 DAY), '10:00:00',
             '10:30:00', 0, 'clinic', 'completed', ?)`,
    [clinic.id, patientId, physio.id, service.insertId, VISIT]
  )
  await db.execute(
    `INSERT INTO consultation_notes
       (clinic_id, appointment_id, physio_id, subjective, assessment, plan,
        follow_up_date, sessions_recommended)
     VALUES (?, ?, ?, 'Improving', 'Responding well', 'Review in three weeks',
             DATE_SUB(CURDATE(), INTERVAL 1 DAY), 6)`,
    [clinic.id, seen.insertId, physio.id]
  )

  const withFollowUp = await page()
  check(
    withFollowUp.body.includes('Follow-ups you asked for'),
    'a follow-up date written in the notes appears'
  )

  /* --------------------------------- and disappears once they are booked in */
  const day = await findBookableDay(patientSession, service.insertId, 'clinic', { fromEnd: true })
  const upcoming = await db.execute(
    `INSERT INTO appointments (clinic_id, code, patient_id, physio_id, service_id,
                              appointment_date, start_time, end_time, slot_seat, mode,
                              status, amount_paise)
     VALUES (?, 'FUTURE01', ?, ?, ?, ?, '16:00:00', '16:30:00', 0, 'clinic', 'confirmed', ?)`,
    [clinic.id, patientId, physio.id, service.insertId, day.date, VISIT]
  )

  const booked = await page()
  check(
    !booked.body.includes('Vikram'),
    'once an appointment is booked they drop off every list — the point is who is NOT coming back'
  )

  await db.execute('DELETE FROM appointments WHERE id = ?', [upcoming[0].insertId])

  /* ------------------------------------------------- marking them contacted */
  loadActionIds()
  const contacted = await admin.action(CLINIC, '/admin/recalls', 'markContacted', [
    { patientId, note: 'Will call back after Diwali' },
  ])
  check(contacted.ok === true, 'reception can record that they called', contacted.error || '')

  const [[profile]] = await db.execute(
    'SELECT last_recall_at, recall_note FROM patient_profiles WHERE user_id = ?', [patientId]
  )
  check(Boolean(profile?.last_recall_at), '  …stamping when')
  check(profile?.recall_note === 'Will call back after Diwali', '  …and what was said')
}

/* ========================================================================== */
/*  6. THE POLICY SCREEN                                                      */
/* ========================================================================== */
console.log('\nTHE POLICY SCREEN')
{
  await admin.req(CLINIC, '/admin/settings/policies')
  loadActionIds()

  const saved = await admin.action(CLINIC, '/admin/settings/policies', 'savePolicies', [
    {
      freeCancellationHours: '24',
      noShowFeeRupees: '500',
      lateCancelForfeitsSession: true,
      allowPayAtClinic: true,
      homeTravelBufferMins: '45',
      recallAfterDays: '90',
      bookingMinNoticeMins: '60',
      bookingHoldMins: '15',
    },
  ])
  check(saved.ok === true, 'the owner can change the policies', saved.error || saved.raw || '')

  const [[updated]] = await db.execute(
    `SELECT free_cancellation_hours, no_show_fee_paise, home_travel_buffer_mins, recall_after_days
       FROM clinics WHERE id = ?`,
    [clinic.id]
  )
  check(Number(updated.no_show_fee_paise) === 50000, '  …the no-show fee is stored in paise')
  check(Number(updated.home_travel_buffer_mins) === 45, '  …the travel buffer is stored')
  check(Number(updated.recall_after_days) === 90, '  …and the lapsed window')

  // A physiotherapist must not be able to set the clinic's fees.
  const [[hash]] = await db.execute('SELECT password_hash FROM users WHERE email = ?', [OWNER.email])
  await db.execute(
    `INSERT INTO users (clinic_id, name, email, password_hash, role, email_verified, is_active)
     VALUES (?, 'Staff Physio', 'real.physio@example.com', ?, 'physio', 1, 1)`,
    [clinic.id, hash.password_hash]
  )
  const staff = makeSession()
  await signIn(staff, CLINIC, { email: 'real.physio@example.com', password: OWNER.password })

  const refused = await staff.action(CLINIC, '/admin/settings/policies', 'savePolicies', [
    { freeCancellationHours: '0', noShowFeeRupees: '0', homeTravelBufferMins: '0',
      recallAfterDays: '7', bookingMinNoticeMins: '0', bookingHoldMins: '5' },
  ])
  check(refused.ok !== true, 'a physiotherapist cannot change them', refused.error || '')

  const [[unchanged]] = await db.execute(
    'SELECT no_show_fee_paise FROM clinics WHERE id = ?', [clinic.id]
  )
  check(Number(unchanged.no_show_fee_paise) === 50000, '  …and nothing changed')
}

console.log('\nCleaning up…')
await teardown()
console.log('  ✓ test clinic removed')

console.log(`\n${failures === 0 ? '✓ THE DIARY MATCHES A REAL CLINIC' : `✗ ${failures} FAILURE(S)`}\n`)
await db.end()
process.exit(failures === 0 ? 0 : 1)
