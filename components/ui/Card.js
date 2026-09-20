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

export function Stat({ label, value, hint, icon, tone = 'brand', className }) {
  const toneRing = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-300',
    success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300',
    warning: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300',
    info: 'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300',
    danger: 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300',
  }[tone]

  return (
    <div className={cn('card p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400">
            {label}
          </p>
          {/* tabular-nums keeps digits the same width, so a column of numbers
              lines up and does not jitter when a value changes. */}
          <p className="mt-2 text-3xl font-bold tabular-nums text-ink-900 dark:text-white">
            {value}
          </p>
          {hint && <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{hint}</p>}
        </div>
        {icon && (
          <div className={cn('grid size-11 shrink-0 place-items-center rounded-2xl', toneRing)}>
            {icon}
          </div>
        )}
      </div>
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
