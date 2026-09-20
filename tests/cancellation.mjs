/**
 * ============================================================================
 *  CANCELLING A SUBSCRIPTION
 * ============================================================================
 *  WHY THIS SUITE EXISTS AT ALL
 *  ----------------------------
 *  A cancellation has exactly two ways to go badly wrong, and both are expensive
 *  in ways a bug report never captures:
 *
 *    1. IT DOES NOT ACTUALLY STOP THE MONEY. The clinic sees "cancelled", the
 *       mandate is still live, and next month they are charged again. That is a
 *       chargeback, a furious customer, and a story they tell other clinics.
 *
 *    2. IT TAKES ACCESS AWAY IMMEDIATELY. They paid for the month. Cutting them
 *       off on the day they cancel is taking money for nothing — and their
 *       patients have appointments booked in the next three weeks.
 *
 *  So the assertions here are mostly about the MIDDLE state: cancelled, but still
 *  working. That state is derived rather than stored (see isCancelling), which
 *  makes it exactly the kind of thing a refactor breaks silently.
 * ============================================================================
 */

import fs from 'node:fs'
import process from 'node:process'
import mysql from 'mysql2/promise'

process.loadEnvFile('.env.local')

const PLATFORM = 'http://localhost:3000'
const SLUG = 'cxltest'
const CLINIC = `http://${SLUG}.localhost:3000`
const OWNER = { email: 'cxl.owner@example.com', password: 'cxltest123' }

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
  console.error(`\n  ✗ ${MANIFEST} missing. Start the dev server first.\n`)
  process.exit(1)
}

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
          try { best = JSON.parse(text.slice(i, j + 1)) } catch { /* keep looking */ }
          break
        }
      }
    }
  }
  return best ?? { error: 'no result in stream', raw: text.slice(0, 200) }
}

const sub = () =>
  db.execute(
    `SELECT s.* FROM subscriptions s
      JOIN clinics c ON c.id = s.clinic_id
     WHERE c.slug = ? ORDER BY s.id DESC LIMIT 1`,
    [SLUG]
  ).then(([r]) => r[0])

async function teardown() {
  const [rows] = await db.execute('SELECT id FROM clinics WHERE slug = ?', [SLUG])
  if (rows.length) {
    const id = rows[0].id
    for (const t of ['error_events', 'login_otps', 'whatsapp_messages', 'payments',
                     'consultation_notes', 'appointments', 'patient_packages', 'packages',
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
  await db.execute("DELETE FROM users WHERE email LIKE 'cxl.%@example.com'")
}

console.log('\nCleaning any previous run…')
await teardown()

/* ========================================================================== */
/*  SET UP                                                                    */
/* ========================================================================== */
{
  const s = makeSession()
  const res = await s.req(PLATFORM, '/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Dr. Cancel Test',
      email: OWNER.email,
      phone: '9812399991',
      password: OWNER.password,
      confirmPassword: OWNER.password,
      clinicName: 'Cancel Test Clinic',
      slug: SLUG,
      city: 'Pune',
      planCode: 'professional',
      acceptTerms: true,
    }),
  })
  if (res.status !== 201) {
    console.error('  ✗ could not create the clinic:', await res.text())
    process.exit(1)
  }
  await db.execute("UPDATE clinics SET onboarding_step = 'done' WHERE slug = ?", [SLUG])
}

const [[clinic]] = await db.execute('SELECT * FROM clinics WHERE slug = ?', [SLUG])

/* ========================================================================== */
/*  WHO MAY CANCEL                                                            */
/* ========================================================================== */
console.log('\nWHO MAY CANCEL')
{
  const owner = makeSession()
  await owner.signIn(CLINIC, OWNER)
  await owner.req(CLINIC, '/admin/billing')

  // A physiotherapist must not be able to end the clinic's subscription. Money is
  // the owner's business, and this is a server action — a public POST endpoint —
  // so the page not being in their sidebar proves nothing.
  const [[physio]] = await db.execute(
    "SELECT email FROM users WHERE clinic_id = ? AND role = 'physio' LIMIT 1", [clinic.id]
  )
  // Read first, then write. MySQL refuses a subquery on the very table being
  // updated (ER_UPDATE_TABLE_USED), so this cannot be one statement.
  const [[ownerRow]] = await db.execute('SELECT password_hash FROM users WHERE email = ?', [
    OWNER.email,
  ])
  await db.execute('UPDATE users SET password_hash = ? WHERE email = ?', [
    ownerRow.password_hash,
    physio.email,
  ])

  const asPhysio = makeSession()
  const who = await asPhysio.signIn(CLINIC, { email: physio.email, password: OWNER.password })
  check(who?.role === 'physio', 'signed in as a physiotherapist', who?.role)

  const refused = await asPhysio.action(CLINIC, '/admin/billing', 'cancelSubscription', [{}])
  check(refused.ok === false, 'a physiotherapist cannot cancel the subscription', refused.error)

  const stillThere = await sub()
  check(stillThere?.cancelled_at === null, 'and nothing was recorded')
}

