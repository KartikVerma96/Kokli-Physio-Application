import { Inter, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import { platform } from '@/config/platform'
import { getCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import { brandStyle } from '@/lib/brand'
import { Suspense } from 'react'
import StoreProvider from '@/store/StoreProvider'
import Toaster from '@/components/ui/Toaster'
import RouteProgress from '@/components/ui/RouteProgress'

/**
 * ============================================================================
 *  ROOT LAYOUT
 * ============================================================================
 *  Wraps every page in the app. This is where fonts, global metadata, the Redux
 *  provider and the toast container are set up — once, for everything.
 *
 *  Note there is no Header or Footer here. They live in app/(public)/layout.js
 *  instead, because the video consultation room and the admin panel both want
 *  completely different chrome. Putting them here would force every page to
 *  carry a marketing header.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/*  FONTS                                                                     */
/* -------------------------------------------------------------------------- */
/*
 *  next/font downloads these at BUILD time and serves them from our own domain.
 *  Three real benefits, all of which Google measures:
 *
 *    - No request to fonts.googleapis.com, so no extra DNS lookup and TLS
 *      handshake on a slow mobile connection.
 *    - `display: swap` plus a generated size-adjusted fallback means text is
 *      readable immediately and barely moves when the real font arrives. That
 *      movement is Cumulative Layout Shift, and it is a ranking factor.
 *    - Nothing about the visitor is sent to Google's font servers, which is
 *      also the right answer for a medical site.
 *
 *  `variable` exposes each font as a CSS custom property, which app/globals.css
 *  then wires into --font-sans and --font-display.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  weight: ['600', '700', '800'],   // headings only, so no need for 400
  variable: '--font-jakarta',
})

/* -------------------------------------------------------------------------- */
/*  SITE-WIDE METADATA                                                        */
/* -------------------------------------------------------------------------- */

/**
 * ROOT METADATA IS DELIBERATELY GENERIC
 * -------------------------------------
 * This layout wraps EVERY hostname — the platform's marketing site and every
 * clinic's website. It therefore cannot name a clinic, because it does not know
 * which one the request is for.
 *
 * The real, per-clinic titles and descriptions come from each page's
 * `generateMetadata()`, which resolves the tenant first. What is left here is
 * only what is true of every page on every hostname.
 *
 * `metadataBase` is the one exception worth noting: it makes relative URLs in
 * metadata resolve, and pages override it with their own canonical anyway.
 */
export const metadata = {
  metadataBase: new URL(`${platform.protocol}://${platform.domain}`),

  title: {
    default: `${platform.name} — ${platform.tagline}`,
    // Pages that set `title: 'About'` become "About | Kokli" on the
    // platform, and clinic pages override the whole thing with their own brand.
    template: `%s | ${platform.name}`,
  },
  description: platform.description,

  applicationName: platform.name,

  // Prevents iOS Safari from auto-linking every number it thinks is a phone
  // number, which mangles prices and appointment codes.
  formatDetection: { telephone: false, address: false, email: false },

  openGraph: {
    type: 'website',
    locale: 'en_IN',
    siteName: platform.name,
    title: `${platform.name} — ${platform.tagline}`,
    description: platform.description,
  },

  twitter: { card: 'summary_large_image' },

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Lets Google show a longer text snippet and a large image preview,
      // rather than defaulting to something conservative.
      'max-snippet': -1,
      'max-image-preview': 'large',
      'max-video-preview': -1,
    },
  },

  // Paste the verification string from Google Search Console here once you have
  // registered the site. Search Console is where you submit the sitemap and see
  // what people actually searched to find the clinic.
  verification: {
    // google: 'your-google-search-console-verification-code',
  },

  category: 'health',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Deliberately NOT setting maximumScale or userScalable: false. Blocking zoom
  // is an accessibility failure — an older patient with poor eyesight must be
  // able to pinch-zoom your booking form.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fdfcfa' },
    { media: '(prefers-color-scheme: dark)', color: '#060a13' },
  ],
}

export default async function RootLayout({ children }) {
  /**
   * THE CLINIC'S COLOUR, ON EVERY PAGE OF THEIR ADDRESS
   * ---------------------------------------------------
   * This used to be set only by app/(public)/layout.js, so a clinic's website
   * was in their colour while their own admin panel, their patients' dashboard,
   * the login page and the video room were all in Kokli's teal. Their patients
   * clicked "My appointments" and appeared to have left for another company.
   *
   * Setting it here, on <html>, covers every route group at once — and also
   * the toasts and dropdowns that render at the end of <body>, outside any
   * page's wrapper.
   *
   * On kokli.in there is no clinic, nothing is set, and the defaults in
   * app/globals.css (Kokli's own teal) apply. getCurrentClinic() is cached for
   * the request, so the pages below that ask again cost nothing.
   */
  const clinic = await getCurrentClinic()

  return (
    <html
      lang="en-IN"
      className={`${inter.variable} ${jakarta.variable}`}
      style={clinic ? brandStyle(clinicView(clinic).brandColour) : undefined}
      // globals.css sets smooth scrolling on <html> for anchor links. This tells
      // Next.js so it can switch it off during page changes — otherwise every
      // navigation visibly glides to the top, and Next warns on every page.
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        {/*
          THE ANTI-FLASH SCRIPT
          ---------------------
          This runs before the browser paints a single pixel, which is why it is
          a plain inline <script> and not a React effect. It reads the saved
          theme and puts the `dark` class on <html> immediately, so a dark-mode
          user never sees a white flash.

          It is wrapped in try/catch because localStorage throws in Safari
          private browsing, and a broken theme must not take down the page.

          `suppressHydrationWarning` on <html> above is required: this script
          changes the class attribute before React hydrates, and without it
          React would warn that the server's HTML does not match the browser's.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var saved = localStorage.getItem('theme');
                var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (saved === 'dark' || (!saved && prefersDark)) {
                  document.documentElement.classList.add('dark');
                }
              } catch (e) {}
            `,
          }}
        />

        {/*
          NO-JAVASCRIPT SAFETY NET

          components/ui/Reveal.js hides its children until an IntersectionObserver
          fades them in, so without JavaScript the homepage service cards would be
          in the HTML but permanently invisible.

          app/globals.css handles this with `@media (scripting: none)`, which is the
          modern way and is what most visitors will hit. This <noscript> block does
          the same job for older browsers that do not support that media feature —
          belt and braces, because invisible content is not a cosmetic bug.
        */}
        <noscript>
          <style>{`.reveal,.animate-fade-up,.animate-fade-in{opacity:1!important;transform:none!important;animation:none!important}`}</style>
        </noscript>
      </head>

      <body className="min-h-screen antialiased">
        {/* No structured data here: it would have to describe a business, and
            this layout serves both the platform and every clinic. Each clinic
            emits its own from app/(public)/page.js. */}

        {/* Redux wraps everything so any client component can reach the store.
            Server Components passed as children still render on the server —
            see the explanation in store/StoreProvider.js. */}
        {/* The thin line across the top during a page change. In its own
            Suspense boundary because it reads the query string, and Next
            requires that of any client component which does — without it every
            page that could be static would be forced to render on demand. */}
        <Suspense fallback={null}>
          <RouteProgress />
        </Suspense>

        <StoreProvider>
          {children}
          <Toaster />
        </StoreProvider>
      </body>
    </html>
  )
}
