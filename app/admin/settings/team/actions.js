'use server'

/**
 * ============================================================================
 *  TEAM — adding and removing physiotherapists
 * ============================================================================
 *
 *  WHY THIS EXISTS
 *  ---------------
 *  The pricing page says Starter includes 1 physiotherapist, Professional 3 and
 *  Clinic 10. Until this file existed, none of that was true: there was no way to
 *  add a second therapist at all, so every tier gave exactly one and the Clinic
 *  plan was ₹2,999 for nothing extra.
 *
 *  A plan limit that nothing enforces is not a limit — it is a claim on a pricing
 *  page. This is the code that makes the tiers real.
 * ============================================================================
 */

import { revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { query, queryOne, isDuplicateError } from '@/lib/db'
import { sendEmailInBackground } from '@/lib/email'
import { staffWelcome } from '@/lib/emailTemplates'

async function requireClinicAdmin() {
  const clinic = await getCurrentClinic()
  if (!clinic) throw new Error('NO_CLINIC')

  const session = await auth()
  const user = session?.user
  if (!user) throw new Error('UNAUTHENTICATED')
  if (user.role === 'platform') return clinic
  if (user.role !== 'admin') throw new Error('FORBIDDEN')
  if (Number(user.clinicId) !== Number(clinic.id)) throw new Error('FORBIDDEN')

  return clinic
}

function guardFailure(error) {
  const messages = {
    NO_CLINIC: 'This clinic could not be found.',
    UNAUTHENTICATED: 'Your session has expired. Please sign in again.',
    FORBIDDEN: 'Only the clinic administrator can manage the team.',
  }
  return { ok: false, error: messages[error.message] || 'Something went wrong.' }
}

/**
 * How many therapist seats are in use.
 *
 * Counts only ACTIVE physios. A deactivated therapist who left last year should
 * not occupy a seat the clinic is paying for — but the row stays, because their
 * name is attached to historical appointments and clinical notes.
 */
async function seatsUsed(clinicId) {
  const row = await queryOne(
    `SELECT COUNT(*) AS n FROM users
      WHERE clinic_id = ? AND role = 'physio' AND is_active = 1`,
    [clinicId]
  )
  return Number(row?.n ?? 0)
}

/* ========================================================================== */
/*  ADD A PHYSIOTHERAPIST                                                     */
/* ========================================================================== */

export async function addPhysio(previousState, formData) {
  let clinic
  try {
    clinic = await requireClinicAdmin()
  } catch (error) {
    return guardFailure(error)
  }

  const name = String(formData.get('name') || '').trim()
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const password = String(formData.get('password') || '')
  const credentials = String(formData.get('credentials') || '').trim()
  /**
   * Optional, and only useful for one thing: signing in.
   *
   * A physiotherapist with a number on file can use the WhatsApp code on the
   * login page instead of remembering the password you are about to type for
   * them — which matters because there is no forgot-password flow yet, so a
   * forgotten password today means an admin editing the database.
   */
  const phone = String(formData.get('phone') || '').trim()

  const errors = {}
  if (name.length < 2) errors.name = 'Enter their full name'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = 'Enter a valid email address'
  if (password.length < 8) errors.password = 'At least 8 characters'
  // Ten digits after stripping punctuation, and only checked when given.
  if (phone && phone.replace(/\D/g, '').replace(/^(0|91)/, '').length !== 10) {
    errors.phone = 'Enter a 10-digit mobile number, or leave it blank'
  }
  if (Object.keys(errors).length) {
    return { ok: false, errors, error: 'Please check the highlighted fields.' }
  }

  /* ------------------------------------------------------- the seat limit */
  /**
   * Checked on the SERVER, against the plan joined onto the clinic row.
   *
   * Hiding the "Add" button in the UI when the limit is reached is a courtesy,
   * not a control — the button is in a page anyone signed in as admin can call
   * a server action from. This is the check that actually holds.
   */
  const limit = clinic.max_physios ?? 1
  const used = await seatsUsed(clinic.id)

  if (used >= limit) {
    return {
      ok: false,
      // Names the limit AND the way out. A wall with no door is how you lose an
      // upgrade you were about to be paid for.
      error: `Your ${clinic.plan_name || 'current'} plan includes ${limit} physiotherapist${limit === 1 ? '' : 's'}, and you are using ${used}. Upgrade your plan to add more.`,
      atLimit: true,
    }
  }

  try {
    const hash = await bcrypt.hash(password, 10)
    await query(
      `INSERT INTO users (clinic_id, name, email, password_hash, phone, role, email_verified, is_active)
       VALUES (?, ?, ?, ?, ?, 'physio', 1, 1)`,
      // NULL rather than '' so the phone-login lookup, which filters on
      // `phone IS NOT NULL`, cannot match an empty string.
      [clinic.id, name, email, hash, phone || null]
    )

    // Their credentials show on the public site next to their name.
    if (credentials) {
      await query(
        `UPDATE clinics SET practitioner_credentials = COALESCE(practitioner_credentials, ?)
          WHERE id = ?`,
        [credentials, clinic.id]
      )
    }

    // Tells them where to sign in. Deliberately does NOT contain the password —
    // email is not a secure channel, and the administrator hands that over in
    // person or by whatever they already use to talk to their staff.
    sendEmailInBackground({
      to: email,
      clinic,
      ...staffWelcome({ clinic, name, email }),
    })

    revalidatePath('/admin/settings/team')
    revalidatePath('/', 'layout')
    return { ok: true, message: `${name} can now sign in and take appointments.` }
  } catch (error) {
    // Emails are globally unique across the platform — see the note on the users
    // table in database/schema.sql for why, and what it costs.
    if (isDuplicateError(error)) {
      return {
        ok: false,
        errors: { email: 'That email is already registered on the platform.' },
        error: 'That email is already in use.',
      }
    }
    console.error('[team/addPhysio]', error)
    return { ok: false, error: 'Could not add that physiotherapist.' }
  }
}

/* ========================================================================== */
/*  DEACTIVATE                                                                */
/* ========================================================================== */

/**
 * Deactivate rather than delete, always.
 *
 * A physiotherapist's name is attached to appointments and to signed clinical
 * notes. Deleting the row would either break those foreign keys or orphan a
 * medical record whose author can no longer be identified — which, for a
 * clinical document, is close to falsifying it.
 *
 * So: they can no longer sign in, they free a seat, they disappear from booking.
 * The history keeps their name.
 */
export async function setPhysioActive(physioId, active) {
  let clinic
  try {
    clinic = await requireClinicAdmin()
  } catch (error) {
    return guardFailure(error)
  }

  // Re-activating has to respect the seat limit too, or it becomes the loophole.
  if (active) {
    const limit = clinic.max_physios ?? 1
    if ((await seatsUsed(clinic.id)) >= limit) {
      return {
        ok: false,
        error: `Your plan includes ${limit} physiotherapist${limit === 1 ? '' : 's'}. Deactivate someone else, or upgrade.`,
      }
    }
  }

  try {
    await query(
      `UPDATE users SET is_active = ? WHERE id = ? AND clinic_id = ? AND role = 'physio'`,
      [active ? 1 : 0, physioId, clinic.id]
    )
    revalidatePath('/admin/settings/team')
    return { ok: true, message: active ? 'Reactivated.' : 'Deactivated. Their records are kept.' }
  } catch (error) {
    console.error('[team/setPhysioActive]', error)
    return { ok: false, error: 'Could not update that physiotherapist.' }
  }
}
