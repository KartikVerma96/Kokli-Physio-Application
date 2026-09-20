/**
 * ============================================================================
 *  INPUT VALIDATION
 * ============================================================================
 *
 *  Every piece of data arriving from a browser is validated here before it is
 *  allowed anywhere near the database.
 *
 *  WHY BOTHER, WHEN THE FORM ALREADY HAS `required` ON THE INPUTS?
 *  --------------------------------------------------------------
 *  Because HTML validation is a convenience for honest users, not a security
 *  control. Anyone can open a terminal and do this:
 *
 *      curl -X POST localhost:3000/api/appointments \
 *           -d '{"serviceId":"; DROP TABLE users --","painLevel":9999}'
 *
 *  No form, no JavaScript, no `required` attribute in sight. The server is the
 *  only place a rule can actually be enforced.
 *
 *  We use Zod: describe the shape you want, and it either hands you clean
 *  typed data or a list of human-readable problems.
 * ============================================================================
 */

import { z } from 'zod'

/* -------------------------------------------------------------------------- */
/*  REUSABLE PIECES                                                           */
/* -------------------------------------------------------------------------- */

const email = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .max(190, 'That email is too long')
  .toLowerCase()
  .email('Enter a valid email address')

const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Passwords cannot be longer than 72 characters')
  // bcrypt silently ignores anything past 72 bytes, so a 200-character
  // password is no stronger than its first 72. We reject rather than truncate,
  // because silently altering someone's password is worse than telling them.
  .refine((v) => /[a-zA-Z]/.test(v), 'Include at least one letter')
  .refine((v) => /[0-9]/.test(v), 'Include at least one number')

// Indian mobile numbers: 10 digits starting 6–9, optionally with +91 and any
// spaces or dashes people naturally type.
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-()]/g, ''))
  .refine(
    (v) => v === '' || /^(\+91)?[6-9]\d{9}$/.test(v),
    'Enter a valid 10-digit mobile number'
  )

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must look like 2026-03-15')

const isoTime = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time must look like 14:30')

const id = z.coerce.number().int().positive()

/* -------------------------------------------------------------------------- */
/*  ACCOUNTS                                                                  */
/* -------------------------------------------------------------------------- */

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Please enter your full name')
      .max(120, 'That name is too long'),
    email,
    phone: phone.optional().or(z.literal('')),
    password,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, {
      message: 'Please accept the terms to continue',
    }),
  })
  // `refine` on the whole object is how you validate one field against
  // another. `path` decides which input shows the error.
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
})

export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your full name').max(120),
  phone: phone.optional().or(z.literal('')),
  dateOfBirth: isoDate.optional().or(z.literal('')),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional().or(z.literal('')),
  address: z.string().trim().max(300).optional().or(z.literal('')),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  occupation: z.string().trim().max(120).optional().or(z.literal('')),
  heightCm: z.coerce.number().int().min(50).max(250).optional().or(z.literal('')),
  weightKg: z.coerce.number().int().min(10).max(300).optional().or(z.literal('')),
  emergencyContactName: z.string().trim().max(120).optional().or(z.literal('')),
  emergencyContactPhone: phone.optional().or(z.literal('')),
  medicalHistory: z.string().trim().max(4000).optional().or(z.literal('')),
  currentMedications: z.string().trim().max(2000).optional().or(z.literal('')),
  allergies: z.string().trim().max(1000).optional().or(z.literal('')),
})

/* -------------------------------------------------------------------------- */
/*  CLINIC SIGNUP — a physiotherapist creating their business                 */
/* -------------------------------------------------------------------------- */

