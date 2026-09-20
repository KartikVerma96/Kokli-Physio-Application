import Link from 'next/link'
import { TriangleAlert, Clock, CreditCard } from 'lucide-react'
import { auth } from '@/lib/auth'
import { trialDaysRemaining } from '@/lib/tenant'

/**
 * ============================================================================
 *  CLINIC STATUS BANNER — shown to clinic STAFF, never to patients
 * ============================================================================
 *
 *  Warns the clinic owner about things only they should know: the trial is
 *  ending, a payment failed, payments are not connected yet.
 *
 *  THE ROLE CHECK IS THE WHOLE POINT
 *  ---------------------------------
 *  This sits in the PUBLIC layout, so it renders on the clinic's patient-facing
 *  website. A patient must never see "your trial expires in 3 days" — it is
 *  commercially embarrassing for the clinic and completely irrelevant to
 *  somebody trying to book an appointment for their back.
 *
 *  So it renders only for admin and physio accounts of THIS clinic. Everyone
 *  else — patients, and anyone signed out — gets nothing at all.
 * ============================================================================
 */

export default async function ClinicStatusBanner({ clinic }) {
  const session = await auth()
  const user = session?.user

  if (!user) return null
  if (!['admin', 'physio'].includes(user.role)) return null
  // A staff member of a DIFFERENT clinic browsing this one must not see its
  // billing state either.
  if (Number(user.clinicId) !== Number(clinic.id)) return null

  const banner = chooseBanner(clinic)
  if (!banner) return null

  return (
    <div className={`border-b ${banner.classes}`}>
      <div className="container-page flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <banner.icon className="size-4 shrink-0" aria-hidden="true" />
          {banner.message}
        </p>
        {banner.action && (
          <Link
            href={banner.action.href}
            className="shrink-0 rounded-lg bg-white/70 px-3 py-1 text-xs font-bold underline-offset-2 hover:underline dark:bg-black/20"
          >
            {banner.action.label}
          </Link>
        )}
      </div>
    </div>
  )
}

/**
 * Only ever ONE banner, chosen by severity.
 *
 * Stacking three warnings teaches people to ignore all of them. The order below
 * is deliberate: money problems that will stop the business outrank a trial
 * countdown, which outranks a setup reminder.
 */
function chooseBanner(clinic) {
  if (clinic.status === 'read_only') {
    return {
      icon: TriangleAlert,
      classes:
        'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100',
      message:
        'Your subscription has lapsed. Your records are all safe, but you cannot take new bookings until you resubscribe.',
      action: { href: '/admin/billing', label: 'Reactivate' },
    }
  }

  if (clinic.status === 'past_due') {
    return {
      icon: CreditCard,
      classes:
        'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100',
      message: 'Your last payment failed. Please update your payment method to avoid interruption.',
      action: { href: '/admin/billing', label: 'Fix payment' },
    }
  }

  // Payments not connected is more urgent than a trial countdown: the booking
  // page cannot take money at all, which the owner may not have realised.
  if (!clinic.razorpay_key_id) {
    return {
      icon: CreditCard,
      classes:
        'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100',
      message:
        'Payments are not connected yet, so patients cannot pay for bookings. Connect your Razorpay account to start taking appointments.',
      action: { href: '/admin/settings/payments', label: 'Connect Razorpay' },
    }
  }

  const daysLeft = trialDaysRemaining(clinic)
  // Silent until the last week — a countdown from day 30 is just nagging.
  if (daysLeft !== null && daysLeft <= 7) {
    return {
      icon: Clock,
      classes:
        'border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-900 dark:bg-brand-950/60 dark:text-brand-100',
      message:
        daysLeft === 0
          ? 'Your free trial ends today. Choose a plan to keep taking bookings.'
          : `Your free trial ends in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}.`,
      action: { href: '/admin/billing', label: 'Choose a plan' },
    }
  }

  return null
}
