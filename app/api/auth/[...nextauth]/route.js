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

import { handlers } from '@/lib/auth'

export const { GET, POST } = handlers
