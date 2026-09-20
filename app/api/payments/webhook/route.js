import { NextResponse } from 'next/server'
import { query, queryOne, transaction } from '@/lib/db'
import { verifyWebhookSignature } from '@/lib/razorpay'
import { getCurrentClinic } from '@/lib/tenant'

/**
 * ============================================================================
 *  POST /api/payments/webhook — Razorpay tells us directly
 * ============================================================================
 *
 *  WHY THIS EXISTS WHEN /verify ALREADY WORKS
 *  ------------------------------------------
 *  /api/payments/verify depends on the patient's browser coming back to tell us
 *  the good news. In the real world it often does not:
 *
 *    - they pay in their UPI app, then the phone switches back to WhatsApp
 *    - the train enters a tunnel between "paid" and our server
 *    - the battery dies
 *    - they simply close the tab, satisfied, the second the bank says success
 *
 *  In every one of those cases the money has left the patient's account and the
 *  appointment is still sitting at 'pending_payment', due to be released back to
 *  the pool in a few minutes. That is the worst possible outcome: charged, and no
 *  appointment.
 *
 *  A webhook is Razorpay's server telling OUR server, directly, with no browser
 *  in the middle. It is the only reliable path, and any payment integration
 *  without one will lose real bookings.
 *
 *  SETTING IT UP
 *  -------------
 *   1. Razorpay Dashboard → Settings → Webhooks → Add New Webhook
 *   2. URL: https://yourdomain.com/api/payments/webhook
 *      (locally, use ngrok or the Razorpay CLI to expose your machine)
 *   3. Subscribe to: payment.captured, payment.failed, refund.processed
 *   4. Set a secret, and put the same value in RAZORPAY_WEBHOOK_SECRET
 *
 *  IDEMPOTENCY IS NOT OPTIONAL
 *  ---------------------------
 *  Razorpay retries a webhook until it gets a 2xx, and may deliver the same
 *  event more than once even after success. Both handlers below therefore check
 *  the current state before writing, so processing the same event five times
 *  produces exactly the same result as processing it once.
 * ============================================================================
 */

export async function POST(request) {
  /**
   * THE RAW BODY MATTERS
   *
   * The signature is computed over the exact bytes Razorpay sent. Calling
   * request.json() and re-stringifying would reorder keys and change whitespace,
   * and the signature would then never match. Read the text, verify it, and only
   * then parse.
   *
   * This is the number one cause of "my webhook signature is always invalid".
   */
  const rawBody = await request.text()
  const signature = request.headers.get('x-razorpay-signature')

  /**
   * WHICH CLINIC IS THIS WEBHOOK FOR?
   *
   * The hostname. Each clinic registers a webhook pointing at THEIR subdomain —
   * aarogya.kokli.in/api/payments/webhook — with their own secret, so the
   * signature can only be verified against the right clinic's key.
   *
   * That is not just convenient, it is the security property: a webhook signed
   * with clinic A's secret cannot be replayed against clinic B, because B's
   * secret will not verify it.
   */
  const clinic = await getCurrentClinic()
  if (!clinic) {
    return NextResponse.json({ error: 'Unknown clinic' }, { status: 404 })
  }

  if (!verifyWebhookSignature(clinic, { rawBody, signature })) {
    // Return 400, not 500. A 5xx tells Razorpay "try again later", and there is
    // no point retrying something that will never verify.
    console.error('[webhook] signature verification failed')
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
      case 'payment.captured':
        await handleCaptured(clinic, event)
        break
      case 'payment.failed':
        await handleFailed(clinic, event)
        break
      case 'refund.processed':
        await handleRefund(clinic, event)
        break
      default:
        // Unknown events get a 200. Razorpay may add new event types, and
        // returning an error would make it retry something we will never handle.
        break
    }

    // Always acknowledge quickly. Razorpay times out after a few seconds, and a
    // timeout is treated as a failure and retried.
    return NextResponse.json({ ok: true })
  } catch (error) {
    // A genuine 500 here is correct: something broke on our side, and we DO want
    // Razorpay to retry.
    console.error('[webhook] handler error:', error)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
}

