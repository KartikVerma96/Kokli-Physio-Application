import { requireClinicAdmin } from '@/lib/guards'
import { query } from '@/lib/db'
import { toCsv, csvResponse, jsonResponse, stamp } from '@/lib/csv'

/**
 * ============================================================================
 *  THE CLINIC'S OWN DATA  →  GET /api/export/clinic?dataset=patients
 * ============================================================================
 *  Every record the clinic owns, as CSV a clinic can open in Excel.
 *
 *  WHY GIVING CUSTOMERS THEIR DATA BACK WINS BUSINESS
 *  --------------------------------------------------
 *  The instinct is that an export makes leaving easier, so leave it out. It is
 *  exactly backwards.
 *
 *  Every clinic evaluating this has been burned before — usually by Practo — and
 *  "can I get my patient list out?" is a question they ask early. A vendor who says
 *  yes, with a button, removes the single largest reason not to sign up. A vendor
 *  who says no is asking a small business to bet its records on a company it met
 *  last week.
 *
 *  It also cuts both ways commercially. A clinic that knows it can leave has no
 *  reason to keep a spreadsheet "just in case", which means their data actually
 *  lives here, which is what makes the product sticky. Lock-in built on fear is the
 *  weakest kind: it holds until the day they finally get angry enough.
 *
 *  And it is required. Under India's DPDP Act the clinic is the data fiduciary for
 *  its patients — the obligation is theirs, and they cannot meet it if the software
 *  will not let go.
 *
 *  WHY ONE DATASET PER REQUEST
 *  ---------------------------
 *  There is no zip library here, and adding a dependency to bundle files is a poor
 *  trade. Separate CSVs are also what a clinic actually wants: patients.csv opens
 *  in Excel and is immediately useful, where a zip has to be unpacked first.
 *
 *  `dataset=all` returns one JSON with everything, for a genuine migration.
 * ============================================================================
 */

export const dynamic = 'force-dynamic'

/**
 * Every dataset, its query and its column list.
 *
 * The queries are here rather than in lib/queries.js on purpose: these are the
 * only reads in the application that deliberately return whole tables, and mixing
 * them in with the scoped page queries is how somebody reuses one by mistake.
 *
 * Every single one filters on clinic_id. There is no exception and there must not
 * be — one missing filter here hands a clinic every other clinic's patient list in
 * a file they can open.
 */
