/**
 * ============================================================================
 *  BACKUPS
 * ============================================================================
 *      npm run backup           take one
 *      npm run backup:verify    prove the latest one can actually be restored
 *      npm run backup -- --list what is on disk
 *
 *  WHY THIS IS THE MOST IMPORTANT SCRIPT IN THE REPOSITORY
 *  -------------------------------------------------------
 *  Clinics are being asked to put their patients' medical records here. One disk
 *  failure, one mistyped DELETE, one bad migration, and both the data and the
 *  company are gone — there is no version of this business that survives losing a
 *  clinic's records. Every other feature is an improvement. This one is the
 *  difference between a business and a liability.
 *
 *  ============================================================================
 *  AN UNVERIFIED BACKUP IS NOT A BACKUP
 *  ============================================================================
 *  The classic failure is not the absence of backups. It is a cron job that has
 *  been writing 0-byte files for four months because a password changed, and
 *  nobody looked until the day it mattered.
 *
 *  So this script refuses to call a dump successful unless it can prove it:
 *
 *    * mysqldump's exit code is checked — silently ignoring it is how empty files
 *      get written.
 *    * The file must be larger than a floor size.
 *    * It must contain the expected number of CREATE TABLE statements.
 *    * It must end with mysqldump's own completion marker, which is only written
 *      after the last row. A truncated dump — disk full, connection dropped — is
 *      otherwise indistinguishable from a good one.
 *
 *  And `backup:verify` goes further: it restores the newest dump into a THROWAWAY
 *  database and counts the tables. That is the only test that means anything,
 *  because a file that gzips fine can still fail to import.
 *
 *  ============================================================================
 *  WHY --single-transaction MATTERS HERE
 *  ============================================================================
 *  Without it, mysqldump locks each table as it reads it. On a live clinic that
 *  means the booking page hangs mid-backup — and a nightly outage at 2am is still
 *  an outage for a patient booking at 2am.
 *
 *  With it, InnoDB gives the dump one consistent snapshot and takes no locks at
 *  all. The whole backup is the database as it was at one instant, which also means
 *  appointments and payments cannot disagree in the restored copy.
 * ============================================================================
 */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync, spawnSync } = require('node:child_process')
const mysql = require('mysql2/promise')

process.loadEnvFile(path.join(__dirname, '..', '.env.local'))

const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
}

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || '3306',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
}

/** Where dumps go. Overridable, because on a server this belongs on another volume. */
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups')

/** How many daily dumps to keep. Thirty days of history at a few MB each. */
const KEEP = Number(process.env.BACKUP_KEEP || 30)

/** Below this, something went wrong however happy the exit code looked. */
const MIN_BYTES = 2048

/* ========================================================================== */
/*  FINDING mysqldump                                                         */
/* ========================================================================== */

/**
 * mysqldump is frequently NOT on the PATH.
 *
 * The official macOS installer puts it in /usr/local/mysql/bin and adds nothing to
 * the shell profile; Homebrew's mysql-client is keg-only for the same reason. So
 * the usual places are checked before giving up, and the error names the override
 * rather than saying "not found" — a message that sends somebody to a search engine
 * is a message that failed.
 */
