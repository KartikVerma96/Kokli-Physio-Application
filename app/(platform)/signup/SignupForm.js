'use client'

/**
 * ============================================================================
 *  SIGNUP FORM — where a stranger becomes a customer
 * ============================================================================
 *
 *  Every field here is one someone can abandon at, so the form asks for the
 *  minimum needed to create a working clinic and leaves everything else to the
 *  onboarding wizard afterwards. Address, opening hours, prices and treatments
 *  are all editable later; none of them belong on this page.
 *
 *  THE INTERESTING PART IS THE WEB ADDRESS
 *  ---------------------------------------
 *  The slug is permanent — it is the clinic's public URL and every link they
 *  ever share. So it gets three things most fields do not:
 *
 *    1. It is SUGGESTED from the clinic name, so most people never type it.
 *    2. It is CHECKED as they type, against the server, with a debounce.
 *    3. It is shown as the full URL they will actually get, not as a bare word.
 *
 *  Finding out a name is taken after submitting a nine-field form is a genuinely
 *  bad moment. Finding out while typing costs nothing.
 * ============================================================================
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import {
  User, Mail, Lock, Phone, Building2, MapPin, AlertCircle, Check, Loader2, ArrowRight,
} from 'lucide-react'
import { Input, Checkbox } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { signupSchema, validate } from '@/lib/validation'
import { toast } from '@/lib/toast'
import { formatMoney, slugify, cn } from '@/lib/utils'

export default function SignupForm({ plans, selectedPlan, platformDomain }) {
  const router = useRouter()

  const [values, setValues] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    clinicName: '',
    slug: '',
    city: '',
    planCode: selectedPlan || plans[0]?.code || 'starter',
    acceptTerms: false,
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(null)

  // Whether the person has typed their own slug. Once they have, we stop
  // overwriting it from the clinic name — silently changing something someone
  // deliberately edited is infuriating.
  const slugTouched = useRef(false)

  // 'idle' | 'checking' | 'available' | 'taken'
  const [slugState, setSlugState] = useState({ status: 'idle', reason: null })

  const plan = plans.find((p) => p.code === values.planCode) || plans[0]

  function update(field, isCheckbox = false) {
    return (event) => {
      const value = isCheckbox ? event.target.checked : event.target.value
      setValues((prev) => {
        const next = { ...prev, [field]: value }
        // Suggest the web address from the clinic name until they edit it.
        if (field === 'clinicName' && !slugTouched.current) {
          next.slug = slugify(value).slice(0, 40)
        }
        if (field === 'slug') slugTouched.current = true
        return next
      })
      if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
      if (formError) setFormError(null)
    }
  }

  /* ------------------------------------------------- live availability check */
  /**
   * Debounced by 400ms.
   *
   * Without the delay this would fire a request per keystroke — "a", "aa",
   * "aar"… — which is wasteful and, worse, races: the reply for "aar" can land
   * after the reply for "aarogya" and overwrite it with a stale answer. The
   * cleanup function cancels the pending timer on every change, so only the last
   * pause in typing actually asks the server.
   */
  const checkSlug = useCallback(async (slug, signal) => {
    if (!slug || slug.length < 3) {
      setSlugState({ status: 'idle', reason: null })
      return
    }
    setSlugState({ status: 'checking', reason: null })
    try {
      const res = await fetch(`/api/signup?slug=${encodeURIComponent(slug)}`, { signal })
      const data = await res.json()
      setSlugState({
        status: data.available ? 'available' : 'taken',
        reason: data.reason || null,
      })
    } catch {
      // An aborted request is the normal case here, not an error.
      if (!signal?.aborted) setSlugState({ status: 'idle', reason: null })
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => checkSlug(values.slug, controller.signal), 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [values.slug, checkSlug])

  /* ---------------------------------------------------------------- submit */
  async function handleSubmit(event) {
    event.preventDefault()

    const result = validate(signupSchema, values)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    if (slugState.status === 'taken') {
      setErrors({ slug: 'That web address is already taken' })
      return
    }

    setSubmitting(true)
    setFormError(null)

    try {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const data = await response.json()

      if (!response.ok) {
        if (data.errors) setErrors(data.errors)
        setFormError(data.error || 'We could not create your clinic. Please try again.')
        toast.error(data.error || 'Could not create your clinic.')
        setSubmitting(false)
        return
      }

      // Sign them in on the platform origin. In production the session cookie is
      // set on the parent domain and therefore travels to the new subdomain; on
      // localhost browsers refuse a `.localhost` cookie, so the clinic site will
      // ask them to sign in once. The success screen below says so plainly.
      await signIn('credentials', {
        email: values.email,
        password: values.password,
        redirect: false,
      })

      toast.success(`${values.clinicName} is ready.`)
      setDone(data)
    } catch {
      const message = 'Something went wrong on our side. Please try again.'
      setFormError(message)
      toast.error(message)
      setSubmitting(false)
    }
  }

  /* ------------------------------------------------------------- success */
  if (done) {
    return <ClinicReady done={done} clinicName={values.clinicName} email={values.email} />
  }

  return (
    <div className="container-page py-14">
      <div className="mx-auto max-w-2xl">
        <div className="text-center">
          <h1 className="text-3xl font-bold sm:text-4xl">Create your clinic</h1>
          <p className="mt-3 text-ink-600 dark:text-ink-400">
            Free for {plan?.trialDays ?? 30} days. No card needed, and you can cancel any time.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-10 space-y-8" noValidate>
          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{formError}</p>
            </div>
          )}

          {/* ============================================= about the clinic */}
          <section className="card p-6">
            <h2 className="text-base font-bold">Your clinic</h2>

            <div className="mt-5 space-y-5">
              <Input
                label="Clinic name"
                name="clinicName"
                placeholder="Aarogya Physiotherapy"
                value={values.clinicName}
                onChange={update('clinicName')}
                error={errors.clinicName}
                icon={<Building2 className="size-4" />}
                required
                autoFocus
              />

              {/* ------------------------------------------ the web address */}
              <div>
                <label
                  htmlFor="slug"
                  className="block text-sm font-medium text-ink-700 dark:text-ink-200"
                >
                  Your web address
                  <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
                </label>

                <div className="mt-1.5 flex items-stretch">
                  <input
                    id="slug"
                    name="slug"
                    value={values.slug}
                    onChange={update('slug')}
                    placeholder="aarogya"
                    aria-invalid={errors.slug || slugState.status === 'taken' ? 'true' : undefined}
                    aria-describedby="slug-status"
                    className={cn(
                      'h-11 min-w-0 flex-1 rounded-l-xl border border-r-0 bg-white px-4 text-[15px] shadow-sm focus:outline-none dark:bg-ink-900',
                      errors.slug || slugState.status === 'taken'
                        ? 'border-red-400'
                        : slugState.status === 'available'
                          ? 'border-emerald-400'
                          : 'border-ink-200 focus:border-brand-500 dark:border-ink-700'
                    )}
                  />
                  <span className="flex shrink-0 items-center rounded-r-xl border border-l-0 border-ink-200 bg-ink-50 px-3 text-sm text-ink-500 dark:border-ink-700 dark:bg-ink-800">
                    .{platformDomain}
                  </span>
                </div>

                {/* aria-live so a screen reader hears the availability result,
                    which is otherwise conveyed only by a colour and an icon. */}
                <p id="slug-status" aria-live="polite" className="mt-1.5 text-xs">
                  {errors.slug ? (
                    <span className="font-medium text-red-600">{errors.slug}</span>
                  ) : slugState.status === 'checking' ? (
                    <span className="flex items-center gap-1.5 text-ink-500">
                      <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                      Checking availability…
                    </span>
                  ) : slugState.status === 'available' ? (
                    <span className="flex items-center gap-1.5 font-medium text-emerald-600">
                      <Check className="size-3.5" aria-hidden="true" />
                      {values.slug}.{platformDomain} is available
                    </span>
                  ) : slugState.status === 'taken' ? (
                    <span className="font-medium text-red-600">
                      {slugState.reason || 'Already taken'} — try adding your city
                    </span>
                  ) : (
                    <span className="text-ink-500">
                      This is permanent, so choose carefully. Patients will see it.
                    </span>
                  )}
                </p>
              </div>

              <Input
                label="City"
                name="city"
                placeholder="Pune"
                value={values.city}
                onChange={update('city')}
                error={errors.city}
                icon={<MapPin className="size-4" />}
                hint="Used in your page titles — it is what patients actually search for"
              />
            </div>
          </section>

          {/* ================================================= about you */}
          <section className="card p-6">
            <h2 className="text-base font-bold">Your account</h2>
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
              You will be the clinic&rsquo;s administrator.
            </p>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Input
                label="Your full name"
                name="name"
                autoComplete="name"
                placeholder="Dr. Ananya Verma"
                value={values.name}
                onChange={update('name')}
                error={errors.name}
                icon={<User className="size-4" />}
                required
              />
              <Input
                label="Mobile number"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="98765 43210"
                value={values.phone}
                onChange={update('phone')}
                error={errors.phone}
                icon={<Phone className="size-4" />}
              />
              <Input
                label="Email address"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@clinic.in"
                value={values.email}
                onChange={update('email')}
                error={errors.email}
                icon={<Mail className="size-4" />}
                className="sm:col-span-2"
                required
              />
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
              <Input
                label="Confirm password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={values.confirmPassword}
                onChange={update('confirmPassword')}
                error={errors.confirmPassword}
                icon={<Lock className="size-4" />}
                required
              />
            </div>
          </section>

          {/* ===================================================== the plan */}
          <section className="card p-6">
            <h2 className="text-base font-bold">Choose a plan</h2>
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
              Nothing is charged today. You can change or cancel before the trial ends.
            </p>

            <fieldset className="mt-5">
              <legend className="sr-only">Plan</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {plans.map((p) => {
                  const isSelected = values.planCode === p.code
                  return (
                    <label
                      key={p.code}
                      className={cn(
                        'cursor-pointer rounded-2xl border-2 p-4 transition-all',
                        isSelected
                          ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/40'
                          : 'border-ink-200 hover:border-brand-300 dark:border-ink-700'
                      )}
                    >
                      <input
                        type="radio"
                        name="planCode"
                        value={p.code}
                        checked={isSelected}
                        onChange={update('planCode')}
                        className="sr-only"
                      />
                      <span className="flex items-center justify-between">
                        <span className="text-sm font-bold">{p.name}</span>
                        {isSelected && <Check className="size-4 text-brand-600" aria-hidden="true" />}
                      </span>
                      <span className="mt-1 block text-lg font-bold">
                        {formatMoney(p.pricePaise)}
                        <span className="text-xs font-normal text-ink-500">/mo</span>
                      </span>
                      <span className="mt-1 block text-xs text-ink-500 dark:text-ink-400">
                        {p.maxPhysios} physio{p.maxPhysios === 1 ? '' : 's'}
                        {p.videoEnabled ? ' · video calls' : ''}
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          </section>

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
                , and confirm I am authorised to create this clinic.
              </>
            }
          />

          <Button type="submit" size="lg" fullWidth loading={submitting}>
            {submitting ? 'Creating your clinic…' : `Start my ${plan?.trialDays ?? 30}-day free trial`}
          </Button>

          <p className="text-center text-sm text-ink-600 dark:text-ink-400">
            Already have a clinic?{' '}
            <Link href="/login" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  THE SUCCESS SCREEN                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately a page rather than an instant redirect.
 *
 * The clinic has just been created on a different origin, and — on localhost —
 * the session cookie cannot travel there. Rather than bouncing someone to a
 * login screen with no explanation, this says what happened and what is next.
 */
function ClinicReady({ done, clinicName, email }) {
  const target = `${done.clinicUrl}/admin/onboarding`

  return (
    <div className="container-page py-20">
      <div className="mx-auto max-w-xl text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
          <Check className="size-7" aria-hidden="true" />
        </span>

        <h1 className="mt-6 text-3xl font-bold">{clinicName} is ready</h1>
        <p className="mt-3 text-ink-600 dark:text-ink-400">
          Your clinic lives at{' '}
          <strong className="font-mono text-ink-900 dark:text-white">{done.clinicUrl}</strong>. Your{' '}
          {done.trialDays}-day free trial has started.
        </p>

        <div className="mt-8">
          <a
            href={target}
            className="inline-flex h-13 items-center justify-center gap-2.5 rounded-2xl bg-brand-600 px-7 text-base font-semibold text-white shadow-brand transition-all hover:-translate-y-0.5 hover:bg-brand-700"
          >
            Set up your clinic
            <ArrowRight className="size-4" aria-hidden="true" />
          </a>
        </div>

        <div className="mt-8 rounded-2xl border border-ink-200 p-5 text-left text-sm dark:border-ink-700">
          <p className="font-bold">What happens next</p>
          <ol className="mt-3 space-y-2 text-ink-600 dark:text-ink-400">
            <li>1. Add your clinic details and photo</li>
            <li>2. Add your treatments and prices</li>
            <li>3. Set your working hours</li>
            <li>4. Connect Razorpay so patients can pay you directly</li>
          </ol>
          <p className="mt-4 text-xs text-ink-500">
            If your clinic asks you to sign in, use <strong>{email}</strong> and the password you
            just chose. (On a local machine the browser will not share a login between
            <code className="mx-1">localhost</code> and a subdomain — on a real domain it does.)
          </p>
        </div>
      </div>
    </div>
  )
}
