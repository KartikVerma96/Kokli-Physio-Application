import Link from 'next/link'
import {
  ArrowRight, CalendarCheck, ShieldCheck, Star, Video, MapPin, Clock, CheckCircle2,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import { formatTime, formatDateRelative, firstName, countOf } from '@/lib/utils'
import { joinDot } from '@/lib/clinicView'

/**
 * ============================================================================
 *  HERO
 * ============================================================================
 *  The first screen. It has about three seconds to answer four questions:
 *  what is this, is it near me, can they help my problem, and how do I start?
 *
 *  A Server Component, deliberately — this is the most important content on the
 *  site for search, and it arrives inside the HTML rather than being drawn by
 *  JavaScript afterwards.
 *
 *  THE <h1>
 *  --------
 *  Exactly one per page, and it is the strongest on-page ranking signal there
 *  is. Ours contains the service and the city ("Physiotherapy in Pune"),
 *  because that is what people actually type into Google. Writing something
 *  like "Welcome to our website" here wastes the single most valuable line on
 *  the page.
 * ============================================================================
 */

export default function Hero({ site, nextSlot, servicesCount = 10 }) {
  /**
   * The stats array is whatever the clinic chose to fill in — it may be empty,
   * and the "rating" entry is only there by convention. Find it by looking for a
   * label mentioning rating rather than by index, and drop the badge entirely if
   * there is nothing worth showing.
   */
  const rating = site.stats.find((s) => /rating/i.test(s?.label || ''))?.value ?? null

  const badge =
    [
      site.doctor.experienceYears ? `${site.doctor.experienceYears} years` : null,
      site.address.city ? `in ${site.address.city}` : null,
    ]
      .filter(Boolean)
      .join(' ') || null

  return (
    // The extra top padding is the floating header, which overlays this section
    // rather than sitting in a band above it: 76px on a phone, 84px from lg.
    // See the note in Navbar.js — change one and the other has to follow.
    <section className="mesh-bg relative overflow-hidden pt-31 pb-20 lg:pt-41 lg:pb-28">
      {/* Two large soft blobs drifting behind the content. `aria-hidden` and
          pointer-events-none keep them decorative — invisible to screen readers
          and unable to intercept a click. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -top-24 size-120 rounded-full bg-brand-300/20 blur-3xl animate-float dark:bg-brand-700/20"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 -left-24 size-104 rounded-full bg-sun-300/20 blur-3xl animate-float [animation-delay:2.5s] dark:bg-sun-700/10"
      />

      <div className="container-page relative">
        <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-10">
          {/* ================================================== left column */}
          <div className="animate-fade-up">
            {/*
              Trust badge. Naming the city immediately answers "is this near me?",
              which is the first thing a local searcher checks.

              EVERY PART OF THIS IS OPTIONAL, AND THAT IS THE POINT.
              This used to read `site.stats[2].value` directly, which crashed the
              entire homepage of any clinic that had not filled in at least three
              stats — a brand new tenant, in other words. On a single-clinic site
              that was safe because the array was a constant in config/site.js. On
              a platform it is customer data, and customer data is always partly
              missing. Anything read from a clinic row needs a fallback.
            */}
            {badge && (
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/70 py-1.5 pl-1.5 pr-4 text-sm font-medium shadow-soft backdrop-blur dark:border-brand-800 dark:bg-ink-900/70">
                {rating && (
                  <span className="flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-bold text-[var(--color-brand-fg,#fff)]">
                    <Star className="size-3 fill-current" aria-hidden="true" />
                    {rating}
                  </span>
                )}
                <span className="text-ink-700 dark:text-ink-200">{badge}</span>
              </div>
            )}

            <h1 className="mt-6 text-4xl font-bold leading-[1.08] tracking-tight text-balance sm:text-5xl lg:text-[3.5rem]">
              Physiotherapy{site.address.city ? ` in ${site.address.city}` : ''} that gets you{' '}
              <span className="text-gradient">back to living</span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-600 text-pretty dark:text-ink-300">
              Back pain, sports injuries, frozen shoulder, post-surgery recovery — treated with
              hands-on care and a plan you actually understand. See {firstName(site.doctor.name)}{' '}
              at the clinic, or over video from home.
            </p>

            {/* ----------------------------------------------------- CTAs */}
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button href="/book" size="lg">
                Book an appointment
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
              <Button href="/services" variant="secondary" size="lg">
                See all treatments
              </Button>
            </div>

            {/* --------------------------------------------- reassurances */}
            {/* Answering the objections a person has while their finger hovers
                over the button. Each of these removes one reason to leave. */}
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2.5 text-sm text-ink-600 dark:text-ink-400">
              {[
                'No referral needed',
                `Free cancellation up to ${site.booking.freeCancellationHours}h before`,
                'GST invoice for insurance',
              ].map((point) => (
                <li key={point} className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* ================================================= right column */}
          <div className="relative animate-fade-up stagger-2 lg:pl-6">
            {/* -------------------------------------- next-available card */}
            <div className="card relative overflow-hidden p-6 shadow-float lg:p-7">
              {/* A subtle brand wash across the top of the card. */}
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-28 bg-linear-to-b from-brand-50 to-transparent dark:from-brand-950/40"
              />

              <div className="relative">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-brand-600 dark:text-brand-400">
                      Next available
                    </p>
                    {/* This is real data, read from the database on the server.
                        A specific time is far more persuasive than "Book now"
                        because it removes the fear of a two-week wait. */}
                    {nextSlot ? (
                      <p className="mt-1.5 text-2xl font-bold">
                        {formatDateRelative(nextSlot.date)}, {formatTime(nextSlot.startTime)}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-2xl font-bold">Book your slot</p>
                    )}
                  </div>
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-600 text-[var(--color-brand-fg,#fff)] shadow-brand">
                    <CalendarCheck className="size-5" aria-hidden="true" />
                  </span>
                </div>

                {/* --------------------------------- the two ways to be seen */}
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <Link
                    href="/book?mode=clinic"
                    className="group rounded-2xl border border-ink-200 p-4 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift dark:border-ink-700"
                  >
                    <MapPin className="size-5 text-brand-600" aria-hidden="true" />
                    <p className="mt-2.5 text-sm font-bold">At the clinic</p>
                    <p className="mt-0.5 text-xs leading-snug text-ink-500 dark:text-ink-400">
                      Hands-on treatment in {site.address.city}
                    </p>
                  </Link>

                  <Link
                    href="/book?mode=online"
                    className="group rounded-2xl border border-ink-200 p-4 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift dark:border-ink-700"
                  >
                    <Video className="size-5 text-brand-600" aria-hidden="true" />
                    <p className="mt-2.5 text-sm font-bold">Online video</p>
                    <p className="mt-0.5 text-xs leading-snug text-ink-500 dark:text-ink-400">
                      From anywhere, same day
                    </p>
                  </Link>
                </div>

                <div className="mt-6 space-y-2.5 border-t border-ink-100 pt-5 text-sm dark:border-ink-800">
                  {site.openingHours[0] && (
                    <p className="flex items-center gap-2 text-ink-600 dark:text-ink-300">
                      <Clock className="size-4 shrink-0 text-ink-400" aria-hidden="true" />
                      {site.openingHours[0].days}: {site.openingHours[0].time}
                    </p>
                  )}
                  <p className="flex items-center gap-2 text-ink-600 dark:text-ink-300">
                    <ShieldCheck className="size-4 shrink-0 text-ink-400" aria-hidden="true" />
                    {countOf(servicesCount, 'treatment')} · secure online payment
                  </p>
                </div>
              </div>
            </div>

            {/* The credential chip.
                It used to be absolutely positioned over the card's bottom-left
                corner, which looked good in isolation and covered the "10
                treatments · secure online payment" line underneath it. Sitting it
                below the card in normal flow cannot overlap anything at any
                breakpoint — a good reminder that absolute positioning over content
                you do not control is a bug waiting for a longer string. */}
            <div className="mt-4 flex animate-fade-up stagger-4 items-center gap-2.5 rounded-2xl border border-ink-200 bg-white p-3 pr-4 shadow-soft dark:border-ink-700 dark:bg-ink-900">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sun-100 text-sun-700 dark:bg-sun-950/60 dark:text-sun-300">
                <ShieldCheck className="size-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-bold leading-tight">{site.doctor.credentials || site.doctor.title}</p>
                <p className="text-[11px] leading-tight text-ink-500">
                  {joinDot('Registered physiotherapist', site.doctor.registration)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
