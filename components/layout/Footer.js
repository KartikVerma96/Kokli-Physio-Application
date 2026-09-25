import Link from 'next/link'
import { Stethoscope, MapPin, Phone, Mail, Clock } from 'lucide-react'
// Brand logos are not in lucide-react v1 — see components/ui/SocialIcons.js.
import { Instagram, Facebook, Youtube, Linkedin } from '@/components/ui/SocialIcons'
import { formattedAddress, whatsappLink, telLink } from '@/lib/clinicView'
import { getActiveServices } from '@/lib/queries'

/**
 * ============================================================================
 *  FOOTER
 * ============================================================================
 *  A Server Component, so it queries the service list directly. It appears on
 *  every page, and that has a real SEO benefit worth understanding:
 *
 *  Google discovers pages by following links. A footer link to every treatment
 *  page from every page means each one is reachable in a single hop from
 *  anywhere on the site, and internal links pass ranking signal. This is called
 *  internal linking, and it is one of the highest-value, lowest-effort things
 *  you can do for search visibility.
 *
 *  The address is also marked up here in a way Google can parse (see the
 *  LocalBusiness JSON-LD in app/layout.js), which is what makes the clinic
 *  eligible for the local map pack.
 * ============================================================================
 */

export default async function Footer({ site }) {
  const services = await getActiveServices(site.id)
  const year = new Date().getFullYear()

  const socials = [
    { href: site.social.instagram, icon: Instagram, label: 'Instagram' },
    { href: site.social.facebook, icon: Facebook, label: 'Facebook' },
    { href: site.social.youtube, icon: Youtube, label: 'YouTube' },
    { href: site.social.linkedin, icon: Linkedin, label: 'LinkedIn' },
  ].filter((s) => s.href)

  return (
    // No top margin. It used to hold 96px of page background above the footer,
    // which read as deliberate space under a coloured band and as a hole under
    // anything else. Every section already ends with its own padding, and the
    // border below is the line that separates the page from the footer.
    <footer className="arc-left relative overflow-hidden border-t border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
      <div className="container-page py-14">
        <div className="grid gap-10 lg:grid-cols-12">
          {/* -------------------------------------------------- about */}
          <div className="lg:col-span-4">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="grid size-10 place-items-center rounded-2xl bg-linear-to-br from-brand-500 to-brand-700 text-[var(--color-brand-fg,#fff)]">
                <Stethoscope className="size-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-display text-base font-bold leading-tight">{site.name}</span>
                <span className="block text-[11px] text-ink-500">{site.tagline}</span>
              </span>
            </Link>

            {/* Every clause is conditional. A clinic that signed up an hour ago
                has no credentials or city yet, and "Led by Dr X, , with  years of
                practice in ." on a live website looks broken. */}
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-ink-600 dark:text-ink-400">
              {site.legalName}. Led by {site.doctor.name}
              {site.doctor.credentials ? `, ${site.doctor.credentials}` : ''}
              {site.doctor.experienceYears
                ? `, with ${site.doctor.experienceYears} years of clinical practice`
                : ''}
              {site.address.city ? ` in ${site.address.city}` : ''}.
            </p>

            {site.doctor.registration && (
              <p className="mt-3 text-xs text-ink-400">
                Registration No. {site.doctor.registration}
              </p>
            )}

            {socials.length > 0 && (
              <div className="mt-6 flex gap-2">
                {socials.map(({ href, icon: SocialIcon, label }) => (
                  <a
                    key={label}
                    href={href}
                    // rel="noopener" stops the opened page reaching back into
                    // ours through window.opener; "noreferrer" avoids leaking
                    // the URL your patient came from.
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="grid size-9 place-items-center rounded-xl bg-ink-100 text-ink-600 transition-colors hover:bg-brand-600 hover:text-[var(--color-brand-fg,#fff)] dark:bg-ink-800 dark:text-ink-300"
                  >
                    <SocialIcon className="size-4" aria-hidden="true" />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* ----------------------------------------------- treatments */}
          <div className="lg:col-span-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-ink-900 dark:text-white">
              Treatments
            </h3>
            <ul className="mt-4 space-y-2.5">
              {services.map((service) => (
                <li key={service.slug}>
                  <Link
                    href={`/services/${service.slug}`}
                    className="text-sm text-ink-600 transition-colors hover:text-brand-700 dark:text-ink-400 dark:hover:text-brand-300"
                  >
                    {service.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* --------------------------------------------------- links */}
          <div className="lg:col-span-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-ink-900 dark:text-white">
              Clinic
            </h3>
            <ul className="mt-4 space-y-2.5">
              {[
                { href: '/about', label: 'About the clinic' },
                { href: '/services', label: 'All services' },
                { href: '/book', label: 'Book online' },
                { href: '/contact', label: 'Contact & directions' },
                { href: '/dashboard', label: 'Patient login' },
                { href: '/privacy', label: 'Privacy policy' },
                { href: '/terms', label: 'Terms of service' },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-ink-600 transition-colors hover:text-brand-700 dark:text-ink-400 dark:hover:text-brand-300"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* ------------------------------------------------- contact */}
          <div className="lg:col-span-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-ink-900 dark:text-white">
              Visit us
            </h3>

            {/* <address> is the correct element for contact details and tells
                assistive technology (and search engines) what this block is. */}
            <address className="mt-4 space-y-3 text-sm not-italic text-ink-600 dark:text-ink-400">
              <a
                href={site.address.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex gap-2.5 transition-colors hover:text-brand-700 dark:hover:text-brand-300"
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
                <span>{formattedAddress(site)}</span>
              </a>

              {telLink(site) && (
                <a
                  href={telLink(site)}
                  className="flex gap-2.5 transition-colors hover:text-brand-700 dark:hover:text-brand-300"
                >
                  <Phone className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
                  <span>{site.contact.phone}</span>
                </a>
              )}

              {site.contact.email && (
                <a
                  href={`mailto:${site.contact.email}`}
                  className="flex gap-2.5 transition-colors hover:text-brand-700 dark:hover:text-brand-300"
                >
                  <Mail className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
                  <span>{site.contact.email}</span>
                </a>
              )}

              <div className="flex gap-2.5">
                <Clock className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
                <div className="space-y-1">
                  {site.openingHours.map((slot) => (
                    <p key={slot.days}>
                      <span className="font-medium text-ink-700 dark:text-ink-300">{slot.days}</span>
                      <br />
                      {slot.time}
                    </p>
                  ))}
                </div>
              </div>
            </address>

            {whatsappLink(site) && (
              <a
                href={whatsappLink(site)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 hover:text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/70 dark:hover:text-emerald-100"
              >
                Message us on WhatsApp
              </a>
            )}
          </div>
        </div>

        {/* ------------------------------------------------- bottom bar */}
        <div className="mt-12 flex flex-col gap-4 border-t border-ink-100 pt-6 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between dark:border-ink-800">
          <p>© {year} {site.legalName}. All rights reserved.</p>
          <p className="max-w-xl sm:text-right">
            {/* A genuine medical disclaimer. Not legal boilerplate — it is the
                honest and correct thing for a healthcare site to say. */}
            The information on this website is general in nature and is not a substitute for a
            personal consultation. If you are experiencing severe or sudden symptoms, please seek
            immediate medical attention.
          </p>
        </div>
      </div>
    </footer>
  )
}
