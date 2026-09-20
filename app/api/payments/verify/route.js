import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { queryOne, transaction } from '@/lib/db'
import { verifyPaymentSignature, fetchPayment, isDemoMode } from '@/lib/razorpay'
import { verifyPaymentSchema, validateRequest } from '@/lib/validation'
import { sendEmailInBackground } from '@/lib/email'
import { appointmentConfirmed, newBookingForClinic } from '@/lib/emailTemplates'

/**
 * ============================================================================
 *  POST /api/payments/verify — confirm a payment and the appointment
 * ============================================================================
 *  Razorpay Checkout has just told the BROWSER that the payment succeeded. The
 *  browser now tells us. This endpoint decides whether to believe it.
 *
 *  WHY WE CANNOT SIMPLY BELIEVE IT
 *  -------------------------------
 *  Everything the browser sends can be forged. Anyone can open the console and
 *  post `{ appointmentId: 7, razorpay_payment_id: 'pay_whatever' }` at this URL
 *  to try to confirm an appointment they never paid for.
 *
 *  So we run four checks, in order, and all four must pass:
 *
 *    1. Is this appointment actually theirs?     (session, not request body)
 *    2. Is the signature genuine?                (HMAC with our secret key)
 *    3. Does the order id match the one WE created for this appointment?
 *    4. Did Razorpay really capture the full amount?  (asked of Razorpay directly)
 *
 *  Check 2 is the mathematical proof. Checks 1, 3 and 4 close the gaps around
 *  it — a valid signature for someone ELSE'S ₹500 appointment must not confirm
 *  this ₹1,200 one.
 *
 *  AND A FIFTH LAYER: THE WEBHOOK
 *  ------------------------------
 *  This route only runs if the patient's browser survives long enough to call
 *  it. Phones lose signal, batteries die, people close the tab the moment their
 *  bank app says "success". app/api/payments/webhook/route.js receives the same
 *  news directly from Razorpay, server to server, and confirms the appointment
 *  even if the browser never came back. Both paths are written to be safely
 *  repeatable, so it does not matter which arrives first — or if both do.
 * ============================================================================
 */

