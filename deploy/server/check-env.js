/**
 * ============================================================================
 *  CHECK THE PRODUCTION ENV FILE — without printing a single value
 * ============================================================================
 *      node deploy/server/check-env.js ~/kokli/.env.local
 *
 *  On a server with no Node of its own, through the app's image:
 *
 *      docker run --rm -v ~/kokli/.env.local:/env:ro \
 *        -v "$PWD/deploy/server/check-env.js:/check.js:ro" \
 *        node:24-bookworm-slim node /check.js /env
 *
 *  It prints key names and verdicts only, so its output is safe to paste
 *  anywhere. Exit code 1 means something must be fixed before a deploy.
 *
 *  WHY IT EXISTS
 *  -------------
 *  Nothing in the app checks most of these at start-up. A placeholder secret
 *  works — and makes sessions forgeable. A wrong-length encryption key passes
 *  every health check and fails the day a clinic connects Razorpay. AUTH_URL,
 *  set "to be safe", silently breaks Google sign-in on every clinic. Each of
 *  those is one line in a text file, and each is cheaper to catch here.
 * ============================================================================
 */

const fs = require('node:fs')

const file = process.argv[2]
if (!file) {
  console.error('Usage: node check-env.js <path to .env.local>')
  process.exit(2)
}

const env = {}
const bad = []
const notes = []

fs.readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
  const n = i + 1
  if (raw.endsWith('\r')) bad.push(`line ${n}: Windows line ending (CRLF)`)
  const line = raw.replace(/\r$/, '')
  if (!line.trim() || line.trimStart().startsWith('#')) return

  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (!m) return bad.push(`line ${n}: not KEY=value (no spaces around =)`)
  const [, key, value] = m

  if (key in env) bad.push(`${key}: defined twice`)
  if (/^["']|["']$/.test(value)) bad.push(`${key}: remove the quotes`)
  if (value.includes('$')) bad.push(`${key}: contains $ — Compose would alter it`)
  if (/\s#/.test(value) || value !== value.trim()) bad.push(`${key}: spaces, or a # comment after the value`)
  env[key] = value
})

const has = (key) => (env[key] || '') !== ''
// generate-with: the wording deploy/kokli-db/env.example uses for its values.
const placeholder = /__[A-Z_]+__|REPLACE_ME|replace_this|your_|changeme|generate-with/i
const need = (key, ok, why) => {
  if (!has(key) || placeholder.test(env[key]) || !ok(env[key])) bad.push(`${key}: ${why}`)
}

/* ------------------------------------------------------------- required */
need('DB_HOST', (v) => !/^(127\.|localhost$|host\.docker\.internal$)/.test(v),
  'the database container name (kokli-mysql), not this machine')
need('DB_PORT', (v) => v === '3306', 'expected 3306')
need('DB_USER', (v) => v.length > 0, 'the database user')
need('DB_PASSWORD', (v) => /^[A-Za-z0-9._~+/=-]{16,}$/.test(v),
  '16+ characters with no quotes, backslashes or $ (openssl rand -hex 24)')
need('DB_NAME', (v) => v === 'physio_clinic', 'must be physio_clinic — the schema names it')
need('PLATFORM_DOMAIN', (v) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) && !v.startsWith('www.'),
  'the bare domain, lower case — no scheme, port or www')
need('PLATFORM_PROTOCOL', (v) => v === 'https', 'must be https in production')
need('AUTH_SECRET', (v) => v.length >= 32, 'random, at least 32 characters (openssl rand -base64 32)')
need('PLATFORM_ENCRYPTION_KEY', (v) => Buffer.from(v, 'base64').length === 32,
  'must decode to exactly 32 bytes — openssl rand -base64 32')
need('CRON_SECRET', (v) => v.length >= 32, 'random, at least 32 characters (openssl rand -hex 32)')
if (has('CRON_SECRET') && env.CRON_SECRET === env.AUTH_SECRET) bad.push('CRON_SECRET: must not be the same as AUTH_SECRET')

/* ---------------------------------------------- must not be in this file */
for (const key of ['AUTH_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'AUTH_REDIRECT_PROXY_URL', 'AUTH_TRUST_HOST',
  'KOKLI_VERSION', 'HOSTNAME', 'NEXT_PUBLIC_SITE_URL', 'EMAIL_DEBUG_HTML', 'DEBUG', 'NODE_DEBUG',
  'NODE_TLS_REJECT_UNAUTHORIZED', 'BACKUP_DIR']) {
  if (key in env) bad.push(`${key}: remove it`)
}
if ('NODE_ENV' in env && env.NODE_ENV !== 'production') bad.push('NODE_ENV: remove it — the image sets production')
if ('PORT' in env && env.PORT !== '3000') bad.push('PORT: remove it — the proxy and health checks expect 3000')
if ('TZ' in env && env.TZ !== 'Asia/Kolkata') bad.push('TZ: remove it — the image sets Asia/Kolkata, matching MySQL')

/* ------------------------------- integrations: all of a group, or none */
const group = (name, keys) => {
  const set = keys.filter(has).length
  if (set && set !== keys.length) bad.push(`${name}: set all of ${keys.join(', ')}, or none`)
  return set === keys.length
}
if (!group('SMTP', ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'])) notes.push('SMTP empty — emails are printed to the log, so password reset cannot work')
if (has('SMTP_PORT') && !['465', '587'].includes(env.SMTP_PORT)) bad.push('SMTP_PORT: 465 (TLS) or 587 (STARTTLS)')
if (has('SMTP_FROM') && !/^[^\s<>"]+@[^\s<>"]+$/.test(env.SMTP_FROM)) bad.push('SMTP_FROM: a bare address, no display name')
if (!group('WhatsApp', ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TOKEN'])) {
  notes.push('WhatsApp empty — reminders are printed to the log; phone sign-in only on clinics using their own connected number')
}
if (!group('Google', ['AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'])) notes.push('Google empty — the sign-in button is hidden')
if (group('TURN', ['TURN_URL', 'TURN_USERNAME', 'TURN_CREDENTIAL'])) {
  if (!/^turns?:[^\s,]+$/.test(env.TURN_URL)) bad.push('TURN_URL: exactly one turn: or turns: URL')
} else notes.push('TURN empty — video calls behind strict networks will not connect')
if (group('Platform billing', ['PLATFORM_RAZORPAY_KEY_ID', 'PLATFORM_RAZORPAY_KEY_SECRET', 'PLATFORM_RAZORPAY_WEBHOOK_SECRET'])) {
  if (!env.PLATFORM_RAZORPAY_KEY_ID.startsWith('rzp_live_')) bad.push('PLATFORM_RAZORPAY_KEY_ID: a live key (rzp_live_...) in production')
} else notes.push('Platform billing empty — clinics cannot subscribe yet')

for (const note of notes) console.log(`note  ${note}`)
for (const problem of bad) console.log(`FAIL  ${problem}`)
console.log(bad.length ? `\n${bad.length} problem(s) — fix them before deploying.` : '\nOK — the env file passes every check.')
process.exit(bad.length ? 1 : 0)
