import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { runWhatsAppJobs } from '@/lib/whatsappJobs'

/**
 * ============================================================================
 *  POST /api/cron/whatsapp — send the scheduled messages
 * ============================================================================
 *
 *      curl -X POST https://yourdomain.com/api/cron/whatsapp \
 *           -H "Authorization: Bearer $CRON_SECRET"
 *
 *  RUN IT EVERY TEN MINUTES, NOT ONCE A NIGHTLY
 *  --------------------------------------------
 *  A reminder is time-sensitive in a way a subscription sweep is not. A clinic
 *  setting a 24-hour window expects the message roughly 24 hours before, and a
 *  once-daily job at 2am sends everything at 2am — which is both useless and the
 *  fastest way to have patients block the number.
 *
 *  Every job it runs selects only unhandled rows, so running often is free and
 *  running twice is harmless. See lib/whatsappJobs.js.
 *
 *  Same two ways in as the subscription sweep: the shared secret for a scheduler,
 *  or a signed-in platform account for the button in /platform.
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
    const result = await runWhatsAppJobs()
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[cron/whatsapp]', error)
    return NextResponse.json({ error: 'WhatsApp jobs failed' }, { status: 500 })
  }
}
