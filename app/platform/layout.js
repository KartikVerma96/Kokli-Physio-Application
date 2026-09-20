import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Command } from 'lucide-react'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { platform } from '@/config/platform'
import { initials } from '@/lib/utils'
import ThemeToggle from '@/components/layout/ThemeToggle'
import SignOutButton from '@/components/dashboard/SignOutButton'
import DashboardNav from '@/components/dashboard/DashboardNav'

/**
 * ============================================================================
 *  PLATFORM ADMIN  →  kokli.local/platform
 * ============================================================================
 *  YOUR console. The only part of the application that deliberately reads
 *  across every tenant.
 *
 *  THREE GATES, NOT ONE
 *  --------------------
 *  Every other admin surface belongs to a clinic and is protected by "does your
 *  session's clinic match this hostname?". This one has no clinic, so that
 *  question does not apply — which means it needs its own answer:
 *
 *    1. proxy.js blocks /platform on any clinic subdomain, and requires a
 *       platform role on the root domain.
 *    2. This layout re-checks the role, because a single check is never enough
 *       for the one page that can see every clinic's data.
 *    3. It refuses to render on a clinic hostname at all, so a misconfigured
 *       middleware matcher cannot expose it through a customer's own domain.
 *
 *  The queries behind these pages are the only unscoped ones in lib/queries.js,
 *  and they are grouped at the bottom of that file under a warning for exactly
 *  this reason.
 * ============================================================================
 */

// Icon NAMES, not components — see the note in components/dashboard/DashboardNav.js.
const NAV_ITEMS = [
  { href: '/platform', label: 'Overview', icon: 'LayoutDashboard' },
  { href: '/platform/clinics', label: 'Clinics', icon: 'Users' },
  { href: '/platform/revenue', label: 'Revenue', icon: 'IndianRupee' },
  { href: '/platform/plans', label: 'Plans', icon: 'CreditCard' },
  { href: '/platform/errors', label: 'Errors', icon: 'Bug' },
  { href: '/platform/account', label: 'Your account', icon: 'UserCircle' },
]

export const metadata = {
  title: 'Platform admin',
  robots: { index: false, follow: false, nocache: true },
}

export default async function PlatformLayout({ children }) {
  // Gate 3: never render on a clinic's hostname, whatever the middleware did.
  const clinic = await getCurrentClinic()
  if (clinic) redirect('/')

  // Gate 2: the role check, repeated.
  const session = await auth()
  if (!session?.user) redirect('/login?next=/platform')
  if (session.user.role !== 'platform') redirect('/')

  const user = session.user

  return (
    <div className="min-h-screen bg-sand-100 dark:bg-ink-950">
      <div className="shell-page flex">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-ink-200 bg-white lg:flex dark:border-ink-800 dark:bg-ink-900">
          <div className="p-5">
            <Link href="/platform" className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-xl bg-ink-900 text-white dark:bg-white dark:text-ink-900">
                <Command className="size-4.5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-display text-sm font-bold leading-tight">
                  {platform.name}
                </span>
                <span className="block text-[10px] text-ink-500">Platform admin</span>
              </span>
            </Link>
          </div>

          <nav className="flex-1 px-3" aria-label="Platform">
            <DashboardNav items={NAV_ITEMS} />
          </nav>

          <div className="border-t border-ink-100 p-3 dark:border-ink-800">
            <div className="flex items-center gap-2.5 rounded-xl p-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink-900 text-xs font-bold text-white dark:bg-ink-700">
                {initials(user.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{user.name}</p>
                <p className="truncate text-[11px] uppercase tracking-wider text-ink-500">
                  Platform
                </p>
              </div>
            </div>
            <div className="mt-1 flex items-center gap-1">
              <SignOutButton />
              <ThemeToggle />
            </div>
            <Link
              href="/"
              className="mt-1 block rounded-xl px-3 py-2 text-xs font-medium text-ink-500 transition-colors hover:bg-ink-100 dark:hover:bg-ink-800"
            >
              View marketing site →
            </Link>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-ink-200 bg-white/85 px-4 backdrop-blur lg:hidden dark:border-ink-800 dark:bg-ink-900/85">
            <Link href="/platform" className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-xl bg-ink-900 text-white dark:bg-white dark:text-ink-900">
                <Command className="size-4" aria-hidden="true" />
              </span>
              <span className="font-display text-sm font-bold">Platform</span>
            </Link>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <SignOutButton compact />
            </div>
          </header>

          {/* The shell is full width so the sidebar sits against the window edge;
              the content is capped inside it so tables and cards stay readable on
              a wide monitor. See .shell-page in app/globals.css. */}
          <main className="shell-content p-4 pb-24 lg:p-8 lg:pb-8">{children}</main>
        </div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 backdrop-blur lg:hidden dark:border-ink-800 dark:bg-ink-900/95"
        aria-label="Platform"
      >
        <DashboardNav items={NAV_ITEMS} variant="tabs" />
      </nav>
    </div>
  )
}
