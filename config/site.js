/**
 * ============================================================================
 *  SINGLE SOURCE OF TRUTH FOR ALL CLINIC INFORMATION
 * ============================================================================
 *
 *  This is the ONLY file you need to edit to make the whole website yours.
 *  The clinic name, phone number, address, doctor bio, services and even the
 *  SEO tags all read from here. Change it once, it changes everywhere.
 *
 *  Search this file for "CHANGE ME" to find everything you should replace.
 * ============================================================================
 */

export const site = {
  // ---------------------------------------------------------------- identity
  name: 'Aarogya Physiotherapy', // CHANGE ME
  legalName: 'Aarogya Physiotherapy & Rehab Clinic', // CHANGE ME
  tagline: 'Move better. Live pain-free.',
  // A one-line description. Google shows this under your name in results,
  // so keep it under ~155 characters and put your city + main service in it.
  description:
    'Expert physiotherapy in Pune for back pain, neck pain, sports injuries and post-surgery rehab. Book an in-clinic visit or a same-day online video consultation.',

  // The full public URL of your site. Used for SEO tags and the sitemap.
  // In development this stays localhost; on your live server set NEXT_PUBLIC_SITE_URL.
  url: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',

  // --------------------------------------------------------------- the doctor
  doctor: {
    name: 'Dr. Ananya Verma', // CHANGE ME
    // "PT" is the standard suffix for a physiotherapist in India.
    credentials: 'BPT, MPT (Orthopaedics)',
    title: 'Consultant Physiotherapist',
    registration: 'MH-PT-2016-04821', // CHANGE ME — state council registration no.
    experienceYears: 9,
    languages: ['English', 'Hindi', 'Marathi'],
    bio: 'Ananya has spent nine years helping people get back to the things they love — whether that is picking up a grandchild without wincing, returning to the cricket pitch after an ACL repair, or simply sitting through a workday without neck pain. She trained in orthopaedic manual therapy and believes the best treatment is the one you understand, so every session ends with a plan you can actually follow at home.',
    specialisations: [
      'Orthopaedic manual therapy',
      'Sports injury rehabilitation',
      'Post-operative recovery',
      'Dry needling',
      'Ergonomic & posture correction',
    ],
  },

  // ------------------------------------------------------------------ contact
  contact: {
    phone: '+91 90000 00000', // CHANGE ME
    // Digits only, with country code — used to build the wa.me link.
    whatsapp: '919000000000', // CHANGE ME
    email: 'hello@aarogyaphysio.in', // CHANGE ME
  },

  address: {
    line1: '2nd Floor, Sunrise Arcade', // CHANGE ME
    line2: 'Baner Road, Near Balewadi Phata',
    city: 'Pune',
    state: 'Maharashtra',
    postalCode: '411045',
    country: 'IN',
    countryName: 'India',
    // Latitude / longitude power the "local business" SEO tag and the map link.
    // Get yours: open Google Maps, right-click your clinic, click the numbers.
    latitude: 18.5642,
    longitude: 73.7769,
    mapsUrl: 'https://maps.google.com/?q=18.5642,73.7769', // CHANGE ME
  },

  // ------------------------------------------------------- opening hours (UI)
  // These are the hours shown to visitors and given to Google. The hours that
  // actually control bookable slots live in the `availability_rules` database
  // table and are edited from Admin → Availability.
  openingHours: [
    { days: 'Monday – Friday', time: '9:00 AM – 8:00 PM' },
    { days: 'Saturday', time: '9:00 AM – 4:00 PM' },
    { days: 'Sunday', time: 'Online consultations only' },
  ],
  // Machine-readable version for Google. Format: DayCode HH:MM-HH:MM
  openingHoursSpec: [
    { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '20:00' },
    { days: ['Saturday'], opens: '09:00', closes: '16:00' },
  ],

  // ---------------------------------------------------------------- social
  social: {
    instagram: 'https://instagram.com/aarogyaphysio', // CHANGE ME
    facebook: 'https://facebook.com/aarogyaphysio',
    youtube: '',
    linkedin: '',
  },

  // ---------------------------------------------------------------- money
  currency: {
    code: 'INR',
    symbol: '₹',
    locale: 'en-IN',
  },

  // The clinic's timezone. All appointment times are stored and shown in it.
  timezone: 'Asia/Kolkata',

  // ---------------------------------------------------------------- booking
  booking: {
    // How many days ahead a patient may book.
    maxDaysAhead: 30,
    // A slot must be at least this many minutes in the future to be bookable.
    // Stops someone booking a 10:00 slot at 09:59.
    minNoticeMinutes: 60,
    // After picking a slot the patient has this long to pay before the slot
    // is released back to everyone else. See lib/slots.js.
    paymentHoldMinutes: 15,
    // Free cancellation up to this many hours before the appointment.
    freeCancellationHours: 12,
  },

  // ---------------------------------------------------------------- trust
  // Numbers shown on the homepage. Keep them honest.
  stats: [
    { value: '9+', label: 'Years of practice' },
    { value: '3,200+', label: 'Sessions delivered' },
    { value: '4.9', label: 'Average patient rating' },
    { value: '48hr', label: 'Typical pain relief' },
  ],
}

