'use client'

/**
 * ============================================================================
 *  REVEAL — fade content in as it scrolls into view
 * ============================================================================
 *  Wrap anything and it animates upward into place when it first becomes
 *  visible:
 *
 *      <Reveal delay={100}><ServiceCard ... /></Reveal>
 *
 *  WHY IntersectionObserver AND NOT A SCROLL LISTENER?
 *  --------------------------------------------------
 *  A `window.addEventListener('scroll')` handler fires dozens of times per
 *  second and each call has to measure element positions, which forces the
 *  browser to recalculate layout. On a mid-range phone that is what makes
 *  scrolling feel sticky.
 *
 *  IntersectionObserver is the browser's own answer: it watches elements
 *  natively, off the main thread, and calls you exactly once when visibility
 *  changes. It is also about six lines of code.
 *
 *  WHY NOT framer-motion?
 *  ----------------------
 *  It is excellent, but it is roughly 50KB of JavaScript. For one fade-up
 *  effect, the browser's own API plus a CSS keyframe is a better trade.
 *
 *  A NOTE ON BROWSER SUPPORT
 *  -------------------------
 *  There is no fallback for browsers without IntersectionObserver, because there
 *  are none left that matter — it has been supported everywhere since 2019, and
 *  React 19 requires newer browsers than that anyway. Writing a fallback for a
 *  browser that cannot run the framework is dead code.
 * ============================================================================
 */

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export default function Reveal({ children, delay = 0, className, as: Tag = 'div' }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          // Stop watching once it has appeared. The animation should play once,
          // not every time the user scrolls back past it.
          observer.unobserve(entry.target)
        }
      },
      {
        // Start the animation slightly BEFORE the element reaches the viewport,
        // so by the time the user's eye arrives it has already finished. Firing
        // exactly at the edge means they watch things fade in, which feels slow.
        rootMargin: '0px 0px -80px 0px',
        threshold: 0.05,
      }
    )

    observer.observe(element)

    /**
     * A FAILSAFE, BECAUSE INVISIBLE CONTENT IS UNACCEPTABLE
     *
     * The observer above is the normal path and fires reliably in real browsers. This
     * timer is the guarantee: whatever happens, the content becomes visible within a
     * second and a half.
     *
     * It is not hypothetical. Headless Chrome under a virtual clock never ran the
     * observer callback at all, which left the entire homepage services grid — the
     * single most important content on the site — as a blank gap. Anything that
     * behaves like that (an odd embedded webview, a scripted screenshot service, a
     * bug in a future browser) would have hidden it from a real patient too.
     *
     * The cost is nil: a below-the-fold element that reveals itself early is not
     * something anyone can see happen.
     */
    const failsafe = setTimeout(() => setVisible(true), 1500)

    return () => {
      observer.disconnect()
      clearTimeout(failsafe)
    }
  }, [])

  return (
    <Tag
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      // `reveal` is not a styling class — it is the hook the no-JavaScript
      // overrides target. See the note at the bottom of this file.
      className={cn(
        'reveal transition-all duration-700 ease-out motion-reduce:transition-none',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0',
        className
      )}
    >
      {children}
    </Tag>
  )
}

/**
 * ============================================================================
 *  THE FAILURE MODE THIS GUARDS AGAINST
 * ============================================================================
 *  Content inside a Reveal starts at `opacity-0` and is only made visible by the
 *  effect above. So if JavaScript never runs, the content is in the HTML but
 *  permanently invisible — and the entire services grid on the homepage is wrapped
 *  in these.
 *
 *  That is a real risk, not a theoretical one. It bites when a script fails to
 *  load on a flaky mobile connection, when a corporate proxy strips JavaScript, and
 *  in text-mode or reader tools. It also caught this project out in a headless
 *  screenshot, which is what prompted the fix.
 *
 *  app/globals.css carries an `@media (scripting: none)` rule, and app/layout.js a
 *  <noscript> style block for older browsers. Both force every .reveal element
 *  visible. Search for "scripting: none" and "noscript" in those files.
 *
 *  The general lesson worth taking away: if you hide content by default and reveal
 *  it with JavaScript, you have made your content conditional on JavaScript. Always
 *  provide the no-JS path.
 * ============================================================================
 */
