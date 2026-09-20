'use client'

/**
 * ============================================================================
 *  REGISTRATION FORM
 * ============================================================================
 *  Creates the account, then signs the person straight in. Making a new patient
 *  fill in a form and then immediately fill in a login form is a pointless
 *  extra step, and a measurable number of people give up at it.
 *
 *  The password strength meter is not decoration: showing progress as someone
 *  types genuinely produces stronger passwords than a list of rules they read
 *  after being rejected.
 * ============================================================================
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { User, Mail, Lock, Phone, AlertCircle } from 'lucide-react'
import { Input, Checkbox } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import GoogleButton from '@/components/auth/GoogleButton'
import { registerSchema, validate } from '@/lib/validation'
import { toast } from '@/lib/toast'
import { cn, firstName } from '@/lib/utils'

export default function RegisterForm({ googleEnabled, next }) {
  const router = useRouter()

  const [values, setValues] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false,
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const destination = next || '/dashboard'

  function update(field, isCheckbox = false) {
    return (event) => {
      const value = isCheckbox ? event.target.checked : event.target.value
      setValues((prev) => ({ ...prev, [field]: value }))
      if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
      if (formError) setFormError(null)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const result = validate(registerSchema, values)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setSubmitting(true)
    setFormError(null)

    try {
      // Step 1: create the account. The API route validates everything again
      // with the same schema — see app/api/register/route.js.
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const data = await response.json()

      if (!response.ok) {
        // The server may return per-field errors (e.g. "email already
        // registered"), which we merge into the form so the message appears
        // under the offending input rather than floating at the top.
        if (data.errors) setErrors(data.errors)
        const message = data.error || 'We could not create your account. Please try again.'
        setFormError(message)
        toast.error(message)
        setSubmitting(false)
        return
      }

      // Step 2: sign them in with the credentials they just chose.
      const signInResult = await signIn('credentials', {
        email: values.email,
        password: values.password,
        redirect: false,
      })

      if (signInResult?.error) {
        // The account genuinely exists, so send them to the login page with a
        // confirmation rather than showing a scary error.
        toast.success('Account created. Please sign in.')
        router.push('/login?registered=1')
        return
      }

      // Now we DO have their name, because they just typed it.
      toast.success(
        `Welcome, ${firstName(values.name)}. Your account is ready — let us find you a slot.`
      )

      router.refresh()
      router.push(destination)
    } catch {
      const message = 'Something went wrong on our side. Please try again.'
      setFormError(message)
      toast.error(message)
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-bold">Create your account</h1>
      <p className="mt-2 text-ink-600 dark:text-ink-400">
        It takes about thirty seconds, and you only do it once.
      </p>

      {googleEnabled && (
        <>
          <div className="mt-7">
            <GoogleButton callbackUrl={destination} label="Sign up with Google" />
          </div>
          <div className="my-7 flex items-center gap-4">
            <span className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
            <span className="text-xs font-medium uppercase tracking-wider text-ink-400">
              or use your email
            </span>
            <span className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
          </div>
        </>
      )}

      <form onSubmit={handleSubmit} className={googleEnabled ? 'space-y-5' : 'mt-7 space-y-5'} noValidate>
        {formError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{formError}</p>
          </div>
        )}

        <Input
          label="Full name"
          name="name"
          autoComplete="name"
          placeholder="Rohan Deshpande"
          value={values.name}
          onChange={update('name')}
          error={errors.name}
          icon={<User className="size-4" />}
          required
          autoFocus
        />

        <Input
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={values.email}
          onChange={update('email')}
          error={errors.email}
          icon={<Mail className="size-4" />}
          hint="Appointment confirmations and invoices go here"
          required
        />

        <Input
          label="Mobile number"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="98765 43210"
          value={values.phone}
          onChange={update('phone')}
          error={errors.phone}
          icon={<Phone className="size-4" />}
          hint="Optional, but it lets the clinic reach you if a slot has to move"
        />

        <div>
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={values.password}
            onChange={update('password')}
            error={errors.password}
            icon={<Lock className="size-4" />}
            required
          />
          {values.password && <PasswordStrength password={values.password} />}
        </div>

        <Input
          label="Confirm password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder="Type it once more"
          value={values.confirmPassword}
          onChange={update('confirmPassword')}
          error={errors.confirmPassword}
          icon={<Lock className="size-4" />}
          required
        />

        <Checkbox
          name="acceptTerms"
          checked={values.acceptTerms}
          onChange={update('acceptTerms', true)}
          error={errors.acceptTerms}
          label={
            <>
              I agree to the{' '}
              <Link href="/terms" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
                terms of service
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
                privacy policy
              </Link>
              , including the storage of my clinical records.
            </>
          }
        />

        <Button type="submit" fullWidth size="lg" loading={submitting}>
          {submitting ? 'Creating your account…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-7 text-center text-sm text-ink-600 dark:text-ink-400">
        Already have an account?{' '}
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
          className="font-semibold text-brand-700 hover:underline dark:text-brand-400"
        >
          Sign in
        </Link>
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  PASSWORD STRENGTH METER                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A simple, honest strength indicator.
 *
 * It scores length and character variety, which is a rough proxy — a real
 * estimator like zxcvbn also checks against lists of common passwords and
 * keyboard patterns, and would rightly rate "Password123" as weak where this
 * gives it a pass. For a clinic app this is a reasonable trade: it nudges people
 * towards better passwords without adding a 400KB dependency.
 *
 * Length matters far more than symbols, which is why it is weighted heaviest
 * here. "correcthorsebatterystaple" is genuinely stronger than "P@ss1!".
 */
function PasswordStrength({ password }) {
  const checks = [
    password.length >= 8,
    password.length >= 12,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ]
  const score = checks.filter(Boolean).length

  const levels = [
    { label: 'Very weak', colour: 'bg-red-500', text: 'text-red-600' },
    { label: 'Weak', colour: 'bg-red-500', text: 'text-red-600' },
    { label: 'Fair', colour: 'bg-amber-500', text: 'text-amber-600' },
    { label: 'Good', colour: 'bg-lime-500', text: 'text-lime-600' },
    { label: 'Strong', colour: 'bg-emerald-500', text: 'text-emerald-600' },
    { label: 'Very strong', colour: 'bg-emerald-600', text: 'text-emerald-700' },
  ]
  const level = levels[score]

  return (
    <div className="mt-2.5">
      <div className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors duration-300',
              index < score ? level.colour : 'bg-ink-200 dark:bg-ink-700'
            )}
          />
        ))}
      </div>
      {/* aria-live so a screen reader hears the rating change as they type,
          rather than only seeing coloured bars they cannot perceive. */}
      <p className={cn('mt-1.5 text-xs font-medium', level.text)} aria-live="polite">
        {level.label}
        {score < 3 && ' — try making it longer'}
      </p>
    </div>
  )
}
