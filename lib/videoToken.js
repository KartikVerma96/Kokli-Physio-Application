/**
 * ============================================================================
 *  VIDEO ROOM TOKENS
 * ============================================================================
 *
 *  THE PROBLEM THIS SOLVES
 *  -----------------------
 *  Socket.IO connects directly to the Node server, bypassing Next.js entirely.
 *  That means `auth()` is not available there — the signalling server has no idea
 *  who is connecting, and cannot read the session the way a page can.
 *
 *  Without something, anyone who learned a room id could connect to it and sit
 *  silently inside a private medical consultation.
 *
 *  THE SOLUTION
 *  ------------
 *  The consultation page IS a Server Component, so it can check the session and
 *  confirm this person owns this appointment. Having done that, it mints a
 *  short-lived signed token and passes it to the browser. The browser presents
 *  that token when it opens the socket, and the signalling server verifies the
 *  signature.
 *
 *  This is the same idea as a JWT, written out longhand so the mechanism is
 *  visible rather than hidden inside a library:
 *
 *      payload   {roomId, userId, name, role, exp}   base64url encoded
 *      signature HMAC-SHA256(payload, AUTH_SECRET)   base64url encoded
 *      token     payload.signature
 *
 *  The payload is only ENCODED, not encrypted — anyone can read it. That is fine;
 *  it contains nothing secret. What matters is that nobody can CHANGE it, because
 *  altering one byte invalidates the signature, and producing a valid signature
 *  requires AUTH_SECRET, which never leaves the server.
 *
 *  Tokens expire after two hours: long enough for a consultation that overruns,
 *  short enough that a leaked link is useless by tomorrow.
 *
 *  MODULE STYLE: this file is CommonJS, because server.js is run directly by Node
 *  and uses require(). Next.js happily imports CommonJS from app code, so the
 *  same single implementation serves both — which matters, since a signing and a
 *  verifying function that drift apart is a genuinely nasty bug.
 * ============================================================================
 */

const crypto = require('node:crypto')

const TOKEN_TTL_SECONDS = 2 * 60 * 60

function secret() {
  const value = process.env.AUTH_SECRET
  if (!value) {
    // Failing loudly is right. A signing key that silently defaults to an empty
    // string produces tokens anyone can forge.
    throw new Error('AUTH_SECRET is not set — video room tokens cannot be signed.')
  }
  return value
}

/** base64url: like base64, but safe to put in a URL or a header. */
function encode(value) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
}

/**
 * Mint a token. Called from the consultation page, AFTER it has verified that
 * this user is a participant in this appointment.
 */
function createVideoToken({ roomId, userId, name, role, appointmentId }) {
  const payload = encode(
    JSON.stringify({
      roomId,
      userId: String(userId),
      name,
      // 'patient' or 'physio' — the UI labels the other person's tile with it.
      role,
      appointmentId: String(appointmentId),
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    })
  )

  return `${payload}.${sign(payload)}`
}

/**
 * Verify a token and return its contents, or null.
 *
 * Returns null for every failure rather than throwing, so the caller has exactly
 * one thing to check.
 */
function verifyVideoToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null

  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null

  // Recompute the signature and compare in constant time. See the note on
  // timing attacks in lib/razorpay.js — same reasoning, same habit.
  let expected
  try {
    expected = sign(payload)
  } catch {
    return null
  }

  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return null
  if (!crypto.timingSafeEqual(a, b)) return null

  let data
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  // The signature being valid is not enough — an expired token is a valid
  // signature over stale claims.
  if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null
  if (!data.roomId || !data.userId) return null

  return data
}

module.exports = { createVideoToken, verifyVideoToken, TOKEN_TTL_SECONDS }
