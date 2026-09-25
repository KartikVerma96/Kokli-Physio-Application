/**
 * ============================================================================
 *  CONDITIONS MARQUEE
 * ============================================================================
 *  A continuously scrolling line of the conditions the clinic treats.
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
    /**
     * A flat band in the clinic's own deep colour. No glow, no drifting orbs,
     * no fade at the edges — the colour simply starts and stops, and the
     * scrolling line is the only thing moving.
     */
    <section className="relative overflow-hidden bg-brand-950 py-16 text-white">
      <div className="container-page">
        {/* Not "What we treat" — the treatments section above already uses that
            as its eyebrow, and two sections wearing the same label read as a
            mistake. */}
        <p className="text-center text-[11px] font-bold uppercase tracking-[0.18em] text-brand-300">
          Common problems
        </p>
        <p className="mt-2 text-center text-sm text-white/70">
          Conditions treated at {site.name}
          {site.address.city ? `, ${site.address.city}` : ''}
        </p>
      </div>

      {/* ONE line, not two. Two rows filled the band but gave a reader twice as
          much to track and nothing more to learn; one slow line is calmer, and
          it leaves the colour behind it doing the work.

          The pills are DARK glass, not light. Pale pills on the clinic's deep
          colour came out as maroon on maroon and the words went soft; a darker
          fill with a hairline highlight along the top reads as recessed glass,
          and the text sits on it cleanly.

          The mask fades both ends so the line is not seen to be cut by the edge
          of the screen. */}
      <div
        className="relative mt-7 overflow-hidden"
        style={{
          maskImage: 'linear-gradient(to right, transparent, black 16%, black 84%, transparent)',
          WebkitMaskImage: 'linear-gradient(to right, transparent, black 16%, black 84%, transparent)',
        }}
      >
        {/* 64s rather than 40s: at a walking pace the words can actually be read
            as they pass, which is the entire point of the strip. */}
        <ul className="flex w-max animate-marquee gap-3 [animation-duration:64s] hover:[animation-play-state:paused]">
          {[...CONDITIONS, ...CONDITIONS].map((condition, index) => (
            <li
              key={`${condition}-${index}`}
              aria-hidden={index >= CONDITIONS.length ? 'true' : undefined}
              className="flex items-center gap-2.5 whitespace-nowrap rounded-full border border-white/12 bg-black/25 px-5 py-2.5 text-[15px] font-medium text-white/90 shadow-[inset_0_1px_0_rgb(255_255_255/0.10)] backdrop-blur-sm transition-colors hover:border-white/30 hover:bg-black/35 hover:text-white"
            >
              <span className="size-1.5 rounded-full bg-brand-300" aria-hidden="true" />
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
  // No numbers, no bar. An empty card straddling the hero looks broken, and a
  // clinic that has not entered real figures should not be shown any.
  if (!site.stats.length) return null

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
