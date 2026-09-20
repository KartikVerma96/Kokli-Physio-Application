'use server'

/**
 * ============================================================================
 *  PLAN EDITING — the platform's own price list
 * ============================================================================
 *
 *  Changing a row here changes what every clinic can do, what the pricing page
 *  advertises and what new subscribers are charged. It is the highest-leverage
 *  form in the application, so it gets the same guard as the rest of /platform
 *  and a few rules of its own.
 *
 *  THE ONE THING TO UNDERSTAND: RAZORPAY PLANS ARE IMMUTABLE
 *  ---------------------------------------------------------
 *  A Razorpay plan's amount cannot be edited after it is created. So changing a
 *  price here cannot update the plan sitting in Razorpay — instead we clear the
 *  cached `razorpay_plan_id`, and the next clinic to subscribe causes a fresh
 *  Razorpay plan to be created at the new price (see ensureRazorpayPlan).
 *
 *  Which means: existing subscribers keep paying the old amount until they
 *  re-subscribe. That is not a bug to work around — it is the correct behaviour,
 *  and in most places the legally required one. You do not get to raise the
 *  price on an active mandate somebody already authorised.
 * ============================================================================
 */

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { query, queryOne } from '@/lib/db'
import { toPaise } from '@/lib/utils'

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

/** A whole number within bounds, or the fallback. */
function intIn(value, { min, max, fallback }) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n < min || n > max) return fallback
  return n
}

/* ========================================================================== */
/*  SAVE A PLAN                                                               */
/* ========================================================================== */

export async function savePlan(previousState, formData) {
  try {
    await requirePlatform()
  } catch (error) {
    return failure(error)
  }

  const id = Number(formData.get('id'))
  const existing = await queryOne('SELECT * FROM plans WHERE id = ?', [id])
  if (!existing) return { ok: false, error: 'That plan no longer exists.' }

  const name = String(formData.get('name') || '').trim()
  const tagline = String(formData.get('tagline') || '').trim()
  const priceRupees = Number(formData.get('priceRupees'))

  const errors = {}
  if (name.length < 2) errors.name = 'Give the plan a name'
  // A ₹0 plan is a legitimate thing to want (a free tier), but it must be
  // deliberate rather than the result of an empty box.
  if (!Number.isFinite(priceRupees) || priceRupees < 0 || priceRupees > 1_000_000) {
    errors.priceRupees = 'Enter a price between ₹0 and ₹10,00,000'
  }
  if (Object.keys(errors).length) {
    return { ok: false, errors, error: 'Please check the highlighted fields.' }
  }

  const pricePaise = toPaise(priceRupees)

  // One bullet per line in the textarea → a JSON array in the column. Blank
  // lines are dropped so a stray Enter does not put an empty bullet on the
  // pricing page.
  const highlights = String(formData.get('highlights') || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  // Listed in the same order as the ? placeholders below. Written out as a plain
  // array rather than built from an object, because a `?` silently taking the
  // wrong value is the kind of bug that only shows up on somebody's bill.
  const values = [
    name,
    tagline || null,
    pricePaise,
    intIn(formData.get('trialDays'), { min: 0, max: 365, fallback: existing.trial_days }),
    intIn(formData.get('maxPhysios'), { min: 1, max: 500, fallback: existing.max_physios }),
    intIn(formData.get('maxLocations'), { min: 1, max: 100, fallback: existing.max_locations }),
    formData.get('videoEnabled') ? 1 : 0,
    formData.get('soapNotesEnabled') ? 1 : 0,
    formData.get('whatsappEnabled') ? 1 : 0,
    formData.get('whatsappOwnNumber') ? 1 : 0,
    intIn(formData.get('whatsappQuota'), { min: 0, max: 100000, fallback: existing.whatsapp_monthly_quota }),
    formData.get('analyticsEnabled') ? 1 : 0,
    JSON.stringify(highlights),
    formData.get('isActive') ? 1 : 0,
    intIn(formData.get('sortOrder'), { min: 0, max: 999, fallback: existing.sort_order }),
  ]

  /**
   * The price changed → the cached Razorpay plan is now wrong, so forget it.
   *
   * Leaving it in place would be the expensive kind of bug: every new subscriber
   * would silently be charged the OLD amount, and nothing in the app would look
   * broken. You would find out from your bank statement.
   */
  const priceChanged = Number(existing.price_paise) !== pricePaise
  const razorpayClause = priceChanged ? ', razorpay_plan_id = NULL' : ''

  try {
    await query(
      `UPDATE plans
          SET name = ?, tagline = ?, price_paise = ?, trial_days = ?,
              max_physios = ?, max_locations = ?,
              video_enabled = ?, soap_notes_enabled = ?, whatsapp_enabled = ?,
              whatsapp_own_number = ?, whatsapp_monthly_quota = ?,
              analytics_enabled = ?, highlights = CAST(? AS JSON),
              is_active = ?, sort_order = ?${razorpayClause}
        WHERE id = ?`,
      [...values, id]
    )

    revalidatePath('/platform/plans')
    revalidatePath('/pricing')
    revalidatePath('/home')
    revalidatePath('/admin/billing')

    return {
      ok: true,
      message: priceChanged
        ? `${name} saved at ₹${priceRupees.toLocaleString('en-IN')}/month. Clinics already subscribed keep their current price.`
        : `${name} saved.`,
    }
  } catch (error) {
    console.error('[platform/savePlan]', error)
    return { ok: false, error: 'Could not save that plan.' }
  }
}

/* ========================================================================== */
/*  RETIRE / RESTORE                                                          */
/* ========================================================================== */

/**
 * Hide a plan from the pricing page without touching anybody on it.
 *
 * This is how a price rise is done properly: retire the old row, add a new one
 * at the new price. Existing customers keep the plan they signed up for, which
 * is both fair and what their mandate actually authorises, and new customers
 * only ever see the current price.
 *
 * Deleting the row instead would break the foreign key from `subscriptions` —
 * and rightly so. A subscription has to be able to say what it is a subscription
 * to, forever.
 */
export async function setPlanActive(planId, active) {
  try {
    await requirePlatform()
  } catch (error) {
    return failure(error)
  }

  try {
    const plan = await queryOne('SELECT id, name FROM plans WHERE id = ?', [planId])
    if (!plan) return { ok: false, error: 'Plan not found.' }

    if (!active) {
      const row = await queryOne(
        `SELECT COUNT(*) AS n FROM subscriptions
          WHERE plan_id = ? AND status IN ('trialing', 'active', 'past_due')`,
        [planId]
      )
      const live = Number(row?.n ?? 0)

      await query('UPDATE plans SET is_active = 0 WHERE id = ?', [planId])
      revalidatePath('/platform/plans')
      revalidatePath('/pricing')
      revalidatePath('/home')

      return {
        ok: true,
        message: live
          ? `${plan.name} is hidden from the pricing page. The ${live} clinic${live === 1 ? '' : 's'} on it are unaffected and keep billing normally.`
          : `${plan.name} is hidden from the pricing page.`,
      }
    }

    await query('UPDATE plans SET is_active = 1 WHERE id = ?', [planId])
    revalidatePath('/platform/plans')
    revalidatePath('/pricing')
    revalidatePath('/home')
    return { ok: true, message: `${plan.name} is on sale again.` }
  } catch (error) {
    console.error('[platform/setPlanActive]', error)
    return { ok: false, error: 'Could not update that plan.' }
  }
}
