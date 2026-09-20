-- ===========================================================================
--  MIGRATION 002 — SESSION PACKAGES, AND TAKING MONEY AT THE DESK
-- ===========================================================================
--
--  Run once against an existing database:
--
--      mysql -u root -p physio_clinic < database/migrations/002-packages-and-desk-payments.sql
--
--  A fresh install gets all of this from schema.sql instead.
--
--  ---------------------------------------------------------------------------
--  WHY: THE APP WAS MODELLING THE WRONG BUSINESS
--  ---------------------------------------------------------------------------
--  Two assumptions were baked into the original schema, and both are wrong for a
--  physiotherapy clinic.
--
--  1. ONE VISIT AT A TIME.
--     Physiotherapy is a COURSE. A frozen shoulder is eight to twelve sessions
--     over six weeks; ACL rehabilitation runs for months. Clinics therefore sell
--     packages — ten sessions for the price of eight — because it secures the
--     revenue up front AND because a patient who has prepaid actually finishes
--     the course, which is better for them clinically. Selling single visits caps
--     revenue per patient at roughly an eighth of what the clinic can bill.
--
--  2. THE PATIENT PAYS ONLINE, IN ADVANCE, BY THEMSELVES.
--     In India most physiotherapy patients telephone or walk in, and pay cash or
--     UPI at the reception desk. The old schema could not represent either: an
--     appointment had to be created by a signed-in patient and paid through
--     Razorpay within fifteen minutes or the slot was released. So the front desk
--     could not book anybody, cash takings were invisible, and the revenue figure
--     on the admin dashboard was not merely incomplete — it was wrong.
--
--  Everything below exists to fix those two things.
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  1. PACKAGES — what the clinic SELLS
-- ---------------------------------------------------------------------------
--  A product, not a purchase: "10 sessions of Sports Injury Rehab, ₹6,000,
--  valid 90 days". The purchase is patient_packages below.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS packages (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id         INT UNSIGNED NOT NULL,

  name              VARCHAR(120) NOT NULL,
  description       VARCHAR(500) NULL,

  /**
   * Which treatment the sessions may be spent on.
   *
   * NULL means any treatment — a general "10 physiotherapy sessions" block.
   * Naming a service is how a clinic sells a specific course of rehab and stops
   * a cheap package being redeemed against an expensive treatment.
   */
  service_id        INT UNSIGNED NULL,

  sessions_count    SMALLINT UNSIGNED NOT NULL,
  price_paise       INT UNSIGNED NOT NULL,

  /**
   * How long the patient has to use it, from the day it is sold.
   *
   * This is not a trick to make money on unused sessions — it is clinical. A
   * course of treatment works because the sessions are close together; someone
   * redeeming session four a year late is starting again, not continuing. 0 means
   * no expiry.
   */
  validity_days     SMALLINT UNSIGNED NOT NULL DEFAULT 90,

  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 0,

  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_packages_clinic (clinic_id, is_active, sort_order),

  CONSTRAINT fk_package_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE CASCADE,
  -- RESTRICT, not CASCADE: a service with packages sold against it must not be
  -- deletable out from under them.
  CONSTRAINT fk_package_service FOREIGN KEY (service_id)
    REFERENCES services (id) ON DELETE RESTRICT,

  CONSTRAINT chk_package_sessions CHECK (sessions_count BETWEEN 1 AND 200)
) ENGINE = InnoDB;


