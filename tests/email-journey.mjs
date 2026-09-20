/**
 * ============================================================================
 *  END-TO-END: the emails the application sends
 * ============================================================================
 *
 *  Drives the real flows — book, pay, cancel, subscribe, let a trial run down —
 *  and checks the right email came out of each, addressed to the right person,
 *  with the right facts in it.
 *
 *  HOW IT READS THE EMAILS
 *  -----------------------
 *  With no SMTP configured, lib/email.js prints each message to the terminal
 *  instead of sending it. So the test reads the dev server's log file:
 *
 *      npm run dev > /tmp/dev.log 2>&1 &
 *      node tests/email-journey.mjs /tmp/dev.log
 *
 *  That is not a trick to make testing easier — it IS the developer experience.
 *  Anyone cloning this repo can watch the whole booking journey, read every
 *  message a patient would get, and never sign up to a mail provider. This test
 *  keeps that path honest.
 *
 *  WHY IT CHECKS THE ADDRESS AND NOT JUST THE TEXT
 *  -----------------------------------------------
 *  The dangerous email bug is not a typo — it is a confirmation sent to the
 *  wrong patient. Every assertion below names who the message went to.
 * ============================================================================
 */

import mysql from 'mysql2/promise'
import fs from 'node:fs'
import process from 'node:process'

process.loadEnvFile('.env.local')

const LOG_PATH = process.argv[2] || process.env.EMAIL_LOG
const PLATFORM = 'http://localhost:3000'
const SLUG = 'mailtest'
const CLINIC = `http://${SLUG}.localhost:3000`
const OWNER_EMAIL = 'mail.owner@example.com'
const PATIENT_EMAIL = 'mail.patient@example.com'
const CLINIC_INBOX = 'mail.clinic@example.com'
const PASSWORD = 'mailtest123'

if (!LOG_PATH || !fs.existsSync(LOG_PATH)) {
  console.error(
    `\n✗ Cannot read the dev server log.\n\n  Start the server with its output redirected, then pass the path:\n\n      npm run dev > /tmp/dev.log 2>&1 &\n      node tests/email-journey.mjs /tmp/dev.log\n`
  )
  process.exit(1)
}

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

/* -------------------------------------------------------------- log reading */

let logOffset = fs.statSync(LOG_PATH).size

/** Everything written to the log since the last time this was called. */
function newLogText() {
  const size = fs.statSync(LOG_PATH).size
  if (size <= logOffset) return ''
  const fd = fs.openSync(LOG_PATH, 'r')
  const buffer = Buffer.alloc(size - logOffset)
  fs.readSync(fd, buffer, 0, buffer.length, logOffset)
  fs.closeSync(fd)
  logOffset = size
  return buffer.toString('utf8')
}

/**
 * Every email block read from the log and not yet matched.
 *
 * This buffer has to live outside waitForEmail, and getting that wrong cost a
 * confusing half hour: with the buffer inside the function, a poll that read TWO
 * emails at once returned the first and threw the second away, so the very next
 * assertion timed out looking for a message that had already gone past. Reading
 * a stream destructively means whatever you do not keep is lost.
 */
const pending = []

function drainLog() {
  const text = newLogText()
  if (!text) return
  for (const block of text.split('┌─ EMAIL').slice(1)) {
    pending.push('┌─ EMAIL' + block)
  }
}

/**
 * Wait for an email matching `match`, and consume it.
 *
 * Emails are sent in the background on purpose — the HTTP response does not wait
 * for them — so the test cannot either. It polls briefly rather than sleeping a
 * fixed amount, which keeps it fast when things work and still gives a slow
 * machine room.
 */
async function waitForEmail(match, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    drainLog()
    const index = pending.findIndex((block) => match(block))
    if (index !== -1) return pending.splice(index, 1)[0]
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return null
}

/** The HTML half of a printed block — the part where escaping has to be right. */
const htmlOf = (block) => block.split('─ html ─')[1] || ''

