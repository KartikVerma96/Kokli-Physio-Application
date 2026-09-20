import { platform, clinicUrl, platformUrl } from '@/config/platform'
import { formatMoney, formatDateLong, formatTime } from '@/lib/utils'

/**
 * ============================================================================
 *  EMAIL TEMPLATES
 * ============================================================================
 *  Every message the application sends, in one file, so the tone stays
 *  consistent and nothing gets written twice.
 *
 *  WHY THIS LOOKS LIKE 2005 HTML
 *  -----------------------------
 *  Tables, inline styles, no flexbox, no grid, no external stylesheet. That is
 *  not laziness — it is what email clients support. Outlook renders with Word's
 *  engine, Gmail strips <style> blocks in some views, and roughly half of all
 *  email is read on a phone. Inline styles on nested tables is the only layout
 *  that survives all of them.
 *
 *  Each template returns `{ subject, html }`. Rendering and sending are kept
 *  apart so a template can be read, tested or previewed without a mail server.
 * ============================================================================
 */

const BRAND = '#0d9488' // teal-600, the same brand colour as the app
const INK = '#1f2937'
const MUTED = '#6b7280'
const LINE = '#e5e7eb'

/**
 * The shell every email sits inside.
 *
 * 600px is the long-standing safe width — wider and Outlook's reading pane
 * introduces a horizontal scrollbar.
 */
function layout({ clinic, heading, body, cta, footerNote }) {
  const senderName = clinic?.name || platform.name

  return `
<div style="margin:0;padding:24px 12px;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${LINE};">
    <tr>
      <td style="padding:24px 32px;border-bottom:1px solid ${LINE};">
        <span style="font-size:16px;font-weight:700;color:${INK};">${escape(senderName)}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;font-weight:700;color:${INK};">${escape(heading)}</h1>
        <div style="font-size:15px;line-height:1.65;color:${INK};">${body}</div>
        ${
          cta
            ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px;">
                 <tr><td style="border-radius:12px;background:${BRAND};">
                   <a href="${cta.href}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escape(cta.label)}</a>
                 </td></tr>
               </table>`
            : ''
        }
      </td>
    </tr>
    <tr>
      <td style="padding:20px 32px;background:#fafaf9;border-top:1px solid ${LINE};font-size:12px;line-height:1.6;color:${MUTED};">
        ${footerNote ? `<p style="margin:0 0 8px;">${footerNote}</p>` : ''}
        <p style="margin:0;">
          ${clinic ? `${escape(clinic.name)}${clinic.phone ? ` · ${escape(clinic.phone)}` : ''}` : platform.name}
        </p>
      </td>
    </tr>
  </table>
</div>`.trim()
}

/** A label/value list — used for appointment and invoice details. */
function detailRows(rows) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;border:1px solid ${LINE};border-radius:12px;">
    ${rows
      .filter(Boolean)
      .map(
        ([label, value], index) => `<tr>
          <td style="padding:11px 16px;font-size:13px;color:${MUTED};${index ? `border-top:1px solid ${LINE};` : ''}">${escape(label)}</td>
          <td style="padding:11px 16px;font-size:14px;font-weight:600;color:${INK};text-align:right;${index ? `border-top:1px solid ${LINE};` : ''}">${escape(value)}</td>
        </tr>`
      )
      .join('')}
  </table>`
}

/**
 * Escape anything that came from the database.
 *
 * A clinic types its own name and a patient types their own; both end up inside
 * HTML. Without this, a name containing a `<` breaks the layout — and an email
 * body is a perfectly good place to try to inject a link.
 */
function escape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* ========================================================================== */
/*  PATIENT-FACING                                                            */
/* ========================================================================== */

