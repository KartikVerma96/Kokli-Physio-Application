# Aarogya Physiotherapy — a full-stack clinic application

A complete, working physiotherapy clinic website and management system: public marketing
site, online booking with real availability, card/UPI payments, one-to-one video
consultations, a patient portal, and an admin panel the clinic runs itself from.

Built to be **read**. Every file explains not just what it does but why it was done that
way, including the trade-offs and the mistakes worth avoiding. If you are learning
full-stack development, start with the reading order near the bottom of this file.

**Stack:** Next.js 16 (App Router) · JavaScript · MySQL (raw SQL, no ORM) ·
Auth.js v5 · Redux Toolkit · Tailwind CSS v4 · Socket.IO + native WebRTC · Razorpay ·
react-hot-toast

---

## Getting it running

You need **Node 20+** and **MySQL 8+** (MySQL Workbench is a convenient way to inspect
the database, but the app does not need it).

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env.local

# 3. Open .env.local and set two things:
#      DB_PASSWORD   your MySQL password
#      AUTH_SECRET   run: openssl rand -base64 32

# 4. Create the database, tables and demo data
npm run db:setup

# 5. Start it
npm run dev
```

Open **http://localhost:3000**.

### Sign in with

| Email                     | Password     | What you see                                    |
| ------------------------- | ------------ | ----------------------------------------------- |
| `patient@example.com`     | `patient123` | Patient portal — book, pay, join video calls    |
| `doctor@aarogyaphysio.in` | `doctor123`  | Physiotherapist — diary, patients, SOAP notes   |
| `admin@aarogyaphysio.in`  | `admin123`   | Everything, plus revenue                        |

Delete these before the site goes anywhere near a real patient. They are created in
`scripts/setup-db.js` and shown in a box on the login page — remove both.

### It works with no accounts or API keys

Google login and Razorpay are both **optional**:

- **No Google keys?** The "Continue with Google" button simply is not rendered.
  Email and password login works normally.
- **No Razorpay keys?** Payments run in **demo mode** — the payment step succeeds
  immediately and the appointment confirms, so you can walk the entire flow including a
  live video consultation. `/admin/payments` displays a clear warning while this is
  active. Demo mode is hard-locked to non-production by `isDemoMode()` in
  `lib/razorpay.js`, so a missing key in production can never make appointments free.

- **No SMTP?** Every email — booking confirmations, cancellations, receipts, trial
  reminders — is **printed to the terminal** instead of being sent. You can read exactly
  what a patient would receive without signing up to a mail provider. Set the `SMTP_*`
  variables and the same code posts it for real.

Adding the real keys later is just filling in `.env.local` — see the instructions in
`.env.example`.

---

## Making it yours

Almost everything a clinic needs to change lives in **one file: `config/site.js`.**
Clinic name, address, phone, the physiotherapist's name and registration number, opening
hours, currency, cancellation policy, FAQs. Search it for `CHANGE ME`.

Everything else — treatments, prices, session lengths, working hours, holidays — is
edited from the **admin panel** at `/admin`, with no code changes. That is deliberate: the
person who knows what patients call their condition should be able to write the page title
without asking a developer.

Before going live:

1. Replace the placeholder testimonials in `config/site.js` with real, permitted reviews
   (see the warning in `components/home/Testimonials.js` — this matters).
2. Drop a real photo at `public/doctor.jpg` and use it in `components/home/DoctorIntro.js`.
3. Have a lawyer read `/privacy` and `/terms`. They are written to be accurate about what
   this app actually does, but they are not legal advice.
4. Set `NEXT_PUBLIC_SITE_URL` to your real domain, and submit
   `https://yourdomain.com/sitemap.xml` in Google Search Console.
5. Set up the Razorpay **webhook** (`RAZORPAY_WEBHOOK_SECRET`). Without it, a patient
   whose phone loses signal after paying ends up charged with no appointment. See the long
   comment in `app/api/payments/webhook/route.js`.
6. Set a **TURN server** (`TURN_URL`). Without one, roughly one video call in ten cannot
   connect at all. `metered.ca` has a free tier that is ample for one clinic.

---

## How it fits together

