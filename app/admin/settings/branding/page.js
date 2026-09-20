import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import BrandingForm from './BrandingForm'

/**
 * ============================================================================
 *  BRANDING  →  /admin/settings/branding
 * ============================================================================
 *  The clinic's colour, changeable.
 *
 *  It was previously set once in the onboarding wizard and never again — a
 *  screen a clinic sees on their first afternoon, when they are guessing, and
 *  never returns to. Anything a business might reasonably want to change later
 *  needs a home in settings, not only in setup.
 * ============================================================================
 */

export const metadata = { title: 'Branding', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function BrandingPage() {
  const clinic = await requireCurrentClinic()
  const session = await auth()
  if (!['admin', 'platform'].includes(session?.user?.role)) redirect('/admin')

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Branding</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          The colour patients see on your website.
        </p>
      </div>

      <BrandingForm
        brandColour={clinic.brand_colour || '#0d9488'}
        clinicName={clinic.name}
        slug={clinic.slug}
      />
    </div>
  )
}
