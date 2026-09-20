import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  CalendarDays, Users, IndianRupee, Clock, Video, MapPin, TrendingUp, FileText,
  AlertCircle, CheckCircle2, Phone,
} from 'lucide-react'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import { getAdminStats, getTodaysSchedule } from '@/lib/queries'
import { getDefaultPhysioId, releaseExpiredHolds } from '@/lib/slots'
import { formatMoney, formatTime, formatDateLong, statusMeta, todayISO, firstName } from '@/lib/utils'
import { Card, Stat, Badge, EmptyState } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'

/**
 * ============================================================================
 *  ADMIN DASHBOARD  →  /admin
 * ============================================================================
 *  The first thing your sister sees each morning. Today's diary comes first,
 *  because that is what she needs in the next hour — the numbers can wait until
 *  she has scrolled.
 * ============================================================================
 */

export const dynamic = 'force-dynamic'

export default async function AdminDashboard() {
  const clinic = await requireCurrentClinic()

  /**
   * A clinic that has not finished setting up goes straight to the wizard.
   *
   * A redirect rather than a banner. A half-configured clinic has no treatments
   * and no working hours, so this dashboard would be a wall of empty states and
   * its public website could not take a single booking. Dropping a new owner
   * into that and hoping they find "Settings" is how a signup becomes a churn.
   *
   * It lives on this page rather than the admin layout because a layout cannot
   * read the pathname — putting it there would redirect the wizard to itself.
   */
  if (clinic.onboarding_step !== 'done') {
    redirect('/admin/onboarding')
  }

  const session = await auth()
  const physioId = await getDefaultPhysioId(clinic.id)

  /**
   * Tidy up abandoned payment holds on the way in.
   *
   * This is why the app needs no cron job: the cleanup runs as a side effect of
   * somebody using the site. On a staff dashboard that is loaded several times a
   * day, it is more than frequent enough. See lib/slots.js.
   */
  await releaseExpiredHolds()

  const [stats, schedule] = await Promise.all([
    getAdminStats(clinic.id),
    physioId ? getTodaysSchedule(clinic.id, physioId) : [],
  ])

  const isAdmin = session.user.role === 'admin'
  const nextUp = schedule.find((a) => ['confirmed', 'in_progress'].includes(a.status))

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------ header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl">Good day, {firstName(session.user.name)}</h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            {formatDateLong(todayISO())} ·{' '}
            {schedule.length === 0
              ? 'nothing booked today'
              : `${schedule.length} appointment${schedule.length === 1 ? '' : 's'} today`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button href="/admin/appointments" variant="secondary" size="sm">
            All appointments
          </Button>
          <Button href="/admin/availability" size="sm">
            Manage availability
          </Button>
        </div>
      </div>

      {/* --------------------------------------------- awaiting payment alert */}
      {/* Surfaced prominently because it is money in limbo — a patient who paid
          but whose confirmation never arrived needs someone to look. */}
      {Number(stats.appointments.awaiting_payment_count) > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div className="flex-1 text-sm">
            <p className="font-bold text-amber-900 dark:text-amber-100">
              {stats.appointments.awaiting_payment_count} booking
              {Number(stats.appointments.awaiting_payment_count) === 1 ? '' : 's'} awaiting payment
            </p>
            <p className="mt-0.5 text-amber-800 dark:text-amber-200">
              These slots are held while the patient pays and release automatically if they do not.
              No action needed unless a patient says they were charged.
            </p>
          </div>
          <Button href="/admin/appointments?status=pending_payment" variant="secondary" size="sm">
            Review
          </Button>
        </div>
      )}

      {/* ------------------------------------------------------------- stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Today"
          value={Number(stats.appointments.today_count) || 0}
          hint="appointments"
          icon={<CalendarDays className="size-5" />}
          tone="brand"
        />
        <Stat
          label="Upcoming"
          value={Number(stats.appointments.upcoming_count) || 0}
          hint="confirmed ahead"
          icon={<Clock className="size-5" />}
          tone="info"
        />
        <Stat
          label="Patients"
          value={Number(stats.patients.total) || 0}
          hint={`${Number(stats.patients.new_this_month) || 0} new in 30 days`}
          icon={<Users className="size-5" />}
          tone="success"
        />
        {/* Revenue is admin-only. The physiotherapist sees the diary; the person
            who runs the business sees the money. */}
        {isAdmin ? (
          <Stat
            label="This month"
            value={formatMoney(Number(stats.revenue.month_paise) || 0)}
            hint={`${formatMoney(Number(stats.revenue.total_paise) || 0)} all time`}
            icon={<IndianRupee className="size-5" />}
            tone="warning"
          />
        ) : (
          <Stat
            label="Completed"
            value={Number(stats.appointments.completed_count) || 0}
            hint="sessions delivered"
            icon={<CheckCircle2 className="size-5" />}
            tone="warning"
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* =============================================== today's schedule */}
        <div className="lg:col-span-2">
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-ink-100 p-5 dark:border-ink-800">
              <div>
                <h2 className="font-bold">Today’s diary</h2>
                {nextUp && (
                  <p className="mt-0.5 text-xs text-ink-500">
                    Next: {nextUp.patient_name} at {formatTime(nextUp.start_time)}
                  </p>
                )}
              </div>
              <Link
                href={`/admin/appointments?date=${todayISO()}`}
                className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-400"
              >
                Open
              </Link>
            </div>

            {schedule.length === 0 ? (
              <EmptyState
                icon={<CalendarDays className="size-6" />}
                title="Nothing booked today"
                description="A clear day. Availability for the coming weeks is managed under Availability."
                action={
                  <Button href="/admin/availability" size="sm" variant="secondary">
                    Check availability
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                {schedule.map((appointment) => (
                  <ScheduleRow key={appointment.id} appointment={appointment} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* ================================================== side column */}
        <div className="space-y-6">
          {/* -------------------------------------------- booking trend */}
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-brand-600" aria-hidden="true" />
              <h2 className="font-bold">Bookings, last 14 days</h2>
            </div>
            <BookingSparkline trend={stats.trend} />
          </Card>

          {/* ------------------------------------------ popular services */}
          <Card className="p-5">
            <h2 className="font-bold">Most booked</h2>
            {stats.popular.length === 0 ? (
              <p className="mt-3 text-sm text-ink-500">No bookings yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {stats.popular.map((service, index) => {
                  const max = Number(stats.popular[0].bookings) || 1
                  const percent = Math.round((Number(service.bookings) / max) * 100)
                  return (
                    <li key={service.name}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-medium">{service.name}</span>
                        <span className="shrink-0 text-sm font-bold tabular-nums">
                          {service.bookings}
                        </span>
                      </div>
                      {/* A plain bar. No charting library needed for this, and it
                          keeps the JavaScript bundle honest. */}
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                        <div
                          className="h-full rounded-full bg-brand-500"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {/* ------------------------------------------------ mode split */}
          <Card className="p-5">
            <h2 className="font-bold">Online vs in-clinic</h2>
            <div className="mt-4 space-y-3">
              <ModeBar
                icon={MapPin}
                label="At the clinic"
                count={Number(stats.appointments.clinic_count) || 0}
                total={
                  (Number(stats.appointments.clinic_count) || 0) +
                  (Number(stats.appointments.online_count) || 0)
                }
              />
              <ModeBar
                icon={Video}
                label="Online video"
                count={Number(stats.appointments.online_count) || 0}
                total={
                  (Number(stats.appointments.clinic_count) || 0) +
                  (Number(stats.appointments.online_count) || 0)
                }
              />
            </div>
            {Number(stats.appointments.no_show_count) > 0 && (
              <p className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500 dark:border-ink-800">
                {stats.appointments.no_show_count} no-show
                {Number(stats.appointments.no_show_count) === 1 ? '' : 's'} ·{' '}
                {stats.appointments.cancelled_count} cancelled overall
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  ONE ROW OF THE DIARY                                                      */
/* -------------------------------------------------------------------------- */

function ScheduleRow({ appointment }) {
  const meta = statusMeta(appointment.status)
  const isOnline = appointment.mode === 'online'

  return (
    <li className="flex items-center gap-4 p-4">
      {/* The time, large and left-aligned. Scanning a diary is scanning times. */}
      <div className="w-16 shrink-0 text-center">
        <p className="text-sm font-bold tabular-nums">{formatTime(appointment.start_time)}</p>
        <p className="text-[10px] text-ink-400">{formatTime(appointment.end_time)}</p>
      </div>

      <span
        className={`grid size-9 shrink-0 place-items-center rounded-xl ${
          isOnline
            ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300'
            : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300'
        }`}
      >
        <Icon name={appointment.service_icon} className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{appointment.patient_name}</p>
        <p className="truncate text-xs text-ink-500 dark:text-ink-400">
          {appointment.service_name} · {isOnline ? 'online' : 'clinic'}
        </p>
      </div>

      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        {Boolean(appointment.has_notes) && (
          <span title="Clinical notes written">
            <FileText className="size-4 text-brand-600" aria-hidden="true" />
          </span>
        )}
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>

      <div className="flex shrink-0 gap-1">
        {/* A tel: link, so a staff member on a phone can ring a late patient with
            one tap rather than copying the number out. */}
        {appointment.patient_phone && (
          <a
            href={`tel:${appointment.patient_phone.replace(/\s/g, '')}`}
            className="grid size-9 place-items-center rounded-xl text-ink-500 transition-colors hover:bg-ink-100 hover:text-brand-700 dark:hover:text-brand-300 dark:hover:bg-ink-800"
            aria-label={`Call ${appointment.patient_name}`}
            title={appointment.patient_phone}
          >
            <Phone className="size-4" />
          </a>
        )}

        {isOnline && ['confirmed', 'in_progress'].includes(appointment.status) && (
          <Link
            href={`/consult/${appointment.id}`}
            className="grid size-9 place-items-center rounded-xl bg-brand-600 text-white transition-colors hover:bg-brand-700"
            aria-label="Join video consultation"
            title="Join video consultation"
          >
            <Video className="size-4" />
          </Link>
        )}

        <Link
          href={`/admin/appointments/${appointment.id}`}
          className="grid size-9 place-items-center rounded-xl text-ink-500 transition-colors hover:bg-ink-100 hover:text-brand-700 dark:hover:text-brand-300 dark:hover:bg-ink-800"
          aria-label="Open appointment"
          title="Open appointment"
        >
          <FileText className="size-4" />
        </Link>
      </div>
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/*  A SPARKLINE, WITHOUT A CHART LIBRARY                                      */
/* -------------------------------------------------------------------------- */

/**
 * Fourteen bars showing bookings per day.
 *
 * Deliberately hand-rolled rather than reaching for Recharts or Chart.js. Those
 * are 100–200KB of JavaScript, and this is fourteen divs with a height. For a
 * simple bar chart the library costs more than it gives — and on a clinic admin
 * page loaded on a phone over mobile data, that trade matters.
 */
function BookingSparkline({ trend }) {
  // The query only returns days that HAD bookings, so the gaps have to be filled
  // in — otherwise five bookings over fourteen days renders as five adjacent bars
  // and looks like a busy fortnight.
  const days = []
  const byDay = new Map(trend.map((row) => [String(row.day).slice(0, 10), Number(row.bookings)]))

  for (let i = 13; i >= 0; i--) {
    const date = new Date()
    date.setDate(date.getDate() - i)
    const iso = date.toISOString().slice(0, 10)
    days.push({ iso, count: byDay.get(iso) || 0 })
  }

  const max = Math.max(1, ...days.map((d) => d.count))
  const total = days.reduce((sum, d) => sum + d.count, 0)

  return (
    <>
      <p className="mt-2 text-2xl font-bold tabular-nums">{total}</p>
      <p className="text-xs text-ink-500">bookings in the last two weeks</p>

      <div className="mt-4 flex h-16 items-end gap-1" role="img" aria-label={`${total} bookings over the last 14 days`}>
        {days.map((day) => (
          <div
            key={day.iso}
            // A minimum height of 4% so a zero-booking day still shows a faint
            // tick. A bar of literally zero height reads as missing data.
            style={{ height: `${Math.max(4, (day.count / max) * 100)}%` }}
            className={`flex-1 rounded-t ${
              day.count > 0 ? 'bg-brand-500' : 'bg-ink-200 dark:bg-ink-700'
            }`}
            title={`${day.iso}: ${day.count} booking${day.count === 1 ? '' : 's'}`}
          />
        ))}
      </div>
    </>
  )
}

function ModeBar({ icon: ModeIcon, label, count, total }) {
  const percent = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          <ModeIcon className="size-3.5 text-ink-400" aria-hidden="true" />
          {label}
        </span>
        <span className="text-sm font-bold tabular-nums">
          {count} <span className="font-normal text-ink-400">({percent}%)</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}


