import Link from 'next/link'
import { Users, Search, Mail, Phone } from 'lucide-react'
import { getPatients } from '@/lib/queries'
import { formatMoney, formatDateShort, ageFrom, initials } from '@/lib/utils'
import { Card, EmptyState, Badge } from '@/components/ui/Card'
import { requireCurrentClinic } from '@/lib/tenant'

/**
 * ============================================================================
 *  PATIENTS  →  /admin/patients
 * ============================================================================
 *  The clinic's patient list, with the numbers that matter clinically and
 *  commercially: how many sessions they have had, when they were last in, and
 *  their lifetime value.
 *
 *  "Last visit" is the most useful column here. A patient who came four times and
 *  then stopped two months ago is either better — or gave up. Either way, that is
 *  worth a phone call, and it is invisible unless something surfaces it.
 * ============================================================================
 */

export const dynamic = 'force-dynamic'

export default async function AdminPatientsPage({ searchParams }) {
  const clinic = await requireCurrentClinic()
  const params = await searchParams
  const search = typeof params?.q === 'string' ? params.q.trim() : ''

  const patients = await getPatients(clinic.id, { search })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold lg:text-3xl">Patients</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          {patients.length} {patients.length === 1 ? 'patient' : 'patients'}
          {search && ` matching “${search}”`}
        </p>
      </div>

      {/* A plain GET form, so the search term ends up in the URL and the result is
          shareable and bookmarkable. No JavaScript involved. */}
      <Card className="p-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="q" className="mb-1.5 block text-xs font-semibold text-ink-600 dark:text-ink-300">
              Search by name, email or phone
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-400"
                aria-hidden="true"
              />
              <input
                id="q"
                name="q"
                defaultValue={search}
                placeholder="Rohan, rohan@example.com, 98765…"
                className="h-11 w-full rounded-xl border border-ink-200 bg-white pl-11 pr-4 text-sm focus:border-brand-500 focus:outline-none dark:border-ink-700 dark:bg-ink-900"
              />
            </div>
          </div>
          <button
            type="submit"
            className="h-11 shrink-0 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-[var(--color-brand-fg,#fff)] transition-colors hover:bg-brand-700"
          >
            Search
          </button>
          {search && (
            <Link
              href="/admin/patients"
              className="h-11 shrink-0 rounded-xl px-4 text-sm font-semibold leading-[2.75rem] text-ink-500 transition-colors hover:bg-brand-50 dark:hover:bg-brand-500/10"
            >
              Clear
            </Link>
          )}
        </form>
      </Card>

      <Card className="overflow-hidden p-0">
        {patients.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" />}
            title={search ? 'Nobody matches that search' : 'No patients yet'}
            description={
              search
                ? 'Try a partial name, or search by phone number instead.'
                : 'Patients appear here as soon as they register on the website.'
            }
          />
        ) : (
          <>
          {/* PHONES: a card per patient — who, how to reach them, how often they
              come. The six-column table only fits from tablet width up. */}
          <ul className="divide-y divide-ink-100 md:hidden dark:divide-ink-800">
            {patients.map((patient) => {
              const age = ageFrom(patient.date_of_birth)
              return (
                <li key={patient.id} className="flex items-center gap-3 p-4">
                  <Link href={`/admin/patients/${patient.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    {patient.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={patient.image} alt="" className="size-10 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-500/20 dark:text-brand-200">
                        {initials(patient.name)}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{patient.name}</span>
                      <span className="block truncate text-xs text-ink-500">
                        {[age && `${age} yrs`, patient.city].filter(Boolean).join(' · ') || patient.phone || patient.email}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-500">
                        {patient.appointment_count} {Number(patient.appointment_count) === 1 ? 'visit' : 'visits'} ·{' '}
                        {patient.last_visit ? `last ${formatDateShort(patient.last_visit)}` : 'no visit yet'} ·{' '}
                        <span className="font-semibold text-ink-700 tabular-nums dark:text-ink-200">
                          {formatMoney(Number(patient.lifetime_paise) || 0)}
                        </span>
                      </span>
                    </span>
                  </Link>
                  {patient.phone && (
                    <a
                      href={`tel:${patient.phone.replace(/\s/g, '')}`}
                      className="grid size-10 shrink-0 place-items-center rounded-xl text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-500/10 dark:hover:text-brand-200"
                      aria-label={`Call ${patient.name}`}
                    >
                      <Phone className="size-4" />
                    </a>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50/60 text-left dark:border-ink-800 dark:bg-ink-800/40">
                <tr>
                  <Th>Patient</Th>
                  <Th>Contact</Th>
                  <Th className="text-center">Sessions</Th>
                  <Th>Last visit</Th>
                  <Th className="text-right">Lifetime value</Th>
                  <Th>Registered</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {patients.map((patient) => {
                  const age = ageFrom(patient.date_of_birth)

                  return (
                    <tr
                      key={patient.id}
                      className="transition-colors hover:bg-brand-50/60 dark:hover:bg-brand-500/5"
                    >
                      <Td>
                        <Link href={`/admin/patients/${patient.id}`} className="flex items-center gap-3 group">
                          {patient.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={patient.image} alt="" className="size-9 shrink-0 rounded-full object-cover" />
                          ) : (
                            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                              {initials(patient.name)}
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="block truncate font-semibold group-hover:text-brand-700 group-hover:underline dark:group-hover:text-brand-300">
                              {patient.name}
                            </span>
                            <span className="block text-xs text-ink-500">
                              {[age && `${age} yrs`, patient.city].filter(Boolean).join(' · ') || '—'}
                            </span>
                          </span>
                        </Link>
                      </Td>

                      <Td>
                        <a
                          href={`mailto:${patient.email}`}
                          className="flex items-center gap-1.5 text-xs hover:text-brand-700 dark:hover:text-brand-300"
                        >
                          <Mail className="size-3 shrink-0 text-ink-400" aria-hidden="true" />
                          <span className="truncate">{patient.email}</span>
                        </a>
                        {patient.phone && (
                          <a
                            href={`tel:${patient.phone.replace(/\s/g, '')}`}
                            className="mt-0.5 flex items-center gap-1.5 text-xs hover:text-brand-700 dark:hover:text-brand-300"
                          >
                            <Phone className="size-3 shrink-0 text-ink-400" aria-hidden="true" />
                            {patient.phone}
                          </a>
                        )}
                      </Td>

                      <Td className="text-center font-semibold tabular-nums">
                        {patient.appointment_count}
                      </Td>

                      <Td>
                        {patient.last_visit ? (
                          formatDateShort(patient.last_visit)
                        ) : (
                          <span className="text-ink-400">Never</span>
                        )}
                      </Td>

                      <Td className="text-right font-semibold tabular-nums">
                        {formatMoney(Number(patient.lifetime_paise) || 0)}
                      </Td>

                      <Td>
                        <span className="text-xs text-ink-500">
                          {formatDateShort(patient.created_at)}
                        </span>
                        {patient.google_id && (
                          <Badge tone="info" className="ml-1.5">
                            Google
                          </Badge>
                        )}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
    </div>
  )
}

function Th({ children, className = '' }) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-xs font-bold uppercase tracking-wider text-ink-500 ${className}`}
    >
      {children}
    </th>
  )
}

function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>
}
