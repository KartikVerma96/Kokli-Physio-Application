import crypto from 'node:crypto'
import Razorpay from 'razorpay'
import { decryptSecret } from '@/lib/crypto'

/**
 * ============================================================================
 *  PAYMENTS — RAZORPAY
 * ============================================================================
 *
 *  HOW A RAZORPAY PAYMENT ACTUALLY WORKS
 *  -------------------------------------
 *  There are three parties and the sequence matters, because the whole security
 *  model rests on it.
 *
 *   1. Our server asks Razorpay to create an ORDER for ₹800. Razorpay returns
 *      an order_id. This happens server-side with our secret key, so the amount
 *      is fixed by us and cannot be tampered with.
 *
 *   2. The browser opens Razorpay Checkout with that order_id and our PUBLIC
 *      key id. The patient types their card or UPI details into Razorpay's own
 *      iframe. We never see or touch their card details — which is precisely
 *      why we do not need PCI-DSS certification.
 *
 *   3. On success, Razorpay hands the browser three values: order_id,
 *      payment_id and a SIGNATURE. Our server recomputes that signature using
 *      the secret key. If it matches, the payment is genuine.
 *
 *  WHY STEP 3 IS THE WHOLE BALL GAME
 *  ---------------------------------
 *  A dishonest patient can open devtools and call our /api/payments/verify
 *  endpoint by hand, claiming "I paid, here is order xyz". Without signature
 *  verification we would confirm a free appointment.
 *
 *  The signature is HMAC-SHA256 of "order_id|payment_id", keyed with our secret.
 *  Only Razorpay and our server know that secret, so only they can produce a
 *  valid signature — and it cannot be worked backwards from a valid one. This is
 *  why RAZORPAY_KEY_SECRET must never appear in client code, and why the key id
 *  (which is safe to expose) is the only one with a NEXT_PUBLIC_ prefix.
 *
 *  ---------------------------------------------------------------------------
 *  WHAT MULTI-TENANCY CHANGED: THE KEYS BELONG TO THE CLINIC, NOT TO US
 *  ---------------------------------------------------------------------------
 *  Every function here now takes a `clinic` and uses THAT clinic's Razorpay
 *  credentials, read from their row and decrypted (see lib/crypto.js).
 *
 *  This is the most important business decision in the whole platform. Patient
 *  money goes straight from the patient to the clinic's own Razorpay account and
 *  settles into the clinic's own bank. It never touches us.
 *
 *  Two consequences worth being explicit about:
 *
 *    LEGAL     Holding other businesses' takings would make the platform a
 *              payment aggregator, which in India means RBI licensing. Routing
 *              money directly avoids that entirely.
 *
 *    PRACTICAL Refunds, chargebacks and settlement delays are between the clinic
 *              and Razorpay. We are not in the middle of an argument about
 *              somebody else's ₹800.
 *
 *  The platform's OWN revenue — subscriptions — uses a completely separate set of
 *  credentials from the environment. See lib/platformBilling.js.
 *
 *  TEST MODE
 *  ---------
 *  Razorpay test keys are free and instant. Use UPI id `success@razorpay`, or
 *  card 4111 1111 1111 1111 with any future expiry and any CVV. No real money
 *  moves. See .env.example for how to get the keys.
 * ============================================================================
 */

/**
 * ONE CLINIC'S RAZORPAY CREDENTIALS.
 *
 * The key id is stored in plain text — it only identifies an account and is sent
 * to the browser anyway. The SECRET is stored encrypted (AES-256-GCM, see
 * lib/crypto.js) and decrypted here, at the last possible moment, because a
 * leaked database must not hand an attacker the ability to move other
 * businesses' money.
 *
 * Returns null when the clinic has not connected an account yet. Every caller
 * treats that as "not configured" rather than throwing, so a clinic mid-setup
 * gets demo mode and a clear notice instead of a stack trace.
 */
