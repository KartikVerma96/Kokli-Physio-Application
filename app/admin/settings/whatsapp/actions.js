'use server'

/**
 * ============================================================================
 *  SERVER ACTIONS — WhatsApp settings
 * ============================================================================
 *  Which messages this clinic sends, and how long before an appointment.
 * ============================================================================
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { query, queryOne } from '@/lib/db'
import { optInToMarketing, optOutOfWhatsApp, normaliseNumber, whatsappAllowance } from '@/lib/whatsapp'
import { encryptSecret, isEncryptionConfigured } from '@/lib/crypto'

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

const settingsSchema = z.object({
  sendReminders: z.coerce.boolean(),
  sendExercises: z.coerce.boolean(),
  sendPackageNudge: z.coerce.boolean(),
  sendReviewRequest: z.coerce.boolean(),
  reminderHours: z.coerce.number().int().min(2).max(72),
})

export async function saveWhatsAppSettings(input = {}) {
  let clinic
  try {
    clinic = await requireClinicAdmin()
  } catch (error) {
    const messages = {
      NO_CLINIC: 'This clinic could not be found.',
      UNAUTHENTICATED: 'Your session has expired. Please sign in again.',
      FORBIDDEN: 'Only the clinic administrator can change this.',
    }
    return { ok: false, error: messages[error.message] || 'Something went wrong.' }
  }

  const parsed = settingsSchema.safeParse({
    sendReminders: Boolean(input.sendReminders),
    sendExercises: Boolean(input.sendExercises),
    sendPackageNudge: Boolean(input.sendPackageNudge),
    sendReviewRequest: Boolean(input.sendReviewRequest),
    reminderHours: input.reminderHours,
  })

  if (!parsed.success) {
    const errors = {}
    for (const issue of parsed.error.issues) errors[issue.path[0]] = issue.message
    return { ok: false, errors, error: 'Please check the highlighted fields.' }
  }

  const d = parsed.data

  try {
    await query(
      `UPDATE clinics
          SET wa_send_reminders = ?, wa_send_exercises = ?,
              wa_send_package_nudge = ?, wa_send_review_request = ?,
              wa_reminder_hours = ?
        WHERE id = ?`,
      [
        d.sendReminders ? 1 : 0,
        d.sendExercises ? 1 : 0,
        d.sendPackageNudge ? 1 : 0,
        d.sendReviewRequest ? 1 : 0,
        d.reminderHours,
        clinic.id,
      ]
    )

    revalidatePath('/admin/settings/whatsapp')
    return { ok: true, message: 'Saved. New messages follow these settings.' }
  } catch (error) {
    console.error('[saveWhatsAppSettings]', error)
    return { ok: false, error: 'Could not save those settings.' }
  }
}

/* ========================================================================== */
/*  CONSENT                                                                   */
/* ========================================================================== */

/**
 * Record that a patient agreed to marketing messages.
 *
 * WHY THIS IS A DELIBERATE ACTION AND NOT A TICK-BOX ON A FORM SOMEWHERE
 * ---------------------------------------------------------------------
 * Package nudges and review requests are marketing under Meta's rules, and
 * sending one without consent gets the sending number blocked — the clinic's own
 * number if they have connected one, and the shared platform number if they have
 * not, which would take every other clinic on it down too.
 *
 * So consent is recorded per patient, with the date, by somebody who actually
 * asked them. It is slower. It is also the only version that is true.
 */
