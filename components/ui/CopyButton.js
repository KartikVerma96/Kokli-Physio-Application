'use client'

/**
 * ============================================================================
 *  COPY BUTTON
 * ============================================================================
 *  Copies a short value — an appointment code, a transaction reference — and
 *  confirms it with a toast.
 *
 *  WHY THIS NEEDS FEEDBACK AT ALL
 *  ------------------------------
 *  Copying is completely invisible. Nothing on screen changes, and the clipboard is
 *  somewhere you cannot see. Without confirmation people click three or four times
 *  to be sure, then paste and find out. It is the textbook case for a toast: a
 *  transient, non-blocking "yes, that worked".
 *
 *  The tick that replaces the icon for a moment does the same job for anyone who
 *  has toasts scrolled off screen, and it is the faster signal of the two.
 * ============================================================================
 */

import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

export default function CopyButton({ value, label = 'code', className }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(null)

  // Clear a pending timer if the component unmounts first, or it fires against a
  // component that no longer exists.
  useEffect(() => () => clearTimeout(timerRef.current), [])

  async function copy() {
    try {
      /**
       * navigator.clipboard requires a secure context — HTTPS, or localhost. On a
       * plain-HTTP staging server it simply is not there, which is why this is
       * wrapped rather than assumed.
       */
      await navigator.clipboard.writeText(String(value))

      setCopied(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 2000)

      toast.success(`${value} copied to your clipboard.`)
    } catch {
      // Tell them what to do instead rather than failing silently.
      toast.error(
        `Could not reach the clipboard. Select the ${label} and copy it manually.`
      )
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      // The accessible name says what will be copied, not just "Copy".
      aria-label={`Copy ${label} ${value}`}
      title={`Copy ${label}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold transition-colors',
        copied
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800 dark:hover:text-ink-200',
        className
      )}
    >
      {copied ? (
        <>
          <Check className="size-3.5" aria-hidden="true" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-3.5" aria-hidden="true" />
          Copy
        </>
      )}
    </button>
  )
}
