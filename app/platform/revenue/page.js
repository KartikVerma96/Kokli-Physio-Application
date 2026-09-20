import Link from 'next/link'
import { IndianRupee, TrendingUp, Clock, AlertCircle, Receipt } from 'lucide-react'
import { getPlatformInvoices } from '@/lib/queries'
import { platform } from '@/config/platform'
import { formatMoney, formatDateShort } from '@/lib/utils'
import { Card, Stat, Badge, EmptyState } from '@/components/ui/Card'

/**
 * ============================================================================
 *  REVENUE  →  kokli.local/platform/revenue
 * ============================================================================
 *  Every rupee the platform has ever invoiced, newest first.
 *
 *  WHY A LEDGER AND NOT JUST A TOTAL
 *  ---------------------------------
 *  The overview page shows MRR, which answers "how big is the business". This
 *  page answers the two questions that actually cost you money if you cannot:
 *
 *    1. Which charges FAILED?  A failed renewal is a customer who is still using
 *       the product and no longer paying for it. Every day it goes unnoticed is
 *       a day of free service, and — worse — a customer who will be angrier the
 *       later you contact them.
 *
 *    2. What did we charge THIS clinic, and when?  Sooner or later somebody
 *       disputes an invoice, and "I think it was around ₹1,299" is not an answer.
 *
 *  GST is displayed separately from the subscription amount throughout. It is
 *  not your revenue — it is tax you collected on the government's behalf and
 *  will hand over. Folding it into a revenue figure overstates the business by
 *  18% and makes the quarterly filing a reconciliation nightmare.
 * ============================================================================
 */

export const metadata = { title: 'Revenue', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'paid', label: 'Paid' },
  { key: 'pending', label: 'Pending' },
  { key: 'failed', label: 'Failed' },
  { key: 'refunded', label: 'Refunded' },
]

const STATUS_TONE = {
  paid: 'success',
  pending: 'warning',
  failed: 'danger',
  refunded: 'neutral',
}

