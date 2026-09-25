import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Bug, Globe, Server } from 'lucide-react'
import { recentErrors } from '@/lib/errorLog'
import { formatDateShort } from '@/lib/utils'
import { Card, Stat, Badge, EmptyState } from '@/components/ui/Card'
import ResolveButton from './ResolveButton'

/**
 * ============================================================================
 *  ERRORS  →  kokli.local/platform/errors
 * ============================================================================
 *  What is broken, how often, since when, and for which clinic.
 *
 *  WHY THE COUNT MATTERS MORE THAN THE LIST
 *  ----------------------------------------
 *  An error that happened once at 3am is probably a dropped connection. The same
 *  error 340 times is a page nobody can use, and the difference between those two
 *  is the only thing that tells you what to do this morning. So the occurrence
 *  count is the most prominent thing on each row, not the timestamp.
 *
 *  WHY "RESOLVED" IS A TICK AND NOT A DELETE
 *  -----------------------------------------
 *  Marking something resolved hides it. If it happens again, lib/errorLog.js clears
 *  the flag and it comes back to the top — visible as a REGRESSION rather than as
 *  something brand new. Deleting the row would lose that, and "we fixed this in
 *  March and it is back" is exactly the fact worth keeping.
 * ============================================================================
 */

export const metadata = { title: 'Errors', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function ErrorsPage({ searchParams }) {
  const params = await searchParams
  const showResolved = params?.show === 'all'

  const errors = await recentErrors({ includeResolved: showResolved, limit: 200 })

  const open = errors.filter((e) => !e.resolved_at)
  const totalHits = open.reduce((sum, e) => sum + Number(e.occurrences || 0), 0)
  const today = open.filter((e) => isToday(e.last_seen_at))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Errors</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Grouped by fault, newest activity first. You are emailed the first time each one appears.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <Stat
          label="Open faults"
          value={String(open.length)}
          hint={open.length === 0 ? 'nothing broken' : 'distinct problems'}
          icon={<Bug className="size-5" />}
          tone={open.length === 0 ? 'success' : 'danger'}
        />
        <Stat
          label="Total occurrences"
          value={totalHits.toLocaleString('en-IN')}
          hint="across all open faults"
          icon={<AlertTriangle className="size-5" />}
          tone="warning"
        />
        <Stat
          label="Active today"
          value={String(today.length)}
          hint="seen in the last 24 hours"
          icon={<Server className="size-5" />}
          tone={today.length === 0 ? 'success' : 'danger'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/platform/errors"
          aria-current={!showResolved ? 'page' : undefined}
          className={tab(!showResolved)}
        >
          Open
        </Link>
        <Link
          href="/platform/errors?show=all"
          aria-current={showResolved ? 'page' : undefined}
          className={tab(showResolved)}
        >
          Including resolved
        </Link>
      </div>

      {errors.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 className="size-6" />}
            title="Nothing has failed"
            description={
              showResolved
                ? 'No errors have ever been recorded.'
                : 'No open faults. Anything resolved is hidden — switch tabs to see it.'
            }
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {errors.map((fault) => (
            <li key={fault.id}>
              <Card className={`p-4 ${fault.resolved_at ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-xl ${
                      fault.resolved_at
                        ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40'
                        : 'bg-red-50 text-red-600 dark:bg-red-950/40'
                    }`}
                  >
                    {fault.source === 'browser' ? (
                      <Globe className="size-4" aria-hidden="true" />
                    ) : (
                      <Server className="size-4" aria-hidden="true" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold">{fault.message}</p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500 dark:text-ink-400">
                      {/* The count first, because it is what decides whether this
                          matters today. */}
                      <Badge tone={Number(fault.occurrences) > 10 ? 'danger' : 'neutral'}>
                        {Number(fault.occurrences).toLocaleString('en-IN')}×
                      </Badge>
                      {fault.route && <span className="font-mono">{fault.route}</span>}
                      {fault.clinic_slug && (
                        <Link
                          href={`/platform/clinics?q=${fault.clinic_slug}`}
                          className="font-semibold underline underline-offset-2"
                        >
                          {fault.clinic_name}
                        </Link>
                      )}
                      <span>first {formatDateShort(fault.first_seen_at)}</span>
                      <span>last {formatDateShort(fault.last_seen_at)}</span>
                      {fault.resolved_at && <Badge tone="success">resolved</Badge>}
                    </div>

                    {fault.stack && (
                      /* Collapsed by default. A stack trace is essential when you
                         need it and pure noise when scanning a list of twelve. */
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-semibold text-ink-500 hover:text-ink-800 dark:hover:text-ink-100">
                          Stack trace
                        </summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-ink-900 p-3 text-[11px] leading-relaxed text-red-300">
                          {fault.stack}
                        </pre>
                      </details>
                    )}
                  </div>

                  {!fault.resolved_at && <ResolveButton id={fault.id} />}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-ink-500 dark:text-ink-400">
        Resolved faults are deleted after a fortnight. Open ones are never deleted, however old — a
        fault that has been failing quietly for three months is the most important row here, not the
        least.
      </p>
    </div>
  )
}

function tab(active) {
  return `rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
    active
      ? 'bg-ink-900 text-white dark:bg-white dark:text-ink-900'
      : 'text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800'
  }`
}

function isToday(value) {
  if (!value) return false
  return Date.now() - new Date(value).getTime() < 24 * 60 * 60 * 1000
}
