import Link from 'next/link'
import { CalendarDays, Search, Video, MapPin, FileText, Phone, Plus } from 'lucide-react'
import { getAdminAppointments } from '@/lib/queries'
import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import { releaseExpiredHolds } from '@/lib/slots'
import {
  formatMoney, formatTime, formatDateShort, statusMeta, todayISO, addDaysISO,
} from '@/lib/utils'
import { Card, Badge, EmptyState } from '@/components/ui/Card'
import Icon from '@/components/ui/Icon'
import Button from '@/components/ui/Button'

/**
 * ============================================================================
 *  ALL APPOINTMENTS  →  /admin/appointments
 * ============================================================================
 *  Filtered by status, date and free-text search.
 *
 *  THE FILTERS LIVE IN THE URL, NOT IN REACT STATE
 *  ----------------------------------------------
 *  /admin/appointments?status=confirmed&from=2026-08-01
 *
 *  That choice buys several things for free:
 *
 *    - a filtered view can be bookmarked, and shared with a colleague
 *    - the browser back button steps back through filters, as users expect
 *    - the whole page stays a Server Component, so filtering happens in SQL
 *      rather than by shipping every appointment to the browser and hiding some
 *
 *  Client-side filtering would mean sending the entire appointment history to the
 *  browser — slower, and it puts patient data on the client that the user is not
 *  even looking at.
 * ============================================================================
 */

export const dynamic = 'force-dynamic'

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'pending_payment', label: 'Awaiting payment' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no_show', label: 'No show' },
]

const DATE_FILTERS = [
  { key: '', label: 'Any date' },
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'week', label: 'Next 7 days' },
  { key: 'past', label: 'Past' },
]

