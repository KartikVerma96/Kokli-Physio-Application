'use server'

/**
 * ============================================================================
 *  SERVER ACTIONS — working hours and leave
 * ============================================================================
 *  These control which slots patients can book, so they matter more than they look.
 *  Deleting a rule does not touch appointments already booked into it — those
 *  remain, and rightly so. It only stops NEW bookings.
 * ============================================================================
 */

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { query } from '@/lib/db'
import { getDefaultPhysioId } from '@/lib/slots'
import { availabilityRuleSchema, timeOffSchema, validate } from '@/lib/validation'

/**
 * Throws unless the caller is staff OF THIS CLINIC.
 *
 * The clinic comes from the hostname, the role from the session, and both must
 * agree — see the long note in app/admin/appointments/[id]/actions.js.
 */
async function requireStaff() {
  const clinic = await requireCurrentClinic()

  const session = await auth()
  if (!session?.user) throw new Error('UNAUTHENTICATED')
  if (!['admin', 'physio'].includes(session.user.role)) throw new Error('FORBIDDEN')
  if (Number(session.user.clinicId) !== Number(clinic.id)) throw new Error('FORBIDDEN')

  return { user: session.user, clinic }
}

// Every action revalidates the booking page too, so a change to the working week
// is reflected in what patients can book straight away.
function refresh() {
  revalidatePath('/admin/availability')
  revalidatePath('/book')
  revalidatePath('/')
}

/* ========================================================================== */
/*  WEEKLY RULES                                                              */
/* ========================================================================== */

