import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Clock, CalendarX2, ArrowLeft, Video } from 'lucide-react'
import { auth } from '@/lib/auth'
import { getAppointmentForUser } from '@/lib/queries'
import { createVideoToken } from '@/lib/videoToken'
import { canJoinCall, formatDateLong, formatTime, todayISO } from '@/lib/utils'
import { requireCurrentClinic, clinicHasFeature } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import Button from '@/components/ui/Button'
import VideoRoom from '@/components/video/VideoRoom'

/**
 * ============================================================================
 *  VIDEO CONSULTATION  →  /consult/[id]
 * ============================================================================
 *  The gatekeeper for the video room. Four checks happen here, on the server,
 *  before a single byte of the call interface is sent:
 *
 *    1. Is this person signed in?                        (proxy.js, then auth())
 *    2. Is this appointment theirs?                      (SQL, in the query)
 *    3. Is it an ONLINE appointment that has been paid for?
 *    4. Is it actually time for it?
 *
 *  Only then does it mint a signed token and hand it to the browser. The
 *  signalling server verifies that token and will not let a socket join a room
 *  without one — see lib/videoToken.js for why that indirection is necessary.
 *
 *  This page has no header, no footer and no navigation. A live medical
 *  consultation should own the whole screen; a "Book an appointment" banner across
 *  the top of it would be absurd.
 * ============================================================================
 */

export const dynamic = 'force-dynamic'

// The clinic's name, not ours — a patient in a video call is meeting their
// physiotherapist, and the tab title is part of that.
export async function generateMetadata() {
  const clinic = await requireCurrentClinic()

  return {
    title: { absolute: `Video consultation | ${clinic.name}` },
    // Never index, never follow, never cache. This should not exist as far as any
    // crawler is concerned.
    robots: { index: false, follow: false, nocache: true },
  }
}

