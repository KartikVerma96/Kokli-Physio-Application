'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireClinicAdmin, guardFailure } from '@/lib/guards'
import { query, queryOne } from '@/lib/db'
import { cancelPlatformSubscription, isBillingDemoMode } from '@/lib/platformBilling'
import { sendEmailInBackground } from '@/lib/email'
import { subscriptionCancelled, clinicCancelledForPlatform } from '@/lib/emailTemplates'
import { formatDateLong } from '@/lib/utils'
import { platform } from '@/config/platform'
import { reportError } from '@/lib/errorLog'

/**
 * ============================================================================
 *  CANCELLING A SUBSCRIPTION
 * ============================================================================
 *  A clinic could not cancel. `cancelPlatformSubscription()` had existed in
 *  lib/platformBilling.js since the billing work, correctly defaulting to
 *  cancel-at-cycle-end, and nothing ever called it. The only way out was to email
 *  and hope somebody did it by hand.
 *
 *  ============================================================================
 *  WHY THERE IS NO RETENTION FLOW HERE
 *  ============================================================================
 *  The instinct is to make cancelling hard — bury the button, add three
 *  "are you sure" screens, offer a discount before letting go. It is a bad trade
 *  in this specific market, for three reasons:
 *
 *    1. A clinic that cannot find the cancel button does not stay a customer. It
 *       disputes the charge with its bank. A chargeback costs the fee, the revenue,
 *       and standing with Razorpay — and Razorpay watches the dispute ratio.
 *
 *    2. Indian physiotherapy is a word-of-mouth market. Clinics in one city know
 *       each other, sit in the same associations, and share what a vendor did to
 *       them. Trapping one clinic costs the next five.
 *
 *    3. It is very likely illegal. A recurring charge a customer cannot stop from
 *       inside the product is exactly what consumer-protection rules exist for.
 *
 *  So: one button, plain language, and it works the first time. The only thing
 *  asked in return is WHY — optional, one click — because at this stage of the
 *  business a churn reason is worth more than the ₹1,299.
 *
 *  ============================================================================
 *  WHY IT ENDS AT THE PERIOD END AND NOT IMMEDIATELY
 *  ============================================================================
 *  They have already paid for this month. Cutting access on the day they cancel
 *  is taking money for nothing, and their PATIENTS have appointments booked in the
 *  next three weeks — patients who did nothing wrong and would simply find a
 *  clinic whose booking page works.
 *
 *  ============================================================================
 *  WHY RAZORPAY IS TOLD NOW, NOT ON THE LAST DAY
 *  ============================================================================
 *  The alternative — record it locally, let the nightly job cancel the mandate the
 *  night before renewal — allows an "undo" with no new payment authorisation, which
 *  is nicer. It also means that if the cron job fails for one night, we charge a
 *  clinic that cancelled three weeks ago.
 *
 *  Those two failures are not comparable. "You have to authorise payment again to
 *  come back" is a mild inconvenience. "We charged you after you cancelled" is a
 *  chargeback, a furious customer, and a story they tell other clinics. So the
 *  mandate is revoked at Razorpay the moment they ask, with cancel_at_cycle_end so
 *  the paid month still runs out — and the guarantee no longer depends on our cron
 *  surviving.
 * ============================================================================
 */

const cancelSchema = z.object({
  /**
   * A fixed list, not free text, because the value of this field is entirely in
   * being able to COUNT it. "too expensive" typed forty different ways answers
   * nothing.
   */
  reason: z.enum([
    'too_expensive',
    'not_using_it',
    'missing_feature',
    'switching',
    'closing_clinic',
    'other',
  ]).optional(),
  // The free text sits alongside, for the part a list cannot capture.
  note: z.string().trim().max(500).optional(),
})

