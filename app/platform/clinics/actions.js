'use server'

/**
 * ============================================================================
 *  PLATFORM ACTIONS — the ones that reach across every tenant
 * ============================================================================
 *
 *  These are the most dangerous functions in the codebase. Everything else is
 *  scoped to one clinic by construction; these deliberately are not, because
 *  suspending a customer or extending their trial means acting ON a tenant from
 *  outside it.
 *
 *  So every one begins with the same guard, and the guard checks a role that
 *  only exists on accounts with no clinic at all. There is no "clinic admin who
 *  is also platform staff" — the tenancy CHECK constraint in the schema makes
 *  that combination impossible to create.
 * ============================================================================
 */

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { query, queryOne } from '@/lib/db'

/**
 * Throws unless the caller is platform staff on the platform's own hostname.
 *
 * The hostname half matters: without it, a clinic subdomain could serve these
 * actions, and a bug in the middleware matcher would be enough to expose
 * cross-tenant writes through a customer's own domain.
 */
async function requirePlatform() {
  const clinic = await getCurrentClinic()
  if (clinic) throw new Error('WRONG_HOST')

  const session = await auth()
  if (!session?.user) throw new Error('UNAUTHENTICATED')
  if (session.user.role !== 'platform') throw new Error('FORBIDDEN')

  return session.user
}

function failure(error) {
  const messages = {
    WRONG_HOST: 'That is not available here.',
    UNAUTHENTICATED: 'Your session has expired. Please sign in again.',
    FORBIDDEN: 'You are not allowed to do that.',
  }
  return { ok: false, error: messages[error.message] || 'Something went wrong.' }
}

/* ========================================================================== */
/*  SUSPEND / REINSTATE                                                       */
/* ========================================================================== */

/**
 * Switch a clinic off, or back on.
 *
 * WHAT SUSPENDING DOES AND DOES NOT DO
 * ------------------------------------
 * It takes the clinic's public website offline and blocks every login, including
 * the owner's. It does NOT delete anything: patients, appointments, clinical
 * notes and invoices are all untouched, and reinstating restores the clinic
 * exactly as it was.
 *
 * That distinction is not a nicety. These are medical records belonging to real
 * patients, and a billing dispute is not a reason to destroy them — in most
 * jurisdictions it is not even legal to.
 */
export async function setClinicStatus(clinicId, status) {
  try {
    await requirePlatform()
  } catch (error) {
    return failure(error)
  }

  // An allow-list. `status` arrives from the browser, and without this a caller
  // could set any value the ENUM accepts — including 'active' on a clinic that
  // has never paid.
  const allowed = ['active', 'suspended', 'trialing', 'read_only', 'cancelled']
  if (!allowed.includes(status)) {
    return { ok: false, error: 'That is not a status we recognise.' }
  }

  try {
    const clinic = await queryOne('SELECT id, name FROM clinics WHERE id = ?', [clinicId])
    if (!clinic) return { ok: false, error: 'Clinic not found.' }

    await query('UPDATE clinics SET status = ? WHERE id = ?', [status, clinicId])

    revalidatePath('/platform')
    revalidatePath('/platform/clinics')

    const wording = {
      suspended: 'suspended — their website is offline and nobody can sign in',
      active: 'reinstated',
      trialing: 'moved back onto a trial',
      read_only: 'set to read-only — they can view everything but take no new bookings',
      cancelled: 'marked as cancelled',
    }
    return { ok: true, message: `${clinic.name} ${wording[status]}. No data was deleted.` }
  } catch (error) {
    console.error('[platform/setClinicStatus]', error)
    return { ok: false, error: 'Could not update that clinic.' }
  }
}

/* ========================================================================== */
/*  EXTEND A TRIAL                                                            */
/* ========================================================================== */

/**
 * Give a clinic more time.
 *
 * Genuinely useful in a young business: somebody promising is mid-setup when
 * their trial runs out, and the choice is a few more days or losing them. Being
 * able to do it in one click, rather than by editing SQL, is the difference
 * between saving that customer and not.
 */
export async function extendTrial(clinicId, days = 14) {
  try {
    await requirePlatform()
  } catch (error) {
    return failure(error)
  }

  const extra = Math.min(Math.max(Number(days) || 0, 1), 90)

  try {
    const subscription = await queryOne(
      `SELECT id, status FROM subscriptions
        WHERE clinic_id = ? AND status IN ('trialing', 'past_due', 'active')
        ORDER BY id DESC LIMIT 1`,
      [clinicId]
    )
    if (!subscription) return { ok: false, error: 'That clinic has no live subscription.' }

    await query(
      `UPDATE subscriptions
          SET status = 'trialing',
              trial_ends_at = DATE_ADD(GREATEST(COALESCE(trial_ends_at, NOW()), NOW()), INTERVAL ? DAY),
              current_period_end = DATE_ADD(GREATEST(COALESCE(trial_ends_at, NOW()), NOW()), INTERVAL ? DAY),
              grace_ends_at = NULL
        WHERE id = ?`,
      [extra, extra, subscription.id]
    )

    // Put the clinic back in business if the lapse had already locked it.
    await query(
      `UPDATE clinics SET status = 'trialing'
        WHERE id = ? AND status IN ('past_due', 'read_only')`,
      [clinicId]
    )

    revalidatePath('/platform')
    revalidatePath('/platform/clinics')
    return { ok: true, message: `Trial extended by ${extra} days.` }
  } catch (error) {
    console.error('[platform/extendTrial]', error)
    return { ok: false, error: 'Could not extend that trial.' }
  }
}

/* ========================================================================== */
/*  CHANGE A CLINIC'S PLAN                                                    */
/* ========================================================================== */

/** Move a clinic onto a different plan — for a manual upgrade or a deal. */
export async function changePlan(clinicId, planCode) {
  try {
    await requirePlatform()
  } catch (error) {
    return failure(error)
  }

  try {
    const plan = await queryOne(
      `SELECT id, name, price_paise, billing_period FROM plans WHERE code = ? AND is_active = 1`,
      [planCode]
    )
    if (!plan) return { ok: false, error: 'No such plan.' }

    const subscription = await queryOne(
      `SELECT id FROM subscriptions
        WHERE clinic_id = ? AND status IN ('trialing', 'active', 'past_due')
        ORDER BY id DESC LIMIT 1`,
      [clinicId]
    )
    if (!subscription) return { ok: false, error: 'That clinic has no live subscription.' }

    // price_paise is copied onto the subscription, not read from the plan, so a
    // later price rise does not silently change what this clinic pays. Same
    // reasoning as appointments.amount_paise.
    await query(
      `UPDATE subscriptions SET plan_id = ?, price_paise = ?, billing_period = ? WHERE id = ?`,
      [plan.id, plan.price_paise, plan.billing_period, subscription.id]
    )

    revalidatePath('/platform')
    revalidatePath('/platform/clinics')
    return { ok: true, message: `Moved onto ${plan.name}.` }
  } catch (error) {
    console.error('[platform/changePlan]', error)
    return { ok: false, error: 'Could not change that plan.' }
  }
}
