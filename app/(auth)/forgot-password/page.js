import Link from 'next/link'
import { buildMetadata } from '@/lib/seo'
import { getCurrentClinic } from '@/lib/tenant'
import { canSendAuthCodes } from '@/lib/whatsapp'
import ForgotPasswordForm from './ForgotPasswordForm'

/**
 * ============================================================================
 *  FORGOT PASSWORD  →  /forgot-password
 * ============================================================================
 *  THERE ARE TWO WAYS BACK IN, AND THE SECOND ONE IS BETTER
 *  -------------------------------------------------------
 *  The email link is the traditional route and it works for everybody, including
 *  the platform account, which has no phone number on file.
 *
 *  But for an Indian physiotherapy patient it is often the worse option, and
 *  sometimes an impossible one. Reception's new-patient form marks email OPTIONAL,
 *  so a large share of patients have a placeholder address ending in `.invalid`
 *  that no mail can ever reach. Even those with a real one may not read it.
 *
 *  Those patients already have a working door: the WhatsApp code on the login
 *  page. Signing in that way needs no password at all, and once inside they can
 *  set one from their profile. So this page points at it FIRST when the clinic can
 *  send codes — a route that works beats a route that is conventional.
 * ============================================================================
 */

export const metadata = buildMetadata({
  title: 'Reset your password',
  description: 'Ask for a link to choose a new password.',
  path: '/forgot-password',
  noIndex: true,
})

export default async function ForgotPasswordPage() {
  const clinic = await getCurrentClinic()
  const phoneEnabled = clinic ? await canSendAuthCodes(clinic) : false

  return (
    <div>
      <h1 className="text-3xl font-bold">Reset your password</h1>
      <p className="mt-2 text-ink-600 dark:text-ink-400">
        Enter the email address on your account and we will send you a link.
      </p>

      {phoneEnabled && (
        <div className="mt-6 rounded-2xl border border-brand-200 bg-brand-50/70 p-4 text-sm dark:border-brand-800 dark:bg-brand-950/30">
          <p className="font-bold">No password? You may not need one.</p>
          <p className="mt-1 text-ink-600 dark:text-ink-300">
            If your clinic has your mobile number, you can sign in with a WhatsApp code instead —
            then set a password from your profile once you are in.
          </p>
          <Link
            href="/login"
            className="mt-2 inline-block font-semibold text-brand-700 hover:underline dark:text-brand-400"
          >
            Sign in with your mobile number →
          </Link>
        </div>
      )}

      <div className="mt-7">
        <ForgotPasswordForm />
      </div>

      <p className="mt-8 text-center text-sm text-ink-600 dark:text-ink-400">
        Remembered it?{' '}
        <Link href="/login" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
          Sign in
        </Link>
      </p>
    </div>
  )
}
