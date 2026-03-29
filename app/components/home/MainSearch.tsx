import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ArrowUpRight, Search, Settings2 } from 'lucide-react'
import { useConveyor } from '@/app/hooks/use-conveyor'
import { useI18n } from '@/app/i18n'
import { parseMainSearchCommand } from '@/app/components/home/query-command'
import { ExplainCard } from '@/app/components/home/ExplainCard'
import { useExplainCommand } from '@/app/components/home/use-explain-command'
import { useTranslateCommand } from '@/app/components/home/use-translate-command'
import { TranslateCard } from '@/app/components/home/TranslateCard'
import { AccessibilityPermission } from '@/app/components/welcome/AccessibilityPermission'
import {
  copyTextToClipboard,
  executeMainSearchPlugin,
  getMainSearchPluginResult,
  getMainSearchResultsCatalog,
  renderMainSearchPluginPanel,
  type MainSearchPluginResult,
} from '@/app/plugins/main-search'
import { getThemeLogoUrl } from '@/app/theme-assets'
import { compareReleaseVersions } from '@/lib/app/release'
import { getMainPlaceholderOptions } from '@/lib/i18n/shared'
import './styles.css'

type LauncherCommandItem = {
  id: string
  kind: 'translate' | 'explain'
  title: string
  subtitle: string
  typeLabel: string
  keywords: string[]
  aliases: string[]
  order: number
}

type InstalledAppItem = {
  name: string
  fileName: string
  bundleId: string
  path: string
  iconDataUrl: string | null
}

type LauncherItem =
  | { kind: 'plugin'; item: MainSearchPluginResult }
  | { kind: 'command'; item: LauncherCommandItem }
  | { kind: 'app'; item: InstalledAppItem }

type LauncherSection = {
  id: string
  title: string
  items: LauncherItem[]
}

const compareByOrder = <T extends { order: number; title: string }>(left: T, right: T) => {
  return left.order - right.order || left.title.localeCompare(right.title)
}

const getPrimaryAlias = (aliases: string[]) => aliases[0] ?? ''

const matchesSlashAliasQuery = (query: string, values: string[]) => {
  const normalizedQuery = query.toLowerCase()
  return values.some((value) => value.toLowerCase().includes(normalizedQuery))
}

const getPluginQueryWithAlias = (pluginItem: MainSearchPluginResult, currentQuery: string) => {
  const alias = getPrimaryAlias(pluginItem.slashAliases)
  const nextText = currentQuery.trim().startsWith('/') ? '' : currentQuery.trim()
  return nextText ? `${alias} ${nextText}` : `${alias} `
}

const getAppInitial = (name: string) => {
  const trimmed = name.trim()
  return (trimmed[0] ?? '?').toUpperCase()
}

const getLauncherItemKey = (item: LauncherItem) => {
  if (item.kind === 'app') {
    return item.item.path
  }

  return item.item.id
}

const pickRandomPlaceholder = (language: 'zh-CN' | 'en', previous?: string) => {
  const options = getMainPlaceholderOptions(language)

  if (!options.length) {
    return ''
  }

  if (options.length === 1) {
    return options[0]
  }

  let next = options[Math.floor(Math.random() * options.length)] ?? options[0]

  while (next === previous) {
    next = options[Math.floor(Math.random() * options.length)] ?? options[0]
  }

  return next
}

