import Image from 'next/image'

/**
 * ============================================================================
 *  THE KOKLI MARK
 * ============================================================================
 *  Kokli's own logo, used on kokli.in and in the platform console — never on a
 *  clinic's website, which carries the clinic's mark instead.
 *
 *  ONE COMPONENT RATHER THAN FOUR <Image> TAGS
 *  -------------------------------------------
 *  The mark appears in the marketing header, the console sidebar, the console's
 *  mobile header and the sign-in page. Four copies of the same file path, sizes
 *  and alt text is four places to forget when the logo changes; this is one.
 *
 *  The file is an SVG, so `unoptimized` is set: Next's image pipeline has
 *  nothing to do to a vector but re-serve it, and routing it through the
 *  optimiser only adds a request that can fail.
 *
 *  The alt text is empty on purpose wherever the word "Kokli" sits next to the
 *  mark — a screen reader announcing "Kokli logo Kokli" is noise. Pass `alt`
 *  when the mark stands alone.
 * ============================================================================
 */

export default function KokliLogo({ size = 36, className = '', alt = '' }) {
  return (
    <Image
      src="/kokli-logo.svg"
      alt={alt}
      width={size}
      height={size}
      unoptimized
      priority
      className={className}
      aria-hidden={alt ? undefined : 'true'}
    />
  )
}
