'use client'

/**
 * ============================================================================
 *  THE TOAST CONTAINER
 * ============================================================================
 *  The real react-hot-toast <Toaster>. Loaded browser-only by Toaster.js — see
 *  the explanation there for why it is not server-rendered.
 *
 *  The styling deliberately matches the JuJu blog app, so both projects feel like
 *  they came from the same hand: a dark slate surface, a hairline border, 14px
 *  text, and the brand green / red for the success and error icons.
 *
 *  WHY THE SURFACE IS DARK IN BOTH LIGHT AND DARK MODE
 *  --------------------------------------------------
 *  A dark toast reads as an overlay — something floating above the page rather
 *  than part of it — which is exactly what a notification is. It is a common,
 *  deliberate choice, and it means the toast looks identical whichever theme the
 *  patient is using, so there is only one appearance to get right.
 * ============================================================================
 */

import { Toaster as HotToaster } from 'react-hot-toast'

export default function ToasterClient() {
  return (
    <HotToaster
      /**
       * Top-centre, matching JuJu.
       *
       * It is also the right answer for this app specifically: the video
       * consultation room puts its End Call button along the bottom edge with the
       * self-view preview in the bottom-right corner, and a notification covering
       * the hang-up button during a live consultation would be unacceptable.
       *
       * No containerStyle override, also matching JuJu. The toast floats over the
       * sticky header rather than below it, which is correct — a notification is
       * meant to sit above everything, it is opaque with its own shadow so it reads
       * as a layer, and it is gone in a few seconds.
       */
      position="top-center"
      toastOptions={{
        style: {
          background: '#1A1D21',
          color: '#E8E9E9',
          border: '1px solid #363A3D',
          fontSize: '14px',
          fontFamily: 'var(--font-sans)',
          // Caps the width so a long error message wraps into a tidy block instead
          // of stretching across a wide monitor.
          maxWidth: '32rem',
          padding: '12px 16px',
          borderRadius: '14px',
          // A soft lift, so it reads as floating above the page.
          boxShadow: '0 12px 32px -8px rgba(0,0,0,0.45)',
        },
        success: { iconTheme: { primary: '#24AE7C', secondary: '#1A1D21' } },
        error: { iconTheme: { primary: '#F24E43', secondary: '#1A1D21' } },
      }}
    />
  )
}
