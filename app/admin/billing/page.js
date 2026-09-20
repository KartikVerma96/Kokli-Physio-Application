import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CreditCard, Receipt, CheckCircle2, TriangleAlert, Clock, XCircle, CalendarClock } from 'lucide-react'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { getPublicPlans, getClinicSubscription, getClinicInvoices } from '@/lib/queries'
import { effectiveStatus, trialDaysLeft, graceDaysLeft, isCancelling } from '@/lib/subscriptionLifecycle'
import { isBillingDemoMode } from '@/lib/platformBilling'
import { formatMoney, formatDateLong } from '@/lib/utils'
import { platform } from '@/config/platform'
import { Card, Badge, EmptyState } from '@/components/ui/Card'
import PlanChooser from './PlanChooser'
import CancelSubscription from './CancelSubscription'

/**
 * ============================================================================
 *  BILLING  →  /admin/billing
 * ============================================================================
 *  Where a clinic sees what they are on, chooses a plan, and reads their
 *  invoices.
 *
 *  Like /admin/settings/payments, this page existed as a LINK before it existed
 *  as a page — the trial banner has always pointed here. "Reactivate" leading to
 *  a 404 is the worst possible moment for a broken link, because it is precisely
 *  when someone is trying to give you money.
 *
 *  A NOTE ON THE STATUS SHOWN
 *  --------------------------
 *  It comes from `effectiveStatus()`, derived from the dates — not from the
 *  stored `clinics.status` column, which is only as fresh as the last sweep. A
 *  clinic whose trial expired an hour ago sees the truth, whether or not any
 *  scheduled job has run. See lib/subscriptionLifecycle.js.
 * ============================================================================
 */

