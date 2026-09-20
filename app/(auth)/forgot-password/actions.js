'use server'

import { headers } from 'next/headers'
import { getCurrentClinic } from '@/lib/tenant'
import { createResetToken, resetUrl } from '@/lib/passwordReset'
import { sendEmail } from '@/lib/email'
import { passwordReset } from '@/lib/emailTemplates'

/**
 * ============================================================================
 *  ASK FOR A RESET LINK
 * ============================================================================
 *  ONE ANSWER, ALWAYS
 *  ------------------
 *  This action returns the same thing whether the address belongs to a clinic
 *  owner, a patient, or nobody at all. That is the entire security of the form.
 *
 *  A "no account with that email" message would turn it into a way to check who
 *  is a patient at a named physiotherapy clinic. That is private medical
 *  information, and it is the same reasoning already written into the sign-in
 *  provider at lib/auth.js and the OTP request in lib/otp.js — three separate
 *  places, one rule, because a leak from any of them is the same leak.
 *
 *  The consequence to accept: somebody who mistypes their own address is told
 *  "check your email" and gets nothing. That is why the wording says to try
 *  again or contact the clinic rather than promising an email is on its way.
 * ============================================================================
 */

export async function requestPasswordReset({ email }) {
  const clinic = await getCurrentClinic()

  const issued = await createResetToken({ email, ip: await clientAddress() })

  /**
   * Awaited, not fired into the background.
   *
   * The rest of the app uses sendEmailInBackground() so a reminder never adds
   * latency to a page. Here the email IS the outcome — if it fails, the person is
   * standing at a login screen they cannot pass, and a silent failure means they
   * never find out why.
   */
  if (issued) {
    const { token, user } = issued
    await sendEmail({
      to: user.email,
      // The clinic's own branding when they have one, so the mail looks like it
      // came from their physiotherapist and not from a company they never heard of.
      clinic: user.clinic_slug ? { name: user.clinic_name, slug: user.clinic_slug } : clinic,
      ...passwordReset({
        clinic: user.clinic_slug ? { name: user.clinic_name, slug: user.clinic_slug } : null,
        name: user.name,
        url: resetUrl({ token, clinicSlug: user.clinic_slug }),
        minutes: 60,
      }),
    })
  }

  return {
    ok: true,
    message:
      'If that email address has an account, a reset link is on its way. It expires in an hour.',
  }
}

async function clientAddress() {
  const store = await headers()
  const forwarded = store.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 45)
  return store.get('x-real-ip')?.slice(0, 45) || null
}
