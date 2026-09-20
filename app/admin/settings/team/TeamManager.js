'use client'

/**
 * ============================================================================
 *  TEAM MANAGER
 * ============================================================================
 *  The interactive half of /admin/settings/team.
 *
 *  Note the "Add" form is hidden when the plan's seats are full — but the seat
 *  check that actually matters is in the server action. Hiding a control is a
 *  courtesy to the person using the app, never a security boundary.
 * ============================================================================
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Mail, Lock, User, Award, Power, Smartphone } from 'lucide-react'
import { addPhysio, setPhysioActive } from './actions'
import { Card, Badge, EmptyState } from '@/components/ui/Card'
import { Input } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { initials } from '@/lib/utils'

export default function TeamManager({ physios, atLimit, limit }) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [errors, setErrors] = useState({})
  const [saving, startSaving] = useTransition()
  const [pendingToggle, startToggle] = useTransition()

  /**
   * Most forms in this app use `useActionState`, which keeps them working with
   * JavaScript switched off. This one calls the action directly instead, because
   * on success it has to close a panel that only exists once JavaScript has run —
   * and reacting to a result inside an effect just to call setState causes an
   * extra render pass every time. In an event handler it is one clear sequence.
   */
  function submit(event) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)

    startSaving(async () => {
      const result = await addPhysio({}, formData)

      if (result.ok) {
        toast.success(result.message)
        form.reset()
        setErrors({})
        setShowForm(false)
        router.refresh()
        return
      }

      setErrors(result.errors || {})
      // A seat-limit refusal is a warning, not an error — nothing went wrong,
      // they simply need a bigger plan.
      if (result.atLimit) toast.warning(result.error, { duration: 9000 })
      else toast.error(result.error)
    })
  }

  function toggle(physio) {
    const goingOff = physio.isActive
    if (
      goingOff &&
      !window.confirm(
        `Deactivate ${physio.name}?\n\nThey will no longer be able to sign in and will disappear from booking. Their ${physio.appointmentCount} appointment(s) and any clinical notes they wrote are kept.`
      )
    ) {
      return
    }

    startToggle(async () => {
      const result = await setPhysioActive(physio.id, !physio.isActive)
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-ink-100 p-5 dark:border-ink-800">
          <h2 className="font-bold">Physiotherapists</h2>
          {!showForm && !atLimit && (
            <Button size="sm" onClick={() => setShowForm(true)}>
              <UserPlus className="size-4" aria-hidden="true" />
              Add
            </Button>
          )}
        </div>

        {physios.length === 0 ? (
          <EmptyState
            icon={<UserPlus className="size-6" />}
            title="No physiotherapists yet"
            description="Add at least one so patients have somebody to book with."
          />
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {physios.map((physio) => (
              <li key={physio.id} className="flex items-center gap-4 p-4">
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-full text-xs font-bold ${
                    physio.isActive
                      ? 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                      : 'bg-ink-100 text-ink-400 dark:bg-ink-800'
                  }`}
                >
                  {initials(physio.name)}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{physio.name}</p>
                  <p className="truncate text-xs text-ink-500 dark:text-ink-400">
                    {physio.email} · {physio.appointmentCount} appointment
                    {physio.appointmentCount === 1 ? '' : 's'}
                  </p>
                </div>

                {physio.isActive ? (
                  <Badge tone="success" dot>Active</Badge>
                ) : (
                  <Badge tone="neutral">Inactive</Badge>
                )}

                <button
                  type="button"
                  onClick={() => toggle(physio)}
                  disabled={pendingToggle || (!physio.isActive && atLimit)}
                  title={
                    !physio.isActive && atLimit
                      ? `All ${limit} seats are in use`
                      : physio.isActive
                        ? 'Deactivate'
                        : 'Reactivate'
                  }
                  className="grid size-9 shrink-0 place-items-center rounded-xl text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 dark:hover:text-ink-100 disabled:opacity-40 dark:hover:bg-ink-800"
                  aria-label={physio.isActive ? `Deactivate ${physio.name}` : `Reactivate ${physio.name}`}
                >
                  <Power className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ------------------------------------------------------- add a physio */}
      {showForm && (
        <Card className="p-6">
          <h2 className="text-base font-bold">Add a physiotherapist</h2>
          <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
            They will be able to sign in, see the diary, run video consultations and write clinical
            notes. They will not see billing.
          </p>

          <form onSubmit={submit} className="mt-5 space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Input
                label="Full name"
                name="name"
                placeholder="Dr. Meera Iyer"
                error={errors.name}
                icon={<User className="size-4" />}
                required
              />
              <Input
                label="Qualifications"
                name="credentials"
                placeholder="BPT, MPT (Sports)"
                error={errors.credentials}
                icon={<Award className="size-4" />}
              />
              <Input
                label="Email address"
                name="email"
                type="email"
                inputMode="email"
                placeholder="meera@yourclinic.in"
                error={errors.email}
                icon={<Mail className="size-4" />}
                required
              />
              <Input
                label="Temporary password"
                name="password"
                type="password"
                placeholder="At least 8 characters"
                error={errors.password}
                icon={<Lock className="size-4" />}
                hint="Share it with them and ask them to change it"
                required
              />
              <Input
                label="Mobile number"
                name="phone"
                type="tel"
                inputMode="numeric"
                placeholder="98765 43210"
                error={errors.phone}
                icon={<Smartphone className="size-4" />}
                hint="Optional — lets them sign in with a WhatsApp code instead of the password"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" loading={saving}>
                {saving ? 'Adding…' : 'Add physiotherapist'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}
    </>
  )
}