/** Their appointment is paid for and confirmed. */
export function appointmentConfirmed({ clinic, patientName, appointment }) {
  const online = appointment.mode === 'online'
  const url = clinicUrl(clinic.slug, `/dashboard/appointments/${appointment.id}`)

  return {
    subject: `Confirmed: ${appointment.serviceName} on ${formatDateLong(appointment.date)}`,
    html: layout({
      clinic,
      heading: 'Your appointment is confirmed',
      body: `
        <p style="margin:0 0 4px;">Hello ${escape(patientName?.split(' ')[0] || 'there')},</p>
        <p style="margin:0;">Thank you — your booking with ${escape(clinic.name)} is confirmed and paid for.</p>
        ${detailRows([
          ['Treatment', appointment.serviceName],
          ['Date', formatDateLong(appointment.date)],
          ['Time', formatTime(appointment.startTime)],
          ['Where', online ? 'Online video consultation' : clinic.address_line1 || 'At the clinic'],
          ['Reference', appointment.code],
          ['Paid', formatMoney(appointment.amountPaise)],
        ])}
        <p style="margin:0;">${
          online
            ? 'Join from the link below a few minutes early. All you need is a browser — there is nothing to install.'
            : 'Please arrive five minutes early, and wear or bring loose clothing you can move in.'
        }</p>`,
      cta: { label: online ? 'Join the consultation' : 'View your appointment', href: url },
      footerNote: `Need to change it? You can reschedule or cancel free of charge up to ${clinic.free_cancellation_hours ?? 24} hours before.`,
    }),
  }
}

/** They (or the clinic) cancelled it. */
export function appointmentCancelled({ clinic, patientName, appointment, refundNote }) {
  return {
    subject: `Cancelled: ${appointment.serviceName} on ${formatDateLong(appointment.date)}`,
    html: layout({
      clinic,
      heading: 'Your appointment has been cancelled',
      body: `
        <p style="margin:0 0 4px;">Hello ${escape(patientName?.split(' ')[0] || 'there')},</p>
        <p style="margin:0;">Your appointment with ${escape(clinic.name)} has been cancelled.</p>
        ${detailRows([
          ['Treatment', appointment.serviceName],
          ['Was booked for', `${formatDateLong(appointment.date)}, ${formatTime(appointment.startTime)}`],
          ['Reference', appointment.code],
        ])}
        ${refundNote ? `<p style="margin:0 0 12px;">${escape(refundNote)}</p>` : ''}
        <p style="margin:0;">You can book another time whenever suits you.</p>`,
      cta: { label: 'Book another appointment', href: clinicUrl(clinic.slug, '/book') },
    }),
  }
}

/* ========================================================================== */
/*  CLINIC-FACING                                                             */
/* ========================================================================== */

/** Somebody just booked — tell the clinic without making them refresh a page. */
export function newBookingForClinic({ clinic, patientName, patientPhone, appointment }) {
  return {
    subject: `New booking: ${patientName} — ${formatDateLong(appointment.date)} at ${formatTime(appointment.startTime)}`,
    html: layout({
      clinic,
      heading: 'You have a new booking',
      body: `
        <p style="margin:0;">${escape(patientName)} has booked and paid for an appointment.</p>
        ${detailRows([
          ['Patient', patientName],
          patientPhone ? ['Phone', patientPhone] : null,
          ['Treatment', appointment.serviceName],
          ['When', `${formatDateLong(appointment.date)}, ${formatTime(appointment.startTime)}`],
          ['Type', appointment.mode === 'online' ? 'Online video' : 'At the clinic'],
          ['Paid', formatMoney(appointment.amountPaise)],
        ])}`,
      cta: { label: 'Open the diary', href: clinicUrl(clinic.slug, '/admin/appointments') },
    }),
  }
}

/* ========================================================================== */
/*  SUBSCRIPTION — the platform writing to its own customers                  */
/* ========================================================================== */