const DATASETS = {
  patients: {
    label: 'Patients',
    columns: [
      ['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'],
      ['date_of_birth', 'Date of birth'], ['gender', 'Gender'],
      ['occupation', 'Occupation'], ['city', 'City'], ['address', 'Address'],
      ['height_cm', 'Height (cm)'], ['weight_kg', 'Weight (kg)'],
      ['medical_history', 'Medical history'], ['current_medications', 'Medications'],
      ['allergies', 'Allergies'], ['referred_by', 'Referred by'],
      ['emergency_contact_name', 'Emergency contact'],
      ['emergency_contact_phone', 'Emergency phone'],
      ['visits', 'Visits'], ['last_visit', 'Last visit'],
      ['created_at', 'On file since'],
    ],
    sql: `
      SELECT u.name, u.email, u.phone, u.created_at,
             p.date_of_birth, p.gender, p.occupation, p.city, p.address,
             p.height_cm, p.weight_kg, p.medical_history, p.current_medications,
             p.allergies, p.referred_by,
             p.emergency_contact_name, p.emergency_contact_phone,
             (SELECT COUNT(*) FROM appointments a
               WHERE a.patient_id = u.id AND a.status = 'completed') AS visits,
             (SELECT MAX(a.appointment_date) FROM appointments a
               WHERE a.patient_id = u.id AND a.status = 'completed') AS last_visit
        FROM users u
        LEFT JOIN patient_profiles p ON p.user_id = u.id
       WHERE u.clinic_id = ? AND u.role = 'patient'
       ORDER BY u.name`,
  },

  appointments: {
    label: 'Appointments',
    columns: [
      ['code', 'Reference'], ['appointment_date', 'Date'], ['start_time', 'Time'],
      ['patient_name', 'Patient'], ['patient_phone', 'Phone'],
      ['physio_name', 'Physiotherapist'], ['treatment', 'Treatment'],
      ['mode', 'Mode'], ['status', 'Status'], ['amount_paise', 'Amount (paise)'],
      ['pain_level', 'Pain level'], ['patient_notes', 'Patient notes'],
      ['cancel_reason', 'Cancellation reason'], ['created_at', 'Booked at'],
    ],
    sql: `
      SELECT a.code, a.appointment_date, a.start_time, a.mode, a.status,
             a.amount_paise, a.pain_level, a.patient_notes, a.cancel_reason, a.created_at,
             pt.name AS patient_name, pt.phone AS patient_phone,
             ph.name AS physio_name, s.name AS treatment
        FROM appointments a
        LEFT JOIN users pt ON pt.id = a.patient_id
        LEFT JOIN users ph ON ph.id = a.physio_id
        LEFT JOIN services s ON s.id = a.service_id
       WHERE a.clinic_id = ?
       ORDER BY a.appointment_date DESC, a.start_time DESC`,
  },

  payments: {
    label: 'Payments',
    columns: [
      ['created_at', 'Date'], ['patient_name', 'Patient'],
      ['amount_paise', 'Amount (paise)'], ['status', 'Status'],
      ['provider', 'Taken via'], ['method', 'Method'], ['reference', 'Reference'],
      ['appointment_code', 'Appointment'], ['package_name', 'Package'],
      ['refunded_paise', 'Refunded (paise)'], ['refunded_at', 'Refunded at'],
      ['collected_by_name', 'Collected by'],
    ],
    sql: `
      SELECT p.created_at, p.amount_paise, p.status, p.provider, p.method, p.reference,
             p.refunded_paise, p.refunded_at,
             a.code AS appointment_code, pp.name AS package_name,
             COALESCE(pt.name, pkt.name) AS patient_name,
             cb.name AS collected_by_name
        FROM payments p
        LEFT JOIN appointments a ON a.id = p.appointment_id
        LEFT JOIN users pt ON pt.id = a.patient_id
        LEFT JOIN patient_packages pp ON pp.id = p.patient_package_id
        LEFT JOIN users pkt ON pkt.id = pp.patient_id
        LEFT JOIN users cb ON cb.id = p.collected_by
       WHERE p.clinic_id = ?
       ORDER BY p.created_at DESC`,
  },

  notes: {
    label: 'Clinical notes',
    columns: [
      ['appointment_date', 'Date'], ['appointment_code', 'Appointment'],
      ['patient_name', 'Patient'], ['written_by', 'Physiotherapist'],
      ['subjective', 'Subjective'], ['objective', 'Objective'],
      ['assessment', 'Assessment'], ['plan', 'Plan'],
      ['exercises_prescribed', 'Exercises'],
      ['pain_level_before', 'Pain before'], ['pain_level_after', 'Pain after'],
      ['follow_up_date', 'Follow up'], ['sessions_recommended', 'Sessions recommended'],
      ['created_at', 'Written at'],
    ],
    sql: `
      SELECT n.subjective, n.objective, n.assessment, n.plan, n.exercises_prescribed,
             n.pain_level_before, n.pain_level_after, n.follow_up_date,
             n.sessions_recommended, n.created_at,
             a.appointment_date, a.code AS appointment_code,
             pt.name AS patient_name, ph.name AS written_by
        FROM consultation_notes n
        JOIN appointments a ON a.id = n.appointment_id
        LEFT JOIN users pt ON pt.id = a.patient_id
        LEFT JOIN users ph ON ph.id = n.physio_id
       WHERE n.clinic_id = ?
       ORDER BY a.appointment_date DESC`,
  },

  packages: {
    label: 'Packages sold',
    columns: [
      ['purchased_at', 'Purchased'], ['patient_name', 'Patient'], ['name', 'Package'],
      ['treatment', 'Treatment'], ['sessions_total', 'Sessions'],
      ['sessions_used', 'Used'], ['price_paise', 'Price (paise)'],
      ['expires_at', 'Expires'], ['status', 'Status'], ['notes', 'Notes'],
    ],
    sql: `
      SELECT pp.purchased_at, pp.name, pp.sessions_total, pp.price_paise,
             pp.expires_at, pp.status, pp.notes,
             pt.name AS patient_name, s.name AS treatment,
             (SELECT COUNT(*) FROM appointments a
               WHERE a.patient_package_id = pp.id
                 AND a.status IN ('completed', 'confirmed')) AS sessions_used
        FROM patient_packages pp
        LEFT JOIN users pt ON pt.id = pp.patient_id
        LEFT JOIN services s ON s.id = pp.service_id
       WHERE pp.clinic_id = ?
       ORDER BY pp.purchased_at DESC`,
  },

  reviews: {
    label: 'Reviews',
    columns: [
      ['created_at', 'Date'], ['patient_name', 'Patient'], ['rating', 'Rating'],
      ['comment', 'Comment'], ['is_published', 'Published'],
    ],
    sql: `
      SELECT r.created_at, r.rating, r.comment, r.is_published, pt.name AS patient_name
        FROM reviews r
        LEFT JOIN users pt ON pt.id = r.patient_id
       WHERE r.clinic_id = ?
       ORDER BY r.created_at DESC`,
  },

  services: {
    label: 'Treatments',
    columns: [
      ['name', 'Name'], ['slug', 'Web address'], ['price_paise', 'Price (paise)'],
      ['duration_minutes', 'Minutes'], ['available_clinic', 'At the clinic'],
      ['available_online', 'Online'], ['is_active', 'Active'],
      ['short_description', 'Short description'],
    ],
    sql: `
      SELECT name, slug, price_paise, duration_minutes, available_clinic,
             available_online, is_active, short_description
        FROM services WHERE clinic_id = ? ORDER BY name`,
  },
}

