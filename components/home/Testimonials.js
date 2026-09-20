import { Star } from 'lucide-react'
import { SectionHeading } from '@/components/ui/Card'
import Reveal from '@/components/ui/Reveal'
import { initials, formatDateShort } from '@/lib/utils'

/**
 * ============================================================================
 *  TESTIMONIALS
 * ============================================================================
 *  Shows approved reviews from the `reviews` table. If a clinic has fewer than
 *  three, this section RENDERS NOTHING.
 *
 *  WHY IT NO LONGER FALLS BACK TO PLACEHOLDERS
 *  -------------------------------------------
 *  The single-clinic version showed example testimonials until real ones
 *  existed, clearly labelled as examples. That was defensible when one developer
 *  owned the one site and would obviously replace them.
 *
 *  On a platform it is not. Placeholder testimonials would appear on a real
 *  clinic's live website, describing patient outcomes that never happened, under
 *  a real physiotherapist's registration number. A clinic owner who never
 *  scrolled that far would be publishing invented medical claims without
 *  realising it.
 *
 *  These reviews also become Review structured data (lib/seo.js) — the ⭐ ratings
 *  beside a Google result. Fabricated ones breach Google's policy and can strip
 *  rich results from the whole domain, and for a healthcare provider inventing
 *  patient outcomes is a professional problem, not just an SEO one.
 *
 *  So: real reviews or nothing. Showing an empty space is honest; showing
 *  invented praise is not, and the platform must not make that decision on a
 *  clinic's behalf.
 * ============================================================================
 */

export default function Testimonials({ reviews = [] }) {
  // Three is the threshold Google itself expects before aggregate ratings mean
  // anything, and it is also the point at which a testimonials section stops
  // looking sparse.
  if (reviews.length < 3) return null

  const items = reviews.map((review) => ({
    name: review.patient_name,
    role: review.service_name || 'Patient',
    rating: review.rating,
    text: review.comment,
    date: review.created_at,
  }))

  return (
    <section className="arc-left relative overflow-hidden py-20 lg:py-28">
      <div className="container-page">
        <SectionHeading
          eyebrow="Patient stories"
          title="People who were told to just live with it"
          description="Real recoveries from the clinic — back pain, frozen shoulder, ACL rehab and arthritis."
        />

        {/* On desktop this is a masonry-style column layout so cards of
            different lengths pack tightly instead of leaving gaps. */}
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {items.slice(0, 4).map((item, index) => (
            <Reveal key={`${item.name}-${index}`} delay={index * 80}>
              <figure className="card flex h-full flex-col p-6">
                <Stars rating={item.rating} />

                {/* <blockquote> inside <figure> with <figcaption> is the
                    semantically correct markup for an attributed quotation.
                    Assistive technology announces the relationship between the
                    quote and who said it. */}
                <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-ink-700 dark:text-ink-300">
                  “{item.text}”
                </blockquote>

                <figcaption className="mt-5 flex items-center gap-3 border-t border-ink-100 pt-4 dark:border-ink-800">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                    {initials(item.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{item.name}</span>
                    <span className="block truncate text-xs text-ink-500 dark:text-ink-400">
                      {item.role}
                    </span>
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>

      </div>
    </section>
  )
}

/**
 * A star rating.
 *
 * Note the aria-label on the wrapper and aria-hidden on the stars: a screen
 * reader should hear "Rated 5 out of 5", not "star star star star star".
 */
export function Stars({ rating = 5, className = 'size-4' }) {
  return (
    <div className="flex gap-0.5" role="img" aria-label={`Rated ${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${className} ${n <= rating ? 'fill-sun-400 text-sun-400' : 'fill-ink-200 text-ink-200 dark:fill-ink-700 dark:text-ink-700'}`}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}
