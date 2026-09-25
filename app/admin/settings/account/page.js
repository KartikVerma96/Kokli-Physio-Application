import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { passwordState } from '@/lib/passwordReset'
import { formatDateShort } from '@/lib/utils'
import { query } from '@/lib/db'
import { Card } from '@/components/ui/Card'
import PasswordCard from '@/components/account/PasswordCard'

/**
 * ============================================================================
 *  YOUR ACCOUNT  →  /admin/settings/account
 * ============================================================================
 *  For clinic staff — the owner and every physiotherapist.
 *
 *  WHY THIS PAGE HAD TO EXIST
 *  --------------------------
 *  The team page hands an owner a "temporary password" box with the hint "share it
 *  with them and ask them to change it". There was nothing to change it with. Every
 *  physiotherapist in the product was permanently using a password their boss had
 *  typed and sent over WhatsApp.
 * ============================================================================
 */

export const metadata = { title: 'Your account', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function AccountPage() {
  const clinic = await requireCurrentClinic()
  const session = await auth()
  const security = await passwordState(session.user.id)

  const [me] = await query(
    `SELECT name, email, phone, phone_verified, role, last_login_at
       FROM users WHERE id = ? AND clinic_id = ?`,
    [session.user.id, clinic.id]
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Your account</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          How you sign in to {clinic.name}.
        </p>
      </div>

      <Card className="p-5">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Row label="Name" value={me?.name} />
          <Row label="Email" value={me?.email} />
          <Row
            label="Mobile"
            value={me?.phone || 'Not on file'}
            hint={
              me?.phone
                ? me.phone_verified
                  ? 'Verified — you can sign in with a WhatsApp code'
                  : 'Not yet verified. Sign in once with a WhatsApp code to confirm it.'
                : 'Ask your clinic owner to add it, so you can sign in without a password'
            }
          />
          {/* Capitalised here, not with CSS on every row — `capitalize` on the row
              also turned an email address into "Uiview@Example.Com". */}
          <Row label="Role" value={me?.role && me.role[0].toUpperCase() + me.role.slice(1)} />
        </dl>
      </Card>

      <PasswordCard
        hasPassword={security.hasPassword}
        changedAt={security.changedAt ? formatDateShort(security.changedAt) : null}
      />
    </div>
  )
}

function Row({ label, value, hint }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-ink-500">{label}</dt>
      <dd className="mt-0.5 break-words font-semibold">{value || '—'}</dd>
      {hint && <p className="mt-0.5 text-xs text-ink-400">{hint}</p>}
    </div>
  )
}
