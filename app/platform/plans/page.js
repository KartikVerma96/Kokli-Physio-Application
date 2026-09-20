import { Info } from 'lucide-react'
import { getAllPlans } from '@/lib/queries'
import { query } from '@/lib/db'
import { isBillingDemoMode } from '@/lib/platformBilling'
import PlanEditor from './PlanEditor'

/**
 * ============================================================================
 *  PLANS  →  kokli.local/platform/plans
 * ============================================================================
 *  Your price list, editable.
 *
 *  Everything on this page is read by real code somewhere:
 *
 *    price_paise         → what Razorpay charges, and the pricing page
 *    max_physios         → enforced in /admin/settings/team
 *    video_enabled       → gates the consultation room
 *    soap_notes_enabled  → gates clinical notes
 *    trial_days          → how long a new clinic gets before it must pay
 *    highlights          → the bullet points on the pricing cards
 *
 *  ONE column — analytics_enabled — is not read by anything yet, and the editor
 *  says so on the switch itself. A toggle that looks like it does something and
 *  does not is how a clinic ends up paying for a feature that was never built.
 *
 *  whatsapp_enabled was in that list and no longer is: it is now the first gate in
 *  whatsappAllowance(). The label saying otherwise outlived the feature by a
 *  while, which is its own small trap — a switch you believe is inert is a switch
 *  you flip carelessly.
 * ============================================================================
 */

export const metadata = { title: 'Plans', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function PlansPage() {
  const plans = await getAllPlans()

  // How many clinics are live on each plan. Shown next to the price, because
  // "raise this by ₹200" is a different decision at 2 customers than at 200.
  const counts = await query(
    `SELECT plan_id, COUNT(*) AS n
       FROM subscriptions
      WHERE status IN ('trialing', 'active', 'past_due')
      GROUP BY plan_id`
  )
  const byPlan = new Map(counts.map((row) => [Number(row.plan_id), Number(row.n)]))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Plans</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          What you charge, and what each price buys.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm dark:border-sky-800 dark:bg-sky-950/30">
        <Info className="mt-0.5 size-4 shrink-0 text-sky-600" aria-hidden="true" />
        <div className="text-sky-900 dark:text-sky-100">
          <p className="font-bold">Changing a price never changes an existing bill.</p>
          <p className="mt-0.5 text-sky-800 dark:text-sky-200">
            Razorpay mandates are fixed at the amount the clinic authorised, so a new price applies
            only to clinics who subscribe after you save. To move existing customers you have to ask
            them to authorise the new amount — which is exactly as it should be.
            {isBillingDemoMode() && ' Billing is currently in demo mode, so nothing here reaches Razorpay at all.'}
          </p>
        </div>
      </div>

      <div className="space-y-5">
        {plans.map((plan) => (
          <PlanEditor
            key={plan.id}
            plan={{
              id: plan.id,
              code: plan.code,
              name: plan.name,
              tagline: plan.tagline || '',
              priceRupees: Number(plan.price_paise) / 100,
              billingPeriod: plan.billing_period,
              trialDays: plan.trial_days,
              maxPhysios: plan.max_physios,
              maxLocations: plan.max_locations,
              videoEnabled: Boolean(plan.video_enabled),
              soapNotesEnabled: Boolean(plan.soap_notes_enabled),
              whatsappEnabled: Boolean(plan.whatsapp_enabled),
              whatsappOwnNumber: Boolean(plan.whatsapp_own_number),
              whatsappQuota: Number(plan.whatsapp_monthly_quota) || 0,
              analyticsEnabled: Boolean(plan.analytics_enabled),
              // MySQL returns a JSON column already parsed. The fallback covers a
              // row saved before the column existed.
              highlights: Array.isArray(plan.highlights) ? plan.highlights : [],
              isActive: Boolean(plan.is_active),
              sortOrder: plan.sort_order,
              razorpayPlanId: plan.razorpay_plan_id,
            }}
            liveCount={byPlan.get(Number(plan.id)) || 0}
          />
        ))}
      </div>
    </div>
  )
}
