import { auth } from '@/lib/auth'
import { getCurrentClinic } from '@/lib/tenant'
import { reportError } from '@/lib/errorLog'

/**
 * ============================================================================
 *  BROWSER ERRORS  →  POST /api/report-error
 * ============================================================================
 *  The error boundary in app/error.js runs in the browser, so it cannot write to
 *  MySQL itself. This is the one line of pipe between the two.
 *
 *  ============================================================================
 *  A PUBLIC ENDPOINT THAT WRITES TO THE DATABASE — HANDLE WITH CARE
 * ============================================================================
 *  Anyone can POST here. That makes it a way to fill a table with rubbish, so
 *  everything from the request is treated as hostile:
 *
 *    * The message is truncated hard, and the CLIENT'S stack is thrown away
 *      entirely — a browser stack is minified noise, and accepting arbitrary
 *      8KB strings from strangers is a storage-exhaustion invitation.
 *
 *    * The clinic comes from the HOSTNAME and the user from the SESSION. Neither
 *      is read from the body, so nobody can attribute their own noise to a real
 *      clinic or a real patient.
 *
 *    * The per-hour cap on distinct faults in lib/errorLog.js applies here too,
 *      which is the actual protection against a script in a loop.
 *
 *  It always answers 204, even on failure. A reporting endpoint that returns an
 *  error would make the error boundary itself show an error, and there is no
 *  useful thing the browser could do with the answer anyway.
 * ============================================================================
 */

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))

    const message = String(body?.message || '').trim().slice(0, 300)
    if (!message) return new Response(null, { status: 204 })

    const [clinic, session] = await Promise.all([getCurrentClinic(), auth()])

    await reportError({
      // A plain object, not an Error: `digest` is the id Next.js puts on the page
      // so a patient can quote it, and having it here is what connects a support
      // call to a row in this table.
      error: {
        message: body?.digest ? `${message} [digest ${String(body.digest).slice(0, 40)}]` : message,
        stack: null,
      },
      route: String(body?.route || '').slice(0, 300) || null,
      clinicId: clinic?.id ?? null,
      userId: session?.user?.id ? Number(session.user.id) : null,
      source: 'browser',
    })
  } catch {
    // Swallowed on purpose. See the note above.
  }

  return new Response(null, { status: 204 })
}
