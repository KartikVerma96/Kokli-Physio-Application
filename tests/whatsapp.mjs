/**
 * ============================================================================
 *  WHATSAPP
 * ============================================================================
 *
 *  THE ASSERTION THAT MATTERS MOST IS THE CONSENT ONE
 *  --------------------------------------------------
 *  Every clinic sends through the platform's single WhatsApp number. Meta blocks
 *  a number that sends marketing templates to people who did not agree — so one
 *  clinic being careless takes WhatsApp away from ALL of them, on the same
 *  afternoon, with no way to appeal quickly.
 *
 *  That makes "a marketing message cannot be sent without consent" the single
 *  most load-bearing rule in the feature. It is tested from both directions: it
 *  must refuse without consent, and it must send with it — because a gate that
 *  blocks everything is just as broken and much easier to ship by accident.
 *
 *  Everything runs in preview mode (no WHATSAPP_* variables), which is how a
 *  clinic will use it before Meta approves anything. The gates being tested run
 *  before the provider call, so preview mode tests them exactly.
 * ============================================================================
 */

import mysql from 'mysql2/promise'
import process from 'node:process'

process.loadEnvFile('.env.local')

const PLATFORM = 'http://localhost:3000'
const SLUG = 'watest'
const CLINIC = `http://${SLUG}.localhost:3000`
const OWNER = { email: 'wa.owner@example.com', password: 'watest123' }

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
  }
}

