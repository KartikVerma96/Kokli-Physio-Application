import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CreditCard, ShieldCheck, ExternalLink, TriangleAlert, CheckCircle2 } from 'lucide-react'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { maskSecret, isEncryptionConfigured } from '@/lib/crypto'
import { clinicUrl } from '@/config/platform'
import { Card, Badge } from '@/components/ui/Card'
import PaymentKeysForm from './PaymentKeysForm'

/**
 * ============================================================================
 *  PAYMENT SETTINGS  →  /admin/settings/payments
 * ============================================================================
 *  Where a clinic connects — or changes — its own Razorpay account.
 *
 *  This page existed as a LINK before it existed as a page: the trial banner in
 *  components/layout/ClinicStatusBanner.js has always pointed here, so a clinic
 *  that had not connected payments was being sent to a 404. Shipping a link to a
 *  page you have not built is a small thing that reads as a broken product.
 *
 *  It deliberately reuses `saveRazorpayKeys` from the onboarding wizard rather
 *  than reimplementing it. Two code paths writing payment credentials would be
 *  two places to get the encryption wrong.
 * ============================================================================
 */

export const metadata = { title: 'Payment settings', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function PaymentSettingsPage() {
  const clinic = await requireCurrentClinic()
  const session = await auth()

  // Payment credentials move money. Only the clinic's administrator may see or
  // change them — not the physiotherapist, who has no reason to.
  if (!['admin', 'platform'].includes(session?.user?.role)) redirect('/admin')

  const connected = Boolean(clinic.razorpay_key_id)
  const isTestMode = clinic.razorpay_key_id?.startsWith('rzp_test_')

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Payment settings</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Connect your own Razorpay account so patients pay you directly.
        </p>
      </div>

      {/* ------------------------------------------------- the money promise */}
      {/* Restated here rather than only on the marketing site. This is the page
          where a clinic hands over payment credentials, and it is exactly the
          moment they will wonder who ends up holding their money. */}
      <div className="flex items-start gap-3 rounded-2xl border border-brand-200 bg-brand-50/70 p-5 dark:border-brand-800 dark:bg-brand-950/30">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden="true" />
        <div className="text-sm leading-relaxed text-ink-700 dark:text-ink-300">
          <p className="font-bold text-ink-900 dark:text-ink-100">Your money never touches us</p>
          <p className="mt-1">
            Appointment fees go straight from your patient into your own Razorpay account and settle
            into your own bank. We take no commission on a single booking — your subscription is the
            only thing you pay us. Your secret key is encrypted before it is stored.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------ current state */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className={`grid size-11 shrink-0 place-items-center rounded-2xl ${
                connected
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
                  : 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400'
              }`}
            >
              {connected ? (
                <CheckCircle2 className="size-5" aria-hidden="true" />
              ) : (
                <CreditCard className="size-5" aria-hidden="true" />
              )}
            </span>
            <div>
              <h2 className="font-bold">
                {connected ? 'Razorpay is connected' : 'Payments are not connected yet'}
              </h2>
              <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
                {connected ? (
                  <>
                    Key <span className="font-mono">{maskSecret(clinic.razorpay_key_id, 6)}</span>
                  </>
                ) : (
                  'Until you connect an account, patients can browse and see your availability but cannot pay — so no booking can be confirmed.'
                )}
              </p>
            </div>
          </div>

          {connected && (
            <Badge tone={isTestMode ? 'warning' : 'success'} dot>
              {isTestMode ? 'Test mode' : 'Live'}
            </Badge>
          )}
        </div>

        {/* Test keys take no real money. A clinic that has quietly left test keys
            in place is losing every booking, so it is worth being blunt. */}
        {connected && isTestMode && (
          <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0 text-amber-600"
              aria-hidden="true"
            />
            <p className="text-amber-900 dark:text-amber-200">
              These are <strong>test</strong> keys. Bookings will appear to succeed but no real
              money is taken. Replace them with your live keys before accepting real patients.
            </p>
          </div>
        )}
      </Card>

      {/* ---------------------------------------------------- how to get keys */}
      <Card className="p-6">
        <h2 className="text-base font-bold">Where to find your keys</h2>
        <ol className="mt-4 space-y-3 text-sm text-ink-600 dark:text-ink-400">
          {[
            <>
              Sign in at{' '}
              <a
                href="https://dashboard.razorpay.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-brand-700 underline dark:text-brand-400"
              >
                dashboard.razorpay.com
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>{' '}
              (creating an account is free).
            </>,
            <>
              Go to <strong>Settings → API Keys</strong> and press{' '}
              <strong>Generate Key</strong>.
            </>,
            <>
              Copy the <strong>Key ID</strong> and <strong>Key Secret</strong>. The secret is shown
              only once — if you lose it you will need to generate a new pair.
            </>,
            <>
              Paste them below. To take real money, switch the dashboard out of Test Mode first and
              generate live keys.
            </>,
          ].map((step, index) => (
            <li key={index} className="flex gap-3">
              <span
                className="grid size-6 shrink-0 place-items-center rounded-lg bg-brand-600 text-xs font-bold text-[var(--color-brand-fg,#fff)]"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </Card>

      {/* --------------------------------------------------------- the form */}
      {isEncryptionConfigured() ? (
        <PaymentKeysForm connected={connected} currentKeyId={clinic.razorpay_key_id || ''} />
      ) : (
        // Refusing is correct. Storing someone else's payment secret in plain
        // text because the server is misconfigured would be far worse than
        // making them wait.
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-bold">Payment credentials cannot be stored right now</p>
              <p className="mt-1 text-ink-600 dark:text-ink-400">
                The platform is missing its encryption key, so we will not accept a secret we cannot
                protect. Please contact support — this is our problem, not yours.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ------------------------------------------------------ the webhook */}
      <Card className="p-6">
        <h2 className="text-base font-bold">Webhook (recommended)</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
          Without a webhook, a patient whose phone loses signal straight after paying can end up
          charged with no appointment. The webhook lets Razorpay tell us directly, server to server,
          so the booking is confirmed even if their browser never comes back.
        </p>
        <div className="mt-4 rounded-2xl bg-ink-50 p-4 text-sm dark:bg-ink-800/60">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-500">Webhook URL</p>
          <p className="mt-1 break-all font-mono text-xs">
            {clinicUrl(clinic.slug)}/api/payments/webhook
          </p>
          <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">
            In Razorpay: <strong>Settings → Webhooks → Add New Webhook</strong>. Subscribe to{' '}
            <code>payment.captured</code>, <code>payment.failed</code> and{' '}
            <code>refund.processed</code>, set a secret, and paste the same secret above.
          </p>
        </div>
      </Card>

      <p className="text-center text-sm text-ink-500">
        <Link href="/admin" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
          Back to dashboard
        </Link>
      </p>
    </div>
  )
}