function findTool(name) {
  const override = process.env[`${name.toUpperCase()}_PATH`]
  if (override && fs.existsSync(override)) return override

  const candidates = [
    `/usr/local/mysql/bin/${name}`,
    `/opt/homebrew/opt/mysql-client/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ]

  try {
    const onPath = execFileSync('which', [name], { encoding: 'utf8' }).trim()
    if (onPath) return onPath
  } catch {
    /* not on PATH; fall through to the known locations */
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  console.error(c.red(`\n  ✗ Could not find ${name}.\n`))
  console.error(`  It ships with MySQL but is often not on the PATH. Looked in:`)
  for (const candidate of candidates) console.error(c.dim(`      ${candidate}`))
  console.error(`\n  Fix either way:`)
  console.error(`      export ${name.toUpperCase()}_PATH=/full/path/to/${name}`)
  console.error(`      ${name.toUpperCase()}_PATH=... in .env.local\n`)
  process.exit(1)
}

/**
 * The password goes in a temporary defaults file, never on the command line.
 *
 * `--password=secret` as an argument is visible to every user on the machine via
 * `ps`, and lands in shell history. A 0600 file that is deleted in a `finally`
 * block is the standard answer, and it is also the only way to stop mysqldump
 * printing its own warning about it.
 */
function withDefaultsFile(run) {
  const file = path.join(os.tmpdir(), `kokli-my-${process.pid}.cnf`)
  fs.writeFileSync(
    file,
    `[client]\nhost=${DB.host}\nport=${DB.port}\nuser=${DB.user}\npassword="${DB.password || ''}"\n`,
    { mode: 0o600 }
  )
  try {
    return run(file)
  } finally {
    try { fs.unlinkSync(file) } catch { /* already gone */ }
  }
}

/* ========================================================================== */
/*  TAKING ONE                                                                */
/* ========================================================================== */

async function backup() {
  const dump = findTool('mysqldump')
  fs.mkdirSync(BACKUP_DIR, { recursive: true })

  // Sortable, sortable-as-a-string, and unambiguous in every timezone.
  const when = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = path.join(BACKUP_DIR, `${DB.database}-${when}.sql.gz`)

  console.log(c.bold(`\n  Backing up ${DB.database}\n`))
  console.log(`  → ${file}`)

  const expectedTables = await countTables()

  withDefaultsFile((defaults) => {
    const args = [
      `--defaults-extra-file=${defaults}`,
      // One consistent snapshot, no table locks. See the note at the top.
      '--single-transaction',
      // Stored routines and triggers are schema too. A restore without them is a
      // database that looks right and behaves differently.
      '--routines',
      '--triggers',
      '--events',
      // Generated columns and CHECK constraints are used heavily in this schema
      // (the slot uniqueness key, the tenancy constraint). Without complete inserts
      // a restore into a slightly different column order silently misaligns data.
      '--complete-insert',
      // Turn off the buffering that makes mysqldump hold whole tables in memory.
      '--quick',
      '--default-character-set=utf8mb4',
      /**
       * No GTIDs in the dump.
       *
       * MySQL records a global transaction id set, and by default mysqldump writes
       * a SET @@GLOBAL.gtid_purged statement into the file. Restoring that into a
       * DIFFERENT server — which is the entire point of a backup — fails outright,
       * because the target already has its own transaction history. It is also
       * what produces the warning mysqldump prints without it.
       */
      '--set-gtid-purged=OFF',
      DB.database,
    ]

    /**
     * Piped to gzip through the shell, and the exit code of EVERY stage is checked.
     *
     * `set -o pipefail` is the point. Without it a shell pipeline reports the exit
     * code of the LAST command — so a mysqldump that dies halfway produces a
     * perfectly valid gzip of a truncated file and a cheerful exit code 0. That is
     * precisely the silent failure this whole script exists to prevent.
     */
    const quoted = args.map((a) => `'${String(a).replace(/'/g, "'\\''")}'`).join(' ')
    const result = spawnSync(
      '/bin/bash',
      ['-c', `set -o pipefail; '${dump}' ${quoted} | gzip -9 > '${file}'`],
      { stdio: ['ignore', 'inherit', 'inherit'] }
    )

    if (result.status !== 0) {
      try { fs.unlinkSync(file) } catch { /* nothing written */ }
      console.error(c.red(`\n  ✗ mysqldump failed (exit ${result.status}). No file kept.\n`))
      process.exit(1)
    }
  })

  /* ------------------------------------------------------------ prove it */
  const checks = verifyFile(file, expectedTables)
  const size = fs.statSync(file).size

  console.log('')
  for (const check of checks) {
    console.log(`  ${check.ok ? c.green('✓') : c.red('✗')} ${check.label}`)
  }

  if (checks.some((check) => !check.ok)) {
    console.error(c.red('\n  ✗ The dump did not pass its checks. Treat it as unusable.\n'))
    process.exit(1)
  }

  prune()

  console.log(c.green(`\n  ✓ ${(size / 1024 / 1024).toFixed(2)} MB written and checked\n`))
  console.log(c.bold('  To restore it:'))
  console.log(c.dim(`      gunzip -c '${file}' | mysql -u ${DB.user} -p ${DB.database}\n`))
  console.log(c.bold('  Nightly, at 2:30am (crontab -e):'))
  console.log(c.dim(`      30 2 * * * cd ${path.join(__dirname, '..')} && npm run backup >> backups/backup.log 2>&1\n`))
  console.log(c.yellow('  A backup on the same disk as the database is not a backup.'))
  console.log(c.dim('  Copy these off the machine — another provider, or S3/B2 with lifecycle rules.\n'))
}

