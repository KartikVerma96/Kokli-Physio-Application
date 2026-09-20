import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Stethoscope } from 'lucide-react'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import { initials } from '@/lib/utils'
import ThemeToggle from '@/components/layout/ThemeToggle'
import SignOutButton from '@/components/dashboard/SignOutButton'
import DashboardNav from '@/components/dashboard/DashboardNav'

/**
 * ============================================================================
 *  ADMIN LAYOUT
 * ============================================================================
 *  The clinic's own side of the application. Reuses DashboardNav from the patient
 *  area, because the navigation behaves identically — only the items differ.
 *
 *  ROLES
 *  -----
 *  'physio' and 'admin' both get in. In a single-therapist clinic the
 *  physiotherapist genuinely needs the diary, the patient list and the clinical
 *  notes, so locking those to a separate admin account would just mean sharing one
 *  login — which is worse for security, not better.
 *
 *  Where the two differ is revenue and settings: those pages check for 'admin'
 *  specifically. See app/admin/payments/page.js.
 * ============================================================================
 */

// Icon NAMES, not components — see the note in components/dashboard/DashboardNav.js
// about what can and cannot cross the server/client boundary.
const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: 'LayoutDashboard' },
  { href: '/admin/appointments', label: 'Appointments', icon: 'CalendarDays' },
  { href: '/admin/patients', label: 'Patients', icon: 'Users' },
  // The cheapest revenue in the business: patients who are not coming back.
  { href: '/admin/recalls', label: 'Recall', icon: 'PhoneCall' },
  { href: '/admin/availability', label: 'Availability', icon: 'Clock' },
  { href: '/admin/services', label: 'Services', icon: 'Sparkles' },
  { href: '/admin/packages', label: 'Packages', icon: 'Layers' },
  { href: '/admin/payments', label: 'Payments', icon: 'IndianRupee' },
  { href: '/admin/reviews', label: 'Reviews', icon: 'Star' },

  // Set-up-once pages, grouped under a "Settings" heading in the sidebar. Money
  // and staffing are the owner's business, so these are filtered out for physios
  // below — a therapist should not see the clinic's subscription or be able to
  // add colleagues.
  { href: '/admin/billing', label: 'Subscription', icon: 'CreditCard', adminOnly: true, section: 'Settings' },
  { href: '/admin/settings/team', label: 'Team', icon: 'UserCog', adminOnly: true, section: 'Settings' },
  { href: '/admin/settings/branding', label: 'Branding', icon: 'Palette', adminOnly: true, section: 'Settings' },
  { href: '/admin/settings/whatsapp', label: 'WhatsApp', icon: 'MessageCircle', adminOnly: true, section: 'Settings' },
  { href: '/admin/settings/policies', label: 'Policies', icon: 'ClipboardList', adminOnly: true, section: 'Settings' },
  { href: '/admin/settings/payments', label: 'Payment keys', icon: 'KeyRound', adminOnly: true, section: 'Settings' },
  // Exporting the whole patient list belongs to whoever owns the business and
  // carries the legal responsibility for it — hence adminOnly.
  { href: '/admin/settings/data', label: 'Your data', icon: 'Download', adminOnly: true, section: 'Settings' },
  // NOT adminOnly: every physiotherapist needs to be able to change the
  // temporary password their clinic owner typed for them.
  { href: '/admin/settings/account', label: 'Your account', icon: 'UserCircle', section: 'Settings' },
]

export const metadata = {
  title: 'Clinic admin',
  robots: { index: false, follow: false },
}

export default async function AdminLayout({ children }) {
  const clinic = await requireCurrentClinic()
  const site = clinicView(clinic)
  const session = await auth()

  // proxy.js already handles this. Repeated here because an authorisation check
  // you only do in one place is an authorisation check waiting to be bypassed.
  if (!session?.user) redirect('/login?next=/admin')
  if (!['admin', 'physio', 'platform'].includes(session.user.role)) redirect('/dashboard')

  // Staff of a DIFFERENT clinic must never reach this one's admin, even though
  // their session cookie is visible here. proxy.js checks it too; this is the
  // second line of defence on the most sensitive area of the app.
  if (session.user.role !== 'platform' && Number(session.user.clinicId) !== Number(clinic.id)) {
    redirect('/login?next=/admin')
  }

  const user = session.user

  // A physiotherapist sees the diary and the patients; the owner also sees the
  // money. Filtering the list here means the link is genuinely absent rather
  // than merely hidden with CSS — and /admin/billing re-checks the role anyway.
  const navItems = NAV_ITEMS.filter((item) => !item.adminOnly || user.role !== 'physio')

  return (
    <div className="min-h-screen bg-sand-100 dark:bg-ink-950">
      {/* Same centred shell width as the patient dashboard and the public site. */}
      <div className="shell-page flex">
        {/* ==================================================== the sidebar */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-ink-200 bg-white lg:flex dark:border-ink-800 dark:bg-ink-900">
          <div className="p-5">
            <Link href="/admin" className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-xl bg-ink-900 text-white dark:bg-white dark:text-ink-900">
                <Stethoscope className="size-4.5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-display text-sm font-bold leading-tight">
                  {site.name}
                </span>
                <span className="block text-[10px] text-ink-500">Clinic admin</span>
              </span>
            </Link>
          </div>

          <nav className="flex-1 overflow-y-auto px-3" aria-label="Admin">
            <DashboardNav items={navItems} />
          </nav>

          <div className="border-t border-ink-100 p-3 dark:border-ink-800">
            <div className="flex items-center gap-2.5 rounded-xl p-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink-900 text-xs font-bold text-white dark:bg-ink-700">
                {initials(user.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{user.name}</p>
                <p className="truncate text-[11px] uppercase tracking-wider text-ink-500">
                  {user.role}
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
              View public website →
            </Link>
          </div>
        </aside>

        {/* min-w-0 so wide admin tables scroll inside their own container rather
            than stretching the whole page sideways. */}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-ink-200 bg-white/85 px-4 backdrop-blur lg:hidden dark:border-ink-800 dark:bg-ink-900/85">
            <Link href="/admin" className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-xl bg-ink-900 text-white dark:bg-white dark:text-ink-900">
                <Stethoscope className="size-4" aria-hidden="true" />
              </span>
              <span className="font-display text-sm font-bold">Clinic admin</span>
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

      {/* The mobile tab bar shows the five most-used sections; the rest are reachable
          from the dashboard. Seven tabs on a phone is unusable.
          The FULL list is passed — DashboardNav trims what it displays but needs all
          of them to work out which one is active. See the note in that file. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 backdrop-blur lg:hidden dark:border-ink-800 dark:bg-ink-900/95"
        aria-label="Admin"
      >
        <DashboardNav items={navItems} variant="tabs" maxTabs={5} />
      </nav>
    </div>
  )
}
