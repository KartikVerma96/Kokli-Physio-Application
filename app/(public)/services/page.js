import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView, doctorLine } from '@/lib/clinicView'
import { getActiveServices } from '@/lib/queries'
import { buildMetadata, JsonLd, breadcrumbSchema } from '@/lib/seo'
import { ServiceCard } from '@/components/home/ServicesGrid'
import { CtaBand } from '@/components/home/Faq'
import Reveal from '@/components/ui/Reveal'
import PageHeader from '@/components/layout/PageHeader'

/**
 * ============================================================================
 *  ALL SERVICES  →  /services
 * ============================================================================
 *  A hub page listing every treatment, with each card linking to its own
 *  detailed page.
 *
 *  This structure — one hub linking to many specific pages — is deliberate and
 *  it is how content-driven SEO works. This page can rank for the broad,
 *  competitive phrase ("physiotherapy in Pune") while each child page targets
 *  something specific and much easier to win ("frozen shoulder treatment
 *  Pune"). The specific pages are where the actual patients come from, because
 *  people search for their problem, not for a profession.
 * ============================================================================
 */

/**
 * `generateMetadata` rather than a static `metadata` export.
 *
 * The title has to name THIS clinic and THIS city, and neither is known until
 * the tenant is resolved from the hostname — which cannot happen at module load.
 * Every clinic page on the platform uses this pattern for the same reason.
 */
export async function generateMetadata() {
  const site = clinicView(await requireCurrentClinic())
  return buildMetadata({
    site,
    title: `Physiotherapy Treatments in ${site.address.city}`,
    description: `All physiotherapy services at ${site.name}${site.address.city ? `, ${site.address.city}` : ''} — book in-clinic or online.`,
    path: '/services',
  })
}

export default async function ServicesPage() {
  const clinic = await requireCurrentClinic()
  const site = clinicView(clinic)
  const services = await getActiveServices(clinic.id)

  const online = services.filter((s) => s.available_online)
  const clinicOnly = services.filter((s) => !s.available_online)

  return (
    <>
      <JsonLd data={breadcrumbSchema(site, [{ name: 'Services' }])} />

      <PageHeader
        eyebrow="Treatments"
        title={`Physiotherapy treatments${site.address.city ? ` in ${site.address.city}` : ''}`}
        description={`${services.length} ${services.length === 1 ? 'treatment' : 'treatments'} led by ${doctorLine(site)}. Every one starts with a proper assessment — we find the cause before treating the symptom.`}
        breadcrumb={[{ name: 'Services' }]}
      />

      {/* pt-12 matches the other pages under a PageHeader; pb-4 stays small on
          purpose, because the "clinic or online" section below is a continuation
          of this grid rather than a new part of the page.

          Without the top padding the first row of cards sat flush against the
          header's bottom border, which read as a rendering fault rather than a
          layout choice. */}
      <div className="container-page pb-4 pt-12">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service, index) => (
            <Reveal key={service.id} delay={Math.min(index, 5) * 60}>
              <ServiceCard service={service} />
            </Reveal>
          ))}
        </div>
      </div>

      {/* ------------------------------------------- online vs in-clinic */}
      {/* Genuinely useful content, and it happens to be exactly the kind of
          practical detail that earns a page a featured snippet in Google. */}
      <section className="container-page py-20">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-7">
            <h2 className="text-xl font-bold">What works well over video</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
              Physiotherapy is largely assessment, diagnosis and teaching, and all three travel
              perfectly well down a video call. We watch how you move, test your range of motion,
              and coach you through corrective exercises live.
            </p>
            <ul className="mt-5 space-y-2">
              {online.map((service) => (
                <li key={service.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                  <span className="text-ink-700 dark:text-ink-300">{service.name}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card p-7">
            <h2 className="text-xl font-bold">What needs you in the clinic</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
              Some treatment genuinely requires hands — or needles. We would rather tell you that
              than take your money for a session that cannot do what you need.
            </p>
            <ul className="mt-5 space-y-2">
              {clinicOnly.length > 0 ? (
                clinicOnly.map((service) => (
                  <li key={service.id} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-sun-500" aria-hidden="true" />
                    <span className="text-ink-700 dark:text-ink-300">{service.name}</span>
                  </li>
                ))
              ) : (
                <li className="text-sm text-ink-500">Every treatment is available online.</li>
              )}
            </ul>
            <p className="mt-5 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
              Manual therapy, dry needling, joint mobilisation, ultrasound and the Epley manoeuvre
              for vertigo all need physical contact. Everything else we can start remotely and
              continue in person if it turns out you need it.
            </p>
          </div>
        </div>
      </section>

      <CtaBand site={site} />
    </>
  )
}
