import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { canAcceptBookings } from '@/lib/subscriptionLifecycle'
import { query } from '@/lib/db'
import { holdSlot, getDefaultPhysioId } from '@/lib/slots'
import { usablePackages, refreshPackageStatus } from '@/lib/packages'
import { createOrder, isDemoMode, publicKeyId } from '@/lib/razorpay'
import { createAppointmentSchema, validateRequest } from '@/lib/validation'
import { generateAppointmentCode, generateRoomId } from '@/lib/utils'

/**
 * ============================================================================
 *  POST /api/appointments — hold a slot and start the payment
 * ============================================================================
 *  This is the most important endpoint in the application, so it is worth
 *  reading top to bottom. It does five things in a deliberate order:
 *
 *    1. Confirms the caller is signed in.
 *    2. Validates the request body.
 *    3. Holds the slot in the database (status 'pending_payment').
 *    4. Creates a Razorpay order for the amount, taken from the DATABASE.
 *    5. Returns everything the browser needs to open Razorpay Checkout.
 *
 *  THE MOST IMPORTANT LINE IN THE FILE
 *  -----------------------------------
 *  The amount charged comes from `appointment.amountPaise`, which holdSlot() read
 *  from the `services` table. The browser sends no price at all.
 *
 *  If we trusted a price from the request body, a patient could open devtools
 *  and pay ₹1 for a ₹1,000 session. Never, under any circumstances, let the
 *  client tell the server what something costs. Send an id; look the price up.
 * ============================================================================
 */

