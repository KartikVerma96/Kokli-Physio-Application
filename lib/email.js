import nodemailer from 'nodemailer'
import { platform } from '@/config/platform'

/**
 * ============================================================================
 *  SENDING EMAIL
 * ============================================================================
 *
 *  WHY THIS EXISTS
 *  ---------------
 *  Up to now the app told a patient their appointment was booked and then went
 *  quiet. No confirmation, no reminder, nothing to forward to a spouse or add to
 *  a calendar. In a clinic that is not a missing nicety — it is the single
 *  biggest cause of no-shows, and every no-show is an empty half-hour the
 *  physiotherapist has already paid for.
 *
 *  On the business side it is worse: a trial ends without warning, a card fails
 *  in silence, and the first a clinic hears about either is when the product
 *  stops working.
 *
 *  THREE RULES, AND THE FIRST ONE MATTERS MOST
 *  -------------------------------------------
 *
 *  1. EMAIL MUST NEVER BREAK THE THING IT IS TELLING SOMEBODY ABOUT.
 *     Every send is wrapped so a dead SMTP server, a typo'd address or a
 *     provider outage can only ever produce a log line. A booking that has been
 *     paid for must not be rolled back because a mail server was slow. So
 *     nothing in here throws, and every caller is expected NOT to await the
 *     result inside a transaction.
 *
 *  2. IT WORKS WITH NOTHING CONFIGURED.
 *     With no SMTP_* variables set, emails are printed to the terminal instead
 *     of sent. You can watch the whole booking journey, read the confirmation,
 *     and never sign up for anything. Configure SMTP and the same code posts it
 *     for real.
 *
 *  3. THE CLINIC IS THE SENDER, NOT THE PLATFORM.
 *     A patient booked with "Aarogya Physiotherapy", so that is the name in
 *     their inbox and the address a reply goes to. They have no idea what
 *     Kokli is and should not have to care.
 *
 *  SETTING IT UP
 *  -------------
 *  Any SMTP provider works. Free tiers that are enough to start:
 *    Brevo (300/day), Resend (3,000/month), Mailgun, Amazon SES.
 *  Gmail also works for testing with an App Password, but do not ship on it.
 * ============================================================================
 */

/** True when real SMTP credentials are present. */
export function isEmailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD)
}

/**
 * One transporter, reused.
 *
 * Nodemailer pools connections, and building a new transporter per email means a
 * fresh TCP and TLS handshake every time — which under load is slower than the
 * sending itself.
 */
let transporter = null

function getTransporter() {
  if (transporter) return transporter

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    // Port 465 is implicit TLS. 587 starts plain and upgrades with STARTTLS,
    // which nodemailer does automatically when `secure` is false.
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    pool: true,
    maxConnections: 3,
  })

  return transporter
}

/**
 * Build the From header.
 *
 * The ADDRESS always belongs to the platform's verified sending domain — a
 * clinic's own gmail.com address would be rejected by SPF and land in spam. Only
 * the display NAME changes, and Reply-To points at the clinic, so a patient who
 * hits reply reaches the clinic and not you.
 */
function fromHeader(clinic) {
  const address = process.env.SMTP_FROM || `no-reply@${platform.domain}`
  const name = clinic?.name || platform.name
  return `"${name}" <${address}>`
}

/**
 * Send one email. Never throws.
 *
 * @param {object}  options
 * @param {string}  options.to        recipient address
 * @param {string}  options.subject
 * @param {string}  options.html      the rendered body
 * @param {string} [options.text]     plain-text fallback; derived from the HTML if absent
 * @param {object} [options.clinic]   the sending clinic, for the name and reply address
 * @returns {Promise<{ok: boolean, skipped?: boolean, error?: string}>}
 */
export async function sendEmail({ to, subject, html, text, clinic }) {
  if (!to || !subject || !html) {
    console.error('[email] refused to send: missing to, subject or html')
    return { ok: false, error: 'Incomplete email' }
  }

  const message = {
    from: fromHeader(clinic),
    to,
    subject,
    html,
    // Some clients, and most spam filters, want a text alternative. Stripping the
    // tags is crude but better than sending none.
    text: text || htmlToText(html),
    ...(clinic?.email ? { replyTo: clinic.email } : {}),
  }

  /* ------------------------------------------------ not configured: print it */
  if (!isEmailConfigured()) {
    console.log(
      [
        '',
        '┌─ EMAIL (not sent — no SMTP configured) ─────────────────────────',
        `│ To:      ${to}`,
        `│ From:    ${message.from}`,
        `│ Subject: ${subject}`,
        '├─────────────────────────────────────────────────────────────────',
        message.text
          .split('\n')
          .map((line) => `│ ${line}`)
          .join('\n'),
        // Set EMAIL_DEBUG_HTML=1 to see the markup as well. Worth doing while
        // writing a template — the plain-text version above deliberately decodes
        // entities, so it cannot show you whether the HTML was escaped properly.
        ...(process.env.EMAIL_DEBUG_HTML === '1'
          ? ['├─ html ──────────────────────────────────────────────────────────', html]
          : []),
        '└─────────────────────────────────────────────────────────────────',
        '',
      ].join('\n')
    )
    return { ok: true, skipped: true }
  }

  /* --------------------------------------------------------- really send it */
  try {
    await getTransporter().sendMail(message)
    return { ok: true }
  } catch (error) {
    // Logged, never thrown. See rule 1 at the top of this file.
    console.error(`[email] could not send "${subject}" to ${to}:`, error.message)
    return { ok: false, error: error.message }
  }
}

/**
 * Fire an email off without making the caller wait for it.
 *
 * Use this in a request handler. A booking confirmation that adds 400ms to the
 * response is 400ms the patient spends looking at a spinner for no reason, and
 * the response does not depend on the email in any way.
 */
export function sendEmailInBackground(options) {
  // No await, and a catch that can never be reached (sendEmail does not throw)
  // purely so an unhandled rejection can never take the process down.
  sendEmail(options).catch((error) => console.error('[email] background send failed:', error))
}

/** Good enough for a plain-text alternative: drop the tags, keep the words. */
function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|h3|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8377;|&rupee;/g, '₹')
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, lines) => line || lines[index - 1])
    .join('\n')
    .trim()
}
