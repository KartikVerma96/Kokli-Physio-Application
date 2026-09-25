'use client'

/**
 * ============================================================================
 *  ROUTE PROGRESS — the thin line across the top during a page change
 * ============================================================================
 *  The bar YouTube, GitHub and Vercel all have: a click starts it, the new page
 *  finishes it. It exists for one reason — between tapping "Book appointment"
 *  on a phone and the next screen arriving there can be a second of nothing, and
 *  a second of nothing is what makes people tap again.
 *
 *  WHY THIS IS HAND-WRITTEN AND NOT A PACKAGE
 *  ------------------------------------------
 *  The App Router has no router events to subscribe to — `router.events` was a
 *  Pages Router API and is gone. Every package that does this works the same way
 *  underneath, and the way is short enough to own:
 *
 *      START   a click on an internal <a> that will actually navigate,
 *              or a back/forward button press
 *      FINISH  the pathname or query string changing, which only happens once
 *              the new page has rendered
 *
 *  The bar creeps towards 90% and waits there. That is deliberate: it can never
 *  honestly know how far along a navigation is, so it shows movement without
 *  ever claiming to be nearly done, and the jump to 100% is the real arrival.
 *
 *  COLOUR
 *  ------
 *  `bg-brand-500` — the clinic's own colour on a clinic's site, Kokli's teal on
 *  kokli.in, because the brand palette is set per tenant on <html>. See
 *  brandStyle() in lib/brand.js.
 * ============================================================================
 */

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

/** How far the creep is allowed to get before the page actually arrives. */
const CEILING = 90

export default function RouteProgress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState(false)

  // Refs, not state: these are read and written inside timers, where a stale
  // closure over state would silently freeze the bar.
  const timer = useRef(null)
  const done = useRef(null)

  useEffect(() => {
    /** Creep towards the ceiling in ever smaller steps, so it never stalls. */
    function start() {
      if (timer.current) return
      clearTimeout(done.current)
      setVisible(true)
      setWidth(8)
      timer.current = setInterval(() => {
        setWidth((current) => {
          if (current >= CEILING) return current
          // Big steps early, small ones later: 8 → 40 quickly, then a crawl.
          const step = current < 40 ? 8 : current < 70 ? 3 : 1
          return Math.min(CEILING, current + step)
        })
      }, 220)
    }

    /**
     * A click that will really navigate. Everything else is left alone: other
     * tabs, downloads, new windows, anchors on the same page, and the
     * modifier-clicks people use to open links in a background tab.
     */
    function onClick(event) {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return

      const url = new URL(link.href, window.location.href)
      if (url.origin !== window.location.origin) return
      // Same page — a hash link or the page you are already on.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return

      start()
    }

    document.addEventListener('click', onClick, true)
    window.addEventListener('popstate', start)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', start)
      clearInterval(timer.current)
      clearTimeout(done.current)
    }
  }, [])

  /**
   * The new page has rendered: fill the bar, then fade it away.
   *
   * This also runs on first load, where there is nothing to finish — hence the
   * `timer.current` check, so the bar never flashes on arrival.
   */
  useEffect(() => {
    if (!timer.current) return
    clearInterval(timer.current)
    timer.current = null
    setWidth(100)
    done.current = setTimeout(() => {
      setVisible(false)
      setWidth(0)
    }, 260)
  }, [pathname, searchParams])

  return (
    <div
      // Above the sticky header (z-50) and the mobile menu (z-40), because a
      // progress bar hidden behind the thing you just clicked is no use.
      className="pointer-events-none fixed inset-x-0 top-0 z-200 h-0.5"
      aria-hidden="true"
    >
      <div
        className="h-full bg-brand-500 transition-[width,opacity] duration-200 ease-out"
        style={{
          width: `${width}%`,
          opacity: visible ? 1 : 0,
          // The glow is what makes it read as a light rather than a rectangle,
          // and it is the clinic's colour too.
          boxShadow: '0 0 8px rgb(var(--brand-rgb-500) / 0.9), 0 0 3px rgb(var(--brand-rgb-500) / 0.7)',
        }}
      />
    </div>
  )
}
