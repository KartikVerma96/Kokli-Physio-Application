'use client'

/**
 * ============================================================================
 *  PACKAGE MANAGER
 * ============================================================================
 *  The interactive half of /admin/packages.
 *
 *  The one piece of real thinking here is the live "per session / saving" figure
 *  under the price box. A clinic owner typing "6000" for ten sessions cannot tell
 *  at a glance whether that is a sensible discount on their ₹800 visit — and a
 *  package priced above the visit-by-visit total is worse than no package at all.
 *  So the arithmetic is shown as they type, before it is saved.
 * ============================================================================
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Layers, Eye, EyeOff, Pencil } from 'lucide-react'
import { savePackage, togglePackage } from './actions'
import { Card, Badge, EmptyState } from '@/components/ui/Card'
import { Input, Select, Textarea } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { formatMoney } from '@/lib/utils'

const BLANK = {
  id: null,
  name: '',
  description: '',
  serviceId: '',
  sessionsCount: 10,
  pricePaise: 0,
  validityDays: 90,
  isActive: true,
}

export default function PackageManager({ packages, services }) {
  const router = useRouter()
  const [editing, setEditing] = useState(null)
  const [errors, setErrors] = useState({})
  const [submitting, startSaving] = useTransition()
  const [toggling, startToggling] = useTransition()

  // Mirrored in state purely to drive the live saving calculation below.
  const [sessions, setSessions] = useState(BLANK.sessionsCount)
  const [rupees, setRupees] = useState(0)
  const [serviceId, setServiceId] = useState('')

  function open(pkg) {
    const next = pkg || BLANK
    setEditing(next)
    setErrors({})
    setSessions(next.sessionsCount)
    setRupees(Math.round((next.pricePaise || 0) / 100))
    setServiceId(next.serviceId ? String(next.serviceId) : '')
  }

  function submit(event) {
    event.preventDefault()
    // Server actions here take a plain object rather than a FormData — see the
    // note above savePackage in ./actions.js.
    const values = Object.fromEntries(new FormData(event.currentTarget))

    startSaving(async () => {
      const result = await savePackage(values)
      if (result.ok) {
        toast.success(result.message, { duration: 6000 })
        setErrors({})
        setEditing(null)
        router.refresh()
        return
      }
      setErrors(result.errors || {})
      toast.error(result.error)
    })
  }

  function toggle(pkg) {
    startToggling(async () => {
      const result = await togglePackage(pkg.id, !pkg.isActive)
      if (result.ok) {
        toast.success(result.message, { duration: 7000 })
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  /* -------------------------------------------- the live saving calculation */
  const chosenService = services.find((s) => String(s.id) === String(serviceId))
  const perSession = sessions > 0 ? Math.round((rupees * 100) / sessions) : 0
  const visitTotal = chosenService ? chosenService.pricePaise * sessions : null
  const saving = visitTotal !== null ? visitTotal - rupees * 100 : null

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-ink-100 p-5 dark:border-ink-800">
          <h2 className="font-bold">Your packages</h2>
          {!editing && (
            <Button size="sm" onClick={() => open(null)}>
              <Plus className="size-4" aria-hidden="true" />
              New package
            </Button>
          )}
        </div>

        {packages.length === 0 ? (
          <EmptyState
            icon={<Layers className="size-6" />}
            title="No packages yet"
            description="Sell a course of treatment instead of one visit at a time."
          />
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {packages.map((pkg) => (
              <li key={pkg.id} className="flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-bold">
                    {pkg.name}
                    {!pkg.isActive && <Badge tone="neutral">Not offered</Badge>}
                    {pkg.saving && (
                      <Badge tone="success">Saves {formatMoney(pkg.saving.saving)}</Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                    {pkg.sessionsCount} sessions ·{' '}
                    {pkg.serviceName || 'any treatment'} ·{' '}
                    {pkg.validityDays > 0 ? `valid ${pkg.validityDays} days` : 'no expiry'} ·{' '}
                    sold {pkg.timesSold} time{pkg.timesSold === 1 ? '' : 's'}
                  </p>
                </div>

                <p className="shrink-0 text-right">
                  <span className="font-display text-lg font-bold tabular-nums">
                    {formatMoney(pkg.pricePaise)}
                  </span>
                  <span className="block text-[11px] text-ink-500">
                    {formatMoney(Math.round(pkg.pricePaise / pkg.sessionsCount))}/session
                  </span>
                </p>

                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => open(pkg)}
                    aria-label={`Edit ${pkg.name}`}
                    className="grid size-9 place-items-center rounded-xl text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:hover:text-brand-200 dark:hover:bg-brand-500/10"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(pkg)}
                    disabled={toggling}
                    title={pkg.isActive ? 'Stop offering this' : 'Offer it again'}
                    aria-label={pkg.isActive ? `Stop offering ${pkg.name}` : `Offer ${pkg.name} again`}
                    className="grid size-9 place-items-center rounded-xl text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:hover:text-brand-200 disabled:opacity-40 dark:hover:bg-brand-500/10"
                  >
                    {pkg.isActive ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ------------------------------------------------------------- form */}
      {editing && (
        <Card className="p-6">
          <h2 className="text-base font-bold">
            {editing.id ? `Edit ${editing.name}` : 'New package'}
          </h2>

          <form onSubmit={submit} className="mt-5 space-y-5">
            {editing.id && <input type="hidden" name="packageId" value={editing.id} />}

            <div className="grid gap-5 sm:grid-cols-2">
              <Input
                label="Package name"
                name="name"
                defaultValue={editing.name}
                placeholder="Shoulder Rehab — 10 sessions"
                error={errors.name}
                required
              />
              <Select
                label="Which treatment"
                name="serviceId"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                error={errors.serviceId}
                hint="Restricts what the sessions can be spent on"
              >
                <option value="">Any treatment</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {formatMoney(s.pricePaise)} per visit
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <Input
                label="Number of sessions"
                name="sessionsCount"
                type="number"
                min="2"
                max="200"
                value={sessions}
                onChange={(e) => setSessions(Number(e.target.value) || 0)}
                error={errors.sessionsCount}
                required
              />
              <Input
                label="Total price (₹)"
                name="priceRupees"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={rupees}
                onChange={(e) => setRupees(Number(e.target.value) || 0)}
                error={errors.priceRupees}
                required
              />
              <Input
                label="Valid for (days)"
                name="validityDays"
                type="number"
                min="0"
                max="730"
                defaultValue={editing.validityDays}
                error={errors.validityDays}
                hint="0 = never expires"
              />
            </div>

            {/* ------------------------------------------ the arithmetic */}
            {/* Shown before saving, because a package priced above the
                visit-by-visit total is worse than having no package. */}
            {sessions > 0 && rupees > 0 && (
              <div className="rounded-2xl border border-ink-200 p-4 text-sm dark:border-ink-700">
                <p className="font-semibold">
                  {formatMoney(perSession)} per session
                </p>
                {saving !== null && (
                  <p
                    className={`mt-1 ${
                      saving > 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {saving > 0 ? (
                      <>
                        The patient saves {formatMoney(saving)} against {formatMoney(visitTotal)}{' '}
                        paid visit by visit — and you are paid up front.
                      </>
                    ) : saving === 0 ? (
                      <>
                        The same as paying visit by visit. Consider pricing it a little lower —
                        there is no reason for a patient to commit otherwise.
                      </>
                    ) : (
                      <>
                        This costs {formatMoney(-saving)} MORE than paying visit by visit. Nobody
                        will buy it.
                      </>
                    )}
                  </p>
                )}
                {!chosenService && (
                  <p className="mt-1 text-xs text-ink-500">
                    Pick a treatment above to see the saving against paying per visit.
                  </p>
                )}
              </div>
            )}

            <Textarea
              label="Description"
              name="description"
              rows={2}
              defaultValue={editing.description}
              placeholder="A full course of rehabilitation for rotator cuff and frozen shoulder."
              error={errors.description}
            />

            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={editing.isActive}
                className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="font-semibold">Offer this package</span>
            </label>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" loading={submitting}>
                {submitting ? 'Saving…' : editing.id ? 'Save changes' : 'Add package'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}
    </>
  )
}