```
server.js                  Node HTTP server: Next.js + the Socket.IO signalling channel
proxy.js                   Runs before every request; redirects anyone who should not be here

config/site.js             ← THE ONE FILE TO EDIT. All clinic details and SEO copy.

database/schema.sql        Tables, with the reasoning for every design decision
database/seed.sql          10 real physiotherapy services and a weekly timetable
scripts/setup-db.js        npm run db:setup — creates everything, hashes demo passwords

lib/db.js                  MySQL pool, prepared statements, transactions
lib/queries.js             Every read the app performs. Authorisation lives in the SQL.
lib/slots.js               THE BOOKING ENGINE — availability, holds, double-booking defence
lib/auth.js                Auth.js: Google + email/password, both landing in one users row
lib/razorpay.js            Orders, signature verification, refunds, demo mode
lib/videoToken.js          Signed tokens that let the signalling server trust a connection
lib/seo.js                 Metadata and JSON-LD structured data
lib/toast.js               Notifications — success / error / warning / info
lib/validation.js          Zod schemas — every input revalidated server-side
lib/utils.js               Money, dates, appointment codes, status presentation

store/                     Redux Toolkit — used ONLY for the booking wizard

app/(public)/              Marketing site: home, services, service pages, about, contact, book
app/(auth)/                Sign in and register
app/dashboard/             Patient portal: appointments, exercises, profile
app/admin/                 Clinic panel: diary, patients, availability, services, payments, reviews
app/consult/[id]/          The video consultation room
app/api/                   Slots, appointments, payments (verify + webhook), registration
```

---

## The parts worth understanding

### Availability is calculated, never stored

The naive design is a `slots` table with one row per bookable time. It collapses
immediately: you must generate rows months ahead and rewrite thousands whenever working
hours change.

Instead the database holds a dozen **rules** ("Tuesdays, 9am–1pm, 30-minute steps") and
`lib/slots.js` generates the slots on demand for the single day a patient is looking at,
subtracting existing appointments, holidays and anything too soon to give notice.
Availability extends infinitely into the future, and changing the working week is one
`INSERT`.

### Two patients tapping 10:00 AM at the same moment

Checking "is 10:00 free?" in JavaScript and then inserting cannot work — there is always a
gap between the check and the insert. Two things close it:

1. A transaction with `SELECT … FOR UPDATE`, which makes the second request wait and then
   correctly see the clash. This also catches partial overlaps, so a 60-minute booking at
   10:00 blocks a 30-minute one at 10:30.
2. A `UNIQUE` index on a **generated column** (`appointments.active_slot_key`) that equals
   `physio|date|time` while an appointment is live and `NULL` once cancelled. A unique
   index rejects duplicates but permits unlimited NULLs — so one live appointment per slot,
   enforced by MySQL itself, with any number of cancelled ones sharing that time.

Full explanation in `database/schema.sql` and `lib/slots.js`.

### Video calling, built from scratch

Audio and video travel **directly between the two browsers** (WebRTC) and never touch the
server, which is why a one-to-one call costs nothing to run. But two browsers cannot find
each other unaided, so `server.js` relays a handful of small JSON messages — an offer, an
answer, and network candidates — and then gets out of the way. That job is called
signalling, and the whole thing is about 100 lines.

`components/video/VideoRoom.js` walks through the handshake step by step, including the
ICE-candidate queue that is the most common reason a hand-rolled WebRTC implementation
works on localhost and fails for real users.

### The money is never taken from the browser

The amount charged is read from the `services` table on the server. The browser sends a
service **id**, never a price. On the way back, Razorpay's signature is recomputed with our
secret key — without that step anyone could call the verify endpoint and claim to have
paid. See `app/api/payments/verify/route.js`, which runs four independent checks.

### Where Redux is used, and where it is not

Redux holds the **booking wizard** — four steps edited by four different components, read
by a progress bar and a summary panel, and it has to survive going backwards twice without
losing anything. That is genuinely the shape of problem a store is for.

Everything else (services, the dashboard, every admin table) is fetched on the server and
arrives as plain props, because copying server data into a store means two sources of truth
and a synchronisation bug waiting to happen.

Toasts used to live in Redux too and were deliberately moved out to `react-hot-toast` —
see the note at the top of `store/slices/uiSlice.js`. Knowing what does *not* belong in a
store is most of the skill, and that file explains the reasoning.

### SEO

Not one trick but five, and they are all in the code rather than in a plugin:

- **Server rendering.** Every public page arrives as complete HTML. A client-rendered app
  sends an empty `<div>` and hopes the crawler executes JavaScript.
- **Structured data** (`lib/seo.js`). `MedicalClinic` + `LocalBusiness` for the map pack,
  `FAQPage` for the expandable questions in results, `MedicalTherapy` per treatment,
  `BreadcrumbList` to replace the raw URL, `Review` for the stars.
- **A page per condition.** Nobody searches "physiotherapy clinic" — they search "frozen
  shoulder treatment near me". Each service gets its own URL, `<h1>`, and body copy, all
  editable from the admin panel.
- **Real 404s.** `/services/nonexistent` returns HTTP 404, not 200 with 404 content.
  There is a note in `app/not-found.js` about how easily a `loading.js` breaks this and why
  a soft 404 hurts.
- **Core Web Vitals.** Self-hosted fonts via `next/font`, no layout shift, and a small
  JavaScript bundle (no chart library, no animation library, explicit icon imports).

---

## Suggested reading order

If you are here to learn how a full-stack application is built, this order builds up
naturally:

