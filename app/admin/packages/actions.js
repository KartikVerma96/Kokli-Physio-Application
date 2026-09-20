'use server'

/**
 * ============================================================================
 *  SERVER ACTIONS — the packages a clinic sells
 * ============================================================================
 *  A package is a product: "10 sessions of Sports Injury Rehab, ₹6,000, valid 90
 *  days". Selling one to a patient is a different action, on the patient record —
 *  see app/admin/patients/[id]/actions.js.
 * ============================================================================
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { query, queryOne } from '@/lib/db'
import { validate } from '@/lib/validation'
import { toPaise } from '@/lib/utils'

/**
 * Throws unless the caller is staff OF THIS CLINIC.
 *
 * The clinic comes from the hostname, the role from the session, and both must
 * agree — see the long note in app/admin/appointments/[id]/actions.js for what
 * goes wrong when only the role is checked.
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

const packageSchema = z.object({
  name: z.string().trim().min(3, 'Give the package a name').max(120),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  // '' means "any treatment", which is a real and useful option rather than a
  // missing value — a general block of sessions.
  serviceId: z.union([z.coerce.number().int().positive(), z.literal('')]).optional(),
  sessionsCount: z.coerce
    .number()
    .int()
    .min(2, 'A package is at least 2 sessions — one session is just an appointment')
    .max(200),
  priceRupees: z.coerce.number().min(0).max(1_000_000),
  validityDays: z.coerce.number().int().min(0).max(730),
  isActive: z.coerce.boolean().optional(),
})

function refresh() {
  revalidatePath('/admin/packages')
  revalidatePath('/admin/patients')
  revalidatePath('/book')
}

/* ========================================================================== */
/*  CREATE / UPDATE                                                           */
/* ========================================================================== */

/**
 * @param {object} input  plain values, not a FormData.
 *
 * These actions are called from an onSubmit handler rather than used as a
 * `<form action={…}>`, so FormData bought nothing here — the browser had already
 * run JavaScript by the time it was built. A plain object is easier to read, and
 * it means the action can be exercised over HTTP by tests/revenue.mjs. Server
 * actions ARE public endpoints; being able to call them like one is a feature.
 */
export async function savePackage(input = {}) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  const packageId = input.packageId || null

  const result = validate(packageSchema, {
    name: input.name,
    description: input.description,
    serviceId: input.serviceId,
    sessionsCount: input.sessionsCount,
    priceRupees: input.priceRupees,
    validityDays: input.validityDays,
    isActive: Boolean(input.isActive),
  })

  if (!result.ok) {
    return { ok: false, errors: result.errors, error: 'Please check the highlighted fields.' }
  }

  const data = result.data
  const serviceId = data.serviceId === '' || !data.serviceId ? null : Number(data.serviceId)

  // A service id from a form must be proved to belong to this clinic before it is
  // written, or a package could be attached to another clinic's treatment.
  if (serviceId) {
    const owned = await queryOne('SELECT id FROM services WHERE id = ? AND clinic_id = ?', [
      serviceId,
      clinic.id,
    ])
    if (!owned) {
      return { ok: false, errors: { serviceId: 'That treatment could not be found.' } }
    }
  }

  const values = [
    data.name,
    data.description || null,
    serviceId,
    data.sessionsCount,
    toPaise(data.priceRupees),
    data.validityDays,
    data.isActive ? 1 : 0,
  ]

  try {
    if (packageId) {
      /**
       * Editing changes what is OFFERED, never what somebody already bought.
       *
       * patient_packages copies the name, session count and price at the moment of
       * sale precisely so this edit cannot reach backwards into a patient's
       * purchase. Changing "10 sessions" to "8 sessions" here must not quietly
       * remove two sessions from every patient mid-course.
       */
      const updated = await query(
        `UPDATE packages
            SET name = ?, description = ?, service_id = ?, sessions_count = ?,
                price_paise = ?, validity_days = ?, is_active = ?
          WHERE id = ? AND clinic_id = ?`,
        [...values, packageId, clinic.id]
      )
      if (updated.affectedRows === 0) {
        return { ok: false, error: 'That package could not be found.' }
      }
    } else {
      const last = await queryOne(
        'SELECT MAX(sort_order) AS max_order FROM packages WHERE clinic_id = ?',
        [clinic.id]
      )
      await query(
        `INSERT INTO packages
           (clinic_id, name, description, service_id, sessions_count, price_paise,
            validity_days, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [clinic.id, ...values, (Number(last?.max_order) || 0) + 1]
      )
    }

    refresh()
    return {
      ok: true,
      message: packageId
        ? 'Package updated. Patients who already bought it keep what they paid for.'
        : 'Package added. You can now sell it from any patient’s record.',
    }
  } catch (error) {
    console.error('[savePackage]', error)
    return { ok: false, error: 'Could not save that package.' }
  }
}

/* ========================================================================== */
/*  RETIRE / RESTORE                                                          */
/* ========================================================================== */

/**
 * Stop offering a package without touching anybody on one.
 *
 * There is no delete. patient_packages references this row so a patient's receipt
 * can always say what they bought, and a course of treatment somebody is halfway
 * through must not be able to vanish because the price list was tidied up.
 */
export async function togglePackage(packageId, isActive) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  try {
    const pkg = await queryOne('SELECT name FROM packages WHERE id = ? AND clinic_id = ?', [
      packageId,
      clinic.id,
    ])
    if (!pkg) return { ok: false, error: 'That package could not be found.' }

    await query('UPDATE packages SET is_active = ? WHERE id = ? AND clinic_id = ?', [
      isActive ? 1 : 0,
      packageId,
      clinic.id,
    ])

    // How many people are mid-course on it, so the message can say so.
    const live = await queryOne(
      `SELECT COUNT(*) AS n FROM patient_packages
        WHERE package_id = ? AND clinic_id = ? AND status = 'active'`,
      [packageId, clinic.id]
    )
    const count = Number(live?.n ?? 0)

    refresh()
    return {
      ok: true,
      message: isActive
        ? `${pkg.name} is on sale again.`
        : count > 0
          ? `${pkg.name} is no longer offered. The ${count} patient${count === 1 ? '' : 's'} part-way through keep every session they paid for.`
          : `${pkg.name} is no longer offered.`,
    }
  } catch (error) {
    console.error('[togglePackage]', error)
    return { ok: false, error: 'Could not update that package.' }
  }
}
