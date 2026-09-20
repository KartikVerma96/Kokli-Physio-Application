'use server'

/**
 * ============================================================================
 *  SERVER ACTIONS — clinical notes and appointment status
 * ============================================================================
 *  Every function here re-checks that the caller is staff. A server action is a
 *  public endpoint with an obfuscated name, not a private one — see the security
 *  note in app/dashboard/profile/actions.js.
 *
 *  Getting this wrong here would be much worse than on the profile page: an
 *  unprotected saveNotes would let anyone write into a patient's medical record.
 * ============================================================================
 */

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { query, queryOne } from '@/lib/db'
import { consultationNoteSchema, validate } from '@/lib/validation'
import { formatMoney } from '@/lib/utils'
import { sendWhatsAppInBackground } from '@/lib/whatsapp'
import { clinicUrl } from '@/config/platform'

/**
 * Throws unless the caller is staff OF THIS CLINIC.
 *
 * ---------------------------------------------------------------------------
 * THE MISTAKE THIS FIXES IS WORTH UNDERSTANDING
 * ---------------------------------------------------------------------------
 * The first version of this guard checked only the ROLE:
 *
 *     if (!['admin', 'physio'].includes(session.user.role)) throw …
 *
 * Which reads like a real authorisation check, and is not one. Session cookies
 * are shared across the whole parent domain so that signup and Google login can
 * work, which means a physiotherapist at clinic A arrives here holding a valid
 * session on clinic B's hostname. Role alone said "yes, staff" — and the writes
 * below were keyed on an id from the form body with no clinic in the WHERE
 * clause. Clinic A's staff could mark clinic B's appointments complete and write
 * into clinic B's patients' medical records.
 *
 * Two things had to be true, and only one was checked. The clinic comes from the
 * HOSTNAME and the role from the SESSION, and both must agree.
 */
async function requireStaff() {
  const clinic = await getCurrentClinic()
  if (!clinic) throw new Error('NO_CLINIC')

  const session = await auth()
  if (!session?.user) throw new Error('UNAUTHENTICATED')
  if (!['admin', 'physio'].includes(session.user.role)) throw new Error('FORBIDDEN')
  if (Number(session.user.clinicId) !== Number(clinic.id)) throw new Error('FORBIDDEN')

  return { user: session.user, clinic }
}

/* ========================================================================== */
/*  SAVE THE SOAP NOTE                                                        */
/* ========================================================================== */

