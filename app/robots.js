import { getCurrentClinic } from '@/lib/tenant'
import { clinicUrl, platformUrl } from '@/config/platform'

/**
 * ============================================================================
 *  ROBOTS.TXT
 * ============================================================================
 *  Next.js serves this as /robots.txt.
 *
 *  It tells crawlers where they may and may not go. The disallowed list here is
 *  not about secrecy — anything genuinely private is protected by middleware.js
 *  and would just return a redirect to a crawler. It is about not wasting
 *  Google's time.
 *
 *  Google allocates each site a rough "crawl budget". If it spends that budget
 *  requesting /api/slots and /dashboard, it has less left for the treatment
 *  pages you actually want ranked. Pointing it away from machinery means more
 *  of its attention lands on content.
 * ============================================================================
 */

export default async function robots() {
  // The sitemap link has to point at THIS hostname's sitemap, so a clinic's
  // robots.txt sends Google to that clinic's sitemap rather than the platform's.
  const clinic = await getCurrentClinic()
  const base = clinic ? clinicUrl(clinic.slug) : platformUrl()
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',        // JSON endpoints — nothing here for a search engine
          '/admin',       // staff only
          '/dashboard',   // a patient's private area
          '/consult/',    // live video rooms
          '/book/confirm', // a half-finished checkout
          '/platform',    // the platform's own admin
          '/onboarding',  // a half-finished clinic signup
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
