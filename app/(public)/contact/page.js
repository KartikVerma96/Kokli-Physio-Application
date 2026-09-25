import { MapPin, Phone, Mail, Clock, MessageCircle, TriangleAlert } from 'lucide-react'
import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import { formattedAddress, whatsappLink, telLink } from '@/lib/clinicView'
import { buildMetadata, JsonLd, breadcrumbSchema, localBusinessSchema } from '@/lib/seo'
import { getActiveServices, getRatingSummary } from '@/lib/queries'
import PageHeader from '@/components/layout/PageHeader'
import Button from '@/components/ui/Button'

/**
 * ============================================================================
 *  CONTACT & DIRECTIONS  →  /contact
 * ============================================================================
 *  Every phone number is a real tel: link and the email is a mailto: link, so a
 *  patient on a phone taps once and is calling. It sounds trivial; it is the
 *  difference between a booking and a closed tab.
 *
 *  The address appears here in visible text AND in the LocalBusiness structured
 *  data, and it must match your Google Business Profile character for character.
 *  Google cross-checks these, and consistent details across the web is one of
 *  the strongest local ranking signals there is. An address written three
 *  slightly different ways in three places genuinely costs you visibility.
 * ============================================================================
 */

export async function generateMetadata() {
  const site = clinicView(await requireCurrentClinic())
  return buildMetadata({
    site,
    title: `Contact & Directions — Physiotherapy Clinic in ${site.address.city}`,
    description: `Visit ${site.name} at ${formattedAddress(site)}. Call ${site.contact.phone} or book online.`,
    path: '/contact',
  })
}

