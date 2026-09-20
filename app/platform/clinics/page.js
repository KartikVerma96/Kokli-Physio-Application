import Link from 'next/link'
import { Search, Building2, ExternalLink, Users, CalendarDays } from 'lucide-react'
import { getAllClinics, getPublicPlans } from '@/lib/queries'
import { clinicUrl } from '@/config/platform'
import { formatMoney, formatDateShort } from '@/lib/utils'
import { Card, Badge, EmptyState } from '@/components/ui/Card'
import ClinicActions from './ClinicActions'

/**
 * ============================================================================
 *  EVERY CLINIC  →  /platform/clinics
 * ============================================================================
 *  Your customer list. Filters live in the URL, so a filtered view can be
 *  bookmarked and shared — see the note in app/admin/appointments/page.js for
 *  the full reasoning.
 * ============================================================================
 */

export const dynamic = 'force-dynamic'

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'trialing', label: 'Trialing' },
  { value: 'active', label: 'Paying' },
  { value: 'past_due', label: 'Past due' },
  { value: 'read_only', label: 'Locked' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'cancelled', label: 'Cancelled' },
]

const STATUS_TONE = {
  trialing: 'warning',
  active: 'success',
  past_due: 'danger',
  read_only: 'danger',
  suspended: 'neutral',
  cancelled: 'neutral',
}

