/**
 * ============================================================================
 *  SHARED HELPERS
 * ============================================================================
 *  Small pure functions used by both the server and the browser. Keeping them
 *  in one place means a date is formatted identically everywhere, which stops
 *  the classic bug where the booking page says "3:00 PM" and the confirmation
 *  email says "15:00".
 * ============================================================================
 */

/**
 * NOTE ON MULTI-TENANCY
 * --------------------
 * These helpers used to read a single global clinic from config/site.js. On a
 * platform serving many clinics there is no such thing as "the" clinic, so
 * anything clinic-specific — currency, timezone, cancellation policy — is now
 * passed IN, with a sensible default for the common case.
 *
 * Defaults are Indian because that is the market. A clinic row can override
 * every one of them, and passing the clinic is always preferred to relying on
 * the default.
 */

const DEFAULT_TIMEZONE = 'Asia/Kolkata'
const DEFAULT_CURRENCY = { code: 'INR', symbol: '₹', locale: 'en-IN' }

/** Accepts a clinic row, a timezone string, or nothing. */
function timezoneOf(clinicOrTz) {
  if (!clinicOrTz) return DEFAULT_TIMEZONE
  if (typeof clinicOrTz === 'string') return clinicOrTz
  return clinicOrTz.timezone || DEFAULT_TIMEZONE
}

/* -------------------------------------------------------------------------- */
/*  CLASS NAMES                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Join Tailwind class names, ignoring anything falsy.
 *
 *   cn('px-4', isActive && 'bg-brand-600', isDisabled ? 'opacity-50' : null)
 *
 * The popular `clsx` package does exactly this. It is nine lines, so we write
 * it ourselves rather than adding a dependency.
 */
export function cn(...classes) {
  return classes.filter(Boolean).join(' ')
}

/* -------------------------------------------------------------------------- */
/*  MONEY                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Turn paise (integer) into a display string: 80000 → "₹800"
 *
 * Reminder on why the database stores paise: JavaScript cannot represent 0.1
 * exactly in binary, so 0.1 + 0.2 gives 0.30000000000000004. Add up a few
 * hundred appointments and your accounts genuinely do not balance. Integers
 * have no such problem, so all arithmetic happens in paise and we only divide
 * by 100 at the very last moment, purely for display.
 */
export function formatMoney(paise, { withDecimals = false, clinic } = {}) {
  const rupees = (paise || 0) / 100
  const locale = clinic?.currency ? 'en-IN' : DEFAULT_CURRENCY.locale
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: clinic?.currency || DEFAULT_CURRENCY.code,
    minimumFractionDigits: withDecimals ? 2 : 0,
    maximumFractionDigits: withDecimals ? 2 : 0,
  }).format(rupees)
}

export const toPaise = (rupees) => Math.round(Number(rupees) * 100)
export const toRupees = (paise) => (paise || 0) / 100

/* -------------------------------------------------------------------------- */
/*  DATES AND TIMES                                                           */
/* -------------------------------------------------------------------------- */
/*
 *  A NOTE ON THE APPROACH USED HERE
 *
 *  Appointment dates are stored as 'YYYY-MM-DD' strings and times as
 *  'HH:MM:SS' strings, both in clinic-local time. We deliberately never turn
 *  them into a JavaScript Date until we have to.
 *
 *  Why? `new Date('2026-03-15')` is parsed as UTC midnight, so a browser in
 *  India shows it correctly but a server in UTC-5 shows the 14th. Handling
 *  dates as plain strings sidesteps that entire class of bug. The clinic is in
 *  one city and one timezone, so a calendar date really is just a date.
 */

/** Today in the clinic's timezone, as 'YYYY-MM-DD'. */
export function todayISO(clinicOrTz) {
  // 'en-CA' formats as YYYY-MM-DD, which is a handy trick for getting a local
  // calendar date in a specific timezone without any date library.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezoneOf(clinicOrTz) }).format(new Date())
}

