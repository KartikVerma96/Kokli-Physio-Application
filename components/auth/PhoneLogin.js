'use client'

import { useEffect, useRef, useState } from 'react'
import { signIn } from 'next-auth/react'
import { AlertCircle, ArrowLeft, CheckCircle2, Smartphone, User } from 'lucide-react'
import { Input } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { requestLoginCode, confirmLoginCode } from '@/app/(auth)/login/otpActions'

/**
 * ============================================================================
 *  SIGN IN WITH A PHONE NUMBER
 * ============================================================================
 *  Three steps, and the third only sometimes:
 *
 *    phone  →  code  →  [ who are you? ]  →  signed in
 *
 *  WHY THE THIRD STEP EXISTS
 *  -------------------------
 *  In India one mobile number serves a household. A mother books physiotherapy
 *  for her eight-year-old on her own number; a son's number is on file for both
 *  his parents. So a verified number identifies a FAMILY, and when it matches
 *  more than one person the only honest thing to do is ask which of them is
 *  signing in.
 *
 *  Skipping it — silently picking the first match — would put a mother into her
 *  child's medical record without telling her, or worse, the other way round.
 *
 *  WHY THE CODE IS NOT SENT TO signIn()
 *  ------------------------------------
 *  It cannot be: a code is single-use, and it has already been spent verifying.
 *  What travels to signIn() is the signed ticket the server returned, which says
 *  "this number was proved, and these accounts are on it". The Auth.js provider
 *  re-checks the signature and that the chosen id is one of those named. See the
 *  note above issueLoginTicket() in lib/otp.js.
 * ============================================================================
 */

/** Matches RESEND_COOLDOWN_SECONDS in lib/otp.js. Kept in step so the button
 *  becomes clickable exactly when the server will accept it. */
const RESEND_SECONDS = 45

export default function PhoneLogin({ callbackUrl = '/dashboard', onCancel }) {
  const [step, setStep] = useState('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  // The ticket and the household, once the code has been accepted.
  const [ticket, setTicket] = useState(null)
  const [accounts, setAccounts] = useState([])

  const codeRef = useRef(null)

  /* ------------------------------------------------------- resend countdown */
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  // Move the caret into the code box the moment it appears. On a phone this is
  // the difference between "type the code" and "tap the box, then type the code".
  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  /* ------------------------------------------------------------ step 1: send */
  async function send(event) {
    event?.preventDefault()
    setError(null)
    setBusy(true)

    try {
      const result = await requestLoginCode({ phone })
      if (!result.ok) {
        setError(result.message)
        if (result.retryAfter) setCooldown(Math.min(result.retryAfter, RESEND_SECONDS))
        return
      }
      setNotice(result.message)
      setStep('code')
      setCooldown(RESEND_SECONDS)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  /* ----------------------------------------------------------- step 2: check */
  async function check(event) {
    event?.preventDefault()
    setError(null)
    setBusy(true)

    try {
      const result = await confirmLoginCode({ phone, code })
      if (!result.ok) {
        setError(result.message)
        // A rejected code is worth clearing: the usual cause is a mistyped digit
        // and leaving it there invites the same mistake again.
        setCode('')
        codeRef.current?.focus()
        return
      }

      setTicket(result.ticket)
      setAccounts(result.accounts)

      // One person on this number — no reason to ask a question with one answer.
      if (result.accounts.length === 1) {
        await finish(result.ticket, result.accounts[0].id)
        return
      }

      setStep('pick')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  /* -------------------------------------------------------- step 3: sign in */
  async function finish(withTicket, userId) {
    setBusy(true)
    /**
     * No `redirect: false`. Auth.js sets the session cookie and navigates, and
     * the callback URL is where proxy.js takes over — staff typing a patient's
     * URL get forwarded to /admin from there. Handling the redirect ourselves
     * would mean duplicating that routing in the browser.
     */
    await signIn('phone-otp', { ticket: withTicket, userId: String(userId), callbackUrl })
  }

  /* ================================================================== render */

  if (step === 'pick') {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>Number confirmed. This number is on file for more than one person.</p>
        </div>

        <p className="text-sm font-semibold">Who is signing in?</p>

        <ul className="space-y-2">
          {accounts.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                onClick={() => finish(ticket, account.id)}
                disabled={busy}
                className="flex w-full items-center gap-3 rounded-2xl border border-ink-200 p-4 text-left transition-all hover:border-brand-400 hover:bg-brand-50/60 disabled:opacity-60 dark:border-ink-700 dark:hover:border-brand-600 dark:hover:bg-brand-950/30"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink-100 dark:bg-ink-800">
                  <User className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{account.name}</span>
                  <span className="block text-xs capitalize text-ink-500">
                    {account.role === 'patient' ? 'Patient' : account.role}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <form onSubmit={step === 'phone' ? send : check} className="space-y-5" noValidate>
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}

      {step === 'phone' ? (
        <>
          <Input
            label="Mobile number"
            name="phone"
            type="tel"
            /**
             * inputMode="numeric" brings up the number pad; autoComplete="tel"
             * lets the phone fill its own number in one tap. On a login form used
             * mostly on mobile these two attributes matter more than the styling.
             */
            inputMode="numeric"
            autoComplete="tel"
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            icon={<Smartphone className="size-4" />}
            hint="The number your clinic has on file. We will send a code on WhatsApp."
            required
            autoFocus
          />

          <Button type="submit" loading={busy} className="w-full">
            Send code on WhatsApp
          </Button>
        </>
      ) : (
        <>
          {notice && (
            <p className="text-sm text-ink-600 dark:text-ink-300">{notice}</p>
          )}

          <Input
            ref={codeRef}
            label="6-digit code"
            name="code"
            type="text"
            inputMode="numeric"
            /**
             * autoComplete="one-time-code" is what lets iOS and Android offer the
             * code straight from the notification. It only works for a 6-digit
             * numeric field, which is part of why the code is six digits.
             */
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="••••••"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="text-center text-lg tracking-[0.5em]"
            required
          />

          <Button type="submit" loading={busy} disabled={code.length !== 6} className="w-full">
            Sign in
          </Button>

          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setStep('phone')
                setCode('')
                setError(null)
                setNotice(null)
              }}
              className="inline-flex items-center gap-1 font-medium text-ink-500 hover:text-brand-700 dark:hover:text-brand-200"
            >
              <ArrowLeft className="size-3" aria-hidden="true" />
              Change number
            </button>

            <button
              type="button"
              onClick={send}
              disabled={cooldown > 0 || busy}
              className="font-semibold text-brand-700 hover:underline disabled:text-ink-400 disabled:no-underline dark:text-brand-400"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
        </>
      )}

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="w-full text-center text-xs font-medium text-ink-500 hover:text-brand-700 dark:hover:text-brand-200"
        >
          Use email and password instead
        </button>
      )}
    </form>
  )
}
