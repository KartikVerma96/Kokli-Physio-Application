-- ===========================================================================
--  MIGRATION 007 — ACCOUNT RECOVERY, AND KNOWING WHEN THINGS BREAK
-- ===========================================================================
--
--      npm run db:migrate
--
--  TWO GAPS THAT ONLY LOOK SMALL
--  -----------------------------
--  1. NOBODY COULD CHANGE A PASSWORD. Not reset a forgotten one — CHANGE one.
--     Searching the codebase for `password_hash` found three writes: the signup
--     form, the register form, and an admin creating a colleague. None of them
--     was a person changing their own.
--
--     That made the team page dishonest. It hands the owner a "temporary
--     password" field with the hint "Share it with them and ask them to change
--     it", and there was no way to change it. Every physiotherapist in the
--     product was permanently using a password their boss had typed and sent
--     over WhatsApp.
--
--     Worse for the platform owner, who has no phone number on file and is
--     deliberately excluded from phone sign-in (a SIM swap must never reach an
--     account that can read every clinic's records). A forgotten password there
--     meant editing the database by hand.
--
--  2. NOBODY WAS TOLD WHEN A PAGE FAILED. app/error.js shows the patient a
--     polite message. It tells the operator nothing. With one clinic you notice;
--     with twenty you find out when somebody finally telephones, and by then it
--     has been broken for a week.
--
--  WHY THE RESET TOKEN IS SHA-256 AND THE LOGIN OTP IS bcrypt
--  ---------------------------------------------------------
--  Not an inconsistency — the threat is different, and so is the answer.
--
--  An OTP is six digits: a million possibilities, which a laptop exhausts
--  instantly. It needs a SLOW hash so that a stolen table cannot be reversed.
--
--  A reset token is 32 random bytes: 2^256 possibilities. No amount of computing
--  reverses that, so slowness buys nothing — and it costs something real, because
--  a token must be looked up BY ITS VALUE. bcrypt salts every hash differently,
--  so the same input hashes differently every time and cannot be indexed; finding
--  a token would mean bcrypt-comparing every live row. SHA-256 is deterministic,
--  so one indexed lookup finds it.
--
--  What both share is that the plaintext is never stored. A leaked table of live
--  reset tokens is a leaked table of accounts.
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  1. RESET TOKENS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,

  -- SHA-256 hex of the token that was emailed. 64 characters, indexed, unique.
  token_hash    CHAR(64) NOT NULL,

  -- One hour. Long enough to find the email in a spam folder, short enough that
  -- a forwarded or archived message stops being a key by the afternoon.
  expires_at    DATETIME NOT NULL,

  -- Single use. Without this, the link in an inbox works forever — and inboxes
  -- get breached far more often than databases do.
  consumed_at   DATETIME NULL,

  -- Who asked, so a flood can be traced and rate limited.
  ip            VARCHAR(45) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_reset_token (token_hash),
  -- "How many has this account asked for recently", for the rate limit.
  KEY idx_reset_user (user_id, created_at),

  CONSTRAINT fk_reset_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
--  2. WHEN THE PASSWORD LAST CHANGED
-- ---------------------------------------------------------------------------
--  Shown on the account page, so somebody can tell at a glance whether the
--  temporary password their clinic gave them is still the one in use. Also the
--  column a future "sign out everywhere" would compare a token's issue time
--  against.
ALTER TABLE users
  ADD COLUMN password_changed_at DATETIME NULL AFTER password_hash;

-- Everyone who already has a password got it at sign-up, so that is the honest
-- answer rather than pretending it changed today.
UPDATE users SET password_changed_at = created_at WHERE password_hash IS NOT NULL;


-- ---------------------------------------------------------------------------
--  3. ERRORS, GROUPED
-- ---------------------------------------------------------------------------
--  GROUPED, not listed. One broken page hit by forty patients is ONE problem,
--  and a table with forty identical rows hides the other three faults that
--  happened once each. So the fingerprint is unique and the count goes up — the
--  same idea every error tracker uses, in one table.
CREATE TABLE IF NOT EXISTS error_events (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- SHA-256 of the message plus the first stack frame. Stable across occurrences,
  -- different between faults. Deliberately NOT the whole stack: line numbers move
  -- between builds and would split one fault into many.
  fingerprint   CHAR(64) NOT NULL,

  message       VARCHAR(500) NOT NULL,
  stack         TEXT NULL,

  -- Where it happened, and to whom. Both nullable: an error in a cron job has no
  -- route and no user, and that is exactly when this table earns its keep.
  route         VARCHAR(300) NULL,
  clinic_id     INT UNSIGNED NULL,
  user_id       INT UNSIGNED NULL,
  -- 'server' or 'browser'.
  source        ENUM('server', 'browser') NOT NULL DEFAULT 'server',

  occurrences   INT UNSIGNED NOT NULL DEFAULT 1,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Set when somebody has dealt with it. Kept rather than deleted so that a fault
  -- coming back is visible as a return, not as something new.
  resolved_at   DATETIME NULL,
  -- Whether the "something new just broke" alert has gone out for this one.
  alerted_at    DATETIME NULL,

  UNIQUE KEY uq_error_fingerprint (fingerprint),
  -- The console's main query: unresolved, newest first.
  KEY idx_error_recent (resolved_at, last_seen_at),
  KEY idx_error_clinic (clinic_id, last_seen_at),

  -- ON DELETE SET NULL, not CASCADE: deleting a clinic must not erase the record
  -- of what went wrong while they were a customer.
  CONSTRAINT fk_error_clinic FOREIGN KEY (clinic_id)
    REFERENCES clinics (id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