const to = (address) => (block) => block.includes(`To:      ${address}`)
const and = (...tests) => (block) => tests.every((test) => test(block))
const subjectHas = (text) => (block) => new RegExp(`Subject:.*${escapeRegExp(text)}`).test(block)
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/* --------------------------------------------------------------- http utils */

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
    json(origin, path, body) {
      return this.req(origin, path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
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

async function teardown() {
  const [rows] = await db.execute('SELECT id FROM clinics WHERE slug = ?', [SLUG])
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
  await db.execute('DELETE FROM users WHERE email LIKE ?', ['mail.%@example.com'])
}

console.log('\nCleaning any previous run…')
await teardown()

/* ========================================================================== */
/*  SET UP                                                                    */
/* ========================================================================== */
{
  const s = makeSession()
  const res = await s.json(PLATFORM, '/api/signup', {
    name: 'Dr. Mail Tester',
    email: OWNER_EMAIL,
    phone: '9876500022',
    password: PASSWORD,
    confirmPassword: PASSWORD,
    // A hostile clinic name, on purpose. It ends up inside the HTML of every
    // email the clinic sends, so it must come out escaped.
    clinicName: 'Mail <script>alert(1)</script> Clinic',
    slug: SLUG,
    city: 'Nagpur',
    planCode: 'professional',
    acceptTerms: true,
  })
  if (res.status !== 201) {
    console.error('  ✗ could not create the test clinic:', await res.json())
    process.exit(1)
  }
}

const [[clinic]] = await db.execute('SELECT * FROM clinics WHERE slug = ?', [SLUG])
await db.execute("UPDATE clinics SET onboarding_step = 'done', email = ? WHERE id = ?", [
  CLINIC_INBOX,
  clinic.id,
])

/* ========================================================================== */
/*  1. A NEW CLINIC TELLS THE PLATFORM OWNER                                  */
/* ========================================================================== */
console.log('\nWHEN A CLINIC SIGNS UP')
{
  const email = await waitForEmail(subjectHas('New clinic'))
  check(Boolean(email), 'the platform owner is told about the signup')
  if (email) {
    check(email.includes(OWNER_EMAIL), 'and the email names who to contact')
    // The printed block ends with the raw HTML when EMAIL_DEBUG_HTML=1, which is
    // where the escaping has to be right — a text/plain part is never parsed as
    // markup, so `<script>` appearing THERE is harmless and expected.
    const html = htmlOf(email)
    if (html) {
      check(html.includes('&lt;script&gt;'), 'a hostile clinic name is escaped in the HTML')
      check(!html.includes('<script>'), 'and no script tag survives into the markup')
    } else {
      console.log('  – escaping check skipped: restart the dev server with EMAIL_DEBUG_HTML=1')
    }
  }
}

/* ========================================================================== */
/*  2. A BOOKING IS CONFIRMED                                                 */
/* ========================================================================== */
console.log('\nWHEN A PATIENT BOOKS AND PAYS')

// A treatment and a working week, so there is something to book.
const [service] = await db.execute(
  `INSERT INTO services (clinic_id, slug, name, short_description, price_paise, duration_minutes,
                         available_online, available_clinic)
   VALUES (?, 'sports-injury', 'Sports Injury Assessment', 'A full assessment.', 120000, 45, 1, 1)`,
  [clinic.id]
)
const [[physio]] = await db.execute(
  "SELECT id FROM users WHERE clinic_id = ? AND role = 'physio' LIMIT 1", [clinic.id]
)
for (let weekday = 0; weekday <= 6; weekday++) {
  await db.execute(
    `INSERT INTO availability_rules (clinic_id, physio_id, weekday, start_time, end_time, slot_minutes, mode)
     VALUES (?, ?, ?, '09:00:00', '18:00:00', 30, 'both')`,
    [clinic.id, physio.id, weekday]
  )
}

const patient = makeSession()
let booking
{
  // Register the patient through the real endpoint so the password hashing,
  // profile row and session all match production.
  await patient.json(CLINIC, '/api/register', {
    name: 'Priya Sharma',
    email: PATIENT_EMAIL,
    phone: '9812345678',
    password: PASSWORD,
    confirmPassword: PASSWORD,
    acceptTerms: true,
  })
  const user = await signIn(patient, CLINIC, PATIENT_EMAIL, PASSWORD)
  check(user?.role === 'patient', 'the patient signs in', `role=${user?.role}`)

  /**
   * Find a day that genuinely has a free slot.
   *
   * Not "the first open day" — run this at four in the afternoon and today is open
   * but fully past its last bookable time, and the test fails as though booking
   * were broken. Time-of-day assumptions in tests are quietly poisonous.
   */
  const dates = await (await patient.req(CLINIC, '/api/slots?days=14&mode=clinic')).json()
  let chosen = null
  for (const day of (dates.dates || []).filter((d) => d.isOpen)) {
    const found = (
      await (
        await patient.req(
          CLINIC,
          `/api/slots?serviceId=${service.insertId}&date=${day.date}&mode=clinic`
        )
      ).json()
    ).slots || []
    if (found.length) {
      chosen = { date: day.date, slots: found }
      break
    }
  }
  check(chosen !== null, 'the new clinic has a bookable slot')

  const res = await patient.json(CLINIC, '/api/appointments', {
    serviceId: service.insertId,
    date: chosen.date,
    startTime: chosen.slots[0].startTime,
    mode: 'clinic',
  })
  booking = await res.json()
  check(res.status === 201, 'the slot is held', `status ${res.status} ${booking.error ?? ''}`)

  // No email yet — the appointment is only held, not paid for.
  const premature = await waitForEmail(to(PATIENT_EMAIL), 1500)
  check(!premature, 'nothing is emailed while the booking is still unpaid')

  const paid = await patient.json(CLINIC, '/api/payments/verify', {
    appointmentId: booking.appointment.id,
    razorpay_order_id: booking.order.id,
    razorpay_payment_id: 'pay_demo_test',
    razorpay_signature: 'demo',
  })
  check(paid.status === 200, 'the payment is confirmed', `status ${paid.status}`)

  const confirmation = await waitForEmail(and(to(PATIENT_EMAIL), subjectHas('Confirmed')))
  check(Boolean(confirmation), 'the patient gets a confirmation')
  if (confirmation) {
    check(confirmation.includes('Sports Injury Assessment'), '  …naming the treatment')
    check(confirmation.includes(booking.appointment.code), '  …and the booking reference')
    check(confirmation.includes('1,200'), '  …and what they paid')
    // Checked against the HTML, not the whole block: the plain-text part
    // deliberately decodes entities, so `<script>` there is expected and inert.
    check(!htmlOf(confirmation).includes('<script>'), '  …with the clinic name escaped in the HTML')
  }

  const clinicCopy = await waitForEmail(and(to(CLINIC_INBOX), subjectHas('New booking')))
  check(Boolean(clinicCopy), 'and the clinic is told about it')
  if (clinicCopy) {
    check(clinicCopy.includes('Priya Sharma'), '  …naming the patient')
    check(clinicCopy.includes('9812345678'), '  …with a phone number to ring')
  }
}

/* ========================================================================== */
/*  3. CANCELLING                                                             */
/* ========================================================================== */
console.log('\nWHEN IT IS CANCELLED')
{
  const res = await patient.req(CLINIC, `/api/appointments/${booking.appointment.id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Something came up' }),
  })
  check(res.status === 200, 'the cancellation goes through', `status ${res.status}`)

  const email = await waitForEmail(and(to(PATIENT_EMAIL), subjectHas('Cancelled')))
  check(Boolean(email), 'the patient is told')
  if (email) check(email.includes(booking.appointment.code), '  …quoting the same reference')
}

/* ========================================================================== */
/*  4. SUBSCRIBING                                                            */
/* ========================================================================== */
console.log('\nWHEN THE CLINIC SUBSCRIBES')
{
  const admin = makeSession()
  await signIn(admin, CLINIC, OWNER_EMAIL, PASSWORD)

  const started = await (await admin.json(CLINIC, '/api/billing/subscribe', { planCode: 'starter' })).json()
  await admin.json(CLINIC, '/api/billing/verify', {
    razorpay_subscription_id: started.subscriptionId,
    razorpay_payment_id: started.demoPaymentId,
    razorpay_signature: 'demo',
  })

  const receipt = await waitForEmail(and(to(OWNER_EMAIL), subjectHas('receipt')))
  check(Boolean(receipt), 'the owner gets a receipt')
  if (receipt) {
    check(/INV-\d{4}-\d+/.test(receipt), '  …with a real invoice number')
    check(receipt.includes('GST'), '  …showing GST separately from the fee')
  }
}

/* ========================================================================== */
/*  5. THE TRIAL REMINDER — ONCE, NOT NIGHTLY                                 */
/* ========================================================================== */
console.log('\nWHEN A TRIAL IS ABOUT TO END')
{
  // Put the clinic back on a trial with two days left.
  await db.execute(
    `UPDATE subscriptions
        SET status = 'trialing',
            trial_ends_at = DATE_ADD(NOW(), INTERVAL 2 DAY),
            trial_reminder_sent_at = NULL
      WHERE clinic_id = ? AND status IN ('active','trialing','past_due')`,
    [clinic.id]
  )
  await db.execute("UPDATE clinics SET status = 'trialing' WHERE id = ?", [clinic.id])

  const first = await fetch(`${PLATFORM}/api/cron/subscriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
  const firstResult = await first.json()
  check(first.status === 200, 'the sweep runs', `status ${first.status}`)
  check(firstResult.reminded === 1, 'and sends one reminder', JSON.stringify(firstResult))

  const reminder = await waitForEmail(and(to(OWNER_EMAIL), subjectHas('trial')))
  check(Boolean(reminder), 'the owner is warned the trial is ending')
  if (reminder) check(reminder.includes('2 days'), '  …saying how long is left')

  // The important half: running it again must not send another.
  const second = await fetch(`${PLATFORM}/api/cron/subscriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
  const secondResult = await second.json()
  check(
    secondResult.reminded === 0,
    'running the sweep again sends nothing — a nightly cron does not nag',
    JSON.stringify(secondResult)
  )
  const duplicate = await waitForEmail(and(to(OWNER_EMAIL), subjectHas('trial')), 1500)
  check(!duplicate, 'and no second reminder reaches the inbox')
}

console.log('\nCleaning up…')
await teardown()
console.log('  ✓ test clinic removed')

console.log(`\n${failures === 0 ? '✓ EMAIL WORKS' : `✗ ${failures} FAILURE(S)`}\n`)
await db.end()
process.exit(failures === 0 ? 0 : 1)
