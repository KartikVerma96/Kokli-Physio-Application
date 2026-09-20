import { cn } from '@/lib/utils'

/**
 * ============================================================================
 *  FORM FIELDS
 * ============================================================================
 *  Input, Textarea, Select and Checkbox, each wrapped in a label and an error
 *  message.
 *
 *  THE ACCESSIBILITY PART IS THE POINT
 *  -----------------------------------
 *  Every field here wires up four things that are easy to forget and matter
 *  enormously to anyone using a screen reader:
 *
 *    htmlFor / id       clicking the label focuses the input
 *    aria-invalid       announces "invalid entry" when there is an error
 *    aria-describedby   reads the error text out loud, tied to this field
 *    role="alert"       announces the error the moment it appears
 *
 *  A patient with low vision filling in a medical form is exactly the person
 *  who cannot afford a form that only communicates through red borders.
 * ============================================================================
 */

const baseInput = cn(
  'w-full rounded-xl border bg-white px-4 text-[15px] text-ink-900 shadow-sm',
  'placeholder:text-ink-400',
  'transition-colors duration-150',
  'focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none',
  'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400',
  'dark:bg-ink-900 dark:text-ink-100 dark:placeholder:text-ink-500'
)

/** The label + error wrapper shared by all the field types below. */
export function Field({ label, htmlFor, error, hint, required, children, className }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-ink-700 dark:text-ink-200">
          {label}
          {required && (
            <span className="ml-0.5 text-red-500" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      {children}

      {/* The hint is hidden once there is an error, so the two never fight for
          the same space and shift the layout. */}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-xs text-ink-500 dark:text-ink-400">
          {hint}
        </p>
      )}

      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="flex items-start gap-1 text-xs font-medium text-red-600 dark:text-red-400">
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

export function Input({ label, name, error, hint, required, className, icon, ...props }) {
  const id = props.id || name
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint} required={required}>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400">
            {icon}
          </span>
        )}
        <input
          id={id}
          name={name}
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(
            baseInput,
            'h-11',
            icon && 'pl-11',
            error && 'border-red-400 focus:border-red-500 focus:ring-red-500/10',
            className
          )}
          {...props}
        />
      </div>
    </Field>
  )
}

export function Textarea({ label, name, error, hint, required, rows = 4, className, ...props }) {
  const id = props.id || name
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint} required={required}>
      <textarea
        id={id}
        name={name}
        rows={rows}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(
          baseInput,
          'resize-y py-3 leading-relaxed',
          error && 'border-red-400 focus:border-red-500 focus:ring-red-500/10',
          className
        )}
        {...props}
      />
    </Field>
  )
}

export function Select({ label, name, error, hint, required, children, className, ...props }) {
  const id = props.id || name
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint} required={required}>
      <div className="relative">
        <select
          id={id}
          name={name}
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(
            baseInput,
            'h-11 appearance-none pr-10',
            error && 'border-red-400 focus:border-red-500',
            className
          )}
          {...props}
        >
          {children}
        </select>
        {/* The native dropdown arrow cannot be styled, so it is removed with
            appearance-none above and drawn here instead. */}
        <svg
          className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-400"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    </Field>
  )
}

export function Checkbox({ label, name, error, className, ...props }) {
  const id = props.id || name
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-start gap-3">
        <input
          id={id}
          name={name}
          type="checkbox"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(
            'mt-0.5 size-5 shrink-0 cursor-pointer rounded-md border-2 border-ink-300',
            'text-brand-600 accent-brand-600',
            'focus:ring-4 focus:ring-brand-500/15',
            error && 'border-red-400'
          )}
          {...props}
        />
        <label htmlFor={id} className="cursor-pointer text-sm leading-relaxed text-ink-600 dark:text-ink-300">
          {label}
        </label>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * The 0–10 pain scale. Physiotherapists use this at every single visit — it is
 * called the Visual Analogue Scale, and it is how you prove to a patient that
 * they are actually getting better.
 *
 * Rendered as radio buttons rather than a range slider on purpose: a slider
 * gives no feedback about which value is selected until you look at a number,
 * is fiddly on a phone, and is genuinely hard to operate with a keyboard.
 */
export function PainScale({ value, onChange, name = 'painLevel', label = 'How bad is the pain right now?' }) {
  return (
    <fieldset>
      <legend className="mb-2 block text-sm font-medium text-ink-700 dark:text-ink-200">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 11 }, (_, n) => {
          const selected = String(value) === String(n)
          return (
            <label
              key={n}
              className={cn(
                'relative flex size-10 cursor-pointer items-center justify-center rounded-xl border-2 text-sm font-semibold transition-all',
                selected
                  ? 'scale-105 border-transparent text-white shadow-lift'
                  : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300 dark:bg-ink-900 dark:text-ink-300'
              )}
              // The colour runs green → amber → red across the scale, which
              // communicates severity before the number is even read.
              style={selected ? { backgroundColor: painColour(n) } : undefined}
            >
              <input
                type="radio"
                name={name}
                value={n}
                checked={selected}
                onChange={() => onChange(n)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              {n}
            </label>
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-ink-500">
        <span>0 — no pain</span>
        <span>10 — worst imaginable</span>
      </div>
    </fieldset>
  )
}

/** Green at 0, amber in the middle, red at 10. */
export function painColour(level) {
  const n = Number(level)
  if (n <= 2) return '#16a34a'
  if (n <= 4) return '#65a30d'
  if (n <= 6) return '#f59e0b'
  if (n <= 8) return '#ea580c'
  return '#dc2626'
}
