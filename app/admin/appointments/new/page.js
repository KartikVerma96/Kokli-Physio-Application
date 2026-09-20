import Link from 'next/link'
import { ArrowLeft, Info } from 'lucide-react'
import { requireCurrentClinic } from '@/lib/tenant'
import { getAllServices } from '@/lib/queries'
import { canAcceptBookings } from '@/lib/subscriptionLifecycle'
import { getClinicSubscription } from '@/lib/queries'
import { Card } from '@/components/ui/Card'
import DeskBooking from './DeskBooking'

/**
 * ============================================================================
 *  NEW APPOINTMENT  →  /admin/appointments/new
 * ============================================================================
 *  Reception books a patient who telephoned, or who is standing at the desk.
 *
 *  This is the screen the clinic will use more than any other. Most physiotherapy
 *  patients do not book online — they ring up, or they walk in with a referral
 *  from an orthopaedic surgeon. Before this page existed the only way into the
 *  diary was a patient booking themselves and paying by card within fifteen
 *  minutes, which meant the real diary stayed on paper.
 * ============================================================================
 */

export const metadata = { title: 'New appointment', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function NewAppointmentPage() {
  const clinic = await requireCurrentClinic()

  const [services, subscription] = await Promise.all([
    getAllServices(clinic.id),
    getClinicSubscription(clinic.id),
  ])

  // The same gate the online booking endpoint applies. A lapsed clinic keeps every
  // record and can still see its diary, but cannot add to it — and reception
  // should be told that here rather than after filling the form in.
  const bookable = canAcceptBookings({
    ...clinic,
    subscription_status: subscription?.status,
    trial_ends_at: subscription?.trial_ends_at,
    current_period_end: subscription?.current_period_end,
    grace_ends_at: subscription?.grace_ends_at,
  })

  const active = services
    .filter((s) => s.is_active)
    .map((s) => ({
      id: s.id,
      name: s.name,
      pricePaise: Number(s.price_paise),
      durationMinutes: Number(s.duration_minutes),
      availableOnline: Boolean(s.available_online),
      availableClinic: Boolean(s.available_clinic),
    }))

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/admin/appointments"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 transition-colors hover:text-brand-700 dark:hover:text-brand-300"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to the diary
      </Link>

      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">New appointment</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          For a patient who telephoned or walked in.
        </p>
      </div>

      {!bookable && (
        <Card className="flex items-start gap-3 border-amber-300 p-5 text-sm dark:border-amber-800">
          <Info className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <p className="font-bold text-amber-900 dark:text-amber-100">
              New bookings are paused
            </p>
            <p className="mt-1 text-amber-800 dark:text-amber-200">
              Your subscription has lapsed. Every patient record and appointment is safe and you can
              still see the diary, but no new appointments can be taken until it is active again.{' '}
              <Link href="/admin/billing" className="font-semibold underline">
                Sort out billing
              </Link>
              .
            </p>
          </div>
        </Card>
      )}

      {active.length === 0 ? (
        <Card className="p-6 text-sm">
          <p className="font-bold">No treatments yet</p>
          <p className="mt-1 text-ink-600 dark:text-ink-400">
            Add at least one treatment in{' '}
            <Link href="/admin/services" className="font-semibold text-brand-700 underline dark:text-brand-400">
              Services &amp; pricing
            </Link>{' '}
            before booking anybody in.
          </p>
        </Card>
      ) : (
        <DeskBooking
          services={active}
          allowPayLater={Boolean(clinic.allow_pay_at_clinic)}
          disabled={!bookable}
        />
      )}
    </div>
  )
}
