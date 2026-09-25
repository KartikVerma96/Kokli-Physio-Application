'use client'

/**
 * ============================================================================
 *  SOAP NOTES FORM
 * ============================================================================
 *  The clinical record for one session, in the format physiotherapists are
 *  actually taught:
 *
 *    S — Subjective  what the patient reports    "pain 6/10, worse mornings"
 *    O — Objective   what you measure            "lumbar flexion 40°, SLR 60°"
 *    A — Assessment  your clinical reasoning     "L4-L5 discogenic pain"
 *    P — Plan        what happens next           "manual therapy + McKenzie, 2x/week"
 *
 *  WHO SEES WHAT
 *  -------------
 *  The patient sees only the Assessment and the Plan, plus their exercises. S and O
 *  are working notes — shorthand, measurements, differentials being ruled out —
 *  and showing a patient "?? early OA, r/o meniscal tear" alarms them without
 *  informing them. The split is enforced in the patient's page, and stated in the
 *  form below so the physiotherapist knows exactly what will be visible.
 *
 *  The exercise builder is a repeating row group. HTML forms cannot post an array
 *  of objects, so the fields are named exercise-0-name, exercise-1-name and so on,
 *  and the server action reassembles them — see actions.js.
 * ============================================================================
 */

import { useActionState, useState } from 'react'
import { useEffect } from 'react'
import { Plus, Trash2, CheckCircle2, AlertCircle, Dumbbell, Info } from 'lucide-react'
import { saveConsultationNote } from './actions'
import { toast } from '@/lib/toast'
import { Card } from '@/components/ui/Card'
import { Input, Textarea, PainScale } from '@/components/ui/Field'
import Button from '@/components/ui/Button'

/** A few templates, because typing the same rehab plan forty times is not a good use of a clinician's evening. */
const EXERCISE_LIBRARY = [
  { name: 'Glute bridge', sets: '3', reps: '12', frequency: 'Daily' },
  { name: 'Bird dog', sets: '3', reps: '10 each side', frequency: 'Daily' },
  { name: 'Dead bug', sets: '3', reps: '10 each side', frequency: 'Daily' },
  { name: 'Chin tuck', sets: '3', reps: '10', frequency: '3x daily' },
  { name: 'Scapular retraction', sets: '3', reps: '15', frequency: 'Daily' },
  { name: 'Wall slide', sets: '3', reps: '10', frequency: 'Daily' },
  { name: 'Straight leg raise', sets: '3', reps: '15', frequency: 'Twice daily' },
  { name: 'Terminal knee extension', sets: '3', reps: '15', frequency: 'Daily' },
  { name: 'Calf raise', sets: '3', reps: '15', frequency: 'Daily' },
  { name: 'Pendulum swing', sets: '3', reps: '10 each way', frequency: '3x daily' },
  { name: 'Towel-assisted shoulder flexion', sets: '3', reps: '10', frequency: 'Twice daily' },
  { name: 'Single leg balance', sets: '3', reps: '30 seconds', frequency: 'Daily' },
]

