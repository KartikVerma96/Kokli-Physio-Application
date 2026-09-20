import crypto from 'node:crypto'
import { query, queryOne } from '@/lib/db'
import { platform, platformUrl } from '@/config/platform'
import { sendEmailInBackground } from '@/lib/email'

/**
 * ============================================================================
 *  KNOWING WHEN SOMETHING BREAKS
 * ============================================================================
 *  app/error.js shows the patient a polite page. It told the operator nothing.
 *
 *  With one clinic you notice a broken page yourself. With twenty you find out
 *  when somebody finally telephones — and by then it has been broken for a week,
 *  during which every patient who hit it went somewhere else. This file is the
 *  difference between finding out in a minute and finding out in a month.
 *
 *  ============================================================================
 *  WHY NOT SENTRY
 *  ============================================================================
 *  Sentry is better than this and would take ten minutes to add. It also means a
 *  third party receiving stack traces from an application that handles Indian
 *  medical records, a per-seat bill that grows with the business, and a dependency
 *  in the one code path that must never itself fail.
 *
 *  One table and one page is enough to answer the only questions that matter: what
 *  is broken, how often, since when, and for which clinic. If the business grows
 *  past that, `reportError` is the single function that changes.
 *
 *  ============================================================================
 *  GROUPED, NOT LISTED
 *  ============================================================================
 *  One broken page hit by forty patients is ONE problem. Forty rows would bury the
 *  three other faults that each happened once — and those are usually the
 *  interesting ones. So identical faults collapse onto a fingerprint and a counter.
 *
 *  The fingerprint is the message plus the FIRST stack frame only. Including the
 *  whole stack looks more precise and is worse: line numbers shift between builds,
 *  so the same bug would appear as a brand-new fault after every deployment.
 *
 *  ============================================================================
 *  THIS FUNCTION MUST NEVER THROW
 *  ============================================================================
 *  It runs inside catch blocks. If reporting an error can itself raise one, then
 *  the first database hiccup turns every handled failure into an unhandled crash,
 *  and the monitoring becomes the outage. Every path here is wrapped.
 * ============================================================================
 */

/**
 * A cap on DISTINCT faults recorded per hour.
 *
 * Repeat occurrences are free — ON DUPLICATE KEY just bumps a counter on one row.
 * The runaway case is a fault whose message varies every time, which defeats
 * grouping and inserts a fresh row per request. `fingerprintFor` generalises the
 * usual culprits, but it cannot anticipate every message a library will invent, so
 * this is the backstop that keeps a bad hour from becoming a full disk.
 */
const MAX_DISTINCT_PER_HOUR = 500

/**
 * Record an error. Never throws, never blocks anything important.
 *
 * @param {object}  input
 * @param {Error|string} input.error
 * @param {string} [input.route]     the path being served
 * @param {number} [input.clinicId]
 * @param {number} [input.userId]
 * @param {'server'|'browser'} [input.source]
 */
export async function reportError({
  error,
  route = null,
  clinicId = null,
  userId = null,
  source = 'server',
} = {}) {
  try {
    const message = String(error?.message || error || 'Unknown error').slice(0, 500)
    const stack = typeof error?.stack === 'string' ? error.stack.slice(0, 8000) : null

    // Always to the terminal as well. In development that is where the developer is
    // looking, and in production it is what the hosting platform captures — the
    // database write is the addition, not the replacement.
    console.error(`[error] ${route || source}: ${message}`)

    const fingerprint = fingerprintFor(message, stack)

    /**
     * The backstop. Checked before inserting, and only for faults not already on
     * record — an existing fingerprint is always allowed through, because bumping a
     * counter costs nothing and losing the count of a live fault costs a lot.
     */
    const known = await queryOne(
      `SELECT id FROM error_events WHERE fingerprint = ?`,
      [fingerprint]
    )
    if (!known) {
      const distinct = await queryOne(
        `SELECT COUNT(*) AS n FROM error_events WHERE first_seen_at > NOW() - INTERVAL 1 HOUR`
      )
      if (Number(distinct?.n || 0) >= MAX_DISTINCT_PER_HOUR) {
        console.error('[errorLog] distinct-fault cap reached this hour; not recording new faults')
        return { ok: false, capped: true }
      }
    }

    /**
     * The whole write in one statement.
     *
     * ON DUPLICATE KEY UPDATE means "insert it, or bump the one that is already
     * there". Doing it as SELECT-then-INSERT-or-UPDATE would race: two requests
     * failing at the same moment both find nothing and both insert, and one of them
     * dies on the unique index — inside the error handler, which is the worst place
     * for a second error.
     *
     * `route` and the ids are refreshed to the LATEST occurrence, because when
     * chasing a fault the most recent context is the useful one.
     */
    const [result] = await query(
      `INSERT INTO error_events
         (fingerprint, message, stack, route, clinic_id, user_id, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         occurrences  = occurrences + 1,
         last_seen_at = NOW(),
         message      = VALUES(message),
         stack        = COALESCE(VALUES(stack), stack),
         route        = COALESCE(VALUES(route), route),
         clinic_id    = COALESCE(VALUES(clinic_id), clinic_id),
         user_id      = COALESCE(VALUES(user_id), user_id),
         -- A fault that comes back is not resolved any more, whatever somebody
         -- ticked last week. Clearing this is what makes a regression visible.
         resolved_at  = NULL`,
      [fingerprint, message, stack, truncate(route, 300), clinicId, userId, source]
    ).then((r) => [r])

    // affectedRows is 1 for a fresh insert and 2 for an update — a mysql2 quirk
    // that happens to be exactly the signal needed for "is this new?".
    const isNew = result?.affectedRows === 1
    if (isNew) await alertOnce(fingerprint, message, route)

    return { ok: true, isNew }
  } catch (loggingFailure) {
    // The last resort. Nothing above this may propagate.
    console.error('[errorLog] could not record an error:', loggingFailure?.message)
    return { ok: false }
  }
}

