import { formatDateLong, formatTime } from '@/lib/utils'

/**
 * ============================================================================
 *  WHATSAPP MESSAGE TEMPLATES
 * ============================================================================
 *
 *  HOW WHATSAPP TEMPLATES ACTUALLY WORK, BECAUSE IT IS NOT OBVIOUS
 *  ---------------------------------------------------------------
 *  You cannot send a patient any text you like. A business may only start a
 *  conversation using a template Meta has approved in advance, submitted with
 *  {{1}}, {{2}} placeholders. At send time you supply the values in order — never
 *  the sentence.
 *
 *  So the text below is NOT what gets sent. Meta holds the text. This file holds
 *  the NAME Meta knows it by, and the ORDER of the values. Getting that order
 *  wrong sends a patient somebody else's appointment time with no error, which is
 *  why each template lists its parameters explicitly rather than interpolating a
 *  string.
 *
 *  `submission` on each entry is the exact text to paste into Meta's template
 *  form. Keep the two in step: change the wording there and the parameter order
 *  here must match, or the message will read as nonsense.
 *
 *  ---------------------------------------------------------------------------
 *  CATEGORY IS A COMMERCIAL AND LEGAL DECISION, NOT A LABEL
 *  ---------------------------------------------------------------------------
 *  UTILITY    Follows from something the patient did — they booked, they were
 *             treated. No consent needed. Cheap.
 *  MARKETING  Asks them for something — buy more, leave a review. Needs explicit
 *             opt-in, costs roughly three times as much, and sending one without
 *             consent gets the number blocked.
 *
 *  Meta re-categorises templates it disagrees with. If a "reminder" is written to
 *  include an offer, it will be reclassified as marketing — which is why the
 *  utility templates below say nothing promotional at all.
 * ============================================================================
 */

