
/**
 * ============================================================================
 *  CONDITIONS MARQUEE
 * ============================================================================
 *  A continuously scrolling band of the conditions the clinic treats.
 *
 *  This is doing real SEO work behind an unassuming visual. People do not search
 *  for "physiotherapy" — they search for their symptom: "sciatica treatment",
 *  "frozen shoulder", "heel pain". Every one of those phrases needs to exist in
 *  the page's text for the page to have any chance of matching that search.
 *
 *  HOW THE INFINITE SCROLL WORKS
 *  -----------------------------
 *  The list is rendered TWICE, side by side, and the whole strip is translated
 *  left by exactly 50% — the width of one copy. At the end of the animation the
 *  second copy sits precisely where the first one started, so the jump back to
 *  zero is invisible. That is the entire trick, and it needs no JavaScript.
 *
 *  The duplicate copy is aria-hidden, so a screen reader reads the list of
 *  conditions once rather than stuttering through it twice.
 * ============================================================================
 */

const CONDITIONS = [
  'Lower back pain', 'Sciatica', 'Slipped disc', 'Neck pain', 'Cervical spondylosis',
  'Frozen shoulder', 'Rotator cuff injury', 'Tennis elbow', 'Knee osteoarthritis',
  'ACL rehabilitation', 'Post knee replacement', 'Ankle sprain', 'Plantar fasciitis',
  'Heel pain', 'Hamstring strain', 'Stroke rehabilitation', 'Parkinson’s disease',
  'Bell’s palsy', 'Vertigo / BPPV', 'Posture correction', 'Text neck',
  'Pregnancy back pain', 'Diastasis recti', 'Sports injury', 'Muscle spasm',
  'Tension headache', 'Arthritis', 'Fall prevention',
]

export default function Conditions({ site }) {
  return (
    <section className="border-y border-ink-200 bg-white py-12 dark:border-ink-800 dark:bg-ink-900">
      <div className="container-page">
        <p className="text-center text-sm font-semibold text-ink-500 dark:text-ink-400">
          Conditions treated at {site.name}, {site.address.city}
        </p>
      </div>

      {/* The mask fades both ends out so the strip does not appear to be cut
          off by the edge of the screen. A gradient mask is the cleanest way to
          do this — no overlay divs that would need to match the background. */}
      <div
        className="relative mt-6 overflow-hidden"
        style={{
          maskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)',
          WebkitMaskImage: 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)',
        }}
      >
        <ul className="flex w-max animate-marquee gap-3 hover:[animation-play-state:paused]">
          {[...CONDITIONS, ...CONDITIONS].map((condition, index) => (
            <li
              key={`${condition}-${index}`}
              aria-hidden={index >= CONDITIONS.length ? 'true' : undefined}
              className="whitespace-nowrap rounded-full border border-ink-200 bg-sand-50 px-4 py-2 text-sm font-medium text-ink-700 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200"
            >
              {condition}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/*  TRUST BAR                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The four headline numbers. Kept in config/site.js so they are edited in one
 * place — and so it is obvious they are claims about the clinic that somebody
 * is responsible for keeping honest.
 */
export function TrustBar({ site }) {
  return (
    /**
     * `-mt-8` lifts the card up so it straddles the boundary with the hero, which is
     * the effect we want. The bottom margin is the part that was missing: the hero's
     * padding all sits ABOVE this card, so without `mb-*` the card's bottom edge
     * landed flush against the conditions band below and looked like a mistake rather
     * than a design.
     */
    <section className="container-page relative z-10 -mt-8 mb-14 lg:mb-20">
      <div className="card grid grid-cols-2 divide-ink-100 overflow-hidden p-0 shadow-lift lg:grid-cols-4 lg:divide-x dark:divide-ink-800">
        {site.stats.map((stat) => (
          <div key={stat.label} className="border-b border-ink-100 p-6 text-center lg:border-b-0 dark:border-ink-800">
            <p className="font-display text-3xl font-bold text-brand-700 dark:text-brand-400">
              {stat.value}
            </p>
            <p className="mt-1 text-xs font-medium text-ink-500 dark:text-ink-400">{stat.label}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
