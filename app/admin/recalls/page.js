import Link from 'next/link'
import { Layers, CalendarClock, UserX, Info, Phone } from 'lucide-react'
import { requireCurrentClinic } from '@/lib/tenant'
import { unfinishedPackages, followUpsDue, lapsedPatients, realEmail } from '@/lib/recalls'
import { formatDateShort, formatDateLong } from '@/lib/utils'
import { Card, Stat, Badge, EmptyState } from '@/components/ui/Card'
import RecallList from './RecallList'

/**
 * ============================================================================
 *  RECALL  →  /admin/recalls
 * ============================================================================
 *  Who to telephone today.
 *
 *  A new patient costs money to find — advertising, a Google listing, a referral
 *  relationship with a surgeon. A patient treated here six months ago costs one
 *  phone call, already trusts the clinic, and their file is already open. This is
 *  the cheapest revenue a physiotherapy clinic can get, and the application was
 *  already storing everything needed to produce the list while reading none of it.
 *
 *  Ordered by how badly each group needs calling — see the note at the top of
 *  lib/recalls.js. Unfinished packages first, because those patients have already
 *  paid for treatment they have not received, which is a clinical failure before
 *  it is a commercial one.
 * ============================================================================
 */

export const metadata = { title: 'Recall', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function RecallsPage() {
  const clinic = await requireCurrentClinic()
  const lapsedAfter = Number(clinic.recall_after_days) || 60

  const [packages, followUps, lapsed] = await Promise.all([
    unfinishedPackages(clinic.id),
    followUpsDue(clinic.id),
    lapsedPatients(clinic.id, { afterDays: lapsedAfter }),
  ])

  const total = packages.length + followUps.length + lapsed.length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Recall</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          {total === 0
            ? 'Nobody needs chasing — everyone is either booked in or finished.'
            : `${total} patient${total === 1 ? '' : 's'} worth a phone call.`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Sessions unused"
          value={packages.length}
          hint="already paid for"
          icon={<Layers className="size-5" />}
          tone="brand"
        />
        <Stat
          label="Follow-ups due"
          value={followUps.length}
          hint="you asked to see them again"
          icon={<CalendarClock className="size-5" />}
          tone="warning"
        />
        <Stat
          label="Lapsed"
          value={lapsed.length}
          hint={`no visit in ${lapsedAfter} days`}
          icon={<UserX className="size-5" />}
          tone="info"
        />
      </div>

      {total === 0 && (
        <EmptyState
          icon={<Phone className="size-6" />}
          title="Nothing to chase"
          description="Every patient with sessions left, a follow-up due, or a long gap already has an appointment booked."
        />
      )}

      {/* ═══════════════════════════════ 1. paid for, not taken */}
      {packages.length > 0 && (
        <RecallList
          title="Sessions they have paid for and not used"
          why="Money you are holding for work you have not done — and an unfinished course of treatment is how people relapse. These are the easiest calls in the building: nobody is being sold anything."
          icon="Layers"
          tone="brand"
          rows={packages.map((row) => ({
            patientId: row.patient_id,
            name: row.name,
            phone: row.phone,
            email: realEmail(row.email),
            headline: `${row.sessionsLeft} of ${row.sessions_total} sessions left`,
            detail: [
              row.package_name,
              row.expires_at ? `expires ${formatDateShort(row.expires_at)}` : 'no expiry',
              row.last_visit ? `last seen ${formatDateShort(row.last_visit)}` : 'never seen',
            ].join(' · '),
            // Expiring soonest is genuinely the most urgent: after that date the
            // patient has lost sessions they paid for, which is a complaint.
            urgent: Boolean(row.expires_at),
            lastRecallAt: null,
          }))}
        />
      )}

      {/* ═══════════════════════════════ 2. clinically due */}
      {followUps.length > 0 && (
        <RecallList
          title="Follow-ups you asked for"
          why="A physiotherapist wrote a follow-up date in the clinical notes. Missing it means ignoring your own clinical judgement."
          icon="CalendarClock"
          tone="warning"
          rows={followUps.map((row) => ({
            patientId: row.patient_id,
            name: row.name,
            phone: row.phone,
            email: realEmail(row.email),
            headline: `Due ${formatDateLong(row.follow_up_date)}`,
            detail: [
              row.service_name,
              row.sessions_recommended ? `${row.sessions_recommended} sessions recommended` : null,
              row.last_seen ? `last seen ${formatDateShort(row.last_seen)}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            urgent: new Date(row.follow_up_date) <= new Date(),
            lastRecallAt: row.last_recall_at,
          }))}
        />
      )}

      {/* ═══════════════════════════════ 3. simply gone quiet */}
      {lapsed.length > 0 && (
        <RecallList
          title={`No visit in ${lapsedAfter} days`}
          why="The coldest calls, and still cheaper than finding somebody new. Worth asking how the problem is rather than opening with an offer."
          icon="UserX"
          tone="info"
          rows={lapsed.map((row) => ({
            patientId: row.patient_id,
            name: row.name,
            phone: row.phone,
            email: realEmail(row.email),
            headline: `Last seen ${formatDateShort(row.last_visit)}`,
            detail: `${row.visits} visit${Number(row.visits) === 1 ? '' : 's'} in total${
              row.recall_note ? ` · “${row.recall_note}”` : ''
            }`,
            urgent: false,
            lastRecallAt: row.last_recall_at,
          }))}
        />
      )}

      <Card className="flex items-start gap-3 p-5 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
        <p className="text-ink-600 dark:text-ink-400">
          Anybody with an appointment already booked is left off every list — the point is who is{' '}
          <em>not</em> coming back. &ldquo;No visit in {lapsedAfter} days&rdquo; is a clinic setting;
          change it in{' '}
          <Link
            href="/admin/settings/policies"
            className="font-semibold text-brand-700 underline dark:text-brand-400"
          >
            Settings → Policies
          </Link>
          .
        </p>
      </Card>
    </div>
  )
}