/* -------------------------------------------------------------------------- */
/*  PAYMENT CAPTURED                                                          */
/* -------------------------------------------------------------------------- */

async function handleCaptured(clinic, event) {
  const payment = event.payload?.payment?.entity
  if (!payment) return

  const orderId = payment.order_id
  const paymentId = payment.id

  // Find our own payment row from the order id we created earlier.
  const row = await queryOne(
    `SELECT p.id, p.status, p.amount_paise, p.appointment_id, a.status AS appointment_status
       FROM payments p
       JOIN appointments a ON a.id = p.appointment_id
      WHERE p.clinic_id = ? AND p.razorpay_order_id = ?`,
    [clinic.id, orderId]
  )

  if (!row) {
    // An order we have no record of. Worth logging loudly — it usually means the
    // webhook is pointed at the wrong environment (test keys hitting a
    // production server, or vice versa).
    console.warn(`[webhook] captured payment for unknown order ${orderId}`)
    return
  }

  // Idempotency check. If /api/payments/verify already handled this, stop here.
  if (row.status === 'paid') return

  // Never confirm short payment.
  if (Number(payment.amount) < Number(row.amount_paise)) {
    console.error(
      `[webhook] amount mismatch on order ${orderId}: expected ${row.amount_paise}, got ${payment.amount}`
    )
    return
  }

  await transaction(async (tx) => {
    await tx.execute(
      `UPDATE payments
          SET status = 'paid', razorpay_payment_id = ?, method = ?
        WHERE id = ?`,
      [paymentId, payment.method || null, row.id]
    )

    /**
     * The WHERE clause is doing real work here.
     *
     * `status = 'pending_payment'` means a webhook arriving after the patient
     * already cancelled cannot resurrect the appointment. And if the hold
     * expired, the row is 'cancelled' — so this UPDATE matches nothing, the
     * payment is still recorded as paid, and the discrepancy shows up in
     * Admin → Payments for a human to refund. That is the correct outcome:
     * visible, not silently wrong.
     */
    await tx.execute(
      `UPDATE appointments
          SET status = 'confirmed', hold_expires_at = NULL
        WHERE id = ? AND status = 'pending_payment'`,
      [row.appointment_id]
    )
  })

  console.log(`[webhook] confirmed appointment ${row.appointment_id} from payment.captured`)
}

/* -------------------------------------------------------------------------- */
/*  PAYMENT FAILED                                                            */
/* -------------------------------------------------------------------------- */

async function handleFailed(clinic, event) {
  const payment = event.payload?.payment?.entity
  if (!payment) return

  await query(
    `UPDATE payments
        SET status = 'failed',
            razorpay_payment_id = ?,
            error_description = ?
      WHERE clinic_id = ? AND razorpay_order_id = ? AND status = 'created'`,
    [
      clinic.id,
      payment.id,
      // Razorpay's description is genuinely useful — "insufficient funds" versus
      // "card declined by issuer" tells the patient what to do differently.
      String(payment.error_description || payment.error_reason || 'Payment failed').slice(0, 500),
      payment.order_id,
    ]
  )

  /**
   * Note we do NOT cancel the appointment here.
   *
   * A failed card is very often followed by a successful UPI attempt thirty
   * seconds later, and cancelling would pull the slot out from under a patient
   * who is actively trying to pay. The hold expires on its own soon enough —
   * releaseExpiredHolds() in lib/slots.js handles it.
   */
}

/* -------------------------------------------------------------------------- */
/*  REFUND PROCESSED                                                          */
/* -------------------------------------------------------------------------- */

async function handleRefund(clinic, event) {
  const refund = event.payload?.refund?.entity
  if (!refund) return

  await query(
    `UPDATE payments
        SET status = 'refunded',
            refund_id = ?,
            refunded_paise = ?,
            refunded_at = NOW()
      WHERE clinic_id = ? AND razorpay_payment_id = ?`,
    [refund.id, refund.amount, clinic.id, refund.payment_id]
  )

  console.log(`[webhook] refund ${refund.id} recorded for payment ${refund.payment_id}`)
}
