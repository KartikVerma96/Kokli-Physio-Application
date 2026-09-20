'use client'

/**
 * ============================================================================
 *  NAVBAR — the interactive half of the navigation
 * ============================================================================
 *  Client Component, because it needs three things the server cannot do:
 *  scroll position, a mobile menu that opens, and a dropdown that closes when
 *  you click away from it.
 *
 *  It receives `user` and `services` as props from Header.js — it never fetches
 *  anything itself.
 * ============================================================================
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import {
  Menu, X, ChevronDown, LayoutDashboard, CalendarCheck, LogOut, User,
  Phone, Stethoscope, Shield, Video,
} from 'lucide-react'
import { cn, initials } from '@/lib/utils'
import { telLink } from '@/lib/clinicView'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import ThemeToggle from './ThemeToggle'

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/services', label: 'Services', hasDropdown: true },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
]

export default function Navbar({ site, user, services }) {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [servicesOpen, setServicesOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  /**
   * ------------------------------------------------------------------------
   *  "HAS THE PAGE SCROLLED?" — VIA A SENTINEL, NOT A SCROLL LISTENER
   * ------------------------------------------------------------------------
   *  The header is transparent over the hero and gains a frosted background once
   *  you scroll, so the hero art is never cut off by a solid bar.
   *
   *  The obvious implementation is a scroll listener reading window.scrollY. It has
   *  two problems, and the second one is a real bug that showed up in testing:
   *
   *    1. It runs on every scroll frame, and each call reads a layout property.
   *    2. It only reacts to scroll EVENTS. Land on /#services directly and the
   *       browser jumps down the page without necessarily firing one — so the
   *       header stayed transparent while sitting on top of the content, and the
   *       navigation was unreadable.
   *
   *  A sentinel fixes both. We put a tiny invisible element at the very top of the
   *  document and let IntersectionObserver tell us when it leaves the viewport.
   *  That is true whenever the page is scrolled, no matter HOW it got scrolled —
   *  a wheel, a hash jump, a restored scroll position, or scrollTo() — and the
   *  browser does the watching natively rather than us polling.
   */
  const topSentinelRef = useRef(null)

  useEffect(() => {
    const sentinel = topSentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  /**
   * Close every menu.
   *
   * Called from a click handler on each menu CONTAINER, so a click on any link
   * inside bubbles up to it. Without this, tapping a link in the mobile menu
   * navigates but leaves the menu covering the new page.
   *
   * An earlier version did this in an effect watching `pathname`. Reacting to a
   * route change afterwards works, but it is the wrong shape: the menu should close
   * because the user clicked something, not as a delayed consequence of the URL
   * having changed. Handling the event directly is both more direct and one fewer
   * render.
   */
  function closeAllMenus() {
    setMobileOpen(false)
    setServicesOpen(false)
    setUserMenuOpen(false)
  }

  // ---------------------------------------- lock scrolling behind the menu
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  // ----------------------------------------------- Escape closes everything
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setMobileOpen(false)
      setServicesOpen(false)
      setUserMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const isActive = (href) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)

  const homeHref = !user ? '/' : user.role === 'patient' ? '/dashboard' : '/admin'

  return (
    <>
      {/* Skip link: the very first thing a keyboard user reaches, letting them
          jump past the whole navigation instead of tabbing through it on every
          page. Invisible until focused. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-110 focus:rounded-xl focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      {/* The scroll sentinel. `absolute` with no positioned ancestor anchors it to
          the top of the document, and it occupies no space in the layout. When it
          scrolls out of view the header switches to its frosted style — see the
          note above. */}
      <div
        ref={topSentinelRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-3 w-px"
      />

      {/* ------------------------------------------------- announcement bar */}
      <div className="hidden bg-ink-900 text-white lg:block dark:bg-ink-800">
        <div className="container-page flex h-9 items-center justify-between text-xs">
          <p className="flex items-center gap-2">
            <Video className="size-3.5 text-brand-300" aria-hidden="true" />
            Same-day online video consultations available
          </p>
          <div className="flex items-center gap-5">
            {telLink(site) && (
              <a href={telLink(site)} className="flex items-center gap-1.5 transition-colors hover:text-brand-300">
                <Phone className="size-3.5" aria-hidden="true" />
                {site.contact.phone}
              </a>
            )}
            {site.openingHours[0] && (
              <span className="text-ink-400">{site.openingHours[0].time}</span>
            )}
          </div>
        </div>
      </div>

      <header
        className={cn(
          'sticky top-0 z-50 transition-all duration-300',
          scrolled
            ? 'glass border-b border-ink-200/60 shadow-soft dark:border-ink-800/60'
            : 'border-b border-transparent bg-transparent'
        )}
      >
        <nav className="container-page flex h-16 items-center justify-between gap-4 lg:h-18" aria-label="Main navigation">
          {/* ----------------------------------------------------- logo */}
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label={`${site.name} home`}>
            <span className="grid size-10 place-items-center rounded-2xl bg-linear-to-br from-brand-500 to-brand-700 text-white shadow-brand">
              <Stethoscope className="size-5" aria-hidden="true" />
            </span>
            <span className="hidden sm:block">
              <span className="block font-display text-base font-bold leading-tight">{site.name}</span>
              <span className="block text-[11px] font-medium leading-tight text-ink-500 dark:text-ink-400">
                {[site.address.city, site.doctor.credentials].filter(Boolean).join(' · ')}
              </span>
            </span>
          </Link>

          {/* ------------------------------------------- desktop links */}
          {/* One handler on the list: a click on any link or dropdown item inside
              bubbles up to here and closes the menus. */}
          <ul className="hidden items-center gap-1 lg:flex" onClick={closeAllMenus}>
            {LINKS.map((link) => (
              <li
                key={link.href}
                className="relative"
                // Hover-intent on the dropdown: open on mouse enter, close on
                // leave. The click handler below covers touch devices, where
                // there is no hover at all.
                onMouseEnter={link.hasDropdown ? () => setServicesOpen(true) : undefined}
                onMouseLeave={link.hasDropdown ? () => setServicesOpen(false) : undefined}
              >
                <Link
                  href={link.href}
                  className={cn(
                    'flex items-center gap-1 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors',
                    isActive(link.href)
                      ? 'text-brand-700 dark:text-brand-300'
                      : 'text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-white'
                  )}
                  aria-current={isActive(link.href) ? 'page' : undefined}
                  aria-expanded={link.hasDropdown ? servicesOpen : undefined}
                >
                  {link.label}
                  {link.hasDropdown && (
                    <ChevronDown
                      className={cn('size-3.5 transition-transform', servicesOpen && 'rotate-180')}
                      aria-hidden="true"
                    />
                  )}
                </Link>

                {link.hasDropdown && servicesOpen && (
                  <div className="absolute left-0 top-full w-136 pt-2">
                    <div className="card animate-fade-up grid grid-cols-2 gap-1 p-2 shadow-float">
                      {services.map((service) => (
                        <Link
                          key={service.slug}
                          href={`/services/${service.slug}`}
                          className="group flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-brand-50 dark:hover:bg-brand-950/40"
                        >
                          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-700 transition-colors group-hover:bg-brand-600 group-hover:text-white dark:bg-brand-950 dark:text-brand-300">
                            <Icon name={service.icon} className="size-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{service.name}</span>
                            <span className="line-clamp-2 block text-xs leading-snug text-ink-500 dark:text-ink-400">
                              {service.shortDescription}
                            </span>
                          </span>
                        </Link>
                      ))}
                      <Link
                        href="/services"
                        className="col-span-2 mt-1 rounded-xl bg-ink-50 px-3 py-2.5 text-center text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50 hover:text-brand-800 dark:bg-ink-800 dark:text-brand-300 dark:hover:bg-ink-700 dark:hover:text-brand-200"
                      >
                        View all treatments →
                      </Link>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* --------------------------------------------- right side */}
          <div className="flex items-center gap-2">
            <ThemeToggle />

            {user ? (
              <UserMenu
                user={user}
                open={userMenuOpen}
                setOpen={setUserMenuOpen}
                homeHref={homeHref}
              />
            ) : (
              <Link
                href="/login"
                className="hidden rounded-xl px-3.5 py-2 text-sm font-semibold text-ink-600 transition-colors hover:text-ink-900 sm:block dark:text-ink-300 dark:hover:text-white"
              >
                Sign in
              </Link>
            )}

            <Button href="/book" size="sm" className="hidden sm:inline-flex">
              Book appointment
            </Button>

            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className="grid size-10 place-items-center rounded-xl text-ink-700 transition-colors hover:bg-ink-100 lg:hidden dark:text-ink-200 dark:hover:bg-ink-800"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </nav>
      </header>

      {/* ----------------------------------------------------- mobile menu */}
      {mobileOpen && (
        <div className="fixed inset-0 top-16 z-40 animate-fade-in lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            tabIndex={-1}
          />
          <div
            className="relative max-h-full overflow-y-auto border-t border-ink-200 bg-white p-5 shadow-float dark:border-ink-800 dark:bg-ink-900"
            onClick={closeAllMenus}
          >
            <ul className="space-y-1">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={cn(
                      'block rounded-xl px-4 py-3 text-base font-semibold transition-colors',
                      isActive(link.href)
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300'
                        : 'text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800'
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>

            <div className="my-4 border-t border-ink-100 dark:border-ink-800" />

            {user ? (
              <div className="space-y-1">
                <Link href={homeHref} className="flex items-center gap-3 rounded-xl px-4 py-3 text-base font-semibold text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800">
                  <LayoutDashboard className="size-5" aria-hidden="true" />
                  {user.role === 'patient' ? 'My dashboard' : 'Admin panel'}
                </Link>
                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-base font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  <LogOut className="size-5" aria-hidden="true" />
                  Sign out
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <Button href="/login" variant="secondary" fullWidth size="lg">Sign in</Button>
                <Button href="/register" variant="ghost" fullWidth size="lg">Create an account</Button>
              </div>
            )}

            <Button href="/book" fullWidth size="lg" className="mt-4">
              Book an appointment
            </Button>

            {telLink(site) && (
              <a
                href={telLink(site)}
                className="mt-4 flex items-center justify-center gap-2 py-2 text-sm font-medium text-ink-500"
              >
                <Phone className="size-4" aria-hidden="true" />
                {site.contact.phone}
              </a>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/*  USER DROPDOWN                                                             */
/* -------------------------------------------------------------------------- */

function UserMenu({ user, open, setOpen, homeHref }) {
  const ref = useRef(null)

  // Close when the user clicks anywhere outside the menu. This is the standard
  // dropdown pattern: listen on the document, and check whether the click
  // landed inside our own subtree.
  useEffect(() => {
    if (!open) return
    const onClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open, setOpen])

  const staff = ['admin', 'physio'].includes(user.role)

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-xl p-1 pr-2 transition-colors hover:bg-ink-100 dark:hover:bg-ink-800"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {user.image ? (
          /* A plain <img>, not next/image. Google avatar URLs are on an external
             domain, which next/image would require whitelisting in next.config.mjs
             — and for a 32px avatar the optimisation is not worth the configuration.

             Note the disable comment has to sit on the line IMMEDIATELY before the
             element. Put an explanation between them and the directive applies to
             the comment instead, which is a genuinely confusing five minutes. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="size-8 rounded-full object-cover" />
        ) : (
          <span className="grid size-8 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
            {initials(user.name)}
          </span>
        )}
        <ChevronDown className={cn('size-3.5 text-ink-400 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && (
        <div role="menu" className="card absolute right-0 top-full mt-2 w-60 animate-fade-up overflow-hidden p-1.5 shadow-float">
          <div className="border-b border-ink-100 px-3 py-2.5 dark:border-ink-800">
            <p className="truncate text-sm font-bold">{user.name}</p>
            <p className="truncate text-xs text-ink-500">{user.email}</p>
            {staff && (
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                <Shield className="size-2.5" aria-hidden="true" />
                {user.role}
              </span>
            )}
          </div>

          <div className="py-1">
            <MenuLink href={homeHref} icon={LayoutDashboard}>
              {staff ? 'Admin panel' : 'My dashboard'}
            </MenuLink>
            {!staff && (
              <>
                <MenuLink href="/dashboard/appointments" icon={CalendarCheck}>My appointments</MenuLink>
                <MenuLink href="/dashboard/profile" icon={User}>Profile & history</MenuLink>
              </>
            )}
          </div>

          <div className="border-t border-ink-100 pt-1 dark:border-ink-800">
            <button
              type="button"
              role="menuitem"
              onClick={() => signOut({ callbackUrl: '/' })}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function MenuLink({ href, icon: LinkIcon, children }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800"
    >
      <LinkIcon className="size-4 text-ink-400" aria-hidden="true" />
      {children}
    </Link>
  )
}
