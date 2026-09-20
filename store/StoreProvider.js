'use client'

/**
 * ============================================================================
 *  STORE PROVIDER
 * ============================================================================
 *
 *  Wraps the app so any client component can reach the Redux store. Mounted
 *  once, in app/layout.js.
 *
 *  WHY THE 'use client' LINE AT THE TOP?
 *  -------------------------------------
 *  In the App Router every component is a Server Component by default, and
 *  Server Components run on the server only — no state, no effects, no
 *  browser. Redux needs React context and subscriptions, both of which are
 *  browser-side things, so this file has to opt into being a Client Component.
 *
 *  Crucially, this does NOT make the whole app client-side. Server Components
 *  passed as `children` still render on the server; they simply arrive already
 *  rendered and slot into place inside this provider. So the homepage remains
 *  fully server-rendered HTML — good for speed and good for SEO — while the
 *  booking wizard inside it still gets its store.
 *
 *  WHY useState AND NOT JUST CALLING makeStore()?
 *  ----------------------------------------------
 *  React may render a component more than once. Calling makeStore() in the
 *  component body would build a brand-new store on every render, throwing away the
 *  patient's half-finished booking each time.
 *
 *  Passing the FUNCTION to useState — `useState(makeStore)`, not
 *  `useState(makeStore())` — makes it a lazy initialiser: React calls it once, on
 *  the first render, and keeps the result forever after. That single missing pair of
 *  parentheses is the whole trick, and getting it wrong is a classic React bug.
 *
 *  (Older guides use a useRef for this. It works, but the current React lint rules
 *  object to reading a ref during render, and useState says what we mean more
 *  directly: this is a value the component keeps.)
 * ============================================================================
 */

import { useState } from 'react'
import { Provider } from 'react-redux'
import { makeStore } from '@/store'

export default function StoreProvider({ children }) {
  // The setter is deliberately discarded — the store is created once and never
  // replaced.
  const [store] = useState(makeStore)

  return <Provider store={store}>{children}</Provider>
}
