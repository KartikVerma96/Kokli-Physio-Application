import Link from 'next/link'
import {
  CalendarCheck, Video, MapPin, Clock, Plus, Dumbbell, FileText, ArrowRight, Sparkles,
} from 'lucide-react'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import {
  getNextAppointment, getPatientAppointments, getPatientExercises, getActiveServices,
} from '@/lib/queries'
import {
  formatMoney, formatDateLong, formatTime, formatDateRelative, statusMeta, canJoinCall,
  firstName,
} from '@/lib/utils'
import { Card, Stat, Badge, EmptyState } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import AppointmentRow from '@/components/dashboard/AppointmentRow'

/**
 * ============================================================================
 *  DASHBOARD OVERVIEW  →  /dashboard
 * ============================================================================
 *  The one screen a returning patient looks at. It answers three questions in
 *  order of urgency:
 *
 *    1. When is my next appointment, and can I join it right now?
 *    2. What exercises am I supposed to be doing?
 *    3. What has happened so far?
 *
 *  All server-rendered, so it arrives complete — no spinners, no "loading your
 *  appointments" while a patient with a live consultation in two minutes waits to
 *  find the Join button.
 * ============================================================================
 */

// Never cached: a patient reloading this page ten minutes before a consultation
// must see the Join button appear, not a stale copy from earlier.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const clinic = await requireCurrentClinic()
  const site = clinicView(clinic)
  const session = await auth()
  const userId = session.user.id

  const [next, appointments, exercisePlans, services] = await Promise.all([
    getNextAppointment(clinic.id, userId),
    getPatientAppointments(clinic.id, userId, { limit: 6 }),
    getPatientExercises(clinic.id, userId),
    getActiveServices(clinic.id),
  ])

  const completed = appointments.filter((a) => a.status === 'completed').length
  const upcoming = appointments.filter((a) =>
    ['confirmed', 'in_progress'].includes(a.status)
  ).length
  const totalSpent = appointments
    .filter((a) => ['confirmed', 'completed', 'in_progress'].includes(a.status))
    .reduce((sum, a) => sum + a.amount_paise, 0)

  // The most recent prescription is the one that matters — that is what they
  // should be doing this week.
  const latestPlan = exercisePlans[0]
  const exerciseCount = latestPlan?.exercises_prescribed?.length ?? 0

  const greetingName = firstName(session.user.name)

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- greeting */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl">
            {greeting(site)}, {greetingName}
          </h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            {next
              ? `Your next appointment is ${formatDateRelative(next.appointment_date).toLowerCase()} at ${formatTime(next.start_time)}.`
              : 'You have no upcoming appointments booked.'}
          </p>
        </div>
        <Button href="/book" size="sm">
          <Plus className="size-4" aria-hidden="true" />
          Book appointment
        </Button>
      </div>

      {/* ------------------------------------------------- next appointment */}
      {next ? (
        <NextAppointmentCard appointment={next} site={site} />
      ) : (
        <Card className="p-0">
          <EmptyState
            icon={<CalendarCheck className="size-6" />}
            title="Nothing booked yet"
            description={
              completed > 0
                ? 'Keeping up with follow-ups is what makes progress stick. Book your next session when you are ready.'
                : `Book an assessment with ${site.doctor.name} and get a proper diagnosis plus a written plan.`
            }
            action={<Button href="/book">Find a slot</Button>}
          />
        </Card>
      )}

      {/* ------------------------------------------------------------ stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Upcoming"
          value={upcoming}
          hint={upcoming === 1 ? 'appointment booked' : 'appointments booked'}
          icon={<CalendarCheck className="size-5" />}
          tone="brand"
        />
        <Stat
          label="Completed"
          value={completed}
          hint="sessions finished"
          icon={<FileText className="size-5" />}
          tone="success"
        />
        <Stat
          label="Exercises"
          value={exerciseCount}
          hint={exerciseCount ? 'in your current plan' : 'none prescribed yet'}
          icon={<Dumbbell className="size-5" />}
          tone="info"
        />
        <Stat
          label="Invested in recovery"
          value={formatMoney(totalSpent)}
          hint="across all sessions"
          icon={<Sparkles className="size-5" />}
          tone="warning"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ------------------------------------------------- appointments */}
        <div className="lg:col-span-2">
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-ink-100 p-5 dark:border-ink-800">
              <h2 className="font-bold">Recent appointments</h2>
              {appointments.length > 0 && (
                <Link
                  href="/dashboard/appointments"
                  className="flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-400"
                >
                  See all
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              )}
            </div>

            {appointments.length === 0 ? (
              <EmptyState
                icon={<CalendarCheck className="size-6" />}
                title="No appointments yet"
                description="Your appointment history will appear here."
                action={<Button href="/book" size="sm">Book your first session</Button>}
              />
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                {appointments.map((appointment) => (
                  <AppointmentRow key={appointment.id} appointment={appointment} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* ---------------------------------------------------- exercises */}
        <div className="space-y-6">
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-ink-100 p-5 dark:border-ink-800">
              <h2 className="font-bold">Your exercises</h2>
              {exerciseCount > 0 && (
                <Link
                  href="/dashboard/exercises"
                  className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-400"
                >
                  All
                </Link>
              )}
            </div>

            {exerciseCount === 0 ? (
              <div className="p-5">
                <p className="text-sm leading-relaxed text-ink-500 dark:text-ink-400">
                  Nothing prescribed yet. After your first session, your home exercise programme
                  appears here — with sets, reps and how often to do them.
                </p>
              </div>
            ) : (
              <>
                <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                  {latestPlan.exercises_prescribed.slice(0, 4).map((exercise, index) => (
                    <li key={index} className="p-4">
                      <p className="text-sm font-semibold">{exercise.name}</p>
                      <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                        {[exercise.sets && `${exercise.sets} sets`, exercise.reps && `${exercise.reps} reps`, exercise.frequency]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </li>
                  ))}
                </ul>
                {exerciseCount > 4 && (
                  <div className="border-t border-ink-100 p-4 dark:border-ink-800">
                    <Button href="/dashboard/exercises" variant="secondary" size="sm" fullWidth>
                      View all {exerciseCount} exercises
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* -------------------------------------------- quick booking */}
          <Card className="p-5">
            <h2 className="font-bold">Book again</h2>
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
              Straight to a slot for the treatment you need.
            </p>
            <ul className="mt-4 space-y-2">
              {services.slice(0, 4).map((service) => (
                <li key={service.id}>
                  <Link
                    href={`/book?service=${service.slug}`}
                    className="group flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-ink-50 dark:hover:bg-ink-800"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
                      <Icon name={service.icon} className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{service.name}</span>
                      <span className="block text-xs text-ink-500">
                        {formatMoney(service.price_paise)} · {service.duration_minutes} min
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  THE NEXT APPOINTMENT                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The hero card. Deliberately the largest and loudest thing on the page, because
 * for a patient with a consultation today it is the only thing they came for.
 *
 * The Join button appears from 10 minutes before the start time — see canJoinCall
 * in lib/utils.js. That early window is not arbitrary: it lets people sort out
 * camera and microphone permissions without eating into a paid session.
 */
function NextAppointmentCard({ appointment, site }) {
  const joinable = canJoinCall(appointment)
  const isOnline = appointment.mode === 'online'
  const meta = statusMeta(appointment.status)

  return (
    <Card className="relative overflow-hidden border-brand-200 p-0 dark:border-brand-800">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-linear-to-br from-brand-50 via-white to-sun-50/40 dark:from-brand-950/50 dark:via-ink-900 dark:to-ink-900"
      />

      <div className="relative p-6 lg:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand" dot>
                Next appointment
              </Badge>
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <span className="font-mono text-xs text-ink-400">{appointment.code}</span>
            </div>

            <h2 className="mt-3 text-xl font-bold lg:text-2xl">{appointment.service_name}</h2>

            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <CalendarCheck className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
                <dt className="sr-only">Date</dt>
                <dd className="font-semibold">{formatDateLong(appointment.appointment_date)}</dd>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
                <dt className="sr-only">Time</dt>
                <dd className="font-semibold">
                  {formatTime(appointment.start_time)} – {formatTime(appointment.end_time)}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                {isOnline ? (
                  <Video className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
                ) : (
                  <MapPin className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
                )}
                <dt className="sr-only">Where</dt>
                <dd className="font-semibold">
                  {isOnline ? 'Online video call' : `${site.address.line1}, ${site.address.city}`}
                </dd>
              </div>
            </dl>
          </div>

          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-600 text-white shadow-brand">
            <Icon name={appointment.service_icon} className="size-7" />
          </span>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {isOnline && joinable && (
            // animate-pulse-ring draws the eye to the one thing that is
            // time-sensitive. Used nowhere else in the app, on purpose.
            <Button
              href={`/consult/${appointment.id}`}
              size="lg"
              className="animate-pulse-ring"
            >
              <Video className="size-4" aria-hidden="true" />
              Join video consultation
            </Button>
          )}

          {isOnline && !joinable && (
            <span className="flex items-center gap-2 rounded-xl bg-white/70 px-4 py-2.5 text-sm font-medium text-ink-600 dark:bg-ink-800/70 dark:text-ink-300">
              <Clock className="size-4" aria-hidden="true" />
              The join button appears 10 minutes before your appointment
            </span>
          )}

          <Button href={`/dashboard/appointments/${appointment.id}`} variant="secondary" size="lg">
            View details
          </Button>

          {!isOnline && (
            <Button
              href={site.address.mapsUrl}
              variant="ghost"
              size="lg"
              target="_blank"
              rel="noopener noreferrer"
            >
              <MapPin className="size-4" aria-hidden="true" />
              Directions
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

/** A greeting that matches the clock. Small touch, makes the app feel alive. */
function greeting(site) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: site.timezone,
      hour: '2-digit',
      hour12: false,
    }).format(new Date())
  )
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}
