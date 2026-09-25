'use client'

/**
 * ============================================================================
 *  BOOKING SUMMARY — the sticky panel beside the wizard
 * ============================================================================
 *  Reads the whole booking from the store and shows what has been chosen so far.
 *
 *  This component is the clearest illustration of why the wizard uses Redux. It
 *  needs every field — service, mode, date, time, price — yet it is a sibling of
 *  the components that set them, not a child. With props alone, the wizard would
 *  have to hold all the state and thread it down two branches of the tree. Here
 *  it simply subscribes to the store and takes what it needs, and could be moved
 *  anywhere in the layout without touching a single other file.
 * ============================================================================
 */

import { useSelector } from 'react-redux'
import { Calendar, Clock, MapPin, Video, IndianRupee, ShieldCheck, CircleDashed } from 'lucide-react'
import { selectBooking } from '@/store/slices/bookingSlice'
import { formatMoney, formatDateLong, formatTime } from '@/lib/utils'
import { doctorLine, shortAddress } from '@/lib/clinicView'
import Icon from '@/components/ui/Icon'

export default function BookingSummary({ site }) {
  const { service, mode, date, startTime } = useSelector(selectBooking)

  return (
    // Sticky so the running total and the appointment details stay visible while
    // the patient scrolls a long list of slots. On mobile it sits below the
    // wizard, where sticky positioning would just get in the way.
    <div className="lg:sticky lg:top-28">
      <div className="card overflow-hidden">
        <div className="border-b border-ink-100 bg-linear-to-br from-brand-50 to-white p-5 dark:border-ink-800 dark:from-brand-950/40 dark:to-ink-900">
          <h2 className="font-bold">Your appointment</h2>
          <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
            With {doctorLine(site)}
          </p>
        </div>

        <div className="space-y-4 p-5">
          {/* ------------------------------------------------- treatment */}
          <SummaryRow
            icon={service ? null : CircleDashed}
            customIcon={
              service ? <Icon name={service.icon} className="size-4" /> : null
            }
            label="Treatment"
            value={service?.name}
            secondary={service ? `${service.duration_minutes} minute session` : null}
          />

          {/* ------------------------------------------------------ mode */}
          <SummaryRow
            icon={mode === 'online' ? Video : MapPin}
            label="Where"
            value={mode === 'online' ? 'Online video call' : 'At the clinic'}
            secondary={
              mode === 'online'
                ? 'Link appears in your dashboard'
                : shortAddress(site)
            }
          />

          {/* ------------------------------------------------------ date */}
          <SummaryRow icon={Calendar} label="Date" value={date ? formatDateLong(date) : null} />

          {/* ------------------------------------------------------ time */}
          <SummaryRow
            icon={Clock}
            label="Time"
            value={startTime ? formatTime(startTime) : null}
            secondary={startTime ? `${site.address.city} local time` : null}
          />
        </div>

        {/* ---------------------------------------------------------- total */}
        <div className="border-t border-ink-100 p-5 dark:border-ink-800">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <IndianRupee className="size-3.5 text-ink-400" aria-hidden="true" />
              Total
            </span>
            <span className="font-display text-2xl font-bold tabular-nums">
              {service ? formatMoney(service.price_paise) : '—'}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-400">
            One session. Includes assessment and a home exercise plan.
          </p>
        </div>
      </div>

      {/* --------------------------------------------------- reassurances */}
      <ul className="mt-4 space-y-2.5 rounded-2xl border border-ink-200 p-4 text-xs text-ink-600 dark:border-ink-700 dark:text-ink-400">
        {[
          `Free cancellation up to ${site.booking.freeCancellationHours} hours before`,
          'GST invoice emailed for insurance claims',
          'No referral needed',
          `Slot held for ${site.booking.paymentHoldMinutes} minutes while you pay`,
        ].map((point) => (
          <li key={point} className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden="true" />
            {point}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * One line of the summary.
 *
 * Note that an unset value renders a dash rather than disappearing. Keeping the
 * row in place means the panel does not grow and shift as the patient works
 * through the steps — the layout is stable from the first render, which is both
 * calmer to use and better for Cumulative Layout Shift.
 */
function SummaryRow({ icon: RowIcon, customIcon, label, value, secondary }) {
  const isSet = Boolean(value)

  return (
    <div className="flex items-start gap-3">
      <span
        className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl transition-colors ${
          isSet
            ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300'
            : 'bg-ink-100 text-ink-300 dark:bg-ink-800 dark:text-ink-600'
        }`}
      >
        {customIcon || (RowIcon && <RowIcon className="size-4" aria-hidden="true" />)}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">{label}</p>
        <p
          className={`mt-0.5 text-sm font-semibold ${
            isSet ? '' : 'text-ink-300 dark:text-ink-600'
          }`}
        >
          {value || 'Not chosen yet'}
        </p>
        {secondary && isSet && (
          <p className="mt-0.5 text-xs leading-snug text-ink-500 dark:text-ink-400">{secondary}</p>
        )}
      </div>
    </div>
  )
}
