import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView, formattedAddress, doctorLine } from '@/lib/clinicView'
import { buildMetadata } from '@/lib/seo'
import PageHeader from '@/components/layout/PageHeader'

/**
 * ============================================================================
 *  TERMS OF SERVICE  →  /terms
 * ============================================================================
 *  The rules of the relationship — booking, payment, cancellation, and the honest
 *  limits of what online physiotherapy can do.
 *
 *  The cancellation figures are read from config/site.js rather than typed here, so
 *  the policy can never drift out of step with what the application actually
 *  enforces in code. A stated policy that contradicts the software is worse than no
 *  policy at all.
 *
 *  Have a lawyer review this before going live.
 * ============================================================================
 */

export async function generateMetadata() {
  const site = clinicView(await requireCurrentClinic())
  return buildMetadata({
    site,
    title: 'Terms of Service',
    description: `Booking, payment and cancellation terms for physiotherapy appointments at ${site.name}.`,
    path: '/terms',
  })
}

export default async function TermsPage() {
  const clinic = await requireCurrentClinic()
  const site = clinicView(clinic)

  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Terms of service"
        description="How booking, payment and cancellation work, and what physiotherapy here can and cannot do for you."
        breadcrumb={[{ name: 'Terms' }]}
      />

      <div className="container-page py-14">
        <div className="prose-clinic max-w-3xl">
          <p className="text-sm text-ink-400">
            Last updated: {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </p>

          <p>
            These terms apply when you book an appointment with {site.legalName},{' '}
            {formattedAddress(site)}. By booking, you agree to them.
          </p>

          <h2>Who treats you</h2>
          <p>
            Treatment is provided by {doctorLine(site)}
            {site.doctor.registration
              ? `, registered with the state physiotherapy council under number ${site.doctor.registration}. If you would like to verify that registration, we will happily give you the details to do so.`
              : '.'}
          </p>

          <h2>Booking and payment</h2>
          <ul>
            <li>Appointments are paid for online at the time of booking. That is what confirms the slot.</li>
            <li>
              While you are on the payment page your slot is held for{' '}
              {site.booking.paymentHoldMinutes} minutes. If payment is not completed in that time, the
              slot is released back to other patients.
            </li>
            <li>
              The price you pay is the price shown at the moment of booking. Later price changes never
              affect an appointment already paid for.
            </li>
            <li>Payments are processed by Razorpay. We never see your card or UPI credentials.</li>
            <li>A receipt is available in your dashboard immediately. A GST invoice is available on request.</li>
          </ul>

          <h2>Cancellation and refunds</h2>
          <ul>
            <li>
              <strong>
                Cancel more than {site.booking.freeCancellationHours} hours before your appointment:
              </strong>{' '}
              full refund, automatically, no questions asked. It usually reaches your account in 5–7
              working days.
            </li>
            <li>
              <strong>Cancel within {site.booking.freeCancellationHours} hours:</strong> no refund. That
              time can no longer be offered to another patient who is in pain, and the clinic cannot
              absorb that indefinitely.
            </li>
            <li>
              <strong>If you do not turn up:</strong> the session is charged in full.
            </li>
            <li>
              <strong>If the clinic cancels</strong> — illness, an emergency, anything on our side — you
              get a full refund automatically, whatever the notice. That is only fair; you did nothing
              wrong.
            </li>
          </ul>
          <p>
            If something genuinely urgent comes up inside the cancellation window, ring us rather than
            cancelling online. We will usually try to move your appointment instead, and we would
            rather do that than take money for a session you could not attend.
          </p>

          <h2>Online video consultations</h2>
          <p>Online consultations are real physiotherapy, and they have real limits. Both are worth being clear about.</p>
          <p>
            <strong>They work well for:</strong> assessment and diagnosis, watching how you move,
            teaching and correcting exercises, posture and ergonomic advice, and follow-ups between
            clinic visits.
          </p>
          <p>
            <strong>They cannot provide:</strong> manual therapy, joint mobilisation, dry needling,
            ultrasound, taping, or any other hands-on treatment. Services that require those are marked
            as clinic-only and cannot be booked online.
          </p>
          <p>You are responsible for:</p>
          <ul>
            <li>a device with a working camera and microphone, and a reasonable internet connection</li>
            <li>a private space where you are comfortable being seen moving</li>
            <li>clear floor space around you, so you can exercise without hurting yourself</li>
          </ul>
          <p>
            If a technical problem on our side means the consultation cannot go ahead, we will
            reschedule it or refund you in full. If your own connection fails and we cannot complete
            the session, we will do our best to reschedule as a goodwill gesture.
          </p>

          <h2>What we expect from you</h2>
          <ul>
            <li>
              Tell us about your medical conditions and medication honestly. Some conditions genuinely
              change what is safe — osteoporosis rules out spinal manipulation, blood thinners rule out
              dry needling, and a pacemaker rules out some electrotherapy. Leaving those out does not
              protect you.
            </li>
            <li>Tell us immediately if any treatment or exercise causes sharp or increasing pain.</li>
            <li>Arrive on time. A late start means a shorter session, not a longer appointment.</li>
            <li>Do the home exercises. It is the single biggest factor in whether treatment works.</li>
          </ul>

          <h2>What physiotherapy can and cannot promise</h2>
          <p>
            We will give you an honest assessment, a treatment plan based on current evidence, and a
            realistic estimate of how many sessions you are likely to need.
          </p>
          <p>
            What nobody can promise is a specific outcome. Bodies heal at different rates, and the same
            diagnosis behaves differently in different people. If we do not think physiotherapy is the
            right answer for your problem, we will tell you at the first appointment and help you get
            to the right person — a doctor, a surgeon, or for imaging.
          </p>

          <h2>This is not an emergency service</h2>
          <p>
            Go to a hospital emergency department immediately, rather than booking here, if you have:
            sudden severe pain following an accident; numbness around the groin or genitals; loss of
            bladder or bowel control; weakness in both legs; sudden severe headache with neck
            stiffness; or chest pain. These need urgent medical assessment, not physiotherapy.
          </p>

          <h2>Your account</h2>
          <ul>
            <li>Keep your password to yourself. Your account holds your medical records.</li>
            <li>The information you give us must be accurate — it is used to make clinical decisions.</li>
            <li>
              We may suspend an account that is used to abuse staff, book fraudulently, or repeatedly
              fail to attend paid appointments.
            </li>
          </ul>

          <h2>Limits on our liability</h2>
          <p>
            Nothing in these terms limits our liability for professional negligence, or for anything
            that cannot lawfully be limited. Beyond that, our liability for any claim relating to an
            appointment is limited to the fee you paid for it.
          </p>

          <h2>Changes and governing law</h2>
          <p>
            We may update these terms. The version that applies to your appointment is the one
            published when you booked it. These terms are governed by the laws of India, and the courts
            of {site.address.city}, {site.address.state} have jurisdiction.
          </p>

          <h2>Questions</h2>
          <p>
            Email <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a> or call{' '}
            {site.contact.phone}. If you are unhappy with any aspect of your treatment, please tell us
            first — most things are fixable, and we would rather know.
          </p>
        </div>
      </div>
    </>
  )
}
