import { Shield, HeartPulse } from 'lucide-react'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import { getProfile } from '@/lib/queries'
import { passwordState } from '@/lib/passwordReset'
import { ageFrom, formatDateShort } from '@/lib/utils'
import { Card, Badge } from '@/components/ui/Card'
import PasswordCard from '@/components/account/PasswordCard'
import DataExportCard from '@/components/account/DataExportCard'
import ProfileForm from './ProfileForm'

/**
 * ============================================================================
 *  PROFILE & MEDICAL HISTORY  →  /dashboard/profile
 * ============================================================================
 *  Server Component: it loads the current values and hands them to the form.
 *
 *  WHY A PHYSIOTHERAPIST GENUINELY NEEDS THESE FIELDS
 *  -------------------------------------------------
 *  This is not a generic sign-up form padded out with optional questions. Every
 *  field below changes what a physiotherapist does:
 *
 *    Occupation   Neck pain in a software engineer and neck pain in a mason are
 *                 different problems with different fixes. It is often the single
 *                 most useful thing on the form.
 *
 *    Height/weight  Load through a knee or hip in rehab is calculated from body
 *                 mass. It also affects safe progression rates after surgery.
 *
 *    Medical history  Diabetes roughly doubles frozen shoulder recovery time and
 *                 changes what is realistic to promise. Osteoporosis rules out
 *                 spinal manipulation entirely. Cardiac conditions cap exercise
 *                 intensity. Getting this wrong can genuinely hurt someone.
 *
 *    Medications  Blood thinners make dry needling and deep tissue work risky.
 *                 Painkillers mask the feedback we rely on to judge intensity.
 *
 *    Emergency contact  An older patient exercising to fatigue in a clinic. It
 *                 has to be on file before it is needed.
 *
 *  Explaining the "why" next to each group is deliberate: people give better
 *  answers to questions whose purpose they understand.
 * ============================================================================
 */

export const metadata = { title: 'Profile & medical history' }
export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const clinic = await requireCurrentClinic()
  const session = await auth()
  const profile = await getProfile(clinic.id, session.user.id)
  const security = await passwordState(session.user.id)

  const age = ageFrom(profile?.date_of_birth)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Profile & medical history</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Kept private between you and your physiotherapist, and used to make your treatment safer.
        </p>
      </div>

      {/* --------------------------------------------------- account summary */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-ink-500">
              Signed in as
            </p>
            <p className="mt-1 font-semibold">{profile?.email}</p>
            <p className="mt-0.5 text-xs text-ink-500">
              {age ? `${age} years old · ` : ''}Patient since{' '}
              {new Date(profile.created_at).toLocaleDateString('en-IN', {
                month: 'long',
                year: 'numeric',
              })}
            </p>
          </div>

          {/* Google accounts have no password with us, so it is worth saying so —
              otherwise a patient goes looking for a "change password" option that
              cannot exist. */}
          {profile?.google_id ? (
            <Badge tone="info">Google account</Badge>
          ) : (
            <Badge tone="neutral">Email & password</Badge>
          )}
        </div>
      </Card>

      {/* ---------------------------------------------------- privacy notice */}
      <div className="flex items-start gap-3 rounded-2xl border border-ink-200 p-5 dark:border-ink-700">
        <Shield className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden="true" />
        <div className="text-sm leading-relaxed text-ink-600 dark:text-ink-400">
          <p className="font-bold text-ink-900 dark:text-ink-100">Who can see this</p>
          <p className="mt-1">
            Only you and the clinic’s physiotherapist. It is never shared with anyone else, never
            used for marketing, and never sold. You can clear any field at any time — though please
            keep the medical history accurate, because treatment decisions are made from it.
          </p>
        </div>
      </div>

      <ProfileForm profile={profile} />

      {/* -------------------------------------------------- account security */}
      {/* Below the medical history rather than above it, because that is what the
          patient came here for. But on this page rather than a separate one: a
          patient will never go looking for "account settings". */}
      <PasswordCard
        hasPassword={security.hasPassword}
        changedAt={security.changedAt ? formatDateShort(security.changedAt) : null}
      />

      <DataExportCard />

      {/* ------------------------------------------------------ safety note */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/30">
        <HeartPulse className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
          <p className="font-bold">Please do tell us about these</p>
          <p className="mt-1">
            Diabetes, osteoporosis, heart conditions, pregnancy, blood-thinning medication, cancer
            treatment, or a pacemaker. Each of these genuinely changes what is safe — osteoporosis
            rules out spinal manipulation, blood thinners rule out dry needling, and a pacemaker
            rules out some electrotherapy. Leaving them out does not protect you.
          </p>
        </div>
      </div>
    </div>
  )
}
