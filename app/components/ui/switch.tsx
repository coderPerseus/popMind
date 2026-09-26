import * as React from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

function Switch({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: 'sm' | 'default'
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        'peer group/switch inline-flex shrink-0 items-center rounded-full border-0 p-[2px] transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:bg-[var(--mac-accent)] data-[state=unchecked]:bg-[var(--mac-fill-strong)] data-[state=unchecked]:shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)] data-[size=default]:h-[20px] data-[size=default]:w-[34px] data-[size=sm]:h-4 data-[size=sm]:w-[26px]',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25),0_0_0_0.5px_rgba(0,0,0,0.06)] ring-0 transition-transform duration-150 group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[14px] group-data-[size=sm]/switch:data-[state=checked]:translate-x-[10px] data-[state=unchecked]:translate-x-0'
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
