'use server'

/**
 * ============================================================================
 *  SERVER ACTIONS — the clinic's own rules
 * ============================================================================
 *  The handful of numbers that decide how the clinic behaves rather than what it
 *  looks like: how late somebody may cancel, what a no-show costs, whether
 *  reception may book without taking money, how long a gap counts as lapsed.
 *
 *  These are the settings a clinic owner actually changes after a month of using
 *  the software, once they have seen how their patients behave.
 * ============================================================================
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { query } from '@/lib/db'
import { toPaise } from '@/lib/utils'

/**
 * Policies are the OWNER's business, not a physiotherapist's.
 *
 * A therapist deciding the no-show fee is the same category of mistake as a
 * therapist seeing the subscription — see the adminOnly filter in
 * app/admin/layout.js.
 */
async function requireClinicAdmin() {
  const clinic = await getCurrentClinic()
  if (!clinic) throw new Error('NO_CLINIC')

  const session = await auth()
  if (!session?.user) throw new Error('UNAUTHENTICATED')
  if (session.user.role === 'platform') return clinic
  if (session.user.role !== 'admin') throw new Error('FORBIDDEN')
  if (Number(session.user.clinicId) !== Number(clinic.id)) throw new Error('FORBIDDEN')

  return clinic
}

const policySchema = z.object({
  freeCancellationHours: z.coerce.number().int().min(0).max(168),
  noShowFeeRupees: z.coerce.number().min(0).max(100_000),
  lateCancelForfeitsSession: z.coerce.boolean(),
  allowPayAtClinic: z.coerce.boolean(),
  homeTravelBufferMins: z.coerce.number().int().min(0).max(240),
  recallAfterDays: z.coerce.number().int().min(7).max(730),
  bookingMinNoticeMins: z.coerce.number().int().min(0).max(10_080),
  bookingHoldMins: z.coerce.number().int().min(5).max(120),
})

export async function savePolicies(input = {}) {
  let clinic
  try {
    clinic = await requireClinicAdmin()
  } catch (error) {
    const messages = {
      NO_CLINIC: 'This clinic could not be found.',
      UNAUTHENTICATED: 'Your session has expired. Please sign in again.',
      FORBIDDEN: 'Only the clinic administrator can change the policies.',
    }
    return { ok: false, error: messages[error.message] || 'Something went wrong.' }
  }

  const parsed = policySchema.safeParse({
    freeCancellationHours: input.freeCancellationHours,
    noShowFeeRupees: input.noShowFeeRupees || 0,
    lateCancelForfeitsSession: Boolean(input.lateCancelForfeitsSession),
    allowPayAtClinic: Boolean(input.allowPayAtClinic),
    homeTravelBufferMins: input.homeTravelBufferMins,
    recallAfterDays: input.recallAfterDays,
    bookingMinNoticeMins: input.bookingMinNoticeMins,
    bookingHoldMins: input.bookingHoldMins,
  })

  if (!parsed.success) {
    const errors = {}
    for (const issue of parsed.error.issues) errors[issue.path[0]] = issue.message
    return { ok: false, errors, error: 'Please check the highlighted fields.' }
  }

  const data = parsed.data

  try {
    await query(
      `UPDATE clinics
          SET free_cancellation_hours = ?,
              no_show_fee_paise = ?,
              late_cancel_forfeits_session = ?,
              allow_pay_at_clinic = ?,
              home_travel_buffer_mins = ?,
              recall_after_days = ?,
              booking_min_notice_mins = ?,
              booking_hold_mins = ?
        WHERE id = ?`,
      [
        data.freeCancellationHours,
        toPaise(data.noShowFeeRupees),
        data.lateCancelForfeitsSession ? 1 : 0,
        data.allowPayAtClinic ? 1 : 0,
        data.homeTravelBufferMins,
        data.recallAfterDays,
        data.bookingMinNoticeMins,
        data.bookingHoldMins,
        clinic.id,
      ]
    )

    // These change what patients are told on the public site as well as what the
    // app enforces, so the booking pages have to be rebuilt.
    revalidatePath('/admin/settings/policies')
    revalidatePath('/admin/recalls')
    revalidatePath('/book')
    revalidatePath('/', 'layout')

    return {
      ok: true,
      message: 'Policies saved. They apply to new bookings from now on.',
    }
  } catch (error) {
    console.error('[savePolicies]', error)
    return { ok: false, error: 'Could not save those policies.' }
  }
}
