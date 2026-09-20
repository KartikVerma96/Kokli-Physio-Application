/**
 * ============================================================================
 *  PLATFORM CONFIGURATION — YOUR business, not a clinic's
 * ============================================================================
 *
 *  Read this alongside the old config/site.js, which is now only a set of
 *  DEFAULTS used to pre-fill a brand-new clinic. The distinction is the whole
 *  point of the SaaS rewrite:
 *
 *      config/platform.js   you        — one row, in code
 *      clinics table        customers  — many rows, in the database
 *
 *  Anything that must differ per clinic (name, address, prices, hours) belongs
 *  in the database. Anything that is true of the product itself belongs here.
 * ============================================================================
 */

export const platform = {
  // ---------------------------------------------------------------- identity
  name: 'Kokli',
  tagline: 'Clinic software that fills your diary.',
  description:
    'Booking website, online payments and video consultations for physiotherapy clinics in India. Set up in an afternoon, free for 30 days.',

  /**
   * THE ROOT DOMAIN. Everything hangs off this.
   *
   *   kokli.local          your marketing site and signup
   *   aarogya.kokli.local  a clinic
   *   kokli.local/platform your admin
   *
   * In development this is `localhost`, because browsers resolve *.localhost
   * automatically — `aarogya.localhost:3000` works in Chrome and Firefox with no
   * hosts-file editing at all.
   *
   * To go live: buy a domain, point a wildcard DNS record (*.yourdomain.com) at
   * the server, and set PLATFORM_DOMAIN. Nothing else changes.
   */
  domain: process.env.PLATFORM_DOMAIN || 'localhost',

  // Set on production so links in emails and SEO tags are absolute and correct.
  protocol: process.env.PLATFORM_PROTOCOL || 'http',
  port: process.env.PORT || 3000,

  // ----------------------------------------------------------------- contact
  supportEmail: 'support@kokli.in',
  salesEmail: 'hello@kokli.in',
  supportPhone: '+91 90000 00000',

  /**
   * ------------------------------------------------------------------- legal
   * The registered entity behind Kokli.
   *
   * WHY THIS IS ONE BLOCK AND NOT SCATTERED THROUGH THE PAGES
   * --------------------------------------------------------
   * These exact strings have to match, character for character, across four
   * places that each check them independently:
   *
   *     the Udyam certificate      the source of truth
   *     Razorpay KYC               refuses activation on a mismatch
   *     Meta business verification rejects on a mismatch
   *     these website pages        which the other two are checked against
   *
   * A name typed separately into four files drifts — "Kokli Technologies" in one,
   * "Kokli Tech" in another — and the failure arrives weeks later as an
   * unexplained verification rejection. One object, read everywhere.
   *
   * `name` is the BRAND (Kokli) and appears throughout the product.
   * `legal.name` is the ENTITY, and appears only where the law wants it.
   */
  legal: {
    name: 'Kokli Technologies',
    udyam: 'UDYAM-DL-02-0124498',
    address: {
      line1: 'H-161, J&K Block',
      line2: 'Laxmi Nagar',
      city: 'New Delhi',
      state: 'Delhi',
      pin: '110092',
      country: 'India',
    },
    /**
     * When the business was registered. Used on the legal pages so a reader can
     * see the entity is real and how long it has existed.
     */
    registeredOn: '2026-08-09',
  },

  // ----------------------------------------------------------------- billing
  currency: { code: 'INR', symbol: '₹', locale: 'en-IN' },

  /**
   * India charges 18% GST on software as a service.
   *
   * Stored as a number here and COPIED onto each invoice when it is raised, so
   * that if the rate ever changes, historical invoices keep the rate that was
   * actually charged. Never recalculate tax on an old invoice.
   */
  gstPercent: 18,

  /**
   * How long a clinic keeps working after a payment fails.
   *
   * Seven days is a deliberate choice. A failed card is usually an expiry or a
   * bank's fraud check, not a decision to leave — and cutting off a clinic's
   * bookings the same morning would harm their patients, not just them. After
   * the grace period they go READ-ONLY: they can still open every record, they
   * just cannot take new bookings. Data is never deleted.
   */
  graceDays: 7,

  // Subdomains a clinic may not take, because they are ours or would be
  // confusing. Checked during signup.
  reservedSlugs: [
    'www', 'app', 'api', 'admin', 'platform', 'dashboard', 'auth', 'login',
    'signup', 'register', 'billing', 'support', 'help', 'docs', 'blog', 'mail',
    'smtp', 'ftp', 'cdn', 'static', 'assets', 'status', 'about', 'pricing',
    'contact', 'terms', 'privacy', 'demo', 'test', 'staging', 'dev',
  ],

  // --------------------------------------------------------------- marketing
  // Shown on the pricing page. The real limits live in the `plans` table — these
  // are only the sales copy that sits beside them.
  valueProps: [
    {
      title: 'A booking website that actually ranks',
      body: 'Every treatment gets its own page, written for the way patients search — "frozen shoulder treatment near me", not "physiotherapy". Structured data, sitemap and local SEO are generated for you.',
    },
    {
      title: 'Payments land in YOUR account',
      body: 'You connect your own Razorpay. Patient fees settle directly to your bank, same as they do now. We never hold your money and never take a cut of it.',
    },
    {
      title: 'Video consultations built in',
      body: 'One-to-one video that runs in the browser — nothing for your patient to install. See people who moved away, or who cannot drive after surgery.',
    },
    {
      title: 'Clinical notes and home exercises',
      body: 'SOAP notes the way you were taught, and exercise programmes your patients can open on their phone at home. Adherence is what makes treatment work.',
    },
  ],

  faqs: [
    {
      q: 'Do I need my own website already?',
      a: 'No — this becomes your website. You get an address like yourclinic.kokli.in with your name, your treatments, your prices and your photo. If you already have a site, you can keep it and use this purely for bookings.',
    },
    {
      q: 'Who receives the money my patients pay?',
      a: 'You do, directly. During setup you connect your own Razorpay account, and patient fees settle into your bank exactly as they would if you had built the site yourself. We never touch that money and take no commission on it. The only thing you pay us is the monthly subscription.',
    },
    {
      q: 'What happens to my patient records if I stop paying?',
      a: 'Nothing is deleted. Your account becomes read-only: you can still open every patient record, every clinical note and every invoice, and export them. You simply cannot take new bookings until you resubscribe. Deleting medical records over a failed card would be indefensible.',
    },
    {
      q: 'How long does setup take?',
      a: 'About twenty minutes. You enter your clinic details, add your treatments and prices, set your working hours, and connect Razorpay. Most clinics are taking bookings the same afternoon.',
    },
    {
      q: 'Is my patients’ data safe?',
      a: 'Each clinic’s data is isolated at the database level, and every query is scoped to your clinic — no clinic can ever see another’s records. Payment credentials are encrypted at rest. Clinical records are visible only to you and your physiotherapists.',
    },
    {
      q: 'Can I cancel whenever I want?',
      a: 'Yes. It is month to month with no contract and no notice period. Cancel from your billing page and you keep access until the end of the period you have already paid for.',
    },
  ],
}

