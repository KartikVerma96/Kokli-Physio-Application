import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft, Video, MapPin, Clock, CalendarDays, Phone, Mail, User, Receipt, AlertCircle,
} from 'lucide-react'
import { auth } from '@/lib/auth'
import { getAppointmentForUser, getAppointmentNotes, getPatientRecord } from '@/lib/queries'
import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import {
  formatMoney, formatDateLong, formatTime, statusMeta, ageFrom, canJoinCall,
} from '@/lib/utils'
import { Card, Badge } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { painColour } from '@/components/ui/Field'
import NotesForm from './NotesForm'
import StatusActions from './StatusActions'
import CollectPayment from './CollectPayment'

/**
 * ============================================================================
 *  ONE APPOINTMENT, STAFF VIEW  →  /admin/appointments/[id]
 * ============================================================================
 *  Everything the physiotherapist needs in one screen: who is coming, what they
 *  said, their medical history, and the form to write up the SOAP note afterwards.
 *
 *  The medical history is shown right beside the notes form ON PURPOSE. Diabetes
 *  changes recovery expectations, osteoporosis rules out spinal manipulation, and
 *  blood thinners rule out dry needling. Making a physiotherapist click away to
 *  another page to check is how those things get missed.
 * ============================================================================
 */

export const dynamic = 'force-dynamic'

