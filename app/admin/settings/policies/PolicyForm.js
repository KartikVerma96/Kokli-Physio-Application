'use client'

/**
 * ============================================================================
 *  POLICY FORM
 * ============================================================================
 *  Every field carries a hint saying what happens if it is set badly, in both
 *  directions. A clinic owner cannot choose a no-show fee from a number box
 *  labelled "no-show fee" — they can choose one from "too high and patients stop
 *  booking, zero and it costs you a half-hour you have already paid for".
 * ============================================================================
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarX, IndianRupee, Layers, Car, Phone, Clock } from 'lucide-react'
import { savePolicies } from './actions'
import { Card } from '@/components/ui/Card'
import { Input, Checkbox } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { toast } from '@/lib/toast'

export default function PolicyForm({ policies }) {
  const router = useRouter()
  const [errors, setErrors] = useState({})
  const [saving, startSaving] = useTransition()

  function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const values = Object.fromEntries(form)

    // Unticked checkboxes are absent from FormData entirely, so they have to be
    // turned into an explicit false — otherwise "off" reads as "unchanged".
    values.lateCancelForfeitsSession = form.get('lateCancelForfeitsSession') === 'on'
    values.allowPayAtClinic = form.get('allowPayAtClinic') === 'on'

    startSaving(async () => {
      const result = await savePolicies(values)
      if (result.ok) {
        toast.success(result.message, { duration: 6000 })
        setErrors({})
        router.refresh()
        return
      }
      setErrors(result.errors || {})
      toast.error(result.error)
    })
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* ═══════════════════════════════════════════ cancellations */}
      <Section
        icon={CalendarX}
        title="Cancellations and no-shows"
        blurb="Between 15% and 25% of physiotherapy appointments are missed. Each one is a half-hour you have already paid a therapist for."
      >
        <Input
          label="Free cancellation window (hours)"
          name="freeCancellationHours"
          type="number"
          min="0"
          max="168"
          defaultValue={policies.freeCancellationHours}
          error={errors.freeCancellationHours}
          hint="Cancel with more notice than this and the patient is refunded in full. 12 to 24 hours is normal — long enough for you to fill the slot."
        />
        <Input
          label="No-show fee (₹)"
          name="noShowFeeRupees"
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          defaultValue={policies.noShowFeeRupees}
          error={errors.noShowFeeRupees}
          hint="What is owed when somebody simply does not arrive. 0 switches it off. The full session price will lose you patients; half of it changes behaviour without feeling punitive."
        />
        <Checkbox
          label="A no-show or late cancellation uses up a package session"
          name="lateCancelForfeitsSession"
          defaultChecked={policies.lateCancelForfeitsSession}
        />
        <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">
          Switch this off and a patient on a ten-session package can cancel at 9:55 for a 10:00
          appointment, every time, at no cost — and the slot is dead each time. Every clinic that
          sells courses of treatment has this rule.
        </p>
      </Section>

      {/* ═══════════════════════════════════════════ taking money */}
      <Section
        icon={IndianRupee}
        title="Taking payment"
        blurb="How reception is allowed to handle money at the desk."
      >
        <Checkbox
          label="Reception may book an appointment before it is paid for"
          name="allowPayAtClinic"
          defaultChecked={policies.allowPayAtClinic}
        />
        <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">
          On by default, because it is how clinics work: the patient is booked, comes in, is treated,
          and pays on the way out. This never applies to a patient booking themselves online — they
          always pay first, or the slot-holding mechanism has nothing holding it.
        </p>
        <Input
          label="How long an online booking is held (minutes)"
          name="bookingHoldMins"
          type="number"
          min="5"
          max="120"
          defaultValue={policies.bookingHoldMins}
          error={errors.bookingHoldMins}
          hint="How long a patient has to finish paying before the slot is released. Too short and slow payers lose their slot; too long and the diary is full of holds that never become bookings."
        />
        <Input
          label="Minimum notice for an online booking (minutes)"
          name="bookingMinNoticeMins"
          type="number"
          min="0"
          max="10080"
          defaultValue={policies.bookingMinNoticeMins}
          error={errors.bookingMinNoticeMins}
          hint="Stops somebody booking a slot that starts in four minutes. 60 is sensible; reception can always book sooner from the desk."
        />
      </Section>

      {/* ═══════════════════════════════════════════ home visits */}
      <Section
        icon={Car}
        title="Home visits"
        blurb="Domiciliary physiotherapy bills two to three times the clinic rate, and for post-surgical and elderly patients it is often the only option."
      >
        <Input
          label="Travel time either side (minutes)"
          name="homeTravelBufferMins"
          type="number"
          min="0"
          max="240"
          defaultValue={policies.homeTravelBufferMins}
          error={errors.homeTravelBufferMins}
          hint="Added to every home visit so the diary blocks the whole trip, not just the treatment. Set it to 0 and you will book two visits across the city back to back — and be late for the second, every time."
        />
        <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">
          Mark individual treatments as available at home, with their own price, under Services. Home
          visits also need their own working hours under Availability — you are out of the building
          and cannot be treating anybody in it.
        </p>
      </Section>

      {/* ═══════════════════════════════════════════ recall */}
      <Section
        icon={Phone}
        title="Bringing patients back"
        blurb="A patient you treated six months ago costs one phone call. A new one costs advertising."
      >
        <Input
          label="Count a patient as lapsed after (days)"
          name="recallAfterDays"
          type="number"
          min="7"
          max="730"
          defaultValue={policies.recallAfterDays}
          error={errors.recallAfterDays}
          hint="60 is a good default for physiotherapy: long enough that a finished course is not chased next week, short enough that somebody who dropped out half-way is called while they still remember why they came."
        />
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={saving}>
          {saving ? 'Saving…' : 'Save policies'}
        </Button>
        <p className="text-xs text-ink-500 dark:text-ink-400">
          Applies to new bookings. Nothing already in the diary changes.
        </p>
      </div>
    </form>
  )
}

function Section({ icon: Icon, title, blurb, children }) {
  return (
    <Card className="p-6">
      <h2 className="flex items-center gap-2 font-bold">
        <Icon className="size-4 text-ink-400" aria-hidden="true" />
        {title}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-500 dark:text-ink-400">{blurb}</p>
      <div className="mt-5 space-y-5">{children}</div>
    </Card>
  )
}
