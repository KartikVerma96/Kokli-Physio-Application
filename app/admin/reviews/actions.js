'use server'

/**
 * Approve or unpublish a patient review.
 *
 * Publishing changes what search engines see (Review structured data on the
 * homepage), so the homepage is revalidated on every change.
 */

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { query } from '@/lib/db'

/**
 * Throws unless the caller is staff OF THIS CLINIC.
 *
 * The clinic comes from the hostname, the role from the session, and both must
 * agree. Checking the role alone is not authorisation on a multi-tenant app:
 * session cookies span the parent domain, so a valid staff session from another
 * clinic arrives here looking perfectly legitimate. See the long note in
 * app/admin/appointments/[id]/actions.js.
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

export async function setReviewPublished(reviewId, isPublished) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  try {
    // Without `AND clinic_id = ?` a clinic could unpublish a competitor's
    // five-star reviews, or publish one the competitor had deliberately rejected.
    const result = await query(
      'UPDATE reviews SET is_published = ? WHERE id = ? AND clinic_id = ?',
      [isPublished ? 1 : 0, reviewId, clinic.id]
    )
    if (result.affectedRows === 0) return { ok: false, error: 'That review could not be found.' }

    revalidatePath('/admin/reviews')
    // The homepage renders the testimonials AND the aggregate rating schema.
    revalidatePath('/')
    revalidatePath('/about')

    return {
      ok: true,
      message: isPublished
        ? 'Review published — it is now on the homepage.'
        : 'Review unpublished and removed from the website.',
    }
  } catch (error) {
    console.error('[setReviewPublished] error:', error)
    return { ok: false, error: 'Could not update that review.' }
  }
}

export async function deleteReview(reviewId) {
  let clinic
  try {
    ;({ clinic } = await requireStaff())
  } catch {
    return { ok: false, error: 'You are not allowed to do that.' }
  }

  try {
    const result = await query('DELETE FROM reviews WHERE id = ? AND clinic_id = ?', [
      reviewId,
      clinic.id,
    ])
    if (result.affectedRows === 0) return { ok: false, error: 'That review could not be found.' }

    revalidatePath('/admin/reviews')
    revalidatePath('/')

    return { ok: true, message: 'Review deleted.' }
  } catch (error) {
    console.error('[deleteReview] error:', error)
    return { ok: false, error: 'Could not delete that review.' }
  }
}
