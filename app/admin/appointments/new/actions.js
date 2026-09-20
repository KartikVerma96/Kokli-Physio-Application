'use server'

/**
 * ============================================================================
 *  SERVER ACTIONS — booking a patient from the reception desk
 * ============================================================================
 *
 *  WHY THIS EXISTS
 *  ---------------
 *  Until now the only way an appointment could be created was by a signed-in
 *  patient, paying online, within fifteen minutes. /api/appointments explicitly
 *  refuses anybody who is not a patient.
 *
 *  That is not how a physiotherapy clinic works. Most patients telephone, or walk
 *  in off the street with a doctor's referral in hand. Reception writes them in
 *  the book and they pay cash on the way out. With no way to represent that, the
 *  clinic keeps its real diary on paper and the software becomes a website with a
 *  booking form attached — which is exactly the outcome to avoid.
 *
 *  WHAT A DESK BOOKING DOES DIFFERENTLY
 *  ------------------------------------
 *    · It is CONFIRMED immediately. A booking reception has just promised on the
 *      phone must not evaporate because no card was charged in fifteen minutes.
 *    · It can be paid three ways: now at the desk, later on the way out, or from
 *      a package the patient already bought.
 *    · It can create the patient. A walk-in has no account, and demanding they
 *      register with an email address before they can be treated is absurd.
 *
 *  The slot itself is booked through exactly the same holdSlot() as the online
 *  path, so the transaction, the row lock and the unique index that stop
 *  double-booking all apply identically. There is one booking engine, not two.
 * ============================================================================
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { query, queryOne, transaction, isDuplicateError } from '@/lib/db'
import { holdSlot, getDefaultPhysioId } from '@/lib/slots'
import { recordDeskPayment, isDeskMethod, deskMethodLabel } from '@/lib/deskPayments'
import { refreshPackageStatus, usablePackages } from '@/lib/packages'
import { generateAppointmentCode, generateRoomId, formatMoney } from '@/lib/utils'

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
/*  CREATE A PATIENT AT THE DESK                                              */
/* ========================================================================== */

const newPatientSchema = z.object({
  name: z.string().trim().min(2, 'Enter their name').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a phone number'),
  email: z.string().trim().email('That is not a valid email').optional().or(z.literal('')),
})

/**
 * Register a walk-in.
 *
 * THE EMAIL PROBLEM, AND WHY THE ANSWER IS A PLACEHOLDER
 * -----------------------------------------------------
 * `users.email` is NOT NULL and globally unique — it is the login identifier. A
 * seventy-year-old who has walked in with a knee problem may not have an email
 * address, and will certainly not invent one at a reception desk.
 *
 * So when no email is given, one is derived from the phone number:
 *
 *     p919812345678@aarogya.invalid
 *
 * `.invalid` is reserved by RFC 2606 precisely for this — it can never be a real
 * domain, so nothing can ever accidentally send mail to it. Deriving it from the
 * phone rather than randomly means the same patient walking in a second time
 * collides with their own existing record instead of creating a duplicate, which
 * is the behaviour you want: one patient, one file.
 *
 * They have no password, so they cannot sign in. If they later want the portal
 * they register normally with a real email, and reception merges the notes — which
 * is a manual job, and honest about being one.
 */
