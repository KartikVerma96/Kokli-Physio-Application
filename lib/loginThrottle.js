import { query, queryOne } from '@/lib/db'

/**
 * ============================================================================
 *  SLOWING DOWN PASSWORD GUESSING
 * ============================================================================
 *
 *  WHY THIS EXISTS
 *  ---------------
 *  Nothing stopped an attacker trying passwords. A probe managed 13 guesses a
 *  second with no limit and no lockout — roughly 45,000 an hour against one
 *  account, from one laptop, on a home connection.
 *
 *  For most software that is bad. For this software it is worse: behind a clinic
 *  admin password sit every patient's name, phone number, medical history and
 *  clinical notes. A single guessed password is a medical data breach, and in
 *  most jurisdictions a reportable one.
 *
 *  WHY IT IS A DELAY AND NOT A LOCKOUT
 *  -----------------------------------
 *  Locking an account after N failures sounds stronger and creates a new attack:
 *  anybody who knows a clinic owner's email can lock them out of their own
 *  business, permanently, by failing their password every few minutes. That is a
 *  denial-of-service handed to the attacker for free.
 *
 *  So failures produce a growing WAIT, and the counter is keyed on the email AND
 *  the client address together. Guessing from one address slows that address
 *  down; it does not lock the real owner out from theirs. The correct password
 *  always works the moment the wait has passed, and a success clears the record.
 *
 *  This is the OWASP recommendation, and it is worth understanding why the
 *  obvious design is the wrong one.
 *
 *  WHY IN THE DATABASE RATHER THAN IN MEMORY
 *  -----------------------------------------
 *  A Map in the Node process would be faster and would forget everything on
 *  every deploy — an attacker just waits for a restart. It also breaks the moment
 *  the app runs as two instances. One tiny row per email survives both.
 * ============================================================================
 */

/**
 * The ladder. Each step is "after this many failures, wait this long".
 *
 * Deliberately gentle at the start: real people mistype their own password two or
 * three times without being attacked, and punishing that teaches them to hate the
 * software. It gets steep quickly after that — by the twentieth attempt an
 * attacker is down to four guesses an hour.
 */
const LADDER = [
  { failures: 5, waitSeconds: 30 },
  { failures: 8, waitSeconds: 120 },
  { failures: 12, waitSeconds: 300 },
  { failures: 20, waitSeconds: 900 },
]

/** Failures older than this are forgotten — yesterday's typo is not evidence. */
const WINDOW_MINUTES = 60

function keyFor(email, ip) {
  return `${String(email || '').toLowerCase()}|${ip || 'unknown'}`.slice(0, 190)
}

/**
 * How long this email+address must wait before another attempt is considered.
 *
 * @returns {Promise<{blocked: boolean, secondsLeft: number, failures: number}>}
 */
export async function checkLoginAllowed(email, ip) {
  const row = await queryOne(
    `SELECT failures, blocked_until,
            TIMESTAMPDIFF(SECOND, NOW(), blocked_until) AS seconds_left
       FROM login_attempts
      WHERE attempt_key = ?`,
    [keyFor(email, ip)]
  )

  if (!row) return { blocked: false, secondsLeft: 0, failures: 0 }

  const secondsLeft = Number(row.seconds_left) || 0
  return {
    blocked: Boolean(row.blocked_until) && secondsLeft > 0,
    secondsLeft: Math.max(0, secondsLeft),
    failures: Number(row.failures) || 0,
  }
}

/** Record a failed attempt and work out the new wait. */
export async function recordLoginFailure(email, ip) {
  const key = keyFor(email, ip)

  /**
   * One statement, not read-then-write.
   *
   * Two simultaneous guesses would both read "4 failures" and both write 5,
   * costing the attacker nothing. Letting MySQL do the increment makes that
   * impossible. The `first_failure_at` reset is what expires the window: if the
   * last failure was over an hour ago, the count starts again from one.
   */
  await query(
    `INSERT INTO login_attempts (attempt_key, failures, first_failure_at, last_failure_at)
     VALUES (?, 1, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       failures = IF(last_failure_at < DATE_SUB(NOW(), INTERVAL ? MINUTE), 1, failures + 1),
       first_failure_at = IF(last_failure_at < DATE_SUB(NOW(), INTERVAL ? MINUTE), NOW(), first_failure_at),
       last_failure_at = NOW()`,
    [key, WINDOW_MINUTES, WINDOW_MINUTES]
  )

  const row = await queryOne('SELECT failures FROM login_attempts WHERE attempt_key = ?', [key])
  const failures = Number(row?.failures) || 1

  // The highest rung reached, so the wait grows rather than resetting.
  const step = [...LADDER].reverse().find((rung) => failures >= rung.failures)
  if (step) {
    await query(
      'UPDATE login_attempts SET blocked_until = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE attempt_key = ?',
      [step.waitSeconds, key]
    )
  }

  return { failures, waitSeconds: step?.waitSeconds ?? 0 }
}

/**
 * Forget everything about this email+address.
 *
 * Called on a SUCCESSFUL sign-in. Somebody who mistyped their password four
 * times and then got it right is not a threat, and carrying their count forward
 * would make the next honest mistake feel like a punishment.
 */
export async function clearLoginFailures(email, ip) {
  await query('DELETE FROM login_attempts WHERE attempt_key = ?', [keyFor(email, ip)])
}

/**
 * Housekeeping.
 *
 * Without it the table grows by one row per attacked address, forever. Called
 * from the nightly sweep rather than on every login — a DELETE on the hot path of
 * signing in is not worth it.
 */
export async function purgeOldLoginAttempts() {
  const result = await query(
    'DELETE FROM login_attempts WHERE last_failure_at < DATE_SUB(NOW(), INTERVAL 7 DAY)'
  )
  return result.affectedRows || 0
}

/** "in 2 minutes" — for a message a human reads. */
export function waitLabel(seconds) {
  if (seconds <= 60) return `${Math.max(1, Math.ceil(seconds))} seconds`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}
