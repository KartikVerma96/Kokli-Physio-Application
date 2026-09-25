import Link from 'next/link'
import { ArrowRight, Clock, MapPin, Video } from 'lucide-react'
import Icon from '@/components/ui/Icon'
import Reveal from '@/components/ui/Reveal'
import { SectionHeading } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { formatMoney } from '@/lib/utils'

/**
 * ============================================================================
 *  SERVICES GRID
 * ============================================================================
 *  The treatment cards, rendered from the `services` table. When your sister
 *  adds a service in the admin panel it appears here, on the services page, in
 *  the footer, in the navigation dropdown and in the sitemap — with no code
 *  change anywhere. That is the whole reason services live in the database
 *  rather than in a hard-coded array.
 *
 *  Each card links to its own page at /services/[slug]. Those individual pages
 *  are what rank in Google, because a page about exactly one condition beats a
 *  page listing twelve.
 * ============================================================================
 */

export default function ServicesGrid({ services, limit }) {
  const shown = limit ? services.slice(0, limit) : services

  return (
    <section id="services" className="py-20 lg:py-28">
      <div className="container-page">
        <SectionHeading
          eyebrow="What we treat"
          title="Treatment for the thing that is actually bothering you"
          description="Every course of treatment starts with a proper assessment, so you know what is wrong before anyone starts fixing it."
        />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((service, index) => (
            // The delay is capped so that the ninth card is not still waiting
            // to appear long after the user has scrolled past it.
            <Reveal key={service.id} delay={Math.min(index, 5) * 70}>
              <ServiceCard service={service} />
            </Reveal>
          ))}
        </div>

        {limit && services.length > limit && (
          <div className="mt-12 text-center">
            <Button href="/services" variant="secondary" size="lg">
              View all {services.length} treatments
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

export function ServiceCard({ service }) {
  return (
    /**
     * The whole card is one link. Two reasons:
     *   - A big tap target is much easier on a phone than a small "read more".
     *   - It is a single element in the tab order, rather than three separate
     *     links to the same page, which is tedious with a keyboard.
     *
     * `h-full` matters inside a CSS grid: without it, cards in the same row
     * have different heights whenever one description wraps to an extra line.
     */
    <Link
      href={`/services/${service.slug}`}
      className="card group flex h-full flex-col p-6 transition-all duration-300 hover:-translate-y-1.5 hover:border-brand-200 hover:shadow-lift dark:hover:border-brand-800"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 transition-all duration-300 group-hover:scale-105 group-hover:bg-brand-600 group-hover:text-[var(--color-brand-fg,#fff)] dark:bg-brand-950/60 dark:text-brand-300">
          <Icon name={service.icon} className="size-6" />
        </span>

        <div className="flex flex-col items-end gap-1.5">
          <span className="font-display text-lg font-bold text-ink-900 dark:text-white">
            {formatMoney(service.price_paise)}
          </span>
          <span className="flex items-center gap-1 text-xs text-ink-400">
            <Clock className="size-3" aria-hidden="true" />
            {service.duration_minutes} min
          </span>
        </div>
      </div>

      <h3 className="mt-5 text-lg font-bold leading-snug transition-colors group-hover:text-brand-700 dark:group-hover:text-brand-300">
        {service.name}
      </h3>

      {/* line-clamp-3 keeps every card the same height whatever the copy
          length, which is what makes a grid look tidy rather than ragged. */}
      <p className="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
        {service.short_description}
      </p>

      <div className="mt-5 flex items-center justify-between border-t border-ink-100 pt-4 dark:border-ink-800">
        {/* Showing where a treatment can happen prevents a wasted booking —
            and a patient who feels misled. */}
        <div className="flex gap-1.5">
          {Boolean(service.available_clinic) && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-ink-100 px-2 py-1 text-[11px] font-semibold text-ink-600 dark:bg-ink-800 dark:text-ink-300">
              <MapPin className="size-3" aria-hidden="true" />
              Clinic
            </span>
          )}
          {Boolean(service.available_online) && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-semibold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
              <Video className="size-3" aria-hidden="true" />
              Online
            </span>
          )}
        </div>

        <span className="flex items-center gap-1 text-sm font-semibold text-brand-700 transition-transform group-hover:translate-x-0.5 dark:text-brand-400">
          Details
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </span>
      </div>
    </Link>
  )
}
