import { query, queryOne } from '@/lib/db'

/**
 * ============================================================================
 *  SESSION PACKAGES — a course of treatment, prepaid
 * ============================================================================
 *
 *  WHAT A PACKAGE IS, IN CLINICAL TERMS
 *  ------------------------------------
 *  Physiotherapy is not a visit, it is a course. Nobody recovers from a frozen
 *  shoulder in one appointment — it is eight to twelve sessions over six weeks,
 *  and the treatment only works if they are close together. So clinics sell the
 *  course: ten sessions for the price of eight, valid ninety days.
 *
 *  That is not a discount gimmick. It aligns the money with the medicine. A
 *  patient who has paid for ten sessions turns up for session seven on a wet
 *  Tuesday when they are feeling better; a patient paying per visit does not, and
 *  relapses. The package is the single most important commercial mechanism in the
 *  business, and the clinic's revenue per patient rises severalfold with it.
 *
 *  THE ONE DESIGN DECISION THAT MATTERS: SESSIONS USED IS DERIVED
 *  -------------------------------------------------------------
 *  There is no `sessions_used` counter. The number of sessions spent is counted
 *  from the appointments pointing at the package:
 *
 *      SELECT COUNT(*) FROM appointments
 *       WHERE patient_package_id = ?
 *         AND (status <> 'cancelled' OR package_session_forfeited = 1)
 *
 *  The second condition is the clinic's no-show policy. A session cancelled at
 *  9:55 for a 10:00 appointment, or simply not attended, is FORFEITED — the
 *  therapist's half-hour was spent either way. Without it a prepaid patient could
 *  cancel at the last minute forever at no cost, and the slot would be dead every
 *  time.
 *
 *  A counter would be faster and would be wrong. It is a second source of truth
 *  about the same fact, and the two drift the first time a booking is cancelled
 *  during a failure, or an appointment is deleted, or two requests decrement at
 *  once. Then a patient has "2 sessions left" and four appointments booked, and
 *  somebody has to work out which is real.
 *
 *  Deriving it means the appointments ARE the record. The same reasoning as
 *  subscription status in lib/subscriptionLifecycle.js: compute the thing that
 *  matters from the rows that cannot lie.
 *
 *  CONCURRENCY
 *  -----------
 *  Deriving on read is not enough on its own — two people booking the last
 *  session simultaneously would both count nine used and both proceed. So
 *  `consumeSession` takes a row lock on the package before counting, inside the
 *  caller's transaction. Exactly the pattern that stops double-booking a slot in
 *  lib/slots.js.
 * ============================================================================
 */

/* ========================================================================== */
/*  READING                                                                   */
/* ========================================================================== */

/**
 * Every package a patient holds, with sessions remaining worked out.
 *
 * `status` in the database only ever says what a human decided (cancelled,
 * refunded). Whether a package is USABLE is decided here, from the count and the
 * expiry date — so a package cannot be usable-looking and empty.
 */
export async function patientPackages(clinicId, patientId) {
  const rows = await query(
    `SELECT pp.*,
            s.name AS service_name,
            (SELECT COUNT(*) FROM appointments a
              WHERE a.patient_package_id = pp.id
                AND (a.status <> 'cancelled' OR a.package_session_forfeited = 1))
              AS sessions_used
       FROM patient_packages pp
       LEFT JOIN services s ON s.id = pp.service_id
      WHERE pp.clinic_id = ? AND pp.patient_id = ?
      ORDER BY pp.purchased_at DESC`,
    [clinicId, patientId]
  )

  return rows.map(decorate)
}

/**
 * The packages a patient could actually spend on a given treatment, right now.
 *
 * Used by the booking flow. Ordered so the package closest to expiring is spent
 * first, which is what a patient would want if asked — and avoids the situation
 * where sessions expire unused while a later package is drawn down.
 */
export async function usablePackages(clinicId, patientId, serviceId = null) {
  const all = await patientPackages(clinicId, patientId)

  return all
    .filter((p) => p.isUsable)
    // A package tied to a service can only be spent on that service. One with no
    // service (a general block of sessions) can be spent on anything.
    .filter((p) => !p.service_id || !serviceId || Number(p.service_id) === Number(serviceId))
    .sort((a, b) => {
      if (a.expires_at && b.expires_at) return new Date(a.expires_at) - new Date(b.expires_at)
      if (a.expires_at) return -1
      if (b.expires_at) return 1
      return a.id - b.id
    })
}

/** Adds the derived fields every caller wants. */
function decorate(row) {
  const used = Number(row.sessions_used) || 0
  const total = Number(row.sessions_total) || 0
  const remaining = Math.max(0, total - used)

  const expired = Boolean(row.expires_at) && new Date(row.expires_at) < startOfToday()
  const closed = ['cancelled', 'refunded'].includes(row.status)

  return {
    ...row,
    sessionsUsed: used,
    sessionsTotal: total,
    sessionsRemaining: remaining,
    isExpired: expired,
    isUsedUp: remaining === 0,
    isUsable: !closed && !expired && remaining > 0,
    // What to show on a card. "3 of 10 used" reads better than either number alone.
    label: `${used} of ${total} used`,
    pricePerSession: total > 0 ? Math.round(Number(row.price_paise) / total) : 0,
  }
}

/**
 * Midnight today.
 *
 * A package expiring today is still usable today — comparing against `new Date()`
 * would make it expire at whatever time of day the row was created, which is
 * arbitrary and would occasionally rob a patient of a session they had paid for.
 */
