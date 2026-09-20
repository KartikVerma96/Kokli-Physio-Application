'use server'

import { getCurrentClinic } from '@/lib/tenant'
import { consumeResetToken } from '@/lib/passwordReset'
import { sendEmailInBackground } from '@/lib/email'
import { passwordChanged } from '@/lib/emailTemplates'

/**
 * Exchange a reset token for a new password.
 *
 * WHY IT DOES NOT SIGN THEM IN AFTERWARDS
 * ---------------------------------------
 * Tempting, and wrong. Anyone holding the link would be handed a live session, so
 * a reset email intercepted in transit becomes an account rather than a chance to
 * guess a password. Sending them to /login to use what they just chose costs one
 * form and closes that.
 *
 * The notification email is fired into the background because it is not the
 * outcome — the password has already changed by the time it goes out, and a mail
 * server being slow must not make the person think the reset failed.
 */
export async function submitNewPassword({ token, password, confirm }) {
  if (String(password || '') !== String(confirm || '')) {
    return { ok: false, field: 'confirm', message: 'Both passwords must match.' }
  }

  const result = await consumeResetToken({ token, password })
  if (!result.ok) return result

  const clinic = await getCurrentClinic()

  /**
   * Sent to the address ON FILE, and this is the point of it.
   *
   * If somebody else did the reset, the link went to a mailbox they control — this
   * message is the only thing that reaches the real owner and tells them their
   * account was taken. It goes out whether the reset looked legitimate or not,
   * because the value is entirely in the case where it was not.
   */
  sendEmailInBackground({
    to: result.user.email,
    clinic,
    ...passwordChanged({ clinic, name: result.user.name }),
  })

  return { ok: true, message: 'Your password is set. Sign in with it now.' }
}
