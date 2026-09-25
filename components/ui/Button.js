import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * ============================================================================
 *  BUTTON
 * ============================================================================
 *  One component for every button and button-shaped link in the app.
 *
 *  WHY BOTHER, WHEN TAILWIND CLASSES WOULD DO?
 *  -------------------------------------------
 *  Because without it, the twelfth button someone writes will have a slightly
 *  different padding, a slightly different hover colour, and no focus ring.
 *  Design consistency is not achieved by trying hard; it is achieved by making
 *  the consistent thing the easiest thing to reach for.
 *
 *  It also renders an <a> automatically when you pass `href`, which matters for
 *  accessibility: something that navigates must be a link, so it can be opened
 *  in a new tab, and something that acts must be a <button>.
 *
 *      <Button href="/book">Book now</Button>          → <a>
 *      <Button onClick={save}>Save</Button>            → <button>
 *      <Button variant="ghost" size="sm">Cancel</Button>
 * ============================================================================
 */

const VARIANTS = {
  // The main call to action. Only one of these per screen — if everything is
  // emphasised, nothing is.
  primary:
    // `--color-brand-fg` is set on <html> from the clinic's colour (app/layout.js),
    // so a light brand gets dark text instead of unreadable white — on the website
    // and in the admin alike. The fallback is for kokli.in, which sets none.
    'bg-brand-600 text-[var(--color-brand-fg,#fff)] shadow-brand hover:bg-brand-700 hover:-translate-y-0.5 active:translate-y-0',

  // The warm accent, for the single most important action on the page.
  accent:
    'bg-sun-400 text-ink-900 shadow-[0_8px_24px_-6px_rgba(251,191,36,0.55)] hover:bg-sun-300 hover:-translate-y-0.5 active:translate-y-0',

  // Secondary actions that still need to look like buttons.
  secondary:
    'bg-white text-ink-800 border border-ink-200 shadow-soft hover:border-brand-300 hover:text-brand-700 hover:-translate-y-0.5 dark:bg-ink-800 dark:text-ink-100 dark:border-ink-700 dark:hover:border-brand-600',

  outline:
    'border-2 border-brand-600 text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/50',

  // Tertiary actions: Cancel, Back, Skip.
  ghost:
    'text-ink-600 hover:bg-brand-50 hover:text-brand-700 dark:text-ink-300 dark:hover:bg-brand-500/10 dark:hover:text-brand-200',

  // Destructive actions. Red on purpose — a colour that makes people pause.
  danger:
    'bg-red-600 text-white shadow-[0_8px_24px_-6px_rgba(220,38,38,0.5)] hover:bg-red-700',

  dangerGhost:
    'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40',
}

const SIZES = {
  xs: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  sm: 'h-9 px-4 text-sm gap-2 rounded-xl',
  md: 'h-11 px-5 text-sm gap-2 rounded-xl',
  lg: 'h-13 px-7 text-base gap-2.5 rounded-2xl',
}

export default function Button({
  children,
  href,
  variant = 'primary',
  size = 'md',
  className,
  loading = false,
  disabled = false,
  fullWidth = false,
  type = 'button',
  ...props
}) {
  const classes = cn(
    // Shared by every variant. `whitespace-nowrap` stops a button collapsing
    // into two lines on a narrow screen, and the transition covers colour AND
    // transform so the small lift on hover is smooth.
    'inline-flex items-center justify-center font-semibold whitespace-nowrap',
    'transition-all duration-200 ease-out select-none',
    'disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant] || VARIANTS.primary,
    SIZES[size] || SIZES.md,
    fullWidth && 'w-full',
    className
  )

  const content = (
    <>
      {loading && <Spinner />}
      {children}
    </>
  )

  // A link with `disabled` on it is meaningless in HTML, so a disabled link
  // renders as a span instead. Otherwise it would still be clickable.
  if (href && !disabled && !loading) {
    return (
      <Link href={href} className={classes} {...props}>
        {content}
      </Link>
    )
  }
  if (href) {
    return <span className={cn(classes, 'opacity-50 pointer-events-none')}>{content}</span>
  }

  return (
    <button type={type} className={classes} disabled={disabled || loading} {...props}>
      {content}
    </button>
  )
}

/** The small spinning ring shown inside a loading button. */
function Spinner() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
