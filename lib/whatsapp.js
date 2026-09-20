import { query, queryOne } from '@/lib/db'
import { decryptSecret } from '@/lib/crypto'
import { TEMPLATES } from '@/lib/whatsappTemplates'

/**
 * ============================================================================
 *  WHATSAPP
 * ============================================================================
 *
 *  WHY THIS MATTERS MORE THAN EMAIL
 *  --------------------------------
 *  Indian patients do not read email. They read WhatsApp. Everything the app
 *  currently sends — confirmations, exercise programmes, reminders — goes to a
 *  channel most patients never open, which is why clinics still telephone
 *  everybody. Moving those messages to WhatsApp is the difference between
 *  software that organises a clinic and software that changes its week.
 *
 *  ---------------------------------------------------------------------------
 *  THE FOUR RULES, IN THE ORDER THEY ARE ENFORCED
 *  ---------------------------------------------------------------------------
 *  Every send passes four gates before a single rupee is spent. The order is
 *  deliberate: cheapest and most consequential first.
 *
 *   1. OPTED OUT?      They asked to stop. Nothing else is even considered.
 *   2. CONSENT?        Marketing templates need explicit opt-in — see below.
 *   3. PLAN?           Does this clinic's plan include WhatsApp at all?
 *   4. QUOTA?          Has it used its monthly allowance?
 *
 *  ---------------------------------------------------------------------------
 *  WHY CONSENT IS CHECKED HERE AND NOWHERE ELSE
 *  ---------------------------------------------------------------------------
 *  Meta splits templates into UTILITY (a reminder for an appointment they booked)
 *  and MARKETING (a nudge to buy more sessions). Marketing without consent gets
 *  the sending number BLOCKED.
 *
 *  Which number depends on the arrangement — see senderFor() below. A clinic on
 *  its own number risks only itself; a clinic on the platform's fallback number
 *  takes every other clinic on that number down with it. The second case is why
 *  the check lives in the sender rather than on whichever screen happens to call
 *  it: there is no code path to a marketing message that avoids this function.
 *
 *  ---------------------------------------------------------------------------
 *  IT WORKS WITH NOTHING CONFIGURED
 *  ---------------------------------------------------------------------------
 *  With no WHATSAPP_* variables set, messages are printed to the terminal exactly
 *  as lib/email.js does. The whole feature can be demonstrated to a clinic — and
 *  tested — before Meta has approved anything, which matters because approval
 *  takes days.
 * ============================================================================
 */

/**
 * Whose WhatsApp number sends this clinic's messages, and who pays for it.
 *
 * ---------------------------------------------------------------------------
 * TWO ARRANGEMENTS, AND THE DIFFERENCE MATTERS COMMERCIALLY AND FOR SAFETY
 * ---------------------------------------------------------------------------
 * OWN      The clinic has connected its own WhatsApp Business number. Messages
 *          come from the clinic — which is what a patient expects — and Meta
 *          bills the clinic directly. No quota: they are paying, so it is not
 *          ours to ration.
 *
 * PLATFORM The fallback, for a clinic that has not set theirs up yet. Messages
 *          go out on the platform's number and WE pay Meta, so it is capped hard
 *          by the plan. When the cap is reached messages stop rather than
 *          quietly costing more than the subscription is worth.
 *
 * The safety difference is bigger than the money. Meta blocks and quality-rates
 * per NUMBER. On a shared number one clinic sending marketing without consent
 * takes WhatsApp away from every clinic at once; on their own number the damage
 * is contained to the clinic that caused it. Encouraging clinics onto their own
 * number is therefore the single best thing that can be done for reliability, not
 * just for cost.
 */
export function senderFor(clinic, { ownNumberAllowed = true } = {}) {
  /**
   * `ownNumberAllowed` comes from whatsappAllowance(), and it must.
   *
   * This function used to decide on its own, which meant it could disagree with the
   * allowance: a Professional clinic with a connected number would be rationed by
   * the quota AND sent from its own number — charged twice, exactly the outcome the
   * unrationed own-number rule exists to prevent.
   *
   * One decision, made in one place, passed in here. The default is `true` so the
   * settings page and the terminal preview can ask "is a number connected at all?"
   * without needing a plan lookup.
   */
  const ownToken = decryptSecret(clinic?.wa_token_enc)
  if (ownNumberAllowed && clinic?.wa_phone_number_id && ownToken) {
    return { own: true, phoneNumberId: clinic.wa_phone_number_id, token: ownToken }
  }

  if (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TOKEN) {
    return {
      own: false,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      token: process.env.WHATSAPP_TOKEN,
    }
  }

  return null
}

