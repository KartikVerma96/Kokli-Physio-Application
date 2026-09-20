import { Star, Info } from 'lucide-react'
import { getPendingReviews } from '@/lib/queries'
import { formatDateLong } from '@/lib/utils'
import { Card, EmptyState } from '@/components/ui/Card'
import ReviewsManager from './ReviewsManager'
import { requireCurrentClinic } from '@/lib/tenant'

/**
 * ============================================================================
 *  REVIEWS  →  /admin/reviews
 * ============================================================================
 *  Approve patient reviews before they appear publicly. Nothing is published
 *  automatically — is_published defaults to 0 in the database.
 *
 *  WHY THIS PAGE MATTERS MORE THAN IT LOOKS
 *  ----------------------------------------
 *  Published reviews become Review and AggregateRating structured data, which is
 *  what puts ⭐⭐⭐⭐⭐ next to the clinic in Google's results. That is one of the
 *  single most effective things for local click-through.
 *
 *  It also makes them tempting to invent, so the warning below is not decoration.
 *  Fabricated reviews violate Google's structured data policy and can cost the
 *  whole site its rich results — and for a healthcare provider, inventing patient
 *  outcomes is a professional problem, not just an SEO one.
 * ============================================================================
 */

export const dynamic = 'force-dynamic'

export default async function AdminReviewsPage() {
  const clinic = await requireCurrentClinic()
  const reviews = await getPendingReviews(clinic.id)

  const pending = reviews.filter((r) => !r.is_published)
  const published = reviews.filter((r) => r.is_published)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Reviews</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          {pending.length} awaiting approval · {published.length} published
        </p>
      </div>

      <Card className="flex items-start gap-3 p-5">
        <Info className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden="true" />
        <div className="text-sm leading-relaxed text-ink-600 dark:text-ink-400">
          <p className="font-bold text-ink-900 dark:text-ink-100">
            Only publish real reviews, with the patient’s permission
          </p>
          <p className="mt-1">
            Published reviews are sent to Google as structured data, which is what produces the star
            rating beside your search listing. Google requires them to be genuine and will remove
            rich results from a site that fabricates them.
          </p>
          <p className="mt-2">
            The stars only appear once at least three reviews are published — below that, a single
            five-star rating is neither convincing to a person nor permitted by Google’s guidelines.
          </p>
        </div>
      </Card>

      {reviews.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={<Star className="size-6" />}
            title="No reviews yet"
            description="Ask patients for a review at the end of a course of treatment — that is when they are most positive and most willing. Once they submit one, it appears here for approval."
          />
        </Card>
      ) : (
        <ReviewsManager reviews={reviews} />
      )}

      {/* Practical guidance rather than filler. Getting reviews is a process, and
          most clinics simply never ask. */}
      <Card className="p-5">
        <h2 className="font-bold">Getting reviews, in practice</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-600 dark:text-ink-400">
          {[
            'Ask at the end of the LAST session of a course, not the first — that is when the improvement is obvious to them.',
            'Ask in person and then follow up on WhatsApp with a link. An unprompted email almost never works.',
            'Ask them to mention the specific condition they came in with. “Fixed my sciatica” is worth far more to search than “great clinic”.',
            'Never offer a discount in exchange for a review. It is against Google’s policy and it is obvious to readers.',
            'Ask on your Google Business Profile too — those reviews carry more local ranking weight than reviews on your own site.',
          ].map((tip) => (
            <li key={tip} className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
              {tip}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
