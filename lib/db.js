/**
 * ============================================================================
 *  DATABASE ACCESS LAYER
 * ============================================================================
 *
 *  Everything that touches MySQL goes through this file. Three helpers:
 *
 *    query(sql, params)     → array of rows
 *    queryOne(sql, params)  → the first row, or null
 *    transaction(fn)        → runs several writes all-or-nothing
 *
 *  WHY A CONNECTION POOL?
 *  ----------------------
 *  Opening a MySQL connection takes a TCP handshake plus authentication —
 *  tens of milliseconds. Doing that per request would make every page slow.
 *  A pool opens a handful of connections once and lends them out, so a query
 *  borrows a ready connection and returns it when finished.
 *
 *  WHY THE `globalThis` DANCE BELOW?
 *  ---------------------------------
 *  In development Next.js hot-reloads modules every time you save a file.
 *  Each reload would create a brand-new pool, and after twenty saves you have
 *  twenty pools and MySQL starts refusing connections with "too many
 *  connections". Stashing the pool on globalThis — which survives reloads —
 *  fixes it. In production the module loads once, so it makes no difference.
 * ============================================================================
 */

import mysql from 'mysql2/promise'

function createPool() {
  return mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'physio_clinic',

    waitForConnections: true,
    connectionLimit: 10,   // plenty for a single-clinic app
    queueLimit: 0,

    // Deliberately OFF. With multipleStatements enabled, a single SQL
    // injection hole would let an attacker append "; DROP TABLE users".
    // We never need it at runtime — only the setup script does.
    multipleStatements: false,

    // Return DATE columns as 'YYYY-MM-DD' strings instead of JS Date objects.
    // This avoids the classic timezone bug where an appointment on the 15th
    // silently becomes the 14th because the server is in UTC and midnight
    // local time is the previous day in UTC. Dates in this app are calendar
    // dates, not instants, so strings are the honest representation.
    dateStrings: true,

    timezone: 'local',
    charset: 'utf8mb4',
    enableKeepAlive: true,
  })
}

// One pool per process, surviving hot reloads in development.
const globalForDb = globalThis
if (!globalForDb.__physioPool) {
  globalForDb.__physioPool = createPool()
}
export const pool = globalForDb.__physioPool

/**
 * Run a SQL query and get the rows back.
 *
 * ALWAYS pass values through the `params` array, never by building a string:
 *
 *   ✗ query(`SELECT * FROM users WHERE email = '${email}'`)
 *   ✓ query('SELECT * FROM users WHERE email = ?', [email])
 *
 * The first version lets someone type  ' OR 1=1 --  as their email and read
 * your entire users table. The second sends the value separately from the
 * SQL, so MySQL treats it strictly as data and never as instructions. This is
 * called a prepared statement, and it is the single most important security
 * habit in backend development.
 */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params)
  return rows
}

/**
 * Same as query(), but for when you expect at most one row.
 * Returns null rather than undefined so `if (!user)` always reads cleanly.
 */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params)
  return rows.length > 0 ? rows[0] : null
}

/**
 * Run several statements as one atomic unit.
 *
 * Either every statement succeeds and the whole lot is committed, or one
 * throws and the whole lot is rolled back as if it never happened. This
 * matters enormously for money: booking an appointment inserts a row into
 * `appointments` AND a row into `payments`. Without a transaction, a crash
 * between the two leaves an appointment nobody can pay for, or a payment
 * attached to nothing.
 *
 *   await transaction(async (tx) => {
 *     const appt = await tx.execute('INSERT INTO appointments ...')
 *     await tx.execute('INSERT INTO payments ...')
 *   })
 *
 * Note we take a dedicated connection out of the pool: a transaction is a
 * property of one connection, so all its statements must run on the same one.
 *
 * ---------------------------------------------------------------------------
 * DEADLOCKS ARE RETRIED, AND THIS IS NOT OPTIONAL
 * ---------------------------------------------------------------------------
 * A deadlock is not a bug and not a failure. When two transactions each hold a
 * lock the other wants, InnoDB picks one arbitrarily, rolls it back, and returns
 * ER_LOCK_DEADLOCK — whose message is literally "try restarting transaction".
 * The victim did nothing wrong; it simply lost a coin toss.
 *
 * This became visible the day slot capacity went above one. With one patient per
 * slot only two requests ever contend and MySQL usually serialises them cleanly.
 * With three places, four simultaneous bookings take row and gap locks in
 * different orders, a cycle forms, and two of them came back as HTTP 500 — an
 * apology to a patient whose slot was genuinely free.
 *
 * Retrying is safe BY CONSTRUCTION: a deadlock rolls the whole transaction back,
 * so nothing was committed and running it again starts from the same state.
 *
 * The one rule it imposes on callers: the callback must not have side effects
 * OUTSIDE the database. No emails, no payment-gateway calls, no writing files —
 * those would happen twice. Everywhere in this codebase, email is deliberately
 * sent after the transaction commits, and that is why.
 */
