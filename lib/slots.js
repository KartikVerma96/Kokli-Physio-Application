import { query, queryOne, transaction, isDuplicateError } from '@/lib/db'
import { todayISO, nowTime, addDaysISO, weekdayOf, toMinutes, toTimeString } from '@/lib/utils'
import { consumeSession } from '@/lib/packages'

/**
 * ============================================================================
 *  THE SLOT ENGINE
 * ============================================================================
 *
 *  Given a clinic, a date, a service and whether the patient wants online or
 *  in-clinic, this answers: which times can actually be booked?
 *
 *  THE KEY IDEA: SLOTS ARE CALCULATED, NOT STORED
 *  ---------------------------------------------
 *  The naive design is a `slots` table with one row per bookable time. It falls
 *  apart immediately: you would generate rows months ahead, regenerate them
 *  forever, and rewrite thousands every time a clinic changes its hours — times
 *  however many clinics are on the platform.
 *
 *  Instead the database stores RULES ("Tuesdays, 9am to 1pm, 30-minute steps")
 *  and this file generates the slots on demand for the single day a patient is
 *  looking at. Availability extends infinitely into the future, and changing the
 *  working week is one UPDATE.
 *
 *  A slot survives to the patient only if it passes all five tests:
 *    1. It sits inside a working window for that weekday.
 *    2. The whole service fits before that window closes.
 *    3. It does not overlap an existing appointment.
 *    4. It does not overlap a holiday or blocked period.
 *    5. It is far enough in the future to give reasonable notice.
 *
 *  MULTI-TENANT NOTE
 *  -----------------
 *  Every function takes `clinicId` first and every query filters on it. The
 *  booking policy (how far ahead, how much notice, how long a hold lasts) now
 *  comes from the CLINIC row rather than a global config file, because those are
 *  business decisions each clinic makes for itself.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/*  BOOKING POLICY                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Pull the booking rules off a clinic row, with sane fallbacks.
 *
 * The fallbacks matter: a clinic row could be partially filled during
 * onboarding, and a NULL `booking_hold_mins` must not become a zero-minute hold
 * that releases every slot instantly.
 */
export function bookingPolicy(clinic) {
  return {
    maxDaysAhead: clinic?.booking_max_days_ahead ?? 30,
    minNoticeMinutes: clinic?.booking_min_notice_mins ?? 60,
    holdMinutes: clinic?.booking_hold_mins ?? 15,
    freeCancellationHours: clinic?.free_cancellation_hours ?? 12,
  }
}

/* -------------------------------------------------------------------------- */
/*  WHO IS THE PHYSIO?                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Most clinics on the platform have one physiotherapist, so the patient is not
 * asked to choose. Everything downstream takes a physioId, so growing into a
 * multi-therapist clinic means adding a picker — not rewriting the engine.
 */
export async function getDefaultPhysioId(clinicId) {
  const physio = await queryOne(
    `SELECT id FROM users
      WHERE clinic_id = ? AND role = 'physio' AND is_active = 1
      ORDER BY id ASC LIMIT 1`,
    [clinicId]
  )
  if (physio) return physio.id

  // Fall back to an admin, so a clinic that has not added a physio account yet
  // still has a bookable diary rather than a broken booking page.
  const admin = await queryOne(
    `SELECT id FROM users WHERE clinic_id = ? AND role = 'admin' ORDER BY id ASC LIMIT 1`,
    [clinicId]
  )
  return admin?.id ?? null
}

/* -------------------------------------------------------------------------- */
/*  RELEASING ABANDONED SLOTS                                                 */
/* -------------------------------------------------------------------------- */

/**
 * When a patient picks 10:00 AM we immediately create the appointment with
 * status 'pending_payment' so nobody else can take it while they are typing
 * their card details. That hold has to expire, or one abandoned checkout would
 * block the slot forever.
 *
 * This runs before every availability lookup and every booking. It is a single
 * cheap UPDATE against an index, and doing it here means the platform needs no
 * cron job to stay correct — the cleanup happens as a side effect of people
 * using the site.
 *
 * Setting status to 'cancelled' also releases the database-level slot lock,
 * because the generated `active_slot_key` column becomes NULL.
 *
 * Note this is deliberately NOT scoped to one clinic: expired holds anywhere are
 * garbage, and cleaning all of them in one indexed UPDATE is cheaper than doing
 * it per tenant. It cannot leak anything — it only ever cancels rows that have
 * already timed out.
 */
