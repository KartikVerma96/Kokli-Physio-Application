'use client'

/**
 * ============================================================================
 *  THE ONBOARDING WIZARD
 * ============================================================================
 *  Four steps, each backed by a Server Action, each saving on its own. There is
 *  no "save everything at the end" — a clinic that fills in three steps and
 *  closes the tab keeps those three steps.
 *
 *  Every step uses `useActionState`, which is the modern way to wire a form to a
 *  Server Action and gives you the pending flag and the returned errors without
 *  a single fetch call. See app/dashboard/profile/ProfileForm.js for the same
 *  pattern explained at more length.
 * ============================================================================
 */

import { useActionState, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2, Sparkles, Clock, CreditCard, Check, ArrowRight, ArrowLeft, Trash2,
  ExternalLink, ShieldCheck, Info, PartyPopper,
} from 'lucide-react'
import { saveClinicDetails, addService, removeService, saveWorkingHours, saveRazorpayKeys, finishOnboarding } from './actions'
import { Input, Textarea, Select, Checkbox } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { toast } from '@/lib/toast'
import { cn, formatMoney } from '@/lib/utils'

const STEPS = [
  { n: 1, label: 'Clinic details', icon: Building2 },
  { n: 2, label: 'Treatments', icon: Sparkles },
  { n: 3, label: 'Working hours', icon: Clock },
  { n: 4, label: 'Payments', icon: CreditCard },
]

const DAYS = [
  { weekday: 1, label: 'Monday' },
  { weekday: 2, label: 'Tuesday' },
  { weekday: 3, label: 'Wednesday' },
  { weekday: 4, label: 'Thursday' },
  { weekday: 5, label: 'Friday' },
  { weekday: 6, label: 'Saturday' },
  { weekday: 0, label: 'Sunday' },
]

