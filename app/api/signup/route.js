import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { transaction, queryOne, isDuplicateError } from '@/lib/db'
import { signupSchema, validateRequest } from '@/lib/validation'
import { validateSlug, clinicUrl, platform } from '@/config/platform'
import { sendEmailInBackground } from '@/lib/email'
import { newClinicForPlatform } from '@/lib/emailTemplates'
import { getPlanByCode } from '@/lib/queries'
/**
 * config/site.js is no longer "the clinic" — it is the DEFAULT CONTENT a brand
 * new clinic starts with, so their website looks finished from the first minute
 * instead of being full of empty placeholders. Every word is editable in the
 * onboarding wizard.
 *
 * Note `faqs` is a separate export, not a property of `site`.
 */
import { site as defaults, faqs as defaultFaqs } from '@/config/site'

/**
 * ============================================================================
 *  POST /api/signup — a physiotherapist creates their clinic
 * ============================================================================
 *
 *  This is the moment a stranger becomes a customer, and it has to create four
 *  things that are useless without each other:
 *
 *      1. the clinic          the tenant everything else hangs off
 *      2. the owner account   role 'admin', belonging to that clinic
 *      3. a physio account    so the diary has somebody to book with
 *      4. a trial subscription
 *
 *  ALL OF IT IN ONE TRANSACTION
 *  ----------------------------
 *  Half of this is worse than none of it. A clinic with no owner cannot be
 *  logged into and cannot be deleted through the UI. An owner with no clinic
 *  violates the tenancy CHECK constraint outright. A clinic with no subscription
 *  has no trial and is locked out on arrival.
 *
 *  So it is one transaction: all four, or nothing, and the customer simply sees
 *  "that did not work, try again".
 *
 *  WHY A PHYSIO ACCOUNT IS CREATED TOO
 *  -----------------------------------
 *  Availability and appointments both point at a physio_id. A clinic with only
 *  an admin would have an empty diary that cannot be filled, and the owner would
 *  hit a dead end before seeing anything work. Most clinics signing up ARE the
 *  physiotherapist, so we create one from their own name and let them rename it.
 * ============================================================================
 */

