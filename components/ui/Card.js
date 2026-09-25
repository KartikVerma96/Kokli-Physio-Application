import { cloneElement, isValidElement } from 'react'
import { cn } from '@/lib/utils'

/**
 * ============================================================================
 *  CARD, BADGE, STAT AND EMPTY STATE
 * ============================================================================
 *  The small presentational pieces used across the dashboard and admin panel.
 * ============================================================================
 */

export function Card({ children, className, as: Tag = 'div', hover = false, ...props }) {
  return (
    <Tag
      className={cn(
        'card',
        // Lifting a card slightly on hover is a strong affordance: it says
        // "this whole thing is clickable" without needing a "click here" label.
        hover && 'transition-all duration-300 hover:-translate-y-1 hover:shadow-lift',
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  )
}

export function CardHeader({ title, description, action, className, icon }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-ink-100 p-5 dark:border-ink-800', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-300">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold">{title}</h3>
          {description && (
            <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function CardBody({ children, className }) {
  return <div className={cn('p-5', className)}>{children}</div>
}

/* -------------------------------------------------------------------------- */
/*  BADGE                                                                     */
/* -------------------------------------------------------------------------- */

const TONES = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/50 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/50 dark:text-amber-300',
  danger:  'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/50 dark:text-red-300',
  info:    'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950/50 dark:text-sky-300',
  brand:   'bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-950/50 dark:text-brand-300',
  neutral: 'bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300',
}

export function Badge({ children, tone = 'neutral', className, dot = false }) {
  return (
    <span
      className={cn(
        // `ring-1 ring-inset` rather than `border` so the badge's size never
        // changes between toned and untoned states.
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset whitespace-nowrap',
        TONES[tone] || TONES.neutral,
        className
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/*  STAT TILE                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * ----------------------------------------------------------------------------
 *  THE TILE, AND ITS TWO COPIES OF THE ICON
 * ----------------------------------------------------------------------------
 *  Each tone paints three things: a faint tinted wash across the card, a solid
 *  chip behind the icon, and an oversized ghost of the same icon bleeding out of
 *  the top-right corner. The ghost is what gives the tile its character — it
 *  reads as a watermark rather than a second icon, so the number stays the thing
 *  you see first.
 *
 *  `brand` uses the clinic's own colour (see brandStyle in lib/brand.js), so an
 *  admin panel is tinted in the clinic's colour rather than ours. The other
 *  tones are fixed, because "money in" being green and "overdue" being red is
 *  meaning, not decoration.
 */
const STAT_TONES = {
  brand: {
    wash: 'from-brand-50/90 dark:from-brand-500/10',
    chip: 'bg-brand-500/15 text-brand-600 dark:text-brand-300',
    ghost: 'text-brand-500/10 dark:text-brand-400/10',
  },
  success: {
    wash: 'from-emerald-50/90 dark:from-emerald-500/10',
    chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
    ghost: 'text-emerald-500/10 dark:text-emerald-400/10',
  },
  warning: {
    wash: 'from-amber-50/90 dark:from-amber-500/10',
    chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
    ghost: 'text-amber-500/10 dark:text-amber-400/10',
  },
  info: {
    wash: 'from-sky-50/90 dark:from-sky-500/10',
    chip: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
    ghost: 'text-sky-500/10 dark:text-sky-400/10',
  },
  danger: {
    wash: 'from-red-50/90 dark:from-red-500/10',
    chip: 'bg-red-500/15 text-red-600 dark:text-red-300',
    ghost: 'text-red-500/10 dark:text-red-400/10',
  },
  // For a fact with no good or bad about it — "sending from: our number". It
  // was being passed already and silently fell back to the brand colour, which
  // made a neutral statement look like the headline number on the page.
  neutral: {
    wash: 'from-ink-100/70 dark:from-ink-500/10',
    chip: 'bg-ink-500/15 text-ink-600 dark:text-ink-300',
    ghost: 'text-ink-500/10 dark:text-ink-400/10',
  },
}

export function Stat({ label, value, hint, icon, tone = 'brand', className }) {
  const t = STAT_TONES[tone] || STAT_TONES.brand

  /**
   * The same icon element, resized for the watermark.
   *
   * Callers pass a ready-made element (`icon={<Users className="size-5" />}`),
   * and cloning it with a new className is how the tile gets a second, much
   * larger copy without every caller having to pass the icon twice.
   */
  const ghost =
    isValidElement(icon) && cloneElement(icon, { className: 'size-24 sm:size-28', strokeWidth: 1.25 })

  return (
    // overflow-hidden keeps the oversized ghost inside the rounded corners;
    // the wash is a background IMAGE, so .card's own background colour still
    // provides the surface underneath it in both themes.
    <div className={cn('card relative overflow-hidden bg-linear-to-br to-transparent p-4 sm:p-5', t.wash, className)}>
      {ghost && (
        <div className={cn('pointer-events-none absolute -right-4 -top-5', t.ghost)} aria-hidden="true">
          {ghost}
        </div>
      )}

      {icon && (
        <div className={cn('relative grid size-10 place-items-center rounded-xl sm:size-11 sm:rounded-2xl', t.chip)}>
          {icon}
        </div>
      )}

      {/* tabular-nums keeps digits the same width, so a column of numbers
          lines up and does not jitter when a value changes. */}
      <p className="relative mt-3 text-2xl font-bold tabular-nums text-ink-900 sm:text-3xl dark:text-white">
        {value}
      </p>
      <p className="relative mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500 sm:text-xs dark:text-ink-400">
        {label}
      </p>
      {hint && <p className="relative mt-1.5 text-xs text-ink-500 dark:text-ink-400">{hint}</p>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  EMPTY STATE                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Shown when a list has nothing in it.
 *
 * An empty list is a moment of confusion — "is it loading? is it broken?" — so
 * an empty state should always explain what should be there and offer the
 * action that would fill it. Never just render nothing.
 */
export function EmptyState({ icon, title, description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && (
        <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-ink-100 text-ink-400 dark:bg-ink-800 dark:text-ink-500">
          {icon}
        </div>
      )}
      <h3 className="text-base font-bold">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-ink-500 dark:text-ink-400">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  SECTION HEADING                                                           */
/* -------------------------------------------------------------------------- */

/** The eyebrow + heading + subheading block that opens each homepage section. */
export function SectionHeading({ eyebrow, title, description, align = 'center', className }) {
  return (
    <div
      className={cn(
        'max-w-2xl',
        align === 'center' && 'mx-auto text-center',
        className
      )}
    >
      {eyebrow && (
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-brand-600 dark:text-brand-400">
          {eyebrow}
        </p>
      )}
      {/* text-balance stops a heading leaving one lonely word on the last line.
          It is one CSS property and it makes typography look considered. */}
      <h2 className="text-3xl font-bold text-balance sm:text-4xl">{title}</h2>
      {description && (
        <p className="mt-4 text-lg leading-relaxed text-ink-600 text-pretty dark:text-ink-300">
          {description}
        </p>
      )}
    </div>
  )
}
