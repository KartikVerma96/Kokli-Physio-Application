'use client'

/**
 * ============================================================================
 *  TOASTER — mounted once, in app/layout.js
 * ============================================================================
 *  Every `toast.*()` call anywhere in the app renders through here. The actual
 *  container lives in ToasterClient.js; this file exists only to load it in the
 *  browser and never on the server.
 *
 *  ---------------------------------------------------------------------------
 *  WHY ssr: false — A REAL HYDRATION BUG, AND THE GENERAL LESSON
 *  ---------------------------------------------------------------------------
 *  react-hot-toast renders its container as a <div> with an inline style computed
 *  from its props:
 *
 *      position: fixed; z-index: 9999; top: 16px; left: 16px; …
 *
 *  React compares the server's HTML against what the client renders, attribute by
 *  attribute. If those two ever disagree you get:
 *
 *      "A tree hydrated but some attributes of the server rendered HTML didn't
 *       match the client properties. This won't be patched up."
 *
 *  And they disagree very easily here. Changing a prop like `containerStyle` while
 *  a dev server is running can leave the server chunk and the client chunk built
 *  from different source — the server emits `top: 16px`, the client wants
 *  `top: 20`, and React complains. `suppressHydrationWarning` cannot help, because
 *  it only covers the element you put it on, not a third-party descendant.
 *
 *  The fix is to notice that server-rendering this component is POINTLESS. It is a
 *  portal for notifications that are always triggered by a click, a form
 *  submission, or a socket event — all of which happen after hydration. There is by
 *  definition never a toast to include in the initial HTML.
 *
 *  So `ssr: false` removes the entire class of problem, and shaves an empty div off
 *  every server response.
 *
 *  THE GENERAL LESSON: when a third-party component causes a hydration mismatch,
 *  first ask whether it needed to be server-rendered at all. Anything that only
 *  ever reacts to user interaction usually did not.
 * ============================================================================
 */

import dynamic from 'next/dynamic'

/**
 * `ssr: false` is only permitted inside a Client Component, which is why this file
 * carries the 'use client' directive above.
 *
 * No `loading` state is given on purpose — there is nothing to show. An empty
 * container that appears a moment later is exactly the right behaviour.
 */
const ToasterClient = dynamic(() => import('./ToasterClient'), { ssr: false })

export default function Toaster() {
  return <ToasterClient />
}
