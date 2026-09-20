'use server'

/**
 * ============================================================================
 *  ONBOARDING — the server actions that set a new clinic up
 * ============================================================================
 *
 *  Four steps, four actions, one shared rule: every one re-checks that the
 *  caller is an admin OF THIS CLINIC before it writes anything.
 *
 *  A server action is a public HTTP endpoint with an obfuscated name. Next.js
 *  does not protect it for you, and "only the onboarding page calls this, and
 *  that page is behind a login" is not a security control — anyone can find the
 *  action id in the page source and call it directly with any arguments.
 * ============================================================================
 */

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { query, transaction } from '@/lib/db'
import { encryptSecret, isEncryptionConfigured } from '@/lib/crypto'
import { clinicDetailsSchema, razorpayKeysSchema, validate } from '@/lib/validation'
import { slugify } from '@/lib/utils'

/**
 * The guard every action starts with.
 *
 * Returns the clinic, or throws. Note it resolves the clinic from the HOSTNAME
 * and compares it against the SESSION — never trusting a clinic id from the
 * caller, which would let one clinic's admin write into another's row.
 */
async function requireClinicAdmin() {
  const clinic = await getCurrentClinic()
  if (!clinic) throw new Error('NO_CLINIC')

  const session = await auth()
  const user = session?.user
  if (!user) throw new Error('UNAUTHENTICATED')

  if (user.role === 'platform') return { clinic, user }
  if (user.role !== 'admin') throw new Error('FORBIDDEN')
  if (Number(user.clinicId) !== Number(clinic.id)) throw new Error('FORBIDDEN')

  return { clinic, user }
}

/** Turn a thrown guard error into a message a person can act on. */
function guardFailure(error) {
  const messages = {
    NO_CLINIC: 'This clinic could not be found.',
    UNAUTHENTICATED: 'Your session has expired. Please sign in again.',
    FORBIDDEN: 'Only the clinic administrator can do that.',
  }
  return { ok: false, error: messages[error.message] || 'Something went wrong.' }
}

const blank = (v) => (v === '' || v === undefined ? null : v)

/* ========================================================================== */
/*  STEP 1 — the clinic's public details                                      */
/* ========================================================================== */

export async function saveClinicDetails(previousState, formData) {
  let clinic
  try {
    ;({ clinic } = await requireClinicAdmin())
  } catch (error) {
    return guardFailure(error)
  }

  const result = validate(clinicDetailsSchema, Object.fromEntries(formData))
  if (!result.ok) {
    return { ok: false, errors: result.errors, error: 'Please check the highlighted fields.' }
  }
  const d = result.data

  try {
    await query(
      `UPDATE clinics SET
         name = ?, legal_name = ?, tagline = ?, description = ?,
         phone = ?, whatsapp = ?, email = ?,
         address_line1 = ?, address_line2 = ?, city = ?, state = ?, postal_code = ?,
         latitude = ?, longitude = ?,
         maps_url = CASE WHEN ? IS NOT NULL AND ? IS NOT NULL
                         THEN CONCAT('https://maps.google.com/?q=', ?, ',', ?)
                         ELSE maps_url END,
         brand_colour = COALESCE(?, brand_colour),
         practitioner_name = ?, practitioner_credentials = ?, practitioner_registration = ?,
         practitioner_experience_years = ?, practitioner_bio = ?,
         onboarding_step = CASE WHEN onboarding_step = 'details' THEN 'services' ELSE onboarding_step END
       WHERE id = ?`,
      [
        d.name, blank(d.legalName) || d.name, blank(d.tagline), blank(d.description),
        blank(d.phone), blank(d.whatsapp), blank(d.email),
        blank(d.addressLine1), blank(d.addressLine2), blank(d.city), blank(d.state), blank(d.postalCode),
        blank(d.latitude), blank(d.longitude),
        blank(d.latitude), blank(d.longitude), blank(d.latitude), blank(d.longitude),
        blank(d.brandColour),
        blank(d.practitionerName), blank(d.practitionerCredentials), blank(d.practitionerRegistration),
        blank(d.practitionerExperienceYears), blank(d.practitionerBio),
        clinic.id,
      ]
    )

    // The clinic's own website reads all of this, so every one of its pages is
    // now stale.
    revalidatePath('/', 'layout')

    return { ok: true, message: 'Clinic details saved.' }
  } catch (error) {
    console.error('[onboarding/details]', error)
    return { ok: false, error: 'Could not save your details. Please try again.' }
  }
}

/* ========================================================================== */
/*  STEP 2 — treatments and prices                                            */
/* ========================================================================== */

