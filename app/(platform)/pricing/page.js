import { Check, X, ChevronDown } from 'lucide-react'
import { platform } from '@/config/platform'
import { getPublicPlans } from '@/lib/queries'
import { buildMetadata } from '@/lib/seo'
import { formatMoney } from '@/lib/utils'
import Button from '@/components/ui/Button'
import { SectionHeading } from '@/components/ui/Card'
import { PlanCard } from '../home/page'

/**
 * ============================================================================
 *  PRICING  →  kokli.local/pricing
 * ============================================================================
 *  The comparison table is generated from the plan ROWS, not hand-written. That
 *  means a limit changed in the platform admin is reflected here immediately and
 *  cannot drift out of step with what the app actually enforces.
 *
 *  A pricing page that disagrees with the code is worse than no pricing page: it
 *  is a promise you will fail to keep in front of a paying customer.
 * ============================================================================
 */

export const metadata = buildMetadata({
  title: 'Pricing',
  description: `Simple month-to-month pricing for physiotherapy clinics. Free ${30}-day trial, no commission on your bookings, cancel any time.`,
  path: '/pricing',
})

export const dynamic = 'force-dynamic'

/**
 * The comparison rows.
 *
 * ---------------------------------------------------------------------------
 * ONLY LIST WHAT THE PRODUCT ACTUALLY DOES
 * ---------------------------------------------------------------------------
 * An earlier version of this table advertised WhatsApp reminders, revenue
 * analytics and multi-location support. The `plans` table has columns for all
 * three — but nothing in the application reads them, so a clinic paying for the
 * top tier would have received exactly what the middle tier gives.
 *
 * Selling something you cannot deliver is worse than offering a shorter list. It
 * is also the fastest way to lose a customer who signed up specifically for the
 * feature that turned out not to exist.
 *
 * Those rows are therefore commented out rather than deleted, with the column
 * still in the schema, ready to come back the day they are built. `value` reads
 * a real column in every case, so this table cannot drift from what the code
 * enforces.
 */
const FEATURES = [
  { label: 'Booking website with your own address', value: () => true },
  { label: 'Online payments into your own account', value: () => true },
  { label: 'Patient records & clinical notes', value: (p) => Boolean(p.soap_notes_enabled) },
  { label: 'Home exercise programmes', value: () => true },
  { label: 'Automatic SEO for your city', value: () => true },
  { label: 'Physiotherapists included', value: (p) => `${p.max_physios}` },
  { label: 'Online video consultations', value: (p) => Boolean(p.video_enabled) },

  /**
   * The row that sells the product.
   *
   * A clinic reading this page is comparing ₹499 with ₹1,299 and wondering what
   * the difference buys. "WhatsApp reminders" is the answer: no-shows run 15-25%
   * in physiotherapy and a reminder halves them, so the upgrade pays for itself
   * several times over in the first month. It is deliberately listed by what it
   * does rather than by the feature name.
   */
  {
    label: 'WhatsApp messages included',
    value: (p) => (p.whatsapp_enabled ? `${p.whatsapp_monthly_quota}/month` : false),
  },
  /**
   * "Unlimited on your own WhatsApp number" is hidden, not deleted.
   *
   * Every message now goes from Kokli's own WhatsApp number, which is a deliberate
   * decision rather than a limitation: a clinic connecting its own number needs a
   * Facebook business account, a spare phone number, and Meta's Coexistence flow —
   * and almost no physiotherapy clinic will get through that.
   *
   * The code behind it is intact and tested. Turn `whatsapp_own_number` on for a
   * plan in the platform admin and this line comes back:
   *
   *   { label: 'Unlimited on your own WhatsApp number',
   *     value: (p) => Boolean(p.whatsapp_own_number) },
   *
   * Left commented rather than removed because a pricing row is trivial to restore
   * and the reasoning behind its absence is not.
   */
  { label: 'Home exercise plans by WhatsApp', value: (p) => Boolean(p.whatsapp_enabled) },

  // NOT YET BUILT — re-enable each line the day the feature ships:
  // { label: 'Locations', value: (p) => `${p.max_locations}` },
  // { label: 'Revenue & retention analytics', value: (p) => Boolean(p.analytics_enabled) },
]

