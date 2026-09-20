/**
 * ============================================================================
 *  CLINIC VIEW — a database row, shaped for the user interface
 * ============================================================================
 *
 *  A `clinics` row is shaped for storage: flat, snake_case, nullable columns.
 *  The components want something shaped for reading: nested, camelCase, with no
 *  nulls to guard against.
 *
 *      clinic.practitioner_name        →   site.doctor.name
 *      clinic.address_line1            →   site.address.line1
 *      clinic.booking_hold_mins        →   site.booking.paymentHoldMinutes
 *
 *  WHY BOTHER WITH A MAPPER AT ALL
 *  -------------------------------
 *  Three reasons, in order of how much they matter:
 *
 *  1. NULLS BECOME DEFAULTS, ONCE. A clinic halfway through onboarding has no
 *     address yet. Without this, every component would need its own
 *     `clinic.city ?? ''`, and the one that forgets renders "null, null" on a
 *     live website. Handling it here means the UI can trust what it is given.
 *
 *  2. THE SHAPE IS DELIBERATELY THE OLD ONE. This app began as a single-clinic
 *     site reading a `site` object from config/site.js. Matching that shape
 *     exactly means the conversion to multi-tenant was a change of SOURCE, not a
 *     rewrite of forty components — which is a far smaller thing to get wrong.
 *
 *  3. IT IS THE BOUNDARY. Components never see raw database columns, so renaming
 *     a column is a change to this file rather than a search across the app.
 *
 *  USAGE
 *  -----
 *      // Server Component
 *      const clinic = await requireCurrentClinic()
 *      const site = clinicView(clinic)
 *
 *      // Client Component — the parent passes it down, because the browser has
 *      // no database and no headers()
 *      <BookingWizard site={clinicView(clinic)} />
 * ============================================================================
 */

import { clinicUrl } from '@/config/platform'

/** JSON columns arrive parsed from mysql2, but a NULL arrives as null. */
function list(value, fallback = []) {
  return Array.isArray(value) ? value : fallback
}

export function clinicView(clinic) {
  if (!clinic) return null

  return {
    // ------------------------------------------------------------- identity
    id: clinic.id,
    slug: clinic.slug,
    name: clinic.name,
    legalName: clinic.legal_name || clinic.name,
    tagline: clinic.tagline || '',
    description: clinic.description || '',

    // The clinic's own public address, used for canonical links and SEO tags.
    url: clinicUrl(clinic.slug),

    brandColour: clinic.brand_colour || '#0d9488',
    logoUrl: clinic.logo_url || null,

    // ------------------------------------------------------------- doctor
    // Named `doctor` because that is what the components already call it.
    doctor: {
      name: clinic.practitioner_name || clinic.name,
      credentials: clinic.practitioner_credentials || '',
      title: clinic.practitioner_title || 'Physiotherapist',
      registration: clinic.practitioner_registration || '',
      experienceYears: clinic.practitioner_experience_years || null,
      bio: clinic.practitioner_bio || '',
      languages: list(clinic.practitioner_languages, ['English']),
      specialisations: list(clinic.practitioner_specialisations),
    },

    // ------------------------------------------------------------ contact
    contact: {
      phone: clinic.phone || '',
      whatsapp: clinic.whatsapp || '',
      email: clinic.email || '',
    },

    // ------------------------------------------------------------ address
    address: {
      line1: clinic.address_line1 || '',
      line2: clinic.address_line2 || '',
      city: clinic.city || '',
      state: clinic.state || '',
      postalCode: clinic.postal_code || '',
      country: clinic.country || 'IN',
      // Numbers, not the DECIMAL strings MySQL returns — the structured data
      // and the map embed both want real numbers.
      latitude: clinic.latitude !== null ? Number(clinic.latitude) : null,
      longitude: clinic.longitude !== null ? Number(clinic.longitude) : null,
      mapsUrl:
        clinic.maps_url ||
        (clinic.latitude && clinic.longitude
          ? `https://maps.google.com/?q=${clinic.latitude},${clinic.longitude}`
          : ''),
    },

    // ------------------------------------------------------------- hours
    openingHours: list(clinic.opening_hours),
    openingHoursSpec: list(clinic.opening_hours_spec),

    social: clinic.social && typeof clinic.social === 'object' ? clinic.social : {},

    // -------------------------------------------------------------- money
    currency: {
      code: clinic.currency || 'INR',
      symbol: '₹',
      locale: 'en-IN',
    },
    timezone: clinic.timezone || 'Asia/Kolkata',

    // ------------------------------------------------------------ booking
    booking: {
      maxDaysAhead: clinic.booking_max_days_ahead ?? 30,
      minNoticeMinutes: clinic.booking_min_notice_mins ?? 60,
      paymentHoldMinutes: clinic.booking_hold_mins ?? 15,
      freeCancellationHours: clinic.free_cancellation_hours ?? 12,
    },

    // ------------------------------------------------------------ content
    stats: list(clinic.stats),
    faqs: list(clinic.faqs),

    // ---------------------------------------------------- plan & status
    // Read by the UI to hide features the clinic has not paid for, and to show
    // trial banners. See lib/tenant.js for what each status means.
    status: clinic.status,
    plan: {
      code: clinic.plan_code || null,
      name: clinic.plan_name || null,
      videoEnabled: Boolean(clinic.video_enabled),
      soapNotesEnabled: Boolean(clinic.soap_notes_enabled),
      whatsappEnabled: Boolean(clinic.whatsapp_enabled),
      analyticsEnabled: Boolean(clinic.analytics_enabled),
      maxPhysios: clinic.max_physios || 1,
    },
    trialEndsAt: clinic.trial_ends_at || null,

    // Whether patients can actually pay. Used to warn staff during onboarding
    // that their booking page cannot take money yet.
    paymentsConnected: Boolean(clinic.razorpay_key_id),
  }
}

/** The address as one readable line. */
export function formattedAddress(site) {
  const a = site?.address
  if (!a) return ''
  return [a.line1, a.line2, [a.city, a.postalCode].filter(Boolean).join(' '), a.state]
    .filter(Boolean)
    .join(', ')
}

/** A pre-filled WhatsApp link, or null when the clinic has no WhatsApp number. */
export function whatsappLink(site, message = 'Hi, I would like to book a physiotherapy appointment.') {
  const number = site?.contact?.whatsapp
  if (!number) return null
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
}

/** A tel: link with the spaces stripped, or null. */
export function telLink(site) {
  const phone = site?.contact?.phone
  if (!phone) return null
  return `tel:${phone.replace(/\s/g, '')}`
}
