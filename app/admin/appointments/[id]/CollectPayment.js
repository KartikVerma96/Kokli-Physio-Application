'use client'

/**
 * ============================================================================
 *  COLLECT PAYMENT — the money side of an appointment, at the desk
 * ============================================================================
 *  Shown on an appointment that has been treated but not paid for.
 *
 *  This is the other half of what "pay at the clinic" needs. Reception books the
 *  patient, the physiotherapist treats them, and on the way out they hand over
 *  ₹800 — and until now there was nowhere to put that. The clinic's revenue
 *  figure showed only the online minority, which is a worse failure than showing
 *  nothing, because a wrong number gets believed.
 * ============================================================================
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { IndianRupee, Layers, Check } from 'lucide-react'
import { recordAppointmentPayment } from '@/app/admin/patients/[id]/actions'
import { Card, Badge } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { formatMoney } from '@/lib/utils'

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card machine' },
  { value: 'bank_transfer', label: 'Bank transfer' },
]

export default function CollectPayment({ appointment }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [errors, setErrors] = useState({})
  const [saving, startSaving] = useTransition()

  function submit(event) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))

    startSaving(async () => {
      const result = await recordAppointmentPayment(values)
      if (result.ok) {
        toast.success(result.message, { duration: 7000 })
        setErrors({})
        setOpen(false)
        router.refresh()
        return
      }
      setErrors(result.errors || {})
      toast.error(result.error)
    })
  }

  /* ------------------------------------------------- already accounted for */

  // Came out of a package: the money arrived when the package was sold, and there
  // is deliberately nothing to collect.
  if (appointment.patient_package_id) {
    return (
      <Card className="flex items-start gap-3 p-5 text-sm">
        <Layers className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
        <div>
          <p className="font-bold">Paid from a package</p>
          <p className="mt-0.5 text-ink-600 dark:text-ink-400">
            One session from{' '}
            {appointment.package_name ? (
              <span className="font-semibold">{appointment.package_name}</span>
            ) : (
              'their course of treatment'
            )}
            . Nothing to collect today.
          </p>
        </div>
      </Card>
    )
  }

  if (appointment.payment_status === 'paid') {
    return (
      <Card className="flex items-start gap-3 p-5 text-sm">
        <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
        <div>
          <p className="font-bold">
            Paid — {formatMoney(appointment.amount_paise)}
          </p>
          <p className="mt-0.5 text-ink-600 dark:text-ink-400">
            {appointment.payment_method
              ? `by ${String(appointment.payment_method).replace('_', ' ')}`
              : 'settled'}
            {appointment.collected_by_name && ` · taken by ${appointment.collected_by_name}`}
          </p>
        </div>
      </Card>
    )
  }

  if (appointment.payment_status === 'refunded') {
    return (
      <Card className="flex items-start gap-3 p-5 text-sm">
        <IndianRupee className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
        <div>
          <p className="font-bold">Refunded</p>
          <p className="mt-0.5 text-ink-600 dark:text-ink-400">
            Nothing outstanding on this appointment.
          </p>
        </div>
      </Card>
    )
  }

  /* -------------------------------------------------------- still to collect */
  return (
    <Card className="border-amber-300 p-5 dark:border-amber-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-bold">
            <IndianRupee className="size-4 text-amber-600" aria-hidden="true" />
            {formatMoney(appointment.amount_paise)} to collect
            <Badge tone="warning">Unpaid</Badge>
          </h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
            Record it when the patient pays, so the day&rsquo;s takings add up.
          </p>
        </div>
        {!open && (
          <Button size="sm" onClick={() => setOpen(true)}>
            Take payment
          </Button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="mt-5 space-y-5">
          <input type="hidden" name="appointmentId" value={appointment.id} />

          <div className="grid gap-5 sm:grid-cols-2">
            <Select label="Paid by" name="method" defaultValue="cash" error={errors.method} required>
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
              hint="Optional"
            />
          </div>

          <p className="text-xs text-ink-500 dark:text-ink-400">
            {formatMoney(appointment.amount_paise)} will be recorded against your name. The amount
            comes from the appointment, not this form — apply any discount before booking.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={saving}>
              {saving ? 'Recording…' : `Record ${formatMoney(appointment.amount_paise)}`}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}
