import { useCallback, useEffect, useState } from 'react'
import { useConveyor } from '@/app/hooks/use-conveyor'
import type { MainSearchCommand } from '@/app/components/home/query-command'
import type { MainExplainState } from '@/lib/explain/types'

const emptyState: MainExplainState = {
  session: null,
}

export function useExplainCommand(command: MainSearchCommand) {
  const explain = useConveyor('explain')
  const [state, setState] = useState<MainExplainState>(emptyState)

  const isActive = command.kind === 'explain'

  useEffect(() => {
    let mounted = true
    const syncState = (nextState: MainExplainState) => {
      if (mounted) {
        setState(nextState)
      }
    }

    const unsubscribe = explain.onState(syncState)
    void explain.getState().then(syncState)

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [explain])

  useEffect(() => {
    if (!isActive || command.kind !== 'explain') {
      void explain.reset()
      return
    }

    const nextQuery = command.text.trim()
    if (!nextQuery) {
      if (state.session) {
        void explain.reset()
      }
      return
    }

    if (state.session && state.session.selectionText !== nextQuery) {
      void explain.reset()
    }
  }, [command, explain, isActive, state.session])

  const runImmediately = useCallback(() => {
    if (command.kind !== 'explain' || !command.text.trim()) {
      return
    }

    void explain.startSession(command.text.trim())
  }, [command, explain])

  const submitFollowup = useCallback(
    async (text: string) => {
      const message = text.trim()
      if (!message) {
        return false
      }

      await explain.submitMessage(message)
      return true
    },
    [explain]
  )

  const regenerate = useCallback(() => {
    if (state.session) {
      void explain.regenerate()
      return
    }

    if (command.kind === 'explain' && command.text.trim()) {
      void explain.startSession(command.text.trim())
    }
  }, [command, explain, state.session])

  const stop = useCallback(() => {
    void explain.stop()
  }, [explain])

  const reset = useCallback(() => {
    void explain.reset()
  }, [explain])

  return {
    isActive,
    state,
    session: state.session,
    runImmediately,
    submitFollowup,
    regenerate,
    stop,
    reset,
  }
}
