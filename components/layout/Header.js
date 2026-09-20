import { auth } from '@/lib/auth'
import { getActiveServices } from '@/lib/queries'
import Navbar from './Navbar'

/**
 * ============================================================================
 *  HEADER — the server half of the navigation
 * ============================================================================
 *  This is a Server Component, so it can read the session and query MySQL
 *  directly. It then hands plain data to Navbar, which is a Client Component
 *  because it needs click handlers and scroll state.
 *
 *  This split — a server shell fetching data, wrapping a small interactive
 *  client component — is THE central pattern of the Next.js App Router, and it
 *  is worth internalising:
 *
 *    * The session check costs zero extra network requests. No loading spinner
 *      appears where the user's name should be, and the header never flickers
 *      from "Sign in" to "Hello Rohan" after the page loads.
 *    * Only the interactive part becomes client-side JavaScript.
 *
 *  The alternative — a client-side useSession() hook — would mean the header
 *  arrives empty, then fills in a moment later. Users notice that, and so does
 *  Google's Cumulative Layout Shift score.
 * ============================================================================
 */

export default async function Header({ site }) {
  // Both of these run in parallel rather than one after the other. Two 8ms
  // queries in sequence is 16ms of dead time on every single page.
  const [session, services] = await Promise.all([auth(), getActiveServices(site.id)])

  /**
   * Only show a signed-in header to a user who belongs to THIS clinic.
   *
   * The session cookie spans every subdomain (see auth.config.js), so a patient
   * of another clinic arrives here holding a valid session. Rendering their name
   * in this clinic's header would be both confusing and a small information
   * leak. proxy.js makes the same check for protected routes; this is the public
   * page equivalent.
   */
  const sessionUser = session?.user ?? null
  const user =
    sessionUser &&
    (sessionUser.role === 'platform' || Number(sessionUser.clinicId) === Number(site.id))
      ? sessionUser
      : null

  return (
    <Navbar
      site={site}
      user={user}
      // The dropdown only needs enough to render a link, so we deliberately
      // do not pass the full service rows. Everything given to a Client
      // Component is serialised into the HTML sent to the browser, so passing
      // less genuinely means a smaller page.
      services={services.slice(0, 8).map((s) => ({
        slug: s.slug,
        name: s.name,
        icon: s.icon,
        shortDescription: s.short_description,
      }))}
    />
  )
}
