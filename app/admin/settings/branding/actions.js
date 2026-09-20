'use server'

/**
 * ============================================================================
 *  SERVER ACTIONS — the clinic's own colour
 * ============================================================================
 *  Chosen once during setup and, until now, never changeable again: the colour
 *  lived only in the onboarding wizard, which a clinic sees once and never
 *  returns to. Somebody who picked in a hurry — or whose branding changed — had
 *  no way back.
 * ============================================================================
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { query } from '@/lib/db'

async function requireClinicAdmin() {
  const clinic = await getCurrentClinic()
  if (!clinic) throw new Error('NO_CLINIC')

  const session = await auth()
  if (!session?.user) throw new Error('UNAUTHENTICATED')
  if (session.user.role === 'platform') return clinic
  if (session.user.role !== 'admin') throw new Error('FORBIDDEN')
  if (Number(session.user.clinicId) !== Number(clinic.id)) throw new Error('FORBIDDEN')

  return clinic
}

const brandingSchema = z.object({
  /**
   * Six-digit hex only.
   *
   * Not because other notations are wrong, but because this string is written
   * straight into a `style` attribute on the public site. Constraining it to
   * `#` plus six hex digits means nothing else can ever end up there — a colour
   * field that accepted arbitrary text would be a way to inject CSS into every
   * patient's browser.
   */
  brandColour: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour, or type a hex code like #0d9488'),
})

export async function saveBranding(input = {}) {
  let clinic
  try {
    clinic = await requireClinicAdmin()
  } catch (error) {
    const messages = {
      NO_CLINIC: 'This clinic could not be found.',
      UNAUTHENTICATED: 'Your session has expired. Please sign in again.',
      FORBIDDEN: 'Only the clinic administrator can change the branding.',
    }
    return { ok: false, error: messages[error.message] || 'Something went wrong.' }
  }

  const parsed = brandingSchema.safeParse({ brandColour: input.brandColour })
  if (!parsed.success) {
    const errors = {}
    for (const issue of parsed.error.issues) errors[issue.path[0]] = issue.message
    return { ok: false, errors, error: 'Please check the highlighted fields.' }
  }

  try {
    await query('UPDATE clinics SET brand_colour = ? WHERE id = ?', [
      parsed.data.brandColour.toLowerCase(),
      clinic.id,
    ])

    /**
     * The whole public site, not just this page.
     *
     * The colour is injected on the public layout wrapper and the homepage is
     * cached, so revalidating only the settings page would leave a clinic staring
     * at their old colour and concluding it had not saved.
     */
    revalidatePath('/', 'layout')
    revalidatePath('/admin/settings/branding')

    return { ok: true, message: 'Saved. Your website is using the new colour now.' }
  } catch (error) {
    console.error('[saveBranding]', error)
    return { ok: false, error: 'Could not save that colour.' }
  }
}