export async function POST(request) {
  const parsed = await validateRequest(signupSchema, request)
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'Please check the highlighted fields.', errors: parsed.errors },
      { status: 422 }
    )
  }

  const { name, email, password, clinicName, slug: rawSlug, phone, city, planCode } = parsed.data

  // Re-validated on the server. The form checks it too, but the form is not the
  // thing standing between a stranger and a reserved subdomain like `admin`.
  const slugCheck = validateSlug(rawSlug)
  if (!slugCheck.ok) {
    return NextResponse.json(
      { error: slugCheck.error, errors: { slug: slugCheck.error } },
      { status: 422 }
    )
  }
  const slug = slugCheck.slug

  // Default to Starter if the caller asked for a plan that does not exist.
  const plan =
    (await getPlanByCode(planCode || 'starter')) || (await getPlanByCode('starter'))
  if (!plan) {
    return NextResponse.json(
      { error: 'No plans are configured. Run npm run db:setup.' },
      { status: 503 }
    )
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10)

    const result = await transaction(async (tx) => {
      /* ------------------------------------------------------- 1. the clinic */
      // Pre-filled with sensible starting content from config/site.js so a brand
      // new clinic has a website that looks finished from the first minute,
      // rather than a page full of empty placeholders. Every word is editable.
      const [clinicRes] = await tx.execute(
        `INSERT INTO clinics
           (slug, name, legal_name, tagline, description, phone, email, city,
            practitioner_name, opening_hours, opening_hours_spec, faqs, stats,
            status, onboarding_step)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?,
                 'trialing', 'details')`,
        [
          slug,
          clinicName,
          clinicName,
          defaults.tagline ?? null,
          `Physiotherapy${city ? ` in ${city}` : ''}. Book an appointment online.`,
          phone || null,
          email,
          city || null,
          name,
          // `?? []` on every one: mysql2 refuses `undefined` outright rather
          // than coercing it to NULL, so a missing default would take the whole
          // signup down with a confusing bind error.
          JSON.stringify(defaults.openingHours ?? []),
          JSON.stringify(defaults.openingHoursSpec ?? []),
          JSON.stringify(defaultFaqs ?? []),
          // NOT the demo figures. config/site.js carries "3,200+ sessions",
          // "4.9 average rating" and "9+ years" for the demo clinic, and copying
          // them made every brand-new clinic's homepage claim all three on day
          // one — with no patients and no reviews. A made-up rating is also the
          // kind of thing Google penalises. A new clinic starts with none and
          // the homepage simply leaves the bar out.
          JSON.stringify([]),
        ]
      )
      const clinicId = clinicRes.insertId

      /* ------------------------------------------------ 2. the owner account */
      const [ownerRes] = await tx.execute(
        `INSERT INTO users (clinic_id, name, email, password_hash, phone, role, email_verified)
         VALUES (?, ?, ?, ?, ?, 'admin', 1)`,
        [clinicId, name, email, passwordHash, phone || null]
      )
      const ownerId = ownerRes.insertId

      await tx.execute('UPDATE clinics SET owner_user_id = ? WHERE id = ?', [ownerId, clinicId])

      /* --------------------------------------------- 3. a physio to book with */
      // A separate row from the owner, with a derived email, so the clinic can
      // later add real therapists without the owner's login being entangled with
      // a calendar.
      await tx.execute(
        `INSERT INTO users (clinic_id, name, email, role, email_verified, is_active)
         VALUES (?, ?, ?, 'physio', 1, 1)`,
        [clinicId, name, `physio+${slug}@${slug}.invalid`]
      )

      /* ------------------------------------------------ 4. the free trial */
      await tx.execute(
        `INSERT INTO subscriptions
           (clinic_id, plan_id, status, price_paise, billing_period,
            trial_ends_at, current_period_start, current_period_end)
         VALUES (?, ?, 'trialing', ?, ?,
                 DATE_ADD(NOW(), INTERVAL ? DAY), NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))`,
        [clinicId, plan.id, plan.price_paise, plan.billing_period, plan.trial_days, plan.trial_days]
      )

      return { clinicId, ownerId }
    })

    /**
     * Tell yourself. Not the customer — they are already looking at the success
     * screen — but YOU.
     *
     * In the first year of a business, a new signup is the most important event
     * that happens all week, and the difference between a trial that converts
     * and one that goes quiet is very often a short, human email on day one. An
     * admin page you have to remember to open is not a substitute.
     */
    sendEmailInBackground({
      to: platform.salesEmail,
      ...newClinicForPlatform({
        clinic: { name: clinicName, slug, city },
        ownerName: name,
        ownerEmail: email,
        planName: plan.name,
      }),
    })

    return NextResponse.json(
      {
        ok: true,
        slug,
        clinicId: result.clinicId,
        clinicUrl: clinicUrl(slug),
        trialDays: plan.trial_days,
      },
      { status: 201 }
    )
  } catch (error) {
    /**
     * Two different UNIQUE constraints can fire here, and the customer needs to
     * know WHICH — "that did not work" would leave them guessing whether to
     * change their email or their web address.
     *
     * Catching the constraint rather than checking first is deliberate: between
     * a check and an insert, another signup can always take the same slug. See
     * app/api/register/route.js for the same reasoning at more length.
     */
    if (isDuplicateError(error)) {
      const taken = await queryOne('SELECT id FROM clinics WHERE slug = ?', [slug])
      if (taken) {
        return NextResponse.json(
          {
            error: 'That web address is already taken.',
            errors: { slug: 'Already taken — try adding your city, e.g. yourclinic-pune' },
          },
          { status: 409 }
        )
      }
      return NextResponse.json(
        {
          error: 'An account with that email already exists.',
          errors: { email: 'Already registered — sign in instead.' },
        },
        { status: 409 }
      )
    }

    console.error('[signup] unexpected error:', error)
    return NextResponse.json(
      { error: 'Something went wrong creating your clinic. Please try again.' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/signup?slug=aarogya — is this web address free?
 *
 * Used by the signup form as the person types, so they find out before pressing
 * the button rather than after filling in the whole form.
 */
export async function GET(request) {
  const slug = new URL(request.url).searchParams.get('slug')

  const check = validateSlug(slug)
  if (!check.ok) return NextResponse.json({ available: false, reason: check.error })

  const existing = await queryOne('SELECT id FROM clinics WHERE slug = ?', [check.slug])

  return NextResponse.json({
    available: !existing,
    slug: check.slug,
    url: clinicUrl(check.slug),
    reason: existing ? 'Already taken' : null,
  })
}
