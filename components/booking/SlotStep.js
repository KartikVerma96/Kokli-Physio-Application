'use client'

/**
 * ============================================================================
 *  STEP 2 — pick a date, then a time
 * ============================================================================
 *  A horizontal strip of dates, and below it the free slots for whichever date
 *  is selected.
 *
 *  The availability itself is calculated entirely on the server (lib/slots.js)
 *  and fetched from /api/slots. That is not an arbitrary split: only the server
 *  can see which slots are already booked, and only the server can be trusted.
 *  If this component decided what was available, a patient could edit the
 *  JavaScript and "create" a slot at 3am.
 * ============================================================================
 */

import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { CalendarX2, Loader2, Sun, Sunset, Moon } from 'lucide-react'
import { fetchSlots, setDate, setStartTime, selectBooking } from '@/store/slices/bookingSlice'
import { cn, formatDateRelative, toMinutes } from '@/lib/utils'

export default function SlotStep({ site, dates }) {
  const dispatch = useDispatch()
  const { serviceId, service, mode, date, startTime, slots, slotsStatus, slotsError } =
    useSelector(selectBooking)

  /* ------------------------------------------------ default to the first day */
  // Rather than showing an empty calendar, land on the first day that is open.
  useEffect(() => {
    if (date) return
    const firstOpen = dates.find((d) => d.isOpen)
    if (firstOpen) dispatch(setDate(firstOpen.date))
  }, [date, dates, dispatch])

  /* ----------------------------------------------------------- load the slots */
  useEffect(() => {
    // slotsStatus === 'idle' is the signal that something invalidated the list —
    // the date, mode or service changed. The reducers set it back to 'idle'
    // whenever that happens, which keeps the refetch logic in one place instead
    // of scattered across three effects.
    if (serviceId && date && slotsStatus === 'idle') {
      dispatch(fetchSlots({ serviceId, date, mode }))
    }
  }, [serviceId, date, mode, slotsStatus, dispatch])

  // Group the slots by part of the day. A patient thinks "can I come after
  // work?", not "is 17:30 free?", so morning / afternoon / evening headings match
  // how people actually choose — and it breaks a wall of thirty buttons into
  // something scannable.
  const groups = groupByTimeOfDay(slots)

  return (
    <div>
      <h2 className="text-xl font-bold">When suits you?</h2>
      <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-400">
        Live availability for the next {site.booking.maxDaysAhead} days
        {service && ` · ${service.duration_minutes} minute session`}
        {mode === 'online' ? ' · online video' : ' · at the clinic'}
      </p>

      {/* ==================================================== the date strip */}
      {/* Horizontally scrollable on mobile. `snap-x` makes it come to rest on a
          whole date rather than halfway across one. */}
      <div
        className="mt-6 -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-3"
        role="group"
        aria-label="Choose a date"
      >
        {dates.map((day) => {
          const isSelected = date === day.date

          return (
            <button
              key={day.date}
              type="button"
              onClick={() => dispatch(setDate(day.date))}
              disabled={!day.isOpen}
              aria-pressed={isSelected}
              className={cn(
                'flex min-w-[4.5rem] shrink-0 snap-start flex-col items-center gap-0.5 rounded-2xl border-2 px-3 py-3 transition-all',
                isSelected && 'border-brand-500 bg-brand-600 text-white shadow-brand',
                !isSelected && day.isOpen &&
                  'border-ink-200 hover:border-brand-300 hover:bg-brand-50/50 dark:border-ink-700 dark:hover:bg-brand-950/30',
                !day.isOpen && 'cursor-not-allowed border-ink-100 opacity-40 dark:border-ink-800'
              )}
            >
              <span className={cn('text-[10px] font-bold uppercase tracking-wider', isSelected ? 'text-brand-100' : 'text-ink-400')}>
                {weekdayLabel(day.date)}
              </span>
              <span className="text-lg font-bold tabular-nums leading-tight">
                {Number(day.date.slice(8, 10))}
              </span>
              <span className={cn('text-[10px] font-medium', isSelected ? 'text-brand-100' : 'text-ink-400')}>
                {day.isToday ? 'Today' : monthLabel(day.date)}
              </span>
            </button>
          )
        })}
      </div>

      {/* ======================================================== the slots */}
      <div className="mt-6 min-h-[16rem]">
        {slotsStatus === 'loading' && <SlotsSkeleton />}

        {slotsStatus === 'failed' && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <p className="font-semibold">Could not load available times</p>
            <p className="mt-1">{slotsError}</p>
            <button
              type="button"
              onClick={() => dispatch(fetchSlots({ serviceId, date, mode }))}
              className="mt-3 font-semibold underline"
            >
              Try again
            </button>
          </div>
        )}

        {slotsStatus === 'succeeded' && slots.length === 0 && (
          // An empty state that explains itself. `reason` comes from the slot
          // engine, so it says "Dr. Verma is on leave" or "Fully booked on this
          // day" rather than leaving the patient guessing.
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-300 py-14 text-center dark:border-ink-700">
            <CalendarX2 className="size-8 text-ink-300" aria-hidden="true" />
            <p className="mt-3 font-semibold">No slots on {formatDateRelative(date)}</p>
            <p className="mt-1 max-w-xs text-sm text-ink-500 dark:text-ink-400">
              {slotsError || 'Try another date from the strip above.'}
            </p>
          </div>
        )}

        {slotsStatus === 'succeeded' && slots.length > 0 && (
          <div className="space-y-6 animate-fade-in">
            {groups.map((group) =>
              group.slots.length === 0 ? null : (
                <fieldset key={group.label}>
                  <legend className="flex items-center gap-2 text-sm font-bold text-ink-700 dark:text-ink-200">
                    <group.icon className="size-4 text-brand-600" aria-hidden="true" />
                    {group.label}
                    <span className="font-normal text-ink-400">
                      · {group.slots.length} available
                    </span>
                  </legend>

                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                    {group.slots.map((slot) => {
                      const isSelected = startTime === slot.startTime
                      return (
                        <button
                          key={slot.startTime}
                          type="button"
                          onClick={() => dispatch(setStartTime(slot.startTime))}
                          aria-pressed={isSelected}
                          className={cn(
                            'rounded-xl border-2 px-2 py-2.5 text-sm font-semibold tabular-nums transition-all',
                            isSelected
                              ? 'border-brand-500 bg-brand-600 text-white shadow-brand'
                              : 'border-ink-200 hover:-translate-y-0.5 hover:border-brand-400 hover:text-brand-700 dark:border-ink-700 dark:hover:border-brand-600 dark:hover:text-brand-300'
                          )}
                        >
                          {slot.label}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
              )
            )}

            <p className="text-xs text-ink-400">
              All times are {site.address.city} local time. Slots need at least{' '}
              {site.booking.minNoticeMinutes} minutes notice.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  HELPERS                                                                   */
/* -------------------------------------------------------------------------- */

function groupByTimeOfDay(slots) {
  return [
    { label: 'Morning', icon: Sun, slots: slots.filter((s) => toMinutes(s.startTime) < 12 * 60) },
    {
      label: 'Afternoon',
      icon: Sunset,
      slots: slots.filter((s) => {
        const m = toMinutes(s.startTime)
        return m >= 12 * 60 && m < 17 * 60
      }),
    },
    { label: 'Evening', icon: Moon, slots: slots.filter((s) => toMinutes(s.startTime) >= 17 * 60) },
  ]
}

// Both of these build the Date with Date.UTC and read it back in UTC, so a
// browser in another timezone can never shift the calendar date by a day.
function weekdayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short',
    timeZone: 'UTC',
  })
}

function monthLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    month: 'short',
    timeZone: 'UTC',
  })
}

/**
 * The loading placeholder.
 *
 * It deliberately occupies roughly the same space as the real slot grid. A
 * spinner that collapses to nothing makes the page jump when the content
 * arrives, and that jump is exactly what Google's Cumulative Layout Shift metric
 * penalises.
 */
function SlotsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading available times">
      {[8, 10].map((count, groupIndex) => (
        <div key={groupIndex}>
          <div className="skeleton h-4 w-28" />
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="skeleton h-11" />
            ))}
          </div>
        </div>
      ))}
      <p className="flex items-center gap-2 text-sm text-ink-400">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Checking availability…
      </p>
    </div>
  )
}
