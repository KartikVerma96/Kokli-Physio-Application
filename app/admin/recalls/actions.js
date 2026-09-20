'use server'

/**
 * ============================================================================
 *  SERVER ACTIONS — recall
 * ============================================================================
 *  One action: record that somebody has been contacted.
 *
 *  Without it the recall list shows the same twelve names every morning, and a
 *  list that does not change is a list that stops being read. That is not a
 *  cosmetic problem — it is the difference between a feature that earns money and
 *  one that gets ignored after a fortnight.
 * ============================================================================
 */

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { query, queryOne } from '@/lib/db'

async function requireStaff() {
  const clinic = await getCurrentClinic()
  if (!clinic) throw new Error('NO_CLINIC')

  const session = await auth()
  if (!session?.user) throw new Error('UNAUTHENTICATED')
  if (!['admin', 'physio'].includes(session.user.role)) throw new Error('FORBIDDEN')
  if (Number(session.user.clinicId) !== Number(clinic.id)) throw new Error('FORBIDDEN')

  return { user: session.user, clinic }
}

/**
 * Mark a patient as contacted, with an optional note.
 *
 * Stamps `patient_profiles.last_recall_at`. The patient stays on the list — they
 * genuinely have not come back yet — but sorted and labelled as already called, so
 * nobody rings them twice in a morning.
 */
export async function markContacted(input = {}) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  const patientId = Number(input.patientId)
  const note = String(input.note || '').trim().slice(0, 300)

  // patientId came from a form, so prove it is this clinic's patient first.
  const patient = await queryOne(
    `SELECT id, name FROM users WHERE id = ? AND clinic_id = ? AND role = 'patient'`,
    [patientId, clinic.id]
  )
  if (!patient) return { ok: false, error: 'That patient could not be found.' }

  try {
    /**
     * An upsert, because a patient created at the reception desk may have no
     * profile row yet — a plain UPDATE would silently affect nothing and the
     * button would appear to do nothing at all.
     */
    await query(
      `INSERT INTO patient_profiles (user_id, last_recall_at, recall_note)
       VALUES (?, NOW(), ?)
       ON DUPLICATE KEY UPDATE last_recall_at = NOW(), recall_note = VALUES(recall_note)`,
      [patientId, note || null]
    )

    revalidatePath('/admin/recalls')
    revalidatePath(`/admin/patients/${patientId}`)

    return { ok: true, message: `${patient.name} marked as contacted.` }
  } catch (error) {
    console.error('[markContacted]', error)
    return { ok: false, error: 'Could not save that.' }
  }
}