function credentials(clinic) {
  const keyId = clinic?.razorpay_key_id || ''
  if (!keyId) return null

  const keySecret = decryptSecret(clinic.razorpay_key_secret_enc)
  if (!keySecret) return null

  return { keyId, keySecret }
}

/**
 * Has THIS clinic connected a real Razorpay account?
 *
 * Note the placeholder detection. An earlier single-tenant version of this
 * function read the environment, and .env.example ships with
 * `rzp_test_xxxxxxxxxxxxxx` — which starts with `rzp_` and is indistinguishable
 * from a real key to a naive check. The same trap exists now that clinics type
 * their own keys in: somebody will paste the example value out of the docs.
 *
 * A configuration mistake should degrade to demo mode with a visible notice, not
 * produce a checkout that fails with an opaque "Authentication failed" from
 * Razorpay's API.
 */
export function isPaymentConfigured(clinic) {
  const creds = credentials(clinic)
  if (!creds) return false

  const looksLikePlaceholder = (value) =>
    value === '' ||
    /x{4,}/i.test(value) ||          // rzp_test_xxxxxxxxxxxxxx
    /^your[_-]/i.test(value) ||      // your_razorpay_secret_here
    value.includes('here')

  if (looksLikePlaceholder(creds.keyId) || looksLikePlaceholder(creds.keySecret)) return false

  // A real Razorpay key id is `rzp_test_` or `rzp_live_` followed by 14 characters.
  return creds.keyId.startsWith('rzp_') && creds.keyId.length >= 20 && creds.keySecret.length >= 16
}

/**
 * DEMO MODE
 *
 * Without Razorpay keys the app would be unusable — you could never get past
 * the payment step to see the video consultation. So when keys are absent AND we
 * are not in production, payments are simulated: the checkout step succeeds
 * immediately and the appointment is confirmed.
 *
 * The `NODE_ENV !== 'production'` half of that condition is a hard safety
 * interlock, not a stylistic choice. Without it, deploying with a missing
 * environment variable would silently turn every appointment free.
 */
export function isDemoMode(clinic) {
  return !isPaymentConfigured(clinic) && process.env.NODE_ENV !== 'production'
}

/**
 * A Razorpay client for one clinic.
 *
 * Built per call rather than cached in a module variable. That is deliberate: a
 * cached client would be shared across every request in the Node process, and on
 * a multi-tenant server the next request is very likely a DIFFERENT clinic. One
 * clinic charging a patient with another clinic's keys would be about the worst
 * bug this codebase could have.
 *
 * Constructing it is cheap — it only stores two strings.
 */
function getClient(clinic) {
  const creds = credentials(clinic)
  if (!creds) {
    throw new Error(`Clinic ${clinic?.id ?? '?'} has not connected a Razorpay account.`)
  }
  return new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret })
}

/* -------------------------------------------------------------------------- */
/*  CREATING AN ORDER                                                         */
/* -------------------------------------------------------------------------- */

/**
 * @param {number} amountPaise  the amount in paise (₹800 → 80000)
 * @param {string} receipt      our own reference, e.g. the appointment code
 * @param {object} notes        metadata that comes back on the webhook
 */
