'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { resolveError } from '@/lib/errorLog'

/**
 * Mark a fault dealt with.
 *
 * PLATFORM ONLY, checked here and not merely in the layout. A server action is a
 * public POST endpoint: the layout guarding the page it lives on does nothing to
 * stop somebody posting straight to the action. This table spans every tenant, so
 * it is the last surface that should rely on a check happening elsewhere.
 */
export async function markResolved(id) {
  const session = await auth()
  if (session?.user?.role !== 'platform') {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  await resolveError(id)
  revalidatePath('/platform/errors')
  return { ok: true }
}
