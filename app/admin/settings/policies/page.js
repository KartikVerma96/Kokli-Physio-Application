import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import PolicyForm from './PolicyForm'

/**
 * ============================================================================
 *  POLICIES  →  /admin/settings/policies
 * ============================================================================
 *  The numbers that decide how the clinic behaves.
 *
 *  Every one of these has a real consequence, which is why each field on the form
 *  says what it is and what happens if you get it wrong rather than just carrying
 *  a label. A no-show fee set to the full session price will lose the clinic
 *  patients; set to zero it loses the clinic money. Nobody can pick well from a
 *  bare number box.
 * ============================================================================
 */

export const metadata = { title: 'Policies', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function PoliciesPage() {
  const clinic = await requireCurrentClinic()
  const session = await auth()

  if (!['admin', 'platform'].includes(session?.user?.role)) redirect('/admin')

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Policies</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Cancellations, no-shows, and how the diary behaves.
        </p>
      </div>

      <PolicyForm
        policies={{
          freeCancellationHours: Number(clinic.free_cancellation_hours) || 0,
          noShowFeeRupees: Math.round((Number(clinic.no_show_fee_paise) || 0) / 100),
          lateCancelForfeitsSession: Boolean(clinic.late_cancel_forfeits_session),
          allowPayAtClinic: Boolean(clinic.allow_pay_at_clinic),
          homeTravelBufferMins: Number(clinic.home_travel_buffer_mins) || 0,
          recallAfterDays: Number(clinic.recall_after_days) || 60,
          bookingMinNoticeMins: Number(clinic.booking_min_notice_mins) || 0,
          bookingHoldMins: Number(clinic.booking_hold_mins) || 15,
        }}
      />
    </div>
  )
}
