/**
 * ============================================================================
 *  SEO
 * ============================================================================
 *
 *  Ranking on Google is not one trick. It is roughly four things, and this
 *  file plus the server-rendering approach of the whole app covers all four:
 *
 *  1. CRAWLABLE CONTENT
 *     Every public page is rendered on the server, so the HTML Google receives
 *     already contains the words. A client-rendered app sends an empty <div>
 *     and hopes the crawler runs the JavaScript. Google usually does — but
 *     "usually" is a bad foundation, and Bing and every social-media preview
 *     scraper are far less capable. This is the single biggest reason to
 *     server-render a clinic website.
 *
 *  2. CORRECT METADATA
 *     A unique title and description per page. buildMetadata() below.
 *
 *  3. STRUCTURED DATA (JSON-LD)
 *     Machine-readable facts about the business: that it is a physiotherapy
 *     clinic, where it is, when it opens, what it charges. This is what earns
 *     the rich results — the star ratings, the opening hours in the sidebar,
 *     the expandable FAQ list, and inclusion in the local map pack. For a
 *     local clinic, this is the highest-leverage item on the whole list.
 *
 *  4. SPEED AND CORE WEB VITALS
 *     Handled elsewhere: server rendering, next/font, a small JS bundle, and
 *     no layout shift.
 *
 *  A NOTE ON KEYWORDS
 *  ------------------
 *  Google has ignored the `keywords` meta tag for over a decade. What actually
 *  works for a local clinic is genuinely useful text that names the condition
 *  and the city — "physiotherapy for sciatica in Pune" — in the page's real
 *  content, headings and URL. That is why database/seed.sql writes service
 *  descriptions the way it does.
 * ============================================================================
 */

import { formattedAddress } from '@/lib/clinicView'
import { platform } from '@/config/platform'

/**
 * MULTI-TENANT NOTE
 * -----------------
 * Every function here used to read one global clinic from config/site.js. On a
 * platform there is no "the" clinic, so each takes a `site` — the object from
 * lib/clinicView.js for whichever clinic this request belongs to.
 *
 * That is what makes each clinic's SEO genuinely their own: their name, their
 * address, their coordinates, their reviews. A platform that emitted the same
 * structured data for every tenant would be worse than emitting none.
 */

/* ========================================================================== */
/*  PAGE METADATA                                                             */
/* ========================================================================== */

/**
 * Build a Next.js metadata object.
 *
 *   export const metadata = buildMetadata({
 *     title: 'Sports Injury Rehabilitation',
 *     description: '...',
 *     path: '/services/sports-injury-rehab',
 *   })
 *
 * The brand is appended for you, so that becomes
 * "Sports Injury Rehabilitation | Aarogya Physiotherapy" — the CLINIC's name on
 * a clinic page, and Kokli's only on Kokli's own marketing pages.
 */
export function buildMetadata({
  site,
  title,
  description,
  path = '/',
  image,
  noIndex = false,
  type = 'website',
  publishedTime,
} = {}) {
  // Falls back to the platform's own identity, which is what the marketing
  // pages on the root domain need.
  const base = site?.url || `${platform.protocol}://${platform.domain}`
  const brand = site?.name || platform.name
  const url = `${base}${path}`
  const resolvedDescription = description || site?.description || platform.description
  // A dedicated share image if one is given, otherwise the generated default
  // (see app/opengraph-image.js).
  const ogImage = image || `${base}/opengraph-image`

  /**
   * THE FINISHED <title>. Two rules, both there because of a mistake that is
   * easy to make and very hard to spot:
   *
   *   1. The brand is appended only if the title does not already contain it.
   *      Otherwise a home page titled "Aarogya Physiotherapy — Physiotherapy in
   *      Pune" ends up as "… | Aarogya Physiotherapy", saying the name twice.
   *
   *   2. `brand` is the CLINIC on a clinic page, and Kokli only on Kokli's own
   *      pages. Getting this wrong is the expensive one: a patient searching for
   *      "Aarogya Physiotherapy" would find a result stamped with the name of the
   *      software the clinic happens to rent. It is their website, not ours.
   */
  const fullTitle = !title
    ? `${brand}${site?.tagline ? ` — ${site.tagline}` : ''}`
    : title.includes(brand)
      ? title
      : `${title} | ${brand}`

  return {
    /**
     * `absolute` opts out of the `%s | Kokli` template in app/layout.js. That
     * template is a sensible default for a single-brand site and exactly wrong
     * for a platform, where most pages belong to somebody else's brand — so
     * every page built here states its title in full instead.
     */
    title: { absolute: fullTitle },
    description: resolvedDescription,

    /**
     * The canonical URL tells Google "this is the real address of this page".
     * It matters more than it sounds: /services?ref=instagram and /services
     * are the same page, and without a canonical Google may treat them as two
     * competing duplicates, splitting the ranking between them.
     */
    alternates: { canonical: url },

    // Open Graph controls how the link looks when shared on WhatsApp,
    // Facebook or LinkedIn. For a clinic that gets recommended person to
    // person, WhatsApp previews genuinely drive bookings.
    openGraph: {
      type,
      url,
      title: fullTitle,
      description: resolvedDescription,
      siteName: brand,
      locale: 'en_IN',
      images: [{ url: ogImage, width: 1200, height: 630, alt: brand }],
      ...(publishedTime ? { publishedTime } : {}),
    },

    twitter: {
      card: 'summary_large_image',
      title: title || brand,
      description: resolvedDescription,
      images: [ogImage],
    },

    // Used on pages that must never appear in search results — a patient's
    // dashboard, the admin panel, a video consultation room.
    ...(noIndex
      ? { robots: { index: false, follow: false, nocache: true } }
      : {}),
  }
}

