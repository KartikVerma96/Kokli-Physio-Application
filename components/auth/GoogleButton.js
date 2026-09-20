'use client'

/**
 * ============================================================================
 *  GOOGLE SIGN-IN BUTTON
 * ============================================================================
 *  Starts the OAuth flow. One line does the actual work; the rest is the
 *  official Google logo and a loading state.
 *
 *  WHAT HAPPENS WHEN THIS IS CLICKED
 *  ---------------------------------
 *   1. signIn('google') sends the browser to accounts.google.com with our
 *      client id and the callback URL registered in Google Cloud Console.
 *   2. The patient picks their account and approves. Their password is only
 *      ever typed on Google's domain — we never see it, which is the entire
 *      security argument for OAuth.
 *   3. Google redirects back to /api/auth/callback/google with a short-lived
 *      code.
 *   4. Auth.js exchanges that code for tokens on the SERVER, using the client
 *      secret. This is why the secret must never be exposed to the browser.
 *   5. Our signIn callback in lib/auth.js creates or links the MySQL user row.
 *   6. A session cookie is set and the patient lands on callbackUrl.
 *
 *  Note there is no `redirect: false` here, unlike the password form. The
 *  redirect IS the mechanism — there is no way to do OAuth without leaving the
 *  page.
 * ============================================================================
 */

import { useState } from 'react'
import { signIn } from 'next-auth/react'

export default function GoogleButton({ callbackUrl = '/dashboard', label = 'Continue with Google' }) {
  const [loading, setLoading] = useState(false)

  function handleClick() {
    // The button stays in its loading state permanently, because the page is
    // about to be replaced by Google's. Resetting it would be pointless — and
    // a button that springs back to normal while the browser is navigating away
    // looks broken.
    setLoading(true)
    signIn('google', { callbackUrl })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-ink-200 bg-white text-sm font-semibold text-ink-800 shadow-soft transition-all hover:border-ink-300 hover:shadow-lift disabled:opacity-60 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100 dark:hover:border-ink-600"
    >
      {loading ? (
        <>
          <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Redirecting to Google…
        </>
      ) : (
        <>
          {/* Google's brand guidelines require their actual four-colour mark —
              not a recoloured or monochrome version. */}
          <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
            />
          </svg>
          {label}
        </>
      )}
    </button>
  )
}
