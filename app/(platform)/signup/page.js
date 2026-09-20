import { getPublicPlans } from '@/lib/queries'
import { buildMetadata } from '@/lib/seo'
import { platform } from '@/config/platform'
import SignupForm from './SignupForm'

/**
 * ============================================================================
 *  CREATE YOUR CLINIC  →  kokli.local/signup
 * ============================================================================
 *  The server shell: loads the plans and hands them to the form.
 *
 *  ?plan=professional arrives from the pricing page, so the plan someone clicked
 *  is already selected when they get here. Small thing, but re-choosing a plan
 *  you just chose is exactly the kind of friction that loses signups.
 * ============================================================================
 */

export const metadata = buildMetadata({
  title: 'Create your clinic',
  description: `Set up your physiotherapy clinic on ${platform.name}. Free 30-day trial, no card required.`,
  path: '/signup',
  noIndex: true,
})

export const dynamic = 'force-dynamic'

export default async function SignupPage({ searchParams }) {
  const params = await searchParams
  const plans = await getPublicPlans()

  const requested = typeof params?.plan === 'string' ? params.plan : null
  const selected = plans.find((p) => p.code === requested) || plans[0] || null

  return (
    <SignupForm
      plans={plans.map((p) => ({
        code: p.code,
        name: p.name,
        pricePaise: p.price_paise,
        trialDays: p.trial_days,
        videoEnabled: Boolean(p.video_enabled),
        maxPhysios: p.max_physios,
      }))}
      selectedPlan={selected?.code ?? null}
      platformDomain={platform.domain}
    />
  )
}
