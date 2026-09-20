import Google from 'next-auth/providers/google'
import { platform } from '@/config/platform'

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
 *   2. Google sign-in, which must come back to a single registered callback URL
 *      on the root domain — Google does not allow wildcard redirect URIs, so
 *      per-subdomain OAuth callbacks are impossible.
 *
 * The security consequence is handled deliberately in proxy.js: a session is
 * VISIBLE everywhere, so every protected route re-checks that the session's
 * clinic matches the hostname. Sharing the cookie without that check would let
 * any clinic's patient walk into another clinic's site signed in.
 *
 * On localhost the domain is left undefined. Browsers refuse `Domain=.localhost`
 * outright, but they already treat `*.localhost` as the same site for cookie
 * purposes, so subdomain sharing works in development anyway.
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
     * The trade-off: because the session is self-contained, changing someone's
     * role or clinic in the database does not take effect until their token
     * refreshes. `updateAge` below caps that at a day.
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
   * Send every OAuth callback to the ROOT domain.
   *
   * Google requires each redirect URI to be registered exactly, and does not
   * accept wildcards — so `https://*.kokli.in/api/auth/callback/google` is
   * not a thing you can register. `redirectProxyUrl` makes Auth.js always use
   * the root domain for the callback and then forward the user on, so one
   * registered URI covers every clinic.
   */
  ...(googleEnabled && platform.domain !== 'localhost'
    ? { redirectProxyUrl: `${platform.protocol}://${platform.domain}/api/auth` }
    : {}),

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
