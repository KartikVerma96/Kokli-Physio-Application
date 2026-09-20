import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { queryOne, transaction } from '@/lib/db'
import { sendEmailInBackground } from '@/lib/email'
import { appointmentCancelled } from '@/lib/emailTemplates'
import { refundPayment } from '@/lib/razorpay'
import { getCurrentClinic } from '@/lib/tenant'

/**
 * ============================================================================
 *  POST /api/appointments/[id]/cancel
 * ============================================================================
 *  Cancels an appointment, frees the slot, and issues a refund if the clinic's
 *  policy says one is due.
 *
 *  WHO MAY CANCEL WHAT
 *  -------------------
 *  A patient may cancel their OWN appointment. Refunded only if they are outside
 *  the free-cancellation window.
 *
 *  Staff may cancel ANY appointment, and it is always refunded in full. That
 *  asymmetry is deliberate and it is the fair rule: if the clinic cancels — the
 *  physio is ill, the clinic floods — the patient did nothing wrong and must not
 *  be out of pocket.
 *
 *  WHY THE SLOT FREES ITSELF
 *  -------------------------
 *  There is no "release the slot" code anywhere below. Setting status to
 *  'cancelled' makes the generated `active_slot_key` column become NULL, which
 *  releases the unique index that was holding the slot. The time is instantly
 *  bookable again. See the long comment on the appointments table in
 *  database/schema.sql — this is the payoff for that design.
 * ============================================================================
 */