export async function createOrder(clinic, { amountPaise, receipt, notes = {} }) {
  if (isDemoMode(clinic)) {
    /**
     * A fake order shaped exactly like a real one, so nothing downstream needs
     * to know the difference.
     *
     * THE RANDOM SUFFIX IS NOT DECORATION.
     * `order_demo_${Date.now()}` alone collides: two patients booking in the same
     * millisecond get the same id, and `payments.uq_razorpay_order` — quite
     * rightly — refuses the second, which surfaces to the patient as a 500 on a
     * slot that was genuinely free.
     *
     * Rare with one patient per slot. Routine once a clinic sets capacity to
     * three and four people race for the same time, which is exactly the case
     * this app now supports.
     */
    return {
      id: `order_demo_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      amount: amountPaise,
      currency: 'INR',
      receipt,
      status: 'created',
      demo: true,
    }
  }

  const order = await getClient(clinic).orders.create({
    // Razorpay works in the smallest currency unit — paise — which is exactly
    // why the database stores paise too. No conversion, no rounding, no bugs.
    amount: amountPaise,
    currency: 'INR',
    // Razorpay caps the receipt field at 40 characters.
    receipt: String(receipt).slice(0, 40),
    notes,
  })

  return order
}

/* -------------------------------------------------------------------------- */
/*  VERIFYING A PAYMENT                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Is this payment confirmation genuine?
 *
 * Recomputes the HMAC and compares. Returns true or false and never throws, so
 * the caller can treat any problem as "not verified".
 */
export function verifyPaymentSignature(clinic, { orderId, paymentId, signature }) {
  if (isDemoMode(clinic)) return true

  if (!orderId || !paymentId || !signature) return false

  const creds = credentials(clinic)
  if (!creds) return false

  const expected = crypto
    .createHmac('sha256', creds.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')

  return timingSafeEqual(expected, signature)
}

/**
 * Verify a webhook. The body must be the RAW request text, byte for byte —
 * parsing it to JSON and re-stringifying changes whitespace and key order, and
 * the signature then never matches. This is the single most common reason a
 * webhook integration mysteriously fails.
 */
export function verifyWebhookSignature(clinic, { rawBody, signature }) {
  const secret = decryptSecret(clinic?.razorpay_webhook_secret_enc)
  if (!secret || !signature) return false

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  return timingSafeEqual(expected, signature)
}

/**
 * Compare two strings without leaking information through how long it takes.
 *
 * A plain `a === b` returns as soon as it finds a differing character, so a
 * signature starting with the right byte takes measurably longer to reject than
 * one that is wrong immediately. Repeated millions of times, that timing
 * difference lets an attacker reconstruct the correct value one byte at a time.
 * crypto.timingSafeEqual always compares every byte.
 *
 * This is genuinely paranoid for a clinic booking app. It is also two lines, and
 * it is the correct habit for every signature and token comparison you will ever
 * write.
 */
function timingSafeEqual(a, b) {
  const bufferA = Buffer.from(String(a), 'utf8')
  const bufferB = Buffer.from(String(b), 'utf8')
  // timingSafeEqual throws if the lengths differ, so that has to be checked
  // first — and a length mismatch already means "not equal".
  if (bufferA.length !== bufferB.length) return false
  return crypto.timingSafeEqual(bufferA, bufferB)
}

/* -------------------------------------------------------------------------- */
/*  FETCHING AND REFUNDING                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Ask Razorpay directly about a payment.
 *
 * Worth doing for the amount check in the verify route: the signature proves the
 * message is authentic, but this proves the sum actually captured. Belt and
 * braces on anything involving money.
 */
export async function fetchPayment(clinic, paymentId) {
  if (isDemoMode(clinic)) {
    return { id: paymentId, status: 'captured', method: 'demo', amount: null }
  }
  return getClient(clinic).payments.fetch(paymentId)
}

/**
 * Refund a payment, fully or in part.
 *
 * Used when the clinic cancels, or when a patient cancels inside the free
 * cancellation window. `speed: 'optimum'` lets Razorpay use the instant rail
 * where the bank supports it, so the patient sees their money back in hours
 * rather than the standard five to seven working days.
 */
export async function refundPayment(clinic, { paymentId, amountPaise, notes = {} }) {
  if (isDemoMode(clinic)) {
    return { id: `rfnd_demo_${Date.now()}`, amount: amountPaise, status: 'processed' }
  }

  return getClient(clinic).payments.refund(paymentId, {
    // Omitting amount refunds the whole payment.
    ...(amountPaise ? { amount: amountPaise } : {}),
    speed: 'optimum',
    notes,
  })
}

/**
 * The clinic's PUBLIC key id, for Razorpay Checkout in the browser.
 *
 * Safe to send to the client — it only identifies the account. The secret never
 * leaves the server, which is the entire reason the two are separate.
 */
export function publicKeyId(clinic) {
  return clinic?.razorpay_key_id || ''
}
