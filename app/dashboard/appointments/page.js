import { CalendarCheck, Plus } from 'lucide-react'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import { getPatientAppointments } from '@/lib/queries'
import { todayISO } from '@/lib/utils'
import { Card, EmptyState } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import AppointmentRow from '@/components/dashboard/AppointmentRow'

/**
 * ============================================================================
 *  MY APPOINTMENTS  →  /dashboard/appointments
 * ============================================================================
 *  Split into upcoming and past rather than one long list.
 *
 *  That split is not decoration — the two groups need opposite sort orders.
 *  Upcoming should read soonest-first (the next thing you must attend is at the
 *  top). Past should read newest-first (what happened most recently matters most).
 *  A single list sorted either way puts the wrong thing at the top for half the
 *  page.
 * ============================================================================
 */

export const metadata = { title: 'My appointments' }
export const dynamic = 'force-dynamic'

export default async function AppointmentsPage() {
  const clinic = await requireCurrentClinic()
  const session = await auth()
  const appointments = await getPatientAppointments(clinic.id, session.user.id)

  const today = todayISO()

  // An appointment counts as upcoming if it is still live AND has not passed.
  const isUpcoming = (a) =>
    ['pending_payment', 'confirmed', 'in_progress'].includes(a.status) &&
    String(a.appointment_date).slice(0, 10) >= today

  const upcoming = appointments
    .filter(isUpcoming)
    // Soonest first. Comparing 'YYYY-MM-DD' and 'HH:MM:SS' strings sorts
    // correctly because both formats are zero-padded and fixed-width — a small
    // but genuinely useful property of the ISO date format.
    .sort((a, b) =>
      `${a.appointment_date}${a.start_time}`.localeCompare(`${b.appointment_date}${b.start_time}`)
    )

  const past = appointments.filter((a) => !isUpcoming(a))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl">My appointments</h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            {appointments.length === 0
              ? 'Nothing here yet.'
              : `${upcoming.length} upcoming · ${past.length} past`}
          </p>
        </div>
        <Button href="/book" size="sm">
          <Plus className="size-4" aria-hidden="true" />
          Book appointment
        </Button>
      </div>

      {appointments.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={<CalendarCheck className="size-6" />}
            title="No appointments yet"
            description="Once you book, everything appears here — with your invoice, clinical notes and prescribed exercises."
            action={<Button href="/book">Book your first session</Button>}
          />
        </Card>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-ink-500">
                Upcoming
              </h2>
              <Card className="overflow-hidden p-0">
                <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                  {upcoming.map((appointment) => (
                    <AppointmentRow key={appointment.id} appointment={appointment} />
                  ))}
                </ul>
              </Card>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-ink-500">
                Past appointments
              </h2>
              <Card className="overflow-hidden p-0">
                <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                  {past.map((appointment) => (
                    <AppointmentRow key={appointment.id} appointment={appointment} />
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  )
}
