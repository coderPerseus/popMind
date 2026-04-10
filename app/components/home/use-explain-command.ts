import { useCallback, useEffect, useState } from 'react'
import { useConveyor } from '@/app/hooks/use-conveyor'
import type { MainSearchCommand } from '@/app/components/home/query-command'
import type { MainExplainState, ExplainSessionMode } from '@/lib/explain/types'
import type { AiProviderId } from '@/lib/capability/types'

const emptyState: MainExplainState = {
  session: null,
}

const useMainAiCommand = (
  command: MainSearchCommand,
  commandKind: Extract<MainSearchCommand, { kind: 'explain' | 'gemma' }>['kind'],
  sessionMode: ExplainSessionMode,
  providerId?: AiProviderId
) => {
  const explain = useConveyor('explain')
  const [state, setState] = useState<MainExplainState>(emptyState)

  const isActive = command.kind === commandKind

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
    if (!isActive || command.kind !== commandKind) {
      if (state.session?.mode === sessionMode) {
        void explain.reset()
      }
      return
    }

    const nextQuery = command.text.trim()
    if (!nextQuery) {
      if (state.session?.mode === sessionMode) {
        void explain.reset()
      }
      return
    }

    if (state.session && (state.session.mode !== sessionMode || state.session.selectionText !== nextQuery)) {
      void explain.reset()
    }
  }, [command, commandKind, explain, isActive, sessionMode, state.session])

  const runImmediately = useCallback(() => {
    if (command.kind !== commandKind || !command.text.trim()) {
      return
    }

    void explain.startSession(command.text.trim(), sessionMode, providerId)
  }, [command, commandKind, explain, providerId, sessionMode])

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

    if (command.kind === commandKind && command.text.trim()) {
      void explain.startSession(command.text.trim(), sessionMode, providerId)
    }
  }, [command, commandKind, explain, providerId, sessionMode, state.session])

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

export function useExplainCommand(command: MainSearchCommand) {
  return useMainAiCommand(command, 'explain', 'explain')
}

export function useGemmaCommand(command: MainSearchCommand) {
  return useMainAiCommand(command, 'gemma', 'chat', 'gemma')
}
