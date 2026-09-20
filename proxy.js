import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from '@/auth.config'
import { platform } from '@/config/platform'
import { slugFromHost } from '@/lib/tenant'

/**
 * ============================================================================
 *  MIDDLEWARE — the doorman for a multi-tenant platform
 * ============================================================================
 *
 *  Runs before every matching request, before any page renders. It answers two
 *  questions and nothing else:
 *
 *      1. WHICH WORLD is this request in — the platform, or a clinic?
 *      2. Is this person allowed where they are going?
 *
 *  ---------------------------------------------------------------------------
 *  WHY IT DOES NOT TOUCH THE DATABASE
 *  ---------------------------------------------------------------------------
 *  Middleware runs in the "edge" runtime, a stripped-down JavaScript environment
 *  with no TCP sockets — so mysql2 cannot run here at all.
 *
 *  That is a constraint, but it also produces a good design. This file does the
 *  cheap work: parse the hostname, read the signed session cookie, redirect
 *  anyone obviously in the wrong place. The expensive work — does this clinic
 *  exist, is its subscription current — happens in the layouts, which are
 *  ordinary Server Components and can query freely.
 *
 *  So: middleware decides WHO you are, layouts decide WHAT you may see.
 *
 *  ---------------------------------------------------------------------------
 *  THE CROSS-TENANT CHECK — THE MOST IMPORTANT PART OF THIS FILE
 *  ---------------------------------------------------------------------------
 *  The session cookie is deliberately set on `.kokli.local` so it is
 *  visible on every subdomain. It has to be: signing up on the platform and
 *  landing on your brand-new clinic must carry the session across, and Google
 *  sign-in has to come back through the root domain.
 *
 *  The consequence is that a valid session belonging to clinic A is ALSO
 *  presented to clinic B's website. The cookie alone therefore proves only
 *  "signed in somewhere" — never "allowed here".
 *
 *  So below, a session whose clinic does not match the hostname is treated as no
 *  session at all. Without that single check, any patient of any clinic could
 *  open another clinic's subdomain and be logged in.
 * ============================================================================
 */

const { auth } = NextAuth(authConfig)

/* ------------------------------- routes, by which world they belong to ---- */

/** Clinic-side routes that need any signed-in user. */
const CLINIC_PROTECTED = ['/dashboard', '/book/confirm', '/consult']

/** Clinic-side routes that need clinic staff. */
const CLINIC_STAFF = ['/admin']

/** Clinic-side routes that only patients should see (staff get redirected). */
const CLINIC_PATIENT_ONLY = ['/dashboard']

/** Platform routes that only YOU may see. */
const PLATFORM_ONLY = ['/platform']

/**
 * Signed-in users have no business on these, in either world.
 *
 * `/forgot-password` is here: somebody already signed in does not need a reset
 * email, they need the account page, and letting them ask burns one of the three
 * links they are allowed per hour.
 *
 * `/reset-password` is deliberately NOT here. The token in that URL is the
 * credential — whoever holds it is authorised, session or no session — and a
 * patient who happens to be signed in on a shared reception computer must still be
 * able to follow the link from their own email.
 */
const GUEST_ONLY = ['/login', '/register', '/signup', '/forgot-password']

/**
 * Paths that only make sense on a clinic subdomain. Reaching them on the root
 * domain means someone typed kokli.local/dashboard, so send them to the
 * marketing site rather than rendering a clinic page with no clinic.
 */
const CLINIC_WORLD_ONLY = ['/dashboard', '/admin', '/book', '/consult', '/services']

