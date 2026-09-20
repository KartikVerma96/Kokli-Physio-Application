'use client'

import { useState } from 'react'
import { Mail, CheckCircle2, AlertCircle } from 'lucide-react'
import { Input } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { requestPasswordReset } from './actions'

/**
 * Ask for a reset link.
 *
 * WHY THE SUCCESS STATE REPLACES THE FORM
 * ---------------------------------------
 * The form is gone once it has been submitted, deliberately. Leaving it on screen
 * invites a second and third press, and every press costs the person one of the
 * three links they are allowed per hour — after which they are locked out of the
 * only route back into their account for an hour, by their own impatience.
 */
export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await requestPasswordReset({ email })
      if (result.ok) setSent(result.message)
      else setError(result.message || 'Something went wrong.')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">{sent}</p>
          {/* Named explicitly, because the alternative is somebody deciding the
              product is broken when the mail is simply in a spam folder. */}
          <p className="mt-1">
            Check your spam folder too. If nothing arrives, the address may be different from the one
            on your account — ask your clinic which one they have.
          </p>
        </div>
      </div>
    )
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
        label="Email address"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        icon={<Mail className="size-4" />}
        required
        autoFocus
      />

      <Button type="submit" loading={busy} className="w-full">
        Send me a reset link
      </Button>
    </form>
  )
}
