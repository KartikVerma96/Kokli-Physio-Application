import Link from 'next/link'
import { redirect } from 'next/navigation'
import { IndianRupee, TrendingUp, RotateCcw, XCircle, Info } from 'lucide-react'
import { auth } from '@/lib/auth'
import { getPayments, getAdminStats } from '@/lib/queries'
import { isDemoMode, isPaymentConfigured } from '@/lib/razorpay'
import { formatMoney, formatDateShort, formatDateLong } from '@/lib/utils'
import { Card, Stat, Badge, EmptyState } from '@/components/ui/Card'
import { requireCurrentClinic } from '@/lib/tenant'

/**
 * ============================================================================
 *  PAYMENTS  →  /admin/payments
 * ============================================================================
 *  The money trail. ADMIN ONLY — the physiotherapist sees the diary and the
 *  clinical records; revenue belongs to whoever runs the business.
 *
 *  Failed attempts are shown alongside successful ones on purpose. A run of
 *  failures against the same appointment usually means a patient is struggling to
 *  pay and may need a phone call — and it is the first place to look when somebody
 *  says "I was charged but have no appointment".
 * ============================================================================
 */

export const dynamic = 'force-dynamic'

const STATUS_TONES = {
  paid: 'success',
  created: 'warning',
  failed: 'danger',
  refunded: 'info',
}

