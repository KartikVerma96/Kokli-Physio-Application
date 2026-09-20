import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { transaction, isDuplicateError } from '@/lib/db'
import { registerSchema, validateRequest } from '@/lib/validation'
import { getCurrentClinic } from '@/lib/tenant'

/**
 * ============================================================================
 *  POST /api/register — create a patient account
 * ============================================================================
 *
 *  A "route handler": a file called route.js that exports a function named after
 *  an HTTP method. This one only answers POST, so a GET to the same URL returns
 *  405 Method Not Allowed automatically.
 *
 *  THE THREE THINGS THIS FILE GETS RIGHT, AND WHY EACH MATTERS
 *  ----------------------------------------------------------
 *  1. It validates everything again, server-side. The browser already checked,
 *     but the browser is under the user's control. `curl` does not run your
 *     React validation.
 *
 *  2. It hashes the password with bcrypt and stores only the hash. If this
 *     database is ever leaked, the attacker gets 60-character hashes, not
 *     passwords — which matters enormously because people reuse passwords, so a
 *     plain-text leak here would compromise their email and bank too.
 *
 *  3. It catches the UNIQUE constraint violation instead of checking first.
 *     See the comment on that catch block below.
 *
 *  A PATIENT BELONGS TO ONE CLINIC
 *  -------------------------------
 *  The clinic comes from the HOSTNAME the request arrived on, never from the
 *  request body. Someone registering at aarogya.kokli.in becomes a patient
 *  of Aarogya and nowhere else — and because the body cannot name a clinic,
 *  there is no way to register yourself into somebody else's.
 *
 *  Registering separately at each clinic is the correct model for healthcare,
 *  not an inconvenience to design around: your physiotherapist in Pune has no
 *  business seeing the notes written about you by a clinic in Delhi.
 * ============================================================================
 */

export async function POST(request) {
  /* -------------------------------------------------------------- 0. which clinic */
  const clinic = await getCurrentClinic()
  if (!clinic) {
    // The platform's own marketing site has no patients — only clinics do. A
    // POST here means somebody found the endpoint on the wrong hostname.
    return NextResponse.json(
      { error: 'Patient accounts are created on a clinic’s own website.' },
      { status: 404 }
    )
  }

  // ------------------------------------------------------------- 1. validate
  const result = await validateRequest(registerSchema, request)
  if (!result.ok) {
    // 422 Unprocessable Entity is the precise status for "I understood the
    // request, but the data in it is not acceptable". 400 would also be
    // defensible; 500 would be wrong, because nothing broke.
    return NextResponse.json(
      { error: 'Please check the highlighted fields.', errors: result.errors },
      { status: 422 }
    )
  }

  const { name, email, phone, password } = result.data

  try {
    // ----------------------------------------------------------- 2. hash it
    /**
     * bcrypt with a cost factor of 10.
     *
     * The cost is deliberately slow — about 60ms per hash. That is invisible to
     * the person registering but makes brute-forcing a stolen hash database
     * impractical: an attacker who could try billions of plain SHA-256 guesses
     * per second manages a few thousand against bcrypt.
     *
     * bcrypt also generates and embeds a random salt automatically, so two
     * patients who both pick "physio123" get completely different hashes. That
     * defeats rainbow tables, and it is why you must never "helpfully" hash the
     * password yourself before calling bcrypt.
     */
    const passwordHash = await bcrypt.hash(password, 10)

    // -------------------------------------------------- 3. insert atomically
    // Two inserts — the user and their (empty) clinical profile — wrapped in a
    // transaction so a failure cannot leave a user row with no profile.
    const userId = await transaction(async (tx) => {
      const [insert] = await tx.execute(
        `INSERT INTO users (clinic_id, name, email, password_hash, phone, role)
         VALUES (?, ?, ?, ?, ?, 'patient')`,
        [clinic.id, name, email, passwordHash, phone || null]
      )

      // patient_profiles has no clinic_id of its own — it hangs off the user,
      // and the user carries the tenancy. One place to be right about it.
      await tx.execute(
        `INSERT INTO patient_profiles (user_id) VALUES (?)`,
        [insert.insertId]
      )

      return insert.insertId
    })

    // Deliberately minimal response. There is no reason to echo back anything
    // about the account, and an API that returns less is an API that leaks less.
    return NextResponse.json({ ok: true, userId }, { status: 201 })
  } catch (error) {
    /**
     * WHY WE CATCH THE DUPLICATE INSTEAD OF CHECKING FIRST
     *
     * The obvious approach is:
     *     if (await emailExists(email)) return error
     *     await insertUser()
     *
     * Two requests with the same email arriving at the same moment both pass
     * that check, and both insert. You end up with two accounts for one email,
     * and now nobody can log in deterministically.
     *
     * Letting MySQL's UNIQUE index be the referee removes the gap entirely,
     * because the constraint is checked and the row written in one atomic
     * operation. This is a general principle: prefer a database constraint over
     * an application-level check for anything that must be unique.
     */
    if (isDuplicateError(error)) {
      return NextResponse.json(
        {
          // Emails are unique across the whole platform, so this also fires when
          // the address is registered at a DIFFERENT clinic. The wording avoids
          // confirming which — that would leak that a given person is a patient
          // somewhere, which is exactly the sort of thing a clinic must not say.
          error: 'An account with that email already exists.',
          errors: { email: 'This email is already registered — try signing in instead.' },
        },
        { status: 409 }   // 409 Conflict
      )
    }

    // Anything else is genuinely our fault. Log the detail for us, and tell the
    // patient nothing — a stack trace or SQL error in the response is a gift to
    // an attacker mapping out your database.
    console.error('[register] unexpected error:', error)
    return NextResponse.json(
      { error: 'Something went wrong on our side. Please try again in a moment.' },
      { status: 500 }
    )
  }
}