/** The names, for the export page to render buttons from. */
export const DATASET_KEYS = Object.keys(DATASETS)

export async function GET(request) {
  let clinic
  try {
    /**
     * ADMIN ONLY, not staff.
     *
     * A physiotherapist needs the diary and the notes for the patient in front of
     * them. A file containing every patient's phone number, address and medical
     * history is a different thing entirely, and it belongs to whoever owns the
     * business and carries the legal responsibility for it.
     */
    clinic = await requireClinicAdmin()
  } catch {
    return Response.json({ error: 'Only the clinic owner can export data.' }, { status: 403 })
  }

  const wanted = new URL(request.url).searchParams.get('dataset') || 'patients'

  /* ------------------------------------------------------ everything at once */
  if (wanted === 'all') {
    /**
     * All seven at once, not one after another.
     *
     * These queries are independent — no dataset needs another's result — so
     * awaiting them in a loop just adds six round trips of waiting to the slowest
     * request in the application. On a clinic with years of history that is the
     * difference between a download starting and somebody pressing the button again.
     */
    const keys = Object.keys(DATASETS)
    const results = await Promise.all(keys.map((key) => query(DATASETS[key].sql, [clinic.id])))
    const all = Object.fromEntries(keys.map((key, i) => [key, results[i]]))
    return jsonResponse(
      {
        exported_at: new Date().toISOString(),
        clinic: { name: clinic.name, slug: clinic.slug, city: clinic.city },
        about_this_file:
          'A complete copy of your clinic\'s data. Passwords are not included: they are stored ' +
          'only as one-way hashes and cannot be read back by anyone.',
        ...all,
      },
      `${clinic.slug}-all-data-${stamp()}.json`
    )
  }

  const spec = DATASETS[wanted]
  if (!spec) {
    return Response.json(
      { error: 'Unknown dataset.', available: [...DATASET_KEYS, 'all'] },
      { status: 400 }
    )
  }

  const rows = await query(spec.sql, [clinic.id])
  return csvResponse(toCsv(rows, spec.columns), `${clinic.slug}-${wanted}-${stamp()}.csv`)
}
