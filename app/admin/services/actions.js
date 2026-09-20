'use server'

/**
 * ============================================================================
 *  SERVER ACTIONS — services and pricing
 * ============================================================================
 *  Editing a service changes the public website: the homepage, the services page,
 *  the individual treatment page, the navigation dropdown and the sitemap all read
 *  from this table. That is exactly why services live in the database rather than
 *  in a hard-coded array — your sister can add a treatment without a developer.
 * ============================================================================
 */

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { query, queryOne, isDuplicateError } from '@/lib/db'
import { serviceSchema, validate } from '@/lib/validation'
import { toPaise } from '@/lib/utils'

/**
 * Throws unless the caller is staff OF THIS CLINIC.
 *
 * The clinic comes from the hostname, the role from the session, and both must
 * agree — see the long note in app/admin/appointments/[id]/actions.js. On this
 * page the stakes are a competitor's price list: the UPDATE below is keyed on an
 * id from the form, so role-only authorisation let one clinic rewrite another's
 * treatments and prices.
 */
async function requireStaff() {
  const clinic = await getCurrentClinic()
  if (!clinic) throw new Error('NO_CLINIC')

  const session = await auth()
  if (!session?.user) throw new Error('UNAUTHENTICATED')
  if (!['admin', 'physio'].includes(session.user.role)) throw new Error('FORBIDDEN')
  if (Number(session.user.clinicId) !== Number(clinic.id)) throw new Error('FORBIDDEN')

  return { user: session.user, clinic }
}

/**
 * Every page that displays services has to be revalidated, or an edit appears in
 * some places and not others — which looks like a bug to whoever made the change.
 */
function refresh(slug) {
  revalidatePath('/admin/services')
  revalidatePath('/')
  revalidatePath('/services')
  revalidatePath('/book')
  revalidatePath('/sitemap.xml')
  if (slug) revalidatePath(`/services/${slug}`)
}

/* ========================================================================== */
/*  CREATE / UPDATE                                                           */
/* ========================================================================== */

