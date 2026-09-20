'use client'

/**
 * ============================================================================
 *  CONNECT YOUR OWN WHATSAPP NUMBER
 * ============================================================================
 *  The same shape as connecting Razorpay: the clinic pastes credentials, we
 *  encrypt and store them, and from then on the messages are theirs.
 *
 *  The screen leads with WHY rather than with the form, because "paste a Phone
 *  number ID" means nothing to a physiotherapist. What means something is that
 *  patients see the clinic's name, replies reach reception, and the monthly limit
 *  disappears.
 * ============================================================================
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Link2, ShieldCheck, Unlink } from 'lucide-react'
import { connectOwnWhatsApp, disconnectOwnWhatsApp } from './actions'
import { Card, Badge } from '@/components/ui/Card'
import { Input } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import { toast } from '@/lib/toast'

export default function ConnectNumber({ connected, phoneNumberId, planQuota }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [errors, setErrors] = useState({})
  const [saving, startSaving] = useTransition()
  const [removing, startRemoving] = useTransition()

  function submit(event) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))

    startSaving(async () => {
      const result = await connectOwnWhatsApp(values)
      if (result.ok) {
        toast.success(result.message, { duration: 9000 })
        setErrors({})
        setOpen(false)
        router.refresh()
        return
      }
      setErrors(result.errors || {})
      toast.error(result.error)
    })
  }

  function disconnect() {
    if (
      !window.confirm(
        `Go back to sending from our number?\n\nYour messages will then be limited to ${planQuota} a month on your plan, instead of unlimited.`
      )
    ) {
      return
    }
    startRemoving(async () => {
      const result = await disconnectOwnWhatsApp()
      if (result.ok) {
        toast.success(result.message, { duration: 9000 })
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  /* ------------------------------------------------------------- connected */
  if (connected) {
    return (
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 font-bold">
              <ShieldCheck className="size-4 text-emerald-600" aria-hidden="true" />
              Sending from your own number
              <Badge tone="success" dot>No monthly limit</Badge>
            </h2>
            <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
              Patients see your clinic&rsquo;s name, and replies come to you. Meta bills you
              directly for the messages — usually well under a rupee each.
            </p>
            <p className="mt-2 font-mono text-xs text-ink-500">ID {phoneNumberId}</p>
          </div>

          <Button size="sm" variant="ghost" onClick={disconnect} loading={removing}>
            <Unlink className="size-4" aria-hidden="true" />
            Disconnect
          </Button>
        </div>
      </Card>
    )
  }

  /* --------------------------------------------------------- not connected */
  return (
    <Card className="p-6">
      <h2 className="flex items-center gap-2 font-bold">
        <Link2 className="size-4 text-ink-400" aria-hidden="true" />
        Use your own WhatsApp number
      </h2>

      <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
        Right now messages go from our number, and your plan includes{' '}
        <strong>{planQuota} a month</strong>. Connect your own WhatsApp Business number and three
        things change:
      </p>

      <ul className="mt-4 space-y-2 text-sm">
        {[
          ['Patients see your clinic', 'A message from a name they recognise gets read. One from an unknown business number gets ignored.'],
          ['Replies come to you', 'A patient answering “can I move to Thursday?” reaches your reception, not ours.'],
          ['No monthly limit', 'Meta bills you directly — typically under a rupee per conversation — so we stop rationing it.'],
        ].map(([title, why]) => (
          <li key={title} className="flex items-start gap-2.5">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
            <span>
              <span className="font-semibold">{title}</span>
              <span className="block text-xs text-ink-500 dark:text-ink-400">{why}</span>
            </span>
          </li>
        ))}
      </ul>

      {!open ? (
        <Button className="mt-5" size="sm" onClick={() => setOpen(true)}>
          Connect my number
        </Button>
      ) : (
        <form onSubmit={submit} className="mt-5 space-y-5">
          <div className="rounded-2xl border border-ink-200 p-4 text-xs leading-relaxed text-ink-600 dark:border-ink-700 dark:text-ink-400">
            <p className="font-bold text-ink-900 dark:text-ink-100">Where to find these</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>
                Go to <span className="font-mono">business.facebook.com</span> → create a Business
                account and verify it. This takes a few days, so start it first.
              </li>
              <li>
                <span className="font-mono">developers.facebook.com</span> → create an app → add
                WhatsApp.
              </li>
              <li>
                Add the phone number that will send. It must NOT already be signed in on the normal
                WhatsApp or WhatsApp Business app.
              </li>
              <li>
                Copy the <strong>Phone number ID</strong> — a long number, not the phone number
                itself — and generate a <strong>permanent</strong> access token via System User. The
                default token expires in 24 hours.
              </li>
            </ol>
            <p className="mt-2">
              We will create and submit the message templates for you once this is connected.
            </p>
          </div>

          <Input
            label="Phone number ID"
            name="phoneNumberId"
            inputMode="numeric"
            placeholder="109876543210987"
            error={errors.phoneNumberId}
            hint="The long numeric ID from Meta, not your phone number"
            required
          />
          <Input
            label="Permanent access token"
            name="token"
            type="password"
            placeholder="EAAG…"
            error={errors.token}
            hint="Stored encrypted. It is never shown again and never leaves this server."
            required
          />

          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={saving}>
              {saving ? 'Connecting…' : 'Connect'}
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
