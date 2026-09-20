/**
 * ============================================================================
 *  TAKING MONEY AT THE RECEPTION DESK
 * ============================================================================
 *
 *  WHY THIS EXISTS
 *  ---------------
 *  The app could originally only record money that arrived through Razorpay. In
 *  an Indian physiotherapy clinic that is a minority of the takings: most
 *  patients telephone or walk in, and pay cash or UPI at the desk on their way
 *  out.
 *
 *  The consequence was not a missing feature, it was a wrong number. The revenue
 *  figure on the admin dashboard reads from `payments`, so it showed only online
 *  prepayments — a clinic doing ₹80,000 a month saw ₹9,000 and had no way to tell
 *  which was real. A business dashboard that under-reports is worse than none,
 *  because it gets believed.
 *
 *  WHAT MAKES A CASH RECORD TRUSTWORTHY
 *  ------------------------------------
 *  An online payment carries its own proof — a signature only Razorpay could
 *  produce. A ₹800 note handed across a desk carries none. So the two things this
 *  module insists on are:
 *
 *    collected_by   which member of staff recorded it, taken from the session,
 *                   never from the form. This is the only thing that makes the
 *                   cash drawer reconcilable at the end of the day.
 *
 *    amount         read from the service or package in the DATABASE, never from
 *                   the request. Same rule as the online path. Staff may apply a
 *                   discount, but it is recorded as a discount rather than by
 *                   quietly rewriting the price.
 * ============================================================================
 */

/**
 * How the money arrived.
 *
 * `provider` is stored on the payment row; 'razorpay' is added by the online
 * path and deliberately absent here, because nothing at a desk should be able to
 * claim it was an online payment.
 */
export const DESK_PAYMENT_METHODS = [
  {
    value: 'cash',
    label: 'Cash',
    hint: 'Notes handed over at the desk',
  },
  {
    value: 'upi',
    label: 'UPI',
    hint: 'GPay, PhonePe, Paytm — paid to your own QR code',
  },
  {
    value: 'card',
    label: 'Card machine',
    hint: 'Your own POS terminal',
  },
  {
    value: 'bank_transfer',
    label: 'Bank transfer',
    hint: 'NEFT, IMPS or a cheque',
  },
]

const VALID_METHODS = new Set(DESK_PAYMENT_METHODS.map((m) => m.value))

/** True for a method this module is willing to record. */
export function isDeskMethod(value) {
  return VALID_METHODS.has(value)
}

export function deskMethodLabel(value) {
  return DESK_PAYMENT_METHODS.find((m) => m.value === value)?.label || value || 'Unknown'
}

/**
 * Record a payment taken at the desk, inside the caller's transaction.
 *
 * Exactly one of `appointmentId` and `patientPackageId` must be given — the
 * database CHECK enforces it too, so a mistake here fails loudly rather than
 * creating a payment that belongs to nothing.
 *
 * @param {object} tx                  transaction handle from lib/db.js
 * @param {object} details
 * @param {number} details.clinicId
 * @param {number|null} details.appointmentId
 * @param {number|null} details.patientPackageId
 * @param {number} details.amountPaise      from the database, not the form
 * @param {string} details.method           one of DESK_PAYMENT_METHODS
 * @param {number} details.collectedBy      the signed-in staff member's id
 * @param {string} [details.reference]       receipt book number, UPI reference
 */
export async function recordDeskPayment(tx, details) {
  const {
    clinicId,
    appointmentId = null,
    patientPackageId = null,
    amountPaise,
    method,
    collectedBy,
    reference = null,
  } = details

  if (!isDeskMethod(method)) {
    throw new Error(`Not a desk payment method: ${method}`)
  }
  if ((appointmentId === null) === (patientPackageId === null)) {
    throw new Error('A desk payment must be for exactly one appointment or one package')
  }

  const [result] = await tx.execute(
    `INSERT INTO payments
       (clinic_id, appointment_id, patient_package_id, provider, amount_paise, currency,
        status, method, collected_by, reference)
     VALUES (?, ?, ?, ?, ?, 'INR', 'paid', ?, ?, ?)`,
    [
      clinicId,
      appointmentId,
      patientPackageId,
      // The provider IS the method for offline money. There is no gateway to name,
      // and calling it 'razorpay' would make the ledger lie.
      method,
      amountPaise,
      method,
      collectedBy,
      reference || null,
    ]
  )

  return result.insertId
}
