import { Dumbbell, Info, CalendarDays } from 'lucide-react'
import { auth } from '@/lib/auth'
import { requireCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import { getPatientExercises } from '@/lib/queries'
import { formatDateLong } from '@/lib/utils'
import { Card, EmptyState, Badge } from '@/components/ui/Card'
import Button from '@/components/ui/Button'

/**
 * ============================================================================
 *  MY EXERCISES  →  /dashboard/exercises
 * ============================================================================
 *  Every home exercise programme this patient has been given, newest first.
 *
 *  This is the page that changes outcomes rather than just recording them.
 *  Adherence to home exercise is the single biggest predictor of whether
 *  physiotherapy works, and the usual reason people stop is not laziness — it is
 *  that the photocopied sheet went in the bin and they cannot remember whether it
 *  was three sets of ten or ten sets of three.
 *
 *  A page they can open on their phone at home, at any time, is a genuinely
 *  clinical feature disguised as a web page.
 * ============================================================================
 */

export const metadata = { title: 'My exercises' }
export const dynamic = 'force-dynamic'

export default async function ExercisesPage() {
  const clinic = await requireCurrentClinic()
  const session = await auth()
  const plans = await getPatientExercises(clinic.id, session.user.id)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">My exercises</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Your home programme, as prescribed after each session.
        </p>
      </div>

      {plans.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={<Dumbbell className="size-6" />}
            title="No exercises prescribed yet"
            description="After your first session, your physiotherapist writes up a home programme here — with sets, reps and how often to do each one."
            action={<Button href="/book">Book an assessment</Button>}
          />
        </Card>
      ) : (
        <>
          {/* Safety guidance, at the top where it will actually be read. This is
              not legal cover — it is the advice a physiotherapist gives verbally at
              the end of every session, written down. */}
          <div className="flex items-start gap-3 rounded-2xl border border-brand-200 bg-brand-50/70 p-5 dark:border-brand-800 dark:bg-brand-950/30">
            <Info className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden="true" />
            <div className="text-sm leading-relaxed text-ink-700 dark:text-ink-300">
              <p className="font-bold">How to use these</p>
              <p className="mt-1">
                Mild discomfort during an exercise is normal and expected — up to about 3 out of 10.
                Sharp pain, pain that gets worse over the following day, or any new numbness or
                tingling means stop and tell us. Doing fewer repetitions properly beats doing more
                badly.
              </p>
            </div>
          </div>

          {plans.map((plan, planIndex) => (
            <Card key={planIndex} className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold">{plan.service_name}</h2>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-500">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    Prescribed {formatDateLong(plan.created_at)}
                  </p>
                </div>
                {/* Only the newest plan is the one to follow. Without this label, a
                    patient scrolling down would reasonably assume they are supposed
                    to do all of them. */}
                {planIndex === 0 ? (
                  <Badge tone="success" dot>
                    Current plan
                  </Badge>
                ) : (
                  <Badge tone="neutral">Previous plan</Badge>
                )}
              </div>

              <ol className="mt-5 space-y-3">
                {plan.exercises_prescribed.map((exercise, index) => (
                  <li
                    key={index}
                    className="flex gap-4 rounded-2xl border border-ink-200 p-4 dark:border-ink-700"
                  >
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{exercise.name}</p>

                      {/* The prescription itself, shown as separate chips rather
                          than a run-on sentence. Someone glancing at their phone
                          mid-exercise needs to find "3 sets" instantly. */}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {exercise.sets && <Chip label="Sets" value={exercise.sets} />}
                        {exercise.reps && <Chip label="Reps" value={exercise.reps} />}
                        {exercise.frequency && <Chip label="How often" value={exercise.frequency} />}
                      </div>

                      {exercise.notes && (
                        <p className="mt-2.5 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
                          {exercise.notes}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </>
      )}
    </div>
  )
}

function Chip({ label, value }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-lg bg-ink-100 px-2.5 py-1 text-xs dark:bg-ink-800">
      <span className="font-medium text-ink-500 dark:text-ink-400">{label}</span>
      <span className="font-bold">{value}</span>
    </span>
  )
}
