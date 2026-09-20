/**
 * ============================================================================
 *  BOOKING SLICE — the state of the appointment wizard
 * ============================================================================
 *
 *  A "slice" is one piece of the store: its initial state, the actions that
 *  can change it, and the reducer that applies them. Redux Toolkit's
 *  createSlice generates the action creators for you, so writing
 *
 *      reducers: { setMode(state, action) { state.mode = action.payload } }
 *
 *  automatically gives you an exported `setMode('online')` action. That is the
 *  main reason modern Redux is so much less code than the old style.
 *
 *  ABOUT MUTATING `state` DIRECTLY
 *  -------------------------------
 *  `state.mode = action.payload` looks like it breaks the first rule of Redux.
 *  It does not. Redux Toolkit runs reducers inside Immer, which hands you a
 *  draft proxy, records what you touched, and produces a brand-new immutable
 *  object from it. You get to write the obvious code and still get immutable
 *  updates. (This only works inside createSlice — anywhere else, the rule
 *  still applies.)
 * ============================================================================
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

/* -------------------------------------------------------------------------- */
/*  ASYNC THUNKS                                                              */
/* -------------------------------------------------------------------------- */
/*
 *  A thunk is how Redux handles anything asynchronous. createAsyncThunk wraps
 *  one promise and dispatches three actions around it automatically:
 *
 *      fetchSlots.pending    → the moment it starts   (show a spinner)
 *      fetchSlots.fulfilled  → it worked              (store the data)
 *      fetchSlots.rejected   → it threw               (show the error)
 *
 *  Handling those three in `extraReducers` below is what makes loading and
 *  error states impossible to forget.
 */

/**
 * Ask the server which slots are free on a given date.
 *
 * The availability calculation deliberately lives on the server (lib/slots.js),
 * not here. It has to: only the server can see which slots are already booked,
 * and only the server can be trusted. A patient could otherwise edit the
 * client state and "make" a slot appear available.
 */
export const fetchSlots = createAsyncThunk(
  'booking/fetchSlots',
  async ({ serviceId, date, mode }, { rejectWithValue }) => {
    const params = new URLSearchParams({ serviceId, date, mode })
    const response = await fetch(`/api/slots?${params}`)
    const data = await response.json()
    if (!response.ok) return rejectWithValue(data.error || 'Could not load available times')
    return data
  }
)

/**
 * Hold the chosen slot by creating an appointment with status
 * 'pending_payment'. The server returns a Razorpay order to pay against.
 */
export const createAppointment = createAsyncThunk(
  'booking/createAppointment',
  async (_, { getState, rejectWithValue }) => {
    const { booking } = getState()
    const response = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceId: booking.serviceId,
        date: booking.date,
        startTime: booking.startTime,
        mode: booking.mode,
        patientNotes: booking.patientNotes,
        painLevel: booking.painLevel === '' ? undefined : booking.painLevel,
        patientPackageId: booking.patientPackageId || undefined,
        visitAddress: booking.mode === 'home' ? booking.visitAddress : undefined,
      }),
    })
    const data = await response.json()
    if (!response.ok) return rejectWithValue(data.error || 'Could not hold that slot')
    return data
  }
)

/* -------------------------------------------------------------------------- */
/*  THE SLICE                                                                 */
/* -------------------------------------------------------------------------- */

const initialState = {
  // Which step of the wizard we are on, 1-indexed.
  step: 1,

  // ---- what the patient has chosen
  serviceId: null,
  service: null,          // the full service object, kept for the summary panel
  mode: 'clinic',         // 'clinic' | 'online'
  date: null,             // 'YYYY-MM-DD'
  startTime: null,        // 'HH:MM:SS'
  patientNotes: '',
  painLevel: '',

  // Where the physiotherapist should come, for mode 'home'. Only sent when the
  // mode actually is 'home'.
  visitAddress: '',

  /**
   * The prepaid session the patient has chosen to spend, if any.
   *
   * null means "pay for this visit". Only the ID lives here — the price, the
   * session count and whether the package is even valid are all the server's
   * business, checked under a row lock in lib/packages.js.
   */
  patientPackageId: null,

  // ---- slots for the currently selected date
  slots: [],
  slotsStatus: 'idle',    // idle | loading | succeeded | failed
  slotsError: null,

  // ---- the appointment being created
  createStatus: 'idle',
  createError: null,
  appointment: null,      // { id, code, amountPaise, ... }
  order: null,            // the Razorpay order to hand to Checkout
}

