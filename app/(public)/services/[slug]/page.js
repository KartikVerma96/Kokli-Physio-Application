import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  Clock, IndianRupee, MapPin, Video, CheckCircle2, ArrowRight, Stethoscope, ShieldCheck,
} from 'lucide-react'
import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView, doctorLine } from '@/lib/clinicView'
import { getServiceBySlug, getActiveServices } from '@/lib/queries'
import { buildMetadata, JsonLd, serviceSchema, breadcrumbSchema, faqSchema } from '@/lib/seo'
import { formatMoney } from '@/lib/utils'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import PageHeader from '@/components/layout/PageHeader'
import { CtaBand } from '@/components/home/Faq'

/**
 * ============================================================================
 *  ONE TREATMENT PAGE  →  /services/[slug]
 * ============================================================================
 *  A dynamic route. `[slug]` in the folder name means this single file serves
 *  every service: /services/frozen-shoulder, /services/dry-needling, and any
 *  service your sister adds in future — with no new code.
 *
 *  These pages are the SEO workhorses of the entire site. Somebody with a
 *  frozen shoulder does not search "physiotherapy clinic"; they search "frozen
 *  shoulder treatment near me" or "cannot lift arm above shoulder". A page
 *  about exactly that one condition, with the condition in the URL, the <h1>,
 *  the headings and the body text, is what matches that search.
 * ============================================================================
 */

/**
 * Server-rendered on every request, so a price or description edited in the admin
 * panel is live immediately. See the long note in app/(public)/page.js for the
 * caching alternative and why we did not take it.
 *
 * Next.js CAN pre-build every one of these into a static file at deploy time —
 * add a `generateStaticParams` that returns all the slugs, plus
 * `export const revalidate = 3600`. That is measurably faster, but it means
 * `npm run build` needs a live database connection, and content edits go stale
 * for an hour. Not the right trade for a single clinic.
 */
export const dynamic = 'force-dynamic'

/**
 * Per-page metadata, generated from the database.
 *
 * Note it prefers the seo_title and seo_description columns, which your sister
 * can edit in Admin → Services. That means the person who understands what
 * patients actually call their condition can tune the search listing without
 * asking a developer.
 */
export async function generateMetadata({ params }) {
  const { slug } = await params
  const clinic = await requireCurrentClinic()
  const site = clinicView(clinic)
  const service = await getServiceBySlug(clinic.id, slug)

  if (!service) {
    return buildMetadata({ site, title: 'Treatment not found', noIndex: true })
  }

  return buildMetadata({
    site,
    title: service.seo_title || `${service.name} in ${site.address.city}`,
    description: service.seo_description || service.short_description,
    path: `/services/${service.slug}`,
  })
}