/** The current clinic-local time as 'HH:MM'. */
export function nowTime(clinicOrTz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezoneOf(clinicOrTz),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

/** Add days to a 'YYYY-MM-DD' string and get another 'YYYY-MM-DD' string. */
export function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  // Month is 0-indexed in JS Date, hence m - 1. Using Date.UTC keeps the
  // arithmetic away from any local-timezone shifting.
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** getDay()-style weekday number for an ISO date. 0 = Sunday. */
export function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** '2026-03-15' → 'Sunday, 15 March 2026' */
export function formatDateLong(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** '2026-03-15' → 'Sun, 15 Mar' */
export function formatDateShort(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/** '14:30:00' → '2:30 PM' */
export function formatTime(time) {
  if (!time) return ''
  const [hStr, mStr] = String(time).split(':')
  let hour = Number(hStr)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  hour = hour % 12 || 12          // 0 → 12, 13 → 1
  return `${hour}:${mStr} ${suffix}`
}

/** 'Today' / 'Tomorrow' / 'Sat, 21 Mar' — friendlier in lists. */
export function formatDateRelative(iso) {
  const today = todayISO()
  if (iso === today) return 'Today'
  if (iso === addDaysISO(today, 1)) return 'Tomorrow'
  if (iso === addDaysISO(today, -1)) return 'Yesterday'
  return formatDateShort(iso)
}

/** Minutes between two 'HH:MM' times. */
export function minutesBetween(from, to) {
  return toMinutes(to) - toMinutes(from)
}

/** 'HH:MM' → minutes since midnight. Makes time comparison plain arithmetic. */
export function toMinutes(time) {
  const [h, m] = String(time).split(':').map(Number)
  return h * 60 + m
}

/** minutes since midnight → 'HH:MM:SS' (the format MySQL TIME wants). */
export function toTimeString(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

/** How old someone is, from a date of birth. */
export function ageFrom(dob) {
  if (!dob) return null
  const [y, m, d] = String(dob).slice(0, 10).split('-').map(Number)
  const today = new Date()
  let age = today.getFullYear() - y
  // Subtract a year if their birthday has not happened yet this year.
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--
  return age
}

/* -------------------------------------------------------------------------- */
/*  IDS AND CODES                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A short human-readable appointment reference: 'APT-7K3M9Q'.
 *
 * The alphabet leaves out 0, O, 1, I and L on purpose, because those are the
 * characters people misread and mistype when reading a code over the phone.
 */
export function generateAppointmentCode() {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return `APT-${code}`
}

/**
 * The private room name for a video consultation.
 *
 * This is a capability URL: knowing the room id is what grants entry, so it
 * must be long and unguessable. crypto.randomUUID is cryptographically random
 * and available in both Node and the browser.
 */
export function generateRoomId() {
  return `room_${crypto.randomUUID().replace(/-/g, '')}`
}

/* -------------------------------------------------------------------------- */
/*  TEXT                                                                      */
/* -------------------------------------------------------------------------- */

/** 'Back & Neck Pain!' → 'back-neck-pain' — for SEO-friendly URLs. */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')   // anything not a letter or digit → hyphen
    .replace(/^-+|-+$/g, '')       // trim hyphens from both ends
}

/**
 * The first name, ignoring any title.
 *
 *   firstName('Dr. Ananya Verma')  → 'Ananya'
 *   firstName('Rohan Deshpande')   → 'Rohan'
 *
 * Written because `name.split(' ')[0]` — the obvious version — returns "Dr." for
 * every doctor in the system, which produced the genuinely odd sentence
 * "See Dr. at the clinic, or over video from home" on the homepage.
 */
export function firstName(name) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter((word) => !/^(dr|mr|mrs|ms|miss|prof|shri|smt)\.?$/i.test(word))

  return words[0] || String(name || '').trim()
}

export function initials(name) {
  return String(name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

export function truncate(text, length = 120) {
  if (!text || text.length <= length) return text || ''
  return text.slice(0, length).trimEnd() + '…'
}

/* -------------------------------------------------------------------------- */
/*  APPOINTMENT STATUS PRESENTATION                                           */
/* -------------------------------------------------------------------------- */

/**
 * One place that decides how every status is worded and coloured. Without
 * this you end up writing `status === 'pending_payment' ? ... : ...` in eight
 * components and they slowly drift apart.
 */
export const STATUS_META = {
  pending_payment: { label: 'Awaiting payment', tone: 'warning' },
  confirmed:       { label: 'Confirmed',        tone: 'success' },
  in_progress:     { label: 'In progress',      tone: 'info' },
  completed:       { label: 'Completed',        tone: 'neutral' },
  cancelled:       { label: 'Cancelled',        tone: 'danger' },
  no_show:         { label: 'No show',          tone: 'danger' },
}

export function statusMeta(status) {
  return STATUS_META[status] || { label: status, tone: 'neutral' }
}

/**
 * Can this appointment's video room be opened right now?
 *
 * We allow joining from 10 minutes before the start time until 30 minutes
 * after the end time. Early access lets people sort out camera permissions
 * without eating into their session; the grace period at the end means a call
 * that overruns slightly does not get cut off.
 */
export function canJoinCall(appointment, { earlyMinutes = 10, graceMinutes = 30 } = {}) {
  if (!appointment) return false
  if (appointment.mode !== 'online') return false
  if (!['confirmed', 'in_progress'].includes(appointment.status)) return false

  const today = todayISO()
  const date = String(appointment.appointment_date).slice(0, 10)
  if (date !== today) return false

  const now = toMinutes(nowTime())
  return (
    now >= toMinutes(appointment.start_time) - earlyMinutes &&
    now <= toMinutes(appointment.end_time) + graceMinutes
  )
}

/** Whether cancelling now still earns a refund, per the clinic's policy. */
export function isRefundable(appointment, freeCancellationHours = 12) {
  if (!appointment || appointment.status !== 'confirmed') return false
  const date = String(appointment.appointment_date).slice(0, 10)
  const hoursUntil =
    (Date.parse(`${date}T${appointment.start_time}`) - Date.now()) / 3_600_000
  return hoursUntil >= freeCancellationHours
}
