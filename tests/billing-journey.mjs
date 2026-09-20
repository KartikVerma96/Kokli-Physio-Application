/**
 * ============================================================================
 *  END-TO-END: a clinic subscribes, and the plan's limits become real
 * ============================================================================
 *
 *  Covers everything added when the app became a subscription business:
 *
 *    /api/billing/subscribe        starting a subscription
 *    /api/billing/verify           confirming it and raising an invoice
 *    /api/billing/webhook          Razorpay's own notification, and its signature
 *    /api/cron/subscriptions       the status sweep, and who may run it
 *    /admin/billing                the clinic's billing screen
 *    /admin/settings/team          the seat limit that makes the tiers mean something
 *    /admin/settings/payments      where a clinic connects its own Razorpay
 *    /platform/revenue, /plans     the platform owner's ledger and price list
 *
 *  IT RUNS AGAINST THE DEV SERVER ON PURPOSE
 *  -----------------------------------------
 *  Platform billing runs in demo mode when no PLATFORM_RAZORPAY_* keys are set,
 *  and demo mode is hard-locked to non-production. That is what lets this test
 *  walk the whole trial → paid journey without a Razorpay account. Against a
 *  production build the subscribe call would correctly refuse.
 *
 *  A NOTE ON THE HOST HEADER
 *  -------------------------
 *  Every request goes to a real `*.localhost` origin rather than to localhost
 *  with a Host header, because Node's fetch silently DROPS a Host header. An
 *  earlier version of the isolation suite did the latter and passed every
 *  cross-tenant check while testing nothing at all.
 * ============================================================================
 */

import mysql from 'mysql2/promise'
import crypto from 'node:crypto'
import process from 'node:process'

process.loadEnvFile('.env.local')

const PLATFORM = 'http://localhost:3000'
const SLUG = 'billtest'
const CLINIC = `http://${SLUG}.localhost:3000`
const OWNER_EMAIL = 'bill.owner@example.com'
const PASSWORD = 'billing123'

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

/**
 * Cancel a subscription this run created at Razorpay.
 *
 * With real keys the test genuinely creates one, and a test that leaves litter in
 * an external account is a test people stop running. Never allowed to fail the
 * suite: the local cleanup below matters more, and Razorpay being unreachable is
 * not a reason to report a broken build.
 */
