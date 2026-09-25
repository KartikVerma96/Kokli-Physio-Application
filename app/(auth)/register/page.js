import { redirectIfSignedIn } from '@/lib/guards'
import { redirect } from 'next/navigation'
import { buildMetadata } from '@/lib/seo'
import { googleEnabled } from '@/auth.config'
import { getCurrentClinic } from '@/lib/tenant'
import RegisterForm from './RegisterForm'

/**
 * ============================================================================
 *  CREATE ACCOUNT  →  /register
 * ============================================================================
 */

export const metadata = buildMetadata({
  title: 'Create your account',
  description:
    'Create a patient account to book physiotherapy appointments, join online video consultations and access your prescribed exercises.',
  path: '/register',
  noIndex: true,
})

export default async function RegisterPage({ searchParams }) {
  // Already signed in here? Then this page is not for you. See lib/guards.js.
  await redirectIfSignedIn()

  const params = await searchParams

  /**
   * A PATIENT always belongs to a clinic, so this form only means anything on a
   * clinic's own subdomain.
   *
   * On kokli.in itself it used to render anyway: somebody filled in their name,
   * email, phone and password twice, ticked the consent box, pressed Create — and
   * only then was told "Patient accounts are created on a clinic's own website".
   * /api/register was right to refuse. The page was wrong to offer.
   *
   * The person reaching /register on the platform domain is, overwhelmingly, a
   * clinic owner who clicked "Create an account" on the sign-in page — so they are
   * sent where they meant to go. A patient who lands here by mistake finds the
   * clinic signup instead of a dead form, which is at least honest about what the
   * site is.
   */
  const clinic = await getCurrentClinic()
  if (!clinic) redirect('/signup')

  return (
    <RegisterForm
      googleEnabled={googleEnabled}
      next={sanitiseNext(params?.next)}
    />
  )
}

/** Only relative paths, to prevent an open-redirect. Same as the login page. */
function sanitiseNext(next) {
  if (typeof next !== 'string') return null
  if (!next.startsWith('/') || next.startsWith('//')) return null
  return next
}