/* ========================================================================== */
/*  CANCELLING WHILE ON TRIAL                                                 */
/* ========================================================================== */
console.log('\nON TRIAL — ENDS IMMEDIATELY, BECAUSE NOTHING WAS PAID')
{
  const s = makeSession()
  await s.signIn(CLINIC, OWNER)
  await s.req(CLINIC, '/admin/billing')

  const before = await sub()
  check(before.status === 'trialing', 'starts on trial', before.status)

  const result = await s.action(CLINIC, '/admin/billing', 'cancelSubscription', [
    { reason: 'too_expensive', note: 'Testing the cancel flow' },
  ])
  check(result.ok === true, 'the owner can cancel', result.message || result.error)
  check(result.immediate === true, 'a trial ends immediately — there is no paid period to honour')

  const after = await sub()
  check(after.status === 'cancelled', 'the subscription is cancelled', after.status)
  check(after.cancelled_at !== null, 'cancelled_at is stamped')
  check(after.cancelled_by === 'clinic', 'attributed to the clinic, not to us', after.cancelled_by)
  check(
    String(after.cancel_reason || '').includes('too_expensive'),
    'the churn reason is stored',
    after.cancel_reason
  )
  check(
    String(after.cancel_reason || '').includes('Testing the cancel flow'),
    'along with what they typed'
  )

  // Idempotent: a second click, or a second tab, must not produce an error about
  // something that already worked.
  const again = await s.action(CLINIC, '/admin/billing', 'cancelSubscription', [{}])
  check(
    again.ok === true && again.alreadyCancelled === true,
    'cancelling twice is harmless rather than an error',
    again.message
  )
}

/* ========================================================================== */
/*  THE MIDDLE STATE — PAID UP, CANCELLED, STILL WORKING                      */
/* ========================================================================== */
console.log('\nPAID AND CANCELLING — KEEPS WORKING UNTIL THE PERIOD ENDS')
{
  // Put the clinic on a paid subscription with three weeks left, and cancel that.
  await db.execute(
    `UPDATE subscriptions
        SET status = 'active', cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL,
            trial_ends_at = NOW() - INTERVAL 5 DAY,
            current_period_start = NOW() - INTERVAL 7 DAY,
            current_period_end = NOW() + INTERVAL 21 DAY,
            razorpay_subscription_id = 'sub_demo_cxltest'
      WHERE clinic_id = ?`,
    [clinic.id]
  )
  await db.execute("UPDATE clinics SET status = 'active' WHERE id = ?", [clinic.id])

  const s = makeSession()
  await s.signIn(CLINIC, OWNER)
  await s.req(CLINIC, '/admin/billing')

  /**
   * ------------------------------------------------------------------------
   *  FIRST: RAZORPAY REFUSES, SO WE RECORD NOTHING
   * ------------------------------------------------------------------------
   *  The id planted above is fake. With real keys configured, the action calls
   *  Razorpay, Razorpay rejects it, and the cancellation must NOT be written —
   *  otherwise a clinic sees "cancelled" while a live mandate quietly charges them
   *  again next month. That is the single worst outcome the feature can produce,
   *  so it is asserted rather than assumed.
   *
   *  Only meaningful when real keys are present. In demo mode Razorpay is never
   *  called, so there is nothing to refuse and the check is skipped — a test that
   *  passes only in one configuration is a test that will be deleted by whoever
   *  hits it in the other.
   */
  const liveKeys = Boolean(
    process.env.PLATFORM_RAZORPAY_KEY_ID && process.env.PLATFORM_RAZORPAY_KEY_SECRET
  )

  if (liveKeys) {
    const refused = await s.action(CLINIC, '/admin/billing', 'cancelSubscription', [{}])
    check(
      refused.ok === false,
      'if Razorpay refuses, the cancellation is NOT recorded',
      refused.error?.slice(0, 60)
    )
    const [[untouched]] = await db.execute(
      'SELECT cancelled_at FROM subscriptions WHERE clinic_id = ? ORDER BY id DESC LIMIT 1',
      [clinic.id]
    )
    check(untouched.cancelled_at === null, '  …and nothing was written to our side either')
  } else {
    check(true, 'Razorpay-refusal check skipped — billing is in demo mode')
    check(true, '  …(set PLATFORM_RAZORPAY_* to exercise it)')
  }

  /**
   * Now clear the Razorpay id so the rest of the block tests OUR logic.
   *
   * A subscription with no mandate is a real state — one created while billing was
   * in demo mode, or set up by hand — and cancelling it should still work. Using it
   * here keeps every assertion below independent of Razorpay's network.
   */
  await db.execute(
    'UPDATE subscriptions SET razorpay_subscription_id = NULL WHERE clinic_id = ?',
    [clinic.id]
  )

  const result = await s.action(CLINIC, '/admin/billing', 'cancelSubscription', [
    { reason: 'switching' },
  ])
  check(result.ok === true, 'the owner can cancel a paid subscription', result.message || result.error)
  check(result.immediate !== true, 'and it does NOT end immediately')

  const after = await sub()
  check(
    after.status === 'active',
    'the subscription stays ACTIVE — they paid for this month',
    after.status
  )
  check(after.cancelled_at !== null, 'while cancelled_at records the request')

  /**
   * The two together are the "cancelling" state. This is the assertion that
   * matters most in the whole suite: if a refactor ever makes cancellation flip the
   * status straight to 'cancelled', a clinic loses three weeks it has paid for and
   * every gate in the app closes on them at once.
   */
  const page = await s.req(CLINIC, '/admin/billing')
  const body = await page.text()
  check(/subscription ends on/i.test(body), 'the billing page shows the end date')
  check(!/Cancel subscription<\/button>/i.test(body), 'and no longer offers to cancel again')

  /* --------------------------------------------- everything still works today */
  const booking = await s.req(CLINIC, '/book')
  const bookingBody = await booking.text()
  check(
    booking.status === 200 && !/Online booking is paused/i.test(bookingBody),
    'the booking page still takes bookings',
    `got ${booking.status}`
  )

  const admin = await s.req(CLINIC, '/admin')
  check(admin.status === 200, 'the clinic admin still opens', `got ${admin.status}`)
}