const RETRYABLE = new Set([
  'ER_LOCK_DEADLOCK', // 1213 — two transactions wanted each other's locks
  'ER_LOCK_WAIT_TIMEOUT', // 1205 — waited too long for one
])

export async function transaction(callback, { attempts = 3 } = {}) {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const result = await callback(connection)
      await connection.commit()
      return result
    } catch (error) {
      await connection.rollback()
      lastError = error

      if (!RETRYABLE.has(error.code) || attempt === attempts) throw error

      /**
       * A tiny, growing pause before trying again.
       *
       * Retrying instantly tends to reproduce the same collision — both losers
       * charge back in together. A few milliseconds, increasing each time, is
       * enough to let the winner finish and the queue drain.
       */
      await new Promise((resolve) => setTimeout(resolve, 15 * attempt))
      console.warn(`[db] ${error.code} — retrying transaction (attempt ${attempt + 1}/${attempts})`)
    } finally {
      // Returns the connection to the pool. Forgetting this is the most common
      // way to leak connections until the app freezes.
      connection.release()
    }
  }

  throw lastError
}

/**
 * Build a safe `LIMIT n` fragment.
 *
 * WHY THIS EXISTS — A GENUINE MySQL GOTCHA WORTH KNOWING
 * -----------------------------------------------------
 * You cannot use a `?` placeholder for LIMIT in a prepared statement:
 *
 *     query('SELECT ... LIMIT ?', [20])
 *     → Error: Incorrect arguments to mysqld_stmt_execute
 *
 * MySQL requires the LIMIT value to be a literal integer in the prepared
 * statement, not a bound parameter. It is one of the few places `?` genuinely does
 * not work, and the error message gives you no clue why.
 *
 * So the number has to go into the SQL string. That would normally be exactly the
 * SQL-injection mistake this file warns about — which is why this helper exists and
 * why it is the ONLY place in the app that interpolates anything into SQL:
 *
 *   - Number() then Math.floor() means the result is always a number, never text
 *   - a NaN falls back to the default rather than producing "LIMIT NaN"
 *   - it is clamped to a sane maximum, so a caller cannot ask for a million rows
 *
 * After those three steps the value provably cannot contain SQL. Everything else in
 * this application still goes through `?` placeholders, always.
 */
export function limitClause(limit, { fallback = 100, max = 500 } = {}) {
  const parsed = Math.floor(Number(limit))
  if (!Number.isFinite(parsed) || parsed < 1) return `LIMIT ${fallback}`
  return `LIMIT ${Math.min(parsed, max)}`
}

/**
 * A row limit that is safe to interpolate directly into SQL.
 *
 * WHY THIS EXISTS — AND WHY IT IS NOT A `?` PLACEHOLDER
 * ----------------------------------------------------
 * MySQL will not accept a prepared-statement placeholder in a LIMIT clause here:
 *
 *     SELECT … LIMIT ?      →  "Incorrect arguments to mysqld_stmt_execute"
 *
 * The server refuses to bind an integer to LIMIT through the binary protocol.
 * (`connection.query()` works, because it interpolates client-side — but that
 * gives up prepared statements for the whole query, which is not a trade worth
 * making on a query that also carries user-supplied values.)
 *
 * So the limit is interpolated, and this function is what makes that safe. It
 * coerces to an integer and clamps it, so the value spliced into the SQL is
 * ALWAYS a plain number and can never carry anything else. That is the rule:
 * interpolation is acceptable only when the value provably cannot be a string.
 *
 * Everything else still goes through `?`. Never widen this pattern.
 */
export function safeLimit(value, fallback = 100, max = 1000) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}

/**
 * True when the error is MySQL rejecting a duplicate value on a UNIQUE index.
 *
 * We rely on this in two places:
 *   - registration, where two people race to claim the same email
 *   - booking, where two patients race for the same appointment slot
 *
 * Letting the database detect the clash and then handling the error is more
 * reliable than checking first, because between your check and your insert
 * another request can always slip in. See the `uq_active_slot` comment in
 * database/schema.sql for the full explanation.
 */
export function isDuplicateError(error) {
  return error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062)
}
