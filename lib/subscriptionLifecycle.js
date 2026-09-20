import { query } from '@/lib/db'
import { platform } from '@/config/platform'
import { purgeOldLoginAttempts } from '@/lib/loginThrottle'
import { purgeOldOtps } from '@/lib/otp'
import { purgeOldResets } from '@/lib/passwordReset'
import { purgeOldErrors } from '@/lib/errorLog'
import { sendEmailInBackground } from '@/lib/email'
import { trialEndingSoon } from '@/lib/emailTemplates'

/**
 * How many days before a trial ends the reminder goes out.
 *
 * Three is deliberate. A week out, a clinic still mid-setup ignores it; the
 * morning of, it reads as a threat. Three days is long enough to act on and
 * short enough to feel real.
 */
const REMIND_WITHIN_DAYS = 3

/**
 * ============================================================================
 *  SUBSCRIPTION LIFECYCLE — trial → active → past_due → read_only
 * ============================================================================
 *
 *  THE PROBLEM THIS SOLVES
 *  -----------------------
 *  A trial ends at a moment in time. Nobody is watching at that moment.
 *
 *  The obvious answer is a nightly cron job that sweeps expired trials and
 *  updates their status. That is the right thing for reporting, and there is one
 *  below. But relying on it ALONE has a nasty failure mode: if the job does not
 *  run — the server was down, the schedule was never set up, someone deployed
 *  without it — every lapsed clinic keeps taking bookings indefinitely, and you
 *  find out weeks later.
 *
 *  So the enforcement does not depend on the job at all.
 *
 *  TWO LAYERS, AND THE ORDER MATTERS
 *  ---------------------------------
 *  1. DERIVED (this file's `effectiveStatus`) — a pure function of the dates on
 *     the row. Correct the instant a trial expires, needs no write, and cannot
 *     drift because there is nothing to keep in sync. Every gate in the app asks
 *     this, never the raw column.
 *
 *  2. PERSISTED (`sweepSubscriptions`) — writes the derived status back so the
 *     platform admin, MRR figures and churn reports show the truth. Run it from
 *     a scheduler, or by hand from /platform. If it never runs, the numbers go
 *     stale but NOTHING IS ENFORCED WRONGLY.
 *
 *  Deriving what you can and persisting only for convenience is a good general
 *  pattern: it turns "the cron did not run" from a security incident into a
 *  reporting inconvenience.
 * ============================================================================
 */

/**
 * What this clinic's status ACTUALLY is right now, from the dates.
 *
 * Never reads `clinics.status` for the time-based transitions, because that
 * column is only as fresh as the last sweep.
 *
 * @returns {'trialing'|'active'|'past_due'|'read_only'|'suspended'|'cancelled'}
 */
export function effectiveStatus(clinic) {
  if (!clinic) return 'cancelled'

  // Set by a human from the platform admin. Nothing time-based overrides an
  // explicit decision.
  if (clinic.status === 'suspended') return 'suspended'
  if (clinic.status === 'cancelled') return 'cancelled'

  const now = Date.now()
  const at = (value) => (value ? new Date(value).getTime() : null)

  const trialEnds = at(clinic.trial_ends_at)
  const graceEnds = at(clinic.grace_ends_at)
  const periodEnds = at(clinic.current_period_end)

  /* --------------------------------------------------------------- trialing */
  if (clinic.subscription_status === 'trialing') {
    if (trialEnds && now < trialEnds) return 'trialing'

    // The trial is over. They get the same grace period a failed payment gets,
    // rather than being cut off the second the clock ticks over — someone whose
    // trial expires on a Saturday should not lose Monday's bookings.
    const graceUntil = graceEnds ?? (trialEnds ? trialEnds + platform.graceDays * 86_400_000 : null)
    if (graceUntil && now < graceUntil) return 'past_due'
    return 'read_only'
  }

  /* ----------------------------------------------------------------- active */
  if (clinic.subscription_status === 'active') {
    // Still inside the period they have paid for.
    if (!periodEnds || now < periodEnds) return 'active'

    // The period lapsed without a renewal webhook arriving. Treat it as past_due
    // rather than active: Razorpay may simply be slow, but continuing to grant a
    // paid service on an unpaid period is the wrong way to be wrong.
    const graceUntil = graceEnds ?? periodEnds + platform.graceDays * 86_400_000
    return now < graceUntil ? 'past_due' : 'read_only'
  }

  /* --------------------------------------------------------------- past_due */
  if (clinic.subscription_status === 'past_due') {
    if (graceEnds && now < graceEnds) return 'past_due'
    return 'read_only'
  }

  // cancelled, expired, or no subscription row at all.
  if (!clinic.subscription_status) return 'read_only'
  return 'read_only'
}

