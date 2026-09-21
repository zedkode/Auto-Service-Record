import { useEffect, useRef, useId, type ReactNode } from 'react'
import { cn } from '../cn.js'

/**
 * Built on the native <dialog> element, which provides focus trapping, Escape-to-close
 * and inertness for the rest of the page without re-implementing any of it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'drawer'
}) {
  const titleId = useId()
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const handleCancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }
    el.addEventListener('cancel', handleCancel)
    return () => el.removeEventListener('cancel', handleCancel)
  }, [onClose])

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', drawer: 'max-w-sm' }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={cn(
        'w-[calc(100vw-2rem)] rounded-xl border border-border-default bg-surface-overlay p-0 text-content-primary shadow-lg',
        'backdrop:bg-black/40 backdrop:backdrop-blur-[2px]',
        size === 'drawer' ? 'm-0 h-dvh max-h-dvh rounded-none' : 'my-auto mx-auto',
        widths[size],
      )}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself) closes; clicks inside do not.
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
        <div>
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-[13px] text-content-secondary">{description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="-mr-1 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-md text-content-tertiary transition-colors hover:bg-surface-sunken hover:text-content-primary"
        >
          <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div
        className={cn(
          size === 'drawer' ? 'max-h-[calc(100dvh-6rem)]' : 'max-h-[70vh]',
          'overflow-y-auto px-5 py-4',
        )}
      >
        {children}
      </div>

      {footer && (
        <div className="flex justify-end gap-2 border-t border-border-subtle bg-surface-sunken/50 px-5 py-3">
          {footer}
        </div>
      )}
    </dialog>
  )
}