/** True when this clinic can actually send — its own number or the platform's. */
export function isWhatsAppConfigured(clinic = null) {
  return Boolean(senderFor(clinic))
}

/** True when the clinic has connected its own number, so it bears the cost. */
export function usesOwnNumber(clinic) {
  return Boolean(clinic?.wa_phone_number_id && clinic?.wa_token_enc)
}

/* ========================================================================== */
/*  WHO CAN BE MESSAGED                                                       */
/* ========================================================================== */

/**
 * The number to use, in the form Meta wants.
 *
 * Meta expects a full international number with no plus, spaces or dashes:
 * 919812345678. Indian clinics type numbers every possible way — "98123 45678",
 * "+91-9812345678", "09812345678" — so all of them are normalised here rather
 * than being the data-entry problem of whoever typed it.
 */
export function normaliseNumber(raw, defaultCountryCode = '91') {
  const digits = String(raw || '').replace(/\D/g, '')
  if (!digits) return null

  // Already international.
  if (digits.length > 10 && digits.startsWith(defaultCountryCode)) return digits
  // A leading zero is the Indian trunk prefix and is not part of the number.
  const local = digits.replace(/^0+/, '')
  if (local.length === 10) return `${defaultCountryCode}${local}`
  // Anything else is passed through — a foreign patient may be legitimate.
  return digits.length >= 10 ? digits : null
}

/**
 * Everything needed to decide whether this patient may be messaged.
 *
 * One query rather than three, because the reminder scheduler asks this for every
 * appointment tomorrow and N+1 queries in a loop is how a nightly job turns into
 * a nightly outage.
 */
async function messagingProfile(clinicId, patientId) {
  return queryOne(
    `SELECT u.id, u.name, u.phone,
            pr.whatsapp_number, pr.whatsapp_marketing_opt_in_at, pr.whatsapp_opted_out_at
       FROM users u
       LEFT JOIN patient_profiles pr ON pr.user_id = u.id
      WHERE u.id = ? AND u.clinic_id = ?`,
    [patientId, clinicId]
  )
}

/* ========================================================================== */
/*  THE QUOTA                                                                 */
/* ========================================================================== */

/**
 * How many messages this clinic has actually SENT this calendar month.
 *
 * Counts sent/delivered/read only. A message skipped for lack of consent, or one
 * that failed, cost nothing and must not eat the allowance — charging a clinic
 * for a message its patient never received would be indefensible the first time
 * somebody checked.
 */