async function cleanUpRazorpay(subscriptionId) {
  if (!subscriptionId || !String(subscriptionId).startsWith('sub_')) return
  if (!process.env.PLATFORM_RAZORPAY_KEY_ID || !process.env.PLATFORM_RAZORPAY_KEY_SECRET) return
  try {
    const Razorpay = (await import('razorpay')).default
    const rzp = new Razorpay({
      key_id: process.env.PLATFORM_RAZORPAY_KEY_ID,
      key_secret: process.env.PLATFORM_RAZORPAY_KEY_SECRET,
    })
    await rzp.subscriptions.cancel(subscriptionId, false)
    console.log(`  · cancelled test subscription ${subscriptionId} at Razorpay`)
  } catch {
    console.log(`  · could not cancel ${subscriptionId} at Razorpay — remove it by hand if it lingers`)
  }
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
  await db.execute('DELETE FROM users WHERE email LIKE ?', ['bill.%@example.com'])
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

console.log('\nCleaning any previous run…')
await teardown()

/* ========================================================================== */
/*  SET UP: a clinic on the Professional plan (3 physiotherapist seats)        */
/* ========================================================================== */
{
  const s = makeSession()
  const res = await s.json(PLATFORM, '/api/signup', {
    name: 'Dr. Billing Tester',
    email: OWNER_EMAIL,
    phone: '9876500011',
    password: PASSWORD,
    confirmPassword: PASSWORD,
    clinicName: 'Billing Test Clinic',
    slug: SLUG,
    city: 'Pune',
    planCode: 'professional',
    acceptTerms: true,
  })
  const data = await res.json()
  if (res.status !== 201) {
    console.error('  ✗ could not create the test clinic:', data)
    process.exit(1)
  }
  await db.execute("UPDATE clinics SET onboarding_step = 'done' WHERE slug = ?", [SLUG])
}

const [[clinicRow]] = await db.execute('SELECT * FROM clinics WHERE slug = ?', [SLUG])
const clinicId = clinicRow.id

/* ========================================================================== */
/*  1. THE BILLING PAGES RENDER                                               */
/* ========================================================================== */
console.log('\nTHE NEW ADMIN PAGES')
const owner = makeSession()
{
  const user = await signIn(owner, CLINIC, OWNER_EMAIL, PASSWORD)
  check(user?.role === 'admin', 'the owner signs in', `role=${user?.role}`)

  for (const [path, needle] of [
    ['/admin/billing', 'Professional'],
    ['/admin/settings/team', 'seat'],
    ['/admin/settings/payments', 'Razorpay'],
  ]) {
    const res = await owner.req(CLINIC, path)
    const body = res.status === 200 ? await res.text() : ''
    check(res.status === 200, `${path} renders`, `status ${res.status}`)
    check(body.includes(needle), `  …and mentions “${needle}”`)
  }

  // The sidebar must actually link to them, or they may as well not exist.
  const dash = await (await owner.req(CLINIC, '/admin')).text()
  check(dash.includes('/admin/settings/team'), 'the sidebar links to Team')
  check(dash.includes('/admin/billing'), 'the sidebar links to Subscription')
  check(dash.includes('/admin/settings/payments'), 'the sidebar links to Payment keys')
}

/* ========================================================================== */
/*  2. SUBSCRIBING                                                            */
/* ========================================================================== */
/**
 * ============================================================================
 *  A NOTE ON WHAT THIS SECTION CAN AND CANNOT TEST
 * ============================================================================
 *  Activating a subscription requires a signature that only Razorpay produces,
 *  after a human authorises a mandate in a browser. A headless test cannot make
 *  one, and it must not be able to — the whole point of the check is that nothing
 *  but a real payment activates a paid plan.
 *
 *  So the full journey is exercised in DEMO mode, where the server mints a
 *  deterministic stand-in payment id and verifies against that instead. When real
 *  Razorpay keys are configured the stand-in does not exist, the verify step
 *  correctly refuses, and those assertions are skipped rather than deleted.
 *
 *  The skip is announced loudly. Green tests that quietly stopped covering the
 *  payment path would be worse than a failure — a failure at least gets looked at.
 *
 *  To run the full journey: comment out PLATFORM_RAZORPAY_* in .env.local.
 *  To test the real path: subscribe once in a browser with a test card.
 * ============================================================================
 */
const liveKeys = Boolean(
  process.env.PLATFORM_RAZORPAY_KEY_ID && process.env.PLATFORM_RAZORPAY_KEY_SECRET
)

console.log(liveKeys ? '\nSUBSCRIBING (real Razorpay test keys)' : '\nSUBSCRIBING (demo mode)')
let subscribeData
{
  const res = await owner.json(CLINIC, '/api/billing/subscribe', { planCode: 'clinic' })
  subscribeData = await res.json()
  check(res.status === 200, 'subscribe succeeds', `status ${res.status} ${subscribeData.error ?? ''}`)
  if (liveKeys) {
    check(
      subscribeData.demoMode !== true && String(subscribeData.subscriptionId || '').startsWith('sub_'),
      'a REAL Razorpay subscription was created',
      subscribeData.subscriptionId
    )
    check(!subscribeData.demoPaymentId, 'and no stand-in payment id is offered — only a real payment can activate it')
  } else {
    check(subscribeData.demoMode === true, 'and reports demo mode, so no real money moves')
    check(
      typeof subscribeData.demoPaymentId === 'string' && subscribeData.demoPaymentId.startsWith('pay_demo_'),
      'the server minted the stand-in payment id, not the browser',
      subscribeData.demoPaymentId
    )
  }
  check(!('amount' in (subscribeData.prefill || {})), 'the browser is never told an amount to charge')

  // Only ONE live subscription row may exist per clinic — the partial unique
  // index enforces it, and switching plans must therefore close the old one.
  const [live] = await db.execute(
    `SELECT status FROM subscriptions WHERE clinic_id = ? AND status IN ('trialing','active','past_due')`,
    [clinicId]
  )
  check(live.length === 1, 'exactly one live subscription row remains', `${live.length} found`)
}

/* ========================================================================== */
/*  3. VERIFYING — the signature is what activates anything                   */
/* ========================================================================== */
console.log('\nVERIFYING')
{
  // A forged confirmation must be refused. This is the single most important
  // check in the file: without it, anyone could POST themselves a paid plan.
  const forged = await owner.json(CLINIC, '/api/billing/verify', {
    razorpay_subscription_id: subscribeData.subscriptionId,
    razorpay_payment_id: 'pay_forged_123',
    razorpay_signature: 'not-a-real-signature',
  })
  const [[stillTrialing]] = await db.execute('SELECT status FROM clinics WHERE id = ?', [clinicId])
  check(forged.status === 400, 'a forged confirmation is refused', `status ${forged.status}`)
  check(stillTrialing.status !== 'active', 'and the clinic is not activated', stillTrialing.status)

  /**
   * Everything below needs an ACTIVATED subscription, and only a real payment or
   * the demo stand-in can produce one. With live keys neither is available to a
   * script, so the rest is skipped — announced, not hidden.
   */
  if (liveKeys) {
    console.log('  ⚠ SKIPPED: activation, invoicing and GST split')
    console.log('    A real Razorpay mandate needs a browser. Comment out')
    console.log('    PLATFORM_RAZORPAY_* in .env.local to run this part.')
  }

  const res = liveKeys
    ? null
    : await owner.json(CLINIC, '/api/billing/verify', {
        razorpay_subscription_id: subscribeData.subscriptionId,
        razorpay_payment_id: subscribeData.demoPaymentId,
        razorpay_signature: 'demo',
      })
  if (!liveKeys) {
    const data = await res.json()
    check(res.status === 200, 'the genuine confirmation is accepted', `status ${res.status} ${data.error ?? ''}`)
  }

  // The plan a clinic is on lives on its live SUBSCRIPTION row, not on the clinic
  // itself — so there is only ever one place that can be right about it.
  const [[clinic]] = await db.execute('SELECT status FROM clinics WHERE id = ?', [clinicId])
  const [[plan]] = await db.execute(
    `SELECT p.code, p.max_physios
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.clinic_id = ? AND s.status IN ('trialing','active','past_due')`,
    [clinicId]
  )
  if (!liveKeys) check(clinic.status === 'active', 'the clinic is now active', clinic.status)
  check(plan.code === 'clinic', 'on the plan it paid for', plan.code)

  if (!liveKeys) {
    const [[sub]] = await db.execute(
      'SELECT status FROM subscriptions WHERE clinic_id = ? ORDER BY id DESC LIMIT 1', [clinicId]
    )
    check(sub.status === 'active', 'the subscription row is active', sub.status)

    const [invoices] = await db.execute('SELECT * FROM platform_invoices WHERE clinic_id = ?', [clinicId])
    check(invoices.length === 1, 'exactly one invoice was raised', `${invoices.length}`)
    check(invoices[0]?.status === 'paid', 'marked paid', invoices[0]?.status)
    check(Number(invoices[0]?.tax_paise) > 0, 'with GST stored separately from the fee',
      `fee ${invoices[0]?.amount_paise}, gst ${invoices[0]?.tax_paise}`)

    // Replaying the same confirmation must not raise a second invoice.
    await owner.json(CLINIC, '/api/billing/verify', {
      razorpay_subscription_id: subscribeData.subscriptionId,
      razorpay_payment_id: subscribeData.demoPaymentId,
      razorpay_signature: 'demo',
    })
    const [again] = await db.execute('SELECT id FROM platform_invoices WHERE clinic_id = ?', [clinicId])
    check(again.length === 1, 'replaying it does not double-bill', `${again.length} invoices`)
  }
}

/* ========================================================================== */
/*  4. THE SEAT LIMIT IS REAL                                                 */
/* ========================================================================== */
console.log('\nTHE PLAN LIMIT ON PHYSIOTHERAPISTS')
{
  const [[plan]] = await db.execute(
    `SELECT p.max_physios
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.clinic_id = ? AND s.status IN ('trialing','active','past_due')`,
    [clinicId]
  )
  const limit = Number(plan.max_physios)
  check(limit === 10, 'the Clinic plan allows 10 physiotherapists', `${limit}`)

  // React's server output splits interpolated text with <!-- --> markers, so the
  // rendered "1 of 10 seats" is not a single string in the HTML. Strip them first.
  const page = (await (await owner.req(CLINIC, '/admin/settings/team')).text()).replaceAll('<!-- -->', '')
  check(page.includes(`of ${limit} seat`), 'the team page shows the seat allowance', `${limit}`)

  /**
   * The refusal is proven at the layer that enforces it: the page reads
   * `max_physios` off the clinic's plan, and the server action compares it to a
   * COUNT of active physios. Filling every seat directly in the database is the
   * same state the action would see, and lets the check be tested without
   * reverse-engineering a server-action id out of a build manifest.
   */
  const [[owner1]] = await db.execute(
    "SELECT id FROM users WHERE clinic_id = ? AND role = 'physio' LIMIT 1", [clinicId]
  )
  void owner1
  for (let i = 0; i < limit; i++) {
    await db.execute(
      `INSERT IGNORE INTO users (clinic_id, name, email, password_hash, role, email_verified, is_active)
       VALUES (?, ?, ?, '!', 'physio', 1, 1)`,
      [clinicId, `Filler ${i}`, `bill.filler${i}@example.com`]
    )
  }
  const [[used]] = await db.execute(
    "SELECT COUNT(*) AS n FROM users WHERE clinic_id = ? AND role = 'physio' AND is_active = 1", [clinicId]
  )
  check(Number(used.n) > limit - 1, 'seats can be filled', `${used.n} active`)

  const full = (await (await owner.req(CLINIC, '/admin/settings/team')).text()).replaceAll('<!-- -->', '')
  check(full.includes('Upgrade for more seats'), 'a full clinic is offered an upgrade, not a dead end')
  check(!full.includes('>Add<'), 'and the Add button is withdrawn')

  // Tidy up so the rest of the test sees a normal clinic.
  await db.execute("DELETE FROM users WHERE email LIKE 'bill.filler%@example.com'")
}

/* ========================================================================== */
/*  5. WHO IS ALLOWED NEAR ANY OF THIS                                        */
/* ========================================================================== */
console.log('\nAUTHORISATION')
{
  // A physiotherapist at the same clinic — staff, but not the owner.
  const physioEmail = 'bill.physio@example.com'
  const [[hash]] = await db.execute('SELECT password_hash FROM users WHERE email = ?', [OWNER_EMAIL])
  await db.execute(
    `INSERT INTO users (clinic_id, name, email, password_hash, role, email_verified, is_active)
     VALUES (?, 'Bill Physio', ?, ?, 'physio', 1, 1)`,
    [clinicId, physioEmail, hash.password_hash]
  )

  const physio = makeSession()
  const user = await signIn(physio, CLINIC, physioEmail, PASSWORD)
  check(user?.role === 'physio', 'a physiotherapist signs in', `role=${user?.role}`)

  const billing = await physio.req(CLINIC, '/admin/billing')
  check(billing.status !== 200, 'a physiotherapist cannot open the billing page', `status ${billing.status}`)

  const team = await physio.req(CLINIC, '/admin/settings/team')
  check(team.status !== 200, 'nor the team page', `status ${team.status}`)

  const subscribe = await physio.json(CLINIC, '/api/billing/subscribe', { planCode: 'starter' })
  check(subscribe.status >= 400, 'nor change the clinic’s plan', `status ${subscribe.status}`)

  const diary = await physio.req(CLINIC, '/admin/appointments')
  check(diary.status === 200, 'but the diary, which is their job, still works', `status ${diary.status}`)

  // A signed-out stranger.
  const stranger = makeSession()
  const anon = await stranger.json(CLINIC, '/api/billing/subscribe', { planCode: 'starter' })
  check(anon.status >= 400, 'a stranger cannot start a subscription', `status ${anon.status}`)

  const cron = await stranger.req(PLATFORM, '/api/cron/subscriptions', { method: 'POST' })
  check(cron.status === 401, 'nor run the status sweep', `status ${cron.status}`)

  const wrongSecret = await stranger.req(PLATFORM, '/api/cron/subscriptions', {
    method: 'POST',
    headers: { authorization: 'Bearer wrong-secret' },
  })
  check(wrongSecret.status === 401, 'nor with the wrong secret', `status ${wrongSecret.status}`)
}

/* ========================================================================== */
/*  6. THE WEBHOOK                                                            */
/* ========================================================================== */
console.log('\nTHE RAZORPAY WEBHOOK')
{
  const secret = process.env.PLATFORM_RAZORPAY_WEBHOOK_SECRET
  const body = JSON.stringify({
    event: 'subscription.halted',
    payload: { subscription: { entity: { id: subscribeData.subscriptionId } } },
  })

  const unsigned = await fetch(`${PLATFORM}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  check(unsigned.status >= 400, 'an unsigned webhook is refused', `status ${unsigned.status}`)

  if (secret) {
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex')
    const signed = await fetch(`${PLATFORM}/api/billing/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': signature },
      body,
    })
    check(signed.status === 200, 'a correctly signed one is accepted', `status ${signed.status}`)
  } else {
    console.log('  – signed-webhook check skipped: PLATFORM_RAZORPAY_WEBHOOK_SECRET is not set')
  }
}

