import { query, queryOne, safeLimit } from '@/lib/db'

/**
 * ============================================================================
 *  DATA ACCESS — every read the application performs
 * ============================================================================
 *
 *  THE ONE RULE
 *  ------------
 *  Every function here takes `clinicId` as its FIRST argument, and every query
 *  filters on it. No exceptions, including the functions where it looks
 *  redundant.
 *
 *  It genuinely is redundant in places. getAppointmentForUser already matches on
 *  a primary key, so adding `AND a.clinic_id = ?` cannot change which row comes
 *  back — the id is unique across the whole table. It is there anyway, because:
 *
 *    * A rule with exceptions is a rule people forget. "Always scope by clinic"
 *      is followable; "scope by clinic unless the id is unique and you have
 *      thought it through" is not.
 *    * It turns a would-be data leak into an empty result. If a bug ever passed
 *      the wrong appointment id, the redundant filter is what stops clinic A
 *      reading clinic B's medical record.
 *    * It documents intent. A reader can see at a glance that this query is
 *      tenant-scoped.
 *
 *  In a multi-tenant medical application, cheap redundancy that converts a
 *  catastrophe into a 404 is worth having everywhere.
 *
 *  WHY THE AUTHORISATION LIVES IN THE SQL
 *  --------------------------------------
 *  Look at getAppointmentForUser: the "can this person see this?" test is part
 *  of the WHERE clause, not an `if` after the fetch. A future edit cannot
 *  accidentally drop it without also breaking the query, and the unauthorised
 *  row is never loaded into memory in the first place.
 * ============================================================================
 */

/* ========================================================================== */
/*  SERVICES                                                                  */
/* ========================================================================== */

export async function getActiveServices(clinicId) {
  return query(
    `SELECT id, slug, name, short_description, icon, duration_minutes,
            price_paise, home_price_paise,
            available_online, available_clinic, available_home
       FROM services
      WHERE clinic_id = ? AND is_active = 1
      ORDER BY sort_order, name`,
    [clinicId]
  )
}

export async function getServiceBySlug(clinicId, slug) {
  // mysql2 parses JSON columns automatically, so conditions_treated arrives as
  // a real JavaScript array — no JSON.parse needed.
  return queryOne(
    `SELECT * FROM services WHERE clinic_id = ? AND slug = ? AND is_active = 1`,
    [clinicId, slug]
  )
}

/** Used by the per-clinic sitemap. */
export async function getAllServiceSlugs(clinicId) {
  return query(
    `SELECT slug, updated_at FROM services WHERE clinic_id = ? AND is_active = 1`,
    [clinicId]
  )
}

/** All services including hidden ones — clinic staff only. */
export async function getAllServices(clinicId) {
  return query(`SELECT * FROM services WHERE clinic_id = ? ORDER BY sort_order, name`, [clinicId])
}

/* ========================================================================== */
/*  APPOINTMENTS                                                              */
/* ========================================================================== */

/**
 * Every appointment for one patient, newest first.
 *
 * Two things worth noticing:
 *
 *   - The JOIN pulls the service name from `services`, but the PRICE comes from
 *     appointments.amount_paise. Deliberate: if the clinic raises prices, this
 *     row must still show what the patient actually paid.
 *
 *   - The LEFT JOIN on payments uses a subquery to pick only the successful
 *     payment. A plain join would duplicate the appointment row once per payment
 *     attempt, so one failed card followed by a successful UPI would make the
 *     same appointment appear twice.
 */
export async function getPatientAppointments(clinicId, patientId, { limit = 100 } = {}) {
  return query(
    `SELECT a.*,
            s.name AS service_name,
            s.slug AS service_slug,
            s.icon AS service_icon,
            u.name AS physio_name,
            p.status AS payment_status,
            p.razorpay_payment_id,
            p.method AS payment_method,
            (n.id IS NOT NULL) AS has_notes
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN users u ON u.id = a.physio_id
       LEFT JOIN payments p
              ON p.id = (SELECT id FROM payments
                          WHERE appointment_id = a.id AND status = 'paid'
                          ORDER BY id DESC LIMIT 1)
       LEFT JOIN consultation_notes n ON n.appointment_id = a.id
      WHERE a.clinic_id = ? AND a.patient_id = ?
      ORDER BY a.appointment_date DESC, a.start_time DESC
      LIMIT ${safeLimit(limit)}`,
    [clinicId, patientId]
  )
}

