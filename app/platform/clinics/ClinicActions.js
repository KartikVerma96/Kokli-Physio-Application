'use client'

/**
 * ============================================================================
 *  PER-CLINIC ACTIONS — suspend, reinstate, extend, change plan
 * ============================================================================
 *  Everything here affects somebody else's live business, so the destructive
 *  ones ask first and say what will actually happen — including, importantly,
 *  what will NOT happen. "Suspend" sounds like deletion, and a clinic owner's
 *  first question will be whether their patient records are gone.
 *
 *  ============================================================================
 *  WHY THIS MENU IS `fixed` AND NOT `absolute`
 *  ============================================================================
 *  It used to be `absolute right-0`, which is the obvious way to hang a dropdown
 *  off a button — and it was visibly broken. The menu lives inside
 *
 *      <Card className="overflow-hidden p-0">   ← page.js
 *
 *  and `overflow: hidden` on ANY ancestor clips an absolutely-positioned
 *  descendant. So the bottom of the menu was sliced off at the card's edge: the
 *  last plan in the list appeared cut in half.
 *
 *  The card needs its `overflow-hidden` — without it the divided rows poke out
 *  past the rounded corners. So the menu has to escape the clipping instead, and
 *  `position: fixed` does exactly that: it is positioned against the VIEWPORT and
 *  is not clipped by an ancestor's overflow at all.
 *
 *  The cost is that fixed elements do not move with the page, so the coordinates
 *  are computed from the button's own rect and recomputed on scroll and resize.
 *  Three extra things fall out of doing it properly:
 *
 *    * it FLIPS ABOVE the button when there is more room up than down — the last
 *      row of a long list is exactly where a downward menu has nowhere to go
 *    * it never runs off the right edge on a narrow window
 *    * it scrolls internally rather than overflowing the screen
 * ============================================================================
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Pause, Play, CalendarPlus, ArrowUpDown } from 'lucide-react'
import { setClinicStatus, extendTrial, changePlan } from './actions'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

/** Matches w-64 below. Needed in JS because the menu is placed by hand. */
const MENU_WIDTH = 256

/** Keep this much clear of every viewport edge. */
const EDGE_GAP = 8

/** Below this much room, opening downward is not worth it — flip instead. */
const MIN_ROOM = 220

export default function ClinicActions({ clinicId, name, status, planCode, plans }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const buttonRef = useRef(null)

  /** The computed fixed-position style, or null before the first measurement. */
  const [placement, setPlacement] = useState(null)

  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return

    // Right-aligned to the button, then pulled back inside the window if that
    // would hang it off the edge on a narrow screen.
    const left = Math.max(
      EDGE_GAP,
      Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - EDGE_GAP)
    )

    const roomBelow = window.innerHeight - rect.bottom - EDGE_GAP
    const roomAbove = rect.top - EDGE_GAP

    // Downward unless there is genuinely more space the other way. A menu that
    // flips for the sake of a few pixels feels twitchy.
    const openUpwards = roomBelow < MIN_ROOM && roomAbove > roomBelow

    setPlacement({
      left,
      ...(openUpwards
        ? { bottom: window.innerHeight - rect.top + EDGE_GAP, maxHeight: roomAbove }
        : { top: rect.bottom + EDGE_GAP, maxHeight: roomBelow }),
    })
  }, [])

  // Before paint, so the menu never appears in the wrong place for one frame.
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return

    const onScroll = () => place()
    const onKey = (event) => {
      // Escape closes it. Expected of any menu, and the only way out for somebody
      // using a keyboard.
      if (event.key === 'Escape') setOpen(false)
    }

    // `true` for the capture phase, so scrolling INSIDE a container is caught too,
    // not only the window. The admin tables scroll in their own boxes.
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, place])

  const run = (fn, confirmMessage) => {
    if (confirmMessage && !window.confirm(confirmMessage)) return
    setOpen(false)
    start(async () => {
      const result = await fn()
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
      router.refresh()
    })
  }

  const isSuspended = status === 'suspended'

  return (
    <div className="inline-block text-left">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-expanded={open}
        aria-haspopup="menu"
        className="grid size-9 place-items-center rounded-xl border border-ink-200 text-ink-500 transition-colors hover:bg-ink-100 disabled:opacity-40 dark:border-ink-700 dark:hover:bg-ink-800"
        aria-label={`Actions for ${name}`}
      >
        <MoreHorizontal className="size-4" />
      </button>

      {open && placement && (
        <>
          {/* A full-screen click-catcher. Simpler and more reliable on touch
              devices than a document mousedown listener. */}
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            tabIndex={-1}
          />
          <div
            role="menu"
            /**
             * `fixed`, positioned by hand. See the long note at the top: an
             * `absolute` menu is clipped by the card's `overflow-hidden`.
             *
             * `overflow-y-auto` with the measured max-height is the backstop — on a
             * short window the menu scrolls inside itself instead of running off
             * the screen, so no option is ever unreachable.
             */
            className="card fixed z-50 w-64 animate-fade-up overflow-y-auto overscroll-contain p-1.5 text-left shadow-float"
            style={placement}
          >
            {isSuspended ? (
              <MenuButton
                icon={Play}
                onClick={() =>
                  run(() => setClinicStatus(clinicId, 'active'), `Reinstate ${name}?`)
                }
              >
                Reinstate clinic
              </MenuButton>
            ) : (
              <MenuButton
                icon={Pause}
                danger
                onClick={() =>
                  run(
                    () => setClinicStatus(clinicId, 'suspended'),
                    `Suspend ${name}?\n\nNobody — including the owner — can sign in, and the website stops taking new bookings. Patients who visit are asked to telephone instead.\n\nThe website itself stays up and NO data is deleted. Patients, appointments and clinical notes are all kept, and reinstating restores everything exactly as it was.`
                  )
                }
              >
                Suspend clinic
              </MenuButton>
            )}

            <MenuButton
              icon={CalendarPlus}
              onClick={() => run(() => extendTrial(clinicId, 14), `Give ${name} 14 more days?`)}
            >
              Extend trial by 14 days
            </MenuButton>

            <div className="mt-1 border-t border-ink-100 pt-1 dark:border-ink-800">
              <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400">
                Move to plan
              </p>
              {plans.map((plan) => (
                <MenuButton
                  key={plan.code}
                  icon={ArrowUpDown}
                  disabled={plan.code === planCode}
                  onClick={() =>
                    run(() => changePlan(clinicId, plan.code), `Move ${name} to ${plan.name}?`)
                  }
                >
                  {plan.name}
                  {plan.code === planCode && (
                    <span className="ml-auto text-[10px] text-ink-400">current</span>
                  )}
                </MenuButton>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MenuButton({ icon: Icon, children, onClick, danger, disabled }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors disabled:opacity-40',
        danger
          ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40'
          : 'text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800'
      )}
    >
      <Icon className="size-4 shrink-0 text-ink-400" aria-hidden="true" />
      {children}
    </button>
  )
}
