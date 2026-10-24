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
const zlib = require('node:zlib')
const { StringDecoder } = require('node:string_decoder')
const { pipeline } = require('node:stream/promises')
const { execFileSync, spawnSync } = require('node:child_process')
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

/**
 * How many dumps to keep in BACKUP_DIR, newest first.
 *
 * On the server there are two pools, so neither can eat the other's history:
 *
 *    ~/kokli/backups             the nightly dump; BACKUP_KEEP from .env.local
 *                                (30 = a month of nights)
 *    ~/kokli/backups/predeploy   one before every deploy; the deploy itself sets
 *                                BACKUP_DIR and BACKUP_KEEP=10 for that run
 *
 * list() does not look into subdirectories, so pruning and --verify in one pool
 * never touch the other. Never below 1: a typo here must not mean "delete them all".
 */
const KEEP = Math.max(1, Number.parseInt(process.env.BACKUP_KEEP || '30', 10) || 30)

/** Below this, something went wrong however happy the exit code looked. */
const MIN_BYTES = 2048

/**
 * Row counts recorded with every dump and checked again on restore. Tables can
 * restore empty and still count as tables; these are the ones that must not.
 */
const COUNTED = ['clinics', 'users', 'appointments', 'payments']

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

/**
 * Is this MariaDB's mysqldump rather than MySQL's?
 *
 * They share a name and almost every option, which is exactly why the difference
 * bites: the one option they do not share fails the whole backup. `--version`
 * says which one it is ("... 10.11.6-MariaDB ..."), so ask rather than guess.
 */
function isMariaDbDump(dump) {
  try {
    return /mariadb/i.test(execFileSync(dump, ['--version'], { encoding: 'utf8' }))
  } catch {
    // Cannot even print its version — let the real run report the real error.
    return false
  }
}

/**
 * Does this mysqldump have an option? Asked, not assumed, for the same reason as
 * above: an option a tool does not know makes it refuse to dump anything at all.
 */
function dumpSupports(dump, option) {
  try {
    return execFileSync(dump, ['--help'], { encoding: 'utf8' }).includes(option)
  } catch {
    return false
  }
}

async function backup() {
  const dump = findTool('mysqldump')
  fs.mkdirSync(BACKUP_DIR, { recursive: true })

  // Sortable, sortable-as-a-string, and unambiguous in every timezone.
  const when = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = path.join(BACKUP_DIR, `${DB.database}-${when}.sql.gz`)
  /**
   * Written under another name, and renamed only once it has passed its checks.
   *
   * A dump killed halfway — its container stopped under it, the disk full — would
   * otherwise sit in the directory under a perfectly good name, and be exactly the
   * file a restore picks, because it is the newest. list() only sees `.sql.gz`.
   */
  const partial = `${file}.partial`

  console.log(c.bold(`\n  Backing up ${DB.database}\n`))
  console.log(`  → ${file}`)

  const conn = await mysql.createConnection(DB)
  let expectedTables
  let before
  let after
  try {
    expectedTables = await countTables(conn, DB.database)
    before = await rowCounts(conn, DB.database)

    dumpTo(dump, partial)

    after = await rowCounts(conn, DB.database)
  } finally {
    await conn.end()
  }

  /* ------------------------------------------------------------ prove it */
  const checks = await verifyFile(partial, expectedTables)
  const size = fs.statSync(partial).size

  console.log('')
  for (const check of checks) {
    console.log(`  ${check.ok ? c.green('✓') : c.red('✗')} ${check.label}`)
  }

  if (checks.some((check) => !check.ok)) {
    try { fs.unlinkSync(partial) } catch { /* already gone */ }
    console.error(c.red('\n  ✗ The dump did not pass its checks, so it was not kept.\n'))
    process.exit(1)
  }

  fs.renameSync(partial, file)
  writeCounts(file, { tables: expectedTables, before, after })
  prune()

  console.log(c.green(`\n  ✓ ${(size / 1024 / 1024).toFixed(2)} MB written and checked\n`))

  if (fs.existsSync('/.dockerenv')) {
    // Inside the app's container on the server, where the laptop advice below
    // would be wrong: cron there is the server's, and restoring is §7f's job.
    console.log(c.dim('  Scheduling, restoring and copying off the server: DEPLOYMENT.md §7f.\n'))
    return
  }

  console.log(c.bold('  To restore it:'))
  console.log(c.dim(`      gunzip -c '${file}' | mysql -u ${DB.user} -p ${DB.database}\n`))
  console.log(c.bold('  Nightly, at 2:30am (crontab -e):'))
  console.log(c.dim(`      30 2 * * * cd ${path.join(__dirname, '..')} && npm run backup >> backups/backup.log 2>&1\n`))
  console.log(c.yellow('  A backup on the same disk as the database is not a backup.'))
  console.log(c.dim('  Copy these off the machine — another provider, or S3/B2 with lifecycle rules.\n'))
}