export const signupSchema = z
  .object({
    // ---- the person
    name: z.string().trim().min(2, 'Please enter your full name').max(120),
    email,
    phone: phone.optional().or(z.literal('')),
    password,
    confirmPassword: z.string(),

    // ---- the business
    clinicName: z
      .string()
      .trim()
      .min(2, 'Please enter your clinic name')
      .max(120, 'That name is too long'),
    /**
     * The subdomain. Deliberately strict, because it becomes a DNS label and a
     * permanent public address:
     *   - 3–63 characters (63 is the DNS limit for one label)
     *   - lowercase letters, digits and hyphens only
     *   - cannot start or end with a hyphen
     * The reserved-word check lives in config/platform.js and runs server-side.
     */
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, 'At least 3 characters')
      .max(63, 'At most 63 characters')
      .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens only')
      .refine((v) => !v.startsWith('-') && !v.endsWith('-'), 'Cannot start or end with a hyphen'),

    city: z.string().trim().max(80).optional().or(z.literal('')),
    planCode: z.string().trim().max(40).optional().or(z.literal('')),

    acceptTerms: z.literal(true, { message: 'Please accept the terms to continue' }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

/** Step 1 of onboarding — the clinic's public details. */
export const clinicDetailsSchema = z.object({
  name: z.string().trim().min(2, 'Clinic name is required').max(120),
  legalName: z.string().trim().max(160).optional().or(z.literal('')),
  tagline: z.string().trim().max(200).optional().or(z.literal('')),
  description: z.string().trim().max(300).optional().or(z.literal('')),
  phone: phone.optional().or(z.literal('')),
  whatsapp: phone.optional().or(z.literal('')),
  email: z.string().trim().toLowerCase().max(190).optional().or(z.literal('')),
  addressLine1: z.string().trim().max(160).optional().or(z.literal('')),
  addressLine2: z.string().trim().max(160).optional().or(z.literal('')),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  state: z.string().trim().max(80).optional().or(z.literal('')),
  postalCode: z.string().trim().max(20).optional().or(z.literal('')),
  latitude: z.coerce.number().min(-90).max(90).optional().or(z.literal('')),
  longitude: z.coerce.number().min(-180).max(180).optional().or(z.literal('')),
  brandColour: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0d9488')
    .optional()
    .or(z.literal('')),
  practitionerName: z.string().trim().max(120).optional().or(z.literal('')),
  practitionerCredentials: z.string().trim().max(120).optional().or(z.literal('')),
  practitionerRegistration: z.string().trim().max(80).optional().or(z.literal('')),
  practitionerExperienceYears: z.coerce.number().int().min(0).max(70).optional().or(z.literal('')),
  practitionerBio: z.string().trim().max(4000).optional().or(z.literal('')),
})

/** Step 4 of onboarding — connecting the clinic's own Razorpay account. */
export const razorpayKeysSchema = z.object({
  keyId: z
    .string()
    .trim()
    .min(10, 'Paste your Key ID')
    .regex(/^rzp_(test|live)_[A-Za-z0-9]+$/, 'Should look like rzp_test_xxxxxxxxxxxx'),
  keySecret: z.string().trim().min(10, 'Paste your Key Secret').max(200),
  webhookSecret: z.string().trim().max(200).optional().or(z.literal('')),
})

/* -------------------------------------------------------------------------- */
/*  BOOKING                                                                   */
/* -------------------------------------------------------------------------- */

export const createAppointmentSchema = z.object({
  serviceId: id,
  date: isoDate,
  startTime: isoTime,
  mode: z.enum(['online', 'clinic', 'home'], { message: 'Choose how you want to be seen' }),
  // Only meaningful for a home visit. Validated as required in the endpoint rather
  // than here, because the requirement depends on `mode`.
  visitAddress: z.string().trim().max(500).optional().or(z.literal('')),
  // What the patient is coming in for. Optional, but genuinely useful — a
  // physio who reads "left knee, stairs, 3 weeks" before the session starts
  // can prepare instead of spending the first five minutes asking.
  patientNotes: z.string().trim().max(1000).optional().or(z.literal('')),
  // The pain scale physiotherapists actually use: 0 is no pain, 10 is the
  // worst imaginable. Recorded at booking so progress can be measured later.
  painLevel: z.coerce.number().int().min(0).max(10).optional().or(z.literal('')),
  /**
   * Spend a prepaid session instead of paying.
   *
   * Only an ID is accepted — never a price, never a session count. The server
   * proves the package belongs to this patient, covers this treatment, has not
   * expired and has a session left, all under a row lock. Exactly the same
   * principle as never letting the browser name an amount.
   */
  patientPackageId: z.coerce.number().int().positive().optional().or(z.literal('')),
})

export const cancelAppointmentSchema = z.object({
  appointmentId: id,
  reason: z.string().trim().max(255).optional().or(z.literal('')),
})

/* -------------------------------------------------------------------------- */
/*  PAYMENTS                                                                  */
/* -------------------------------------------------------------------------- */

export const verifyPaymentSchema = z.object({
  appointmentId: id,
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
})

/* -------------------------------------------------------------------------- */
/*  ADMIN                                                                     */
/* -------------------------------------------------------------------------- */

export const serviceSchema = z.object({
  name: z.string().trim().min(3, 'Name is required').max(160),
  slug: z
    .string()
    .trim()
    .min(3, 'Slug is required')
    .max(120)
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens only'),
  shortDescription: z.string().trim().min(10, 'Write at least a sentence').max(300),
  description: z.string().trim().max(8000).optional().or(z.literal('')),
  icon: z.string().trim().max(60).optional().or(z.literal('')),
  durationMinutes: z.coerce.number().int().min(10).max(240),
  // Entered in rupees in the admin form; converted to paise before storing.
  priceRupees: z.coerce.number().min(0).max(1_000_000),
  availableOnline: z.coerce.boolean(),
  availableClinic: z.coerce.boolean(),
  availableHome: z.coerce.boolean(),
  // Blank means "not priced for home", which is different from ₹0.
  homePriceRupees: z.union([z.coerce.number().min(0).max(1_000_000), z.literal('')]).optional(),
  isActive: z.coerce.boolean(),
  seoTitle: z.string().trim().max(200).optional().or(z.literal('')),
  seoDescription: z.string().trim().max(300).optional().or(z.literal('')),
})

export const availabilityRuleSchema = z
  .object({
    weekday: z.coerce.number().int().min(0).max(6),
    startTime: isoTime,
    endTime: isoTime,
    slotMinutes: z.coerce.number().int().min(10).max(120),
    mode: z.enum(['online', 'clinic', 'both', 'home']),
    /**
     * How many patients this therapist takes at once in these hours.
     *
     * Capped at 8 in the database too. A physiotherapist genuinely treating three
     * people at once is not overbooking — one is on traction, one under ultrasound,
     * and they are doing hands-on work with the third. A clinic that sets ten is
     * lying to its patients.
     */
    capacity: z.coerce.number().int().min(1).max(8).optional(),
  })
  .refine((d) => d.endTime > d.startTime, {
    message: 'The finish time must be after the start time',
    path: ['endTime'],
  })

export const timeOffSchema = z
  .object({
    offDate: isoDate,
    startTime: isoTime.optional().or(z.literal('')),
    endTime: isoTime.optional().or(z.literal('')),
    reason: z.string().trim().max(200).optional().or(z.literal('')),
  })
  .refine((d) => !d.startTime || !d.endTime || d.endTime > d.startTime, {
    message: 'The finish time must be after the start time',
    path: ['endTime'],
  })

/**
 * Clinical notes in SOAP format. See the comment on the consultation_notes
 * table in database/schema.sql for what each letter means.
 */
export const consultationNoteSchema = z.object({
  appointmentId: id,
  subjective: z.string().trim().max(4000).optional().or(z.literal('')),
  objective: z.string().trim().max(4000).optional().or(z.literal('')),
  assessment: z.string().trim().max(4000).optional().or(z.literal('')),
  plan: z.string().trim().max(4000).optional().or(z.literal('')),
  painLevelBefore: z.coerce.number().int().min(0).max(10).optional().or(z.literal('')),
  painLevelAfter: z.coerce.number().int().min(0).max(10).optional().or(z.literal('')),
  followUpDate: isoDate.optional().or(z.literal('')),
  sessionsRecommended: z.coerce.number().int().min(0).max(60).optional().or(z.literal('')),
  exercises: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        sets: z.string().trim().max(40).optional().or(z.literal('')),
        reps: z.string().trim().max(40).optional().or(z.literal('')),
        frequency: z.string().trim().max(80).optional().or(z.literal('')),
        notes: z.string().trim().max(300).optional().or(z.literal('')),
      })
    )
    .max(20)
    .optional(),
})

/* -------------------------------------------------------------------------- */
/*  RUNNING A SCHEMA                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Validate an object and get back a predictable shape:
 *
 *   { ok: true,  data:   {...clean values} }
 *   { ok: false, errors: { email: 'Enter a valid email address' } }
 *
 * The flat `errors` object is designed to be handed straight to a form, where
 * each input looks up its own message by field name.
 */
export function validate(schema, input) {
  const result = schema.safeParse(input)
  if (result.success) return { ok: true, data: result.data }

  const errors = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0] ?? '_form'
    // Keep only the first problem per field. Showing a patient four separate
    // complaints about one password box is discouraging and unnecessary.
    if (!errors[field]) errors[field] = issue.message
  }
  return { ok: false, errors }
}

/**
 * Same thing for API routes, which receive JSON rather than a form.
 * Handles the case where the body is not valid JSON at all.
 */
export async function validateRequest(schema, request) {
  let body
  try {
    body = await request.json()
  } catch {
    return { ok: false, errors: { _form: 'Expected a JSON request body' } }
  }
  return validate(schema, body)
}
