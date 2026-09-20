'use client'

/**
 * Reviews awaiting approval, and those already live.
 *
 * Pending ones come first — they are the only ones needing a decision.
 */

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, EyeOff, Trash2 } from 'lucide-react'
import { setReviewPublished, deleteReview } from './actions'
import { toast } from '@/lib/toast'
import { formatDateLong, initials } from '@/lib/utils'
import { Card, Badge } from '@/components/ui/Card'
import { Stars } from '@/components/home/Testimonials'
import Button from '@/components/ui/Button'

export default function ReviewsManager({ reviews }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function run(action, args, confirmMessage) {
    if (confirmMessage && !window.confirm(confirmMessage)) return

    startTransition(async () => {
      const result = await action(...args)
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
      if (result.ok) router.refresh()
    })
  }

  // Unpublished first: those are the ones that need a decision.
  const sorted = [...reviews].sort((a, b) => Number(a.is_published) - Number(b.is_published))

  return (
    <div className="space-y-3">
      {sorted.map((review) => (
        <Card key={review.id} className="p-5">
          <div className="flex flex-wrap items-start gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
              {initials(review.patient_name)}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-bold">{review.patient_name}</p>
                <Stars rating={review.rating} className="size-3.5" />
                {review.is_published ? (
                  <Badge tone="success" dot>
                    Published
                  </Badge>
                ) : (
                  <Badge tone="warning">Awaiting approval</Badge>
                )}
              </div>

              <p className="mt-0.5 text-xs text-ink-500">
                {review.patient_email} · {formatDateLong(review.created_at)}
              </p>

              {review.comment && (
                <p className="mt-3 whitespace-pre-line rounded-xl bg-ink-50 p-3.5 text-sm leading-relaxed dark:bg-ink-800/60">
                  {review.comment}
                </p>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              {review.is_published ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(setReviewPublished, [review.id, false])}
                >
                  <EyeOff className="size-4" aria-hidden="true" />
                  Unpublish
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(
                      setReviewPublished,
                      [review.id, true],
                      'Publish this review on the website?\n\nOnly do this if it is genuine and the patient has agreed to it being public.'
                    )
                  }
                >
                  <Check className="size-4" aria-hidden="true" />
                  Publish
                </Button>
              )}

              <Button
                variant="dangerGhost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(deleteReview, [review.id], 'Delete this review permanently?')
                }
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
