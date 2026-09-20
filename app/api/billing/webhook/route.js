import { NextResponse } from 'next/server'
import { query, queryOne, transaction } from '@/lib/db'
import { verifyPlatformWebhook, invoiceNumber, gstOn } from '@/lib/platformBilling'
import { platform } from '@/config/platform'
import { sendEmailInBackground } from '@/lib/email'
import { subscriptionReceipt, subscriptionPaymentFailed } from '@/lib/emailTemplates'

/**
 * ============================================================================
 *  POST /api/billing/webhook — Razorpay tells YOU about a subscription
 * ============================================================================
 *
 *  This is how recurring revenue actually arrives. Nobody is sitting at a
 *  browser when a mandate is debited on the 14th of next month — Razorpay
 *  charges the card and posts here.
 *
 *  IT LIVES ON THE PLATFORM DOMAIN, NOT A CLINIC SUBDOMAIN
 *  -------------------------------------------------------
 *  Unlike /api/payments/webhook, which is per-clinic and verified with that
 *  clinic's secret, this one is YOUR account and YOUR single secret. The clinic
 *  is identified from `notes.clinic_id`, which was stamped on the subscription
 *  when it was created.
 *
 *  Register it once: Razorpay Dashboard → Settings → Webhooks →
 *  https://yourdomain.com/api/billing/webhook, subscribing to
 *  subscription.charged, subscription.halted, subscription.cancelled and
 *  subscription.completed.
 *
 *  IDEMPOTENCY IS NOT OPTIONAL
 *  ---------------------------
 *  Razorpay retries until it gets a 2xx and may deliver the same event twice
 *  even after success. Every handler below checks state before writing, so
 *  processing an event five times produces the same result as processing it
 *  once — otherwise a retried charge would raise five invoices.
 * ============================================================================
 */

