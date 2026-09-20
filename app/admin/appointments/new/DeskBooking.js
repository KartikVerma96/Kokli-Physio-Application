'use client'

/**
 * ============================================================================
 *  DESK BOOKING
 * ============================================================================
 *  Four steps, in the order reception actually works:
 *
 *      who  →  what  →  when  →  how they are paying
 *
 *  That order is not arbitrary. On the telephone the patient says their name
 *  first, then what is wrong; the times available depend on which treatment
 *  (because treatments differ in length); and how they are paying can only be
 *  offered once you know whether they have a package left. Any other order means
 *  going back and changing an answer.
 *
 *  Slots come from the same /api/slots endpoint the public booking page uses, so
 *  the reception desk and the patient's phone can never disagree about what is
 *  free.
 * ============================================================================
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, UserPlus, Calendar, Check, IndianRupee, Layers, Clock, Loader2, User,
} from 'lucide-react'
import {
  createDeskAppointment, createDeskPatient, searchPatients, packagesForPatient,
} from './actions'
import { Card, Badge } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { formatMoney, formatDateLong } from '@/lib/utils'

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card machine' },
  { value: 'bank_transfer', label: 'Bank transfer' },
]

export default function DeskBooking({ services, allowPayLater, disabled }) {
  const router = useRouter()

  const [patient, setPatient] = useState(null)
  const [serviceId, setServiceId] = useState(services[0] ? String(services[0].id) : '')
  const [mode, setMode] = useState('clinic')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [settlement, setSettlement] = useState(allowPayLater ? 'later' : 'now')
  const [packageId, setPackageId] = useState('')
  const [packages, setPackages] = useState([])
  const [errors, setErrors] = useState({})
  const [booking, startBooking] = useTransition()

  const service = services.find((s) => String(s.id) === String(serviceId))

  /* ------------------------------------------------------------ 1. who */
  async function choosePatient(next) {
    setPatient(next)
    setPackages([])
    setPackageId('')
    if (!next || !serviceId) return

    // What can they spend? Asked as soon as both the patient and the treatment are
    // known, so the payment step can offer the package instead of taking money
    // twice for a session they have already paid for.
    const result = await packagesForPatient(next.id, serviceId)
    setPackages(result.packages || [])
    if (result.packages?.length) {
      setSettlement('package')
      setPackageId(String(result.packages[0].id))
    }
  }

  async function changeService(nextId) {
    setServiceId(nextId)
    setStartTime('')
    if (patient) {
      const result = await packagesForPatient(patient.id, nextId)
      setPackages(result.packages || [])
      setPackageId(result.packages?.length ? String(result.packages[0].id) : '')
      if (!result.packages?.length && settlement === 'package') {
        setSettlement(allowPayLater ? 'later' : 'now')
      }
    }
  }

  /* --------------------------------------------------------- 4. book it */
  function submit(event) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))

    startBooking(async () => {
      const result = await createDeskAppointment(values)
      if (result.ok) {
        toast[result.warning ? 'warning' : 'success'](result.message, { duration: 9000 })
        router.push(`/admin/appointments/${result.appointmentId}`)
        return
      }
      setErrors(result.errors || {})
      toast.error(result.error)
    })
  }

  const chosenPackage = packages.find((p) => String(p.id) === String(packageId))

  return (
    <form onSubmit={submit} className="space-y-5">
      {patient && <input type="hidden" name="patientId" value={patient.id} />}
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="startTime" value={startTime} />
      <input type="hidden" name="settlement" value={settlement} />
      {settlement === 'package' && (
        <input type="hidden" name="patientPackageId" value={packageId} />
      )}

      {/* ═══════════════════════════════════════════════════════ 1. WHO */}
      <PatientStep patient={patient} onChoose={choosePatient} onClear={() => setPatient(null)} />

      {/* ══════════════════════════════════════════════════════ 2. WHAT */}
      {patient && (
        <Card className="p-5">
          <StepHeading number={2} title="What are they coming for?" />

          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Select
              label="Treatment"
              name="serviceId"
              value={serviceId}
              onChange={(e) => changeService(e.target.value)}
              error={errors.serviceId}
              required
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {formatMoney(s.pricePaise)}, {s.durationMinutes} min
                </option>
              ))}
            </Select>

            <Select
              label="Type"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value)
                setStartTime('')
              }}
            >
              <option value="clinic" disabled={service && !service.availableClinic}>
                At the clinic
              </option>
              <option value="online" disabled={service && !service.availableOnline}>
                Online video consultation
              </option>
            </Select>
          </div>
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════ 3. WHEN */}
      {patient && service && (
        <SlotStep
          serviceId={serviceId}
          mode={mode}
          date={date}
          startTime={startTime}
          onDate={(d) => {
            setDate(d)
            setStartTime('')
          }}
          onTime={setStartTime}
          error={errors.startTime}
        />
      )}

      {/* ═══════════════════════════════════════════════════════ 4. MONEY */}
      {patient && service && startTime && (
        <Card className="p-5">
          <StepHeading number={4} title="How are they paying?" />

          <div className="mt-4 space-y-2">
            {packages.length > 0 && (
              <PaymentChoice
                checked={settlement === 'package'}
                onSelect={() => setSettlement('package')}
                icon={Layers}
                title="From their package"
                detail={
                  chosenPackage
                    ? `${chosenPackage.sessionsRemaining} of ${chosenPackage.sessionsTotal} sessions left on ${chosenPackage.name}`
                    : 'Use a prepaid session'
                }
                tone="brand"
              />
            )}

            <PaymentChoice
              checked={settlement === 'now'}
              onSelect={() => setSettlement('now')}
              icon={IndianRupee}
              title="Paying now"
              detail={`Take ${formatMoney(service.pricePaise)} at the desk`}
            />

            {allowPayLater && (
              <PaymentChoice
                checked={settlement === 'later'}
                onSelect={() => setSettlement('later')}
                icon={Clock}
                title="Paying at the clinic"
                detail={`${formatMoney(service.pricePaise)} to collect — the appointment is confirmed either way`}
              />
            )}
          </div>

          {/* Which package, when they have more than one. */}
          {settlement === 'package' && packages.length > 1 && (
            <div className="mt-5">
              <Select
                label="Which package"
                value={packageId}
                onChange={(e) => setPackageId(e.target.value)}
                error={errors.patientPackageId}
                hint="The one expiring soonest is chosen for you"
              >
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.sessionsRemaining} left
                    {p.expiresAt ? `, expires ${formatDateLong(p.expiresAt)}` : ''}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {settlement === 'now' && (
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Select label="Paid by" name="method" defaultValue="cash" error={errors.method} required>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
              <Input
                label="Reference"
                name="reference"
                placeholder="Receipt no. or UPI ref"
                hint="Optional"
              />
            </div>
          )}

          <div className="mt-6">
            <Input
              label="Note"
              name="patientNotes"
              placeholder="Referred by Dr. Rao — lower back, three weeks"
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button type="submit" loading={booking} disabled={disabled}>
              {booking ? 'Booking…' : 'Book the appointment'}
            </Button>
            <p className="text-xs text-ink-500 dark:text-ink-400">
              {patient.name} · {service.name} · {formatDateLong(date)} at {startTime.slice(0, 5)}
            </p>
          </div>
        </Card>
      )}
    </form>
  )
}