export const TEMPLATES = {
  /* ====================================================================== */
  /*  1. THE REMINDER — the one that pays for the subscription              */
  /* ====================================================================== */
  appointment_reminder: {
    metaName: 'appointment_reminder',
    category: 'utility',
    language: 'en',

    /**
     * Submit this to Meta exactly as written.
     *
     * Deliberately plain. It states a fact the patient already agreed to and asks
     * nothing — that is what keeps it in the utility category and out of the
     * marketing price bracket.
     *
     * The reply instruction matters more than it looks: a patient who replies
     * opens a 24-hour window in which the clinic can message freely, so
     * "reply CANCEL" turns a cancellation into a free conversation AND gives the
     * clinic the slot back in time to refill it.
     */
    submission: `Hello {{1}}, this is a reminder of your physiotherapy appointment at {{2}}.

📅 {{3}}
🕐 {{4}}
📍 {{5}}

Please arrive 5 minutes early. Reply CANCEL if you cannot make it, so we can offer the slot to someone else.`,

    // name, clinic, date, time, where
    parameters: (v, clinic) => [
      firstName(v.patientName),
      clinic.name,
      formatDateLong(v.date),
      formatTime(v.startTime),
      v.where || clinic.address_line1 || 'the clinic',
    ],

    preview: ([name, clinic, date, time, where]) =>
      `Hello ${name}, this is a reminder of your physiotherapy appointment at ${clinic}.\n\n` +
      `📅 ${date}\n🕐 ${time}\n📍 ${where}\n\n` +
      `Please arrive 5 minutes early. Reply CANCEL if you cannot make it, so we can offer the slot to someone else.`,
  },

  /* ====================================================================== */
  /*  2. THE HOME EXERCISE PROGRAMME                                        */
  /* ====================================================================== */
  exercise_programme: {
    metaName: 'exercise_programme',
    category: 'utility',
    language: 'en',

    /**
     * The most under-rated of the four.
     *
     * The home programme is where physiotherapy actually works — the session is
     * an hour a week, the exercises are every day. It currently exists as a page
     * in a portal the patient never opens. On their phone, next to their family
     * chat, they might do them.
     *
     * Better compliance means better outcomes, and better outcomes are what
     * produce the reviews and the doctor referrals that grow the clinic.
     */
    submission: `Hi {{1}}, here is your home exercise programme from {{2}}.

{{3}}

Do these {{4}}. If anything causes sharp pain, stop and message us.

Your full programme with instructions: {{5}}`,

    // name, clinic, the exercise list, frequency, link
    parameters: (v, clinic) => [
      firstName(v.patientName),
      clinic.name,
      exerciseList(v.exercises),
      v.frequency || 'daily',
      v.url,
    ],

    preview: ([name, clinic, list, frequency, url]) =>
      `Hi ${name}, here is your home exercise programme from ${clinic}.\n\n${list}\n\n` +
      `Do these ${frequency}. If anything causes sharp pain, stop and message us.\n\n` +
      `Your full programme with instructions: ${url}`,
  },

  /* ====================================================================== */
  /*  3. SESSIONS LEFT, EXPIRING SOON                        (MARKETING)    */
  /* ====================================================================== */
  package_expiring: {
    metaName: 'package_expiring',
    category: 'marketing',
    language: 'en',

    /**
     * Marketing because it invites them to come back and spend.
     *
     * It is also the most defensible message in the set: the patient has already
     * PAID for these sessions. Framing matters — "you have sessions remaining" is
     * a reminder about their own money, and reads as service rather than a sales
     * push, which is both truer and more effective.
     */
    submission: `Hi {{1}}, you have {{2}} physiotherapy sessions remaining with {{3}}, and they expire on {{4}}.

Finishing your course is what makes the treatment hold — stopping early is the most common reason problems come back.

Book a time: {{5}}

Reply STOP to opt out of these messages.`,

    // name, sessions left, clinic, expiry, booking link
    parameters: (v, clinic) => [
      firstName(v.patientName),
      String(v.sessionsLeft),
      clinic.name,
      formatDateLong(v.expiresAt),
      v.bookingUrl,
    ],

    preview: ([name, left, clinic, expires, url]) =>
      `Hi ${name}, you have ${left} physiotherapy sessions remaining with ${clinic}, and they expire on ${expires}.\n\n` +
      `Finishing your course is what makes the treatment hold — stopping early is the most common reason problems come back.\n\n` +
      `Book a time: ${url}\n\nReply STOP to opt out of these messages.`,
  },

  /* ====================================================================== */
  /*  4. THE REVIEW REQUEST                                  (MARKETING)    */
  /* ====================================================================== */
  review_request: {
    metaName: 'review_request',
    category: 'marketing',
    language: 'en',

    /**
     * Google Maps is how a physiotherapy clinic gets found, and the difference
     * between four reviews and forty is simply asking at the right moment.
     *
     * The right moment is a day or two after a course finishes, while they can
     * still feel the difference. Asking after a single visit is too early —
     * nothing has changed yet — and a month later they have forgotten.
     *
     * Note it does NOT ask for five stars. Beyond being against Google's policy,
     * a clinic gaming reviews learns nothing; one that asks honestly finds out
     * what it is doing wrong while the patient still cares enough to say.
     */
    submission: `Hi {{1}}, we hope you are feeling better after your treatment at {{2}}.

If you have a moment, would you share how it went? It genuinely helps other people find us — and tells us what to do better.

{{3}}

Thank you for trusting us with your recovery.

Reply STOP to opt out of these messages.`,

    // name, clinic, review link
    parameters: (v, clinic) => [firstName(v.patientName), clinic.name, v.reviewUrl],

    preview: ([name, clinic, url]) =>
      `Hi ${name}, we hope you are feeling better after your treatment at ${clinic}.\n\n` +
      `If you have a moment, would you share how it went? It genuinely helps other people find us — and tells us what to do better.\n\n` +
      `${url}\n\nThank you for trusting us with your recovery.\n\nReply STOP to opt out of these messages.`,
  },

  /* ====================================================================== */
  /*  5. THE LOGIN CODE                                 (AUTHENTICATION)    */
  /* ====================================================================== */
  login_code: {
    metaName: 'login_code',
    category: 'authentication',
    language: 'en',

    /**
     * A different category, and it is not a formality.
     *
     * Meta treats AUTHENTICATION templates as their own class, with rules the
     * other four do not have to follow:
     *
     *   * No URLs and no marketing language. A link in a message containing a
     *     one-time code is the exact shape of every phishing message ever sent,
     *     so Meta rejects it — correctly.
     *   * The code must be the FIRST variable, so WhatsApp can offer its native
     *     "Copy code" button. That button is why this beats SMS on usability:
     *     the patient taps it rather than memorising six digits.
     *   * A time-to-live can be attached, so WhatsApp itself stops showing the
     *     copy button once the code has expired.
     *
     * WHY THIS IS SAFE TO SEND WHEN OTHER MESSAGES ARE NOT
     * ---------------------------------------------------
     * The other four templates are things the CLINIC decided to send. This one
     * the patient asked for, thirty seconds ago, by typing their number into a
     * login form. That is why sendAuthCode() in lib/whatsapp.js skips the
     * opt-out and marketing-consent gates: somebody who opted out of appointment
     * reminders has not opted out of being able to sign in, and treating those as
     * the same thing would lock them out of their own medical records.
     *
     * WHY THERE IS NO CLINIC NAME PARAMETER
     * -------------------------------------
     * It is sent FROM the clinic's own WhatsApp number, so the clinic's name is
     * already at the top of the chat. Repeating it inside the message buys
     * nothing and gives Meta another string to object to.
     */
    submission: `*{{1}}* is your verification code.

For your security, do not share this code with anyone — including someone claiming to be from the clinic.`,

    // The code, and nothing else. Keep it that way.
    parameters: (v) => [String(v.code)],

    preview: ([code]) =>
      `*${code}* is your verification code.\n\n` +
      `For your security, do not share this code with anyone — including someone claiming to be from the clinic.`,
  },
}

