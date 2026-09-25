import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getCurrentClinic, getCurrentSlug } from '@/lib/tenant'
import { clinicUrl } from '@/config/platform'

/**
 * ============================================================================
 *  TENANT-AWARE AUTHORISATION GUARDS
 * ============================================================================
 *  The check that keeps one clinic out of another clinic's data, in one place.
 *
 *  WHY THIS FILE EXISTS
 *  --------------------
 *  An identical `requireClinicAdmin` had been copied into five server-action files.
 *  Copies of an authorisation check are a specific hazard: the day one of them
 *  needs a fix, four keep the bug, and nothing tells you which four.
 *
 *  Note this is NOT the same idea as the deliberate double-checking elsewhere in
 *  the app — proxy.js and each layout both verifying a role is defence in depth,
 *  because they are different checks at different layers. Five byte-identical
 *  copies of one function is not depth, it is drift waiting to happen.
 *
 *  THE THREE QUESTIONS, IN ORDER
 *  -----------------------------
 *    1. Which clinic is this hostname?     — never taken from the request body
 *    2. Who is signed in?                  — from the signed session cookie
 *    3. Do those two agree?                — the one that matters
 *
 *  Question 3 is the whole point. A clinic A administrator has a perfectly valid
 *  session cookie, and that cookie is visible on clinic B's subdomain because it is
 *  set on the parent domain. Without this comparison, being an admin anywhere would
 *  make you an admin everywhere.
 * ============================================================================
 */

/**
 * The clinic, if the caller may administer it. Throws otherwise.
 *
 * Platform staff pass, because supporting a paying customer means being able to
 * look at their settings — the same exception made in requireClinicUser().
 *
 * Throws rather than returning null so that a forgotten `if` cannot become an
 * authorisation bypass. A caller that ignores the result gets a 500, which is
 * noisy and safe; a caller that ignores a null gets a silent breach.
 */
export async function requireClinicAdmin() {
  const clinic = await getCurrentClinic()
  if (!clinic) throw new Error('NO_CLINIC')

  const session = await auth()
  if (!session?.user) throw new Error('UNAUTHENTICATED')
  if (session.user.role === 'platform') return clinic
  if (session.user.role !== 'admin') throw new Error('FORBIDDEN')
  if (Number(session.user.clinicId) !== Number(clinic.id)) throw new Error('FORBIDDEN')

  return clinic
}

/**
 * The clinic, if the caller is staff there — admin OR physio.
 *
 * In a one-therapist clinic the physiotherapist genuinely needs the diary, the
 * patient list and the notes, so locking those to a separate admin login would
 * only mean two people sharing one password. Money and staffing use
 * requireClinicAdmin() instead.
 */
export async function requireClinicStaff() {
  const clinic = await getCurrentClinic()
  if (!clinic) throw new Error('NO_CLINIC')

  const session = await auth()
  if (!session?.user) throw new Error('UNAUTHENTICATED')
  if (session.user.role === 'platform') return clinic
  if (!['admin', 'physio'].includes(session.user.role)) throw new Error('FORBIDDEN')
  if (Number(session.user.clinicId) !== Number(clinic.id)) throw new Error('FORBIDDEN')

  return clinic
}

/**
 * Turn a thrown guard into something a form can show.
 *
 * The messages are deliberately vague about WHICH check failed. "You are not an
 * admin of this clinic" tells an attacker their session is valid and they are
 * probing the right place; "you are not allowed to do that" tells them nothing.
 */
export function guardFailure(error) {
  const reason = String(error?.message || '')
  if (reason === 'UNAUTHENTICATED') {
    return { ok: false, error: 'Your session has expired. Please sign in again.' }
  }
  return { ok: false, error: 'You are not allowed to do that.' }
}

/**
 * Send somebody who is already signed in HERE away from a guest page.
 *
 * Called at the top of /login, /register, /signup and /forgot-password. It
 * replaces a rule that lived in proxy.js and turned the sign-in button into a
 * loop: the middleware can read a token but not check it against the database,
 * so it bounced people whose accounts had been deleted. `auth()` here runs the
 * jwt callback in lib/auth.js, which does check — a stale token comes back as no
 * session, and the page simply renders.
 *
 * Where they are sent depends on which world they are in:
 *
 *   on kokli.in        the platform account goes to /platform; anybody else is
 *                      sent to their OWN clinic's address, because a clinic
 *                      owner who types kokli.in and presses "Sign in" means
 *                      "take me to my clinic"
 *   on a clinic site   only that clinic's own staff and patients are sent on;
 *                      another clinic's session and the platform account see
 *                      the form, the same rule proxy.js applies to every
 *                      protected page
 *
 * The login form on kokli.in relies on the first rule: after signing in it just
 * reloads /login, and this decides where each account belongs.
 */
export async function redirectIfSignedIn() {
  const session = await auth()
  const user = session?.user
  if (!user) return

  const slug = await getCurrentSlug()

  if (!slug) {
    if (user.role === 'platform') redirect('/platform')
    if (user.clinicSlug) {
      redirect(clinicUrl(user.clinicSlug, user.role === 'patient' ? '/dashboard' : '/admin'))
    }
    return
  }

  if (user.role === 'platform' || user.clinicSlug !== slug) return
  redirect(user.role === 'patient' ? '/dashboard' : '/admin')
}
