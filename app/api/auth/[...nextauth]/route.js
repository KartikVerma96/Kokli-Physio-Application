/**
 * ============================================================================
 *  THE AUTH ENDPOINTS
 * ============================================================================
 *
 *  These four lines create every authentication URL the app needs:
 *
 *    POST /api/auth/signin/credentials   email + password sign-in
 *    GET  /api/auth/signin/google        start the Google redirect
 *    GET  /api/auth/callback/google      where Google sends the user back
 *    POST /api/auth/signout              sign out
 *    GET  /api/auth/session              the current session as JSON
 *    GET  /api/auth/csrf                 the CSRF token the forms use
 *
 *  [...nextauth] is a catch-all route segment: it matches /api/auth/anything,
 *  at any depth, and Auth.js works out which of the above was asked for.
 *
 *  This is also why the Google redirect URI you register in Google Cloud must
 *  be exactly  http://localhost:3000/api/auth/callback/google  — that path is
 *  defined by this file's location on disk.
 * ============================================================================
 */

import { NextRequest } from 'next/server'
import { handlers } from '@/lib/auth'
import { platform } from '@/config/platform'

/**
 * Give Auth.js the address the visitor actually typed.
 *
 * Behind our own server (server.js), a route handler's `request.url` always says
 * `localhost:3000` — even for a request to aarogya.localhost:3000 or, in
 * production, aarogya.kokli.in. The real hostname only survives in the Host
 * header. Auth.js reads `request.url`, so every clinic looked like the root
 * domain, and Google sign-in from a clinic's website could never finish: the
 * callback was never forwarded back to the clinic (see redirectProxyUrl in
 * auth.config.js).
 *
 * Only OUR hostnames are accepted. The Host header is chosen by whoever sends
 * the request, and a forged one must not be able to make Auth.js build its
 * links on somebody else's domain.
 */
function withRealAddress(request) {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (!host) return request

  const name = host.split(':')[0]
  if (name !== platform.domain && !name.endsWith(`.${platform.domain}`)) return request

  const url = new URL(request.url)
  url.protocol = `${platform.protocol}:`
  url.host = host
  return new NextRequest(url, request)
}

export const GET = (request) => handlers.GET(withRealAddress(request))
export const POST = (request) => handlers.POST(withRealAddress(request))
