import Link from 'next/link'
import { notFound } from 'next/navigation'
import { platform } from '@/config/platform'
import { getCurrentSlug } from '@/lib/tenant'
import Button from '@/components/ui/Button'
import ThemeToggle from '@/components/layout/ThemeToggle'
import KokliLogo from '@/components/ui/KokliLogo'

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

export default async function PlatformLayout({ children }) {
  /**
   * ==========================================================================
   *  THE MARKETING SITE EXISTS ON THE ROOT DOMAIN ONLY
   * ==========================================================================
   *  This layout used to render on any hostname, which meant Kokli's own pages
   *  leaked onto every clinic's website:
   *
   *    aarogya.kokli.in/pricing   Kokli selling software at ₹1,299 a month,
   *                               on a physiotherapist's own site, to a patient
   *                               who came to book an appointment
   *    aarogya.kokli.in/signup    "Create your clinic", from inside a clinic
   *    typo.kokli.in/signup       a working form on an address that does not exist
   *
   *  The last one is how it was found: a tab left open on a clinic that had just
   *  been deleted still showed a live signup page, while its home page correctly
   *  returned 404. The same address answering two different ways.
   *
   *  Any subdomain at all — a real clinic or a mistyped one — gets a 404 here.
   *  A clinic's own pages live in app/(public), and never come through this file.
   */
  if (await getCurrentSlug()) notFound()

  return (
    <div className="flex min-h-screen flex-col">
      {/* The same bar a clinic's website wears — a floating capsule inset from
          the page edges, sitting over the section below rather than in a band of
          its own. See components/layout/Navbar.js, which does this for clinics;
          the negative margin gives back the height this header occupies (12px of
          top padding plus the bar: 64px on a phone, 72px from lg), and the first
          section of every page below carries that height as top padding. */}
      <header className="sticky top-0 z-50 -mb-19 px-3 pt-3 sm:px-5 lg:-mb-21">
        <nav
          className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 rounded-3xl border border-ink-200/60 bg-white/70 px-4 shadow-soft backdrop-blur-xl transition-all duration-300 lg:h-18 lg:px-6 dark:border-white/10 dark:bg-ink-900/70"
          aria-label="Main"
        >
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <KokliLogo size={32} className="size-8" />
            <span className="font-display text-[17px] font-bold leading-none tracking-tight">
              {platform.name}
            </span>
          </Link>

          <ul className="hidden items-center gap-7 md:flex">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-[15px] font-medium text-ink-500 transition-colors hover:text-ink-900 dark:text-ink-400 dark:hover:text-white"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/login"
              className="hidden shrink-0 px-2 text-[15px] font-medium whitespace-nowrap text-ink-500 transition-colors hover:text-ink-900 sm:block dark:text-ink-400 dark:hover:text-white"
            >
              Sign in
            </Link>
            <Button href="/signup" size="sm" className="rounded-full">
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
          <div className="flex items-center gap-3">
            <KokliLogo size={40} className="size-10 shrink-0" />
            <div>
              <p className="font-display font-bold">{platform.name}</p>
              <p className="mt-1 text-ink-500">{platform.tagline}</p>
            </div>
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
