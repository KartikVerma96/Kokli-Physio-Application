-- ===========================================================================
--  MIGRATION 005 — WHATSAPP
-- ===========================================================================
--
--      mysql -u root -p physio_clinic < database/migrations/005-whatsapp.sql
--
--  WHY THIS IS THE MOST IMPORTANT FEATURE IN THE PRODUCT
--  ----------------------------------------------------
--  Indian patients do not read email. They read WhatsApp. Every message the
--  application currently sends — the appointment confirmation, the exercise
--  programme, the trial reminder — goes to a channel most patients will never
--  open, which means in practice the clinic still telephones everybody.
--
--  Four uses, one integration, and each one is worth more to a clinic than the
--  whole subscription:
--
--    REMINDER    No-shows run 15–25% in physiotherapy. A reminder the day before
--                roughly halves that. For a clinic billing ₹75,000 a month, that
--                is ₹8,000–15,000 recovered — five to ten times what they pay us.
--
--    EXERCISES   The home programme currently exists as a page the patient never
--                visits. Sent to their phone, compliance rises, outcomes improve,
--                and outcomes are what produce reviews and referrals.
--
--    PACKAGE     "3 sessions left, expires in 12 days." Money already taken for
--                treatment not yet given, recovered with one message.
--
--    REVIEW      Google Maps is how a physiotherapy clinic gets found. Asking at
--                the right moment — just after discharge — is the difference
--                between four reviews and forty.
--
--  ---------------------------------------------------------------------------
--  THE RULE THAT SHAPES EVERYTHING BELOW: MARKETING vs UTILITY
--  ---------------------------------------------------------------------------
--  Meta divides templates into categories. Reminders and exercise programmes are
--  UTILITY — they follow from something the patient asked for, need no consent,
--  and cost little. Package nudges and review requests are MARKETING — they need
--  explicit opt-in and cost roughly three times as much.
--
--  Sending a marketing template without consent gets the sending number BLOCKED.
--  Because that is the platform's single number, one careless clinic would take
--  WhatsApp away from every clinic at once. So consent is not a nicety here, it
--  is the one thing standing between us and a total outage — which is why it is
--  a column with a timestamp rather than a checkbox somebody can assume.
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  1. PLANS — how many messages a month the price includes
-- ---------------------------------------------------------------------------
ALTER TABLE plans
  /**
   * NULL means unlimited, 0 means none.
   *
   * The distinction matters: `whatsapp_enabled = 0` says the plan has no
   * WhatsApp at all, while a quota of 0 on an enabled plan would be a plan that
   * advertises the feature and refuses to send. Keeping both explicit stops that
   * combination being created by accident.
   *
   * A quota exists because every message costs real money. Without one, a single
   * clinic messaging its whole patient list could cost more in a week than it
   * pays in a year.
   */
  ADD COLUMN whatsapp_monthly_quota INT UNSIGNED NULL AFTER whatsapp_enabled;


-- ---------------------------------------------------------------------------
--  2. CLINICS — which messages this clinic wants sent
-- ---------------------------------------------------------------------------
ALTER TABLE clinics
  -- Each switch is separate because clinics genuinely disagree. A busy clinic
  -- wants reminders and nothing else; a new one wants review requests most.
  ADD COLUMN wa_send_reminders   TINYINT(1) NOT NULL DEFAULT 1 AFTER recall_after_days,
  ADD COLUMN wa_send_exercises   TINYINT(1) NOT NULL DEFAULT 1 AFTER wa_send_reminders,
  ADD COLUMN wa_send_package_nudge TINYINT(1) NOT NULL DEFAULT 0 AFTER wa_send_exercises,
  ADD COLUMN wa_send_review_request TINYINT(1) NOT NULL DEFAULT 0 AFTER wa_send_package_nudge,

  /**
   * How many hours before the appointment the reminder goes.
   *
   * 24 is right for physiotherapy: long enough that the clinic can refill the
   * slot if they cancel, short enough that they have not forgotten again by the
   * time it arrives.
   */
  ADD COLUMN wa_reminder_hours   SMALLINT UNSIGNED NOT NULL DEFAULT 24
    AFTER wa_send_review_request,

  /**
   * A clinic may eventually attach its own WhatsApp number so messages come from
   * them rather than from the platform. Not used yet — the columns exist so that
   * day needs no migration, and the secret is encrypted for the same reason the
   * Razorpay one is.
   */
  ADD COLUMN wa_phone_number_id  VARCHAR(64) NULL AFTER wa_reminder_hours,
  ADD COLUMN wa_token_enc        TEXT NULL AFTER wa_phone_number_id;


