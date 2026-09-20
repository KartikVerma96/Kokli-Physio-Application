import Link from 'next/link'
import { platform } from '@/config/platform'
import { buildMetadata } from '@/lib/seo'
import LegalPage, { Section, List } from '@/components/legal/LegalPage'

/**
 * ============================================================================
 *  PRIVACY POLICY  →  kokli.in/legal/privacy
 * ============================================================================
 *  THE DISTINCTION THIS WHOLE PAGE TURNS ON
 *  ----------------------------------------
 *  Under India's Digital Personal Data Protection Act there are two roles, and
 *  Kokli is firmly in the second one:
 *
 *    DATA FIDUCIARY — decides why and how personal data is used. That is the
 *                     CLINIC. It chose to collect the patient's history, it
 *                     decides what treatment to record, it answers to the patient.
 *
 *    DATA PROCESSOR — handles the data on the fiduciary's instructions. That is
 *                     US. We store it and show it back; we decide nothing about it.
 *
 *  Getting this backwards would be both legally wrong and commercially fatal — a
 *  clinic reading a policy that claims we own their patient records will not sign.
 *
 *  Note the platform's OWN users (a clinic owner signing up) are different: for
 *  their account data we are the fiduciary. Both cases are stated separately
 *  below, because merging them is what makes these documents unreadable.
 * ============================================================================
 */

