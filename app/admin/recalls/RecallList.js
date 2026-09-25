'use client'

/**
 * ============================================================================
 *  RECALL LIST — one group of patients to telephone
 * ============================================================================
 *  Deliberately built around the phone, not around email.
 *
 *  Indian physiotherapy patients answer a phone call and ignore an email. So the
 *  primary action on every row is a `tel:` link — tapped on a phone it dials, and
 *  on a desktop it opens whatever softphone the clinic uses. WhatsApp is offered
 *  second because for a lot of patients it is the only channel they actually read.
 *
 *  "Mark called" is not bureaucracy. Without it the list shows the same twelve
 *  names every morning and stops being read within a fortnight, which is how a
 *  feature that could pay for the subscription several times over ends up unused.
 * ============================================================================
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Layers, CalendarClock, UserX, Phone, MessageCircle, Check, Clock } from 'lucide-react'
import { markContacted } from './actions'
import { Card, Badge } from '@/components/ui/Card'
import { toast } from '@/lib/toast'
import { formatDateShort } from '@/lib/utils'

// Icon names cross the server/client boundary as strings — see the note in
// components/dashboard/DashboardNav.js.
const ICONS = { Layers, CalendarClock, UserX }

const TONES = {
  brand: 'text-brand-600 dark:text-brand-300',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-sky-600 dark:text-sky-400',
}

export default function RecallList({ title, why, icon, tone, rows }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState(null)
  const [pending, startPending] = useTransition()

  const Icon = ICONS[icon] || Phone

  function contacted(row) {
    setBusyId(row.patientId)
    startPending(async () => {
      const note = window.prompt(
        `Note about the call with ${row.name}? (optional)\n\nFor example: "will call back next week" or "moved to Delhi".`
      )
      // Cancel on the prompt means cancel the whole thing — recording a call that
      // did not happen is worse than recording nothing.
      if (note === null) {
        setBusyId(null)
        return
      }

      const result = await markContacted({ patientId: row.patientId, note })
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.error)
      }
      setBusyId(null)
    })
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-ink-100 p-5 dark:border-ink-800">
        <h2 className="flex items-center gap-2 font-bold">
          <Icon className={`size-4 ${TONES[tone] || ''}`} aria-hidden="true" />
          {title}
          <Badge tone="neutral">{rows.length}</Badge>
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-500 dark:text-ink-400">{why}</p>
      </div>

      <ul className="divide-y divide-ink-100 dark:divide-ink-800">
        {rows.map((row) => {
          const calledToday =
            row.lastRecallAt &&
            new Date(row.lastRecallAt).toDateString() === new Date().toDateString()

          return (
            <li
              key={`${row.patientId}-${row.headline}`}
              className={`flex flex-wrap items-center gap-x-4 gap-y-2 p-4 ${
                calledToday ? 'opacity-55' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                  <Link href={`/admin/patients/${row.patientId}`} className="hover:underline">
                    {row.name}
                  </Link>
                  {row.urgent && <Badge tone="warning">{row.headline}</Badge>}
                  {!row.urgent && (
                    <span className="text-xs font-normal text-ink-500">{row.headline}</span>
                  )}
                  {calledToday && (
                    <Badge tone="success" dot>
                      Called today
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-500 dark:text-ink-400">
                  {row.detail}
                  {row.lastRecallAt && !calledToday && (
                    <> · last called {formatDateShort(row.lastRecallAt)}</>
                  )}
                </p>
              </div>

              {/* ------------------------------------------------- the actions */}
              <div className="flex shrink-0 items-center gap-1">
                {row.phone ? (
                  <>
                    <a
                      href={`tel:${String(row.phone).replace(/\s/g, '')}`}
                      title={`Call ${row.phone}`}
                      aria-label={`Call ${row.name} on ${row.phone}`}
                      className="grid size-9 place-items-center rounded-xl text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:hover:text-brand-300 dark:hover:bg-brand-500/10"
                    >
                      <Phone className="size-4" />
                    </a>
                    <a
                      href={`https://wa.me/${String(row.phone).replace(/\D/g, '').replace(/^0+/, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="WhatsApp"
                      aria-label={`Message ${row.name} on WhatsApp`}
                      className="grid size-9 place-items-center rounded-xl text-ink-400 transition-colors hover:bg-ink-100 hover:text-emerald-600 dark:hover:bg-ink-800"
                    >
                      <MessageCircle className="size-4" />
                    </a>
                  </>
                ) : (
                  <span className="px-2 text-xs text-ink-400">no phone on file</span>
                )}

                <button
                  type="button"
                  onClick={() => contacted(row)}
                  disabled={pending && busyId === row.patientId}
                  title="Record that you have contacted them"
                  aria-label={`Mark ${row.name} as contacted`}
                  className="grid size-9 place-items-center rounded-xl text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:hover:text-brand-200 disabled:opacity-40 dark:hover:bg-brand-500/10"
                >
                  {pending && busyId === row.patientId ? (
                    <Clock className="size-4 animate-pulse" />
                  ) : (
                    <Check className="size-4" />
                  )}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