function dumpTo(dump, target) {
  // The status comes OUT of withDefaultsFile before anything exits: process.exit()
  // inside it would skip the `finally` that deletes the file holding the password.
  const status = withDefaultsFile((defaults) => {
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
      // Tablespace definitions need the global PROCESS privilege to read, which
      // the application's own MySQL user rightly does not have — so without
      // this, a backup taken as that user fails outright. They restore nothing
      // this schema uses: every table lives in its own InnoDB file anyway.
      '--no-tablespaces',
      /**
       * No GTIDs in the dump.
       *
       * MySQL records a global transaction id set, and by default mysqldump writes
       * a SET @@GLOBAL.gtid_purged statement into the file. Restoring that into a
       * DIFFERENT server — which is the entire point of a backup — fails outright,
       * because the target already has its own transaction history. It is also
       * what produces the warning mysqldump prints without it.
       */
      //
      // ...but only MySQL's own mysqldump has this flag. MariaDB's — which is
      // what Debian installs as `mysqldump`, and so what the Docker image has —
      // rejects it as an unknown option and dumps nothing at all. It also never
      // writes a gtid_purged line for a MySQL server, so leaving the flag out
      // there loses nothing.
      ...(isMariaDbDump(dump) ? [] : ['--set-gtid-purged=OFF']),
      /**
       * No masking policies — a MySQL 9 feature this app does not use. Without
       * this, MySQL 9's mysqldump tries to read them from a table in the `mysql`
       * system schema, which the app's own database user rightly cannot see, and
       * prints an error into every backup log. Older tools have neither the
       * feature nor the option, so the option is passed only when it exists.
       */
      ...(dumpSupports(dump, '--masking-policies') ? ['--skip-masking-policies'] : []),
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
      ['-c', `set -o pipefail; '${dump}' ${quoted} | gzip -9 > '${target}'`],
      { stdio: ['ignore', 'inherit', 'inherit'] }
    )
    return result.status
  })

  if (status !== 0) {
    try { fs.unlinkSync(target) } catch { /* nothing written */ }
    console.error(c.red(`\n  ✗ mysqldump failed (exit ${status}). No file kept.\n`))
    process.exit(1)
  }
}

/**
 * The four checks that separate a dump from a file.
 *
 * The completion marker is the important one. mysqldump writes "Dump completed on"
 * as its very last line, AFTER the final row — so finding it there is proof the
 * process ran to the end rather than dying with the disk full.
 */
async function verifyFile(file, expectedTables) {
  const size = fs.statSync(file).size
  const { tables, inserts, lastLine } = await scanDump(file)

  return [
    { ok: size >= MIN_BYTES, label: `file is ${size} bytes (over ${MIN_BYTES})` },
    { ok: /Dump completed on/.test(lastLine), label: 'mysqldump wrote its completion marker' },
    {
      ok: tables >= expectedTables,
      label: `contains ${tables} CREATE TABLE statements (expected ${expectedTables})`,
    },
    { ok: inserts > 0, label: `contains ${inserts} INSERT statements` },
  ]
}

/**
 * Read a dump once, as a stream, counting as it goes.
 *
 * This used to gunzip the whole dump into one string. That held every byte of it
 * in the production container's memory, on a host with no swap, and past about
 * 512 MB it stopped working in the worst way: the string could not even be made,
 * the check threw after the dump was written, and every backup — the deploy's
 * included — failed from then on. Line by line, memory stays flat at any size.
 */
async function scanDump(file) {
  const found = { tables: 0, inserts: 0, lastLine: '' }
  const take = (line) => {
    if (line.startsWith('CREATE TABLE')) found.tables++
    else if (line.startsWith('INSERT INTO')) found.inserts++
    if (line.trim()) found.lastLine = line
  }

  const decoder = new StringDecoder('utf8')
  let carry = ''
  await pipeline(fs.createReadStream(file), zlib.createGunzip(), async (source) => {
    for await (const chunk of source) {
      const lines = (carry + decoder.write(chunk)).split('\n')
      carry = lines.pop()
      for (const line of lines) take(line)
    }
    take(carry + decoder.end())
  })
  return found
}

async function countTables(conn, schema) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?`,
    [schema]
  )
  return Number(rows[0].n)
}

/** COUNTED's row counts in one schema; null for a table that is not there. */
async function rowCounts(conn, schema) {
  const counts = {}
  for (const table of COUNTED) {
    try {
      const [[row]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${schema}\`.\`${table}\``)
      counts[table] = Number(row.n)
    } catch {
      counts[table] = null
    }
  }
  return counts
}

