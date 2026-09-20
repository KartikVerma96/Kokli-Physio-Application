'use client'

/**
 * ============================================================================
 *  DASHBOARD NAVIGATION
 * ============================================================================
 *  Renders either the sidebar list or the mobile tab bar from the same array of
 *  items, so the two can never drift out of sync.
 *
 *  It is a Client Component for exactly one reason: usePathname(), to highlight
 *  the current page. That is a browser-side hook, so this file has to opt in.
 *
 *  Highlighting the active item sounds cosmetic. It is not — without it, a patient
 *  who taps "My exercises" and lands on a page with an empty state has no way to
 *  tell whether the tap registered.
 *
 *  ---------------------------------------------------------------------------
 *  WHY EACH ITEM'S ICON IS A STRING, NOT A COMPONENT
 *  ---------------------------------------------------------------------------
 *  The layouts that use this are Server Components, and everything a Server
 *  Component passes to a Client Component has to be SERIALISABLE — it is encoded,
 *  sent over the wire, and decoded in the browser.
 *
 *  Numbers, strings, arrays, plain objects and even React ELEMENTS are all fine.
 *  A component FUNCTION is not:
 *
 *      { label: 'Overview', icon: LayoutDashboard }   ✗ a function — cannot cross
 *      { label: 'Overview', icon: 'LayoutDashboard' } ✓ a string — fine
 *
 *  Passing the function produces "Functions cannot be passed directly to Client
 *  Components", and — worse — the page can still render on the server while the
 *  client component silently fails to hydrate. So the layouts pass a name, and this
 *  file looks the component up in the map below, where the import happens on the
 *  client side of the boundary.
 *
 *  This is the same pattern as components/ui/Icon.js, which turns the icon name
 *  stored in the `services` database column into a component.
 * ============================================================================
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, CalendarCheck, Dumbbell, User, CalendarDays, Users, Clock,
  Sparkles, IndianRupee, Star, CreditCard, UserCog, KeyRound, Layers,
  PhoneCall, ClipboardList, MessageCircle, Palette,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/** Every icon either navigation uses, keyed by the name the layouts pass in. */
const NAV_ICONS = {
  LayoutDashboard,
  CalendarCheck,
  Dumbbell,
  User,
  CalendarDays,
  Users,
  Clock,
  Sparkles,
  IndianRupee,
  Star,
  CreditCard,
  UserCog,
  KeyRound,
  Layers,
  PhoneCall,
  ClipboardList,
  MessageCircle,
  Palette,
}

export default function DashboardNav({ items, variant = 'sidebar', maxTabs = 5 }) {
  const pathname = usePathname()

  /**
   * ------------------------------------------------------------------------
   *  EXACTLY ONE ITEM IS EVER ACTIVE — "LONGEST MATCH WINS"
   * ------------------------------------------------------------------------
   *  This looked simple and was wrong. The first version special-cased one href:
   *
   *      href === '/dashboard' ? pathname === href : pathname.startsWith(href)
   *
   *  It happened to work for the patient sidebar and was broken in the admin
   *  sidebar, where the section root is '/admin'. On /admin/patients BOTH
   *  "Dashboard" (because the path starts with /admin) and "Patients" lit up at
   *  once — and on /admin/appointments/42, so did "Appointments".
   *
   *  Hardcoding the exception was the mistake. What we actually want is the rule a
   *  router uses: of every item the URL matches, the most SPECIFIC one wins.
   *
   *      /admin                → /admin
   *      /admin/patients       → /admin/patients   (not /admin as well)
   *      /admin/appointments/42→ /admin/appointments
   *
   *  Note the `${item.href}/` in the prefix test. Comparing against '/admin' alone
   *  would make '/administrator' a match; requiring the slash means only real path
   *  segments count.
   */
  const activeHref = items.reduce((best, item) => {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`)
    if (!matches) return best
    // Longer href = deeper in the tree = more specific.
    return best === null || item.href.length > best.length ? item.href : best
  }, null)

  const isActive = (href) => href === activeHref

  if (variant === 'tabs') {
    return (
      <ul className="flex">
        {/* The tab bar shows only the first few items — seven tabs is unusable on a
            phone — but `activeHref` above was computed from the FULL list. That
            matters: on /admin/payments, which has no tab of its own, matching
            against the visible subset alone would fall back to /admin and wrongly
            light up "Dashboard". */}
        {items.slice(0, maxTabs).map((item) => {
          const active = isActive(item.href)
          const ItemIcon = NAV_ICONS[item.icon] || LayoutDashboard
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  // min-h-14 keeps every tap target comfortably above the
                  // 44px minimum that both Apple and Google recommend.
                  'flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-semibold transition-colors',
                  active ? 'text-brand-700 dark:text-brand-300' : 'text-ink-400'
                )}
              >
                <ItemIcon className={cn('size-5', active && 'stroke-[2.5]')} aria-hidden="true" />
                <span className="truncate">{shortLabel(item.label)}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    )
  }

  /**
   * An item may carry `section: 'Settings'`, which prints a small heading above
   * the first item that has it. Purely visual — the list stays flat, so the
   * longest-match rule above is untouched. Once a sidebar passes about seven
   * entries, a run of undifferentiated links is hard to scan; the day-to-day
   * work and the things you configure once belong in separate groups.
   */
  const withHeadings = items.map((item, index) => ({
    ...item,
    heading: item.section && item.section !== items[index - 1]?.section ? item.section : null,
  }))

  return (
    <ul className="space-y-1">
      {withHeadings.map(({ heading, ...item }) => {
        const active = isActive(item.href)
        const ItemIcon = NAV_ICONS[item.icon] || LayoutDashboard
        return (
          <li key={item.href}>
            {heading && (
              <p className="px-3 pb-1.5 pt-5 text-[10px] font-bold uppercase tracking-wider text-ink-400">
                {heading}
              </p>
            )}
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                active
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                  : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-white'
              )}
            >
              <ItemIcon className="size-4.5 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** "My appointments" does not fit under a tab icon on a 360px screen. */
function shortLabel(label) {
  return label
    .replace('My ', '')
    .replace('Profile & history', 'Profile')
    .replace(' & ', ' ')
}
