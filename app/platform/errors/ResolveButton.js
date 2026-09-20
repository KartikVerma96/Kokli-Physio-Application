'use client'

import { useTransition } from 'react'
import { Check } from 'lucide-react'
import { toast } from '@/lib/toast'
import { markResolved } from './actions'

/** Hides a fault until it happens again. See the note in page.js. */
export default function ResolveButton({ id }) {
  const [busy, start] = useTransition()

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() =>
        start(async () => {
          const result = await markResolved(id)
          if (result?.ok) toast.success('Marked resolved. It will reappear if it happens again.')
          else toast.error(result?.error || 'Could not update that.')
        })
      }
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-ink-200 px-3 text-xs font-semibold transition-colors hover:bg-ink-50 disabled:opacity-60 dark:border-ink-700 dark:hover:bg-ink-800"
    >
      <Check className="size-3.5" aria-hidden="true" />
      {busy ? 'Saving…' : 'Resolved'}
    </button>
  )
}