/**
 * One appointment, but only if this user is allowed to see it.
 *
 * Three filters, and each blocks a different attack:
 *   clinic_id  — stops another CLINIC reading it
 *   patient_id — stops another PATIENT of the same clinic reading it
 *   the staff flag — lets the clinic's own physio and admin see any of theirs
 */
export async function getAppointmentForUser(clinicId, appointmentId, user) {
  const staff = ['admin', 'physio', 'platform'].includes(user.role)

  return queryOne(
    `SELECT a.*,
            s.name AS service_name, s.slug AS service_slug,
            s.duration_minutes, s.icon AS service_icon,
            pat.name AS patient_name, pat.email AS patient_email, pat.phone AS patient_phone,
            phy.name AS physio_name,
            pay.status AS payment_status, pay.razorpay_payment_id,
            pay.method AS payment_method, pay.created_at AS paid_at,
            -- Who took the money, for a desk payment. Meaningless online, and
            -- essential for cash: it is what makes the drawer reconcilable.
            taker.name AS collected_by_name,
            -- The package this session came out of, if any. When set there is
            -- deliberately nothing to collect.
            pp.name AS package_name,
            pp.sessions_total AS package_sessions_total
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN users pat ON pat.id = a.patient_id
       JOIN users phy ON phy.id = a.physio_id
       LEFT JOIN patient_packages pp ON pp.id = a.patient_package_id
       LEFT JOIN payments pay
              ON pay.id = (SELECT id FROM payments
                            WHERE appointment_id = a.id AND status = 'paid'
                            ORDER BY id DESC LIMIT 1)
       LEFT JOIN users taker ON taker.id = pay.collected_by
      WHERE a.id = ?
        AND a.clinic_id = ?
        AND (? = 1 OR a.patient_id = ?)`,
    [appointmentId, clinicId, staff ? 1 : 0, user.id]
  )
}

export async function getAppointmentNotes(clinicId, appointmentId) {
  return queryOne(
    `SELECT n.*, u.name AS physio_name
       FROM consultation_notes n
       JOIN users u ON u.id = n.physio_id
      WHERE n.clinic_id = ? AND n.appointment_id = ?`,
    [clinicId, appointmentId]
  )
}

/** The patient's next confirmed appointment, for the dashboard hero card. */
export async function getNextAppointment(clinicId, patientId) {
  return queryOne(
    `SELECT a.*, s.name AS service_name, s.icon AS service_icon
       FROM appointments a
       JOIN services s ON s.id = a.service_id
      WHERE a.clinic_id = ?
        AND a.patient_id = ?
        AND a.status IN ('confirmed', 'in_progress')
        AND (a.appointment_date > CURDATE()
             OR (a.appointment_date = CURDATE() AND a.end_time >= CURTIME()))
      ORDER BY a.appointment_date, a.start_time
      LIMIT 1`,
    [clinicId, patientId]
  )
}

/**
 * Every exercise ever prescribed to this patient, newest first.
 * This is what turns a clinic website into something a patient opens daily.
 */
export async function getPatientExercises(clinicId, patientId) {
  const rows = await query(
    `SELECT n.exercises_prescribed, n.created_at, s.name AS service_name
       FROM consultation_notes n
       JOIN appointments a ON a.id = n.appointment_id
       JOIN services s ON s.id = a.service_id
      WHERE n.clinic_id = ?
        AND a.patient_id = ?
        AND n.exercises_prescribed IS NOT NULL
      ORDER BY n.created_at DESC`,
    [clinicId, patientId]
  )
  return rows.filter((r) => Array.isArray(r.exercises_prescribed) && r.exercises_prescribed.length)
}

/* ========================================================================== */
/*  CLINIC ADMIN — DIARY AND LISTS                                            */
/* ========================================================================== */

/**
 * The appointment list with filters.
 *
 * NOTE ON BUILDING SQL DYNAMICALLY: the `conditions` array only ever receives
 * fixed strings that we wrote, and every VALUE goes into `params` as a `?`
 * placeholder. That distinction is what keeps this safe. Interpolating a
 * user-supplied value into the SQL string — even where it looks harmless — is
 * how SQL injection happens.
 *
 * Notice clinic_id is seeded into the conditions FIRST, before any caller-
 * supplied filter, so it can never be displaced by one.
 */
