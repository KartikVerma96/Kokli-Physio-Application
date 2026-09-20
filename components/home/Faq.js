import { ChevronDown, MessageCircleQuestion } from 'lucide-react'
import { whatsappLink } from '@/lib/clinicView'
import { SectionHeading } from '@/components/ui/Card'
import Button from '@/components/ui/Button'

/**
 * ============================================================================
 *  FAQ
 * ============================================================================
 *  Built from <details> and <summary>, which are native HTML elements that
 *  expand and collapse on their own.
 *
 *  WHY NOT A REACT ACCORDION WITH useState?
 *  ---------------------------------------
 *  Because this needs none. <details> gives us, for free:
 *
 *    - open/close behaviour with zero JavaScript
 *    - correct keyboard support (Enter and Space) that we cannot get wrong
 *    - correct screen reader announcements ("expanded" / "collapsed")
 *    - working in-page search: Ctrl+F finds text inside a closed panel and
 *      the browser opens it automatically. A useState accordion cannot do that
 *      at all, because the text is not in the DOM.
 *    - it stays a Server Component, so it ships no JavaScript whatsoever
 *
 *  This is worth internalising as a general principle: reach for the platform
 *  first. A React version of this would be more code, slower, and worse.
 *
 *  THE SEO ANGLE
 *  -------------
 *  These same questions are emitted as FAQPage structured data by the page that
 *  renders this component, which is what produces the expandable Q&A blocks
 *  directly in Google's results. That only works if the answers are genuinely
 *  present in the HTML — which, because <details> keeps its content in the DOM
 *  even when closed, they are.
 * ============================================================================
 */

export default function Faq({ site, items }) {
  const questions = items ?? site.faqs ?? []
  return (
    <section id="faq" className="bg-white py-20 lg:py-28 dark:bg-ink-900">
      <div className="container-page">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          {/* ------------------------------------------------ left column */}
          <div className="lg:col-span-4">
            {/* lg:sticky keeps this panel in view while the reader works down
                a long list of questions. */}
            <div className="lg:sticky lg:top-28">
              <SectionHeading
                eyebrow="Questions"
                title="Things patients ask us first"
                align="left"
                description="If your question is not here, message us on WhatsApp — you will usually get an answer the same day."
              />

              <div className="mt-8 rounded-2xl border border-ink-200 p-5 dark:border-ink-700">
                <MessageCircleQuestion className="size-6 text-brand-600" aria-hidden="true" />
                <p className="mt-3 text-sm font-bold">Not sure which treatment you need?</p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
                  Book the 60-minute assessment. We work out the diagnosis and the plan, and it
                  counts as your first treatment session.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button href="/book" size="sm">Book assessment</Button>
                  <Button
                    href={whatsappLink(site)}
                    variant="ghost"
                    size="sm"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    WhatsApp us
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* ----------------------------------------------- the questions */}
          <div className="lg:col-span-8">
            <div className="divide-y divide-ink-100 dark:divide-ink-800">
              {questions.map((item, index) => (
                <details
                  key={item.q}
                  // The first one starts open, so it is immediately obvious that
                  // these expand rather than being plain headings.
                  open={index === 0}
                  className="group py-2"
                >
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-4 text-left">
                    {/* h3 inside summary keeps the document outline correct:
                        each question is a real heading under the section's h2. */}
                    <h3 className="text-base font-bold leading-snug transition-colors group-open:text-brand-700 dark:group-open:text-brand-300">
                      {item.q}
                    </h3>
                    <ChevronDown
                      className="mt-0.5 size-5 shrink-0 text-ink-400 transition-transform duration-200 group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>

                  <div className="pb-5 pr-10 text-[15px] leading-relaxed text-ink-600 dark:text-ink-400">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/*  CLOSING CALL TO ACTION                                                    */
/* -------------------------------------------------------------------------- */

export function CtaBand({ site }) {
  return (
    <section className="arc-right relative overflow-hidden py-20 lg:py-24">
      <div className="container-page">
        {/*
          THIS PANEL KEEPS ITS OWN WIDTH, NARROWER THAN THE PAGE
          ------------------------------------------------------
          Everything else on the page is content that grows happily with the
          container. This does not: it is a centred headline, one line of copy and two
          buttons, all capped at max-w-2xl inside. Let the panel run to the full
          1536px and that narrow column of text ends up marooned in the middle of a
          very wide, very short teal banner.

          76rem (1216px) is exactly the width it had before the page container was
          widened, which is the proportion it was designed at — wide enough to feel
          like a full-width band, narrow enough that the content still owns it.

          The general point: a panel whose contents are centred and capped has an
          ideal width of its own, and should not simply inherit the page's.
        */}
        <div className="relative mx-auto max-w-[76rem] overflow-hidden rounded-4xl bg-linear-to-br from-brand-700 via-brand-600 to-brand-800 px-6 py-14 text-center sm:px-14 lg:py-20">
          {/* Decorative bloom, matching the hero so the page feels bookended. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-sun-300/25 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-32 -left-24 size-96 rounded-full bg-brand-300/20 blur-3xl"
          />

          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-3xl font-bold text-balance text-white sm:text-4xl lg:text-[2.75rem]">
              Pain you have been putting up with is usually treatable
            </h2>

            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-brand-50 text-pretty">
              Book a slot in the next minute, or call the clinic and speak to us directly. Free
              cancellation up to {site.booking.freeCancellationHours} hours before.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button href="/book" variant="accent" size="lg">
                Book an appointment
              </Button>
              <Button
                href={`tel:${site.contact.phone.replace(/\s/g, '')}`}
                size="lg"
                className="border border-white/30 bg-white/10 text-white shadow-none hover:bg-white/20"
              >
                {site.contact.phone}
              </Button>
            </div>

            <p className="mt-6 text-sm text-brand-100/80">
              {site.address.city} clinic · Online video consultations across India
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
