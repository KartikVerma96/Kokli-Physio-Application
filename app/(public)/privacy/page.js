import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView, formattedAddress } from '@/lib/clinicView'
import { buildMetadata } from '@/lib/seo'
import PageHeader from '@/components/layout/PageHeader'

/**
 * ============================================================================
 *  PRIVACY POLICY  →  /privacy
 * ============================================================================
 *  A real, specific privacy policy — not generic boilerplate.
 *
 *  This matters for three reasons: patients reading it want a straight answer,
 *  medical data carries genuine legal obligations in India under the DPDP Act 2023,
 *  and Google treats a substantive policy page as a trust signal on health sites.
 *
 *  IMPORTANT: this is written to be accurate about what THIS application actually
 *  does. Have a lawyer review it before the site goes live, and update it whenever
 *  the app starts collecting something new.
 * ============================================================================
 */

export async function generateMetadata() {
  const site = clinicView(await requireCurrentClinic())
  return buildMetadata({
    site,
    title: 'Privacy Policy',
    description: `How ${site.name} collects, stores and protects your personal and medical information.`,
    path: '/privacy',
  })
}

export default async function PrivacyPage() {
  const clinic = await requireCurrentClinic()
  const site = clinicView(clinic)

  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Privacy policy"
        description={`What we collect, why we collect it, and what we do with it. Written in plain language, because a policy nobody can read protects nobody.`}
        breadcrumb={[{ name: 'Privacy' }]}
      />

      <div className="container-page py-14">
        <div className="prose-clinic max-w-3xl">
          <p className="text-sm text-ink-400">Last updated: {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</p>

          <h2>Who we are</h2>
          <p>
            {site.legalName}, {formattedAddress(site)}. For any question about your data, or to ask us to
            correct or delete it, contact us at{' '}
            <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a> or {site.contact.phone}.
          </p>

          <h2>What we collect</h2>
          <p>
            <strong>When you create an account:</strong> your name, email address and — if you give it
            — your mobile number. If you sign in with Google, we receive your name, email address and
            profile picture from Google. We never receive your Google password.
          </p>
          <p>
            <strong>When you book:</strong> the treatment, date and time you chose, whether you want to
            be seen in the clinic or online, and anything you type in the notes field, including your
            pain score.
          </p>
          <p>
            <strong>Medical information you give us:</strong> date of birth, height, weight,
            occupation, existing conditions, past surgeries, current medication, allergies and an
            emergency contact. All of it is optional, and all of it is used to make your treatment
            safer — some conditions genuinely change what is safe to do.
          </p>
          <p>
            <strong>Clinical records we create:</strong> the notes your physiotherapist writes after
            each session, your recorded pain scores, and the exercises prescribed to you.
          </p>
          <p>
            <strong>Payments:</strong> we store the amount, the date, the payment method type and the
            transaction reference from Razorpay. We never see or store your card number, CVV, UPI PIN
            or bank credentials — those go directly to Razorpay, which is a PCI-DSS certified payment
            processor.
          </p>

          <h2>Video consultations</h2>
          <p>
            Online consultations use a direct, encrypted browser-to-browser connection (WebRTC). The
            audio and video are not routed through our servers and{' '}
            <strong>we do not record consultations</strong>. Our server only passes the small
            connection-setup messages needed for your browser and your physiotherapist’s browser to
            find each other.
          </p>
          <p>
            On some restrictive networks a direct connection is impossible and the call is relayed
            through a third-party TURN server. Even then the media stays encrypted end to end and is
            not stored.
          </p>
          <p>
            Text messages sent in the chat panel during a consultation are not saved anywhere — they
            disappear when the call ends.
          </p>

          <h2>Who can see your information</h2>
          <p>
            Your clinical records are visible to you and to the treating physiotherapist at this
            clinic. Nobody else. We do not sell your data, we do not share it with advertisers, and we
            do not use it for marketing.
          </p>
          <p>We share the minimum necessary with three service providers:</p>
          <ul>
            <li>
              <strong>Razorpay</strong> — your name, email and phone number, so they can process your
              payment and send you a receipt.
            </li>
            <li>
              <strong>Google</strong> — only if you choose to sign in with Google, and only what is
              needed to authenticate you.
            </li>
            <li>
              <strong>Our hosting provider</strong> — which stores the database on our behalf and has
              no permission to access it.
            </li>
          </ul>
          <p>
            We will disclose information if we are legally required to, or where there is a genuine
            risk of serious harm to you or someone else.
          </p>

          <h2>How long we keep it</h2>
          <p>
            Clinical records are kept for a minimum of three years after your last appointment, in
            line with professional record-keeping obligations for physiotherapists in India. Financial
            records are kept for eight years, as tax law requires. Your account details are kept until
            you ask us to delete them.
          </p>

          <h2>Your rights</h2>
          <p>You can ask us at any time to:</p>
          <ul>
            <li>give you a copy of everything we hold about you</li>
            <li>correct anything that is wrong</li>
            <li>
              delete your account and personal data — though we may have to retain clinical and
              financial records for the periods described above
            </li>
            <li>stop contacting you</li>
          </ul>
          <p>
            Email <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a> and we will respond
            within 30 days. You can also edit most of your own details directly in your dashboard.
          </p>

          <h2>How we protect it</h2>
          <ul>
            <li>Passwords are stored as bcrypt hashes. We cannot read your password, even if we wanted to.</li>
            <li>Sessions use signed, httpOnly cookies that JavaScript cannot read.</li>
            <li>All traffic is encrypted with HTTPS in production.</li>
            <li>Database access is restricted to the application, over prepared statements only.</li>
            <li>Clinical records are only ever returned for the logged-in patient they belong to.</li>
          </ul>
          <p>
            No system is perfect. If we ever discover a breach affecting your data, we will tell you
            and the relevant authority promptly.
          </p>

          <h2>Cookies</h2>
          <p>
            We use one essential cookie, which keeps you signed in. That is it — no analytics cookies,
            no advertising cookies, no third-party trackers. Fonts are served from our own domain
            rather than from Google, so browsing this site does not tell Google that you visited a
            physiotherapy clinic.
          </p>

          <h2>Children</h2>
          <p>
            Patients under 18 are welcome at the clinic, but the account must be created and managed by
            a parent or guardian, who is responsible for consenting to treatment.
          </p>

          <h2>Changes to this policy</h2>
          <p>
            If we change anything significant we will update the date at the top and, where the change
            affects how your data is used, tell you directly.
          </p>
        </div>
      </div>
    </>
  )
}