export async function saveConsultationNote(previousState, formData) {
  let user, clinic
  try {
    ;({ user, clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  /**
   * The exercise list arrives as flat, indexed form fields, because HTML forms have
   * no concept of an array of objects:
   *
   *     exercise-0-name, exercise-0-sets, exercise-0-reps, …
   *     exercise-1-name, …
   *
   * We walk the indices and rebuild the array. Rows with no name are skipped, so a
   * physiotherapist can leave blank rows in the form without creating empty
   * exercises in the patient's plan.
   */
  const exercises = []
  for (let index = 0; index < 20; index++) {
    const name = String(formData.get(`exercise-${index}-name`) || '').trim()
    if (!name) continue
    exercises.push({
      name,
      sets: String(formData.get(`exercise-${index}-sets`) || '').trim(),
      reps: String(formData.get(`exercise-${index}-reps`) || '').trim(),
      frequency: String(formData.get(`exercise-${index}-frequency`) || '').trim(),
      notes: String(formData.get(`exercise-${index}-notes`) || '').trim(),
    })
  }

  const result = validate(consultationNoteSchema, {
    appointmentId: formData.get('appointmentId'),
    subjective: formData.get('subjective'),
    objective: formData.get('objective'),
    assessment: formData.get('assessment'),
    plan: formData.get('plan'),
    painLevelBefore: formData.get('painLevelBefore'),
    painLevelAfter: formData.get('painLevelAfter'),
    followUpDate: formData.get('followUpDate'),
    sessionsRecommended: formData.get('sessionsRecommended'),
    exercises,
  })

  if (!result.ok) {
    return { ok: false, errors: result.errors, error: 'Please check the highlighted fields.' }
  }

  const data = result.data

  try {
    // `AND clinic_id = ?` is the load-bearing half. data.appointmentId came from
    // the form, so without it any staff member could name any appointment in the
    // database.
    const appointment = await queryOne(
      `SELECT a.id, a.patient_id, a.status, u.name AS patient_name
         FROM appointments a JOIN users u ON u.id = a.patient_id
        WHERE a.id = ? AND a.clinic_id = ?`,
      [data.appointmentId, clinic.id]
    )
    if (!appointment) return { ok: false, error: 'That appointment no longer exists.' }

    /**
     * One note per appointment, enforced by a UNIQUE index on appointment_id — so
     * this is an upsert rather than an insert. A physiotherapist editing a note she
     * wrote an hour ago must update it, not create a second one; two conflicting
     * notes on one session is a genuine clinical hazard.
     */
    await query(
      `INSERT INTO consultation_notes
         (clinic_id, appointment_id, physio_id, subjective, objective, assessment, plan,
          exercises_prescribed, pain_level_before, pain_level_after,
          follow_up_date, sessions_recommended)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         subjective = VALUES(subjective),
         objective = VALUES(objective),
         assessment = VALUES(assessment),
         plan = VALUES(plan),
         exercises_prescribed = VALUES(exercises_prescribed),
         pain_level_before = VALUES(pain_level_before),
         pain_level_after = VALUES(pain_level_after),
         follow_up_date = VALUES(follow_up_date),
         sessions_recommended = VALUES(sessions_recommended)`,
      [
        // clinic_id is NOT NULL with no default, and leaving it out of this list
        // did not fail quietly — it made EVERY note save fail with
        // ER_NO_DEFAULT_FOR_FIELD. Writing up a session is the core of a
        // physiotherapist's day, and it had never once worked.
        clinic.id,
        data.appointmentId,
        user.id,
        blank(data.subjective),
        blank(data.objective),
        blank(data.assessment),
        blank(data.plan),
        // The JSON column needs a JSON string. MySQL validates it on the way in and
        // rejects anything malformed, and mysql2 parses it back into a real array
        // when we read it.
        exercises.length > 0 ? JSON.stringify(exercises) : null,
        blank(data.painLevelBefore),
        blank(data.painLevelAfter),
        blank(data.followUpDate),
        blank(data.sessionsRecommended),
      ]
    )

    // Writing up the notes is the natural moment the session becomes "done", so
    // mark it complete if it has not been already. Saves a second click on every
    // single appointment.
    if (appointment.status === 'confirmed' || appointment.status === 'in_progress') {
      await query(`UPDATE appointments SET status = 'completed' WHERE id = ? AND clinic_id = ?`, [
        data.appointmentId,
        clinic.id,
      ])
    }

    /**
     * Send the home exercise programme to their phone.
     *
     * This is the moment it matters. The physiotherapist has just written the
     * exercises down, the patient is walking to their car, and the programme is
     * fresh in both their minds. A day later it is a page in a portal nobody
     * opens — which is exactly what it was before.
     *
     * Only when there ARE exercises: a note without any is a clinical record, not
     * something to message somebody about.
     */
    if (exercises.length > 0 && clinic.wa_send_exercises) {
      sendWhatsAppInBackground({
        clinic,
        patientId: appointment.patient_id,
        template: 'exercise_programme',
        appointmentId: appointment.id,
        values: {
          patientName: appointment.patient_name,
          exercises,
          frequency: exercises[0]?.frequency || 'daily',
          url: clinicUrl(clinic.slug, '/dashboard/exercises'),
        },
      })

      await query('UPDATE consultation_notes SET wa_exercises_sent_at = NOW() WHERE appointment_id = ?', [
        data.appointmentId,
      ])
    }

    // Refresh both sides: the admin view AND the patient's own pages, so the
    // exercises appear in their dashboard immediately.
    revalidatePath(`/admin/appointments/${data.appointmentId}`)
    revalidatePath('/admin/appointments')
    revalidatePath('/admin')
    revalidatePath(`/dashboard/appointments/${data.appointmentId}`)
    revalidatePath('/dashboard/exercises')
    revalidatePath('/dashboard')

    return {
      ok: true,
      message: `Notes saved${exercises.length ? ` with ${exercises.length} exercise${exercises.length === 1 ? '' : 's'}` : ''}. The patient can see them now.`,
    }
  } catch (error) {
    console.error('[saveConsultationNote] error:', error)
    return { ok: false, error: 'Could not save the notes. Please try again.' }
  }
}

/* ========================================================================== */
/*  CHANGE THE APPOINTMENT STATUS                                             */
/* ========================================================================== */

/**
 * Used for "mark as completed" and "mark as no-show".
 *
 * Cancellation is deliberately NOT handled here — it goes through
 * /api/appointments/[id]/cancel, because it also has to issue a refund. Two paths
 * that both cancel would eventually disagree with each other about the money.
 */
export async function updateAppointmentStatus(appointmentId, status) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  // An allow-list, not a blocklist. `status` arrives from the browser, and without
  // this a caller could set it to anything the ENUM accepts — including
  // 'confirmed' on an unpaid appointment.
  const allowed = ['confirmed', 'in_progress', 'completed', 'no_show']
  if (!allowed.includes(status)) {
    return { ok: false, error: 'That is not a status we recognise.' }
  }

  try {
    /**
     * A no-show has to cost something, or it costs the clinic everything.
     *
     * 15–25% of physiotherapy appointments are no-shows, and each one is a
     * half-hour the clinic has already paid a therapist for. Until now the status
     * was recorded and nothing else happened.
     *
     * Three things follow, and none of them moves money by itself — software that
     * claimed to have taken cash from somebody who is not there would be lying:
     *
     *   · The fee is STAMPED on the appointment, from the clinic's policy at this
     *     moment. A fee changed next year must not alter what somebody owed today.
     *   · A package session is FORFEITED, because the therapist's time was spent
     *     whether or not the patient arrived. Without this the session silently
     *     returns to their balance.
     *   · A payment already taken is simply kept. No refund is due for not turning
     *     up, and that was already the behaviour.
     */
    const appointment = await queryOne(
      `SELECT id, patient_package_id, status FROM appointments
        WHERE id = ? AND clinic_id = ?`,
      [appointmentId, clinic.id]
    )
    if (!appointment) return { ok: false, error: 'That appointment could not be found.' }

    const isNoShow = status === 'no_show'
    const fee = isNoShow ? Number(clinic.no_show_fee_paise) || 0 : 0
    const forfeit =
      isNoShow && appointment.patient_package_id && clinic.late_cancel_forfeits_session ? 1 : 0

    const result = await query(
      `UPDATE appointments
          SET status = ?, no_show_fee_paise = ?, package_session_forfeited = ?
        WHERE id = ? AND clinic_id = ?`,
      [status, fee, forfeit, appointmentId, clinic.id]
    )

    // Nothing matched means the id belongs to another clinic (or nothing at all).
    // Saying so plainly beats reporting a success that did not happen.
    if (result.affectedRows === 0) {
      return { ok: false, error: 'That appointment could not be found.' }
    }

    revalidatePath(`/admin/appointments/${appointmentId}`)
    revalidatePath('/admin/appointments')
    revalidatePath('/admin')
    revalidatePath(`/dashboard/appointments/${appointmentId}`)

    if (isNoShow) {
      const parts = []
      if (fee > 0) parts.push(`${formatMoney(fee)} is owed`)
      if (forfeit) parts.push('the package session has been used')
      return {
        ok: true,
        message: parts.length
          ? `Marked as no show — ${parts.join(', and ')}.`
          : 'Marked as no show.',
      }
    }

    return { ok: true, message: `Marked as ${status.replace('_', ' ')}.` }
  } catch (error) {
    console.error('[updateAppointmentStatus] error:', error)
    return { ok: false, error: 'Could not update the appointment.' }
  }
}

function blank(value) {
  return value === '' || value === undefined ? null : value
}
