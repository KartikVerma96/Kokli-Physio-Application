import { Mail, MapPin, Building2, Clock, LifeBuoy } from 'lucide-react'
import { platform, legalAddress } from '@/config/platform'
import { buildMetadata } from '@/lib/seo'
import LegalPage, { Section } from '@/components/legal/LegalPage'

/**
 * ============================================================================
 *  CONTACT  →  kokli.in/legal/contact
 * ============================================================================
 *  Razorpay's KYC review requires a reachable business on the website: a legal
 *  name, a postal address and a way to contact a human. Meta's verification looks
 *  for the same. This page is the one both of them will open.
 *
 *  WHY IT ROUTES PATIENTS AWAY FIRST
 *  ---------------------------------
 *  Most people who reach this page from a Google search are PATIENTS with a
 *  question about an appointment — and we cannot help them. We do not hold their
 *  booking in any sense they would recognise, we cannot change it, and we are not
 *  their clinic. Sending them to the clinic in the first block saves them a wasted
 *  email and a day of waiting.
 * ============================================================================
 */

export const metadata = buildMetadata({
  title: 'Contact',
  description: `How to reach ${platform.legal.name} — the team behind ${platform.name}.`,
  path: '/legal/contact',
})

export default function ContactPage() {
  return (
    <LegalPage
      title="Contact us"
      intro="A small team in New Delhi. Emails reach a person, not a queue."
      updated="9 August 2026"
    >
      {/* ---------------------------------------------------- patients first */}
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm dark:border-amber-700 dark:bg-amber-950/30">
        <p className="font-bold text-amber-900 dark:text-amber-100">
          Are you a patient with a question about your appointment?
        </p>
        <p className="mt-1 text-amber-800 dark:text-amber-200">
          Please contact your clinic directly — their number is on their website and on your booking
          confirmation. {platform.name} makes the software your clinic uses; we cannot see, move or
          cancel your appointment for you.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card
          icon={<LifeBuoy className="size-5" />}
          title="Support"
          body="Something not working, or a question about your account."
          action={platform.supportEmail}
          href={`mailto:${platform.supportEmail}`}
        />
        <Card
          icon={<Mail className="size-5" />}
          title="Sales"
          body="Thinking about it, or want a walkthrough for your clinic."
          action={platform.salesEmail}
          href={`mailto:${platform.salesEmail}`}
        />
      </div>

      <Section title="How quickly we reply">
        <p className="flex items-start gap-2.5">
          <Clock className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
          <span>
            Within one working day, and usually much faster. Monday to Saturday, 9am&ndash;7pm IST.
            If something is broken and it is stopping your clinic from working, say so in the
            subject line and it goes to the front.
          </span>
        </p>
      </Section>

      <Section title="Registered office">
        <p className="flex items-start gap-2.5">
          <Building2 className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
          <span>
            <strong>{platform.legal.name}</strong>
            <br />
            Udyam registration <span className="font-mono">{platform.legal.udyam}</span>
          </span>
        </p>
        <p className="flex items-start gap-2.5">
          <MapPin className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
          <span>{legalAddress()}</span>
        </p>
        <p className="text-sm text-ink-500 dark:text-ink-400">
          This is a registered address, not a walk-in office. Please email first — we are happy to
          arrange a call.
        </p>
      </Section>

      <Section title="Reporting a security problem">
        <p>
          If you think you have found a vulnerability, email{' '}
          <a
            href={`mailto:${platform.supportEmail}`}
            className="font-semibold text-brand-700 hover:underline dark:text-brand-400"
          >
            {platform.supportEmail}
          </a>{' '}
          with &ldquo;security&rdquo; in the subject. We will acknowledge within one working day. We
          will not take legal action against anyone who reports a problem in good faith and gives us
          a reasonable chance to fix it before telling anyone else.
        </p>
      </Section>
    </LegalPage>
  )
}

function Card({ icon, title, body, action, href }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
      <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-300">
        {icon}
      </span>
      <h3 className="mt-3 font-bold">{title}</h3>
      <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{body}</p>
      <a
        href={href}
        className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline dark:text-brand-400"
      >
        {action}
      </a>
    </div>
  )
}