function startOfToday() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/** One patient's total remaining sessions, for a badge. */
export async function remainingSessions(clinicId, patientId) {
  const usable = (await patientPackages(clinicId, patientId)).filter((p) => p.isUsable)
  return usable.reduce((total, p) => total + p.sessionsRemaining, 0)
}

/* ========================================================================== */
/*  SPENDING A SESSION                                                        */
/* ========================================================================== */

/**
 * Claim one session from a package, inside an existing transaction.
 *
 * MUST be called with a `tx` from lib/db.js `transaction()`, because the lock it
 * takes is only held for the life of that transaction. Called outside one, the
 * lock is released immediately and the check below becomes decorative.
 *
 * @param {object} tx           the transaction handle
 * @param {number} clinicId
 * @param {number} patientId
 * @param {number} packageId    the patient_packages row
 * @param {number|null} serviceId  the treatment being booked
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function consumeSession(tx, { clinicId, patientId, packageId, serviceId }) {
  /**
   * FOR UPDATE takes the row lock. Any second request trying to spend from the
   * same package waits here until this transaction commits or rolls back, and
   * then counts again — seeing this booking. Without it, two requests both read
   * "9 used, 1 left" and both book, and the clinic has given away an eleventh
   * session on a ten-session package.
   */
  const [rows] = await tx.execute(
    `SELECT id, patient_id, service_id, sessions_total, status, expires_at
       FROM patient_packages
      WHERE id = ? AND clinic_id = ?
      FOR UPDATE`,
    [packageId, clinicId]
  )
  const pkg = rows[0]

  if (!pkg) return { ok: false, error: 'That package could not be found.' }
  if (Number(pkg.patient_id) !== Number(patientId)) {
    // Belongs to a different patient. Worth being blunt in the log: an id from a
    // request body reached a package that is not the caller's.
    console.error(`[packages] package ${packageId} does not belong to patient ${patientId}`)
    return { ok: false, error: 'That package belongs to a different patient.' }
  }
  if (['cancelled', 'refunded'].includes(pkg.status)) {
    return { ok: false, error: 'That package is no longer active.' }
  }
  if (pkg.expires_at && new Date(pkg.expires_at) < startOfToday()) {
    return { ok: false, error: 'That package has expired.' }
  }
  if (pkg.service_id && serviceId && Number(pkg.service_id) !== Number(serviceId)) {
    return { ok: false, error: 'That package cannot be used for this treatment.' }
  }

  const [[counted]] = await tx.execute(
    `SELECT COUNT(*) AS used FROM appointments
      WHERE patient_package_id = ?
        AND (status <> 'cancelled' OR package_session_forfeited = 1)`,
    [packageId]
  )

  const remaining = Number(pkg.sessions_total) - Number(counted.used)
  if (remaining <= 0) {
    return { ok: false, error: 'That package has no sessions left.' }
  }

  return { ok: true, remainingAfter: remaining - 1 }
}

/**
 * Bring a package's stored status into line with reality.
 *
 * Purely for display and reporting — nothing depends on it, exactly as with
 * clinic subscription status. Call it after booking or cancelling so the admin
 * list does not show "active" against a package with nothing left in it.
 */
export async function refreshPackageStatus(clinicId, packageId) {
  const pkg = await queryOne(
    `SELECT pp.*,
            (SELECT COUNT(*) FROM appointments a
              WHERE a.patient_package_id = pp.id
                AND (a.status <> 'cancelled' OR a.package_session_forfeited = 1))
              AS sessions_used
       FROM patient_packages pp
      WHERE pp.id = ? AND pp.clinic_id = ?`,
    [packageId, clinicId]
  )
  if (!pkg) return

  // A human decision is never overwritten by an automatic one.
  if (['cancelled', 'refunded'].includes(pkg.status)) return

  const view = decorate(pkg)
  const derived = view.isUsedUp ? 'used_up' : view.isExpired ? 'expired' : 'active'

  if (derived !== pkg.status) {
    await query('UPDATE patient_packages SET status = ? WHERE id = ? AND clinic_id = ?', [
      derived,
      packageId,
      clinicId,
    ])
  }
}

/* ========================================================================== */
/*  THE CLINIC'S OFFERINGS                                                    */
/* ========================================================================== */

/** The packages a clinic sells. `activeOnly` for anything patient-facing. */
export async function clinicPackages(clinicId, { activeOnly = false } = {}) {
  return query(
    `SELECT p.*, s.name AS service_name,
            (SELECT COUNT(*) FROM patient_packages pp WHERE pp.package_id = p.id) AS times_sold
       FROM packages p
       LEFT JOIN services s ON s.id = p.service_id
      WHERE p.clinic_id = ? ${activeOnly ? 'AND p.is_active = 1' : ''}
      ORDER BY p.sort_order, p.price_paise`,
    [clinicId]
  )
}

/**
 * What a package saves against paying per visit.
 *
 * Shown on the sell screen and to the patient, because "₹6,000" means nothing on
 * its own and "save ₹1,600" is the entire reason anybody buys one.
 */
export function packageSaving(pkg, servicePricePaise) {
  if (!servicePricePaise) return null
  const perVisit = Number(servicePricePaise) * Number(pkg.sessions_count)
  const saving = perVisit - Number(pkg.price_paise)
  if (saving <= 0) return null
  return { perVisitTotal: perVisit, saving, percent: Math.round((saving / perVisit) * 100) }
}