export default auth((request) => {
  const { pathname, search } = request.nextUrl
  const host = request.headers.get('host')
  const slug = slugFromHost(host)
  const isPlatformHost = slug === null

  const sessionUser = request.auth?.user ?? null

  const matches = (routes) =>
    routes.some((r) => pathname === r || pathname.startsWith(`${r}/`))

  /* ======================================================================== */
  /*  THE CROSS-TENANT CHECK                                                  */
  /* ======================================================================== */
  /**
   * `user` from here on means "signed in AND entitled to be on this hostname".
   *
   * Platform staff pass everywhere — supporting a customer means being able to
   * open their clinic. Everyone else must match the subdomain exactly.
   */
  let user = null
  if (sessionUser) {
    if (sessionUser.role === 'platform') {
      user = sessionUser
    } else if (isPlatformHost) {
      // A clinic's user on the root domain. They are signed in, but there is no
      // clinic context here — fine for signup/marketing, and the world checks
      // below will move them along if they try to reach a clinic page.
      user = sessionUser
    } else if (sessionUser.clinicSlug === slug) {
      user = sessionUser
    }
    // else: a session for a DIFFERENT clinic. Deliberately left as null, so this
    // request is treated exactly as if nobody were signed in.
  }

  /**
   * Pass the resolved slug downstream in a request header.
   *
   * lib/tenant.js reads it, so no Server Component has to re-parse the Host
   * header, and the tenant is resolved in exactly one place.
   */
  const requestHeaders = new Headers(request.headers)
  if (slug) requestHeaders.set('x-clinic-slug', slug)
  else requestHeaders.delete('x-clinic-slug')
  const proceed = () => NextResponse.next({ request: { headers: requestHeaders } })

  /* ======================================================================== */
  /*  WORLD 1 — THE PLATFORM  (kokli.local)                              */
  /* ======================================================================== */
  if (isPlatformHost) {
    /**
     * THE ROOT PATH BELONGS TO TWO DIFFERENT PAGES
     * --------------------------------------------
     * `/` on a clinic subdomain is that clinic's homepage. `/` on the root domain
     * is the platform's marketing site. Same path, completely different page.
     *
     * A REWRITE rather than a redirect: the browser keeps showing
     * kokli.local/ while Next renders app/(platform)/home. A redirect would
     * put an ugly /home in the address bar and give the marketing site two URLs,
     * which is bad for SEO.
     */
    if (pathname === '/') {
      return NextResponse.rewrite(new URL('/home', request.nextUrl), {
        request: { headers: requestHeaders },
      })
    }

    // Clinic pages do not exist here.
    if (matches(CLINIC_WORLD_ONLY)) {
      return NextResponse.redirect(new URL('/', request.nextUrl))
    }

    // Your admin. Note the deliberate 404-style redirect rather than a 403:
    // there is no reason to confirm to a stranger that /platform is a real place.
    if (matches(PLATFORM_ONLY)) {
      if (!user) {
        const loginUrl = new URL('/login', request.nextUrl)
        loginUrl.searchParams.set('next', pathname + search)
        return NextResponse.redirect(loginUrl)
      }
      if (user.role !== 'platform') {
        return NextResponse.redirect(new URL('/', request.nextUrl))
      }
    }

    // A signed-in person does not need the login page.
    if (user && matches(GUEST_ONLY)) {
      const home = user.role === 'platform' ? '/platform' : '/'
      return NextResponse.redirect(new URL(home, request.nextUrl))
    }

    return proceed()
  }

  /* ======================================================================== */
  /*  WORLD 2 — A CLINIC  (aarogya.kokli.local)                          */
  /* ======================================================================== */

  // The platform admin is not reachable from a clinic's domain.
  if (matches(PLATFORM_ONLY)) {
    return NextResponse.redirect(new URL('/', request.nextUrl))
  }

  // ------------------------------------------------------------- 1. guests
  if (user && matches(GUEST_ONLY)) {
    const home = user.role === 'patient' ? '/dashboard' : '/admin'
    return NextResponse.redirect(new URL(home, request.nextUrl))
  }

  // --------------------------------------------------- 2. must be signed in
  if (!user && matches([...CLINIC_PROTECTED, ...CLINIC_STAFF])) {
    const loginUrl = new URL('/login', request.nextUrl)
    // Remember where they were heading, so signing in lands them there rather
    // than on the homepage.
    loginUrl.searchParams.set('next', pathname + search)
    return NextResponse.redirect(loginUrl)
  }

  // ----------------------------------------------------------- 3. staff only
  if (user && matches(CLINIC_STAFF) && !['admin', 'physio', 'platform'].includes(user.role)) {
    // Send them to their own dashboard rather than a "403 Forbidden" page.
    // There is no reason to confirm to a patient that an admin area exists.
    return NextResponse.redirect(new URL('/dashboard', request.nextUrl))
  }

  // -------------------------------------------------------- 4. patients only
  // The mirror of rule 3. Without it, staff signing in land on the patient
  // portal and are bounced out by a redirect() inside a layout — which is far
  // more fragile mid-navigation than an HTTP redirect issued here.
  if (
    user &&
    matches(CLINIC_PATIENT_ONLY) &&
    ['admin', 'physio'].includes(user.role)
  ) {
    return NextResponse.redirect(new URL('/admin', request.nextUrl))
  }

  /* ------------------------------------------- 5. remember the clinic for OAuth */
  /**
   * ==========================================================================
   *  THE COOKIE THAT MAKES GOOGLE SIGN-UP POSSIBLE
   * ==========================================================================
   *  lib/auth.js needs to know WHICH clinic a brand-new Google user is joining.
   *  It reads that from a `pending-clinic` cookie — and until this block existed
   *  nothing ever wrote one, so `readPendingClinicSlug()` always returned null and
   *  EVERY first-time Google sign-up was rejected with a misleading "that sign-in
   *  was cancelled" message. An existing patient could sign in fine, which is
   *  exactly why it went unnoticed: the developer testing it already has an
   *  account.
   *
   *  WHY IT HAS TO EXIST AT ALL
   *  --------------------------
   *  Google will not accept a wildcard redirect URI, so every OAuth callback comes
   *  back to the ROOT domain — see redirectProxyUrl in auth.config.js. By the time
   *  Google returns, the hostname no longer says which clinic the patient started
   *  from. The cookie carries that one fact across the round trip.
   *
   *  WHY HERE, IN THE MIDDLEWARE
   *  --------------------------
   *  This is the one place that has already resolved the clinic from the hostname
   *  and can set a cookie on the response. Setting it from the button in the
   *  browser would mean trusting a value the browser chose; setting it here means
   *  it is derived from the address the patient was actually on.
   *
   *  Four properties, each load-bearing:
   *
   *    domain    the PARENT domain, so the cookie is readable on the root domain
   *              where the callback lands. Without this it is invisible at exactly
   *              the moment it is needed. Same helper the session cookie uses.
   *    httpOnly  the browser cannot rewrite it into a different clinic's slug.
   *    sameSite  'lax' — it must survive the top-level redirect back from Google.
   *              'strict' would drop it and put the bug straight back.
   *    maxAge    ten minutes. It is a hint for one sign-in, not a preference.
   */
  const response = proceed()

  if (matches(['/login', '/register'])) {
    response.cookies.set('pending-clinic', slug, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      path: '/',
      maxAge: 600,
      ...(cookieParentDomain() ? { domain: cookieParentDomain() } : {}),
    })
  }

  return response
})

/**
 * The parent domain for a cross-subdomain cookie, or undefined locally.
 *
 * Mirrors cookieDomain() in auth.config.js deliberately rather than importing it:
 * that module is the Auth.js config and this is the middleware, and a cookie helper
 * is not worth coupling them over. Browsers reject a Domain attribute on
 * `localhost`, which is why development gets undefined and a host-only cookie.
 */
function cookieParentDomain() {
  const domain = platform.domain
  if (!domain || domain === 'localhost' || domain.startsWith('127.')) return undefined
  return `.${domain}`
}

export const config = {
  /**
   * Which requests run through the middleware.
   *
   * The negative lookahead skips Next's internal assets, the auth endpoints
   * themselves (which must never be redirected — that would break the OAuth
   * callback) and anything that looks like a static file. Every skipped request
   * is latency saved on something that needs no protection.
   */
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)',
  ],
}