1. **`config/site.js`** — get a feel for the domain.
2. **`database/schema.sql`** — the data model, with every decision justified. Read this
   before any code; everything else follows from it.
3. **`lib/db.js`** — connection pooling, prepared statements, transactions, and why
   `LIMIT ?` is the one place a placeholder does not work.
4. **`lib/queries.js`** — how authorisation belongs in the `WHERE` clause, not in an `if`.
5. **`app/(public)/page.js`** and **`components/home/Hero.js`** — a Server Component
   fetching data and rendering HTML.
6. **`components/layout/Header.js`** + **`Navbar.js`** — the server-shell / client-island
   pattern that is the heart of the App Router.
7. **`lib/auth.js`** + **`proxy.js`** — sessions, two login methods, route protection.
8. **`lib/slots.js`** — the most interesting algorithm in the project.
9. **`store/slices/bookingSlice.js`** + **`components/booking/BookingWizard.js`** — Redux
   where it genuinely earns its place.
10. **`app/api/appointments/route.js`** → **`app/api/payments/verify/route.js`** — taking
    money safely.
11. **`server.js`** + **`components/video/VideoRoom.js`** — WebRTC end to end.
12. **`app/admin/appointments/[id]/actions.js`** — Server Actions, and why each one must
    re-check the session itself.

---

## Commands

```bash
npm run dev        # start on :3000 (Next.js + Socket.IO, hot reloading)
npm run build      # production build — does NOT need a database connection
npm start          # run the production build
npm run lint       # ESLint, including the React Compiler rules
npm run db:setup   # create the database and demo data (refuses to wipe existing data)
npm run db:reset   # wipe and recreate — destroys everything

npm test                 # everything below, cheapest checks first
npm run test:scoping     # static: is every tenant-scoped query given a clinic?
npm run test:security    # password guessing, patient privacy, forged webhooks
npm run test:whatsapp    # consent, quotas, no duplicate reminders
npm run test:pages       # does every page render, for every role?
npm run test:isolation   # can clinic A READ clinic B's data? (25 checks)
npm run test:actions     # can clinic A WRITE clinic B's data via a server action?
npm run test:revenue     # packages, cash at the desk, and the money counted once
npm run test:reality     # parallel patients, home visits, no-shows, recall
npm run test:journey     # signup → a live, bookable clinic
npm run test:billing     # subscribe → invoice → seat limits → who may do what
```

The suite talks to a **running dev server and a real database** — no mocks. That is the
point: the bugs worth catching here are the ones that only appear when a real request
hits real SQL. Start the server first, then run it.

The email tests need to read the server's output, so they take the log path:

```bash
npm run dev > /tmp/dev.log 2>&1 &
node tests/email-journey.mjs /tmp/dev.log
```

### WhatsApp — the feature that makes the price obvious

Indian patients do not read email. Four uses, one integration:

| Message | When | Category |
|---|---|---|
| Appointment reminder | 24h before, per clinic setting | Utility |
| Home exercise programme | The moment the note is saved | Utility |
| Sessions expiring soon | 10 days before a package lapses | **Marketing** |
| Google review request | 2 days after the last session | **Marketing** |

**Whose number sends it** — and who pays:

| | Sends from | Billed by Meta to | Monthly limit |
|---|---|---|---|
| Clinic connects their own number | The clinic | The clinic | None |
| Not connected yet (fallback) | The platform | **You** | Hard cap per plan |

Every plan's cap is finite, deliberately — "unlimited" means one thing only: the clinic
connected its own number. At the cap, worst case, Professional costs you ₹55/month
against ₹1,299 revenue.

The safety argument matters more than the money. Meta blocks and quality-rates **per
number**, so a clinic sending badly on its own number damages only itself; on the shared
fallback it would take every other clinic on that number down with it. Pushing clinics
onto their own number is the best thing you can do for reliability.

**The rule everything is built around:** Meta blocks a number that sends *marketing*
templates without consent. Consent is therefore checked inside the sender itself
([lib/whatsapp.js](lib/whatsapp.js)) — there is no code path to a marketing message that
skips it — and stored as a **date**, because "the flag was true" proves nothing if a
clinic is ever challenged.

Setup: `npm run whatsapp:templates` prints the exact text to submit to Meta. Business
verification takes 3–10 days, so start it first. Until it is approved every message
prints to the terminal, so the whole feature can be demonstrated to a clinic today.

### How the clinic makes money

Six mechanisms. The schema was originally wrong about every one of them, because it
modelled a single-visit, prepaid, online-booked, one-patient-at-a-time practice — and a
physiotherapy clinic is the opposite on all four counts:

