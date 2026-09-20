import crypto from 'node:crypto'
import Razorpay from 'razorpay'
import { platform } from '@/config/platform'

/**
 * ============================================================================
 *  PLATFORM BILLING — the clinic pays YOU
 * ============================================================================
 *
 *  DO NOT CONFUSE THIS WITH lib/razorpay.js
 *  ----------------------------------------
 *  There are two completely separate money flows in this application, and
 *  keeping them in two files with two sets of credentials is the whole point:
 *
 *      lib/razorpay.js        patient → CLINIC   the clinic's own keys
 *      lib/platformBilling.js clinic  → YOU      your keys, from the environment
 *
 *  Mixing them would mean a bug in one could charge money into the other's
 *  account. Different file, different credentials, different table
 *  (`platform_invoices` rather than `payments`).
 *
 *  ---------------------------------------------------------------------------
 *  WHY SUBSCRIPTIONS AND NOT JUST A MONTHLY ORDER
 *  ---------------------------------------------------------------------------
 *  A one-off Razorpay order charges once. To take ₹499 every month you would
 *  have to ask the clinic to pay again by hand, every month, forever — and most
 *  would forget, so you would spend your life chasing invoices.
 *
 *  A Razorpay SUBSCRIPTION sets up a mandate: the customer authorises recurring
 *  debits once (UPI AutoPay, or a card mandate), and Razorpay charges them on
 *  schedule and tells you what happened by webhook. That is the difference
 *  between a business and a hobby.
 *
 *  THE SHAPE OF IT
 *  ---------------
 *      PLAN          created once per price point, in YOUR Razorpay account
 *      SUBSCRIPTION  created per clinic, pointing at a plan
 *      the mandate   authorised by the clinic in Razorpay's checkout
 *      webhooks      subscription.charged / .halted / .cancelled
 *
 *  Razorpay plans are immutable, so a price change means creating a NEW Razorpay
 *  plan — which is why `plans.razorpay_plan_id` is looked up lazily and cached
 *  rather than assumed to exist.
 *
 *  DEMO MODE
 *  ---------
 *  Without platform Razorpay keys, subscriptions are simulated so the whole
 *  trial → paid flow can be walked through locally. Hard-locked to
 *  non-production, exactly as in lib/razorpay.js — a missing key in production
 *  must never make subscriptions free.
 * ============================================================================
 */

/** Are the PLATFORM's own Razorpay keys configured? */
export function isPlatformBillingConfigured() {
  return Boolean(
    process.env.PLATFORM_RAZORPAY_KEY_ID?.startsWith('rzp_') &&
      process.env.PLATFORM_RAZORPAY_KEY_SECRET
  )
}

export function isBillingDemoMode() {
  return !isPlatformBillingConfigured() && process.env.NODE_ENV !== 'production'
}

let client = null
function getClient() {
  if (!isPlatformBillingConfigured()) {
    throw new Error(
      'Platform billing is not configured. Set PLATFORM_RAZORPAY_KEY_ID and PLATFORM_RAZORPAY_KEY_SECRET.'
    )
  }
  // Safe to cache, unlike the per-clinic client in lib/razorpay.js: there is
  // only ever ONE platform account, so there is no tenant to mix up.
  if (!client) {
    client = new Razorpay({
      key_id: process.env.PLATFORM_RAZORPAY_KEY_ID,
      key_secret: process.env.PLATFORM_RAZORPAY_KEY_SECRET,
    })
  }
  return client
}

/** The public key id, for the subscription checkout in the browser. */
export function platformPublicKeyId() {
  return process.env.PLATFORM_RAZORPAY_KEY_ID || ''
}

/* ========================================================================== */
/*  RAZORPAY PLANS                                                            */
/* ========================================================================== */

/**
 * Find or create the Razorpay plan matching one of our rows.
 *
 * Razorpay plans cannot be edited once created — change the amount and you must
 * create a new one. So this is keyed on the amount as well as the code: raising
 * Starter from ₹499 to ₹599 produces a brand-new Razorpay plan, and clinics
 * already subscribed to the old one keep paying ₹499 until they change plan.
 * That is the correct behaviour, and it falls out of the design rather than
 * needing to be handled.
 */
export async function ensureRazorpayPlan(plan) {
  if (isBillingDemoMode()) {
    return `plan_demo_${plan.code}_${plan.price_paise}`
  }

  const created = await getClient().plans.create({
    period: plan.billing_period === 'yearly' ? 'yearly' : 'monthly',
    interval: 1,
    item: {
      name: `${platform.name} — ${plan.name}`,
      amount: plan.price_paise,
      currency: 'INR',
      description: plan.tagline || `${plan.name} plan`,
    },
    notes: { plan_code: plan.code, platform: platform.name },
  })

  return created.id
}

/* ========================================================================== */
/*  SUBSCRIPTIONS                                                             */
/* ========================================================================== */

/**
 * Start a subscription for a clinic.
 *
 * `total_count` is Razorpay's required maximum number of billing cycles — it has
 * no "forever" option. 120 months is ten years, which is effectively forever for
 * a business relationship and avoids an unbounded mandate the clinic cannot
 * reason about.
 *
 * `customer_notify: 1` lets Razorpay send its own payment emails, which matters
 * because this application does not send email at all yet.
 */