export async function POST(request) {
  // ------------------------------------------------------------ 1. who is this
  // The clinic is the hostname's, never the caller's to choose.
  const clinic = await getCurrentClinic()
  if (!clinic) {
    return NextResponse.json({ error: 'Unknown clinic' }, { status: 404 })
  }

  // A clinic whose subscription has lapsed keeps every record but takes no new
  // bookings. This is the enforcement point for that.
  // Derived from the dates rather than read from clinics.status, so a trial that
  // expired an hour ago is enforced immediately — with or without a cron sweep.
  // See lib/subscriptionLifecycle.js.
  if (!canAcceptBookings(clinic)) {
    return NextResponse.json(
      { error: 'This clinic is not accepting online bookings at the moment.' },
      { status: 403 }
    )
  }

  const session = await auth()
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Please sign in to book an appointment.' },
      { status: 401 }
    )
  }

  // A patient of another clinic holds a valid session here, because the cookie
  // spans subdomains. They may not book on this one.
  if (session.user.role !== 'platform' && Number(session.user.clinicId) !== Number(clinic.id)) {
    return NextResponse.json(
      { error: 'Please sign in with an account for this clinic.' },
      { status: 403 }
    )
  }

  // Staff booking on a patient's behalf is a genuinely useful feature, but it
  // needs its own flow (choose which patient) rather than silently booking the
  // receptionist in. Admin → Appointments is where that belongs.
  if (session.user.role !== 'patient') {
    return NextResponse.json(
      { error: 'Staff accounts cannot book for themselves. Use the admin panel.' },
      { status: 403 }
    )
  }

  // ------------------------------------------------------------- 2. validate
  const parsed = await validateRequest(createAppointmentSchema, request)
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'Please check your booking details.', errors: parsed.errors },
      { status: 422 }
    )
  }

  const { serviceId, date, startTime, mode, patientNotes, painLevel } = parsed.data
  const visitAddress = parsed.data.visitAddress || null

  if (mode === 'home' && !visitAddress) {
    return NextResponse.json(
      { error: 'Please give the address for the home visit.', errors: { visitAddress: 'Required for a home visit' } },
      { status: 422 }
    )
  }
  const patientPackageId = parsed.data.patientPackageId || null

  /**
   * Paying with a prepaid session.
   *
   * Checked here so the response can say plainly why not, but the check that
   * MATTERS is inside holdSlot's transaction, where the package row is locked
   * before the session is counted. This one is a courtesy; that one is the rule.
   */
  if (patientPackageId) {
    const usable = await usablePackages(clinic.id, session.user.id, serviceId)
    if (!usable.some((p) => Number(p.id) === Number(patientPackageId))) {
      return NextResponse.json(
        { error: 'That package cannot be used for this appointment.' },
        { status: 422 }
      )
    }
  }

  try {
    const physioId = await getDefaultPhysioId(clinic.id)
    if (!physioId) {
      return NextResponse.json(
        { error: 'The clinic diary is not set up yet.' },
        { status: 503 }
      )
    }

    // ---------------------------------------------------------- 3. hold it
    // holdSlot re-checks availability against the database and uses a
    // transaction plus a unique index to make double-booking impossible. All the
    // detail is in lib/slots.js.
    const held = await holdSlot({
      clinic,
      physioId,
      patientId: session.user.id,
      serviceId,
      date,
      startTime,
      mode,
      patientNotes,
      painLevel,
      // A room id is generated for online appointments only. It is long and
      // random, because knowing it is what grants entry to the consultation.
      roomId: generateRoomId(),
      code: generateAppointmentCode(),
      visitAddress,

      /**
       * A package session is CONFIRMED straight away and never held.
       *
       * There is nothing to wait for: the money arrived when the package was
       * sold. Holding it as 'pending_payment' would mean the appointment quietly
       * expired in fifteen minutes for a patient who had already paid — which is
       * the worst possible version of this feature.
       */
      patientPackageId,
      ...(patientPackageId ? { status: 'confirmed', hold: false } : {}),
    })

    if (!held.ok) {
      // 409 Conflict is exactly right here: the request was valid, but the world
      // changed underneath it — somebody else took the slot.
      return NextResponse.json({ error: held.error }, { status: 409 })
    }

    const appointment = held.appointment

    /* ------------------------------------- 4a. paid from a package: done */
    if (patientPackageId) {
      // Keep the stored status tidy for the admin list. Sessions remaining is
      // always derived, so nothing depends on this.
      await refreshPackageStatus(clinic.id, patientPackageId)

      return NextResponse.json(
        {
          appointment: {
            id: appointment.id,
            code: appointment.code,
            date: appointment.date,
            startTime: appointment.startTime,
            endTime: appointment.endTime,
            label: appointment.label,
            mode: appointment.mode,
            amountPaise: 0,
            serviceName: appointment.serviceName,
          },
          // The browser needs to know there is no checkout to open.
          paidFromPackage: true,
          clinicName: clinic.name,
        },
        { status: 201 }
      )
    }

    // ------------------------------------------------------- 4. the order
    /**
     * If Razorpay refuses — bad keys, their API down, a network blip — the slot has
     * ALREADY been held by the step above. Leaving it held would block that time for
     * the full hold period over a booking that can never be paid for.
     *
     * So the hold is released immediately on failure. Waiting for the expiry sweep
     * would technically self-heal, but it would take the slot out of circulation for
     * fifteen minutes for no reason, and during clinic hours that is a real
     * appointment lost.
     */
    let order
    try {
      order = await createOrder(clinic, {
        // From the database. Never from the request. And the clinic is passed
        // explicitly so the order is created against THAT clinic's Razorpay
        // account — the patient's money goes to them, never through us.
        amountPaise: appointment.amountPaise,
        receipt: appointment.code,
        notes: {
          appointment_id: String(appointment.id),
          appointment_code: appointment.code,
          patient_id: String(session.user.id),
          service: appointment.serviceName,
          date: appointment.date,
          time: appointment.startTime,
          mode,
        },
      })
    } catch (error) {
      console.error('[api/appointments] payment gateway refused the order:', error)

      await query(
        `UPDATE appointments
            SET status = 'cancelled',
                cancelled_at = NOW(),
                cancelled_by = 'system',
                cancel_reason = 'Payment gateway unavailable',
                hold_expires_at = NULL
          WHERE id = ? AND status = 'pending_payment'`,
        [appointment.id]
      )

      return NextResponse.json(
        {
          error:
            'The payment service is not responding just now, so we could not hold that slot. Please try again in a moment, or call the clinic to book.',
        },
        { status: 502 }   // 502 Bad Gateway — an upstream service failed, not us
      )
    }

    // Record the attempt immediately, before the patient has paid anything. If
    // they abandon checkout we still have the evidence that an order existed,
    // which is what makes reconciling against a Razorpay statement possible.
    await query(
      `INSERT INTO payments (clinic_id, appointment_id, provider, razorpay_order_id, amount_paise, currency, status)
       VALUES (?, ?, 'razorpay', ?, ?, 'INR', 'created')`,
      [clinic.id, appointment.id, order.id, appointment.amountPaise]
    )

    // ------------------------------------------------------- 5. respond
    return NextResponse.json(
      {
        appointment: {
          id: appointment.id,
          code: appointment.code,
          date: appointment.date,
          startTime: appointment.startTime,
          endTime: appointment.endTime,
          label: appointment.label,
          mode: appointment.mode,
          amountPaise: appointment.amountPaise,
          serviceName: appointment.serviceName,
          // How long the patient has to pay before the slot is released.
          holdMinutes: appointment.holdMinutes,
          // The exact deadline, as an ISO timestamp. Sending the moment rather than
          // a duration means the countdown in the browser is anchored to the SERVER's
          // clock — which is the one the expiry is actually enforced against. A
          // patient whose laptop clock is ten minutes fast would otherwise see a
          // countdown that disagrees with reality.
          holdExpiresAt: appointment.holdExpiresAt,
        },
        order: {
          id: order.id,
          amount: order.amount,
          currency: order.currency,
        },
        // Only the PUBLIC key id crosses to the browser. The secret stays here.
        razorpayKeyId: publicKeyId(clinic),
        // Tells the wizard to skip Razorpay Checkout and confirm directly, so
        // the app is usable before any payment keys are configured.
        demoMode: isDemoMode(clinic),
        prefill: {
          name: session.user.name,
          email: session.user.email,
          contact: session.user.phone || '',
        },
        clinicName: clinic.name,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[api/appointments] error:', error)
    return NextResponse.json(
      { error: 'Could not hold that slot. Please try again.' },
      { status: 500 }
    )
  }
}

/**
 * ============================================================================
 *  GET /api/appointments — the signed-in patient's own appointments
 * ============================================================================
 *  Note `WHERE patient_id = session.user.id`. The id comes from the signed
 *  session cookie, never from a query parameter.
 *
 *  If this accepted ?patientId=123 instead, anyone could read anybody's medical
 *  appointments by changing a number in the URL. That flaw has a name — insecure
 *  direct object reference — and it is one of the most common serious bugs in
 *  real applications. The defence is simple and absolute: derive identity from
 *  the session, never from user input.
 * ============================================================================
 */
export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  const clinic = await getCurrentClinic()
  if (!clinic) return NextResponse.json({ error: 'Unknown clinic' }, { status: 404 })

  const appointments = await query(
    `SELECT a.id, a.code, a.appointment_date, a.start_time, a.end_time, a.mode,
            a.status, a.amount_paise, a.room_id, s.name AS service_name
       FROM appointments a
       JOIN services s ON s.id = a.service_id
      WHERE a.clinic_id = ? AND a.patient_id = ?
      ORDER BY a.appointment_date DESC, a.start_time DESC
      LIMIT 50`,
    [clinic.id, session.user.id]
  )

  return NextResponse.json({ appointments })
}