export async function setMarketingConsent(patientId, consented) {
  let clinic
  try {
    clinic = await requireClinicAdmin()
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  const patient = await queryOne(
    `SELECT id, name FROM users WHERE id = ? AND clinic_id = ? AND role = 'patient'`,
    [patientId, clinic.id]
  )
  if (!patient) return { ok: false, error: 'That patient could not be found.' }

  try {
    if (consented) {
      await optInToMarketing(patientId)
      return {
        ok: true,
        message: `${patient.name} will receive package reminders and review requests.`,
      }
    }

    await optOutOfWhatsApp(clinic.id, patientId)
    return { ok: true, message: `${patient.name} will no longer be messaged on WhatsApp.` }
  } catch (error) {
    console.error('[setMarketingConsent]', error)
    return { ok: false, error: 'Could not save that.' }
  }
}

/** Correct or add the WhatsApp number, when it differs from the phone on file. */
export async function setWhatsAppNumber(patientId, number) {
  let clinic
  try {
    clinic = await requireClinicAdmin()
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  const patient = await queryOne(
    `SELECT id, name FROM users WHERE id = ? AND clinic_id = ? AND role = 'patient'`,
    [patientId, clinic.id]
  )
  if (!patient) return { ok: false, error: 'That patient could not be found.' }

  const cleaned = String(number || '').trim()
  // Normalised on the way in, so a number typed as "+91 98123 45678" and one
  // typed as "09812345678" are the same patient's number, not two.
  if (cleaned && !normaliseNumber(cleaned)) {
    return { ok: false, error: 'That does not look like a phone number.' }
  }

  try {
    await query(
      `INSERT INTO patient_profiles (user_id, whatsapp_number)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE whatsapp_number = VALUES(whatsapp_number)`,
      [patientId, cleaned || null]
    )
    return {
      ok: true,
      message: cleaned
        ? `WhatsApp messages for ${patient.name} will go to ${cleaned}.`
        : `Using ${patient.name}'s phone number on file.`,
    }
  } catch (error) {
    console.error('[setWhatsAppNumber]', error)
    return { ok: false, error: 'Could not save that number.' }
  }
}


/* ========================================================================== */
/*  CONNECTING THE CLINIC'S OWN WHATSAPP NUMBER                               */
/* ========================================================================== */

/**
 * Attach this clinic's own WhatsApp Business number.
 *
 * WHY A CLINIC WOULD WANT TO
 * --------------------------
 * Messages arrive from THEIR number, with their name in the patient's phone, and
 * a reply reaches them rather than us. Patients trust a message from the clinic
 * they visit; one from an unknown business number gets ignored or reported.
 *
 * WHY WE WANT THEM TO
 * -------------------
 * Two reasons, and the second matters more. Meta bills them directly, so their
 * messaging is not a cost we carry — that is the obvious one. The important one
 * is that Meta blocks and quality-rates per NUMBER: a clinic that sends badly on
 * its own number damages only itself, where on our shared fallback number it
 * would take every other clinic down with it.
 *
 * The token is encrypted at rest for the same reason the Razorpay secret is: a
 * leaked database must not let somebody send messages as another business.
 */
export async function connectOwnWhatsApp(input = {}) {
  let clinic
  try {
    clinic = await requireClinicAdmin()
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  /**
   * ==========================================================================
   *  THE PLAN CHECK, HERE AND NOT ONLY ON THE PAGE
   * ==========================================================================
   *  Connecting your own number means unlimited sending, so it belongs to the top
   *  plan — see migration 008 for the pricing reasoning.
   *
   *  The settings page already hides the form when the plan does not allow it, and
   *  that is worth nothing on its own. A server action is a public POST endpoint:
   *  anything the browser can send, so can curl. Hiding a form is a courtesy to the
   *  user; this is the check.
   */
  const allowance = await whatsappAllowance(clinic)
  if (!allowance.ownNumberAllowed) {
    return {
      ok: false,
      error:
        'Sending from your own WhatsApp number is available on the Clinic plan. ' +
        'Your current plan includes a monthly allowance on our number instead.',
    }
  }

  /**
   * Refuse rather than store it in the clear.
   *
   * Without PLATFORM_ENCRYPTION_KEY the token would go into the database
   * readable. A leaked backup would then let anybody send WhatsApp messages as
   * this clinic — to their own patients. Better to be unavailable than quietly
   * insecure.
   */
  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      error:
        'Encryption is not configured on this server, so a WhatsApp token cannot be stored safely. Contact support.',
    }
  }

  const phoneNumberId = String(input.phoneNumberId || '').trim()
  const token = String(input.token || '').trim()

  const errors = {}
  /**
   * Meta's phone number ID is around fifteen digits. An Indian mobile is ten.
   *
   * The minimum is 12 rather than 10 precisely so that pasting the phone number
   * — by far the commonest mistake here — is caught rather than accepted and
   * then failing later with an opaque error from Meta.
   */
  if (!/^\d{12,25}$/.test(phoneNumberId)) {
    errors.phoneNumberId =
      'This is the numeric Phone number ID from Meta, not your phone number'
  }
  if (token.length < 40) errors.token = 'That does not look like a Meta access token'
  if (Object.keys(errors).length) {
    return { ok: false, errors, error: 'Please check the highlighted fields.' }
  }

  try {
    await query('UPDATE clinics SET wa_phone_number_id = ?, wa_token_enc = ? WHERE id = ?', [
      phoneNumberId,
      encryptSecret(token),
      clinic.id,
    ])

    revalidatePath('/admin/settings/whatsapp')
    return {
      ok: true,
      message:
        'Connected. Messages now go from your own number, and there is no monthly limit — Meta bills you directly.',
    }
  } catch (error) {
    console.error('[connectOwnWhatsApp]', error)
    return { ok: false, error: 'Could not save those details.' }
  }
}

/**
 * Go back to the platform's number.
 *
 * The monthly cap returns with it, which the message says plainly — a clinic that
 * disconnects and then wonders why messages stopped in the third week has been
 * failed by the software, not by Meta.
 */
export async function disconnectOwnWhatsApp() {
  let clinic
  try {
    clinic = await requireClinicAdmin()
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  try {
    await query(
      'UPDATE clinics SET wa_phone_number_id = NULL, wa_token_enc = NULL WHERE id = ?',
      [clinic.id]
    )
    revalidatePath('/admin/settings/whatsapp')
    return {
      ok: true,
      message:
        'Disconnected. Messages will go from our number again, within your plan’s monthly allowance.',
    }
  } catch (error) {
    console.error('[disconnectOwnWhatsApp]', error)
    return { ok: false, error: 'Could not disconnect.' }
  }
}
