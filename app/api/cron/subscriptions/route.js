import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sweepSubscriptions } from '@/lib/subscriptionLifecycle'

/**
 * ============================================================================
 *  POST /api/cron/subscriptions — persist derived subscription statuses
 * ============================================================================
 *
 *  Writes each clinic's derived status back to the database so the platform
 *  admin, MRR and churn figures are accurate.
 *
 *  IMPORTANT: THIS IS NOT WHAT ENFORCES ANYTHING.
 *  Enforcement is derived on read in lib/subscriptionLifecycle.js, so a lapsed
 *  clinic is blocked from taking bookings the instant its trial expires, whether
 *  or not this ever runs. If the scheduler dies, the numbers go stale — nothing
 *  becomes insecure. That separation is deliberate.
 *
 *  TWO WAYS TO CALL IT
 *  -------------------
 *    A scheduler, with the shared secret:
 *        curl -X POST https://yourdomain.com/api/cron/subscriptions \
 *             -H "Authorization: Bearer $CRON_SECRET"
 *
 *    Or signed in as platform staff, from the button in /platform.
 *
 *  Without CRON_SECRET set, the header route is refused outright rather than
 *  left open — an unauthenticated endpoint that mutates every clinic's status is
 *  not something to leave lying around because a variable was forgotten.
 * ============================================================================
 */

export async function POST(request) {
  const secret = process.env.CRON_SECRET
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

  const viaSecret = Boolean(secret) && provided === secret

  let viaSession = false
  if (!viaSecret) {
    const session = await auth()
    viaSession = session?.user?.role === 'platform'
  }

  if (!viaSecret && !viaSession) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 })
  }

  try {
    const result = await sweepSubscriptions()
    if (result.changed > 0) {
      console.log('[cron/subscriptions]', JSON.stringify(result.changes))
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[cron/subscriptions]', error)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
