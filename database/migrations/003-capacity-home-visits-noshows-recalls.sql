-- ===========================================================================
--  MIGRATION 003 — THE FOUR REMAINING WAYS A CLINIC EARNS
-- ===========================================================================
--
--      mysql -u root -p physio_clinic < database/migrations/003-capacity-home-visits-noshows-recalls.sql
--
--  1. PARALLEL PATIENTS   The diary assumed one patient per therapist per slot.
--                         A real physiotherapy clinic runs two to four at once —
--                         one on traction, one on ultrasound, one doing
--                         supervised exercise with the therapist. Assuming 1:1
--                         under-books a busy clinic by two or three times.
--
--  2. HOME VISITS         Domiciliary physiotherapy bills two to three times the
--                         clinic rate and is the main revenue line for
--                         post-surgical and geriatric patients. `mode` could not
--                         express it at all.
--
--  3. NO-SHOWS            15–25% of appointments in physiotherapy. The status
--                         existed and the dashboard counted them, but nothing
--                         financial followed — the single largest revenue leak.
--
--  4. RECALL              A discharged patient is the cheapest revenue a clinic
--                         will ever get. `follow_up_date` was written into the
--                         clinical note and then nothing ever read it.
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  1. CAPACITY — more than one patient in a slot
-- ---------------------------------------------------------------------------
ALTER TABLE availability_rules
  /**
   * How many patients this therapist can have in one slot.
   *
   * 1 keeps the old behaviour exactly, which is why it is the default: an
   * existing clinic sees no change until it decides otherwise.
   *
   * A physiotherapist genuinely treating three people at once is not
   * overbooking — one is on a traction table for fifteen minutes, one is under
   * ultrasound, and the therapist is doing hands-on work with the third. The
   * limiting resource is beds and machines, not the therapist's undivided
   * attention. Two to three is normal; a clinic that sets ten is lying to its
   * patients, which is why it is capped.
   */
  ADD COLUMN capacity SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER slot_minutes,

  -- Home visits need their own windows, because the therapist is travelling.
  -- 'both' keeps its existing meaning (clinic + online) so no row changes
  -- behaviour; 'home' is a new, separate kind of window.
  MODIFY COLUMN mode ENUM('online', 'clinic', 'both', 'home') NOT NULL DEFAULT 'both',

  ADD CONSTRAINT chk_rule_capacity CHECK (capacity BETWEEN 1 AND 8);


/**
 * ---------------------------------------------------------------------------
 *  THE UNIQUE INDEX HAS TO CHANGE, AND THIS IS THE INTERESTING PART
 * ---------------------------------------------------------------------------
 *  Double-booking was made impossible by a generated column:
 *
 *      CONCAT(clinic_id, '|', physio_id, '|', appointment_date, '|', start_time)
 *
 *  with a UNIQUE index over it. Two patients at 10:00 produce the same string,
 *  so the second INSERT is refused by MySQL itself — a guarantee that holds even
 *  if somebody later writes a second booking path and forgets the transaction.
 *
 *  That is exactly what now needs to allow three patients at 10:00, and the wrong
 *  fix is to drop the index and trust the application. Deleting your last line of
 *  defence to add a feature is how the bug comes back in two years.
 *
 *  So the key gains a SEAT NUMBER. Seat 0, seat 1, seat 2 at the same 10:00 are
 *  three different strings, and two patients cannot hold the same seat. The
 *  booking transaction picks the lowest free seat under a row lock; if two
 *  requests race for seat 0, the unique index still settles it.
 *
 *  Capacity becomes a real limit AND the database still refuses the impossible.
 * ---------------------------------------------------------------------------
 */
ALTER TABLE appointments DROP INDEX uq_active_slot;
ALTER TABLE appointments DROP COLUMN active_slot_key;

ALTER TABLE appointments
  /**
   * Which of the slot's places this booking holds, 0-indexed.
   *
   * Not shown to anybody and not a bed number — it is purely the thing that makes
   * the uniqueness guarantee survive capacity greater than one.
   */
  ADD COLUMN slot_seat SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER end_time;

ALTER TABLE appointments
  ADD COLUMN active_slot_key VARCHAR(112)
    GENERATED ALWAYS AS (
      CASE WHEN status IN ('pending_payment', 'confirmed', 'in_progress', 'completed')
           THEN CONCAT(clinic_id, '|', physio_id, '|', appointment_date, '|',
                       start_time, '|', slot_seat)
      END
    ) STORED,
  ADD UNIQUE KEY uq_active_slot (active_slot_key);


