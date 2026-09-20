import Link from 'next/link'
import { Video, MapPin, ChevronRight, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/Card'
import Icon from '@/components/ui/Icon'
import {
  formatMoney, formatDateShort, formatTime, statusMeta, canJoinCall,
} from '@/lib/utils'

/**
 * ============================================================================
 *  ONE ROW IN AN APPOINTMENT LIST
 * ============================================================================
 *  Used on the dashboard overview and on the full appointments page, so both look
 *  identical and only need fixing once.
 *
 *  A Server Component — there is nothing interactive here beyond a link, so it
 *  ships no JavaScript at all. Worth noticing: a list of twenty of these adds
 *  nothing to the bundle. If this were a Client Component "just in case", every
 *  patient would download the code for it on every visit.
 * ============================================================================
 */

export default function AppointmentRow({ appointment }) {
  const meta = statusMeta(appointment.status)
  const isOnline = appointment.mode === 'online'
  const joinable = canJoinCall(appointment)

  return (
    <li>
      <Link
        href={`/dashboard/appointments/${appointment.id}`}
        className="flex items-center gap-4 p-4 transition-colors hover:bg-ink-50 dark:hover:bg-ink-800/50"
      >
        {/* ----------------------------------------------------- the date */}
        {/* A small calendar-page block. Far quicker to scan down a column of
            these than to read "Sat, 21 Mar" fifteen times. */}
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-ink-100 text-center dark:bg-ink-800">
          <div>
            <p className="text-[10px] font-bold uppercase leading-none text-ink-500">
              {formatDateShort(appointment.appointment_date).split(',')[0]}
            </p>
            <p className="text-base font-bold leading-tight">
              {Number(String(appointment.appointment_date).slice(8, 10))}
            </p>
          </div>
        </div>

        {/* --------------------------------------------------- the details */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon name={appointment.service_icon} className="size-3.5 shrink-0 text-brand-600" />
            <p className="truncate text-sm font-bold">{appointment.service_name}</p>
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500 dark:text-ink-400">
            <span>{formatTime(appointment.start_time)}</span>
            <span className="flex items-center gap-1">
              {isOnline ? (
                <Video className="size-3" aria-hidden="true" />
              ) : (
                <MapPin className="size-3" aria-hidden="true" />
              )}
              {isOnline ? 'Online' : 'Clinic'}
            </span>
            <span className="font-mono">{appointment.code}</span>
            {Boolean(appointment.has_notes) && (
              <span className="flex items-center gap-1 text-brand-600 dark:text-brand-400">
                <FileText className="size-3" aria-hidden="true" />
                Notes ready
              </span>
            )}
          </p>
        </div>

        {/* ---------------------------------------------- status and price */}
        <div className="hidden shrink-0 text-right sm:block">
          <p className="text-sm font-bold tabular-nums">{formatMoney(appointment.amount_paise)}</p>
          <div className="mt-1 flex justify-end">
            {joinable ? (
              <Badge tone="success" dot>
                Join now
              </Badge>
            ) : (
              <Badge tone={meta.tone}>{meta.label}</Badge>
            )}
          </div>
        </div>

        <ChevronRight className="size-4 shrink-0 text-ink-300" aria-hidden="true" />
      </Link>
    </li>
  )
}
