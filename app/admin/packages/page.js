import { Layers, Info, ShoppingBag, IndianRupee } from 'lucide-react'
import { requireCurrentClinic } from '@/lib/tenant'
import { clinicPackages, packageSaving } from '@/lib/packages'
import { getAllServices } from '@/lib/queries'
import { formatMoney } from '@/lib/utils'
import { Card, Stat } from '@/components/ui/Card'
import PackageManager from './PackageManager'

/**
 * ============================================================================
 *  PACKAGES  →  /admin/packages
 * ============================================================================
 *  The courses of treatment the clinic sells.
 *
 *  WHY A PHYSIOTHERAPY CLINIC NEEDS THIS AND A GP SURGERY DOES NOT
 *  ---------------------------------------------------------------
 *  Physiotherapy is a course, not a visit. Nobody recovers from a frozen shoulder
 *  in one appointment — it is eight to twelve sessions over six weeks, and the
 *  treatment only works if they are close together.
 *
 *  So the clinic sells the course: ten sessions for the price of eight. That is
 *  not a discount gimmick, it aligns the money with the medicine. A patient who
 *  has already paid comes in for session seven on a wet Tuesday when they are
 *  feeling better — which is exactly the session that stops them relapsing. A
 *  patient paying per visit skips it.
 *
 *  Commercially it is the difference between billing ₹800 and billing ₹6,000 for
 *  the same patient, and it is why this page exists.
 * ============================================================================
 */

export const metadata = { title: 'Packages', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function PackagesPage() {
  const clinic = await requireCurrentClinic()

  const [packages, services] = await Promise.all([
    clinicPackages(clinic.id),
    getAllServices(clinic.id),
  ])

  const active = packages.filter((p) => p.is_active)
  const sold = packages.reduce((total, p) => total + Number(p.times_sold), 0)

  // Average revenue per package sold, which is the number that shows what this
  // feature is worth against a single ₹800 visit.
  const averageValue =
    packages.length > 0
      ? Math.round(
          packages.reduce((sum, p) => sum + Number(p.price_paise) * Number(p.times_sold), 0) /
            Math.max(sold, 1)
        )
      : 0

  const serviceOptions = services
    .filter((s) => s.is_active)
    .map((s) => ({ id: s.id, name: s.name, pricePaise: Number(s.price_paise) }))

  // Worked out on the server so the client component stays a form and nothing
  // more. Each package gets the saving against paying visit-by-visit.
  const withSaving = packages.map((pkg) => {
    const service = serviceOptions.find((s) => Number(s.id) === Number(pkg.service_id))
    return {
      id: pkg.id,
      name: pkg.name,
      description: pkg.description || '',
      serviceId: pkg.service_id,
      serviceName: pkg.service_name,
      sessionsCount: Number(pkg.sessions_count),
      pricePaise: Number(pkg.price_paise),
      validityDays: Number(pkg.validity_days),
      isActive: Boolean(pkg.is_active),
      timesSold: Number(pkg.times_sold),
      saving: service ? packageSaving(pkg, service.pricePaise) : null,
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Packages</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Courses of treatment, sold up front.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <Stat
          label="On sale"
          value={active.length}
          hint={`${packages.length} in total`}
          icon={<Layers className="size-5" />}
          tone="brand"
        />
        <Stat
          label="Sold"
          value={sold}
          hint="all time"
          icon={<ShoppingBag className="size-5" />}
          tone="success"
        />
        <Stat
          label="Average package"
          value={sold > 0 ? formatMoney(averageValue) : '—'}
          hint="against a single visit"
          icon={<IndianRupee className="size-5" />}
          tone="info"
        />
      </div>

      {packages.length === 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sm dark:border-sky-800 dark:bg-sky-950/30">
          <Info className="mt-0.5 size-4 shrink-0 text-sky-600" aria-hidden="true" />
          <div className="text-sky-900 dark:text-sky-100">
            <p className="font-bold">A good first package</p>
            <p className="mt-1 text-sky-800 dark:text-sky-200">
              Take your most common treatment and offer ten sessions for the price of eight, valid
              for ninety days. It is the standard shape because it works: the patient saves a
              fifth, you are paid in advance, and they finish the course — which is the part that
              actually gets them better.
            </p>
          </div>
        </div>
      )}

      <PackageManager packages={withSaving} services={serviceOptions} />

      <Card className="flex items-start gap-3 p-5 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
        <p className="text-ink-600 dark:text-ink-400">
          Editing a package changes what you offer from now on. Patients part-way through a course
          keep exactly the sessions, price and expiry they bought — their purchase is a receipt, and
          a receipt cannot change afterwards. To raise a price, edit it here and existing patients
          are unaffected.
        </p>
      </Card>
    </div>
  )
}