/**
 * What the database held while a dump was taken, kept beside it as
 * `<dump>.counts.json`.
 *
 * --verify used to compare the restored copy with the live tables at the moment
 * it ran, so one booking between the nightly dump and the weekly check made a
 * perfectly good backup "not match" — a false alarm that grows with the number of
 * patients. Counted just before and just after the dump, the snapshot mysqldump
 * read lies between the two; at night they are the same number.
 */
function countsFile(dumpFile) {
  return `${dumpFile}.counts.json`
}

function writeCounts(dumpFile, { tables, before, after }) {
  const rows = {}
  for (const table of COUNTED) {
    const pair = [before[table], after[table]]
    rows[table] = pair.includes(null) ? null : [Math.min(...pair), Math.max(...pair)]
  }
  const target = countsFile(dumpFile)
  fs.writeFileSync(`${target}.tmp`, `${JSON.stringify({ tables, rows }, null, 2)}\n`)
  fs.renameSync(`${target}.tmp`, target)
}

function readCounts(dumpFile) {
  try {
    return JSON.parse(fs.readFileSync(countsFile(dumpFile), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(c.yellow(`  ! ${path.basename(countsFile(dumpFile))} is unreadable (${error.message})`))
    }
    return null
  }
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
  for (const file of files.slice(KEEP)) {
    fs.unlinkSync(path.join(BACKUP_DIR, file))
    console.log(c.dim(`  · removed old backup ${file}`))
  }

  /**
   * And what runs leave behind: counts whose dump is gone, and half-written dumps
   * from a run that was killed. Only ones hours old — a run still writing its
   * file right now, in another process, is not a leftover.
   */
  const kept = new Set(files.slice(0, KEEP))
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    const full = path.join(BACKUP_DIR, name)
    try {
      if (name.includes('.sql.gz.counts.json')) {
        if (!kept.has(name.slice(0, name.indexOf('.counts.json')))) fs.unlinkSync(full)
      } else if (name.endsWith('.sql.gz.partial')) {
        if (Date.now() - fs.statSync(full).mtimeMs > 6 * 60 * 60 * 1000) {
          fs.unlinkSync(full)
          console.log(c.dim(`  · removed an unfinished dump ${name}`))
        }
      }
    } catch {
      /* removed by someone else in the meantime */
    }
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

    /**
     * Failures set the exit code and RETURN — never process.exit() in here.
     * process.exit() ends the process on the spot, skipping the `finally` below,
     * and that once left a restored copy of every clinic's records behind in
     * the scratch database whenever a restore failed or did not match.
     */
    if (!ok) {
      console.error(c.red('\n  ✗ The restore FAILED. This backup is not usable.\n'))
      process.exitCode = 1
      return
    }

    /**
     * Compared with what the database held when the dump was TAKEN, recorded
     * beside it. Dumps from before that existed are compared with the live
     * database instead, which is only right if nothing was written since.
     */
    const recorded = readCounts(file)
    const versus = recorded ? 'when dumped' : 'live'
    const restoredTables = await countTables(conn, scratch)
    const expectedTables = recorded ? Number(recorded.tables) : await countTables(conn, DB.database)

    const restoredRows = await rowCounts(conn, scratch)
    let ranges
    if (recorded) {
      ranges = recorded.rows || {}
    } else {
      const live = await rowCounts(conn, DB.database)
      ranges = Object.fromEntries(COUNTED.map((t) => [t, live[t] === null ? null : [live[t], live[t]]]))
    }

    if (!recorded) console.log(c.dim('\n  (no counts were recorded with this dump — comparing with the live database)'))
    console.log('')
    const tablesOk = restoredTables === expectedTables
    console.log(
      `  ${tablesOk ? c.green('✓') : c.red('✗')} tables: ${restoredTables} restored, ${expectedTables} ${versus}`
    )

    let rowsOk = true
    for (const table of COUNTED) {
      const got = restoredRows[table]
      const range = ranges[table] ?? null
      // A table missing from both sides matches; missing from one side does not.
      const match = range === null ? got === null : got !== null && got >= range[0] && got <= range[1]
      if (!match) rowsOk = false
      const expected = range === null ? 'none' : range[0] === range[1] ? range[0] : `${range[0]}–${range[1]}`
      console.log(`  ${match ? c.green('✓') : c.red('✗')} ${table}: ${got} restored, ${expected} ${versus}`)
    }

    if (!tablesOk || !rowsOk) {
      console.error(c.red('\n  ✗ The restored copy does not match. Investigate before trusting it.\n'))
      process.exitCode = 1
      return
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