export const metadata = buildMetadata({
  title: 'Privacy Policy',
  description: `How ${platform.legal.name} handles personal data, and why patient records belong to the clinic.`,
  path: '/legal/privacy',
})

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="What we hold, why we hold it, and what we will never do with it."
      updated="9 August 2026"
    >
      <Section title="The short version">
        <List
          items={[
            'Patient records belong to the clinic. We hold them on the clinic’s instructions and for no other purpose.',
            'We never sell data, and we never share it with other clinics.',
            'We never use patient data to advertise anything to anyone.',
            'Any clinic, and any patient, can download their own data at any time — one button, no request, no fee.',
            'Passwords and login codes are stored as one-way hashes. Nobody at Kokli can read them.',
          ]}
        />
      </Section>

      <Section title="1. Two different relationships">
        <p>
          India&apos;s Digital Personal Data Protection Act distinguishes between the party that
          decides how personal data is used and the party that merely handles it. Which one we are
          depends on whose data it is.
        </p>
        <p>
          <strong>Patient data — the clinic decides, we process.</strong> When a patient books at a
          clinic, that clinic is the data fiduciary. It decided to collect the medical history, it
          decides what to record, and it answers to the patient. We are its processor: we store the
          data, show it back, and act on the clinic&apos;s instructions. We make no decision about
          it, and we do not use it for our own purposes.
        </p>
        <p>
          <strong>Clinic account data — we decide.</strong> When a clinic owner signs up, we are the
          fiduciary for their own account details: name, email, phone, subscription and invoices.
        </p>
      </Section>

      <Section title="2. What we hold">
        <p className="font-semibold">For a clinic&apos;s patients, on the clinic&apos;s behalf:</p>
        <List
          items={[
            'Name, email, mobile number.',
            'Date of birth, gender, occupation, address — where the patient provides them.',
            'Medical history, current medications, allergies, and the emergency contact. This is health data, and it is treated as sensitive throughout.',
            'Appointments, clinical notes written by the physiotherapist, prescribed exercises, and payment records.',
            'A log of the messages sent to the patient, and whether each was delivered — but never the content of a reply.',
          ]}
        />
        <p className="font-semibold">For a clinic and its staff:</p>
        <List
          items={[
            'Name, email, mobile number, role.',
            'Subscription, invoices and payment status.',
            'Sign-in times, and failed sign-in attempts — kept briefly, to stop password guessing.',
          ]}
        />
      </Section>

      <Section title="3. What we do not hold">
        <List
          items={[
            'Card numbers. Payments go through Razorpay, which handles the card and returns only a reference to us.',
            'Readable passwords. Only a bcrypt hash, which cannot be reversed.',
            'Readable login codes. The WhatsApp code you type is compared against a hash and then destroyed.',
            'The content of WhatsApp conversations. We record that a message was sent, not what anyone replied.',
          ]}
        />
      </Section>

      <Section title="4. Why we hold it">
        <p>
          To run the service the clinic is paying for: showing the diary, taking bookings, writing
          notes, collecting payments, sending appointment reminders, and letting patients sign in.
        </p>
        <p>
          We also keep records we are legally required to keep, such as invoices for tax purposes.
        </p>
        <p>
          We do <strong>not</strong> use clinic or patient data to train models, to build a
          directory, or to market anything to patients.
        </p>
      </Section>

      <Section title="5. Who else sees it">
        <p>Only the suppliers needed to deliver the service, and only the part each one needs:</p>
        <List
          items={[
            'Razorpay — to take payments. It receives the amount and a contact detail, never medical information.',
            'Meta (WhatsApp Business Platform) — to deliver messages. It receives the phone number and the message content.',
            'Our email provider — to deliver confirmations and receipts.',
            'Our hosting provider — which stores the database on our behalf.',
          ]}
        />
        <p>
          We do not sell data to anybody, for any purpose. If we are ever compelled to disclose data
          by a lawful order, we will tell the affected clinic unless the law forbids it.
        </p>
      </Section>

      <Section title="6. Where it is stored, and for how long">
        <p>
          Data is stored on servers in India. Backups are encrypted and kept for a rolling 30 days.
        </p>
        <p>
          A clinic&apos;s data is kept for as long as the clinic has an account, and for 90 days
          after it closes — so that a clinic that leaves and changes its mind, or realises it needs
          a record, can still get it. After that it is deleted. Invoices are kept longer where tax
          law requires.
        </p>
      </Section>

      <Section title="7. Your rights">
        <p>
          <strong>If you are a patient:</strong> you can download everything the clinic holds about
          you from your dashboard, under Profile. To correct or delete something, ask the clinic —
          they are the fiduciary, and we act on their instruction.
        </p>
        <p>
          <strong>If you are a clinic:</strong> you can export everything from Settings → Your data,
          and delete your account by contacting us.
        </p>
        <p>
          You can also opt out of WhatsApp messages at any time by replying STOP, or by asking the
          clinic. Appointment reminders you asked for by booking are separate from marketing, and we
          never send the marketing kind without recorded consent.
        </p>
      </Section>

      <Section title="8. Security">
        <List
          items={[
            'Every clinic’s data is isolated at the database level, and that isolation is verified by automated tests on every change.',
            'Passwords and login codes are hashed with bcrypt and never stored in readable form.',
            'Each clinic’s payment and messaging credentials are encrypted at rest with AES-256-GCM.',
            'Sign-in attempts are rate limited to make password guessing impractical.',
            'Backups are taken daily and test-restored, because a backup nobody has restored is not a backup.',
          ]}
        />
        <p>
          No system is perfectly secure. If a breach ever affects your data, we will tell you and
          the relevant authority promptly, and we will tell you what actually happened.
        </p>
      </Section>

      <Section title="9. Children">
        <p>
          Physiotherapy is provided to children, and a parent or guardian may book on their behalf.
          Where a patient is under 18, the clinic is responsible for obtaining the guardian&apos;s
          consent, and that record is treated with the same care as any other health data.
        </p>
      </Section>

      <Section title="10. Contact">
        <p>
          Questions about this policy, or about data we hold, go to{' '}
          <a
            href={`mailto:${platform.supportEmail}`}
            className="font-semibold text-brand-700 hover:underline dark:text-brand-400"
          >
            {platform.supportEmail}
          </a>
          . If you are a patient, your clinic is usually the faster route — see our{' '}
          <Link href="/legal/contact" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
            contact page
          </Link>
          .
        </p>
      </Section>
    </LegalPage>
  )
}
