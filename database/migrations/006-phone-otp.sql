-- ===========================================================================
--  MIGRATION 006 — PHONE NUMBER LOGIN WITH A WHATSAPP OTP
-- ===========================================================================
--
--      npm run db:migrate
--
--  WHY PHONE AND NOT EMAIL
--  -----------------------
--  Look at what reception actually collects when somebody telephones for an
--  appointment (app/admin/appointments/new/DeskBooking.js):
--
--      Full name    required
--      Phone        required
--      Email        OPTIONAL
--
--  Phone is the field that is always there and always right — the receptionist
--  was on a call and heard it from the patient. Email is the field that is half
--  the time blank, and the other half typed from a spelling read out over a bad
--  line.
--
--  That makes phone the correct login identity for this product, not a
--  convenience. It also fixes two problems at once:
--
--    * A desk-created patient has NO password_hash, so they can never sign in
--      with a password, and there is no forgot-password flow to set one. Today
--      their only door is Google — and only if the email happens to be right.
--
--    * A mistyped email is a login credential for somebody else's medical
--      records. A phone number heard directly from the patient is not.
--
--  WHY THE PHONE COLUMN IS DELIBERATELY *NOT* UNIQUE
--  -------------------------------------------------
--  In India one number serves a whole family. A mother books physiotherapy for
--  her eight-year-old on her own number; a son's number is on file for both his
--  elderly parents. UNIQUE (phone) would make all of that impossible.
--
--  So the number identifies a HOUSEHOLD, not a person. After the OTP is
--  verified, if more than one patient shares that number the login shows an
--  account picker. See lib/otp.js.
--
--  Contrast with users.email, which IS globally unique — the reasoning for that
--  is recorded at the top of schema.sql. The two are different on purpose.
--
--  WHY THE CODE IS HASHED
--  ----------------------
--  A six-digit code has a million possibilities, which a laptop exhausts
--  instantly. If these were stored in plain text, one database leak would hand
--  over every account whose code had not yet expired. bcrypt costs ~100ms per
--  check, which is nothing on a login and everything on an offline attack.
--
--  The same reasoning as password_hash. An OTP is a password that lives for five
--  minutes, and it deserves the same treatment.
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  1. THE CODES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_otps (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- Scoped to a clinic like everything else. The same person may be a patient
  -- at two clinics on this platform; a code issued by one must not open the
  -- other.
  clinic_id     INT UNSIGNED NOT NULL,

  -- Normalised to digits with a country code (see normaliseNumber in
  -- lib/whatsapp.js) so that '98765 43210', '+919876543210' and '09876543210'
  -- all land on the same row instead of granting three separate attempt budgets.
  phone         VARCHAR(20) NOT NULL,

  -- bcrypt, never the code itself.
  code_hash     VARCHAR(255) NOT NULL,

  -- Wrong guesses against THIS code. At the limit the row is consumed, so a
  -- brute-force attempt costs the attacker a fresh OTP — and fresh OTPs are
  -- themselves rate limited.
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,

  -- Five minutes. Long enough for a WhatsApp message to arrive on a slow
  -- connection, short enough that a phone left on a table is not a login.
  expires_at    DATETIME NOT NULL,

  -- Set the moment it is used or burned. A code is single-use: without this,
  -- one intercepted message is a permanent key.
  consumed_at   DATETIME NULL,

  -- Kept for rate limiting by origin and for answering "who was hammering us".
  ip            VARCHAR(45) NULL,

  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- The verify query: newest live code for this clinic and number.
  KEY idx_otp_lookup (clinic_id, phone, consumed_at, expires_at),
  -- The two rate-limit queries: how many codes has this number asked for in the
  -- last few minutes, and how many has this IP asked for in the last hour.
  KEY idx_otp_rate_phone (phone, created_at),
  KEY idx_otp_rate_ip (ip, created_at),

  CONSTRAINT fk_otp_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
--  2. FINDING A USER BY PHONE HAS TO BE FAST
-- ---------------------------------------------------------------------------
--  users.phone had no index at all, because until now nothing ever searched by
--  it — reception's duplicate check was the only caller and it runs once per new
--  patient. A login runs on every attempt, including every attempt by somebody
--  guessing, so an unindexed scan here is also a denial-of-service surface.
ALTER TABLE users
  ADD KEY idx_users_clinic_phone (clinic_id, phone);


-- ---------------------------------------------------------------------------
--  3. WAS THE NUMBER EVER PROVEN?
-- ---------------------------------------------------------------------------
--  A number typed in by reception is hearsay until somebody answers an OTP on
--  it. Recording that distinction is what lets the desk keep working exactly as
--  it does — reception should not have to verify anything to book an
--  appointment — while still knowing which numbers have been confirmed.
--
--  Mirrors email_verified, which already exists for the same reason.
ALTER TABLE users
  ADD COLUMN phone_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER email_verified;

-- Anyone who set a password through the register form typed their own number in
-- themselves and then proved they hold the account. Reception-created rows have
-- no password_hash and stay unverified until the first OTP.
UPDATE users SET phone_verified = 1
 WHERE password_hash IS NOT NULL AND phone IS NOT NULL AND phone <> '';


-- ---------------------------------------------------------------------------
--  4. A THIRD MESSAGE CATEGORY
-- ---------------------------------------------------------------------------
--  Meta bills and moderates authentication templates separately from utility and
--  marketing ones, and the gates in lib/whatsapp.js have to treat them
--  differently too: a login code the user asked for thirty seconds ago must
--  ignore the marketing-consent check, and must not be blocked because somebody
--  once opted out of appointment reminders.
--
--  Keeping it a distinct value rather than lying and calling it 'utility' means
--  the clinic's own message log stays honest about what was sent and why.
ALTER TABLE whatsapp_messages
  MODIFY COLUMN category ENUM('utility', 'marketing', 'authentication')
    NOT NULL DEFAULT 'utility';