export default async function AdminAppointmentPage({ params }) {
  const { id } = await params

  const session = await auth()
  const clinic = await requireCurrentClinic()
  const site = clinicView(clinic)
  const appointment = await getAppointmentForUser(clinic.id, id, session.user)
  if (!appointment) notFound()

  const [notes, record] = await Promise.all([
    getAppointmentNotes(clinic.id, appointment.id),
    getPatientRecord(clinic.id, appointment.patient_id),
  ])

  const meta = statusMeta(appointment.status)
  const isOnline = appointment.mode === 'online'
  const patient = record?.patient
  const age = ageFrom(patient?.date_of_birth)

  // Previous sessions, for context. A fourth visit is a very different
  // conversation from a first one.
  const previousVisits = (record?.appointments || []).filter(
    (a) => a.id !== appointment.id && a.status === 'completed'
  )

  return (
    <div className="space-y-6">
      <Link
        href="/admin/appointments"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 transition-colors hover:text-brand-700 dark:hover:text-brand-300"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All appointments
      </Link>

      {/* ============================================================ header */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={meta.tone} dot>
                {meta.label}
              </Badge>
              <Badge tone="neutral">{isOnline ? 'Online video' : 'In clinic'}</Badge>
              {appointment.payment_status === 'paid' ? (
                <Badge tone="success">Paid</Badge>
              ) : (
                <Badge tone="warning">Unpaid</Badge>
              )}
              <span className="font-mono text-xs text-ink-400">{appointment.code}</span>
            </div>

            <h1 className="mt-3 text-2xl font-bold">{appointment.service_name}</h1>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              {formatDateLong(appointment.appointment_date)} ·{' '}
              {formatTime(appointment.start_time)} – {formatTime(appointment.end_time)} ·{' '}
              {appointment.duration_minutes} minutes
            </p>
          </div>

          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
            <Icon name={appointment.service_icon} className="size-7" />
          </span>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-ink-100 pt-5 dark:border-ink-800">
          {isOnline && canJoinCall({ ...appointment, mode: 'online' }) && (
            <Button href={`/consult/${appointment.id}`} size="lg">
              <Video className="size-4" aria-hidden="true" />
              Join consultation
            </Button>
          )}

          {/* Status buttons are a Client Component: each one needs a confirmation,
              and marking a paid session as a no-show should not be a stray tap. */}
          <StatusActions appointmentId={appointment.id} status={appointment.status} />

          {appointment.patient_phone && (
            <Button
              href={`tel:${appointment.patient_phone.replace(/\s/g, '')}`}
              variant="ghost"
              size="lg"
            >
              <Phone className="size-4" aria-hidden="true" />
              {appointment.patient_phone}
            </Button>
          )}
        </div>
      </Card>

      {/**
        * Money before clinical notes.
        *
        * An unpaid appointment is the one thing on this page that has a deadline —
        * the patient is standing at the desk. The notes can be written up after
        * they have gone; the ₹800 cannot be collected after they have gone.
        */}
      <CollectPayment
        appointment={{
          id: appointment.id,
          amount_paise: appointment.amount_paise,
          payment_status: appointment.payment_status,
          payment_method: appointment.payment_method,
          collected_by_name: appointment.collected_by_name,
          patient_package_id: appointment.patient_package_id,
          package_name: appointment.package_name,
        }}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ================================================== notes column */}
        <div className="lg:col-span-2">
          <NotesForm
            appointmentId={appointment.id}
            notes={notes}
            patientPainAtBooking={appointment.pain_level}
          />
        </div>

        {/* ================================================ patient column */}
        <div className="space-y-6">
          {/* ------------------------------------------------ the patient */}
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-base font-bold">
                  <User className="size-4 text-brand-600" aria-hidden="true" />
                  {appointment.patient_name}
                </h2>
                <p className="mt-0.5 text-xs text-ink-500">
                  {[age && `${age} years`, patient?.gender && titleCase(patient.gender), patient?.city]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <Link
                href={`/admin/patients/${appointment.patient_id}`}
                className="shrink-0 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-400"
              >
                Full record →
              </Link>
            </div>

            <dl className="mt-4 space-y-2 text-sm">
              <Row icon={Mail} value={appointment.patient_email} />
              {appointment.patient_phone && <Row icon={Phone} value={appointment.patient_phone} />}
              {patient?.occupation && <Row icon={User} value={patient.occupation} />}
              {(patient?.height_cm || patient?.weight_kg) && (
                <Row
                  icon={User}
                  value={[
                    patient.height_cm && `${patient.height_cm} cm`,
                    patient.weight_kg && `${patient.weight_kg} kg`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              )}
            </dl>

            <p className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500 dark:border-ink-800">
              {previousVisits.length === 0
                ? 'First visit to the clinic.'
                : `${previousVisits.length} previous session${previousVisits.length === 1 ? '' : 's'} · last on ${formatDateLong(previousVisits[0].appointment_date)}`}
            </p>
          </Card>

          {/* --------------------------------------- what the patient said */}
          {(appointment.patient_notes || appointment.pain_level !== null) && (
            <Card className="p-5">
              <h2 className="text-base font-bold">What they wrote when booking</h2>

              {appointment.pain_level !== null && (
                <div className="mt-3 flex items-center gap-2.5">
                  <span
                    className="grid size-9 place-items-center rounded-xl text-sm font-bold text-white"
                    style={{ backgroundColor: painColour(appointment.pain_level) }}
                  >
                    {appointment.pain_level}
                  </span>
                  <span className="text-sm text-ink-600 dark:text-ink-400">
                    pain out of 10 at booking
                  </span>
                </div>
              )}

              {appointment.patient_notes && (
                <p className="mt-3 whitespace-pre-line rounded-xl bg-ink-50 p-3.5 text-sm leading-relaxed dark:bg-ink-800/60">
                  {appointment.patient_notes}
                </p>
              )}
            </Card>
          )}

          {/* -------------------------------------------- medical history */}
          {/*
            Deliberately styled as a warning panel rather than a neutral card. This
            is the information that changes what is SAFE to do, and it should be
            impossible to skim past.
          */}
          <Card className="border-amber-200 p-5 dark:border-amber-900">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <AlertCircle className="size-4 text-amber-600" aria-hidden="true" />
              Medical history
            </h2>

            <div className="mt-3 space-y-3 text-sm">
              <HistoryBlock label="Conditions & surgeries" value={patient?.medical_history} />
              <HistoryBlock label="Medication" value={patient?.current_medications} />
              <HistoryBlock label="Allergies" value={patient?.allergies} />
            </div>

            {!patient?.medical_history && !patient?.current_medications && !patient?.allergies && (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                Nothing on file. Ask at the start of the session and check specifically for
                diabetes, osteoporosis, cardiac conditions, pregnancy, blood thinners and
                pacemakers before choosing a treatment.
              </p>
            )}

            {patient?.emergency_contact_name && (
              <p className="mt-4 border-t border-ink-100 pt-3 text-xs dark:border-ink-800">
                <span className="font-bold">Emergency contact:</span> {patient.emergency_contact_name}
                {patient.emergency_contact_phone && ` · ${patient.emergency_contact_phone}`}
              </p>
            )}
          </Card>

          {/* --------------------------------------------- pain progress */}
          {/*
            The single most useful chart in a physiotherapy clinic: it is the
            objective evidence that a course of treatment is working, for the
            physio's own judgement and for the patient's confidence.
          */}
          {record?.painHistory?.length > 1 && (
            <Card className="p-5">
              <h2 className="text-base font-bold">Pain over the course of treatment</h2>
              <ul className="mt-4 space-y-2">
                {record.painHistory.map((entry, index) => (
                  <li key={index} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-xs text-ink-500">
                      {formatDateLong(entry.appointment_date).slice(0, -6)}
                    </span>
                    <div className="flex flex-1 items-center gap-1">
                      {/* A ten-segment bar per visit. Reading down the column shows
                          the trend at a glance without any charting code. */}
                      {Array.from({ length: 10 }, (_, n) => (
                        <span
                          key={n}
                          className="h-2 flex-1 rounded-sm"
                          style={{
                            backgroundColor:
                              n < entry.pain_level_before
                                ? painColour(entry.pain_level_before)
                                : 'var(--color-ink-200)',
                          }}
                        />
                      ))}
                    </div>
                    <span className="w-8 shrink-0 text-right text-xs font-bold tabular-nums">
                      {entry.pain_level_before}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* -------------------------------------------------- payment */}
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <Receipt className="size-4 text-brand-600" aria-hidden="true" />
              Payment
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <PaymentRow label="Amount" value={formatMoney(appointment.amount_paise)} />
              <PaymentRow label="Status" value={appointment.payment_status || 'not paid'} />
              {appointment.payment_method && (
                <PaymentRow label="Method" value={appointment.payment_method.toUpperCase()} />
              )}
              {appointment.razorpay_payment_id && (
                <PaymentRow label="Reference" value={appointment.razorpay_payment_id} mono />
              )}
            </dl>
          </Card>

          {/* ------------------------------------------------- location */}
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-base font-bold">
              {isOnline ? (
                <Video className="size-4 text-brand-600" aria-hidden="true" />
              ) : (
                <MapPin className="size-4 text-brand-600" aria-hidden="true" />
              )}
              {isOnline ? 'Online consultation' : 'In clinic'}
            </h2>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-400">
              {isOnline
                ? 'A private video room opens for both of you 10 minutes before the slot.'
                : `${site.address.line1}, ${site.address.line2}, ${site.address.city}`}
            </p>
            {isOnline && appointment.room_id && (
              <p className="mt-2 font-mono text-[10px] text-ink-400">
                Room {appointment.room_id.slice(0, 16)}…
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Row({ icon: RowIcon, value }) {
  return (
    <div className="flex items-center gap-2">
      <RowIcon className="size-3.5 shrink-0 text-ink-400" aria-hidden="true" />
      <dd className="min-w-0 truncate">{value}</dd>
    </div>
  )
}

function HistoryBlock({ label, value }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-400">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line leading-relaxed">{value}</dd>
    </div>
  )
}

function PaymentRow({ label, value, mono }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500 dark:text-ink-400">{label}</dt>
      <dd className={`text-right font-semibold ${mono ? 'break-all font-mono text-[11px]' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

function titleCase(value) {
  return String(value).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}