/** Their subscription is live, and here is the receipt. */
export function subscriptionReceipt({ clinic, planName, amountPaise, taxPaise, invoiceNumber, periodEnd }) {
  return {
    subject: `${platform.name} receipt ${invoiceNumber} — ${planName}`,
    html: layout({
      heading: 'Thank you — your subscription is active',
      body: `
        <p style="margin:0 0 4px;">Hello,</p>
        <p style="margin:0;">${escape(clinic.name)} is now on the ${escape(planName)} plan. Here is your receipt.</p>
        ${detailRows([
          ['Invoice', invoiceNumber],
          ['Plan', planName],
          ['Subscription', formatMoney(amountPaise)],
          [`GST (${platform.gstPercent}%)`, formatMoney(taxPaise)],
          ['Total paid', formatMoney(Number(amountPaise) + Number(taxPaise))],
          periodEnd ? ['Next payment', formatDateLong(periodEnd)] : null,
        ])}
        <p style="margin:0;">Your patients' payments are unaffected by this — they continue to go straight into your own Razorpay account.</p>`,
      cta: { label: 'View your billing', href: clinicUrl(clinic.slug, '/admin/billing') },
      footerNote: `Questions about this invoice? Reply to this email or write to ${platform.supportEmail}.`,
    }),
  }
}

/** The trial is nearly over. Sent once, a few days out. */
export function trialEndingSoon({ clinic, daysLeft, planName }) {
  return {
    subject:
      daysLeft <= 1
        ? `Your ${platform.name} trial ends tomorrow`
        : `${daysLeft} days left on your ${platform.name} trial`,
    html: layout({
      heading: daysLeft <= 1 ? 'Your trial ends tomorrow' : `Your trial ends in ${daysLeft} days`,
      body: `
        <p style="margin:0 0 4px;">Hello,</p>
        <p style="margin:0 0 12px;">Your free trial of ${platform.name} for ${escape(clinic.name)} is nearly up.</p>
        <p style="margin:0 0 12px;">When it ends, your website stays online and every patient record, appointment and clinical note is kept exactly as it is — but you will not be able to take new bookings until you subscribe.</p>
        <p style="margin:0;">Setting it up takes about a minute${planName ? `, and the ${escape(planName)} plan you picked is ready to go` : ''}.</p>`,
      cta: { label: 'Choose your plan', href: clinicUrl(clinic.slug, '/admin/billing') },
      footerNote: `Not sure which plan fits? Reply to this email — we would rather put you on the right one.`,
    }),
  }
}

/** A renewal failed. This one has to be unmistakably clear. */
export function subscriptionPaymentFailed({ clinic, graceDays }) {
  return {
    subject: `Action needed: your ${platform.name} payment did not go through`,
    html: layout({
      heading: 'Your last payment did not go through',
      body: `
        <p style="margin:0 0 4px;">Hello,</p>
        <p style="margin:0 0 12px;">We could not collect this month's subscription for ${escape(clinic.name)}. Usually this means a card has expired or a bank declined the mandate — it is rarely anything more than that.</p>
        <p style="margin:0 0 12px;"><strong>Nothing has stopped working.</strong> You have ${graceDays} days to sort it out, and your bookings, records and website carry on as normal in the meantime.</p>
        <p style="margin:0;">After that, the clinic goes read-only: you keep access to everything already there, but new bookings pause until a payment succeeds.</p>`,
      cta: { label: 'Update your payment method', href: clinicUrl(clinic.slug, '/admin/billing') },
      footerNote: `If you think this is a mistake, reply to this email and we will look into it before anything changes.`,
    }),
  }
}

/** A new physiotherapist has been given an account. */
export function staffWelcome({ clinic, name, email }) {
  return {
    subject: `You have been added to ${clinic.name} on ${platform.name}`,
    html: layout({
      clinic,
      heading: `Welcome to ${clinic.name}`,
      body: `
        <p style="margin:0 0 4px;">Hello ${escape(name?.split(' ')[0] || 'there')},</p>
        <p style="margin:0 0 12px;">An account has been created for you at ${escape(clinic.name)}. You can see your diary, run online consultations and write clinical notes.</p>
        ${detailRows([
          ['Sign in at', clinicUrl(clinic.slug, '/login').replace(/^https?:\/\//, '')],
          ['Your email', email],
        ])}
        <p style="margin:0;">Your administrator will give you a temporary password. Please change it the first time you sign in.</p>`,
      cta: { label: 'Sign in', href: clinicUrl(clinic.slug, '/login') },
    }),
  }
}

