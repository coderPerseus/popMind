import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Badge } from '@/app/components/ui/badge'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Select } from '@/app/components/ui/select'
import { Switch } from '@/app/components/ui/switch'
import { useConveyor } from '@/app/hooks/use-conveyor'
import { useI18n } from '@/app/i18n'
import type { AiProviderId, AppLanguage, CapabilitySettings, WebSearchProviderId } from '@/lib/capability/types'
import type { I18nKey } from '@/lib/i18n/shared'
import type { ExplainHistoryListItem, HistoryDataType, SearchHistoryListItem, SearchHistorySummary } from '@/lib/search-history/types'
import type { ThemeMode } from '@/lib/theme/shared'
import { translationEngineLabels, translationEngineOrder, translationLanguages } from '@/lib/translation/shared'
import { Database, Download, Globe, History, Languages, LockKeyhole, Moon, Monitor, SearchCheck, Sun, Trash2 } from 'lucide-react'
import './styles.css'

type PermissionStatus = {
  granted: boolean
  supported: boolean
}

type SettingsSection = 'general' | 'translation' | 'history'
type HistoryTab = 'search' | 'explain'
type StatusTone = 'success' | 'error'

type NavItem = {
  id: SettingsSection
  label: string
  icon: typeof SearchCheck
}

const aiProviderOptions: Array<{ id: AiProviderId; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Claude' },
  { id: 'google', label: 'Gemini' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'deepseek', label: 'DeepSeek' },
]

const webSearchProviders: Array<{ id: WebSearchProviderId; label: string; keyUrl: string }> = [
  { id: 'tavily', label: 'Tavily', keyUrl: 'https://app.tavily.com/home' },
  { id: 'serper', label: 'Serper', keyUrl: 'https://serper.dev/' },
  { id: 'brave', label: 'Brave', keyUrl: 'https://brave.com/search/api/' },
  { id: 'jina', label: 'Jina', keyUrl: 'https://s.jina.ai' },
]

const getProviderLabel = (provider: AiProviderId | null | undefined, fallbackLabel = 'None') => {
  return aiProviderOptions.find((item) => item.id === provider)?.label ?? fallbackLabel
}