/* ========================================================================== */
/*  STEP 1 — FIND OR CREATE THE PATIENT                                       */
/* ========================================================================== */

function PatientStep({ patient, onChoose, onClear }) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState(null)
  const [searching, startSearch] = useTransition()
  const [adding, setAdding] = useState(false)
  const [errors, setErrors] = useState({})
  const [creating, startCreate] = useTransition()

  /**
   * Set when the typed number is already on file for somebody else.
   *
   * In India one mobile number serves a household, so this is usually a family
   * member rather than a duplicate — see the note in createDeskPatient(). Holding
   * the form's values here lets reception answer the question without retyping.
   */
  const [shared, setShared] = useState(null)

  function search(event) {
    event.preventDefault()
    if (term.trim().length < 2) return
    startSearch(async () => {
      const result = await searchPatients(term)
      setResults(result.patients || [])
    })
  }

  function create(event) {
    event.preventDefault()
    submit(Object.fromEntries(new FormData(event.currentTarget)))
  }

  /** `values.allowSharedPhone` is what reception's "someone else" answer sets. */
  function submit(values) {
    startCreate(async () => {
      const result = await createDeskPatient(values)

      if (result.ok) {
        toast[result.existing ? 'warning' : 'success'](result.message)
        onChoose({ id: result.patientId, name: values.name, phone: values.phone })
        setAdding(false)
        setErrors({})
        setShared(null)
        return
      }

      // Not a validation failure — a question only reception can answer.
      if (result.sharedPhone) {
        setShared({ people: result.sharedPhone, values })
        setErrors({})
        return
      }

      setErrors(result.errors || {})
      toast.error(result.error)
    })
  }

  if (patient) {
    return (
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
          <User className="size-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{patient.name}</p>
          <p className="truncate text-xs text-ink-500 dark:text-ink-400">
            {patient.phone || 'no phone on file'}
            {patient.visits > 0 && ` · ${patient.visits} previous visit${patient.visits === 1 ? '' : 's'}`}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClear} type="button">
          Change
        </Button>
      </Card>
    )
  }

  return (
    <Card className="p-5">
      <StepHeading number={1} title="Who is it for?" />

      {/* Two nested forms would be invalid HTML, so the search is a div with a
          keydown handler rather than a <form>. */}
      <div className="mt-4 flex gap-2">
        <div className="flex-1">
          <Input
            label="Search your patients"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                search(e)
              }
            }}
            placeholder="Name, phone or email"
            icon={<Search className="size-4" />}
            hint="Reception usually has a surname, or the last four digits of a phone number"
          />
        </div>
        <div className="pt-7">
          <Button type="button" onClick={search} loading={searching} variant="secondary">
            {searching ? '' : 'Search'}
          </Button>
        </div>
      </div>

      {results !== null && (
        <div className="mt-4">
          {results.length === 0 ? (
            <p className="rounded-xl bg-ink-50 p-4 text-sm text-ink-600 dark:bg-ink-800/60 dark:text-ink-300">
              Nobody matching “{term}”. They are probably new — add them below.
            </p>
          ) : (
            <ul className="divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-200 dark:divide-ink-800 dark:border-ink-700">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onChoose(p)}
                    className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-ink-50 dark:hover:bg-ink-800/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-ink-500">
                        {p.phone || p.email || 'no contact details'}
                      </span>
                    </span>
                    {p.visits > 0 && <Badge tone="neutral">{p.visits} visits</Badge>}
                    <Check className="size-4 shrink-0 text-ink-300" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ------------------------------------------------- a new patient */}
      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-400"
        >
          <UserPlus className="size-4" aria-hidden="true" />
          New patient
        </button>
      ) : (
        <form onSubmit={create} className="mt-5 space-y-4 rounded-2xl border border-ink-200 p-4 dark:border-ink-700">
          <p className="text-sm font-bold">New patient</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Full name" name="name" error={errors.name} required />
            <Input
              label="Phone"
              name="phone"
              type="tel"
              inputMode="tel"
              error={errors.phone}
              required
            />
            <Input
              label="Email"
              name="email"
              type="email"
              error={errors.email}
              hint="Optional"
            />
          </div>
          <p className="text-xs text-ink-500 dark:text-ink-400">
            No email is fine — they can still sign in with a WhatsApp code sent to this number.
          </p>

          {/* --------------------------------- this number is already on file */}
          {shared && (
            <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
              <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                {shared.people.length === 1
                  ? `${shared.people[0].name} already uses this number.`
                  : `${shared.people.map((p) => p.name).join(', ')} already use this number.`}
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-200">
                One number often covers a whole family. Is this the same person, or somebody else in
                the household?
              </p>
              <div className="flex flex-wrap gap-2">
                {shared.people.map((person) => (
                  <Button
                    key={person.id}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      onChoose({ id: person.id, name: person.name, phone: shared.values.phone })
                      setAdding(false)
                      setShared(null)
                    }}
                  >
                    Use {person.name}&apos;s record
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  loading={creating}
                  onClick={() => submit({ ...shared.values, allowSharedPhone: true })}
                >
                  No — add {shared.values.name || 'a new patient'} separately
                </Button>
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                A separate record keeps their clinical notes, exercises and progress their own. They
                will share the number for reminders and sign-in.
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <Button type="submit" size="sm" loading={creating}>
              {creating ? 'Adding…' : 'Add and continue'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}

/* ========================================================================== */
/*  STEP 3 — THE SLOT                                                         */
/* ========================================================================== */

function SlotStep({ serviceId, mode, date, startTime, onDate, onTime, error }) {
  const [days, setDays] = useState(null)
  const [slots, setSlots] = useState(null)
  const [loading, setLoading] = useState(false)

  // Loaded on demand rather than in an effect: the button press IS the intent, and
  // an effect here would refetch on every unrelated re-render.
  async function loadDays() {
    setLoading(true)
    try {
      const res = await fetch(`/api/slots?days=21&mode=${mode}`)
      const data = await res.json()
      setDays(data.dates || [])
    } finally {
      setLoading(false)
    }
  }

  async function pickDate(iso) {
    onDate(iso)
    setSlots(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/slots?serviceId=${serviceId}&date=${iso}&mode=${mode}`)
      const data = await res.json()
      setSlots(data.slots || [])
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="p-5">
      <StepHeading number={3} title="When?" />

      {days === null ? (
        <Button type="button" className="mt-4" variant="secondary" onClick={loadDays} loading={loading}>
          <Calendar className="size-4" aria-hidden="true" />
          Show available times
        </Button>
      ) : (
        <>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
            {days.filter((d) => d.isOpen).length === 0 && (
              <p className="text-sm text-ink-500">
                Nothing open in the next three weeks. Check Availability.
              </p>
            )}
            {days
              .filter((d) => d.isOpen)
              .map((d) => (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => pickDate(d.date)}
                  className={`shrink-0 rounded-xl border px-3 py-2 text-center text-xs transition-colors ${
                    date === d.date
                      ? 'border-brand-500 bg-brand-50 font-bold text-brand-800 dark:bg-brand-950/60 dark:text-brand-200'
                      : 'border-ink-200 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800/60'
                  }`}
                >
                  {/* /api/slots returns only { date, isOpen, isToday }, so the
                      human labels are derived here rather than adding fields to an
                      endpoint the public booking page also uses. */}
                  <span className="block font-semibold">
                    {d.isToday ? 'Today' : weekdayShort(d.date)}
                  </span>
                  <span className="block text-[11px] text-ink-500">{dayAndMonth(d.date)}</span>
                </button>
              ))}
          </div>

          {loading && (
            <p className="mt-3 flex items-center gap-2 text-sm text-ink-500">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Looking…
            </p>
          )}

          {slots !== null && !loading && (
            <div className="mt-4">
              {slots.length === 0 ? (
                <p className="text-sm text-ink-500">
                  Nothing free that day — try another.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {slots.map((s) => (
                    <button
                      key={s.startTime}
                      type="button"
                      onClick={() => onTime(s.startTime)}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                        startTime === s.startTime
                          ? 'border-brand-500 bg-brand-600 text-white'
                          : 'border-ink-200 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800/60'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </Card>
  )
}

/* ========================================================================== */
/*  SMALL PIECES                                                              */
/* ========================================================================== */

/** 'Mon' from '2026-08-03'. Parsed as a local date, not UTC — see below. */
function weekdayShort(iso) {
  return partsOf(iso).toLocaleDateString('en-IN', { weekday: 'short' })
}

/** '3 Aug'. */
function dayAndMonth(iso) {
  return partsOf(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/**
 * Build a Date from a plain ISO date without timezone surprises.
 *
 * `new Date('2026-08-03')` is parsed as UTC MIDNIGHT, which in India (UTC+5:30)
 * is still 2026-08-03 — but west of Greenwich it is the 2nd, and the chip would
 * show the wrong weekday. Passing the parts separately builds a LOCAL date, which
 * is what a clinic diary means by a day.
 */
function partsOf(iso) {
  const [year, month, day] = String(iso).slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day)
}

function StepHeading({ number, title }) {
  return (
    <h2 className="flex items-center gap-2.5 font-bold">
      <span className="grid size-6 place-items-center rounded-full bg-ink-900 text-[11px] text-white dark:bg-white dark:text-ink-900">
        {number}
      </span>
      {title}
    </h2>
  )
}

function PaymentChoice({ checked, onSelect, icon: Icon, title, detail, tone }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={checked}
      className={`flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors ${
        checked
          ? tone === 'brand'
            ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/50'
            : 'border-ink-900 bg-ink-50 dark:border-white dark:bg-ink-800/60'
          : 'border-ink-200 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800/60'
      }`}
    >
      <Icon
        className={`mt-0.5 size-4 shrink-0 ${checked ? 'text-brand-600 dark:text-brand-300' : 'text-ink-400'}`}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-ink-500 dark:text-ink-400">{detail}</span>
      </span>
      {checked && <Check className="ml-auto mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />}
    </button>
  )
}
