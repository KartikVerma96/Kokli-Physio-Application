'use server'

/**
 * ============================================================================
 *  SERVER ACTIONS — selling a package, and taking the money for it
 * ============================================================================
 *
 *  This is where a course of treatment is actually sold, and it is the first
 *  place in the application where money is recorded that did NOT come through a
 *  payment gateway.
 *
 *  THE TWO RULES FOR OFFLINE MONEY
 *  -------------------------------
 *  1. The AMOUNT comes from the database, never the form. Exactly the same rule
 *     as the online path: the browser names a package, and the price is looked up.
 *     A form that could name its own price would eventually name ₹1.
 *
 *  2. WHO TOOK IT comes from the session, never the form. An online payment
 *     carries a signature only Razorpay could produce; a cash note carries
 *     nothing, so the identity of the person who recorded it is the only thing
 *     making the day's takings reconcilable.
 *
 *  A discount IS allowed — clinics give them, and pretending otherwise just means
 *  staff work around the software. But it is recorded as a discount against the
 *  package's real price rather than by rewriting the price, so the books show what
 *  happened.
 * ============================================================================
 */

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { query, queryOne, transaction } from '@/lib/db'
import { recordDeskPayment, isDeskMethod, deskMethodLabel } from '@/lib/deskPayments'
import { refreshPackageStatus } from '@/lib/packages'
import { formatMoney, toPaise } from '@/lib/utils'

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
/*  SELL A PACKAGE                                                            */
/* ========================================================================== */

