import Link from 'next/link'
import { Stethoscope } from 'lucide-react'
import { platform } from '@/config/platform'
import Button from '@/components/ui/Button'
import ThemeToggle from '@/components/layout/ThemeToggle'

/**
 * ============================================================================
 *  PLATFORM LAYOUT — YOUR marketing site, on the root domain
 * ============================================================================
 *
 *  A completely separate shell from app/(public)/, which is a clinic's website.
 *  Two route groups, two audiences, no shared chrome:
 *
 *      app/(platform)/   kokli.local          → physiotherapists buying
 *      app/(public)/     aarogya.kokli.local  → patients booking
 *
 *  Keeping them apart matters more than it might look. The clinic layout resolves
 *  a tenant and 404s without one; this layout must work with no tenant at all.
 *  Trying to serve both from one layout would mean a conditional in every
 *  component, and eventually one of them would get it wrong on a live page.
 * ============================================================================
 */

const NAV = [
  { href: '/#features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
]

export default function PlatformLayout({ children }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-ink-200/60 glass dark:border-ink-800/60">
        <nav className="container-page flex h-16 items-center justify-between gap-4" aria-label="Main">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-2xl bg-linear-to-br from-brand-500 to-brand-700 text-white shadow-brand">
              <Stethoscope className="size-4.5" aria-hidden="true" />
            </span>
            <span className="font-display text-base font-bold">{platform.name}</span>
          </Link>

          <ul className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="rounded-xl px-3.5 py-2 text-sm font-semibold text-ink-600 transition-colors hover:text-ink-900 dark:text-ink-300 dark:hover:text-white"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/login"
              className="hidden rounded-xl px-3.5 py-2 text-sm font-semibold text-ink-600 transition-colors hover:text-ink-900 sm:block dark:text-ink-300 dark:hover:text-white"
            >
              Sign in
            </Link>
            <Button href="/signup" size="sm">
              Start free trial
            </Button>
          </div>
        </nav>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="arc-left relative overflow-hidden border-t border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
        <div className="container-page flex flex-col gap-4 py-10 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display font-bold">{platform.name}</p>
            <p className="mt-1 text-ink-500">{platform.tagline}</p>
          </div>
          {/* Two rows, because these are two different kinds of link and mixing
              them makes both harder to find. Razorpay's KYC review and Meta's
              business verification both look for the legal set specifically. */}
          <div className="flex flex-col gap-3 sm:items-end">
            <div className="flex flex-wrap gap-5 text-ink-600 dark:text-ink-400">
              <Link href="/pricing" className="hover:text-brand-700 dark:hover:text-brand-300">Pricing</Link>
              <Link href="/signup" className="hover:text-brand-700 dark:hover:text-brand-300">Start free</Link>
              <Link href="/legal/contact" className="hover:text-brand-700 dark:hover:text-brand-300">Contact</Link>
              <a href={`mailto:${platform.supportEmail}`} className="hover:text-brand-700 dark:hover:text-brand-300">
                {platform.supportEmail}
              </a>
            </div>
            <div className="flex flex-wrap gap-5 text-ink-500 dark:text-ink-500">
              <Link href="/legal/terms" className="hover:text-brand-700 dark:hover:text-brand-300">Terms</Link>
              <Link href="/legal/privacy" className="hover:text-brand-700 dark:hover:text-brand-300">Privacy</Link>
              <Link href="/legal/refunds" className="hover:text-brand-700 dark:hover:text-brand-300">Refunds &amp; cancellation</Link>
            </div>
          </div>
        </div>
        <div className="container-page border-t border-ink-100 py-5 text-xs text-ink-400 dark:border-ink-800">
          {/* The legal entity, on every page of the marketing site. Both Razorpay
              and Meta check that the website names a real, registered business. */}
          © {new Date().getFullYear()} {platform.legal.name}. {platform.name} is a trading name of{' '}
          {platform.legal.name}, {platform.legal.address.city}. Built for physiotherapy clinics in
          India.
        </div>
      </footer>
    </div>
  )
}
