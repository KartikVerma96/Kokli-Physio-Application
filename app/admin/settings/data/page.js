import { redirect } from 'next/navigation'
import { Download, FileJson, ShieldCheck, Info } from 'lucide-react'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { platform } from '@/config/platform'
import { query } from '@/lib/db'
import { Card } from '@/components/ui/Card'

/**
 * ============================================================================
 *  YOUR DATA  →  /admin/settings/data
 * ============================================================================
 *  Every record the clinic owns, downloadable.
 *
 *  WHY A PAGE AND NOT A HIDDEN ENDPOINT
 *  ------------------------------------
 *  This page is a sales argument as much as a feature. Every clinic evaluating
 *  this software has been burned by a vendor before, and "can I get my patient list
 *  out?" comes up early in the conversation. Being able to open this page during a
 *  demo answers it in five seconds.
 *
 *  It is also the clinic's legal obligation, not ours. Under India's DPDP Act the
 *  clinic is the data fiduciary for its patients — when a patient asks for their
 *  records, the clinic must produce them, and cannot unless the software lets go.
 *
 *  The counts are shown next to each download deliberately. A file that arrives
 *  with 0 rows looks broken; a page that said "1,284 patients" first makes an empty
 *  file obviously wrong instead of ambiguous.
 * ============================================================================
 */

export const metadata = { title: 'Your data', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

const DOWNLOADS = [
  { key: 'patients', label: 'Patients', note: 'Contact details, medical history, visit counts' },
  { key: 'appointments', label: 'Appointments', note: 'Every booking, past and future, with its status' },
  { key: 'payments', label: 'Payments', note: 'Online and at the desk, with refunds' },
  { key: 'notes', label: 'Clinical notes', note: 'Full SOAP notes and prescribed exercises' },
  { key: 'packages', label: 'Packages sold', note: 'Sessions bought, used and expiring' },
  { key: 'reviews', label: 'Reviews', note: 'Ratings and comments, published or not' },
  { key: 'services', label: 'Treatments', note: 'Your price list' },
]

export default async function DataPage() {
  const clinic = await requireCurrentClinic()

  /**
   * ADMIN ONLY — and this check is the one that makes it true.
   *
   * The nav entry is marked adminOnly, so a physiotherapist never sees the link.
   * That gates nothing: the URL is guessable and typing it worked. The page then
   * showed how many patients, appointments and clinical notes the clinic holds,
   * and offered download buttons that only failed once pressed.
   *
   * /api/export/clinic was never exposed — it calls requireClinicAdmin() and
   * refused the physiotherapist with a 403, so no data ever left. But a page that
   * leaks counts and hands out buttons that 403 is still wrong, and it was the only
   * adminOnly page in the app missing this line.
   *
   * Same rule as /admin/billing: money and the whole patient list belong to whoever
   * owns the business and carries the legal responsibility for them.
   */
  const session = await auth()
  if (!['admin', 'platform'].includes(session?.user?.role)) redirect('/admin')

  /**
   * One query for all seven counts rather than seven queries.
   *
   * Correlated subqueries in a single SELECT, because this page is opened by a
   * cautious owner who will click every button — the counts must be right and they
   * must not cost seven round trips to be right.
   */
  const [counts] = await query(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE clinic_id = ? AND role = 'patient')   AS patients,
       (SELECT COUNT(*) FROM appointments WHERE clinic_id = ?)                 AS appointments,
       (SELECT COUNT(*) FROM payments WHERE clinic_id = ?)                     AS payments,
       (SELECT COUNT(*) FROM consultation_notes WHERE clinic_id = ?)           AS notes,
       (SELECT COUNT(*) FROM patient_packages WHERE clinic_id = ?)             AS packages,
       (SELECT COUNT(*) FROM reviews WHERE clinic_id = ?)                      AS reviews,
       (SELECT COUNT(*) FROM services WHERE clinic_id = ?)                     AS services`,
    Array(7).fill(clinic.id)
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Your data</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Everything {clinic.name} has in {platform.name}, yours to download at any time.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm dark:border-sky-800 dark:bg-sky-950/30">
        <Info className="mt-0.5 size-4 shrink-0 text-sky-600" aria-hidden="true" />
        <div className="text-sky-900 dark:text-sky-100">
          <p className="font-bold">This is your data, not ours.</p>
          <p className="mt-0.5 text-sky-800 dark:text-sky-200">
            Files open directly in Excel. If a patient asks for a copy of their own records — which
            they are entitled to under the DPDP Act — they can download it themselves from their
            profile page, so you do not have to handle the request.
          </p>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {DOWNLOADS.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {item.label}
                  <span className="ml-2 text-xs font-medium text-ink-400">
                    {Number(counts?.[item.key] ?? 0).toLocaleString('en-IN')} rows
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{item.note}</p>
              </div>
              {/* A plain link. Downloading a file is what an anchor has always
                  done — doing it in JavaScript adds a Blob, an object URL and a
                  synthesised click, each of which can fail on a phone. */}
              <a
                href={`/api/export/clinic?dataset=${item.key}`}
                download
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-ink-200 px-3.5 text-sm font-semibold transition-colors hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800"
              >
                <Download className="size-4" aria-hidden="true" />
                CSV
              </a>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink-100 dark:bg-ink-800">
            <FileJson className="size-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold">Everything, in one file</h2>
            <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
              All of the above as a single JSON file, with the relationships between records intact.
              This is the one to take if you are moving to different software.
            </p>
            <a
              href="/api/export/clinic?dataset=all"
              download
              className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl border border-ink-200 px-4 text-sm font-semibold transition-colors hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800"
            >
              <Download className="size-4" aria-hidden="true" />
              Download everything (JSON)
            </a>
          </div>
        </div>
      </Card>

      <p className="flex items-start gap-2 text-xs text-ink-500 dark:text-ink-400">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Passwords are never included in an export. They are stored only as one-way hashes and
          cannot be read back by anyone, including us. These files contain patient medical
          information — keep them somewhere you would be comfortable keeping paper records.
        </span>
      </p>
    </div>
  )
}
