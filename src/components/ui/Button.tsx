import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/*
 * Buttons use the display (mono) face with letter-spacing for short labels.
 * A button that can hold long, wrapping text (e.g. the answer choices) adds
 * `font-sans tracking-normal`; tailwind-merge lets that override win.
 *
 * Press effect (the only one): a hard --shadow-press that drops 2px to
 * --shadow-press-active on :active, timed by `transition-press`
 * (--duration-fast for shadow/transform). ghost and link have no shadow.
 */
const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-display text-sm font-bold tracking-wider transition-press disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-ring/60 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          'border-2 border-primary bg-primary text-primary-foreground shadow-press hover:bg-primary/90 active:translate-y-0.5 active:shadow-press-active',
        destructive:
          'border-2 border-destructive bg-destructive text-destructive-foreground shadow-press hover:bg-destructive/90 active:translate-y-0.5 active:shadow-press-active focus-visible:ring-destructive/30',
        outline:
          'border-2 border-input bg-card text-foreground shadow-press hover:border-primary hover:bg-accent active:translate-y-0.5 active:shadow-press-active',
        secondary:
          'border-2 border-secondary bg-secondary text-secondary-foreground shadow-press hover:bg-accent active:translate-y-0.5 active:shadow-press-active',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-4 py-2',
        sm: 'h-9 px-3 text-xs',
        lg: 'h-12 px-8 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading = false, disabled, children, type, ...props }, ref) => (
    <button
      ref={ref}
      data-slot="button"
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'

export { Button, buttonVariants }
