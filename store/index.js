/**
 * ============================================================================
 *  THE REDUX STORE
 * ============================================================================
 *
 *  WHAT GOES IN REDUX, AND WHAT DOES NOT
 *  -------------------------------------
 *  This is the question that decides whether Redux helps you or fights you.
 *
 *  In a server-rendered Next.js app most "state" is not client state at all.
 *  The list of services, a patient's appointments, the admin diary — that all
 *  lives in MySQL and is fetched on the server, arriving as plain props. Copying
 *  it into Redux would mean two sources of truth and a synchronisation bug
 *  waiting to happen.
 *
 *  Redux earns its place here for state that is genuinely client-side and
 *  genuinely shared across components:
 *
 *    booking — the multi-step booking wizard. Service, mode, date and slot are
 *              chosen in four different components, a progress bar and a
 *              summary panel both read the whole selection, and the user can
 *              move backwards without losing anything. This is exactly the
 *              shape of problem Redux is good at; passing it all down through
 *              props would be genuinely painful.
 *
 *    ui      — a little shared chrome state (the mobile navigation drawer).
 *              Deliberately small. Toasts used to live here and were moved out to
 *              react-hot-toast; the note at the top of store/slices/uiSlice.js
 *              explains why that was the right call, and it is worth reading —
 *              knowing what does NOT belong in a store is most of the skill.
 *
 *  WHY makeStore() IS A FUNCTION
 *  -----------------------------
 *  On the server, one Node process handles every visitor. A single shared store
 *  would leak one patient's half-finished booking into another patient's page —
 *  a real privacy bug, not a theoretical one. Creating a fresh store per
 *  request makes that impossible. StoreProvider.js does the creating.
 * ============================================================================
 */

import { configureStore } from '@reduxjs/toolkit'
import bookingReducer from './slices/bookingSlice'
import uiReducer from './slices/uiSlice'

export const makeStore = () =>
  configureStore({
    reducer: {
      booking: bookingReducer,
      ui: uiReducer,
    },
    // Redux Toolkit already includes the thunk middleware plus development-only
    // checks that shout at you if you accidentally mutate state outside a
    // reducer or put something non-serialisable in the store. Both are genuinely
    // useful while learning, so we leave the defaults alone.
    devTools: process.env.NODE_ENV !== 'production',
  })
