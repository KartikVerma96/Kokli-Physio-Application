import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { query, queryOne, transaction } from '@/lib/db'
import { getPlanByCode } from '@/lib/queries'
import {
  ensureRazorpayPlan,
  createPlatformSubscription,
  platformPublicKeyId,
  isBillingDemoMode,
  demoPaymentIdFor,
} from '@/lib/platformBilling'
import { platform } from '@/config/platform'

/**
 * ============================================================================
 *  POST /api/billing/subscribe — a clinic starts paying you
 * ============================================================================
 *
 *  Called from /admin/billing when a clinic picks a plan. It returns everything
 *  the browser needs to open Razorpay's subscription checkout, where the clinic
 *  authorises a recurring mandate.
 *
 *  THE AMOUNT IS NEVER TAKEN FROM THE REQUEST
 *  ------------------------------------------
 *  The body carries a plan CODE — 'professional' — and the price is looked up
 *  from the `plans` table. Exactly the same rule as patient bookings: send an
 *  identifier, look the price up. A body that could name its own price is a body
 *  that will eventually name ₹1.
 *
 *  ONLY THE OWNER MAY SUBSCRIBE
 *  ----------------------------
 *  Role 'admin' of this clinic, and nobody else. A physiotherapist should not be
 *  able to commit the practice to a monthly payment, and a patient obviously not.
 * ============================================================================
 */

export async function POST(request) {
  /* ------------------------------------------------------------- 1. who */
  const clinic = await getCurrentClinic()
  if (!clinic) return NextResponse.json({ error: 'Unknown clinic' }, { status: 404 })

  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })
  }
  if (session.user.role !== 'admin' || Number(session.user.clinicId) !== Number(clinic.id)) {
    return NextResponse.json(
      { error: 'Only the clinic administrator can change the subscription.' },
      { status: 403 }
    )
  }

  /* ------------------------------------------------------------ 2. plan */
  let planCode
  try {
    planCode = String((await request.json())?.planCode || '')
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 })
  }

  const plan = await getPlanByCode(planCode)
  if (!plan || !plan.is_active) {
    return NextResponse.json({ error: 'That plan is not available.' }, { status: 404 })
  }

  try {
    /* -------------------------------------------- 3. the Razorpay plan */
    /**
     * Created lazily and cached on the row.
     *
     * Razorpay plans are immutable, so the cached id is only valid while the
     * price is unchanged. `razorpay_plan_id` is cleared whenever a price is
     * edited in the platform admin, which makes the next subscribe create a
     * fresh one — and leaves existing subscribers on the old plan at the old
     * price, which is what they agreed to.
     */
    /**
     * A DEMO id is never valid against real Razorpay.
     *
     * ensureRazorpayPlan() returns `plan_demo_<code>_<paise>` while billing is in
     * demo mode, and that id gets cached on the row like any other. The moment real
     * keys are configured, the cache is poison: Razorpay answers "The ID provided
     * is invalid or could not be found", every subscribe attempt 500s, and nothing
     * in the message points at a stale row in the plans table.
     *
     * This is not hypothetical — it happened the first time real test keys were
     * added, and the error gave no clue. Treating a demo id as absent means the
     * switch from demo to live, and from test keys to live keys, simply works.
     */
    const cachedId = plan.razorpay_plan_id
    const cacheIsUsable =
      cachedId && (isBillingDemoMode() ? cachedId.startsWith('plan_demo_') : !cachedId.startsWith('plan_demo_'))

    let razorpayPlanId = cacheIsUsable ? cachedId : null
    if (!razorpayPlanId) {
      razorpayPlanId = await ensureRazorpayPlan(plan)
      await query('UPDATE plans SET razorpay_plan_id = ? WHERE id = ?', [razorpayPlanId, plan.id])
    }

    /* ------------------------------------------- 4. the subscription */
    const rzpSubscription = await createPlatformSubscription({
      clinic,
      plan,
      razorpayPlanId,
    })

    /**
     * Record it against the clinic BEFORE the mandate is authorised.
     *
     * The row starts as 'trialing' — not 'active' — because nothing has been
     * charged yet. It only becomes active when the signature is verified
     * (/api/billing/verify) or the first charge webhook lands. Marking it active
     * here would grant a paid plan to anyone who opened the checkout and
     * abandoned it.
     */
    await transaction(async (tx) => {
      // Close whatever they were on. The partial-unique index on
      // subscriptions.active_clinic_key permits only ONE live row per clinic, so
      // this is required, not tidiness — without it the insert below fails.
      await tx.execute(
        `UPDATE subscriptions
            SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = 'clinic',
                cancel_reason = 'Replaced by a new subscription'
          WHERE clinic_id = ? AND status IN ('trialing', 'active', 'past_due')`,
        [clinic.id]
      )

      await tx.execute(
        `INSERT INTO subscriptions
           (clinic_id, plan_id, status, razorpay_subscription_id, price_paise,
            billing_period, trial_ends_at, current_period_start, current_period_end)
         VALUES (?, ?, 'trialing', ?, ?, ?, ?, NOW(), ?)`,
        [
          clinic.id,
          plan.id,
          rzpSubscription.id,
          plan.price_paise,
          plan.billing_period,
          // Any trial they had left is preserved rather than forfeited for
          // upgrading early — punishing someone for paying sooner is backwards.
          clinic.trial_ends_at,
          clinic.current_period_end,
        ]
      )
    })

    return NextResponse.json({
      ok: true,
      subscriptionId: rzpSubscription.id,
      razorpayKeyId: platformPublicKeyId(),
      demoMode: isBillingDemoMode(),
      // In demo mode there is no real payment, so we mint the stand-in id HERE
      // rather than in the browser. Two reasons: a client-generated id is not
      // something a payment record should ever trust, and deriving it from the
      // subscription id keeps it stable — replaying the same demo confirmation
      // hits the idempotency check in /verify instead of raising a second invoice.
      demoPaymentId: isBillingDemoMode() ? demoPaymentIdFor(rzpSubscription.id) : null,
      planName: plan.name,
      amountPaise: plan.price_paise,
      platformName: platform.name,
      prefill: {
        name: session.user.name,
        email: session.user.email,
        contact: session.user.phone || '',
      },
    })
  } catch (error) {
    console.error('[billing/subscribe]', error)
    return NextResponse.json(
      { error: 'Could not start the subscription. Please try again.' },
      { status: 500 }
    )
  }
}
