-- ===========================================================================
--  MIGRATION 004 — SLOW DOWN PASSWORD GUESSING
-- ===========================================================================
--
--      mysql -u root -p physio_clinic < database/migrations/004-login-throttle.sql
--
--  Nothing limited sign-in attempts. A probe managed 13 guesses a second, with
--  no limit and no lockout — about 45,000 an hour against one account from a
--  single laptop.
--
--  Behind a clinic admin password sits every patient's name, phone number,
--  medical history and clinical notes, so a guessed password is a medical data
--  breach rather than an inconvenience.
--
--  See lib/loginThrottle.js for why this produces a growing DELAY rather than a
--  lockout — locking accounts hands attackers a way to shut a clinic out of its
--  own business.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS login_attempts (
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
