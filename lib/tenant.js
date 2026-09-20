import { cache } from 'react'
import { headers } from 'next/headers'
import { queryOne } from '@/lib/db'
import { platform } from '@/config/platform'

/**
 * ============================================================================
 *  TENANT RESOLUTION — "which clinic is this request for?"
 * ============================================================================
 *
 *  Every request to the application belongs to exactly one of two worlds:
 *
 *      kokli.local           the PLATFORM  — marketing, signup, your admin
 *      aarogya.kokli.local   a CLINIC      — a real tenant's website
 *
 *  The hostname is the only thing that distinguishes them, so it is read here,
 *  once, and everything downstream asks this file rather than parsing hosts
 *  itself. One place to get it right, one place to change it.
 *
 *  ---------------------------------------------------------------------------
 *  WHY `cache()` MATTERS MORE THAN IT LOOKS
 *  ---------------------------------------------------------------------------
 *  Rendering one page might ask "which clinic is this?" a dozen times — the
 *  layout, the header, the footer, the page itself, three components inside it.
 *  Without help that is a dozen identical database queries per page load.
 *
 *  React's `cache()` memoises the function FOR THE LIFETIME OF ONE REQUEST. The
 *  first caller runs the query; the other eleven get the same promise back. And
 *  crucially the cache is per-request, so clinic A's row can never be served to
 *  clinic B — which a module-level `let currentClinic` would do, catastrophically
 *  and intermittently, under concurrent load.
 *
 *  That is the trap this file exists to avoid: in a server that handles many
 *  tenants at once, "cache the current tenant in a variable" is a data leak.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/*  PARSING THE HOSTNAME                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Pull the clinic slug out of a hostname, or null for the platform itself.
 *
 *   aarogya.kokli.in  → 'aarogya'
 *   aarogya.localhost:3000 → 'aarogya'
 *   kokli.in          → null
 *   www.kokli.in      → null
 *
 * Exported separately from the database lookup because proxy.js runs in the edge
 * runtime and needs the parsing WITHOUT being able to touch MySQL.
 */
export function slugFromHost(host) {
  if (!host) return null

  // Strip the port, and lowercase — hostnames are case-insensitive but the
  // Host header preserves whatever the client sent.
  const hostname = String(host).split(':')[0].toLowerCase()
  const root = platform.domain.toLowerCase()

  // Exactly the root domain: this is the platform.
  if (hostname === root) return null

  // Not under our domain at all. Could be an IP address, a health check, or a
  // custom domain we do not support yet.
  if (!hostname.endsWith(`.${root}`)) return null

  const label = hostname.slice(0, -(root.length + 1))

  // Multi-level like `a.b.kokli.in` is not something we issue, so treat it
  // as the platform rather than guessing.
  if (label.includes('.')) return null

  // 'www' is the platform, not a clinic called www.
  if (label === 'www' || label === '') return null

  return label
}

/* -------------------------------------------------------------------------- */
/*  THE CURRENT REQUEST'S CLINIC                                              */
/* -------------------------------------------------------------------------- */

/**
 * The clinic slug for the request being rendered, or null on the platform.
 *
 * proxy.js has already resolved this and written it into a request header, so
 * the common path never re-parses. Falling back to the Host header keeps this
 * working for any route the middleware matcher skips.
 */
export const getCurrentSlug = cache(async () => {
  const headerList = await headers()
  return headerList.get('x-clinic-slug') || slugFromHost(headerList.get('host'))
})

/**
 * The full clinic row for this request, or null on the platform.
 *
 * This is THE function the rest of the app calls. Server Components use it
 * directly; Client Components receive whatever they need as props, because a
 * browser has no `headers()`.
 *
 *   const clinic = await getCurrentClinic()
 *   if (!clinic) notFound()
 */
export const getCurrentClinic = cache(async () => {
  const slug = await getCurrentSlug()
  if (!slug) return null
  return getClinicBySlug(slug)
})

/**
 * Like getCurrentClinic, but throws instead of returning null.
 *
 * Use it in code that is only ever reached on a clinic subdomain — a booking
 * page, the patient dashboard. The throw is a genuine programming error, not a
 * user error, and should be loud rather than silently rendering an empty page.
 */
export async function requireCurrentClinic() {
  const clinic = await getCurrentClinic()
  if (!clinic) {
    throw new Error(
      'No clinic for this request. This route should only be reachable on a clinic subdomain.'
    )
  }
  return clinic
}

/** Convenience: just the id, which is what every scoped query needs. */
export async function getCurrentClinicId() {
  const clinic = await getCurrentClinic()
  return clinic?.id ?? null
}

/* -------------------------------------------------------------------------- */
/*  LOOKUPS                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Load a clinic by its subdomain.
 *
 * Also `cache()`d, so two different code paths asking for the same slug in one
 * request share a single query.
 *
 * Note it deliberately does NOT filter on status. A suspended clinic still has
 * to be loadable, or we could not render the "this clinic is not currently
 * available" page for it. Deciding what a status MEANS is proxy.js's job; this
 * function only fetches.
 */
