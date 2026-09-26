import * as React from 'react'

import { cn } from '@/lib/utils'

function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'mac-select flex h-7 w-full min-w-0 appearance-none rounded-[6px] border-0 bg-[var(--mac-control)] py-0 pr-7 pl-2.5 text-[13px] text-[var(--mac-label)] shadow-[var(--mac-shadow-control)] transition-[box-shadow] outline-none focus-visible:shadow-[0_0_0_3px_var(--ring)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export { Select }
