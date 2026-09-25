import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Users, Info } from 'lucide-react'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { query } from '@/lib/db'
import { Card, Badge } from '@/components/ui/Card'
import TeamManager from './TeamManager'

/**
 * ============================================================================
 *  TEAM  →  /admin/settings/team
 * ============================================================================
 *  Add and deactivate physiotherapists, within the seat limit of the plan.
 *
 *  This is what makes the pricing tiers mean something. Before it existed, the
 *  "1 / 3 / 10 physiotherapists" line on the pricing page was unenforceable in
 *  both directions: nobody could add a second therapist even on the top plan.
 * ============================================================================
 */

export const metadata = { title: 'Team', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function TeamPage() {
  const clinic = await requireCurrentClinic()
  const session = await auth()

  if (!['admin', 'platform'].includes(session?.user?.role)) redirect('/admin')

  const physios = await query(
    `SELECT u.id, u.name, u.email, u.is_active, u.created_at,
            (SELECT COUNT(*) FROM appointments a
              WHERE a.physio_id = u.id AND a.clinic_id = u.clinic_id) AS appointment_count
       FROM users u
      WHERE u.clinic_id = ? AND u.role = 'physio'
      ORDER BY u.is_active DESC, u.name`,
    [clinic.id]
  )

  const limit = clinic.max_physios ?? 1
  const used = physios.filter((p) => p.is_active).length

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Team</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          The physiotherapists patients can book with.
        </p>
      </div>

      {/* ------------------------------------------------------- seat usage */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-300">
              <Users className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-bold">
                {used} of {limit} seat{limit === 1 ? '' : 's'} used
              </p>
              <p className="text-xs text-ink-500 dark:text-ink-400">
                on the {clinic.plan_name || 'current'} plan
              </p>
            </div>
          </div>

          {used >= limit ? (
            <Link
              href="/admin/billing"
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg,#fff)] transition-colors hover:bg-brand-700"
            >
              Upgrade for more seats
            </Link>
          ) : (
            <Badge tone="success">{limit - used} available</Badge>
          )}
        </div>

        {/* A simple usage bar. Seeing 3/3 filled says more at a glance than the
            sentence above it. */}
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
          <div
            className={`h-full rounded-full ${used >= limit ? 'bg-amber-500' : 'bg-brand-500'}`}
            style={{ width: `${Math.min(100, (used / Math.max(limit, 1)) * 100)}%` }}
          />
        </div>
      </Card>

      <TeamManager
        physios={physios.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          isActive: Boolean(p.is_active),
          appointmentCount: Number(p.appointment_count),
        }))}
        atLimit={used >= limit}
        limit={limit}
      />

      <div className="flex items-start gap-3 rounded-2xl border border-ink-200 p-5 text-sm dark:border-ink-700">
        <Info className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
        <p className="text-ink-600 dark:text-ink-400">
          Deactivating a physiotherapist stops them signing in and frees their seat, but keeps their
          name on every appointment and clinical note they wrote. Clinical records must always say
          who wrote them, so nobody is ever deleted.
        </p>
      </div>
    </div>
  )
}
