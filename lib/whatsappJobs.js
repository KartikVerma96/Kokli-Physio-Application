import { query } from '@/lib/db'
import { sendWhatsApp } from '@/lib/whatsapp'
import { clinicUrl } from '@/config/platform'

/**
 * ============================================================================
 *  THE SCHEDULED WHATSAPP MESSAGES
 * ============================================================================
 *  Three of the four uses are not triggered by anything a person does — nobody
 *  clicks a button to make tomorrow arrive, or a package expire. They run from a
 *  scheduler.
 *
 *  ---------------------------------------------------------------------------
 *  THE RULE EVERY JOB HERE FOLLOWS: MARK BEFORE SENDING
 *  ---------------------------------------------------------------------------
 *  Each job stamps its "sent" column BEFORE calling WhatsApp, not after.
 *
 *  That is deliberate and it is the opposite of what feels right. Marking
 *  afterwards means a crash between the send and the stamp leaves the appointment
 *  unmarked — so the next run sends the reminder again, and again, and a patient
 *  receives the same message six times. Marking first means the worst case is one
 *  patient missing one reminder, which is the failure a clinic would choose every
 *  time if asked.
 *
 *  ---------------------------------------------------------------------------
 *  WHY THEY ARE SAFE TO RUN OFTEN
 *  ---------------------------------------------------------------------------
 *  Every query below selects only rows that have not been handled, so running the
 *  job every ten minutes and running it once a day produce the same messages.
 *  That matters because a scheduler that must run exactly once is a scheduler that
 *  will eventually run twice.
 * ============================================================================
 */

/**
 * Rebuild the clinic object the sender needs, from a joined row.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS RATHER THAN AN OBJECT LITERAL AT EACH CALL SITE
 * ---------------------------------------------------------------------------
 * Each job hand-built `{ id, name, slug }` and quietly left out
 * `wa_phone_number_id` and `wa_token_enc`. The sender reads those to decide
 * whether the clinic is on its OWN WhatsApp number — so every clinic looked like
 * it was on the platform's, and clinics paying Meta directly were still being
 * capped by our monthly allowance.
 *
 * Nothing errored. Messages simply stopped at 500 for people who were paying for
 * them, which is the kind of bug that surfaces as an angry email a month later.
 * One function, so a field added to the sender cannot be forgotten in three
 * places.
 */
function clinicFrom(row, extra = {}) {
  return {
    id: row.clinic_id,
    name: row.clinic_name,
    slug: row.slug,
    wa_phone_number_id: row.wa_phone_number_id,
    wa_token_enc: row.wa_token_enc,
    ...extra,
  }
}

/* ========================================================================== */
/*  1. APPOINTMENT REMINDERS                                                  */
/* ========================================================================== */

/**
 * Remind everybody whose appointment is inside their clinic's reminder window.
 *
 * `wa_reminder_hours` is per clinic, defaulting to 24. The window is open-ended
 * at the near end on purpose: an appointment at 9am tomorrow should still be
 * reminded if the scheduler was down overnight and only came back at 7am. Better
 * a late reminder than none.
 */
export async function sendDueReminders() {
  const due = await query(
    `SELECT a.id, a.appointment_date, a.start_time, a.mode, a.visit_address,
            a.patient_id, u.name AS patient_name,
            c.id AS clinic_id, c.name AS clinic_name, c.slug, c.address_line1,
            c.wa_phone_number_id, c.wa_token_enc
       FROM appointments a
       JOIN clinics c ON c.id = a.clinic_id
       JOIN users u ON u.id = a.patient_id
      WHERE a.status = 'confirmed'
        AND a.wa_reminder_sent_at IS NULL
        AND c.wa_send_reminders = 1
        AND c.status IN ('trialing', 'active', 'past_due')
        -- Inside the window, and not already in the past.
        AND TIMESTAMP(a.appointment_date, a.start_time) > NOW()
        AND TIMESTAMP(a.appointment_date, a.start_time)
            <= DATE_ADD(NOW(), INTERVAL c.wa_reminder_hours HOUR)
      ORDER BY a.appointment_date, a.start_time
      LIMIT 500`
  )

  let sent = 0
  let skipped = 0

  for (const row of due) {
    // Marked first — see the note at the top of this file.
    await query('UPDATE appointments SET wa_reminder_sent_at = NOW() WHERE id = ?', [row.id])

    const result = await sendWhatsApp({
      clinic: clinicFrom(row, { address_line1: row.address_line1 }),
      patientId: row.patient_id,
      template: 'appointment_reminder',
      appointmentId: row.id,
      values: {
        patientName: row.patient_name,
        date: row.appointment_date,
        startTime: row.start_time,
        where:
          row.mode === 'online'
            ? 'Online video consultation'
            : row.mode === 'home'
              ? row.visit_address || 'Your home'
              : row.address_line1 || 'the clinic',
      },
    })

    if (result.ok && !result.skipped) sent++
    else skipped++
  }

  return { considered: due.length, sent, skipped }
}

/* ========================================================================== */
/*  2. PACKAGES ABOUT TO EXPIRE                                (MARKETING)    */
/* ========================================================================== */

/**
 * Patients holding sessions they paid for, expiring soon, with nothing booked.
 *
 * Ten days out is the window: long enough that they can still fit the sessions
 * in, close enough that it is urgent. Nudging at thirty days is ignored; at three
 * days it is an apology for wasting their money.
 *
 * Marketing category, so `sendWhatsApp` will refuse without explicit consent.
 * That refusal is logged rather than silent, so a clinic can see how much reach
 * it is losing by not collecting opt-ins.
 */
