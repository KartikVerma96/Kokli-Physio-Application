import Link from 'next/link'
import { CalendarOff, Phone } from 'lucide-react'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { canAcceptBookings } from '@/lib/subscriptionLifecycle'
import { clinicView } from '@/lib/clinicView'
import { getActiveServices } from '@/lib/queries'
import { getDefaultPhysioId, getBookableDates } from '@/lib/slots'
import { usablePackages } from '@/lib/packages'
import { buildMetadata, JsonLd, breadcrumbSchema, reservationSchema } from '@/lib/seo'
import PageHeader from '@/components/layout/PageHeader'
import BookingWizard from '@/components/booking/BookingWizard'

/**
 * ============================================================================
 *  BOOK AN APPOINTMENT  →  /book
 * ============================================================================
 *  The Server Component shell. It fetches the services and the date strip, reads
 *  the session, and hands all of it to the wizard as plain props.
 *
 *  DELIBERATELY NOT BEHIND A LOGIN
 *  -------------------------------
 *  This page is public and indexable. Two reasons:
 *
 *    - SEO. "book physiotherapy appointment Pune" is a high-intent search, and
 *      a page behind a login wall cannot rank for it at all.
 *    - Conversion. Forcing someone to create an account before they can even see
 *      whether you have a Saturday morning free loses a real share of bookings.
 *
 *  So the patient can browse services and slots freely, and only needs an account
 *  at the moment of payment — where the wizard prompts them, carrying their whole
 *  selection through the login redirect in the URL so nothing is lost.
 * ============================================================================
 */

export async function generateMetadata() {
  const site = clinicView(await requireCurrentClinic())
  return buildMetadata({
    site,
    title: `Book a Physiotherapy Appointment${site.address.city ? ` in ${site.address.city}` : ''}`,
    description: `Check live availability and book at ${site.name}. In-clinic or online video consultation, secure payment, free cancellation up to ${site.booking.freeCancellationHours} hours before.`,
    path: '/book',
  })
}

/**
 * Availability changes the moment somebody books, so this page must never be
 * cached. `force-dynamic` means it is rendered fresh on every request.
 *
 * This is the opposite choice to the homepage, which uses `revalidate = 600`.
 * The rule of thumb: cache marketing content, never cache anything a user is
 * about to act on.
 */
export const dynamic = 'force-dynamic'

export default async function BookPage({ searchParams }) {
  const params = await searchParams

  const clinic = await requireCurrentClinic()
  const site = clinicView(clinic)

  /**
   * ==========================================================================
   *  A CLINIC THAT CANNOT TAKE BOOKINGS SAYS SO, HERE
   * ==========================================================================
   *  POST /api/appointments already refuses with a 403 for a suspended, cancelled
   *  or read-only clinic — the money gate has always been closed. What was missing
   *  was telling the patient BEFORE they used it.
   *
   *  Without this, somebody at a suspended clinic picked a treatment, picked a
   *  date, picked a time, pressed confirm, and got an unexplained failure. Three
   *  minutes of work to reach a dead end, with nothing to do next.
   *
   *  Note the site itself stays up, deliberately. Losing access to your medical
   *  records because your physiotherapist is late paying a bill would be
   *  indefensible — see the note above canAcceptBookings() in
   *  lib/subscriptionLifecycle.js. So: browsable, contactable, not bookable.
   */
  if (!canAcceptBookings(clinic)) {
    return (
      <div className="container-page py-16">
        <div className="mx-auto max-w-xl text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
            <CalendarOff className="size-7" aria-hidden="true" />
          </span>

          <h1 className="mt-5 text-2xl font-bold">Online booking is paused</h1>

          <p className="mt-3 text-[15px] leading-relaxed text-ink-600 dark:text-ink-400">
            {site.name} is not taking appointments through the website at the moment. They are still
            open — please call and they will book you in.
          </p>

          {/* The phone number IS the fallback. A holding page without one just
              tells somebody their physiotherapist is unreachable. */}
          {site.phone && (
            <a
              href={`tel:${site.phone.replace(/\s/g, '')}`}
              className="mt-7 inline-flex h-12 items-center gap-2 rounded-xl bg-brand-600 px-6 text-sm font-semibold text-[var(--color-brand-fg,#fff)]"
            >
              <Phone className="size-4" aria-hidden="true" />
              Call {site.phone}
            </a>
          )}

          <p className="mt-6 text-sm text-ink-500 dark:text-ink-400">
            Already have an appointment?{' '}
            <Link href="/dashboard/appointments" className="font-semibold underline">
              It is still confirmed
            </Link>
            .
          </p>
        </div>
      </div>
    )
  }

  const [session, services, physioId] = await Promise.all([
    auth(),
    getActiveServices(clinic.id),
    getDefaultPhysioId(clinic.id),
  ])

  // Only treat the visitor as signed in if they belong to THIS clinic — the
  // session cookie spans every subdomain. See components/layout/Header.js.
  const sessionUser = session?.user ?? null
  const user =
    sessionUser && Number(sessionUser.clinicId) === Number(clinic.id) ? sessionUser : null

  // The date strip for the default mode. The wizard refetches this itself
  // whenever the patient switches between clinic and online, because Sunday is
  // online-only and the strip has to reflect that.
  const initialMode = params?.mode === 'online' ? 'online' : 'clinic'
  const dates = physioId
    ? await getBookableDates({ clinic, physioId, mode: initialMode, days: site.booking.maxDaysAhead })
    : []

  /**
   * Deep links carry a preselection:
   *    /book?service=frozen-shoulder&mode=online
   *
   * Used by every "Book this treatment" button on the service pages, and — more
   * importantly — by the login redirect, so a patient who has to sign in at the
   * payment step comes back to exactly the slot they had chosen rather than an
   * empty form.
   */
  const preselected = services.find((s) => s.slug === params?.service) || null

  /**
   * Sessions this patient has already paid for.
   *
   * Fetched for ALL treatments, and filtered in the wizard once the patient picks
   * one — because they choose the treatment after this page renders. A signed-out
   * visitor has none, and the query is skipped rather than run with a null id.
   *
   * The server re-checks every one of these before spending it (see
   * lib/packages.js), so this list is only ever about what to OFFER.
   */
  const packages = user ? await usablePackages(clinic.id, user.id, null) : []

  return (
    <>
      <JsonLd data={[reservationSchema(site), breadcrumbSchema(site, [{ name: 'Book an appointment' }])]} />

      <PageHeader
        eyebrow="Booking"
        title="Book your appointment"
        description={`Pick a treatment, choose a time that suits you, and pay securely. Takes about a minute. Free cancellation up to ${site.booking.freeCancellationHours} hours before your slot.`}
        breadcrumb={[{ name: 'Book' }]}
      />

      <div className="container-page py-12">
        <BookingWizard
          services={services}
          initialDates={dates}
          site={site}
          user={user}
          packages={packages.map((p) => ({
            id: p.id,
            name: p.name,
            serviceId: p.service_id,
            sessionsRemaining: p.sessionsRemaining,
            sessionsTotal: p.sessionsTotal,
            expiresAt: p.expires_at ? String(p.expires_at).slice(0, 10) : null,
          }))}
          initial={{
            service: preselected,
            mode: initialMode,
            date: typeof params?.date === 'string' ? params.date : null,
            time: typeof params?.time === 'string' ? params.time : null,
          }}
        />
      </div>
    </>
  )
}
