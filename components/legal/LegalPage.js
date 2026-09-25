import Link from 'next/link'
import { platform, legalAddress } from '@/config/platform'

/**
 * ============================================================================
 *  SHARED SHELL FOR THE FOUR LEGAL PAGES
 * ============================================================================
 *  Terms, Privacy, Refunds and Contact all need the same three things: a title,
 *  a "last updated" date, and the registered entity at the bottom. Repeating that
 *  four times is how three of them end up with last year's address.
 *
 *  WHY THE ENTITY BLOCK IS AT THE FOOT OF EVERY PAGE
 *  -------------------------------------------------
 *  Razorpay's KYC review and Meta's business verification both look for a real,
 *  identifiable business on the website — a legal name, a postal address and a way
 *  to reach a human. Putting it on all four means whichever page a reviewer opens,
 *  they find it.
 *
 *  It is also simply honest. A company handling other people's medical records
 *  should say who it is.
 * ============================================================================
 */

export default function LegalPage({ title, intro, updated, children }) {
  return (
    // pt = the old py plus the height the floating header overlays: 76px on a
    // phone, 84px from lg. See the note in app/(platform)/layout.js.
    <div className="container-page pt-33 pb-14 lg:pt-41 lg:pb-20">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-3xl font-bold lg:text-4xl">{title}</h1>
        {intro && (
          <p className="mt-3 text-lg leading-relaxed text-ink-600 dark:text-ink-400">{intro}</p>
        )}
        <p className="mt-4 text-sm text-ink-400">Last updated {updated}</p>

        {/* `prose`-ish styling by hand — the project has no typography plugin, and
            adding one for four pages would be a dependency for nothing. */}
        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-ink-700 dark:text-ink-300">
          {children}
        </div>

        {/* ------------------------------------------------- who we actually are */}
        <div className="mt-14 rounded-2xl border border-ink-200 bg-white p-6 text-sm dark:border-ink-800 dark:bg-ink-900">
          <p className="font-bold">{platform.legal.name}</p>
          <p className="mt-1 text-ink-600 dark:text-ink-400">{legalAddress()}</p>
          <p className="mt-2 text-ink-600 dark:text-ink-400">
            Udyam registration: <span className="font-mono">{platform.legal.udyam}</span>
          </p>
          <p className="mt-3">
            <a
              href={`mailto:${platform.supportEmail}`}
              className="font-semibold text-brand-700 hover:underline dark:text-brand-400"
            >
              {platform.supportEmail}
            </a>
          </p>
          <p className="mt-4 text-xs text-ink-400">
            {platform.name} is a trading name of {platform.legal.name}.
          </p>
        </div>

        <nav className="mt-8 flex flex-wrap gap-5 text-sm text-ink-500">
          <Link href="/legal/terms" className="hover:text-brand-700 dark:hover:text-brand-400">Terms</Link>
          <Link href="/legal/privacy" className="hover:text-brand-700 dark:hover:text-brand-400">Privacy</Link>
          <Link href="/legal/refunds" className="hover:text-brand-700 dark:hover:text-brand-400">Refunds &amp; cancellation</Link>
          <Link href="/legal/contact" className="hover:text-brand-700 dark:hover:text-brand-400">Contact</Link>
        </nav>
      </div>
    </div>
  )
}

/** A numbered section. Kept here so all four pages space and weight identically. */
export function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-ink-900 dark:text-ink-100">{title}</h2>
      {children}
    </section>
  )
}

/** A bulleted list with the spacing the rest of the site uses. */
export function List({ items }) {
  return (
    <ul className="ml-5 list-disc space-y-2 marker:text-ink-400">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}