export async function messagesUsedThisMonth(clinicId) {
  const row = await queryOne(
    `SELECT COUNT(*) AS n FROM whatsapp_messages
      WHERE clinic_id = ?
        AND status IN ('sent', 'delivered', 'read')
        AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
    [clinicId]
  )
  return Number(row?.n ?? 0)
}

/**
 * The clinic's WhatsApp position: allowed at all, how much left.
 *
 * `quota === null` means unlimited, which is not the same as 0. See the note on
 * plans.whatsapp_monthly_quota in migration 005.
 */
export async function whatsappAllowance(clinic) {
  /**
   * ==========================================================================
   *  THE PLAN IS CHECKED FIRST. THE ORDER IS THE WHOLE POINT.
   * ==========================================================================
   *  This function used to answer the own-number case before reading the plan at
   *  all, and that one early return gave the product away:
   *
   *    * a Starter clinic — ₹499, WhatsApp NOT included — got unlimited WhatsApp
   *      for free by connecting a number
   *    * a Professional clinic needing more than its 500 had no reason to move to
   *      the ₹2,999 plan, because connecting a number was cheaper than upgrading
   *
   *  The mistake was conflating two different questions. WHOSE NUMBER SENDS is a
   *  delivery detail. WHETHER THIS CLINIC MAY USE WHATSAPP is a licence. Answering
   *  the first one first meant the second was never asked.
   */
  const plan = await queryOne(
    `SELECT p.whatsapp_enabled, p.whatsapp_monthly_quota, p.whatsapp_own_number
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
      WHERE s.clinic_id = ? AND s.status IN ('trialing', 'active', 'past_due')
      ORDER BY s.id DESC LIMIT 1`,
    [clinic.id]
  )

  if (!plan || !plan.whatsapp_enabled) {
    return {
      enabled: false,
      ownNumber: false,
      ownNumberAllowed: false,
      quota: 0,
      used: 0,
      left: 0,
      unlimited: false,
    }
  }

  /**
   * Now — and only now — the clinic's own number.
   *
   * Still unrationed, and for the original good reason: they are billed by Meta
   * directly, so rationing it would be charging them twice, once for the message
   * and once for permission to send it. What has changed is that the PLAN has to
   * allow it, which is what makes it a reason to be on the top plan rather than a
   * way to avoid paying for one.
   */
  const ownNumberAllowed = Boolean(plan.whatsapp_own_number)

  if (ownNumberAllowed && usesOwnNumber(clinic)) {
    const used = await messagesUsedThisMonth(clinic.id)
    return {
      enabled: true,
      ownNumber: true,
      ownNumberAllowed: true,
      unlimited: true,
      quota: null,
      used,
      left: Infinity,
    }
  }

  /**
   * On the platform's number the quota is ALWAYS finite.
   *
   * A NULL quota once meant "unlimited", which on our own number is an unbounded
   * bill — one clinic messaging its whole patient list could cost more in a week
   * than it pays in a year. Unlimited now means one thing only: the clinic
   * connected its own number and is paying Meta itself.
   */
  const quota = Number(plan.whatsapp_monthly_quota) || 0
  const used = await messagesUsedThisMonth(clinic.id)

  return {
    enabled: quota > 0,
    ownNumber: false,
    ownNumberAllowed,
    unlimited: false,
    quota,
    used,
    left: Math.max(0, quota - used),
  }
}

/* ========================================================================== */
/*  SENDING                                                                   */
/* ========================================================================== */

/**
 * Send one templated message. Never throws.
 *
 * @param {object}  options
 * @param {object}  options.clinic       the sending clinic
 * @param {number}  options.patientId
 * @param {string}  options.template     a key of TEMPLATES
 * @param {object}  options.values       the template's parameters
 * @param {number} [options.appointmentId]
 * @param {number} [options.patientPackageId]
 * @returns {Promise<{ok: boolean, skipped?: boolean, reason?: string}>}
 */
export async function sendWhatsApp({
  clinic,
  patientId,
  template,
  values = {},
  appointmentId = null,
  patientPackageId = null,
}) {
  const spec = TEMPLATES[template]
  if (!spec) {
    console.error(`[whatsapp] unknown template: ${template}`)
    return { ok: false, reason: 'Unknown template' }
  }

  const profile = await messagingProfile(clinic.id, patientId)
  if (!profile) return skip({ clinic, patientId, template, spec, to: '', reason: 'Patient not found' })

  const to = normaliseNumber(profile.whatsapp_number || profile.phone)
  if (!to) {
    return skip({ clinic, patientId, template, spec, to: '', reason: 'No usable phone number' })
  }

  /* ---------------------------------------------------------- 1. opted out */
  if (profile.whatsapp_opted_out_at) {
    return skip({ clinic, patientId, template, spec, to, reason: 'Patient opted out' })
  }

  /* ----------------------------------------------------------- 2. consent */
  /**
   * The gate that protects every clinic at once. See the note at the top.
   *
   * Note it is checked against a TIMESTAMP, not a boolean: if a clinic is ever
   * challenged about a message, "the flag was true" proves nothing and "they
   * agreed on 14 March" proves everything.
   */
  if (spec.category === 'marketing' && !profile.whatsapp_marketing_opt_in_at) {
    return skip({
      clinic, patientId, template, spec, to,
      reason: 'No marketing consent — utility messages still allowed',
    })
  }

  /* -------------------------------------------------------------- 3. plan */
  const allowance = await whatsappAllowance(clinic)
  if (!allowance.enabled) {
    return skip({ clinic, patientId, template, spec, to, reason: 'Plan does not include WhatsApp' })
  }

  /* ------------------------------------------------------------- 4. quota */
  if (allowance.left <= 0) {
    return skip({
      clinic, patientId, template, spec, to,
      reason: `Monthly allowance of ${allowance.quota} messages used`,
    })
  }

  /* ------------------------------------------------------------- send it */
  const parameters = spec.parameters(values, clinic)

  const [logged] = await query(
    `INSERT INTO whatsapp_messages
       (clinic_id, patient_id, template, category, to_number, status,
        appointment_id, patient_package_id)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
    [clinic.id, patientId, template, spec.category, to, appointmentId, patientPackageId]
  ).then((r) => [r])

  const messageId = logged.insertId

  // The allowance decided this a few lines up; senderFor must not re-decide it.
  const sender = senderFor(clinic, { ownNumberAllowed: allowance.ownNumberAllowed })

  if (!sender) {
    printToTerminal({ to, clinic, spec, parameters, template })
    await query(
      `UPDATE whatsapp_messages SET status = 'sent', reason = 'Printed — WhatsApp not configured'
        WHERE id = ?`,
      [messageId]
    )
    return { ok: true, skipped: true, reason: 'Not configured — printed instead' }
  }

  try {
    const providerId = await postToMeta({ to, spec, parameters, sender })
    await query(
      `UPDATE whatsapp_messages SET status = 'sent', provider_message_id = ? WHERE id = ?`,
      [providerId, messageId]
    )
    return { ok: true }
  } catch (error) {
    // Logged, never thrown. A failed reminder must not roll back an appointment.
    console.error(`[whatsapp] ${template} to ${to} failed:`, error.message)
    await query(`UPDATE whatsapp_messages SET status = 'failed', reason = ? WHERE id = ?`, [
      String(error.message).slice(0, 300),
      messageId,
    ])
    return { ok: false, reason: error.message }
  }
}

