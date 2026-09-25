import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft, Video, MapPin, Clock, CalendarCheck, CheckCircle2, Receipt, FileText,
  Dumbbell, TriangleAlert, Phone,
} from 'lucide-react'
import { auth } from '@/lib/auth'
import { getAppointmentForUser, getAppointmentNotes } from '@/lib/queries'
import { clinicView, whatsappLink, withCredentials, shortAddress } from '@/lib/clinicView'
import { requireCurrentClinic } from '@/lib/tenant'
import {
  formatMoney, formatDateLong, formatTime, statusMeta, canJoinCall, isRefundable,
} from '@/lib/utils'
import { Card, Badge } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { painColour } from '@/components/ui/Field'
import CancelAppointment from '@/components/dashboard/CancelAppointment'
import CopyButton from '@/components/ui/CopyButton'

/**
 * ============================================================================
 *  ONE APPOINTMENT  →  /dashboard/appointments/[id]
 * ============================================================================
 *  Everything about a single appointment: the details, the join button, the
 *  invoice, and — once the session is done — the physiotherapist's clinical notes
 *  and the exercises prescribed.
 *
 *  THE AUTHORISATION IS IN THE QUERY
 *  ---------------------------------
 *  getAppointmentForUser takes the appointment id AND the user, and the ownership
 *  check is part of its WHERE clause. So changing the number in the URL to read
 *  somebody else's medical appointment returns nothing, and this page 404s.
 *
 *  That is the important pattern. If the check were an `if` statement after the
 *  fetch, a future edit could remove it and nothing would look wrong. Putting it
 *  in the SQL means the data simply is not available to leak. See lib/queries.js.
 * ============================================================================
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }) {
  const { id } = await params
  return {
    title: `Appointment ${id}`,
    robots: { index: false, follow: false },
  }
}

export default async function AppointmentDetailPage({ params, searchParams }) {
  const { id } = await params
  const query = await searchParams

  const clinic = await requireCurrentClinic()
  const site = clinicView(clinic)
  const session = await auth()
  const appointment = await getAppointmentForUser(clinic.id, id, session.user)

  if (!appointment) notFound()

  // Notes are only fetched once the session is done — before that there are none.
  const notes =
    appointment.status === 'completed' ? await getAppointmentNotes(clinic.id, appointment.id) : null

  const meta = statusMeta(appointment.status)
  const isOnline = appointment.mode === 'online'
  const joinable = canJoinCall(appointment)
  const refundable = isRefundable(appointment, site.booking.freeCancellationHours)
  const justBooked = query?.booked === '1'

  const exercises = Array.isArray(notes?.exercises_prescribed) ? notes.exercises_prescribed : []

  return (
    <div className="space-y-6">
      {/* -------------------------------------------------------- back link */}
      <Link
        href="/dashboard/appointments"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 transition-colors hover:text-brand-700 dark:hover:text-brand-300"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All appointments
      </Link>

      {/* ------------------------------------------- just-booked confirmation */}
      {justBooked && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950/40">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden="true" />
          <div>
            <p className="font-bold text-emerald-900 dark:text-emerald-100">
              Your appointment is confirmed
            </p>
            <p className="mt-1 text-sm leading-relaxed text-emerald-800 dark:text-emerald-200">
              Reference <strong className="font-mono">{appointment.code}</strong>. A confirmation has
              been saved here, and your invoice is below.
              {isOnline
                ? ' The join button appears on this page 10 minutes before your slot.'
                : ` Please arrive five minutes early at ${site.address.line1}.`}
            </p>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- header */}
      <Card className="p-6 lg:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={meta.tone} dot>
                {meta.label}
              </Badge>
              <Badge tone="neutral">{isOnline ? 'Online video' : 'At the clinic'}</Badge>
              {/* Patients quote this code when they ring the clinic, so it is
                  copyable rather than something to squint at and retype. */}
              <span className="flex items-center gap-1">
                <span className="font-mono text-xs text-ink-400">{appointment.code}</span>
                <CopyButton value={appointment.code} label="appointment code" />
              </span>
            </div>

            <h1 className="mt-3 text-2xl font-bold">{appointment.service_name}</h1>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              With {withCredentials(appointment.physio_name, site.doctor.credentials)}
            </p>
          </div>

          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
            <Icon name={appointment.service_icon} className="size-7" />
          </span>
        </div>

        {/* ------------------------------------------------------- the facts */}
        <dl className="mt-6 grid gap-4 border-t border-ink-100 pt-6 sm:grid-cols-2 lg:grid-cols-4 dark:border-ink-800">
          <Detail icon={CalendarCheck} label="Date" value={formatDateLong(appointment.appointment_date)} />
          <Detail
            icon={Clock}
            label="Time"
            value={`${formatTime(appointment.start_time)} – ${formatTime(appointment.end_time)}`}
          />
          <Detail
            icon={isOnline ? Video : MapPin}
            label="Where"
            value={isOnline ? 'Online video call' : shortAddress(site) || 'At the clinic'}
          />
          <Detail icon={Receipt} label="Paid" value={formatMoney(appointment.amount_paise)} />
        </dl>

        {/* ---------------------------------------------------------- actions */}
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-ink-100 pt-6 dark:border-ink-800">
          {isOnline && joinable && (
            <Button href={`/consult/${appointment.id}`} size="lg" className="animate-pulse-ring">
              <Video className="size-4" aria-hidden="true" />
              Join video consultation
            </Button>
          )}

          {isOnline && !joinable && ['confirmed'].includes(appointment.status) && (
            <p className="flex items-center gap-2 rounded-xl bg-ink-100 px-4 py-2.5 text-sm text-ink-600 dark:bg-ink-800 dark:text-ink-300">
              <Clock className="size-4 shrink-0" aria-hidden="true" />
              Your video room opens 10 minutes before the appointment
            </p>
          )}

          {!isOnline && appointment.status === 'confirmed' && (
            <Button
              href={site.address.mapsUrl}
              variant="secondary"
              size="lg"
              target="_blank"
              rel="noopener noreferrer"
            >
              <MapPin className="size-4" aria-hidden="true" />
              Get directions
            </Button>
          )}

          {/* Cancellation is a Client Component because it needs a confirmation
              dialogue — cancelling a medical appointment by a single misplaced tap
              would be genuinely bad. */}
          {['confirmed', 'pending_payment'].includes(appointment.status) && (
            <CancelAppointment
              site={site}
              appointmentId={appointment.id}
              refundable={refundable}
              amount={formatMoney(appointment.amount_paise)}
            />
          )}

          <Button
            href={whatsappLink(site, `Hi, about appointment ${appointment.code} — `)}
            variant="ghost"
            size="lg"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Phone className="size-4" aria-hidden="true" />
            Message the clinic
          </Button>
        </div>

        {/* Cancellation policy, stated where it is relevant rather than buried in
            the terms page. */}
        {appointment.status === 'confirmed' && (
          <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {refundable
              ? `You can still cancel this appointment for a full refund. After ${site.booking.freeCancellationHours} hours before the slot, the session is non-refundable, because that time can no longer be offered to someone else.`
              : `This appointment is now inside the ${site.booking.freeCancellationHours}-hour window, so cancelling will not be refunded. You can still cancel to free the slot, or message the clinic to discuss moving it.`}
          </p>
        )}
      </Card>

      {/* ---------------------------------------------------- what you told us */}
      {(appointment.patient_notes || appointment.pain_level !== null) && (
        <Card className="p-6">
          <h2 className="text-base font-bold">What you told us when booking</h2>

          {appointment.pain_level !== null && (
            <div className="mt-4 flex items-center gap-3">
              <span
                className="grid size-11 place-items-center rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: painColour(appointment.pain_level) }}
              >
                {appointment.pain_level}
              </span>
              <div>
                <p className="text-sm font-semibold">Pain at booking</p>
                <p className="text-xs text-ink-500">{appointment.pain_level} out of 10</p>
              </div>
            </div>
          )}

          {appointment.patient_notes && (
            // whitespace-pre-line preserves the line breaks the patient typed
            // without letting them inject HTML — React escapes the content, so
            // this is safe by default.
            <p className="mt-4 whitespace-pre-line rounded-2xl bg-ink-50 p-4 text-sm leading-relaxed text-ink-700 dark:bg-ink-800/60 dark:text-ink-300">
              {appointment.patient_notes}
            </p>
          )}
        </Card>
      )}

      {/* -------------------------------------------------- clinical notes */}
      {notes && (
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-brand-600" aria-hidden="true" />
            <h2 className="text-base font-bold">Notes from your session</h2>
          </div>
          <p className="mt-1 text-xs text-ink-500">
            Written by {notes.physio_name} after your appointment
          </p>

          {/* ------------------------------------------ pain before/after */}
          {notes.pain_level_before !== null && (
            <div className="mt-5 flex flex-wrap items-center gap-4 rounded-2xl bg-ink-50 p-4 dark:bg-ink-800/60">
              <div className="flex items-center gap-2.5">
                <span
                  className="grid size-10 place-items-center rounded-xl text-sm font-bold text-white"
                  style={{ backgroundColor: painColour(notes.pain_level_before) }}
                >
                  {notes.pain_level_before}
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-ink-500">Before</p>
                  <p className="text-xs text-ink-500">at the start</p>
                </div>
              </div>

              {notes.pain_level_after !== null && (
                <>
                  <span className="text-ink-300" aria-hidden="true">
                    →
                  </span>
                  <div className="flex items-center gap-2.5">
                    <span
                      className="grid size-10 place-items-center rounded-xl text-sm font-bold text-white"
                      style={{ backgroundColor: painColour(notes.pain_level_after) }}
                    >
                      {notes.pain_level_after}
                    </span>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-ink-500">After</p>
                      <p className="text-xs text-ink-500">end of session</p>
                    </div>
                  </div>

                  {notes.pain_level_after < notes.pain_level_before && (
                    <Badge tone="success">
                      {notes.pain_level_before - notes.pain_level_after} point improvement
                    </Badge>
                  )}
                </>
              )}
            </div>
          )}

          {/* ---------------------------------------------- the SOAP note */}
          {/*
            Only the Assessment and Plan are shown to the patient.

            Subjective and Objective are the physiotherapist's raw working notes —
            shorthand, measurements, differential possibilities being ruled out.
            Showing "?? early OA, r/o meniscal tear" to a patient causes alarm
            without informing them. The Assessment is the conclusion and the Plan is
            what they need to act on. Staff see all four in the admin panel.
          */}
          <div className="mt-6 space-y-5">
            {notes.assessment && (
              <NoteSection title="What we found" body={notes.assessment} />
            )}
            {notes.plan && <NoteSection title="Your treatment plan" body={notes.plan} />}
          </div>

          {(notes.sessions_recommended || notes.follow_up_date) && (
            <div className="mt-6 flex flex-wrap gap-6 border-t border-ink-100 pt-5 text-sm dark:border-ink-800">
              {notes.sessions_recommended ? (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-ink-500">
                    Sessions recommended
                  </p>
                  <p className="mt-1 font-semibold">{notes.sessions_recommended}</p>
                </div>
              ) : null}
              {notes.follow_up_date && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-ink-500">
                    Suggested follow-up
                  </p>
                  <p className="mt-1 font-semibold">{formatDateLong(notes.follow_up_date)}</p>
                </div>
              )}
              <div className="flex items-end">
                <Button href="/book" size="sm" variant="secondary">
                  Book follow-up
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ------------------------------------------------------- exercises */}
      {exercises.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <Dumbbell className="size-5 text-brand-600" aria-hidden="true" />
            <h2 className="text-base font-bold">Your home exercise programme</h2>
          </div>
          <p className="mt-1 text-xs text-ink-500">
            Doing these between sessions is what makes the difference. Stop and tell us if any of
            them causes sharp pain.
          </p>

          <ol className="mt-5 space-y-3">
            {exercises.map((exercise, index) => (
              <li
                key={index}
                className="flex gap-4 rounded-2xl border border-ink-200 p-4 dark:border-ink-700"
              >
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-[var(--color-brand-fg,#fff)]"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{exercise.name}</p>
                  <p className="mt-0.5 text-sm text-ink-600 dark:text-ink-400">
                    {[
                      exercise.sets && `${exercise.sets} sets`,
                      exercise.reps && `${exercise.reps} reps`,
                      exercise.frequency,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {exercise.notes && (
                    <p className="mt-1.5 text-sm italic text-ink-500 dark:text-ink-400">
                      {exercise.notes}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* --------------------------------------------------------- invoice */}
      {appointment.payment_status === 'paid' && (
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <Receipt className="size-5 text-brand-600" aria-hidden="true" />
            <h2 className="text-base font-bold">Payment receipt</h2>
          </div>

          <dl className="mt-4 space-y-2.5 text-sm">
            <ReceiptRow label="Amount paid" value={formatMoney(appointment.amount_paise, { withDecimals: true })} />
            <ReceiptRow label="Method" value={formatMethod(appointment.payment_method)} />
            <ReceiptRow label="Transaction id" value={appointment.razorpay_payment_id} mono />
            <ReceiptRow label="Reference" value={appointment.code} mono />
            {appointment.paid_at && (
              <ReceiptRow label="Paid on" value={formatDateLong(appointment.paid_at)} />
            )}
          </dl>

          <p className="mt-4 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            For a formal GST invoice for insurance or employer reimbursement, message the clinic
            quoting reference {appointment.code} and it will be emailed to you.
          </p>
        </Card>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  SMALL PIECES                                                              */
/* -------------------------------------------------------------------------- */

function Detail({ icon: DetailIcon, label, value }) {
  return (
    <div className="flex items-start gap-2.5">
      <DetailIcon className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-xs font-bold uppercase tracking-wider text-ink-500">{label}</dt>
        <dd className="mt-0.5 text-sm font-semibold">{value}</dd>
      </div>
    </div>
  )
}

function NoteSection({ title, body }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-brand-800 dark:text-brand-300">{title}</h3>
      <p className="mt-1.5 whitespace-pre-line text-[15px] leading-relaxed text-ink-700 dark:text-ink-300">
        {body}
      </p>
    </div>
  )
}

function ReceiptRow({ label, value, mono }) {
  if (!value) return null
  return (
    <div className="flex justify-between gap-4 border-b border-ink-100 pb-2.5 last:border-0 dark:border-ink-800">
      <dt className="text-ink-500 dark:text-ink-400">{label}</dt>
      <dd className={`text-right font-semibold ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  )
}

function formatMethod(method) {
  if (!method) return 'Online'
  const labels = {
    upi: 'UPI',
    card: 'Card',
    netbanking: 'Netbanking',
    wallet: 'Wallet',
    demo: 'Demo payment',
  }
  return labels[method] || method
}