async function teardown() {
  const [rows] = await db.execute('SELECT id FROM clinics WHERE slug = ?', [SLUG])
  if (rows.length) {
    const id = rows[0].id
    await db.execute('DELETE FROM whatsapp_messages WHERE clinic_id = ?', [id])
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
  await db.execute("DELETE FROM users WHERE email LIKE 'wa.%@example.com'")
}

const cron = (body) =>
  fetch(`${PLATFORM}/api/cron/whatsapp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    body,
  })

console.log('\nCleaning any previous run…')
await teardown()

/* ========================================================================== */
/*  SET UP — a clinic on Professional (WhatsApp included, 500/month)           */
/* ========================================================================== */
{
  const s = makeSession()
  const res = await s.json(PLATFORM, '/api/signup', {
    name: 'Dr. WhatsApp Tester',
    email: OWNER.email,
    phone: '9876500077',
    password: OWNER.password,
    confirmPassword: OWNER.password,
    clinicName: 'WhatsApp Test Clinic',
    slug: SLUG,
    city: 'Thane',
    planCode: 'professional',
    acceptTerms: true,
  })
  if (res.status !== 201) {
    console.error('  ✗ could not create the clinic:', await res.json())
    process.exit(1)
  }
  await db.execute(
    `UPDATE clinics SET onboarding_step = 'done', maps_url = 'https://g.page/r/test/review',
                        wa_send_reminders = 1, wa_send_package_nudge = 1, wa_send_review_request = 1
      WHERE slug = ?`,
    [SLUG]
  )
}

const [[clinic]] = await db.execute('SELECT * FROM clinics WHERE slug = ?', [SLUG])
const [[physio]] = await db.execute(
  "SELECT id FROM users WHERE clinic_id = ? AND role = 'physio' LIMIT 1", [clinic.id]
)
const [service] = await db.execute(
  `INSERT INTO services (clinic_id, slug, name, short_description, price_paise, duration_minutes,
                         available_online, available_clinic, is_active)
   VALUES (?, 'wa-treat', 'Treatment', 'x', 80000, 30, 0, 1, 1)`,
  [clinic.id]
)

/** A patient, optionally with marketing consent. */
async function makePatient(name, { consent = false, phone = null, optOut = false } = {}) {
  const [u] = await db.execute(
    `INSERT INTO users (clinic_id, name, email, phone, role, email_verified, is_active)
     VALUES (?, ?, ?, ?, 'patient', 1, 1)`,
    [clinic.id, name, `wa.${name.replace(/\s/g, '').toLowerCase()}@example.com`, phone ?? '9812345678']
  )
  await db.execute(
    `INSERT INTO patient_profiles (user_id, whatsapp_marketing_opt_in_at, whatsapp_opted_out_at)
     VALUES (?, ${consent ? 'NOW()' : 'NULL'}, ${optOut ? 'NOW()' : 'NULL'})`,
    [u.insertId]
  )
  return u.insertId
}

/**
 * An appointment a given number of minutes from now.
 *
 * BOTH the date and the time are derived from the same moment. Writing
 * `CURDATE() + 1 DAY` with `TIME(NOW() + 30 MINUTE)` looks like "tomorrow, soon"
 * and is actually 24.5 hours away — outside a 24-hour reminder window. Worse, it
 * only fails part of the day: run the suite at 23:20 and NOW()+45min rolls past
 * midnight, so some rows land inside the window and some do not, and the failure
 * looks like a bug in the scheduler.
 */
async function appointmentIn(minutes, { patientId, code, seat = 0, status = 'confirmed' }) {
  const [r] = await db.execute(
    `INSERT INTO appointments (clinic_id, code, patient_id, physio_id, service_id,
                              appointment_date, start_time, end_time, slot_seat, mode, status, amount_paise)
     VALUES (?, ?, ?, ?, ?,
             DATE(DATE_ADD(NOW(), INTERVAL ? MINUTE)),
             TIME(DATE_ADD(NOW(), INTERVAL ? MINUTE)),
             TIME(DATE_ADD(NOW(), INTERVAL ? MINUTE)),
             ?, 'clinic', ?, 80000)`,
    [clinic.id, code, patientId, physio.id, service.insertId, minutes, minutes, minutes + 30, seat, status]
  )
  return r.insertId
}

const sent = (patientId, template) =>
  db
    .execute(
      `SELECT status, reason FROM whatsapp_messages
        WHERE clinic_id = ? AND patient_id = ? AND template = ?
        ORDER BY id DESC LIMIT 1`,
      [clinic.id, patientId, template]
    )
    .then(([r]) => r[0] || null)

/* ========================================================================== */
console.log('\nAPPOINTMENT REMINDERS — utility, no consent needed')
/* ========================================================================== */
{
  const patient = await makePatient('Reminder Patient')

  // Two hours from now — comfortably inside the clinic's 24-hour window.
  const apptId = await appointmentIn(120, { patientId: patient, code: 'WAREM001' })

  const res = await cron()
  const body = await res.json()
  check(res.status === 200, 'the scheduler runs', `status ${res.status}`)

  const message = await sent(patient, 'appointment_reminder')
  check(message?.status === 'sent', 'a reminder goes without any consent', message?.reason || '')
  check(Number(body.reminders?.considered) >= 1, '  …and the job reports what it did')

  /**
   * Run it again. This is the assertion that stops a patient being messaged six
   * times because a scheduler ran every ten minutes — see the note on marking
   * before sending in lib/whatsappJobs.js.
   */
  await cron()
  const [again] = await db.execute(
    `SELECT COUNT(*) AS n FROM whatsapp_messages
      WHERE clinic_id = ? AND patient_id = ? AND template = 'appointment_reminder'`,
    [clinic.id, patient]
  )
  check(Number(again[0].n) === 1, 'running the scheduler again does NOT send it twice', `${again[0].n} message(s)`)

  await db.execute('DELETE FROM appointments WHERE id = ?', [apptId])
}

/* ========================================================================== */
console.log('\nMARKETING — the rule that protects every clinic at once')
/* ========================================================================== */
{
  const withoutConsent = await makePatient('No Consent')
  const withConsent = await makePatient('Gave Consent', { consent: true })

  // Both hold a package expiring in a week with sessions left and nothing booked.
  for (const patientId of [withoutConsent, withConsent]) {
    await db.execute(
      `INSERT INTO patient_packages (clinic_id, patient_id, name, service_id, sessions_total,
                                    price_paise, expires_at, status)
       VALUES (?, ?, 'Course of 10', ?, 10, 600000, DATE_ADD(CURDATE(), INTERVAL 7 DAY), 'active')`,
      [clinic.id, patientId, service.insertId]
    )
  }

  await cron()

  const refused = await sent(withoutConsent, 'package_expiring')
  check(refused?.status === 'skipped', 'a marketing message is REFUSED without consent', refused?.reason || '')
  check(
    /consent/i.test(refused?.reason || ''),
    '  …and the reason says so, so reception can fix it',
    refused?.reason || ''
  )

  const allowed = await sent(withConsent, 'package_expiring')
  check(allowed?.status === 'sent', 'and DOES go to a patient who agreed', allowed?.reason || '')
}

/* ========================================================================== */
console.log('\nOPTING OUT BEATS EVERYTHING')
/* ========================================================================== */
{
  // Consented once, then asked to stop. The opt-out must win.
  const stopped = await makePatient('Opted Out', { consent: true, optOut: true })

  await appointmentIn(150, { patientId: stopped, code: 'WASTOP01', seat: 1 })

  await cron()
  const message = await sent(stopped, 'appointment_reminder')
  check(
    message?.status === 'skipped',
    'even a UTILITY reminder is refused after they opt out',
    message?.reason || ''
  )
  check(/opted out/i.test(message?.reason || ''), '  …for the right reason', message?.reason || '')
}

/* ========================================================================== */
console.log('\nNO PHONE NUMBER, AND A BADLY TYPED ONE')
/* ========================================================================== */
{
  const noPhone = await makePatient('No Phone', { phone: '' })
  const messy = await makePatient('Messy Number', { phone: '+91 98123-45678' })

  await appointmentIn(180, { patientId: noPhone, code: 'WANOPH01', seat: 2 })
  await appointmentIn(180, { patientId: messy, code: 'WAMESS01', seat: 3 })

  await cron()

  const missing = await sent(noPhone, 'appointment_reminder')
  check(missing?.status === 'skipped', 'a patient with no number is skipped, not crashed on', missing?.reason || '')

  const normalised = await sent(messy, 'appointment_reminder')
  check(
    normalised?.status === 'sent',
    '"+91 98123-45678" is normalised and sent',
    normalised?.status
  )
  const [[row]] = await db.execute(
    `SELECT to_number FROM whatsapp_messages
      WHERE patient_id = ? AND template = 'appointment_reminder' ORDER BY id DESC LIMIT 1`,
    [messy]
  )
  check(row?.to_number === '919812345678', '  …to 919812345678, the form Meta wants', row?.to_number)
}

/* ========================================================================== */
console.log('\nTHE PLAN GATE AND THE MONTHLY ALLOWANCE')
/* ========================================================================== */
{
  // Drop the clinic to Starter, which has no WhatsApp at all.
  const [[starter]] = await db.execute("SELECT id FROM plans WHERE code = 'starter'")
  await db.execute("UPDATE subscriptions SET plan_id = ? WHERE clinic_id = ? AND status IN ('trialing','active','past_due')",
    [starter.id, clinic.id])

  const patient = await makePatient('Starter Patient')
  await appointmentIn(210, { patientId: patient, code: 'WAPLAN01', seat: 4 })

  await cron()
  const blocked = await sent(patient, 'appointment_reminder')
  check(blocked?.status === 'skipped', 'a Starter clinic sends nothing', blocked?.reason || '')
  check(/plan/i.test(blocked?.reason || ''), '  …and is told it is the plan', blocked?.reason || '')

  // Back to Professional, then exhaust the allowance.
  const [[pro]] = await db.execute("SELECT id FROM plans WHERE code = 'professional'")
  await db.execute("UPDATE subscriptions SET plan_id = ? WHERE clinic_id = ? AND status IN ('trialing','active','past_due')",
    [pro.id, clinic.id])

  // 500 messages already sent this month.
  const filler = []
  for (let i = 0; i < 500; i++) {
    filler.push(`(${clinic.id}, 'appointment_reminder', 'utility', '919800000000', 'sent')`)
  }
  await db.query(
    `INSERT INTO whatsapp_messages (clinic_id, template, category, to_number, status) VALUES ${filler.join(',')}`
  )

  const overQuota = await makePatient('Over Quota')
  await appointmentIn(240, { patientId: overQuota, code: 'WAQUOT01', seat: 5 })

  await cron()
  const capped = await sent(overQuota, 'appointment_reminder')
  check(capped?.status === 'skipped', 'the monthly allowance stops the 501st message', capped?.reason || '')
  check(/allowance|quota/i.test(capped?.reason || ''), '  …and says why', capped?.reason || '')

  /**
   * A skipped message must not eat the allowance.
   *
   * Charging a clinic for a message its patient never received would be
   * indefensible the first time anybody checked the numbers.
   */
  const [[counted]] = await db.execute(
    `SELECT COUNT(*) AS n FROM whatsapp_messages
      WHERE clinic_id = ? AND status IN ('sent','delivered','read')
        AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
    [clinic.id]
  )
  const [[skipped]] = await db.execute(
    `SELECT COUNT(*) AS n FROM whatsapp_messages WHERE clinic_id = ? AND status = 'skipped'`,
    [clinic.id]
  )
  check(
    Number(skipped.n) > 0 && Number(counted.n) === 500 + 3,
    'skipped messages do not count against the allowance',
    `${counted.n} counted, ${skipped.n} skipped`
  )
}