export default function OnboardingWizard({
  initialStep, site, clinicUrl, services, rules, paymentsConnected, razorpayKeyId,
}) {
  const router = useRouter()
  const [step, setStep] = useState(initialStep)

  const go = (n) => {
    setStep(n)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (step >= 5) return <AllDone site={site} clinicUrl={clinicUrl} />

  return (
    <div className="mx-auto max-w-3xl">
      <div className="text-center">
        <h1 className="text-2xl font-bold lg:text-3xl">Set up {site.name}</h1>
        <p className="mt-1.5 text-sm text-ink-500 dark:text-ink-400">
          About twenty minutes. Everything here can be changed later.
        </p>
      </div>

      <Steps current={step} onJump={go} />

      <div className="mt-8">
        {step === 1 && <DetailsStep site={site} onDone={() => go(2)} />}
        {step === 2 && (
          <ServicesStep services={services} onBack={() => go(1)} onDone={() => go(3)} router={router} />
        )}
        {step === 3 && <HoursStep rules={rules} onBack={() => go(2)} onDone={() => go(4)} />}
        {step === 4 && (
          <PaymentsStep
            connected={paymentsConnected}
            keyId={razorpayKeyId}
            onBack={() => go(3)}
            onDone={() => go(5)}
          />
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Steps({ current, onJump }) {
  return (
    <nav aria-label="Setup progress" className="mt-8">
      <ol className="flex items-center gap-2">
        {STEPS.map((s, index) => {
          const done = current > s.n
          const active = current === s.n
          return (
            <li key={s.n} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => done && onJump(s.n)}
                disabled={!done}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex min-w-0 items-center gap-2.5 rounded-xl px-1 py-1',
                  done && 'cursor-pointer hover:bg-ink-100 dark:hover:bg-ink-800'
                )}
              >
                <span
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold',
                    (done || active) && 'bg-brand-600 text-white',
                    active && 'shadow-brand ring-4 ring-brand-500/20',
                    !done && !active && 'bg-ink-100 text-ink-400 dark:bg-ink-800 dark:text-ink-500'
                  )}
                >
                  {done ? <Check className="size-4" aria-hidden="true" /> : s.n}
                </span>
                <span
                  className={cn(
                    'hidden truncate text-sm font-semibold sm:block',
                    active ? 'text-ink-900 dark:text-white' : 'text-ink-500'
                  )}
                >
                  {s.label}
                </span>
              </button>
              {index < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-0.5 flex-1 rounded-full',
                    done ? 'bg-brand-500' : 'bg-ink-200 dark:bg-ink-700'
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

/** Fires a toast whenever a server action comes back, for every step. */
function useActionToast(state, onSuccess) {
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message)
      onSuccess?.()
    } else if (state?.error) {
      toast.error(state.error)
    }
    // onSuccess is recreated each render; including it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])
}

/* ============================================== STEP 1 — clinic details ==== */

function DetailsStep({ site, onDone }) {
  const [state, formAction, pending] = useActionState(saveClinicDetails, {})
  useActionToast(state, onDone)
  const errors = state?.errors || {}

  return (
    <form action={formAction} className="space-y-6">
      <Card className="p-6">
        <h2 className="text-base font-bold">What patients see</h2>
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
          This is your public website. The city matters most — it is what people actually search
          for.
        </p>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Input label="Clinic name" name="name" defaultValue={site.name} error={errors.name} required />
          <Input label="Legal name" name="legalName" defaultValue={site.legalName} error={errors.legalName} hint="For invoices" />
          <Input label="Tagline" name="tagline" defaultValue={site.tagline} error={errors.tagline} className="sm:col-span-2" placeholder="Move better. Live pain-free." />
          <Textarea label="One-line description" name="description" rows={2} maxLength={300} defaultValue={site.description} error={errors.description} className="sm:col-span-2" hint="Google shows this under your name in search results" />
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-bold">Contact & address</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Input label="Phone" name="phone" type="tel" defaultValue={site.contact.phone} error={errors.phone} />
          <Input label="WhatsApp" name="whatsapp" type="tel" defaultValue={site.contact.whatsapp} error={errors.whatsapp} hint="Digits with country code, e.g. 919000000000" />
          <Input label="Email" name="email" type="email" defaultValue={site.contact.email} error={errors.email} className="sm:col-span-2" />
          <Input label="Address line 1" name="addressLine1" defaultValue={site.address.line1} error={errors.addressLine1} className="sm:col-span-2" />
          <Input label="Address line 2" name="addressLine2" defaultValue={site.address.line2} error={errors.addressLine2} className="sm:col-span-2" />
          <Input label="City" name="city" defaultValue={site.address.city} error={errors.city} required />
          <Input label="State" name="state" defaultValue={site.address.state} error={errors.state} />
          <Input label="PIN code" name="postalCode" defaultValue={site.address.postalCode} error={errors.postalCode} />
          <Input label="Brand colour" name="brandColour" type="color" defaultValue={site.brandColour} error={errors.brandColour} hint="Tints your website" />
          <Input label="Latitude" name="latitude" defaultValue={site.address.latitude ?? ''} error={errors.latitude} hint="Right-click your clinic in Google Maps to get these" />
          <Input label="Longitude" name="longitude" defaultValue={site.address.longitude ?? ''} error={errors.longitude} hint="They put you on the local map results" />
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-bold">The physiotherapist</h2>
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
          Naming a registered practitioner is the single strongest trust signal a health website
          has — for patients, and for Google.
        </p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Input label="Name" name="practitionerName" defaultValue={site.doctor.name} error={errors.practitionerName} />
          <Input label="Qualifications" name="practitionerCredentials" defaultValue={site.doctor.credentials} error={errors.practitionerCredentials} placeholder="BPT, MPT (Orthopaedics)" />
          <Input label="Council registration no." name="practitionerRegistration" defaultValue={site.doctor.registration} error={errors.practitionerRegistration} />
          <Input label="Years in practice" name="practitionerExperienceYears" type="number" min="0" max="70" defaultValue={site.doctor.experienceYears ?? ''} error={errors.practitionerExperienceYears} />
          <Textarea label="Short bio" name="practitionerBio" rows={4} defaultValue={site.doctor.bio} error={errors.practitionerBio} className="sm:col-span-2" hint="Written for a patient in pain, not for a CV" />
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" size="lg" loading={pending}>
          Save and continue
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </form>
  )
}

/* ================================================== STEP 2 — treatments ==== */

function ServicesStep({ services, onBack, onDone, router }) {
  const [state, formAction, pending] = useActionState(addService, {})
  const [removing, startRemove] = useTransition()
  useActionToast(state, () => router.refresh())
  const errors = state?.errors || {}

  const active = services.filter((s) => s.isActive)

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-base font-bold">Your treatments</h2>
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
          Each one gets its own page on your website, which is what ranks for searches like
          &ldquo;frozen shoulder treatment near me&rdquo;.
        </p>

        {active.length > 0 && (
          <ul className="mt-5 divide-y divide-ink-100 dark:divide-ink-800">
            {active.map((service) => (
              <li key={service.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{service.name}</p>
                  <p className="text-xs text-ink-500">
                    {formatMoney(service.priceRupees * 100)} · {service.durationMinutes} min
                    {service.availableOnline ? ' · online available' : ' · clinic only'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={removing}
                  onClick={() =>
                    startRemove(async () => {
                      const result = await removeService(service.id)
                      if (result.ok) toast.success(result.message)
                      else toast.error(result.error)
                      router.refresh()
                    })
                  }
                  className="rounded-lg p-2 text-ink-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/40"
                  aria-label={`Remove ${service.name}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {active.length === 0 && (
          <p className="mt-5 rounded-xl bg-ink-50 p-4 text-sm text-ink-500 dark:bg-ink-800/60">
            No treatments yet. Add your first one below — most clinics start with an assessment.
          </p>
        )}
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-bold">Add a treatment</h3>
        <form action={formAction} className="mt-4 space-y-5">
          <Input label="Name" name="name" placeholder="Initial Assessment & Treatment Plan" error={errors.name} required />
          <Textarea
            label="Short description"
            name="shortDescription"
            rows={2}
            maxLength={300}
            placeholder="A full 60-minute first visit: we find the actual cause of your pain and give you a written plan."
            error={errors.shortDescription}
            required
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Input label="Price (₹)" name="priceRupees" type="number" min="0" step="50" placeholder="1000" error={errors.priceRupees} required />
            <Input label="Duration (minutes)" name="durationMinutes" type="number" min="10" max="240" step="5" defaultValue="45" error={errors.durationMinutes} required />
          </div>
          <Checkbox
            name="availableOnline"
            defaultChecked
            label="Can be done as an online video consultation"
          />
          <Button type="submit" variant="secondary" loading={pending}>
            Add treatment
          </Button>
        </form>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="lg" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </Button>
        <Button size="lg" onClick={onDone} disabled={active.length === 0}>
          Continue
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {active.length === 0 && (
        <p className="text-right text-xs text-ink-500">Add at least one treatment to continue.</p>
      )}
    </div>
  )
}

/* =============================================== STEP 3 — working hours ==== */

function HoursStep({ rules, onBack, onDone }) {
  const [state, formAction, pending] = useActionState(saveWorkingHours, {})
  useActionToast(state, onDone)

  // Pre-fill from whatever is already saved, else a sensible clinic default.
  const byDay = new Map(rules.map((r) => [r.weekday, r]))
  const initial = (weekday) =>
    byDay.get(weekday) || {
      start: '09:00',
      end: '18:00',
      mode: 'both',
      // Monday to Saturday open by default; Sunday closed. Matches how most
      // Indian clinics actually run.
      open: weekday !== 0,
    }

  return (
    <form action={formAction} className="space-y-6">
      <Card className="p-6">
        <h2 className="text-base font-bold">When are you open?</h2>
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
          Patients can only book inside these hours. You can add breaks, holidays and a second
          shift later from Admin → Availability.
        </p>

        <div className="mt-5 space-y-3">
          {DAYS.map(({ weekday, label }) => {
            const day = initial(weekday)
            const isOpen = byDay.has(weekday) || (rules.length === 0 && day.open)
            return (
              <div
                key={weekday}
                className="grid grid-cols-1 items-center gap-3 rounded-2xl border border-ink-200 p-4 sm:grid-cols-[9rem_1fr_1fr_10rem] dark:border-ink-700"
              >
                <Checkbox name={`day-${weekday}-open`} defaultChecked={isOpen} label={label} />
                <Input label="From" name={`day-${weekday}-start`} type="time" defaultValue={day.start} />
                <Input label="To" name={`day-${weekday}-end`} type="time" defaultValue={day.end} />
                <Select label="Mode" name={`day-${weekday}-mode`} defaultValue={day.mode}>
                  <option value="both">Clinic & online</option>
                  <option value="clinic">Clinic only</option>
                  <option value="online">Online only</option>
                </Select>
              </div>
            )
          })}
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="lg" onClick={onBack} type="button">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </Button>
        <Button type="submit" size="lg" loading={pending}>
          Save and continue
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </form>
  )
}

/* =================================================== STEP 4 — payments ===== */

function PaymentsStep({ connected, keyId, onBack, onDone }) {
  const [state, formAction, pending] = useActionState(saveRazorpayKeys, {})
  const [skipping, startSkip] = useTransition()
  useActionToast(state, onDone)
  const errors = state?.errors || {}

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-bold">Connect your own Razorpay</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
              Patient fees settle straight into <strong>your</strong> bank account. We never hold
              your money and take no commission on bookings — the subscription is all you pay.
            </p>
          </div>
        </div>

        {connected && (
          <p className="mt-5 flex items-center gap-2 rounded-xl bg-emerald-50 p-3.5 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            <Check className="size-4 shrink-0" aria-hidden="true" />
            Already connected with <code className="font-mono">{keyId}</code>. Saving again replaces it.
          </p>
        )}

        <ol className="mt-5 space-y-2 rounded-2xl bg-ink-50 p-5 text-sm text-ink-700 dark:bg-ink-800/60 dark:text-ink-300">
          <li>
            1. Sign up free at{' '}
            <a
              href="https://dashboard.razorpay.com/signup"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-brand-700 underline dark:text-brand-400"
            >
              dashboard.razorpay.com
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </li>
          <li>2. Go to Settings → API Keys → Generate Key</li>
          <li>3. Paste both values below</li>
        </ol>

        <form action={formAction} className="mt-6 space-y-5">
          <Input
            label="Key ID"
            name="keyId"
            defaultValue={keyId}
            placeholder="rzp_test_xxxxxxxxxxxxxx"
            error={errors.keyId}
            hint="Starts with rzp_test_ or rzp_live_. Safe to share — it only identifies your account."
            required
          />
          <Input
            label="Key Secret"
            name="keySecret"
            type="password"
            placeholder="••••••••••••••••"
            error={errors.keySecret}
            hint="Encrypted before it is stored. Never shown again once saved."
            required
          />
          <Input
            label="Webhook secret (optional)"
            name="webhookSecret"
            type="password"
            error={errors.webhookSecret}
            hint="Set one in Razorpay → Webhooks. Without it, a patient whose phone dies after paying may not get their booking confirmed."
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" loading={pending}>
              Connect and finish
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              loading={skipping}
              onClick={() =>
                startSkip(async () => {
                  const result = await finishOnboarding()
                  if (result.ok) {
                    toast.info('Skipped for now. Connect payments from Settings when ready.')
                    onDone()
                  } else toast.error(result.error)
                })
              }
            >
              Skip for now
            </Button>
          </div>
        </form>

        <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          If you skip this, your website works and shows your treatments, but patients cannot pay —
          so no bookings can be confirmed. Test keys are fine to start with.
        </p>
      </Card>

      <div className="flex justify-start">
        <Button variant="ghost" size="lg" onClick={onBack} type="button">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </Button>
      </div>
    </div>
  )
}

/* ======================================================= ALL DONE ========== */

function AllDone({ site, clinicUrl }) {
  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
        <PartyPopper className="size-7" aria-hidden="true" />
      </span>

      <h1 className="mt-6 text-2xl font-bold">{site.name} is live</h1>
      <p className="mt-3 text-ink-600 dark:text-ink-400">
        Your website is published and taking bookings. Share the link with your patients.
      </p>

      <p className="mt-5 rounded-xl bg-ink-100 px-4 py-3 font-mono text-sm dark:bg-ink-800">
        {clinicUrl}
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button href="/admin" size="lg">Go to my dashboard</Button>
        <Button href={clinicUrl} variant="secondary" size="lg" target="_blank" rel="noopener noreferrer">
          View my website
          <ExternalLink className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="mt-10 rounded-2xl border border-ink-200 p-5 text-left text-sm dark:border-ink-700">
        <p className="font-bold">Worth doing next</p>
        <ul className="mt-3 space-y-2 text-ink-600 dark:text-ink-400">
          <li>· Add a photo of yourself — it measurably increases bookings</li>
          <li>· Ask three patients for a review, then approve them in Admin → Reviews</li>
          <li>· Submit your sitemap in Google Search Console so you start ranking</li>
        </ul>
      </div>
    </div>
  )
}
