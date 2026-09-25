'use client'

/**
 * ============================================================================
 *  SERVICES MANAGER
 * ============================================================================
 *  A list of services, with an inline editor that expands in place. No separate
 *  edit page and no modal — the person editing can see the other services while
 *  they work, which matters when you are pricing one relative to another.
 * ============================================================================
 */

import { useActionState, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Eye, EyeOff, ExternalLink, X, MapPin, Video } from 'lucide-react'
import { saveService, toggleService } from './actions'
import { toast } from '@/lib/toast'
import { formatMoney, slugify, toRupees, cn } from '@/lib/utils'
import { Card, Badge } from '@/components/ui/Card'
import { Input, Textarea, Select, Checkbox } from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import Icon, { ICON_NAMES } from '@/components/ui/Icon'

export default function ServicesManager({ services }) {
  const router = useRouter()

  // null = nothing open, 'new' = the create form, or a service id.
  const [editing, setEditing] = useState(null)
  const [pending, startTransition] = useTransition()

  function toggle(service) {
    const nextActive = !service.is_active
    if (
      !nextActive &&
      !window.confirm(
        `Hide “${service.name}” from the website?\n\nIt stops being bookable, and its page returns a 404. Appointments already booked are unaffected.`
      )
    ) {
      return
    }

    startTransition(async () => {
      const result = await toggleService(service.id, nextActive)
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
      if (result.ok) router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing(editing === 'new' ? null : 'new')}>
          <Plus className="size-4" aria-hidden="true" />
          Add a service
        </Button>
      </div>

      {editing === 'new' && (
        <ServiceForm
          onDone={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            router.refresh()
          }}
        />
      )}

      <div className="space-y-3">
        {services.map((service) => (
          <div key={service.id}>
            <Card
              className={cn(
                'p-4 transition-opacity',
                !service.is_active && 'opacity-60'
              )}
            >
              {/* On a phone the name takes the whole first line and the price and
                  buttons drop to a second. With `flex-1` alone the name column
                  shrank to nothing and the treatment name ran over the price. */}
              <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
                  <Icon name={service.icon} className="size-5" />
                </span>

                <div className="min-w-0 flex-1 basis-[calc(100%-3.75rem)] sm:basis-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold">{service.name}</h2>
                    {!service.is_active && <Badge tone="neutral">Hidden</Badge>}
                    {Boolean(service.available_clinic) && (
                      <Badge tone="neutral">
                        <MapPin className="size-3" aria-hidden="true" />
                        Clinic
                      </Badge>
                    )}
                    {Boolean(service.available_online) && (
                      <Badge tone="brand">
                        <Video className="size-3" aria-hidden="true" />
                        Online
                      </Badge>
                    )}
                  </div>

                  <p className="mt-1 line-clamp-2 text-sm text-ink-600 dark:text-ink-400">
                    {service.short_description}
                  </p>

                  <p className="mt-1.5 font-mono text-[11px] text-ink-400">/services/{service.slug}</p>
                </div>

                <div className="ml-15 shrink-0 sm:ml-0 sm:text-right">
                  <p className="font-display text-lg font-bold">{formatMoney(service.price_paise)}</p>
                  <p className="text-xs text-ink-500">{service.duration_minutes} min</p>
                </div>

                <div className="ml-auto flex shrink-0 gap-1 sm:ml-0">
                  <button
                    type="button"
                    onClick={() => setEditing(editing === service.id ? null : service.id)}
                    className="grid size-9 place-items-center rounded-xl text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:hover:text-brand-300 dark:hover:bg-brand-500/10"
                    aria-label={`Edit ${service.name}`}
                    title="Edit"
                  >
                    {editing === service.id ? <X className="size-4" /> : <Pencil className="size-4" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => toggle(service)}
                    disabled={pending}
                    className="grid size-9 place-items-center rounded-xl text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:hover:text-brand-300 dark:hover:bg-brand-500/10"
                    aria-label={service.is_active ? `Hide ${service.name}` : `Show ${service.name}`}
                    title={service.is_active ? 'Hide from website' : 'Show on website'}
                  >
                    {service.is_active ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                  </button>

                  {Boolean(service.is_active) && (
                    <a
                      href={`/services/${service.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="grid size-9 place-items-center rounded-xl text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:hover:text-brand-300 dark:hover:bg-brand-500/10"
                      aria-label={`View ${service.name} on the website`}
                      title="View the live page"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  )}
                </div>
              </div>
            </Card>

            {editing === service.id && (
              <div className="mt-3">
                <ServiceForm
                  service={service}
                  onDone={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null)
                    router.refresh()
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  THE EDITOR                                                                */
/* -------------------------------------------------------------------------- */

function ServiceForm({ service, onDone, onSaved }) {
  const [state, formAction, pending] = useActionState(saveService, {})

  // The slug is generated from the name as you type, but only for a NEW service.
  // Changing an existing slug silently would break the live URL and any Google
  // ranking it has earned, so an edit leaves it alone unless the user changes it.
  const [name, setName] = useState(service?.name || '')
  const [slug, setSlug] = useState(service?.slug || '')
  const [slugEdited, setSlugEdited] = useState(Boolean(service))

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message)
      onSaved()
    } else if (state?.error) {
      toast.error(state.error)
    }
    // onSaved is stable enough here; adding it would re-fire on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const errors = state?.errors || {}

  return (
    <Card className="animate-fade-up border-brand-200 p-6 dark:border-brand-800">
      <form action={formAction} className="space-y-5">
        {service && <input type="hidden" name="serviceId" value={service.id} />}

        <h3 className="font-bold">{service ? `Edit “${service.name}”` : 'New service'}</h3>

        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            label="Name"
            name="name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              if (!slugEdited) setSlug(slugify(event.target.value))
            }}
            error={errors.name}
            placeholder="Frozen Shoulder Treatment"
            required
          />

          <Input
            label="URL slug"
            name="slug"
            value={slug}
            onChange={(event) => {
              setSlug(slugify(event.target.value))
              setSlugEdited(true)
            }}
            error={errors.slug}
            hint={
              service
                ? 'Careful — changing this breaks the existing link and loses its Google ranking'
                : `The page will be at /services/${slug || 'your-slug'}`
            }
            required
          />
        </div>

        <Textarea
          label="Short description"
          name="shortDescription"
          rows={2}
          maxLength={300}
          defaultValue={service?.short_description || ''}
          error={errors.shortDescription}
          placeholder="Regain a shoulder that reaches overhead, fastens a blouse and sleeps through the night."
          hint="Shown on the cards on the homepage and services page. One or two plain sentences."
          required
        />

        <Textarea
          label="Full description"
          name="description"
          rows={6}
          defaultValue={service?.description || ''}
          error={errors.description}
          placeholder="Leave a blank line between paragraphs. Write for a patient in pain who is deciding whether to book — describe what the problem is, what the treatment involves, and be honest about how long it takes."
          hint="The main text on the treatment page. This is the content Google reads, so real detail here genuinely helps you rank."
        />

        <div className="grid gap-5 sm:grid-cols-3">
          <Input
            label="Duration (minutes)"
            name="durationMinutes"
            type="number"
            min="10"
            max="240"
            step="5"
            defaultValue={service?.duration_minutes || 45}
            error={errors.durationMinutes}
            required
          />

          <Input
            label="Price (₹)"
            name="priceRupees"
            type="number"
            min="0"
            step="50"
            defaultValue={service ? toRupees(service.price_paise) : 800}
            error={errors.priceRupees}
            hint="In rupees, not paise"
            required
          />

          <Select label="Icon" name="icon" defaultValue={service?.icon || 'Activity'}>
            {ICON_NAMES.map((iconName) => (
              <option key={iconName} value={iconName}>
                {iconName}
              </option>
            ))}
          </Select>
        </div>

        <fieldset className="space-y-3 rounded-2xl border border-ink-200 p-4 dark:border-ink-700">
          <legend className="px-1 text-sm font-semibold">How it can be delivered</legend>

          <Checkbox
            label="Available in the clinic"
            name="availableClinic"
            defaultChecked={service ? Boolean(service.available_clinic) : true}
            error={errors.availableClinic}
          />
          <Checkbox
            label="Available as an online video consultation"
            name="availableOnline"
            defaultChecked={service ? Boolean(service.available_online) : true}
          />
          <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            Untick “online” for anything needing hands or needles — dry needling, joint mobilisation,
            ultrasound, the Epley manoeuvre. Being honest about that is better medicine than taking
            money for a session that cannot do the job.
          </p>

          <Checkbox
            label="Available as a home visit"
            name="availableHome"
            defaultChecked={service ? Boolean(service.available_home) : false}
          />
          <Input
            label="Home visit price (₹)"
            name="homePriceRupees"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            defaultValue={
              service?.home_price_paise != null ? Math.round(service.home_price_paise / 100) : ''
            }
            error={errors.homePriceRupees}
            hint="A separate price, not a surcharge — travel is a flat cost in time. Leave blank to charge the clinic rate."
          />
          <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            Home visits are where the money is for post-surgical and elderly patients, who often
            cannot travel at all. Set the working hours for them separately under Availability — the
            therapist is out of the building and cannot be treating anybody in it.
          </p>

          <Checkbox
            label="Visible on the website"
            name="isActive"
            defaultChecked={service ? Boolean(service.is_active) : true}
          />
        </fieldset>

        <fieldset className="space-y-4 rounded-2xl border border-ink-200 p-4 dark:border-ink-700">
          <legend className="px-1 text-sm font-semibold">Search engine listing (optional)</legend>

          <Input
            label="Page title"
            name="seoTitle"
            maxLength={200}
            defaultValue={service?.seo_title || ''}
            error={errors.seoTitle}
            placeholder="Frozen Shoulder Treatment in Pune | Shoulder Pain Physiotherapy"
            hint="What appears as the blue headline in Google. Aim for 50–60 characters and put the condition and city in it."
          />

          <Textarea
            label="Meta description"
            name="seoDescription"
            rows={2}
            maxLength={300}
            defaultValue={service?.seo_description || ''}
            error={errors.seoDescription}
            placeholder="Frozen shoulder and shoulder pain physiotherapy in Pune. Stage-matched joint mobilisation and stretching to restore full overhead movement."
            hint="The grey text under the headline in Google. Around 150 characters. Write it to make someone click, not to stuff in keywords."
          />
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={pending}>
            {pending ? 'Saving…' : service ? 'Save changes' : 'Create service'}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