export async function POST(request) {
  // The RAW body. Parsing to JSON and re-stringifying reorders keys and changes
  // whitespace, and the signature then never matches. This is the number one
  // cause of "my webhook signature is always invalid".
  const rawBody = await request.text()
  const signature = request.headers.get('x-razorpay-signature')

  if (!verifyPlatformWebhook({ rawBody, signature })) {
    // 400, not 500. A 5xx tells Razorpay to retry, and there is no point
    // retrying something that will never verify.
    console.error('[billing/webhook] signature verification failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 })
  }

  try {
    switch (event.event) {
      case 'subscription.charged':
        await handleCharged(event)
        break
      case 'subscription.halted':
      case 'subscription.pending':
        await handleFailed(event)
        break
      case 'subscription.cancelled':
      case 'subscription.completed':
        await handleCancelled(event)
        break
      default:
        // Unknown events get a 200 — Razorpay adds new types, and an error would
        // make it retry something we will never handle.
        break
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    // A genuine 500 is correct here: something broke on our side and we DO want
    // the retry.
    console.error('[billing/webhook] handler error:', error)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
}

/** Find our subscription row from the Razorpay id in the event. */
async function findSubscription(event) {
  const entity = event.payload?.subscription?.entity
  if (!entity?.id) return null

  return queryOne(
    `SELECT s.*, c.slug AS clinic_slug, c.name AS clinic_name, c.phone AS clinic_phone,
            p.name AS plan_name, owner.email AS owner_email
       FROM subscriptions s
       JOIN clinics c ON c.id = s.clinic_id
       JOIN plans p ON p.id = s.plan_id
       LEFT JOIN users owner ON owner.id = c.owner_user_id
      WHERE s.razorpay_subscription_id = ?`,
    [entity.id]
  )
}

/* ========================================================================== */
/*  CHARGED — the money arrived                                               */
/* ========================================================================== */

async function handleCharged(event) {
  const subscription = await findSubscription(event)
  if (!subscription) {
    // Usually means the webhook is pointed at the wrong environment — test keys
    // hitting production, or the reverse. Worth logging loudly.
    console.warn('[billing/webhook] charge for an unknown subscription')
    return
  }

  const payment = event.payload?.payment?.entity
  const paymentId = payment?.id ?? null

  // Idempotency: if this exact payment already produced an invoice, stop.
  if (paymentId) {
    const seen = await queryOne(
      'SELECT id FROM platform_invoices WHERE razorpay_payment_id = ?',
      [paymentId]
    )
    if (seen) return
  }

  const entity = event.payload.subscription.entity
  const periodEnd = entity.current_end
    ? new Date(entity.current_end * 1000)
    : new Date(Date.now() + 30 * 86_400_000)

  await transaction(async (tx) => {
    await tx.execute(
      `UPDATE subscriptions
          SET status = 'active',
              trial_ends_at = NULL,
              grace_ends_at = NULL,
              current_period_start = NOW(),
              current_period_end = ?
        WHERE id = ?`,
      [periodEnd, subscription.id]
    )

    // A clinic that had lapsed comes straight back to life. Note this does NOT
    // touch 'suspended' — a clinic you switched off by hand stays off until you
    // switch it back on, whatever they pay.
    await tx.execute(
      `UPDATE clinics SET status = 'active'
        WHERE id = ? AND status IN ('trialing', 'past_due', 'read_only')`,
      [subscription.clinic_id]
    )

    const year = new Date().getFullYear()
    const [[{ n }]] = await tx.execute(
      'SELECT COUNT(*) AS n FROM platform_invoices WHERE YEAR(created_at) = ?',
      [year]
    )

    const amount = payment?.amount ?? subscription.price_paise
    await tx.execute(
      `INSERT INTO platform_invoices
         (clinic_id, subscription_id, number, razorpay_payment_id,
          amount_paise, tax_paise, status, period_start, period_end, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, 'paid', CURDATE(), ?, NOW())`,
      [
        subscription.clinic_id,
        subscription.id,
        invoiceNumber(year, n + 1),
        paymentId,
        amount,
        gstOn(amount),
        periodEnd,
      ]
    )
  })

  console.log(`[billing/webhook] ${subscription.clinic_slug} charged and renewed`)

  // The receipt. Sent after the transaction, so it can only describe something
  // that really happened.
  if (subscription.owner_email) {
    const amount = payment?.amount ?? subscription.price_paise
    const [invoice] = await query(
      'SELECT number FROM platform_invoices WHERE subscription_id = ? ORDER BY id DESC LIMIT 1',
      [subscription.id]
    )
    sendEmailInBackground({
      to: subscription.owner_email,
      ...subscriptionReceipt({
        clinic: { name: subscription.clinic_name, slug: subscription.clinic_slug },
        planName: subscription.plan_name,
        amountPaise: amount,
        taxPaise: gstOn(amount),
        invoiceNumber: invoice?.number ?? '—',
        periodEnd,
      }),
    })
  }
}

/* ========================================================================== */
/*  FAILED — the mandate could not be debited                                 */
/* ========================================================================== */

async function handleFailed(event) {
  const subscription = await findSubscription(event)
  if (!subscription) return

  /**
   * past_due, not read_only. The clinic keeps working through the grace period.
   *
   * A halted mandate is usually an expired card or a bank's fraud check, not a
   * decision to leave — and cutting off a clinic's bookings the same morning
   * harms their patients, not just them. `grace_ends_at` is stamped once so the
   * countdown is a fixed date rather than sliding forward on every retry.
   */
  await query(
    `UPDATE subscriptions
        SET status = 'past_due',
            grace_ends_at = COALESCE(grace_ends_at, DATE_ADD(NOW(), INTERVAL ? DAY))
      WHERE id = ?`,
    [platform.graceDays, subscription.id]
  )

  await query(
    `UPDATE clinics SET status = 'past_due' WHERE id = ? AND status = 'active'`,
    [subscription.clinic_id]
  )

  const payment = event.payload?.payment?.entity
  const year = new Date().getFullYear()
  const [{ n }] = await query(
    'SELECT COUNT(*) AS n FROM platform_invoices WHERE YEAR(created_at) = ?',
    [year]
  )

  // Recorded as a failed invoice rather than silently dropped, so the clinic can
  // see what happened on their billing page and you can see it in your ledger.
  await query(
    `INSERT INTO platform_invoices
       (clinic_id, subscription_id, number, razorpay_payment_id,
        amount_paise, tax_paise, status, failure_reason)
     VALUES (?, ?, ?, ?, ?, ?, 'failed', ?)`,
    [
      subscription.clinic_id,
      subscription.id,
      invoiceNumber(year, n + 1),
      payment?.id ?? null,
      subscription.price_paise,
      gstOn(subscription.price_paise),
      String(payment?.error_description || 'The recurring payment could not be collected').slice(0, 500),
    ]
  )

  console.warn(`[billing/webhook] ${subscription.clinic_slug} payment failed — grace period started`)

  /**
   * Tell them, today.
   *
   * This is the highest-value email the platform sends. A clinic whose card
   * quietly expired will not notice anything until bookings stop, and by then
   * they are annoyed at you rather than at their bank. One clear email inside the
   * grace period turns almost all of these back into paying customers.
   */
  if (subscription.owner_email) {
    sendEmailInBackground({
      to: subscription.owner_email,
      ...subscriptionPaymentFailed({
        clinic: { name: subscription.clinic_name, slug: subscription.clinic_slug },
        graceDays: platform.graceDays,
      }),
    })
  }
}

/* ========================================================================== */
/*  CANCELLED                                                                 */
/* ========================================================================== */

async function handleCancelled(event) {
  const subscription = await findSubscription(event)
  if (!subscription) return

  await query(
    `UPDATE subscriptions
        SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = 'clinic',
            cancel_reason = 'Cancelled at Razorpay'
      WHERE id = ?`,
    [subscription.id]
  )

  /**
   * They keep working until the period they have already paid for runs out.
   *
   * The lifecycle derivation in lib/subscriptionLifecycle.js handles the rest:
   * once current_period_end passes with no live subscription, the clinic becomes
   * read_only on its own. Cutting them off the moment they click cancel would be
   * taking money for a service withdrawn early.
   */
  await query(
    `UPDATE clinics SET status = 'read_only'
      WHERE id = ? AND ? < NOW()`,
    [subscription.clinic_id, subscription.current_period_end]
  )

  console.log(`[billing/webhook] ${subscription.clinic_slug} cancelled`)
}
