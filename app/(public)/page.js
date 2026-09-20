import { getCurrentClinic } from '@/lib/tenant'
import { notFound } from 'next/navigation'
import { clinicView } from '@/lib/clinicView'
import { getActiveServices, getPublishedReviews, getRatingSummary } from '@/lib/queries'
import { getDefaultPhysioId, getAvailableSlots, getBookableDates } from '@/lib/slots'
import {
  JsonLd, buildMetadata, localBusinessSchema, faqSchema, reviewSchema, reservationSchema,
} from '@/lib/seo'
import Hero from '@/components/home/Hero'
import Conditions, { TrustBar } from '@/components/home/Conditions'
import ServicesGrid from '@/components/home/ServicesGrid'
import HowItWorks from '@/components/home/HowItWorks'
import DoctorIntro from '@/components/home/DoctorIntro'
import Testimonials from '@/components/home/Testimonials'
import Faq, { CtaBand } from '@/components/home/Faq'

/**
 * ============================================================================
 *  A CLINIC'S HOMEPAGE  →  aarogya.kokli.local/
 * ============================================================================
 *  A Server Component. Everything runs on the server, and the browser receives
 *  finished HTML with this clinic's services, reviews and next available slot
 *  already inside it.
 *
 *  WHY THAT MATTERS SO MUCH HERE
 *  -----------------------------
 *  A client-rendered version would send an empty shell, then JavaScript, then
 *  make three API calls, then finally draw the content. The patient stares at a
 *  spinner, and a crawler has to execute JavaScript to see a single word of it.
 *  Server rendering removes all four steps — and every clinic on the platform
 *  gets that for free.
 * ============================================================================
 */

// Never cached. Each request may be for a different clinic, and a cached
// homepage would be a catastrophic cross-tenant leak — clinic B served clinic
// A's page. See the note in lib/tenant.js about per-request caching.
export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  /**
   * getCurrentClinic, not requireCurrentClinic.
   *
   * `generateMetadata` runs BEFORE the layout, so on the platform's root domain —
   * where there is no clinic — throwing here would produce a 500 before the
   * layout ever got the chance to render its clean 404. Returning empty metadata
   * lets the layout make that decision.
   */
  const clinic = await getCurrentClinic()
  if (!clinic) return {}
  const site = clinicView(clinic)
  return buildMetadata({
    site,
    title: `${site.name} — Physiotherapy in ${site.address.city}`,
    path: '/',
  })
}

export default async function ClinicHomePage() {
  /**
   * notFound(), not a throw.
   *
   * The layout has already decided that a request with no clinic is a 404, and
   * Next renders layout and page concurrently — so throwing here logged a real
   * error on every hit to an unknown subdomain even though the 404 was served
   * correctly. Agreeing with the layout keeps the logs meaningful: an error in
   * them should mean something is actually wrong.
   */
  const clinic = await getCurrentClinic()
  if (!clinic) notFound()

  const site = clinicView(clinic)

  // Promise.all runs these together rather than one after another. Four 8ms
  // queries in sequence is 32ms; in parallel it is 8ms.
  const [services, reviews, rating, physioId] = await Promise.all([
    getActiveServices(clinic.id),
    getPublishedReviews(clinic.id, { limit: 4 }),
    getRatingSummary(clinic.id),
    getDefaultPhysioId(clinic.id),
  ])

  const nextSlot = await findNextAvailableSlot(clinic, physioId, services)

  return (
    <>
      {/*
        STRUCTURED DATA — generated from THIS clinic's row.
        Four schemas, each earning something different:
          localBusiness  → the local map pack, opening hours, star ratings
          faq            → the expandable Q&A block inside search results
          review         → individual review snippets
          reservation    → marks the clinic as offering bookable appointments
      */}
      <JsonLd
        data={[
          localBusinessSchema({ site, services, rating }),
          faqSchema(site.faqs),
          ...reviewSchema(
            site,
            reviews.map((r) => ({ name: r.patient_name, rating: r.rating, text: r.comment }))
          ),
          reservationSchema(site),
        ]}
      />

      <Hero site={site} nextSlot={nextSlot} servicesCount={services.length} />
      <TrustBar site={site} />
      <Conditions site={site} />
      <ServicesGrid services={services} limit={6} />
      <HowItWorks site={site} />
      <DoctorIntro site={site} />
      <Testimonials reviews={reviews} />
      <Faq site={site} />
      <CtaBand site={site} />
    </>
  )
}

/**
 * Walk forward from today until we find a bookable slot, for the hero card.
 *
 * Uses the shortest service as the probe, because a short service fits into more
 * gaps — so this answers "how soon could I possibly be seen", which is the
 * question the card is really making a claim about.
 *
 * Returns null rather than throwing. A homepage must never fail to render
 * because an availability lookup had a bad day.
 */
async function findNextAvailableSlot(clinic, physioId, services) {
  if (!physioId || services.length === 0) return null

  const probeService = services.reduce(
    (shortest, s) => (s.duration_minutes < shortest.duration_minutes ? s : shortest),
    services[0]
  )

  try {
    const days = await getBookableDates({ clinic, physioId, mode: 'clinic', days: 10 })

    for (const day of days) {
      if (!day.isOpen) continue
      const { slots } = await getAvailableSlots({
        clinic,
        physioId,
        date: day.date,
        serviceId: probeService.id,
        mode: 'clinic',
      })
      if (slots.length > 0) return { date: day.date, startTime: slots[0].startTime }
    }
  } catch {
    // Deliberately swallowed — the hero falls back to "Book your slot".
  }

  return null
}
