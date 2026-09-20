import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { authConfig } from '@/auth.config'
import { readLoginTicket } from '@/lib/otp'
import { query, queryOne } from '@/lib/db'
import {
  checkLoginAllowed,
  recordLoginFailure,
  clearLoginFailures,
  waitLabel,
} from '@/lib/loginThrottle'

/**
 * ============================================================================
 *  AUTHENTICATION — the full setup
 * ============================================================================
 *
 *  Exports four things the rest of the app uses:
 *
 *    handlers  → wired up in app/api/auth/[...nextauth]/route.js
 *    auth()    → call it in ANY server component to get the current user
 *    signIn()  → used by the login form and the Google button
 *    signOut() → used by the header menu
 *
 *  ---------------------------------------------------------------------------
 *  WHAT MULTI-TENANCY CHANGED HERE
 *  ---------------------------------------------------------------------------
 *  Two things, and both are about the token rather than the login itself:
 *
 *   1. The JWT now carries `clinicId` and `clinicSlug`. proxy.js compares that
 *      slug against the hostname on every request, and it has to come from the
 *      token because middleware cannot query the database.
 *
 *   2. Google sign-up needs to know WHICH clinic the new patient is joining.
 *      The OAuth callback lands on the root domain, so the hostname cannot tell
 *      us — the clinic is carried through the flow in a short-lived cookie
 *      instead. See the signIn callback below.
 *
 *  Emails stay globally unique and a user belongs to exactly one clinic. The
 *  reasoning, and what it costs, is written up on the users table in
 *  database/schema.sql.
 * ============================================================================
 */

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
    ...authConfig.providers,

    /**
     * ---------------------------------------------------------------------
     *  EMAIL + PASSWORD
     * ---------------------------------------------------------------------
     *  `authorize` is the whole thing: return a user object and they are logged
     *  in, return null and they are not. It only ever runs on the server.
     */
    Credentials({
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(credentials, request) {
        const email = String(credentials?.email || '').trim().toLowerCase()
        const password = String(credentials?.password || '')

        if (!email || !password) return null

        /**
         * ------------------------------------------------------------------
         *  THROTTLE FIRST, BEFORE TOUCHING THE DATABASE OR bcrypt
         * ------------------------------------------------------------------
         *  Deliberately the very first thing. bcrypt is intentionally slow, so
         *  running it before the check would let an attacker cost the server
         *  60ms of CPU per guess — a way to exhaust the machine even while
         *  failing to guess anything.
         *
         *  The address comes from the request rather than anything the client
         *  can set. `x-forwarded-for` is only trustworthy behind a proxy you
         *  control; see the note in clientAddress() below.
         */
        const ip = clientAddress(request)
        const gate = await checkLoginAllowed(email, ip)

        if (gate.blocked) {
          /**
           * Throwing rather than returning null.
           *
           * Auth.js turns a returned null into a generic "wrong details", which
           * would be a lie here — the details might be perfect. Somebody locked
           * out by their own typing needs to know they must wait, or they will
           * keep trying and keep extending it.
           *
           * The message deliberately says nothing about whether the account
           * exists: the same wait applies to an email that was never registered,
           * so this cannot be used to check who is a patient here.
           */
          throw new Error(`Too many attempts. Please wait ${waitLabel(gate.secondsLeft)}.`)
        }

        /**
         * One place to record a failure, so no rejection path can forget to.
         *
         * EVERY failure counts, including "no such account" — otherwise the
         * throttle itself becomes an enumeration oracle: unthrottled means the
         * email is unknown, throttled means somebody is a patient here.
         */
        const fail = async () => {
          await recordLoginFailure(email, ip)
          return null
        }

        const user = await queryOne(
          `SELECT u.id, u.name, u.email, u.password_hash, u.phone, u.image, u.role,
                  u.is_active, u.clinic_id, c.slug AS clinic_slug, c.status AS clinic_status
             FROM users u
             LEFT JOIN clinics c ON c.id = u.clinic_id
            WHERE u.email = ?`,
          [email]
        )

        /**
         * SECURITY: every failure path returns exactly the same thing — null —
         * and the login page shows one generic message.
         *
         * It is tempting to be helpful and say "no account with that email".
         * Don't. That turns the login form into a tool for checking whether
         * someone is a patient at a physiotherapy clinic, which is private
         * medical information. This is called account enumeration.
         */
        if (!user) return fail()
        if (!user.is_active) return fail()

        // No password hash means the account was created through Google.
        // Saying so would also leak that the account exists, so stay silent and
        // let the login page mention both options generically.
        if (!user.password_hash) return fail()

        const passwordMatches = await bcrypt.compare(password, user.password_hash)
        if (!passwordMatches) return fail()

        // A clinic switched off by the platform cannot have anyone sign in —
        // including its own staff. Their data is intact; access is not.
        if (user.role !== 'platform' && user.clinic_status === 'suspended') return fail()

        // They got in: forget the failures, so the next honest typo starts fresh.
        await clearLoginFailures(email, ip)

        // Whatever is returned here lands in the `user` argument of the jwt
        // callback below. Never include password_hash.
        return {
          id: String(user.id),
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          phone: user.phone,
          clinicId: user.clinic_id ? String(user.clinic_id) : null,
          clinicSlug: user.clinic_slug ?? null,
        }
      },
    }),

    /**
     * ---------------------------------------------------------------------
     *  PHONE NUMBER + WHATSAPP CODE
     * ---------------------------------------------------------------------
     *  The third door, and for most Indian patients the only one that works.
     *  Reception collects a phone number for everybody and an email for some, so
     *  a desk-created patient has no password and no way to set one. See the long
     *  note at the top of lib/otp.js.
     *
     *  WHY THIS TAKES A TICKET AND NOT A CODE
     *  --------------------------------------
     *  The code has already been checked and consumed by the time we get here —
     *  it had to be, because the household list is only knowable after
     *  verification and one number can belong to a whole family. What arrives is
     *  the signed statement of what was proved, plus which of those accounts the
     *  person picked.
     *
     *  This provider therefore trusts nothing from the browser except a signature
     *  it can verify itself. `userId` is checked against the ids named inside the
     *  ticket, so a tampered id cannot select an account that was not on the
     *  verified number.
     */
    Credentials({
      id: 'phone-otp',
      name: 'Phone number',
      credentials: {
        ticket: { label: 'Ticket', type: 'text' },
        userId: { label: 'Account', type: 'text' },
      },

      async authorize(credentials) {
        const ticket = readLoginTicket(credentials?.ticket)
        if (!ticket) return null

        const wanted = Number(credentials?.userId)

        /**
         * The chosen account must be one the ticket vouches for.
         *
         * Without this line the ticket would prove only "some number at this
         * clinic was verified", and any id could be substituted — which is every
         * account at the clinic, including the owner's.
         */
        if (!wanted || !ticket.userIds.includes(wanted)) return null

        /**
         * Re-read from the database rather than trusting the ticket's contents.
         *
         * Three minutes is short but not zero, and an account can be deactivated
         * or a clinic suspended inside it. The ticket says who MAY sign in; the
         * database decides who still can.
         */
        const user = await queryOne(
          `SELECT u.id, u.name, u.email, u.image, u.role, u.phone,
                  u.clinic_id, u.is_active,
                  c.slug AS clinic_slug, c.status AS clinic_status
             FROM users u
             LEFT JOIN clinics c ON c.id = u.clinic_id
            WHERE u.id = ? AND u.clinic_id = ?`,
          [wanted, ticket.clinicId]
        )

        if (!user || !user.is_active) return null
        // Same rule as the password provider: a switched-off clinic signs nobody in.
        if (user.clinic_status === 'suspended') return null
        /**
         * The platform account keeps a password, always.
         *
         * It can read every clinic's patient records, and a SIM swap — a real and
         * common attack in India — must not be enough to reach that. usersOnNumber()
         * excludes the role too; this is the second check, on the sensitive path.
         */
        if (user.role === 'platform') return null

        return {
          id: String(user.id),
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          phone: user.phone,
          clinicId: user.clinic_id ? String(user.clinic_id) : null,
          clinicSlug: user.clinic_slug ?? null,
        }
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    /**
     * ---------------------------------------------------------------------
     *  GOOGLE SIGN-IN: make sure a local user row exists, in the right clinic
     * ---------------------------------------------------------------------
     *  Google has told us who this person is, but our tables know nothing about
     *  them yet, and every appointment needs a real users.id to point at.
     *
     *  THE MULTI-TENANT WRINKLE: the OAuth callback arrives on the ROOT domain
     *  (Google will not accept wildcard redirect URIs), so the hostname cannot
     *  tell us which clinic they were signing up for. The clinic slug is instead
     *  written to a short-lived cookie before the redirect to Google, and read
     *  back here. See components/auth/GoogleButton.js.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider !== 'google') return true

      // Google will happily tell us the address is unverified. Trusting an
      // unverified address would let someone claim an account that is not
      // theirs.
      if (profile?.email_verified === false) return false

      const email = String(user.email || '').toLowerCase()
      if (!email) return false

      const existing = await queryOne(
        `SELECT u.id, u.is_active, c.status AS clinic_status
           FROM users u LEFT JOIN clinics c ON c.id = u.clinic_id
          WHERE u.email = ?`,
        [email]
      )

      if (existing) {
        if (!existing.is_active) return false
        if (existing.clinic_status === 'suspended') return false

        // Link the Google id to the account they already had and refresh their
        // photo. COALESCE keeps what we have if Google sends nothing.
        await query(
          `UPDATE users
              SET google_id = COALESCE(google_id, ?),
                  image = COALESCE(?, image),
                  email_verified = 1
            WHERE id = ?`,
          [account.providerAccountId, user.image || null, existing.id]
        )
        return true
      }

      // A brand-new person. They must be joining a specific clinic, and we only
      // know which one from the cookie set before the redirect.
      const slug = await readPendingClinicSlug()
      if (!slug) {
        // No clinic context. Refusing is the right call: creating a user with no
        // clinic would violate the tenancy CHECK constraint, and silently
        // guessing a clinic would be worse.
        console.warn('[auth] Google sign-up with no clinic context — rejected')
        return false
      }

      const clinic = await queryOne(
        `SELECT id, status FROM clinics WHERE slug = ?`,
        [slug]
      )
      if (!clinic || clinic.status === 'suspended') return false

      await query(
        `INSERT INTO users (clinic_id, name, email, image, google_id, role, email_verified)
         VALUES (?, ?, ?, ?, ?, 'patient', 1)`,
        [
          clinic.id,
          user.name || email.split('@')[0],
          email,
          user.image || null,
          account.providerAccountId,
        ]
      )
      return true
    },

    /**
     * ---------------------------------------------------------------------
     *  BUILDING THE TOKEN
     * ---------------------------------------------------------------------
     *  Runs on sign-in (when `user` is present) and on every later session read
     *  (when it is not). Anything put on the token is signed into the cookie and
     *  available everywhere afterwards without a database query — which is
     *  exactly why clinicSlug lives here.
     *
     *  Note the asymmetry: the Credentials provider handed us our own row,
     *  complete with clinic. Google handed us Google's id, which means nothing
     *  to our foreign keys — so for Google we look the row up by email. It
     *  exists, because the signIn callback above just created it.
     */
    async jwt({ token, user, account, trigger }) {
      if (user) {
        if (account?.provider === 'google') {
          const dbUser = await queryOne(
            `SELECT u.id, u.name, u.role, u.phone, u.image, u.clinic_id, c.slug AS clinic_slug
               FROM users u LEFT JOIN clinics c ON c.id = u.clinic_id
              WHERE u.email = ?`,
            [String(user.email).toLowerCase()]
          )
          if (dbUser) {
            token.id = String(dbUser.id)
            token.role = dbUser.role
            token.phone = dbUser.phone
            token.name = dbUser.name
            token.picture = dbUser.image || token.picture
            token.clinicId = dbUser.clinic_id ? String(dbUser.clinic_id) : null
            token.clinicSlug = dbUser.clinic_slug ?? null
          }
        } else {
          token.id = user.id
          token.role = user.role
          token.phone = user.phone
          token.clinicId = user.clinicId ?? null
          token.clinicSlug = user.clinicSlug ?? null
        }
      }

      /**
       * Called from the client as `updateSession()`.
       *
       * It refreshes the clinic too, which matters during onboarding: the owner
       * signs up before their clinic exists, so their token starts with no
       * clinic and must pick one up the moment it is created.
       */
      if (trigger === 'update' && token.id) {
        const fresh = await queryOne(
          `SELECT u.name, u.phone, u.image, u.role, u.clinic_id, c.slug AS clinic_slug
             FROM users u LEFT JOIN clinics c ON c.id = u.clinic_id
            WHERE u.id = ?`,
          [token.id]
        )
        if (fresh) {
          token.name = fresh.name
          token.phone = fresh.phone
          token.picture = fresh.image
          token.role = fresh.role
          token.clinicId = fresh.clinic_id ? String(fresh.clinic_id) : null
          token.clinicSlug = fresh.clinic_slug ?? null
        }
      }

      return token
    },
  },
})

