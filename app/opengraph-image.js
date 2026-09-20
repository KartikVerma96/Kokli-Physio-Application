import { ImageResponse } from 'next/og'
import { getCurrentClinic } from '@/lib/tenant'
import { clinicView } from '@/lib/clinicView'
import { platform } from '@/config/platform'

/**
 * ============================================================================
 *  SOCIAL SHARE IMAGE
 * ============================================================================
 *  Next.js turns this file into /opengraph-image, and automatically references
 *  it from every page's meta tags.
 *
 *  This is the picture that appears when someone shares the clinic link on
 *  WhatsApp, Facebook or LinkedIn. For a clinic that grows by word of mouth,
 *  that preview is often the first impression — a link with no image looks
 *  broken and gets fewer taps.
 *
 *  Generating it in code rather than designing a PNG means it can never go
 *  stale: change the clinic name in config/site.js and this updates with it.
 *
 *  Note the plain style objects instead of Tailwind classes. This runs through
 *  Satori, which renders JSX to an image and supports only a subset of flexbox
 *  CSS — no class names, no grid.
 * ============================================================================
 */

// 1200x630 is the size Facebook, WhatsApp, LinkedIn and X all standardised on.
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Share image'

export default async function Image() {
  /**
   * Generated per clinic, from the hostname.
   *
   * A shared WhatsApp link to aarogya.kokli.in must preview as Aarogya —
   * with their name and their practitioner — not as the platform. For a clinic
   * that grows by word of mouth, that preview is often the first impression.
   */
  const clinic = await getCurrentClinic()
  const site = clinic
    ? clinicView(clinic)
    : {
        name: platform.name,
        tagline: platform.tagline,
        doctor: { name: '', credentials: '' },
        address: { city: '' },
        contact: { phone: platform.supportPhone },
      }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: 'linear-gradient(135deg, #0f766e 0%, #0d9488 45%, #115e59 100%)',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* A soft light bloom in the corner, so the background is not flat. */}
        <div
          style={{
            position: 'absolute',
            top: -160,
            right: -120,
            width: 560,
            height: 560,
            borderRadius: 9999,
            background: 'radial-gradient(circle, rgba(251,191,36,0.35) 0%, rgba(251,191,36,0) 70%)',
          }}
        />

        {/* ------------------------------------------------------- top row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              background: 'rgba(255,255,255,0.16)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 38,
              fontWeight: 700,
              color: '#ffffff',
            }}
          >
            {/*
              Plain ASCII on purpose. Satori fetches a font for whatever glyphs it
              finds, and a decorative symbol like ✚ has no match in the standard
              set — the build fails with "Failed to download dynamic font".
              Stick to Latin characters and digits inside an ImageResponse.
            */}
            +
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: '#ffffff' }}>{site.name}</div>
            {/*
              One single text child, built with a template string.

              Satori refuses to lay out a <div> that has more than one child unless
              it is told how — and `{a} · {b}` is THREE children (expression, text,
              expression), not one string. Either add display:'flex' or collapse it
              into a template literal, as here.
            */}
            <div style={{ fontSize: 19, color: 'rgba(255,255,255,0.72)' }}>
              {[site.doctor.name, site.doctor.credentials].filter(Boolean).join(' · ') || platform.tagline}
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------ headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div
            style={{
              fontSize: 74,
              fontWeight: 800,
              color: '#ffffff',
              lineHeight: 1.06,
              letterSpacing: -2.5,
              maxWidth: 900,
            }}
          >
            {site.tagline}
          </div>
          <div style={{ fontSize: 27, color: 'rgba(255,255,255,0.85)', maxWidth: 820, lineHeight: 1.4 }}>
            {site.address.city ? `Expert physiotherapy in ${site.address.city} for back pain, sports injuries and post-surgery rehab.` : platform.description}
          </div>
        </div>

        {/* ----------------------------------------------------- bottom row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {['In-clinic & online', 'Book in 60 seconds', site.contact.phone].map((label) => (
            <div
              key={label}
              style={{
                padding: '12px 24px',
                borderRadius: 9999,
                background: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.24)',
                color: '#ffffff',
                fontSize: 21,
                fontWeight: 600,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    size
  )
}
