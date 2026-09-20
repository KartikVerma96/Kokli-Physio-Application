'use client'

/**
 * ============================================================================
 *  PACKAGE PANEL — a patient's courses of treatment
 * ============================================================================
 *  Shows what they have bought, how much is left, and sells them another.
 *
 *  The progress bar is the point of the whole panel. "4 of 10 used" tells the
 *  physiotherapist where the patient is in their course, which is the single most
 *  useful thing to know at the start of a session — and it tells reception when to
 *  have the conversation about the next package, which is where the revenue is.
 * ============================================================================
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Layers, Plus, XCircle } from 'lucide-react'
import { sellPackage, closePatientPackage } from './actions'
import { Card, Badge, EmptyState } from '@/components/ui/Card'
import { Input, Select, Textarea } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { formatMoney, formatDateShort } from '@/lib/utils'

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card machine' },
  { value: 'bank_transfer', label: 'Bank transfer' },
]

export default function PackagePanel({ patientId, patientName, packages, offerings }) {
  const router = useRouter()
  const [selling, setSelling] = useState(false)
  const [errors, setErrors] = useState({})
  const [saving, startSaving] = useTransition()
  const [closing, startClosing] = useTransition()
  const [chosen, setChosen] = useState('')

  function submit(event) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))

    startSaving(async () => {
      const result = await sellPackage(values)
      if (result.ok) {
        toast.success(result.message, { duration: 8000 })
        setErrors({})
        setSelling(false)
        setChosen('')
        router.refresh()
        return
      }
      setErrors(result.errors || {})
      toast.error(result.error)
    })
  }

  function close(pkg, status) {
    const wording =
      status === 'refunded'
        ? `Mark ${pkg.name} as refunded?\n\nThis records the refund but does NOT move any money — you will need to return it yourself.`
        : `Cancel ${pkg.name}?\n\n${pkg.sessionsRemaining} unused session(s) will no longer be bookable. Sessions already used are kept.`
    if (!window.confirm(wording)) return

    startClosing(async () => {
      const result = await closePatientPackage(pkg.id, status)
      if (result.ok) {
        toast.success(result.message, { duration: 8000 })
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  const offering = offerings.find((o) => String(o.id) === String(chosen))

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-ink-100 p-5 dark:border-ink-800">
        <h2 className="flex items-center gap-2 font-bold">
          <Layers className="size-4 text-ink-400" aria-hidden="true" />
          Packages
        </h2>
        {!selling && offerings.length > 0 && (
          <Button size="sm" onClick={() => setSelling(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Sell
          </Button>
        )}
      </div>

      {packages.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-6" />}
          title="No packages"
          description={
            offerings.length === 0
              ? 'Create a package first, in Packages.'
              : `${patientName.split(' ')[0]} is paying visit by visit.`
          }
        />
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {packages.map((pkg) => (
            <li key={pkg.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                    {pkg.name}
                    {pkg.isUsable ? (
                      <Badge tone="success" dot>
                        {pkg.sessionsRemaining} left
                      </Badge>
                    ) : pkg.status === 'refunded' ? (
                      <Badge tone="neutral">Refunded</Badge>
                    ) : pkg.status === 'cancelled' ? (
                      <Badge tone="neutral">Cancelled</Badge>
                    ) : pkg.isExpired ? (
                      <Badge tone="warning">Expired</Badge>
                    ) : (
                      <Badge tone="neutral">Finished</Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                    {pkg.label} · {formatMoney(pkg.price_paise)} ·{' '}
                    {pkg.service_name || 'any treatment'} · bought{' '}
                    {formatDateShort(pkg.purchased_at)}
                    {pkg.expires_at && ` · expires ${formatDateShort(pkg.expires_at)}`}
                  </p>
                </div>

                {pkg.isUsable && (
                  <button
                    type="button"
                    onClick={() => close(pkg, 'cancelled')}
                    disabled={closing}
                    title="Cancel the remaining sessions"
                    aria-label={`Cancel ${pkg.name}`}
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-red-600 disabled:opacity-40 dark:hover:bg-ink-800"
                  >
                    <XCircle className="size-4" />
                  </button>
                )}
              </div>

              {/* Where they are in the course. */}
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                <div
                  className={`h-full rounded-full ${
                    pkg.isUsable ? 'bg-brand-500' : 'bg-ink-300 dark:bg-ink-600'
                  }`}
                  style={{
                    width: `${Math.min(100, (pkg.sessionsUsed / Math.max(pkg.sessionsTotal, 1)) * 100)}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ------------------------------------------------------- sell one */}
      {selling && (
        <form onSubmit={submit} className="space-y-5 border-t border-ink-100 p-5 dark:border-ink-800">
          <input type="hidden" name="patientId" value={patientId} />

          <Select
            label="Package"
            name="packageId"
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            error={errors.packageId}
            required
          >
            <option value="">Choose a package…</option>
            {offerings.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} — {o.sessionsCount} sessions, {formatMoney(o.pricePaise)}
              </option>
            ))}
          </Select>

          {offering && (
            <div className="rounded-2xl border border-ink-200 p-4 text-sm dark:border-ink-700">
              <p className="font-semibold">
                {offering.sessionsCount} sessions · {formatMoney(offering.pricePaise)}
              </p>
              <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                {formatMoney(Math.round(offering.pricePaise / offering.sessionsCount))} per session ·{' '}
                {offering.validityDays > 0
                  ? `valid ${offering.validityDays} days from today`
                  : 'no expiry'}
                {offering.serviceName ? ` · ${offering.serviceName} only` : ' · any treatment'}
              </p>
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <Select label="Paid by" name="method" error={errors.method} required defaultValue="cash">
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
            <Input
              label="Reference"
              name="reference"
              placeholder="Receipt no. or UPI ref"
              hint="Optional, but makes the day easier to reconcile"
            />
          </div>

          <Input
            label="Discount (₹)"
            name="discountRupees"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            defaultValue="0"
            hint="Recorded against the package's real price, so the books still add up"
          />

          <Textarea label="Note" name="notes" rows={2} placeholder="Paid by her son at reception." />

          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={saving}>
              {saving ? 'Recording…' : 'Record the sale'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSelling(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}