/**
 * Frequently asked questions.
 *
 * These do double duty: they are rendered on the homepage AND fed to Google as
 * FAQ structured data, which is how you get those expandable question lists
 * directly in the search results. Write real answers — Google rewards them.
 */
export const faqs = [
  {
    q: 'Do I need a doctor’s referral to see a physiotherapist?',
    a: 'No. In India you can book a physiotherapist directly. If you already have X-rays, an MRI or a surgeon’s note, bring them along — they help, but they are not required to get started.',
  },
  {
    q: 'How is an online physiotherapy consultation useful if you cannot touch me?',
    a: 'A great deal of physiotherapy is assessment, diagnosis and teaching. Over video we watch how you move, test your range of motion, identify what is triggering the pain, and then coach you through a corrective exercise programme live. Online works especially well for neck and back pain, posture problems, and follow-ups between clinic visits. If you need hands-on manual therapy, we will tell you honestly and book you in-clinic instead.',
  },
  {
    q: 'What should I wear and prepare for my appointment?',
    a: 'Wear loose, comfortable clothing that lets you move and lets us see the area being treated — shorts for a knee problem, a vest or loose t-shirt for a shoulder. For online sessions, find a quiet spot with about two metres of clear floor space, prop your phone or laptop so your whole body is visible, and keep a chair and a water bottle nearby.',
  },
  {
    q: 'How many sessions will I need?',
    a: 'Most simple problems settle in 4 to 6 sessions. Long-standing pain or post-surgical rehabilitation usually runs 8 to 12 sessions across a few months. You will get an honest estimate at the end of your first assessment, and we re-check progress every fourth session rather than keeping you coming indefinitely.',
  },
  {
    q: 'Does physiotherapy hurt?',
    a: 'Treatment should never be more than mildly uncomfortable. Some techniques — deep tissue work, dry needling, stretching a stiff joint — can feel intense while they happen and leave you a little sore for a day, much like after a good workout. Sharp or worsening pain is always a signal to stop, and you should say so immediately.',
  },
  {
    q: 'How do I pay, and can I get a receipt for insurance?',
    a: 'You pay online while booking, using UPI, any debit or credit card, or netbanking. A GST invoice is emailed to you straight away and is always available in your dashboard, which is what most insurers and employers ask for when reimbursing.',
  },
  {
    q: 'What is your cancellation policy?',
    a: `Cancel or reschedule free of charge up to ${12} hours before your appointment and you get a full refund. Inside 12 hours we cannot refund the session, because that slot can no longer be offered to someone else in pain.`,
  },
]

/**
 * Patient testimonials. Also fed to Google as review structured data, which is
 * what produces the ⭐⭐⭐⭐⭐ stars next to your search listing.
 *
 * IMPORTANT: only ever put real, permission-given reviews here. Made-up reviews
 * violate Google's policy and can get your listing penalised. These are
 * placeholders — replace them with the real thing.
 */
export const testimonials = [
  {
    name: 'Rohan Deshpande',
    role: 'Software engineer, 34',
    condition: 'Chronic lower back pain',
    rating: 5,
    text: 'Two years of sitting badly caught up with me and I could not get through a meeting without standing up. Six sessions plus a genuinely short home routine and I am back to normal. The online follow-ups meant I never had to take an afternoon off work.',
  },
  {
    name: 'Meera Iyer',
    role: 'Teacher, 52',
    condition: 'Frozen shoulder',
    rating: 5,
    text: 'I could not reach the top shelf or fasten my own blouse. The progress was slow at first and Dr. Ananya was upfront about that, which I appreciated. Eleven weeks later I have my arm back.',
  },
  {
    name: 'Aditya Kulkarni',
    role: 'Club cricketer, 25',
    condition: 'ACL reconstruction rehab',
    rating: 5,
    text: 'Post-surgery rehab was mapped out week by week so I always knew what came next. Returned to competitive cricket in seven months, which my surgeon said was ahead of schedule.',
  },
  {
    name: 'Sunita Rao',
    role: 'Retired, 68',
    condition: 'Knee osteoarthritis',
    rating: 5,
    text: 'I was told a knee replacement was my only option. A year of strengthening later I climb the stairs to my flat without holding the railing. Surgery is off the table for now.',
  },
]

/** Helper: the address as one readable line. */
export function formattedAddress() {
  const a = site.address
  return [a.line1, a.line2, `${a.city} ${a.postalCode}`, a.state].filter(Boolean).join(', ')
}

/** Helper: a pre-filled WhatsApp link. */
export function whatsappLink(message = `Hi, I would like to book a physiotherapy appointment.`) {
  return `https://wa.me/${site.contact.whatsapp}?text=${encodeURIComponent(message)}`
}