/**
 * Can this clinic take NEW bookings right now?
 *
 * The single gate the booking flow asks. Note it derives rather than trusting
 * the stored column — see the two-layer note above.
 *
 * read_only, suspended and cancelled clinics can still be browsed and every
 * record opened. They simply cannot accept new business. That distinction is the
 * whole of the lockout design: never destroy access to medical records over a
 * billing problem.
 */
export function canAcceptBookings(clinic) {
  return ['trialing', 'active', 'past_due'].includes(effectiveStatus(clinic))
}

/**
 * ============================================================================
 *  IS THIS SUBSCRIPTION ON ITS WAY OUT?
 * ============================================================================
 *  A clinic that cancels does NOT stop being active. They keep everything until
 *  the end of the month they have already paid for — see cancelSubscription() in
 *  app/admin/billing/actions.js for why that is not negotiable.
 *
 *  So "cancelling" is a state between active and cancelled, and it is DERIVED
 *  rather than stored:
 *
 *      cancelled_at IS NOT NULL   they asked to stop
 *      status is still active     the period they paid for has not ended
 *
 *  No new column, for the same reason the rest of this file derives instead of
 *  storing: a boolean and a status can disagree, and when they do, no code path
 *  is obviously the wrong one. Two facts that cannot contradict each other are
 *  worth more than a flag that is easier to read.
 */
export function isCancelling(clinic) {
  return Boolean(clinic?.cancelled_at) && ['active', 'past_due'].includes(clinic?.subscription_status)
}

