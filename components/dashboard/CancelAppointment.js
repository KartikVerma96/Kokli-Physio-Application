'use client'

/**
 * ============================================================================
 *  CANCEL APPOINTMENT
 * ============================================================================
 *  A two-step action: press "Cancel appointment", then confirm in a dialogue that
 *  spells out exactly what happens to the money.
 *
 *  WHY NOT ONE CLICK?
 *  ------------------
 *  Because it is destructive and irreversible. A misplaced tap on a phone would
 *  cancel a medical appointment and, inside the free window, trigger a refund that
 *  takes a week to reverse. The rule of thumb: any action you cannot undo deserves
 *  a confirmation that states the consequence in words, not a generic "are you
 *  sure?".
 *
 *  Notice the dialogue tells the patient whether they get their money back BEFORE
 *  they commit. Hiding that until afterwards is how you generate angry phone
 *  calls.
 * ============================================================================
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, TriangleAlert } from 'lucide-react'
import { toast } from '@/lib/toast'
import Button from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Field'

export default function CancelAppointment({ site, appointmentId, refundable, amount }) {
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleCancel() {
    setBusy(true)

    try {
      const response = await fetch(`/api/appointments/${appointmentId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const data = await response.json()

      if (!response.ok) {
        toast.error(data.error || 'Could not cancel.')
        setBusy(false)
        return
      }

      toast.success(data.message)
      setOpen(false)

      /**
       * router.refresh() re-runs the Server Component for this page, so the status
       * badge, the buttons and the refund line all update from the database.
       *
       * This is the App Router equivalent of refetching — and it is better than
       * managing a local copy of the appointment in client state, because there is
       * only ever one source of truth.
       */
      router.refresh()
    } catch {
      toast.error('Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="dangerGhost" size="lg" onClick={() => setOpen(true)}>
        Cancel appointment
      </Button>

      {open && (
        <div
          // role="dialog" and aria-modal tell assistive technology that the rest of
          // the page is inert while this is open.
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-title"
          className="fixed inset-0 z-[90] flex items-end justify-center p-4 sm:items-center"
        >
          {/* The backdrop is a button so it can be clicked to dismiss AND is
              reachable by keyboard. tabIndex={-1} keeps it out of the tab order,
              since Escape and the Keep button are the proper ways out. */}
          <button
            type="button"
            className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm"
            onClick={() => !busy && setOpen(false)}
            aria-label="Close"
            tabIndex={-1}
          />

          <div className="card relative w-full max-w-md animate-fade-up p-6 shadow-float">
            <button
              type="button"
              onClick={() => !busy && setOpen(false)}
              className="absolute right-4 top-4 rounded-lg p-1 text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:hover:text-brand-200 dark:hover:bg-brand-500/10"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>

            <span className="grid size-11 place-items-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400">
              <TriangleAlert className="size-5" aria-hidden="true" />
            </span>

            <h2 id="cancel-title" className="mt-4 text-lg font-bold">
              Cancel this appointment?
            </h2>

            {/* The consequence, in plain language, before they commit. */}
            <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
              {refundable ? (
                <>
                  You are still outside the {site.booking.freeCancellationHours}-hour window, so{' '}
                  <strong className="text-emerald-700 dark:text-emerald-400">
                    {amount} will be refunded in full
                  </strong>
                  . Refunds usually reach your account within 5–7 working days.
                </>
              ) : (
                <>
                  This appointment is inside the {site.booking.freeCancellationHours}-hour window, so{' '}
                  <strong className="text-red-700 dark:text-red-400">
                    {amount} cannot be refunded
                  </strong>
                  . That time can no longer be offered to another patient. If something urgent has
                  come up, message the clinic — we will usually try to move it instead.
                </>
              )}
            </p>

            <div className="mt-5">
              <Textarea
                label="Reason (optional)"
                name="reason"
                rows={3}
                maxLength={255}
                placeholder="Feeling better, work conflict, travel…"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                hint="It genuinely helps the clinic plan. Nobody will chase you about it."
              />
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Keep appointment
              </Button>
              <Button variant="danger" onClick={handleCancel} loading={busy}>
                {busy ? 'Cancelling…' : 'Yes, cancel it'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