- **Packages.** Physiotherapy is a course, not a visit — a frozen shoulder is
  eight to twelve sessions. Clinics sell ten sessions for the price of eight, which
  secures the revenue and, more importantly, means the patient actually finishes the
  course. Define them in `/admin/packages`, sell one from any patient's record, and
  the patient spends sessions with no payment step. Sessions remaining are **derived**
  by counting appointments, never stored as a counter — see the long note in
  [lib/packages.js](lib/packages.js).
- **Money at the desk.** Most Indian physio patients telephone or walk in and pay
  cash or UPI at reception. `/admin/appointments/new` books them (creating the patient
  if they are new, with no email needed), and takes the payment now, later, or from a
  package. Before this existed the revenue figure showed only online prepayments — a
  number that was not incomplete but wrong.
- **Parallel patients.** A physiotherapist treats two to four people at once: one on a
  traction table, one under ultrasound, one doing hands-on work. `availability_rules.capacity`
  says how many, and the diary offers the slot until it is genuinely full. Assuming 1:1
  under-books a busy clinic two or three times over. See the note on `slot_seat` in
  [database/migrations/003-capacity-home-visits-noshows-recalls.sql](database/migrations/003-capacity-home-visits-noshows-recalls.sql)
  for how the database still refuses a real double-booking.
- **Home visits.** Two to three times the clinic rate, and often the only option for
  post-surgical and elderly patients. Mark a treatment available at home with its own
  price, set separate home-visit hours, and the travel buffer blocks the whole trip in
  the diary rather than just the treatment.
- **No-shows.** 15–25% of physiotherapy appointments. A fee is stamped on the
  appointment from the clinic's policy at that moment, and a prepaid session is
  forfeited — for a no-show or a cancellation inside the notice window. Without that a
  patient on a package can cancel at 9:55 for a 10:00 slot forever at no cost.
- **Recall.** `/admin/recalls` lists who is not coming back: sessions paid for and not
  used, follow-up dates the physiotherapist wrote in the notes, and patients who simply
  stopped. Everyone with an appointment booked is excluded — the point is who is *not*
  booked. All of it was already in the database and nothing read it.

Every policy above is a clinic setting under **Settings → Policies**, not a hardcoded
number.

### One thing to get right when you deploy

**Put the app behind a reverse proxy that sets `X-Forwarded-For` itself.**

Sign-in throttling ([lib/loginThrottle.js](lib/loginThrottle.js)) counts failures per
email *and* client address, so that guessing from one address cannot lock a clinic out
of its own account from another. It reads the address from `X-Forwarded-For`, which any
client can send — so if the app is exposed directly to the internet, an attacker can
rotate that header and get a fresh allowance each time.

Nginx, Caddy, Cloudflare and every managed host overwrite the header rather than
appending to it, which is exactly what is needed. This is the one deployment detail with
a security consequence.

### Notes

- **`npm run dev` runs `node server.js`, not `next dev`.** Socket.IO needs a long-lived
  HTTP server to attach to, and Next does not expose the one it creates. `server.js`
  creates the server, hands most requests to Next, and keeps `/api/socket` for signalling.
- **`npm audit` reports advisories** in transitive development dependencies of `next` and
  `eslint` (postcss, sharp, brace-expansion). `npm audit fix --force` "fixes" them by
  downgrading Next.js to version 9, which is obviously worse. They are upstream issues in
  build tooling, not in anything this app ships to a browser. Leave them and update Next
  when a patch lands.
- **Route protection lives in `proxy.js`**, which is the Next.js 16 name for what used to
  be `middleware.js`.

---

## What is not built

Being honest about the edges, because a README that implies completeness wastes your time:

- **No SMS.** WhatsApp is built (below); SMS is not, and probably never needs to be.
- **No PDF invoices.** The receipt is an email and a row in `/admin/billing`; a GST invoice
  is issued on request.
- **No practitioner picker when booking.** A clinic can now add several physiotherapists
  (`/admin/settings/team`, enforced against the plan's seat limit), but the booking flow
  still assigns the first active one rather than letting the patient choose.
- **A no-show fee is recorded, not collected.** The amount owed is stamped on the
  appointment and shown to reception, but nothing charges the card on file — because
  there is no card on file. Collecting it needs a stored mandate, which is a bigger
  piece of work than it sounds.
- **Recall is a list, not a campaign.** It gives you the phone numbers and records that
  you called. It does not send the messages — that wants WhatsApp Business, which is
  the next real feature.
- **No reschedule button.** A patient cancels and rebooks. Rescheduling in one step needs
  its own flow to avoid losing the slot in between.
- **Patients cannot submit reviews yet.** The `reviews` table, the admin approval screen and
  the structured data all exist; the patient-facing form does not.
- **No unit tests.** What exists is end-to-end (see Commands above) and covers the parts
  where a bug costs money or leaks data: tenant isolation, double-booking, signature
  verification, seat limits, who may see what. Pure functions like `effectiveStatus()`
  would be worth a Vitest file.