-- ---------------------------------------------------------------------------
--  3. PATIENTS — consent, and the number to use
-- ---------------------------------------------------------------------------
ALTER TABLE patient_profiles
  /**
   * The WhatsApp number, when it differs from the phone on file.
   *
   * Often it does: an elderly patient gives the clinic their landline and their
   * son's WhatsApp. NULL means "use users.phone".
   */
  ADD COLUMN whatsapp_number VARCHAR(20) NULL,

  /**
   * Consent for MARKETING messages — package nudges and review requests.
   *
   * A timestamp rather than a flag, deliberately. If a clinic is ever challenged
   * over a message, "true" proves nothing; a date proves when the patient agreed.
   * NULL means no consent, and the marketing templates simply will not send.
   */
  ADD COLUMN whatsapp_marketing_opt_in_at DATETIME NULL,

  /**
   * They asked to stop. Overrides everything, including utility messages.
   *
   * Kept as its own column rather than clearing the opt-in above, because
   * "never consented" and "consented then withdrew" are different facts and only
   * one of them means you must never message them again.
   */
  ADD COLUMN whatsapp_opted_out_at DATETIME NULL;


-- ---------------------------------------------------------------------------
--  4. THE MESSAGE LOG
-- ---------------------------------------------------------------------------
--  Every send, successful or not. Three jobs: it is how a quota is counted, how
--  a clinic sees what its patients were told, and how a delivery complaint gets
--  answered a month later.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id         INT UNSIGNED NOT NULL,
  patient_id        INT UNSIGNED NULL,

  -- Which template, e.g. 'appointment_reminder'. Not the rendered text: the text
  -- is Meta's, from the approved template, and could change without us.
  template          VARCHAR(60) NOT NULL,
  category          ENUM('utility', 'marketing') NOT NULL DEFAULT 'utility',

  -- Stored so a complaint can be answered without guessing which number was used.
  to_number         VARCHAR(20) NOT NULL,

  status            ENUM('queued', 'sent', 'delivered', 'read', 'failed', 'skipped')
                    NOT NULL DEFAULT 'queued',
  -- Why it was skipped or failed: 'no consent', 'quota reached', 'opted out',
  -- or whatever Meta said.
  reason            VARCHAR(300) NULL,

  provider_message_id VARCHAR(120) NULL,

  -- What Meta charged, once the delivery webhook says. Lets a clinic see the real
  -- cost of its own messaging, and lets us see whether a plan's quota is priced
  -- correctly.
  cost_paise        INT UNSIGNED NULL,

  -- What it was about, so the log can be read alongside the diary.
  appointment_id    INT UNSIGNED NULL,
  patient_package_id INT UNSIGNED NULL,

  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,

  -- The quota query: this clinic, this month, actually sent.
  KEY idx_wa_quota (clinic_id, status, created_at),
  KEY idx_wa_patient (clinic_id, patient_id, created_at),
  KEY idx_wa_provider (provider_message_id),

  CONSTRAINT fk_wa_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE CASCADE,
  CONSTRAINT fk_wa_patient FOREIGN KEY (patient_id)
    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_wa_appointment FOREIGN KEY (appointment_id)
    REFERENCES appointments (id) ON DELETE SET NULL,
  CONSTRAINT fk_wa_package FOREIGN KEY (patient_package_id)
    REFERENCES patient_packages (id) ON DELETE SET NULL
) ENGINE = InnoDB;


-- ---------------------------------------------------------------------------
--  5. "HAS THIS ALREADY BEEN SENT?"
-- ---------------------------------------------------------------------------
--  Each of these stops the same message going twice. Derived from the log would
--  be possible but slower and, more importantly, less obvious — a scheduler that
--  runs every ten minutes must answer "did I already do this" instantly and
--  without ambiguity, because the cost of getting it wrong is a patient receiving
--  the same reminder six times.
-- ---------------------------------------------------------------------------
ALTER TABLE appointments
  ADD COLUMN wa_reminder_sent_at DATETIME NULL,
  ADD COLUMN wa_review_asked_at  DATETIME NULL;

ALTER TABLE patient_packages
  ADD COLUMN wa_expiry_nudge_sent_at DATETIME NULL;

ALTER TABLE consultation_notes
  ADD COLUMN wa_exercises_sent_at DATETIME NULL;
