'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, AlertCircle } from 'lucide-react'
import { Input } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { submitNewPassword } from './actions'

export default function ResetPasswordForm({ token }) {
  const router = useRouter()
  const [values, setValues] = useState({ password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const update = (field) => (event) =>
    setValues((prev) => ({ ...prev, [field]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setError(null)
    setErrors({})
    setBusy(true)

    try {
      const result = await submitNewPassword({ token, ...values })

      if (!result.ok) {
        if (result.field) setErrors({ [result.field]: result.message })
        else setError(result.message)
        return
      }

      toast.success(result.message)
      /**
       * To the login page, not into the app.
       *
       * Signing them in here would hand a live session to anyone holding the link,
       * which turns an intercepted email into an account rather than a chance to
       * guess a password. One extra form is a small price.
       */
      router.push('/login?reset=1')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}

      <Input
        label="New password"
        name="password"
        type="password"
        // 'new-password' rather than 'current-password' is what makes a password
        // manager offer to GENERATE one instead of filling in the old one.
        autoComplete="new-password"
        placeholder="At least 8 characters"
        value={values.password}
        onChange={update('password')}
        error={errors.password || errors.newPassword}
        icon={<Lock className="size-4" />}
        required
        autoFocus
      />

      <Input
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        value={values.confirm}
        onChange={update('confirm')}
        error={errors.confirm}
        icon={<Lock className="size-4" />}
        required
      />

      <Button type="submit" loading={busy} className="w-full">
        Save password
      </Button>
    </form>
  )
}
