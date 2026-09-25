'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { XCircle, Download, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Select, Textarea } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { cancelSubscription } from './actions'

/**
 * ============================================================================
 *  CANCELLING
 * ============================================================================
 *  DELIBERATELY NOT A DARK PATTERN
 *  -------------------------------
 *  Two clicks: open the panel, confirm. No hidden link, no three-step gauntlet,
 *  no discount offer standing between a clinic and the door. The reasoning is in
 *  the long note in actions.js — briefly: a clinic that cannot cancel disputes the
 *  charge with its bank instead, and Indian physiotherapy is a word-of-mouth
 *  market where trapping one clinic costs the next five.
 *
 *  WHAT THIS PANEL IS ACTUALLY FOR
 *  -------------------------------
 *  Answering the two questions a leaving customer has, BEFORE they ask:
 *
 *      Will I be charged again?          No.
 *      Is my patient data being deleted? No.
 *
 *  Both are stated before the button, not after. Somebody who has decided to leave
 *  should not have to email support to find out whether their medical records are
 *  about to disappear.
 *
 *  The export link is here on purpose. Offering a clinic its data on the way out is
 *  the difference between a customer who recommends you anyway and one who warns
 *  people about you.
 * ============================================================================
 */

const REASONS = [
  { value: '', label: 'Prefer not to say' },
  { value: 'too_expensive', label: 'Too expensive' },
  { value: 'not_using_it', label: 'We are not using it enough' },
  { value: 'missing_feature', label: 'Missing something we need' },
  { value: 'switching', label: 'Moving to different software' },
  { value: 'closing_clinic', label: 'Closing or pausing the clinic' },
  { value: 'other', label: 'Something else' },
]

export default function CancelSubscription({ onTrial, periodEndLabel }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState({ reason: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await cancelSubscription(values)
      if (!result.ok) {
        toast.error(result.error || 'Could not cancel just now.')
        return
      }
      setDone(result.message)
      toast.success('Cancelled.')
      router.refresh()
    } catch {
      toast.error('Something went wrong. Nothing has been changed.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Card className="border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950/30">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-bold text-emerald-900 dark:text-emerald-100">{done}</p>
            <p className="mt-1 text-emerald-800 dark:text-emerald-200">
              We have emailed you a confirmation. If this was a mistake, reply to it — it reaches a
              person.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-200 p-4 dark:border-ink-800">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Cancel your subscription</p>
          <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
            Month to month — you can stop whenever you like, and nothing is deleted.
          </p>
        </div>
        {/* A plain, findable button. Quiet because it is destructive, not hidden
            because it is inconvenient for us. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-xl px-3 py-2 text-sm font-semibold text-ink-500 underline underline-offset-4 transition-colors hover:text-red-600"
        >
          Cancel subscription
        </button>
      </div>
    )
  }

  return (
    <Card className="border-red-200 p-5 dark:border-red-900">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/40">
          <XCircle className="size-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">Cancel your subscription</h3>

          {/* The two questions, answered first. */}
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex gap-2.5">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <div>
                <dt className="font-semibold">You will not be charged again.</dt>
                <dd className="text-ink-600 dark:text-ink-400">
                  {onTrial
                    ? 'Nothing has been charged during your trial, and nothing will be.'
                    : `Your current month runs until ${periodEndLabel}, and everything works normally until then.`}
                </dd>
              </div>
            </div>
            <div className="flex gap-2.5">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <div>
                <dt className="font-semibold">Nothing is deleted.</dt>
                <dd className="text-ink-600 dark:text-ink-400">
                  Your patients, appointments, clinical notes and payment history all stay. You and
                  your team can still sign in and read everything afterwards.
                </dd>
              </div>
            </div>
            <div className="flex gap-2.5">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
              <div>
                <dt className="font-semibold">Your website stops taking new bookings.</dt>
                <dd className="text-ink-600 dark:text-ink-400">
                  It stays online, and patients are asked to telephone you instead. Appointments
                  already booked are unaffected.
                </dd>
              </div>
            </div>
          </dl>

          {/* Offered on the way out, not withheld. */}
          <Link
            href="/admin/settings/data"
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 px-3.5 text-sm font-semibold transition-colors hover:bg-brand-50/70 dark:border-ink-700 dark:hover:bg-brand-500/10"
          >
            <Download className="size-4" aria-hidden="true" />
            Download your data first
          </Link>

          <form onSubmit={submit} className="mt-5 space-y-4 border-t border-ink-100 pt-5 dark:border-ink-800">
            {/* Optional, and it says so. A required field here would be a toll gate
                on the way out, which is the thing this whole panel avoids. */}
            <Select
              label="Why are you leaving? (optional)"
              name="reason"
              value={values.reason}
              onChange={(e) => setValues((v) => ({ ...v, reason: e.target.value }))}
              hint="It genuinely helps us fix things. Skip it if you would rather not."
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>

            <Textarea
              label="Anything you want to tell us? (optional)"
              name="note"
              rows={3}
              maxLength={500}
              value={values.note}
              onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))}
              placeholder="What were you hoping this would do?"
            />

            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="danger" loading={busy}>
                {onTrial ? 'End my trial' : 'Confirm cancellation'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Keep my subscription
              </Button>
            </div>
          </form>
        </div>
      </div>
    </Card>
  )
}
