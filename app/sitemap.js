import { getCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import { getAllServiceSlugs } from '@/lib/queries'
import { platformUrl } from '@/config/platform'

/**
 * ============================================================================
 *  SITEMAP
 * ============================================================================
 *  Next.js turns this file into /sitemap.xml automatically.
 *
 *  A sitemap is a list of every page you want indexed. Google finds most pages
 *  by following links anyway, but a sitemap does two things links cannot:
 *
 *    - It gets brand-new pages crawled within hours instead of weeks. When your
 *      sister adds a service in the admin panel, the page appears here on the
 *      next request, with no code change and no manual step.
 *    - Search Console reports errors per sitemap URL, so you can see exactly
 *      which pages Google refused to index and why.
 *
 *  Because this reads from MySQL, the sitemap is always in sync with the live
 *  service list. That is the payoff for generating it rather than writing a
 *  static XML file that would drift out of date immediately.
 *
 *  ONE THING TO DO BY HAND, ONCE: submit https://yourdomain.com/sitemap.xml in
 *  Google Search Console → Sitemaps.
 * ============================================================================
 */

/**
 * Generated per request rather than at build time, so a service added this
 * morning is in the sitemap this afternoon — and so `npm run build` does not
 * need a live database connection.
 */
export const dynamic = 'force-dynamic'

export default async function sitemap() {
  /**
   * ONE SITEMAP PER CLINIC, resolved from the hostname.
   *
   * aarogya.kokli.in/sitemap.xml lists only Aarogya's pages, with Aarogya's
   * URLs. That is the whole point: each clinic submits their own sitemap to
   * Search Console and builds their own search presence.
   *
   * On the root domain there is no clinic, so we emit the platform's marketing
   * pages instead.
   */
  const clinic = await getCurrentClinic()
  if (!clinic) return platformSitemap()

  const site = clinicView(clinic)
  /**
   * The database read is wrapped because this route must never fail.
   *
   * If MySQL is briefly down and this throws, Googlebot gets an HTTP 500 for
   * /sitemap.xml. Repeated 500s are logged in Search Console as a fetch error
   * and Google backs off from re-reading it. Returning a sitemap with just the
   * static pages is strictly better than returning nothing.
   */
  let services = []
  try {
    services = await getAllServiceSlugs(clinic.id)
  } catch (error) {
    console.error('[sitemap] could not read services:', error.message)
  }

  /**
   * `priority` and `changeFrequency` are hints, and Google has said publicly
   * that it largely ignores them. `lastModified` it does pay attention to, so
   * that is the one worth getting right — service pages report the real
   * updated_at from the database.
   */
  const staticPages = [
    { path: '', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/services', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/book', priority: 0.9, changeFrequency: 'daily' },
    { path: '/about', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/legal/contact', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/register', priority: 0.4, changeFrequency: 'yearly' },
    { path: '/login', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/legal/privacy', priority: 0.2, changeFrequency: 'yearly' },
    { path: '/legal/terms', priority: 0.2, changeFrequency: 'yearly' },
  ]

  return [
    ...staticPages.map((page) => ({
      url: `${site.url}${page.path}`,
      lastModified: new Date(),
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    })),

    // Every treatment page. These are the pages that actually rank, because
    // they match what people search for — "frozen shoulder treatment Pune"
    // rather than the clinic's name.
    ...services.map((service) => ({
      url: `${site.url}/services/${service.slug}`,
      lastModified: service.updated_at ? new Date(service.updated_at) : new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    })),
  ]
}


/**
 * The marketing site's sitemap, served on the root domain.
 *
 * Deliberately does NOT list clinics. Each clinic is its own site on its own
 * subdomain with its own sitemap, and listing them here would make the platform
 * look like a directory competing with its own customers for the same searches.
 */
function platformSitemap() {
  const pages = [
    { path: '', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/pricing', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/signup', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/legal/contact', priority: 0.5, changeFrequency: 'yearly' },
    { path: '/login', priority: 0.3, changeFrequency: 'yearly' },
    // Listed on purpose. They rank for nothing, but a verification reviewer at
    // Razorpay or Meta finding them in the sitemap is one fewer reason to ask.
    { path: '/legal/terms', priority: 0.2, changeFrequency: 'yearly' },
    { path: '/legal/privacy', priority: 0.2, changeFrequency: 'yearly' },
    { path: '/legal/refunds', priority: 0.2, changeFrequency: 'yearly' },
  ]
  return pages.map((page) => ({
    url: platformUrl(page.path),
    lastModified: new Date(),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }))
}
