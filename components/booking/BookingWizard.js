'use client'

/**
 * ============================================================================
 *  BOOKING WIZARD — where Redux earns its keep
 * ============================================================================
 *  Four steps: choose a treatment → choose a time → add details → pay.
 *
 *  WHY THIS IS THE RIGHT PLACE FOR REDUX
 *  ------------------------------------
 *  Look at what the selection has to reach:
 *
 *    - the step components, each of which edits one part of it
 *    - the progress bar, which needs to know how far along we are
 *    - the summary panel, which shows the whole selection at once
 *    - the payment step, which needs every field together
 *    - and it must survive going backwards, twice, without losing anything
 *
 *  Passing that through props means every one of those components takes a dozen
 *  props it does not care about, and the wizard becomes the only thing that can
 *  hold state — so the summary panel cannot be moved without rewriting it.
 *
 *  With a store, each piece reads exactly what it needs and dispatches exactly
 *  what changed. That is the actual argument for Redux, and it is worth noticing
 *  that most of this app does NOT need it — the services list, the dashboard and
 *  the admin tables all come from the server as plain props.
 *
 *  The slice, including the async thunks and the reasoning behind each action,
 *  is in store/slices/bookingSlice.js.
 * ============================================================================
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useDispatch, useSelector } from 'react-redux'
import { ArrowLeft, ArrowRight, Check, Lock, CalendarDays, ClipboardList, CreditCard } from 'lucide-react'
import {
  selectService, setMode, setDate, setStartTime, nextStep, previousStep, goToStep,
  createAppointment, clearCreateError, resetBooking, selectBooking, selectCanContinue,
} from '@/store/slices/bookingSlice'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import Button from '@/components/ui/Button'
import ServiceStep from './ServiceStep'
import SlotStep from './SlotStep'
import DetailsStep from './DetailsStep'
import PaymentStep from './PaymentStep'
import BookingSummary from './BookingSummary'

const STEPS = [
  { number: 1, label: 'Treatment', icon: ClipboardList },
  { number: 2, label: 'Date & time', icon: CalendarDays },
  { number: 3, label: 'Your details', icon: ClipboardList },
  { number: 4, label: 'Payment', icon: CreditCard },
]

export default function BookingWizard({ site, services, initialDates, user, initial, packages = [] }) {
  const dispatch = useDispatch()
  const router = useRouter()
  const booking = useSelector(selectBooking)
  const canContinue = useSelector(selectCanContinue)

  const [dates, setDates] = useState(initialDates)

  /* ------------------------------------------------------------------ setup */
  /**
   * Apply anything that came in through the URL, once, on mount.
   *
   * This is what makes /book?service=frozen-shoulder&mode=online work, and — more
   * importantly — it is how a patient who had to sign in at the payment step
   * comes back to exactly the slot they had picked. The wizard sends them to
   * /login?next=/book?service=…&date=…&time=…, and this restores it.
   *
   * The empty dependency array means "run once after the first render". Adding
   * `initial` to it would re-apply the URL selection every time the object
   * identity changed, wiping out whatever the patient had since chosen.
   */
  useEffect(() => {
    if (initial?.service) {
      dispatch(selectService(initial.service))
    }
    if (initial?.mode) dispatch(setMode(initial.mode))
    if (initial?.date) dispatch(setDate(initial.date))
    if (initial?.time) dispatch(setStartTime(initial.time))

    // Jump straight to the step their selection has already satisfied.
    if (initial?.service && initial?.date && initial?.time) dispatch(goToStep(3))
    else if (initial?.service) dispatch(goToStep(2))

    // Clear the store when the wizard unmounts, so navigating away and coming
    // back later starts fresh rather than resuming a stale half-booking.
    return () => dispatch(resetBooking())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ------------------------------------------- refetch the date strip on mode */
  // Sunday is online-only, so which DAYS are open depends on the mode. The slot
  // list inside a day is refetched by SlotStep itself.
  useEffect(() => {
    let cancelled = false

    async function loadDates() {
      try {
        const response = await fetch(`/api/slots?days=30&mode=${booking.mode}`)
        const data = await response.json()
        // The guard stops a slow response from an earlier mode overwriting a
        // faster one from the current mode — the classic race with fetch in an
        // effect.
        if (!cancelled && Array.isArray(data.dates)) setDates(data.dates)
      } catch {
        // Keep the dates we already have. The server revalidates the real choice
        // when the booking is submitted, so a stale strip is cosmetic.
      }
    }

    loadDates()
    return () => { cancelled = true }
  }, [booking.mode])

  /* --------------------------------------------------- surface booking errors */
  useEffect(() => {
    if (booking.createError) {
      toast.error(booking.createError)
      dispatch(clearCreateError())
    }
  }, [booking.createError, dispatch])

  /* --------------------------------------------------------------- handlers */

  function handleContinue() {
    if (!canContinue) return

    // Scroll back to the top of the wizard so the patient sees the new step's
    // heading rather than being left halfway down the previous one.
    window.scrollTo({ top: 200, behavior: 'smooth' })
    dispatch(nextStep())
  }

  function handleBack() {
    window.scrollTo({ top: 200, behavior: 'smooth' })
    dispatch(previousStep())
  }

  /** Step 4: hold the slot and create the Razorpay order. */
  async function handleStartPayment() {
    const result = await dispatch(createAppointment())
    // A rejected thunk means the slot went, or something broke. The effect above
    // has already shown the toast, and the reducer has sent the patient back to
    // the calendar if the slot was taken.
    return result.meta.requestStatus === 'fulfilled' ? result.payload : null
  }

  /** Called by PaymentStep once the payment has verified. */
  function handlePaid({ code, appointmentId }) {
    toast.success(`Appointment ${code} is confirmed.`)
    dispatch(resetBooking())
    router.push(`/dashboard/appointments/${appointmentId}?booked=1`)
  }

  /* ----------------------------------------------------------------- render */

  return (
    <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
      {/* ================================================== the wizard body */}
      <div className="lg:col-span-8">
        <ProgressSteps current={booking.step} onStepClick={(n) => dispatch(goToStep(n))} />

        <div className="mt-8">
          {booking.step === 1 && <ServiceStep site={site} services={services} />}
          {booking.step === 2 && <SlotStep site={site} dates={dates} />}
          {booking.step === 3 && <DetailsStep site={site} user={user} />}
          {booking.step === 4 && (
            <PaymentStep
              site={site}
              user={user}
              /* Only the packages that can be spent on the CHOSEN treatment. The
                 server re-checks this, but offering one the server would refuse
                 is a pointless dead end for the patient. */
              packages={packages.filter(
                (p) => !p.serviceId || Number(p.serviceId) === Number(booking.serviceId)
              )}
              onStartPayment={handleStartPayment}
              onPaid={handlePaid}
            />
          )}
        </div>

        {/* ----------------------------------------------- step navigation */}
        {/* Hidden on the payment step, which owns its own buttons — a "Continue"
            next to "Pay ₹800" would be genuinely confusing. */}
        {booking.step < 4 && (
          <div className="mt-8 flex items-center justify-between gap-4 border-t border-ink-200 pt-6 dark:border-ink-800">
            {booking.step > 1 ? (
              <Button variant="ghost" size="lg" onClick={handleBack}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back
              </Button>
            ) : (
              <span />
            )}

            <Button size="lg" onClick={handleContinue} disabled={!canContinue}>
              {booking.step === 3 ? 'Review & pay' : 'Continue'}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}

        {/* An honest note about the account requirement, shown early so it is
            never a surprise at the payment step. */}
        {!user && booking.step < 4 && (
          <p className="mt-5 flex items-start gap-2 rounded-2xl bg-ink-100 p-4 text-sm text-ink-600 dark:bg-ink-800 dark:text-ink-300">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              You can browse availability freely. You will need an account at the payment step so
              your appointment, invoice and exercises are saved to you —{' '}
              <Link href="/login" className="font-semibold text-brand-700 underline dark:text-brand-400">
                sign in
              </Link>{' '}
              now if you prefer.
            </span>
          </p>
        )}
      </div>

      {/* ==================================================== summary panel */}
      <div className="lg:col-span-4">
        <BookingSummary site={site} />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  PROGRESS INDICATOR                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Shows how far through the booking the patient is.
 *
 * Completed steps are clickable so they can go back and change their mind —
 * being able to revise a choice without starting again is the whole point of a
 * wizard holding its state. Future steps are not clickable, because skipping
 * ahead would leave required fields empty.
 */
function ProgressSteps({ current, onStepClick }) {
  return (
    <nav aria-label="Booking progress">
      <ol className="flex items-center gap-2">
        {STEPS.map((step, index) => {
          const isComplete = current > step.number
          const isCurrent = current === step.number

          return (
            <li key={step.number} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => isComplete && onStepClick(step.number)}
                disabled={!isComplete}
                // aria-current tells a screen reader which step is active,
                // which the colours alone cannot convey.
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'flex min-w-0 items-center gap-2.5 rounded-xl px-1 py-1 text-left transition-colors',
                  isComplete && 'cursor-pointer hover:bg-ink-100 dark:hover:bg-ink-800',
                  !isComplete && 'cursor-default'
                )}
              >
                <span
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold transition-all',
                    isComplete && 'bg-brand-600 text-white',
                    isCurrent && 'bg-brand-600 text-white shadow-brand ring-4 ring-brand-500/20',
                    !isComplete && !isCurrent && 'bg-ink-100 text-ink-400 dark:bg-ink-800 dark:text-ink-500'
                  )}
                >
                  {isComplete ? <Check className="size-4" aria-hidden="true" /> : step.number}
                </span>

                <span
                  className={cn(
                    'hidden truncate text-sm font-semibold sm:block',
                    isCurrent ? 'text-ink-900 dark:text-white' : 'text-ink-500 dark:text-ink-400'
                  )}
                >
                  {step.label}
                </span>
              </button>

              {/* The connecting line, on every step but the last. */}
              {index < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-0.5 flex-1 rounded-full transition-colors',
                    isComplete ? 'bg-brand-500' : 'bg-ink-200 dark:bg-ink-700'
                  )}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
