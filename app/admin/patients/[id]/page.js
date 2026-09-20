import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft, Mail, Phone, MapPin, Briefcase, Ruler, Weight, AlertCircle, FileText,
  TrendingDown, Calendar,
} from 'lucide-react'
import { getPatientRecord } from '@/lib/queries'
import {
  formatMoney, formatDateShort, formatDateLong, formatTime, statusMeta, ageFrom, initials,
} from '@/lib/utils'
import { Card, Badge, Stat } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { painColour } from '@/components/ui/Field'
import { requireCurrentClinic } from '@/lib/tenant'
import { patientPackages, clinicPackages } from '@/lib/packages'
import PackagePanel from './PackagePanel'

/**
 * ============================================================================
 *  ONE PATIENT RECORD  →  /admin/patients/[id]
 * ============================================================================
 *  The complete clinical picture: demographics, medical history, every
 *  appointment, and the pain trend across their course of treatment.
 *
 *  Note the ordering: medical history sits ABOVE the appointment list. When you are
 *  about to treat someone, the contraindications matter more than the billing
 *  history, so they should not be something you scroll past.
 * ============================================================================
 */

export const dynamic = 'force-dynamic'

export default async function PatientRecordPage({ params }) {
  const clinic = await requireCurrentClinic()
  const { id } = await params
  const record = await getPatientRecord(clinic.id, id)

  if (!record) notFound()

  // Their courses of treatment, and what the clinic currently sells.
  const [packages, offerings] = await Promise.all([
    patientPackages(clinic.id, id),
    clinicPackages(clinic.id, { activeOnly: true }),
  ])

  const { patient, appointments, painHistory } = record
  const age = ageFrom(patient.date_of_birth)

  const completed = appointments.filter((a) => a.status === 'completed')
  const noShows = appointments.filter((a) => a.status === 'no_show')
  const lifetime = appointments
    .filter((a) => ['confirmed', 'completed', 'in_progress'].includes(a.status))
    .reduce((sum, a) => sum + a.amount_paise, 0)

  // Was the last session better than the first? The clearest possible summary of
  // whether treatment is working.
  const painChange =
    painHistory.length > 1
      ? painHistory[0].pain_level_before - painHistory[painHistory.length - 1].pain_level_before
      : null

  return (
    <div className="space-y-6">
      <Link
        href="/admin/patients"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 transition-colors hover:text-brand-700 dark:hover:text-brand-300"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All patients
      </Link>

      {/* ============================================================ header */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start gap-5">
          {patient.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={patient.image} alt="" className="size-16 shrink-0 rounded-2xl object-cover" />
          ) : (
            <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-brand-100 text-xl font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
              {initials(patient.name)}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{patient.name}</h1>
            <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
              {[
                age && `${age} years old`,
                patient.gender && titleCase(patient.gender),
                patient.occupation,
              ]
                .filter(Boolean)
                .join(' · ') || 'No profile details yet'}
            </p>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
              <a
                href={`mailto:${patient.email}`}
                className="flex items-center gap-1.5 hover:text-brand-700 dark:hover:text-brand-300"
              >
                <Mail className="size-3.5 text-ink-400" aria-hidden="true" />
                {patient.email}
              </a>
              {patient.phone && (
                <a
                  href={`tel:${patient.phone.replace(/\s/g, '')}`}
                  className="flex items-center gap-1.5 hover:text-brand-700 dark:hover:text-brand-300"
                >
                  <Phone className="size-3.5 text-ink-400" aria-hidden="true" />
                  {patient.phone}
                </a>
              )}
              {patient.city && (
                <span className="flex items-center gap-1.5 text-ink-600 dark:text-ink-400">
                  <MapPin className="size-3.5 text-ink-400" aria-hidden="true" />
                  {patient.city}
                </span>
              )}
            </div>
          </div>

          <p className="shrink-0 text-xs text-ink-400">
            Patient since {formatDateShort(patient.created_at)}
          </p>
        </div>
      </Card>

      {/* ------------------------------------------------------------- stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Sessions completed" value={completed.length} icon={<FileText className="size-5" />} />
        <Stat
          label="Total appointments"
          value={appointments.length}
          hint={noShows.length ? `${noShows.length} no-show${noShows.length === 1 ? '' : 's'}` : 'no missed visits'}
          icon={<Calendar className="size-5" />}
          tone="info"
        />
        <Stat
          label="Lifetime value"
          value={formatMoney(lifetime)}
          icon={<TrendingDown className="size-5" />}
          tone="warning"
        />
        <Stat
          label="Pain change"
          value={painChange === null ? '—' : painChange > 0 ? `−${painChange}` : `+${Math.abs(painChange)}`}
          hint={
            painChange === null
              ? 'needs 2+ recorded sessions'
              : painChange > 0
                ? 'points better since first visit'
                : 'points worse — review the plan'
          }
          icon={<TrendingDown className="size-5" />}
          tone={painChange === null ? 'brand' : painChange > 0 ? 'success' : 'danger'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ============================================ appointment history */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-ink-100 p-5 dark:border-ink-800">
              <h2 className="font-bold">Appointment history</h2>
            </div>

            {appointments.length === 0 ? (
              <p className="p-5 text-sm text-ink-500">No appointments booked yet.</p>
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                {appointments.map((appointment) => {
                  const meta = statusMeta(appointment.status)
                  return (
                    <li key={appointment.id}>
                      <Link
                        href={`/admin/appointments/${appointment.id}`}
                        className="flex items-center gap-4 p-4 transition-colors hover:bg-ink-50/60 dark:hover:bg-ink-800/40"
                      >
                        <div className="w-20 shrink-0">
                          <p className="text-sm font-semibold">
                            {formatDateShort(appointment.appointment_date)}
                          </p>
                          <p className="text-xs text-ink-500 tabular-nums">
                            {formatTime(appointment.start_time)}
                          </p>
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{appointment.service_name}</p>
                          <p className="text-xs text-ink-500">
                            {appointment.mode === 'online' ? 'Online' : 'Clinic'} ·{' '}
                            <span className="font-mono">{appointment.code}</span>
                          </p>
                        </div>

                        {Boolean(appointment.has_notes) && (
                          <FileText className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
                        )}

                        <Badge tone={meta.tone}>{meta.label}</Badge>

                        <span className="hidden w-16 shrink-0 text-right text-sm font-semibold tabular-nums sm:block">
                          {formatMoney(appointment.amount_paise)}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {/* ------------------------------------------------ pain trend */}
          {painHistory.length > 0 && (
            <Card className="p-5">
              <h2 className="font-bold">Pain across treatment</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                Recorded at the start of each session. This is the objective evidence that treatment
                is working.
              </p>

              <ul className="mt-5 space-y-2.5">
                {painHistory.map((entry, index) => (
                  <li key={index} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs text-ink-500">
                      {formatDateShort(entry.appointment_date)}
                    </span>

                    <div className="flex flex-1 gap-1">
                      {Array.from({ length: 10 }, (_, n) => (
                        <span
                          key={n}
                          className="h-2.5 flex-1 rounded-sm"
                          style={{
                            backgroundColor:
                              n < entry.pain_level_before
                                ? painColour(entry.pain_level_before)
                                : 'var(--color-ink-200)',
                          }}
                        />
                      ))}
                    </div>

                    <span className="w-16 shrink-0 text-right text-xs font-bold tabular-nums">
                      {entry.pain_level_before}
                      {entry.pain_level_after !== null && (
                        <span className="font-normal text-ink-400"> → {entry.pain_level_after}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* ================================================ clinical column */}
        <div className="space-y-6">
          {/**
            * Packages sit above the medical history on purpose.
            *
            * "4 of 10 used" is what reception needs the moment this page opens —
            * both to tell the patient where they are in their course, and to know
            * when to have the conversation about the next one. It is the only thing
            * on the page that is time-sensitive.
            */}
          <PackagePanel
            patientId={patient.id}
            patientName={patient.name}
            packages={packages.map((pkg) => ({
              id: pkg.id,
              name: pkg.name,
              status: pkg.status,
              price_paise: Number(pkg.price_paise),
              service_name: pkg.service_name,
              purchased_at: pkg.purchased_at,
              expires_at: pkg.expires_at,
              sessionsUsed: pkg.sessionsUsed,
              sessionsTotal: pkg.sessionsTotal,
              sessionsRemaining: pkg.sessionsRemaining,
              isUsable: pkg.isUsable,
              isExpired: pkg.isExpired,
              label: pkg.label,
            }))}
            offerings={offerings.map((o) => ({
              id: o.id,
              name: o.name,
              sessionsCount: Number(o.sessions_count),
              pricePaise: Number(o.price_paise),
              validityDays: Number(o.validity_days),
              serviceName: o.service_name,
            }))}
          />

          {/* Medical history first — this is what changes what is safe to do. */}
          <Card className="border-amber-200 p-5 dark:border-amber-900">
            <h2 className="flex items-center gap-2 font-bold">
              <AlertCircle className="size-4 text-amber-600" aria-hidden="true" />
              Medical history
            </h2>

            <div className="mt-3 space-y-3 text-sm">
              <Block label="Conditions & surgeries" value={patient.medical_history} />
              <Block label="Current medication" value={patient.current_medications} />
              <Block label="Allergies" value={patient.allergies} />
              <Block label="Referred by" value={patient.referred_by} />
            </div>

            {!patient.medical_history && !patient.current_medications && !patient.allergies && (
              <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                Nothing on file. Ask the patient to complete it in their dashboard, or take the
                history at the next session.
              </p>
            )}
          </Card>

          {/* ------------------------------------------------- measurements */}
          <Card className="p-5">
            <h2 className="font-bold">Profile</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <ProfileRow icon={Briefcase} label="Occupation" value={patient.occupation} />
              <ProfileRow icon={Ruler} label="Height" value={patient.height_cm && `${patient.height_cm} cm`} />
              <ProfileRow icon={Weight} label="Weight" value={patient.weight_kg && `${patient.weight_kg} kg`} />
              <ProfileRow
                icon={Calendar}
                label="Date of birth"
                value={patient.date_of_birth && formatDateLong(patient.date_of_birth)}
              />
              <ProfileRow icon={MapPin} label="Address" value={patient.address} />
            </dl>

            {patient.emergency_contact_name && (
              <div className="mt-4 border-t border-ink-100 pt-3 dark:border-ink-800">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
                  Emergency contact
                </p>
                <p className="mt-1 text-sm font-semibold">{patient.emergency_contact_name}</p>
                {patient.emergency_contact_phone && (
                  <a
                    href={`tel:${patient.emergency_contact_phone.replace(/\s/g, '')}`}
                    className="text-sm text-brand-700 hover:underline dark:text-brand-400"
                  >
                    {patient.emergency_contact_phone}
                  </a>
                )}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-bold">Contact this patient</h2>
            <div className="mt-3 space-y-2">
              <Button href={`mailto:${patient.email}`} variant="secondary" size="sm" fullWidth>
                <Mail className="size-4" aria-hidden="true" />
                Send an email
              </Button>
              {patient.phone && (
                <Button
                  href={`https://wa.me/${patient.phone.replace(/\D/g, '')}`}
                  variant="secondary"
                  size="sm"
                  fullWidth
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Phone className="size-4" aria-hidden="true" />
                  WhatsApp
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Block({ label, value }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-400">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line leading-relaxed">{value}</dd>
    </div>
  )
}

function ProfileRow({ icon: RowIcon, label, value }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2">
      <RowIcon className="mt-0.5 size-3.5 shrink-0 text-ink-400" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-400">{label}</dt>
        <dd className="leading-snug">{value}</dd>
      </div>
    </div>
  )
}

function titleCase(value) {
  return String(value).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}
