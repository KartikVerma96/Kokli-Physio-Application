import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { query, queryOne } from '@/lib/db'
import { jsonResponse, stamp } from '@/lib/csv'

/**
 * ============================================================================
 *  "GIVE ME MY DATA"  →  GET /api/export/me
 * ============================================================================
 *  Everything this clinic holds about the signed-in patient, as one JSON file.
 *
 *  WHY THIS IS NOT OPTIONAL
 *  ------------------------
 *  India's Digital Personal Data Protection Act gives a person the right to a copy
 *  of their own data from anyone processing it. A physiotherapy clinic holds
 *  medical records, so it is squarely in scope — and the CLINIC is the data
 *  fiduciary while this platform is its processor. When a patient asks, the clinic
 *  is legally on the hook and has nothing to answer with unless the software
 *  provides it.
 *
 *  A button the patient presses themselves is better for everyone: no request to
 *  handle, no staff time, no thirty-day clock.
 *
 *  WHY JSON AND NOT CSV
 *  --------------------
 *  This is nested — a patient, their appointments, the notes and payments hanging
 *  off each one. Flattening it either repeats the patient on every row or loses the
 *  relationships. The clinic-wide export uses CSV because those genuinely are
 *  tables; this one is a record.
 *
 *  WHAT IS DELIBERATELY LEFT OUT
 *  -----------------------------
 *  Password hashes, reset tokens, OTP hashes. Handing those over would be actively
 *  dangerous, and the right of access is about transparency, not about exporting
 *  credentials.
 *
 *  ============================================================================
 *  A NOTE ON THE JOINS, BECAUSE THEY ARE NOT OBVIOUS
 *  ============================================================================
 *  Neither `payments` nor `consultation_notes` carries a patient_id. Both reach the
 *  patient THROUGH the appointment:
 *
 *      consultation_notes → appointment_id → appointments.patient_id
 *      payments           → appointment_id → appointments.patient_id
 *                         → patient_package_id → patient_packages.patient_id
 *
 *  Payments have two routes because a package is bought up front, with no
 *  appointment attached — so filtering only on the appointment would silently omit
 *  every package purchase, which is the largest payment a patient ever makes here.
 *
 *  Every query still filters on clinic_id as well as the patient, even where the
 *  join makes it redundant. Redundant is the point: it is one line, and it means no
 *  single wrong join can cross a tenant boundary.
 * ============================================================================
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const clinic = await requireCurrentClinic()
  const session = await auth()

  if (!session?.user) {
    return Response.json({ error: 'Sign in first.' }, { status: 401 })
  }

  /**
   * The clinic comes from the HOSTNAME, the patient from the SESSION.
   *
   * Nothing here is read from the request. A session belonging to another clinic
   * is refused rather than quietly matching no rows, so a bug in the queries can
   * never be the only thing standing between two tenants.
   */
  const userId = Number(session.user.id)
  if (session.user.role !== 'platform' && Number(session.user.clinicId) !== Number(clinic.id)) {
    return Response.json({ error: 'Not your clinic.' }, { status: 403 })
  }

  const account = await queryOne(
    `SELECT u.id, u.name, u.email, u.phone, u.role,
            u.email_verified, u.phone_verified, u.created_at, u.last_login_at,
            p.date_of_birth, p.gender, p.address, p.city, p.occupation,
            p.height_cm, p.weight_kg,
            p.medical_history, p.current_medications, p.allergies, p.referred_by,
            p.emergency_contact_name, p.emergency_contact_phone,
            p.whatsapp_number, p.whatsapp_marketing_opt_in_at, p.whatsapp_opted_out_at
       FROM users u
       LEFT JOIN patient_profiles p ON p.user_id = u.id
      WHERE u.id = ? AND u.clinic_id = ?`,
    [userId, clinic.id]
  )

  if (!account) {
    return Response.json({ error: 'No record found.' }, { status: 404 })
  }

  const [appointments, payments, notes, packages, reviews, messages] = await Promise.all([
    query(
      `SELECT a.code, a.appointment_date, a.start_time, a.end_time, a.status, a.mode,
              a.visit_address, a.amount_paise, a.patient_notes, a.pain_level,
              a.cancelled_at, a.cancel_reason, a.created_at,
              s.name AS treatment, u.name AS physiotherapist
         FROM appointments a
         LEFT JOIN services s ON s.id = a.service_id
         LEFT JOIN users u ON u.id = a.physio_id
        WHERE a.clinic_id = ? AND a.patient_id = ?
        ORDER BY a.appointment_date DESC, a.start_time DESC`,
      [clinic.id, userId]
    ),

    query(
      `SELECT p.amount_paise, p.currency, p.status, p.provider, p.method, p.reference,
              p.refunded_paise, p.refunded_at, p.created_at, p.updated_at,
              a.code AS appointment_code, pp.name AS package_name
         FROM payments p
         LEFT JOIN appointments a ON a.id = p.appointment_id
         LEFT JOIN patient_packages pp ON pp.id = p.patient_package_id
        WHERE p.clinic_id = ?
          AND (a.patient_id = ? OR pp.patient_id = ?)
        ORDER BY p.created_at DESC`,
      [clinic.id, userId, userId]
    ),

    /**
     * The patient's own clinical notes.
     *
     * A physiotherapist's assessment of a patient IS that patient's health data,
     * and the right of access covers it. Withholding it would also be poor
     * practice — people are entitled to read what is written about their body.
     */
    query(
      `SELECT n.subjective, n.objective, n.assessment, n.plan, n.exercises_prescribed,
              n.pain_level_before, n.pain_level_after, n.follow_up_date,
              n.sessions_recommended, n.created_at, n.updated_at,
              a.appointment_date, a.code AS appointment_code, u.name AS written_by
         FROM consultation_notes n
         JOIN appointments a ON a.id = n.appointment_id
         LEFT JOIN users u ON u.id = n.physio_id
        WHERE n.clinic_id = ? AND a.patient_id = ?
        ORDER BY a.appointment_date DESC`,
      [clinic.id, userId]
    ),

    query(
      `SELECT pp.name, pp.sessions_total, pp.price_paise, pp.purchased_at,
              pp.expires_at, pp.status, pp.notes,
              s.name AS treatment,
              (SELECT COUNT(*) FROM appointments a
                WHERE a.patient_package_id = pp.id
                  AND a.status IN ('completed', 'confirmed')) AS sessions_used
         FROM patient_packages pp
         LEFT JOIN services s ON s.id = pp.service_id
        WHERE pp.clinic_id = ? AND pp.patient_id = ?
        ORDER BY pp.purchased_at DESC`,
      [clinic.id, userId]
    ),

    query(
      `SELECT rating, comment, is_published, created_at
         FROM reviews WHERE clinic_id = ? AND patient_id = ?
        ORDER BY created_at DESC`,
      [clinic.id, userId]
    ),

    // What was sent, and what was deliberately not sent. Somebody asking "why do I
    // keep getting these" deserves the log rather than a shrug.
    query(
      `SELECT template, category, to_number, status, reason, created_at
         FROM whatsapp_messages
        WHERE clinic_id = ? AND patient_id = ?
        ORDER BY created_at DESC
        LIMIT 500`,
      [clinic.id, userId]
    ),
  ])

  return jsonResponse(
    {
      exported_at: new Date().toISOString(),
      /**
       * The clinic is named inside the file, not only in its name. A patient
       * attending two clinics on this platform ends up with two of these in one
       * downloads folder, and six months later the filename will not be enough.
       */
      clinic: {
        name: clinic.name,
        city: clinic.city,
        email: clinic.email,
        phone: clinic.phone,
      },
      about_this_file:
        'Everything this clinic holds about you. Passwords and security codes are excluded on ' +
        'purpose: they are stored only as one-way hashes and cannot be read back by anyone, ' +
        'including the clinic.',
      account,
      appointments,
      payments,
      clinical_notes: notes,
      packages,
      reviews,
      whatsapp_messages: messages,
    },
    `my-data-${clinic.slug}-${stamp()}.json`
  )
}