export async function getAdminAppointments(
  clinicId,
  { status, date, from, to, patientId, search, limit = 200 } = {}
) {
  const conditions = ['a.clinic_id = ?']
  const params = [clinicId]

  if (status) { conditions.push('a.status = ?'); params.push(status) }
  if (date) { conditions.push('a.appointment_date = ?'); params.push(date) }
  if (from) { conditions.push('a.appointment_date >= ?'); params.push(from) }
  if (to) { conditions.push('a.appointment_date <= ?'); params.push(to) }
  if (patientId) { conditions.push('a.patient_id = ?'); params.push(patientId) }
  if (search) {
    conditions.push('(pat.name LIKE ? OR pat.email LIKE ? OR a.code LIKE ? OR pat.phone LIKE ?)')
    const like = `%${search}%`
    params.push(like, like, like, like)
  }

  return query(
    `SELECT a.*,
            s.name AS service_name, s.icon AS service_icon,
            pat.name AS patient_name, pat.email AS patient_email, pat.phone AS patient_phone,
            pay.status AS payment_status,
            (n.id IS NOT NULL) AS has_notes
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN users pat ON pat.id = a.patient_id
       LEFT JOIN payments pay
              ON pay.id = (SELECT id FROM payments
                            WHERE appointment_id = a.id AND status = 'paid'
                            ORDER BY id DESC LIMIT 1)
       LEFT JOIN consultation_notes n ON n.appointment_id = a.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.appointment_date DESC, a.start_time DESC
      LIMIT ${safeLimit(limit)}`,
    [...params]
  )
}

/** Today's diary — the first thing clinic staff should see each morning. */
export async function getTodaysSchedule(clinicId, physioId) {
  return query(
    `SELECT a.*, s.name AS service_name, s.icon AS service_icon,
            pat.name AS patient_name, pat.phone AS patient_phone, pat.email AS patient_email,
            (n.id IS NOT NULL) AS has_notes
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN users pat ON pat.id = a.patient_id
       LEFT JOIN consultation_notes n ON n.appointment_id = a.id
      WHERE a.clinic_id = ?
        AND a.physio_id = ?
        AND a.appointment_date = CURDATE()
        AND a.status IN ('confirmed', 'in_progress', 'completed', 'no_show')
      ORDER BY a.start_time`,
    [clinicId, physioId]
  )
}

/**
 * The numbers on the clinic dashboard.
 *
 * Each count is a conditional SUM over the same scan. `SUM(condition)` works
 * because MySQL treats a true comparison as 1 and false as 0 — a neat and very
 * common SQL idiom worth knowing.
 */