/* ========================================================================== */
/*  THE PERIOD RUNS OUT                                                       */
/* ========================================================================== */
console.log('\nWHEN THE PAID PERIOD RUNS OUT')
{
  // Wind the clock back rather than waiting three weeks.
  await db.execute(
    `UPDATE subscriptions SET current_period_end = NOW() - INTERVAL 1 HOUR WHERE clinic_id = ?`,
    [clinic.id]
  )

  const res = await fetch(`${PLATFORM}/api/cron/subscriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
  const sweep = await res.json()
  check(res.status === 200, 'the nightly sweep runs', `got ${res.status}`)
  check(Number(sweep.ended) >= 1, 'and ends the expired cancellation', `ended=${sweep.ended}`)

  const after = await sub()
  check(after.status === 'cancelled', 'the subscription is now cancelled', after.status)

  const s = makeSession()
  await s.signIn(CLINIC, OWNER)

  /* ------------------------------------- no new bookings, but nothing is lost */
  const booking = await s.req(CLINIC, '/book')
  const bookingBody = await booking.text()
  check(
    /Online booking is paused/i.test(bookingBody),
    'the booking page now tells patients to telephone'
  )

  const post = await s.req(CLINIC, '/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  check(post.status === 403, 'and the booking API refuses', `got ${post.status}`)

  // The whole point of the lockout design: records are never lost over billing.
  const patients = await s.req(CLINIC, '/admin/patients')
  check(patients.status === 200, 'the patient list still opens', `got ${patients.status}`)

  const exported = await s.req(CLINIC, '/api/export/clinic?dataset=patients')
  check(exported.status === 200, 'and the data export still works', `got ${exported.status}`)
}

/* ========================================================================== */
/*  THE PLATFORM SEES IT                                                      */
/* ========================================================================== */
console.log('\nTHE PLATFORM SEES THE CHURN')
{
  await db.execute(
    `UPDATE subscriptions
        SET status = 'active', current_period_end = NOW() + INTERVAL 10 DAY
      WHERE clinic_id = ?`,
    [clinic.id]
  )

  const [[owner]] = await db.execute("SELECT email FROM users WHERE role = 'platform' LIMIT 1")
  const s = makeSession()
  const who = await s.signIn(PLATFORM, { email: owner.email, password: 'owner123' })

  if (who?.role !== 'platform') {
    check(false, 'signed in as the platform owner', 'seed password may have changed')
  } else {
    const page = await s.req(PLATFORM, '/platform/clinics')
    const body = await page.text()
    check(/cancelling/i.test(body), 'a pending cancellation is visible on the clinic list')
    check(/switching/i.test(body), 'with the reason they gave, so a call can be targeted')
  }
}

/* ========================================================================== */
console.log('\nCleaning up…')
await teardown()
check(true, 'test clinic removed')

await db.end()

console.log(
  failures === 0
    ? '\n✓ CANCELLATION WORKS\n'
    : `\n✗ ${failures} FAILURE(S)\n`
)
process.exit(failures === 0 ? 0 : 1)