/**
 * Record a message that was deliberately not sent.
 *
 * Skipped sends are logged as carefully as real ones. Without this a clinic
 * asking "why did my patient not get the reminder" has nothing to look at, and
 * the honest answers — no consent, no number, allowance used — are exactly the
 * ones they need to act on.
 */
async function skip({ clinic, patientId, template, spec, to, reason }) {
  await query(
    `INSERT INTO whatsapp_messages
       (clinic_id, patient_id, template, category, to_number, status, reason)
     VALUES (?, ?, ?, ?, ?, 'skipped', ?)`,
    [clinic.id, patientId, template, spec?.category || 'utility', to || '', reason]
  )
  return { ok: false, skipped: true, reason }
}

/**
 * Fire and forget, for a request handler.
 *
 * A reminder that adds 400ms to a page load is 400ms of somebody waiting for
 * nothing — the response does not depend on the message.
 */
export function sendWhatsAppInBackground(options) {
  sendWhatsApp(options).catch((error) =>
    console.error('[whatsapp] background send failed:', error)
  )
}

/* ========================================================================== */
/*  THE PROVIDER                                                              */
/* ========================================================================== */

/**
 * Meta's WhatsApp Cloud API, called directly.
 *
 * Directly rather than through Gupshup, AiSensy or Twilio: they are resellers of
 * this same API with their own margin on top. The trade is that Meta's onboarding
 * is more work once, and every message is cheaper forever.
 *
 * If that turns out to be the wrong call, this is the only function that changes.
 * Everything above it — consent, quota, logging — is provider-agnostic on purpose.
 */
