import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MessageCircle, Info, TriangleAlert, UserCheck, Smartphone } from 'lucide-react'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { whatsappAllowance, isWhatsAppConfigured, usesOwnNumber } from '@/lib/whatsapp'
import { query } from '@/lib/db'
import { Card, Stat, Badge } from '@/components/ui/Card'
import WhatsAppSettings from './WhatsAppSettings'
import ConnectNumber from './ConnectNumber'

/**
 * ============================================================================
 *  WHATSAPP  →  /admin/settings/whatsapp
 * ============================================================================
 *  Which messages go out, and how the allowance is being used.
 *
 *  The recent-messages list at the bottom exists because the first question a
 *  clinic asks is never "is it configured" — it is "did my patient actually get
 *  it". Skipped messages are shown with their reason for the same purpose: "no
 *  consent" and "no phone number" are both things reception can fix in a minute,
 *  and neither is visible anywhere else.
 * ============================================================================
 */

export const metadata = { title: 'WhatsApp', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function WhatsAppPage() {
  const clinic = await requireCurrentClinic()
  const session = await auth()
  if (!['admin', 'platform'].includes(session?.user?.role)) redirect('/admin')

  const allowance = await whatsappAllowance(clinic)
  const own = usesOwnNumber(clinic)

  // What the plan would allow if they went back to our number — the number the
  // disconnect warning has to quote.
  const planQuota = await query(
    `SELECT p.whatsapp_monthly_quota AS quota
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.clinic_id = ? AND s.status IN ('trialing', 'active', 'past_due')
      ORDER BY s.id DESC LIMIT 1`,
    [clinic.id]
  )

  const recent = await query(
    `SELECT m.template, m.category, m.status, m.reason, m.to_number, m.created_at,
            u.name AS patient_name
       FROM whatsapp_messages m
       LEFT JOIN users u ON u.id = m.patient_id
      WHERE m.clinic_id = ?
      ORDER BY m.id DESC
      LIMIT 25`,
    [clinic.id]
  )

  const consented = await query(
    `SELECT COUNT(*) AS n FROM patient_profiles pr
       JOIN users u ON u.id = pr.user_id
      WHERE u.clinic_id = ? AND pr.whatsapp_marketing_opt_in_at IS NOT NULL
        AND pr.whatsapp_opted_out_at IS NULL`,
    [clinic.id]
  )
  const patients = await query(
    "SELECT COUNT(*) AS n FROM users WHERE clinic_id = ? AND role = 'patient'",
    [clinic.id]
  )

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">WhatsApp</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Where your patients actually read their messages.
        </p>
      </div>

      {!allowance.enabled && (
        <Card className="flex items-start gap-3 border-amber-300 p-5 text-sm dark:border-amber-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <p className="font-bold text-amber-900 dark:text-amber-100">
              Your plan does not include WhatsApp
            </p>
            <p className="mt-1 text-amber-800 dark:text-amber-200">
              Appointment reminders typically halve no-shows. For most clinics that is worth several
              times the difference in price.{' '}
              <Link href="/admin/billing" className="font-semibold underline">
                See the plans
              </Link>
              .
            </p>
          </div>
        </Card>
      )}

      {allowance.enabled && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          <Stat
            label="Sent this month"
            value={allowance.used}
            hint={own ? 'no limit — your own number' : `of ${allowance.quota} included`}
            icon={<MessageCircle className="size-5" />}
            tone={!own && allowance.left < 50 ? 'warning' : 'brand'}
          />
          <Stat
            label="Can be marketed to"
            value={`${consented[0].n} of ${patients[0].n}`}
            hint="patients who agreed"
            icon={<UserCheck className="size-5" />}
            tone="info"
          />
          <Stat
            label="Sending from"
            value={own ? 'Your number' : 'Our number'}
            icon={<Smartphone className="size-5" />}
            hint={
              isWhatsAppConfigured(clinic)
                ? own
                  ? 'billed to you by Meta'
                  : 'included in your plan'
                : 'preview — printed, not sent'
            }
            tone={own ? 'success' : 'neutral'}
          />
        </div>
      )}

      {allowance.enabled && allowance.ownNumberAllowed && (
        <ConnectNumber
          connected={own}
          phoneNumberId={clinic.wa_phone_number_id}
          planQuota={Number(planQuota[0]?.quota) || 0}
        />
      )}

      {/* Plan includes WhatsApp, but not on their own number. */}
      {allowance.enabled && !allowance.ownNumberAllowed && (
        <Card className="flex items-start gap-3 border-brand-200 p-5 text-sm dark:border-brand-900">
          <Info className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
          <div>
            <p className="font-bold">Want to send from your own WhatsApp number?</p>
            <p className="mt-1 text-ink-600 dark:text-ink-400">
              Your plan includes {allowance.quota} messages a month from our number, and sending
              stops when they run out. On the top plan you can connect your own number instead and
              send as many as you like — Meta bills you directly, so there is no monthly limit at
              all.{' '}
              <Link href="/admin/billing" className="font-semibold underline">
                Compare the plans
              </Link>
              .
            </p>
          </div>
        </Card>
      )}

      {!isWhatsAppConfigured(clinic) && (
        <Card className="flex items-start gap-3 p-5 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
          <p className="text-ink-600 dark:text-ink-400">
            WhatsApp is not connected yet, so messages are written to the server log instead of
            being sent. Everything else works exactly as it will when it goes live — which is
            deliberate, so the clinic can see what patients will receive before anything reaches
            them.
          </p>
        </Card>
      )}

      <WhatsAppSettings
        settings={{
          sendReminders: Boolean(clinic.wa_send_reminders),
          sendExercises: Boolean(clinic.wa_send_exercises),
          sendPackageNudge: Boolean(clinic.wa_send_package_nudge),
          sendReviewRequest: Boolean(clinic.wa_send_review_request),
          reminderHours: Number(clinic.wa_reminder_hours) || 24,
        }}
        hasReviewLink={Boolean(clinic.maps_url)}
        enabled={allowance.enabled}
      />

      {/* ------------------------------------------------- what actually happened */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-ink-100 p-5 dark:border-ink-800">
          <h2 className="font-bold">Recent messages</h2>
          <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
            Including the ones that were not sent, and why — most of those are fixable.
          </p>
        </div>

        {recent.length === 0 ? (
          <p className="p-5 text-sm text-ink-500">Nothing sent yet.</p>
        ) : (
          <ul className="divide-y divide-ink-100 text-sm dark:divide-ink-800">
            {recent.map((m, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {m.patient_name || m.to_number}
                  </span>
                  <span className="block truncate text-xs text-ink-500 dark:text-ink-400">
                    {m.template.replace(/_/g, ' ')}
                    {m.reason ? ` · ${m.reason}` : ''}
                  </span>
                </span>
                {m.category === 'marketing' && <Badge tone="neutral">marketing</Badge>}
                <Badge
                  tone={
                    ['sent', 'delivered', 'read'].includes(m.status)
                      ? 'success'
                      : m.status === 'failed'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {m.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