export async function createDeskPatient(input = {}) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  const parsed = newPatientSchema.safeParse({
    name: input.name,
    phone: input.phone,
    email: input.email,
  })

  if (!parsed.success) {
    const errors = {}
    for (const issue of parsed.error.issues) errors[issue.path[0]] = issue.message
    return { ok: false, errors, error: 'Please check the highlighted fields.' }
  }

  const { name, phone } = parsed.data
  const digits = phone.replace(/\D/g, '')
  const email = parsed.data.email
    ? parsed.data.email.toLowerCase()
    : `p${digits}@${clinic.slug}.invalid`

  try {
    /**
     * ------------------------------------------------------------------------
     *  IS THIS SOMEBODY WE ALREADY KNOW?
     * ------------------------------------------------------------------------
     *  Two different questions wearing one coat, and answering them the same way
     *  was a real bug:
     *
     *    SAME EMAIL  →  definitely the same person. users.email is globally
     *                   unique (see the note at the top of schema.sql), so this
     *                   is not a judgement call.
     *
     *    SAME PHONE  →  probably a FAMILY MEMBER. In India one mobile number
     *                   serves a household: a mother books physiotherapy for her
     *                   eight-year-old on her own number, a son's number is on
     *                   file for both his parents.
     *
     *  Treating a phone match as the same person meant the child's appointment
     *  was silently booked under the mother's name, and the child never got a
     *  record at all — so their clinical notes, exercises and progress ended up
     *  mixed into hers. For a clinic doing any paediatric or geriatric work that
     *  is a daily occurrence, not an edge case.
     *
     *  So a phone match now ASKS, and reception decides. Nothing is created until
     *  they do.
     */
    const sameEmail = await queryOne(
      `SELECT id, name FROM users
        WHERE clinic_id = ? AND role = 'patient' AND email = ?
        ORDER BY id LIMIT 1`,
      [clinic.id, email]
    )
    if (sameEmail) {
      return {
        ok: true,
        patientId: sameEmail.id,
        existing: true,
        message: `${sameEmail.name} is already on file — using their existing record.`,
      }
    }

    if (!input.allowSharedPhone) {
      const household = await query(
        `SELECT id, name FROM users
          WHERE clinic_id = ? AND role = 'patient' AND phone = ? AND phone <> ''
          ORDER BY id`,
        [clinic.id, phone]
      )

      if (household.length > 0) {
        /**
         * Not an error — a question. `ok: false` with `sharedPhone` lets the form
         * offer both answers, and reception picks. Calling it an error would push
         * them towards inventing a second phone number to get past it, which is
         * how a patient file ends up unreachable.
         */
        return {
          ok: false,
          sharedPhone: household.map((p) => ({ id: p.id, name: p.name })),
          error: `This number is already on file for ${household.map((p) => p.name).join(', ')}.`,
        }
      }
    }

    const patientId = await transaction(async (tx) => {
      const [result] = await tx.execute(
        `INSERT INTO users (clinic_id, name, email, phone, role, email_verified, is_active)
         VALUES (?, ?, ?, ?, 'patient', 0, 1)`,
        [clinic.id, name, email, phone]
      )
      await tx.execute('INSERT INTO patient_profiles (user_id) VALUES (?)', [result.insertId])
      return result.insertId
    })

    revalidatePath('/admin/patients')
    return { ok: true, patientId, message: `${name} added.` }
  } catch (error) {
    if (isDuplicateError(error)) {
      return {
        ok: false,
        errors: { email: 'That email is already registered on the platform.' },
        error: 'That email is already in use.',
      }
    }
    console.error('[createDeskPatient]', error)
    return { ok: false, error: 'Could not add that patient.' }
  }
}

/* ========================================================================== */
/*  BOOK IT                                                                   */
/* ========================================================================== */