export default async function PlatformClinicsPage({ searchParams }) {
  const params = await searchParams
  const status = typeof params?.status === 'string' ? params.status : ''
  const search = typeof params?.q === 'string' ? params.q.trim() : ''

  const [clinics, plans] = await Promise.all([
    getAllClinics({ status, search }),
    getPublicPlans(),
  ])

  const totalMrr = clinics
    .filter((c) => c.subscription_status === 'active')
    .reduce((sum, c) => sum + (Number(c.mrr_paise) || 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Clinics</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          {clinics.length} shown · {formatMoney(totalMrr)} MRR from those paying
        </p>
      </div>

      {/* A plain GET form — no JavaScript, and the result is a shareable URL. */}
      <Card className="p-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          {status && <input type="hidden" name="status" value={status} />}
          <div className="min-w-0 flex-1">
            <label htmlFor="q" className="mb-1.5 block text-xs font-semibold text-ink-600 dark:text-ink-300">
              Search by clinic name, web address or email
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
              <input
                id="q"
                name="q"
                defaultValue={search}
                placeholder="aarogya, pune, owner@…"
                className="h-11 w-full rounded-xl border border-ink-200 bg-white pl-11 pr-4 text-sm focus:border-brand-500 focus:outline-none dark:border-ink-700 dark:bg-ink-900"
              />
            </div>
          </div>
          <button type="submit" className="h-11 shrink-0 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700">
            Search
          </button>
          {(search || status) && (
            <Link href="/platform/clinics" className="h-11 shrink-0 rounded-xl px-4 text-sm font-semibold leading-[2.75rem] text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800">
              Clear
            </Link>
          )}
        </form>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-ink-400">Status</span>
        {STATUS_FILTERS.map((f) => {
          const href = `/platform/clinics${
            f.value || search
              ? `?${new URLSearchParams({ ...(f.value && { status: f.value }), ...(search && { q: search }) })}`
              : ''
          }`
          const isActive = status === f.value
          return (
            <Link
              key={f.value}
              href={href}
              /**
               * 'page', not 'true'. `aria-current="page"` is the token screen
               * readers announce as "current page" for navigation; "true" is
               * technically valid but generic. Matches the tabs on the revenue and
               * errors pages.
               */
              aria-current={isActive ? 'page' : undefined}
              className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition-colors ${
                isActive
                  ? 'border-transparent bg-ink-900 text-white dark:bg-white dark:text-ink-900'
                  : /**
                     * Every hover colour needs BOTH themes.
                     *
                     * This line used to end `hover:bg-ink-100 dark:text-ink-300` with
                     * no dark hover at all — so in dark mode hovering painted a LIGHT
                     * background behind LIGHT text, and the pill went ghostly and
                     * unreadable at the exact moment you were about to click it.
                     *
                     * Dark mode moves UP the scale on hover (800 → 700) because the
                     * surface is dark; light mode moves DOWN (white → ink-100). Both
                     * also darken or brighten the text, so the pill feels like it
                     * responds rather than merely changing shade.
                     */
                    'border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:bg-ink-100 hover:text-ink-900 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300 dark:hover:border-ink-600 dark:hover:bg-ink-700 dark:hover:text-white'
              }`}
            >
              {f.label}
            </Link>
          )
        })}
      </div>

      <Card className="overflow-hidden p-0">
        {clinics.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-6" />}
            title="No clinics match"
            description="Try clearing the filters."
          />
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {clinics.map((clinic) => (
              <li key={clinic.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-bold">{clinic.name}</h2>
                      <Badge tone={STATUS_TONE[clinic.status] || 'neutral'}>
                        {clinic.status.replace('_', ' ')}
                      </Badge>
                      {clinic.plan_name && <Badge tone="brand">{clinic.plan_name}</Badge>}
                      {clinic.onboarding_step !== 'done' && (
                        <Badge tone="warning">setup: {clinic.onboarding_step}</Badge>
                      )}
                    </div>

                    <a
                      href={clinicUrl(clinic.slug)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-brand-700 hover:underline dark:text-brand-400"
                    >
                      {clinic.slug}
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>

                    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-500 dark:text-ink-400">
                      <div className="flex items-center gap-1.5">
                        <Users className="size-3.5" aria-hidden="true" />
                        <dt className="sr-only">Patients</dt>
                        <dd>{clinic.patient_count} patients</dd>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CalendarDays className="size-3.5" aria-hidden="true" />
                        <dt className="sr-only">Appointments</dt>
                        <dd>{clinic.appointment_count} appointments</dd>
                      </div>
                      <div>
                        <dt className="sr-only">Joined</dt>
                        <dd>joined {formatDateShort(clinic.created_at)}</dd>
                      </div>
                      {clinic.trial_ends_at && clinic.subscription_status === 'trialing' && (
                        <div>
                          <dt className="sr-only">Trial ends</dt>
                          <dd className="font-medium text-amber-600">
                            trial ends {formatDateShort(clinic.trial_ends_at)}
                          </dd>
                        </div>
                      )}
                      {/* Leaving. Red rather than amber, and it says WHY if they
                          told us — the reason is the actionable part, and it is the
                          difference between a call worth making and one that is not. */}
                      {clinic.cancelled_at && (
                        <div>
                          <dt className="sr-only">Cancelling</dt>
                          <dd className="font-bold text-red-600">
                            cancelling
                            {clinic.current_period_end
                              ? ` · ends ${formatDateShort(clinic.current_period_end)}`
                              : ''}
                            {clinic.cancel_reason ? ` · ${clinic.cancel_reason}` : ''}
                          </dd>
                        </div>
                      )}
                      {!clinic.razorpay_key_id && (
                        <dd className="font-medium text-amber-600">payments not connected</dd>
                      )}
                    </dl>

                    {clinic.owner_email && (
                      <p className="mt-2 text-xs text-ink-500">
                        {clinic.owner_name} ·{' '}
                        <a href={`mailto:${clinic.owner_email}`} className="underline">
                          {clinic.owner_email}
                        </a>
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    {clinic.subscription_status === 'active' && (
                      <p className="text-sm font-bold tabular-nums">
                        {formatMoney(Number(clinic.mrr_paise) || 0)}
                        <span className="text-xs font-normal text-ink-500">/mo</span>
                      </p>
                    )}
                    <div className="mt-2">
                      <ClinicActions
                        clinicId={clinic.id}
                        name={clinic.name}
                        status={clinic.status}
                        planCode={clinic.plan_code}
                        plans={plans.map((p) => ({ code: p.code, name: p.name }))}
                      />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