/**
 * Read the clinic slug stashed before a Google redirect.
 *
 * Imported lazily because `next/headers` is only available inside a request, and
 * this module is also loaded by middleware where it is not.
 */
async function readPendingClinicSlug() {
  try {
    const { cookies } = await import('next/headers')
    const store = await cookies()
    return store.get('pending-clinic')?.value || null
  } catch {
    return null
  }
}

/* ==========================================================================
   GUARD HELPERS
   ==========================================================================
   Used at the top of protected pages and API routes. Middleware already blocks
   most unauthorised traffic, but these are a second line of defence: never rely
   on a single check for anything that matters.
   ========================================================================== */

/** The signed-in user, or null. */
export async function currentUser() {
  const session = await auth()
  return session?.user ?? null
}

/** Throws unless someone is signed in. Returns the user. */
export async function requireUser() {
  const user = await currentUser()
  if (!user) throw new Error('UNAUTHENTICATED')
  return user
}

/**
 * Throws unless the signed-in user holds one of the given roles.
 *
 *   const staff = await requireRole(['admin', 'physio'])
 *
 * 'physio' is included alongside 'admin' in most places because in a small
 * clinic the physiotherapist genuinely needs the diary and the patient list.
 * Only revenue and billing are admin-only.
 */
export async function requireRole(roles) {
  const user = await requireUser()
  const allowed = Array.isArray(roles) ? roles : [roles]
  if (!allowed.includes(user.role)) throw new Error('FORBIDDEN')
  return user
}