/* ========================================================================== */
console.log('\nTHE CLINIC ON ITS OWN NUMBER')
/* ========================================================================== */
{
  /**
   * The clinic is still over its 500-message platform allowance from the block
   * above. Connecting its own number lifts the cap entirely — Meta bills the clinic
   * directly, so there is nothing left for us to ration.
   *
   * BUT ONLY IF THE PLAN ALLOWS IT, and that is the point of the first half of this
   * block. Before migration 008, whatsappAllowance() answered the own-number case
   * before it ever read the plan — so a Starter clinic got unlimited WhatsApp for
   * free by connecting a number, and a Professional clinic that needed more than its
   * 500 had no reason to upgrade. The quota created no pressure at all, which is the
   * entire mechanism the pricing depends on.
   *
   * The clinic in this suite is on PROFESSIONAL, which does not include it.
   */
  const [[before]] = await db.execute(
    'SELECT wa_phone_number_id FROM clinics WHERE id = ?', [clinic.id]
  )
  check(!before.wa_phone_number_id, 'starts on the platform number')

  const admin = makeSession()
  const { csrfToken } = await (await admin.req(CLINIC, '/api/auth/csrf')).json()
  await admin.req(CLINIC, '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, email: OWNER.email, password: OWNER.password }).toString(),
  })
  await admin.req(CLINIC, '/admin/settings/whatsapp')

  // Load the action ids the same way the other suites do.
  const fs = await import('node:fs')
  const MANIFEST = '.next/dev/server/server-reference-manifest.json'
  const ids = new Map(
    Object.entries(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).node).map(([id, e]) => [
      e.exportedName,
      id,
    ])
  )
  const callAction = async (name, args) => {
    const id = ids.get(name)
    if (!id) return { error: `action ${name} not compiled` }
    const res = await admin.req(CLINIC, '/admin/settings/whatsapp', {
      method: 'POST',
      headers: { 'Next-Action': id, 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(args),
    })
    const text = await res.text()
    const m = [...text.matchAll(/\{"ok":.*?\}(?=\s*$|\n)/gs)]
    if (m.length) {
      try {
        return JSON.parse(m[m.length - 1][0])
      } catch {
        /* fall through */
      }
    }
    return { raw: text.slice(0, 160) }
  }

  /* --------------------------------- the plan gate, from the server's side */
  /**
   * Refused on Professional. Note this goes straight at the ACTION, not the page —
   * the settings page hides the form, and hiding a form gates nothing. A server
   * action is a public POST endpoint.
   */
  const blocked = await callAction('connectOwnWhatsApp', [
    { phoneNumberId: '109876543210987', token: 'EAAG' + 'x'.repeat(80) },
  ])
  check(
    blocked.ok !== true,
    'on Professional, connecting your own number is REFUSED — the quota cannot be routed around',
    blocked.error || blocked.raw || ''
  )

  const [[notConnected]] = await db.execute(
    'SELECT wa_phone_number_id FROM clinics WHERE id = ?', [clinic.id]
  )
  check(!notConnected.wa_phone_number_id, '  …and nothing was stored')

  /* --------------------------- now a plan that DOES allow its own number */
  /**
   * The plan's `whatsapp_own_number` flag is set here by the test, rather than
   * relied upon from the seed.
   *
   * That separation matters. Whether any plan offers own-number sending is a
   * PRICING decision — it was on for the Clinic plan, and is currently off for
   * every plan because Kokli sends everything from its own number. The code path
   * behind it is a different thing entirely, and it still has to work the day
   * somebody switches the flag back on.
   *
   * This test broke exactly once by conflating the two: the flag was turned off in
   * the database and four assertions failed, none of which had anything to do with
   * the code they were testing. A test that depends on a business decision fails
   * every time the business changes its mind.
   */
  const [[topPlan]] = await db.execute("SELECT id FROM plans WHERE code = 'clinic'")
  const [[topPlanBefore]] = await db.execute(
    'SELECT whatsapp_own_number FROM plans WHERE id = ?', [topPlan.id]
  )
  await db.execute('UPDATE plans SET whatsapp_own_number = 1 WHERE id = ?', [topPlan.id])
  await db.execute('UPDATE subscriptions SET plan_id = ? WHERE clinic_id = ?', [
    topPlan.id,
    clinic.id,
  ])

  /**
   * The format check runs HERE, after the upgrade — not before it.
   *
   * A phone number where a phone-number ID is wanted is the commonest mistake a
   * clinic makes. This assertion used to sit above the plan gate, where the gate
   * rejected it first: it passed while proving nothing about format validation at
   * all. A test that passes for the wrong reason is worse than no test, so the
   * assertion now also insists the refusal is NOT the plan one.
   */
  const wrong = await callAction('connectOwnWhatsApp', [
    { phoneNumberId: '9812345678', token: 'x'.repeat(60) },
  ])
  check(
    wrong.ok !== true && !/Clinic plan/.test(wrong.error || ''),
    'a phone number is rejected where an ID is wanted — on format, not on plan',
    wrong.error || ''
  )

  const connected = await callAction('connectOwnWhatsApp', [
    { phoneNumberId: '109876543210987', token: 'EAAG' + 'x'.repeat(80) },
  ])
  check(
    connected.ok === true,
    'on the Clinic plan it is allowed',
    connected.error || connected.raw || ''
  )

  const [[after]] = await db.execute(
    'SELECT wa_phone_number_id, wa_token_enc FROM clinics WHERE id = ?', [clinic.id]
  )
  check(after.wa_phone_number_id === '109876543210987', '  …the ID is stored')
  check(
    Boolean(after.wa_token_enc) && !String(after.wa_token_enc).includes('EAAG'),
    '  …and the token is ENCRYPTED, not stored in the clear'
  )

  /**
   * The assertion this whole block exists for: the cap is gone.
   *
   * The clinic is well past 500 sent this month, and a message must now go out
   * anyway — because it is their number and their bill.
   */
  const overQuotaPatient = await makePatient('Own Number Patient')
  await appointmentIn(270, { patientId: overQuotaPatient, code: 'WAOWN001', seat: 6 })

  await cron()
  const message = await sent(overQuotaPatient, 'appointment_reminder')

  /**
   * The assertion is "not skipped for quota", not "sent".
   *
   * The credentials above are deliberately fake, so the message reaches Meta and
   * comes back "Malformed access token" — a FAILED send. That failure is the
   * proof: to fail at Meta it had to get past the quota gate, which is exactly
   * what connecting your own number is supposed to do. Asserting `sent` would
   * mean asserting that Meta accepts made-up tokens.
   */
  const stoppedByQuota = message?.status === 'skipped' && /allowance|quota/i.test(message?.reason || '')
  check(
    !stoppedByQuota && Boolean(message),
    'past 500 messages, its own number is no longer capped',
    `${message?.status} — ${message?.reason || 'reached the provider'}`
  )

  /**
   * Back to Professional before checking that the cap returns.
   *
   * The block above moved this clinic to the Clinic plan so it could connect its own
   * number, and that plan allows 2,000 messages a month. At roughly 503 sent, the
   * cap would simply not fire — and the assertion below would fail for a reason that
   * has nothing to do with what it is testing.
   */
  const [[proAgain]] = await db.execute("SELECT id FROM plans WHERE code = 'professional'")
  await db.execute('UPDATE subscriptions SET plan_id = ? WHERE clinic_id = ?', [
    proAgain.id,
    clinic.id,
  ])

  // Put the plan flag back exactly as it was. `plans` is shared, real configuration
  // — a test that leaves it changed silently rewrites the price list.
  await db.execute('UPDATE plans SET whatsapp_own_number = ? WHERE id = ?', [
    topPlanBefore.whatsapp_own_number,
    topPlan.id,
  ])

  // And disconnecting brings the cap back.
  const off = await callAction('disconnectOwnWhatsApp', [])
  check(off.ok === true, 'it can go back to our number', off.error || '')

  const backOnPlatform = await makePatient('Back On Platform')
  await appointmentIn(300, { patientId: backOnPlatform, code: 'WAPLAT01', seat: 7 })
  await cron()
  const capped = await sent(backOnPlatform, 'appointment_reminder')
  check(
    capped?.status === 'skipped' && /allowance|quota/i.test(capped?.reason || ''),
    '  …and the monthly cap applies again',
    capped?.reason || ''
  )
}

/* ========================================================================== */
console.log('\nTHE SETTINGS SCREEN')
/* ========================================================================== */
{
  const admin = makeSession()
  const { csrfToken } = await (await admin.req(CLINIC, '/api/auth/csrf')).json()
  await admin.req(CLINIC, '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, email: OWNER.email, password: OWNER.password }).toString(),
  })

  const res = await admin.req(CLINIC, '/admin/settings/whatsapp')
  const body = res.status === 200 ? (await res.text()).replaceAll('<!-- -->', '') : ''
  check(res.status === 200, '/admin/settings/whatsapp renders', `status ${res.status}`)
  check(body.includes('Appointment reminder'), '  …showing the message types')
  check(
    body.includes('permission') || body.includes('agreed'),
    '  …and explaining the consent rule where the decision is made'
  )
}

console.log('\nCleaning up…')
await teardown()
console.log('  ✓ test clinic removed')

console.log(`\n${failures === 0 ? '✓ WHATSAPP WORKS' : `✗ ${failures} FAILURE(S)`}\n`)
await db.end()
process.exit(failures === 0 ? 0 : 1)
