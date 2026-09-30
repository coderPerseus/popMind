import { useCallback, useLayoutEffect, useRef } from 'react'

/** Stable function identity that always calls the latest closure. */
export function useEvent<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
  const ref = useRef(fn)

  useLayoutEffect(() => {
    ref.current = fn
  })

  return useCallback((...args: Args) => ref.current(...args), [])
}