/**
 * The check that keeps tenants apart, for pages and server actions.
 *
 * Middleware does this for whole route groups; this is for the individual
 * surfaces that must be certain — anything reading or writing patient data.
 * Platform staff pass, because supporting a customer means being able to look.
 */
export async function requireClinicUser(clinicId) {
  const user = await requireUser()
  if (user.role === 'platform') return user
  if (!clinicId || Number(user.clinicId) !== Number(clinicId)) {
    throw new Error('FORBIDDEN')
  }
  return user
}

export const isStaff = (user) => ['admin', 'physio', 'platform'].includes(user?.role)
export const isPlatform = (user) => user?.role === 'platform'

/**
 * The client's address, as well as it can be known.
 *
 * `x-forwarded-for` is set by whatever proxy sits in front of the app — and by
 * anybody sending a request directly, which is why it is only trusted for the
 * throttle and never for anything that grants access. The worst a forged header
 * can do here is give an attacker a fresh throttle bucket, which is the same
 * position as using a fresh IP address.
 *
 * In development there is no proxy and this returns 'local', so the throttle
 * still works while testing.
 */
function clientAddress(request) {
  const forwarded = request?.headers?.get?.('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 60)
  return request?.headers?.get?.('x-real-ip')?.slice(0, 60) || 'local'
}
