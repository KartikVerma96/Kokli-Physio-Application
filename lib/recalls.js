import { query } from '@/lib/db'

/**
 * ============================================================================
 *  RECALL — the patients worth phoning today
 * ============================================================================
 *
 *  WHY THIS IS THE CHEAPEST REVENUE IN THE BUSINESS
 *  -----------------------------------------------
 *  A new patient costs money to find: advertising, a Google listing, a referral
 *  relationship with an orthopaedic surgeon. A patient who was treated here six
 *  months ago costs one phone call, already trusts the clinic, and their file is
 *  already open.
 *
 *  The application was already storing everything needed to produce this list and
 *  reading none of it. `follow_up_date` was written into the clinical note by the
 *  physiotherapist — an explicit clinical instruction to see somebody again — and
 *  then nothing ever looked at it. `last_visit` was displayed on the patients page
 *  and not actionable.
 *
 *  THREE LISTS, IN ORDER OF HOW BADLY THEY NEED CALLING
 *  ---------------------------------------------------
 *  1. UNFINISHED PACKAGES.  They have paid for sessions they have not taken. This
 *     is first because it is both a clinical failure — an incomplete course of
 *     treatment is how people relapse — and money the clinic is holding for work
 *     it has not done. Nobody has to be sold anything; they just need reminding.
 *
 *  2. FOLLOW-UPS DUE.  A physiotherapist wrote "see again on the 14th" in the
 *     notes. Missing it is ignoring your own clinical judgement.
 *
 *  3. LAPSED.  No visit for however many days the clinic considers lapsed, and
 *     nothing booked. The longest list and the coldest calls, so it comes last.
 *
 *  Every list excludes anybody with a FUTURE APPOINTMENT — the whole point is who
 *  is NOT coming back, and a list that includes people already booked in gets
 *  ignored within a week.
 * ============================================================================
 */

/**
 * Patients holding sessions they have paid for and not used.
 *
 * The session count is derived the same way as everywhere else — appointments
 * that were not cancelled, plus any forfeited to a no-show. See lib/packages.js.
 */
export async function unfinishedPackages(clinicId) {
  return query(
    `SELECT pp.id AS package_id, pp.name AS package_name, pp.expires_at,
            pp.sessions_total,
            (SELECT COUNT(*) FROM appointments a
              WHERE a.patient_package_id = pp.id
                AND (a.status <> 'cancelled' OR a.package_session_forfeited = 1))
              AS sessions_used,
            u.id AS patient_id, u.name, u.phone, u.email,
            (SELECT MAX(a2.appointment_date) FROM appointments a2
              WHERE a2.patient_id = u.id AND a2.clinic_id = pp.clinic_id
                AND a2.status = 'completed') AS last_visit
       FROM patient_packages pp
       JOIN users u ON u.id = pp.patient_id
      WHERE pp.clinic_id = ?
        AND pp.status = 'active'
        AND (pp.expires_at IS NULL OR pp.expires_at >= CURDATE())
        -- Nobody who is already coming back.
        AND NOT EXISTS (
          SELECT 1 FROM appointments f
           WHERE f.patient_id = u.id AND f.clinic_id = pp.clinic_id
             AND f.appointment_date >= CURDATE()
             AND f.status IN ('pending_payment', 'confirmed', 'in_progress')
        )
      ORDER BY pp.expires_at IS NULL, pp.expires_at, u.name`,
    [clinicId]
  ).then((rows) =>
    rows
      .map((row) => ({
        ...row,
        sessionsLeft: Number(row.sessions_total) - Number(row.sessions_used),
      }))
      // A package with nothing left is finished, not unfinished. Filtered here
      // rather than in SQL because the count is a derived column.
      .filter((row) => row.sessionsLeft > 0)
  )
}

/** Follow-up dates the physiotherapist wrote in the notes, now due. */
export async function followUpsDue(clinicId, { withinDays = 14 } = {}) {
  return query(
    `SELECT n.follow_up_date, n.sessions_recommended,
            u.id AS patient_id, u.name, u.phone, u.email,
            s.name AS service_name,
            a.appointment_date AS last_seen,
            pr.last_recall_at
       FROM consultation_notes n
       JOIN appointments a ON a.id = n.appointment_id
       JOIN users u ON u.id = a.patient_id
       LEFT JOIN services s ON s.id = a.service_id
       LEFT JOIN patient_profiles pr ON pr.user_id = u.id
      WHERE n.clinic_id = ?
        AND n.follow_up_date IS NOT NULL
        AND n.follow_up_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
        -- Only the most recent note per patient matters; an old follow-up that has
        -- since been superseded is noise.
        AND n.id = (
          SELECT MAX(n2.id) FROM consultation_notes n2
           JOIN appointments a2 ON a2.id = n2.appointment_id
           WHERE a2.patient_id = u.id AND n2.clinic_id = n.clinic_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM appointments f
           WHERE f.patient_id = u.id AND f.clinic_id = n.clinic_id
             AND f.appointment_date >= CURDATE()
             AND f.status IN ('pending_payment', 'confirmed', 'in_progress')
        )
      ORDER BY n.follow_up_date`,
    [clinicId, withinDays]
  )
}

/**
 * Patients who simply stopped coming.
 *
 * `recall_after_days` is a clinic setting, defaulting to 60 — long enough that a
 * finished course is not chased the following week, short enough that somebody who
 * dropped out half-way is called while they still remember why they came.
 */
export async function lapsedPatients(clinicId, { afterDays = 60, limit = 100 } = {}) {
  return query(
    `SELECT u.id AS patient_id, u.name, u.phone, u.email,
            MAX(a.appointment_date) AS last_visit,
            COUNT(*) AS visits,
            pr.last_recall_at, pr.recall_note
       FROM users u
       JOIN appointments a ON a.patient_id = u.id AND a.clinic_id = u.clinic_id
       LEFT JOIN patient_profiles pr ON pr.user_id = u.id
      WHERE u.clinic_id = ?
        AND u.role = 'patient'
        AND a.status = 'completed'
        AND NOT EXISTS (
          SELECT 1 FROM appointments f
           WHERE f.patient_id = u.id AND f.clinic_id = u.clinic_id
             AND f.appointment_date >= CURDATE()
             AND f.status IN ('pending_payment', 'confirmed', 'in_progress')
        )
      GROUP BY u.id, u.name, u.phone, u.email, pr.last_recall_at, pr.recall_note
      HAVING MAX(a.appointment_date) < DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY last_visit DESC
      LIMIT ${Number.parseInt(limit, 10) || 100}`,
    [clinicId, afterDays]
  )
}

/**
 * A derived placeholder address is noise on a call list.
 *
 * Desk-created patients get `p<phone>@<slug>.invalid` so the NOT NULL unique
 * constraint on users.email is satisfied. Reception did not type it and cannot
 * use it, so it should not appear as if it were a real address.
 */
export function realEmail(email) {
  return email && !String(email).endsWith('.invalid') ? email : null
}