/**
 * Email the operator the first time a fault appears.
 *
 * ONLY the first time, which is the entire design. An alert per occurrence trains
 * you to filter the alerts, and a filtered alert is the same as no alert. One
 * message per NEW fault stays readable and stays trusted.
 */
async function alertOnce(fingerprint, message, route) {
  try {
    if (!platform.supportEmail) return

    // Cheap circuit breaker: if something is generating a flood of DISTINCT faults,
    // do not also generate a flood of email.
    const recent = await queryOne(
      `SELECT COUNT(*) AS n FROM error_events WHERE first_seen_at > NOW() - INTERVAL 1 HOUR`
    )
    if (Number(recent?.n || 0) > 20) return

    await query(`UPDATE error_events SET alerted_at = NOW() WHERE fingerprint = ?`, [fingerprint])

    sendEmailInBackground({
      to: platform.supportEmail,
      subject: `[${platform.name}] New error: ${message.slice(0, 90)}`,
      html: `
        <p style="font-family:sans-serif;">Something has failed for the first time.</p>
        <p style="font-family:sans-serif;"><strong>${escapeHtml(message)}</strong></p>
        <p style="font-family:sans-serif;">Route: ${escapeHtml(route || 'unknown')}</p>
        <p style="font-family:sans-serif;">
          <a href="${platformUrl('/platform/errors')}">Open the error log</a>
        </p>`,
    })
  } catch {
    // An alert that cannot be sent must not undo the record that was written.
  }
}

/**
 * Wrap a route handler or cron job so failures are recorded.
 *
 *     export const POST = withErrorReporting(handler, '/api/payments/webhook')
 *
 * The error is re-thrown after recording. Swallowing it here would turn a genuine
 * 500 into a silent 200, which is a far worse bug than the one being reported.
 */
export function withErrorReporting(handler, route) {
  return async function reported(...args) {
    try {
      return await handler(...args)
    } catch (error) {
      await reportError({ error, route })
      throw error
    }
  }
}

/* ========================================================================== */
/*  READING IT BACK                                                           */
/* ========================================================================== */

/** Recent faults for the console, newest activity first. */
export function recentErrors({ includeResolved = false, limit = 100 } = {}) {
  return query(
    `SELECT e.id, e.fingerprint, e.message, e.stack, e.route, e.source,
            e.occurrences, e.first_seen_at, e.last_seen_at, e.resolved_at,
            c.name AS clinic_name, c.slug AS clinic_slug
       FROM error_events e
       LEFT JOIN clinics c ON c.id = e.clinic_id
      ${includeResolved ? '' : 'WHERE e.resolved_at IS NULL'}
      ORDER BY e.last_seen_at DESC
      LIMIT ${Number(limit) || 100}`
  )
}

export async function resolveError(id) {
  await query(`UPDATE error_events SET resolved_at = NOW() WHERE id = ?`, [Number(id)])
}

/**
 * Drop resolved faults nobody has seen in a fortnight.
 *
 * Unresolved ones are never deleted, however old: an error that has been broken
 * quietly for three months is the most important row in the table, not the least.
 */
export async function purgeOldErrors() {
  const [result] = await query(
    `DELETE FROM error_events
      WHERE resolved_at IS NOT NULL AND last_seen_at < NOW() - INTERVAL 14 DAY`
  ).then((r) => [r])
  return result?.affectedRows || 0
}

/* ========================================================================== */
/*  HELPERS                                                                   */
/* ========================================================================== */

/**
 * The message plus the first stack frame, hashed.
 *
 * Numbers inside the message are replaced first: "Duplicate entry 'order_8321'"
 * and "Duplicate entry 'order_9014'" are the same bug, and left alone they would
 * become one new fault per occurrence — the exact thing grouping exists to stop.
 */
function fingerprintFor(message, stack) {
  const generalised = message
    // Long hex runs first — ids, tokens, order references. Doing digits first would
    // turn 'a3f9b2' into 'aNfNbN' and leave it unique per occurrence.
    .replace(/\b[0-9a-f]{8,}\b/gi, 'HEX')
    // Anything quoted is almost always a value rather than part of the fault:
    // "Duplicate entry 'order_8321'" is the same bug as 'order_9014'.
    .replace(/'[^']*'/g, "'X'")
    .replace(/\d+/g, 'N')
  const firstFrame = stack ? (stack.split('\n')[1] || '').trim().replace(/:\d+:\d+/g, '') : ''
  return crypto.createHash('sha256').update(`${generalised}|${firstFrame}`).digest('hex')
}

function truncate(value, max) {
  if (!value) return null
  const text = String(value)
  return text.length > max ? text.slice(0, max) : text
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