export function MainSearch() {
  const { language, t } = useI18n()
  const appApi = useConveyor('app')
  const { onMainWindowReset, onMainWindowSetSearchQuery, webOpenUrl, windowDismissTopmost, windowShowRoute } =
    useConveyor('window')
  const search = useConveyor('search')
  const [query, setQuery] = useState('')
  const [logoUrl, setLogoUrl] = useState(() => getThemeLogoUrl())
  const [activeIndex, setActiveIndex] = useState(0)
  const [isLaunching, setIsLaunching] = useState(false)
  const [installedApps, setInstalledApps] = useState<InstalledAppItem[]>([])
  const [isSearchingApps, setIsSearchingApps] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ version: string; url: string } | null>(null)
  const [placeholder, setPlaceholder] = useState(() => pickRandomPlaceholder(language))
  const inputRef = useRef<HTMLInputElement>(null)
  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim()
  const isAppSearchMode = Boolean(normalizedQuery && !normalizedQuery.startsWith('/'))
  const launcherCommands = useMemo<LauncherCommandItem[]>(
    () => [
      {
        id: 'command.translate',
        kind: 'translate',
        title: t('launcher.command.translate.title'),
        subtitle: t('launcher.command.translate.subtitle'),
        typeLabel: t('main.resultType.command'),
        keywords: ['translate', 'tr', 'translation', 'command', '翻译'],
        aliases: ['/tr', '/translate', '/翻译'],
        order: 1,
      },
      {
        id: 'command.explain',
        kind: 'explain',
        title: t('launcher.command.explain.title'),
        subtitle: t('launcher.command.explain.subtitle'),
        typeLabel: t('main.resultType.command'),
        keywords: ['explain', 'explanation', 'command', '解释', 'ex'],
        aliases: ['/ex', '/explain', '/解释'],
        order: 2,
      },
    ],
    [t]
  )
  const pluginCatalog = useMemo(() => getMainSearchResultsCatalog(language), [language])
  const slashEntries = useMemo(
    () => [
      ...launcherCommands.map((item) => ({
        kind: item.kind,
        id: item.id,
        aliases: item.aliases,
      })),
      ...pluginCatalog.map((item) => ({
        kind: 'plugin' as const,
        id: item.id,
        aliases: item.slashAliases,
      })),
    ],
    [launcherCommands, pluginCatalog]
  )
  const command: any = useMemo(
    () => parseMainSearchCommand(normalizedQuery, slashEntries),
    [normalizedQuery, slashEntries]
  )
  const activePlugin = useMemo(
    () => (command.kind === 'plugin' ? getMainSearchPluginResult(language, command.id, command.text) : null),
    [command, language]
  )
  const activePluginPanel = useMemo(() => {
    if (!activePlugin || activePlugin.mode !== 'panel' || command.kind !== 'plugin') {
      return null
    }

    return renderMainSearchPluginPanel(language, activePlugin.id, {
      query: command.text,
      trigger: command.trigger,
      setQuery,
    })
  }, [activePlugin, command, language])

  const translate = useTranslateCommand(command)
  const explain = useExplainCommand(command)
  const resetTranslate = translate.reset
  const resetExplain = explain.reset

  const launcherSections = useMemo(() => {
    if (translate.isActive || explain.isActive || activePlugin) {
      return [] as LauncherSection[]
    }

    if (isAppSearchMode) {
      return installedApps.length
        ? [
            {
              id: 'apps',
              title: t('main.apps'),
              items: installedApps.map((item) => ({ kind: 'app' as const, item })),
            },
          ]
        : []
    }

    const pluginItems = normalizedQuery.startsWith('/')
      ? pluginCatalog.filter((item) =>
          matchesSlashAliasQuery(normalizedQuery, [item.title, item.handle, ...item.keywords, ...item.slashAliases])
        )
      : pluginCatalog
    const normalizedKeyword = normalizedQuery.toLowerCase()
    const commandItems = [...launcherCommands].sort(compareByOrder).filter((item) => {
      if (!normalizedKeyword) {
        return true
      }

      return matchesSlashAliasQuery(normalizedKeyword, [item.title, item.subtitle, ...item.keywords, ...item.aliases])
    })

    const sections: LauncherSection[] = []

    if (pluginItems.length) {
      sections.push({
        id: 'plugins',
        title: normalizedQuery ? t('main.plugins.matching') : t('main.plugins'),
        items: pluginItems.map((item) => ({ kind: 'plugin', item })),
      })
    }

    if (commandItems.length) {
      sections.push({
        id: 'commands',
        title: normalizedQuery ? t('main.commands.matching') : t('main.commands'),
        items: commandItems.map((item) => ({ kind: 'command', item })),
      })
    }

    return sections
  }, [
    activePlugin,
    explain.isActive,
    installedApps,
    isAppSearchMode,
    launcherCommands,
    normalizedQuery,
    pluginCatalog,
    t,
    translate.isActive,
  ])
  const launcherItems = useMemo(() => launcherSections.flatMap((section) => section.items), [launcherSections])
  const activeItem = launcherItems[activeIndex] ?? null

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setPlaceholder((current) => pickRandomPlaceholder(language, current))
  }, [language])

  useEffect(() => {
    const unsubscribe = onMainWindowReset(() => {
      setQuery('')
      setActiveIndex(0)
      setIsLaunching(false)
      setPlaceholder((current) => pickRandomPlaceholder(language, current))
      resetTranslate()
      resetExplain()
    })

    return () => {
      unsubscribe()
    }
  }, [language, onMainWindowReset, resetExplain, resetTranslate])

  useEffect(() => {
    const unsubscribe = onMainWindowSetSearchQuery((nextQuery) => {
      setQuery(nextQuery)
      setActiveIndex(0)
      setIsLaunching(false)
      resetTranslate()
      resetExplain()
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    })

    return () => {
      unsubscribe()
    }
  }, [onMainWindowSetSearchQuery, resetExplain, resetTranslate])

  useEffect(() => {
    const root = document.documentElement
    const syncLogo = () => setLogoUrl(getThemeLogoUrl())
    const observer = new MutationObserver(syncLogo)

    syncLogo()
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false

    void Promise.all([appApi.version(), appApi.latestRelease()])
      .then(([currentVersion, latestRelease]) => {
        if (cancelled || !latestRelease) {
          return
        }

        if (compareReleaseVersions(latestRelease.version, currentVersion) > 0) {
          setUpdateInfo(latestRelease)
          return
        }

        setUpdateInfo(null)
      })
      .catch(() => {
        if (!cancelled) {
          setUpdateInfo(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [appApi])

  useEffect(() => {
    let cancelled = false

    if (!isAppSearchMode) {
      setInstalledApps([])
      setIsSearchingApps(false)
      return
    }

    setIsSearchingApps(true)

    void appApi
      .searchInstalledApps(normalizedQuery, 8)
      .then((results) => {
        if (!cancelled) {
          setInstalledApps(results)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInstalledApps([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSearchingApps(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [appApi, isAppSearchMode, normalizedQuery])

  // Escape key: go through the shared auto-dismiss controller.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void windowDismissTopmost()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [windowDismissTopmost])

  useEffect(() => {
    setActiveIndex(0)
  }, [normalizedQuery])

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(launcherItems.length - 1, 0)))
  }, [launcherItems.length])

  const launchPlugin = async (result: MainSearchPluginResult, executionQuery = query.trim()) => {
    if (result.mode === 'panel') {
      setQuery(getPluginQueryWithAlias(result, executionQuery))
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }

    if (isLaunching) return
    if (!executionQuery.trim()) return

    setIsLaunching(true)
    try {
      await executeMainSearchPlugin(language, result.id, {
        query: executionQuery.trim(),
        openUrl: webOpenUrl,
        copyText: copyTextToClipboard,
      })
      try {
        await search.recordHistory({
          kind: 'plugin',
          query: query.trim(),
          actionId: result.id,
          actionLabel: result.title,
          metadata: {
            pluginType: result.typeLabel,
          },
        })
      } catch {
        // Ignore history write failure so plugin execution still completes.
      }
      setQuery('')
      window.close()
    } finally {
      setIsLaunching(false)
    }
  }

  const activateCommand = (commandItem: LauncherCommandItem) => {
    setQuery(`${getPrimaryAlias(commandItem.aliases)} `)
    inputRef.current?.focus()
  }

  const activatePluginAlias = (pluginItem: MainSearchPluginResult) => {
    setQuery(`${getPrimaryAlias(pluginItem.slashAliases)} `)
    inputRef.current?.focus()
  }

  const activatePlugin = async (pluginItem: MainSearchPluginResult) => {
    const currentQuery = query.trim()

    if (pluginItem.mode === 'panel') {
      setQuery(getPluginQueryWithAlias(pluginItem, currentQuery))
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }

    if (!currentQuery) {
      activatePluginAlias(pluginItem)
      return
    }

    await launchPlugin(pluginItem, currentQuery)
  }

  const launchInstalledApp = async (appItem: InstalledAppItem) => {
    if (isLaunching) {
      return
    }

    setIsLaunching(true)
    try {
      await appApi.openInstalledApp(appItem.path)
      setQuery('')
      window.close()
    } finally {
      setIsLaunching(false)
    }
  }

  const handleInputKeyDown = async (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (translate.isActive) {
      if (event.key === 'Enter') {
        event.preventDefault()
        translate.runImmediately()
      }
      return
    }

    if (explain.isActive) {
      if (event.key === 'Enter') {
        event.preventDefault()
        explain.runImmediately()
      }
      return
    }

    if (activePlugin?.mode === 'link' && command.kind === 'plugin') {
      if (event.key === 'Enter') {
        event.preventDefault()
        await launchPlugin(activePlugin, command.text)
      }
      return
    }

    if (!launcherItems.length) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => Math.min(current + 1, launcherItems.length - 1))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => Math.max(current - 1, 0))
      return
    }

    if (event.key === 'Enter' && activeItem) {
      event.preventDefault()
      if (activeItem.kind === 'plugin') {
        await activatePlugin(activeItem.item)
      } else if (activeItem.kind === 'app') {
        await launchInstalledApp(activeItem.item)
      } else {
        activateCommand(activeItem.item)
      }
    }
  }

  return (
    <div className="ms-root">
      {/* Search bar — drag region for moving the window */}
      <div className="ms-search-bar" data-tauri-drag-region>
        <span className="ms-search-icon">
          <Search size={20} strokeWidth={2.2} />
        </span>
        <input
          ref={inputRef}
          className="ms-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(event) => void handleInputKeyDown(event)}
          placeholder={placeholder || t('main.placeholder')}
          spellCheck={false}
          autoComplete="off"
        />
        {query && (
          <button
            className="ms-clear"
            onClick={() => {
              setQuery('')
              setPlaceholder((current) => pickRandomPlaceholder(language, current))
              inputRef.current?.focus()
            }}
            aria-label={t('main.clear')}
          >
            ×
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="ms-divider" />

      <div className="ms-permission-guide">
        <AccessibilityPermission />
      </div>

      {/* Results area */}
      <div className="ms-results">
        {translate.isActive && command.kind === 'translate' ? (
          <TranslateCard
            command={command}
            cardState={translate.cardState}
            sourceLanguage={translate.sourceLanguage}
            targetLanguage={translate.targetLanguage}
            engineId={translate.engineId}
            enabledEngineIds={translate.enabledEngineIds}
            copied={translate.copied}
            languages={translate.languages}
            onSourceLanguageChange={translate.setSourceLanguage}
            onTargetLanguageChange={translate.setTargetLanguage}
            onEngineChange={translate.setEngineId}
            onCopy={() => {
              void translate.copyResult()
            }}
            onRetranslate={translate.retranslate}
          />
        ) : explain.isActive && command.kind === 'explain' ? (
          <ExplainCard
            command={command}
            session={explain.session}
            onReexplain={explain.regenerate}
            onSubmitFollowup={explain.submitFollowup}
            onStop={explain.stop}
          />
        ) : activePluginPanel ? (
          activePluginPanel
        ) : activePlugin && command.kind === 'plugin' ? (
          <div className="ms-command-stack">
            <div className="ms-command-chip">
              <span
                className="ms-command-chip-logo"
                style={{ '--ms-logo-bg': activePlugin.logo.background ?? 'rgba(255, 255, 255, 0.92)' } as CSSProperties}
              >
                <img src={activePlugin.logo.src} alt={activePlugin.logo.alt} className="ms-result-logo-img" />
              </span>
              <span>{command.trigger}</span>
              <span className="ms-command-chip-muted">{activePlugin.title}</span>
            </div>

            <section className={`ms-translate-card ${command.text ? '' : 'is-placeholder'}`}>
              <div className="ms-translate-card-header">
                <span className="ms-translate-card-icon is-plugin">
                  <ArrowUpRight size={16} />
                </span>
                <div>
                  <div className="ms-translate-card-title">{activePlugin.title}</div>
                  <div className="ms-translate-card-subtitle">
                    {command.text ? t('main.plugin.openReady') : t('main.plugin.openHint', { title: activePlugin.title })}
                  </div>
                </div>
              </div>

              {command.text ? (
                <div className="ms-translate-source">{command.text}</div>
              ) : (
                <div className="ms-translate-source">{t('main.plugin.example', { trigger: command.trigger })}</div>
              )}
            </section>
          </div>
        ) : launcherSections.length ? (
          <div className="ms-launcher-list">
            {launcherSections.map((section) => (
              <section key={section.id} className="ms-section">
                <div className="ms-section-title">{section.title}</div>
                <div className="ms-result-list">
                  {section.items.map((entry) => {
                    const entryKey = getLauncherItemKey(entry)
                    const flatIndex = launcherItems.findIndex(
                      (item) => item.kind === entry.kind && getLauncherItemKey(item) === entryKey
                    )

                    if (entry.kind === 'plugin') {
                      const result = entry.item
                      const logoStyle = {
                        '--ms-logo-bg': result.logo.background ?? 'rgba(255, 255, 255, 0.92)',
                      } as CSSProperties
                      const secondaryHandle = `${result.handle} · ${getPrimaryAlias(result.slashAliases)}`

                      return (
                        <button
                          key={result.id}
                          className={`ms-result-item ${flatIndex === activeIndex ? 'is-active' : ''}`}
                          type="button"
                          onMouseEnter={() => setActiveIndex(flatIndex)}
                          onClick={() => void activatePlugin(result)}
                          disabled={isLaunching}
                        >
                          <span className="ms-result-logo" style={logoStyle}>
                            <img src={result.logo.src} alt={result.logo.alt} className="ms-result-logo-img" />
                          </span>

                          <span className="ms-result-copy">
                            <span className="ms-result-title-row">
                              <span className="ms-result-title">{result.title}</span>
                              <span className="ms-result-handle">{secondaryHandle}</span>
                            </span>
                          </span>

                          <span className="ms-result-type">{result.typeLabel}</span>
                        </button>
                      )
                    }

                    if (entry.kind === 'app') {
                      const appItem = entry.item

                      return (
                        <button
                          key={appItem.path}
                          className={`ms-result-item is-app-result ${flatIndex === activeIndex ? 'is-active' : ''}`}
                          type="button"
                          onMouseEnter={() => setActiveIndex(flatIndex)}
                          onClick={() => void launchInstalledApp(appItem)}
                          disabled={isLaunching}
                        >
                          <span className="ms-result-logo">
                            {appItem.iconDataUrl ? (
                              <img src={appItem.iconDataUrl} alt={appItem.name} className="ms-result-logo-img" />
                            ) : (
                              <span className="ms-result-logo-fallback">{getAppInitial(appItem.name)}</span>
                            )}
                          </span>

                          <span className="ms-result-copy">
                            <span className="ms-result-title-row">
                              <span className="ms-result-title is-app">{appItem.name}</span>
                            </span>
                          </span>

                          <span className="ms-result-type">{t('main.resultType.app')}</span>
                        </button>
                      )
                    }

                    return (
                      <button
                        key={entry.item.id}
                        className={`ms-result-item ${flatIndex === activeIndex ? 'is-active' : ''}`}
                        type="button"
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        onClick={() => activateCommand(entry.item)}
                      >
                        <span className="ms-command-result-logo">
                          {getPrimaryAlias(entry.item.aliases).replace('/', '')}
                        </span>

                        <span className="ms-result-copy">
                          <span className="ms-result-title-row">
                            <span className="ms-result-title">{entry.item.title}</span>
                            <span className="ms-result-handle">{entry.item.subtitle}</span>
                          </span>
                        </span>

                        <span className="ms-result-type">{entry.item.typeLabel}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : isAppSearchMode && isSearchingApps ? (
          <div className="ms-empty">
            <div className="ms-empty-title">{t('main.searchingAppsTitle')}</div>
            <div className="ms-empty-desc">{t('main.searchingAppsDesc')}</div>
          </div>
        ) : isAppSearchMode ? (
          <div className="ms-empty">
            <div className="ms-empty-title">{t('main.noAppsTitle')}</div>
            <div className="ms-empty-desc">{t('main.noAppsDesc')}</div>
          </div>
        ) : (
          <div className="ms-empty">
            <div className="ms-empty-title">{t('main.emptyTitle')}</div>
            <div className="ms-empty-desc">{t('main.empty')}</div>
          </div>
        )}
      </div>

      {/* Footer bar */}
      <div className="ms-footer">
        <div className="ms-footer-brand">
          <button className="ms-footer-logo" onClick={() => void windowShowRoute('settings')} aria-label={t('main.settingsAria')}>
            <img src={logoUrl} alt="popMind" className="ms-logo-img" />
            <Settings2 size={13} className="ms-footer-settings-icon" />
          </button>
          {updateInfo ? (
            <button
              className="ms-update-badge"
              type="button"
              onClick={() => void webOpenUrl(updateInfo.url)}
              aria-label={t('main.updateAria')}
              title={updateInfo.url}
            >
              {t('main.updateAvailable', { version: updateInfo.version })}
            </button>
          ) : null}
        </div>

        <div className="ms-footer-shortcut">
          <kbd className="ms-kbd">⌥</kbd>
          <kbd className="ms-kbd">Space</kbd>
        </div>
      </div>
    </div>
  )
}
