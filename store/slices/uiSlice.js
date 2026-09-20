/**
 * ============================================================================
 *  UI SLICE — small pieces of shared interface state
 * ============================================================================
 *
 *  WHAT USED TO BE HERE, AND WHY IT LEFT
 *  -------------------------------------
 *  This slice originally held a list of toast notifications, and the Toaster
 *  component rendered them. It was a reasonable demonstration of "any component can
 *  reach the store" — but it was the wrong home for that data, and it is worth
 *  understanding why, because it is a mistake people make constantly with Redux.
 *
 *  Toasts are pure interface ephemera. Nothing ever reads them back, nothing is
 *  decided from them, they are never persisted, and they vanish on their own after
 *  four seconds. Application state is the opposite of all of those things.
 *
 *  Keeping them here also had a concrete cost. Because the store owned the toasts,
 *  the store also had to own where they APPEARED — the video consultation room
 *  needed them moved out from under its End Call button, so there was a
 *  `toastPlacement` field being set on mount and reset on unmount. That is a lot of
 *  application state to describe a visual detail.
 *
 *  They now live in react-hot-toast (see lib/toast.js), which renders into a portal
 *  and handles timers, stacking, animation and screen-reader announcements. The
 *  placement problem disappeared with it.
 *
 *  THE LESSON
 *  ----------
 *  Redux is for state that is shared, read back, and meaningful to the application.
 *  The booking wizard in store/slices/bookingSlice.js is all three. A message that
 *  fades out by itself is none of them.
 * ============================================================================
 */

import { createSlice } from '@reduxjs/toolkit'

const uiSlice = createSlice({
  name: 'ui',

  initialState: {
    /**
     * Whether the mobile navigation drawer is open.
     *
     * Note that Navbar.js currently keeps this in its own useState, because it is
     * the only component that needs it — which is the correct default. This stays
     * here for the moment when something else needs to close the drawer (a
     * "book now" button inside it, say), so the pattern is already in place.
     */
    mobileNavOpen: false,
  },

  reducers: {
    toggleMobileNav(state) {
      state.mobileNavOpen = !state.mobileNavOpen
    },

    closeMobileNav(state) {
      state.mobileNavOpen = false
    },
  },
})

export const { toggleMobileNav, closeMobileNav } = uiSlice.actions

export default uiSlice.reducer

export const selectMobileNavOpen = (state) => state.ui.mobileNavOpen