export async function releaseExpiredHolds() {
  const result = await query(
    `UPDATE appointments
        SET status = 'cancelled',
            cancelled_at = NOW(),
            cancelled_by = 'system',
            cancel_reason = 'Payment not completed in time'
      WHERE status = 'pending_payment'
        AND hold_expires_at IS NOT NULL
        AND hold_expires_at < NOW()`
  )
  return result.affectedRows || 0
}

/* -------------------------------------------------------------------------- */
/*  GENERATING SLOTS FOR ONE DAY                                              */
/* -------------------------------------------------------------------------- */

/**
 * @returns {Promise<{date, slots: Array<{startTime, endTime, label}>, reason?: string}>}
 *
 * `reason` explains an empty list, so the UI can say something useful — "the
 * clinic is closed on this day" beats a blank panel.
 */
export async function getAvailableSlots({ clinic, physioId, date, serviceId, mode = 'clinic' }) {
  const clinicId = clinic?.id
  const policy = bookingPolicy(clinic)
  const today = todayISO()
  const empty = (reason) => ({ date, slots: [], reason })

  // ------------------------------------------------------- guard the inputs
  if (!clinicId) return empty('Unknown clinic')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return empty('Invalid date')
  if (date < today) return empty('That date has already passed')
  if (date > addDaysISO(today, policy.maxDaysAhead)) {
    return empty(`Booking opens ${policy.maxDaysAhead} days in advance`)
  }
  if (!['online', 'clinic', 'home'].includes(mode)) return empty('Invalid consultation mode')

  await releaseExpiredHolds()

  // -------------------------------------------------------- the service
  const service = await queryOne(
    `SELECT id, duration_minutes, available_online, available_clinic, available_home
       FROM services
      WHERE id = ? AND clinic_id = ? AND is_active = 1`,
    [serviceId, clinicId]
  )
  if (!service) return empty('That service is not available')
  if (mode === 'online' && !service.available_online) {
    return empty('This treatment needs to be done in the clinic')
  }
  if (mode === 'clinic' && !service.available_clinic) {
    return empty('This service is offered online only')
  }
  if (mode === 'home' && !service.available_home) {
    return empty('This treatment is not offered as a home visit')
  }

  /**
   * A home visit occupies more of the therapist's day than the treatment lasts,
   * because they have to get there and back. The travel buffer is added to the
   * duration, which means the existing overlap test blocks the whole trip without
   * needing to know anything about travel.
   *
   * Without it a clinic books two home visits back to back across a city and the
   * second one is late, every time.
   */
  const duration =
    mode === 'home'
      ? service.duration_minutes + (Number(clinic.home_travel_buffer_mins) || 0)
      : service.duration_minutes

  // ---------------------------------------------- the working windows
  // A rule applies if its mode is 'both' or matches exactly what was asked for.
  // That is what lets Sunday be online-only.
  /**
   * `mode = 'both'` means clinic OR online — its meaning predates home visits and
   * is left alone so no existing row changes behaviour. A home visit therefore
   * needs its own window, which is correct anyway: the therapist is out of the
   * building and cannot be treating anybody in it.
   */
  const rules = await query(
    `SELECT start_time, end_time, slot_minutes, capacity
       FROM availability_rules
      WHERE clinic_id = ?
        AND physio_id = ?
        AND weekday = ?
        AND is_active = 1
        AND (mode = ? OR (mode = 'both' AND ? IN ('clinic', 'online')))
      ORDER BY start_time`,
    [clinicId, physioId, weekdayOf(date), mode, mode]
  )
  if (rules.length === 0) {
    return empty(
      mode === 'online'
        ? 'No online clinic on this day'
        : mode === 'home'
          ? 'No home visits on this day'
          : 'The clinic is closed on this day'
    )
  }

  // ------------------------------------------- appointments already booked
  const booked = await query(
    `SELECT start_time, end_time
       FROM appointments
      WHERE clinic_id = ?
        AND physio_id = ?
        AND appointment_date = ?
        AND status IN ('pending_payment', 'confirmed', 'in_progress', 'completed')`,
    [clinicId, physioId, date]
  )

  // ------------------------------------------------- holidays and leave
  const timeOff = await query(
    `SELECT start_time, end_time, reason
       FROM time_off
      WHERE clinic_id = ? AND physio_id = ? AND off_date = ?`,
    [clinicId, physioId, date]
  )

  // A row with no times means the whole day is off, and nothing else matters.
  const wholeDayOff = timeOff.find((t) => !t.start_time && !t.end_time)
  if (wholeDayOff) return empty(wholeDayOff.reason || 'Not available on this day')

  /**
   * Two different kinds of obstacle, and they no longer behave the same way.
   *
   * TIME OFF is absolute: the therapist is not there, so no capacity exists.
   * An APPOINTMENT only uses up ONE of the slot's places — with capacity 3 the
   * slot stays open until three overlap.
   *
   * The original code treated any overlap as a clash, which is exactly the 1:1
   * assumption being removed here.
   */
  const closed = timeOff.map((t) => ({ from: toMinutes(t.start_time), to: toMinutes(t.end_time) }))
  const taken = booked.map((b) => ({ from: toMinutes(b.start_time), to: toMinutes(b.end_time) }))

  // Only relevant for today. `earliest` is the first minute we will accept.
  const earliest = date === today ? toMinutes(nowTime(clinic)) + policy.minNoticeMinutes : -Infinity

  // ------------------------------------------------------- generate and sift
  const slots = []
  const seen = new Set() // two overlapping rules could produce the same time

  for (const rule of rules) {
    const windowStart = toMinutes(rule.start_time)
    const windowEnd = toMinutes(rule.end_time)
    const step = rule.slot_minutes || 30

    const capacity = Math.max(1, Number(rule.capacity) || 1)

    for (let start = windowStart; start + duration <= windowEnd; start += step) {
      const end = start + duration

      if (start < earliest) continue
      if (seen.has(start)) continue

      // The standard interval overlap test. Two ranges overlap unless one
      // finishes before the other begins.
      if (closed.some((b) => start < b.to && b.from < end)) continue

      // How many of this slot's places are already used. Full only when the
      // count reaches capacity — which for capacity 1 is the old behaviour
      // exactly, and that is deliberate: no existing clinic changes.
      const overlapping = taken.filter((b) => start < b.to && b.from < end).length
      if (overlapping >= capacity) continue

      seen.add(start)
      slots.push({
        startTime: toTimeString(start),
        endTime: toTimeString(end),
        label: formatSlotLabel(start),
        // Useful to the reception desk: "2 of 3 places left" is the difference
        // between offering an alternative and not bothering.
        placesLeft: capacity - overlapping,
      })
    }
  }

  slots.sort((a, b) => a.startTime.localeCompare(b.startTime))

  if (slots.length === 0) {
    return empty(
      date === today ? 'No more slots left today — try tomorrow' : 'Fully booked on this day'
    )
  }

  return { date, slots }
}