export default async function RevenuePage({ searchParams }) {
  const params = await searchParams
  const status = STATUS_TABS.some((tab) => tab.key === params?.status) ? params.status : ''

  // The filter applies to the TABLE. The totals below are deliberately computed
  // from every invoice, so switching to "Failed" does not make the headline
  // figures change under you — a filter that silently rewrites the summary is
  // how people misread their own numbers.
  const [invoices, all] = await Promise.all([
    getPlatformInvoices({ status: status || undefined, limit: 300 }),
    getPlatformInvoices({ limit: 1000 }),
  ])

  const paid = all.filter((i) => i.status === 'paid')
  const collected = sum(paid, 'amount_paise')
  const taxCollected = sum(paid, 'tax_paise')
  const pending = sum(all.filter((i) => i.status === 'pending'), 'amount_paise')
  const failed = all.filter((i) => i.status === 'failed')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Revenue</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Every subscription invoice raised by {platform.name}.
        </p>
      </div>

      {/* ------------------------------------------------- failures first */}
      {/* Put at the top, above the pleasant numbers, because this is the only
          part of the page that needs someone to DO something today. */}
      {failed.length > 0 && (
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-bold text-red-900 dark:text-red-100">
              {failed.length} failed charge{failed.length === 1 ? '' : 's'} worth{' '}
              {formatMoney(sum(failed, 'amount_paise'))}
            </p>
            <p className="mt-0.5 text-red-800 dark:text-red-200">
              These clinics are still using the product. Razorpay retries automatically, but a card
              that has expired will never recover on its own — somebody has to ask them for a new one.
            </p>
            <ul className="mt-3 space-y-1.5">
              {failed.slice(0, 5).map((invoice) => (
                <li key={invoice.id} className="flex flex-wrap items-center gap-x-3 text-xs">
                  <Link
                    href={`/platform/clinics?q=${invoice.clinic_slug}`}
                    className="font-semibold underline underline-offset-2"
                  >
                    {invoice.clinic_name}
                  </Link>
                  <span className="text-red-700 dark:text-red-300">
                    {formatMoney(invoice.amount_paise)} · {formatDateShort(invoice.created_at)}
                  </span>
                  {invoice.failure_reason && (
                    <span className="text-red-600 dark:text-red-400">{invoice.failure_reason}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- totals */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Collected all time"
          value={formatMoney(collected)}
          hint={`across ${paid.length} paid invoice${paid.length === 1 ? '' : 's'}`}
          icon={<IndianRupee className="size-5" />}
          tone="success"
        />
        <Stat
          label="This month"
          value={formatMoney(sum(paid.filter(inThisMonth), 'amount_paise'))}
          hint={`${paid.filter(inThisMonth).length} invoice${paid.filter(inThisMonth).length === 1 ? '' : 's'}`}
          icon={<TrendingUp className="size-5" />}
          tone="brand"
        />
        <Stat
          label="Awaiting payment"
          value={formatMoney(pending)}
          hint="raised but not yet settled"
          icon={<Clock className="size-5" />}
          tone="warning"
        />
        <Stat
          label={`GST collected (${platform.gstPercent}%)`}
          value={formatMoney(taxCollected)}
          hint="owed to the government, not revenue"
          icon={<Receipt className="size-5" />}
          tone="info"
        />
      </div>

      {/* ------------------------------------------------------ the ledger */}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-4 dark:border-ink-800">
          {STATUS_TABS.map((tab) => {
            const active = tab.key === status
            return (
              <Link
                key={tab.key || 'all'}
                href={tab.key ? `/platform/revenue?status=${tab.key}` : '/platform/revenue'}
                aria-current={active ? 'page' : undefined}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                  active
                    ? 'bg-ink-900 text-white dark:bg-white dark:text-ink-900'
                    : 'text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800'
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>

        {invoices.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-6" />}
            title={status ? `No ${status} invoices` : 'No invoices yet'}
            description={
              status
                ? 'Nothing in this state right now.'
                : 'Invoices appear here the moment a clinic’s first subscription payment succeeds.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50/60 text-xs uppercase tracking-wider text-ink-500 dark:border-ink-800 dark:bg-ink-800/40">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-bold">Invoice</th>
                  <th scope="col" className="px-4 py-3 text-left font-bold">Clinic</th>
                  <th scope="col" className="px-4 py-3 text-left font-bold">Period</th>
                  <th scope="col" className="px-4 py-3 text-right font-bold">Subscription</th>
                  <th scope="col" className="px-4 py-3 text-right font-bold">GST</th>
                  <th scope="col" className="px-4 py-3 text-right font-bold">Total</th>
                  <th scope="col" className="px-4 py-3 text-left font-bold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-ink-50/60 dark:hover:bg-ink-800/40">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-semibold">{invoice.number}</span>
                      <span className="block text-[11px] text-ink-400">
                        {formatDateShort(invoice.created_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/platform/clinics?q=${invoice.clinic_slug}`}
                        className="font-semibold hover:underline"
                      >
                        {invoice.clinic_name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-500">
                      {invoice.period_start
                        ? `${formatDateShort(invoice.period_start)} – ${formatDateShort(invoice.period_end)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(invoice.amount_paise)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-500">
                      {formatMoney(invoice.tax_paise)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums">
                      {formatMoney(Number(invoice.amount_paise) + Number(invoice.tax_paise))}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[invoice.status] || 'neutral'}>{invoice.status}</Badge>
                      {invoice.paid_at && (
                        <span className="mt-0.5 block text-[11px] text-ink-400">
                          {formatDateShort(invoice.paid_at)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-ink-500 dark:text-ink-400">
        Showing the most recent {invoices.length} invoice{invoices.length === 1 ? '' : 's'}. Amounts
        exclude GST except in the Total column.
      </p>
    </div>
  )
}

/** Sums a paise column. Every amount is an integer, so no floating-point drift. */
function sum(rows, column) {
  return rows.reduce((total, row) => total + (Number(row[column]) || 0), 0)
}

/** Paid within the current calendar month. */
function inThisMonth(invoice) {
  const when = new Date(invoice.paid_at || invoice.created_at)
  const now = new Date()
  return when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth()
}