export default async function ConsultPage({ params }) {
  const { id } = await params

  const clinic = await requireCurrentClinic()
  const site = clinicView(clinic)

  const session = await auth()
  if (!session?.user) redirect(`/login?next=/consult/${id}`)

  // A session from another clinic is visible here but must not open a video room.
  if (session.user.role !== 'platform' && Number(session.user.clinicId) !== Number(clinic.id)) {
    redirect(`/login?next=/consult/${id}`)
  }

  /**
   * Video is a paid feature. A clinic on Starter has the code but not the plan,
   * and the gate belongs HERE, on the server, before a room is minted — not in
   * the UI, which anyone can bypass.
   */
  if (!clinicHasFeature(clinic, 'video_enabled')) {
    return (
      <Gate
        icon={Video}
        title="Video consultations are not enabled"
        message="This clinic's plan does not include online video consultations. Please contact the clinic to arrange an in-person appointment."
        appointmentId={id}
        site={site}
      />
    )
  }

  const appointment = await getAppointmentForUser(clinic.id, id, session.user)
  if (!appointment) notFound()

  const isStaff = ['admin', 'physio'].includes(session.user.role)

  /* ------------------------------------------------- not an online appointment */
  if (appointment.mode !== 'online') {
    return (
      <Gate
        icon={CalendarX2}
        title="This is an in-clinic appointment"
        message={`Your ${appointment.service_name} appointment is booked at the clinic, not online. Please come to ${site.address.line1}, ${site.address.city} at ${formatTime(appointment.start_time)} on ${formatDateLong(appointment.appointment_date)}.`}
        appointmentId={appointment.id}
        site={site}
      />
    )
  }

  /* --------------------------------------------------------- not yet paid */
  if (appointment.status === 'pending_payment') {
    return (
      <Gate
        icon={Clock}
        title="Payment not completed"
        message="This appointment has not been paid for yet, so the video room is not open. Complete the payment and the room becomes available 10 minutes before your slot."
        appointmentId={appointment.id}
        site={site}
      />
    )
  }

  if (['cancelled', 'no_show'].includes(appointment.status)) {
    return (
      <Gate
        icon={CalendarX2}
        title="This appointment was cancelled"
        message="The video room for a cancelled appointment is closed. You are welcome to book another slot whenever suits you."
        appointmentId={appointment.id}
        site={site}
      />
    )
  }

  /* -------------------------------------------------------- not time yet */
  /**
   * Staff get a wider window than patients.
   *
   * A physiotherapist genuinely needs to open a room early to test her camera
   * before a clinic day, or to rejoin after a dropped connection once the slot has
   * technically ended. A patient does not, and a room that opens hours early is a
   * room somebody sits in by mistake.
   */
  const patientCanJoin = canJoinCall(appointment)
  const staffCanJoin =
    isStaff &&
    ['confirmed', 'in_progress', 'completed'].includes(appointment.status) &&
    String(appointment.appointment_date).slice(0, 10) === todayISO()

  if (!patientCanJoin && !staffCanJoin) {
    const isPast = String(appointment.appointment_date).slice(0, 10) < todayISO()

    return (
      <Gate
        icon={Clock}
        title={isPast ? 'This consultation has finished' : 'The room is not open yet'}
        message={
          isPast
            ? 'The video room closes after the appointment ends. Your physiotherapist’s notes and exercises appear on the appointment page once written up.'
            : `Your consultation is at ${formatTime(appointment.start_time)} on ${formatDateLong(appointment.appointment_date)}. The room opens 10 minutes before, which gives you time to check your camera and microphone without eating into the session.`
        }
        appointmentId={appointment.id}
        site={site}
      />
    )
  }

  /* ----------------------------------------------------------- let them in */

  // Signed on the server, after every check above has passed. The browser cannot
  // forge one of these, and it expires in two hours.
  const token = createVideoToken({
    roomId: appointment.room_id,
    userId: session.user.id,
    name: session.user.name,
    role: isStaff ? 'physio' : 'patient',
    appointmentId: appointment.id,
  })

  /**
   * ICE SERVERS — how the two browsers find each other
   *
   * STUN: each browser asks a STUN server "what does my public address look like
   * from outside?". Cheap, stateless, and Google's are free. This is enough for
   * roughly 85–90% of connections.
   *
   * TURN: for the rest — symmetric NAT, strict corporate firewalls, some mobile
   * carriers — no direct path exists at all. TURN relays the media through a
   * server instead. It genuinely costs bandwidth, which is why it is not free, and
   * why it is optional here.
   *
   * WITHOUT TURN, ABOUT ONE PATIENT IN TEN CANNOT CONNECT. For a clinic taking
   * money for online consultations that is not acceptable, so set TURN_URL in
   * production. metered.ca has a free 50GB/month tier that is ample for a
   * single-therapist clinic. See .env.example.
   *
   * These are assembled on the server so the TURN credentials are not sitting in
   * the client bundle for anyone to lift and use.
   */
  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ]

  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    })
  }

  return (
    <VideoRoom
      site={site}
      token={token}
      iceServers={iceServers}
      hasTurn={Boolean(process.env.TURN_URL)}
      self={{
        name: session.user.name,
        role: isStaff ? 'physio' : 'patient',
      }}
      appointment={{
        id: appointment.id,
        code: appointment.code,
        serviceName: appointment.service_name,
        date: appointment.appointment_date,
        startTime: appointment.start_time,
        endTime: appointment.end_time,
        durationMinutes: appointment.duration_minutes,
        patientName: appointment.patient_name,
        physioName: appointment.physio_name,
        patientNotes: appointment.patient_notes,
        painLevel: appointment.pain_level,
        status: appointment.status,
      }}
    />
  )
}

/* -------------------------------------------------------------------------- */
/*  THE "YOU CANNOT COME IN YET" SCREEN                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every rejection path renders this rather than a bare 403.
 *
 * A patient who clicks a link expecting a doctor and gets "Forbidden" assumes the
 * site is broken and phones the clinic. Explaining WHY, and offering the way
 * forward, prevents that call.
 */
function Gate({ icon: GateIcon, title, message, appointmentId, site }) {
  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center p-5">
      <div className="card w-full max-w-lg p-8 text-center shadow-float">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
          <GateIcon className="size-7" aria-hidden="true" />
        </span>

        <h1 className="mt-5 text-xl font-bold">{title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-600 dark:text-ink-400">{message}</p>

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button href={`/dashboard/appointments/${appointmentId}`}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Appointment details
          </Button>
          <Button href="/book" variant="secondary">
            <Video className="size-4" aria-hidden="true" />
            Book another slot
          </Button>
        </div>

        <p className="mt-6 text-xs text-ink-400">
          Need help?{' '}
          <Link href="/contact" className="underline">
            Contact the clinic
          </Link>{' '}
          on {site.contact.phone}
        </p>
      </div>
    </div>
  )
}
