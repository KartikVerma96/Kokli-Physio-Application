'use client'

/**
 * ============================================================================
 *  PLAN EDITOR
 * ============================================================================
 *  One collapsible card per plan. Collapsed it reads like a price list; open, it
 *  is a form.
 *
 *  Each toggle is labelled with what it actually gates, and the two that gate
 *  nothing yet say so. Writing "not built yet" on your own admin screen is not
 *  an admission of failure — it is the only thing stopping you from selling it.
 * ============================================================================
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, EyeOff, Eye, Users, Video, FileText, MessageCircle, BarChart3 } from 'lucide-react'
import { savePlan, setPlanActive } from './actions'
import { Card, Badge } from '@/components/ui/Card'
import { Input, Textarea } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { formatMoney } from '@/lib/utils'

/** The feature switches, with the truth about each one next to it. */
const FEATURES = [
  {
    name: 'videoEnabled',
    label: 'Online video consultations',
    icon: Video,
    gates: 'Gates the consultation room.',
  },
  {
    name: 'soapNotesEnabled',
    label: 'Clinical notes',
    icon: FileText,
    gates: 'Gates SOAP notes on an appointment.',
  },
  {
    name: 'whatsappEnabled',
    label: 'WhatsApp messaging',
    icon: MessageCircle,
    // No longer "not built yet". whatsappAllowance() in lib/whatsapp.js reads this
    // as the first gate, before anything else — the label said otherwise for a
    // while after the feature shipped, which is its own small trap.
    gates: 'The master switch. Off means no WhatsApp at all, whatever the quota says.',
  },
  {
    name: 'whatsappOwnNumber',
    label: 'May use their own WhatsApp number',
    icon: MessageCircle,
    gates:
      'Unlimited sending, because Meta bills them directly. Keep this OFF below the top plan — ' +
      'it is what makes the quota a reason to upgrade rather than something to route around.',
  },
  {
    name: 'analyticsEnabled',
    label: 'Revenue analytics',
    icon: BarChart3,
    gates: 'Not built yet — nothing reads this.',
    unbuilt: true,
  },
]