/* -------------------------------------------------------------------------- */
/*  URL HELPERS                                                               */
/* -------------------------------------------------------------------------- */
/*
 *  Every URL in the app is built through these, so switching from
 *  `localhost:3000` to a real domain is one environment variable rather than a
 *  find-and-replace across fifty files.
 */

/** Is the port worth printing? Only in development. */
function portSuffix() {
  const port = String(platform.port)
  return platform.domain === 'localhost' || platform.domain.endsWith('.local')
    ? `:${port}`
    : ''
}

/** The platform's own site: https://kokli.in */
export function platformUrl(path = '') {
  return `${platform.protocol}://${platform.domain}${portSuffix()}${path}`
}

/** A clinic's site: https://aarogya.kokli.in */
export function clinicUrl(slug, path = '') {
  return `${platform.protocol}://${slug}.${platform.domain}${portSuffix()}${path}`
}

/** The bare hostname of a clinic, without protocol or path. */
export function clinicHost(slug) {
  return `${slug}.${platform.domain}${portSuffix()}`
}

/**
 * Is this hostname a valid, available subdomain?
 *
 * Rules: 3–63 characters, lowercase letters/digits/hyphens, cannot start or end
 * with a hyphen, and not on the reserved list. The length limit is not
 * arbitrary — 63 characters is the maximum length of a single DNS label.
 */
export function validateSlug(slug) {
  const value = String(slug || '').trim().toLowerCase()

  if (value.length < 3) return { ok: false, error: 'At least 3 characters' }
  if (value.length > 63) return { ok: false, error: 'At most 63 characters' }
  if (!/^[a-z0-9-]+$/.test(value)) {
    return { ok: false, error: 'Lowercase letters, numbers and hyphens only' }
  }
  if (value.startsWith('-') || value.endsWith('-')) {
    return { ok: false, error: 'Cannot start or end with a hyphen' }
  }
  if (platform.reservedSlugs.includes(value)) {
    return { ok: false, error: 'That address is reserved — please pick another' }
  }

  return { ok: true, slug: value }
}

/**
 * The registered address on one line, for the legal pages and email footers.
 *
 * Built from the parts rather than stored as a string, so there is exactly one
 * place the address lives — see the note on `platform.legal`.
 */
export function legalAddress() {
  const a = platform.legal.address
  return [a.line1, a.line2, a.city, a.state, a.pin, a.country].filter(Boolean).join(', ')
}