export async function POST(request, { params }) {
  const { id } = await params

  const clinic = await getCurrentClinic()
  if (!clinic) return NextResponse.json({ error: 'Unknown clinic' }, { status: 404 })

  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })
  }
  if (session.user.role !== 'platform' && Number(session.user.clinicId) !== Number(clinic.id)) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403 })
  }

  const isStaff = ['admin', 'physio'].includes(session.user.role)

  let reason = ''
  try {
    const body = await request.json()
    reason = String(body?.reason || '').slice(0, 255)
  } catch {
    // A body is optional here — cancelling without giving a reason is fine.
  }

  try {
    // The ownership check is in the WHERE clause: a patient can only ever load
    // their own appointment, so there is no way to cancel someone else's.
    const appointment = await queryOne(
      `SELECT a.id, a.code, a.status, a.amount_paise, a.appointment_date, a.start_time,
              a.patient_id, a.mode, a.patient_package_id, s.name AS service_name,
              u.name AS patient_name, u.email AS patient_email
         FROM appointments a
         LEFT JOIN services s ON s.id = a.service_id
         LEFT JOIN users u ON u.id = a.patient_id
        WHERE a.id = ?
          AND a.clinic_id = ?
          AND (? = 1 OR a.patient_id = ?)`,
      [id, clinic.id, isStaff ? 1 : 0, session.user.id]
    )

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found.' }, { status: 404 })
    }

    if (['cancelled', 'completed', 'no_show'].includes(appointment.status)) {
      return NextResponse.json(
        { error: `This appointment is already ${appointment.status.replace('_', ' ')}.` },
        { status: 409 }
      )
    }

    /* --------------------------------------------------- refund decision */
    // Recomputed here on the server. The button in the UI decides what to SAY;
    // this decides what actually happens, and it is the only one that counts.
    const hoursUntil =
      (Date.parse(`${String(appointment.appointment_date).slice(0, 10)}T${appointment.start_time}`) -
        Date.now()) /
      3_600_000

    const withinFreeWindow = hoursUntil >= (clinic.free_cancellation_hours ?? 12)
    const shouldRefund = isStaff || withinFreeWindow

    /**
     * A prepaid session cancelled too late is FORFEITED.
     *
     * lib/packages.js counts a session as used when the appointment is not
     * cancelled, so without this flag a late cancellation quietly hands the
     * session back — and a patient on a ten-session package could cancel at 9:55
     * for a 10:00 slot every time, at no cost, with the slot dead each time.
     *
     * Staff cancellations never forfeit. If the clinic called the patient to move
     * the appointment, charging them for it would be indefensible.
     */
    const forfeitSession =
      Boolean(appointment.patient_package_id) &&
      !isStaff &&
      !withinFreeWindow &&
      Boolean(clinic.late_cancel_forfeits_session)

    // Find the successful payment, if there was one. An appointment still at
    // 'pending_payment' has nothing to refund.
    const payment = await queryOne(
      `SELECT id, razorpay_payment_id, amount_paise, status
         FROM payments
        WHERE clinic_id = ? AND appointment_id = ? AND status = 'paid'
        ORDER BY id DESC LIMIT 1`,
      [clinic.id, appointment.id]
    )

    /* ------------------------------------------------------ do the refund */
    let refund = null
    if (shouldRefund && payment?.razorpay_payment_id) {
      try {
        refund = await refundPayment(clinic, {
          paymentId: payment.razorpay_payment_id,
          amountPaise: payment.amount_paise,
          notes: {
            appointment_code: appointment.code,
            cancelled_by: isStaff ? 'clinic' : 'patient',
            reason: reason || 'Cancelled',
          },
        })
      } catch (error) {
        /**
         * The refund failed but the cancellation must still go through.
         *
         * Refusing to cancel because Razorpay is having a bad minute would leave
         * the slot blocked and the patient stuck. So we cancel, log loudly, and the
         * unrefunded payment stays visible in Admin → Payments for a human to
         * settle. Losing the slot is worse than a refund that needs one manual
         * click.
         */
        console.error(`[cancel] refund failed for appointment ${appointment.id}:`, error.message)
      }
    }

    /* ----------------------------------------------------- write it down */
    await transaction(async (tx) => {
      await tx.execute(
        `UPDATE appointments
            SET status = 'cancelled',
                cancelled_at = NOW(),
                cancelled_by = ?,
                cancel_reason = ?,
                package_session_forfeited = ?,
                hold_expires_at = NULL
          WHERE id = ?`,
        [isStaff ? 'clinic' : 'patient', reason || null, forfeitSession ? 1 : 0, appointment.id]
      )

      if (refund && payment) {
        await tx.execute(
          `UPDATE payments
              SET status = 'refunded',
                  refund_id = ?,
                  refunded_paise = ?,
                  refunded_at = NOW()
            WHERE id = ?`,
          [refund.id, refund.amount ?? payment.amount_paise, payment.id]
        )
      }
    })

    /* ----------------------------------------------------- tell the patient */
    /**
     * Sent even when the CLINIC did the cancelling — especially then. A patient
     * who turns up to a cancelled appointment has wasted an afternoon, and
     * "we updated it in the system" is not a defence.
     */
    if (appointment.patient_email) {
      sendEmailInBackground({
        to: appointment.patient_email,
        clinic,
        ...appointmentCancelled({
          clinic,
          patientName: appointment.patient_name,
          appointment: {
            code: appointment.code,
            serviceName: appointment.service_name || 'Physiotherapy appointment',
            date: appointment.appointment_date,
            startTime: appointment.start_time,
          },
          refundNote: refund
            ? 'Your refund has been issued and usually appears on your statement within 5–7 working days.'
            : null,
        }),
      })
    }

    return NextResponse.json({
      ok: true,
      refunded: Boolean(refund),
      // Genuinely useful to state: Razorpay refunds take days to appear on a
      // card statement, and a patient who is not told that will assume it failed
      // and message the clinic.
      message: refund
        ? 'Appointment cancelled. Your refund has been issued and usually appears within 5–7 working days.'
        : forfeitSession
          ? `Appointment cancelled. As this was less than ${clinic.free_cancellation_hours ?? 12} hours before your slot, the session has been used from your package.`
          : payment
            ? `Appointment cancelled. As this was inside the ${(clinic.free_cancellation_hours ?? 12)}-hour window, no refund is due.`
            : 'Appointment cancelled.',
    })
  } catch (error) {
    console.error('[api/appointments/cancel] error:', error)
    return NextResponse.json(
      { error: 'Could not cancel that appointment. Please contact the clinic.' },
      { status: 500 }
    )
  }
}
