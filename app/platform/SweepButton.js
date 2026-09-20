'use client'

/**
 * ============================================================================
 *  "REFRESH STATUSES" — runs the subscription sweep by hand
 * ============================================================================
 *  Calls POST /api/cron/subscriptions, the same endpoint a nightly scheduler
 *  hits.
 *
 *  WHY A BUTTON FOR SOMETHING A CRON DOES
 *  --------------------------------------
 *  Because until this project is deployed somewhere with a scheduler, there IS
 *  no cron — and the numbers on this page would drift a day behind reality with
 *  no way to fix them.
 *
 *  It is worth being clear about what this does and does not affect. A clinic
 *  whose trial ran out an hour ago is ALREADY blocked from taking bookings,
 *  because that is worked out from the dates every time it is checked, not read
 *  from a column. This only writes the derived status back so the counts and the
 *  MRR figure above agree with it. Nothing about the enforcement waits for it.
 * ============================================================================
 */

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { toast } from '@/lib/toast'

export default function SweepButton() {
  const router = useRouter()
  const [running, startRunning] = useTransition()

  function run() {
    startRunning(async () => {
      try {
        const response = await fetch('/api/cron/subscriptions', { method: 'POST' })
        const data = await response.json()

        if (!response.ok) {
          toast.error(data.error || 'Could not refresh the statuses.')
          return
        }

        toast.success(
          data.changed
            ? `${data.changed} clinic${data.changed === 1 ? '' : 's'} moved to a new status.`
            : `Checked ${data.checked} clinic${data.checked === 1 ? '' : 's'} — everything was already up to date.`
        )
        router.refresh()
      } catch {
        toast.error('Could not reach the server.')
      }
    })
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={running}
      className="inline-flex items-center gap-2 rounded-xl border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-600 transition-colors hover:bg-ink-100 disabled:opacity-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
    >
      <RefreshCw className={`size-3.5 ${running ? 'animate-spin' : ''}`} aria-hidden="true" />
      {running ? 'Checking…' : 'Refresh statuses'}
    </button>
  )
}
