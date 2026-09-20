import Link from 'next/link'
import {
  ArrowRight, Check, Video, IndianRupee, Search, ClipboardList, ChevronDown, ShieldCheck,
} from 'lucide-react'
import { platform } from '@/config/platform'
import { getPublicPlans } from '@/lib/queries'
import { buildMetadata } from '@/lib/seo'
import { formatMoney } from '@/lib/utils'
import Button from '@/components/ui/Button'
import { SectionHeading } from '@/components/ui/Card'
import Reveal from '@/components/ui/Reveal'

/**
 * ============================================================================
 *  THE PLATFORM'S HOMEPAGE  →  kokli.local/
 * ============================================================================
 *  Sells the product to physiotherapists. Reached by a REWRITE from `/` in
 *  proxy.js, so the address bar shows the root domain rather than /home.
 *
 *  Every claim here is deliberately one the product can actually keep — the
 *  audience is clinicians, and a physiotherapist who signs up expecting
 *  something that does not exist churns in a week and tells their colleagues.
 * ============================================================================
 */

export const metadata = buildMetadata({
  title: `${platform.name} — ${platform.tagline}`,
  description: platform.description,
  path: '/',
})

// Plans come from the database, so a price change in the platform admin shows
// here immediately.
export const dynamic = 'force-dynamic'

const ICONS = { Search, IndianRupee, Video, ClipboardList }

export default async function PlatformHome() {
  const plans = await getPublicPlans()
  const cheapest = plans.length ? Math.min(...plans.map((p) => p.price_paise)) : null
  const trialDays = plans[0]?.trial_days ?? 30

  return (
    <>
      {/* ==================================================== hero */}
      <section className="mesh-bg relative overflow-hidden py-20 lg:py-28">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-24 size-[30rem] rounded-full bg-brand-300/20 blur-3xl animate-float dark:bg-brand-700/20"
        />
        <div className="container-page relative">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/70 px-4 py-1.5 text-sm font-medium shadow-soft backdrop-blur dark:border-brand-800 dark:bg-ink-900/70">
              <ShieldCheck className="size-4 text-brand-600" aria-hidden="true" />
              Free for {trialDays} days · no card needed
            </span>

            <h1 className="mt-6 text-4xl font-bold leading-[1.08] tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Clinic software that{' '}
              <span className="text-gradient">fills your diary</span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-ink-600 text-pretty dark:text-ink-300">
              A booking website that ranks on Google, online payments straight into your own
              account, and video consultations built in. Set up in an afternoon.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button href="/signup" size="lg">
                Start your free trial
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
              <Button href="/pricing" variant="secondary" size="lg">
                See pricing
              </Button>
            </div>

            {cheapest !== null && (
              <p className="mt-5 text-sm text-ink-500 dark:text-ink-400">
                From {formatMoney(cheapest)}/month afterwards. Cancel any time.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ================================================ value props */}
      <section id="features" className="bg-white py-20 lg:py-28 dark:bg-ink-900">
        <div className="container-page">
          <SectionHeading
            eyebrow="What you get"
            title="Everything a physiotherapy clinic actually needs"
            description="Not a generic appointment tool with a physiotherapy label on it."
          />

          <div className="mt-14 grid gap-6 md:grid-cols-2">
            {platform.valueProps.map((prop, index) => {
              const Icon = Object.values(ICONS)[index] || Search
              return (
                <Reveal key={prop.title} delay={index * 80}>
                  <div className="card h-full p-7">
                    <span className="grid size-11 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <h3 className="mt-5 text-lg font-bold">{prop.title}</h3>
                    <p className="mt-2.5 text-[15px] leading-relaxed text-ink-600 dark:text-ink-400">
                      {prop.body}
                    </p>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* ============================================ the money promise */}
      <section className="py-20 lg:py-24">
        <div className="container-page">
          <div className="mx-auto max-w-[76rem] overflow-hidden rounded-4xl bg-linear-to-br from-brand-700 via-brand-600 to-brand-800 px-6 py-14 text-center sm:px-14">
            <div className="mx-auto max-w-2xl">
              <h2 className="text-3xl font-bold text-balance text-white sm:text-4xl">
                Your patients&rsquo; money goes to you. Never to us.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-brand-50 text-pretty">
                You connect your own Razorpay account during setup. Appointment fees settle into
                your bank exactly as they would if you had built the site yourself. We take no
                commission on a single booking — the subscription is all you pay.
              </p>
              <div className="mt-8">
                <Button href="/signup" variant="accent" size="lg">
                  Start free for {trialDays} days
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================== plans */}
      <section className="py-8 lg:py-12">
        <div className="container-page">
          <SectionHeading
            eyebrow="Pricing"
            title="Priced for a working clinic"
            description="Month to month. No contract, no setup fee, no commission on your bookings."
          />

          <div className="mx-auto mt-14 grid max-w-5xl gap-6 lg:grid-cols-3">
            {plans.map((plan, index) => (
              <PlanCard key={plan.id} plan={plan} featured={index === 1} />
            ))}
          </div>
        </div>
      </section>

      {/* ====================================================== FAQ */}
      <section id="faq" className="bg-white py-20 lg:py-28 dark:bg-ink-900">
        <div className="container-page">
          <SectionHeading eyebrow="Questions" title="What clinics ask before signing up" />
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
            <Button href="/signup" size="lg">
              Start your free trial
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}

/**
 * One pricing card.
 *
 * `highlights` is presentation only — what a clinic may actually DO is decided
 * by the limit columns on the plan row, read by lib/tenant.js. Never gate a
 * feature on marketing copy.
 */
export function PlanCard({ plan, featured = false }) {
  const highlights = Array.isArray(plan.highlights) ? plan.highlights : []

  return (
    <div
      className={`card relative flex flex-col p-7 ${
        featured ? 'border-brand-400 shadow-lift lg:-my-4 lg:py-11' : ''
      }`}
    >
      {featured && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
          Most popular
        </span>
      )}

      <h3 className="text-lg font-bold">{plan.name}</h3>
      <p className="mt-1 min-h-10 text-sm text-ink-500 dark:text-ink-400">{plan.tagline}</p>

      <p className="mt-5 flex items-baseline gap-1">
        <span className="font-display text-4xl font-bold">{formatMoney(plan.price_paise)}</span>
        <span className="text-sm text-ink-500">/month</span>
      </p>

      <ul className="mt-6 flex-1 space-y-2.5">
        {highlights.map((line) => (
          <li key={line} className="flex items-start gap-2.5 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
            <span className="text-ink-700 dark:text-ink-300">{line}</span>
          </li>
        ))}
      </ul>

      <Button
        href={`/signup?plan=${plan.code}`}
        variant={featured ? 'primary' : 'secondary'}
        fullWidth
        size="lg"
        className="mt-7"
      >
        Start {plan.trial_days}-day trial
      </Button>

      <p className="mt-3 text-center text-xs text-ink-400">No card needed to start</p>
    </div>
  )
}