async function postToMeta({ to, spec, parameters, sender }) {
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0'

  const response = await fetch(
    `https://graph.facebook.com/${version}/${sender.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sender.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: spec.metaName,
        language: { code: spec.language || 'en' },
        components: [{ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text })) }],
      },
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    /**
     * Meta's errors are genuinely useful and worth surfacing verbatim.
     *
     * The two seen most often: 132001 "template does not exist" (it has not been
     * approved yet, or the name differs by a character) and 131047 "re-engagement
     * required" (a free-form message outside the 24-hour window, which is exactly
     * what templates exist to avoid).
     */
    const detail = data?.error?.message || `HTTP ${response.status}`
    const code = data?.error?.code ? ` [${data.error.code}]` : ''
    throw new Error(`${detail}${code}`)
  }

  return data?.messages?.[0]?.id || null
}

/**
 * With nothing configured, print the message.
 *
 * The same choice as lib/email.js, for the same reason: the entire feature can be
 * demonstrated to a clinic and tested end to end before Meta has approved a single
 * template — and approval takes days.
 */
function printToTerminal({ to, clinic, spec, parameters, template }) {
  console.log(
    [
      '',
      '┌─ WHATSAPP (not sent — not configured) ──────────────────────────',
      `│ To:       +${to}`,
      `│ Clinic:   ${clinic.name}`,
      `│ Template: ${template}  (${spec.category})`,
      `│ Sending:  ${usesOwnNumber(clinic) ? "the clinic's own number" : "the platform number"}`,
      '├─────────────────────────────────────────────────────────────────',
      spec
        .preview(parameters)
        .split('\n')
        .map((line) => `│ ${line}`)
        .join('\n'),
      '└─────────────────────────────────────────────────────────────────',
      '',
    ].join('\n')
  )
}

/* ========================================================================== */
/*  LOGIN CODES                                                               */
/* ========================================================================== */

/**
 * Send a login code. Deliberately NOT sendWhatsApp().
 *
 * WHY THIS HAS ITS OWN FUNCTION
 * -----------------------------
 * Every gate in sendWhatsApp() is wrong here, and forcing a login code through
 * them would produce a system that locks people out of their own medical records:
 *
 *   patientId        sendWhatsApp() starts from a patient id. A login starts
 *                    from a phone number belonging to nobody yet — possibly to
 *                    several people (one family, one number), possibly to a
 *                    member of staff, who has no patient_profiles row at all.
 *
 *   opted out        Somebody who replied STOP to appointment reminders has not
 *                    asked to be locked out of signing in. Honouring an opt-out
 *                    here would mean the only way back into your account is to
 *                    telephone the clinic.
 *
 *   marketing        Irrelevant. This is not marketing by any definition — the
 *                    person typed their number into a login form seconds ago.
 *
 * WHAT IS STILL ENFORCED
 * ----------------------
 * The plan and the monthly quota, both unchanged. If the clinic is on the
 * platform's number and has used its allowance, this returns false and the login
 * page simply stops offering phone sign-in — it never leaves the patient at a
 * dead end, because Google and email/password are still on the same page.
 *
 * A clinic on its own WhatsApp number has no quota at all, so for them this is
 * always available. See whatsappAllowance().
 */
export async function sendAuthCode({ clinic, phone, code, userId = null }) {
  const spec = TEMPLATES.login_code
  const to = normaliseNumber(phone)
  if (!to) return { ok: false, reason: 'No usable phone number' }

  const allowance = await whatsappAllowance(clinic)
  if (!allowance.enabled) {
    return { ok: false, reason: 'Plan does not include WhatsApp' }
  }
  if (allowance.left <= 0) {
    return { ok: false, reason: `Monthly allowance of ${allowance.quota} messages used` }
  }

  const parameters = spec.parameters({ code })

  /**
   * Logged like any other message, so the clinic's own message log stays honest
   * and the quota count includes it. Note the code itself is never written here —
   * only that a login_code was sent, to which number, and when.
   */
  const [logged] = await query(
    `INSERT INTO whatsapp_messages
       (clinic_id, patient_id, template, category, to_number, status)
     VALUES (?, ?, 'login_code', 'authentication', ?, 'queued')`,
    [clinic.id, userId, to]
  ).then((r) => [r])

  const messageId = logged.insertId
  // Same rule as sendWhatsApp: the allowance above already decided this.
  const sender = senderFor(clinic, { ownNumberAllowed: allowance.ownNumberAllowed })

  if (!sender) {
    printToTerminal({ to, clinic, spec, parameters, template: 'login_code' })
    await query(
      `UPDATE whatsapp_messages SET status = 'sent', reason = 'Printed — WhatsApp not configured'
        WHERE id = ?`,
      [messageId]
    )
    return { ok: true, printed: true }
  }

  try {
    const providerId = await postToMeta({ to, spec, parameters, sender })
    await query(
      `UPDATE whatsapp_messages SET status = 'sent', provider_message_id = ? WHERE id = ?`,
      [providerId, messageId]
    )
    return { ok: true }
  } catch (error) {
    console.error(`[whatsapp] login_code to ${to} failed:`, error.message)
    await query(`UPDATE whatsapp_messages SET status = 'failed', reason = ? WHERE id = ?`, [
      String(error.message).slice(0, 300),
      messageId,
    ])
    return { ok: false, reason: error.message }
  }
}

/**
 * Can this clinic offer phone sign-in at all?
 *
 * Read by the login page so the option is only shown when a code can actually be
 * delivered. A phone-login button that cannot send anything is worse than no
 * button — see the same reasoning behind `googleEnabled` in auth.config.js.
 */
export async function canSendAuthCodes(clinic) {
  if (!clinic) return false
  const allowance = await whatsappAllowance(clinic)
  return allowance.enabled && allowance.left > 0
}

/* ========================================================================== */
/*  OPTING OUT                                                                */
/* ========================================================================== */

/**
 * Stop messaging this patient, for good.
 *
 * Sets the timestamp rather than clearing consent, because "never agreed" and
 * "agreed then withdrew" are different facts and only the second one is a promise
 * that must never be broken.
 */
export async function optOutOfWhatsApp(clinicId, patientId) {
  await query(
    `INSERT INTO patient_profiles (user_id, whatsapp_opted_out_at)
     VALUES (?, NOW())
     ON DUPLICATE KEY UPDATE whatsapp_opted_out_at = NOW()`,
    [patientId]
  )
  void clinicId
}

/** Record consent for marketing messages, with the date it was given. */
export async function optInToMarketing(patientId) {
  await query(
    `INSERT INTO patient_profiles (user_id, whatsapp_marketing_opt_in_at, whatsapp_opted_out_at)
     VALUES (?, NOW(), NULL)
     ON DUPLICATE KEY UPDATE whatsapp_marketing_opt_in_at = NOW(), whatsapp_opted_out_at = NULL`,
    [patientId]
  )
}
