import { NextResponse } from 'next/server'
import { getAvailableSlots, getBookableDates, getDefaultPhysioId } from '@/lib/slots'
import { getCurrentClinic } from '@/lib/tenant'

/**
 * ============================================================================
 *  GET /api/slots — which times are free?
 * ============================================================================
 *  Called by the booking wizard whenever the patient changes the date, the
 *  service or the mode.
 *
 *      /api/slots?serviceId=2&date=2026-08-04&mode=clinic
 *
 *  WHY THIS IS AN API ROUTE AND NOT A SERVER COMPONENT
 *  --------------------------------------------------
 *  Almost every other read in this app happens in a Server Component, which is
 *  faster and simpler. This one is different: the patient taps through five
 *  different dates in a few seconds, and each tap must update only the slot grid.
 *  Re-rendering the whole page server-side for each tap would feel sluggish and
 *  lose their scroll position.
 *
 *  So the availability lookup stays on the server — where it must be, since it
 *  needs the database and cannot be trusted to the client — and is exposed as a
 *  small JSON endpoint the wizard can call. That is the right dividing line:
 *  server components for page content, API routes for interactive fragments.
 *
 *  NO AUTHENTICATION HERE, DELIBERATELY
 *  ------------------------------------
 *  Anyone may look at the clinic's free slots — that is public information, and
 *  requiring a login to see availability would lose bookings. What is protected
 *  is the act of BOOKING one, which needs a session (see /api/appointments) and
 *  re-checks availability server-side anyway.
 * ============================================================================
 */

export async function GET(request) {
  const { searchParams } = new URL(request.url)

  const serviceId = searchParams.get('serviceId')
  const date = searchParams.get('date')
  const mode = searchParams.get('mode') || 'clinic'
  // ?days=14 returns the date strip instead of one day's slots.
  const days = searchParams.get('days')

  try {
    // The clinic comes from the hostname, never from a query parameter. If it
    // were a parameter, anyone could read any clinic's diary by changing a
    // number in the URL.
    const clinic = await getCurrentClinic()
    if (!clinic) {
      return NextResponse.json({ error: 'Unknown clinic' }, { status: 404 })
    }

    const physioId = await getDefaultPhysioId(clinic.id)
    if (!physioId) {
      return NextResponse.json(
        { error: 'No physiotherapist is set up yet. Run npm run db:setup.' },
        { status: 503 }
      )
    }

    // ------------------------------------------------- the date strip
    if (days) {
      const dates = await getBookableDates({
        clinic,
        physioId,
        mode,
        // Clamped so a hand-crafted ?days=99999 cannot be used to make the
        // server do unbounded work. Always bound anything a caller can size.
        days: Math.min(Math.max(Number(days) || 14, 1), 60),
      })
      return NextResponse.json({ dates })
    }

    // ------------------------------------------------ one day's slots
    if (!serviceId || !date) {
      return NextResponse.json(
        { error: 'serviceId and date are both required' },
        { status: 400 }
      )
    }

    const result = await getAvailableSlots({ clinic, physioId, date, serviceId, mode })

    return NextResponse.json(result, {
      headers: {
        /**
         * Availability changes the instant somebody books, so this must never be
         * cached — not by the browser, not by a CDN, not by Next.js. Showing a
         * slot that was taken two minutes ago sends the patient through the
         * whole booking flow only to be rejected at the last step.
         */
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    console.error('[api/slots] error:', error)
    return NextResponse.json(
      { error: 'Could not load availability. Please try again.' },
      { status: 500 }
    )
  }
}
