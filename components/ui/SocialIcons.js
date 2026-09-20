/**
 * ============================================================================
 *  SOCIAL BRAND ICONS
 * ============================================================================
 *  Instagram, Facebook, YouTube and LinkedIn, as inline SVG.
 *
 *  WHY THESE ARE NOT IMPORTED FROM lucide-react
 *  --------------------------------------------
 *  Lucide removed every brand and logo icon in version 1. Company logos are
 *  trademarks, and an icon library redistributing them under its own licence
 *  creates a legal problem the maintainers reasonably declined to carry.
 *
 *  So we draw them ourselves. This is worth knowing about generally: icon
 *  libraries move, rename and remove things between major versions, and a build
 *  that fails with "export Instagram was not found" is almost always this.
 *
 *  Each icon is a single path on a 24x24 grid using `currentColor`, so it
 *  inherits text colour and works in both light and dark mode without changes.
 * ============================================================================
 */

const base = {
  viewBox: '0 0 24 24',
  fill: 'currentColor',
  'aria-hidden': 'true',
}

export function Instagram({ className = 'size-4', ...props }) {
  return (
    <svg {...base} className={className} {...props}>
      <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.96.24 2.65.5.72.28 1.3.66 1.88 1.24.58.58.96 1.16 1.24 1.88.27.69.45 1.48.5 2.65.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.23 1.96-.5 2.65a5.2 5.2 0 0 1-1.24 1.88c-.58.58-1.16.96-1.88 1.24-.69.27-1.48.45-2.65.5-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.96-.23-2.65-.5a5.2 5.2 0 0 1-1.88-1.24 5.2 5.2 0 0 1-1.24-1.88c-.27-.69-.45-1.48-.5-2.65C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.23-1.96.5-2.65.28-.72.66-1.3 1.24-1.88A5.2 5.2 0 0 1 5.85 2.4c.69-.27 1.48-.45 2.65-.5C9.77 2.17 10.15 2.16 12 2.16Zm0 1.98c-3.15 0-3.5.01-4.74.07-.96.04-1.48.2-1.83.34-.46.18-.79.39-1.13.74-.35.34-.56.67-.74 1.13-.13.35-.3.87-.34 1.83-.06 1.24-.07 1.59-.07 4.75s.01 3.51.07 4.75c.04.96.2 1.48.34 1.83.18.46.39.79.74 1.13.34.35.67.56 1.13.74.35.13.87.3 1.83.34 1.24.06 1.59.07 4.74.07s3.5-.01 4.74-.07c.96-.04 1.48-.21 1.83-.34.46-.18.79-.39 1.13-.74.35-.34.56-.67.74-1.13.13-.35.3-.87.34-1.83.06-1.24.07-1.59.07-4.75s-.01-3.51-.07-4.75c-.04-.96-.21-1.48-.34-1.83a3.04 3.04 0 0 0-.74-1.13 3.04 3.04 0 0 0-1.13-.74c-.35-.13-.87-.3-1.83-.34-1.24-.06-1.59-.07-4.74-.07Zm0 3.37a4.49 4.49 0 1 1 0 8.98 4.49 4.49 0 0 1 0-8.98Zm0 7.4a2.92 2.92 0 1 0 0-5.83 2.92 2.92 0 0 0 0 5.84Zm5.72-7.6a1.05 1.05 0 1 1-2.1 0 1.05 1.05 0 0 1 2.1 0Z" />
    </svg>
  )
}

export function Facebook({ className = 'size-4', ...props }) {
  return (
    <svg {...base} className={className} {...props}>
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.9 3.77-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.45 2.91h-2.33V22c4.78-.76 8.44-4.92 8.44-9.94Z" />
    </svg>
  )
}

export function Youtube({ className = 'size-4', ...props }) {
  return (
    <svg {...base} className={className} {...props}>
      <path d="M21.58 7.19a2.51 2.51 0 0 0-1.77-1.77C18.25 5 12 5 12 5s-6.25 0-7.81.42a2.51 2.51 0 0 0-1.77 1.77A26.2 26.2 0 0 0 2 12c0 1.63.14 3.26.42 4.81a2.51 2.51 0 0 0 1.77 1.77C5.75 19 12 19 12 19s6.25 0 7.81-.42a2.51 2.51 0 0 0 1.77-1.77c.28-1.55.42-3.18.42-4.81 0-1.63-.14-3.26-.42-4.81ZM9.96 15.02V8.98L15.2 12l-5.24 3.02Z" />
    </svg>
  )
}

export function Linkedin({ className = 'size-4', ...props }) {
  return (
    <svg {...base} className={className} {...props}>
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12Zm1.78 13.02H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
    </svg>
  )
}