export async function createDeskAppointment(input = {}) {
  let user, clinic
  try {
    ;({ user, clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  const patientId = Number(input.patientId)
  const serviceId = Number(input.serviceId)
  const date = String(input.date || '')
  const startTime = String(input.startTime || '')
  const mode = String(input.mode || 'clinic')
  const settlement = String(input.settlement || 'later')
  const method = String(input.method || '')
  const reference = String(input.reference || '').trim()
  const packageId = Number(input.patientPackageId) || null
  const notes = String(input.patientNotes || '').trim()

  if (!patientId) return { ok: false, errors: { patientId: 'Choose a patient' } }
  if (!serviceId) return { ok: false, errors: { serviceId: 'Choose a treatment' } }
  if (!date || !startTime) return { ok: false, errors: { startTime: 'Choose a time' } }
  if (!['clinic', 'online'].includes(mode)) return { ok: false, error: 'Unknown appointment type.' }
  if (!['now', 'later', 'package'].includes(settlement)) {
    return { ok: false, error: 'Unknown payment option.' }
  }
  if (settlement === 'now' && !isDeskMethod(method)) {
    return { ok: false, errors: { method: 'Choose how they paid' } }
  }
  if (settlement === 'package' && !packageId) {
    return { ok: false, errors: { patientPackageId: 'Choose which package to use' } }
  }
  if (settlement === 'later' && !clinic.allow_pay_at_clinic) {
    return {
      ok: false,
      error: 'This clinic requires payment at the time of booking.',
    }
  }

  // The patient must be this clinic's. patientId came from a form.
  const patient = await queryOne(
    `SELECT id, name FROM users WHERE id = ? AND clinic_id = ? AND role = 'patient'`,
    [patientId, clinic.id]
  )
  if (!patient) return { ok: false, error: 'That patient could not be found.' }

  const physioId = await getDefaultPhysioId(clinic.id)
  if (!physioId) {
    return { ok: false, error: 'Add a physiotherapist before booking appointments.' }
  }

  /**
   * The same holdSlot() the online path uses, with the desk options set.
   *
   * `status: 'confirmed'` and `hold: false` together are what make this a desk
   * booking: it is real the moment reception makes it, and it does not expire.
   */
  const result = await holdSlot({
    clinic,
    physioId,
    patientId,
    serviceId,
    date,
    startTime,
    mode,
    patientNotes: notes || null,
    painLevel: null,
    roomId: mode === 'online' ? generateRoomId() : null,
    code: generateAppointmentCode(),
    patientPackageId: settlement === 'package' ? packageId : null,
    bookedBy: user.id,
    status: 'confirmed',
    hold: false,
  })

  if (!result.ok) return { ok: false, error: result.error }

  const appointment = result.appointment

  /* ------------------------------------------------------ money, if any */
  try {
    if (settlement === 'now') {
      await transaction(async (tx) => {
        await recordDeskPayment(tx, {
          clinicId: clinic.id,
          appointmentId: appointment.id,
          // From the appointment, which copied it from the service. Never the form.
          amountPaise: appointment.amountPaise,
          method,
          collectedBy: user.id,
          reference,
        })
      })
    }

    if (settlement === 'package') {
      // Keep the stored status honest for the admin list. Nothing depends on it —
      // sessions remaining is always derived — but "active" against an empty
      // package would be misleading.
      await refreshPackageStatus(clinic.id, packageId)
    }
  } catch (error) {
    /**
     * The appointment exists and the payment did not record.
     *
     * Deliberately NOT rolled back. The slot is genuinely booked, the patient is
     * expected, and deleting the appointment because a payment row failed would
     * turn a bookkeeping problem into a clinical one. It is reported so somebody
     * can add the payment by hand from the appointment page.
     */
    console.error('[createDeskAppointment] booked but payment not recorded:', error)
    revalidatePath('/admin/appointments')
    return {
      ok: true,
      appointmentId: appointment.id,
      warning: true,
      message: `Booked ${patient.name} for ${appointment.label}, but the payment did not save. Record it from the appointment page.`,
    }
  }

  revalidatePath('/admin/appointments')
  revalidatePath('/admin')
  revalidatePath(`/admin/patients/${patientId}`)
  revalidatePath('/dashboard')

  const settled =
    settlement === 'now'
      ? `${formatMoney(appointment.amountPaise)} taken by ${deskMethodLabel(method).toLowerCase()}`
      : settlement === 'package'
        ? 'one session used from their package'
        : `${formatMoney(appointment.amountPaise)} to collect at the clinic`

  return {
    ok: true,
    appointmentId: appointment.id,
    message: `${patient.name} booked for ${appointment.label} — ${settled}.`,
  }
}

/* ========================================================================== */
/*  LOOKING A PATIENT UP                                                      */
/* ========================================================================== */

/**
 * Search this clinic's patients by name, phone or email.
 *
 * Reception types a surname or the last four digits of a phone number, which is
 * how people actually identify a caller. Capped at 10 results — a longer list is
 * not more useful, it just means searching again with more of the name.
 */
export async function searchPatients(term) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.', patients: [] }
  }

  const search = String(term || '').trim()
  if (search.length < 2) return { ok: true, patients: [] }

  const like = `%${search}%`
  const patients = await query(
    `SELECT u.id, u.name, u.phone, u.email,
            (SELECT COUNT(*) FROM appointments a
              WHERE a.patient_id = u.id AND a.clinic_id = u.clinic_id
                AND a.status = 'completed') AS visits
       FROM users u
      WHERE u.clinic_id = ? AND u.role = 'patient'
        AND (u.name LIKE ? OR u.phone LIKE ? OR u.email LIKE ?)
      ORDER BY u.name
      LIMIT 10`,
    [clinic.id, like, like, like]
  )

  return {
    ok: true,
    patients: patients.map((p) => ({
      id: p.id,
      name: p.name,
      phone: p.phone,
      // A derived placeholder address is noise on screen — reception did not type
      // it and cannot use it.
      email: String(p.email).endsWith('.invalid') ? null : p.email,
      visits: Number(p.visits),
    })),
  }
}

/** The packages this patient could spend on this treatment, for the payment step. */
export async function packagesForPatient(patientId, serviceId) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, packages: [] }
  }

  const usable = await usablePackages(clinic.id, Number(patientId), Number(serviceId) || null)

  return {
    ok: true,
    packages: usable.map((p) => ({
      id: p.id,
      name: p.name,
      sessionsRemaining: p.sessionsRemaining,
      sessionsTotal: p.sessionsTotal,
      expiresAt: p.expires_at,
      serviceName: p.service_name,
    })),
  }
}
