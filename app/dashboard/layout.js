import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Stethoscope, Plus } from 'lucide-react'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import { initials } from '@/lib/utils'
import Button from '@/components/ui/Button'
import ThemeToggle from '@/components/layout/ThemeToggle'
import SignOutButton from '@/components/dashboard/SignOutButton'
import DashboardNav from '@/components/dashboard/DashboardNav'

/**
 * ============================================================================
 *  PATIENT DASHBOARD LAYOUT
 * ============================================================================
 *  A different shell from the public site: a sidebar instead of a marketing
 *  header, and no footer full of SEO links. Somebody signed in wants to reach
 *  their appointment, not read about the clinic.
 *
 *  BELT AND BRACES ON AUTHORISATION
 *  --------------------------------
 *  proxy.js already blocks unauthenticated requests to /dashboard, so the check
 *  below should never fire. It is here anyway, because "should never fire" is not
 *  a security guarantee — one typo in the middleware matcher would silently expose
 *  every patient's medical records.
 *
 *  Defence in depth: middleware for the fast redirect, this check as the real
 *  gate, and every query in lib/queries.js scoped by user id as the last line.
 * ============================================================================
 */

/**
 * The sidebar and mobile tab items.
 *
 * `icon` is the NAME of an icon, not the component. This object is handed to
 * DashboardNav, which is a Client Component, and a component function cannot be
 * serialised across that boundary — see the long note in DashboardNav.js.
 */
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: 'LayoutDashboard' },
  { href: '/dashboard/appointments', label: 'My appointments', icon: 'CalendarCheck' },
  { href: '/dashboard/exercises', label: 'My exercises', icon: 'Dumbbell' },
  { href: '/dashboard/profile', label: 'Profile & history', icon: 'User' },
]

/**
 * A patient logged in here is on THEIR CLINIC's website, not on ours, and the
 * browser tab should say so. Setting a `template` on this layout replaces the
 * `%s | Kokli` one from app/layout.js for every page underneath it, so
 * "My appointments" becomes "My appointments | Aarogya Physiotherapy" without
 * each page having to know the clinic's name.
 */
export async function generateMetadata() {
  const clinic = await requireCurrentClinic()

  return {
    title: {
      default: `My dashboard | ${clinic.name}`,
      template: `%s | ${clinic.name}`,
    },
    // A patient's dashboard must never appear in search results.
    robots: { index: false, follow: false },
  }
}

export default async function DashboardLayout({ children }) {
  const clinic = await requireCurrentClinic()
  const site = clinicView(clinic)
  const session = await auth()

  if (!session?.user) redirect('/login?next=/dashboard')

  /**
   * The cross-tenant check, again.
   *
   * proxy.js already rejects a session belonging to another clinic, but this is
   * the patient portal — every page inside it renders medical records. A single
   * check in one place is not enough for that, so the layout verifies it too.
   */
  if (session.user.role !== 'platform' && Number(session.user.clinicId) !== Number(clinic.id)) {
    redirect('/login?next=/dashboard')
  }

  // Staff who land here are sent to their own panel. Not an error — just the
  // wrong door.
  if (session.user.role !== 'patient') redirect('/admin')

  const user = session.user

  return (
    <div className="min-h-screen bg-sand-100 dark:bg-ink-950">
      {/* `shell-page` centres the whole shell at the same width as the marketing
          site (see --page-max in globals.css), so the sidebar lines up with the
          public header's left edge and there is one width across the app. */}
      <div className="shell-page flex">
        {/* ==================================================== the sidebar */}
        {/* Hidden on mobile, where DashboardNav renders a bottom tab bar instead —
            a left sidebar on a phone would eat a third of the screen. */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-ink-200 bg-white lg:flex dark:border-ink-800 dark:bg-ink-900">
          <div className="p-5">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-xl bg-linear-to-br from-brand-500 to-brand-700 text-white">
                <Stethoscope className="size-4.5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-display text-sm font-bold leading-tight">
                  {site.name}
                </span>
                <span className="block text-[10px] text-ink-500">Patient portal</span>
              </span>
            </Link>
          </div>

          <nav className="flex-1 px-3" aria-label="Dashboard">
            <DashboardNav items={NAV_ITEMS} />
          </nav>

          <div className="p-3">
            <Button href="/book" fullWidth size="sm">
              <Plus className="size-4" aria-hidden="true" />
              Book appointment
            </Button>
          </div>

          {/* ------------------------------------------------- user footer */}
          <div className="border-t border-ink-100 p-3 dark:border-ink-800">
            <div className="flex items-center gap-2.5 rounded-xl p-2">
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.image} alt="" className="size-9 rounded-full object-cover" />
              ) : (
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                  {initials(user.name)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{user.name}</p>
                <p className="truncate text-xs text-ink-500">{user.email}</p>
              </div>
            </div>
            <div className="mt-1 flex items-center gap-1">
              <SignOutButton />
              <ThemeToggle />
            </div>
          </div>
        </aside>

        {/* ================================================== main content */}
        {/* min-w-0 is essential here. Without it, a wide table inside a flex child
            forces the whole layout wider than the viewport and the page scrolls
            horizontally — one of the most common and most confusing flexbox bugs. */}
        <div className="min-w-0 flex-1">
          {/* ------------------------------------------- mobile top bar */}
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-ink-200 bg-white/85 px-4 backdrop-blur lg:hidden dark:border-ink-800 dark:bg-ink-900/85">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-xl bg-linear-to-br from-brand-500 to-brand-700 text-white">
                <Stethoscope className="size-4" aria-hidden="true" />
              </span>
              <span className="font-display text-sm font-bold">{site.name}</span>
            </Link>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <SignOutButton compact />
            </div>
          </header>

          {/* pb-24 leaves room for the mobile tab bar so the last row of content
              is not hidden behind it. */}
          {/* The shell is full width so the sidebar sits against the window edge;
              the content is capped inside it so tables and cards stay readable on
              a wide monitor. See .shell-page in app/globals.css. */}
          <main className="shell-content p-4 pb-24 lg:p-8 lg:pb-8">{children}</main>
        </div>
      </div>

      {/* ------------------------------------------- mobile bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 backdrop-blur lg:hidden dark:border-ink-800 dark:bg-ink-900/95"
        aria-label="Dashboard"
      >
        <DashboardNav items={NAV_ITEMS} variant="tabs" />
      </nav>
    </div>
  )
}
