'use client'

/**
 * ============================================================================
 *  PROFILE FORM
 * ============================================================================
 *  Uses React's useActionState, which is the modern way to wire a form to a
 *  Server Action:
 *
 *      const [state, formAction, pending] = useActionState(updateProfile, initial)
 *      <form action={formAction}>
 *
 *  What you get for free, without writing any of it:
 *
 *    formAction  posts the form to the server function
 *    state       whatever the action returned — success message or field errors
 *    pending     true while it is in flight, for the disabled button
 *
 *  No fetch, no onSubmit, no useState for loading, no try/catch. Compare that with
 *  the login form in app/(auth)/login/LoginForm.js, which does all of it by hand
 *  because it needs to call signIn() rather than a server action of ours — the
 *  contrast between the two files is worth reading side by side.
 *
 *  A REAL BONUS: because it is a genuine <form> with a real action, this works even
 *  if JavaScript fails to load. The browser submits it the old-fashioned way and
 *  the server action still runs.
 * ============================================================================
 */

import { useActionState, useEffect } from 'react'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { updateProfile } from './actions'
import { toast } from '@/lib/toast'
import { Card } from '@/components/ui/Card'
import { Input, Select, Textarea } from '@/components/ui/Field'
import Button from '@/components/ui/Button'

export default function ProfileForm({ profile }) {
  const [state, formAction, pending] = useActionState(updateProfile, {})

  // Mirror the result into a toast as well as the inline banner. The banner is at
  // the bottom of a long form, and on a phone the patient may well have scrolled
  // away from it by the time the save completes.
  useEffect(() => {
    if (state?.ok) toast.success(state.message)
    else if (state?.error) toast.error(state.error)
  }, [state])

  const errors = state?.errors || {}

  return (
    <form action={formAction} className="space-y-6">
      {/* ======================================================= about you */}
      <Card className="p-6">
        <h2 className="text-base font-bold">About you</h2>
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
          How we address you, and how we reach you if a slot has to move.
        </p>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Input
            label="Full name"
            name="name"
            // defaultValue rather than value: this is an uncontrolled input, so the
            // browser owns its state and React does not re-render on every keypress.
            // For a long form that is both simpler and noticeably faster.
            defaultValue={profile?.name || ''}
            error={errors.name}
            autoComplete="name"
            required
          />
          <Input
            label="Mobile number"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={profile?.phone || ''}
            error={errors.phone}
            autoComplete="tel"
          />
          <Input
            label="Date of birth"
            name="dateOfBirth"
            type="date"
            defaultValue={profile?.date_of_birth ? String(profile.date_of_birth).slice(0, 10) : ''}
            error={errors.dateOfBirth}
            hint="Age affects healing time and safe exercise loading"
          />
          <Select
            label="Gender"
            name="gender"
            defaultValue={profile?.gender || ''}
            error={errors.gender}
          >
            <option value="">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </Select>
          <Input
            label="Occupation"
            name="occupation"
            defaultValue={profile?.occupation || ''}
            error={errors.occupation}
            hint="Often the most useful field on this form — desk work and manual work cause different problems"
          />
          <Input
            label="City"
            name="city"
            defaultValue={profile?.city || ''}
            error={errors.city}
            autoComplete="address-level2"
          />
          <Input
            label="Height (cm)"
            name="heightCm"
            type="number"
            min="50"
            max="250"
            defaultValue={profile?.height_cm || ''}
            error={errors.heightCm}
          />
          <Input
            label="Weight (kg)"
            name="weightKg"
            type="number"
            min="10"
            max="300"
            defaultValue={profile?.weight_kg || ''}
            error={errors.weightKg}
            hint="Used to calculate safe loading in knee and hip rehab"
          />
        </div>

        <div className="mt-5">
          <Textarea
            label="Address"
            name="address"
            rows={2}
            defaultValue={profile?.address || ''}
            error={errors.address}
            hint="Only needed if you ever want a home visit"
          />
        </div>
      </Card>

      {/* ================================================= medical history */}
      <Card className="p-6">
        <h2 className="text-base font-bold">Medical history</h2>
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
          This is what keeps your treatment safe. Please be thorough — leaving something out does
          not protect you.
        </p>

        <div className="mt-5 space-y-5">
          <Textarea
            label="Existing conditions and past surgeries"
            name="medicalHistory"
            rows={4}
            defaultValue={profile?.medical_history || ''}
            error={errors.medicalHistory}
            placeholder="For example: Type 2 diabetes since 2019. High blood pressure, controlled. Left knee arthroscopy in 2021. No history of osteoporosis."
            hint="Diabetes, osteoporosis, heart conditions, pregnancy, cancer treatment and pacemakers all change what treatment is safe"
          />

          <Textarea
            label="Current medication"
            name="currentMedications"
            rows={3}
            defaultValue={profile?.current_medications || ''}
            error={errors.currentMedications}
            placeholder="For example: Metformin 500mg twice daily. Aspirin 75mg daily."
            hint="Blood thinners make dry needling and deep tissue work unsafe; painkillers mask the feedback we use to judge intensity"
          />

          <Textarea
            label="Allergies"
            name="allergies"
            rows={2}
            defaultValue={profile?.allergies || ''}
            error={errors.allergies}
            placeholder="For example: latex, adhesive tape, ibuprofen"
            hint="Latex and tape allergies matter — we use both"
          />
        </div>
      </Card>

      {/* ================================================ emergency contact */}
      <Card className="p-6">
        <h2 className="text-base font-bold">Emergency contact</h2>
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
          Who we should call if something happens during a session. Rarely needed, but it has to be
          on file before it is.
        </p>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Input
            label="Name"
            name="emergencyContactName"
            defaultValue={profile?.emergency_contact_name || ''}
            error={errors.emergencyContactName}
          />
          <Input
            label="Phone number"
            name="emergencyContactPhone"
            type="tel"
            inputMode="tel"
            defaultValue={profile?.emergency_contact_phone || ''}
            error={errors.emergencyContactPhone}
          />
        </div>
      </Card>

      {/* ============================================================ save */}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" loading={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>

        {/* role="status" so a screen reader announces the outcome. Without it, a
            blind user presses Save and gets no feedback at all. */}
        {state?.ok && (
          <p role="status" className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            {state.message}
          </p>
        )}
        {state?.error && (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
            <AlertCircle className="size-4" aria-hidden="true" />
            {state.error}
          </p>
        )}
      </div>
    </form>
  )
}
