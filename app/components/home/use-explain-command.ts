import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConveyor } from '@/app/hooks/use-conveyor'
import type { MainSearchCommand } from '@/app/components/home/query-command'
import { listConfiguredAiProviders } from '@/lib/capability/ai-providers'
import type { MainExplainState, ExplainSessionMode } from '@/lib/explain/types'
import type { AiProviderId, CapabilitySettings } from '@/lib/capability/types'

const emptyState: MainExplainState = {
  session: null,
}

const useMainAiCommand = (
  command: MainSearchCommand,
  commandKind: Extract<MainSearchCommand, { kind: 'explain' | 'gemma' }>['kind'],
  sessionMode: ExplainSessionMode,
  lockedProviderId?: AiProviderId
) => {
  const explain = useConveyor('explain')
  const capability = useConveyor('capability')
  const [state, setState] = useState<MainExplainState>(emptyState)
  const [settings, setSettings] = useState<CapabilitySettings | null>(null)
  const [preferredProviderId, setPreferredProviderId] = useState<AiProviderId | undefined>(lockedProviderId)
  const [preferredWebSearch, setPreferredWebSearch] = useState<boolean | null>(null)

  const isActive = command.kind === commandKind
  const configuredProviders = useMemo(() => (settings ? listConfiguredAiProviders(settings) : []), [settings])

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
    let mounted = true
    const syncSettings = (nextSettings: CapabilitySettings) => {
      if (mounted) {
        setSettings(nextSettings)
      }
    }

    const unsubscribe = capability.onState(syncSettings)
    void capability.getSettings().then(syncSettings)

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [capability])

  useEffect(() => {
    if (lockedProviderId) {
      setPreferredProviderId(lockedProviderId)
    }
  }, [lockedProviderId])

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

  const resolvedProviderId = lockedProviderId ?? preferredProviderId ?? settings?.aiService.activeProvider ?? undefined
  const resolvedWebSearchEnabled =
    state.session?.webSearchEnabled ?? preferredWebSearch ?? settings?.webSearch.enabled ?? false

  const runImmediately = useCallback(() => {
    if (command.kind !== commandKind || !command.text.trim()) {
      return
    }

    void explain.startSession(command.text.trim(), sessionMode, resolvedProviderId, resolvedWebSearchEnabled)
  }, [command, commandKind, explain, resolvedProviderId, resolvedWebSearchEnabled, sessionMode])

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
      void explain.startSession(command.text.trim(), sessionMode, resolvedProviderId, resolvedWebSearchEnabled)
    }
  }, [command, commandKind, explain, resolvedProviderId, resolvedWebSearchEnabled, sessionMode, state.session])

  const stop = useCallback(() => {
    void explain.stop()
  }, [explain])

  const reset = useCallback(() => {
    void explain.reset()
  }, [explain])

  const setWebSearchEnabled = useCallback(
    (enabled: boolean) => {
      setPreferredWebSearch(enabled)
      if (state.session) {
        void explain.setWebSearchEnabled(enabled)
      }
    },
    [explain, state.session]
  )

  const setProvider = useCallback(
    (providerId: AiProviderId) => {
      if (lockedProviderId) {
        return
      }

      setPreferredProviderId(providerId)
      if (state.session) {
        void explain.setProvider(providerId)
      }
    },
    [explain, lockedProviderId, state.session]
  )

  return {
    isActive,
    state,
    session: state.session,
    settings,
    configuredProviders,
    selectedProviderId: state.session?.providerId ?? state.session?.aiProvider ?? resolvedProviderId,
    webSearchEnabled: resolvedWebSearchEnabled,
    canSwitchProvider: !lockedProviderId && configuredProviders.length > 1,
    runImmediately,
    submitFollowup,
    regenerate,
    stop,
    reset,
    setWebSearchEnabled,
    setProvider,
  }
}

export function useExplainCommand(command: MainSearchCommand) {
  return useMainAiCommand(command, 'explain', 'explain')
}

export function useGemmaCommand(command: MainSearchCommand) {
  return useMainAiCommand(command, 'gemma', 'chat', 'gemma')
}