/**
 * Add one treatment.
 *
 * The slug is derived from the name and de-duplicated per clinic, because two
 * treatments called "Back Pain" in the same clinic would otherwise collide on
 * the UNIQUE (clinic_id, slug) index and throw a raw database error at someone
 * who has done nothing wrong.
 */
export async function addService(previousState, formData) {
  let clinic
  try {
    ;({ clinic } = await requireClinicAdmin())
  } catch (error) {
    return guardFailure(error)
  }

  const name = String(formData.get('name') || '').trim()
  const shortDescription = String(formData.get('shortDescription') || '').trim()
  const priceRupees = Number(formData.get('priceRupees'))
  const durationMinutes = Number(formData.get('durationMinutes'))
  const availableOnline = formData.get('availableOnline') === 'on'

  const errors = {}
  if (name.length < 3) errors.name = 'Give the treatment a name'
  if (shortDescription.length < 10) errors.shortDescription = 'Write at least a sentence'
  if (!Number.isFinite(priceRupees) || priceRupees < 0) errors.priceRupees = 'Enter a price'
  if (!Number.isFinite(durationMinutes) || durationMinutes < 10) {
    errors.durationMinutes = 'At least 10 minutes'
  }
  if (Object.keys(errors).length) {
    return { ok: false, errors, error: 'Please check the highlighted fields.' }
  }

  try {
    const base = slugify(name).slice(0, 100) || 'treatment'
    const existing = await query('SELECT slug FROM services WHERE clinic_id = ?', [clinic.id])
    const taken = new Set(existing.map((r) => r.slug))

    let slug = base
    let n = 2
    while (taken.has(slug)) slug = `${base}-${n++}`

    await query(
      `INSERT INTO services
         (clinic_id, slug, name, short_description, price_paise, duration_minutes,
          available_online, available_clinic, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1,
               (SELECT COALESCE(MAX(s.sort_order), 0) + 1 FROM services s WHERE s.clinic_id = ?))`,
      [
        clinic.id, slug, name, shortDescription,
        // Rupees in the form, paise in the database. Converted once, here.
        Math.round(priceRupees * 100),
        durationMinutes,
        availableOnline ? 1 : 0,
        clinic.id,
      ]
    )

    await query(
      `UPDATE clinics SET onboarding_step = 'availability'
        WHERE id = ? AND onboarding_step = 'services'`,
      [clinic.id]
    )

    revalidatePath('/', 'layout')
    return { ok: true, message: `${name} added.` }
  } catch (error) {
    console.error('[onboarding/addService]', error)
    return { ok: false, error: 'Could not add that treatment.' }
  }
}

export async function removeService(serviceId) {
  let clinic
  try {
    ;({ clinic } = await requireClinicAdmin())
  } catch (error) {
    return guardFailure(error)
  }

  try {
    /**
     * Deleted only if nothing has ever been booked against it.
     *
     * `services` is referenced by `appointments` with ON DELETE RESTRICT, so a
     * booked treatment cannot be removed anyway — but a raw foreign-key error is
     * a terrible thing to show a clinic owner. Checking first lets us explain,
     * and deactivating is the correct action: the treatment disappears from the
     * website while the historical appointments keep their name and price.
     */
    const [used] = await query(
      'SELECT COUNT(*) AS n FROM appointments WHERE clinic_id = ? AND service_id = ?',
      [clinic.id, serviceId]
    )

    if (used.n > 0) {
      await query('UPDATE services SET is_active = 0 WHERE id = ? AND clinic_id = ?', [
        serviceId,
        clinic.id,
      ])
      revalidatePath('/', 'layout')
      return {
        ok: true,
        message: 'Hidden from your website. It has past bookings, so the record is kept.',
      }
    }

    await query('DELETE FROM services WHERE id = ? AND clinic_id = ?', [serviceId, clinic.id])
    revalidatePath('/', 'layout')
    return { ok: true, message: 'Treatment removed.' }
  } catch (error) {
    console.error('[onboarding/removeService]', error)
    return { ok: false, error: 'Could not remove that treatment.' }
  }
}

/* ========================================================================== */
/*  STEP 3 — working hours                                                    */
/* ========================================================================== */

/**
 * Replace the whole weekly timetable in one go.
 *
 * Wholesale replacement rather than a diff, inside a transaction. The form
 * submits the complete week, so working out which rules changed would be more
 * code and more ways to be wrong — and a half-applied timetable would show
 * patients slots the physio is not actually working.
 */
