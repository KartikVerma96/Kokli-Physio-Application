'use client'

/**
 * ============================================================================
 *  BRANDING FORM
 * ============================================================================
 *  A colour picker with a live preview beside it.
 *
 *  The preview is the point. A hex code tells a physiotherapist nothing, and the
 *  swatch in the picker tells them almost nothing — what they need to see is a
 *  button, a link and a badge in that colour, which is where it will actually
 *  appear. Choosing blind and discovering the result on the public site is how
 *  people end up with a website they quietly dislike.
 * ============================================================================
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Palette, Check } from 'lucide-react'
import { saveBranding } from './actions'
import { brandRamp, readableTextOn } from '@/lib/brand'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { toast } from '@/lib/toast'

/**
 * A few that work.
 *
 * Offered because "pick any colour" produces a lot of neon pink. These are
 * saturated enough to look deliberate and dark enough that white text on them is
 * readable — which matters, since every primary button uses white text.
 */
const SUGGESTIONS = [
  { hex: '#0d9488', name: 'Teal' },
  { hex: '#0369a1', name: 'Ocean' },
  { hex: '#4f46e5', name: 'Indigo' },
  { hex: '#7c3aed', name: 'Violet' },
  { hex: '#be123c', name: 'Rose' },
  { hex: '#c2410c', name: 'Amber' },
  { hex: '#15803d', name: 'Forest' },
  { hex: '#334155', name: 'Slate' },
]

export default function BrandingForm({ brandColour, clinicName, slug }) {
  const router = useRouter()
  const [colour, setColour] = useState(brandColour)
  const [errors, setErrors] = useState({})
  const [saving, startSaving] = useTransition()

  const changed = colour.toLowerCase() !== brandColour.toLowerCase()

  /**
   * The preview uses the SAME functions the public site does.
   *
   * Anything else is a guess about what the website will look like, and a preview
   * that guesses is worse than no preview — it is confidently wrong.
   */
  const ramp = brandRamp(colour)
  const onBrand = readableTextOn(colour)

  function submit(event) {
    event.preventDefault()
    startSaving(async () => {
      const result = await saveBranding({ brandColour: colour })
      if (result.ok) {
        toast.success(result.message)
        setErrors({})
        router.refresh()
        return
      }
      setErrors(result.errors || {})
      toast.error(result.error)
    })
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card className="p-6">
        <h2 className="flex items-center gap-2 font-bold">
          <Palette className="size-4 text-ink-400" aria-hidden="true" />
          Your colour
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
          One colour tints your whole website — buttons, links, highlights and the header
          gradient. Lighter and darker shades are worked out from it, so you only choose one.
        </p>

        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <div className="space-y-4">
            <div className="flex items-end gap-3">
              {/* The native picker, made big enough to be worth tapping. */}
              <label className="shrink-0">
                <span className="mb-1.5 block text-sm font-semibold">Pick</span>
                <input
                  type="color"
                  value={colour}
                  onChange={(e) => setColour(e.target.value)}
                  aria-label="Brand colour"
                  className="size-12 cursor-pointer rounded-xl border-2 border-ink-200 bg-transparent p-1 dark:border-ink-700"
                />
              </label>
              <div className="min-w-0 flex-1">
                <Input
                  label="Or type a hex code"
                  value={colour}
                  onChange={(e) => setColour(e.target.value)}
                  error={errors.brandColour}
                  spellCheck={false}
                  className="font-mono"
                />
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-ink-500 dark:text-ink-400">
                Or start from one of these
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.hex}
                    type="button"
                    onClick={() => setColour(s.hex)}
                    title={`${s.name} — ${s.hex}`}
                    aria-label={s.name}
                    className="grid size-9 place-items-center rounded-xl border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: s.hex,
                      borderColor: colour.toLowerCase() === s.hex ? '#0f172a' : 'transparent',
                    }}
                  >
                    {colour.toLowerCase() === s.hex && (
                      <Check className="size-4 text-white" aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ------------------------------------------------ the live preview */}
          {/**
            * Built with plain inline styles rather than the brand-* classes.
            *
            * Those classes read the colour from a CSS variable set on the PUBLIC
            * layout, which this admin page is not inside — so they would show the
            * old colour, or the admin's, and quietly lie about what was chosen.
            */}
          <div
            className="rounded-2xl border border-ink-200 p-5 dark:border-ink-700"
            style={{ '--preview': colour }}
          >
            <p className="text-xs font-semibold text-ink-500 dark:text-ink-400">
              How your website will look
            </p>

            <div
              className="mt-3 rounded-xl p-4"
              style={{
                background: `linear-gradient(135deg, ${ramp['--color-brand-600']} 0%, ${ramp['--color-brand-400']} 100%)`,
                color: onBrand,
              }}
            >
              <p className="font-display text-sm font-bold">{clinicName}</p>
              <p className="mt-0.5 text-[11px] opacity-85">Physiotherapy &amp; Rehabilitation</p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span
                className="rounded-xl px-3.5 py-2 text-xs font-semibold"
                style={{ backgroundColor: ramp['--color-brand-600'], color: onBrand }}
              >
                Book an appointment
              </span>
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                style={{
                  backgroundColor: ramp['--color-brand-100'],
                  color: ramp['--color-brand-800'],
                }}
              >
                Available today
              </span>
            </div>

            <p className="mt-3 text-xs text-ink-600 dark:text-ink-400">
              Read more about{' '}
              <span className="font-semibold underline" style={{ color: ramp['--color-brand-700'] }}>
                our treatments
              </span>
              .
            </p>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={saving} disabled={!changed}>
          {saving ? 'Saving…' : changed ? 'Save colour' : 'Saved'}
        </Button>
        <a
          href={`/`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-ink-500 underline hover:text-brand-700 dark:hover:text-brand-200"
        >
          View {slug}&rsquo;s public website →
        </a>
      </div>
    </form>
  )
}
