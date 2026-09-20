import { CalendarDays, CreditCard, Stethoscope, TrendingUp } from 'lucide-react'
import Reveal from '@/components/ui/Reveal'
import { SectionHeading } from '@/components/ui/Card'

/**
 * ============================================================================
 *  HOW IT WORKS
 * ============================================================================
 *  Four steps from "my back hurts" to "I am better".
 *
 *  This section exists to remove uncertainty. Someone in pain who has never
 *  seen a physiotherapist does not know whether they need a referral, what a
 *  session involves, or whether one visit will be enough. Every unanswered
 *  question is a reason to close the tab, so we answer them before they are
 *  asked.
 *
 *  Steps 3 and 4 describe how a physiotherapy course of treatment genuinely
 *  works — assessment, then a home programme, then reassessment. This is not
 *  marketing copy; setting that expectation up front is what stops a patient
 *  giving up after two sessions because they expected an instant cure.
 * ============================================================================
 */

function buildSteps(site) {
  return [
  {
    icon: CalendarDays,
    title: 'Pick a time that suits you',
    description:
      'Choose your treatment, then in-clinic or online video, then any free slot in the next month. No phone calls, no waiting for someone to call back.',
    detail: 'Takes about a minute',
  },
  {
    icon: CreditCard,
    title: 'Pay securely online',
    description:
      'UPI, card or netbanking. Your slot is held while you pay and confirmed the moment it goes through. A GST invoice lands in your dashboard straight away.',
    detail: `Free cancellation up to ${site.booking.freeCancellationHours}h before`,
  },
  {
    icon: Stethoscope,
    title: 'Get properly assessed',
    description:
      'Your first session is a real examination, not a quick massage. We work out what is causing the pain, explain it in plain language, and start treatment the same session.',
    detail: '45–60 minutes, one-to-one',
  },
  {
    icon: TrendingUp,
    title: 'Follow a plan that works',
    description:
      'You leave with exercises in your dashboard and a clear idea of how many sessions you need. We recheck your progress every fourth visit, so you are never coming indefinitely.',
    detail: 'Most people need 4–6 sessions',
    },
  ]
}

export default function HowItWorks({ site }) {
  // Built per render rather than as a module constant, because one of the steps
  // quotes the clinic's own cancellation window — which differs per tenant.
  const steps = buildSteps(site)

  return (
    <section className="relative overflow-hidden bg-white py-20 lg:py-28 dark:bg-ink-900">
      {/* A faint dot grid for texture, fading out towards the bottom. */}
      <div
        aria-hidden="true"
        className="dot-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />

      <div className="container-page relative">
        <SectionHeading
          eyebrow="How it works"
          title="From booking to feeling better"
          description="No referral needed, no queue, and no mystery about what happens next."
        />

        <ol className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <Reveal key={step.title} delay={index * 90}>
              {/* h-full so all four cards match height regardless of copy. */}
              <li className="card relative h-full p-6">
                {/* The step number, sitting half-outside the card corner. */}
                <span
                  className="absolute -top-3.5 left-6 grid size-7 place-items-center rounded-lg bg-brand-600 text-xs font-bold text-white shadow-brand"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>

                <step.icon className="mt-2 size-7 text-brand-600 dark:text-brand-400" aria-hidden="true" />

                <h3 className="mt-4 text-base font-bold leading-snug">{step.title}</h3>

                <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
                  {step.description}
                </p>

                <p className="mt-4 border-t border-ink-100 pt-3 text-xs font-semibold text-brand-700 dark:border-ink-800 dark:text-brand-400">
                  {step.detail}
                </p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}
