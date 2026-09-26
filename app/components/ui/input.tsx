import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-7 w-full min-w-0 rounded-[6px] border-0 bg-[var(--mac-field)] px-2.5 text-[13px] text-[var(--mac-label)] shadow-[var(--mac-shadow-control)] transition-[box-shadow] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-[13px] file:font-medium placeholder:text-[var(--mac-tertiary-label)] focus-visible:shadow-[0_0_0_3px_var(--ring)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export { Input }
