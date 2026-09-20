'use client'

/**
 * ============================================================================
 *  STEP 1 — choose a treatment, and how you want it delivered
 * ============================================================================
 */

import { useDispatch, useSelector } from 'react-redux'
import { Clock, MapPin, Video, Check, Info, Home } from 'lucide-react'
import { selectService, setMode, selectBooking } from '@/store/slices/bookingSlice'
import { cn, formatMoney } from '@/lib/utils'
import Icon from '@/components/ui/Icon'

export default function ServiceStep({ site, services }) {
  const dispatch = useDispatch()
  const { serviceId, service, mode } = useSelector(selectBooking)

  return (
    <div>
      <h2 className="text-xl font-bold">What do you need treated?</h2>
      <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-400">
        Not sure? Choose the assessment — we work out the diagnosis and it counts as your first
        treatment session.
      </p>

      {/* ------------------------------------------------- service radios */}
      {/* A fieldset with a legend is the correct grouping for a set of related
          choices. A screen reader announces "Treatment, 1 of 10" as the user
          moves through them, which a plain div cannot do. */}
      <fieldset className="mt-6">
        <legend className="sr-only">Choose a treatment</legend>

        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((item) => {
            const isSelected = serviceId === item.id

            return (
              <label
                key={item.id}
                className={cn(
                  'relative flex cursor-pointer gap-3.5 rounded-2xl border-2 p-4 transition-all',
                  isSelected
                    ? 'border-brand-500 bg-brand-50/60 shadow-soft dark:bg-brand-950/40'
                    : 'border-ink-200 hover:border-brand-300 hover:bg-ink-50/60 dark:border-ink-700 dark:hover:bg-ink-800/50'
                )}
              >
                {/* A real radio input, made invisible rather than replaced by a
                    div. That keeps arrow-key navigation, form semantics and
                    screen reader support working for free — all of which a
                    div-with-onClick throws away. */}
                <input
                  type="radio"
                  name="service"
                  value={item.id}
                  checked={isSelected}
                  onChange={() => dispatch(selectService(item))}
                  className="sr-only"
                />

                <span
                  className={cn(
                    'grid size-10 shrink-0 place-items-center rounded-xl transition-colors',
                    isSelected
                      ? 'bg-brand-600 text-white'
                      : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400'
                  )}
                >
                  <Icon name={item.icon} className="size-5" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-sm font-bold leading-snug">{item.name}</span>
                    {isSelected && (
                      <Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
                    )}
                  </span>

                  <span className="mt-1 block line-clamp-2 text-xs leading-snug text-ink-500 dark:text-ink-400">
                    {item.short_description}
                  </span>

                  <span className="mt-2 flex items-center gap-3 text-xs font-semibold">
                    <span className="text-ink-900 dark:text-white">
                      {formatMoney(item.price_paise)}
                    </span>
                    <span className="flex items-center gap-1 text-ink-400">
                      <Clock className="size-3" aria-hidden="true" />
                      {item.duration_minutes} min
                    </span>
                    {!item.available_online && (
                      <span className="text-ink-400">Clinic only</span>
                    )}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {/* ---------------------------------------------------- mode toggle */}
      {service && (
        <fieldset className="mt-8 animate-fade-up">
          <legend className="text-sm font-bold">How would you like to be seen?</legend>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ModeOption
              value="clinic"
              current={mode}
              disabled={!service.available_clinic}
              onSelect={() => dispatch(setMode('clinic'))}
              icon={MapPin}
              title="At the clinic"
              description={`${site.address.line2}, ${site.address.city}. Hands-on treatment, equipment and manual therapy.`}
            />
            <ModeOption
              value="online"
              current={mode}
              disabled={!service.available_online}
              onSelect={() => dispatch(setMode('online'))}
              icon={Video}
              title="Online video call"
              description="One-to-one video consultation in your browser. Nothing to install."
              disabledReason="This treatment needs hands-on contact"
            />
            {/* Only shown when the clinic actually offers this treatment at home.
                An option that is always visible and usually disabled teaches
                patients to ignore the row. */}
            {service.available_home && (
              <ModeOption
                value="home"
                current={mode}
                onSelect={() => dispatch(setMode('home'))}
                icon={Home}
                title="At your home"
                description={
                  service.home_price_paise
                    ? `The physiotherapist comes to you. ${formatMoney(service.home_price_paise)} — includes travel.`
                    : 'The physiotherapist comes to you.'
                }
              />
            )}
          </div>

          {/* An honest explanation rather than a silently greyed-out option.
              A disabled control with no reason given is one of the most
              frustrating things in an interface. */}
          {!service.available_online && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-sun-50 p-3.5 text-xs leading-relaxed text-sun-900 dark:bg-sun-950/40 dark:text-sun-200">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong>{service.name}</strong> is only available in the clinic. It needs physical
                contact — needles, hands or equipment — so it genuinely cannot be delivered over a
                video call, and we would rather say so than take your money for a session that
                cannot work.
              </span>
            </p>
          )}
        </fieldset>
      )}
    </div>
  )
}

function ModeOption({ value, current, disabled, onSelect, icon: OptionIcon, title, description, disabledReason }) {
  const isSelected = current === value

  return (
    <label
      className={cn(
        'relative flex cursor-pointer flex-col rounded-2xl border-2 p-4 transition-all',
        disabled && 'cursor-not-allowed opacity-45',
        isSelected && !disabled
          ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/40'
          : 'border-ink-200 dark:border-ink-700',
        !disabled && !isSelected && 'hover:border-brand-300'
      )}
    >
      <input
        type="radio"
        name="mode"
        value={value}
        checked={isSelected}
        disabled={disabled}
        onChange={onSelect}
        className="sr-only"
      />

      <span className="flex items-center justify-between">
        <OptionIcon
          className={cn('size-5', isSelected ? 'text-brand-600' : 'text-ink-400')}
          aria-hidden="true"
        />
        {isSelected && !disabled && <Check className="size-4 text-brand-600" aria-hidden="true" />}
      </span>

      <span className="mt-3 text-sm font-bold">{title}</span>
      <span className="mt-1 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
        {disabled && disabledReason ? disabledReason : description}
      </span>
    </label>
  )
}
