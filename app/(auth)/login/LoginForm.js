'use client'

/**
 * ============================================================================
 *  SIGN IN FORM
 * ============================================================================
 *  A Client Component, because it has state, validation and a submit handler.
 *
 *  THE TWO WAYS IN, AND WHY THEY BEHAVE DIFFERENTLY
 *  -----------------------------------------------
 *  Email + password  → signIn('credentials', { redirect: false })
 *      We handle the outcome ourselves, so a wrong password shows an inline
 *      error and keeps everything the patient typed. Letting Auth.js redirect
 *      would bounce them to a fresh page with an empty form, which is
 *      infuriating on a phone.
 *
 *  Google           → signIn('google', { callbackUrl })
 *      This one MUST redirect — the whole point of OAuth is that the browser
 *      leaves for accounts.google.com and comes back. There is nothing to
 *      handle inline.
 * ============================================================================
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSession, signIn } from 'next-auth/react'
import { Mail, Lock, AlertCircle, CheckCircle2, Smartphone } from 'lucide-react'
import { Input, Checkbox } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import GoogleButton from '@/components/auth/GoogleButton'
import PhoneLogin from '@/components/auth/PhoneLogin'
import { loginSchema, validate } from '@/lib/validation'
import { toast } from '@/lib/toast'

export default function LoginForm({ googleEnabled, phoneEnabled, next, oauthError, justRegistered, justReset }) {
  const router = useRouter()

  const [values, setValues] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(oauthErrorMessage(oauthError))
  const [submitting, setSubmitting] = useState(false)

  /**
   * Which sign-in method is on screen.
   *
   * Phone first when it is available, because for most Indian patients it is the
   * only one that works — reception collects a number for everybody and an email
   * for some, and a desk-created patient has no password at all. The email form is
   * one tap away for the people who do have one.
   */
  /**
   * Which sign-in method to show first.
   *
   * Phone-and-WhatsApp-code for patients, because most of them have no password:
   * reception created them at the desk, or they came in through Google. Making
   * them hunt for the right method is how a patient gives up on their own portal.
   *
   * BUT anyone arriving with `?next=/admin…` is STAFF, and staff sign in with
   * email and password every single working day. Showing them the patient form and
   * making them click through to the real one is a small daily insult — and it is
   * exactly what happened the first time somebody tried to reach /admin/billing.
   *
   * The `next` parameter is a precise signal here: nothing but staff is ever sent
   * to /admin. It is already sanitised in page.js to start with a single slash, so
   * it cannot be pointed at another site.
   */
  const headingForStaff = typeof next === 'string' && next.startsWith('/admin')
  const [method, setMethod] = useState(phoneEnabled && !headingForStaff ? 'phone' : 'email')

  /**
   * Where the Google button should return to.
   *
   * OAuth leaves the page entirely, so unlike the password path we cannot read the
   * role and decide afterwards — the callback URL has to be committed up front. It
   * points at /dashboard, and the middleware forwards staff on to /admin from there
   * (proxy.js rule 4), which is exactly the case that used to break.
   */
  const destination = next || '/dashboard'

  // Google sends failures back as ?error=... . The inline banner below shows it, but
  // a redirect lands you on a fresh page and it is easy to miss text you did not
  // watch appear — so it is announced as well.
  useEffect(() => {
    const message = oauthErrorMessage(oauthError)
    if (message) toast.error(message)
  }, [oauthError])

  function update(field) {
    return (event) => {
      setValues((prev) => ({ ...prev, [field]: event.target.value }))
      // Clear this field's error as soon as they start fixing it. Leaving a red
      // error under a box someone is actively correcting feels like nagging.
      if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
      if (formError) setFormError(null)
    }
  }

  async function handleSubmit(event) {
    // Without this the browser does a full page reload and the whole handler is
    // pointless. It is the single most common mistake in React forms.
    event.preventDefault()

    // Validate in the browser first, purely for speed of feedback. The server
    // validates again in lib/auth.js — client checks are a convenience, never a
    // security control, because anyone can bypass them.
    const result = validate(loginSchema, values)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }

    setSubmitting(true)
    setFormError(null)

    try {
      const response = await signIn('credentials', {
        email: result.data.email,
        password: result.data.password,
        redirect: false,
      })

      if (response?.error) {
        /**
         * One deliberately vague message for every failure.
         *
         * Saying "no account with that email" would let anyone check whether a
         * particular person is a patient at a physiotherapy clinic — private
         * medical information, leaked by a login form. This message also quietly
         * covers the Google-only account case.
         */
        const message =
          'That email and password did not match. If you signed up with Google, use the Google button above.'
        setFormError(message)
        toast.error(message)
        setSubmitting(false)
        return
      }

      /**
       * The toast survives the navigation that follows, because router.push is a
       * CLIENT-side navigation — the root layout, and with it the Toaster, stays
       * mounted.
       *
       * No name in the message: we do not have one yet, and guessing from the email
       * local part would greet patient@example.com as "Patient".
       */
      toast.success('Signed in. Welcome back.')

      /**
       * WHERE TO SEND THEM — AND WHY THIS IS NOT SIMPLY '/dashboard'
       *
       * This used to push everyone to /dashboard, which gave STAFF a blank page.
       * Two things were going wrong at once:
       *
       *   1. /dashboard is the patient portal, so an admin landing there has to be
       *      bounced to /admin. That was being left to a redirect() inside the
       *      dashboard layout, which is delicate mid-navigation — see rule 4 in
       *      proxy.js, where it is now handled before rendering starts.
       *
       *   2. router.refresh() ran immediately before router.push(). refresh()
       *      re-fetches the CURRENT route — /login — which, now that the session
       *      cookie exists, the middleware redirects away as a guest-only page. So
       *      two navigations raced, and the loser could leave the router having
       *      committed nothing at all. Hence a blank screen.
       *
       * Reading the session gives us the role, so we navigate ONCE, straight to the
       * right place. getSession() reads the cookie that was just set. No refresh() is
       * needed: navigating to a new route fetches it from the server anyway, with the
       * new cookie attached, so the header renders signed-in correctly.
       */
      const session = await getSession()

      /**
       * Three destinations, because there are three kinds of account:
       *
       *   patient           the clinic's patient portal
       *   admin / physio    that clinic's admin panel
       *   platform          YOUR console, on the root domain
       *
       * The platform case is easy to forget and fails confusingly when you do:
       * /admin does not exist on the root domain, so the middleware bounces you
       * to the marketing page and the sign-in appears to have done nothing.
       */
      const roleHome =
        {
          patient: '/dashboard',
          platform: '/platform',
        }[session?.user?.role] ?? '/admin'

      // An explicit ?next= wins — it is where they were heading before we asked them
      // to sign in.
      router.push(next || roleHome)
    } catch {
      const message = 'Something went wrong on our side. Please try again.'
      setFormError(message)
      toast.error(message)
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-bold">Welcome back</h1>
      <p className="mt-2 text-ink-600 dark:text-ink-400">
        Sign in to manage your appointments and exercises.
      </p>

      {/* Confirmation carried over from a completed password reset. */}
      {justReset && (
        <div className="mt-6 flex items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>Your new password is saved. Sign in with it below.</p>
        </div>
      )}

      {/* Confirmation carried over from a successful registration. */}
      {justRegistered && (
        <div className="mt-6 flex items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>Your account is ready. Sign in to book your first appointment.</p>
        </div>
      )}

      {googleEnabled && (
        <>
          <div className="mt-7">
            <GoogleButton callbackUrl={destination} label="Continue with Google" />
          </div>

          <div className="my-7 flex items-center gap-4">
            <span className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
            <span className="text-xs font-medium uppercase tracking-wider text-ink-400">
              or
            </span>
            <span className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
          </div>
        </>
      )}

      {/* ------------------------------------------------ phone number sign-in */}
      {/* Shown INSTEAD of the email form rather than above it. Three stacked
          forms on one page is a decision nobody wants to make while trying to
          look at their appointment; one door, with the others a tap away. */}
      {phoneEnabled && method === 'phone' && (
        <div className={googleEnabled ? '' : 'mt-7'}>
          <PhoneLogin callbackUrl={destination} onCancel={() => setMethod('email')} />
        </div>
      )}

      {phoneEnabled && method === 'email' && (
        <button
          type="button"
          onClick={() => setMethod('phone')}
          className={`flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-ink-200 bg-white text-sm font-semibold text-ink-800 shadow-soft transition-all hover:border-ink-300 hover:shadow-lift dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100 ${
            googleEnabled ? '' : 'mt-7'
          }`}
        >
          <Smartphone className="size-4" aria-hidden="true" />
          Sign in with your mobile number
        </button>
      )}

      {phoneEnabled && method === 'email' && (
        <div className="my-7 flex items-center gap-4">
          <span className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
          <span className="text-xs font-medium uppercase tracking-wider text-ink-400">
            or use your email
          </span>
          <span className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        hidden={phoneEnabled && method === 'phone'}
        className={googleEnabled || phoneEnabled ? 'space-y-5' : 'mt-7 space-y-5'}
        noValidate
      >
        {formError && (
          // role="alert" makes a screen reader announce this the moment it
          // appears, rather than leaving a blind user wondering why nothing
          // happened when they pressed the button.
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{formError}</p>
          </div>
        )}

        <Input
          label="Email address"
          name="email"
          type="email"
          // autoComplete lets the browser and password manager fill this in.
          // Getting these values right is a real usability win, especially on
          // mobile — and 'email' also brings up the right keyboard.
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={values.email}
          onChange={update('email')}
          error={errors.email}
          icon={<Mail className="size-4" />}
          required
          autoFocus
        />

        <div>
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={values.password}
            onChange={update('password')}
            error={errors.password}
            icon={<Lock className="size-4" />}
            required
          />
          <div className="mt-2.5 flex items-center justify-between">
            <Checkbox label="Keep me signed in" name="remember" defaultChecked />
            {/* Beside the field that failed, not at the bottom of the page.
                Somebody who cannot get in is staring at the password box. */}
            <Link
              href="/forgot-password"
              className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-400"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        <Button type="submit" fullWidth size="lg" loading={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-7 text-center text-sm text-ink-600 dark:text-ink-400">
        New here?{' '}
        <Link
          href={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}
          className="font-semibold text-brand-700 hover:underline dark:text-brand-400"
        >
          Create an account
        </Link>
      </p>

      {/* The demo credentials, so anyone learning from this project can get in
          immediately. Delete this block before the site goes anywhere near a
          real patient. */}
      <div className="mt-8 rounded-2xl border border-dashed border-ink-300 p-4 text-xs dark:border-ink-700">
        <p className="font-bold text-ink-600 dark:text-ink-300">Demo accounts</p>
        <ul className="mt-2 space-y-1 text-ink-500 dark:text-ink-400">
          <li>Patient — patient@example.com / patient123</li>
          <li>Physio — doctor@aarogyaphysio.in / doctor123</li>
          <li>Admin — admin@aarogyaphysio.in / admin123</li>
        </ul>
        <p className="mt-2 text-ink-400">
          Remove this block in app/(auth)/login/LoginForm.js before going live.
        </p>
      </div>
    </div>
  )
}

/** Turn an Auth.js error code from the URL into something a human can act on. */
function oauthErrorMessage(code) {
  if (!code) return null
  const messages = {
    OAuthAccountNotLinked:
      'An account already exists with that email address. Sign in with your password instead.',
    AccessDenied: 'That sign-in was cancelled or the account is not active.',
    Configuration:
      'Google sign-in is not configured correctly. Check AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET in .env.local.',
    Verification: 'That sign-in link has expired. Please try again.',
  }
  return messages[code] || 'Sign-in failed. Please try again.'
}