const bookingSlice = createSlice({
  name: 'booking',
  initialState,

  reducers: {
    /**
     * Picking a service can invalidate the chosen slot, because services have
     * different durations — a free 30-minute gap does not fit a 60-minute
     * appointment. So we clear the time whenever the service changes.
     */
    selectService(state, action) {
      const service = action.payload
      state.serviceId = service.id
      state.service = service
      state.startTime = null
      state.slots = []
      state.slotsStatus = 'idle'

      // A package may be tied to one treatment, so a chosen prepaid session can
      // become invalid the moment the service changes. Clearing it here means the
      // patient is re-offered whatever genuinely applies to the new choice, rather
      // than reaching the payment step with a package the server will reject.
      state.patientPackageId = null

      // If this service cannot be delivered the way they had selected, move
      // them to the mode that does work rather than leaving an impossible
      // combination selected.
      if (state.mode === 'online' && !service.available_online) state.mode = 'clinic'
      if (state.mode === 'clinic' && !service.available_clinic) state.mode = 'online'
    },

    setMode(state, action) {
      state.mode = action.payload
      // Availability differs by mode — Sundays are online-only, for instance —
      // so the slot list has to be thrown away and refetched.
      state.startTime = null
      state.slots = []
      state.slotsStatus = 'idle'
    },

    setDate(state, action) {
      state.date = action.payload
      state.startTime = null
      state.slots = []
      state.slotsStatus = 'idle'
    },

    setStartTime(state, action) {
      state.startTime = action.payload
    },

    setPatientNotes(state, action) {
      state.patientNotes = action.payload
    },

    setPainLevel(state, action) {
      state.painLevel = action.payload
    },

    setVisitAddress(state, action) {
      state.visitAddress = action.payload
    },

    /**
     * Choose to spend a prepaid session, or pass null to pay for this visit.
     *
     * A package is tied to a treatment, so changing the service can invalidate
     * the choice — setService below clears it for exactly that reason.
     */
    setPatientPackage(state, action) {
      state.patientPackageId = action.payload || null
    },

    goToStep(state, action) {
      state.step = action.payload
    },

    nextStep(state) {
      state.step = Math.min(state.step + 1, 4)
    },

    previousStep(state) {
      state.step = Math.max(state.step - 1, 1)
      state.createError = null
    },

    /** Clear a failed payment attempt so the patient can try again. */
    clearCreateError(state) {
      state.createError = null
      state.createStatus = 'idle'
    },

    /** Wipe everything — used after a successful booking. */
    resetBooking() {
      return initialState
    },
  },

  /**
   * `extraReducers` handles actions defined elsewhere — here, the three
   * automatic actions from each thunk above.
   */
  extraReducers: (builder) => {
    builder
      // ------------------------------------------------------------- slots
      .addCase(fetchSlots.pending, (state) => {
        state.slotsStatus = 'loading'
        state.slotsError = null
      })
      .addCase(fetchSlots.fulfilled, (state, action) => {
        state.slotsStatus = 'succeeded'
        state.slots = action.payload.slots || []
      })
      .addCase(fetchSlots.rejected, (state, action) => {
        state.slotsStatus = 'failed'
        state.slots = []
        state.slotsError = action.payload || 'Could not load available times'
      })

      // ------------------------------------------------------- appointment
      .addCase(createAppointment.pending, (state) => {
        state.createStatus = 'loading'
        state.createError = null
      })
      .addCase(createAppointment.fulfilled, (state, action) => {
        state.createStatus = 'succeeded'
        state.appointment = action.payload.appointment
        state.order = action.payload.order
      })
      .addCase(createAppointment.rejected, (state, action) => {
        state.createStatus = 'failed'
        state.createError = action.payload || 'Something went wrong'
        // A very common real-world case: somebody else booked this slot while
        // our patient was filling in their notes. Drop them back to the
        // calendar with the stale slot cleared, so the only thing they can do
        // is pick a time that is genuinely still free.
        if (String(action.payload || '').toLowerCase().includes('taken')) {
          state.startTime = null
          state.slotsStatus = 'idle'
          state.step = 2
        }
      })
  },
})

export const {
  selectService,
  setMode,
  setDate,
  setStartTime,
  setPatientNotes,
  setPainLevel,
  setVisitAddress,
  setPatientPackage,
  goToStep,
  nextStep,
  previousStep,
  clearCreateError,
  resetBooking,
} = bookingSlice.actions

export default bookingSlice.reducer

/* -------------------------------------------------------------------------- */
/*  SELECTORS                                                                 */
/* -------------------------------------------------------------------------- */
/*
 *  A selector is just a function that reads the store. Defining them beside
 *  the slice — rather than writing `useSelector(s => s.booking.service?.name)`
 *  inline in twelve components — means that if the shape of the state ever
 *  changes, there is exactly one place to fix.
 */

export const selectBooking = (state) => state.booking

/** Is the current step complete enough to move on? Drives the Next button. */
export const selectCanContinue = (state) => {
  const b = state.booking
  switch (b.step) {
    case 1: return Boolean(b.serviceId && b.mode)
    case 2: return Boolean(b.date && b.startTime)
    // Notes and the pain score are both optional — but a home visit cannot go
    // ahead without an address, and finding that out at the payment step would
    // mean going back two screens.
    case 3: return b.mode !== 'home' || Boolean(b.visitAddress.trim())
    default: return false
  }
}

/**
 * What this booking will cost.
 *
 * A home visit is a different price, not a surcharge — travel is a flat cost in
 * the therapist's time. Falls back to the clinic price when the clinic has marked
 * a treatment available at home and not priced it, which mirrors priceFor() on
 * the server so the figure the patient sees is the figure they are charged.
 */
export const selectAmountPaise = (state) => {
  const { service, mode } = state.booking
  if (!service) return 0
  if (mode === 'home' && service.home_price_paise != null) return service.home_price_paise
  return service.price_paise ?? 0
}