export async function saveWorkingHours(previousState, formData) {
  let clinic
  try {
    ;({ clinic } = await requireClinicAdmin())
  } catch (error) {
    return guardFailure(error)
  }

  const [physio] = await query(
    `SELECT id FROM users WHERE clinic_id = ? AND role = 'physio' ORDER BY id LIMIT 1`,
    [clinic.id]
  )
  if (!physio) return { ok: false, error: 'No physiotherapist on this clinic yet.' }

  // Build the week from the flat form fields: day-1-open, day-1-start, …
  const rules = []
  for (let weekday = 0; weekday <= 6; weekday++) {
    if (formData.get(`day-${weekday}-open`) !== 'on') continue

    const start = String(formData.get(`day-${weekday}-start`) || '')
    const end = String(formData.get(`day-${weekday}-end`) || '')
    const mode = String(formData.get(`day-${weekday}-mode`) || 'both')

    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) continue
    if (end <= start) {
      return {
        ok: false,
        error: `${DAY_NAMES[weekday]}: the finish time must be after the start time.`,
      }
    }

    rules.push({ weekday, start: `${start}:00`, end: `${end}:00`, mode })
  }

  if (rules.length === 0) {
    return { ok: false, error: 'Open on at least one day, or patients cannot book anything.' }
  }

  try {
    await transaction(async (tx) => {
      await tx.execute('DELETE FROM availability_rules WHERE clinic_id = ? AND physio_id = ?', [
        clinic.id,
        physio.id,
      ])
      for (const rule of rules) {
        await tx.execute(
          `INSERT INTO availability_rules
             (clinic_id, physio_id, weekday, start_time, end_time, slot_minutes, mode)
           VALUES (?, ?, ?, ?, ?, 30, ?)`,
          [clinic.id, physio.id, rule.weekday, rule.start, rule.end, rule.mode]
        )
      }
      await tx.execute(
        `UPDATE clinics SET onboarding_step = 'payments'
          WHERE id = ? AND onboarding_step IN ('services', 'availability')`,
        [clinic.id]
      )
    })

    revalidatePath('/', 'layout')
    return { ok: true, message: `Open ${rules.length} day${rules.length === 1 ? '' : 's'} a week.` }
  } catch (error) {
    console.error('[onboarding/hours]', error)
    return { ok: false, error: 'Could not save your working hours.' }
  }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/* ========================================================================== */
/*  STEP 4 — connect the clinic's own Razorpay account                        */
/* ========================================================================== */

export async function saveRazorpayKeys(previousState, formData) {
  let clinic
  try {
    ;({ clinic } = await requireClinicAdmin())
  } catch (error) {
    return guardFailure(error)
  }

  // Refuse rather than store a secret in plain text. A misconfigured server must
  // not quietly downgrade the security of somebody else's payment credentials.
  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      error:
        'The platform is missing its encryption key, so payment credentials cannot be stored safely. Please contact support.',
    }
  }

  const result = validate(razorpayKeysSchema, Object.fromEntries(formData))
  if (!result.ok) {
    return { ok: false, errors: result.errors, error: 'Please check the highlighted fields.' }
  }
  const { keyId, keySecret, webhookSecret } = result.data

  try {
    await query(
      `UPDATE clinics SET
         razorpay_key_id = ?,
         razorpay_key_secret_enc = ?,
         razorpay_webhook_secret_enc = ?,
         payments_connected_at = NOW(),
         onboarding_step = 'done',
         onboarding_completed_at = COALESCE(onboarding_completed_at, NOW())
       WHERE id = ?`,
      [
        keyId,
        // Encrypted at rest — see lib/crypto.js for why this is encryption and
        // not hashing.
        encryptSecret(keySecret),
        encryptSecret(blank(webhookSecret)),
        clinic.id,
      ]
    )

    revalidatePath('/', 'layout')
    return {
      ok: true,
      message: keyId.startsWith('rzp_test_')
        ? 'Connected in TEST mode. Swap in your live keys when you are ready to take real payments.'
        : 'Payments connected. Patients can now pay you directly.',
    }
  } catch (error) {
    console.error('[onboarding/razorpay]', error)
    return { ok: false, error: 'Could not save your payment keys.' }
  }
}

/** Skip payments for now and finish. */
export async function finishOnboarding() {
  let clinic
  try {
    ;({ clinic } = await requireClinicAdmin())
  } catch (error) {
    return guardFailure(error)
  }

  await query(
    `UPDATE clinics SET onboarding_step = 'done',
                        onboarding_completed_at = COALESCE(onboarding_completed_at, NOW())
      WHERE id = ?`,
    [clinic.id]
  )
  revalidatePath('/', 'layout')
  return { ok: true, message: 'Setup complete.' }
}
