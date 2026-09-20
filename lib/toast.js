'use client'

/**
 * ============================================================================
 *  TOAST NOTIFICATIONS
 * ============================================================================
 *  A thin wrapper over react-hot-toast, so every notification in the app looks
 *  and behaves the same way.
 *
 *      import { toast } from '@/lib/toast'
 *
 *      toast.success('Appointment confirmed')
 *      toast.error('That time was just taken')
 *      toast.warning('Payment not completed')
 *      toast.info('Stopped sharing your screen')
 *
 *  WHY A LIBRARY RATHER THAN THE HAND-ROLLED REDUX VERSION THIS REPLACED
 *  --------------------------------------------------------------------
 *  The earlier version kept a list of toasts in Redux and rendered them itself.
 *  It worked, and it was a decent illustration of "any component can reach the
 *  store". But it also meant maintaining timers, stacking, dismissal, enter/exit
 *  animations, positioning and the aria-live announcements by hand — all of which
 *  react-hot-toast already does correctly in about 5KB.
 *
 *  It also removes a whole category of awkwardness. Toasts are pure UI ephemera:
 *  they are never read back, never persisted, and never affect a decision. Putting
 *  them in application state meant the video room had to move them out of the way
 *  of its own controls via a `toastPlacement` field in the store. With a library
 *  rendering into a portal at the top of the screen, that problem simply does not
 *  exist.
 *
 *  Redux still holds the booking wizard, which is where it genuinely earns its
 *  place — see store/index.js.
 *
 *  WHY A WRAPPER RATHER THAN IMPORTING react-hot-toast DIRECTLY
 *  -----------------------------------------------------------
 *  Two small reasons. The library has `success` and `error` but no `warning` or
 *  `info`, and this app needs both — "payment not completed, your slot is still
 *  held" is a warning, not an error. And durations belong in one place: an error
 *  someone must act on should stay longer than a "copied" confirmation.
 * ============================================================================
 */

import hotToast from 'react-hot-toast'

/**
 * How long each kind stays on screen.
 *
 * Errors last much longer than confirmations, because a confirmation only has to
 * be noticed while an error has to be read, understood and acted upon. A payment
 * failure that vanishes in three seconds is worse than no message at all.
 */
const DURATION = {
  success: 4000,
  info: 4000,
  warning: 8000,
  error: 8000,
}

export const toast = {
  success: (message, options = {}) =>
    hotToast.success(message, { duration: DURATION.success, ...options }),

  error: (message, options = {}) =>
    hotToast.error(message, { duration: DURATION.error, ...options }),

  /**
   * Something went sideways but nothing is broken and nothing is lost — an
   * abandoned checkout, a peer whose connection dropped.
   *
   * The icon is a plain string rather than a lucide component so this module stays
   * importable from anywhere without dragging an icon dependency along with it.
   */
  warning: (message, options = {}) =>
    hotToast(message, { icon: '⚠️', duration: DURATION.warning, ...options }),

  /** Neutral acknowledgement. No icon — an icon would imply a verdict. */
  info: (message, options = {}) =>
    hotToast(message, { duration: DURATION.info, ...options }),

  dismiss: hotToast.dismiss,
}

export default toast
