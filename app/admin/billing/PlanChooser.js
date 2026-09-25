'use client'

/**
 * ============================================================================
 *  PLAN CHOOSER — opens Razorpay's subscription checkout
 * ============================================================================
 *
 *  The flow, end to end:
 *
 *   1. Clinic picks a plan → POST /api/billing/subscribe
 *        The server creates the Razorpay subscription with the price read from
 *        the DATABASE, and returns its id. The browser never sends an amount.
 *
 *   2. Razorpay Checkout opens with `subscription_id`, and the clinic authorises
 *        a recurring mandate — UPI AutoPay or a card mandate. This is different
 *        from a one-off payment: they are approving future debits, not just this
 *        one.
 *
 *   3. On success Razorpay returns a signature → POST /api/billing/verify, which
 *        recomputes the HMAC with the platform secret before activating anything.
 *
 *  DEMO MODE skips step 2 entirely so the whole trial → paid journey can be
 *  walked through with no Razorpay account. The interlock is server-side in
 *  lib/platformBilling.js — it can never engage in production.
 * ============================================================================
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { Check, Loader2 } from 'lucide-react'
import Button from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { formatMoney, cn } from '@/lib/utils'

export default function PlanChooser({ plans, currentPlanCode, isActive }) {
  const router = useRouter()
  const [scriptReady, setScriptReady] = useState(false)
  const [busyCode, setBusyCode] = useState(null)

  async function choosePlan(planCode) {
    setBusyCode(planCode)

    try {
      /* --------------------------------------------- 1. create the subscription */
      const response = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode }),
      })
      const data = await response.json()

      if (!response.ok) {
        toast.error(data.error || 'Could not start the subscription.')
        setBusyCode(null)
        return
      }

      /* ------------------------------------------------------- demo shortcut */
      if (data.demoMode) {
        await confirmSubscription({
          razorpay_subscription_id: data.subscriptionId,
          razorpay_payment_id: data.demoPaymentId,
          razorpay_signature: 'demo',
        })
        return
      }

      if (!scriptReady || typeof window.Razorpay === 'undefined') {
        toast.error('The payment window could not load. Check your connection and try again.')
        setBusyCode(null)
        return
      }

      /* --------------------------------------------- 2. the mandate checkout */
      const checkout = new window.Razorpay({
        key: data.razorpayKeyId,
        // `subscription_id`, NOT `order_id`. That single difference is what makes
        // Razorpay collect a recurring mandate instead of a one-off payment.
        subscription_id: data.subscriptionId,
        name: data.platformName,
        description: `${data.planName} — monthly subscription`,
        prefill: data.prefill,
        theme: { color: '#0d9488' },

        handler: (result) => confirmSubscription(result),

        modal: {
          ondismiss: () => {
            setBusyCode(null)
            toast.warning('Subscription not completed. Nothing has been charged.')
          },
        },
      })

      checkout.on('payment.failed', (result) => {
        toast.error(
          result?.error?.description || 'That payment did not go through. Try a different method.'
        )
        setBusyCode(null)
      })

      checkout.open()
    } catch {
      toast.error('Something went wrong. Please try again.')
      setBusyCode(null)
    }
  }

  /* --------------------------------------------------- 3. verify and activate */
  async function confirmSubscription(payload) {
    try {
      const response = await fetch('/api/billing/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json()

      if (!response.ok) {
        toast.error(result.error || 'We could not confirm that subscription.')
        setBusyCode(null)
        return
      }

      toast.success(
        result.alreadyActive
          ? 'Your subscription is already active.'
          : `You are now on ${result.planName}. Thank you.`
      )
      setBusyCode(null)
      // Re-render the server component so the status card, the plan highlight
      // and the invoice list all update from the database.
      router.refresh()
    } catch {
      // The mandate may well have been authorised — the webhook will activate it
      // server-side even if this request failed. So the message must not claim
      // the payment failed, because it probably did not.
      toast.warning(
        'Your payment went through but we could not confirm it here. Refresh in a moment, or contact support.'
      )
      setBusyCode(null)
    }
  }

  return (
    <>
      {/* lazyOnload keeps Razorpay's script off the critical path — it is only
          needed if someone actually picks a plan. */}
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="lazyOnload"
        onLoad={() => setScriptReady(true)}
      />

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = plan.code === currentPlanCode && isActive
          const busy = busyCode === plan.code

          return (
            <div
              key={plan.code}
              className={cn(
                'card flex flex-col p-6',
                isCurrent && 'border-brand-400 shadow-lift'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-bold">{plan.name}</h3>
                {isCurrent && (
                  <span className="rounded-full bg-brand-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-brand-fg,#fff)]">
                    Current
                  </span>
                )}
              </div>

              <p className="mt-1 min-h-10 text-xs text-ink-500 dark:text-ink-400">{plan.tagline}</p>

              <p className="mt-4 flex items-baseline gap-1">
                <span className="font-display text-3xl font-bold">
                  {formatMoney(plan.pricePaise)}
                </span>
                <span className="text-xs text-ink-500">/month</span>
              </p>

              <ul className="mt-5 flex-1 space-y-2">
                {plan.highlights.slice(0, 5).map((line) => (
                  <li key={line} className="flex items-start gap-2 text-xs">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden="true" />
                    <span className="text-ink-700 dark:text-ink-300">{line}</span>
                  </li>
                ))}
              </ul>

              <Button
                onClick={() => choosePlan(plan.code)}
                variant={isCurrent ? 'secondary' : 'primary'}
                fullWidth
                className="mt-6"
                disabled={isCurrent || Boolean(busyCode)}
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Opening…
                  </>
                ) : isCurrent ? (
                  'Your current plan'
                ) : (
                  `Switch to ${plan.name}`
                )}
              </Button>
            </div>
          )
        })}
      </div>
    </>
  )
}
