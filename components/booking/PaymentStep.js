'use client'

/**
 * ============================================================================
 *  STEP 4 — review and pay
 * ============================================================================
 *  The payment flow, end to end:
 *
 *   1. "Confirm & pay" → POST /api/appointments
 *        The server holds the slot (status 'pending_payment'), creates a
 *        Razorpay order for the price it reads from the DATABASE, and returns
 *        the order id. The browser never sends a price — see the long comment
 *        in app/api/appointments/route.js.
 *
 *   2. Razorpay Checkout opens in an overlay. The patient types their card or
 *        UPI details into Razorpay's own iframe, on Razorpay's domain. We never
 *        see those details, which is precisely why this app does not need PCI
 *        certification.
 *
 *   3. On success Razorpay hands us back a signature. We POST it to
 *        /api/payments/verify, which recomputes the HMAC with our secret key.
 *        Only then does the appointment become 'confirmed'.
 *
 *  The signature step is not a formality. Without it, anyone could call our
 *  verify endpoint by hand and claim to have paid.
 * ============================================================================
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Script from 'next/script'
import { useDispatch, useSelector } from 'react-redux'
import {
  ShieldCheck, Lock, AlertCircle, Clock, CreditCard, Smartphone, Building2, CheckCircle2,
  Layers, Check,
} from 'lucide-react'
import { selectBooking, setPatientPackage } from '@/store/slices/bookingSlice'
import { toast } from '@/lib/toast'
import { formatMoney, formatDateLong, formatTime } from '@/lib/utils'
import Button from '@/components/ui/Button'

export default function PaymentStep({ site, user, packages = [], onStartPayment, onPaid }) {
  const dispatch = useDispatch()
  const booking = useSelector(selectBooking)
  const [scriptReady, setScriptReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [holdUntil, setHoldUntil] = useState(null)

  const { service, mode, date, startTime } = booking

  /* ---------------------------------------------- not signed in: prompt first */
  // The whole selection is packed into the `next` URL, so signing in returns
  // them to precisely this point with everything intact.
  if (!user) {
    const returnUrl = `/book?service=${service?.slug}&mode=${mode}&date=${date}&time=${startTime}`

    return (
      <div className="card p-7">
        <span className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
          <Lock className="size-6" aria-hidden="true" />
        </span>

        <h2 className="mt-5 text-xl font-bold">Sign in to confirm your appointment</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
          We need an account so your appointment, invoice, clinical notes and prescribed exercises
          are saved to you — and so only you can see them. Your selection is kept.
        </p>

        <div className="mt-6 rounded-2xl bg-ink-50 p-4 text-sm dark:bg-ink-800/60">
          <p className="font-semibold">{service?.name}</p>
          <p className="mt-0.5 text-ink-600 dark:text-ink-400">
            {formatDateLong(date)} at {formatTime(startTime)} ·{' '}
            {mode === 'online' ? 'Online video' : 'At the clinic'}
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button href={`/login?next=${encodeURIComponent(returnUrl)}`} size="lg" fullWidth>
            Sign in
          </Button>
          <Button
            href={`/register?next=${encodeURIComponent(returnUrl)}`}
            variant="secondary"
            size="lg"
            fullWidth
          >
            Create an account
          </Button>
        </div>
      </div>
    )
  }

  /* ------------------------------------------------------- the payment flow */

  /**
   * Every payment problem goes through here.
   *
   * It sets the inline banner AND fires a toast. That is deliberate duplication: the
   * banner is the durable record you can re-read while deciding what to do, and the
   * toast is what catches your eye when the failure arrives from Razorpay's overlay
   * rather than from something you just clicked. Payment failures are the single
   * worst thing to miss in this flow.
   */
  function reportProblem(message, tone = 'error') {
    setError(message)
    if (tone === 'warning') toast.warning(message)
    else toast.error(message)
  }

  async function handlePay() {
    setBusy(true)
    setError(null)

    // Step 1: hold the slot and get an order.
    const data = await onStartPayment()
    if (!data) {
      // The wizard has already shown a toast and, if the slot was taken, sent the
      // patient back to the calendar.
      setBusy(false)
      return
    }

    /**
     * PAID FROM A PACKAGE — there is nothing to charge.
     *
     * The server has already confirmed the appointment and spent one prepaid
     * session, so there is no order, no Checkout and no hold to count down. Trying
     * to open Razorpay here would fail on a missing order id.
     */
    if (data.paidFromPackage) {
      onPaid({ code: data.appointment.code, appointmentId: data.appointment.id })
      setBusy(false)
      return
    }

    // Show the countdown so the hold is not a mystery. The deadline comes from the
    // server, which is the clock that actually enforces it.
    setHoldUntil(data.appointment.holdExpiresAt ? Date.parse(data.appointment.holdExpiresAt) : null)

    /**
     * DEMO MODE
     *
     * When no Razorpay keys are configured (and we are not in production), skip
     * Checkout entirely and confirm directly. This is what makes the app fully
     * usable — including the video consultation — before anyone has signed up for
     * a payment gateway. The server-side interlock is in lib/razorpay.js.
     */
    if (data.demoMode) {
      await verifyPayment({
        appointmentId: data.appointment.id,
        razorpay_order_id: data.order.id,
        // Derived from the order id, so it is unique per booking without needing a
        // clock reading.
        razorpay_payment_id: `pay_demo_${data.order.id}`,
        razorpay_signature: 'demo',
      })
      return
    }

    if (!scriptReady || typeof window.Razorpay === 'undefined') {
      reportProblem('The payment window could not load. Check your connection and try again.')
      setBusy(false)
      return
    }

    // Step 2: open Razorpay Checkout.
    const checkout = new window.Razorpay({
      key: data.razorpayKeyId,
      amount: data.order.amount,
      currency: data.order.currency,
      order_id: data.order.id,

      name: data.clinicName,
      description: `${data.appointment.serviceName} · ${formatDateLong(data.appointment.date)}`,
      // Prefilling means the patient does not retype what we already know, which
      // matters a great deal on a phone.
      prefill: data.prefill,
      notes: { appointment_code: data.appointment.code },
      theme: { color: '#0d9488' },

      // Step 3: Razorpay calls this with the signature on success.
      handler: (response) => {
        verifyPayment({
          appointmentId: data.appointment.id,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        })
      },

      modal: {
        // Fired when the patient closes the overlay without paying. The slot stays
        // held until it expires, so they can simply press Pay again — much better
        // than cancelling their booking the instant they hesitate.
        ondismiss: () => {
          setBusy(false)
          reportProblem(
            `Payment was not completed. Your slot is held for ${data.appointment.holdMinutes} minutes — press Pay again to finish.`,
            'warning'
          )
        },
      },
    })

    // A failed attempt is not the end. Razorpay keeps the overlay open so they
    // can try a different method, which is why this only records the reason.
    checkout.on('payment.failed', (response) => {
      reportProblem(
        response?.error?.description ||
          'That payment did not go through. Try a different card or UPI app.'
      )
    })

    checkout.open()
  }

  async function verifyPayment(payload) {
    try {
      const response = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json()

      if (!response.ok) {
        reportProblem(result.error || 'We could not confirm that payment.')
        setBusy(false)
        return
      }

      onPaid({ code: result.code, appointmentId: result.appointmentId })
    } catch {
      // The money may well have gone through — the webhook will confirm the
      // appointment server-side even if this request failed. So the message must
      // not tell the patient the payment failed, because it probably did not.
      reportProblem(
        'Your payment went through but we could not confirm it here. Check your dashboard in a moment, or contact the clinic.',
        'warning'
      )
      setBusy(false)
    }
  }

  const amount = service?.price_paise ?? 0

  return (
    <div>
      {/* next/script with strategy="lazyOnload" keeps Razorpay's script out of the
          critical path. It is only needed when the patient reaches this step, so
          loading it on the homepage would slow every page for nothing. */}
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="lazyOnload"
        onLoad={() => setScriptReady(true)}
      />

      <h2 className="text-xl font-bold">Review and pay</h2>
      <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-400">
        Check the details, then pay to confirm. Your slot is held while you pay.
      </p>

      {/* ------------------------------------------------------- the summary */}
      <div className="card mt-6 divide-y divide-ink-100 dark:divide-ink-800">
        <dl className="space-y-3 p-5 text-sm">
          <Row label="Treatment" value={service?.name} />
          <Row label="Date" value={formatDateLong(date)} />
          <Row
            label="Time"
            value={`${formatTime(startTime)} · ${service?.duration_minutes} minutes`}
          />
          <Row
            label="Where"
            value={
              mode === 'online'
                ? 'Online video consultation'
                : `${site.address.line1}, ${site.address.city}`
            }
          />
          <Row label="Physiotherapist" value={`${site.doctor.name}, ${site.doctor.credentials}`} />
          {booking.painLevel !== '' && (
            <Row label="Current pain" value={`${booking.painLevel} / 10`} />
          )}
        </dl>

        {/* ------------------------------------------- spend a prepaid session */}
        {packages.length > 0 && (
          <div className="border-t border-ink-100 p-5 dark:border-ink-800">
            <p className="text-sm font-bold">You have sessions already paid for</p>
            <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
              Use one and there is nothing to pay today.
            </p>

            <div className="mt-3 space-y-2">
              {packages.map((pkg) => (
                <PackageChoice
                  key={pkg.id}
                  pkg={pkg}
                  checked={Number(booking.patientPackageId) === Number(pkg.id)}
                  onSelect={() => dispatch(setPatientPackage(pkg.id))}
                />
              ))}

              <button
                type="button"
                onClick={() => dispatch(setPatientPackage(null))}
                aria-pressed={!booking.patientPackageId}
                className={`flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors ${
                  !booking.patientPackageId
                    ? 'border-ink-900 bg-ink-50 dark:border-white dark:bg-ink-800/60'
                    : 'border-ink-200 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800/60'
                }`}
              >
                <CreditCard className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold">Pay for this visit</span>
                  <span className="block text-xs text-ink-500 dark:text-ink-400">
                    {formatMoney(amount)} by card or UPI, and keep your sessions for later
                  </span>
                </span>
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between p-5">
          <span className="font-semibold">Total to pay</span>
          <span className="font-display text-2xl font-bold">
            {booking.patientPackageId ? formatMoney(0) : formatMoney(amount)}
          </span>
        </div>
      </div>

      {/* ------------------------------------------------------ the countdown */}
      {holdUntil && (
        <HoldCountdown
          until={holdUntil}
          onExpired={() =>
            reportProblem(
              'Your slot hold has expired and the time has been released. Go back and choose another.',
              'warning'
            )
          }
        />
      )}

      {/* ---------------------------------------------------------- errors */}
      {error && (
        <div
          role="alert"
          className="mt-5 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}

      {/* ------------------------------------------------------- the button */}
      <div className="mt-6">
        <Button size="lg" fullWidth onClick={handlePay} loading={busy}>
          {/* The label must not promise a payment when nothing is being charged —
              "Pay ₹800" on a prepaid session is alarming, and wrong. */}
          {busy
            ? booking.patientPackageId
              ? 'Confirming…'
              : 'Opening payment…'
            : booking.patientPackageId
              ? 'Use 1 session and confirm'
              : `Pay ${formatMoney(amount)} and confirm`}
        </Button>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs text-ink-500 dark:text-ink-400">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-emerald-600" aria-hidden="true" />
            Secured by Razorpay
          </span>
          <span className="flex items-center gap-1.5">
            <Smartphone className="size-3.5" aria-hidden="true" />
            UPI
          </span>
          <span className="flex items-center gap-1.5">
            <CreditCard className="size-3.5" aria-hidden="true" />
            Cards
          </span>
          <span className="flex items-center gap-1.5">
            <Building2 className="size-3.5" aria-hidden="true" />
            Netbanking
          </span>
        </div>

        <p className="mt-4 text-center text-xs leading-relaxed text-ink-400">
          We never see or store your card details — they go straight to Razorpay. Free cancellation
          up to {site.booking.freeCancellationHours} hours before your appointment.{' '}
          <Link href="/terms" className="underline">
            Terms
          </Link>
        </p>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-500 dark:text-ink-400">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  )
}

/**
 * A live countdown on the slot hold.
 *
 * A silent time limit is hostile — the patient goes to fetch their card, comes
 * back, and their slot has vanished with no explanation. Showing the clock
 * explains the rule and creates honest urgency.
 */
function HoldCountdown({ until, onExpired }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, until - Date.now()))
  // Guards against announcing the expiry once per second forever.
  const announcedRef = useRef(false)

  useEffect(() => {
    const timer = setInterval(() => {
      const left = Math.max(0, until - Date.now())
      setRemaining(left)

      // A countdown quietly hitting zero is easy to miss while you are hunting for
      // your card, and the consequence — the slot going back to the pool — deserves
      // saying out loud.
      if (left === 0 && !announcedRef.current) {
        announcedRef.current = true
        onExpired?.()
      }
    }, 1000)
    // Clearing the interval on unmount is essential. Without it the timer keeps
    // running after the component is gone, trying to set state on something that
    // no longer exists — a genuine memory leak.
    return () => clearInterval(timer)
  }, [until, onExpired])

  const minutes = Math.floor(remaining / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1000)
  const expired = remaining <= 0

  return (
    <div
      className={`mt-5 flex items-center gap-2.5 rounded-2xl p-4 text-sm ${
        expired
          ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200'
          : 'bg-brand-50 text-brand-900 dark:bg-brand-950/40 dark:text-brand-200'
      }`}
    >
      {expired ? (
        <>
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <p>This hold has expired. Go back and pick a time again.</p>
        </>
      ) : (
        <>
          <Clock className="size-4 shrink-0" aria-hidden="true" />
          <p>
            Your slot is held for{' '}
            <strong className="tabular-nums">
              {minutes}:{String(seconds).padStart(2, '0')}
            </strong>
            {' '}while you pay.
          </p>
        </>
      )}
    </div>
  )
}

/** Exported for the confirmation screen. */
export function PaidBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
      <CheckCircle2 className="size-3.5" aria-hidden="true" />
      Paid
    </span>
  )
}

/**
 * One prepaid package the patient could spend a session from.
 *
 * Shows what is left rather than what was bought: "6 sessions left" is the number
 * that decides anything, and a patient rarely remembers the total.
 */
function PackageChoice({ pkg, checked, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={checked}
      className={`flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors ${
        checked
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/50'
          : 'border-ink-200 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800/60'
      }`}
    >
      <Layers
        className={`mt-0.5 size-4 shrink-0 ${checked ? 'text-brand-600 dark:text-brand-300' : 'text-ink-400'}`}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">
          Use 1 session from {pkg.name}
        </span>
        <span className="block text-xs text-ink-500 dark:text-ink-400">
          {pkg.sessionsRemaining} of {pkg.sessionsTotal} left
          {pkg.expiresAt ? ` · use them by ${formatDateLong(pkg.expiresAt)}` : ''}
        </span>
      </span>
      {checked && (
        <Check className="ml-auto mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
      )}
    </button>
  )
}
