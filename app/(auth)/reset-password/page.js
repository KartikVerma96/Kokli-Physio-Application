import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { buildMetadata } from '@/lib/seo'
import { checkResetToken } from '@/lib/passwordReset'
import ResetPasswordForm from './ResetPasswordForm'

/**
 * ============================================================================
 *  CHOOSE A NEW PASSWORD  →  /reset-password?token=…
 * ============================================================================
 *  The token is checked HERE, on the server, before the form is drawn — and
 *  deliberately without consuming it.
 *
 *  The alternative is letting somebody type a new password twice, press the
 *  button, and only then be told the link expired forty minutes ago. Checking
 *  first costs one query and turns a wasted attempt into a clear instruction.
 * ============================================================================
 */

export const metadata = buildMetadata({
  title: 'Choose a new password',
  path: '/reset-password',
  noIndex: true,
})

export default async function ResetPasswordPage({ searchParams }) {
  const params = await searchParams
  const token = typeof params?.token === 'string' ? params.token : ''

  const valid = await checkResetToken(token)

  if (!valid) {
    return (
      <div>
        <h1 className="text-3xl font-bold">This link has expired</h1>
        <div className="mt-6 flex items-start gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Reset links last one hour and work once.</p>
            <p className="mt-1">
              If you have already used this one, your new password is active — just sign in. Otherwise
              ask for a fresh link.
            </p>
          </div>
        </div>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/forgot-password"
            className="inline-flex h-11 items-center rounded-xl bg-brand-600 px-5 text-sm font-semibold text-[var(--color-brand-fg,#fff)]"
          >
            Send a new link
          </Link>
          <Link
            href="/login"
            className="inline-flex h-11 items-center rounded-xl border border-ink-200 px-5 text-sm font-semibold dark:border-ink-700"
          >
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-3xl font-bold">Choose a new password</h1>
      <p className="mt-2 text-ink-600 dark:text-ink-400">
        For {valid.email}. Pick something you have not used elsewhere.
      </p>

      <div className="mt-7">
        <ResetPasswordForm token={token} />
      </div>
    </div>
  )
}
