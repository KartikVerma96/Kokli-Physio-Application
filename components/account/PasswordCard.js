'use client'

import { useState } from 'react'
import { Lock, KeyRound, ShieldCheck } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { changeMyPassword } from '@/app/account/actions'

/**
 * ============================================================================
 *  PASSWORD CARD
 * ============================================================================
 *  Mounted in three places — the patient's profile, the clinic's account settings
 *  and the platform console — because all three needed it and none had it.
 *
 *  WHY `hasPassword` CHANGES THE WHOLE FORM
 *  ----------------------------------------
 *  A large share of accounts in this product have NO password:
 *
 *    * anyone reception created at the desk (no password_hash at all)
 *    * anyone who signed up with Google
 *    * anyone who signed in with a WhatsApp code
 *
 *  For them this is not "change your password", it is "set one", and asking for a
 *  current password they have never had would be an impossible field on a form
 *  they need. So the current-password box is only rendered when there is one to
 *  check — and the server makes the same decision independently, because a client
 *  deciding what to validate is not validation.
 * ============================================================================
 */

export default function PasswordCard({ hasPassword, changedAt }) {
  const [values, setValues] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const update = (field) => (event) =>
    setValues((prev) => ({ ...prev, [field]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setErrors({})
    setBusy(true)

    try {
      const result = await changeMyPassword(values)

      if (!result.ok) {
        if (result.field) setErrors({ [result.field]: result.message })
        else toast.error(result.message || 'Something went wrong.')
        return
      }

      toast.success(result.message)
      // Cleared on success. Leaving a password sitting in a form on a shared
      // reception computer is exactly the situation this feature exists for.
      setValues({ currentPassword: '', newPassword: '', confirm: '' })
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink-100 dark:bg-ink-800">
          <KeyRound className="size-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">{hasPassword ? 'Change your password' : 'Set a password'}</h2>
          <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
            {hasPassword
              ? changedAt
                ? `Last changed ${changedAt}.`
                : 'You have never changed it — if somebody else chose it for you, change it now.'
              : 'You sign in with Google or a WhatsApp code. A password gives you a second way in.'}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4">
        {hasPassword && (
          <Input
            label="Current password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            value={values.currentPassword}
            onChange={update('currentPassword')}
            error={errors.currentPassword}
            icon={<Lock className="size-4" />}
            required
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={hasPassword ? 'New password' : 'Password'}
            name="newPassword"
            type="password"
            // Makes a password manager offer to generate one, rather than filling
            // in the existing password.
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={values.newPassword}
            onChange={update('newPassword')}
            error={errors.newPassword}
            icon={<Lock className="size-4" />}
            required
          />
          <Input
            label="Confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            value={values.confirm}
            onChange={update('confirm')}
            error={errors.confirm}
            icon={<Lock className="size-4" />}
            required
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" loading={busy}>
            {hasPassword ? 'Update password' : 'Set password'}
          </Button>
          <p className="flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            We will email you whenever it changes.
          </p>
        </div>
      </form>
    </Card>
  )
}