-- ---------------------------------------------------------------------------
--  2. HOME VISITS
-- ---------------------------------------------------------------------------
ALTER TABLE appointments
  MODIFY COLUMN mode ENUM('online', 'clinic', 'home') NOT NULL,

  /**
   * Where the therapist is actually going.
   *
   * Copied onto the appointment rather than read from the patient's profile at
   * the time of the visit, because people move, and a therapist driving to last
   * month's address because the profile changed yesterday is a wasted afternoon.
   */
  ADD COLUMN visit_address VARCHAR(500) NULL AFTER mode;

ALTER TABLE services
  ADD COLUMN available_home TINYINT(1) NOT NULL DEFAULT 0 AFTER available_clinic,

  /**
   * What the same treatment costs at the patient's home.
   *
   * NULL means "not offered at home". A separate price rather than a percentage
   * surcharge because the difference is travel, which is a flat cost in time —
   * and a clinic quoting ₹1,500 wants to quote ₹1,500, not 187.5% of ₹800.
   */
  ADD COLUMN home_price_paise INT UNSIGNED NULL AFTER price_paise;

ALTER TABLE clinics
  /**
   * Travel time either side of a home visit.
   *
   * Added to the appointment's end_time, which is what the overlap test already
   * works on — so a 45-minute visit with a 30-minute buffer correctly blocks 75
   * minutes of the therapist's day. Without it a clinic books back-to-back home
   * visits across a city and the second one is always late.
   */
  ADD COLUMN home_travel_buffer_mins SMALLINT UNSIGNED NOT NULL DEFAULT 30
    AFTER allow_pay_at_clinic;


-- ---------------------------------------------------------------------------
--  3. NO-SHOWS AND LATE CANCELLATIONS
-- ---------------------------------------------------------------------------
ALTER TABLE clinics
  /**
   * What a patient owes for not turning up. 0 disables it.
   *
   * Deliberately not the full session price by default when a clinic sets it —
   * that is the clinic's choice. What matters is that the number exists at all:
   * a no-show currently costs the clinic a half-hour it has already paid for, and
   * nothing anywhere recorded that.
   */
  ADD COLUMN no_show_fee_paise INT UNSIGNED NOT NULL DEFAULT 0
    AFTER free_cancellation_hours,

  /**
   * Does a no-show or a late cancellation use up a package session?
   *
   * Yes, by default, and this is the standard policy at every clinic that sells
   * courses of treatment. Without it a prepaid patient can cancel at 9:55 for a
   * 10:00 appointment at no cost, forever — the slot is dead and the session is
   * still theirs. It is also the honest position: the therapist's half-hour was
   * genuinely spent whether or not the patient arrived.
   */
  ADD COLUMN late_cancel_forfeits_session TINYINT(1) NOT NULL DEFAULT 1
    AFTER no_show_fee_paise;

ALTER TABLE appointments
  -- Set when staff mark a no-show, from the clinic's policy at that moment. A
  -- fee changed next year must not retrospectively alter what somebody owed.
  ADD COLUMN no_show_fee_paise INT UNSIGNED NOT NULL DEFAULT 0 AFTER amount_paise,

  /**
   * A package session that was consumed even though the appointment did not
   * happen — a no-show, or a cancellation inside the notice window.
   *
   * lib/packages.js counts sessions as "appointments that are not cancelled".
   * A forfeited one IS cancelled, so without this flag it would silently return
   * to the patient's balance, which is the opposite of the policy above.
   */
  ADD COLUMN package_session_forfeited TINYINT(1) NOT NULL DEFAULT 0
    AFTER patient_package_id;


-- ---------------------------------------------------------------------------
--  4. RECALL — bringing patients back
-- ---------------------------------------------------------------------------
ALTER TABLE clinics
  /**
   * After how many days with no visit a patient counts as lapsed.
   *
   * Sixty is a reasonable default for physiotherapy: long enough that a finished
   * course is not chased the following week, short enough that a patient who
   * stopped coming half-way is contacted while they still remember why.
   */
  ADD COLUMN recall_after_days SMALLINT UNSIGNED NOT NULL DEFAULT 60
    AFTER late_cancel_forfeits_session;

ALTER TABLE patient_profiles
  -- When somebody last actually contacted this patient about coming back, so the
  -- recall list does not show the same name every morning to be ignored.
  ADD COLUMN last_recall_at DATETIME NULL,
  ADD COLUMN recall_note VARCHAR(300) NULL;