export async function sendPackageExpiryNudges({ withinDays = 10 } = {}) {
  const due = await query(
    `SELECT pp.id, pp.patient_id, pp.name AS package_name, pp.expires_at, pp.sessions_total,
            (SELECT COUNT(*) FROM appointments a
              WHERE a.patient_package_id = pp.id
                AND (a.status <> 'cancelled' OR a.package_session_forfeited = 1))
              AS sessions_used,
            u.name AS patient_name,
            c.id AS clinic_id, c.name AS clinic_name, c.slug,
            c.wa_phone_number_id, c.wa_token_enc
       FROM patient_packages pp
       JOIN clinics c ON c.id = pp.clinic_id
       JOIN users u ON u.id = pp.patient_id
      WHERE pp.status = 'active'
        AND pp.wa_expiry_nudge_sent_at IS NULL
        AND c.wa_send_package_nudge = 1
        AND c.status IN ('trialing', 'active', 'past_due')
        AND pp.expires_at IS NOT NULL
        AND pp.expires_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
        -- Nobody who is already coming back.
        AND NOT EXISTS (
          SELECT 1 FROM appointments f
           WHERE f.patient_id = pp.patient_id AND f.clinic_id = pp.clinic_id
             AND f.appointment_date >= CURDATE()
             AND f.status IN ('pending_payment', 'confirmed', 'in_progress')
        )
      LIMIT 200`,
    [withinDays]
  )

  let sent = 0
  let skipped = 0

  for (const row of due) {
    const left = Number(row.sessions_total) - Number(row.sessions_used)
    // Nothing left is a finished course, not an expiring one.
    if (left <= 0) continue

    await query('UPDATE patient_packages SET wa_expiry_nudge_sent_at = NOW() WHERE id = ?', [row.id])

    const result = await sendWhatsApp({
      clinic: clinicFrom(row),
      patientId: row.patient_id,
      template: 'package_expiring',
      patientPackageId: row.id,
      values: {
        patientName: row.patient_name,
        sessionsLeft: left,
        expiresAt: row.expires_at,
        bookingUrl: clinicUrl(row.slug, '/book'),
      },
    })

    if (result.ok && !result.skipped) sent++
    else skipped++
  }

  return { considered: due.length, sent, skipped }
}

/* ========================================================================== */
/*  3. REVIEW REQUESTS                                         (MARKETING)    */
/* ========================================================================== */

/**
 * Ask a day or two after treatment, and only once per patient per course.
 *
 * The timing is the whole feature. Ask immediately and they have not felt the
 * difference yet; ask in a month and they have forgotten. Two days after a
 * completed session, while they are noticing they can lift their arm again, is
 * when people actually write something.
 *
 * `google_review_url` is per clinic — without it there is nowhere to send them,
 * so those clinics are simply not selected.
 */
export async function sendReviewRequests({ afterDays = 2 } = {}) {
  const due = await query(
    `SELECT a.id, a.patient_id, u.name AS patient_name,
            c.id AS clinic_id, c.name AS clinic_name, c.slug, c.maps_url,
            c.wa_phone_number_id, c.wa_token_enc
       FROM appointments a
       JOIN clinics c ON c.id = a.clinic_id
       JOIN users u ON u.id = a.patient_id
      WHERE a.status = 'completed'
        AND a.wa_review_asked_at IS NULL
        AND c.wa_send_review_request = 1
        AND c.status IN ('trialing', 'active', 'past_due')
        AND c.maps_url IS NOT NULL AND c.maps_url <> ''
        AND a.appointment_date BETWEEN DATE_SUB(CURDATE(), INTERVAL ? + 5 DAY)
                                   AND DATE_SUB(CURDATE(), INTERVAL ? DAY)
        -- Only their most recent completed visit, so a patient part-way through a
        -- course is not asked after every single session.
        AND a.id = (
          SELECT MAX(a2.id) FROM appointments a2
           WHERE a2.patient_id = a.patient_id AND a2.clinic_id = a.clinic_id
             AND a2.status = 'completed'
        )
        -- And nobody still mid-course: asking before they are better is premature.
        AND NOT EXISTS (
          SELECT 1 FROM appointments f
           WHERE f.patient_id = a.patient_id AND f.clinic_id = a.clinic_id
             AND f.appointment_date >= CURDATE()
             AND f.status IN ('pending_payment', 'confirmed', 'in_progress')
        )
      LIMIT 200`,
    [afterDays, afterDays]
  )

  let sent = 0
  let skipped = 0

  for (const row of due) {
    await query('UPDATE appointments SET wa_review_asked_at = NOW() WHERE id = ?', [row.id])

    const result = await sendWhatsApp({
      clinic: clinicFrom(row),
      patientId: row.patient_id,
      template: 'review_request',
      appointmentId: row.id,
      values: { patientName: row.patient_name, reviewUrl: row.maps_url },
    })

    if (result.ok && !result.skipped) sent++
    else skipped++
  }

  return { considered: due.length, sent, skipped }
}

/** Everything, for the scheduler. */
export async function runWhatsAppJobs() {
  const reminders = await sendDueReminders()
  const packages = await sendPackageExpiryNudges()
  const reviews = await sendReviewRequests()

  const total = reminders.sent + packages.sent + reviews.sent
  if (total > 0) {
    console.log(
      `[whatsapp] sent ${total} — ${reminders.sent} reminders, ` +
        `${packages.sent} package nudges, ${reviews.sent} review requests`
    )
  }

  return { reminders, packages, reviews, sent: total }
}