/** A clinic just signed up — a note to you, the platform owner. */
export function newClinicForPlatform({ clinic, ownerName, ownerEmail, planName }) {
  return {
    subject: `New clinic: ${clinic.name} (${planName || 'trial'})`,
    html: layout({
      heading: 'A new clinic has signed up',
      body: `
        ${detailRows([
          ['Clinic', clinic.name],
          ['Address', clinicUrl(clinic.slug).replace(/^https?:\/\//, '')],
          ['Owner', ownerName],
          ['Email', ownerEmail],
          clinic.city ? ['City', clinic.city] : null,
          ['Plan chosen', planName || '—'],
        ])}
        <p style="margin:0;">They are on a trial. The best thing you can do today is send them a short, human email asking what brought them here.</p>`,
      cta: { label: 'Open the platform admin', href: platformUrl('/platform/clinics') },
    }),
  }
}

/**
 * The reset link.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO
 * ----------------------------------------
 *  1. It never says whether an account exists. This template is only ever built
 *     when one does — the caller sends nothing at all otherwise — so there is no
 *     "we could not find you" variant to leak by accident.
 *
 *  2. It carries no password, ever. Compare staffWelcome(), which has the same
 *     note: email is not a secure channel. A link that expires in an hour and dies
 *     on first use is a far smaller thing to lose than a password.
 *
 * The "if this was not you" line is not politeness. It is the only warning a
 * person gets that somebody is trying their email address, and it costs nothing.
 */
export function passwordReset({ clinic, name, url, minutes }) {
  const senderName = clinic?.name || platform.name
  return {
    subject: `Reset your ${senderName} password`,
    html: layout({
      clinic,
      heading: 'Reset your password',
      body: `
        <p style="margin:0 0 4px;">Hello ${escape(name?.split(' ')[0] || 'there')},</p>
        <p style="margin:0 0 12px;">Someone asked to reset the password for this email address at ${escape(senderName)}. Use the button below to choose a new one.</p>
        <p style="margin:0 0 12px;">The link works once and expires in ${minutes} minutes.</p>
        <p style="margin:0;color:#64748b;font-size:13px;">If this was not you, no action is needed — your password has not changed. But if you get these repeatedly, tell us.</p>`,
      cta: { label: 'Choose a new password', href: url },
      footerNote: 'For your security, never share this link with anyone.',
    }),
  }
}

/**
 * Sent AFTER a password changes, to the address it changed on.
 *
 * WHY THIS MATTERS MORE THAN THE RESET EMAIL
 * ------------------------------------------
 * If an attacker takes an account, the reset email went to the mailbox they
 * control. This one goes to the address on file — and it is the moment the real
 * owner finds out. Without it, a silent takeover stays silent.
 *
 * It is why the notification is sent even when the change was legitimate and
 * obvious: the value is entirely in the case where it was not.
 */
export function passwordChanged({ clinic, name }) {
  const senderName = clinic?.name || platform.name
  return {
    subject: `Your ${senderName} password was changed`,
    html: layout({
      clinic,
      heading: 'Your password was changed',
      body: `
        <p style="margin:0 0 4px;">Hello ${escape(name?.split(' ')[0] || 'there')},</p>
        <p style="margin:0 0 12px;">The password for your ${escape(senderName)} account was just changed.</p>
        <p style="margin:0;">If you did this, there is nothing to do. If you did not, reset it immediately and contact us at ${escape(platform.supportEmail)}.</p>`,
      cta: { label: 'Reset your password', href: clinic?.slug ? clinicUrl(clinic.slug, '/forgot-password') : platformUrl('/forgot-password') },
    }),
  }
}

