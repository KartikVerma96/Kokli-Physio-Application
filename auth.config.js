import Google from 'next-auth/providers/google'
import { platform, platformUrl } from '@/config/platform'

/**
 * ============================================================================
 *  AUTH CONFIG — the half that is safe to run in middleware
 * ============================================================================
 *
 *  WHY THE AUTH SETUP IS SPLIT ACROSS TWO FILES
 *  --------------------------------------------
 *  Next.js middleware runs on every request in a stripped-down "edge" runtime
 *  with no access to Node's networking, so mysql2 cannot run there.
 *
 *  Our middleware only needs one cheap answer: "is this visitor signed in, which
 *  clinic do they belong to, and what is their role?" All three are already
 *  inside the signed session cookie, so no database is needed to read them.
 *
 *      auth.config.js  (this file)  no database imports. Safe in middleware.
 *      lib/auth.js                  adds password login and Google account
 *                                   syncing, both of which need MySQL.
 * ============================================================================
 */

export const googleEnabled = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
)

/**
 * The cookie domain.
 *
 * ---------------------------------------------------------------------------
 * THIS ONE LINE IS WHY THE WHOLE PLATFORM WORKS
 * ---------------------------------------------------------------------------
 * A cookie set by `aarogya.kokli.local` is invisible to
 * `smile.kokli.local` and to the root domain. Setting it on the PARENT
 * domain with a leading dot makes it visible to all of them, which is required
 * for two flows:
 *
 *   1. Signing up on the platform and landing on your new clinic subdomain
 *      already signed in.
 *   2. Signing in on kokli.in as a clinic owner and being sent on to your own
 *      clinic's admin — see redirectIfSignedIn() in lib/guards.js.
 *
 * (Google sign-in does NOT depend on it. Its callback is forwarded back to the
 * clinic's own hostname — see redirectProxyUrl below.)
 *
 * The security consequence is handled deliberately in proxy.js: a session is
 * VISIBLE everywhere, so every protected route re-checks that the session's
 * clinic matches the hostname. Sharing the cookie without that check would let
 * any clinic's patient walk into another clinic's site signed in.
 *
 * On localhost the domain is left undefined, because browsers refuse
 * `Domain=.localhost` outright. The price: in development a login on
 * `localhost:3000` is NOT visible on `aarogya.localhost:3000`, so both flows
 * above ask you to sign in a second time on the clinic. On a real domain they
 * do not.
 */
function cookieDomain() {
  const domain = platform.domain
  if (!domain || domain === 'localhost' || domain.startsWith('127.')) return undefined
  return `.${domain}`
}

const useSecureCookies = platform.protocol === 'https'

export const authConfig = {
  pages: {
    signIn: '/login',
    error: '/login',
  },

  session: {
    /**
     * "jwt" means the whole session lives inside a signed, httpOnly cookie —
     * there is no sessions table and no database round-trip to identify a user.
     * Every server-rendered page can therefore know who you are with zero
     * queries, which is what keeps a multi-tenant app fast.
     *
     * The trade-off: because the session is self-contained, a change in the
     * database does not reach it on its own. That is handled in the jwt callback
     * in lib/auth.js, which re-reads the account every five minutes and ends the
     * session if it has been deleted, deactivated or suspended.
     *
     * NOT by `updateAge` below, despite what this comment used to say. updateAge
     * only re-signs the cookie to extend it; it never looks at the database, so a
     * deactivated physiotherapist kept working access for the full 30 days.
     */
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },

  // We run behind our own server (server.js) and serve many hostnames, so let
  // Auth.js trust the Host header rather than trying to infer one deployment URL.
  trustHost: true,

  cookies: {
    sessionToken: {
      name: useSecureCookies
        ? '__Secure-authjs.session-token'
        : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
        domain: cookieDomain(),
      },
    },
  },

  providers: googleEnabled
    ? [
        Google({
          // Auth.js reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET from the
          // environment automatically.
          allowDangerousEmailAccountLinking: true,
          authorization: {
            params: { prompt: 'select_account', access_type: 'offline', response_type: 'code' },
          },
        }),
      ]
    : [],

  /**
   * Send every OAuth callback to the ROOT domain, then back to the clinic.
   *
   * Google requires each redirect URI to be registered exactly, and does not
   * accept wildcards — so `https://*.kokli.in/api/auth/callback/google` is
   * not a thing you can register. With `redirectProxyUrl`:
   *
   *   1. aarogya.kokli.in sends the patient to Google, with the one registered
   *      callback (kokli.in/api/auth/callback/google) and its own address
   *      sealed inside the `state` parameter
   *   2. Google returns them to kokli.in, which only unseals `state` and
   *      forwards the code to aarogya.kokli.in/api/auth/callback/google
   *   3. aarogya.kokli.in finishes the sign-in itself — which matters, because
   *      the PKCE cookie from step 1 exists only on that hostname
   *
   * Used in development too (with the port): without it the callback finished
   * on localhost:3000, where the clinic's PKCE cookie is invisible, so Google
   * sign-in could never work from a clinic subdomain.
   *
   * AUTH_URL MUST NOT BE SET. next-auth rewrites every request's address to
   * AUTH_URL, so aarogya.kokli.in would look like kokli.in, step 1 would think
   * it was already on the root domain, and nothing would ever be forwarded.
   * `trustHost` above, and withRealAddress() in
   * app/api/auth/[...nextauth]/route.js, are what let each hostname speak for
   * itself.
   */
  ...(googleEnabled ? { redirectProxyUrl: platformUrl('/api/auth') } : {}),

  callbacks: {
    /**
     * Runs whenever a session is read — including inside middleware.
     *
     * Copy across only what is needed. The session is a cookie, and cookies are
     * sent on every single request, so a fat session makes the whole site
     * slower.
     *
     * `clinicId` and `clinicSlug` are the important additions for the platform:
     * the slug is what proxy.js compares against the hostname, and it must be in
     * the token because middleware cannot look it up.
     */
    session({ session, token }) {
      if (token) {
        session.user.id = token.id
        session.user.role = token.role
        session.user.clinicId = token.clinicId ?? null
        session.user.clinicSlug = token.clinicSlug ?? null
        session.user.phone = token.phone ?? null
      }
      return session
    },
  },
}
