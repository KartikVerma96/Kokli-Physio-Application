'use client'

/**
 * ============================================================================
 *  STATUS ACTIONS — mark completed, mark no-show, cancel
 * ============================================================================
 *  Each of these changes a paid medical appointment, so each asks for
 *  confirmation and says what the consequence is.
 *
 *  Cancel goes through the API route rather than a server action, because it also
 *  has to issue a refund through Razorpay — and having two code paths that can both
 *  cancel would eventually mean two paths that disagree about the money. One place
 *  handles cancellation: /api/appointments/[id]/cancel.
 * ============================================================================
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, UserX, XCircle } from 'lucide-react'
import { updateAppointmentStatus } from './actions'
import { toast } from '@/lib/toast'
import Button from '@/components/ui/Button'

export default function StatusActions({ appointmentId, status }) {
  const router = useRouter()

  // useTransition gives a pending flag for a server action called outside a form.
  // Without it there is no way to disable the button while the action is running,
  // and a double click would fire it twice.
  const [pending, startTransition] = useTransition()
  const [cancelling, setCancelling] = useState(false)

  function setStatus(next, confirmMessage) {
    if (confirmMessage && !window.confirm(confirmMessage)) return

    startTransition(async () => {
      const result = await updateAppointmentStatus(appointmentId, next)
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
      // Re-runs the Server Component so every badge and button on the page reflects
      // the new status, straight from the database.
      if (result.ok) router.refresh()
    })
  }

  async function cancel() {
    const reason = window.prompt(
      'Cancel this appointment?\n\nThe patient will be refunded in full, because the clinic is cancelling. Reason (optional):'
    )
    // prompt() returns null on Cancel and '' if they press OK with an empty box —
    // only null means "changed my mind".
    if (reason === null) return

    setCancelling(true)
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const data = await response.json()

      if (response.ok) toast.success(data.message)
      else toast.error(data.error)
      if (response.ok) router.refresh()
    } catch {
      toast.error('Could not cancel. Please try again.')
    } finally {
      setCancelling(false)
    }
  }

  // Nothing to do for an appointment that has already finished one way or another.
  if (['cancelled', 'no_show'].includes(status)) return null

  return (
    <>
      {status !== 'completed' && (
        <Button
          variant="secondary"
          size="lg"
          onClick={() => setStatus('completed', 'Mark this appointment as completed?')}
          disabled={pending}
        >
          <CheckCircle2 className="size-4" aria-hidden="true" />
          Mark completed
        </Button>
      )}

      {status === 'confirmed' && (
        <>
          <Button
            variant="ghost"
            size="lg"
            onClick={() =>
              setStatus(
                'no_show',
                'Mark this patient as a no-show?\n\nThis is recorded against their history and the session is not refunded.'
              )
            }
            disabled={pending}
          >
            <UserX className="size-4" aria-hidden="true" />
            No show
          </Button>

          <Button variant="dangerGhost" size="lg" onClick={cancel} loading={cancelling}>
            <XCircle className="size-4" aria-hidden="true" />
            Cancel & refund
          </Button>
        </>
      )}
    </>
  )
}