export async function getAdminStats(clinicId) {
  const appointments = await queryOne(
    `SELECT
       SUM(appointment_date = CURDATE() AND status IN ('confirmed','in_progress')) AS today_count,
       SUM(appointment_date > CURDATE() AND status = 'confirmed') AS upcoming_count,
       SUM(status = 'completed') AS completed_count,
       SUM(status = 'cancelled') AS cancelled_count,
       SUM(status = 'no_show') AS no_show_count,
       SUM(status = 'pending_payment' AND hold_expires_at > NOW()) AS awaiting_payment_count,
       SUM(mode = 'online' AND status IN ('confirmed','completed')) AS online_count,
       SUM(mode = 'clinic' AND status IN ('confirmed','completed')) AS clinic_count,
       COUNT(*) AS total_count
     FROM appointments
     WHERE clinic_id = ?`,
    [clinicId]
  )

  const revenue = await queryOne(
    `SELECT
       COALESCE(SUM(amount_paise - refunded_paise), 0) AS total_paise,
       COALESCE(SUM(CASE WHEN MONTH(created_at) = MONTH(CURDATE())
                          AND YEAR(created_at) = YEAR(CURDATE())
                         THEN amount_paise - refunded_paise ELSE 0 END), 0) AS month_paise,
       COALESCE(SUM(CASE WHEN DATE(created_at) = CURDATE()
                         THEN amount_paise - refunded_paise ELSE 0 END), 0) AS today_paise,
       COUNT(*) AS paid_count
     FROM payments
     WHERE clinic_id = ? AND status IN ('paid', 'refunded')`,
    [clinicId]
  )

  const patients = await queryOne(
    `SELECT COUNT(*) AS total,
            SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) AS new_this_month
       FROM users WHERE clinic_id = ? AND role = 'patient'`,
    [clinicId]
  )

  const trend = await query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS bookings
       FROM appointments
      WHERE clinic_id = ?
        AND created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
        AND status <> 'cancelled'
      GROUP BY DATE(created_at)
      ORDER BY day`,
    [clinicId]
  )

  const popular = await query(
    `SELECT s.name, COUNT(*) AS bookings
       FROM appointments a
       JOIN services s ON s.id = a.service_id
      WHERE a.clinic_id = ?
        AND a.status IN ('confirmed', 'completed', 'in_progress')
      GROUP BY s.id, s.name
      ORDER BY bookings DESC
      LIMIT 5`,
    [clinicId]
  )

  return { appointments, revenue, patients, trend, popular }
}

/* ========================================================================== */
/*  CLINIC ADMIN — PATIENTS                                                   */
/* ========================================================================== */

export async function getPatients(clinicId, { search, limit = 200 } = {}) {
  const conditions = [`u.clinic_id = ?`, `u.role = 'patient'`]
  const params = [clinicId]

  if (search) {
    conditions.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)')
    const like = `%${search}%`
    params.push(like, like, like)
  }

  return query(
    `SELECT u.id, u.name, u.email, u.phone, u.image, u.created_at, u.google_id,
            pr.city, pr.date_of_birth, pr.gender,
            COUNT(a.id) AS appointment_count,
            MAX(CASE WHEN a.status = 'completed' THEN a.appointment_date END) AS last_visit,
            COALESCE(SUM(CASE WHEN a.status IN ('confirmed','completed','in_progress')
                              THEN a.amount_paise ELSE 0 END), 0) AS lifetime_paise
       FROM users u
       LEFT JOIN patient_profiles pr ON pr.user_id = u.id
       LEFT JOIN appointments a ON a.patient_id = u.id AND a.clinic_id = u.clinic_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY u.id, pr.city, pr.date_of_birth, pr.gender
      ORDER BY u.created_at DESC
      LIMIT ${safeLimit(limit)}`,
    [...params]
  )
}

/** One patient's full record — profile, history and clinical notes. */
export async function getPatientRecord(clinicId, patientId) {
  const patient = await queryOne(
    `SELECT u.id, u.name, u.email, u.phone, u.image, u.created_at, u.google_id, pr.*
       FROM users u
       LEFT JOIN patient_profiles pr ON pr.user_id = u.id
      WHERE u.id = ? AND u.clinic_id = ? AND u.role = 'patient'`,
    [patientId, clinicId]
  )
  if (!patient) return null

  const appointments = await query(
    `SELECT a.*, s.name AS service_name, (n.id IS NOT NULL) AS has_notes
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       LEFT JOIN consultation_notes n ON n.appointment_id = a.id
      WHERE a.clinic_id = ? AND a.patient_id = ?
      ORDER BY a.appointment_date DESC, a.start_time DESC`,
    [clinicId, patientId]
  )

  // Pain score over time is the single most useful chart in a physio clinic: it
  // is the objective evidence that treatment is working.
  const painHistory = await query(
    `SELECT a.appointment_date, n.pain_level_before, n.pain_level_after
       FROM consultation_notes n
       JOIN appointments a ON a.id = n.appointment_id
      WHERE a.clinic_id = ? AND a.patient_id = ? AND n.pain_level_before IS NOT NULL
      ORDER BY a.appointment_date`,
    [clinicId, patientId]
  )

  return { patient, appointments, painHistory }
}

export async function getProfile(clinicId, userId) {
  return queryOne(
    `SELECT u.id, u.name, u.email, u.phone, u.image, u.role, u.google_id, pr.*
       FROM users u
       LEFT JOIN patient_profiles pr ON pr.user_id = u.id
      WHERE u.id = ? AND u.clinic_id = ?`,
    [userId, clinicId]
  )
}

/** The clinic's physiotherapists — used for seat limits and the diary. */
export async function getClinicPhysios(clinicId) {
  return query(
    `SELECT id, name, email, phone, image, is_active, created_at
       FROM users
      WHERE clinic_id = ? AND role IN ('physio', 'admin')
      ORDER BY role, name`,
    [clinicId]
  )
}

/* ========================================================================== */
/*  CLINIC ADMIN — AVAILABILITY AND PAYMENTS                                  */
/* ========================================================================== */

export async function getAvailabilityRules(clinicId, physioId) {
  return query(
    `SELECT * FROM availability_rules
      WHERE clinic_id = ? AND physio_id = ?
      ORDER BY weekday, start_time`,
    [clinicId, physioId]
  )
}

export async function getUpcomingTimeOff(clinicId, physioId) {
  return query(
    `SELECT * FROM time_off
      WHERE clinic_id = ? AND physio_id = ? AND off_date >= CURDATE()
      ORDER BY off_date`,
    [clinicId, physioId]
  )
}

export async function getPayments(clinicId, { status, limit = 200 } = {}) {
  const conditions = ['p.clinic_id = ?']
  const params = [clinicId]
  if (status) { conditions.push('p.status = ?'); params.push(status) }

  return query(
    `SELECT p.*, a.code AS appointment_code, a.appointment_date, a.start_time,
            s.name AS service_name, u.name AS patient_name, u.email AS patient_email
       FROM payments p
       JOIN appointments a ON a.id = p.appointment_id
       JOIN services s ON s.id = a.service_id
       JOIN users u ON u.id = a.patient_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT ${safeLimit(limit)}`,
    [...params]
  )
}

/* ========================================================================== */
/*  REVIEWS                                                                   */
/* ========================================================================== */

export async function getPublishedReviews(clinicId, { limit = 12 } = {}) {
  return query(
    `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS patient_name,
            s.name AS service_name
       FROM reviews r
       JOIN users u ON u.id = r.patient_id
       LEFT JOIN appointments a ON a.id = r.appointment_id
       LEFT JOIN services s ON s.id = a.service_id
      WHERE r.clinic_id = ? AND r.is_published = 1
      ORDER BY r.created_at DESC
      LIMIT ${safeLimit(limit)}`,
    [clinicId]
  )
}

export async function getPendingReviews(clinicId) {
  return query(
    `SELECT r.*, u.name AS patient_name, u.email AS patient_email
       FROM reviews r
       JOIN users u ON u.id = r.patient_id
      WHERE r.clinic_id = ?
      ORDER BY r.is_published, r.created_at DESC
      LIMIT 100`,
    [clinicId]
  )
}

/**
 * The aggregate rating fed to Google's structured data.
 *
 * Returns null below three reviews — "5.0 from 1 review" is unconvincing to a
 * human and against Google's guidelines.
 */
export async function getRatingSummary(clinicId) {
  const row = await queryOne(
    `SELECT COUNT(*) AS count, AVG(rating) AS average
       FROM reviews WHERE clinic_id = ? AND is_published = 1`,
    [clinicId]
  )
  if (!row || row.count < 3) return null
  return { count: Number(row.count), average: Number(Number(row.average).toFixed(1)) }
}

/* ========================================================================== */
/*  PLATFORM — YOUR OWN BUSINESS                                              */
/* ========================================================================== */
/*
 *  These are the ONLY functions in this file that are not scoped to a clinic,
 *  because they are about your business rather than a customer's. Every one of
 *  them must be behind a `role === 'platform'` check at the call site.
 *
 *  They are grouped together at the bottom, apart from everything else, so that
 *  an unscoped query is conspicuous rather than easy to miss in the middle of
 *  the file.
 */

/** Every plan shown on the public pricing page. */
export async function getPublicPlans() {
  return query(
    `SELECT * FROM plans
      WHERE is_active = 1 AND is_public = 1
      ORDER BY sort_order, price_paise`
  )
}

export async function getPlanByCode(code, billingPeriod = 'monthly') {
  return queryOne(`SELECT * FROM plans WHERE code = ? AND billing_period = ?`, [
    code,
    billingPeriod,
  ])
}

export async function getAllPlans() {
  return query(`SELECT * FROM plans ORDER BY sort_order, price_paise`)
}

/** The live subscription for one clinic, with its plan. */
export async function getClinicSubscription(clinicId) {
  return queryOne(
    `SELECT s.*, p.code AS plan_code, p.name AS plan_name, p.max_physios,
            p.video_enabled, p.whatsapp_enabled, p.analytics_enabled
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
      WHERE s.clinic_id = ?
        AND s.status IN ('trialing', 'active', 'past_due')
      ORDER BY s.id DESC
      LIMIT 1`,
    [clinicId]
  )
}

export async function getClinicInvoices(clinicId, { limit = 50 } = {}) {
  return query(
    `SELECT * FROM platform_invoices
      WHERE clinic_id = ?
      ORDER BY created_at DESC
      LIMIT ${safeLimit(limit)}`,
    [clinicId]
  )
}

/** Every clinic on the platform, with the numbers you care about. */
export async function getAllClinics({ status, search, limit = 200 } = {}) {
  const conditions = []
  const params = []
  if (status) { conditions.push('c.status = ?'); params.push(status) }
  if (search) {
    conditions.push('(c.name LIKE ? OR c.slug LIKE ? OR c.email LIKE ?)')
    const like = `%${search}%`
    params.push(like, like, like)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  return query(
    `SELECT c.*,
            s.status AS subscription_status, s.trial_ends_at, s.price_paise AS mrr_paise,
            -- The cancellation columns, so churn shows on the list rather than only
            -- surfacing next month as a hole in the revenue chart. A cancellation
            -- seen the same day is one a phone call can sometimes still save.
            s.cancelled_at, s.cancel_reason, s.cancelled_by, s.current_period_end,
            p.name AS plan_name, p.code AS plan_code,
            owner.name AS owner_name, owner.email AS owner_email,
            (SELECT COUNT(*) FROM users u WHERE u.clinic_id = c.id AND u.role = 'patient') AS patient_count,
            (SELECT COUNT(*) FROM appointments a WHERE a.clinic_id = c.id) AS appointment_count
       FROM clinics c
       LEFT JOIN subscriptions s
              ON s.clinic_id = c.id AND s.status IN ('trialing','active','past_due')
       LEFT JOIN plans p ON p.id = s.plan_id
       LEFT JOIN users owner ON owner.id = c.owner_user_id
       ${where}
      ORDER BY c.created_at DESC
      LIMIT ${safeLimit(limit)}`,
    [...params]
  )
}

/**
 * Your business at a glance.
 *
 * MRR — monthly recurring revenue — counts only ACTIVE subscriptions. Trials are
 * counted separately, because a trial is not revenue until it converts, and
 * folding the two together is how founders talk themselves into believing a
 * business is bigger than it is.
 */
export async function getPlatformStats() {
  const clinics = await queryOne(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'trialing')  AS trialing,
       SUM(status = 'active')    AS active,
       SUM(status = 'past_due')  AS past_due,
       SUM(status = 'read_only') AS read_only,
       SUM(status = 'suspended') AS suspended,
       SUM(status = 'cancelled') AS cancelled,
       SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) AS new_this_month
     FROM clinics`
  )

  const revenue = await queryOne(
    `SELECT
       COALESCE(SUM(CASE WHEN s.status = 'active' THEN s.price_paise ELSE 0 END), 0) AS mrr_paise,
       COALESCE(SUM(CASE WHEN s.status = 'trialing' THEN s.price_paise ELSE 0 END), 0) AS trial_pipeline_paise
     FROM subscriptions s
     WHERE s.status IN ('active', 'trialing')`
  )

  const collected = await queryOne(
    `SELECT
       COALESCE(SUM(amount_paise + tax_paise), 0) AS all_time_paise,
       COALESCE(SUM(CASE WHEN MONTH(paid_at) = MONTH(CURDATE())
                          AND YEAR(paid_at) = YEAR(CURDATE())
                         THEN amount_paise + tax_paise ELSE 0 END), 0) AS month_paise,
       COUNT(*) AS invoice_count
     FROM platform_invoices
     WHERE status = 'paid'`
  )

  // Trials ending soon — the highest-value list in the whole business, because
  // this is exactly who to call.
  const endingTrials = await query(
    `SELECT c.id, c.name, c.slug, s.trial_ends_at, owner.email AS owner_email
       FROM subscriptions s
       JOIN clinics c ON c.id = s.clinic_id
       LEFT JOIN users owner ON owner.id = c.owner_user_id
      WHERE s.status = 'trialing'
        AND s.trial_ends_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)
      ORDER BY s.trial_ends_at
      LIMIT 20`
  )

  const signupTrend = await query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS signups
       FROM clinics
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
      GROUP BY DATE(created_at)
      ORDER BY day`
  )

  const byPlan = await query(
    `SELECT p.name, p.code, COUNT(*) AS clinics,
            COALESCE(SUM(s.price_paise), 0) AS mrr_paise
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
      WHERE s.status IN ('active', 'trialing')
      GROUP BY p.id, p.name, p.code
      ORDER BY mrr_paise DESC`
  )

  return { clinics, revenue, collected, endingTrials, signupTrend, byPlan }
}

/** Every invoice across every clinic — your revenue ledger. */
export async function getPlatformInvoices({ status, limit = 200 } = {}) {
  const conditions = []
  const params = []
  if (status) { conditions.push('i.status = ?'); params.push(status) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  return query(
    `SELECT i.*, c.name AS clinic_name, c.slug AS clinic_slug
       FROM platform_invoices i
       JOIN clinics c ON c.id = i.clinic_id
       ${where}
      ORDER BY i.created_at DESC
      LIMIT ${safeLimit(limit)}`,
    [...params]
  )
}
