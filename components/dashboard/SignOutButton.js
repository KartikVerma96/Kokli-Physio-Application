'use client'

/**
 * Sign out. A Client Component because signOut() is a browser-side call — it has
 * to clear the session cookie and then navigate.
 *
 * `callbackUrl: '/'` sends the patient to the homepage afterwards rather than
 * leaving them on a dashboard page they can no longer see, which would bounce
 * them straight back to the login screen.
 */

import { signOut } from 'next-auth/react'
import { LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function SignOutButton({ compact = false }) {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: '/' })}
      className={cn(
        'flex items-center gap-2 rounded-xl text-sm font-semibold text-ink-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400',
        compact ? 'size-10 justify-center' : 'flex-1 px-3 py-2'
      )}
      aria-label="Sign out"
    >
      <LogOut className="size-4 shrink-0" aria-hidden="true" />
      {!compact && 'Sign out'}
    </button>
  )
}
