'use server'

import { requireUser } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { changePassword } from '@/lib/passwordReset'
import { sendEmailInBackground } from '@/lib/email'
import { passwordChanged } from '@/lib/emailTemplates'

/**
 * ============================================================================
 *  CHANGE YOUR OWN PASSWORD
 * ============================================================================
 *  One action for every role. A patient, a physiotherapist, a clinic owner and the
 *  platform account all change a password the same way, and duplicating it per
 *  dashboard is how one copy ends up missing the current-password check.
 *
 *  THE ID COMES FROM THE SESSION, NEVER FROM THE FORM
 *  -------------------------------------------------
 *  There is no `userId` parameter here and there must never be one. A server
 *  action is a public POST endpoint — anything the browser can send, an attacker
 *  can send. Taking the id from the signed session means the only password this
 *  can possibly change is the caller's own.
 *
 *  Note there is no role check at all, which is correct: everybody is allowed to
 *  change their own password. Authorisation is the session existing.
 * ============================================================================
 */

export async function changeMyPassword({ currentPassword, newPassword, confirm }) {
  const user = await requireUser()

  if (String(newPassword || '') !== String(confirm || '')) {
    return { ok: false, field: 'confirm', message: 'Both passwords must match.' }
  }

  const result = await changePassword({
    userId: user.id,
    currentPassword,
    newPassword,
  })

  if (!result.ok) return result

  /**
   * The notification is the security feature, not the courtesy.
   *
   * If somebody else changed this password — a borrowed laptop, a session left
   * open on a clinic's shared reception computer — this email is the only thing
   * that tells the real owner. Which is why it is sent even when the change was
   * obviously legitimate.
   */
  const clinic = await getCurrentClinic()
  if (user.email && !user.email.endsWith('.invalid')) {
    sendEmailInBackground({
      to: user.email,
      clinic,
      ...passwordChanged({ clinic, name: user.name }),
    })
  }

  return {
    ok: true,
    message: result.hadPassword
      ? 'Your password is updated.'
      : 'Your password is set. You can now sign in with your email as well.',
  }
}