-- ---------------------------------------------------------------------------
--  2. PATIENT PACKAGES — what a patient has BOUGHT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_packages (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id         INT UNSIGNED NOT NULL,
  patient_id        INT UNSIGNED NOT NULL,

  -- The offering it was bought from. SET NULL so retiring a package does not
  -- destroy the record of what a patient paid for.
  package_id        INT UNSIGNED NULL,

  /**
   * Copied from the package at the moment of sale, deliberately.
   *
   * Same reasoning as appointments.amount_paise: if the clinic changes the price
   * or the session count next month, this patient's purchase must still say what
   * they actually bought. A package row is a receipt, and a receipt that changes
   * retrospectively is not a receipt.
   */
  name              VARCHAR(120) NOT NULL,
  service_id        INT UNSIGNED NULL,
  sessions_total    SMALLINT UNSIGNED NOT NULL,
  price_paise       INT UNSIGNED NOT NULL,

  /**
   * NOT a counter of sessions used.
   *
   * Sessions used are DERIVED by counting the appointments that point at this
   * row, exactly as subscription status is derived from dates rather than trusted
   * from a column. A counter and a set of appointments are two sources of truth
   * about the same fact, and they drift the first time a booking is cancelled at
   * an awkward moment. See lib/packages.js.
   */
  purchased_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at        DATE NULL,

  status            ENUM('active', 'used_up', 'expired', 'cancelled', 'refunded')
                    NOT NULL DEFAULT 'active',

  -- Free text for "bought at reception, husband paid" and similar.
  notes             VARCHAR(500) NULL,

  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_pp_clinic_patient (clinic_id, patient_id, status),
  KEY idx_pp_expiry (clinic_id, status, expires_at),

  CONSTRAINT fk_pp_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE CASCADE,
  CONSTRAINT fk_pp_patient FOREIGN KEY (patient_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pp_package FOREIGN KEY (package_id)
    REFERENCES packages (id) ON DELETE SET NULL,
  CONSTRAINT fk_pp_service FOREIGN KEY (service_id)
    REFERENCES services (id) ON DELETE RESTRICT
) ENGINE = InnoDB;


-- ---------------------------------------------------------------------------
--  3. APPOINTMENTS — paid from a package, and booked by staff
-- ---------------------------------------------------------------------------
ALTER TABLE appointments
  /**
   * Which package this session was spent from, if any.
   *
   * When set, amount_paise is 0 and no payment row is created: the money changed
   * hands when the package was sold. This column is what makes "session 4 of 10"
   * answerable, and it is the FK the derived session count reads.
   */
  ADD COLUMN patient_package_id INT UNSIGNED NULL AFTER service_id,

  /**
   * Who created the appointment. NULL means the patient booked it themselves.
   *
   * Worth recording for its own sake — "who took this booking" is the first
   * question asked when a patient says they were promised a different time — and
   * it is how the dashboard can separate self-service bookings from desk ones.
   */
  ADD COLUMN booked_by INT UNSIGNED NULL AFTER patient_package_id,

  ADD KEY idx_appt_package (patient_package_id),
  ADD CONSTRAINT fk_appt_package FOREIGN KEY (patient_package_id)
    REFERENCES patient_packages (id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_appt_booked_by FOREIGN KEY (booked_by)
    REFERENCES users (id) ON DELETE SET NULL;


-- ---------------------------------------------------------------------------
--  4. PAYMENTS — cash, UPI and card at the reception desk
-- ---------------------------------------------------------------------------
ALTER TABLE payments
  /**
   * appointment_id becomes nullable, because a payment need not be for one
   * appointment any more: selling a ten-session package is a single payment
   * against patient_packages, not against a visit.
   *
   * The CHECK below keeps that honest — exactly one of the two must be set. A
   * payment that belongs to nothing is an accounting hole, and a payment that
   * belongs to both is a double count.
   */
  MODIFY COLUMN appointment_id INT UNSIGNED NULL,

  ADD COLUMN patient_package_id INT UNSIGNED NULL AFTER appointment_id,

  /**
   * Who took the money.
   *
   * The single most important column for cash. An online payment carries its own
   * proof; a ₹800 note handed across a desk carries none, and "which of the four
   * people on reception recorded this" is the only thing that makes cash
   * reconcilable at the end of the day.
   */
  ADD COLUMN collected_by INT UNSIGNED NULL AFTER method,

  -- Free text for a receipt book number or a UPI reference read off a phone.
  ADD COLUMN reference VARCHAR(120) NULL AFTER collected_by,

  ADD KEY idx_payment_package (patient_package_id),
  ADD CONSTRAINT fk_payment_pp FOREIGN KEY (patient_package_id)
    REFERENCES patient_packages (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_payment_collected_by FOREIGN KEY (collected_by)
    REFERENCES users (id) ON DELETE SET NULL,

  ADD CONSTRAINT chk_payment_target CHECK (
    (appointment_id IS NOT NULL AND patient_package_id IS NULL) OR
    (appointment_id IS NULL AND patient_package_id IS NOT NULL)
  );


-- ---------------------------------------------------------------------------
--  5. CLINICS — may the front desk take payment later?
-- ---------------------------------------------------------------------------
ALTER TABLE clinics
  /**
   * Whether staff may confirm an appointment that has not been paid for.
   *
   * On by default, because that is how clinics actually work: the patient is
   * booked, comes in, and pays on the way out. Switching it off is for a clinic
   * that wants strict prepayment.
   *
   * This only ever applies to STAFF-created bookings. A patient booking
   * themselves online still pays first — otherwise the slot-holding mechanism has
   * nothing holding it, and anyone could fill a diary for free.
   */
  ADD COLUMN allow_pay_at_clinic TINYINT(1) NOT NULL DEFAULT 1
    AFTER booking_hold_mins;
