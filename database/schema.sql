-- ===========================================================================
--  KOKLI — MULTI-TENANT SaaS SCHEMA
-- ===========================================================================
--
--  HOW TO RUN THIS
--  ---------------
--  Easiest way:  npm run db:setup      (runs this file + seed.sql for you)
--
--  Or by hand in MySQL Workbench:
--    1. Open MySQL Workbench and connect to your local server.
--    2. File → Open SQL Script → pick this file.
--    3. Click the lightning bolt (⚡) to execute.
--    4. Repeat for database/seed.sql.
--
-- ===========================================================================
--  WHAT CHANGED, AND WHY: SINGLE CLINIC → MANY CLINICS
-- ===========================================================================
--  This started as one clinic's website. It is now a product that many clinics
--  rent, each with their own patients, prices, diary and branding, at their own
--  address like  aarogya.kokli.local.
--
--  That shift is called MULTI-TENANCY, and it comes down to one idea repeated
--  everywhere: almost every row in this database belongs to exactly one clinic,
--  so almost every table carries a `clinic_id`, and every single query must
--  filter on it.
--
--  THE RULE THAT MATTERS MOST
--  -------------------------
--  A missing `WHERE clinic_id = ?` means one clinic can read another clinic's
--  patient records. In healthcare that is not a bug, it is the end of the
--  business. So this schema is built to make that mistake hard:
--
--    * clinic_id is NOT NULL on every tenant-owned table, so a row cannot be
--      orphaned or ambiguous.
--    * Every index is COMPOSITE and starts with clinic_id, so the fast query is
--      also the correctly-scoped query. Doing it wrong is doing it slowly.
--    * Uniqueness is per clinic, not global: two clinics may both have a service
--      called "back-pain", so it is UNIQUE (clinic_id, slug), never UNIQUE (slug).
--
--  THE ONE DELIBERATE EXCEPTION
--  ----------------------------
--  `users.email` stays globally unique, and a user belongs to exactly ONE
--  clinic. The alternative — UNIQUE (clinic_id, email) — would let one person be
--  a patient at two clinics with separate records, which is arguably more
--  correct. It also means every login has to know which clinic it is for before
--  it can even look the account up, and it breaks Google sign-in, which
--  identifies people by email alone.
--
--  For a physiotherapy platform, someone attending two clinics that both happen
--  to use us is rare. Global emails keep authentication simple and safe. The
--  trade-off is recorded here so it is a decision rather than an accident.
--
--  MONEY: TWO SEPARATE FLOWS, TWO SEPARATE TABLES
--  ----------------------------------------------
--    payments           patient → CLINIC   (each clinic's own Razorpay keys)
--    platform_invoices  clinic  → PLATFORM (your Razorpay account)
--
--  Keeping them in different tables is not tidiness — they are different money,
--  belonging to different businesses, with different tax treatment. Mixing them
--  in one table with a `type` column would be a reconciliation nightmare.
-- ===========================================================================

CREATE DATABASE IF NOT EXISTS physio_clinic
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE physio_clinic;

-- Dropped in reverse dependency order so foreign keys never block us.
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS consultation_notes;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS time_off;
DROP TABLE IF EXISTS availability_rules;
DROP TABLE IF EXISTS services;
DROP TABLE IF EXISTS platform_invoices;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS patient_profiles;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS clinics;
DROP TABLE IF EXISTS plans;


-- ###########################################################################
--  PART 1 — THE PLATFORM (your business)
-- ###########################################################################

-- ===========================================================================
--  1. PLANS — what you sell
-- ===========================================================================
--  Prices live in the database, not in code, so they can be changed from the
--  platform admin without a deployment. That matters more than it sounds: you
--  will raise prices once you have testimonials, and you should not need a
--  developer to do it.
--
--  The limit columns (max_physios, video_enabled …) are read by lib/plan.js and
--  are what actually gate features. Adding a new capability means adding a
--  column here and one check in that file.
-- ===========================================================================
CREATE TABLE plans (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- Stable machine name used in code: 'starter', 'professional', 'clinic'.
  -- Never rename these; rename `name` instead.
  code              VARCHAR(40)  NOT NULL,
  name              VARCHAR(80)  NOT NULL,
  tagline           VARCHAR(200) NULL,

  price_paise       INT UNSIGNED NOT NULL,
  -- 'monthly' or 'yearly'. Yearly plans are added later as separate rows.
  billing_period    ENUM('monthly', 'yearly') NOT NULL DEFAULT 'monthly',

  -- How long a brand-new clinic gets before it must pay. Per plan, because you
  -- may want to offer a longer trial on the expensive tier.
  trial_days        SMALLINT UNSIGNED NOT NULL DEFAULT 30,

  -- ------------------------------------------------------------- the limits
  max_physios       SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  max_locations     SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  -- 0 means unlimited. Documented here because a NULL would be ambiguous.
  max_appointments_per_month INT UNSIGNED NOT NULL DEFAULT 0,

  -- ---------------------------------------------------------- the features
  video_enabled     TINYINT(1) NOT NULL DEFAULT 0,
  soap_notes_enabled TINYINT(1) NOT NULL DEFAULT 1,
  whatsapp_enabled  TINYINT(1) NOT NULL DEFAULT 0,
  -- NULL = unlimited, 0 = none. Different things: see migration 005.
  whatsapp_monthly_quota INT UNSIGNED NULL,

  -- Whether the clinic may connect its OWN WhatsApp number, and so send without a
  -- quota because Meta bills them directly.
  --
  -- The top plan only, and that is a pricing decision rather than a technical one —
  -- see migration 008. Before this column existed, connecting a number bypassed
  -- `whatsapp_enabled` entirely, which made the paid feature optional and removed
  -- every reason to upgrade for a bigger quota.
  whatsapp_own_number    TINYINT(1)   NOT NULL DEFAULT 0,
  analytics_enabled TINYINT(1) NOT NULL DEFAULT 0,

  -- Bullet points for the pricing page. Presentation only — never read these to
  -- decide what a clinic may do; that is what the columns above are for.
  highlights        JSON NULL,

  /**
   * The matching plan id in YOUR Razorpay account.
   *
   * Razorpay plans are IMMUTABLE — the amount cannot be edited once created — so
   * changing a price here means creating a new Razorpay plan. This column caches
   * the current one so it is created once rather than on every subscribe, and it
   * is cleared whenever price_paise changes. See lib/platformBilling.js.
   */
  razorpay_plan_id  VARCHAR(80) NULL,

  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  -- Hidden from the pricing page but still honoured for clinics already on it.
  -- This is how you retire a plan without breaking existing customers.
  is_public         TINYINT(1) NOT NULL DEFAULT 1,
  sort_order        SMALLINT NOT NULL DEFAULT 0,

  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_plans_code (code, billing_period),
  KEY idx_plans_public (is_active, is_public, sort_order)
) ENGINE = InnoDB;


-- ===========================================================================
--  2. CLINICS — one row per paying customer. THE TENANT TABLE.
-- ===========================================================================
--  This is the row everything else hangs off. It holds three separate kinds of
--  thing, and it is worth seeing them as separate:
--
--    IDENTITY      slug, name — which tenant this is and where it lives
--    BRANDING      everything the public website used to read from
--                  config/site.js: address, hours, practitioner, FAQs
--    OPERATIONS    their Razorpay keys, their status, their onboarding progress
--
--  `slug` is the subdomain. aarogya.kokli.local → slug 'aarogya'. It is the
--  primary lookup on literally every request, so it is indexed and immutable
--  once set (changing it would break every link the clinic has ever shared).
-- ===========================================================================
CREATE TABLE clinics (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- ----------------------------------------------------------- identity
  slug              VARCHAR(63)  NOT NULL,
  name              VARCHAR(120) NOT NULL,
  legal_name        VARCHAR(160) NULL,
  tagline           VARCHAR(200) NULL,
  description       VARCHAR(300) NULL,   -- the SEO meta description

  -- ----------------------------------------------------------- branding
  logo_url          VARCHAR(500) NULL,
  -- A hex colour. The public site tints itself with this, so each clinic looks
  -- like itself rather than like our template.
  brand_colour      VARCHAR(9)   NOT NULL DEFAULT '#0d9488',

  -- ------------------------------------------------------------ contact
  phone             VARCHAR(20)  NULL,
  whatsapp          VARCHAR(20)  NULL,
  email             VARCHAR(190) NULL,

  -- ------------------------------------------------------------ address
  address_line1     VARCHAR(160) NULL,
  address_line2     VARCHAR(160) NULL,
  city              VARCHAR(80)  NULL,
  state             VARCHAR(80)  NULL,
  postal_code       VARCHAR(20)  NULL,
  country           CHAR(2)      NOT NULL DEFAULT 'IN',
  -- DECIMAL, not FLOAT. Coordinates compared or stored as binary floats drift,
  -- and these feed the local-SEO structured data where accuracy matters.
  latitude          DECIMAL(10, 7) NULL,
  longitude         DECIMAL(10, 7) NULL,
  maps_url          VARCHAR(500) NULL,

  timezone          VARCHAR(64)  NOT NULL DEFAULT 'Asia/Kolkata',
  currency          CHAR(3)      NOT NULL DEFAULT 'INR',

  -- ------------------------------------------------- the practitioner shown
  -- Denormalised on purpose. The public site needs a named, credentialled
  -- practitioner for trust and for Google's medical-content guidelines, and
  -- reading it from here is one lookup instead of a join on every page.
  practitioner_name        VARCHAR(120) NULL,
  practitioner_credentials VARCHAR(120) NULL,
  practitioner_title       VARCHAR(120) NULL,
  practitioner_registration VARCHAR(80) NULL,
  practitioner_experience_years SMALLINT UNSIGNED NULL,
  practitioner_bio         TEXT NULL,
  practitioner_languages   JSON NULL,
  practitioner_specialisations JSON NULL,

  -- ------------------------------------------------------- page content
  opening_hours     JSON NULL,   -- [{days, time}] shown to visitors
  opening_hours_spec JSON NULL,  -- machine-readable, for Google
  faqs              JSON NULL,   -- [{q, a}] — also becomes FAQ rich results
  stats             JSON NULL,   -- [{value, label}] the homepage numbers
  social            JSON NULL,   -- {instagram, facebook, …}

  -- ------------------------------------------------- booking policy
  booking_max_days_ahead   SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  booking_min_notice_mins  SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  booking_hold_mins        SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  -- May reception confirm an appointment that has not been paid for? On by
  -- default: the patient is booked, comes in, and pays on the way out. Never
  -- applies to a patient booking themselves online.
  allow_pay_at_clinic      TINYINT(1) NOT NULL DEFAULT 1,
  -- Travel time either side of a home visit, added to the appointment so the
  -- diary blocks the whole trip rather than just the treatment.
  home_travel_buffer_mins  SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  free_cancellation_hours  SMALLINT UNSIGNED NOT NULL DEFAULT 12,

  -- What a patient owes for not turning up. 0 disables it. No-shows run 15-25%
  -- in physiotherapy and each one is a half-hour already paid for.
  no_show_fee_paise        INT UNSIGNED NOT NULL DEFAULT 0,

  /**
   * Does a no-show or a late cancellation use up a package session?
   *
   * Yes by default, and the standard policy wherever courses of treatment are
   * sold. Without it a prepaid patient can cancel at 9:55 for a 10:00 slot
   * forever at no cost, and the slot is dead every time.
   */
  late_cancel_forfeits_session TINYINT(1) NOT NULL DEFAULT 1,

  -- After how many days with no visit a patient counts as lapsed, for /admin/recalls.
  recall_after_days        SMALLINT UNSIGNED NOT NULL DEFAULT 60,

  -- Which WhatsApp messages this clinic sends. The two marketing ones are OFF by
  -- default — they need per-patient consent, and a default that sends them would
  -- get the platform's number blocked. See lib/whatsapp.js.
  wa_send_reminders        TINYINT(1) NOT NULL DEFAULT 1,
  wa_send_exercises        TINYINT(1) NOT NULL DEFAULT 1,
  wa_send_package_nudge    TINYINT(1) NOT NULL DEFAULT 0,
  wa_send_review_request   TINYINT(1) NOT NULL DEFAULT 0,
  wa_reminder_hours        SMALLINT UNSIGNED NOT NULL DEFAULT 24,
  -- For the day a clinic attaches its own WhatsApp number rather than sending
  -- through the platform's. Unused today; here so that needs no migration.
  wa_phone_number_id       VARCHAR(64) NULL,
  wa_token_enc             TEXT NULL,

  -- ------------------------------------- THE CLINIC'S OWN PAYMENT GATEWAY
  --  Patient money goes straight to the clinic, never through us. That single
  --  decision keeps the platform out of payment-aggregator territory, which in
  --  India means out of RBI licensing.
  --
  --  The secret is stored ENCRYPTED (AES-256-GCM, see lib/crypto.js). A leaked
  --  database must not hand an attacker the ability to move other businesses'
  --  money. The key id is not secret and stays plain so it can be read easily.
  razorpay_key_id        VARCHAR(80)  NULL,
  razorpay_key_secret_enc TEXT        NULL,
  razorpay_webhook_secret_enc TEXT    NULL,
  payments_connected_at  DATETIME     NULL,

  -- ------------------------------------------------------------- status
  --  trialing   inside the free trial, fully working
  --  active     paying
  --  past_due   payment failed; still working, inside the grace period
  --  read_only  grace expired — can view everything, cannot take new bookings
  --  suspended  switched off by you, from the platform admin
  --  cancelled  the clinic left
  --
  --  Note there is no 'deleted'. A clinic's medical records are not ours to
  --  destroy because a card stopped working.
  status            ENUM('trialing', 'active', 'past_due', 'read_only',
                         'suspended', 'cancelled')
                    NOT NULL DEFAULT 'trialing',

  -- --------------------------------------------------------- onboarding
  -- Which step of setup they reached, so returning to a half-finished signup
  -- resumes instead of starting again.
  onboarding_step   ENUM('details', 'services', 'availability', 'payments', 'done')
                    NOT NULL DEFAULT 'details',
  onboarding_completed_at DATETIME NULL,

  -- The account that created the clinic and is billed. No FOREIGN KEY, and that
  -- is deliberate: clinics and users reference each other, so a constraint in
  -- both directions is a circular dependency that cannot be created in one
  -- pass. The users.clinic_id side is the one that carries the constraint (it is
  -- the one that must never dangle); this side is added by ALTER at the bottom.
  owner_user_id     INT UNSIGNED NULL,

  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_clinics_slug (slug),
  KEY idx_clinics_status (status),
  KEY idx_clinics_owner (owner_user_id)
) ENGINE = InnoDB;


-- ###########################################################################
--  PART 2 — PEOPLE
-- ###########################################################################

-- ===========================================================================
--  3. USERS — patients, physiotherapists, clinic admins, and you
-- ===========================================================================
--  clinic_id is NULL for exactly one kind of account: role = 'platform', which
--  is you. Everyone else belongs to a clinic, and the CHECK constraint below
--  enforces that rather than trusting application code to remember.
--
--  A note on why platform staff are in this table at all: it means one login
--  system, one password-hashing path, one session mechanism. A separate
--  admin_users table is a second implementation of the most security-sensitive
--  code in the app, and the second implementation is always the weaker one.
-- ===========================================================================
CREATE TABLE users (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  clinic_id       INT UNSIGNED NULL,

  name            VARCHAR(120)  NOT NULL,
  email           VARCHAR(190)  NOT NULL,
  password_hash   VARCHAR(255)  NULL,
  phone           VARCHAR(20)   NULL,
  image           VARCHAR(500)  NULL,

  --  patient   books appointments
  --  physio    treats them, writes clinical notes
  --  admin     runs the clinic, sees revenue and billing
  --  platform  YOU — sees every clinic, belongs to none
  role            ENUM('patient', 'physio', 'admin', 'platform')
                  NOT NULL DEFAULT 'patient',

  -- When they last set it themselves. NULL means never — the password they have
  -- is still the one an admin typed for them. See migration 007.
  password_changed_at DATETIME  NULL,

  google_id       VARCHAR(120)  NULL,
  email_verified  TINYINT(1)    NOT NULL DEFAULT 0,
  -- Proven by answering a WhatsApp OTP on it. A number reception typed in from a
  -- phone call is hearsay until then — see database/migrations/006-phone-otp.sql.
  phone_verified  TINYINT(1)    NOT NULL DEFAULT 0,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  last_login_at   DATETIME      NULL,

  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,

  -- 190 chars, not 255: an index key in utf8mb4 is limited to 3072 bytes and
  -- each character can take 4 bytes. 190 * 4 = 760, comfortably inside it.
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_google (google_id),

  -- Composite and clinic-first: the common query is "this clinic's patients".
  KEY idx_users_clinic_role (clinic_id, role),

  -- Phone login looks a user up by number on every attempt, including every
  -- attempt by somebody guessing. Deliberately NOT unique: in India one number
  -- serves a whole family, so it identifies a household, not a person.
  KEY idx_users_clinic_phone (clinic_id, phone),

  CONSTRAINT fk_users_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE RESTRICT,

  -- Every account belongs to a clinic, except platform staff, who never do.
  -- Enforced here so it cannot drift.
  CONSTRAINT chk_users_tenancy CHECK (
    (role = 'platform' AND clinic_id IS NULL) OR
    (role <> 'platform' AND clinic_id IS NOT NULL)
  )
) ENGINE = InnoDB;

-- The other half of the circular reference, added now that both tables exist.
ALTER TABLE clinics
  ADD CONSTRAINT fk_clinics_owner FOREIGN KEY (owner_user_id)
    REFERENCES users (id) ON DELETE SET NULL;


-- ===========================================================================
--  4. PATIENT PROFILES — the clinical intake information
-- ===========================================================================
--  No clinic_id: the primary key IS the user id, and that user already carries
--  one. Adding a second copy would create the possibility of the two
--  disagreeing, which is worse than the join.
-- ===========================================================================
CREATE TABLE patient_profiles (
  user_id             INT UNSIGNED PRIMARY KEY,
  date_of_birth       DATE          NULL,
  gender              ENUM('male', 'female', 'other', 'prefer_not_to_say') NULL,
  address             VARCHAR(300)  NULL,
  city                VARCHAR(80)   NULL,
  occupation          VARCHAR(120)  NULL,

  -- Physiotherapists genuinely need these. Occupation tells you whether the
  -- neck pain is from a desk or from carrying bricks; height/weight feed the
  -- load calculations for knee and hip rehab.
  height_cm           SMALLINT UNSIGNED NULL,
  weight_kg           SMALLINT UNSIGNED NULL,

  emergency_contact_name  VARCHAR(120) NULL,
  emergency_contact_phone VARCHAR(20)  NULL,

  medical_history     TEXT NULL,
  current_medications TEXT NULL,
  allergies           TEXT NULL,
  referred_by         VARCHAR(160) NULL,

  -- When somebody last contacted this patient about coming back, so the recall
  -- list does not show the same names every morning to be ignored.
  last_recall_at    DATETIME NULL,
  recall_note       VARCHAR(300) NULL,

  -- The WhatsApp number when it differs from the phone on file — often it does.
  whatsapp_number   VARCHAR(20) NULL,
  -- Consent for MARKETING messages, as a DATE rather than a flag: if a clinic is
  -- ever challenged, "true" proves nothing and "they agreed on 14 March" proves
  -- everything.
  whatsapp_marketing_opt_in_at DATETIME NULL,
  -- They asked to stop. Beats everything, including utility messages.
  whatsapp_opted_out_at DATETIME NULL,

  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_profile_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;


-- ###########################################################################
--  PART 3 — BILLING (clinic pays the platform)
-- ###########################################################################

-- ===========================================================================
--  5. SUBSCRIPTIONS — one live row per clinic
-- ===========================================================================
--  Why a separate table rather than columns on `clinics`? Because a clinic has a
--  HISTORY of subscriptions: trial, then Starter, then upgraded to
--  Professional, then cancelled, then won back. Columns can only hold the
--  present. Rows let you answer "when did they upgrade?" and "how long were they
--  on Starter?", which is the whole of churn analysis.
--
--  The partial-unique trick from the appointments table is used again here: at
--  most ONE live subscription per clinic, enforced by MySQL rather than by
--  hoping the application remembers.
-- ===========================================================================
CREATE TABLE subscriptions (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id         INT UNSIGNED NOT NULL,
  plan_id           INT UNSIGNED NOT NULL,

  status            ENUM('trialing', 'active', 'past_due', 'cancelled', 'expired')
                    NOT NULL DEFAULT 'trialing',

  -- Razorpay's own identifiers. NULL during a trial, because nothing has been
  -- charged and no mandate exists yet.
  razorpay_subscription_id VARCHAR(80) NULL,
  razorpay_customer_id     VARCHAR(80) NULL,

  -- Copied from the plan at signup, ON PURPOSE — the same reasoning as
  -- appointments.amount_paise. If you raise prices, an existing clinic keeps
  -- paying what they agreed to until they change plan.
  price_paise       INT UNSIGNED NOT NULL,
  billing_period    ENUM('monthly', 'yearly') NOT NULL DEFAULT 'monthly',

  trial_ends_at     DATETIME NULL,

  wa_expiry_nudge_sent_at DATETIME NULL,

  -- Stamped the first time the "your trial ends soon" email goes out, so the
  -- nightly sweep sends it once rather than every night for a week. A reminder
  -- that arrives daily is not a reminder, it is a reason to unsubscribe.
  trial_reminder_sent_at DATETIME NULL,
  current_period_start DATETIME NULL,
  current_period_end   DATETIME NULL,

  -- When a payment fails we do not cut them off. This is the moment the grace
  -- period ends and the clinic drops to read-only.
  grace_ends_at     DATETIME NULL,

  cancelled_at      DATETIME NULL,
  cancel_reason      VARCHAR(255) NULL,
  -- Churn analysis needs to distinguish "left on purpose" from "card expired".
  cancelled_by      ENUM('clinic', 'platform', 'system') NULL,

  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,

  -- Equals the clinic id while the subscription is live, NULL once it is not.
  -- A UNIQUE index rejects duplicates but allows unlimited NULLs, so: one live
  -- subscription per clinic, any number of dead ones.
  active_clinic_key INT UNSIGNED
    GENERATED ALWAYS AS (
      CASE WHEN status IN ('trialing', 'active', 'past_due') THEN clinic_id END
    ) STORED,

  UNIQUE KEY uq_one_live_subscription (active_clinic_key),
  UNIQUE KEY uq_razorpay_subscription (razorpay_subscription_id),
  KEY idx_subscriptions_clinic (clinic_id, created_at),
  KEY idx_subscriptions_status (status),
  -- Powers "which trials expire in the next three days", which is the single
  -- most valuable query in a SaaS business.
  KEY idx_subscriptions_trial (status, trial_ends_at),

  CONSTRAINT fk_subscription_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE RESTRICT,
  CONSTRAINT fk_subscription_plan FOREIGN KEY (plan_id)
    REFERENCES plans (id) ON DELETE RESTRICT
) ENGINE = InnoDB;


-- ===========================================================================
--  6. PLATFORM INVOICES — what each clinic has paid YOU
-- ===========================================================================
--  Append-only. A failed charge followed by a successful retry leaves two rows,
--  so six months later you can reconstruct exactly what happened. Same rule as
--  the `payments` table, for the same reason: this is money.
-- ===========================================================================
CREATE TABLE platform_invoices (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id         INT UNSIGNED NOT NULL,
  subscription_id   INT UNSIGNED NULL,

  -- Your own human-readable reference, e.g. INV-2026-0042.
  number            VARCHAR(40)  NOT NULL,

  razorpay_invoice_id VARCHAR(80) NULL,
  razorpay_payment_id VARCHAR(80) NULL,

  amount_paise      INT UNSIGNED NOT NULL,
  -- Stamped when staff mark a no-show, from the clinic's policy at that moment.
  -- A fee changed next year must not alter what somebody owed today.
  no_show_fee_paise INT UNSIGNED NOT NULL DEFAULT 0,
  -- India: 18% GST on SaaS. Stored per invoice rather than calculated on read,
  -- because the rate can change and old invoices must not silently change with
  -- it.
  tax_paise         INT UNSIGNED NOT NULL DEFAULT 0,
  currency          CHAR(3) NOT NULL DEFAULT 'INR',

  status            ENUM('pending', 'paid', 'failed', 'refunded')
                    NOT NULL DEFAULT 'pending',
  failure_reason    VARCHAR(500) NULL,

  period_start      DATE NULL,
  period_end        DATE NULL,
  paid_at           DATETIME NULL,

  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_invoice_number (number),
  KEY idx_invoice_clinic (clinic_id, created_at),
  KEY idx_invoice_status (status),

  CONSTRAINT fk_invoice_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoice_subscription FOREIGN KEY (subscription_id)
    REFERENCES subscriptions (id) ON DELETE SET NULL
) ENGINE = InnoDB;


-- ###########################################################################
--  PART 4 — THE CLINIC'S OWN DATA (every table scoped by clinic_id)
-- ###########################################################################

-- ===========================================================================
--  7. SERVICES — what each clinic treats, and what they charge
-- ===========================================================================
--  Note `UNIQUE (clinic_id, slug)` rather than `UNIQUE (slug)`. Two clinics can
--  both offer "back-and-neck-pain", and each gets that URL on their own
--  subdomain. Making the slug globally unique would mean the second clinic to
--  sign up cannot use the obvious name — a genuinely bad product decision baked
--  into a database constraint.
-- ===========================================================================
CREATE TABLE services (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id          INT UNSIGNED NOT NULL,

  slug               VARCHAR(120)  NOT NULL,
  name               VARCHAR(160)  NOT NULL,
  short_description  VARCHAR(300)  NOT NULL,
  description        TEXT          NULL,

  icon               VARCHAR(60)   NOT NULL DEFAULT 'Activity',

  duration_minutes   SMALLINT UNSIGNED NOT NULL DEFAULT 45,
  price_paise        INT UNSIGNED  NOT NULL,
  -- What the same treatment costs at the patient's home. NULL means not offered
  -- there. A separate price, not a percentage surcharge: the difference is travel,
  -- which is a flat cost in the therapist's time.
  home_price_paise   INT UNSIGNED  NULL,

  available_online   TINYINT(1)    NOT NULL DEFAULT 1,
  available_clinic   TINYINT(1)    NOT NULL DEFAULT 1,
  available_home     TINYINT(1)    NOT NULL DEFAULT 0,

  conditions_treated JSON          NULL,
  what_to_expect     JSON          NULL,

  seo_title          VARCHAR(200)  NULL,
  seo_description    VARCHAR(300)  NULL,

  is_active          TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order         SMALLINT      NOT NULL DEFAULT 0,

  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_services_clinic_slug (clinic_id, slug),
  KEY idx_services_clinic_active (clinic_id, is_active, sort_order),

  CONSTRAINT fk_services_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE RESTRICT
) ENGINE = InnoDB;


-- ===========================================================================
--  8. AVAILABILITY RULES — each clinic's weekly working pattern
-- ===========================================================================
--  We do NOT store a row per bookable slot. We store RULES ("Tuesdays 09:00 to
--  13:00 in 30-minute steps") and lib/slots.js generates the slots on demand for
--  whichever single day a patient is looking at. Infinite future availability
--  from a handful of rows, and changing the working week is one UPDATE.
--
--  weekday follows JavaScript's Date.getDay(): 0 = Sunday … 6 = Saturday.
--
--  clinic_id is here even though physio_id already implies it. Redundant, yes —
--  but it means the slot query filters on clinic_id like every other query in
--  the app, so the habit never has an exception.
-- ===========================================================================
CREATE TABLE availability_rules (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id     INT UNSIGNED NOT NULL,
  physio_id     INT UNSIGNED NOT NULL,

  weekday       TINYINT UNSIGNED NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  slot_minutes  SMALLINT UNSIGNED NOT NULL DEFAULT 30,

  /**
   * How many patients this therapist takes at once in these hours.
   *
   * 1 is the old behaviour exactly. A physiotherapist genuinely treating three
   * people at once is not overbooking — one is on a traction table, one under
   * ultrasound, and they are doing hands-on work with the third. The limiting
   * resource is beds and machines, not undivided attention.
   */
  capacity      SMALLINT UNSIGNED NOT NULL DEFAULT 1,

  -- 'both' means clinic OR online. Home visits need their own windows, because
  -- the therapist is travelling and cannot be treating anybody in the building.
  mode          ENUM('online', 'clinic', 'both', 'home') NOT NULL DEFAULT 'both',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,

  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_rule_lookup (clinic_id, physio_id, weekday, is_active),

  CONSTRAINT fk_rule_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE RESTRICT,
  CONSTRAINT fk_rule_physio FOREIGN KEY (physio_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_rule_times CHECK (end_time > start_time),
  CONSTRAINT chk_rule_weekday CHECK (weekday BETWEEN 0 AND 6),

  CONSTRAINT chk_rule_capacity CHECK (capacity BETWEEN 1 AND 8)
) ENGINE = InnoDB;


-- ===========================================================================
--  9. TIME OFF — holidays, leave, and one-off blocked hours
-- ===========================================================================
--  Rules say "I always work Tuesdays". Reality says "except next Tuesday, I am
--  at a wedding". This is the exception list, and it always wins.
--  Leave start_time and end_time NULL to block the whole day.
-- ===========================================================================
CREATE TABLE time_off (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id   INT UNSIGNED NOT NULL,
  physio_id   INT UNSIGNED NOT NULL,
  off_date    DATE NOT NULL,
  start_time  TIME NULL,
  end_time    TIME NULL,
  reason      VARCHAR(200) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_timeoff_lookup (clinic_id, physio_id, off_date),

  CONSTRAINT fk_timeoff_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE RESTRICT,
  CONSTRAINT fk_timeoff_physio FOREIGN KEY (physio_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;


-- ===========================================================================
--  10. PACKAGES — a course of treatment, sold up front
-- ===========================================================================
--  Physiotherapy is a course, not a visit. See the long note at the top of
--  lib/packages.js for why this table is the most important commercial mechanism
--  in the whole application, and why sessions used is DERIVED rather than stored.
-- ===========================================================================
CREATE TABLE packages (
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


CREATE TABLE patient_packages (
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


-- ===========================================================================
--  11. APPOINTMENTS — the centre of the whole application
-- ===========================================================================
--  THE STATUS LIFECYCLE
--    pending_payment  Slot held while the patient is on the payment page.
--    confirmed        Paid. A real, guaranteed appointment.
--    in_progress      The video consultation is live right now.
--    completed        Finished. Clinical notes can be written.
--    cancelled        Called off by either side, or the hold expired.
--    no_show          Patient never arrived. Tracked because it matters.
--
--  THE DOUBLE-BOOKING PROBLEM
--  --------------------------
--  Two patients click "confirm 10:00 AM" in the same second. Both requests ask
--  "is 10:00 free?", both are told yes, both insert. Checking in JavaScript can
--  never fix this: there is always a gap between the check and the insert.
--
--  The only reliable fix is to make the DATABASE refuse it. `active_slot_key`
--  below is a generated column — MySQL computes it from the other columns. It
--  equals "clinic|physio|date|time" while the appointment is live, and NULL once
--  it is cancelled. A UNIQUE index rejects duplicate values but permits
--  unlimited NULLs. So: one live appointment per slot, enforced by MySQL itself,
--  while any number of cancelled appointments share that slot harmlessly.
--
--  clinic_id is first in the key. Not strictly required — physio_id is globally
--  unique — but it makes the key self-describing, and it means a bug that
--  somehow mixed clinics could never produce a false clash between two
--  different clinics' diaries.
-- ===========================================================================
CREATE TABLE appointments (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id         INT UNSIGNED NOT NULL,

  -- Human-friendly reference like APT-7K3M9Q. Patients quote it on the phone.
  -- Unique per clinic, not globally: two clinics generating the same short code
  -- is harmless and forcing global uniqueness would mean collisions across
  -- unrelated businesses.
  code              VARCHAR(20) NOT NULL,

  patient_id        INT UNSIGNED NOT NULL,
  physio_id         INT UNSIGNED NOT NULL,
  service_id        INT UNSIGNED NOT NULL,

  appointment_date  DATE NOT NULL,
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,

  -- Which package this session was spent from, if any. When set, amount_paise is
  -- 0 and no payment row exists: the money arrived when the package was sold.
  patient_package_id INT UNSIGNED NULL,
  /**
   * A package session consumed even though the appointment did not happen — a
   * no-show, or a cancellation inside the notice window.
   *
   * lib/packages.js counts sessions as "appointments that are not cancelled", so
   * without this flag a forfeited one would silently return to the patient's
   * balance, which is the opposite of the policy.
   */
  package_session_forfeited TINYINT(1) NOT NULL DEFAULT 0,
  -- Who created it. NULL means the patient booked it themselves online.
  booked_by         INT UNSIGNED NULL,

  slot_seat         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  -- Stamped BEFORE sending, so a crash mid-send costs one missed reminder rather
  -- than six duplicates. See lib/whatsappJobs.js.
  wa_reminder_sent_at DATETIME NULL,
  wa_review_asked_at  DATETIME NULL,

  mode              ENUM('online', 'clinic', 'home') NOT NULL,
  -- Where the therapist is going, for a home visit. Copied onto the appointment
  -- rather than read from the profile later, because people move.
  visit_address     VARCHAR(500) NULL,
  status            ENUM('pending_payment', 'confirmed', 'in_progress',
                         'completed', 'cancelled', 'no_show')
                    NOT NULL DEFAULT 'pending_payment',

  -- Copied from services.price_paise at booking time, ON PURPOSE. If the clinic
  -- raises prices next month, this appointment must still show what the patient
  -- actually paid.
  amount_paise      INT UNSIGNED NOT NULL,

  patient_notes     TEXT NULL,
  pain_level        TINYINT UNSIGNED NULL,

  -- The private room name for the video call. Long and random, so nobody can
  -- guess their way into someone else's consultation.
  room_id           VARCHAR(64) NULL,

  hold_expires_at   DATETIME NULL,

  cancelled_at      DATETIME NULL,
  cancelled_by      ENUM('patient', 'clinic', 'system') NULL,
  cancel_reason     VARCHAR(255) NULL,

  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,

  active_slot_key VARCHAR(112)
    GENERATED ALWAYS AS (
      CASE WHEN status IN ('pending_payment', 'confirmed', 'in_progress', 'completed')
           THEN CONCAT(clinic_id, '|', physio_id, '|', appointment_date, '|',
                       start_time, '|', slot_seat)
           ELSE NULL
      END
    ) STORED,

  UNIQUE KEY uq_appointment_code (clinic_id, code),
  UNIQUE KEY uq_active_slot (active_slot_key),

  KEY idx_appt_patient (clinic_id, patient_id, appointment_date),
  KEY idx_appt_day (clinic_id, physio_id, appointment_date, status),
  KEY idx_appt_status (clinic_id, status),
  KEY idx_appt_holds (status, hold_expires_at),

  KEY idx_appt_package (patient_package_id),

  CONSTRAINT fk_appt_package FOREIGN KEY (patient_package_id)
    REFERENCES patient_packages (id) ON DELETE SET NULL,
  CONSTRAINT fk_appt_booked_by FOREIGN KEY (booked_by)
    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_appt_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE RESTRICT,
  CONSTRAINT fk_appt_patient FOREIGN KEY (patient_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_appt_physio FOREIGN KEY (physio_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_appt_service FOREIGN KEY (service_id)
    REFERENCES services (id) ON DELETE RESTRICT
) ENGINE = InnoDB;


-- ===========================================================================
--  12. PAYMENTS — patient money, belonging to the CLINIC
-- ===========================================================================
--  This is NOT your revenue. It is processed with the clinic's own Razorpay keys
--  and settles into the clinic's own bank account. We record it so the clinic
--  has a ledger and the patient has a receipt, and for no other reason.
--
--  Your revenue is in platform_invoices. Keeping the two apart is what makes
--  both sets of books simple.
-- ===========================================================================
CREATE TABLE payments (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id          INT UNSIGNED NOT NULL,
  appointment_id     INT UNSIGNED NULL,

  -- 'razorpay' for online, or the desk method itself ('cash', 'upi', 'card',
  -- 'bank_transfer'). Calling offline money 'razorpay' would make the ledger lie.
  provider           VARCHAR(30) NOT NULL DEFAULT 'razorpay',
  -- Exactly one of appointment_id and patient_package_id is set — a package sale
  -- is one payment for ten sessions, not a payment against a visit.
  patient_package_id INT UNSIGNED NULL,
  razorpay_order_id  VARCHAR(80)  NULL,
  razorpay_payment_id VARCHAR(80) NULL,
  razorpay_signature VARCHAR(255) NULL,

  amount_paise       INT UNSIGNED NOT NULL,
  currency           CHAR(3) NOT NULL DEFAULT 'INR',

  status             ENUM('created', 'paid', 'failed', 'refunded')
                     NOT NULL DEFAULT 'created',

  method             VARCHAR(40) NULL,
  -- Who took the money. An online payment carries its own proof; a banknote does
  -- not, so this is what makes the day's cash reconcilable.
  collected_by       INT UNSIGNED NULL,
  -- A receipt book number, or a UPI reference read off a patient's phone.
  reference          VARCHAR(120) NULL,
  error_description  VARCHAR(500) NULL,

  refund_id          VARCHAR(80) NULL,
  refunded_paise     INT UNSIGNED NOT NULL DEFAULT 0,
  refunded_at        DATETIME NULL,

  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,

  -- Order ids come from the clinic's own Razorpay account, so they are only
  -- unique within that account — hence the composite key.
  UNIQUE KEY uq_razorpay_order (clinic_id, razorpay_order_id),
  KEY idx_payment_clinic_status (clinic_id, status, created_at),
  KEY idx_payment_appt (appointment_id),

  KEY idx_payment_package (patient_package_id),

  CONSTRAINT fk_payment_pp FOREIGN KEY (patient_package_id)
    REFERENCES patient_packages (id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_collected_by FOREIGN KEY (collected_by)
    REFERENCES users (id) ON DELETE SET NULL,

  -- A payment that belongs to nothing is an accounting hole; one that belongs to
  -- both is a double count.
  CONSTRAINT chk_payment_target CHECK (
    (appointment_id IS NOT NULL AND patient_package_id IS NULL) OR
    (appointment_id IS NULL AND patient_package_id IS NOT NULL)
  ),

  CONSTRAINT fk_payment_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_appt FOREIGN KEY (appointment_id)
    REFERENCES appointments (id) ON DELETE RESTRICT
) ENGINE = InnoDB;


-- ===========================================================================
--  13. CONSULTATION NOTES — clinical records in SOAP format
-- ===========================================================================
--  SOAP is the documentation standard physiotherapists are actually taught:
--    S — Subjective  What the patient reports. "Pain 6/10, worse in mornings."
--    O — Objective   What the physio measures. "Lumbar flexion 40°, SLR 60°."
--    A — Assessment  The clinical reasoning. "L4-L5 discogenic pain."
--    P — Plan        What happens next. "Manual therapy + McKenzie, 2x/week."
--
--  Four columns rather than one blob, so you can later chart how a measurement
--  changed across a course of treatment.
-- ===========================================================================
CREATE TABLE consultation_notes (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id            INT UNSIGNED NOT NULL,
  appointment_id       INT UNSIGNED NOT NULL,
  physio_id            INT UNSIGNED NOT NULL,

  subjective           TEXT NULL,
  objective            TEXT NULL,
  assessment           TEXT NULL,
  plan                 TEXT NULL,

  exercises_prescribed JSON NULL,   -- [{name, sets, reps, frequency, notes}]

  pain_level_before    TINYINT UNSIGNED NULL,
  pain_level_after     TINYINT UNSIGNED NULL,

  follow_up_date       DATE NULL,
  sessions_recommended TINYINT UNSIGNED NULL,

  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,

  -- One note per appointment.
  UNIQUE KEY uq_note_appointment (appointment_id),
  KEY idx_note_clinic (clinic_id, created_at),

  CONSTRAINT fk_note_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE RESTRICT,
  CONSTRAINT fk_note_appt FOREIGN KEY (appointment_id)
    REFERENCES appointments (id) ON DELETE CASCADE,
  CONSTRAINT fk_note_physio FOREIGN KEY (physio_id)
    REFERENCES users (id) ON DELETE RESTRICT
) ENGINE = InnoDB;


-- ===========================================================================
--  14. REVIEWS — patient feedback, and a genuine SEO asset for each clinic
-- ===========================================================================
--  is_published defaults to 0, so nothing appears publicly until the clinic
--  approves it.
-- ===========================================================================
CREATE TABLE reviews (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id      INT UNSIGNED NOT NULL,
  patient_id     INT UNSIGNED NOT NULL,
  appointment_id INT UNSIGNED NULL,
  rating         TINYINT UNSIGNED NOT NULL,
  comment        TEXT NULL,
  is_published   TINYINT(1) NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_review_clinic_published (clinic_id, is_published, created_at),

  CONSTRAINT fk_review_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE RESTRICT,
  CONSTRAINT fk_review_patient FOREIGN KEY (patient_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_review_appt FOREIGN KEY (appointment_id)
    REFERENCES appointments (id) ON DELETE SET NULL,
  CONSTRAINT chk_review_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE = InnoDB;


-- ===========================================================================
--  15. LOGIN ATTEMPTS — slowing down password guessing
-- ===========================================================================
--  Behind a clinic admin password sits every patient's medical history, so a
--  guessed password is a data breach rather than an inconvenience. See
--  lib/loginThrottle.js for why this produces a growing DELAY rather than a
--  lockout — locking accounts hands an attacker a way to shut a clinic out of
--  its own business.
-- ===========================================================================
CREATE TABLE login_attempts (
  /**
   * email|ip together, never the email alone.
   *
   * Keyed on the email alone, anybody who knows a clinic owner's address could
   * throttle them out of their own account from anywhere. Including the client
   * address means guessing from one place slows that place down and leaves the
   * real owner unaffected.
   */
  attempt_key       VARCHAR(190) NOT NULL PRIMARY KEY,

  failures          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  first_failure_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_failure_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- When the next attempt will even be considered. NULL before the first rung.
  blocked_until     DATETIME NULL,

  -- For the nightly purge; without it the table grows forever.
  KEY idx_login_attempts_stale (last_failure_at)
) ENGINE = InnoDB;


-- ===========================================================================
--  16. WHATSAPP MESSAGES — every send, and every deliberate non-send
-- ===========================================================================
--  Three jobs: counting the monthly allowance, showing a clinic what its
--  patients were actually told, and answering a delivery complaint a month
--  later. Skipped messages are recorded as carefully as sent ones — "no consent"
--  and "no phone number" are both things reception can fix in a minute, and
--  neither is visible anywhere else.
-- ===========================================================================
CREATE TABLE whatsapp_messages (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clinic_id         INT UNSIGNED NOT NULL,
  patient_id        INT UNSIGNED NULL,

  -- Which template, e.g. 'appointment_reminder'. Not the rendered text: the text
  -- is Meta's, from the approved template, and could change without us.
  template          VARCHAR(60) NOT NULL,
  -- 'authentication' is a login OTP. Meta bills and moderates that category
  -- separately, and the gates in lib/whatsapp.js treat it differently: a code
  -- the user asked for thirty seconds ago ignores marketing consent.
  category          ENUM('utility', 'marketing', 'authentication')
                    NOT NULL DEFAULT 'utility',

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


-- ===========================================================================
--  17. LOGIN OTPS — phone number sign-in
-- ===========================================================================
--  Reception collects a phone number for every patient and an email for only
--  some of them, so the number is the identity this product can actually rely
--  on. See database/migrations/006-phone-otp.sql for the full reasoning,
--  including why users.phone is deliberately NOT unique — one number serves a
--  whole family in India, so it identifies a household and the login shows an
--  account picker when it matches more than one person.
--
--  The code is bcrypt-hashed for the same reason a password is: six digits is a
--  million possibilities, which is instant to exhaust offline. A leaked table of
--  plaintext codes would be a leaked table of live logins.
-- ===========================================================================
CREATE TABLE login_otps (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- Scoped like everything else: a code issued by one clinic must never open
  -- another, even for the same person on the same number.
  clinic_id     INT UNSIGNED NOT NULL,

  -- Normalised by normaliseNumber() in lib/whatsapp.js, so '98765 43210',
  -- '+919876543210' and '09876543210' share one row rather than getting three
  -- separate attempt budgets.
  phone         VARCHAR(20) NOT NULL,
  code_hash     VARCHAR(255) NOT NULL,

  -- Wrong guesses against THIS code. At the limit the row is consumed, so
  -- brute-forcing costs the attacker a fresh OTP — which is itself rate limited.
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,

  expires_at    DATETIME NOT NULL,
  -- Set on use OR on burn-out. Single-use: without this one intercepted message
  -- is a permanent key.
  consumed_at   DATETIME NULL,
  ip            VARCHAR(45) NULL,

  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_otp_lookup (clinic_id, phone, consumed_at, expires_at),
  KEY idx_otp_rate_phone (phone, created_at),
  KEY idx_otp_rate_ip (ip, created_at),

  CONSTRAINT fk_otp_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE CASCADE
) ENGINE = InnoDB;


-- ===========================================================================
--  18. PASSWORD RESETS — the only way back into an account
-- ===========================================================================
--  See database/migrations/007-account-recovery-and-errors.sql for why this
--  token is SHA-256 while the login OTP is bcrypt. Short version: a 32-byte
--  random token cannot be brute-forced, so slowness buys nothing — and it has to
--  be looked up BY VALUE, which bcrypt's per-row salt makes impossible to index.
-- ===========================================================================
CREATE TABLE password_resets (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,

  token_hash    CHAR(64) NOT NULL,
  -- One hour: long enough to dig the mail out of a spam folder, short enough that
  -- an archived message stops being a key by the afternoon.
  expires_at    DATETIME NOT NULL,
  -- Single use. Inboxes get breached more often than databases.
  consumed_at   DATETIME NULL,

  ip            VARCHAR(45) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_reset_token (token_hash),
  KEY idx_reset_user (user_id, created_at),

  CONSTRAINT fk_reset_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;


-- ===========================================================================
--  19. ERROR EVENTS — so a broken page is not a secret
-- ===========================================================================
--  GROUPED by fingerprint, not listed. One broken page hit by forty patients is
--  ONE problem; forty identical rows would bury the three other faults that each
--  happened once. Unique fingerprint, rising count — the same idea every error
--  tracker uses, in one table and no third-party service.
-- ===========================================================================
CREATE TABLE error_events (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- The message plus the FIRST stack frame only. Line numbers deeper in the stack
  -- move between builds and would split one fault into many.
  fingerprint   CHAR(64) NOT NULL,

  message       VARCHAR(500) NOT NULL,
  stack         TEXT NULL,

  -- Nullable on purpose: a failing cron job has no route and no user, and that is
  -- exactly when this table is the only thing that knows.
  route         VARCHAR(300) NULL,
  clinic_id     INT UNSIGNED NULL,
  user_id       INT UNSIGNED NULL,
  source        ENUM('server', 'browser') NOT NULL DEFAULT 'server',

  occurrences   INT UNSIGNED NOT NULL DEFAULT 1,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Kept, not deleted, so a fault coming back reads as a return rather than as
  -- something brand new.
  resolved_at   DATETIME NULL,
  alerted_at    DATETIME NULL,

  UNIQUE KEY uq_error_fingerprint (fingerprint),
  KEY idx_error_recent (resolved_at, last_seen_at),
  KEY idx_error_clinic (clinic_id, last_seen_at),

  -- SET NULL rather than CASCADE: losing a clinic must not erase the record of
  -- what went wrong while they were a customer.
  CONSTRAINT fk_error_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE SET NULL
) ENGINE = InnoDB;
