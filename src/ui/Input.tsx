import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from './cn'

const fieldStyles =
  'w-full rounded-xl border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-muted/70 focus:border-primary disabled:opacity-50'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, className, id, ...props },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-ink">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={(error ?? hint) ? `${inputId}-desc` : undefined}
        className={cn('h-11', fieldStyles, error && 'border-avoid', className)}
        {...props}
      />
      {(error || hint) && (
        <p
          id={`${inputId}-desc`}
          className={cn('text-xs', error ? 'text-avoid' : 'text-ink-muted')}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  hint?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, className, id, rows = 3, ...props },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-ink">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={(error ?? hint) ? `${inputId}-desc` : undefined}
        className={cn(fieldStyles, 'py-2.5', error && 'border-avoid', className)}
        {...props}
      />
      {(error || hint) && (
        <p
          id={`${inputId}-desc`}
          className={cn('text-xs', error ? 'text-avoid' : 'text-ink-muted')}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  )
})
