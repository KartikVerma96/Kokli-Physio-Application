import { isIP } from 'node:net'

/**
 * ============================================================================
 *  THE CLIENT'S ADDRESS — for rate limits, never for anything that grants access
 * ============================================================================
 *  In production the app sits behind Nginx Proxy Manager (DEPLOYMENT.md §7),
 *  which sets two headers on every request it forwards:
 *
 *    X-Real-IP        the proxy's $remote_addr, written over whatever the client
 *                     sent.
 *
 *    X-Forwarded-For  whatever X-Forwarded-For the CLIENT sent, with that same
 *                     $remote_addr APPENDED at the end. Its first entry is
 *                     therefore whatever the client felt like typing.
 *
 *  This used to take that first entry. Behind a proxy that appends, that handed
 *  an attacker a fresh throttle bucket for every request — one invented header
 *  per password guess, and the sign-in throttle never engaged. (The earlier Caddy
 *  setup overwrote the header instead, which is why it was safe there.)
 *
 *  $remote_addr is only as honest as the proxy's realip settings. Out of the box
 *  NPM trusts an X-Real-IP sent from any private range and from every Cloudflare
 *  and CloudFront address — and anyone can send from Cloudflare's, with a free
 *  Worker. That is why Kokli's proxy hosts carry `set_real_ip_from 127.0.0.1;`
 *  (DEPLOYMENT.md §7d): set inside a server block it REPLACES the inherited list,
 *  so for Kokli no peer is trusted and $remote_addr is the real TCP peer. Without
 *  that line, a client choosing its own address is back.
 *
 *  So, in order of trust:
 *    1. X-Real-IP, when it is a real IP address
 *    2. the LAST X-Forwarded-For entry — the one the nearest proxy added
 *    3. null: no proxy and no socket address. (Next fills X-Forwarded-For from the
 *       socket, so in development this is usually ::1 or ::ffff:127.0.0.1.) The
 *       caller decides what null means; the per-email and per-number limits apply
 *       either way.
 *
 *  Never the first X-Forwarded-For entry.
 * ============================================================================
 */
export function clientIp(headers) {
  const real = headers?.get?.('x-real-ip')?.trim()
  // isIP() accepts an IPv6 zone ID ("fe80::1%eth0") of any length; no proxy ever
  // sends one, and the columns this lands in are VARCHAR(45).
  if (real && isIP(real) && !real.includes('%')) return real.slice(0, 45)

  const hops = (headers?.get?.('x-forwarded-for') || '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean)
  const nearest = hops[hops.length - 1]
  // 45 characters is the longest textual IPv6 address, mapped IPv4 included.
  return nearest ? nearest.slice(0, 45) : null
}
