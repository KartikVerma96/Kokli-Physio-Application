'use client'

/**
 * ============================================================================
 *  AVAILABILITY MANAGER
 * ============================================================================
 *  Two panels: the repeating weekly hours, and one-off days or hours blocked out.
 *
 *  The weekly rules are grouped by day rather than listed as a flat table, because
 *  "what do I work on a Tuesday?" is the question a clinician actually asks. A flat
 *  list sorted by id answers no useful question at all.
 * ============================================================================
 */

import { useActionState, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Power, CalendarOff, Clock, MapPin, Video } from 'lucide-react'
import {
  addAvailabilityRule, deleteAvailabilityRule, toggleAvailabilityRule,
  addTimeOff, deleteTimeOff,
} from './actions'
import { toast } from '@/lib/toast'
import { formatTime, formatDateLong, todayISO, addDaysISO, cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Field'
import Button from '@/components/ui/Button'

// Index = the weekday number stored in the database, matching JS getDay().
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function AvailabilityManager({
  site, rules, timeOff }) {
  const router = useRouter()

  const [pending, startTransition] = useTransition()
  const [showRuleForm, setShowRuleForm] = useState(rules.length === 0)
  const [showOffForm, setShowOffForm] = useState(false)

  /**
   * WRAPPING THE SERVER ACTION, RATHER THAN WATCHING ITS RESULT IN AN EFFECT
   *
   * The obvious approach is to let useActionState hold the result and then react to
   * it in a useEffect — show a toast, close the form, refresh. It works, but it is
   * the wrong shape: the effect fires on a later render, which means an extra render
   * pass and a subtle bug if two submissions ever return the same object.
   *
   * Wrapping the action instead puts the follow-up exactly where it belongs — in the
   * code path that ran it. `await` the server action, then act on what it returned.
   * Everything happens in one pass, in the obvious order.
   */
  const [ruleState, ruleAction, addingRule] = useActionState(
    async (previousState, formData) => {
      const result = await addAvailabilityRule(previousState, formData)

      if (result.ok) {
        toast.success(result.message)
        setShowRuleForm(false)
        router.refresh()
      } else {
        toast.error(result.error)
      }

      return result
    },
    {}
  )

  const [offState, offAction, addingOff] = useActionState(
    async (previousState, formData) => {
      const result = await addTimeOff(previousState, formData)

      if (result.ok) {
        // A clash needs to be READ, not glanced at, so it stays up much longer.
        if (result.clashes > 0) toast.warning(result.message, { duration: 15000 })
        else toast.success(result.message)
        setShowOffForm(false)
        router.refresh()
      } else {
        toast.error(result.error)
      }

      return result
    },
    {}
  )

  function runAction(action, args, confirmMessage) {
    if (confirmMessage && !window.confirm(confirmMessage)) return
    startTransition(async () => {
      const result = await action(...args)
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
      if (result.ok) router.refresh()
    })
  }

  // Group the rules by weekday so the panel reads like a timetable.
  const byWeekday = WEEKDAYS.map((name, weekday) => ({
    weekday,
    name,
    rules: rules.filter((r) => r.weekday === weekday),
  }))

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* ================================================= the working week */}
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Weekly working hours</h2>
          <Button size="sm" onClick={() => setShowRuleForm((v) => !v)}>
            <Plus className="size-4" aria-hidden="true" />
            Add hours
          </Button>
        </div>

        {/* -------------------------------------------------- the add form */}
        {showRuleForm && (
          <Card className="animate-fade-up p-5">
            <form action={ruleAction} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Day of the week" name="weekday" defaultValue="1" required>
                  {WEEKDAYS.map((name, index) => (
                    <option key={name} value={index}>
                      {name}
                    </option>
                  ))}
                </Select>

                <Select label="Available for" name="mode" defaultValue="both" required>
                  <option value="both">Both clinic and online</option>
                  <option value="clinic">In clinic only</option>
                  <option value="online">Online only</option>
                  {/* A separate kind of window: the therapist is travelling, so
                      these hours cannot also be used for clinic patients. */}
                  <option value="home">Home visits only</option>
                </Select>

                <Input
                  label="From"
                  name="startTime"
                  type="time"
                  defaultValue="09:00"
                  error={ruleState?.errors?.startTime}
                  required
                />
                <Input
                  label="Until"
                  name="endTime"
                  type="time"
                  defaultValue="13:00"
                  error={ruleState?.errors?.endTime}
                  required
                />

                <Select
                  label="Slot spacing"
                  name="slotMinutes"
                  defaultValue="30"
                  hint="How far apart appointment start times are offered"
                >
                  <option value="15">Every 15 minutes</option>
                  <option value="20">Every 20 minutes</option>
                  <option value="30">Every 30 minutes</option>
                  <option value="45">Every 45 minutes</option>
                  <option value="60">Every hour</option>
                </Select>

                <Select
                  label="Patients at a time"
                  name="capacity"
                  defaultValue="1"
                  hint="Beds and machines, not attention"
                >
                  <option value="1">One at a time</option>
                  <option value="2">Two together</option>
                  <option value="3">Three together</option>
                  <option value="4">Four together</option>
                </Select>
              </div>

              <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                <strong>Patients at a time</strong> is how most physiotherapy clinics actually run:
                one patient on a traction table, one under ultrasound, and you doing hands-on work
                with a third. Leave it at one if you treat one person at a time — the diary then
                behaves exactly as it did before.
              </p>

              <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                Add two rules for a split shift — for example 9:00–13:00 and 16:00–20:00. That is how
                most physiotherapy clinics in India actually run, so patients can come before or
                after work.
              </p>

              <div className="flex gap-2">
                <Button type="submit" loading={addingRule}>
                  {addingRule ? 'Adding…' : 'Add these hours'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowRuleForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* ------------------------------------------------ the timetable */}
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {byWeekday.map((day) => (
              <li key={day.weekday} className="p-4">
                <div className="flex items-start gap-4">
                  <p
                    className={cn(
                      'w-24 shrink-0 text-sm font-bold',
                      day.rules.length === 0 && 'text-ink-400'
                    )}
                  >
                    {day.name}
                  </p>

                  <div className="min-w-0 flex-1">
                    {day.rules.length === 0 ? (
                      <p className="text-sm text-ink-400">Closed</p>
                    ) : (
                      <ul className="space-y-2">
                        {day.rules.map((rule) => (
                          <li
                            key={rule.id}
                            className={cn(
                              'flex flex-wrap items-center gap-3 rounded-xl border p-3',
                              rule.is_active
                                ? 'border-ink-200 dark:border-ink-700'
                                : 'border-dashed border-ink-300 opacity-55 dark:border-ink-700'
                            )}
                          >
                            <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
                              <Clock className="size-3.5 text-brand-600" aria-hidden="true" />
                              {formatTime(rule.start_time)} – {formatTime(rule.end_time)}
                            </span>

                            <span className="flex items-center gap-1 rounded-lg bg-ink-100 px-2 py-0.5 text-xs font-medium dark:bg-ink-800">
                              {rule.mode === 'online' ? (
                                <Video className="size-3" aria-hidden="true" />
                              ) : rule.mode === 'clinic' ? (
                                <MapPin className="size-3" aria-hidden="true" />
                              ) : null}
                              {rule.capacity > 1 ? `${rule.capacity} at a time · ` : ''}
                              {rule.mode === 'both'
                                ? 'Clinic & online'
                                : rule.mode === 'online'
                                  ? 'Online only'
                                  : rule.mode === 'home'
                                    ? 'Home visits'
                                    : 'Clinic only'}
                            </span>

                            <span className="text-xs text-ink-500">
                              {rule.slot_minutes} min spacing
                            </span>

                            {!rule.is_active && (
                              <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                                Switched off
                              </span>
                            )}

                            <div className="ml-auto flex gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  runAction(toggleAvailabilityRule, [rule.id, !rule.is_active])
                                }
                                disabled={pending}
                                className="grid size-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:hover:text-brand-300 dark:hover:bg-brand-500/15"
                                aria-label={rule.is_active ? 'Switch these hours off' : 'Switch these hours on'}
                                title={rule.is_active ? 'Switch off temporarily' : 'Switch back on'}
                              >
                                <Power className="size-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  runAction(
                                    deleteAvailabilityRule,
                                    [rule.id],
                                    `Remove ${day.name} ${formatTime(rule.start_time)}–${formatTime(rule.end_time)}?\n\nAppointments already booked in this period are NOT cancelled.`
                                  )
                                }
                                disabled={pending}
                                className="grid size-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                                aria-label="Remove these hours"
                                title="Remove permanently"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* ======================================================== time off */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Time off</h2>
          <Button size="sm" variant="secondary" onClick={() => setShowOffForm((v) => !v)}>
            <Plus className="size-4" aria-hidden="true" />
            Add
          </Button>
        </div>

        {showOffForm && (
          <Card className="animate-fade-up p-5">
            <form action={offAction} className="space-y-4">
              <Input
                label="Date"
                name="offDate"
                type="date"
                min={todayISO()}
                max={addDaysISO(todayISO(), 365)}
                defaultValue={addDaysISO(todayISO(), 1)}
                error={offState?.errors?.offDate}
                required
              />

              <p className="text-xs font-semibold text-ink-600 dark:text-ink-300">
                Leave both times empty to block the whole day
              </p>

              <div className="grid grid-cols-2 gap-3">
                <Input label="From" name="startTime" type="time" error={offState?.errors?.startTime} />
                <Input label="Until" name="endTime" type="time" error={offState?.errors?.endTime} />
              </div>

              <Input
                label="Reason"
                name="reason"
                placeholder="Public holiday, conference, personal"
                error={offState?.errors?.reason}
                hint="Shown to patients as the reason no slots are available"
              />

              <div className="flex gap-2">
                <Button type="submit" loading={addingOff}>
                  {addingOff ? 'Adding…' : 'Block this time'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowOffForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}

        <Card className="overflow-hidden p-0">
          {timeOff.length === 0 ? (
            <div className="p-5 text-center">
              <CalendarOff className="mx-auto size-8 text-ink-300" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold">No time off booked</p>
              <p className="mt-1 text-xs text-ink-500">
                Add holidays and leave here so patients cannot book those slots.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {timeOff.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{formatDateLong(entry.off_date)}</p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {entry.start_time && entry.end_time
                        ? `${formatTime(entry.start_time)} – ${formatTime(entry.end_time)}`
                        : 'All day'}
                      {entry.reason && ` · ${entry.reason}`}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      runAction(
                        deleteTimeOff,
                        [entry.id],
                        `Remove the time off on ${formatDateLong(entry.off_date)}?\n\nThose slots become bookable again.`
                      )
                    }
                    disabled={pending}
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                    aria-label="Remove this time off"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-bold">Booking rules</h3>
          <dl className="mt-3 space-y-2 text-xs">
            {[
              ['Booking window', `${site.booking.maxDaysAhead} days ahead`],
              ['Minimum notice', `${site.booking.minNoticeMinutes} minutes`],
              ['Payment hold', `${site.booking.paymentHoldMinutes} minutes`],
              ['Free cancellation', `${site.booking.freeCancellationHours} hours before`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-ink-500 dark:text-ink-400">{label}</dt>
                <dd className="font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
            These are set in <code className="rounded bg-ink-100 px-1 dark:bg-ink-800">config/site.js</code>{' '}
            under <code className="rounded bg-ink-100 px-1 dark:bg-ink-800">booking</code>.
          </p>
        </Card>
      </div>
    </div>
  )
}
