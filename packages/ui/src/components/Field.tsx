import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { useId } from 'react'
import { cn } from '../cn.js'

const CONTROL =
  'w-full rounded-md border bg-surface-raised px-3 text-sm text-content-primary ' +
  'placeholder:text-content-tertiary transition-colors duration-[120ms] ' +
  'focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ' +
  'disabled:opacity-60 disabled:bg-surface-sunken'

export interface FieldProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
  className?: string
}

/**
 * Labels are always programmatically associated; a placeholder is not a label.
 * Errors are announced and linked via aria-describedby (UI_UX.md §8).
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
  htmlFor,
}: FieldProps & { children: React.ReactNode; htmlFor: string }) {
  const hintId = `${htmlFor}-hint`
  const errorId = `${htmlFor}-error`
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-content-primary">
        {label}
        {required && <span className="ml-1 text-status-overdue">(required)</span>}
      </label>
      {hint && (
        <p id={hintId} className="text-[12px] text-content-tertiary">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={errorId} role="alert" className="text-[12px] font-medium text-status-overdue">
          {error}
        </p>
      )}
    </div>
  )
}

export function TextField({
  label,
  hint,
  error,
  required,
  className,
  ...props
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId()
  const id = props.id ?? generated
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
      htmlFor={id}
    >
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(hint && `${id}-hint`, error && `${id}-error`) || undefined}
        className={cn(CONTROL, 'h-9', error ? 'border-status-overdue' : 'border-border-default')}
        {...props}
      />
    </Field>
  )
}

export function SelectField({
  label,
  hint,
  error,
  required,
  className,
  children,
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId()
  const id = props.id ?? generated
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
      htmlFor={id}
    >
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(hint && `${id}-hint`, error && `${id}-error`) || undefined}
        className={cn(
          CONTROL,
          'h-9 appearance-none pr-8',
          error ? 'border-status-overdue' : 'border-border-default',
        )}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2378849a' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 10px center',
        }}
        {...props}
      >
        {children}
      </select>
    </Field>
  )
}

export function TextAreaField({
  label,
  hint,
  error,
  required,
  className,
  ...props
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generated = useId()
  const id = props.id ?? generated
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
      htmlFor={id}
    >
      <textarea
        id={id}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(hint && `${id}-hint`, error && `${id}-error`) || undefined}
        className={cn(
          CONTROL,
          'py-2 resize-y',
          error ? 'border-status-overdue' : 'border-border-default',
        )}
        {...props}
      />
    </Field>
  )
}
