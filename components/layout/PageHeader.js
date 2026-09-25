import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

/**
 * ============================================================================
 *  PAGE HEADER
 * ============================================================================
 *  The banner at the top of every inner page: breadcrumbs, an eyebrow label, the
 *  <h1>, and a short description.
 *
 *  THE BREADCRUMBS ARE NOT DECORATION
 *  ----------------------------------
 *  They do three separate jobs:
 *
 *    1. Orientation. Someone who arrived on /services/frozen-shoulder straight
 *       from Google has no idea where they are in the site. The trail tells them,
 *       and gives them a way up rather than only back.
 *
 *    2. Internal linking. Every service page links back to /services, which
 *       concentrates ranking signal on the hub page.
 *
 *    3. Rich results. Paired with the BreadcrumbList structured data in
 *       lib/seo.js, Google replaces the ugly raw URL in its results with
 *       "aarogyaphysio.in › Services › Frozen Shoulder", which measurably
 *       improves click-through.
 * ============================================================================
 */

export default function PageHeader({ eyebrow, title, description, breadcrumb = [], children }) {
  return (
    // The old pt-10 plus the height the floating header overlays: 76px on a
    // phone, 84px from lg. See the note in Navbar.js.
    <section className="mesh-bg relative overflow-hidden border-b border-ink-200 pb-12 pt-29 lg:pt-31 dark:border-ink-800">
      <div className="container-page">
        {/* -------------------------------------------------- breadcrumbs */}
        {breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-6">
            <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-500 dark:text-ink-400">
              <li>
                <Link href="/" className="transition-colors hover:text-brand-700 dark:hover:text-brand-300">
                  Home
                </Link>
              </li>
              {breadcrumb.map((crumb, index) => {
                const isLast = index === breadcrumb.length - 1
                return (
                  <li key={crumb.name} className="flex items-center gap-1">
                    <ChevronRight className="size-3.5 text-ink-300" aria-hidden="true" />
                    {isLast || !crumb.path ? (
                      // The current page is not a link — linking to where you
                      // already are is confusing, and aria-current announces it.
                      <span aria-current="page" className="font-medium text-ink-700 dark:text-ink-200">
                        {crumb.name}
                      </span>
                    ) : (
                      <Link
                        href={crumb.path}
                        className="transition-colors hover:text-brand-700 dark:hover:text-brand-300"
                      >
                        {crumb.name}
                      </Link>
                    )}
                  </li>
                )
              })}
            </ol>
          </nav>
        )}

        <div className="max-w-3xl">
          {eyebrow && (
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600 dark:text-brand-400">
              {eyebrow}
            </p>
          )}

          {/* One <h1> per page, and it lives here. */}
          <h1 className="mt-3 text-3xl font-bold leading-tight text-balance sm:text-4xl lg:text-[2.75rem]">
            {title}
          </h1>

          {description && (
            <p className="mt-5 text-lg leading-relaxed text-ink-600 text-pretty dark:text-ink-300">
              {description}
            </p>
          )}

          {children && <div className="mt-7">{children}</div>}
        </div>
      </div>
    </section>
  )
}