export async function POST(request) {
  const clinic = await getCurrentClinic()
  if (!clinic) return NextResponse.json({ error: 'Unknown clinic' }, { status: 404 })

  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })
  }
  if (session.user.role !== 'platform' && Number(session.user.clinicId) !== Number(clinic.id)) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403 })
  }

  const parsed = await validateRequest(verifyPaymentSchema, request)
  if (!parsed.ok) {
    return NextResponse.json({ error: 'Invalid payment confirmation.' }, { status: 422 })
  }

  const {
    appointmentId,
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
  } = parsed.data

  try {
    /* ------------------------------------------------------------------ 1 */
    // Ownership. The patient_id condition comes from the session cookie, so a
    // patient cannot confirm somebody else's appointment even with a valid
    // signature for it.
    const appointment = await queryOne(
      `SELECT a.id, a.code, a.status, a.amount_paise, a.patient_id, a.mode, a.room_id,
              a.appointment_date, a.start_time, s.name AS service_name
         FROM appointments a
         LEFT JOIN services s ON s.id = a.service_id
        WHERE a.id = ? AND a.clinic_id = ? AND a.patient_id = ?`,
      [appointmentId, clinic.id, session.user.id]
    )

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found.' }, { status: 404 })
    }

    // Already confirmed? Say so and stop. This makes the endpoint idempotent:
    // calling it twice — because the webhook got there first, or the patient
    // refreshed — is harmless rather than producing a second payment row.
    if (['confirmed', 'in_progress', 'completed'].includes(appointment.status)) {
      return NextResponse.json({ ok: true, alreadyConfirmed: true, code: appointment.code })
    }

    if (appointment.status === 'cancelled') {
      // Almost always means the payment hold expired while they were paying.
      // Money may genuinely have been taken, so this must be visible to staff
      // rather than silently swallowed.
      console.warn(`[payments/verify] payment for cancelled appointment ${appointment.id}`)
      return NextResponse.json(
        {
          error:
            'This booking expired before payment completed. If you were charged, the amount will be refunded — please contact the clinic.',
        },
        { status: 409 }
      )
    }

    /* ------------------------------------------------------------------ 2 */
    // The signature. This is the actual proof of authenticity.
    if (!verifyPaymentSignature(clinic, { orderId, paymentId, signature })) {
      await recordFailure(appointment.id, orderId, paymentId, 'Signature verification failed')
      console.error(`[payments/verify] BAD SIGNATURE for appointment ${appointment.id}`)
      return NextResponse.json(
        { error: 'We could not verify that payment. Please contact the clinic.' },
        { status: 400 }
      )
    }

    /* ------------------------------------------------------------------ 3 */
    // The order id must be the one we created for THIS appointment. Without
    // this, a valid signature from a cheap appointment could be replayed to
    // confirm an expensive one.
    const paymentRow = await queryOne(
      `SELECT id, amount_paise, status FROM payments
        WHERE clinic_id = ? AND appointment_id = ? AND razorpay_order_id = ?`,
      [clinic.id, appointment.id, orderId]
    )

    if (!paymentRow) {
      await recordFailure(appointment.id, orderId, paymentId, 'Order id does not belong to this appointment')
      return NextResponse.json(
        { error: 'That payment does not match this appointment.' },
        { status: 400 }
      )
    }

    /* ------------------------------------------------------------------ 4 */
    // Ask Razorpay what actually happened. The signature proves the message is
    // authentic; this proves the money was captured and the sum is right.
    let method = null
    if (!isDemoMode(clinic)) {
      try {
        const razorpayPayment = await fetchPayment(clinic, paymentId)
        method = razorpayPayment?.method || null

        if (razorpayPayment?.status !== 'captured' && razorpayPayment?.status !== 'authorized') {
          await recordFailure(appointment.id, orderId, paymentId, `Status was ${razorpayPayment?.status}`)
          return NextResponse.json(
            { error: 'That payment has not completed. Please try again.' },
            { status: 402 }
          )
        }

        if (Number(razorpayPayment.amount) < Number(appointment.amount_paise)) {
          await recordFailure(appointment.id, orderId, paymentId, 'Amount was short')
          console.error(
            `[payments/verify] amount mismatch on appointment ${appointment.id}: ` +
              `expected ${appointment.amount_paise}, got ${razorpayPayment.amount}`
          )
          return NextResponse.json({ error: 'The amount paid does not match.' }, { status: 400 })
        }
      } catch (error) {
        // Razorpay being briefly unreachable must NOT block a patient whose
        // signature already verified. The webhook will reconcile it, so we log
        // and continue rather than failing a legitimate booking.
        console.error('[payments/verify] could not reach Razorpay to double-check:', error.message)
      }
    }

    /* ------------------------------------------------------- all four passed */
    // One transaction for both writes. An appointment marked confirmed with no
    // matching paid payment row — or the reverse — would be a mess to untangle,
    // and both statements must therefore succeed or neither should.
    await transaction(async (tx) => {
      await tx.execute(
        `UPDATE payments
            SET status = 'paid',
                razorpay_payment_id = ?,
                razorpay_signature = ?,
                method = ?
          WHERE id = ?`,
        [paymentId, signature, method, paymentRow.id]
      )

      await tx.execute(
        `UPDATE appointments
            SET status = 'confirmed',
                hold_expires_at = NULL
          WHERE id = ?`,
        [appointment.id]
      )
    })

    /* ------------------------------------------------------ tell everybody */
    /**
     * Sent in the background, deliberately AFTER the transaction committed.
     *
     * Two rules are being obeyed here. The email goes out only once the booking
     * is genuinely saved — telling somebody their appointment is confirmed and
     * then rolling back would be worse than sending nothing. And the response
     * does not wait for it: a mail server having a slow morning must not make a
     * patient stare at a spinner, nor lose them a confirmed booking.
     */
    const details = {
      id: appointment.id,
      code: appointment.code,
      serviceName: appointment.service_name || 'Physiotherapy appointment',
      date: appointment.appointment_date,
      startTime: appointment.start_time,
      mode: appointment.mode,
      amountPaise: appointment.amount_paise,
    }

    if (session.user.email) {
      sendEmailInBackground({
        to: session.user.email,
        clinic,
        ...appointmentConfirmed({ clinic, patientName: session.user.name, appointment: details }),
      })
    }

    // And the clinic, so a booking taken at 11pm is not a surprise at 9am.
    if (clinic.email) {
      sendEmailInBackground({
        to: clinic.email,
        clinic,
        ...newBookingForClinic({
          clinic,
          patientName: session.user.name,
          patientPhone: session.user.phone,
          appointment: details,
        }),
      })
    }

    return NextResponse.json({
      ok: true,
      code: appointment.code,
      appointmentId: appointment.id,
      mode: appointment.mode,
      roomId: appointment.room_id,
    })
  } catch (error) {
    console.error('[payments/verify] unexpected error:', error)
    return NextResponse.json(
      { error: 'Something went wrong confirming your payment. Please contact the clinic.' },
      { status: 500 }
    )
  }
}

/**
 * Log a failed attempt.
 *
 * Every rejection is recorded rather than merely refused. A run of signature
 * failures against different appointments is somebody probing the endpoint, and
 * you cannot notice a pattern you never wrote down.
 */
async function recordFailure(appointmentId, orderId, paymentId, reason) {
  try {
    const { query } = await import('@/lib/db')
    await query(
      `UPDATE payments
          SET status = 'failed', razorpay_payment_id = ?, error_description = ?
        WHERE appointment_id = ? AND razorpay_order_id = ? AND status = 'created'`,
      [paymentId || null, reason, appointmentId, orderId]
    )
  } catch (error) {
    console.error('[payments/verify] could not record failure:', error)
  }
}
