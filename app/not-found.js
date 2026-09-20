import Link from 'next/link'
import { Stethoscope, Home, CalendarCheck, Search } from 'lucide-react'
import { platform } from '@/config/platform'
import Button from '@/components/ui/Button'

/**
 * ============================================================================
 *  404 — PAGE NOT FOUND
 * ============================================================================
 *  Next.js renders this for any unmatched URL, and for any page that calls
 *  notFound(). It correctly returns an HTTP 404 status, which matters: a
 *  "not found" page that returns 200 gets indexed by Google as a real page, and
 *  that is a classic and damaging SEO mistake.
 *
 *  It offers the three places somebody who got lost is most likely heading, rather
 *  than a dead end. A 404 that only says "404" wastes a visitor you already have.
 *
 *  ---------------------------------------------------------------------------
 *  A TRAP THAT COST REAL DEBUGGING TIME ON THIS PROJECT — WORTH KNOWING
 *  ---------------------------------------------------------------------------
 *  There is deliberately NO loading.js anywhere in this app, and that is not an
 *  oversight.
 *
 *  A loading.js wraps everything beneath it in a Suspense boundary, which makes
 *  Next.js begin STREAMING the response immediately. Once streaming has started the
 *  HTTP status is already committed as 200 — so a later notFound() can still swap
 *  in this page's content, but it can no longer change the status code.
 *
 *  This project briefly had an app/loading.js, and the result was that
 *  /services/a-slug-that-does-not-exist returned "200 OK" with 404 content. That is
 *  a soft 404: Google treats it as a real page, crawls it, sometimes indexes it, and
 *  it dilutes the site's quality signals. The bug is completely invisible in a
 *  browser — the page looks like a perfectly normal 404.
 *
 *  Every page here renders in single-digit to low-double-digit milliseconds from a
 *  pooled connection, so a skeleton was buying very little. Correct status codes are
 *  worth more.
 *
 *  If you ever do add a loading.js, put it only under a route that never calls
 *  notFound(), and check with:
 *      curl -o /dev/null -w '%{http_code}' localhost:3000/services/nope
 *  It must print 404.
 * ============================================================================
 */

export const metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return (
    <div className="mesh-bg flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <Link href="/" className="flex items-center gap-2.5">
        <span className="grid size-10 place-items-center rounded-2xl bg-linear-to-br from-brand-500 to-brand-700 text-white shadow-brand">
          <Stethoscope className="size-5" aria-hidden="true" />
        </span>
        <span className="font-display text-base font-bold">{platform.name}</span>
      </Link>

      <p className="mt-12 font-display text-7xl font-bold text-brand-600/20 dark:text-brand-400/20">
        404
      </p>

      <h1 className="mt-2 text-2xl font-bold sm:text-3xl">We cannot find that page</h1>

      <p className="mt-3 max-w-md text-ink-600 dark:text-ink-400">
        The link may be out of date, or the page may have moved. Nothing is wrong with your
        appointment — everything is still where it should be in your dashboard.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button href="/">
          <Home className="size-4" aria-hidden="true" />
          Homepage
        </Button>
        <Button href="/services" variant="secondary">
          <Search className="size-4" aria-hidden="true" />
          Browse treatments
        </Button>
        <Button href="/book" variant="ghost">
          <CalendarCheck className="size-4" aria-hidden="true" />
          Book an appointment
        </Button>
      </div>

      <p className="mt-10 text-sm text-ink-500">
        Still stuck? Call the clinic on{' '}
        <a
          href={`tel:${platform.supportPhone.replace(/\s/g, '')}`}
          className="font-semibold text-brand-700 hover:underline dark:text-brand-400"
        >
          {platform.supportPhone}
        </a>
      </p>
    </div>
  )
}
