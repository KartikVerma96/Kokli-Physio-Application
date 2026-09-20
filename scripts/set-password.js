/**
 * ============================================================================
 *  BREAK GLASS — set a password from the server
 * ============================================================================
 *      npm run set-password -- owner@kokli.in
 *      npm run set-password -- owner@kokli.in --generate
 *
 *  WHY A DOCUMENTED RECOVERY PROCEDURE IS NOT A HACK
 *  -------------------------------------------------
 *  Every account in this product has two ways in except one. A patient or a clinic
 *  user with a number on file can sign in with a WhatsApp code and skip the password
 *  entirely. Their email reset works too.
 *
 *  The PLATFORM account has neither of those as a guarantee. It is deliberately
 *  excluded from phone sign-in — a swapped SIM must never reach the one login that
 *  can read every clinic's medical records — and its email reset only works if SMTP
 *  is configured and the mailbox is reachable. If both of those are true on a bad
 *  day, and there is no procedure, the answer is somebody writing a bcrypt hash into
 *  MySQL by hand at 2am. That is when mistakes get made.
 *
 *  So the procedure exists, in the repository, tested. That is the difference
 *  between an operations runbook and improvisation.
 *
 *  ============================================================================
 *  WHY THIS IS SAFE TO SHIP
 *  ============================================================================
 *  It requires shell access to the server AND the database credentials in
 *  .env.local. Anyone holding both can already do anything, including reading every
 *  row — this script grants no capability that was not already there. What it adds
 *  is doing it correctly: the right bcrypt cost, password_changed_at stamped, and
 *  every outstanding reset token retired.
 *
 *  It is NOT reachable over HTTP and must never become so.
 * ============================================================================
 */

const path = require('node:path')
const crypto = require('node:crypto')
const readline = require('node:readline')
const bcrypt = require('bcryptjs')
const mysql = require('mysql2/promise')

process.loadEnvFile(path.join(__dirname, '..', '.env.local'))

const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
}

/**
 * Read a password without echoing it.
 *
 * A password typed in a visible terminal ends up in a screen recording, a shoulder
 * surf, or a scrollback buffer somebody else reads. Passing it as an argument would
 * be worse still — visible in `ps` to every user on the machine, and saved in shell
 * history forever. Hence `--generate` as the recommended path.
 */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const onData = (char) => {
      // Redraw the prompt with no characters, so nothing is ever displayed.
      const text = char.toString()
      if (text === '\n' || text === '\r' || text === '') return
      readline.clearLine(process.stdout, 0)
      readline.cursorTo(process.stdout, 0)
      process.stdout.write(question)
    }
    process.stdin.on('data', onData)
    rl.question(question, (answer) => {
      process.stdin.removeListener('data', onData)
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

/**
 * Four random words beats a random string of symbols.
 *
 * It is longer, therefore stronger, and it can be read aloud down a phone line —
 * which is exactly what happens when somebody is locked out and being helped by
 * whoever has server access.
 */
const WORDS = [
  'anchor', 'basalt', 'cobalt', 'dahlia', 'ember', 'fathom', 'granite', 'harbour',
  'indigo', 'juniper', 'kestrel', 'lantern', 'marble', 'nectar', 'obsidian', 'pelican',
  'quartz', 'ripple', 'saffron', 'thistle', 'umber', 'velvet', 'willow', 'zephyr',
]

function generatePassword() {
  const words = Array.from({ length: 4 }, () => WORDS[crypto.randomInt(0, WORDS.length)])
  return `${words.join('-')}-${crypto.randomInt(10, 100)}`
}

async function main() {
  const args = process.argv.slice(2)
  const email = args.find((a) => !a.startsWith('--'))
  const generate = args.includes('--generate')

  if (!email) {
    console.error(c.red('\n  ✗ Which account?\n'))
    console.error('      npm run set-password -- owner@kokli.in')
    console.error('      npm run set-password -- owner@kokli.in --generate\n')
    process.exit(1)
  }

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  })

  try {
    const [rows] = await db.execute(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, c.name AS clinic_name
         FROM users u LEFT JOIN clinics c ON c.id = u.clinic_id
        WHERE u.email = ?`,
      [email.toLowerCase()]
    )

    if (rows.length === 0) {
      console.error(c.red(`\n  ✗ No account with the email ${email}\n`))
      // Listing the platform accounts is a genuine kindness here: the usual reason
      // for being in this script is not remembering the exact address.
      const [owners] = await db.execute(
        `SELECT email FROM users WHERE role = 'platform' ORDER BY id`
      )
      if (owners.length) {
        console.error('  Platform accounts on this database:')
        for (const owner of owners) console.error(c.dim(`      ${owner.email}`))
        console.error('')
      }
      process.exit(1)
    }

    const user = rows[0]

    console.log(c.bold('\n  Setting a password for:\n'))
    console.log(`      ${user.name}  ${c.dim(`<${user.email}>`)}`)
    console.log(`      role: ${user.role}${user.clinic_name ? `   clinic: ${user.clinic_name}` : ''}`)
    if (!user.is_active) console.log(c.yellow('      ⚠ this account is deactivated and cannot sign in'))
    console.log('')

    let password
    if (generate) {
      password = generatePassword()
    } else {
      password = await askHidden('  New password (not shown): ')
      const again = await askHidden('  Again: ')
      if (password !== again) {
        console.error(c.red('\n  ✗ They do not match. Nothing changed.\n'))
        process.exit(1)
      }
    }

    if (String(password).length < 8) {
      console.error(c.red('\n  ✗ Use at least 8 characters. Nothing changed.\n'))
      process.exit(1)
    }

    // Cost 10, matching lib/passwordReset.js and lib/auth.js. A different cost here
    // would still verify, but it is the kind of drift that becomes a real
    // inconsistency once somebody raises it in one place and not the other.
    const hash = await bcrypt.hash(password, 10)

    await db.execute(
      `UPDATE users SET password_hash = ?, password_changed_at = NOW() WHERE id = ?`,
      [hash, user.id]
    )

    /**
     * Retire every outstanding reset token for this account.
     *
     * The likely reason for running this script is that somebody could not get in.
     * If a reset link was also requested, leaving it live means a second valid key
     * is sitting in a mailbox — and whoever asked for it may not be the person now
     * holding this password.
     */
    const [cleared] = await db.execute(
      `UPDATE password_resets SET consumed_at = NOW()
        WHERE user_id = ? AND consumed_at IS NULL`,
      [user.id]
    )

    console.log(c.green('\n  ✓ Password set.\n'))
    if (generate) {
      console.log(c.bold('  The new password is:\n'))
      console.log(`      ${c.bold(password)}\n`)
      console.log(c.yellow('  This is the only time it is shown. Store it in a password manager now.'))
    }
    if (cleared.affectedRows > 0) {
      console.log(c.dim(`\n  ${cleared.affectedRows} outstanding reset link(s) invalidated.`))
    }
    console.log(c.dim('\n  Sign in, then change it from your account page so nobody else has seen it.\n'))
  } finally {
    await db.end()
  }
}

main().catch((error) => {
  console.error(c.red(`\n  ✗ ${error.message}\n`))
  process.exit(1)
})
