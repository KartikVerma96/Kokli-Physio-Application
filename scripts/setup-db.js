/**
 * ============================================================================
 *  DATABASE SETUP
 * ============================================================================
 *
 *  Usage:
 *    npm run db:setup     Create the database, tables and demo data.
 *    npm run db:reset     Same, but wipes everything first without asking.
 *
 *  Order matters, and it is dictated by the circular reference between clinics
 *  and users (a clinic has an owner; a user belongs to a clinic):
 *
 *    1. schema.sql            tables
 *    2. the platform owner    role='platform', clinic_id NULL — that is you
 *    3. the demo clinic       owner_user_id left NULL for a moment
 *    4. its staff & patient   clinic_id now points at a clinic that exists
 *    5. link owner back       clinics.owner_user_id
 *    6. seed.sql              plans, services, availability, a trial
 *
 *  Passwords are hashed here rather than in SQL because MySQL cannot produce a
 *  bcrypt hash, and storing a plain-text password is never an option — not even
 *  for a demo account.
 *
 *  NOTE ON MODULE STYLE: require() rather than import, because Node runs this
 *  file directly. Everything inside app/ and lib/ uses modern `import`, because
 *  Next.js compiles those first.
 * ============================================================================
 */

const fs = require('node:fs')
const path = require('node:path')
const mysql = require('mysql2/promise')
const bcrypt = require('bcryptjs')

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env.local'))
} catch {
  console.log('  (no .env.local found — falling back to defaults)\n')
}

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'physio_clinic',
}

const RESET = process.argv.includes('--reset')
const DOMAIN = process.env.PLATFORM_DOMAIN || 'localhost'
const PORT = process.env.PORT || 3000

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
}

function readSql(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'database', file), 'utf8')
}

/* -------------------------------------------------------------------------- */
/*  WHAT GETS CREATED                                                         */
/* -------------------------------------------------------------------------- */

/** You. Belongs to no clinic; can see all of them. */
const PLATFORM_OWNER = {
  name: 'Platform Owner',
  email: 'owner@kokli.in',
  password: 'owner123',
}

/**
 * The demo clinic — tenant #1.
 *
 * This is the clinic the whole app was originally built for, now living as an
 * ordinary customer alongside everyone else. That is the right test of a
 * multi-tenant design: the first tenant should be in no way special.
 */