export const getClinicBySlug = cache(async (slug) => {
  if (!slug) return null

  return queryOne(
    `SELECT c.*,
            s.status        AS subscription_status,
            s.trial_ends_at,
            s.current_period_end,
            s.grace_ends_at,
            -- Needed by isCancelling() in lib/subscriptionLifecycle.js. Without it
            -- clinic.cancelled_at is undefined everywhere, the 'your subscription
            -- ends on...' banner never appears, and a clinic that has cancelled sees
            -- no sign of it anywhere in the product.
            s.cancelled_at,
            p.code          AS plan_code,
            p.name          AS plan_name,
            p.max_physios,
            p.max_locations,
            p.video_enabled,
            p.soap_notes_enabled,
            p.whatsapp_enabled,
            p.analytics_enabled
       FROM clinics c
       LEFT JOIN subscriptions s
              ON s.clinic_id = c.id
             AND s.status IN ('trialing', 'active', 'past_due')
       LEFT JOIN plans p ON p.id = s.plan_id
      WHERE c.slug = ?`,
    [slug]
  )
})

/** The same row, by id. Used by the platform admin, which works across tenants. */
export const getClinicById = cache(async (id) => {
  if (!id) return null

  return queryOne(
    `SELECT c.*,
            s.status        AS subscription_status,
            s.trial_ends_at,
            s.current_period_end,
            s.grace_ends_at,
            -- Needed by isCancelling() in lib/subscriptionLifecycle.js. Without it
            -- clinic.cancelled_at is undefined everywhere, the 'your subscription
            -- ends on...' banner never appears, and a clinic that has cancelled sees
            -- no sign of it anywhere in the product.
            s.cancelled_at,
            p.code          AS plan_code,
            p.name          AS plan_name,
            p.max_physios,
            p.max_locations,
            p.video_enabled,
            p.soap_notes_enabled,
            p.whatsapp_enabled,
            p.analytics_enabled
       FROM clinics c
       LEFT JOIN subscriptions s
              ON s.clinic_id = c.id
             AND s.status IN ('trialing', 'active', 'past_due')
       LEFT JOIN plans p ON p.id = s.plan_id
      WHERE c.id = ?`,
    [id]
  )
})

/* -------------------------------------------------------------------------- */
/*  THE AUTHORISATION CHECK THAT MATTERS MOST                                 */
/* -------------------------------------------------------------------------- */

/**
 * Confirm the signed-in user actually belongs to the clinic they are viewing.
 *
 * THIS IS THE MOST IMPORTANT FUNCTION IN THE FILE.
 *
 * The session cookie is set on `.kokli.in` so that it is visible across all
 * subdomains — signing up on the platform and landing on your new clinic has to
 * carry the session with it, and Google sign-in has to come back through the
 * root domain.
 *
 * The consequence is that a valid session from clinic A is PRESENTED to clinic
 * B's site as well. The cookie alone therefore proves "this person is signed in
 * somewhere", not "this person may be here". Without this check, any patient
 * could visit another clinic's subdomain and be treated as logged in.
 *
 * So: every protected surface compares the session's clinic against the host's
 * clinic. proxy.js does it for whole route groups; this helper is for the
 * individual pages and actions that need to be certain.
 *
 * Platform staff (clinic_id NULL) are deliberately allowed through — supporting
 * a customer means being able to look at their clinic.
 */
export function sessionBelongsToClinic(user, clinicId) {
  if (!user) return false
  if (user.role === 'platform') return true
  if (!clinicId) return false
  return Number(user.clinicId) === Number(clinicId)
}

/* -------------------------------------------------------------------------- */
/*  PLAN GATING                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Can this clinic use a given feature?
 *
 *   if (!clinicHasFeature(clinic, 'video_enabled')) …
 *
 * Reads the plan columns joined on above. Defaults to FALSE when there is no
 * subscription at all — failing closed is the only safe default for a paid
 * feature, because a bug in billing should withhold a feature, never give away
 * the expensive one for free.
 */
export function clinicHasFeature(clinic, feature) {
  if (!clinic) return false
  return Boolean(clinic[feature])
}

/**
 * `clinicCanAcceptBookings` used to live here and has been removed.
 *
 * It was a duplicate of canAcceptBookings() in lib/subscriptionLifecycle.js, and a
 * SUBTLY WORSE one: it read `clinic.status` directly, where the survivor derives
 * the status from the trial and grace DATES. That difference matters — a trial that
 * expired an hour ago is enforced immediately by the survivor, and not until the
 * nightly sweep had run by this one.
 *
 * Two functions with the same name and different answers is how a clinic ends up
 * blocked on one screen and not on another. Use canAcceptBookings().
 */

/** Days left on the trial, or null when not trialing. Drives the countdown banner. */
export function trialDaysRemaining(clinic) {
  if (clinic?.status !== 'trialing' || !clinic?.trial_ends_at) return null
  const ms = new Date(clinic.trial_ends_at).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}
