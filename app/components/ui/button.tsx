import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] text-[13px] font-medium leading-none transition-[background-color,box-shadow,color] duration-100 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5 shrink-0 [&_svg]:shrink-0 outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      variant: {
        default:
          'bg-[var(--mac-accent)] text-[var(--mac-on-accent)] shadow-[0_0.5px_1px_rgba(0,0,0,0.2),inset_0_0.5px_0_rgba(255,255,255,0.18)] hover:bg-[var(--mac-accent-hover)]',
        destructive: 'bg-[var(--mac-red)] text-white shadow-[var(--mac-shadow-control)] hover:brightness-95',
        outline:
          'bg-[var(--mac-control)] text-[var(--mac-label)] shadow-[var(--mac-shadow-control)] hover:bg-[var(--mac-fill-strong)] active:bg-[var(--mac-fill-strong)] dark:hover:bg-[var(--mac-fill-strong)]',
        secondary: 'bg-[var(--mac-fill)] text-[var(--mac-label)] hover:bg-[var(--mac-fill-strong)]',
        ghost: 'text-[var(--mac-label)] hover:bg-[var(--mac-hover)] active:bg-[var(--mac-selected)]',
        link: 'text-[var(--mac-accent)] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-7 px-3 has-[>svg]:px-2.5',
        xs: "h-5 gap-1 rounded-[5px] px-1.5 text-[11px] [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-[26px] gap-1.5 px-2.5 text-[12.5px] has-[>svg]:px-2',
        lg: 'h-8 px-4 has-[>svg]:px-3',
        icon: 'size-7',
        'icon-xs': "size-5 rounded-[5px] [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-6',
        'icon-lg': 'size-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
