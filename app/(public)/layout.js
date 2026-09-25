import { notFound } from 'next/navigation'
import { getCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import ClinicStatusBanner from '@/components/layout/ClinicStatusBanner'

/**
 * ============================================================================
 *  PUBLIC LAYOUT — a clinic's own website
 * ============================================================================
 *
 *  WHAT THE PARENTHESES IN THE FOLDER NAME MEAN
 *  --------------------------------------------
 *  `app/(public)/` is a ROUTE GROUP. The parentheses tell Next.js "use this
 *  folder to share a layout, but leave it out of the URL", so
 *  app/(public)/about/page.js is served at /about.
 *
 *  ---------------------------------------------------------------------------
 *  THIS IS WHERE A TENANT BECOMES REAL
 *  ---------------------------------------------------------------------------
 *  proxy.js worked out WHICH clinic from the hostname, but it runs in the edge
 *  runtime and cannot reach MySQL, so it could not check whether that clinic
 *  actually exists. This layout is the first place that can, and it is therefore
 *  the gate:
 *
 *    no clinic for this subdomain  →  404
 *    clinic suspended or cancelled →  a plain "not available" page
 *    otherwise                     →  their website, in their branding
 *
 *  Resolving it here rather than in every page means one query per request (see
 *  the `cache()` note in lib/tenant.js) and one place where an unknown tenant is
 *  handled.
 * ============================================================================
 */

export default async function PublicLayout({ children }) {
  const clinic = await getCurrentClinic()

  /**
   * Somebody typed a subdomain that does not exist — a typo, an old link, or an
   * attempt to see what is out there.
   *
   * A real 404 is deliberate. Anything else (a redirect to the platform, a
   * "clinic not found" page returning 200) would let a stranger enumerate which
   * clinic names are taken by watching status codes, and would get junk
   * subdomains indexed by Google.
   */
  if (!clinic) notFound()

  // Switched off by the platform, or the clinic left. Their data is untouched —
  // this is only about what the public can see.
  if (clinic.status === 'suspended' || clinic.status === 'cancelled') {
    return <ClinicUnavailable name={clinic.name} />
  }

  const site = clinicView(clinic)

  return (
    /**
     * No colour set here any more. The clinic's palette is put on <html> by
     * app/layout.js, so the admin panel, the patient dashboard and the login
     * page share it with this website instead of falling back to Kokli's teal.
     * See brandStyle() in lib/brand.js.
     */
    <div className="flex min-h-screen flex-col">
      {/* Shown to staff only — a trial countdown, or a warning that payments are
          not connected yet. Patients never see it. */}
      <ClinicStatusBanner clinic={clinic} />

      <Header site={site} />

      {/* id="main" is the target of the "Skip to content" link in Navbar.js. */}
      <main id="main" className="flex-1">
        {children}
      </main>

      <Footer site={site} />
    </div>
  )
}

/**
 * The page shown for a clinic that is switched off.
 *
 * Deliberately says almost nothing. "Suspended for non-payment" would be
 * humiliating to display on a business's public website in front of their
 * patients, and it is nobody else's business why the site is down.
 */
function ClinicUnavailable({ name }) {
  return (
    <div className="grid min-h-screen place-items-center bg-sand-100 p-6 text-center dark:bg-ink-950">
      <div>
        <h1 className="text-2xl font-bold">{name}</h1>
        <p className="mt-3 max-w-md text-ink-600 dark:text-ink-400">
          This website is not available at the moment. Please contact the clinic directly.
        </p>
      </div>
    </div>
  )
}