export default function NotesForm({ appointmentId, notes, patientPainAtBooking }) {
  const [state, formAction, pending] = useActionState(saveConsultationNote, {})

  // Pre-fill "pain before" with what the patient reported when booking. It is
  // almost always the right value, and one less thing to type.
  const [painBefore, setPainBefore] = useState(
    notes?.pain_level_before ?? patientPainAtBooking ?? ''
  )
  const [painAfter, setPainAfter] = useState(notes?.pain_level_after ?? '')

  // The exercise rows. Seeded from the saved note when editing, otherwise one
  // blank row so the builder is obviously usable.
  const [exercises, setExercises] = useState(() =>
    Array.isArray(notes?.exercises_prescribed) && notes.exercises_prescribed.length > 0
      ? notes.exercises_prescribed
      : [{ name: '', sets: '', reps: '', frequency: '', notes: '' }]
  )

  useEffect(() => {
    if (state?.ok) toast.success(state.message)
    else if (state?.error) toast.error(state.error)
  }, [state])

  const errors = state?.errors || {}

  function updateExercise(index, field, value) {
    setExercises((current) =>
      current.map((exercise, i) => (i === index ? { ...exercise, [field]: value } : exercise))
    )
  }

  function addExercise(template = null) {
    setExercises((current) => [
      ...current,
      template
        ? { ...template, notes: '' }
        : { name: '', sets: '', reps: '', frequency: '', notes: '' },
    ])
  }

  function removeExercise(index) {
    setExercises((current) =>
      // Never leave zero rows — an empty builder with no visible "add" affordance
      // looks broken.
      current.length === 1
        ? [{ name: '', sets: '', reps: '', frequency: '', notes: '' }]
        : current.filter((_, i) => i !== index)
    )
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="appointmentId" value={appointmentId} />

      {/* Hidden inputs mirror the React state into the form, so the server action
          receives the exercise rows. The visible inputs below are controlled; these
          carry the values in the flat naming scheme the action expects. */}
      {exercises.map((exercise, index) => (
        <div key={`hidden-${index}`} className="hidden">
          <input name={`exercise-${index}-name`} value={exercise.name} readOnly />
          <input name={`exercise-${index}-sets`} value={exercise.sets || ''} readOnly />
          <input name={`exercise-${index}-reps`} value={exercise.reps || ''} readOnly />
          <input name={`exercise-${index}-frequency`} value={exercise.frequency || ''} readOnly />
          <input name={`exercise-${index}-notes`} value={exercise.notes || ''} readOnly />
        </div>
      ))}

      {/* ==================================================== the SOAP note */}
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold">Clinical notes</h2>
            <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
              SOAP format. Saving also marks the appointment completed.
            </p>
          </div>
          {notes && (
            <span className="shrink-0 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              Editing saved note
            </span>
          )}
        </div>

        {/* Who-sees-what, stated where it is relevant. */}
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-brand-50/70 p-3.5 text-xs leading-relaxed text-ink-700 dark:bg-brand-950/30 dark:text-ink-300">
          <Info className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden="true" />
          <span>
            The patient sees <strong>Assessment</strong>, <strong>Plan</strong> and their{' '}
            <strong>exercises</strong>. Subjective and Objective stay private to the clinic, so use
            whatever shorthand you like in those two.
          </span>
        </p>

        <div className="mt-5 space-y-5">
          <Textarea
            label="S — Subjective"
            name="subjective"
            rows={4}
            defaultValue={notes?.subjective || ''}
            error={errors.subjective}
            placeholder="Patient reports L knee pain 6/10, 3 weeks, no trauma. Worse descending stairs and after prolonged sitting. Sleeps through the night. No locking or giving way."
            hint="What the patient tells you — history, symptoms, what makes it better or worse. Private to the clinic."
          />

          <Textarea
            label="O — Objective"
            name="objective"
            rows={4}
            defaultValue={notes?.objective || ''}
            error={errors.objective}
            placeholder="Antalgic gait. Knee flexion 110° (R 135°), extension full. Mild effusion. Tender medial joint line. VMO wasting evident. McMurray negative, Lachman negative. Quads MMT 4/5."
            hint="What you measure — range of motion, strength grades, special tests, palpation. Private to the clinic."
          />

          <Textarea
            label="A — Assessment"
            name="assessment"
            rows={3}
            defaultValue={notes?.assessment || ''}
            error={errors.assessment}
            placeholder="Patellofemoral pain syndrome, likely secondary to quadriceps weakness and hip abductor insufficiency. No signs of meniscal or ligamentous injury."
            hint="Your clinical conclusion. THE PATIENT READS THIS — write it so they understand it."
          />

          <Textarea
            label="P — Plan"
            name="plan"
            rows={3}
            defaultValue={notes?.plan || ''}
            error={errors.plan}
            placeholder="Twice weekly for 3 weeks, then reassess. Manual therapy to patellofemoral joint, progressive quads and glute strengthening, taping for symptom relief. Home programme as prescribed below. Advise reducing stair use in the first week only."
            hint="What happens next. THE PATIENT READS THIS — be specific about what they should do."
          />
        </div>

        {/* ------------------------------------------------ pain before/after */}
        <div className="mt-6 grid gap-6 border-t border-ink-100 pt-6 sm:grid-cols-2 dark:border-ink-800">
          <div>
            <PainScale
              value={painBefore}
              onChange={setPainBefore}
              name="painLevelBeforeVisible"
              label="Pain at the start of the session"
            />
            <input type="hidden" name="painLevelBefore" value={painBefore} />
          </div>
          <div>
            <PainScale
              value={painAfter}
              onChange={setPainAfter}
              name="painLevelAfterVisible"
              label="Pain at the end of the session"
            />
            <input type="hidden" name="painLevelAfter" value={painAfter} />
          </div>
        </div>

        {/* Immediate feedback on the improvement. The patient sees the same numbers
            in their dashboard, and it is the single most motivating thing on the
            page for them. */}
        {painBefore !== '' && painAfter !== '' && Number(painAfter) < Number(painBefore) && (
          <p className="mt-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            {Number(painBefore) - Number(painAfter)} point improvement this session — the patient
            will see this too.
          </p>
        )}

        {/* --------------------------------------------------- follow-up */}
        <div className="mt-6 grid gap-5 border-t border-ink-100 pt-6 sm:grid-cols-2 dark:border-ink-800">
          <Input
            label="Sessions recommended"
            name="sessionsRecommended"
            type="number"
            min="0"
            max="60"
            defaultValue={notes?.sessions_recommended || ''}
            error={errors.sessionsRecommended}
            hint="An honest estimate. The patient sees this."
          />
          <Input
            label="Suggested follow-up date"
            name="followUpDate"
            type="date"
            defaultValue={notes?.follow_up_date ? String(notes.follow_up_date).slice(0, 10) : ''}
            error={errors.followUpDate}
          />
        </div>
      </Card>

      {/* ================================================ exercise builder */}
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold">
              <Dumbbell className="size-4 text-brand-600" aria-hidden="true" />
              Home exercise programme
            </h2>
            <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
              Appears in the patient’s dashboard, on their phone, whenever they need it.
            </p>
          </div>
        </div>

        {/* --------------------------------------------- quick-add library */}
        <div className="mt-5">
          <p className="text-xs font-semibold text-ink-600 dark:text-ink-300">
            Quick add a common exercise
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXERCISE_LIBRARY.map((template) => (
              <button
                key={template.name}
                type="button"
                onClick={() => addExercise(template)}
                className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs font-medium transition-colors hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 dark:border-ink-700 dark:hover:bg-brand-950/40 dark:hover:text-brand-300"
              >
                + {template.name}
              </button>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------------- the rows */}
        <div className="mt-5 space-y-3">
          {exercises.map((exercise, index) => (
            <div
              key={index}
              className="rounded-2xl border border-ink-200 p-4 dark:border-ink-700"
            >
              {/* Number, name and delete share the first line; everything else
                  runs the full width of the card underneath. With the number and
                  the bin as side columns the fields were ~190px on a phone. */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span
                    className="grid size-7 shrink-0 place-items-center rounded-lg bg-ink-100 text-xs font-bold dark:bg-ink-800"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>

                  <input
                    value={exercise.name}
                    onChange={(event) => updateExercise(index, 'name', event.target.value)}
                    placeholder="Exercise name — e.g. Glute bridge"
                    className="min-w-0 flex-1 rounded-xl border border-ink-200 bg-white px-3.5 py-2 text-sm font-semibold focus:border-brand-500 focus:outline-none dark:border-ink-700 dark:bg-ink-900"
                  />

                  <button
                    type="button"
                    onClick={() => removeExercise(index)}
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                    aria-label={`Remove exercise ${index + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>

                {/* Two across on a phone, three from sm up: three in a row left
                    each box too narrow to read "Reps / hold". */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <input
                    value={exercise.sets || ''}
                    onChange={(event) => updateExercise(index, 'sets', event.target.value)}
                    placeholder="Sets"
                    className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none dark:border-ink-700 dark:bg-ink-900"
                  />
                  <input
                    value={exercise.reps || ''}
                    onChange={(event) => updateExercise(index, 'reps', event.target.value)}
                    placeholder="Reps / hold"
                    className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none dark:border-ink-700 dark:bg-ink-900"
                  />
                  <input
                    value={exercise.frequency || ''}
                    onChange={(event) => updateExercise(index, 'frequency', event.target.value)}
                    placeholder="How often"
                    className="col-span-2 rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none sm:col-span-1 dark:border-ink-700 dark:bg-ink-900"
                  />
                </div>

                <input
                  value={exercise.notes || ''}
                  onChange={(event) => updateExercise(index, 'notes', event.target.value)}
                  placeholder="Cue or caution — e.g. keep the pelvis level, stop if sharp pain"
                  className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2 text-sm focus:border-brand-500 focus:outline-none dark:border-ink-700 dark:bg-ink-900"
                />
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => addExercise()}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-ink-300 py-3 text-sm font-semibold text-ink-500 transition-colors hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-300 dark:border-ink-700 dark:hover:border-brand-600"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add a blank exercise
        </button>
      </Card>

      {/* ============================================================ save */}
      <div className="sticky bottom-4 flex flex-wrap items-center gap-4 rounded-2xl border border-ink-200 bg-white/95 p-4 shadow-float backdrop-blur dark:border-ink-700 dark:bg-ink-900/95">
        {/* Sticky, because the form is long and the physiotherapist should never
            have to scroll to the bottom to find Save. */}
        <Button type="submit" size="lg" loading={pending}>
          {pending ? 'Saving…' : notes ? 'Update notes' : 'Save notes & complete'}
        </Button>

        {state?.ok && (
          <p role="status" className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            {state.message}
          </p>
        )}
        {state?.error && (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
            <AlertCircle className="size-4" aria-hidden="true" />
            {state.error}
          </p>
        )}
      </div>
    </form>
  )
}