export async function sellPackage(input = {}) {
  let user, clinic
  try {
    ;({ user, clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  const patientId = Number(input.patientId)
  const packageId = Number(input.packageId)
  const method = String(input.method || '')
  const reference = String(input.reference || '').trim()
  const discountRupees = Number(input.discountRupees) || 0
  const notes = String(input.notes || '').trim()

  if (!packageId) return { ok: false, errors: { packageId: 'Choose a package' } }
  if (!isDeskMethod(method)) {
    return { ok: false, errors: { method: 'Choose how the patient paid' } }
  }

  // Both ids arrive from the form, so both are proved to belong to this clinic
  // before anything is written.
  const patient = await queryOne(
    `SELECT id, name FROM users WHERE id = ? AND clinic_id = ? AND role = 'patient'`,
    [patientId, clinic.id]
  )
  if (!patient) return { ok: false, error: 'That patient could not be found.' }

  const pkg = await queryOne(
    'SELECT * FROM packages WHERE id = ? AND clinic_id = ? AND is_active = 1',
    [packageId, clinic.id]
  )
  if (!pkg) return { ok: false, error: 'That package is not available.' }

  const discountPaise = Math.max(0, Math.min(toPaise(discountRupees), Number(pkg.price_paise)))
  const chargedPaise = Number(pkg.price_paise) - discountPaise

  try {
    let created
    await transaction(async (tx) => {
      /**
       * The name, session count and price are COPIED onto the purchase.
       *
       * The package row is a price list and will change. This row is a receipt and
       * must not: a patient part-way through ten sessions keeps ten sessions even
       * if the clinic reduces the offering to eight tomorrow.
       */
      const [result] = await tx.execute(
        `INSERT INTO patient_packages
           (clinic_id, patient_id, package_id, name, service_id, sessions_total,
            price_paise, expires_at, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ${
           Number(pkg.validity_days) > 0 ? 'DATE_ADD(CURDATE(), INTERVAL ? DAY)' : 'NULL'
         }, 'active', ?)`,
        Number(pkg.validity_days) > 0
          ? [
              clinic.id, patientId, pkg.id, pkg.name, pkg.service_id, pkg.sessions_count,
              chargedPaise, pkg.validity_days, notes || null,
            ]
          : [
              clinic.id, patientId, pkg.id, pkg.name, pkg.service_id, pkg.sessions_count,
              chargedPaise, notes || null,
            ]
      )
      created = result.insertId

      await recordDeskPayment(tx, {
        clinicId: clinic.id,
        patientPackageId: created,
        amountPaise: chargedPaise,
        method,
        collectedBy: user.id,
        reference,
      })
    })

    revalidatePath(`/admin/patients/${patientId}`)
    revalidatePath('/admin/payments')
    revalidatePath('/admin/packages')
    revalidatePath('/admin')
    revalidatePath('/dashboard')

    return {
      ok: true,
      message: `${pkg.sessions_count} sessions added for ${patient.name} — ${formatMoney(
        chargedPaise
      )} by ${deskMethodLabel(method).toLowerCase()}${
        discountPaise > 0 ? ` after a ${formatMoney(discountPaise)} discount` : ''
      }.`,
    }
  } catch (error) {
    console.error('[sellPackage]', error)
    return { ok: false, error: 'Could not record that sale.' }
  }
}

/* ========================================================================== */
/*  CANCEL A PACKAGE                                                          */
/* ========================================================================== */

/**
 * Mark a purchased package cancelled or refunded.
 *
 * Deliberately does NOT move any money — refunding cash means opening the drawer,
 * and software that claimed to have done it would be lying. What this does is stop
 * further sessions being drawn and leave an honest record of why.
 *
 * Sessions already used stay used. The appointments happened.
 */
export async function closePatientPackage(patientPackageId, status) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  if (!['cancelled', 'refunded'].includes(status)) {
    return { ok: false, error: 'That is not a status we recognise.' }
  }

  try {
    const pkg = await queryOne(
      'SELECT id, patient_id, name FROM patient_packages WHERE id = ? AND clinic_id = ?',
      [patientPackageId, clinic.id]
    )
    if (!pkg) return { ok: false, error: 'That package could not be found.' }

    await query('UPDATE patient_packages SET status = ? WHERE id = ? AND clinic_id = ?', [
      status,
      patientPackageId,
      clinic.id,
    ])

    revalidatePath(`/admin/patients/${pkg.patient_id}`)
    revalidatePath('/dashboard')

    return {
      ok: true,
      message:
        status === 'refunded'
          ? `${pkg.name} marked refunded. Remember to return the money — this only updates the record.`
          : `${pkg.name} cancelled. No further sessions can be booked against it.`,
    }
  } catch (error) {
    console.error('[closePatientPackage]', error)
    return { ok: false, error: 'Could not update that package.' }
  }
}

/* ========================================================================== */
/*  TAKE PAYMENT FOR A SINGLE APPOINTMENT                                     */
/* ========================================================================== */

/**
 * Record cash, UPI or card taken at the desk for one appointment.
 *
 * This is the other half of what was missing. A patient who walked in, was
 * treated, and paid ₹800 on the way out previously could not be represented at
 * all — so the clinic's own revenue figure showed only the online minority.
 */
export async function recordAppointmentPayment(input = {}) {
  let user, clinic
  try {
    ;({ user, clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  const appointmentId = Number(input.appointmentId)
  const method = String(input.method || '')
  const reference = String(input.reference || '').trim()

  if (!isDeskMethod(method)) {
    return { ok: false, errors: { method: 'Choose how the patient paid' } }
  }

  const appointment = await queryOne(
    `SELECT id, code, amount_paise, status, patient_package_id
       FROM appointments WHERE id = ? AND clinic_id = ?`,
    [appointmentId, clinic.id]
  )
  if (!appointment) return { ok: false, error: 'That appointment could not be found.' }

  if (appointment.patient_package_id) {
    return {
      ok: false,
      error: 'This session came out of a package, so there is nothing to collect.',
    }
  }

  // Already settled? Say so rather than taking the money twice.
  const existing = await queryOne(
    `SELECT id FROM payments
      WHERE clinic_id = ? AND appointment_id = ? AND status = 'paid'`,
    [clinic.id, appointmentId]
  )
  if (existing) return { ok: false, error: 'This appointment has already been paid for.' }

  try {
    await transaction(async (tx) => {
      await recordDeskPayment(tx, {
        clinicId: clinic.id,
        appointmentId,
        // From the appointment row, which copied it from the service at booking.
        amountPaise: appointment.amount_paise,
        method,
        collectedBy: user.id,
        reference,
      })

      // Paying is what turns a held slot into a real booking, exactly as the
      // online path does.
      if (appointment.status === 'pending_payment') {
        await tx.execute(
          `UPDATE appointments SET status = 'confirmed', hold_expires_at = NULL
            WHERE id = ? AND clinic_id = ?`,
          [appointmentId, clinic.id]
        )
      }
    })

    revalidatePath(`/admin/appointments/${appointmentId}`)
    revalidatePath('/admin/appointments')
    revalidatePath('/admin/payments')
    revalidatePath('/admin')

    return {
      ok: true,
      message: `${formatMoney(appointment.amount_paise)} recorded by ${deskMethodLabel(
        method
      ).toLowerCase()} for ${appointment.code}.`,
    }
  } catch (error) {
    console.error('[recordAppointmentPayment]', error)
    return { ok: false, error: 'Could not record that payment.' }
  }
}