export function SettingsPage() {
  const app = useConveyor('app')
  const capability = useConveyor('capability')
  const search = useConveyor('search')
  const { windowShowRoute } = useConveyor('window')
  const { language, t } = useI18n()
  const [accessibilityStatus, setAccessibilityStatus] = useState<PermissionStatus | null>(null)
  const [screenRecordingStatus, setScreenRecordingStatus] = useState<PermissionStatus | null>(null)
  const [settings, setSettings] = useState<CapabilitySettings | null>(null)
  const [historySummary, setHistorySummary] = useState<Record<HistoryTab, SearchHistorySummary | null>>({
    search: null,
    explain: null,
  })
  const [historyItems, setHistoryItems] = useState<Record<HistoryTab, Array<SearchHistoryListItem | ExplainHistoryListItem>>>({
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
  const [testingWebSearchProviderId, setTestingWebSearchProviderId] = useState<WebSearchProviderId | null>(null)
  const [webSearchTestMessages, setWebSearchTestMessages] = useState<Partial<Record<WebSearchProviderId, { tone: StatusTone; message: string }>>>({})
  const saveTimerRef = useRef<number | null>(null)

  const navItems: NavItem[] = useMemo(
    () => [
      { id: 'general', label: t('settings.nav.general'), icon: SearchCheck },
      { id: 'translation', label: t('settings.nav.translation'), icon: Languages },
      { id: 'history', label: t('settings.nav.history'), icon: History },
    ],
    [t]
  )

  const activeAiProvider = settings?.aiService.activeProvider ?? null

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

  const refreshHistory = useCallback(
    async (type: HistoryTab) => {
      const [summary, items] = await Promise.all([search.getHistorySummary(type), search.listHistory(type, 80)])
      setHistorySummary((current) => ({ ...current, [type]: summary }))
      setHistoryItems((current) => ({ ...current, [type]: items }))
    },
    [search]
  )

  useEffect(() => {
    void app.getThemeMode().then(setThemeMode)
    void refreshPermissions()
    void refreshSettings()
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
  }, [app, capability, refreshHistory, refreshPermissions, refreshSettings])

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
          aiProviderOptions.find((item) => item.id === result.providerId)?.label ?? result.providerId ?? t('common.none')

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

  return (
    <div className="settings-shell">
      <div className="settings-backdrop settings-backdrop-one" />
      <div className="settings-backdrop settings-backdrop-two" />

      <section className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-sidebar-top">
            <Button variant="ghost" className="settings-back-button" onClick={() => void windowShowRoute('home')}>
              ← {t('settings.back')}
            </Button>

            <div className="settings-brand-block">
              <h1>{t('settings.brand')}</h1>
            </div>
          </div>

          <nav className="settings-nav">
            {navItems.map((item) => {
              const Icon = item.icon

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item ${activeSection === item.id ? 'is-active' : ''}`}
                  onClick={() => setActiveSection(item.id)}
                >
                  <span className="settings-nav-icon">
                    <Icon size={15} />
                  </span>
                  <span className="settings-nav-title">{item.label}</span>
                </button>
              )
            })}
          </nav>
        </aside>

        <div className="settings-content">
          <header className="settings-content-header">
            <div>
              <h2>{getSectionTitle(activeSection, t)}</h2>
            </div>

            <Badge variant="outline" className="settings-inline-badge">
              {isSaving ? t('common.saveSaving') : t('common.saveAuto')}
            </Badge>
          </header>

          {activeSection === 'general' && (
            <div className="settings-content-stack">
              <section className="settings-surface">
                <div className="settings-surface-heading">
                  <div>
                    <div className="settings-item-title">{t('settings.theme.title')}</div>
                  </div>
                </div>

                <div className="settings-theme-grid">
                  <ThemeButton
                    active={themeMode === 'light'}
                    label={t('settings.theme.light')}
                    icon={<Sun size={18} />}
                    onClick={() => void handleThemeChange('light')}
                  />
                  <ThemeButton
                    active={themeMode === 'dark'}
                    label={t('settings.theme.dark')}
                    icon={<Moon size={18} />}
                    onClick={() => void handleThemeChange('dark')}
                  />
                  <ThemeButton
                    active={themeMode === 'system'}
                    label={t('settings.theme.system')}
                    icon={<Monitor size={18} />}
                    onClick={() => void handleThemeChange('system')}
                  />
                </div>
              </section>

              <section className="settings-surface">
                <div className="settings-row">
                  <div>
                    <div className="settings-item-title">{t('common.language')}</div>
                  </div>
                  <div className="settings-row-aside">
                    <Select
                      value={settings?.appLanguage ?? language}
                      onChange={(event) => updateField('appLanguage', event.target.value as AppLanguage)}
                    >
                      <option value="zh-CN">{t('app.language.zh-CN')}</option>
                      <option value="en">{t('app.language.en')}</option>
                    </Select>
                  </div>
                </div>
              </section>

              <section className="settings-surface">
                <div className="settings-row">
                  <div>
                    <div className="settings-item-title">{t('settings.accessibility.title')}</div>
                  </div>

                  <div className="settings-row-aside">
                    <Switch
                      checked={Boolean(accessibilityStatus?.granted)}
                      onCheckedChange={() => {
                        void app.openAccessibilitySettings()
                      }}
                      aria-label={t('settings.accessibility.status')}
                    />
                    <span className={`settings-pill ${accessibilityStatus?.granted ? 'is-on' : 'is-off'}`}>
                      {accessibilityStatus?.granted ? t('common.enabled') : t('common.disabled')}
                    </span>
                  </div>
                </div>

                <div className="settings-action-row">
                  <Button size="sm" onClick={() => void app.openAccessibilitySettings()}>
                    <LockKeyhole />
                    {t('common.openSettings')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void refreshPermissions()}>
                    {t('settings.accessibility.refresh')}
                  </Button>
                </div>
              </section>

              <section className="settings-surface">
                <div className="settings-row">
                  <div>
                    <div className="settings-item-title">{t('settings.screenRecording.title')}</div>
                    <div className="settings-item-desc">{t('settings.screenRecording.desc')}</div>
                  </div>

                  <div className="settings-row-aside">
                    <Switch
                      checked={Boolean(screenRecordingStatus?.granted)}
                      onCheckedChange={() => {
                        void app.openScreenRecordingSettings()
                      }}
                      aria-label={t('settings.screenRecording.status')}
                    />
                    <span className={`settings-pill ${screenRecordingStatus?.granted ? 'is-on' : 'is-off'}`}>
                      {screenRecordingStatus?.granted ? t('common.enabled') : t('common.disabled')}
                    </span>
                  </div>
                </div>

                <div className="settings-action-row">
                  <Button size="sm" onClick={() => void app.openScreenRecordingSettings()}>
                    <Monitor />
                    {t('common.openSettings')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void refreshPermissions()}>
                    {t('settings.screenRecording.refresh')}
                  </Button>
                </div>
              </section>

              <section className="settings-surface">
                <div className="settings-surface-heading">
                  <div>
                    <div className="settings-item-title">{t('settings.capability.ai.title')}</div>
                    <div className="settings-item-desc">{t('settings.capability.ai.desc')}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void runAiServiceTest()} disabled={!settings || isTestingAiService}>
                    {isTestingAiService ? t('settings.capability.ai.testing') : t('settings.capability.ai.test')}
                  </Button>
                </div>

                <div className="settings-form-grid">
                  <label className="settings-field settings-field-span">
                    <span className="settings-field-label">{t('settings.capability.ai.provider')}</span>
                    <Select
                      value={activeAiProvider ?? ''}
                      onChange={(event) => updateActiveAiProvider((event.target.value || null) as AiProviderId | null)}
                    >
                      <option value="">None</option>
                      {aiProviderOptions.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.label}
                        </option>
                      ))}
                    </Select>
                  </label>

                  {activeAiProvider ? (
                    <>
                      <label className="settings-field settings-field-span">
                        <span className="settings-field-label">{t('settings.capability.ai.apiKey')}</span>
                        <Input
                          type="password"
                          value={settings?.aiService.providers[activeAiProvider].apiKey ?? ''}
                          onChange={(event) => updateAiService(activeAiProvider, 'apiKey', event.target.value)}
                          placeholder="sk-..."
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field-label">{t('settings.capability.ai.baseUrl')}</span>
                        <Input
                          type="text"
                          value={settings?.aiService.providers[activeAiProvider].baseURL ?? ''}
                          onChange={(event) => updateAiService(activeAiProvider, 'baseURL', event.target.value)}
                          placeholder="https://api.example.com/v1"
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field-label">{t('settings.capability.ai.model')}</span>
                        <Input
                          type="text"
                          value={settings?.aiService.providers[activeAiProvider].model ?? ''}
                          onChange={(event) => updateAiService(activeAiProvider, 'model', event.target.value)}
                          placeholder="gpt-5-mini"
                        />
                      </label>
                    </>
                  ) : null}
                </div>

                {aiTestMessage ? (
                  <div className={`settings-status-message ${aiTestMessage.tone === 'success' ? 'is-success' : 'is-error'}`}>
                    {aiTestMessage.message}
                  </div>
                ) : null}

                <div className="settings-action-row">
                  {aiProviderOptions.map((provider) => (
                    <Badge key={provider.id} variant={provider.id === activeAiProvider ? 'default' : 'outline'}>
                      {provider.label}
                    </Badge>
                  ))}
                </div>
              </section>

              <section className="settings-surface">
                <div className="settings-surface-heading">
                  <div>
                    <div className="settings-item-title">{t('settings.capability.search.title')}</div>
                    <div className="settings-item-desc">{t('settings.capability.search.desc')}</div>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-item-desc">{t('settings.capability.search.priority')}</div>
                  <div className="settings-row-aside">
                    <Switch
                      checked={settings?.webSearch.enabled ?? false}
                      onCheckedChange={(checked) =>
                        void persistPatch({
                          webSearch: {
                            enabled: checked,
                          },
                        })
                      }
                      aria-label={t('settings.capability.search.enabled')}
                    />
                  </div>
                </div>

                <div className="settings-content-stack">
                  {webSearchProviders.map((provider) => (
                    <div className="settings-content-stack" key={provider.id}>
                      <div className="settings-row">
                        <div className="settings-field settings-field-span">
                          <span className="settings-field-label">{provider.label}</span>
                          <Input
                            type="password"
                            value={settings?.webSearch.providers[provider.id].apiKey ?? ''}
                            onChange={(event) => updateWebSearchField(provider.id, event.target.value)}
                            placeholder="key"
                          />
                        </div>

                        <div className="settings-row-aside">
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
                          <Button size="sm" variant="outline" onClick={() => void window.open(provider.keyUrl, '_blank')}>
                            <Globe size={14} />
                            {t('settings.capability.search.getKey')}
                          </Button>
                        </div>
                      </div>

                      {webSearchTestMessages[provider.id] ? (
                        <div
                          className={`settings-status-message ${webSearchTestMessages[provider.id]?.tone === 'success' ? 'is-success' : 'is-error'}`}
                        >
                          {webSearchTestMessages[provider.id]?.message}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {activeSection === 'translation' && settings && (
            <div className="settings-content-stack">
              <section className="settings-surface">
                <div className="settings-surface-heading">
                  <div>
                    <div className="settings-item-title">{t('settings.translation.engines')}</div>
                  </div>
                </div>

                <div className="settings-engine-grid">
                  {translationEngineOrder.map((engine) => {
                    const enabled = settings.enabledEngines[engine]
                    const isAiEngine = engine === 'ai'

                    return (
                      <div className="settings-engine-item" key={engine}>
                        <div>
                          <div className="settings-engine-name">
                            <Badge variant={enabled ? 'default' : 'outline'} className="settings-engine-badge">
                              {translationEngineLabels[engine]}
                            </Badge>
                          </div>
                          {isAiEngine ? (
                            <div className="settings-item-desc">
                              {t('settings.capability.ai.provider')}：{getProviderLabel(activeAiProvider, t('common.none'))}
                            </div>
                          ) : null}
                        </div>
                        <Switch checked={enabled} onCheckedChange={(checked) => updateEngine(engine, checked)} />
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="settings-surface">
                <div className="settings-surface-heading">
                  <div>
                    <div className="settings-item-title">{t('settings.translation.languages')}</div>
                  </div>
                </div>

                <div className="settings-form-grid">
                  <label className="settings-field">
                    <span className="settings-field-label">{t('settings.translation.first')}</span>
                    <Select value={settings.firstLanguage} onChange={(event) => updateField('firstLanguage', event.target.value)}>
                      {translationLanguages
                        .filter((item) => item.code !== 'auto')
                        .map((languageOption) => (
                          <option key={languageOption.code} value={languageOption.code}>
                            {languageOption.label}
                          </option>
                        ))}
                    </Select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">{t('settings.translation.second')}</span>
                    <Select value={settings.secondLanguage} onChange={(event) => updateField('secondLanguage', event.target.value)}>
                      {translationLanguages
                        .filter((item) => item.code !== 'auto')
                        .map((languageOption) => (
                          <option key={languageOption.code} value={languageOption.code}>
                            {languageOption.label}
                          </option>
                        ))}
                    </Select>
                  </label>
                </div>
              </section>
            </div>
          )}

          {activeSection === 'history' && (
            <div className="settings-content-stack">
              <section className="settings-surface">
                <div className="settings-action-row">
                  <HistoryTabButton
                    active={activeHistoryTab === 'search'}
                    label={t('settings.history.searchTab')}
                    onClick={() => setActiveHistoryTab('search')}
                  />
                  <HistoryTabButton
                    active={activeHistoryTab === 'explain'}
                    label={t('settings.history.explainTab')}
                    onClick={() => setActiveHistoryTab('explain')}
                  />
                </div>

                <div className="settings-surface-heading">
                  <div>
                    <div className="settings-item-title">
                      {activeHistoryTab === 'search' ? t('settings.history.searchSummary') : t('settings.history.explainSummary')}
                    </div>
                    <div className="settings-item-desc">
                      {activeHistoryTab === 'search' ? t('settings.history.retentionSearch') : t('settings.history.retentionExplain')}
                    </div>
                  </div>
                </div>

                <div className="settings-stat-grid">
                  <div className="settings-stat-card">
                    <div className="settings-stat-label">{t('settings.history.total')}</div>
                    <div className="settings-stat-value">{historySummary[activeHistoryTab]?.totalCount ?? 0}</div>
                    <div className="settings-stat-meta">
                      {activeHistoryTab === 'search' ? t('settings.history.searchMeta') : t('settings.history.explainMeta')}
                    </div>
                  </div>

                  <div className="settings-stat-card">
                    <div className="settings-stat-label">{t('settings.history.retention')}</div>
                    <div className="settings-stat-value">
                      {t('settings.history.retentionDays', { count: historySummary[activeHistoryTab]?.retentionDays ?? 0 })}
                    </div>
                    <div className="settings-stat-meta">SQLite</div>
                  </div>

                  <div className="settings-stat-card">
                    <div className="settings-stat-label">
                      {activeHistoryTab === 'search' ? t('settings.history.lastSearch') : t('settings.history.lastExplain')}
                    </div>
                    <div className="settings-stat-value">
                      {formatHistoryTime(historySummary[activeHistoryTab]?.lastActivityAt, language)}
                    </div>
                    <div className="settings-stat-meta">{t('common.lastUpdated')}</div>
                  </div>
                </div>
              </section>

              <section className="settings-surface">
                <div className="settings-row">
                  <div>
                    <div className="settings-item-title">{t('settings.history.storage')}</div>
                  </div>
                  <div className="settings-row-aside">
                    <span className="settings-pill is-on">{t('settings.history.sqlite')}</span>
                  </div>
                </div>

                <div className="settings-history-path">
                  <span className="settings-history-path-icon">
                    <Database size={15} />
                  </span>
                  <span>{historySummary[activeHistoryTab]?.storagePath ?? t('common.loading')}</span>
                </div>

                <div className="settings-action-row">
                  <Button size="sm" onClick={() => void exportHistory(activeHistoryTab)} disabled={Boolean(busyHistoryAction)}>
                    <Download size={14} />
                    {busyHistoryAction === 'export' ? t('settings.history.exporting') : t('settings.history.export')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void clearHistory(activeHistoryTab)}
                    disabled={Boolean(busyHistoryAction)}
                  >
                    <Trash2 size={14} />
                    {busyHistoryAction === 'clear' ? t('settings.history.clearing') : t('settings.history.clear')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void refreshHistory(activeHistoryTab)}>
                    {t('common.reload')}
                  </Button>
                </div>

                {historyMessage ? <div className="settings-history-message">{historyMessage}</div> : null}

                <div className="settings-content-stack">
                  {historyItems[activeHistoryTab].length ? (
                    historyItems[activeHistoryTab].map((item) =>
                      activeHistoryTab === 'search' ? (
                        <SearchHistoryCard key={item.id} item={item as SearchHistoryListItem} />
                      ) : (
                        <ExplainHistoryCard key={item.id} item={item as ExplainHistoryListItem} locale={language} t={t} />
                      )
                    )
                  ) : (
                    <div className="settings-item-desc">{t('settings.history.empty')}</div>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function ThemeButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean
  label: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button type="button" className={`settings-theme-option ${active ? 'is-active' : ''}`} onClick={onClick}>
      <span className="settings-theme-icon">{icon}</span>
      <span className="settings-theme-label">{label}</span>
      {active ? <span className="settings-theme-dot" /> : null}
    </button>
  )
}

function HistoryTabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <Button size="sm" variant={active ? 'default' : 'outline'} onClick={onClick}>
      {label}
    </Button>
  )
}

function SearchHistoryCard({ item }: { item: SearchHistoryListItem }) {
  return (
    <div className="settings-engine-item">
      <div>
        <div className="settings-item-title">{item.query}</div>
        <div className="settings-item-desc">
          {item.actionLabel} · {new Date(item.createdAt).toLocaleString()}
        </div>
      </div>
      <Badge variant="outline">{item.kind}</Badge>
    </div>
  )
}

function ExplainHistoryCard({
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
    <details className="settings-surface">
      <summary className="settings-row">
        <div>
          <div className="settings-item-title">{item.selectionText}</div>
          <div className="settings-item-desc">
            {getProviderLabel(item.aiProvider as AiProviderId, t('common.none'))} · {formatHistoryTime(item.updatedAt, locale)}
          </div>
        </div>
        <div className="settings-row-aside">
          <Badge variant="outline">{t('settings.history.row.turns', { count: turns })}</Badge>
          {sourceCount ? <Badge variant="outline">{t('settings.history.row.sources', { count: sourceCount })}</Badge> : null}
        </div>
      </summary>

      <div className="settings-content-stack">
        {item.messages.map((message) => (
          <div key={message.id} className="settings-engine-item">
            <div>
              <div className="settings-item-title">{message.role === 'user' ? 'User' : 'AI'}</div>
              <div className="settings-item-desc" style={{ whiteSpace: 'pre-wrap' }}>
                {message.text}
              </div>
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}

const getSectionTitle = (section: SettingsSection, t: (key: I18nKey, params?: Record<string, string | number>) => string) => {
  if (section === 'translation') {
    return t('settings.title.translation')
  }

  if (section === 'history') {
    return t('settings.title.history')
  }

  return t('settings.title.general')
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