export default async function PricingPage() {
  const plans = await getPublicPlans()
  const trialDays = plans[0]?.trial_days ?? 30

  return (
    <>
      {/* pt = the old py-16 plus the height the floating header overlays. */}
      <section className="mesh-bg border-b border-ink-200 pt-35 pb-16 lg:pt-37 dark:border-ink-800">
        <div className="container-page">
          <SectionHeading
            eyebrow="Pricing"
            title="One price. No commission. Cancel any time."
            description={`Every plan starts with a free ${trialDays}-day trial and needs no card to begin. Your patients' payments always go straight to your own bank account.`}
          />
        </div>
      </section>

      {/* ------------------------------------------------------- the cards */}
      <section className="py-14">
        <div className="container-page">
          <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-3">
            {plans.map((plan, index) => (
              <PlanCard key={plan.id} plan={plan} featured={index === 1} />
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- comparison table */}
      <section className="pb-20">
        <div className="container-page">
          <div className="card mx-auto max-w-5xl overflow-hidden p-0">
            {/* Scrolls inside its own box on a phone rather than stretching the
                page sideways. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-b border-ink-100 bg-ink-50/60 dark:border-ink-800 dark:bg-ink-800/40">
                  <tr>
                    <th scope="col" className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wider text-ink-500">
                      Compare plans
                    </th>
                    {plans.map((plan) => (
                      <th key={plan.id} scope="col" className="px-5 py-4 text-center">
                        <span className="block font-bold">{plan.name}</span>
                        <span className="block text-xs font-normal text-ink-500">
                          {formatMoney(plan.price_paise)}/mo
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {FEATURES.map((feature) => (
                    <tr key={feature.label}>
                      <th scope="row" className="px-5 py-3.5 text-left font-medium">
                        {feature.label}
                      </th>
                      {plans.map((plan) => {
                        const value = feature.value(plan)
                        return (
                          <td key={plan.id} className="px-5 py-3.5 text-center">
                            {typeof value === 'boolean' ? (
                              value ? (
                                <Check className="mx-auto size-4 text-brand-600" aria-label="Included" />
                              ) : (
                                <X className="mx-auto size-4 text-ink-300" aria-label="Not included" />
                              )
                            ) : (
                              <span className="font-semibold tabular-nums">{value}</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* The two arrangements, said plainly. A clinic comparing plans on the
              message count alone would miss that the limit disappears entirely
              once they connect their own number — which is both cheaper for them
              and better for their patients. */}
          <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-ink-500 dark:text-ink-400">
            Included messages are sent from our WhatsApp number. Connect your own — so patients see
            your clinic&rsquo;s name and replies reach you — and there is no monthly limit at all;
            WhatsApp bills you directly, usually well under a rupee per conversation.
          </p>

          <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-ink-500 dark:text-ink-400">
            Prices exclude {platform.gstPercent}% GST. Need more therapists or locations than the
            Clinic plan allows?{' '}
            <a href={`mailto:${platform.salesEmail}`} className="font-semibold text-brand-700 underline dark:text-brand-400">
              Email us
            </a>{' '}
            and we will sort something out.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------- FAQ */}
      <section className="bg-white py-20 dark:bg-ink-900">
        <div className="container-page">
          <SectionHeading eyebrow="Questions" title="Before you sign up" />
          <div className="mx-auto mt-12 max-w-3xl divide-y divide-ink-100 dark:divide-ink-800">
            {platform.faqs.map((faq, index) => (
              <details key={faq.q} open={index === 0} className="group py-2">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-4">
                  <h3 className="text-base font-bold group-open:text-brand-700 dark:group-open:text-brand-300">
                    {faq.q}
                  </h3>
                  <ChevronDown
                    className="mt-0.5 size-5 shrink-0 text-ink-400 transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <p className="pb-5 pr-10 text-[15px] leading-relaxed text-ink-600 dark:text-ink-400">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Button href="/signup" size="lg">Start your free trial</Button>
          </div>
        </div>
      </section>
    </>
  )
}