export default async function ServicePage({ params }) {
  const { slug } = await params
  const clinic = await requireCurrentClinic()
  const site = clinicView(clinic)
  const service = await getServiceBySlug(clinic.id, slug)

  // notFound() renders the 404 page and, importantly, sends a real HTTP 404
  // status. A "not found" page that returns 200 gets indexed by Google as a
  // legitimate page, which is a classic and damaging mistake.
  if (!service) notFound()

  const allServices = await getActiveServices(clinic.id)
  const related = allServices.filter((s) => s.slug !== slug).slice(0, 3)

  // mysql2 parses JSON columns for us, so these arrive as real arrays.
  const conditions = Array.isArray(service.conditions_treated) ? service.conditions_treated : []
  const expectations = Array.isArray(service.what_to_expect) ? service.what_to_expect : []

  return (
    <>
      <JsonLd
        data={[
          serviceSchema(site, service),
          breadcrumbSchema(site, [{ name: 'Services', path: '/services' }, { name: service.name }]),
          // The three FAQs most relevant to a treatment page. Reusing a subset
          // is fine — what matters is that the answers are visible on the page,
          // which they are, further down.
          faqSchema(site.faqs.slice(0, 4)),
        ]}
      />

      <PageHeader
        eyebrow="Treatment"
        title={`${service.name} in ${site.address.city}`}
        description={service.short_description}
        breadcrumb={[{ name: 'Services', path: '/services' }, { name: service.name }]}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button href={`/book?service=${service.slug}`} size="lg">
            Book this treatment
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
          <span className="flex items-center gap-4 text-sm font-medium text-ink-600 dark:text-ink-300">
            <span className="flex items-center gap-1.5">
              <IndianRupee className="size-4 text-brand-600" aria-hidden="true" />
              {formatMoney(service.price_paise)} per session
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="size-4 text-brand-600" aria-hidden="true" />
              {service.duration_minutes} minutes
            </span>
          </span>
        </div>
      </PageHeader>

      <div className="container-page py-14">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-14">
          {/* ================================================ main content */}
          <article className="lg:col-span-8">
            <div className="flex items-start gap-4">
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
                <Icon name={service.icon} className="size-7" />
              </span>
              <div>
                <h2 className="text-2xl font-bold">About this treatment</h2>
                <p className="mt-1 text-sm text-ink-500">
                  With {doctorLine(site)}
                </p>
              </div>
            </div>

            <div className="prose-clinic mt-7 text-[17px]">
              {/* The long description from the database, split on blank lines so
                  each paragraph is a real <p>. Storing plain text and splitting
                  here is much safer than storing HTML, which would need
                  sanitising before it could be rendered. */}
              {String(service.description || service.short_description)
                .split(/\n\s*\n/)
                .map((paragraph, index) => (
                  <p key={index}>{paragraph.trim()}</p>
                ))}
            </div>

            {/* ------------------------------------- conditions treated */}
            {conditions.length > 0 && (
              <div className="mt-12">
                <h2 className="text-2xl font-bold">Conditions we treat with this</h2>
                <p className="mt-2 text-ink-600 dark:text-ink-400">
                  If your diagnosis is not listed, book the assessment — it is often related.
                </p>
                <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                  {conditions.map((condition) => (
                    <li
                      key={condition}
                      className="flex items-start gap-2.5 rounded-xl border border-ink-200 p-3.5 dark:border-ink-700"
                    >
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
                      <span className="text-sm font-medium">{condition}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* -------------------------------------- what to expect */}
            {expectations.length > 0 && (
              <div className="mt-12">
                <h2 className="text-2xl font-bold">What happens in the session</h2>
                <ol className="mt-6 space-y-4">
                  {expectations.map((step, index) => (
                    <li key={step} className="flex gap-4">
                      <span
                        className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-[var(--color-brand-fg,#fff)]"
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <p className="pt-1 text-[15px] leading-relaxed text-ink-700 dark:text-ink-300">
                        {step}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* --------------------------------------------- mini FAQ */}
            <div className="mt-12">
              <h2 className="text-2xl font-bold">Common questions</h2>
              <div className="mt-5 divide-y divide-ink-100 dark:divide-ink-800">
                {site.faqs.slice(0, 4).map((faq) => (
                  <details key={faq.q} className="group py-4">
                    <summary className="cursor-pointer list-none font-semibold group-open:text-brand-700 dark:group-open:text-brand-300">
                      {faq.q}
                    </summary>
                    <p className="mt-3 text-[15px] leading-relaxed text-ink-600 dark:text-ink-400">
                      {faq.a}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          </article>

          {/* ===================================================== sidebar */}
          <aside className="lg:col-span-4">
            {/* Sticky so the price and the Book button stay on screen however
                far the reader scrolls. On a page whose job is to produce a
                booking, that matters. */}
            <div className="space-y-5 lg:sticky lg:top-28">
              <div className="card overflow-hidden">
                <div className="border-b border-ink-100 bg-linear-to-br from-brand-50 to-white p-6 dark:border-ink-800 dark:from-brand-950/40 dark:to-ink-900">
                  <p className="text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-400">
                    Session fee
                  </p>
                  <p className="mt-1.5 font-display text-4xl font-bold">
                    {formatMoney(service.price_paise)}
                  </p>
                  <p className="mt-1 text-sm text-ink-500">
                    {service.duration_minutes} minutes, one-to-one
                  </p>
                </div>

                <div className="space-y-3 p-6">
                  {/* Availability, stated plainly. */}
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-semibold">
                        {service.available_clinic ? 'Available at the clinic' : 'Not offered in clinic'}
                      </p>
                      {Boolean(service.available_clinic) && (
                        <p className="text-xs text-ink-500">
                          {site.address.line2}, {site.address.city}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Video className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-semibold">
                        {service.available_online
                          ? 'Available as a video consultation'
                          : 'Needs an in-person visit'}
                      </p>
                      <p className="text-xs text-ink-500">
                        {service.available_online
                          ? 'One-to-one video call, from anywhere'
                          : 'This treatment requires hands-on contact'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-semibold">Free cancellation</p>
                      <p className="text-xs text-ink-500">
                        Up to {site.booking.freeCancellationHours} hours before your slot
                      </p>
                    </div>
                  </div>

                  <Button href={`/book?service=${service.slug}`} fullWidth size="lg" className="mt-5">
                    Book an appointment
                  </Button>

                  <p className="text-center text-xs text-ink-400">
                    No referral needed · Pay by UPI or card
                  </p>
                </div>
              </div>

              {/* ------------------------------------------ practitioner */}
              <div className="card p-6">
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-2xl bg-linear-to-br from-brand-500 to-brand-700 text-[var(--color-brand-fg,#fff)]">
                    <Stethoscope className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-bold">{site.doctor.name}</p>
                    <p className="text-xs text-ink-500">{site.doctor.credentials}</p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
                  {site.doctor.experienceYears} years in practice. Registered {site.doctor.registration}.
                </p>
                <Link
                  href="/about"
                  className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline dark:text-brand-400"
                >
                  Read more about the clinic →
                </Link>
              </div>

              {/* -------------------------------------------- related */}
              {related.length > 0 && (
                <div className="card p-6">
                  <h3 className="text-sm font-bold uppercase tracking-wider">Related treatments</h3>
                  <ul className="mt-4 space-y-3">
                    {related.map((item) => (
                      <li key={item.id}>
                        <Link
                          href={`/services/${item.slug}`}
                          className="group flex items-center gap-3"
                        >
                          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-600 transition-colors group-hover:bg-brand-600 group-hover:text-[var(--color-brand-fg,#fff)] dark:bg-ink-800 dark:text-ink-300">
                            <Icon name={item.icon} className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold group-hover:text-brand-700 dark:group-hover:text-brand-300">
                              {item.name}
                            </span>
                            <span className="block text-xs text-ink-500">
                              {formatMoney(item.price_paise)} · {item.duration_minutes} min
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      <CtaBand site={site} />
    </>
  )
}