const DEMO_CLINIC = {
  slug: 'aarogya',
  name: 'Aarogya Physiotherapy',
  legal_name: 'Aarogya Physiotherapy & Rehab Clinic',
  tagline: 'Move better. Live pain-free.',
  description:
    'Expert physiotherapy in Pune for back pain, neck pain, sports injuries and post-surgery rehab. Book an in-clinic visit or a same-day online video consultation.',
  brand_colour: '#0d9488',
  phone: '+91 90000 00000',
  whatsapp: '919000000000',
  email: 'hello@aarogyaphysio.in',
  address_line1: '2nd Floor, Sunrise Arcade',
  address_line2: 'Baner Road, Near Balewadi Phata',
  city: 'Pune',
  state: 'Maharashtra',
  postal_code: '411045',
  latitude: 18.5642,
  longitude: 73.7769,
  maps_url: 'https://maps.google.com/?q=18.5642,73.7769',
  practitioner_name: 'Dr. Ananya Verma',
  practitioner_credentials: 'BPT, MPT (Orthopaedics)',
  practitioner_title: 'Consultant Physiotherapist',
  practitioner_registration: 'MH-PT-2016-04821',
  practitioner_experience_years: 9,
  practitioner_bio:
    'Ananya has spent nine years helping people get back to the things they love — whether that is picking up a grandchild without wincing, returning to the cricket pitch after an ACL repair, or simply sitting through a workday without neck pain. She trained in orthopaedic manual therapy and believes the best treatment is the one you understand, so every session ends with a plan you can actually follow at home.',
  practitioner_languages: ['English', 'Hindi', 'Marathi'],
  practitioner_specialisations: [
    'Orthopaedic manual therapy',
    'Sports injury rehabilitation',
    'Post-operative recovery',
    'Dry needling',
    'Ergonomic & posture correction',
  ],
  opening_hours: [
    { days: 'Monday – Friday', time: '9:00 AM – 8:00 PM' },
    { days: 'Saturday', time: '9:00 AM – 4:00 PM' },
    { days: 'Sunday', time: 'Online consultations only' },
  ],
  opening_hours_spec: [
    { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '20:00' },
    { days: ['Saturday'], opens: '09:00', closes: '16:00' },
  ],
  stats: [
    { value: '9+', label: 'Years of practice' },
    { value: '3,200+', label: 'Sessions delivered' },
    { value: '4.9', label: 'Average patient rating' },
    { value: '48hr', label: 'Typical pain relief' },
  ],
  social: { instagram: 'https://instagram.com/aarogyaphysio', facebook: 'https://facebook.com/aarogyaphysio' },
  faqs: [
    {
      q: 'Do I need a doctor’s referral to see a physiotherapist?',
      a: 'No. In India you can book a physiotherapist directly. If you already have X-rays, an MRI or a surgeon’s note, bring them along — they help, but they are not required to get started.',
    },
    {
      q: 'How is an online physiotherapy consultation useful if you cannot touch me?',
      a: 'A great deal of physiotherapy is assessment, diagnosis and teaching. Over video we watch how you move, test your range of motion, identify what is triggering the pain, and then coach you through a corrective exercise programme live. Online works especially well for neck and back pain, posture problems, and follow-ups between clinic visits. If you need hands-on manual therapy, we will tell you honestly and book you in-clinic instead.',
    },
    {
      q: 'What should I wear and prepare for my appointment?',
      a: 'Wear loose, comfortable clothing that lets you move and lets us see the area being treated — shorts for a knee problem, a vest or loose t-shirt for a shoulder. For online sessions, find a quiet spot with about two metres of clear floor space, prop your phone or laptop so your whole body is visible, and keep a chair and a water bottle nearby.',
    },
    {
      q: 'How many sessions will I need?',
      a: 'Most simple problems settle in 4 to 6 sessions. Long-standing pain or post-surgical rehabilitation usually runs 8 to 12 sessions across a few months. You will get an honest estimate at the end of your first assessment, and we re-check progress every fourth session rather than keeping you coming indefinitely.',
    },
    {
      q: 'Does physiotherapy hurt?',
      a: 'Treatment should never be more than mildly uncomfortable. Some techniques — deep tissue work, dry needling, stretching a stiff joint — can feel intense while they happen and leave you a little sore for a day, much like after a good workout. Sharp or worsening pain is always a signal to stop, and you should say so immediately.',
    },
    {
      q: 'How do I pay, and can I get a receipt for insurance?',
      a: 'You pay online while booking, using UPI, any debit or credit card, or netbanking. A GST invoice is emailed to you straight away and is always available in your dashboard, which is what most insurers and employers ask for when reimbursing.',
    },
  ],
}

/** The demo clinic's people. */
const DEMO_USERS = [
  { name: 'Clinic Admin', email: 'admin@aarogyaphysio.in', password: 'admin123', role: 'admin', phone: '+91 90000 00001' },
  { name: 'Dr. Ananya Verma', email: 'doctor@aarogyaphysio.in', password: 'doctor123', role: 'physio', phone: '+91 90000 00002' },
  { name: 'Rohan Deshpande', email: 'patient@example.com', password: 'patient123', role: 'patient', phone: '+91 90000 00003' },
]

/* -------------------------------------------------------------------------- */

