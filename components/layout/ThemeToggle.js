'use client'

/**
 * ============================================================================
 *  THEME TOGGLE
 * ============================================================================
 *  Switches the `dark` class on <html>, which is what every `dark:` Tailwind
 *  class in the app responds to.
 *
 *  THE FLASH-OF-WRONG-THEME PROBLEM
 *  --------------------------------
 *  If you only set the class from a useEffect, the page paints in light mode
 *  first and then snaps to dark a moment later. It is brief, ugly, and on a
 *  dark-mode phone at night it is genuinely unpleasant.
 *
 *  The fix is in app/layout.js: a tiny inline <script> that runs BEFORE the
 *  browser paints anything, reads the saved choice, and sets the class. By the
 *  time this React component mounts, the theme is already correct — this
 *  component only reads it back so the icon matches.
 * ============================================================================
 */

import { useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'

/**
 * READING A BROWSER VALUE, THE CORRECT WAY
 *
 * The current theme does not live in React state — it lives in the DOM, as a class
 * on <html>, put there by the inline script in layout.js before React even loads.
 * That makes it an "external store", and React has an API for exactly this:
 * useSyncExternalStore.
 *
 * It takes three functions:
 *   subscribe        how to be told when the value changes
 *   getSnapshot      how to read the current value in the browser
 *   getServerSnapshot how to read it on the server, where there is no document
 *
 * Using it rather than `useEffect(() => setIsDark(...), [])` matters for a real
 * reason: React knows this value comes from outside, so it reads the server
 * snapshot during hydration and the real one immediately afterwards — no mismatch
 * warning, and no extra render pass.
 */

/** Watch the class attribute on <html> for changes. */
function subscribe(onChange) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

const getSnapshot = () => document.documentElement.classList.contains('dark')

// On the server there is no <html> element to inspect, so we assume light. The
// inline script has already applied the real theme by the time anyone sees the page.
const getServerSnapshot = () => false

export default function ThemeToggle() {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  function toggle() {
    const next = !document.documentElement.classList.contains('dark')
    // Changing the class is the ONLY state change needed — the MutationObserver
    // above notices it and React re-renders with the new value. There is no
    // separate piece of React state to keep in sync, and therefore nothing that can
    // fall out of sync.
    document.documentElement.classList.toggle('dark', next)
    // Persisted so the choice survives a reload. The inline script in layout.js
    // reads this key.
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="grid size-10 place-items-center rounded-xl text-ink-600 transition-colors hover:bg-brand-50 dark:text-ink-300 dark:hover:bg-brand-500/10"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {/* A sun to switch to light, a moon to switch to dark. No placeholder state
          is needed: useSyncExternalStore gives a definite value on the very first
          render, on the server as well as in the browser. */}
      {isDark ? (
        <Sun className="size-4.5" aria-hidden="true" />
      ) : (
        <Moon className="size-4.5" aria-hidden="true" />
      )}
    </button>
  )
}