export default async function AdminPaymentsPage({ searchParams }) {
  const clinic = await requireCurrentClinic()
  const session = await auth()

  // The one page in the admin area that a physio account cannot see. Revenue is a
  // business matter, not a clinical one.
  if (session.user.role !== 'admin') redirect('/admin')

  const params = await searchParams
  const status = typeof params?.status === 'string' ? params.status : ''

  const [payments, stats] = await Promise.all([getPayments(clinic.id, { status }), getAdminStats(clinic.id)])

  const refunded = payments
    .filter((p) => p.status === 'refunded')
    .reduce((sum, p) => sum + Number(p.refunded_paise || 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Payments</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          {payments.length} transactions{status && ` · ${status}`}
        </p>
      </div>

      {/* A prominent notice when payments are simulated. Somebody looking at a
          revenue figure needs to know whether it is real money. */}
      {isDemoMode(clinic) && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/30">
          <Info className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
            <p className="font-bold">Demo payment mode — no real money is moving</p>
            <p className="mt-1">
              No Razorpay keys are configured, so the payment step is simulated and every booking
              confirms instantly. That is what makes the whole flow, including video consultations,
              testable straight away.
            </p>
            <p className="mt-2">
              To take real payments, connect your own Razorpay account in{' '}
              <Link href="/admin/settings/payments" className="font-semibold underline underline-offset-2">
                Settings → Payment keys
              </Link>
              . Test keys are free and take about three minutes. Patients&rsquo; money then goes
              straight into your bank account — it never passes through us.
            </p>
          </div>
        </div>
      )}

      {isPaymentConfigured(clinic) && !clinic.razorpay_webhook_secret_enc && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/30">
          <Info className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
            <p className="font-bold">No webhook secret configured</p>
            <p className="mt-1">
              Without a webhook, a patient whose phone loses signal after paying ends up charged with
              no confirmed appointment. Create the webhook in your Razorpay dashboard and paste the
              same secret into{' '}
              <Link href="/admin/settings/payments" className="font-semibold underline underline-offset-2">
                Settings → Payment keys
              </Link>{' '}
              before taking real bookings.
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat
          label="This month"
          value={formatMoney(Number(stats.revenue.month_paise) || 0)}
          hint="net of refunds"
          icon={<IndianRupee className="size-5" />}
          tone="success"
        />
        <Stat
          label="Today"
          value={formatMoney(Number(stats.revenue.today_paise) || 0)}
          icon={<TrendingUp className="size-5" />}
          tone="brand"
        />
        <Stat
          label="All time"
          value={formatMoney(Number(stats.revenue.total_paise) || 0)}
          hint={`${stats.revenue.paid_count} transactions`}
          icon={<IndianRupee className="size-5" />}
          tone="info"
        />
        <Stat
          label="Refunded"
          value={formatMoney(refunded)}
          hint="in the visible list"
          icon={<RotateCcw className="size-5" />}
          tone="warning"
        />
      </div>

      {/* ----------------------------------------------------------- filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-ink-400">Status</span>
        {[
          { value: '', label: 'All' },
          { value: 'paid', label: 'Paid' },
          { value: 'refunded', label: 'Refunded' },
          { value: 'failed', label: 'Failed' },
          { value: 'created', label: 'Not completed' },
        ].map((filter) => (
          <Link
            key={filter.value}
            href={filter.value ? `/admin/payments?status=${filter.value}` : '/admin/payments'}
            aria-current={status === filter.value ? 'true' : undefined}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${
              status === filter.value
                ? 'bg-brand-600 text-[var(--color-brand-fg,#fff)] shadow-sm'
                : 'bg-white text-ink-600 hover:bg-brand-50 hover:text-brand-700 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-brand-500/15 dark:hover:text-brand-200'
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </div>

      {/* ------------------------------------------------------------ table */}
      <Card className="overflow-hidden p-0">
        {payments.length === 0 ? (
          <EmptyState
            icon={<IndianRupee className="size-6" />}
            title="No transactions"
            description="Payments appear here as soon as patients start booking."
          />
        ) : (
          <>
          {/* PHONES: a card per payment — amount and status first, because
              "did it go through?" is the question a patient rings with. */}
          <ul className="divide-y divide-ink-100 md:hidden dark:divide-ink-800">
            {payments.map((payment) => (
              <li key={payment.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{payment.patient_name}</p>
                    <p className="truncate text-xs text-ink-500">
                      {payment.service_name} · <span className="font-mono">{payment.appointment_code}</span>
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums">{formatMoney(payment.amount_paise)}</p>
                    {Number(payment.refunded_paise) > 0 && (
                      <p className="text-xs text-sky-600">−{formatMoney(payment.refunded_paise)}</p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                  <Badge tone={STATUS_TONES[payment.status] || 'neutral'}>
                    {payment.status === 'created' ? 'not completed' : payment.status}
                  </Badge>
                  <span>
                    {formatDateShort(payment.created_at)},{' '}
                    {new Date(payment.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {payment.method && <span className="uppercase">{payment.method}</span>}
                </div>
                {payment.error_description && (
                  <p className="mt-1.5 text-[11px] text-red-600">{payment.error_description}</p>
                )}
                {(payment.razorpay_payment_id || payment.razorpay_order_id) && (
                  <p className="mt-1 break-all font-mono text-[10px] text-ink-400">
                    {payment.razorpay_payment_id || payment.razorpay_order_id}
                  </p>
                )}
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[54rem] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50/60 text-left dark:border-ink-800 dark:bg-ink-800/40">
                <tr>
                  <Th>Date</Th>
                  <Th>Patient</Th>
                  <Th>Appointment</Th>
                  <Th>Method</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Reference</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {payments.map((payment) => (
                  <tr
                    key={payment.id}
                    className="transition-colors hover:bg-brand-50/60 dark:hover:bg-brand-500/5"
                  >
                    <Td>
                      <p className="whitespace-nowrap font-medium">{formatDateShort(payment.created_at)}</p>
                      <p className="whitespace-nowrap text-xs text-ink-500">
                        {new Date(payment.created_at).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </Td>

                    <Td>
                      <p className="font-medium">{payment.patient_name}</p>
                      <p className="truncate text-xs text-ink-500">{payment.patient_email}</p>
                    </Td>

                    <Td>
                      <p className="truncate">{payment.service_name}</p>
                      <p className="text-xs text-ink-500">
                        {formatDateShort(payment.appointment_date)} ·{' '}
                        <span className="font-mono">{payment.appointment_code}</span>
                      </p>
                    </Td>

                    <Td className="text-xs uppercase">{payment.method || '—'}</Td>

                    <Td>
                      <Badge tone={STATUS_TONES[payment.status] || 'neutral'}>
                        {payment.status === 'created' ? 'not completed' : payment.status}
                      </Badge>
                      {payment.error_description && (
                        // The reason a card was declined is genuinely useful when a
                        // patient rings to ask why their payment failed.
                        <p className="mt-1 max-w-[14rem] truncate text-[11px] text-red-600" title={payment.error_description}>
                          {payment.error_description}
                        </p>
                      )}
                    </Td>

                    <Td className="text-right">
                      <p className="font-semibold tabular-nums">
                        {formatMoney(payment.amount_paise)}
                      </p>
                      {Number(payment.refunded_paise) > 0 && (
                        <p className="text-xs text-sky-600">
                          −{formatMoney(payment.refunded_paise)} refunded
                        </p>
                      )}
                    </Td>

                    <Td>
                      <p className="break-all font-mono text-[10px] text-ink-400">
                        {payment.razorpay_payment_id || payment.razorpay_order_id || '—'}
                      </p>
                      {payment.refunded_at && (
                        <p className="mt-0.5 text-[10px] text-ink-400">
                          Refunded {formatDateShort(payment.refunded_at)}
                        </p>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      <p className="text-xs leading-relaxed text-ink-400">
        Refunds are issued when an appointment is cancelled — automatically for a patient cancelling
        inside the free window, and always when the clinic cancels. They usually reach the patient’s
        account in 5–7 working days. Razorpay’s own dashboard is the authoritative record for
        accounting and reconciliation.
      </p>
    </div>
  )
}

function Th({ children, className = '' }) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-xs font-bold uppercase tracking-wider text-ink-500 ${className}`}
    >
      {children}
    </th>
  )
}

function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>
}