export default function PlanEditor({ plan, liveCount }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [errors, setErrors] = useState({})
  const [saving, startSaving] = useTransition()
  const [toggling, startToggling] = useTransition()

  function submit(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    startSaving(async () => {
      const result = await savePlan({}, formData)
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

  function toggleOnSale() {
    if (
      plan.isActive &&
      liveCount > 0 &&
      !window.confirm(
        `Hide ${plan.name} from the pricing page?\n\nThe ${liveCount} clinic(s) on it keep the plan and carry on being billed. It simply stops being offered to new clinics.`
      )
    ) {
      return
    }

    startToggling(async () => {
      const result = await setPlanActive(plan.id, !plan.isActive)
      if (result.ok) {
        toast.success(result.message, { duration: 7000 })
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Card className={`overflow-hidden p-0 ${!plan.isActive ? 'opacity-70' : ''}`}>
      {/* ------------------------------------------------------ the summary */}
      <div className="flex flex-wrap items-center gap-4 p-5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ChevronDown
            className={`size-4 shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{plan.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                {plan.code}
              </span>
              {!plan.isActive && <Badge tone="neutral">Hidden</Badge>}
            </span>
            <span className="mt-0.5 block truncate text-xs text-ink-500 dark:text-ink-400">
              {plan.maxPhysios} physio{plan.maxPhysios === 1 ? '' : 's'} · {plan.trialDays}-day trial
              · {liveCount} clinic{liveCount === 1 ? '' : 's'} on this plan
            </span>
          </span>
        </button>

        <p className="shrink-0 text-right">
          <span className="font-display text-xl font-bold tabular-nums">
            {formatMoney(plan.priceRupees * 100)}
          </span>
          <span className="block text-[11px] text-ink-500">per {plan.billingPeriod === 'yearly' ? 'year' : 'month'}</span>
        </p>

        <button
          type="button"
          onClick={toggleOnSale}
          disabled={toggling}
          title={plan.isActive ? 'Hide from the pricing page' : 'Put back on sale'}
          aria-label={plan.isActive ? `Hide ${plan.name} from the pricing page` : `Put ${plan.name} back on sale`}
          className="grid size-9 shrink-0 place-items-center rounded-xl text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 dark:hover:text-ink-100 disabled:opacity-40 dark:hover:bg-ink-800"
        >
          {plan.isActive ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </button>
      </div>

      {/* --------------------------------------------------------- the form */}
      {open && (
        <form onSubmit={submit} className="border-t border-ink-100 p-5 dark:border-ink-800">
          <input type="hidden" name="id" value={plan.id} />

          <div className="grid gap-5 sm:grid-cols-2">
            <Input label="Plan name" name="name" defaultValue={plan.name} error={errors.name} required />
            <Input
              label={`Price in rupees per ${plan.billingPeriod === 'yearly' ? 'year' : 'month'}`}
              name="priceRupees"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              defaultValue={plan.priceRupees}
              error={errors.priceRupees}
              hint={
                plan.razorpayPlanId
                  ? 'Changing this creates a fresh Razorpay plan for future subscribers'
                  : 'No Razorpay plan created yet — it is made on the first subscription'
              }
              required
            />
          </div>

          <div className="mt-5">
            <Input
              label="Tagline"
              name="tagline"
              defaultValue={plan.tagline}
              placeholder="For a solo physiotherapist finding their feet"
              hint="One line under the plan name on the pricing page"
            />
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-4">
            <Input
              label="Trial days"
              name="trialDays"
              type="number"
              min="0"
              max="365"
              defaultValue={plan.trialDays}
            />
            <Input
              label="Physiotherapists"
              name="maxPhysios"
              type="number"
              min="1"
              max="500"
              defaultValue={plan.maxPhysios}
              icon={<Users className="size-4" />}
            />
            <Input
              label="Locations"
              name="maxLocations"
              type="number"
              min="1"
              max="100"
              defaultValue={plan.maxLocations}
              hint="Not enforced yet"
            />
            <Input
              label="WhatsApp / month"
              name="whatsappQuota"
              type="number"
              min="0"
              max="100000"
              defaultValue={plan.whatsappQuota}
              icon={<MessageCircle className="size-4" />}
              /**
               * The number your WhatsApp margin lives on, so it is editable here
               * rather than in SQL.
               *
               * Meta charges roughly ₹0.11–0.35 per message in India depending on
               * category, so 500 costs somewhere near ₹60–170 against a ₹1,299 plan.
               * Sending stops dead at the limit — see gate 4 in lib/whatsapp.js —
               * which is what makes a clinic that needs more upgrade rather than
               * quietly costing you money.
               */
              hint="Hard stop. 0 = none"
            />
            <Input
              label="Sort order"
              name="sortOrder"
              type="number"
              min="0"
              max="999"
              defaultValue={plan.sortOrder}
              hint="Low numbers first"
            />
          </div>

          {/* ------------------------------------------------------ features */}
          <fieldset className="mt-6">
            <legend className="text-xs font-bold uppercase tracking-wider text-ink-500">
              What this plan includes
            </legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {FEATURES.map((feature) => (
                <label
                  key={feature.name}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 p-3 transition-colors hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800/60"
                >
                  <input
                    type="checkbox"
                    name={feature.name}
                    defaultChecked={plan[feature.name]}
                    className="mt-0.5 size-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      <feature.icon className="size-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                      {feature.label}
                    </span>
                    <span
                      className={`mt-0.5 block text-xs ${
                        feature.unbuilt ? 'text-amber-600 dark:text-amber-400' : 'text-ink-500 dark:text-ink-400'
                      }`}
                    >
                      {feature.gates}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-5">
            <Textarea
              label="Pricing page bullets"
              name="highlights"
              rows={5}
              defaultValue={plan.highlights.join('\n')}
              hint="One per line. These are shown to customers — they do not control anything."
            />
          </div>

          <label className="mt-5 flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={plan.isActive}
              className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            <span>
              <span className="font-semibold">Offer this plan to new clinics</span>
              <span className="block text-xs text-ink-500 dark:text-ink-400">
                Unticking hides it from the pricing page. Existing clinics are unaffected.
              </span>
            </span>
          </label>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button type="submit" loading={saving}>
              {saving ? 'Saving…' : 'Save plan'}
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