/**
 * The four checks that separate a dump from a file.
 *
 * The completion marker is the important one. mysqldump writes "Dump completed on"
 * as its very last line, AFTER the final row — so its presence is proof the process
 * ran to the end rather than dying with the disk full.
 */
function verifyFile(file, expectedTables) {
  const size = fs.statSync(file).size
  const text = gunzip(file)
  const tables = (text.match(/^CREATE TABLE/gm) || []).length
  const inserts = (text.match(/^INSERT INTO/gm) || []).length

  return [
    { ok: size >= MIN_BYTES, label: `file is ${size} bytes (over ${MIN_BYTES})` },
    { ok: /Dump completed on/.test(text), label: 'mysqldump wrote its completion marker' },
    {
      ok: tables >= expectedTables,
      label: `contains ${tables} CREATE TABLE statements (expected ${expectedTables})`,
    },
    { ok: inserts > 0, label: `contains ${inserts} INSERT statements` },
  ]
}

function gunzip(file) {
  return execFileSync('gunzip', ['-c', file], {
    encoding: 'utf8',
    // A dump can be large; give the buffer room rather than throwing ENOBUFS.
    maxBuffer: 512 * 1024 * 1024,
  })
}

async function countTables() {
  const conn = await mysql.createConnection(DB)
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?`,
    [DB.database]
  )
  await conn.end()
  return Number(rows[0].n)
}

/**
 * Delete the oldest, keep KEEP.
 *
 * Rotation is not tidiness. Without it the disk fills, and a full disk stops the
 * backups AND the database — the failure takes out the thing and its safety net
 * together.
 */
function prune() {
  const files = list()
  const extra = files.slice(KEEP)
  for (const file of extra) {
    fs.unlinkSync(path.join(BACKUP_DIR, file))
    console.log(c.dim(`  · removed old backup ${file}`))
  }
}

/** Newest first. */
function list() {
  if (!fs.existsSync(BACKUP_DIR)) return []
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.sql.gz'))
    .sort()
    .reverse()
}

/* ========================================================================== */
/*  PROVING ONE WORKS                                                         */
/* ========================================================================== */

/**
 * Restore the newest dump into a throwaway database and count what arrived.
 *
 * This is the only check that means anything. A file can be the right size, gzip
 * cleanly, carry the completion marker and still fail to import — a missing
 * routine, a foreign key ordering problem, a character set surprise. The only way
 * to know a backup is restorable is to restore it.
 *
 * Into a SEPARATE database whose name is derived and then dropped, so this can be
 * run on a live machine without a moment where the real data is at risk.
 */
async function verifyRestore() {
  const mysqlBin = findTool('mysql')
  const files = list()

  if (files.length === 0) {
    console.error(c.red('\n  ✗ No backups found. Run `npm run backup` first.\n'))
    process.exit(1)
  }

  const file = path.join(BACKUP_DIR, files[0])
  const scratch = `${DB.database}_verify`

  console.log(c.bold(`\n  Verifying ${files[0]}\n`))
  console.log(c.dim(`  Restoring into a throwaway database: ${scratch}`))

  const conn = await mysql.createConnection({ ...DB, database: undefined })
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${scratch}\``)
    await conn.query(`CREATE DATABASE \`${scratch}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)

    const ok = withDefaultsFile((defaults) => {
      /**
       * The dump begins with `CREATE DATABASE IF NOT EXISTS physio_clinic` and
       * `USE physio_clinic`, so importing it verbatim would write into the REAL
       * database. Both lines are stripped and the target is given on the command
       * line instead — a verification that overwrote production would be the worst
       * possible bug in a backup script.
       */
      const strip = "grep -v -E '^(CREATE DATABASE|USE )' "
      const result = spawnSync(
        '/bin/bash',
        [
          '-c',
          `set -o pipefail; gunzip -c '${file}' | ${strip} | '${mysqlBin}' --defaults-extra-file='${defaults}' '${scratch}'`,
        ],
        { stdio: ['ignore', 'inherit', 'inherit'] }
      )
      return result.status === 0
    })

    if (!ok) {
      console.error(c.red('\n  ✗ The restore FAILED. This backup is not usable.\n'))
      process.exit(1)
    }

    const [[restored]] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?`,
      [scratch]
    )
    const [[live]] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?`,
      [DB.database]
    )

    // A few row counts, because tables can restore empty and still count.
    const rows = {}
    for (const table of ['clinics', 'users', 'appointments', 'payments']) {
      try {
        const [[r]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${scratch}\`.\`${table}\``)
        const [[l]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${DB.database}\`.\`${table}\``)
        rows[table] = { restored: Number(r.n), live: Number(l.n) }
      } catch {
        rows[table] = { restored: null, live: null }
      }
    }

    console.log('')
    const tablesOk = Number(restored.n) === Number(live.n)
    console.log(`  ${tablesOk ? c.green('✓') : c.red('✗')} tables: ${restored.n} restored, ${live.n} live`)

    let rowsOk = true
    for (const [table, count] of Object.entries(rows)) {
      const match = count.restored === count.live
      if (!match) rowsOk = false
      console.log(
        `  ${match ? c.green('✓') : c.red('✗')} ${table}: ${count.restored} restored, ${count.live} live`
      )
    }

    if (!tablesOk || !rowsOk) {
      console.error(c.red('\n  ✗ The restored copy does not match. Investigate before trusting it.\n'))
      process.exit(1)
    }

    console.log(c.green('\n  ✓ This backup restores cleanly and completely.\n'))
  } finally {
    // Always dropped, even on failure. Leaving a full copy of every clinic's
    // medical records lying around in a second database is its own incident.
    await conn.query(`DROP DATABASE IF EXISTS \`${scratch}\``)
    await conn.end()
  }
}

/* ========================================================================== */

async function main() {
  if (!DB.database || !DB.user) {
    console.error(c.red('\n  ✗ DB_NAME and DB_USER must be set in .env.local\n'))
    process.exit(1)
  }

  const args = process.argv.slice(2)

  if (args.includes('--verify')) return verifyRestore()

  if (args.includes('--list')) {
    const files = list()
    console.log(c.bold(`\n  ${files.length} backup(s) in ${BACKUP_DIR}\n`))
    for (const file of files) {
      const size = fs.statSync(path.join(BACKUP_DIR, file)).size
      console.log(`  ${file}  ${c.dim(`${(size / 1024 / 1024).toFixed(2)} MB`)}`)
    }
    console.log('')
    return
  }

  return backup()
}

main().catch((error) => {
  console.error(c.red(`\n  ✗ ${error.message}\n`))
  process.exit(1)
})
