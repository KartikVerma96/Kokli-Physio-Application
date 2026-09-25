import { redirectIfSignedIn } from '@/lib/guards'
import { buildMetadata } from '@/lib/seo'
import { googleEnabled } from '@/auth.config'
import { getCurrentClinic } from '@/lib/tenant'
import { canSendAuthCodes } from '@/lib/whatsapp'
import LoginForm from './LoginForm'

/**
 * ============================================================================
 *  SIGN IN  →  /login
 * ============================================================================
 *  A thin Server Component wrapper. It reads the URL parameters on the server
 *  and hands them to the interactive form.
 *
 *  Two parameters matter:
 *    ?next=/dashboard   where to go after signing in. middleware.js adds this
 *                       when it intercepts someone heading somewhere private.
 *    ?error=...         Auth.js redirects here with this when an OAuth attempt
 *                       fails, so we can show a real message instead of a blank
 *                       page.
 *
 *  `googleEnabled` is read here rather than in the form because it depends on a
 *  server-only environment variable. If Google is not configured, the button
 *  simply is not rendered — much better than showing a button that leads to an
 *  error page.
 *
 *  `phoneEnabled` follows the same rule for the same reason, but the condition is
 *  different: a code can only be delivered if the clinic's WhatsApp is set up and
 *  its monthly allowance is not exhausted. Offering phone sign-in to a clinic that
 *  cannot send a message would be a button that always fails.
 * ============================================================================
 */

export const metadata = buildMetadata({
  title: 'Sign in',
  description: `Sign in to your ${'patient'} account to manage appointments, join video consultations and see your prescribed exercises.`,
  path: '/login',
  // A login page has no business in search results. It has no useful content,
  // and indexing it wastes crawl budget that should go to treatment pages.
  noIndex: true,
})

export default async function LoginPage({ searchParams }) {
  // Already signed in here? Then this page is not for you. See lib/guards.js.
  await redirectIfSignedIn()

  // In the App Router, searchParams is a promise — it must be awaited.
  const params = await searchParams

  /**
   * No clinic on the platform's own /login — that page signs YOU in, and the
   * platform account deliberately keeps a password (see the phone-otp provider in
   * lib/auth.js: a SIM swap must not reach every clinic's records).
   */
  const clinic = await getCurrentClinic()
  const phoneEnabled = clinic ? await canSendAuthCodes(clinic) : false

  return (
    <LoginForm
      googleEnabled={googleEnabled}
      phoneEnabled={phoneEnabled}
      // Only ever accept a relative path. Without this check, someone could
      // send a patient a link to /login?next=https://evil-site.example and the
      // app would happily redirect them there after a successful login, which
      // is a textbook open-redirect phishing vector.
      next={sanitiseNext(params?.next)}
      oauthError={typeof params?.error === 'string' ? params.error : null}
      justRegistered={params?.registered === '1'}
      justReset={params?.reset === '1'}
      // On kokli.in there is no clinic to join as a patient, so "create an
      // account" has to mean starting a clinic, not registering for one.
      onPlatform={!clinic}
    />
  )
}

function sanitiseNext(next) {
  if (typeof next !== 'string') return null
  // Must start with a single slash. '//evil.example' is a protocol-relative URL
  // that browsers treat as absolute, so it is rejected too.
  if (!next.startsWith('/') || next.startsWith('//')) return null
  return next
}