/* ========================================================================== */
/*  STRUCTURED DATA                                                           */
/* ========================================================================== */
/*
 *  Each function below returns a plain object that gets rendered inside a
 *  <script type="application/ld+json"> tag. Test the output with Google's Rich
 *  Results Test:  https://search.google.com/test/rich-results
 */

/**
 * THE MOST IMPORTANT ONE. This is what makes Google understand that this is a
 * physiotherapy clinic at a specific address with specific opening hours, and
 * it is what qualifies the clinic for the local "map pack" — the three
 * businesses shown with a map above the normal results.
 *
 * The two types together are deliberate: MedicalClinic tells Google what kind
 * of business it is, LocalBusiness is what the local-search features look for.
 */
export function localBusinessSchema({ site, services = [], rating = null } = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': ['MedicalClinic', 'LocalBusiness'],
    '@id': `${site.url}/#clinic`,
    name: site.legalName,
    alternateName: site.name,
    description: site.description,
    url: site.url,
    telephone: site.contact.phone,
    email: site.contact.email,
    image: `${site.url}/opengraph-image`,
    priceRange: '₹₹',
    currenciesAccepted: site.currency.code,
    paymentAccepted: 'UPI, Credit Card, Debit Card, Netbanking, Cash',
    medicalSpecialty: 'Physiotherapy',

    address: {
      '@type': 'PostalAddress',
      streetAddress: `${site.address.line1}, ${site.address.line2}`,
      addressLocality: site.address.city,
      addressRegion: site.address.state,
      postalCode: site.address.postalCode,
      addressCountry: site.address.country,
    },

    // Coordinates are what let Google place the clinic on a map and answer
    // "physiotherapist near me".
    geo: {
      '@type': 'GeoCoordinates',
      latitude: site.address.latitude,
      longitude: site.address.longitude,
    },

    hasMap: site.address.mapsUrl,

    openingHoursSpecification: site.openingHoursSpec.map((slot) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: slot.days.map((d) => `https://schema.org/${d}`),
      opens: slot.opens,
      closes: slot.closes,
    })),

    // The physiotherapist herself. Naming a real, credentialled practitioner is
    // a direct signal of what Google calls E-E-A-T (experience, expertise,
    // authoritativeness, trust), which it weighs especially heavily for health
    // topics — where bad information can genuinely hurt people.
    employee: {
      '@type': 'Person',
      name: site.doctor.name,
      jobTitle: site.doctor.title,
      description: site.doctor.bio,
      knowsLanguage: site.doctor.languages,
      hasCredential: {
        '@type': 'EducationalOccupationalCredential',
        credentialCategory: 'degree',
        name: site.doctor.credentials,
      },
    },

    // The treatment list, so Google knows the clinic treats sciatica even if
    // nobody has ever searched the clinic by name.
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Physiotherapy treatments',
      itemListElement: services.map((service) => ({
        '@type': 'Offer',
        itemOffered: {
          '@type': 'MedicalTherapy',
          name: service.name,
          description: service.short_description,
          url: `${site.url}/services/${service.slug}`,
        },
        price: (service.price_paise / 100).toFixed(2),
        priceCurrency: site.currency.code,
      })),
    },

    // Only ever include this when the reviews are real and there are enough of
    // them. Fabricated ratings are a policy violation and Google does act on
    // it. getRatingSummary() in lib/queries.js returns null below 3 reviews.
    ...(rating
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: rating.average,
            reviewCount: rating.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),

    areaServed: {
      '@type': 'City',
      name: site.address.city,
    },

    sameAs: Object.values(site.social).filter(Boolean),
  }
}

