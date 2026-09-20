'use client'

/**
 * ============================================================================
 *  ERROR BOUNDARY
 * ============================================================================
 *  Next.js renders this instead of a white screen whenever a page throws while
 *  rendering. It has to be a Client Component — that is a framework requirement,
 *  because it needs the `reset` callback and error boundaries only exist in the
 *  client React tree.
 *
 *  TWO AUDIENCES, TWO DIFFERENT NEEDS
 *  ----------------------------------
 *  The patient needs a way forward and a phone number. They must never see a stack
 *  trace: it is meaningless to them, alarming, and it can leak table names, file
 *  paths and query structure to anyone poking at the site.
 *
 *  The developer needs the actual error. So it is logged to the console and shown
 *  on screen only in development. In production the visitor gets a short digest —
 *  an id Next.js generates — which they can quote so the matching server log can be
 *  found.
 * ============================================================================
 */

import { useEffect } from 'react'
import Link from 'next/link'
import { TriangleAlert, RotateCcw, Home, Phone } from 'lucide-react'
import { platform } from '@/config/platform'
import Button from '@/components/ui/Button'

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error('[error boundary]', error)

    /**
     * Tell the server, so this is not a secret.
     *
     * Before this existed, a broken page showed the patient a polite message and
     * told the operator nothing — with twenty clinics you find out when somebody
     * finally telephones, a week later.
     *
     * `keepalive` matters: a patient who hits an error usually closes the tab, and
     * a normal fetch is cancelled the moment the page unloads. keepalive lets the
     * request outlive it, which is the difference between recording the error and
     * only recording the ones people were patient about.
     *
     * The failure is swallowed. An error boundary that throws while reporting an
     * error is a white screen, which is the one thing this page exists to prevent.
     */
    fetch('/api/report-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        message: error?.message || 'Unknown client error',
        digest: error?.digest || null,
        route: typeof window === 'undefined' ? null : window.location.pathname,
      }),
    }).catch(() => {})
  }, [error])

  const isDevelopment = process.env.NODE_ENV === 'development'

  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-lg p-8 text-center shadow-float">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
          <TriangleAlert className="size-7" aria-hidden="true" />
        </span>

        <h1 className="mt-5 text-xl font-bold">Something went wrong at our end</h1>

        <p className="mt-3 text-[15px] leading-relaxed text-ink-600 dark:text-ink-400">
          This is our fault, not yours. Nothing has been lost — any appointment you have booked is
          still confirmed. Try again, and if it keeps happening please ring the clinic.
        </p>

        {/* The real error, in development only. */}
        {isDevelopment && (
          <pre className="mt-5 max-h-40 overflow-auto rounded-xl bg-ink-900 p-4 text-left text-xs text-red-300">
            {error?.message}
            {error?.stack ? `\n\n${error.stack}` : ''}
          </pre>
        )}

        {/* In production, just the digest — enough to find the server log, and it
            reveals nothing about the internals. */}
        {!isDevelopment && error?.digest && (
          <p className="mt-4 font-mono text-xs text-ink-400">Reference: {error.digest}</p>
        )}

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {/* reset() re-renders the failed segment without a full page reload. If the
              error was transient — a dropped database connection, say — this fixes it
              instantly and the visitor keeps their place. */}
          <Button onClick={reset}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Try again
          </Button>
          <Button href="/" variant="secondary">
            <Home className="size-4" aria-hidden="true" />
            Homepage
          </Button>
          <Button href={`tel:${platform.supportPhone.replace(/\s/g, '')}`} variant="ghost">
            <Phone className="size-4" aria-hidden="true" />
            Call the clinic
          </Button>
        </div>

        <p className="mt-6 text-xs text-ink-400">
          If you were in the middle of booking, check{' '}
          <Link href="/dashboard/appointments" className="underline">
            your appointments
          </Link>{' '}
          before trying again — it may already have gone through.
        </p>
      </div>
    </div>
  )
}
