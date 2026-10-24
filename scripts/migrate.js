/**
 * ============================================================================
 *  MIGRATION RUNNER
 * ============================================================================
 *
 *      npm run db:migrate
 *      npm run db:migrate -- --pending    only list what has not been applied;
 *                                         exits 3 if anything is pending
 *
 *  Applies every file in database/migrations/ that has not been applied yet, in
 *  filename order, and records what it did.
 *
 *  ON THE SERVER, EVERY DEPLOY RUNS THIS — before the new code goes live
 *  ---------------------------------------------------------------------
 *  The Jenkins deploy takes a backup, then runs this script from the NEW image
 *  while the OLD container is still serving, and only then swaps (DEPLOYMENT.md
 *  §7e). So for a while the old code runs against the new schema, and the rule
 *  for every migration follows from that:
 *
 *    * Additive only: a new table, a new column WITH a default, a new index.
 *      Code that does not know about them keeps working.
 *    * Dropping or renaming something comes in a LATER release, after the code
 *      that used it is gone from production — a rollback puts the old code back
 *      on the new schema too.
 *
 *  A migration that fails stops the deploy before the swap; the old container
 *  keeps serving, and the backup taken a moment earlier is the way back.
 *
 *  WHY THIS EXISTS
 *  ---------------
 *  Migrations were being run by hand, and one of them failed half way: the first
 *  ALTER succeeded, a later statement had a typo, and re-running the fixed file
 *  then failed with "duplicate column" because part of it was already applied.
 *  At that point the only way forward is to edit the migration to skip what
 *  already happened — which means the file no longer describes the change, and
 *  the next person to set up a database gets something different.
 *
 *  That is survivable on a laptop. It is not survivable once real clinics have
 *  real patient records, because the answer to "what state is this database in"
 *  has to be knowable.
 *
 *  So: each STATEMENT is applied separately and recorded separately. A file that
 *  fails half way can be fixed and re-run, and the statements that already
 *  succeeded are skipped rather than repeated.
 * ============================================================================
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const mysql = require('mysql2/promise')

// .env.local on a laptop. Inside the Docker image there is no such file: the
// same variables arrive as the container's environment (compose's env_file),
// and a bare call here would crash the script before it did anything. Only a
// MISSING file is expected — one that exists but cannot be read is a real
// problem, and still stops the script.
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env.local'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const MIGRATIONS_DIR = path.join(__dirname, '..', 'database', 'migrations')

/**
 * Split a file into statements.
 *
 * Comments are stripped FIRST, because both `--` and `/* *\/` comments in these
 * files contain semicolons, apostrophes and the word CREATE. Splitting before
 * stripping produces statements cut in half inside a paragraph of prose.
 */
function statementsIn(sql) {
  const withoutComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--.*$/gm, '')

  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** A stable id for a statement, so it is recognised again after a file is edited. */
function fingerprint(file, statement) {
  return crypto
    .createHash('sha256')
    .update(`${file}::${statement.replace(/\s+/g, ' ')}`)
    .digest('hex')
    .slice(0, 40)
}

/**
 * Errors that mean "this was already done".
 *
 * Tolerated because a half-applied file must be re-runnable. Everything else is
 * a real failure and stops the run — a migration that carries on past an error
 * it does not understand is how a database ends up in a state nobody can
 * reproduce.
 */
const ALREADY_DONE = new Set([
  'ER_DUP_FIELDNAME', // column exists
  'ER_TABLE_EXISTS_ERROR', // table exists
  'ER_DUP_KEYNAME', // index exists
  'ER_DUP_ENTRY', // seed row exists
  'ER_CANT_DROP_FIELD_OR_KEY', // dropping something already dropped
  'ER_FK_DUP_NAME', // foreign key exists
  'ER_CHECK_CONSTRAINT_DUP_NAME', // CHECK constraint exists
  'ER_DUP_CHECK_CONSTRAINT_NAME',
])

/**
 * --pending: what would run, without running it and without writing anything —
 * not even the bookkeeping table. Exit 3 means "something is pending", so a
 * script can tell that apart from a failure (exit 1).
 */
async function listPending(connection, files) {
  let done = new Set()
  try {
    const [applied] = await connection.query('SELECT fingerprint FROM schema_migrations')
    done = new Set(applied.map((r) => r.fingerprint))
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error
  }

  let pending = 0
  for (const file of files) {
    const statements = statementsIn(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
    statements.forEach((statement, i) => {
      if (done.has(fingerprint(file, statement))) return
      pending++
      console.log(`  · ${file}, statement ${i + 1}: ${statement.replace(/\s+/g, ' ').slice(0, 100)}`)
    })
  }

  console.log(pending ? `\n${pending} statement(s) pending.\n` : '✓ Nothing pending.')
  return pending
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: false,
  })

  if (process.argv.includes('--pending')) {
    const files = fs.existsSync(MIGRATIONS_DIR)
      ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
      : []
    const pending = await listPending(connection, files)
    await connection.end()
    process.exitCode = pending ? 3 : 0
    return
  }

  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      fingerprint  CHAR(40) NOT NULL PRIMARY KEY,
      file         VARCHAR(120) NOT NULL,
      statement_no SMALLINT UNSIGNED NOT NULL,
      applied_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_migrations_file (file)
    ) ENGINE = InnoDB
  `)

  const [applied] = await connection.query('SELECT fingerprint FROM schema_migrations')
  const done = new Set(applied.map((r) => r.fingerprint))

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  if (files.length === 0) {
    console.log('No migrations found.')
    await connection.end()
    return
  }

  let ran = 0
  let skipped = 0
  let inPlace = 0

  for (const file of files) {
    const statements = statementsIn(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
    const pending = statements.filter((s, i) => !done.has(fingerprint(file, s, i)))

    if (pending.length === 0) {
      console.log(`  · ${file} — already applied`)
      skipped += statements.length
      continue
    }

    console.log(`  → ${file}`)

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i]
      const id = fingerprint(file, statement)
      if (done.has(id)) {
        skipped++
        continue
      }

      try {
        await connection.query(statement)
        ran++
      } catch (error) {
        if (ALREADY_DONE.has(error.code)) {
          // Recorded anyway: the database is in the state this statement wanted,
          // which is the only thing that matters.
          console.log(`      (already done: ${error.code})`)
          inPlace++
        } else {
          console.error(`\n✗ ${file}, statement ${i + 1}:`)
          console.error(`  ${error.code} — ${error.sqlMessage}`)
          console.error(`\n  ${statement.replace(/\s+/g, ' ').slice(0, 200)}\n`)
          await connection.end()
          process.exit(1)
        }
      }

      await connection.query(
        'INSERT IGNORE INTO schema_migrations (fingerprint, file, statement_no) VALUES (?, ?, ?)',
        [id, file, i + 1]
      )
    }
  }

  // Three different things, counted apart: a fresh database built from
  // schema.sql already has most of what the migrations add.
  console.log(
    `\n✓ ${ran} statement(s) applied, ${inPlace} found already in place (recorded now), ` +
      `${skipped} recorded before.\n`
  )
  await connection.end()
}

main().catch((error) => {
  console.error('\n✗ Migration failed:', error.message, '\n')
  process.exit(1)
})