export async function cancelSubscription(input) {
  let clinic
  try {
    clinic = await requireClinicAdmin()
  } catch (error) {
    return guardFailure(error)
  }

  const parsed = cancelSchema.safeParse({
    reason: input?.reason || undefined,
    note: input?.note || undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: 'Please check the form.' }
  }

  /**
   * The newest subscription, INCLUDING one already cancelled.
   *
   * Narrowing this to ('trialing','active','past_due') looked tidier and was wrong:
   * cancelling a trial sets the status straight to 'cancelled', so a second click —
   * a double tap, a second tab, a browser retry — found no row and answered "there
   * is no active subscription to cancel". Which is technically true and reads as a
   * failure, on an action that had in fact just succeeded.
   *
   * Selecting any subscription and deciding here means the already-cancelled case
   * gets the honest, reassuring answer below instead.
   */
  const subscription = await queryOne(
    `SELECT s.id, s.razorpay_subscription_id, s.status, s.current_period_end,
            s.cancelled_at, s.trial_ends_at,
            p.name AS plan_name
       FROM subscriptions s
       LEFT JOIN plans p ON p.id = s.plan_id
      WHERE s.clinic_id = ?
      ORDER BY s.id DESC LIMIT 1`,
    [clinic.id]
  )

  if (!subscription) {
    return { ok: false, error: 'There is no subscription to cancel.' }
  }
  if (subscription.status === 'expired') {
    return { ok: false, error: 'That subscription has already expired.' }
  }
  if (subscription.cancelled_at || subscription.status === 'cancelled') {
    // Idempotent rather than an error: a double click, or a second tab, must not
    // produce a scary message about something that already worked.
    return {
      ok: true,
      alreadyCancelled: true,
      message:
        subscription.status === 'cancelled'
          ? 'Your subscription has already been cancelled. Nothing further will be charged.'
          : `Your subscription is already set to end on ${formatDateLong(subscription.current_period_end)}.`,
    }
  }

  /**
   * A clinic still ON TRIAL has nothing to cancel at Razorpay — no mandate was
   * ever authorised. Ending immediately is the honest behaviour there: there is no
   * paid period to run out, and pretending otherwise would leave them "active"
   * with a trial date in the past.
   */
  const onTrial = subscription.status === 'trialing'

  /* ------------------------------------------------------- tell Razorpay first */
  /**
   * BEFORE our own database, deliberately.
   *
   * If Razorpay refuses, nothing has been written and the clinic sees an honest
   * error. The other order — mark it cancelled here, then fail at Razorpay — leaves
   * a clinic who believes they have cancelled and a mandate that will charge them
   * again next month. That is the single worst outcome available in this function.
   */
  if (!onTrial && subscription.razorpay_subscription_id && !isBillingDemoMode()) {
    try {
      await cancelPlatformSubscription(subscription.razorpay_subscription_id, true)
    } catch (error) {
      await reportError({ error, route: '/admin/billing#cancel', clinicId: clinic.id })
      return {
        ok: false,
        error:
          'We could not reach the payment provider just now, so nothing has changed. ' +
          `Please try again in a minute — or email ${platform.supportEmail} and we will do it for you.`,
      }
    }
  }

  /* --------------------------------------------------------------- record it */
  const endsAt = onTrial ? new Date() : subscription.current_period_end

  await query(
    `UPDATE subscriptions
        SET cancelled_at = NOW(),
            cancelled_by = 'clinic',
            cancel_reason = ?,
            status = ?
      WHERE id = ?`,
    [
      [parsed.data.reason, parsed.data.note].filter(Boolean).join(' — ').slice(0, 255) || null,
      // On trial there is no paid period left to honour, so it ends now. Otherwise
      // the row stays active and the sweep flips it when the period runs out.
      onTrial ? 'cancelled' : subscription.status,
      subscription.id,
    ]
  )

  /* ------------------------------------------------------------------ tell them */
  const owner = await queryOne(
    `SELECT u.name, u.email FROM users u WHERE u.id = ?`,
    [clinic.owner_user_id]
  )

  if (owner?.email && !owner.email.endsWith('.invalid')) {
    sendEmailInBackground({
      to: owner.email,
      clinic,
      ...subscriptionCancelled({
        clinic,
        name: owner.name,
        endsAt,
        immediate: onTrial,
      }),
    })
  }

  /**
   * And tell YOU, immediately.
   *
   * A cancellation you hear about the same day is one you can sometimes still
   * save with a phone call. One you discover next month in a revenue chart is
   * simply lost revenue. This is the highest-value email the platform sends.
   */
  if (platform.salesEmail) {
    sendEmailInBackground({
      to: platform.salesEmail,
      ...clinicCancelledForPlatform({
        clinic,
        planName: subscription.plan_name,
        reason: parsed.data.reason,
        note: parsed.data.note,
        endsAt,
        immediate: onTrial,
      }),
    })
  }

  revalidatePath('/admin/billing')
  revalidatePath('/admin')

  return {
    ok: true,
    immediate: onTrial,
    message: onTrial
      ? 'Your trial has ended. Nothing has been charged, and none of your data is deleted.'
      : `Your subscription will end on ${formatDateLong(endsAt)}. Everything works normally until then.`,
  }
}
