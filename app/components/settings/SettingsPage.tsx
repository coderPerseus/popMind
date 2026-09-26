import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Select } from '@/app/components/ui/select'
import { Switch } from '@/app/components/ui/switch'
import { useConveyor } from '@/app/hooks/use-conveyor'
import { useI18n } from '@/app/i18n'
import {
  InlineMessage,
  SegmentedControl,
  SettingsBlock,
  SettingsGroup,
  SettingsRow,
  StatusText,
} from '@/app/components/settings/settings-kit'
import { compareReleaseVersions } from '@/lib/app/release'
import { isLocalGemmaConfigured } from '@/lib/capability/gemma'
import {
  DEFAULT_ELEVENLABS_VOICE_ID,
  ELEVENLABS_PRESET_VOICE_IDS,
  normalizeElevenLabsVoiceId,
} from '@/lib/speech-service/shared'
import type {
  AiProviderId,
  AppLanguage,
  CapabilitySettings,
  LocalGemmaConfig,
  SelectionDefaultAction,
  SpeechProviderId,
  WebSearchProviderId,
} from '@/lib/capability/types'
import type { I18nKey } from '@/lib/i18n/shared'
import type {
  ExplainHistoryListItem,
  HistoryDataType,
  SearchHistoryListItem,
  SearchHistorySummary,
} from '@/lib/search-history/types'
import type { ThemeMode } from '@/lib/theme/shared'
import { getVisibleTranslationEngineIds, translationEngineLabels, translationLanguages } from '@/lib/translation/shared'
import {
  ArrowUpRight,
  AudioLines,
  ChevronLeft,
  ChevronRight,
  Download,
  Hand,
  History,
  Languages,
  LockKeyhole,
  Monitor,
  Moon,
  RefreshCw,
  ScreenShare,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Sun,
  TextCursorInput,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import './styles.css'

type PermissionStatus = {
  granted: boolean
  supported: boolean
}

type SettingsSection =
  | 'general'
  | 'permissions'
  | 'selection'
  | 'translation'
  | 'ai'
  | 'speech'
  | 'history'
  | 'advanced'
type HistoryTab = 'search' | 'explain'
type StatusTone = 'success' | 'error'
type GemmaCheckState = {
  status: 'idle' | 'checking' | 'checked'
  installed: boolean
  appPath: string | null
  serviceReachable: boolean
  modelIds: string[]
  detectedModelId: string | null
}

type NavItem = {
  id: SettingsSection
  label: string
  icon: LucideIcon
  /** Colour of the rounded icon tile, as in macOS System Settings. */
  tint: string
}

type UpdateState = {
  status: 'idle' | 'checking' | 'latest' | 'available' | 'failed'
  version?: string
  url?: string
}

const navGroups: SettingsSection[][] = [
  ['general', 'permissions'],
  ['selection', 'translation', 'ai', 'speech'],
  ['history', 'advanced'],
]

const aiProviderOptions: Array<{ id: AiProviderId; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Claude' },
  { id: 'google', label: 'Gemini' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'gemma', label: 'Gemma' },
]

const webSearchProviders: Array<{ id: WebSearchProviderId; label: string; keyUrl: string }> = [
  { id: 'tavily', label: 'Tavily', keyUrl: 'https://app.tavily.com/home' },
  { id: 'serper', label: 'Serper', keyUrl: 'https://serper.dev/' },
  { id: 'brave', label: 'Brave', keyUrl: 'https://brave.com/search/api/' },
  { id: 'jina', label: 'Jina', keyUrl: 'https://s.jina.ai' },
]

const speechProviderOptions: Array<{ id: SpeechProviderId; label: string }> = [
  { id: 'system', label: 'macOS System' },
  { id: 'elevenlabs', label: 'ElevenLabs' },
  { id: 'openai', label: 'OpenAI' },
]

const CUSTOM_ELEVENLABS_VOICE_OPTION = '__custom__'

const getProviderLabel = (provider: AiProviderId | null | undefined, fallbackLabel = 'None') => {
  return aiProviderOptions.find((item) => item.id === provider)?.label ?? fallbackLabel
}

const getAiFieldPlaceholders = (_providerId: AiProviderId | null) => {
  return {
    apiKey: 'sk-...',
    baseURL: 'https://api.example.com/v1',
    model: 'gpt-5-mini',
  }
}

const getLmStudioServerBaseUrl = (value?: string) => {
  const trimmed = value?.trim() || 'http://127.0.0.1:1234/v1'

  try {
    const url = new URL(trimmed)
    const pathname = url.pathname.replace(/\/+$/, '')

    if (!pathname || pathname === '/' || pathname === '/v1' || pathname.startsWith('/v1/')) {
      return url.origin
    }

    if (pathname === '/api/v1' || pathname.startsWith('/api/v1/')) {
      return url.origin
    }

    return `${url.origin}${pathname}`
  } catch {
    return 'http://127.0.0.1:1234'
  }
}

const getLmStudioNativeApiUrl = (value: string | undefined, endpoint: string) => {
  const baseUrl = getLmStudioServerBaseUrl(value).replace(/\/$/, '')
  return `${baseUrl}/api/v1/${endpoint.replace(/^\/+/, '')}`
}

const extractGemmaModelIds = (payload: unknown) => {
  const models = Array.isArray((payload as { models?: unknown[] })?.models)
    ? (payload as { models: Array<Record<string, unknown>> }).models
    : []

  return models
    .flatMap((model) => {
      const key = typeof model.key === 'string' ? model.key.trim() : ''
      const loadedInstances = Array.isArray(model.loaded_instances)
        ? model.loaded_instances
            .map((instance) => (typeof instance?.id === 'string' ? instance.id.trim() : ''))
            .filter(Boolean)
        : []

      return [...loadedInstances, key].filter(Boolean)
    })
    .filter((modelId, index, list) => list.indexOf(modelId) === index)
}

export function SettingsPage() {
  const app = useConveyor('app')
  const capability = useConveyor('capability')
  const search = useConveyor('search')
  const { webOpenUrl, windowShowRoute } = useConveyor('window')
  const { language, t } = useI18n()
  const [accessibilityStatus, setAccessibilityStatus] = useState<PermissionStatus | null>(null)
  const [screenRecordingStatus, setScreenRecordingStatus] = useState<PermissionStatus | null>(null)
  const [settings, setSettings] = useState<CapabilitySettings | null>(null)
  const [historySummary, setHistorySummary] = useState<Record<HistoryTab, SearchHistorySummary | null>>({
    search: null,
    explain: null,
  })
  const [historyItems, setHistoryItems] = useState<
    Record<HistoryTab, Array<SearchHistoryListItem | ExplainHistoryListItem>>
  >({
    search: [],
    explain: [],
  })
  const [isSaving, setIsSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const [activeHistoryTab, setActiveHistoryTab] = useState<HistoryTab>('search')
  const [historyMessage, setHistoryMessage] = useState('')
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
  const [busyHistoryAction, setBusyHistoryAction] = useState<'' | 'export' | 'clear'>('')
  const [isTestingAiService, setIsTestingAiService] = useState(false)
  const [aiTestMessage, setAiTestMessage] = useState<{ tone: StatusTone; message: string } | null>(null)
  const [isTestingSpeechService, setIsTestingSpeechService] = useState(false)
  const [speechTestMessage, setSpeechTestMessage] = useState<{ tone: StatusTone; message: string } | null>(null)
  const [gemmaCheckState, setGemmaCheckState] = useState<GemmaCheckState>({
    status: 'idle',
    installed: false,
    appPath: null,
    serviceReachable: false,
    modelIds: [],
    detectedModelId: null,
  })
  const [testingWebSearchProviderId, setTestingWebSearchProviderId] = useState<WebSearchProviderId | null>(null)
  const [blockedSelectionApps, setBlockedSelectionApps] = useState<string[]>([])
  const [webSearchTestMessages, setWebSearchTestMessages] = useState<
    Partial<Record<WebSearchProviderId, { tone: StatusTone; message: string }>>
  >({})
  const saveTimerRef = useRef<number | null>(null)

  const [appVersion, setAppVersion] = useState('')
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' })
  const [logMessage, setLogMessage] = useState('')

  const navItems: NavItem[] = useMemo(
    () => [
      { id: 'general', label: t('settings.nav.general'), icon: Settings2, tint: 'gray' },
      { id: 'permissions', label: t('settings.nav.permissions'), icon: LockKeyhole, tint: 'blue' },
      { id: 'selection', label: t('settings.nav.selection'), icon: TextCursorInput, tint: 'purple' },
      { id: 'translation', label: t('settings.nav.translation'), icon: Languages, tint: 'teal' },
      { id: 'ai', label: t('settings.nav.ai'), icon: Sparkles, tint: 'indigo' },
      { id: 'speech', label: t('settings.nav.speech'), icon: AudioLines, tint: 'orange' },
      { id: 'history', label: t('settings.nav.history'), icon: History, tint: 'slate' },
      { id: 'advanced', label: t('settings.nav.advanced'), icon: SlidersHorizontal, tint: 'graphite' },
    ],
    [t]
  )

  const activeAiProvider = settings?.aiService.activeProvider ?? null
  const activeSpeechProvider = settings?.speechService.activeProvider ?? 'system'
  const elevenLabsVoiceId = settings?.speechService.providers.elevenlabs.voiceId ?? DEFAULT_ELEVENLABS_VOICE_ID
  const selectedElevenLabsVoiceOption = ELEVENLABS_PRESET_VOICE_IDS.includes(
    elevenLabsVoiceId as (typeof ELEVENLABS_PRESET_VOICE_IDS)[number]
  )
    ? elevenLabsVoiceId
    : CUSTOM_ELEVENLABS_VOICE_OPTION
  const gemmaConfigured = settings ? isLocalGemmaConfigured(settings) : false
  const visibleAiProviderOptions = useMemo(
    () => aiProviderOptions.filter((item) => item.id !== 'gemma' || gemmaConfigured || activeAiProvider === 'gemma'),
    [activeAiProvider, gemmaConfigured]
  )
  const visibleTranslationEngineIds = useMemo(
    () => (settings ? getVisibleTranslationEngineIds(settings) : []),
    [settings]
  )
  const aiFieldPlaceholders = getAiFieldPlaceholders(activeAiProvider)

  const handleThemeChange = async (mode: ThemeMode) => {
    setThemeMode(mode)
    await app.setThemeMode(mode)
  }

  const refreshPermissions = useCallback(async () => {
    const [nextAccessibilityStatus, nextScreenRecordingStatus] = await Promise.all([
      app.checkAccessibility(),
      app.checkScreenRecording(),
    ])

    setAccessibilityStatus(nextAccessibilityStatus)
    setScreenRecordingStatus(nextScreenRecordingStatus)
  }, [app])

  const refreshSettings = useCallback(async () => {
    const result = await capability.getSettings()
    setSettings(result)
  }, [capability])

  const refreshBlockedSelectionApps = useCallback(async () => {
    setBlockedSelectionApps(await app.getBlockedSelectionApps())
  }, [app])

  const refreshHistory = useCallback(
    async (type: HistoryTab) => {
      const [summary, items] = await Promise.all([search.getHistorySummary(type), search.listHistory(type, 80)])
      setHistorySummary((current) => ({ ...current, [type]: summary }))
      setHistoryItems((current) => ({ ...current, [type]: items }))
    },
    [search]
  )

  useEffect(() => {
    void app.version().then(setAppVersion)
    void app.getThemeMode().then(setThemeMode)
    void refreshPermissions()
    void refreshSettings()
    void refreshBlockedSelectionApps()
    void refreshHistory('search')
    void refreshHistory('explain')

    const unsubscribe = capability.onState((nextSettings) => {
      setSettings(nextSettings)
    })

    const timer = window.setInterval(() => {
      void refreshPermissions()
    }, 2500)

    return () => {
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [app, capability, refreshBlockedSelectionApps, refreshHistory, refreshPermissions, refreshSettings])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const persistPatch = useCallback(
    async (patch: Parameters<typeof capability.updateSettings>[0], debounce = false) => {
      if (debounce) {
        if (saveTimerRef.current) {
          window.clearTimeout(saveTimerRef.current)
        }

        saveTimerRef.current = window.setTimeout(() => {
          void persistPatch(patch, false)
        }, 320)
        return
      }

      setIsSaving(true)
      try {
        const next = await capability.updateSettings(patch)
        setSettings(next)
      } finally {
        setIsSaving(false)
      }
    },
    [capability]
  )

  const updateField = <K extends keyof CapabilitySettings>(key: K, value: CapabilitySettings[K]) => {
    setSettings((current) => (current ? { ...current, [key]: value } : current))
    void persistPatch({ [key]: value })
  }

  const updateSelectionDefaultAction = (defaultAction: SelectionDefaultAction) => {
    setSettings((current) => (current ? { ...current, selection: { ...current.selection, defaultAction } } : current))
    void persistPatch({ selection: { defaultAction } })
  }

  const checkForUpdates = async () => {
    setUpdateState({ status: 'checking' })
    try {
      const [currentVersion, latest] = await Promise.all([app.version(), app.latestRelease()])
      if (!latest) {
        setUpdateState({ status: 'failed' })
        return
      }

      setUpdateState(
        compareReleaseVersions(latest.version, currentVersion) > 0
          ? { status: 'available', version: latest.version, url: latest.url }
          : { status: 'latest' }
      )
    } catch {
      setUpdateState({ status: 'failed' })
    }
  }

  const exportLogs = async () => {
    const result = await app.exportLogs()
    setLogMessage(
      !result.canceled && result.filePath ? t('settings.advanced.logsExported', { path: result.filePath }) : ''
    )
  }

  const updateEngine = (engine: keyof CapabilitySettings['enabledEngines'], checked: boolean) => {
    setSettings((current) =>
      current
        ? {
            ...current,
            enabledEngines: {
              ...current.enabledEngines,
              [engine]: checked,
            },
          }
        : current
    )

    void persistPatch({
      enabledEngines: {
        [engine]: checked,
      },
    })
  }

  const updateAiService = (providerId: AiProviderId, key: 'apiKey' | 'baseURL' | 'model', value: string) => {
    setAiTestMessage(null)
    setSettings((current) =>
      current
        ? {
            ...current,
            aiService: {
              ...current.aiService,
              providers: {
                ...current.aiService.providers,
                [providerId]: {
                  ...current.aiService.providers[providerId],
                  [key]: value,
                },
              },
            },
          }
        : current
    )

    void persistPatch(
      {
        aiService: {
          providers: {
            [providerId]: {
              [key]: value,
            },
          },
        },
      },
      true
    )
  }

  const updateLocalGemma = <K extends keyof LocalGemmaConfig>(key: K, value: LocalGemmaConfig[K], debounce = false) => {
    setSettings((current) =>
      current
        ? {
            ...current,
            localModels: {
              ...current.localModels,
              gemma: {
                ...current.localModels.gemma,
                [key]: value,
              },
            },
          }
        : current
    )

    void persistPatch(
      {
        localModels: {
          gemma: {
            [key]: value,
          },
        },
      },
      debounce
    )
  }

  const runGemmaEnvironmentCheck = async () => {
    const nativeModelsUrl = getLmStudioNativeApiUrl(settings?.localModels.gemma.baseURL, 'models')
    setGemmaCheckState({
      status: 'checking',
      installed: false,
      appPath: null,
      serviceReachable: false,
      modelIds: [],
      detectedModelId: null,
    })

    const apps = await app.searchInstalledApps('LM Studio', 5)
    const lmStudioApp = apps.find((item) => /lm studio/i.test(item.name) || /lm studio/i.test(item.fileName)) ?? null

    let serviceReachable = false
    let modelIds: string[] = []
    let detectedModelId: string | null = null

    try {
      const response = await fetch(nativeModelsUrl)
      if (response.ok) {
        const payload = (await response.json()) as unknown
        modelIds = extractGemmaModelIds(payload)
        detectedModelId = modelIds.find((item) => /gemma/i.test(item)) ?? null
        serviceReachable = true
      }
    } catch {
      serviceReachable = false
    }

    if (
      detectedModelId &&
      settings &&
      (!settings.localModels.gemma.model.trim() || !modelIds.includes(settings.localModels.gemma.model.trim()))
    ) {
      updateLocalGemma('model', detectedModelId, true)
    }

    setGemmaCheckState({
      status: 'checked',
      installed: Boolean(lmStudioApp),
      appPath: lmStudioApp?.path ?? null,
      serviceReachable,
      modelIds,
      detectedModelId,
    })
  }

  const updateActiveAiProvider = (providerId: AiProviderId | null) => {
    setAiTestMessage(null)
    setSettings((current) =>
      current
        ? {
            ...current,
            aiService: {
              ...current.aiService,
              activeProvider: providerId,
            },
          }
        : current
    )

    void persistPatch({
      aiService: {
        activeProvider: providerId,
      },
    })
  }

  const updateWebSearchField = (providerId: WebSearchProviderId, value: string) => {
    setWebSearchTestMessages((current) => {
      if (!current[providerId]) {
        return current
      }

      const next = { ...current }
      delete next[providerId]
      return next
    })

    setSettings((current) =>
      current
        ? {
            ...current,
            webSearch: {
              ...current.webSearch,
              providers: {
                ...current.webSearch.providers,
                [providerId]: {
                  ...current.webSearch.providers[providerId],
                  apiKey: value,
                },
              },
            },
          }
        : current
    )

    void persistPatch(
      {
        webSearch: {
          providers: {
            [providerId]: {
              apiKey: value,
            },
          },
        },
      },
      true
    )
  }

  const updateSpeechProvider = (providerId: SpeechProviderId) => {
    setSpeechTestMessage(null)
    setSettings((current) =>
      current
        ? {
            ...current,
            speechService: {
              ...current.speechService,
              activeProvider: providerId,
            },
          }
        : current
    )

    void persistPatch({
      speechService: {
        activeProvider: providerId,
      },
    })
  }

  const updateElevenLabsField = (key: 'apiKey' | 'voiceId' | 'modelId', value: string) => {
    const nextValue = key === 'voiceId' ? normalizeElevenLabsVoiceId(value) : value
    setSpeechTestMessage(null)
    setSettings((current) =>
      current
        ? {
            ...current,
            speechService: {
              ...current.speechService,
              providers: {
                ...current.speechService.providers,
                elevenlabs: {
                  ...current.speechService.providers.elevenlabs,
                  [key]: nextValue,
                },
              },
            },
          }
        : current
    )

    void persistPatch(
      {
        speechService: {
          providers: {
            elevenlabs: {
              [key]: nextValue,
            },
          },
        },
      },
      true
    )
  }

  const updateElevenLabsVoiceSelection = (value: string) => {
    if (value === CUSTOM_ELEVENLABS_VOICE_OPTION) {
      updateElevenLabsField('voiceId', '')
      return
    }

    updateElevenLabsField('voiceId', value)
  }

  const updateOpenAiSpeechField = (key: 'apiKey' | 'voice' | 'model', value: string) => {
    setSpeechTestMessage(null)
    setSettings((current) =>
      current
        ? {
            ...current,
            speechService: {
              ...current.speechService,
              providers: {
                ...current.speechService.providers,
                openai: {
                  ...current.speechService.providers.openai,
                  [key]: value,
                },
              },
            },
          }
        : current
    )

    void persistPatch(
      {
        speechService: {
          providers: {
            openai: {
              [key]: value,
            },
          },
        },
      },
      true
    )
  }

  const runWebSearchProviderTest = async (providerId: WebSearchProviderId) => {
    if (!settings) {
      return
    }

    setWebSearchTestMessages((current) => {
      if (!current[providerId]) {
        return current
      }

      const next = { ...current }
      delete next[providerId]
      return next
    })
    setTestingWebSearchProviderId(providerId)

    try {
      const result = await capability.testWebSearchProvider(settings, providerId)

      if (result.ok) {
        setWebSearchTestMessages((current) => ({
          ...current,
          [providerId]: {
            tone: 'success',
            message: t('settings.capability.search.testSuccess', {
              count: result.resultCount,
            }),
          },
        }))
        return
      }

      if (result.errorCode === 'missing-config') {
        setWebSearchTestMessages((current) => ({
          ...current,
          [providerId]: {
            tone: 'error',
            message: t('settings.capability.search.testMissingConfig'),
          },
        }))
        return
      }

      setWebSearchTestMessages((current) => ({
        ...current,
        [providerId]: {
          tone: 'error',
          message: t('settings.capability.search.testFailed', {
            message: result.errorMessage ?? t('common.none'),
          }),
        },
      }))
    } finally {
      setTestingWebSearchProviderId(null)
    }
  }

  const runAiServiceTest = async () => {
    if (!settings) {
      return
    }

    setAiTestMessage(null)
    setIsTestingAiService(true)

    try {
      const result = await capability.testAiService(settings)

      if (result.ok) {
        const providerLabel =
          aiProviderOptions.find((item) => item.id === result.providerId)?.label ??
          result.providerId ??
          t('common.none')

        setAiTestMessage({
          tone: 'success',
          message: t('settings.capability.ai.testSuccess', {
            provider: providerLabel,
            model: result.modelId ?? t('common.none'),
          }),
        })
        return
      }

      if (result.errorCode === 'missing-config') {
        setAiTestMessage({
          tone: 'error',
          message: t('settings.capability.ai.testMissingConfig'),
        })
        return
      }

      setAiTestMessage({
        tone: 'error',
        message: t('settings.capability.ai.testFailed', {
          message: result.errorMessage ?? t('common.none'),
        }),
      })
    } finally {
      setIsTestingAiService(false)
    }
  }

  const runSpeechServiceTest = async () => {
    if (!settings) {
      return
    }

    setSpeechTestMessage(null)
    setIsTestingSpeechService(true)

    try {
      const result = await capability.testSpeechService(settings)

      if (result.ok) {
        setSpeechTestMessage({
          tone: 'success',
          message: t('settings.capability.speech.testSuccess', {
            provider:
              speechProviderOptions.find((item) => item.id === result.providerId)?.label ??
              result.providerId ??
              t('common.none'),
            voice: result.voiceId ?? t('common.none'),
            model: result.modelId ?? t('common.none'),
          }),
        })
        return
      }

      if (result.errorCode === 'missing-config') {
        setSpeechTestMessage({
          tone: 'error',
          message: t('settings.capability.speech.testMissingConfig'),
        })
        return
      }

      setSpeechTestMessage({
        tone: 'error',
        message: t('settings.capability.speech.testFailed', {
          message: result.errorMessage ?? t('common.none'),
        }),
      })
    } finally {
      setIsTestingSpeechService(false)
    }
  }

  const exportHistory = async (type: HistoryDataType) => {
    setHistoryMessage('')
    setBusyHistoryAction('export')

    try {
      const result = await search.exportHistory(type)
      if (result.canceled) {
        setHistoryMessage(t('settings.history.exportCanceled'))
        return
      }

      setHistoryMessage(t('settings.history.exportSuccess', { count: result.count }))
      await refreshHistory(type)
    } catch (error) {
      setHistoryMessage(t('settings.history.exportFailed', { message: getErrorMessage(error) }))
    } finally {
      setBusyHistoryAction('')
    }
  }

  const clearHistory = async (type: HistoryDataType) => {
    const confirmed = window.confirm(
      t(type === 'search' ? 'settings.history.confirmClearSearch' : 'settings.history.confirmClearExplain')
    )
    if (!confirmed) {
      return
    }

    setHistoryMessage('')
    setBusyHistoryAction('clear')

    try {
      const result = await search.clearHistory(type)
      setHistoryMessage(t('settings.history.clearSuccess', { count: result.deletedCount }))
      await refreshHistory(type)
    } catch (error) {
      setHistoryMessage(t('settings.history.clearFailed', { message: getErrorMessage(error) }))
    } finally {
      setBusyHistoryAction('')
    }
  }

  const aiConfigured = Boolean(activeAiProvider && settings?.aiService.providers[activeAiProvider].apiKey.trim())
  const selectionDefaultAction = settings?.selection.defaultAction ?? 'bubble'
  const activeNavItem = navItems.find((item) => item.id === activeSection) ?? navItems[0]

  const renderSection = () => {
    if (activeSection === 'general') {
      return (
        <>
          <SettingsGroup title={t('settings.group.appearance')}>
            <SettingsRow label={t('settings.theme.title')}>
              <SegmentedControl
                ariaLabel={t('settings.theme.title')}
                value={themeMode}
                onChange={(mode) => void handleThemeChange(mode)}
                options={[
                  { value: 'light', label: t('settings.theme.light'), icon: <Sun size={13} /> },
                  { value: 'dark', label: t('settings.theme.dark'), icon: <Moon size={13} /> },
                  { value: 'system', label: t('settings.theme.system'), icon: <Monitor size={13} /> },
                ]}
              />
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup title={t('settings.group.region')}>
            <SettingsRow label={t('common.language')}>
              <Select
                className="st-select"
                value={settings?.appLanguage ?? language}
                onChange={(event) => updateField('appLanguage', event.target.value as AppLanguage)}
              >
                <option value="zh-CN">{t('app.language.zh-CN')}</option>
                <option value="en">{t('app.language.en')}</option>
              </Select>
            </SettingsRow>
          </SettingsGroup>
        </>
      )
    }

    if (activeSection === 'permissions') {
      const permissionRows = [
        {
          id: 'accessibility',
          label: t('settings.accessibility.title'),
          description: t('settings.accessibility.desc'),
          status: accessibilityStatus,
          icon: <Hand size={14} />,
          tint: 'blue',
          open: () => app.openAccessibilitySettings(),
        },
        {
          id: 'screen',
          label: t('settings.screenRecording.title'),
          description: t('settings.screenRecording.desc'),
          status: screenRecordingStatus,
          icon: <ScreenShare size={14} />,
          tint: 'purple',
          open: () => app.openScreenRecordingSettings(),
        },
      ]

      return (
        <SettingsGroup
          description={t('settings.permissions.intro')}
          footer={
            <Button size="sm" variant="ghost" onClick={() => void refreshPermissions()}>
              <RefreshCw />
              {t('settings.accessibility.refresh')}
            </Button>
          }
        >
          {permissionRows.map((row) => (
            <SettingsRow
              key={row.id}
              icon={<span className={`st-tile is-${row.tint}`}>{row.icon}</span>}
              label={row.label}
              description={row.description}
            >
              <StatusText tone={row.status?.granted ? 'success' : 'warning'}>
                {row.status?.granted ? t('common.enabled') : t('common.disabled')}
              </StatusText>
              {row.status?.granted ? null : (
                <Button size="sm" variant="outline" onClick={() => void row.open()}>
                  {t('common.openSettings')}
                </Button>
              )}
            </SettingsRow>
          ))}
        </SettingsGroup>
      )
    }

    if (activeSection === 'selection') {
      return (
        <>
          <SettingsGroup
            title={t('settings.selection.behavior')}
            footer={
              selectionDefaultAction === 'explain' && !aiConfigured ? (
                <InlineMessage tone="info">{t('settings.selection.explainNeedsAi')}</InlineMessage>
              ) : undefined
            }
          >
            <SettingsRow
              label={t('settings.selection.defaultAction')}
              description={t('settings.selection.defaultActionDesc')}
            >
              <SegmentedControl
                ariaLabel={t('settings.selection.defaultAction')}
                value={selectionDefaultAction}
                onChange={updateSelectionDefaultAction}
                options={[
                  { value: 'bubble', label: t('settings.selection.action.bubble') },
                  { value: 'translate', label: t('settings.selection.action.translate') },
                  { value: 'explain', label: t('settings.selection.action.explain') },
                ]}
              />
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup title={t('settings.selection.blocked')} description={t('settings.selection.blockedDesc')}>
            {blockedSelectionApps.length ? (
              blockedSelectionApps.map((bundleId) => (
                <SettingsRow key={bundleId} label={<span className="st-mono">{bundleId}</span>}>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void app.removeBlockedSelectionApp(bundleId).then(() => refreshBlockedSelectionApps())
                    }
                  >
                    {t('settings.selection.restore')}
                  </Button>
                </SettingsRow>
              ))
            ) : (
              <SettingsBlock className="st-empty">{t('settings.selection.blockedEmpty')}</SettingsBlock>
            )}
          </SettingsGroup>
        </>
      )
    }

    if (activeSection === 'translation' && settings) {
      const languageOptions = translationLanguages.filter((item) => item.code !== 'auto')

      return (
        <>
          <SettingsGroup title={t('settings.translation.languages')}>
            <SettingsRow label={t('settings.translation.first')}>
              <Select
                className="st-select"
                value={settings.firstLanguage}
                onChange={(event) => updateField('firstLanguage', event.target.value)}
              >
                {languageOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </SettingsRow>
            <SettingsRow label={t('settings.translation.second')}>
              <Select
                className="st-select"
                value={settings.secondLanguage}
                onChange={(event) => updateField('secondLanguage', event.target.value)}
              >
                {languageOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup title={t('settings.translation.engines')}>
            {visibleTranslationEngineIds.map((engine) => (
              <SettingsRow
                key={engine}
                label={translationEngineLabels[engine]}
                description={
                  engine === 'ai'
                    ? `${t('settings.capability.ai.provider')}：${getProviderLabel(activeAiProvider, t('common.none'))}`
                    : engine === 'gemma'
                      ? settings.localModels.gemma.model || t('settings.privacy.gemma.detectModelMeta')
                      : undefined
                }
              >
                <Switch
                  checked={settings.enabledEngines[engine]}
                  onCheckedChange={(checked) => updateEngine(engine, checked)}
                />
              </SettingsRow>
            ))}
          </SettingsGroup>
        </>
      )
    }

    if (activeSection === 'ai') {
      return (
        <SettingsGroup
          title={t('settings.ai.service')}
          description={t('settings.capability.ai.desc')}
          accessory={
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runAiServiceTest()}
              disabled={!settings || isTestingAiService}
            >
              {isTestingAiService ? t('settings.capability.ai.testing') : t('settings.capability.ai.test')}
            </Button>
          }
          footer={
            aiTestMessage ? (
              <InlineMessage tone={aiTestMessage.tone === 'success' ? 'success' : 'error'}>
                {aiTestMessage.message}
              </InlineMessage>
            ) : undefined
          }
        >
          <SettingsRow label={t('settings.capability.ai.provider')}>
            <Select
              className="st-select"
              value={activeAiProvider ?? ''}
              onChange={(event) => updateActiveAiProvider((event.target.value || null) as AiProviderId | null)}
            >
              <option value="">{t('common.none')}</option>
              {visibleAiProviderOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </Select>
          </SettingsRow>

          {activeAiProvider && activeAiProvider !== 'gemma' ? (
            <>
              <SettingsRow label={t('settings.capability.ai.apiKey')}>
                <Input
                  className="st-input"
                  type="password"
                  value={settings?.aiService.providers[activeAiProvider].apiKey ?? ''}
                  onChange={(event) => updateAiService(activeAiProvider, 'apiKey', event.target.value)}
                  placeholder={aiFieldPlaceholders.apiKey}
                />
              </SettingsRow>
              <SettingsRow label={t('settings.capability.ai.baseUrl')}>
                <Input
                  className="st-input"
                  value={settings?.aiService.providers[activeAiProvider].baseURL ?? ''}
                  onChange={(event) => updateAiService(activeAiProvider, 'baseURL', event.target.value)}
                  placeholder={aiFieldPlaceholders.baseURL}
                />
              </SettingsRow>
              <SettingsRow label={t('settings.capability.ai.model')}>
                <Input
                  className="st-input"
                  value={settings?.aiService.providers[activeAiProvider].model ?? ''}
                  onChange={(event) => updateAiService(activeAiProvider, 'model', event.target.value)}
                  placeholder={aiFieldPlaceholders.model}
                />
              </SettingsRow>
            </>
          ) : null}

          {activeAiProvider === 'gemma' ? (
            <SettingsBlock className="st-note">
              {t('settings.ai.gemmaHint')}
              <Button size="sm" variant="link" onClick={() => setActiveSection('advanced')}>
                {t('settings.nav.advanced')}
              </Button>
            </SettingsBlock>
          ) : null}
        </SettingsGroup>
      )
    }

    if (activeSection === 'speech') {
      return (
        <SettingsGroup
          title={t('settings.capability.speech.title')}
          description={t('settings.capability.speech.desc')}
          accessory={
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runSpeechServiceTest()}
              disabled={!settings || isTestingSpeechService}
            >
              {isTestingSpeechService ? t('settings.capability.speech.testing') : t('settings.capability.speech.test')}
            </Button>
          }
          footer={
            <>
              {speechTestMessage ? (
                <InlineMessage tone={speechTestMessage.tone === 'success' ? 'success' : 'error'}>
                  {speechTestMessage.message}
                </InlineMessage>
              ) : null}
              <div className="st-link-row">
                <Button
                  size="sm"
                  variant="link"
                  onClick={() =>
                    void webOpenUrl(
                      activeSpeechProvider === 'openai'
                        ? 'https://developers.openai.com/api/docs/guides/text-to-speech'
                        : 'https://elevenlabs.io/docs/overview/intro'
                    )
                  }
                >
                  {t('settings.capability.speech.docs')}
                  <ArrowUpRight />
                </Button>
                {activeSpeechProvider === 'elevenlabs' ? (
                  <Button
                    size="sm"
                    variant="link"
                    onClick={() =>
                      void webOpenUrl(
                        'https://help.elevenlabs.io/hc/en-us/articles/14599760033937-How-do-I-find-the-voice-ID-of-my-voices-via-the-website-and-API'
                      )
                    }
                  >
                    {t('settings.capability.speech.voiceHelp')}
                    <ArrowUpRight />
                  </Button>
                ) : null}
              </div>
            </>
          }
        >
          <SettingsRow label={t('settings.capability.speech.provider')}>
            <Select
              className="st-select"
              value={activeSpeechProvider}
              onChange={(event) => updateSpeechProvider(event.target.value as SpeechProviderId)}
            >
              {speechProviderOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </Select>
          </SettingsRow>

          {activeSpeechProvider === 'elevenlabs' ? (
            <>
              <SettingsRow label={t('settings.capability.speech.apiKey')}>
                <Input
                  className="st-input"
                  type="password"
                  value={settings?.speechService.providers.elevenlabs.apiKey ?? ''}
                  onChange={(event) => updateElevenLabsField('apiKey', event.target.value)}
                  placeholder="sk_..."
                />
              </SettingsRow>
              <SettingsRow label={t('settings.capability.speech.voiceId')}>
                <Select
                  className="st-select"
                  value={selectedElevenLabsVoiceOption}
                  onChange={(event) => updateElevenLabsVoiceSelection(event.target.value)}
                >
                  {ELEVENLABS_PRESET_VOICE_IDS.map((voiceId) => (
                    <option key={voiceId} value={voiceId}>
                      {voiceId}
                    </option>
                  ))}
                  <option value={CUSTOM_ELEVENLABS_VOICE_OPTION}>{language === 'en' ? 'Custom' : '自定义'}</option>
                </Select>
              </SettingsRow>
              {selectedElevenLabsVoiceOption === CUSTOM_ELEVENLABS_VOICE_OPTION ? (
                <SettingsRow label="Voice ID">
                  <Input
                    className="st-input"
                    value={settings?.speechService.providers.elevenlabs.voiceId ?? ''}
                    onChange={(event) => updateElevenLabsField('voiceId', event.target.value)}
                    placeholder={DEFAULT_ELEVENLABS_VOICE_ID}
                  />
                </SettingsRow>
              ) : null}
              <SettingsRow label={t('settings.capability.speech.model')}>
                <Input
                  className="st-input"
                  value={settings?.speechService.providers.elevenlabs.modelId ?? ''}
                  onChange={(event) => updateElevenLabsField('modelId', event.target.value)}
                  placeholder="eleven_multilingual_v2"
                />
              </SettingsRow>
            </>
          ) : null}

          {activeSpeechProvider === 'openai' ? (
            <SettingsRow
              label={t('settings.capability.speech.apiKey')}
              description={t('settings.capability.speech.openaiDefaultHint', {
                voice: settings?.speechService.providers.openai.voice ?? 'alloy',
                model: settings?.speechService.providers.openai.model ?? 'gpt-4o-mini-tts',
              })}
            >
              <Input
                className="st-input"
                type="password"
                value={settings?.speechService.providers.openai.apiKey ?? ''}
                onChange={(event) => updateOpenAiSpeechField('apiKey', event.target.value)}
                placeholder="sk-..."
              />
            </SettingsRow>
          ) : null}
        </SettingsGroup>
      )
    }

    if (activeSection === 'history') {
      const summary = historySummary[activeHistoryTab]

      return (
        <>
          <div className="st-toolbar-row">
            <SegmentedControl
              value={activeHistoryTab}
              onChange={setActiveHistoryTab}
              options={[
                { value: 'search', label: t('settings.history.searchTab') },
                { value: 'explain', label: t('settings.history.explainTab') },
              ]}
            />
          </div>

          <SettingsGroup
            title={
              activeHistoryTab === 'search' ? t('settings.history.searchSummary') : t('settings.history.explainSummary')
            }
            description={
              activeHistoryTab === 'search'
                ? t('settings.history.retentionSearch')
                : t('settings.history.retentionExplain')
            }
            footer={
              <>
                <div className="st-button-row">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void exportHistory(activeHistoryTab)}
                    disabled={Boolean(busyHistoryAction)}
                  >
                    <Download />
                    {busyHistoryAction === 'export' ? t('settings.history.exporting') : t('settings.history.export')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void clearHistory(activeHistoryTab)}
                    disabled={Boolean(busyHistoryAction)}
                  >
                    <Trash2 />
                    {busyHistoryAction === 'clear' ? t('settings.history.clearing') : t('settings.history.clear')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void refreshHistory(activeHistoryTab)}>
                    <RefreshCw />
                    {t('common.reload')}
                  </Button>
                </div>
                {historyMessage ? <InlineMessage tone="info">{historyMessage}</InlineMessage> : null}
              </>
            }
          >
            <SettingsRow label={t('settings.history.total')}>
              <span className="st-value">{summary?.totalCount ?? 0}</span>
            </SettingsRow>
            <SettingsRow label={t('settings.history.retention')}>
              <span className="st-value">
                {t('settings.history.retentionDays', { count: summary?.retentionDays ?? 0 })}
              </span>
            </SettingsRow>
            <SettingsRow
              label={
                activeHistoryTab === 'search' ? t('settings.history.lastSearch') : t('settings.history.lastExplain')
              }
            >
              <span className="st-value">{formatHistoryTime(summary?.lastActivityAt, language)}</span>
            </SettingsRow>
            <SettingsRow
              label={t('settings.history.storage')}
              description={<span className="st-mono">{summary?.storagePath ?? t('common.loading')}</span>}
            >
              <span className="st-value">{t('settings.history.sqlite')}</span>
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup title={t('settings.history.records')}>
            {historyItems[activeHistoryTab].length ? (
              historyItems[activeHistoryTab].map((item) =>
                activeHistoryTab === 'search' ? (
                  <SearchHistoryRow key={item.id} item={item as SearchHistoryListItem} locale={language} />
                ) : (
                  <ExplainHistoryRow key={item.id} item={item as ExplainHistoryListItem} locale={language} t={t} />
                )
              )
            ) : (
              <SettingsBlock className="st-empty">{t('settings.history.empty')}</SettingsBlock>
            )}
          </SettingsGroup>
        </>
      )
    }

    if (activeSection === 'advanced' && settings) {
      const gemmaStatus = (ok: boolean) =>
        gemmaCheckState.status === 'idle' ? (
          <span className="st-value">{t('common.none')}</span>
        ) : (
          <StatusText tone={ok ? 'success' : 'warning'}>{ok ? t('common.enabled') : t('common.disabled')}</StatusText>
        )

      return (
        <>
          <SettingsGroup title={t('settings.advanced.webSearch')} description={t('settings.capability.search.desc')}>
            <SettingsRow
              label={t('settings.capability.search.enabled')}
              description={t('settings.capability.search.priority')}
            >
              <Switch
                checked={settings.webSearch.enabled}
                onCheckedChange={(checked) => void persistPatch({ webSearch: { enabled: checked } })}
              />
            </SettingsRow>
            {webSearchProviders.map((provider) => {
              const message = webSearchTestMessages[provider.id]

              return (
                <SettingsRow
                  key={provider.id}
                  label={provider.label}
                  description={
                    message ? (
                      <span className={message.tone === 'success' ? 'st-text-success' : 'st-text-error'}>
                        {message.message}
                      </span>
                    ) : undefined
                  }
                >
                  <Input
                    className="st-input is-narrow"
                    type="password"
                    value={settings.webSearch.providers[provider.id].apiKey}
                    onChange={(event) => updateWebSearchField(provider.id, event.target.value)}
                    placeholder="API Key"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void runWebSearchProviderTest(provider.id)}
                    disabled={testingWebSearchProviderId === provider.id}
                  >
                    {testingWebSearchProviderId === provider.id
                      ? t('settings.capability.search.testing')
                      : t('settings.capability.search.test')}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title={t('settings.capability.search.getKey')}
                    aria-label={t('settings.capability.search.getKey')}
                    onClick={() => void webOpenUrl(provider.keyUrl)}
                  >
                    <ArrowUpRight />
                  </Button>
                </SettingsRow>
              )
            })}
          </SettingsGroup>

          <SettingsGroup
            title={t('settings.advanced.localModel')}
            description={t('settings.privacy.gemma.desc')}
            accessory={
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runGemmaEnvironmentCheck()}
                disabled={gemmaCheckState.status === 'checking'}
              >
                {gemmaCheckState.status === 'checking'
                  ? t('settings.privacy.gemma.detecting')
                  : t('settings.privacy.gemma.detect')}
              </Button>
            }
            footer={
              <>
                <div className="st-footnotes">
                  <p>{t('settings.privacy.gemma.guide')}</p>
                  <p>{t('settings.privacy.gemma.mainWindowOnly')}</p>
                  <p>{t('settings.privacy.gemma.translationHint')}</p>
                </div>
                <div className="st-link-row">
                  <Button size="sm" variant="link" onClick={() => void webOpenUrl('https://lmstudio.ai')}>
                    {t('settings.privacy.gemma.download')}
                    <ArrowUpRight />
                  </Button>
                  {gemmaCheckState.appPath ? (
                    <Button
                      size="sm"
                      variant="link"
                      onClick={() => void app.openInstalledApp(gemmaCheckState.appPath!)}
                    >
                      {t('settings.privacy.gemma.openApp')}
                      <ArrowUpRight />
                    </Button>
                  ) : null}
                </div>
              </>
            }
          >
            <SettingsRow label={t('settings.privacy.gemma.enabled')}>
              <Switch
                checked={settings.localModels.gemma.enabled}
                onCheckedChange={(checked) => updateLocalGemma('enabled', checked)}
              />
            </SettingsRow>
            <SettingsRow
              label={t('settings.privacy.gemma.detectApp')}
              description={t('settings.privacy.gemma.detectAppMeta')}
            >
              {gemmaStatus(gemmaCheckState.installed)}
            </SettingsRow>
            <SettingsRow
              label={t('settings.privacy.gemma.detectService')}
              description={<span className="st-mono">{settings.localModels.gemma.baseURL}</span>}
            >
              {gemmaStatus(gemmaCheckState.serviceReachable)}
            </SettingsRow>
            <SettingsRow
              label={t('settings.privacy.gemma.detectModel')}
              description={
                gemmaCheckState.modelIds.length
                  ? t('settings.privacy.gemma.modelCount', { count: gemmaCheckState.modelIds.length })
                  : t('settings.privacy.gemma.detectModelMeta')
              }
            >
              <span className="st-value">{gemmaCheckState.detectedModelId ?? t('common.none')}</span>
            </SettingsRow>
            <SettingsRow label={t('settings.capability.ai.apiKey')}>
              <Input
                className="st-input"
                value={settings.localModels.gemma.apiKey}
                onChange={(event) => updateLocalGemma('apiKey', event.target.value, true)}
                placeholder="local"
              />
            </SettingsRow>
            <SettingsRow label={t('settings.capability.ai.baseUrl')}>
              <Input
                className="st-input"
                value={settings.localModels.gemma.baseURL}
                onChange={(event) => updateLocalGemma('baseURL', event.target.value, true)}
                placeholder="http://127.0.0.1:1234/v1"
              />
            </SettingsRow>
            <SettingsRow label={t('settings.capability.ai.model')}>
              <Input
                className="st-input"
                value={settings.localModels.gemma.model}
                onChange={(event) => updateLocalGemma('model', event.target.value, true)}
                placeholder={gemmaCheckState.detectedModelId ?? 'gemma-4-31b-it'}
              />
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup title={t('settings.advanced.diagnostics')}>
            <SettingsRow label={t('settings.advanced.version')} description={renderUpdateStatus()}>
              <span className="st-value">{appVersion || '—'}</span>
              {updateState.status === 'available' && updateState.url ? (
                <Button size="sm" onClick={() => void webOpenUrl(updateState.url!)}>
                  {t('settings.advanced.download')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void checkForUpdates()}
                  disabled={updateState.status === 'checking'}
                >
                  {updateState.status === 'checking'
                    ? t('settings.advanced.checking')
                    : t('settings.advanced.checkUpdate')}
                </Button>
              )}
            </SettingsRow>
            <SettingsRow
              label={t('settings.advanced.logs')}
              description={logMessage || t('settings.advanced.logsDesc')}
            >
              <Button size="sm" variant="outline" onClick={() => void exportLogs()}>
                <Download />
                {t('settings.advanced.exportLogs')}
              </Button>
            </SettingsRow>
          </SettingsGroup>
        </>
      )
    }

    return null
  }

  const renderUpdateStatus = () => {
    if (updateState.status === 'latest')
      return <span className="st-text-success">{t('settings.advanced.upToDate')}</span>
    if (updateState.status === 'available') {
      return (
        <span className="st-text-accent">
          {t('settings.advanced.updateAvailable', { version: updateState.version ?? '' })}
        </span>
      )
    }
    if (updateState.status === 'failed')
      return <span className="st-text-error">{t('settings.advanced.checkFailed')}</span>
    return undefined
  }

  return (
    <div className="st-shell">
      <aside className="st-sidebar">
        <div className="st-sidebar-drag" />
        <nav className="st-nav" aria-label={t('settings.brand')}>
          {navGroups.map((group, groupIndex) => (
            <div className="st-nav-group" key={groupIndex}>
              {group.map((id) => {
                const item = navItems.find((navItem) => navItem.id === id)
                if (!item) return null
                const Icon = item.icon

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`st-nav-item ${activeSection === item.id ? 'is-active' : ''}`}
                    aria-current={activeSection === item.id ? 'page' : undefined}
                    onClick={() => setActiveSection(item.id)}
                  >
                    <span className={`st-tile is-${item.tint}`}>
                      <Icon size={13} strokeWidth={2.2} />
                    </span>
                    <span className="st-nav-label">{item.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="st-sidebar-footer">
          <button type="button" className="st-back" onClick={() => void windowShowRoute('home')}>
            <ChevronLeft size={14} />
            {t('settings.back')}
          </button>
        </div>
      </aside>

      <main className="st-main">
        <header className="st-toolbar">
          <div className="st-toolbar-inner">
            <h1 className="st-title">{activeNavItem.label}</h1>
            <span className={`st-save-state ${isSaving ? 'is-saving' : ''}`}>
              {isSaving ? t('common.saveSaving') : t('common.saveAuto')}
            </span>
          </div>
        </header>
        <div className="st-scroll">
          <div className="st-page" key={activeSection}>
            {renderSection()}
          </div>
        </div>
      </main>
    </div>
  )
}

function SearchHistoryRow({ item, locale }: { item: SearchHistoryListItem; locale: AppLanguage }) {
  return (
    <SettingsRow label={item.query} description={`${item.actionLabel} · ${formatHistoryTime(item.createdAt, locale)}`}>
      <span className="st-tag">{item.kind}</span>
    </SettingsRow>
  )
}

function ExplainHistoryRow({
  item,
  locale,
  t,
}: {
  item: ExplainHistoryListItem
  locale: AppLanguage
  t: (key: I18nKey, params?: Record<string, string | number>) => string
}) {
  const turns = Math.ceil(item.messages.length / 2)
  const sourceCount = item.messages.reduce((count, message) => count + (message.sources?.length ?? 0), 0)

  return (
    <details className="st-disclosure">
      <summary>
        <SettingsRow
          label={item.selectionText}
          description={`${getProviderLabel(item.aiProvider as AiProviderId, t('common.none'))} · ${formatHistoryTime(item.updatedAt, locale)}`}
        >
          <span className="st-tag">{t('settings.history.row.turns', { count: turns })}</span>
          {sourceCount ? (
            <span className="st-tag">{t('settings.history.row.sources', { count: sourceCount })}</span>
          ) : null}
          <ChevronRight size={14} className="st-disclosure-chevron" />
        </SettingsRow>
      </summary>
      <div className="st-disclosure-body">
        {item.messages.map((message) => (
          <div key={message.id} className="st-message-item">
            <div className="st-message-role">{message.role === 'user' ? 'You' : 'AI'}</div>
            <div className="st-message-text">{message.text}</div>
          </div>
        ))}
      </div>
    </details>
  )
}

const formatHistoryTime = (timestamp: number | undefined, locale: AppLanguage) => {
  if (!timestamp) {
    return locale === 'en' ? 'None' : '暂无'
  }

  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Please try again later'
}