export default async function ContactPage() {
  const clinic = await requireCurrentClinic()
  const site = clinicView(clinic)
  const [services, rating] = await Promise.all([
    getActiveServices(clinic.id),
    getRatingSummary(clinic.id),
  ])

  // Google Maps embeds do not need an API key in this form, which keeps the
  // setup simple. It is loaded lazily so it never delays the rest of the page.
  const mapSrc = `https://maps.google.com/maps?q=${site.address.latitude},${site.address.longitude}&z=15&output=embed`

  const channels = [
    {
      icon: Phone,
      label: 'Call the clinic',
      value: site.contact.phone,
      href: telLink(site),
      note: 'Fastest way to reach us during clinic hours',
    },
    {
      icon: MessageCircle,
      label: 'WhatsApp',
      value: site.contact.phone,
      href: whatsappLink(site),
      note: 'Send us a photo of your report or scan',
      external: true,
    },
    {
      icon: Mail,
      label: 'Email',
      value: site.contact.email,
      href: `mailto:${site.contact.email}`,
      note: 'For invoices, insurance and records',
    },
  ]

  return (
    <>
      <JsonLd
        data={[
          localBusinessSchema({ site, services, rating }),
          breadcrumbSchema(site, [{ name: 'Contact' }]),
        ]}
      />

      <PageHeader
        eyebrow="Get in touch"
        title={`Visit the clinic in ${site.address.city}`}
        description="Book online in under a minute, or call and speak to us directly. If you are not sure which treatment you need, ring us — we would rather point you to the right thing than sell you the wrong one."
        breadcrumb={[{ name: 'Contact' }]}
      >
        <Button href="/book" size="lg">Book an appointment</Button>
      </PageHeader>

      <div className="container-page py-14">
        {/* ------------------------------------------------------ channels */}
        <div className="grid gap-5 sm:grid-cols-3">
          {channels.map((channel) => (
            <a
              key={channel.label}
              href={channel.href}
              {...(channel.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="card group p-6 transition-all hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift dark:hover:border-brand-800"
            >
              <span className="grid size-11 place-items-center rounded-2xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-600 group-hover:text-[var(--color-brand-fg,#fff)] dark:bg-brand-950/60 dark:text-brand-300">
                <channel.icon className="size-5" aria-hidden="true" />
              </span>
              <p className="mt-4 text-xs font-bold uppercase tracking-wider text-ink-500">
                {channel.label}
              </p>
              <p className="mt-1 font-semibold group-hover:text-brand-700 dark:group-hover:text-brand-300">
                {channel.value}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                {channel.note}
              </p>
            </a>
          ))}
        </div>

        {/* -------------------------------------------- map and details */}
        <div className="mt-8 grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="card overflow-hidden p-0">
              {/* aspect-video reserves the space before the iframe loads, so the
                  page does not jump when the map arrives — that jump is exactly
                  what Cumulative Layout Shift measures. */}
              <div className="aspect-video w-full">
                <iframe
                  src={mapSrc}
                  title={`Map showing ${site.name} in ${site.address.city}`}
                  className="size-full border-0"
                  // Lazy loading is important here: an eagerly loaded Google
                  // Maps iframe is one of the heaviest things you can put on a
                  // page, and it would compete with your own content for
                  // bandwidth.
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 p-5 dark:border-ink-800">
                <address className="text-sm not-italic leading-relaxed text-ink-600 dark:text-ink-400">
                  {formattedAddress(site)}
                </address>
                <Button
                  href={site.address.mapsUrl}
                  variant="secondary"
                  size="sm"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in Google Maps
                </Button>
              </div>
            </div>

            {/* ----------------------------------------- getting here */}
            {/* Only what the clinic has actually told us. This used to promise
                "free two-wheeler parking, car parking in the basement, second
                floor with lift access" and named address line 2 as the nearest
                bus stop — on EVERY clinic's page, true or not. A patient who
                drives over expecting basement parking blames the clinic. */}
            <div className="card mt-6 p-6">
              <MapPin className="size-5 text-brand-600" aria-hidden="true" />
              <h2 className="mt-3 text-base font-bold">Finding us</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
                {formattedAddress(site) || site.name}.{' '}
                {telLink(site) ? (
                  <>
                    Coming for the first time? Call{' '}
                    <a href={telLink(site)} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                      {site.contact.phone}
                    </a>{' '}
                    and we will guide you in.
                  </>
                ) : (
                  'The map above has directions to the door.'
                )}
              </p>
            </div>
          </div>

          {/* --------------------------------------------------- sidebar */}
          <div className="lg:col-span-5">
            <div className="card p-6">
              <h2 className="flex items-center gap-2 text-base font-bold">
                <Clock className="size-4 text-brand-600" aria-hidden="true" />
                Opening hours
              </h2>
              <dl className="mt-4 space-y-3 text-sm">
                {site.openingHours.map((slot) => (
                  <div
                    key={slot.days}
                    className="flex items-start justify-between gap-4 border-b border-ink-100 pb-3 last:border-0 dark:border-ink-800"
                  >
                    <dt className="font-medium text-ink-700 dark:text-ink-300">{slot.days}</dt>
                    <dd className="text-right text-ink-600 dark:text-ink-400">{slot.time}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs leading-relaxed text-ink-500">
                Live availability is always shown on the booking page — it accounts for
                appointments already taken and any leave.
              </p>
              <Button href="/book" fullWidth className="mt-5">
                See available slots
              </Button>
            </div>

            <div className="card mt-5 p-6">
              <h2 className="text-base font-bold">Before your first visit</h2>
              <ul className="mt-4 space-y-3 text-sm text-ink-600 dark:text-ink-400">
                {[
                  'Bring any X-rays, MRI scans or doctor’s notes you already have.',
                  'Wear loose clothing that lets us see and move the affected area.',
                  'Arrive five minutes early to fill in your intake form, or complete it in your dashboard beforehand.',
                  'Bring a list of any medication you take regularly.',
                ].map((tip) => (
                  <li key={tip} className="flex items-start gap-2.5">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                    {tip}
                  </li>
                ))}
              </ul>
            </div>

            {/* An emergency notice. A physiotherapy clinic is not an emergency
                service, and saying so plainly is the responsible thing to do. */}
            <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/40">
              <h2 className="flex items-center gap-2 text-sm font-bold text-red-900 dark:text-red-200">
                <TriangleAlert className="size-4" aria-hidden="true" />
                This is not an emergency service
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-red-800 dark:text-red-300">
                If you have sudden severe pain, numbness in the groin area, loss of bladder or bowel
                control, or weakness in both legs, go to a hospital emergency department now. Those
                are signs that need immediate medical assessment, not physiotherapy.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
