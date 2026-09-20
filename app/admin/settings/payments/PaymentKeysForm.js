'use client'

/**
 * ============================================================================
 *  PAYMENT KEYS FORM
 * ============================================================================
 *  Reuses `saveRazorpayKeys` from the onboarding wizard rather than having its
 *  own action. Payment credentials are written in exactly one place in this
 *  codebase, which is exactly as many places as they should be written.
 * ============================================================================
 */

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, Lock, Webhook } from 'lucide-react'
import { saveRazorpayKeys } from '@/app/admin/onboarding/actions'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { toast } from '@/lib/toast'

export default function PaymentKeysForm({ connected, currentKeyId }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(saveRazorpayKeys, {})

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message)
      // Re-run the Server Component so the "connected / test mode" panel above
      // reflects the new keys straight away.
      router.refresh()
    } else if (state?.error) {
      toast.error(state.error)
    }
  }, [state, router])

  const errors = state?.errors || {}

  return (
    <Card className="p-6">
      <h2 className="text-base font-bold">
        {connected ? 'Replace your keys' : 'Connect your Razorpay account'}
      </h2>

      <form action={formAction} className="mt-5 space-y-5">
        <Input
          label="Key ID"
          name="keyId"
          // Not pre-filled with the stored value even though it is not secret:
          // this form REPLACES the pair, and a pre-filled ID next to an empty
          // secret invites someone to submit a mismatched combination.
          placeholder={currentKeyId || 'rzp_test_xxxxxxxxxxxxxx'}
          error={errors.keyId}
          icon={<KeyRound className="size-4" />}
          autoComplete="off"
          required
          hint="Starts with rzp_test_ or rzp_live_"
        />

        <Input
          label="Key Secret"
          name="keySecret"
          type="password"
          placeholder="••••••••••••••••"
          error={errors.keySecret}
          icon={<Lock className="size-4" />}
          autoComplete="off"
          required
          hint="Encrypted before it is stored. It is never shown again, here or anywhere else."
        />

        <Input
          label="Webhook secret (optional)"
          name="webhookSecret"
          type="password"
          placeholder="••••••••••••••••"
          error={errors.webhookSecret}
          icon={<Webhook className="size-4" />}
          autoComplete="off"
          hint="Whatever you set when creating the webhook in Razorpay"
        />

        <Button type="submit" size="lg" loading={pending}>
          {pending ? 'Saving…' : connected ? 'Replace keys' : 'Connect Razorpay'}
        </Button>
      </form>
    </Card>
  )
}