/**
 * Confirmation that a subscription is ending.
 *
 * WHY THIS EMAIL MATTERS MORE THAN IT LOOKS
 * ----------------------------------------
 * It is the last thing the product says to a leaving customer, and it is read
 * carefully — because the sender is worried about exactly two things: whether they
 * will be charged again, and whether their patient records are about to vanish.
 *
 * So both are answered in the first two lines, in plain words, before anything
 * else. Every other consideration on this page is secondary to those two.
 *
 * It also carries the export link. A clinic that leaves able to take its data is a
 * clinic that recommends you anyway — and one that comes back when the reason they
 * left stops being true.
 */
export function subscriptionCancelled({ clinic, name, endsAt, immediate }) {
  return {
    subject: immediate
      ? `Your ${platform.name} trial has ended`
      : `Your ${platform.name} subscription ends ${formatDateLong(endsAt)}`,
    html: layout({
      clinic,
      heading: immediate ? 'Your trial has ended' : 'Your subscription is set to end',
      body: `
        <p style="margin:0 0 4px;">Hello ${escape(name?.split(' ')[0] || 'there')},</p>
        <p style="margin:0 0 12px;"><strong>You will not be charged again.</strong> ${
          immediate
            ? 'Nothing was charged at any point during your trial.'
            : `Your current month runs until ${escape(formatDateLong(endsAt))}, and everything works normally until then.`
        }</p>
        <p style="margin:0 0 12px;"><strong>None of your data is deleted.</strong> Your patients, appointments, clinical notes and payment history all stay exactly as they are. If you come back, they are still here.</p>
        <p style="margin:0 0 12px;">After that date your website stops taking new online bookings, and you and your team can still sign in to read everything.</p>
        <p style="margin:0;">Do take a copy of your records for yourself — it is one button, and it is your data.</p>`,
      cta: { label: 'Download your data', href: clinicUrl(clinic.slug, '/admin/settings/data') },
      footerNote: `If you cancelled by mistake, or if there is something we could have fixed, reply to this email — it reaches a person.`,
    }),
  }
}

/**
 * Tells the platform owner, the same day.
 *
 * A cancellation heard about today is one a phone call can sometimes still save.
 * One discovered next month in a revenue chart is simply gone. The churn reason is
 * in the subject line so it is readable without opening anything.
 */
export function clinicCancelledForPlatform({ clinic, planName, reason, note, endsAt, immediate }) {
  const readable = {
    too_expensive: 'Too expensive',
    not_using_it: 'Not using it',
    missing_feature: 'Missing a feature',
    switching: 'Switching to something else',
    closing_clinic: 'Closing the clinic',
    other: 'Other',
  }

  return {
    subject: `Cancelled: ${clinic.name}${reason ? ` — ${readable[reason] || reason}` : ''}`,
    html: layout({
      heading: `${clinic.name} has cancelled`,
      body: `
        ${detailRows([
          ['Clinic', clinic.name],
          ['Plan', planName || '—'],
          ['Reason given', reason ? readable[reason] || reason : 'Not given'],
          note ? ['In their words', note] : null,
          [immediate ? 'Trial ended' : 'Access ends', formatDateLong(endsAt)],
          ['City', clinic.city || '—'],
        ])}
        <p style="margin:0 0 12px;">${
          immediate
            ? 'This was a trial, so nothing was ever charged.'
            : 'They keep working until the date above. Razorpay has been told to stop at the end of the cycle.'
        }</p>
        <p style="margin:0;">If the reason is anything other than "closing the clinic", a short call today is worth making. Ask what they moved to and why — that answer is worth more than the subscription.</p>`,
      cta: { label: 'Open the platform admin', href: platformUrl('/platform/clinics') },
    }),
  }
}