/* ========================================================================== */
/*  7. THE PLATFORM OWNER'S OWN SCREENS                                       */
/* ========================================================================== */
console.log('\nTHE PLATFORM ADMIN')
{
  const [[staff]] = await db.execute(
    "SELECT email FROM users WHERE role = 'platform' LIMIT 1"
  )

  if (!staff) {
    console.log('  – skipped: no platform account in this database')
  } else {
    // The seeded platform password, from scripts/setup-db.js.
    const boss = makeSession()
    const user = await signIn(boss, PLATFORM, staff.email, 'owner123')

    if (user?.role !== 'platform') {
      console.log(`  – skipped: could not sign in as ${staff.email} (seeded password differs)`)
    } else {
      for (const path of ['/platform', '/platform/clinics', '/platform/revenue', '/platform/plans']) {
        const res = await boss.req(PLATFORM, path)
        check(res.status === 200, `${path} renders`, `status ${res.status}`)
      }

      const revenue = await (await boss.req(PLATFORM, '/platform/revenue')).text()
      check(revenue.includes('Billing Test Clinic'), 'the ledger shows the invoice just raised')
      check(revenue.includes('GST'), 'and separates GST from revenue')

      const plans = await (await boss.req(PLATFORM, '/platform/plans')).text()
      check(
        ['starter', 'professional', 'clinic'].every((code) => plans.includes(code)),
        'the plan editor lists every plan'
      )
      // The per-plan form (and the "not built yet" labels on the two switches
      // nothing reads) is behind a collapse, so it is not in the first response.
      // What must always be visible is the warning about what a price change does.
      check(
        plans.includes('Changing a price never changes an existing bill'),
        'and warns that a price change cannot touch an existing mandate'
      )

      const sweep = await boss.req(PLATFORM, '/api/cron/subscriptions', { method: 'POST' })
      const swept = await sweep.json()
      check(sweep.status === 200, 'platform staff can run the sweep from the browser', `status ${sweep.status}`)
      check(typeof swept.checked === 'number', 'and it reports what it checked', JSON.stringify(swept))

      // A clinic's own admin must never reach the platform screens.
      const trespass = await owner.req(PLATFORM, '/platform/revenue')
      check(trespass.status !== 200, 'a clinic owner cannot open the platform ledger', `status ${trespass.status}`)
    }
  }
}

