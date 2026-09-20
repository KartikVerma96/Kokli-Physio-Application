'use server'

import { headers } from 'next/headers'
import { requireCurrentClinic } from '@/lib/tenant'
import { requestOtp, verifyOtp, issueLoginTicket } from '@/lib/otp'

/**
 * ============================================================================
 *  PHONE SIGN-IN — THE TWO SERVER ACTIONS
 * ============================================================================
 *  Step 1 sends a code. Step 2 checks it and hands back a signed ticket plus the
 *  list of accounts on that number, which the browser turns into an account
 *  picker before calling signIn('phone-otp', …).
 *
 *  WHY THESE ARE SERVER ACTIONS AND NOT API ROUTES
 *  ----------------------------------------------
 *  Both need the clinic from the hostname and the client address from the request
 *  headers, and neither must ever run in the browser. A server action gives both
 *  for free and cannot be imported into client code by accident.
 *
 *  WHAT THEY DELIBERATELY DO NOT RETURN
 *  ------------------------------------
 *  Never whether the number is registered. Step 1 returns the same success for a
 *  number with three patients on it and a number with none — otherwise this form
 *  becomes a way to check who attends a physiotherapy clinic, which is private
 *  medical information. The full reasoning is in lib/otp.js.
 * ============================================================================
 */

/** Step 1 — send a code to this number, if anybody is on it. */
export async function requestLoginCode({ phone }) {
  const clinic = await requireCurrentClinic()
  return requestOtp({ clinic, phone, ip: await clientAddress() })
}

/**
 * Step 2 — check the code.
 *
 * On success the code is spent and cannot be checked again, which is why this
 * returns a ticket: it is the proof that survives into the sign-in call. See the
 * long note above issueLoginTicket() in lib/otp.js.
 */
export async function confirmLoginCode({ phone, code }) {
  const clinic = await requireCurrentClinic()
  const result = await verifyOtp({ clinic, phone, code, ip: await clientAddress() })

  if (!result.ok) return { ok: false, message: result.message }

  return {
    ok: true,
    ticket: issueLoginTicket({
      clinicId: clinic.id,
      phone,
      userIds: result.users.map((u) => u.id),
    }),
    /**
     * Only what the picker needs to draw itself. No email, no phone — if
     * reception mistyped a digit and this reached the wrong person, they should
     * not be handed a patient's contact details as well.
     */
    accounts: result.users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
    })),
  }
}

/**
 * The client's address, for rate limiting.
 *
 * Behind a proxy the socket address is the proxy's, so `x-forwarded-for` is the
 * real one — but only when a proxy you control sets it. Locally there is none and
 * the header is absent, which is why null is an accepted answer: the per-number
 * limits still apply, and those are the ones that matter.
 */
async function clientAddress() {
  const store = await headers()
  const forwarded = store.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 45)
  return store.get('x-real-ip')?.slice(0, 45) || null
}
