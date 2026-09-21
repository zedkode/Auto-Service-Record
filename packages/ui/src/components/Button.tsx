import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../cn.js'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-hover active:bg-accent-active border border-transparent shadow-xs',
  secondary:
    'bg-surface-raised text-content-primary border border-border-default hover:bg-surface-sunken hover:border-border-strong',
  ghost:
    'bg-transparent text-content-secondary hover:bg-surface-sunken hover:text-content-primary border border-transparent',
  danger: 'bg-status-overdue text-white hover:opacity-90 border border-transparent shadow-xs',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-[15px] gap-2',
}

/**
 * Shared style builder so a link can LOOK like a button without being one.
 *
 * Never nest a <button> inside an <a>: it is invalid HTML, the button swallows the
 * click so navigation silently fails, and it puts two interactive elements in the
 * tab order. Use `buttonClassName` on the link itself instead.
 */
export function buttonClassName({
  variant = 'secondary',
  size = 'md',
  className,
}: {
  variant?: Variant
  size?: Size
  className?: string
} = {}): string {
  return cn(
    'inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap',
    'transition-colors duration-[120ms] ease-[var(--ease-out)]',
    'disabled:opacity-50 disabled:pointer-events-none',
    VARIANTS[variant],
    SIZES[size],
    className,
  )
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonClassName({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  )
}

function Spinner() {
  return (
    <svg className="size-4 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