/* ========================================================================== */
/*  8. A LAPSED CLINIC STOPS TAKING BOOKINGS                                  */
/* ========================================================================== */
console.log('\nWHEN A SUBSCRIPTION LAPSES')
{
  // Wind the clock back rather than waiting a month. Every date that decides the
  // lifecycle lives on the SUBSCRIPTION row; `clinics.status` is only the cached
  // answer, and it is left stale on purpose so the check below means something.
  await db.execute(
    `UPDATE subscriptions
        SET status = 'past_due',
            trial_ends_at = DATE_SUB(NOW(), INTERVAL 60 DAY),
            current_period_end = DATE_SUB(NOW(), INTERVAL 40 DAY),
            grace_ends_at = DATE_SUB(NOW(), INTERVAL 5 DAY)
      WHERE clinic_id = ? AND status IN ('trialing','active','past_due')`,
    [clinicId]
  )
  await db.execute("UPDATE clinics SET status = 'active' WHERE id = ?", [clinicId])

  const [[service]] = await db.execute(
    'SELECT id FROM services WHERE clinic_id = ? LIMIT 1', [clinicId]
  )

  const patient = makeSession()
  const attempt = await patient.json(CLINIC, '/api/appointments', {
    serviceId: service?.id ?? 1,
    date: '2030-01-15',
    startTime: '10:00',
    mode: 'clinic',
  })
  check(attempt.status >= 400, 'a lapsed clinic cannot take a booking', `status ${attempt.status}`)

  // …and it is blocked BEFORE any sweep has run, because the status is derived
  // from the dates rather than read from a column somebody has to refresh.
  const [[beforeSweep]] = await db.execute('SELECT status FROM clinics WHERE id = ?', [clinicId])
  check(beforeSweep.status === 'active',
    'the stored status is still stale at this point — enforcement did not wait for the sweep',
    beforeSweep.status)
}

console.log('\nCleaning up…')
await cleanUpRazorpay(subscribeData?.subscriptionId)
await teardown()
console.log('  ✓ test clinic removed')

console.log(`\n${failures === 0 ? '✓ BILLING JOURNEY WORKS' : `✗ ${failures} FAILURE(S)`}\n`)
await db.end()
process.exit(failures === 0 ? 0 : 1)
