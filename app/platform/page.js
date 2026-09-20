import Link from 'next/link'
import {
  IndianRupee, Users, TrendingUp, Clock, AlertCircle, ArrowRight, Building2, CheckCircle2,
} from 'lucide-react'
import { getPlatformStats } from '@/lib/queries'
import { platform, clinicUrl } from '@/config/platform'
import { formatMoney, formatDateShort } from '@/lib/utils'
import { Card, Stat, Badge, EmptyState } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import SweepButton from './SweepButton'

/**
 * ============================================================================
 *  PLATFORM OVERVIEW  →  /platform
 * ============================================================================
 *  Your business at a glance.
 *
 *  THE ONE NUMBER THAT MATTERS, AND THE ONE THAT LIES
 *  --------------------------------------------------
 *  MRR — monthly recurring revenue — counts ACTIVE subscriptions only. Trials
 *  are shown separately as "pipeline", never folded in.
 *
 *  That separation is deliberate and it is the most important thing on this
 *  page. A trial is not revenue until somebody's card is charged, and a founder
 *  who adds the two together talks themselves into believing the business is
 *  three times its real size. Every SaaS dashboard that gets this wrong makes
 *  its owner worse at running the company.
 * ============================================================================
 */

export const dynamic = 'force-dynamic'

export default async function PlatformOverview() {
  const stats = await getPlatformStats()

  const clinics = stats.clinics || {}
  const active = Number(clinics.active) || 0
  const trialing = Number(clinics.trialing) || 0
  const mrr = Number(stats.revenue?.mrr_paise) || 0
  const pipeline = Number(stats.revenue?.trial_pipeline_paise) || 0

  // Annual run rate — MRR × 12. A rough figure, but the one investors and
  // landlords ask for.
  const arr = mrr * 12

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl">{platform.name}</h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            {Number(clinics.total) || 0} clinic{Number(clinics.total) === 1 ? '' : 's'} ·{' '}
            {Number(clinics.new_this_month) || 0} joined in the last 30 days
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SweepButton />
          <Button href="/platform/clinics" size="sm" variant="secondary">
            All clinics
          </Button>
        </div>
      </div>

      {/* --------------------------------------------------- trials ending */}
      {/* The single most valuable list in the business: exactly who to call. */}
      {stats.endingTrials.length > 0 && (
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-bold text-amber-900 dark:text-amber-100">
              {stats.endingTrials.length} trial{stats.endingTrials.length === 1 ? '' : 's'} ending
              within a week
            </p>
            <p className="mt-0.5 text-amber-800 dark:text-amber-200">
              These are the clinics worth an email or a phone call today.
            </p>
            <ul className="mt-3 space-y-1.5">
              {stats.endingTrials.slice(0, 5).map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 text-xs">
                  <Link
                    href={`/platform/clinics?q=${t.slug}`}
                    className="font-semibold underline underline-offset-2"
                  >
                    {t.name}
                  </Link>
                  <span className="text-amber-700 dark:text-amber-300">
                    ends {formatDateShort(t.trial_ends_at)}
                  </span>
                  {t.owner_email && (
                    <a href={`mailto:${t.owner_email}`} className="text-amber-700 underline dark:text-amber-300">
                      {t.owner_email}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------- the money */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="MRR"
          value={formatMoney(mrr)}
          hint={`${formatMoney(arr)} annual run rate`}
          icon={<IndianRupee className="size-5" />}
          tone="success"
        />
        <Stat
          label="Trial pipeline"
          value={formatMoney(pipeline)}
          hint={`${trialing} clinic${trialing === 1 ? '' : 's'} — not revenue yet`}
          icon={<Clock className="size-5" />}
          tone="warning"
        />
        <Stat
          label="Paying clinics"
          value={active}
          hint={`${Number(clinics.total) || 0} total`}
          icon={<Building2 className="size-5" />}
          tone="brand"
        />
        <Stat
          label="Collected this month"
          value={formatMoney(Number(stats.collected?.month_paise) || 0)}
          hint={`${formatMoney(Number(stats.collected?.all_time_paise) || 0)} all time`}
          icon={<TrendingUp className="size-5" />}
          tone="info"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ------------------------------------------------- signups trend */}
        <div className="lg:col-span-2">
          <Card className="p-5">
            <h2 className="font-bold">Signups, last 30 days</h2>
            <SignupChart trend={stats.signupTrend} />
          </Card>
        </div>

        {/* ------------------------------------------------------ by plan */}
        <Card className="p-5">
          <h2 className="font-bold">Where the revenue is</h2>
          {stats.byPlan.length === 0 ? (
            <p className="mt-3 text-sm text-ink-500">No subscriptions yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {stats.byPlan.map((row) => {
                const max = Math.max(...stats.byPlan.map((r) => Number(r.mrr_paise) || 0), 1)
                const percent = Math.round(((Number(row.mrr_paise) || 0) / max) * 100)
                return (
                  <li key={row.code}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium">{row.name}</span>
                      <span className="shrink-0 text-sm font-bold tabular-nums">
                        {formatMoney(Number(row.mrr_paise) || 0)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${percent}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      {row.clinics} clinic{Number(row.clinics) === 1 ? '' : 's'}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* ------------------------------------------------- health breakdown */}
      <Card className="p-5">
        <h2 className="font-bold">Clinic health</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'Trialing', value: trialing, tone: 'warning' },
            { label: 'Active', value: active, tone: 'success' },
            { label: 'Past due', value: Number(clinics.past_due) || 0, tone: 'danger' },
            { label: 'Read-only', value: Number(clinics.read_only) || 0, tone: 'danger' },
            { label: 'Suspended', value: Number(clinics.suspended) || 0, tone: 'neutral' },
            { label: 'Cancelled', value: Number(clinics.cancelled) || 0, tone: 'neutral' },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-ink-200 p-4 dark:border-ink-700">
              <p className="text-2xl font-bold tabular-nums">{item.value}</p>
              <Badge tone={item.tone} className="mt-1.5">{item.label}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

/**
 * Thirty bars, one per day.
 *
 * Hand-rolled for the same reason as the clinic dashboard's: a charting library
 * is 100–200KB of JavaScript, and this is thirty divs with a height.
 */
function SignupChart({ trend }) {
  const byDay = new Map(trend.map((r) => [String(r.day).slice(0, 10), Number(r.signups)]))

  const days = []
  for (let i = 29; i >= 0; i--) {
    const date = new Date()
    date.setDate(date.getDate() - i)
    const iso = date.toISOString().slice(0, 10)
    days.push({ iso, count: byDay.get(iso) || 0 })
  }

  const max = Math.max(1, ...days.map((d) => d.count))
  const total = days.reduce((sum, d) => sum + d.count, 0)

  return (
    <>
      <p className="mt-2 text-3xl font-bold tabular-nums">{total}</p>
      <p className="text-xs text-ink-500">new clinics in the last 30 days</p>
      <div
        className="mt-5 flex h-24 items-end gap-1"
        role="img"
        aria-label={`${total} signups over the last 30 days`}
      >
        {days.map((day) => (
          <div
            key={day.iso}
            // A 4% floor so a zero day still shows a tick rather than vanishing.
            style={{ height: `${Math.max(4, (day.count / max) * 100)}%` }}
            className={`flex-1 rounded-t ${
              day.count > 0 ? 'bg-brand-500' : 'bg-ink-200 dark:bg-ink-700'
            }`}
            title={`${day.iso}: ${day.count} signup${day.count === 1 ? '' : 's'}`}
          />
        ))}
      </div>
    </>
  )
}