/**
 * FAQ structured data. This is the one that produces those expandable
 * question-and-answer lists directly inside the search results, which take up
 * a lot of vertical space and push competitors down the page.
 *
 * Requirement: the questions and answers must also be visible on the page
 * itself. Marking up content the user cannot see is cloaking. Ours are
 * rendered by components/home/Faq.js from the same source.
 */
export function faqSchema(items = []) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
}

/**
 * One treatment page. `MedicalTherapy` is more specific than `Service`, and
 * being specific is generally how you help a search engine.
 */
export function serviceSchema(site, service) {
  return {
    '@context': 'https://schema.org',
    '@type': 'MedicalTherapy',
    name: service.name,
    description: service.short_description,
    url: `${site.url}/services/${service.slug}`,
    medicineSystem: 'https://schema.org/WesternConventional',
    relevantSpecialty: { '@type': 'MedicalSpecialty', name: 'Physiotherapy' },
    provider: { '@id': `${site.url}/#clinic` },
    ...(Array.isArray(service.conditions_treated) && service.conditions_treated.length
      ? {
          // Naming the conditions is how the page becomes findable by people
          // searching for their symptom rather than for a treatment.
          indication: service.conditions_treated.map((condition) => ({
            '@type': 'MedicalIndication',
            name: condition,
          })),
        }
      : {}),
    offers: {
      '@type': 'Offer',
      price: (service.price_paise / 100).toFixed(2),
      priceCurrency: site.currency.code,
      availability: 'https://schema.org/InStock',
      url: `${site.url}/book?service=${service.slug}`,
    },
  }
}

/**
 * Breadcrumbs. Google renders these as the little
 * "aarogyaphysio.in › Services › Sports Injury" trail in place of the raw URL,
 * which measurably improves how often people click the result.
 *
 *   breadcrumbSchema([{ name: 'Services', path: '/services' }, { name: 'Sciatica' }])
 */
export function breadcrumbSchema(site, trail = []) {
  const items = [{ name: 'Home', path: '/' }, ...trail]
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      // The last item deliberately has no `item` URL — it is the current page.
      ...(item.path ? { item: `${site.url}${item.path}` } : {}),
    })),
  }
}

/** Identifies the site itself, and offers Google a sitelinks search box. */
export function websiteSchema(site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${site.url}/#website`,
    url: site.url,
    name: site.name,
    description: site.description,
    publisher: { '@id': `${site.url}/#clinic` },
    inLanguage: 'en-IN',
  }
}

/**
 * Individual patient reviews.
 *
 * Same warning as aggregateRating: only real reviews, with permission. The
 * placeholders in config/site.js must be replaced before this site goes live.
 */
export function reviewSchema(site, items = []) {
  return items.map((review) => ({
    '@context': 'https://schema.org',
    '@type': 'Review',
    itemReviewed: { '@id': `${site.url}/#clinic` },
    author: { '@type': 'Person', name: review.name },
    reviewRating: { '@type': 'Rating', ratingValue: review.rating, bestRating: 5 },
    reviewBody: review.text,
  }))
}

/** A physiotherapy appointment as a bookable action. */
export function reservationSchema(site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: 'Physiotherapy consultation',
    provider: { '@id': `${site.url}/#clinic` },
    areaServed: site.address.city,
    availableChannel: [
      {
        '@type': 'ServiceChannel',
        name: 'Online video consultation',
        serviceUrl: `${site.url}/book`,
        availableLanguage: site.doctor.languages,
      },
      {
        '@type': 'ServiceChannel',
        name: 'In-clinic appointment',
        serviceLocation: {
          '@type': 'Place',
          name: site.legalName,
          address: formattedAddress(site),
        },
      },
    ],
  }
}

/* ========================================================================== */
/*  RENDERING IT                                                              */
/* ========================================================================== */

/**
 * Renders one or more schema objects into the page.
 *
 *     <JsonLd data={[localBusinessSchema(), faqSchema()]} />
 *
 * ON dangerouslySetInnerHTML: the name is a real warning, but this is the
 * documented way to emit JSON-LD, and it is safe HERE because every value
 * comes from our own config and database — never from user input. If you ever
 * put patient-submitted text into a schema, sanitise it first: a review
 * containing `</script>` would otherwise break out of the tag and could run as
 * JavaScript. That is why the replace below exists.
 */
export function JsonLd({ data }) {
  const payload = Array.isArray(data) ? data : [data]
  return (
    <>
      {payload.map((schema, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(schema).replace(/</g, '\\u003c'),
          }}
        />
      ))}
    </>
  )
}
