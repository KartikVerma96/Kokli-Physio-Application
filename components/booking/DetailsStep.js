'use client'

/**
 * ============================================================================
 *  STEP 3 — what is bothering you?
 * ============================================================================
 *  Both fields are optional, and that is a deliberate choice: an extra required
 *  field on a booking form measurably reduces completions, and neither of these
 *  is needed to make the appointment valid.
 *
 *  They are worth asking for anyway. A physiotherapist who reads "left knee,
 *  worse on stairs, three weeks, pain 6/10" before the patient walks in can have
 *  the right tests and equipment ready, instead of spending the first five
 *  minutes of a paid session gathering basic history.
 *
 *  The pain score matters more than it looks. Physiotherapy outcomes are measured
 *  on this 0–10 scale, and capturing it at booking gives a genuine baseline. Six
 *  sessions later, "you came in at 7 and you are at 2" is objective evidence that
 *  treatment worked — for the patient's confidence and for the clinical record.
 * ============================================================================
 */

import { useDispatch, useSelector } from 'react-redux'
import { Info, Video, MapPin, Wifi, Shirt, FileText } from 'lucide-react'
import { setPatientNotes, setPainLevel, setVisitAddress, selectBooking } from '@/store/slices/bookingSlice'
import { Textarea, PainScale } from '@/components/ui/Field'
import { firstName } from '@/lib/utils'

export default function DetailsStep({ site, user }) {
  const dispatch = useDispatch()
  const { patientNotes, painLevel, mode, service } = useSelector(selectBooking)

  return (
    <div>
      <h2 className="text-xl font-bold">Tell us what is going on</h2>
      <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-400">
        Both of these are optional, but they let {firstName(site.doctor.name)} prepare before you
        arrive — which means more of your session is spent treating you.
      </p>

      <div className="mt-7 space-y-7">
        {/* A home visit is useless without somewhere to go, and the profile
            address is not good enough: people move, and a therapist driving to
            last year's flat has lost an afternoon. So it is asked every time and
            copied onto the appointment. */}
        {booking.mode === 'home' && (
          <Textarea
            label="Where should the physiotherapist come?"
            name="visitAddress"
            rows={3}
            required
            value={booking.visitAddress}
            onChange={(event) => dispatch(setVisitAddress(event.target.value))}
            placeholder="Flat 402, Sai Residency, Baner Road, Pune 411045. Lift on the left, ring 402."
            hint="A landmark and a floor save the therapist ten minutes on the doorstep"
          />
        )}

        <Textarea
          label="What is the problem?"
          name="patientNotes"
          rows={5}
          maxLength={1000}
          placeholder="For example: Left knee has hurt for about three weeks. Worst going down stairs and after sitting for a while. No injury that I remember. I had an X-ray last month which the doctor said was normal."
          value={patientNotes}
          onChange={(event) => dispatch(setPatientNotes(event.target.value))}
          hint={`${patientNotes.length}/1000 · Where it hurts, how long for, and what makes it worse are the three most useful things to mention.`}
        />

        <div className="rounded-2xl border border-ink-200 p-5 dark:border-ink-700">
          <PainScale
            value={painLevel}
            onChange={(value) => dispatch(setPainLevel(value))}
            label="How bad is it right now?"
          />
          <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              This is the standard 0–10 pain scale physiotherapists use at every visit. Recording it
              now gives us a baseline, so in six weeks we can show you — not just tell you — how much
              has changed.
            </span>
          </p>
        </div>

        {/* -------------------------------------------- preparation advice */}
        {/* Different advice for each mode, because the practical needs genuinely
            differ. Telling an online patient to clear floor space in advance is
            the difference between a productive session and ten minutes of
            furniture moving. */}
        <div className="rounded-2xl bg-brand-50/70 p-5 dark:bg-brand-950/30">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            {mode === 'online' ? (
              <>
                <Video className="size-4 text-brand-600" aria-hidden="true" />
                Getting ready for your video consultation
              </>
            ) : (
              <>
                <MapPin className="size-4 text-brand-600" aria-hidden="true" />
                Getting ready for your clinic visit
              </>
            )}
          </h3>

          <ul className="mt-3 space-y-2.5 text-sm text-ink-700 dark:text-ink-300">
            {(mode === 'online' ? ONLINE_TIPS : CLINIC_TIPS).map((tip) => (
              <li key={tip.text} className="flex items-start gap-2.5">
                <tip.icon className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
                <span>{tip.text}</span>
              </li>
            ))}
          </ul>

          {mode === 'online' && (
            <p className="mt-4 text-xs text-ink-500 dark:text-ink-400">
              The call runs in your browser — there is nothing to download. A link appears in your
              dashboard 10 minutes before the appointment.
            </p>
          )}
        </div>

        {/* A reminder for anyone not signed in yet, so the login prompt at the
            next step is expected rather than a nasty surprise after they have
            typed all this out. */}
        {!user && (
          <p className="rounded-2xl bg-ink-100 p-4 text-sm text-ink-600 dark:bg-ink-800 dark:text-ink-300">
            You will be asked to sign in on the next step. Everything you have chosen and written
            here is carried across, so nothing is lost.
          </p>
        )}
      </div>
    </div>
  )
}

const ONLINE_TIPS = [
  { icon: Wifi, text: 'Find a quiet spot with a steady connection. Wi-Fi is better than mobile data if you have it.' },
  { icon: Video, text: 'Prop your phone or laptop so your whole body is visible — we need to see how you move, not just your face.' },
  { icon: Shirt, text: 'Wear loose clothing that lets us see the affected area. Shorts for a knee, a vest for a shoulder.' },
  { icon: MapPin, text: 'Clear about two metres of floor space, and keep a chair and a water bottle nearby.' },
]

const CLINIC_TIPS = [
  { icon: FileText, text: 'Bring any X-rays, MRI scans, or notes from a doctor or surgeon.' },
  { icon: Shirt, text: 'Wear loose, comfortable clothing you can move in.' },
  { icon: MapPin, text: 'Arrive five minutes early. There is lift access and free two-wheeler parking in the compound.' },
  { icon: FileText, text: 'Bring a list of any medication you take regularly.' },
]
