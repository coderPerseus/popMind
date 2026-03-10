import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Search, Settings2 } from 'lucide-react'
import { useConveyor } from '@/app/hooks/use-conveyor'
import { parseMainSearchCommand } from '@/app/components/home/query-command'
import { useTranslateCommand } from '@/app/components/home/use-translate-command'
import { TranslateCard } from '@/app/components/home/TranslateCard'
import {
  copyTextToClipboard,
  executeMainSearchPlugin,
  getMainSearchResultsCatalog,
  resolveMainSearchResults,
  type MainSearchPluginResult,
} from '@/app/plugins/main-search'
import { getThemeLogoUrl } from '@/app/theme-assets'
import './styles.css'

type LauncherCommandItem = {
  id: string
  title: string
  subtitle: string
  typeLabel: 'Command'
  keywords: string[]
  trigger: '/tr' | '/翻译'
}

type LauncherItem =
  | { kind: 'plugin'; item: MainSearchPluginResult }
  | { kind: 'command'; item: LauncherCommandItem }

type LauncherSection = {
  id: string
  title: string
  items: LauncherItem[]
}

const launcherCommands: LauncherCommandItem[] = [
  {
    id: 'command.translate.en',
    title: 'Translate Text',
    subtitle: '/tr',
    typeLabel: 'Command',
    keywords: ['translate', 'tr', 'translation', 'command', '翻译'],
    trigger: '/tr',
  },
  {
    id: 'command.translate.zh',
    title: '翻译文本',
    subtitle: '/翻译',
    typeLabel: 'Command',
    keywords: ['翻译', 'translate', 'command', 'tr'],
    trigger: '/翻译',
  },
]

export function MainSearch() {
  const { webOpenUrl, windowDismissTopmost, windowShowRoute } = useConveyor('window')
  const search = useConveyor('search')
  const [query, setQuery] = useState('')
  const [logoUrl, setLogoUrl] = useState(() => getThemeLogoUrl())
  const [activeIndex, setActiveIndex] = useState(0)
  const [isLaunching, setIsLaunching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim()
  const command = useMemo(() => parseMainSearchCommand(normalizedQuery), [normalizedQuery])

  const translate = useTranslateCommand(command)

  const launcherSections = useMemo(() => {
    if (translate.isActive) {
      return [] as LauncherSection[]
    }

    const pluginItems = normalizedQuery ? resolveMainSearchResults(normalizedQuery) : getMainSearchResultsCatalog()
    const normalizedKeyword = normalizedQuery.toLowerCase()
    const commandItems = launcherCommands.filter((item) => {
      if (!normalizedKeyword) {
        return true
      }

      const haystack = `${item.title} ${item.subtitle} ${item.keywords.join(' ')}`.toLowerCase()
      return haystack.includes(normalizedKeyword)
    })

    const sections: LauncherSection[] = []

    if (pluginItems.length) {
      sections.push({
        id: 'plugins',
        title: normalizedQuery ? 'Matching Plugins' : 'Plugins',
        items: pluginItems.map((item) => ({ kind: 'plugin', item })),
      })
    }

    if (commandItems.length) {
      sections.push({
        id: 'commands',
        title: normalizedQuery ? 'Matching Commands' : 'Commands',
        items: commandItems.map((item) => ({ kind: 'command', item })),
      })
    }

    return sections
  }, [translate.isActive, normalizedQuery])
  const launcherItems = useMemo(() => launcherSections.flatMap((section) => section.items), [launcherSections])
  const activeItem = launcherItems[activeIndex] ?? null

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const syncLogo = () => setLogoUrl(getThemeLogoUrl())
    const observer = new MutationObserver(syncLogo)

    syncLogo()
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })

    return () => observer.disconnect()
  }, [])

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

  const launchPlugin = async (result: MainSearchPluginResult) => {
    if (isLaunching) return

    setIsLaunching(true)
    try {
      await executeMainSearchPlugin(result.id, {
        query: query.trim(),
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
      window.close()
    } finally {
      setIsLaunching(false)
    }
  }

  const activateCommand = (commandItem: LauncherCommandItem) => {
    setQuery(`${commandItem.trigger} `)
    inputRef.current?.focus()
  }

  const handleInputKeyDown = async (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (translate.isActive) {
      if (event.key === 'Enter') {
        event.preventDefault()
        translate.runImmediately()
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
        await launchPlugin(activeItem.item)
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
          placeholder="输入问题，或使用 /tr /翻译 …"
          spellCheck={false}
          autoComplete="off"
        />
        {query && (
          <button
            className="ms-clear"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            aria-label="清空"
          >
            ×
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="ms-divider" />

      {/* Results area */}
      <div className="ms-results">
        {translate.isActive && command.kind === 'translate' ? (
          <TranslateCard command={command} cardState={translate.cardState} />
        ) : launcherSections.length ? (
          <div className="ms-launcher-list">
            {launcherSections.map((section) => (
              <section key={section.id} className="ms-section">
                <div className="ms-section-title">{section.title}</div>
                <div className="ms-result-list">
                  {section.items.map((entry) => {
                    const flatIndex = launcherItems.findIndex((item) => item.kind === entry.kind && item.item.id === entry.item.id)

                    if (entry.kind === 'plugin') {
                      const result = entry.item
                      const logoStyle = {
                        '--ms-logo-bg': result.logo.background,
                        '--ms-logo-fg': result.logo.color,
                      } as CSSProperties

                      return (
                        <button
                          key={result.id}
                          className={`ms-result-item ${flatIndex === activeIndex ? 'is-active' : ''}`}
                          type="button"
                          onMouseEnter={() => setActiveIndex(flatIndex)}
                          onClick={() => void launchPlugin(result)}
                          disabled={isLaunching}
                        >
                          <span className="ms-result-logo" style={logoStyle}>
                            {result.logo.monogram}
                          </span>

                          <span className="ms-result-copy">
                            <span className="ms-result-title-row">
                              <span className="ms-result-title">{result.title}</span>
                              <span className="ms-result-handle">{result.handle}</span>
                            </span>
                          </span>

                          <span className="ms-result-type">{result.typeLabel}</span>
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
                        <span className="ms-command-result-logo">{entry.item.trigger.replace('/', '')}</span>

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
        ) : (
          <div className="ms-empty">
            <div className="ms-empty-title">没有匹配结果</div>
            <div className="ms-empty-desc">试试搜索插件名称，或者输入 `/tr 需要翻译的文本`。</div>
          </div>
        )}
      </div>

      {/* Footer bar */}
      <div className="ms-footer">
        <button className="ms-footer-logo" onClick={() => void windowShowRoute('settings')} aria-label="打开配置">
          <img src={logoUrl} alt="popMind" className="ms-logo-img" />
          <Settings2 size={13} className="ms-footer-settings-icon" />
        </button>

        <div className="ms-footer-shortcut">
          <kbd className="ms-kbd">⌥</kbd>
          <kbd className="ms-kbd">Space</kbd>
        </div>
      </div>
    </div>
  )
}
