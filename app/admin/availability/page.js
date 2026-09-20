import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import { Clock, Info } from 'lucide-react'
import { getAvailabilityRules, getUpcomingTimeOff } from '@/lib/queries'
import { getDefaultPhysioId } from '@/lib/slots'
import { Card } from '@/components/ui/Card'
import AvailabilityManager from './AvailabilityManager'

/**
 * ============================================================================
 *  AVAILABILITY  →  /admin/availability
 * ============================================================================
 *  Where the clinic's working week is defined. Everything patients can book comes
 *  from here.
 *
 *  A REMINDER OF HOW THIS WORKS, BECAUSE IT IS THE CLEVEREST PART OF THE APP
 *  ------------------------------------------------------------------------
 *  There is no table of bookable slots. The rules below say "Tuesdays, 9am to 1pm,
 *  in 30 minute steps", and lib/slots.js generates the actual slots on demand for
 *  whichever date a patient is looking at, then subtracts anything already booked
 *  and anything blocked by leave.
 *
 *  So availability extends infinitely into the future from a dozen rows, and
 *  changing the working week is one insert — not a regeneration job.
 * ============================================================================
 */

export const dynamic = 'force-dynamic'

export default async function AvailabilityPage() {
  const clinic = await requireCurrentClinic()
  const site = clinicView(clinic)
  const physioId = await getDefaultPhysioId(clinic.id)

  const [rules, timeOff] = await Promise.all([
    physioId ? getAvailabilityRules(clinic.id, physioId) : [],
    physioId ? getUpcomingTimeOff(clinic.id, physioId) : [],
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Availability</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          The working week, and any days off. This is what decides which slots patients can book.
        </p>
      </div>

      {/* An explanation in the interface itself, because the rules-not-slots model
          is genuinely surprising the first time you meet it. */}
      <Card className="flex items-start gap-3 p-5">
        <Info className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden="true" />
        <div className="text-sm leading-relaxed text-ink-600 dark:text-ink-400">
          <p className="font-bold text-ink-900 dark:text-ink-100">How this works</p>
          <p className="mt-1">
            You set repeating weekly hours, and the booking page works out the individual slots from
            them — for every date, indefinitely. A {site.booking.maxDaysAhead}-day booking window
            applies, and a slot needs at least {site.booking.minNoticeMinutes} minutes notice.
          </p>
          <p className="mt-2">
            Removing hours or adding time off only stops NEW bookings. Appointments already in the
            diary stay exactly where they are — you will be told about any that clash so you can ring
            those patients yourself.
          </p>
        </div>
      </Card>

      <AvailabilityManager
        site={site} rules={rules} timeOff={timeOff} />
    </div>
  )
}