function formatSlotLabel(minutes) {
  const h24 = Math.floor(minutes / 60)
  const m = minutes % 60
  const suffix = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

/* -------------------------------------------------------------------------- */
/*  THE DATE STRIP                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The horizontal row of dates at the top of the booking calendar needs to know
 * which days are worth tapping, so closed days can be greyed out.
 *
 * This deliberately does NOT run the full slot calculation for every day — that
 * would be 30 days x 4 queries. It asks two questions in two queries and
 * combines them in memory.
 *
 * A day shown as open can still turn out to be fully booked. That is a
 * deliberate trade-off: this runs on every page load, and the true answer
 * arrives the moment the patient taps a date.
 */
export async function getBookableDates({ clinic, physioId, mode = 'clinic', days = 14 }) {
  const clinicId = clinic?.id
  if (!clinicId) return []

  const today = todayISO()

  const rules = await query(
    `SELECT DISTINCT weekday
       FROM availability_rules
      WHERE clinic_id = ? AND physio_id = ? AND is_active = 1
        AND (mode = ? OR (mode = 'both' AND ? IN ('clinic', 'online')))`,
    [clinicId, physioId, mode, mode]
  )
  const workingWeekdays = new Set(rules.map((r) => r.weekday))

  const lastDate = addDaysISO(today, days)
  const offDays = await query(
    `SELECT off_date FROM time_off
      WHERE clinic_id = ? AND physio_id = ?
        AND off_date BETWEEN ? AND ?
        AND start_time IS NULL AND end_time IS NULL`,
    [clinicId, physioId, today, lastDate]
  )
  const closedDates = new Set(offDays.map((d) => String(d.off_date).slice(0, 10)))

  const result = []
  for (let i = 0; i < days; i++) {
    const date = addDaysISO(today, i)
    result.push({
      date,
      isOpen: workingWeekdays.has(weekdayOf(date)) && !closedDates.has(date),
      isToday: date === today,
    })
  }
  return result
}

/* -------------------------------------------------------------------------- */
/*  BOOKING A SLOT                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Reserve a slot by inserting an appointment with status 'pending_payment'.
 *
 * THE RACE CONDITION, AND THE TWO THINGS THAT STOP IT
 * ---------------------------------------------------
 * Two patients tap 10:00 AM in the same second. Both check "is 10:00 free?",
 * both get "yes", both insert. Checking in JavaScript can never fix this,
 * because there is always a gap between the check and the insert.
 *
 * Defence 1 — a transaction with SELECT … FOR UPDATE. That locks the rows this
 *   query examined until we commit, so the second request blocks until the first
 *   has finished and then correctly sees the clash. This also catches PARTIAL
 *   overlaps: a 60-minute booking at 10:00 must block a 30-minute one at 10:30,
 *   even though the start times differ.
 *
 * Defence 2 — the UNIQUE index on appointments.active_slot_key, enforced by
 *   MySQL itself, which holds even if someone later writes a second booking path
 *   and forgets the transaction.
 *
 * Two independent mechanisms for one bug is not over-engineering when the
 * failure mode is two people in the same appointment.
 */
export async function holdSlot({
  clinic,
  physioId,
  patientId,
  serviceId,
  date,
  startTime,
  mode,
  patientNotes,
  painLevel,
  roomId,
  code,

  /* ------------------------------------------- the desk-booking additions */
  /**
   * These four are all absent for a patient booking themselves online, and the
   * behaviour in that case is exactly what it always was: hold the slot as
   * 'pending_payment' and release it if nobody pays.
   *
   * They exist because a clinic does not work that way. Reception books a patient
   * who telephoned, the patient comes in, is treated, and pays on the way out —
   * or the session comes out of a package they bought last month. Neither of those
   * is a fifteen-minute race against a payment gateway.
   */

  // The patient_packages row this session is drawn from. When set, the session is
  // free at the point of booking because it was paid for when the package was
  // sold, and one session is claimed under a row lock.
  patientPackageId = null,

  // The staff member creating it. NULL means the patient booked it themselves.
  bookedBy = null,

  // 'pending_payment' (the online default) or 'confirmed' (a desk booking, which
  // is a commitment the moment reception makes it).
  status = 'pending_payment',

  // Where the therapist is going, for mode 'home'. Copied onto the appointment
  // rather than read from the profile later, because people move.
  visitAddress = null,

  // Whether to set hold_expires_at. A desk booking must never evaporate because
  // nobody paid within fifteen minutes — the patient is standing there.
  hold = true,
}) {
  const clinicId = clinic.id
  const policy = bookingPolicy(clinic)

  await releaseExpiredHolds()

  const service = await queryOne(
    `SELECT id, name, duration_minutes, price_paise, home_price_paise,
            available_online, available_clinic, available_home
       FROM services WHERE id = ? AND clinic_id = ? AND is_active = 1`,
    [serviceId, clinicId]
  )
  if (!service) return { ok: false, error: 'That service is no longer available' }
  if (mode === 'online' && !service.available_online) {
    return { ok: false, error: 'This treatment has to be done in the clinic' }
  }
  if (mode === 'clinic' && !service.available_clinic) {
    return { ok: false, error: 'This service is offered online only' }
  }
  if (mode === 'home' && !service.available_home) {
    return { ok: false, error: 'This treatment is not offered as a home visit' }
  }
  if (mode === 'home' && !String(visitAddress || '').trim()) {
    return { ok: false, error: 'A home visit needs an address to go to.' }
  }

  /**
   * Re-run the availability check on the server, ignoring anything the browser
   * claimed. The patient's browser said this slot was free, but the browser is
   * under the patient's control — they could have edited the request, or the
   * page could simply be five minutes stale. Never trust the client for
   * anything that must be true.
   */
  const { slots } = await getAvailableSlots({ clinic, physioId, date, serviceId, mode })
  const normalisedStart = startTime.length === 5 ? `${startTime}:00` : startTime
  const requested = slots.find((s) => s.startTime === normalisedStart)
  if (!requested) {
    return { ok: false, error: 'That time is no longer available. Please pick another.' }
  }

  /**
   * How many patients this window takes.
   *
   * Read from the rule rather than from `requested.placesLeft`, because
   * placesLeft was computed a moment ago outside the transaction and is exactly
   * the sort of stale number the lock below exists to stop us trusting. The
   * capacity of a window, on the other hand, is a setting — it does not change
   * while somebody is booking.
   */
  const capacityRow = await queryOne(
    `SELECT MAX(capacity) AS capacity
       FROM availability_rules
      WHERE clinic_id = ? AND physio_id = ? AND weekday = ? AND is_active = 1
        AND (mode = ? OR (mode = 'both' AND ? IN ('clinic', 'online')))
        AND start_time <= ? AND end_time >= ?`,
    [clinicId, physioId, weekdayOf(date), mode, mode, requested.startTime, requested.endTime]
  )
  const capacity = Math.max(1, Number(capacityRow?.capacity) || 1)

  if (!['pending_payment', 'confirmed'].includes(status)) {
    return { ok: false, error: 'A new appointment can only be held or confirmed.' }
  }

  try {
    const appointment = await transaction(async (tx) => {
      /**
       * Claim the package session FIRST, before the slot is taken.
       *
       * Order matters. Claiming the session inside the same transaction as the
       * insert means a patient can never end up with an eleventh appointment on a
       * ten-session package: consumeSession takes a row lock on the package, so a
       * second simultaneous booking waits and then counts this one.
       *
       * Doing it before the slot check also means a package with nothing left
       * fails without having briefly locked a slot somebody else wanted.
       */
      if (patientPackageId) {
        const claim = await consumeSession(tx, {
          clinicId,
          patientId,
          packageId: patientPackageId,
          serviceId,
        })
        if (!claim.ok) throw new PackageError(claim.error)
      }

      /**
       * FIRST, take one well-known lock that every booking for this therapist
       * queues behind.
       *
       * ---------------------------------------------------------------------
       * WHY: THE RANGE SCAN BELOW CAN DEADLOCK, AND DID
       * ---------------------------------------------------------------------
       * `SELECT ... FOR UPDATE` over a date range does not lock one row — InnoDB
       * takes gap locks across the index. Two transactions scanning overlapping
       * ranges can acquire those gaps in different orders, form a cycle, and one
       * gets ER_LOCK_DEADLOCK.
       *
       * With one patient per slot this almost never happened: only two requests
       * ever contend for the same time. The day capacity went to three, four
       * simultaneous bookings started deadlocking and patients whose slot was
       * genuinely free were getting a 500.
       *
       * Retrying is the textbook answer and lib/db.js does retry — but retries
       * only help if the collision is unlucky, and here it was structural: the
       * losers all retried into each other again.
       *
       * Locking ONE deterministic row first removes the cycle entirely. Every
       * booking for this physiotherapist waits at the same door, in arrival order,
       * so there is no second lock for anybody to be holding. Deadlock stops being
       * unlikely and becomes impossible.
       *
       * The cost is that two bookings for the SAME therapist serialise for a few
       * milliseconds. For a diary that is a rounding error, and the alternative is
       * an error message to a patient trying to give the clinic money.
       */
      await tx.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [physioId])

      /**
       * Now work out which places in this slot are free.
       *
       * FOR UPDATE is what makes it safe: a competing request blocks here until
       * this transaction finishes, then counts again and sees this booking.
       * Checking in JavaScript without the lock can never work, because there is
       * always a gap between the check and the insert.
       *
       * Note it selects `slot_seat` too. With capacity greater than one, "is
       * anything overlapping" is no longer the question — the question is which
       * seat is free.
       */
      const [clashes] = await tx.execute(
        `SELECT id, slot_seat FROM appointments
          WHERE clinic_id = ?
            AND physio_id = ?
            AND appointment_date = ?
            AND status IN ('pending_payment', 'confirmed', 'in_progress', 'completed')
            AND start_time < ?
            AND end_time > ?
          FOR UPDATE`,
        [clinicId, physioId, date, requested.endTime, requested.startTime]
      )

      if (clashes.length >= capacity) throw new SlotTakenError()

      /**
       * Take the lowest seat nobody is holding.
       *
       * Lowest rather than "count of clashes" because seats are freed out of
       * order: with three booked and the middle one cancelled, the count says 2
       * and seat 2 is occupied. Scanning for the first gap cannot get that wrong.
       *
       * If two requests somehow reach the same conclusion, the UNIQUE index on
       * active_slot_key — which now includes the seat — refuses the second, and
       * the catch below reports it as "just taken". Two independent mechanisms,
       * same as before.
       */
      const held = new Set(clashes.map((c) => Number(c.slot_seat)))
      let seat = 0
      while (held.has(seat)) seat++
      if (seat >= capacity) throw new SlotTakenError()

      /**
       * A package session costs nothing HERE.
       *
       * amount_paise is what this appointment is charged, and the money for a
       * package session changed hands when the package was sold. Copying the
       * service price in would double-count it in every revenue figure on the
       * admin dashboard.
       */
      const amountPaise = patientPackageId ? 0 : priceFor(service, mode)

      const [result] = await tx.execute(
        `INSERT INTO appointments
           (clinic_id, code, patient_id, physio_id, service_id, patient_package_id,
            booked_by, appointment_date, start_time, end_time, slot_seat, mode,
            visit_address, status, amount_paise, patient_notes, pain_level, room_id,
            hold_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ${hold ? 'DATE_ADD(NOW(), INTERVAL ? MINUTE)' : 'NULL'})`,
        [
          clinicId,
          code,
          patientId,
          physioId,
          serviceId,
          patientPackageId,
          bookedBy,
          date,
          requested.startTime,
          requested.endTime,
          seat,
          mode,
          mode === 'home' ? visitAddress || null : null,
          status,
          amountPaise,
          patientNotes || null,
          painLevel === '' || painLevel === undefined ? null : painLevel,
          mode === 'online' ? roomId : null,
          ...(hold ? [policy.holdMinutes] : []),
        ]
      )

      return {
        id: result.insertId,
        code,
        date,
        startTime: requested.startTime,
        endTime: requested.endTime,
        label: requested.label,
        mode,
        amountPaise,
        serviceName: service.name,
        holdMinutes: hold ? policy.holdMinutes : null,
        status,
        patientPackageId,
      }
    })

    return { ok: true, appointment }
  } catch (error) {
    // A package problem is the caller's fault and has a useful message; say it.
    if (error instanceof PackageError) return { ok: false, error: error.message }
    if (error instanceof SlotTakenError || isDuplicateError(error)) {
      return { ok: false, error: 'Sorry, that time was just taken. Please pick another.' }
    }
    throw error
  }
}

/**
 * What a treatment costs in a given mode.
 *
 * A home visit is a different price, not a discount or a surcharge on the clinic
 * price: the difference is travel, which is a flat cost in the therapist's time.
 * A clinic wanting to charge ₹1,500 wants to charge ₹1,500, not 187.5% of ₹800.
 *
 * Falls back to the clinic price if no home price is set, so a service marked
 * available at home but never priced still books rather than booking for free.
 */
export function priceFor(service, mode) {
  if (mode === 'home' && service.home_price_paise != null) {
    return Number(service.home_price_paise)
  }
  return Number(service.price_paise)
}

/** Raised when a package cannot cover the session. Carries a message for the user. */
class PackageError extends Error {}

/** A private error type so the catch block can tell "taken" from a real fault. */
class SlotTakenError extends Error {
  constructor() {
    super('SLOT_TAKEN')
    this.name = 'SlotTakenError'
  }
}
