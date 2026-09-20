import { redirect } from 'next/navigation'
import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import { getAllServices, getAvailabilityRules } from '@/lib/queries'
import { getDefaultPhysioId } from '@/lib/slots'
import { auth } from '@/lib/auth'
import { clinicUrl } from '@/config/platform'
import OnboardingWizard from './OnboardingWizard'

/**
 * ============================================================================
 *  ONBOARDING  →  yourclinic.kokli.local/admin/onboarding
 * ============================================================================
 *  The four steps between "I just signed up" and "patients can book me".
 *
 *  WHY THE PROGRESS LIVES IN THE DATABASE
 *  --------------------------------------
 *  `clinics.onboarding_step` records how far they got, so closing the laptop
 *  halfway through and coming back tomorrow resumes rather than restarts.
 *  Keeping it in React state would lose it on the first refresh — and this form
 *  is long enough that people genuinely do walk away from it.
 *
 *  Nothing here is mandatory. Every step can be revisited from Admin → Settings
 *  afterwards, and the whole wizard can be skipped. A setup flow that traps
 *  someone until they fill in their postcode is a setup flow they abandon.
 * ============================================================================
 */

export const metadata = { title: 'Set up your clinic', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function OnboardingPage({ searchParams }) {
  const params = await searchParams
  const clinic = await requireCurrentClinic()
  const session = await auth()

  // Only the clinic's own administrator sets it up. The admin layout has already
  // checked the session belongs here; this narrows it to the right role.
  if (session?.user?.role !== 'admin' && session?.user?.role !== 'platform') {
    redirect('/admin')
  }

  const physioId = await getDefaultPhysioId(clinic.id)
  const [services, rules] = await Promise.all([
    getAllServices(clinic.id),
    physioId ? getAvailabilityRules(clinic.id, physioId) : [],
  ])

  // ?step=2 lets someone jump back to a finished step from the summary.
  const requested = Number(params?.step)
  const stepFromDb =
    { details: 1, services: 2, availability: 3, payments: 4, done: 5 }[clinic.onboarding_step] ?? 1
  const initialStep = Number.isFinite(requested) && requested >= 1 && requested <= 5
    ? requested
    : stepFromDb

  return (
    <OnboardingWizard
      initialStep={initialStep}
      site={clinicView(clinic)}
      clinicUrl={clinicUrl(clinic.slug)}
      services={services.map((s) => ({
        id: s.id,
        name: s.name,
        priceRupees: s.price_paise / 100,
        durationMinutes: s.duration_minutes,
        availableOnline: Boolean(s.available_online),
        isActive: Boolean(s.is_active),
      }))}
      rules={rules.map((r) => ({
        weekday: r.weekday,
        start: String(r.start_time).slice(0, 5),
        end: String(r.end_time).slice(0, 5),
        mode: r.mode,
      }))}
      paymentsConnected={Boolean(clinic.razorpay_key_id)}
      razorpayKeyId={clinic.razorpay_key_id || ''}
    />
  )
}
