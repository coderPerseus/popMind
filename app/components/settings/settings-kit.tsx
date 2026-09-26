import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A titled block of rows in a rounded container, like the groups in macOS System Settings. */
export function SettingsGroup({
  title,
  description,
  accessory,
  footer,
  children,
  className,
}: {
  title?: ReactNode
  description?: ReactNode
  accessory?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('st-group', className)}>
      {title || description || accessory ? (
        <header className="st-group-header">
          <div className="st-group-heading">
            {title ? <h3 className="st-group-title">{title}</h3> : null}
            {description ? <p className="st-group-desc">{description}</p> : null}
          </div>
          {accessory ? <div className="st-group-accessory">{accessory}</div> : null}
        </header>
      ) : null}
      <div className="st-group-box">{children}</div>
      {footer ? <div className="st-group-footer">{footer}</div> : null}
    </section>
  )
}

/** One setting: label (and optional description) on the left, control on the right. */
export function SettingsRow({
  label,
  description,
  icon,
  children,
  stacked = false,
  className,
}: {
  label: ReactNode
  description?: ReactNode
  icon?: ReactNode
  children?: ReactNode
  /** Put the control under the label (wide inputs). */
  stacked?: boolean
  className?: string
}) {
  return (
    <div className={cn('st-row', stacked && 'is-stacked', className)}>
      {icon ? <div className="st-row-icon">{icon}</div> : null}
      <div className="st-row-text">
        <div className="st-row-label">{label}</div>
        {description ? <div className="st-row-desc">{description}</div> : null}
      </div>
      {children ? <div className="st-row-control">{children}</div> : null}
    </div>
  )
}

/** Free-form content inside a group (lists, notes, stat tiles). */
export function SettingsBlock({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('st-block', className)}>{children}</div>
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: Array<{ value: T; label: string; icon?: ReactNode }>
  onChange: (value: T) => void
  ariaLabel?: string
}) {
  return (
    <div className="st-segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={cn('st-segment', option.value === value && 'is-active')}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  )
}

export function StatusText({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'error' | 'neutral'
  children: ReactNode
}) {
  return (
    <span className={cn('st-status', `is-${tone}`)}>
      <span className="st-status-dot" />
      {children}
    </span>
  )
}

export function InlineMessage({ tone, children }: { tone: 'success' | 'error' | 'info'; children: ReactNode }) {
  return <div className={cn('st-message', `is-${tone}`)}>{children}</div>
}