export async function createPlatformSubscription({ clinic, plan, razorpayPlanId }) {
  if (isBillingDemoMode()) {
    return {
      id: `sub_demo_${clinic.id}_${Date.now()}`,
      status: 'created',
      short_url: null,
      demo: true,
    }
  }

  return getClient().subscriptions.create({
    plan_id: razorpayPlanId,
    total_count: plan.billing_period === 'yearly' ? 10 : 120,
    quantity: 1,
    customer_notify: 1,
    notes: {
      clinic_id: String(clinic.id),
      clinic_slug: clinic.slug,
      clinic_name: clinic.name,
      plan_code: plan.code,
    },
  })
}

export async function fetchPlatformSubscription(subscriptionId) {
  if (isBillingDemoMode()) {
    return { id: subscriptionId, status: 'active', current_end: null }
  }
  return getClient().subscriptions.fetch(subscriptionId)
}

/**
 * Cancel a subscription.
 *
 * `cancelAtCycleEnd` defaults to TRUE, and that default is deliberate: a clinic
 * cancelling on day 3 of a month they have already paid for keeps the rest of
 * the month. Cutting them off immediately would be taking money for nothing,
 * and it is the kind of thing people write reviews about.
 */
export async function cancelPlatformSubscription(subscriptionId, cancelAtCycleEnd = true) {
  if (isBillingDemoMode()) {
    return { id: subscriptionId, status: cancelAtCycleEnd ? 'active' : 'cancelled' }
  }
  return getClient().subscriptions.cancel(subscriptionId, cancelAtCycleEnd)
}

/* ========================================================================== */
/*  SIGNATURE VERIFICATION                                                    */
/* ========================================================================== */

/**
 * The stand-in payment id for a demo subscription.
 *
 * Derived from the subscription id rather than random, so it is the same value
 * every time — which is what lets the demo path be verified rather than simply
 * trusted, and makes a replayed confirmation land on the idempotency check
 * instead of raising a second invoice.
 */
export function demoPaymentIdFor(subscriptionId) {
  return `pay_demo_${String(subscriptionId || '').replace(/^sub_/, '')}`
}

/**
 * Verify the handshake Razorpay Checkout returns after a mandate is authorised.
 *
 * NOTE THE ARGUMENT ORDER. For one-off payments the HMAC is over
 * `order_id|payment_id`. For subscriptions it is `payment_id|subscription_id` —
 * payment FIRST. Getting this backwards produces a signature that never
 * verifies, and the error message tells you nothing about why.
 */
export function verifySubscriptionSignature({ subscriptionId, paymentId, signature }) {
  /**
   * Demo mode has no Razorpay and therefore no real signature to check. It still
   * must not accept just anything: without the check below, POSTing arbitrary
   * values to /api/billing/verify would activate a paid plan.
   *
   * That could never reach production — demo mode is locked to non-production
   * above — but "it cannot happen in production" is a poor reason to leave an
   * endpoint that hands out subscriptions to whatever it is sent. So the demo
   * path accepts exactly one thing: the stand-in id the server itself derived
   * from the subscription, echoed back unchanged.
   */
  if (isBillingDemoMode()) {
    return paymentId === demoPaymentIdFor(subscriptionId) && signature === 'demo'
  }

  if (!subscriptionId || !paymentId || !signature) return false

  const expected = crypto
    .createHmac('sha256', process.env.PLATFORM_RAZORPAY_KEY_SECRET)
    .update(`${paymentId}|${subscriptionId}`)
    .digest('hex')

  return timingSafeEqual(expected, signature)
}

/** Verify a platform webhook. The body must be the RAW request text. */
export function verifyPlatformWebhook({ rawBody, signature }) {
  const secret = process.env.PLATFORM_RAZORPAY_WEBHOOK_SECRET
  if (!secret || !signature) return false

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  return timingSafeEqual(expected, signature)
}

/**
 * Compare without leaking information through timing.
 *
 * A plain `===` returns as soon as it finds a differing character, so a
 * signature starting with the right byte takes measurably longer to reject.
 * Repeated enough times that difference reconstructs the value one byte at a
 * time. Two lines, and the correct habit for every signature comparison.
 */
function timingSafeEqual(a, b) {
  const bufferA = Buffer.from(String(a), 'utf8')
  const bufferB = Buffer.from(String(b), 'utf8')
  if (bufferA.length !== bufferB.length) return false
  return crypto.timingSafeEqual(bufferA, bufferB)
}

/* ========================================================================== */
/*  INVOICE NUMBERING                                                         */
/* ========================================================================== */

/**
 * Build the next invoice number: INV-2026-0042.
 *
 * Sequential per year, because tax authorities expect an unbroken series and
 * "the 42nd invoice of 2026" is something a human can hold in their head. A
 * random id would be unique but useless in a conversation with an accountant.
 *
 * Derived from a COUNT inside the caller's transaction, so two invoices raised
 * in the same second cannot collide — and `platform_invoices.number` carries a
 * UNIQUE index as the backstop if they somehow do.
 */
export function invoiceNumber(year, sequence) {
  return `INV-${year}-${String(sequence).padStart(4, '0')}`
}

/**
 * India charges GST on SaaS. Computed on the exclusive amount and stored on the
 * invoice, never recalculated on read — if the rate changes, old invoices must
 * keep the rate that was actually charged.
 */
export function gstOn(amountPaise) {
  return Math.round((amountPaise * platform.gstPercent) / 100)
}