async function main() {
  console.log(c.bold('\n  Kokli — database setup\n'))
  console.log(c.dim(`  Connecting to mysql://${config.user}@${config.host}:${config.port}\n`))

  let connection
  try {
    // No database selected yet — schema.sql is what creates it.
    // multipleStatements lets us run a whole .sql file at once. It is switched
    // OFF in the app's own pool (lib/db.js), where it would widen the blast
    // radius of any SQL injection bug.
    connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      multipleStatements: true,
    })
  } catch (error) {
    console.error(c.red('  ✗ Could not connect to MySQL.\n'))
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('    MySQL rejected the username or password.')
      console.error(`    Open ${c.bold('.env.local')} and set DB_USER and DB_PASSWORD`)
      console.error('    to the same credentials you use in MySQL Workbench.\n')
    } else if (error.code === 'ECONNREFUSED') {
      console.error('    Nothing is listening on that port. Is MySQL running?')
      console.error('    On macOS: System Settings → MySQL → Start MySQL Server\n')
    } else {
      console.error(`    ${error.message}\n`)
    }
    process.exit(1)
  }

  // ------------------------------------------------------------ safety check
  if (!RESET) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = ? AND table_name = 'clinics'`,
      [config.database]
    )
    if (rows[0].n > 0) {
      const [clinics] = await connection.query(
        `SELECT COUNT(*) AS n FROM \`${config.database}\`.clinics`
      )
      if (clinics[0].n > 0) {
        console.log(c.yellow(`  ! Database "${config.database}" already exists`))
        console.log(c.yellow(`    and contains ${clinics[0].n} clinic(s).\n`))
        console.log('    Running setup again would DELETE all of it, including')
        console.log('    every clinic, patient and appointment.')
        console.log(`\n    If that is genuinely what you want:  ${c.bold('npm run db:reset')}\n`)
        await connection.end()
        process.exit(0)
      }
    }
  }

  try {
    /* ------------------------------------------------------------ 1. schema */
    process.stdout.write('  1/5  Creating tables .................. ')
    await connection.query(readSql('schema.sql'))
    await connection.changeUser({ database: config.database })
    console.log(c.green('done'))

    /* ---------------------------------------------------- 2. platform owner */
    process.stdout.write('  2/5  Creating your platform account ... ')
    const ownerHash = await bcrypt.hash(PLATFORM_OWNER.password, 10)
    await connection.execute(
      `INSERT INTO users (clinic_id, name, email, password_hash, role, email_verified)
       VALUES (NULL, ?, ?, ?, 'platform', 1)`,
      [PLATFORM_OWNER.name, PLATFORM_OWNER.email, ownerHash]
    )
    console.log(c.green('done'))

    /* ------------------------------------------------------ 3. demo clinic */
    process.stdout.write('  3/5  Creating the demo clinic ......... ')
    const [clinicResult] = await connection.execute(
      `INSERT INTO clinics
         (slug, name, legal_name, tagline, description, brand_colour,
          phone, whatsapp, email,
          address_line1, address_line2, city, state, postal_code, latitude, longitude, maps_url,
          practitioner_name, practitioner_credentials, practitioner_title,
          practitioner_registration, practitioner_experience_years, practitioner_bio,
          practitioner_languages, practitioner_specialisations,
          opening_hours, opening_hours_spec, faqs, stats, social,
          status, onboarding_step, onboarding_completed_at)
       VALUES (?, ?, ?, ?, ?, ?,
               ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?,
               ?, ?, ?,
               ?, ?,
               ?, ?, ?, ?, ?,
               'trialing', 'done', NOW())`,
      [
        DEMO_CLINIC.slug, DEMO_CLINIC.name, DEMO_CLINIC.legal_name, DEMO_CLINIC.tagline,
        DEMO_CLINIC.description, DEMO_CLINIC.brand_colour,
        DEMO_CLINIC.phone, DEMO_CLINIC.whatsapp, DEMO_CLINIC.email,
        DEMO_CLINIC.address_line1, DEMO_CLINIC.address_line2, DEMO_CLINIC.city,
        DEMO_CLINIC.state, DEMO_CLINIC.postal_code, DEMO_CLINIC.latitude,
        DEMO_CLINIC.longitude, DEMO_CLINIC.maps_url,
        DEMO_CLINIC.practitioner_name, DEMO_CLINIC.practitioner_credentials,
        DEMO_CLINIC.practitioner_title, DEMO_CLINIC.practitioner_registration,
        DEMO_CLINIC.practitioner_experience_years, DEMO_CLINIC.practitioner_bio,
        // JSON columns take a JSON string; mysql2 hands it back parsed.
        JSON.stringify(DEMO_CLINIC.practitioner_languages),
        JSON.stringify(DEMO_CLINIC.practitioner_specialisations),
        JSON.stringify(DEMO_CLINIC.opening_hours),
        JSON.stringify(DEMO_CLINIC.opening_hours_spec),
        JSON.stringify(DEMO_CLINIC.faqs),
        JSON.stringify(DEMO_CLINIC.stats),
        JSON.stringify(DEMO_CLINIC.social),
      ]
    )
    const clinicId = clinicResult.insertId
    console.log(c.green('done'))

    /* ------------------------------------------------- 4. the clinic's people */
    process.stdout.write('  4/5  Creating clinic accounts ......... ')
    let ownerId = null
    for (const user of DEMO_USERS) {
      // 10 rounds: slow enough that guessing passwords is impractical, fast
      // enough that logging in feels instant.
      const hash = await bcrypt.hash(user.password, 10)
      const [result] = await connection.execute(
        `INSERT INTO users (clinic_id, name, email, password_hash, phone, role, email_verified)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [clinicId, user.name, user.email, hash, user.phone, user.role]
      )

      if (user.role === 'admin') ownerId = result.insertId

      if (user.role === 'patient') {
        await connection.execute(
          `INSERT INTO patient_profiles
             (user_id, date_of_birth, gender, city, occupation, height_cm, weight_kg,
              medical_history, referred_by)
           VALUES (?, '1991-04-12', 'male', 'Pune', 'Software engineer', 178, 82,
                   'No major illnesses. Sedentary job, 9+ hours at a desk daily.',
                   'Google search')`,
          [result.insertId]
        )
      }
    }

    // The other half of the circular reference, now that the user exists.
    await connection.execute('UPDATE clinics SET owner_user_id = ? WHERE id = ?', [
      ownerId,
      clinicId,
    ])
    console.log(c.green('done'))

    /* -------------------------------------------------------------- 5. seed */
    process.stdout.write('  5/5  Adding plans, services & trial ... ')
    await connection.query(readSql('seed.sql'))
    console.log(c.green('done'))

    /* ------------------------------------------------------------- report */
    const [[{ plans }]] = await connection.query('SELECT COUNT(*) AS plans FROM plans')
    const [[{ services }]] = await connection.query('SELECT COUNT(*) AS services FROM services')
    const [[{ rules }]] = await connection.query(
      'SELECT COUNT(*) AS rules FROM availability_rules'
    )

    const suffix = DOMAIN === 'localhost' || DOMAIN.endsWith('.local') ? `:${PORT}` : ''

    console.log(c.green('\n  ✓ Database ready.\n'))
    console.log(`    ${plans} plans · 1 demo clinic · ${services} services · ${rules} availability rules\n`)

    console.log(c.bold('    THE PLATFORM (your business)'))
    console.log(`    ${c.cyan(`http://${DOMAIN}${suffix}`)}            marketing & signup`)
    console.log(`    ${c.cyan(`http://${DOMAIN}${suffix}/platform`)}   your admin`)
    console.log(`    ${PLATFORM_OWNER.email} / ${PLATFORM_OWNER.password}\n`)

    console.log(c.bold('    THE DEMO CLINIC (a customer)'))
    console.log(`    ${c.cyan(`http://${DEMO_CLINIC.slug}.${DOMAIN}${suffix}`)}`)
    console.log('    ┌──────────────────────────────┬──────────────┬─────────┐')
    console.log('    │ Email                        │ Password     │ Role    │')
    console.log('    ├──────────────────────────────┼──────────────┼─────────┤')
    for (const u of DEMO_USERS) {
      console.log(
        `    │ ${u.email.padEnd(28)} │ ${u.password.padEnd(12)} │ ${u.role.padEnd(7)} │`
      )
    }
    console.log('    └──────────────────────────────┴──────────────┴─────────┘\n')

    console.log(c.dim('    Subdomains work locally with no setup — *.localhost'))
    console.log(c.dim('    resolves automatically in Chrome and Firefox.\n'))
    console.log(`    Next:  ${c.bold('npm run dev')}\n`)
  } catch (error) {
    console.log(c.red('failed\n'))
    console.error(c.red(`  ✗ ${error.message}\n`))
    if (error.sql) console.error(c.dim(`    while running: ${error.sql.slice(0, 300)}…\n`))
    process.exitCode = 1
  } finally {
    await connection.end()
  }
}

main()
