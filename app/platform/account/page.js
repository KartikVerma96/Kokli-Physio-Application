import { ShieldAlert } from 'lucide-react'
import { auth } from '@/lib/auth'
import { passwordState } from '@/lib/passwordReset'
import { formatDateShort } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import PasswordCard from '@/components/account/PasswordCard'

/**
 * ============================================================================
 *  YOUR ACCOUNT  →  kokli.local/platform/account
 * ============================================================================
 *  The platform owner's own password.
 *
 *  WHY THIS ONE IS THE MOST IMPORTANT OF THE THREE
 *  -----------------------------------------------
 *  Every other account has a second way in. A patient or a clinic user with a
 *  number on file can sign in with a WhatsApp code and never needs the password at
 *  all.
 *
 *  This account cannot. It is deliberately excluded from phone sign-in, because a
 *  SIM swap — common in India — must never reach the one login that can read every
 *  clinic's medical records. So its password is the only key, its email reset is the
 *  only spare, and `npm run set-password` is the only locksmith.
 * ============================================================================
 */

export const metadata = { title: 'Your account', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function PlatformAccountPage() {
  const session = await auth()
  const security = await passwordState(session.user.id)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Your account</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          {session.user.email}
        </p>
      </div>

      <Card className="flex items-start gap-3 border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950/30">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="text-amber-900 dark:text-amber-100">
          <p className="font-bold">This account has no second way in.</p>
          <p className="mt-0.5 text-amber-800 dark:text-amber-200">
            Phone sign-in is switched off for it on purpose — a swapped SIM must not reach an account
            that can read every clinic&apos;s patient records. Keep this password in a password
            manager, and make sure email is configured so the reset link can actually reach you. If
            both fail, <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">npm run set-password</code>{' '}
            on the server is the way back.
          </p>
        </div>
      </Card>

      <PasswordCard
        hasPassword={security.hasPassword}
        changedAt={security.changedAt ? formatDateShort(security.changedAt) : null}
      />
    </div>
  )
}
