import { pool } from '@/lib/db'

/**
 * ============================================================================
 *  HEALTH CHECK  →  GET /api/health
 * ============================================================================
 *  The one question a deploy has to ask of a freshly started container: "are
 *  you actually serving?" Three things ask it:
 *
 *    * Docker's HEALTHCHECK, every 30 seconds, for as long as the container runs
 *    * the Jenkins deploy, right after it swaps the container — a "no" there
 *      puts the previous version back automatically
 *    * you, with `curl https://kokli.in/api/health`, to see which commit is live
 *
 *  WHY NOT JUST LOAD THE HOMEPAGE?
 *  -------------------------------
 *  That used to be the check. It works, but it renders a whole page, depends on
 *  the plans table having rows, and goes through the tenant routing — so a
 *  failure could mean any of a dozen things. This answers exactly two: is the
 *  Node process up, and can it reach MySQL. An app that cannot reach its
 *  database is not healthy, however nicely it is still rendering error pages.
 *
 *  WHAT IT DOES NOT SAY
 *  --------------------
 *  Nothing about clinics, users or configuration — anyone on the internet can
 *  call this. The commit id is the only detail, and it is not a secret: it is
 *  what lets you confirm a deploy landed without signing in to anything.
 * ============================================================================
 */

// Never cached. A cached "healthy" is worse than no health check at all.
export const dynamic = 'force-dynamic'

// Docker gives the whole check 5 seconds. Answer before that, so a hung
// database shows up as a clear 503 rather than an anonymous timeout.
const DB_TIMEOUT_MS = 3000

export async function GET() {
  // Baked into the image by the Dockerfile from the commit Jenkins built.
  const version = process.env.KOKLI_VERSION || 'dev'
  const headers = { 'cache-control': 'no-store' }

  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('database timeout')), DB_TIMEOUT_MS)
      ),
    ])
    return Response.json({ ok: true, version }, { headers })
  } catch {
    // 503, not 500: "temporarily unable", which is what a load balancer or a
    // deploy script should hear. The error itself stays in the server log.
    return Response.json({ ok: false, version, database: 'unreachable' }, { status: 503, headers })
  }
}
