'use server'

/**
 * ============================================================================
 *  SERVER ACTIONS — updating the patient's profile
 * ============================================================================
 *
 *  WHAT A SERVER ACTION IS, AND WHY IT IS WORTH LEARNING
 *  ----------------------------------------------------
 *  The 'use server' directive at the top means every function exported from this
 *  file runs ON THE SERVER, even though a form in the browser calls it directly.
 *  Next.js creates the HTTP endpoint, serialises the arguments and wires it up.
 *
 *  Compare the two ways of saving a form:
 *
 *    API route            write app/api/profile/route.js, parse JSON, validate,
 *                         return a status; then in the component write fetch(),
 *                         set loading state, handle errors, parse the response
 *
 *    Server action        write this function; put it in the form's `action`
 *
 *  The second is less code, and — importantly for a learning project — the data
 *  never travels through a URL you have to remember to protect separately.
 *
 *  WHEN TO USE WHICH, IN THIS APP
 *  ------------------------------
 *  Server actions for forms that submit and reload: this profile, the admin
 *  editors, the clinical notes.
 *
 *  API routes for anything called repeatedly from live client state, or by a
 *  third party: /api/slots (called on every date tap), /api/payments/verify
 *  (called from Razorpay's callback), /api/payments/webhook (called by Razorpay's
 *  servers).
 *
 *  SECURITY WARNING WORTH INTERNALISING
 *  ------------------------------------
 *  A server action is a public HTTP endpoint. Next.js gives it an obfuscated id,
 *  but that is not a secret — anyone can find it in the page source and call it
 *  directly with any arguments they like.
 *
 *  So every action MUST re-check the session itself. Never assume "only the
 *  profile page calls this, and that page is behind a login". Treat each action
 *  as its own front door.
 * ============================================================================
 */

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { transaction } from '@/lib/db'
import { profileSchema, validate } from '@/lib/validation'

export async function updateProfile(previousState, formData) {
  /* ------------------------------------------------------- 1. who is this */
  // Not optional. See the security note above.
  const session = await auth()
  if (!session?.user) {
    return { ok: false, error: 'Your session has expired. Please sign in again.' }
  }

  /* ------------------------------------------------------- 2. read the form */
  // formData is a browser FormData object. Object.fromEntries turns it into a
  // plain object our Zod schema can validate.
  const raw = Object.fromEntries(formData)

  const result = validate(profileSchema, raw)
  if (!result.ok) {
    // Returned to the form, which renders each message under its own input.
    return { ok: false, errors: result.errors, error: 'Please check the highlighted fields.' }
  }

  const data = result.data

  /* ------------------------------------------------------------ 3. save it */
  try {
    await transaction(async (tx) => {
      // The name and phone live on `users`; everything clinical lives on
      // `patient_profiles`. Two tables, one transaction — a half-saved profile
      // would be confusing and hard to spot.
      await tx.execute(`UPDATE users SET name = ?, phone = ? WHERE id = ?`, [
        data.name,
        data.phone || null,
        session.user.id,
      ])

      /**
       * INSERT ... ON DUPLICATE KEY UPDATE — MySQL's "upsert".
       *
       * A patient who registered through Google has no patient_profiles row yet,
       * so a plain UPDATE would silently affect zero rows and appear to save
       * nothing. This inserts if the row is missing and updates if it is there,
       * in one statement, with no race between checking and writing.
       */
      await tx.execute(
        `INSERT INTO patient_profiles
           (user_id, date_of_birth, gender, address, city, occupation, height_cm, weight_kg,
            emergency_contact_name, emergency_contact_phone,
            medical_history, current_medications, allergies)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           date_of_birth = VALUES(date_of_birth),
           gender = VALUES(gender),
           address = VALUES(address),
           city = VALUES(city),
           occupation = VALUES(occupation),
           height_cm = VALUES(height_cm),
           weight_kg = VALUES(weight_kg),
           emergency_contact_name = VALUES(emergency_contact_name),
           emergency_contact_phone = VALUES(emergency_contact_phone),
           medical_history = VALUES(medical_history),
           current_medications = VALUES(current_medications),
           allergies = VALUES(allergies)`,
        [
          session.user.id,
          // Empty strings become NULL. An empty string in a DATE column is an
          // error in strict mode, and in every other column NULL is the honest
          // representation of "not answered".
          blank(data.dateOfBirth),
          blank(data.gender),
          blank(data.address),
          blank(data.city),
          blank(data.occupation),
          blank(data.heightCm),
          blank(data.weightKg),
          blank(data.emergencyContactName),
          blank(data.emergencyContactPhone),
          blank(data.medicalHistory),
          blank(data.currentMedications),
          blank(data.allergies),
        ]
      )
    })

    /**
     * Throw away Next.js's cached render of these pages so the new name shows up
     * immediately. Without this, the sidebar and the dashboard greeting would
     * keep saying the old name until something else happened to rebuild them.
     */
    revalidatePath('/dashboard/profile')
    revalidatePath('/dashboard')

    return { ok: true, message: 'Your details have been saved.' }
  } catch (error) {
    console.error('[updateProfile] error:', error)
    return { ok: false, error: 'Could not save your details. Please try again.' }
  }
}

/** '' → null. Keeps the SQL above readable. */
function blank(value) {
  return value === '' || value === undefined ? null : value
}
