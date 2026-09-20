import { BadgeCheck, GraduationCap, Languages, Quote } from 'lucide-react'
import Button from '@/components/ui/Button'
import Reveal from '@/components/ui/Reveal'
import { initials, firstName } from '@/lib/utils'

/**
 * ============================================================================
 *  MEET THE PHYSIOTHERAPIST
 * ============================================================================
 *  Naming a real, qualified, registered person with a photo and a registration
 *  number is not vanity — it is the single most important trust signal a health
 *  website has, for two different audiences:
 *
 *    For patients: they are about to let a stranger treat their spine. Knowing
 *    who that person is, what they trained in, and that they are registered
 *    with the state council is what makes booking feel safe.
 *
 *    For Google: health and medical topics fall under what Google internally
 *    calls "Your Money or Your Life" — subjects where bad information can cause
 *    real harm. Its guidelines direct raters to check who wrote the content and
 *    whether they are qualified. An anonymous clinic site with no named
 *    practitioner is systematically disadvantaged, and reasonably so.
 *
 *  TO ADD A REAL PHOTO: drop it in /public/doctor.jpg and replace the initials
 *  block below with a next/image. A real face measurably outperforms a
 *  placeholder — do it before launch.
 * ============================================================================
 */

export default function DoctorIntro({ site }) {
  return (
    <section id="about" className="py-20 lg:py-28">
      <div className="container-page">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
          {/* ============================================ portrait column */}
          <Reveal className="lg:col-span-5">
            <div className="relative mx-auto max-w-sm lg:mx-0">
              {/* A soft offset panel behind the portrait — depth without a
                  drop shadow, which reads as more considered. */}
              <div
                aria-hidden="true"
                className="absolute -bottom-4 -right-4 h-full w-full rounded-4xl bg-linear-to-br from-brand-200 to-sun-200 dark:from-brand-900 dark:to-sun-950"
              />

              <div className="relative aspect-[4/5] overflow-hidden rounded-4xl border border-ink-200 bg-linear-to-br from-brand-600 to-brand-800 dark:border-ink-700">
                {/* Placeholder portrait: large initials on the brand gradient.
                    Replace with <Image src="/doctor.jpg" ... /> before launch. */}
                <div className="grid h-full place-items-center">
                  <span className="font-display text-7xl font-bold text-white/90">
                    {initials(site.doctor.name.replace('Dr. ', ''))}
                  </span>
                </div>

                {/* Name plate across the bottom of the portrait. */}
                <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-ink-950/90 to-transparent p-5 pt-12">
                  <p className="font-display text-xl font-bold text-white">{site.doctor.name}</p>
                  <p className="text-sm text-white/75">
                    {site.doctor.title} · {site.doctor.credentials}
                  </p>
                </div>
              </div>

              {/* Floating registration badge. The registration number is the
                  detail that separates a qualified physiotherapist from an
                  unlicensed "back pain specialist", and patients in India are
                  increasingly aware of the difference. */}
              <div className="absolute -left-3 top-6 flex items-center gap-2.5 rounded-2xl border border-ink-200 bg-white p-3 shadow-float dark:border-ink-700 dark:bg-ink-900">
                <BadgeCheck className="size-5 shrink-0 text-brand-600" aria-hidden="true" />
                <div>
                  <p className="text-[11px] font-bold leading-tight">Council registered</p>
                  <p className="text-[10px] leading-tight text-ink-500">
                    {site.doctor.registration}
                  </p>
                </div>
              </div>
            </div>
          </Reveal>

          {/* ================================================= text column */}
          <Reveal delay={120} className="lg:col-span-7">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600 dark:text-brand-400">
              Your physiotherapist
            </p>

            <h2 className="mt-3 text-3xl font-bold text-balance sm:text-4xl">
              {site.doctor.experienceYears} years of getting people moving again
            </h2>

            <div className="mt-6 space-y-4 text-lg leading-relaxed text-ink-600 text-pretty dark:text-ink-300">
              <p>{site.doctor.bio}</p>
            </div>

            {/* -------------------------------------------- credentials */}
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-ink-200 p-5 dark:border-ink-700">
                <GraduationCap className="size-5 text-brand-600" aria-hidden="true" />
                <p className="mt-3 text-sm font-bold">Qualifications</p>
                <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
                  {site.doctor.credentials}
                </p>
              </div>

              <div className="rounded-2xl border border-ink-200 p-5 dark:border-ink-700">
                <Languages className="size-5 text-brand-600" aria-hidden="true" />
                <p className="mt-3 text-sm font-bold">Consults in</p>
                <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
                  {site.doctor.languages.join(', ')}
                </p>
              </div>
            </div>

            {/* ------------------------------------------ specialisations */}
            <ul className="mt-6 flex flex-wrap gap-2">
              {site.doctor.specialisations.map((item) => (
                <li
                  key={item}
                  className="rounded-full bg-brand-50 px-3.5 py-1.5 text-sm font-medium text-brand-800 dark:bg-brand-950/60 dark:text-brand-300"
                >
                  {item}
                </li>
              ))}
            </ul>

            {/* ---------------------------------------------- philosophy */}
            <blockquote className="mt-8 flex gap-4 rounded-2xl border-l-4 border-brand-500 bg-brand-50/60 p-5 dark:bg-brand-950/30">
              <Quote className="size-6 shrink-0 text-brand-400" aria-hidden="true" />
              <p className="text-base italic leading-relaxed text-ink-700 dark:text-ink-200">
                “If you leave a session without understanding what is wrong and what you should be
                doing about it at home, I have not finished my job.”
              </p>
            </blockquote>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/book" size="lg">Book with {firstName(site.doctor.name)}</Button>
              <Button href="/about" variant="ghost" size="lg">More about the clinic</Button>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
