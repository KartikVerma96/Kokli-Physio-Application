'use client'

/**
 * ============================================================================
 *  WHATSAPP SETTINGS
 * ============================================================================
 *  Four switches, and each one says plainly what it costs and what it is worth.
 *
 *  The marketing pair carry a warning rather than being hidden or disabled. A
 *  clinic that does not understand why a review request needs consent will turn
 *  it on, watch nothing happen, and conclude the software is broken — so the
 *  screen explains it at the moment of the decision rather than in a help page.
 * ============================================================================
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Dumbbell, Layers, Star, TriangleAlert } from 'lucide-react'
import { saveWhatsAppSettings } from './actions'
import { Card } from '@/components/ui/Card'
import { Input, Checkbox } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { toast } from '@/lib/toast'

export default function WhatsAppSettings({ settings, hasReviewLink, enabled }) {
  const router = useRouter()
  const [errors, setErrors] = useState({})
  const [saving, startSaving] = useTransition()

  function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const values = Object.fromEntries(form)

    // Unticked checkboxes are absent from FormData, so "off" would otherwise read
    // as "unchanged" and a clinic could never switch a message type off.
    for (const key of ['sendReminders', 'sendExercises', 'sendPackageNudge', 'sendReviewRequest']) {
      values[key] = form.get(key) === 'on'
    }

    startSaving(async () => {
      const result = await saveWhatsAppSettings(values)
      if (result.ok) {
        toast.success(result.message)
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
      {/* ══════════════════════════════════════ the two that need no consent */}
      <Card className="p-6">
        <h2 className="font-bold">Messages every patient gets</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
          These follow from something the patient already did — they booked, or they were treated —
          so no separate permission is needed and they cost the least to send.
        </p>

        <div className="mt-5 space-y-5">
          <Switch
            icon={Bell}
            name="sendReminders"
            defaultChecked={settings.sendReminders}
            title="Appointment reminder"
            why="The one that pays for the subscription. No-shows run 15–25% in physiotherapy; a reminder the day before roughly halves that. The message asks them to reply CANCEL, which hands you the slot back in time to fill it."
            disabled={!enabled}
          />

          <div className="pl-7">
            <Input
              label="How long before the appointment"
              name="reminderHours"
              type="number"
              min="2"
              max="72"
              defaultValue={settings.reminderHours}
              error={errors.reminderHours}
              hint="24 hours suits most clinics — long enough to refill a cancelled slot, close enough that they have not forgotten again"
              disabled={!enabled}
            />
          </div>

          <Switch
            icon={Dumbbell}
            name="sendExercises"
            defaultChecked={settings.sendExercises}
            title="Home exercise programme"
            why="Sent the moment you save the clinical note. The session is an hour a week; the exercises are every day — and a programme sitting in a portal nobody opens does not get done. On their phone it might."
            disabled={!enabled}
          />
        </div>
      </Card>

      {/* ══════════════════════════════════ the two that need explicit consent */}
      <Card className="p-6">
        <h2 className="font-bold">Messages that need the patient&rsquo;s permission</h2>

        <div className="mt-3 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed dark:border-amber-800 dark:bg-amber-950/30">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
          <div className="text-amber-900 dark:text-amber-100">
            <p className="font-bold">These only go to patients who have agreed.</p>
            <p className="mt-1 text-amber-800 dark:text-amber-200">
              WhatsApp treats anything that asks the patient for something as marketing, and sending
              it without permission gets the number blocked — for every clinic, not just yours. So
              switching these on is not enough on its own: ask each patient, and record it on their
              record. Anyone who has not agreed is simply skipped, and you will see that in the list
              below.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-5">
          <Switch
            icon={Layers}
            name="sendPackageNudge"
            defaultChecked={settings.sendPackageNudge}
            title="Sessions expiring soon"
            why="Ten days before a package expires, to patients with sessions left and nothing booked. This is money you have already taken for treatment you have not yet given — the most defensible message in the set."
            disabled={!enabled}
          />

          <Switch
            icon={Star}
            name="sendReviewRequest"
            defaultChecked={settings.sendReviewRequest}
            title="Ask for a Google review"
            why="Two days after their last session, once they can feel the difference. Google Maps is how a physiotherapy clinic gets found, and the gap between four reviews and forty is usually just asking."
            disabled={!enabled || !hasReviewLink}
            blocked={
              !hasReviewLink
                ? 'Add your Google Maps link in Settings → Clinic details first — there is nowhere to send them yet.'
                : null
            }
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={saving} disabled={!enabled}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
        <p className="text-xs text-ink-500 dark:text-ink-400">
          Applies to messages from now on. Nothing already sent changes.
        </p>
      </div>
    </form>
  )
}

function Switch({ icon: Icon, name, defaultChecked, title, why, disabled, blocked }) {
  return (
    <div className={disabled ? 'opacity-55' : ''}>
      <Checkbox
        label={
          <span className="flex items-center gap-2">
            <Icon className="size-4 shrink-0 text-ink-400" aria-hidden="true" />
            <span className="font-semibold">{title}</span>
          </span>
        }
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
      />
      <p className="mt-1 pl-7 text-xs leading-relaxed text-ink-500 dark:text-ink-400">{why}</p>
      {blocked && (
        <p className="mt-1 pl-7 text-xs font-medium text-amber-700 dark:text-amber-400">{blocked}</p>
      )}
    </div>
  )
}