export async function saveService(previousState, formData) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  const serviceId = formData.get('serviceId')

  const result = validate(serviceSchema, {
    name: formData.get('name'),
    slug: formData.get('slug'),
    shortDescription: formData.get('shortDescription'),
    description: formData.get('description'),
    icon: formData.get('icon'),
    durationMinutes: formData.get('durationMinutes'),
    priceRupees: formData.get('priceRupees'),
    // An unchecked HTML checkbox sends NOTHING at all, so its absence is what
    // means false. Reading it as `=== 'on'` handles both cases correctly.
    availableOnline: formData.get('availableOnline') === 'on',
    availableClinic: formData.get('availableClinic') === 'on',
    availableHome: formData.get('availableHome') === 'on',
    homePriceRupees: formData.get('homePriceRupees') ?? '',
    isActive: formData.get('isActive') === 'on',
    seoTitle: formData.get('seoTitle'),
    seoDescription: formData.get('seoDescription'),
  })

  if (!result.ok) {
    return { ok: false, errors: result.errors, error: 'Please check the highlighted fields.' }
  }

  const data = result.data

  // A service that can be delivered neither in the clinic nor online cannot be
  // booked at all — it would appear on the website and then offer no slots ever.
  if (!data.availableOnline && !data.availableClinic && !data.availableHome) {
    return {
      ok: false,
      errors: { availableClinic: 'A service has to be available at least one way' },
      error: 'Choose in-clinic, online, or both.',
    }
  }

  // Rupees in the form, paise in the database. The conversion happens exactly once,
  // here — see the note on money in database/schema.sql.
  const pricePaise = toPaise(data.priceRupees)

  /**
   * A home visit is a different price, not a surcharge.
   *
   * NULL means "not priced for home" and the booking engine falls back to the
   * clinic price rather than booking a home visit for nothing — see priceFor() in
   * lib/slots.js. A clinic that offers home visits and forgets to price them gets
   * the clinic rate, which is wrong but not free.
   */
  const homePricePaise =
    data.availableHome && data.homePriceRupees !== '' && data.homePriceRupees != null
      ? toPaise(data.homePriceRupees)
      : null

  try {
    if (serviceId) {
      await query(
        `UPDATE services
            SET name = ?, slug = ?, short_description = ?, description = ?, icon = ?,
                duration_minutes = ?, price_paise = ?,
                available_online = ?, available_clinic = ?, available_home = ?,
                home_price_paise = ?, is_active = ?,
                seo_title = ?, seo_description = ?
          WHERE id = ? AND clinic_id = ?`,
        [
          data.name, data.slug, data.shortDescription, data.description || null,
          data.icon || 'Activity', data.durationMinutes, pricePaise,
          data.availableOnline ? 1 : 0, data.availableClinic ? 1 : 0,
          data.availableHome ? 1 : 0, homePricePaise, data.isActive ? 1 : 0,
          data.seoTitle || null, data.seoDescription || null,
          serviceId, clinic.id,
        ]
      )
    } else {
      // New services go to the end of the list.
      // Scoped, or a clinic with 40 treatments would push every other clinic's
      // new services to sort_order 41.
      const last = await queryOne(
        'SELECT MAX(sort_order) AS max_order FROM services WHERE clinic_id = ?',
        [clinic.id]
      )
      await query(
        `INSERT INTO services
           (clinic_id, name, slug, short_description, description, icon, duration_minutes,
            price_paise, available_online, available_clinic, available_home,
            home_price_paise, is_active, seo_title, seo_description, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          // NOT NULL with no default. Leaving it out did not degrade gracefully —
          // it made "add a treatment" fail every single time it was used.
          clinic.id,
          data.name, data.slug, data.shortDescription, data.description || null,
          data.icon || 'Activity', data.durationMinutes, pricePaise,
          data.availableOnline ? 1 : 0, data.availableClinic ? 1 : 0,
          data.availableHome ? 1 : 0, homePricePaise, data.isActive ? 1 : 0,
          data.seoTitle || null, data.seoDescription || null,
          (Number(last?.max_order) || 0) + 1,
        ]
      )
    }

    refresh(data.slug)

    return {
      ok: true,
      message: serviceId ? 'Service updated and live on the website.' : 'Service added and live on the website.',
    }
  } catch (error) {
    // The slug has a UNIQUE index because it is the page's URL. Two services with
    // the same slug would mean one of them was unreachable.
    if (isDuplicateError(error)) {
      return {
        ok: false,
        errors: { slug: 'Another service already uses that URL slug' },
        error: 'That URL slug is taken.',
      }
    }
    console.error('[saveService] error:', error)
    return { ok: false, error: 'Could not save the service.' }
  }
}

/* ========================================================================== */
/*  SHOW / HIDE                                                               */
/* ========================================================================== */

/**
 * Hide rather than delete.
 *
 * There is deliberately no delete action in this file. Appointments reference
 * services with ON DELETE RESTRICT, so MySQL would refuse anyway — and that
 * restriction is correct: deleting a service would orphan the record of what a
 * patient was actually treated for two years ago.
 *
 * Setting is_active = 0 removes it from the website and from booking while keeping
 * the history intact. That is almost always what "delete this service" really means.
 */
export async function toggleService(serviceId, isActive) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  try {
    const service = await queryOne('SELECT slug FROM services WHERE id = ? AND clinic_id = ?', [
      serviceId,
      clinic.id,
    ])
    if (!service) return { ok: false, error: 'That treatment could not be found.' }

    await query('UPDATE services SET is_active = ? WHERE id = ? AND clinic_id = ?', [
      isActive ? 1 : 0,
      serviceId,
      clinic.id,
    ])

    refresh(service?.slug)

    return {
      ok: true,
      message: isActive
        ? 'Service is visible on the website again.'
        : 'Service hidden. Existing appointments are unaffected.',
    }
  } catch (error) {
    console.error('[toggleService] error:', error)
    return { ok: false, error: 'Could not update the service.' }
  }
}
