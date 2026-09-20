import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { queryOne, transaction } from '@/lib/db'
import {
  verifySubscriptionSignature,
  invoiceNumber,
  gstOn,
  isBillingDemoMode,
} from '@/lib/platformBilling'
import { sendEmailInBackground } from '@/lib/email'
import { subscriptionReceipt } from '@/lib/emailTemplates'

/**
 * ============================================================================
 *  POST /api/billing/verify — the mandate was authorised
 * ============================================================================
 *
 *  Razorpay Checkout has told the BROWSER the subscription mandate is set up.
 *  The browser now tells us, and this decides whether to believe it.
 *
 *  Everything the browser sends can be forged, so the signature is the proof:
 *  an HMAC of `payment_id|subscription_id` keyed with the platform secret, which
 *  only Razorpay and this server know.
 *
 *  NOTE THE ARGUMENT ORDER — payment FIRST for subscriptions, the opposite of
 *  one-off orders. See the comment in lib/platformBilling.js.
 *
 *  AND A SECOND PATH: THE WEBHOOK
 *  ------------------------------
 *  This route only runs if the browser survives long enough to call it.
 *  /api/billing/webhook receives the same news from Razorpay server-to-server
 *  and activates the subscription even if the browser never returns. Both are
 *  written to be safely repeatable, so it does not matter which arrives first —
 *  or if both do.
 * ============================================================================
 */

export async function POST(request) {
  const clinic = await getCurrentClinic()
  if (!clinic) return NextResponse.json({ error: 'Unknown clinic' }, { status: 404 })

  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })
  if (session.user.role !== 'admin' || Number(session.user.clinicId) !== Number(clinic.id)) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 })
  }

  const {
    razorpay_subscription_id: subscriptionId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
  } = body

  if (!subscriptionId || !paymentId || !signature) {
    return NextResponse.json({ error: 'Incomplete confirmation.' }, { status: 422 })
  }

  /* ------------------------------------------------------- 1. is it ours? */
  // The subscription must be the one WE created for THIS clinic. Without this a
  // valid signature from another clinic's cheaper subscription could be replayed
  // here.
  const subscription = await queryOne(
    `SELECT s.*, p.name AS plan_name, p.code AS plan_code
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
      WHERE s.clinic_id = ? AND s.razorpay_subscription_id = ?`,
    [clinic.id, subscriptionId]
  )

  if (!subscription) {
    return NextResponse.json(
      { error: 'That subscription does not belong to this clinic.' },
      { status: 400 }
    )
  }

  // Already handled — by the webhook, or by a refresh. Idempotent by design.
  if (subscription.status === 'active') {
    return NextResponse.json({ ok: true, alreadyActive: true })
  }

  /* --------------------------------------------------- 2. the signature */
  if (!verifySubscriptionSignature({ subscriptionId, paymentId, signature })) {
    console.error(`[billing/verify] BAD SIGNATURE for clinic ${clinic.id}`)
    return NextResponse.json(
      { error: 'We could not verify that payment. Please contact support.' },
      { status: 400 }
    )
  }

  /* ----------------------------------------------------- 3. activate it */
  // Filled inside the transaction so the receipt below can quote the real
  // invoice number, and stays null if anything rolled back.
  let raised = null

  try {
    await transaction(async (tx) => {
      await tx.execute(
        `UPDATE subscriptions
            SET status = 'active',
                trial_ends_at = NULL,
                grace_ends_at = NULL,
                current_period_start = NOW(),
                current_period_end = DATE_ADD(NOW(), INTERVAL 1 ${
                  subscription.billing_period === 'yearly' ? 'YEAR' : 'MONTH'
                })
          WHERE id = ?`,
        [subscription.id]
      )

      await tx.execute(`UPDATE clinics SET status = 'active' WHERE id = ?`, [clinic.id])

      /* ------------------------------------------------- the invoice */
      // Numbered sequentially per year inside the transaction, so two invoices
      // raised at the same moment cannot collide. The UNIQUE index on
      // platform_invoices.number is the backstop.
      const year = new Date().getFullYear()
      const [[{ n }]] = await tx.execute(
        `SELECT COUNT(*) AS n FROM platform_invoices WHERE YEAR(created_at) = ?`,
        [year]
      )

      const amount = subscription.price_paise
      const tax = gstOn(amount)
      raised = { number: invoiceNumber(year, n + 1), amount, tax }

      await tx.execute(
        `INSERT INTO platform_invoices
           (clinic_id, subscription_id, number, razorpay_payment_id,
            amount_paise, tax_paise, status, period_start, period_end, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, 'paid', CURDATE(),
                 DATE_ADD(CURDATE(), INTERVAL 1 ${
                   subscription.billing_period === 'yearly' ? 'YEAR' : 'MONTH'
                 }), NOW())`,
        [clinic.id, subscription.id, raised.number, paymentId, amount, tax]
      )
    })

    // The receipt, after the commit and without blocking the response.
    if (raised && session.user.email) {
      sendEmailInBackground({
        to: session.user.email,
        ...subscriptionReceipt({
          clinic,
          planName: subscription.plan_name,
          amountPaise: raised.amount,
          taxPaise: raised.tax,
          invoiceNumber: raised.number,
          periodEnd: null,
        }),
      })
    }

    return NextResponse.json({
      ok: true,
      planName: subscription.plan_name,
      demoMode: isBillingDemoMode(),
    })
  } catch (error) {
    console.error('[billing/verify]', error)
    return NextResponse.json(
      { error: 'Your payment went through but we could not record it. Please contact support.' },
      { status: 500 }
    )
  }
}
