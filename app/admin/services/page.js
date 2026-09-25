import { getAllServices } from '@/lib/queries'
import { countOf } from '@/lib/utils'
import { requireCurrentClinic } from '@/lib/tenant'
import { Card } from '@/components/ui/Card'
import { Info } from 'lucide-react'
import ServicesManager from './ServicesManager'

/**
 * ============================================================================
 *  SERVICES  →  /admin/services
 * ============================================================================
 *  Add, edit, price and hide treatments. Changes go live on the public website
 *  immediately.
 * ============================================================================
 */

export const dynamic = 'force-dynamic'

export default async function AdminServicesPage() {
  // Every query in lib/queries.js takes the clinic id first. Forgetting it here
  // did not return another clinic's treatments — `WHERE clinic_id = ?` with an
  // undefined parameter is rejected by mysql2 before it reaches the database —
  // it simply crashed the page. That is the right failure: a tenant-scoped query
  // that silently ran unscoped would be very much worse.
  const clinic = await requireCurrentClinic()
  const services = await getAllServices(clinic.id)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Services & pricing</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          {countOf(services.length, 'treatment')} · {services.filter((s) => s.is_active).length} visible on
          the website
        </p>
      </div>

      <Card className="flex items-start gap-3 p-5">
        <Info className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden="true" />
        <div className="text-sm leading-relaxed text-ink-600 dark:text-ink-400">
          <p className="font-bold text-ink-900 dark:text-ink-100">
            Anything you change here appears on the website straight away
          </p>
          <p className="mt-1">
            Each service gets its own page at <code className="rounded bg-ink-100 px-1 dark:bg-ink-800">/services/your-slug</code>,
            and is listed on the homepage, the services page, the footer and the sitemap. Those
            individual pages are what actually rank in Google — someone with a frozen shoulder
            searches for “frozen shoulder treatment”, not for a clinic.
          </p>
          <p className="mt-2">
            Prices are entered in rupees. Changing a price never affects an appointment already
            booked — the amount the patient paid is stored on the appointment itself.
          </p>
        </div>
      </Card>

      <ServicesManager services={services} />
    </div>
  )
}
