import Link from 'next/link'
import { Stethoscope, ShieldCheck, Video, CalendarCheck, Quote } from 'lucide-react'
import { getCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import { platform } from '@/config/platform'

/**
 * ============================================================================
 *  AUTH LAYOUT — the split-screen frame for sign in and register
 * ============================================================================
 *  Another route group: (auth) shapes the layout without appearing in the URL,
 *  so the pages inside are still served at /login and /register.
 *
 *  There is no site header or footer here. That is deliberate — the only thing
 *  a person on this page should be doing is signing in, and a navigation bar
 *  full of alternatives measurably increases the number who wander off. The
 *  logo still links home, so nobody is trapped.
 * ============================================================================
 */

export default async function AuthLayout({ children }) {
  /**
   * Sign-in happens in BOTH worlds: a patient on a clinic subdomain, and a
   * clinic owner on the platform's root domain. So the branding here is
   * whichever applies, rather than assuming a clinic exists.
   */
  const clinic = await getCurrentClinic()
  const site = clinic
    ? clinicView(clinic)
    : {
        name: platform.name,
        tagline: platform.tagline,
        legalName: platform.name,
        address: { city: '' },
        doctor: { name: '', credentials: '' },
      }

  return (
    <div className="flex min-h-screen">
      {/* ================================================== the form side */}
      <div className="flex w-full flex-col px-5 py-8 lg:w-[52%] lg:px-14">
        <Link href="/" className="inline-flex items-center gap-2.5 self-start">
          <span className="grid size-10 place-items-center rounded-2xl bg-linear-to-br from-brand-500 to-brand-700 text-white shadow-brand">
            <Stethoscope className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-display text-base font-bold leading-tight">{site.name}</span>
            <span className="block text-[11px] text-ink-500">{site.address.city || site.tagline}</span>
          </span>
        </Link>

        <div className="flex flex-1 items-center py-10">
          <div className="mx-auto w-full max-w-md">{children}</div>
        </div>

        <p className="text-center text-xs text-ink-400">
          © {new Date().getFullYear()} {site.legalName} ·{' '}
          <Link href="/privacy" className="hover:underline">Privacy</Link> ·{' '}
          <Link href="/terms" className="hover:underline">Terms</Link>
        </p>
      </div>

      {/* ================================================ the poster side */}
      {/* Hidden below `lg`, because on a phone the form should own the screen.
          `sticky top-0 h-screen` keeps the panel fixed while the form scrolls,
          which matters on the longer registration form. */}
      <aside className="relative hidden overflow-hidden bg-linear-to-br from-brand-700 via-brand-600 to-brand-800 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[48%] lg:flex-col lg:justify-between lg:p-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-28 -top-28 size-96 rounded-full bg-sun-300/25 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-24 size-96 rounded-full bg-brand-300/20 blur-3xl"
        />

        <div className="relative">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-200">
            {site.tagline}
          </p>
          <h2 className="mt-4 max-w-md font-display text-4xl font-bold leading-tight text-white text-balance">
            Your treatment plan, appointments and exercises — all in one place
          </h2>
        </div>

        <ul className="relative space-y-5">
          {[
            {
              icon: CalendarCheck,
              title: 'Book in under a minute',
              text: 'Live availability for the next 30 days. No phone calls, no waiting for a callback.',
            },
            {
              icon: Video,
              title: 'Consult from home',
              text: 'One-to-one video consultations that work in your browser — nothing to install.',
            },
            {
              icon: ShieldCheck,
              title: 'Your records, kept private',
              text: 'Clinical notes and prescribed exercises visible only to you and your physiotherapist.',
            },
          ].map((feature) => (
            <li key={feature.title} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/15 text-white ring-1 ring-inset ring-white/20">
                <feature.icon className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="font-semibold text-white">{feature.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-brand-100/85">{feature.text}</p>
              </div>
            </li>
          ))}
        </ul>

        <figure className="relative rounded-2xl bg-white/10 p-6 ring-1 ring-inset ring-white/15">
          <Quote className="size-6 text-brand-200" aria-hidden="true" />
          <blockquote className="mt-3 text-[15px] leading-relaxed text-white/90">
            “If you leave a session without understanding what is wrong and what you should be
            doing about it at home, I have not finished my job.”
          </blockquote>
          <figcaption className="mt-4 text-sm text-brand-100/80">
            {[site.doctor.name, site.doctor.credentials].filter(Boolean).join(' · ') || site.name}
          </figcaption>
        </figure>
      </aside>
    </div>
  )
}