export async function addAvailabilityRule(previousState, formData) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  const result = validate(availabilityRuleSchema, {
    weekday: formData.get('weekday'),
    startTime: formData.get('startTime'),
    endTime: formData.get('endTime'),
    slotMinutes: formData.get('slotMinutes'),
    mode: formData.get('mode'),
  })

  if (!result.ok) {
    return { ok: false, errors: result.errors, error: 'Please check the times you entered.' }
  }

  const { weekday, startTime, endTime, slotMinutes, mode, capacity } = result.data

  try {
    const physioId = await getDefaultPhysioId(clinic.id)
    if (!physioId) return { ok: false, error: 'No physiotherapist account found.' }

    /**
     * Overlapping windows on the same day are allowed on purpose.
     *
     * The slot engine deduplicates identical start times, so two overlapping rules
     * cannot produce a double-booked slot — and being able to add "Tuesday 9–1" and
     * later "Tuesday 12–4" without first editing the original is genuinely more
     * convenient than being told off for it.
     */
    await query(
      `INSERT INTO availability_rules (clinic_id, physio_id, weekday, start_time, end_time, slot_minutes, capacity, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [clinic.id, physioId, weekday, normaliseTime(startTime), normaliseTime(endTime), slotMinutes,
       capacity || 1, mode]
    )

    refresh()
    return { ok: true, message: 'Working hours added.' }
  } catch (error) {
    console.error('[addAvailabilityRule] error:', error)
    return { ok: false, error: 'Could not add those hours.' }
  }
}

export async function deleteAvailabilityRule(ruleId) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  try {
    const physioId = await getDefaultPhysioId(clinic.id)
    // The physio_id condition scopes the delete to this clinic's own rules — it
    // means a crafted id cannot reach another physiotherapist's diary if the app
    // ever grows to more than one.
    // Three placeholders need three parameters. The clinic id was missing from
    // this list, so mysql2 rejected the statement and removing a set of working
    // hours failed every time it was tried.
    await query('DELETE FROM availability_rules WHERE id = ? AND clinic_id = ? AND physio_id = ?', [
      ruleId,
      clinic.id,
      physioId,
    ])

    refresh()
    return { ok: true, message: 'Those hours have been removed. Existing bookings are unaffected.' }
  } catch (error) {
    console.error('[deleteAvailabilityRule] error:', error)
    return { ok: false, error: 'Could not remove those hours.' }
  }
}

export async function toggleAvailabilityRule(ruleId, isActive) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  try {
    const physioId = await getDefaultPhysioId(clinic.id)
    await query(
      'UPDATE availability_rules SET is_active = ? WHERE id = ? AND clinic_id = ? AND physio_id = ?',
      [isActive ? 1 : 0, ruleId, clinic.id, physioId]
    )

    refresh()
    return { ok: true, message: isActive ? 'Hours switched on.' : 'Hours switched off.' }
  } catch (error) {
    console.error('[toggleAvailabilityRule] error:', error)
    return { ok: false, error: 'Could not update those hours.' }
  }
}

/* ========================================================================== */
/*  TIME OFF                                                                  */
/* ========================================================================== */

export async function addTimeOff(previousState, formData) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  const result = validate(timeOffSchema, {
    offDate: formData.get('offDate'),
    startTime: formData.get('startTime'),
    endTime: formData.get('endTime'),
    reason: formData.get('reason'),
  })

  if (!result.ok) {
    return { ok: false, errors: result.errors, error: 'Please check the dates you entered.' }
  }

  const { offDate, startTime, endTime, reason } = result.data

  try {
    const physioId = await getDefaultPhysioId(clinic.id)
    if (!physioId) return { ok: false, error: 'No physiotherapist account found.' }

    /**
     * Warn about appointments already booked in the period being blocked.
     *
     * We do NOT cancel them automatically. Cancelling somebody's paid physiotherapy
     * appointment as a side effect of adding a holiday would be a genuinely bad
     * surprise — the clinic needs to ring them and agree a new time. So we block
     * further bookings and tell the staff member who they need to call.
     */
    const clashes = await query(
      `SELECT a.id, a.code, u.name AS patient_name, a.start_time
         FROM appointments a
         JOIN users u ON u.id = a.patient_id
        WHERE a.physio_id = ?
          AND a.appointment_date = ?
          AND a.status IN ('confirmed', 'pending_payment', 'in_progress')
          ${startTime && endTime ? 'AND a.start_time < ? AND a.end_time > ?' : ''}`,
      startTime && endTime
        ? [clinic.id, physioId, offDate, normaliseTime(endTime), normaliseTime(startTime)]
        : [clinic.id, physioId, offDate]
    )

    await query(
      `INSERT INTO time_off (clinic_id, physio_id, off_date, start_time, end_time, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [
        physioId,
        offDate,
        startTime ? normaliseTime(startTime) : null,
        endTime ? normaliseTime(endTime) : null,
        reason || null,
      ]
    )

    refresh()

    return {
      ok: true,
      message:
        clashes.length > 0
          ? `Time off added. IMPORTANT: ${clashes.length} appointment${clashes.length === 1 ? '' : 's'} already booked in this period — ${clashes.map((c) => `${c.patient_name} (${c.code})`).join(', ')}. Please contact them to rearrange; they have NOT been cancelled.`
          : 'Time off added. Those slots are no longer bookable.',
      clashes: clashes.length,
    }
  } catch (error) {
    console.error('[addTimeOff] error:', error)
    return { ok: false, error: 'Could not add that time off.' }
  }
}

export async function deleteTimeOff(timeOffId) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  try {
    const physioId = await getDefaultPhysioId(clinic.id)
    await query('DELETE FROM time_off WHERE id = ? AND clinic_id = ? AND physio_id = ?', [
      timeOffId,
      clinic.id,
      physioId,
    ])

    refresh()
    return { ok: true, message: 'Time off removed — those slots are bookable again.' }
  } catch (error) {
    console.error('[deleteTimeOff] error:', error)
    return { ok: false, error: 'Could not remove that time off.' }
  }
}

/** MySQL TIME columns want HH:MM:SS; the browser's time input gives HH:MM. */
function normaliseTime(time) {
  return String(time).length === 5 ? `${time}:00` : String(time)
}