/** Whole days left on the trial, or null when not trialing. */
export function trialDaysLeft(clinic) {
  if (clinic?.subscription_status !== 'trialing' || !clinic?.trial_ends_at) return null
  const ms = new Date(clinic.trial_ends_at).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

/** Whole days left before a past_due clinic drops to read-only. */
export function graceDaysLeft(clinic) {
  if (!clinic?.grace_ends_at) return null
  const ms = new Date(clinic.grace_ends_at).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

/* ========================================================================== */
/*  THE SWEEP                                                                 */
/* ========================================================================== */

/**
 * Write the derived status back to the database.
 *
 * Purely for reporting and for the platform admin — enforcement already happened
 * without it. Safe to run as often as you like; it only touches rows whose
 * stored status disagrees with reality.
 *
 * Run it from a scheduler (`POST /api/cron/subscriptions`), or press the button
 * in /platform. It is also called when the platform admin loads, so the numbers
 * you are looking at are correct at the moment you look at them.
 */
export async function sweepSubscriptions() {
  let ended = 0
  /**
   * ------------------------------------------------------------------------
   *  CANCELLATIONS WHOSE PAID PERIOD HAS NOW RUN OUT
   * ------------------------------------------------------------------------
   *  Razorpay was already told to cancel at cycle end, so it will stop charging
   *  regardless of this. This is the SAFETY NET for our own side of the record:
   *  without it a clinic that cancelled in March would still read as `active`
   *  here in April, and every gate in the app — bookings, WhatsApp, video — keys
   *  off that.
   *
   *  Done as one UPDATE rather than inside the loop below, because the loop only
   *  selects subscriptions in ('trialing','active','past_due') joined to clinics
   *  that are not already cancelled — and the whole point here is to move rows
   *  OUT of that set.
   *
   *  IT MUST RUN BEFORE THE SELECT BELOW, and that ordering is load-bearing. The
   *  first version ran it afterwards, and the loop — still holding the row it had
   *  already read — wrote `past_due` straight back over the `cancelled` this had
   *  just set. The clinic then kept taking bookings for a subscription it had
   *  ended, which the test caught and a person would not have.
   */
  const [endedResult] = await query(
    `UPDATE subscriptions
        SET status = 'cancelled'
      WHERE cancelled_at IS NOT NULL
        AND status IN ('active', 'past_due')
        AND current_period_end IS NOT NULL
        AND current_period_end < NOW()`
  ).then((r) => [r])
  ended = endedResult?.affectedRows || 0

  const clinics = await query(
    `SELECT c.id, c.status, c.slug, c.name,
            s.id AS subscription_id, s.status AS subscription_status,
            s.trial_ends_at, s.current_period_end, s.grace_ends_at,
            s.trial_reminder_sent_at,
            p.name AS plan_name,
            owner.email AS owner_email
       FROM clinics c
       LEFT JOIN subscriptions s
              ON s.clinic_id = c.id
             AND s.status IN ('trialing', 'active', 'past_due')
       LEFT JOIN plans p ON p.id = s.plan_id
       LEFT JOIN users owner ON owner.id = c.owner_user_id
      WHERE c.status NOT IN ('suspended', 'cancelled')`
  )

  const changes = []
  let reminded = 0

  for (const clinic of clinics) {
    /* ------------------------------------------- the trial-ending reminder */
    /**
     * Sent once, in the last few days of the trial.
     *
     * This is the only email in the app that has to be sent by a scheduler
     * rather than in response to something happening — nobody clicks a button
     * to make a trial run out. `trial_reminder_sent_at` is what keeps it to one
     * email instead of one a night, and it is stamped BEFORE the send so a
     * crash mid-send cannot turn into a week of duplicates.
     */
    const left = trialDaysLeft(clinic)
    if (
      clinic.subscription_status === 'trialing' &&
      clinic.owner_email &&
      !clinic.trial_reminder_sent_at &&
      left !== null &&
      left <= REMIND_WITHIN_DAYS
    ) {
      await query('UPDATE subscriptions SET trial_reminder_sent_at = NOW() WHERE id = ?', [
        clinic.subscription_id,
      ])
      sendEmailInBackground({
        to: clinic.owner_email,
        ...trialEndingSoon({
          clinic: { name: clinic.name, slug: clinic.slug },
          daysLeft: left,
          planName: clinic.plan_name,
        }),
      })
      reminded++
    }

    const derived = effectiveStatus(clinic)
    if (derived === clinic.status) continue

    /**
     * Stamp a grace deadline the first time a clinic goes past_due, so the
     * countdown is a fixed date rather than being recalculated (and effectively
     * extended) on every sweep.
     */
    if (derived === 'past_due' && !clinic.grace_ends_at && clinic.subscription_id) {
      await query(
        `UPDATE subscriptions
            SET status = 'past_due',
                grace_ends_at = DATE_ADD(NOW(), INTERVAL ? DAY)
          WHERE id = ?`,
        [platform.graceDays, clinic.subscription_id]
      )
    }

    // A clinic that has run out of grace has no live subscription any more.
    if (derived === 'read_only' && clinic.subscription_id) {
      await query(
        `UPDATE subscriptions
            SET status = 'expired', cancelled_at = NOW(), cancelled_by = 'system',
                cancel_reason = 'Trial or billing period lapsed'
          WHERE id = ? AND status IN ('trialing', 'past_due')`,
        [clinic.subscription_id]
      )
    }

    await query('UPDATE clinics SET status = ? WHERE id = ?', [derived, clinic.id])
    changes.push({ clinic: clinic.slug, from: clinic.status, to: derived })
  }

  /**
   * Housekeeping, here rather than on the sign-in path.
   *
   * login_attempts grows by one row per attacked address, and login_otps by one
   * per code ever requested. A DELETE on every login would be a write in front of
   * the most latency-sensitive thing in the app, for tables that only need tidying
   * once a day.
   *
   * The OTP table matters slightly more: a spent code is useless but its bcrypt
   * hash is still a hash of a real secret, and keeping millions of them is a
   * liability with no upside.
   */
  const purged = await purgeOldLoginAttempts()
  const purgedOtps = await purgeOldOtps()
  const purgedResets = await purgeOldResets()
  /**
   * Resolved faults only, and only after a fortnight.
   *
   * An UNRESOLVED error is never deleted however old it is — one that has been
   * failing quietly since March is the most important row in that table, not the
   * least, and a purge by age alone would delete exactly the ones worth finding.
   */
  const purgedErrors = await purgeOldErrors()

  return {
    checked: clinics.length,
    changed: changes.length,
    reminded,
    ended,
    purged,
    purgedOtps,
    purgedResets,
    purgedErrors,
    changes,
  }
}
