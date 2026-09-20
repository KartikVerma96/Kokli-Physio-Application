import Link from 'next/link'
import { platform } from '@/config/platform'
import { buildMetadata } from '@/lib/seo'
import LegalPage, { Section, List } from '@/components/legal/LegalPage'

/**
 * ============================================================================
 *  REFUNDS & CANCELLATION  →  kokli.in/legal/refunds
 * ============================================================================
 *  Razorpay will not activate a live account without this page. That is the
 *  immediate reason it exists — but it is also the page a clinic reads hardest
 *  before typing a card number, so it is worth writing properly rather than
 *  filling with the usual hedging.
 *
 *  EVERY LINE MATCHES THE CODE
 *  ---------------------------
 *    "cancel yourself, from Billing"    app/admin/billing/CancelSubscription.js
 *    "runs to the end of the month"     cancelSubscription() — cancel_at_cycle_end
 *    "nothing is deleted"               canAcceptBookings() keeps read access
 *    "30 days free, no card"            plans.trial_days
 *
 *  If any of those change, this page changes with them. A refund policy that
 *  contradicts the product is the document a clinic quotes back at you during a
 *  chargeback dispute.
 * ============================================================================
 */

export const metadata = buildMetadata({
  title: 'Refunds & Cancellation',
  description: `How to cancel a ${platform.name} subscription, and when a refund applies.`,
  path: '/legal/refunds',
})

export default function RefundsPage() {
  return (
    <LegalPage
      title="Refunds & Cancellation"
      intro="Month to month, cancel yourself, nothing deleted. The detail is below."
      updated="9 August 2026"
    >
      <Section title="Cancelling">
        <p>
          Open <strong>Billing</strong> in your clinic admin and press{' '}
          <strong>Cancel subscription</strong>. It takes two clicks and works immediately — you never
          have to email us, ring anybody, or explain yourself.
        </p>
        <p>
          There is no contract period and no notice period. Every month stands alone.
        </p>
      </Section>

      <Section title="What happens when you cancel">
        <List
          items={[
            'You are not charged again. We instruct Razorpay to stop the mandate the moment you cancel.',
            'Your subscription runs to the end of the month you have already paid for, and everything works normally until that date.',
            'After that date your account becomes read-only. New online bookings pause and your website asks patients to telephone you.',
            'Nothing is deleted. Every patient, appointment, clinical note and invoice stays, and you and your team can still sign in and read all of it.',
            'You can export everything, before or after, from Settings → Your data.',
          ]}
        />
        <p>
          Cancelling during your free trial ends it immediately, and nothing was ever charged.
        </p>
      </Section>

      <Section title="Refunds">
        <p>
          Because you keep full use of the service until the end of the month you paid for,{' '}
          <strong>a cancelled month is not refunded</strong> — you have had the whole of it. This is
          why cancellation takes effect at the period end rather than on the day you press the
          button.
        </p>
        <p>We do refund in these cases:</p>
        <List
          items={[
            'You were charged after cancelling. Refunded in full, and we would like to know how it happened.',
            'A duplicate charge, or a charge caused by a fault of ours. Refunded in full.',
            'We end your account ourselves for a reason that is not your fault. Any unused period is refunded pro rata.',
            'An extended outage that made the service unusable. Tell us and we will put it right, usually with account credit or a pro-rata refund.',
          ]}
        />
        <p>
          Approved refunds are returned to the original payment method by Razorpay, normally within
          5&ndash;7 working days, though the bank can take longer.
        </p>
      </Section>

      <Section title="Try before you pay">
        <p>
          Every clinic gets <strong>30 days free</strong>, with no card required. The trial exists
          so nobody has to buy the software to find out whether it suits them — and it is the reason
          the refund policy above can be simple.
        </p>
      </Section>

      <Section title="Your patients’ payments are separate">
        <p>
          This page is about your {platform.name} subscription only.
        </p>
        <p>
          Money your patients pay you goes <strong>directly into your own Razorpay account</strong>,
          never through us. Refunding a patient is therefore something you do, from your own
          Razorpay dashboard, under your own refund policy. We can show you the record; we cannot
          move that money.
        </p>
      </Section>

      <Section title="Getting in touch">
        <p>
          Email{' '}
          <a
            href={`mailto:${platform.supportEmail}`}
            className="font-semibold text-brand-700 hover:underline dark:text-brand-400"
          >
            {platform.supportEmail}
          </a>{' '}
          with your clinic name and the invoice number. We reply to refund requests within two
          working days. Full terms are on the{' '}
          <Link href="/legal/terms" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
            Terms of Service
          </Link>{' '}
          page.
        </p>
      </Section>
    </LegalPage>
  )
}