/* ========================================================================== */
/*  SMALL HELPERS                                                             */
/* ========================================================================== */

/**
 * "Anjali" from "Dr. Anjali Sharma".
 *
 * A message opening with someone's full name and title reads like a bank. The
 * title is dropped as well as the surname, because "Hello Dr." is worse than
 * either.
 */
function firstName(full) {
  const cleaned = String(full || '').replace(/^(Dr|Mr|Mrs|Ms|Shri|Smt)\.?\s+/i, '')
  return cleaned.split(/\s+/)[0] || 'there'
}

/**
 * The exercises as a short numbered list.
 *
 * Capped at five and truncated, because a WhatsApp template parameter cannot
 * contain newlines in some clients and a wall of text is not read anyway. The
 * link carries the full programme.
 */
function exerciseList(exercises) {
  if (!Array.isArray(exercises) || exercises.length === 0) {
    return 'Your exercises are in the link below.'
  }
  return exercises
    .slice(0, 5)
    .map((e, i) => {
      const detail = [e.sets && `${e.sets} sets`, e.reps && `${e.reps} reps`]
        .filter(Boolean)
        .join(' × ')
      return `${i + 1}. ${e.name}${detail ? ` — ${detail}` : ''}`
    })
    .join('\n')
}

/**
 * Everything needed to submit these to Meta, printed for a human.
 *
 *     node -e "import('./lib/whatsappTemplates.js').then(m => console.log(m.submissionGuide()))"
 *
 * Exists because the templates have to be typed into Meta's Business Manager by
 * hand, and transcribing them out of a source file is exactly where a {{3}} ends
 * up in the wrong place.
 */
export function submissionGuide() {
  const lines = [
    '',
    '════════════════════════════════════════════════════════════════════',
    ' WHATSAPP TEMPLATES — submit these at',
    ' business.facebook.com → WhatsApp Manager → Message Templates → Create',
    '════════════════════════════════════════════════════════════════════',
    '',
    ' Approval usually takes a few hours, occasionally 48. Submit them all at',
    ' once. Business verification must be finished first, and that is the slow',
    ' part — start it today.',
    '',
    ' ONE OF THESE IS DIFFERENT: login_code must be submitted under the',
    ' AUTHENTICATION category, not Utility. Meta then offers a native "Copy code"',
    ' button on it, and rejects any URL inside the body — which is correct, since',
    ' a link next to a one-time code is what every phishing message looks like.',
    '',
  ]

  for (const [key, spec] of Object.entries(TEMPLATES)) {
    lines.push('─'.repeat(68))
    lines.push(` NAME      ${spec.metaName}`)
    lines.push(` CATEGORY  ${spec.category.toUpperCase()}`)
    lines.push(` LANGUAGE  ${spec.language}`)
    lines.push('')
    lines.push(' BODY (paste exactly, including the {{n}} placeholders):')
    lines.push('')
    for (const line of spec.submission.split('\n')) lines.push(`   ${line}`)
    lines.push('')
    lines.push(' SAMPLE VALUES for Meta\'s preview, in order:')
    const samples = SAMPLES[key] || []
    samples.forEach((s, i) => lines.push(`   {{${i + 1}}} = ${s}`))
    lines.push('')
  }

  lines.push('─'.repeat(68))
  lines.push('')
  lines.push(' Once approved, put these in .env.local:')
  lines.push('   WHATSAPP_PHONE_NUMBER_ID=...')
  lines.push('   WHATSAPP_TOKEN=...')
  lines.push('   WHATSAPP_VERIFY_TOKEN=...   (any random string, for the webhook)')
  lines.push('')
  lines.push(' Until then every message prints to the terminal instead of sending,')
  lines.push(' so the whole feature can be demonstrated and tested today.')
  lines.push('')

  return lines.join('\n')
}

/** Sample values Meta asks for when a template is submitted. */
const SAMPLES = {
  appointment_reminder: ['Priya', 'Aarogya Physiotherapy', 'Monday, 4 August', '10:30 AM', '12 MG Road, Pune'],
  exercise_programme: [
    'Priya',
    'Aarogya Physiotherapy',
    '1. Pendulum swings — 3 sets × 10 reps',
    'twice daily',
    'https://aarogya.kokli.in/dashboard/exercises',
  ],
  package_expiring: ['Priya', '3', 'Aarogya Physiotherapy', '20 September', 'https://aarogya.kokli.in/book'],
  review_request: ['Priya', 'Aarogya Physiotherapy', 'https://g.page/r/example/review'],
  login_code: ['472913'],
}
