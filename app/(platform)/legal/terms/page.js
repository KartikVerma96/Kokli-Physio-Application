import Link from 'next/link'
import { platform } from '@/config/platform'
import { buildMetadata } from '@/lib/seo'
import LegalPage, { Section, List } from '@/components/legal/LegalPage'

/**
 * ============================================================================
 *  TERMS OF SERVICE  →  kokli.in/legal/terms
 * ============================================================================
 *  The contract between Kokli and a CLINIC. Not between a clinic and its
 *  patients — that is a separate document living at
 *  {clinic}.kokli.in/legal/terms, written from the clinic's side.
 *
 *  Confusing the two is the commonest mistake a healthcare platform makes, and
 *  it matters: it decides who is responsible when treatment goes wrong. Kokli
 *  sells software. It does not treat anybody.
 *
 *  WRITTEN TO MATCH WHAT THE CODE ACTUALLY DOES
 *  --------------------------------------------
 *  Every clause below describes real behaviour that can be pointed at:
 *
 *    the 30-day trial          plans.trial_days
 *    cancel at period end      app/admin/billing/actions.js
 *    read-only, never deleted  canAcceptBookings() in lib/subscriptionLifecycle.js
 *    export your data          /api/export/clinic
 *
 *  A policy that contradicts the product is worse than no policy: it is the
 *  document a clinic will quote back at you when it does not behave that way.
 * ============================================================================
 */

export const metadata = buildMetadata({
  title: 'Terms of Service',
  description: `The agreement between ${platform.legal.name} and the clinics using ${platform.name}.`,
  path: '/legal/terms',
})

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={`The agreement between ${platform.legal.name} and the clinics that use ${platform.name}.`}
      updated="9 August 2026"
    >
      <Section title="1. Who this agreement is with">
        <p>
          {platform.name} is operated by {platform.legal.name}, a business registered in India. These
          terms apply to the clinic, practice or practitioner who subscribes to {platform.name} (
          &ldquo;you&rdquo;).
        </p>
        <p>
          If you are a <strong>patient</strong> booking an appointment, these are not your terms.
          Your agreement is with the clinic you booked at, and its terms are on its own website.
        </p>
      </Section>

      <Section title="2. What we provide, and what we do not">
        <p>
          We provide software: a booking website, a diary, patient records, clinical notes, payment
          collection, messaging and video consultations.
        </p>
        <p>
          <strong>We do not provide healthcare.</strong> We are not a clinic, we employ no
          physiotherapists, and we take no part in any clinical decision. Diagnosis, treatment,
          record accuracy and professional conduct are entirely yours, along with the registrations
          and insurance your profession requires.
        </p>
      </Section>

      <Section title="3. Your free trial">
        <p>
          Every new clinic gets 30 days free. No card is required to start, nothing is charged
          during the trial, and you can stop at any point without owing anything. At the end of the
          trial your account continues in read-only mode until you choose a plan.
        </p>
      </Section>

      <Section title="4. Payment">
        <List
          items={[
            'Subscriptions are monthly, in advance, at the price shown on the pricing page plus GST at the prevailing rate.',
            'Payment is collected by mandate through Razorpay. We never see or store your card details.',
            'There is no contract period and no notice period. Every month stands alone.',
            'We may change prices with at least 30 days’ notice. An existing mandate is fixed at the amount you authorised, so a new price only applies once you authorise it.',
          ]}
        />
        <p>
          Your patients&apos; payments are a separate matter entirely — see section 6.
        </p>
      </Section>

      <Section title="5. If a payment fails, or you stop paying">
        <p>
          We will never delete your records over a billing problem. What happens instead:
        </p>
        <List
          items={[
            `A failed payment gives you ${platform.graceDays} days’ grace during which nothing changes.`,
            'After that, the account becomes read-only: you and your team can still open every patient, appointment, note and invoice, and export all of it. New online bookings pause, and your website asks patients to telephone you instead.',
            'Paying resumes everything immediately, exactly as it was.',
          ]}
        />
      </Section>

      <Section title="6. Your patients’ money is never ours">
        <p>
          Payments your patients make go directly into <strong>your</strong> Razorpay account, using
          keys you enter yourself. That money never passes through us, and we take no commission or
          fee on it.
        </p>
        <p>
          It also means refunds, chargebacks, receipts and any dispute with a patient about a
          payment are between you and that patient. We can show you the record; we cannot move the
          money.
        </p>
      </Section>

      <Section title="7. Your data belongs to you">
        <p>
          Your patients, appointments, notes and payment history are yours. We hold them to run the
          service for you and for no other purpose.
        </p>
        <List
          items={[
            'You can export everything, at any time, from Settings → Your data. No request, no waiting, no fee.',
            'We never sell your data, share it with other clinics, or use it to advertise to your patients.',
            'We may use anonymous, aggregated statistics — for example the average no-show rate across all clinics — provided no clinic or patient can be identified.',
          ]}
        />
        <p>
          How we handle personal data is set out in our{' '}
          <Link href="/legal/privacy" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
            Privacy Policy
          </Link>
          .
        </p>
      </Section>

      <Section title="8. Cancelling">
        <p>
          You can cancel yourself, from Billing, at any time. Your subscription runs to the end of
          the month you have already paid for, and is not renewed. The full policy is on the{' '}
          <Link href="/legal/refunds" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
            Refunds &amp; Cancellation
          </Link>{' '}
          page.
        </p>
      </Section>

      <Section title="9. What we expect from you">
        <List
          items={[
            'Use the service lawfully, and only for your own clinic.',
            'Keep your sign-in credentials to yourself, and give each member of staff their own account.',
            'Have a lawful basis for the patient data you put in, and for the messages you ask us to send on your behalf.',
            'Do not attempt to reach another clinic’s data, probe the service for weaknesses without telling us, or resell the service as your own.',
          ]}
        />
      </Section>

      <Section title="10. Availability">
        <p>
          We work to keep {platform.name} available at all times, but we do not promise uninterrupted
          service. Maintenance, a failure at a supplier, or an internet problem can all cause an
          outage. We keep daily backups and we will always tell you honestly what happened.
        </p>
      </Section>

      <Section title="11. Liability">
        <p>
          Our total liability to you in any twelve-month period is limited to the amount you paid us
          in that period. We are not liable for lost profits, lost bookings or indirect losses.
        </p>
        <p>
          Nothing here limits liability that cannot lawfully be limited — including for death or
          personal injury caused by negligence, or for fraud.
        </p>
      </Section>

      <Section title="12. Ending the agreement">
        <p>
          You may leave whenever you wish. We may end the agreement with 30 days&apos; notice, or
          immediately if the service is used unlawfully or in a way that endangers other clinics.
        </p>
        <p>
          If we end it, we will give you at least 30 days to export your data first, and we will
          refund any period you have paid for and not used.
        </p>
      </Section>

      <Section title="13. Governing law">
        <p>
          These terms are governed by the laws of India. The courts of{' '}
          {platform.legal.address.city} have jurisdiction.
        </p>
      </Section>

      <Section title="14. Changes">
        <p>
          We may update these terms. If a change materially affects you, we will email the address
          on your account at least 30 days before it takes effect, so you can decide whether to
          carry on.
        </p>
      </Section>
    </LegalPage>
  )
}