export const metadata = { title: 'Billing', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function BillingPage() {
  const clinic = await requireCurrentClinic()
  const session = await auth()

  // Money is the owner's business. A physiotherapist has no reason to see the
  // clinic's invoices, and Admin → Billing is not in their sidebar anyway — this
  // is the check that makes that real rather than cosmetic.
  if (!['admin', 'platform'].includes(session?.user?.role)) redirect('/admin')

  const [plans, subscription, invoices] = await Promise.all([
    getPublicPlans(),
    getClinicSubscription(clinic.id),
    getClinicInvoices(clinic.id, { limit: 24 }),
  ])

  const status = effectiveStatus(clinic)
  const trialLeft = trialDaysLeft(clinic)
  const graceLeft = graceDaysLeft(clinic)
  const demo = isBillingDemoMode()

  /**
   * Already on its way out?
   *
   * `clinic` carries the subscription columns via the tenant query, so this reads
   * the same row the gates elsewhere read — see isCancelling() in
   * lib/subscriptionLifecycle.js for why the state is derived rather than stored.
   */
  const cancelling = isCancelling(clinic)
  const canCancel =
    !cancelling && ['trialing', 'active', 'past_due'].includes(subscription?.status)

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Billing</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Your {platform.name} subscription and invoices.
        </p>
      </div>

      {demo && (
        // Loud, because otherwise someone could believe they have set up real
        // billing when nothing would ever be charged.
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-amber-900 dark:text-amber-200">
            <strong>Demo mode.</strong> The platform has no Razorpay keys configured, so
            subscribing here is simulated and no money moves. Set{' '}
            <code>PLATFORM_RAZORPAY_KEY_ID</code> and <code>PLATFORM_RAZORPAY_KEY_SECRET</code> to
            take real payments.
          </p>
        </div>
      )}

      {/* ------------------------------------------------------ where you are */}
      <StatusCard
        status={status}
        subscription={subscription}
        trialLeft={trialLeft}
        graceLeft={graceLeft}
      />

      {/* --------------------------------------------------------- the plans */}
      <div>
        <h2 className="text-lg font-bold">
          {subscription?.status === 'active' ? 'Change your plan' : 'Choose a plan'}
        </h2>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Month to month. No contract, and we never take a commission on your patient bookings.
        </p>

        <PlanChooser
          plans={plans.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            tagline: p.tagline,
            pricePaise: p.price_paise,
            maxPhysios: p.max_physios,
            videoEnabled: Boolean(p.video_enabled),
            whatsappEnabled: Boolean(p.whatsapp_enabled),
            analyticsEnabled: Boolean(p.analytics_enabled),
            highlights: Array.isArray(p.highlights) ? p.highlights : [],
          }))}
          currentPlanCode={subscription?.plan_code ?? null}
          isActive={subscription?.status === 'active'}
        />
      </div>

      {/* --------------------------------------------- already ending? say so */}
      {/* Above the plan chooser, because a clinic that has cancelled and then
          returns to this page is checking one thing: the date. It should not have
          to hunt for it. */}
      {cancelling && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950/30">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
          <div className="text-amber-900 dark:text-amber-100">
            <p className="font-bold">
              Your subscription ends on {formatDateLong(clinic.current_period_end)}.
            </p>
            <p className="mt-0.5 text-amber-800 dark:text-amber-200">
              You will not be charged again, and everything works normally until then. Nothing is
              deleted afterwards — you and your team keep read access to every record. To carry on
              past that date, choose a plan below and authorise payment again.
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- the invoices */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-ink-100 p-5 dark:border-ink-800">
          <Receipt className="size-4 text-brand-600" aria-hidden="true" />
          <h2 className="font-bold">Invoices</h2>
        </div>

        {invoices.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-6" />}
            title="No invoices yet"
            description="Your first invoice appears here once your trial converts to a paid plan."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50/60 text-left dark:border-ink-800 dark:bg-ink-800/40">
                <tr>
                  <Th>Invoice</Th>
                  <Th>Date</Th>
                  <Th>Period</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-4 py-3 font-mono text-xs">{invoice.number}</td>
                    <td className="px-4 py-3">
                      {formatDateLong(invoice.paid_at || invoice.created_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-500">
                      {invoice.period_start
                        ? `${String(invoice.period_start).slice(0, 10)} → ${String(invoice.period_end).slice(0, 10)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {formatMoney(invoice.amount_paise + invoice.tax_paise)}
                      <span className="block text-[11px] font-normal text-ink-400">
                        incl. {platform.gstPercent}% GST
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge
                        tone={
                          invoice.status === 'paid'
                            ? 'success'
                            : invoice.status === 'failed'
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {invoice.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-center text-xs text-ink-500">
        Questions about billing?{' '}
        <a
          href={`mailto:${platform.supportEmail}`}
          className="font-semibold text-brand-700 underline dark:text-brand-400"
        >
          {platform.supportEmail}
        </a>
        {' · '}
        <Link href="/admin/settings/payments" className="font-semibold text-brand-700 underline dark:text-brand-400">
          Patient payment settings
        </Link>
      </p>

      {/* ------------------------------------------------------- cancelling */}
      {/* Last on the page. A destructive action belongs at the end, after
          everything a clinic normally came here to do — not hidden, just not in
          the way. The panel itself is in CancelSubscription.js. */}
      {canCancel && (
        <CancelSubscription
          onTrial={subscription?.status === 'trialing'}
          periodEndLabel={
            clinic.current_period_end ? formatDateLong(clinic.current_period_end) : 'the end of this month'
          }
        />
      )}

    </div>
  )
}

/* -------------------------------------------------------------------------- */

function StatusCard({ status, subscription, trialLeft, graceLeft }) {
  const presets = {
    trialing: {
      icon: Clock,
      tone: 'brand',
      title: `Free trial — ${trialLeft ?? 0} day${trialLeft === 1 ? '' : 's'} left`,
      body: 'Everything is unlocked. Choose a plan before the trial ends to keep taking bookings.',
    },
    active: {
      icon: CheckCircle2,
      tone: 'success',
      title: `${subscription?.plan_name ?? 'Your plan'} — active`,
      body: subscription?.current_period_end
        ? `Renews on ${formatDateLong(subscription.current_period_end)}.`
        : 'Your subscription is active.',
    },
    past_due: {
      icon: TriangleAlert,
      tone: 'warning',
      title: 'Payment needs attention',
      body: `Your last payment did not go through. Everything still works for ${graceLeft ?? platform.graceDays} more day${graceLeft === 1 ? '' : 's'}, then new bookings pause. Your records are never deleted.`,
    },
    read_only: {
      icon: XCircle,
      tone: 'danger',
      title: 'Read-only — new bookings are paused',
      body: 'You can still open every patient record, note and invoice, and export them. Choose a plan below to start taking bookings again.',
    },
    suspended: {
      icon: XCircle,
      tone: 'danger',
      title: 'Account suspended',
      body: `Your account has been suspended. Please contact ${platform.supportEmail}.`,
    },
    cancelled: {
      icon: XCircle,
      tone: 'neutral',
      title: 'Subscription cancelled',
      body: 'Choose a plan below whenever you would like to start again. Nothing has been deleted.',
    },
  }

  const preset = presets[status] || presets.read_only

  return (
    <Card className="p-6">
      <div className="flex items-start gap-4">
        <span
          className={`grid size-12 shrink-0 place-items-center rounded-2xl ${
            {
              brand: 'bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-300',
              success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400',
              warning: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400',
              danger: 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400',
              neutral: 'bg-ink-100 text-ink-500 dark:bg-ink-800',
            }[preset.tone]
          }`}
        >
          <preset.icon className="size-6" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">{preset.title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
            {preset.body}
          </p>

          {subscription?.status === 'active' && (
            <p className="mt-3 flex items-center gap-2 text-sm">
              <CreditCard className="size-4 text-ink-400" aria-hidden="true" />
              <span className="font-semibold">
                {formatMoney(subscription.price_paise)}
              </span>
              <span className="text-ink-500">
                per {subscription.billing_period === 'yearly' ? 'year' : 'month'} + {platform.gstPercent}% GST
              </span>
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}

function Th({ children, className = '' }) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-xs font-bold uppercase tracking-wider text-ink-500 ${className}`}
    >
      {children}
    </th>
  )
}
