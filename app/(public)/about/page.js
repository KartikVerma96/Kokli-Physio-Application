import { Award, BookOpen, HeartHandshake, Microscope, Users } from 'lucide-react'
import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import { formattedAddress } from '@/lib/clinicView'
import { buildMetadata, JsonLd, breadcrumbSchema, localBusinessSchema } from '@/lib/seo'
import { getActiveServices, getRatingSummary } from '@/lib/queries'
import PageHeader from '@/components/layout/PageHeader'
import DoctorIntro from '@/components/home/DoctorIntro'
import HowItWorks from '@/components/home/HowItWorks'
import { CtaBand } from '@/components/home/Faq'
import { SectionHeading } from '@/components/ui/Card'
import Reveal from '@/components/ui/Reveal'

/**
 * ============================================================================
 *  ABOUT  →  /about
 * ============================================================================
 *  For a healthcare site, this is not a filler page.
 *
 *  Google's quality guidelines put health and medical content in the category
 *  where it looks hardest at who is behind the information — qualifications,
 *  registration, real credentials, a real address. A clinic with a substantive
 *  About page naming a registered practitioner is treated as more trustworthy
 *  than one without, and patients read it for exactly the same reason.
 * ============================================================================
 */

export async function generateMetadata() {
  const site = clinicView(await requireCurrentClinic())
  return buildMetadata({
    site,
    title: `About ${site.name} — ${site.doctor.name}`,
    description: `${site.doctor.name}${site.doctor.credentials ? `, ${site.doctor.credentials}` : ''} — physiotherapy${site.address.city ? ` in ${site.address.city}` : ''}. Meet the clinic and how we work.`,
    path: '/about',
  })
}

const PRINCIPLES = [
  {
    icon: Microscope,
    title: 'Diagnose before you treat',
    text: 'A session that starts with treatment is guesswork. We examine, measure and reason our way to a diagnosis first, then treat the thing we found — and tell you what it is in words you can repeat to your family.',
  },
  {
    icon: BookOpen,
    title: 'Evidence, not tradition',
    text: 'Physiotherapy has moved on a great deal in twenty years. Some treatments people still expect — long courses of passive ultrasound, indefinite bed rest — have been shown not to help. We use what the research supports, and we will explain why if we recommend against something you were expecting.',
  },
  {
    icon: HeartHandshake,
    title: 'You should need us less over time',
    text: 'The goal is discharge, not a subscription. Every plan is built around making you independent, with exercises you can do at home and a clear estimate of how many sessions it should take. We recheck progress every fourth visit.',
  },
  {
    icon: Users,
    title: 'Honest about what we cannot do',
    text: 'Some problems are not physiotherapy problems. If your symptoms suggest something that needs a doctor, a scan or a surgeon, we will say so at the first appointment and help you get to the right person.',
  },
]

const EQUIPMENT = [
  'Electrotherapy — TENS, IFT & muscle stimulation',
  'Therapeutic ultrasound',
  'Short-wave diathermy',
  'Traction table (cervical & lumbar)',
  'Manual therapy plinth',
  'Sterile single-use dry needling supplies',
  'Kinesiology & rigid taping',
  'Resistance bands, weights & balance trainers',
  'Treadmill & static cycle for gait work',
  'Parallel bars for post-operative walking',
]

export default async function AboutPage() {
  const clinic = await requireCurrentClinic()
  const site = clinicView(clinic)
  const [services, rating] = await Promise.all([
    getActiveServices(clinic.id),
    getRatingSummary(clinic.id),
  ])

  return (
    <>
      <JsonLd
        data={[
          localBusinessSchema({ site, services, rating }),
          breadcrumbSchema(site, [{ name: 'About' }]),
        ]}
      />

      <PageHeader
        eyebrow="About the clinic"
        title={`${site.legalName}`}
        description={`A single-therapist clinic in ${site.address.city}, which means the person who assesses you on day one is the person who treats you on day twelve. No rotating juniors, no handovers.`}
        breadcrumb={[{ name: 'About' }]}
      />

      <DoctorIntro site={site} />

      {/* ------------------------------------------------- how we practise */}
      <section className="bg-white py-20 lg:py-28 dark:bg-ink-900">
        <div className="container-page">
          <SectionHeading
            eyebrow="How we practise"
            title="Four things we will not compromise on"
            description="These are not slogans. They are the rules that decide what happens in your session."
          />

          <div className="mt-14 grid gap-6 md:grid-cols-2">
            {PRINCIPLES.map((principle, index) => (
              <Reveal key={principle.title} delay={index * 80}>
                <div className="card h-full p-7">
                  <span className="grid size-11 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
                    <principle.icon className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-lg font-bold">{principle.title}</h3>
                  <p className="mt-2.5 text-[15px] leading-relaxed text-ink-600 dark:text-ink-400">
                    {principle.text}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <HowItWorks site={site} />

      {/* --------------------------------------------------- the clinic */}
      <section className="py-20 lg:py-28">
        <div className="container-page">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <SectionHeading
                eyebrow="The clinic"
                title="What we have on site"
                align="left"
                description={`The clinic is on ${site.address.line2}, ${site.address.city}, with step-free access from the street.`}
              />

              <ul className="mt-8 grid gap-2.5 sm:grid-cols-2">
                {EQUIPMENT.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-sm text-ink-700 dark:text-ink-300"
                  >
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-5">
              <div className="card p-7">
                <Award className="size-6 text-brand-600" aria-hidden="true" />
                <h3 className="mt-4 text-lg font-bold">Credentials & registration</h3>
                <dl className="mt-4 space-y-3 text-sm">
                  {[
                    ['Practitioner', site.doctor.name],
                    ['Qualification', site.doctor.credentials],
                    ['Council registration', site.doctor.registration],
                    ['Years in practice', `${site.doctor.experienceYears} years`],
                    ['Languages', site.doctor.languages.join(', ')],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4 border-b border-ink-100 pb-2.5 last:border-0 dark:border-ink-800">
                      <dt className="text-ink-500 dark:text-ink-400">{label}</dt>
                      <dd className="text-right font-semibold">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="card p-7">
                <h3 className="text-lg font-bold">Visiting us</h3>
                <address className="mt-3 text-sm not-italic leading-relaxed text-ink-600 dark:text-ink-400">
                  {formattedAddress(site)}
                </address>
                <dl className="mt-4 space-y-2 text-sm">
                  {site.openingHours.map((slot) => (
                    <div key={slot.days} className="flex justify-between gap-4">
                      <dt className="text-ink-500 dark:text-ink-400">{slot.days}</dt>
                      <dd className="text-right font-semibold">{slot.time}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </div>
      </section>

      <CtaBand site={site} />
    </>
  )
}