export default async function AdminAppointmentsPage({ searchParams }) {
  const params = await searchParams
  await releaseExpiredHolds()

  const status = typeof params?.status === 'string' ? params.status : ''
  const range = typeof params?.range === 'string' ? params.range : ''
  const date = typeof params?.date === 'string' ? params.date : ''
  const search = typeof params?.q === 'string' ? params.q.trim() : ''

  // Translate the friendly range keys into the from/to the query understands.
  const today = todayISO()
  const filters = { status, search, date }
  if (!date) {
    if (range === 'today') filters.date = today
    else if (range === 'upcoming') filters.from = today
    else if (range === 'week') { filters.from = today; filters.to = addDaysISO(today, 7) }
    else if (range === 'past') filters.to = addDaysISO(today, -1)
  }

  const clinic = await requireCurrentClinic()
  const appointments = await getAdminAppointments(clinic.id, filters)

  const buildUrl = (overrides) => {
    const next = new URLSearchParams()
    const merged = { status, range, date, q: search, ...overrides }
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, value)
    }
    const qs = next.toString()
    return `/admin/appointments${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl">Appointments</h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            {appointments.length} shown
            {status && ` · ${statusMeta(status).label.toLowerCase()}`}
            {search && ` · matching “${search}”`}
          </p>
        </div>
        {/* The most-used button in the clinic: most patients telephone rather than
            book online, so reception starts here many times a day. */}
        <Button href="/admin/appointments/new" size="sm">
          <Plus className="size-4" aria-hidden="true" />
          New appointment
        </Button>
      </div>

      {/* ------------------------------------------------------------ search */}
      {/*
        A plain HTML <form method="get">. No JavaScript at all: submitting it puts
        ?q=... in the URL and the server re-renders. This is the platform doing the
        work, and it is genuinely less code than a controlled input with a debounce.
      */}
      <Card className="p-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          {/* Hidden fields carry the other filters through, so searching does not
              silently reset the status filter. */}
          {status && <input type="hidden" name="status" value={status} />}
          {range && <input type="hidden" name="range" value={range} />}

          <div className="min-w-0 flex-1">
            <label htmlFor="q" className="mb-1.5 block text-xs font-semibold text-ink-600 dark:text-ink-300">
              Search by patient, email, phone or booking code
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-400"
                aria-hidden="true"
              />
              <input
                id="q"
                name="q"
                defaultValue={search}
                placeholder="Rohan, APT-7K3M9Q, 98765…"
                className="h-11 w-full rounded-xl border border-ink-200 bg-white pl-11 pr-4 text-sm focus:border-brand-500 focus:outline-none dark:border-ink-700 dark:bg-ink-900"
              />
            </div>
          </div>

          <button
            type="submit"
            className="h-11 shrink-0 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Search
          </button>

          {(search || status || range) && (
            <Link
              href="/admin/appointments"
              className="h-11 shrink-0 rounded-xl px-4 text-sm font-semibold leading-[2.75rem] text-ink-500 transition-colors hover:bg-ink-100 dark:hover:bg-ink-800"
            >
              Clear
            </Link>
          )}
        </form>
      </Card>

      {/* ----------------------------------------------------------- filters */}
      <div className="space-y-3">
        <FilterRow
          label="Status"
          options={STATUS_FILTERS.map((f) => ({
            ...f,
            href: buildUrl({ status: f.value }),
            active: status === f.value,
          }))}
        />
        <FilterRow
          label="When"
          options={DATE_FILTERS.map((f) => ({
            ...f,
            value: f.key,
            href: buildUrl({ range: f.key, date: '' }),
            active: range === f.key && !date,
          }))}
        />
      </div>

      {/* -------------------------------------------------------- the table */}
      <Card className="overflow-hidden p-0">
        {appointments.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="size-6" />}
            title="No appointments match"
            description="Try clearing the filters, or widening the date range."
          />
        ) : (
          // overflow-x-auto on the wrapper is what stops a wide table breaking the
          // page layout on a phone. The table scrolls inside its own box.
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50/60 text-left dark:border-ink-800 dark:bg-ink-800/40">
                <tr>
                  <Th>When</Th>
                  <Th>Patient</Th>
                  <Th>Treatment</Th>
                  <Th>Mode</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {appointments.map((appointment) => {
                  const meta = statusMeta(appointment.status)
                  const isOnline = appointment.mode === 'online'

                  return (
                    <tr
                      key={appointment.id}
                      className="transition-colors hover:bg-ink-50/60 dark:hover:bg-ink-800/40"
                    >
                      <Td>
                        <p className="font-semibold">
                          {formatDateShort(appointment.appointment_date)}
                        </p>
                        <p className="text-xs text-ink-500 tabular-nums">
                          {formatTime(appointment.start_time)}
                        </p>
                      </Td>

                      <Td>
                        <Link
                          href={`/admin/patients/${appointment.patient_id}`}
                          className="font-semibold hover:text-brand-700 hover:underline dark:hover:text-brand-300"
                        >
                          {appointment.patient_name}
                        </Link>
                        <p className="text-xs text-ink-500">{appointment.patient_email}</p>
                      </Td>

                      <Td>
                        <span className="flex items-center gap-2">
                          <Icon
                            name={appointment.service_icon}
                            className="size-3.5 shrink-0 text-brand-600"
                          />
                          <span className="truncate">{appointment.service_name}</span>
                        </span>
                        <p className="mt-0.5 font-mono text-[11px] text-ink-400">
                          {appointment.code}
                        </p>
                      </Td>

                      <Td>
                        <span className="flex items-center gap-1.5 text-xs">
                          {isOnline ? (
                            <Video className="size-3.5 text-brand-600" aria-hidden="true" />
                          ) : (
                            <MapPin className="size-3.5 text-ink-400" aria-hidden="true" />
                          )}
                          {isOnline ? 'Online' : 'Clinic'}
                        </span>
                      </Td>

                      <Td>
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                          {appointment.payment_status === 'paid' && (
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
                              Paid
                            </span>
                          )}
                        </div>
                      </Td>

                      <Td className="text-right font-semibold tabular-nums">
                        {formatMoney(appointment.amount_paise)}
                      </Td>

                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          {appointment.patient_phone && (
                            <a
                              href={`tel:${appointment.patient_phone.replace(/\s/g, '')}`}
                              className="grid size-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-brand-700 dark:hover:text-brand-300 dark:hover:bg-ink-700"
                              aria-label="Call patient"
                              title={appointment.patient_phone}
                            >
                              <Phone className="size-3.5" />
                            </a>
                          )}
                          {isOnline && ['confirmed', 'in_progress'].includes(appointment.status) && (
                            <Link
                              href={`/consult/${appointment.id}`}
                              className="grid size-8 place-items-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700"
                              aria-label="Join call"
                              title="Join video consultation"
                            >
                              <Video className="size-3.5" />
                            </Link>
                          )}
                          <Link
                            href={`/admin/appointments/${appointment.id}`}
                            className={`grid size-8 place-items-center rounded-lg transition-colors ${
                              appointment.has_notes
                                ? 'text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950'
                                : 'text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-700'
                            }`}
                            aria-label="Open appointment"
                            title={appointment.has_notes ? 'Notes written' : 'Write notes'}
                          >
                            <FileText className="size-3.5" />
                          </Link>
                        </div>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  SMALL PIECES                                                              */
/* -------------------------------------------------------------------------- */

function FilterRow({ label, options }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-bold uppercase tracking-wider text-ink-400">{label}</span>
      {options.map((option) => (
        <Link
          key={option.value ?? option.key}
          href={option.href}
          // aria-current tells a screen reader which filter is applied. Relying on
          // colour alone would leave that invisible.
          aria-current={option.active ? 'true' : undefined}
          className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${
            option.active
              ? 'bg-ink-900 text-white dark:bg-white dark:text-ink-900'
              : 'bg-white text-ink-600 hover:bg-ink-100 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700'
          }`}
        >
          {option.label}
        </Link>
      ))}
    </div>
  )
}

function Th({ children, className = '' }) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-xs font-bold uppercase tracking-wider text-ink-500 ${className}`}
    >
      {children}
    </th>
  )
}

function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>
}
