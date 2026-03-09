import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/app/components/ui/badge'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Select } from '@/app/components/ui/select'
import { Switch } from '@/app/components/ui/switch'
import { useConveyor } from '@/app/hooks/use-conveyor'
import type { ThemeMode } from '@/lib/theme/shared'
import { translationLanguages } from '@/lib/translation/shared'
import type { TranslationSettings } from '@/lib/translation/types'
import { Bot, Languages, LockKeyhole, Moon, Monitor, SearchCheck, Sun } from 'lucide-react'
import './styles.css'

type PermissionStatus = {
  granted: boolean
  supported: boolean
}

type SettingsSection = 'general' | 'translation' | 'ai'

type NavItem = {
  id: SettingsSection
  label: string
  icon: typeof SearchCheck
}

const navItems: NavItem[] = [
  { id: 'general', label: '常规', icon: SearchCheck },
  { id: 'translation', label: '翻译', icon: Languages },
  { id: 'ai', label: 'AI 配置', icon: Bot },
]

export function SettingsPage() {
  const app = useConveyor('app')
  const translation = useConveyor('translation')
  const { windowShowRoute } = useConveyor('window')
  const [status, setStatus] = useState<PermissionStatus | null>(null)
  const [settings, setSettings] = useState<TranslationSettings | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const aiSaveTimerRef = useRef<number | null>(null)
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')

  const handleThemeChange = async (mode: ThemeMode) => {
    setThemeMode(mode)
    await app.setThemeMode(mode)
  }

  const refreshStatus = useCallback(async () => {
    const result = await app.checkAccessibility()
    setStatus(result)
  }, [app])

  const refreshTranslationSettings = useCallback(async () => {
    const result = await translation.getSettings()
    setSettings(result)
  }, [translation])

  useEffect(() => {
    void app.getThemeMode().then(setThemeMode)
    void refreshStatus()
    void refreshTranslationSettings()

    const timer = window.setInterval(() => {
      void refreshStatus()
    }, 2500)

    return () => window.clearInterval(timer)
  }, [app, refreshStatus, refreshTranslationSettings])

  const openAccessibilitySettings = async () => {
    await app.openAccessibilitySettings()
  }

  const persistPatch = useCallback(
    async (patch: Parameters<typeof translation.updateSettings>[0]) => {
      setIsSaving(true)

      try {
        const next = await translation.updateSettings(patch)
        setSettings(next)
      } finally {
        setIsSaving(false)
      }
    },
    [translation],
  )

  const updateEngine = (engine: keyof TranslationSettings['enabledEngines'], checked: boolean) => {
    setSettings((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        enabledEngines: {
          ...current.enabledEngines,
          [engine]: checked,
        },
      }
    })

    void persistPatch({
      enabledEngines: {
        [engine]: checked,
      },
    })
  }

  const updateField = <K extends keyof TranslationSettings>(key: K, value: TranslationSettings[K]) => {
    setSettings((current) => (current ? { ...current, [key]: value } : current))

    void persistPatch({
      [key]: value,
    })
  }

  const updateAiField = (key: keyof TranslationSettings['ai'], value: string) => {
    setSettings((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        ai: {
          ...current.ai,
          [key]: value,
        },
      }
    })

    if (aiSaveTimerRef.current) {
      window.clearTimeout(aiSaveTimerRef.current)
    }

    aiSaveTimerRef.current = window.setTimeout(() => {
      void persistPatch({
        ai: {
          [key]: value,
        },
      })
    }, 320)
  }

  const enabledEngineEntries = useMemo(() => {
    if (!settings) {
      return []
    }

    return Object.entries(settings.enabledEngines) as Array<[keyof TranslationSettings['enabledEngines'], boolean]>
  }, [settings])

  useEffect(() => {
    return () => {
      if (aiSaveTimerRef.current) {
        window.clearTimeout(aiSaveTimerRef.current)
      }
    }
  }, [])

  return (
    <div className="settings-shell">
      <div className="settings-backdrop settings-backdrop-one" />
      <div className="settings-backdrop settings-backdrop-two" />

      <section className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-sidebar-top">
            <Button variant="ghost" className="settings-back-button" onClick={() => void windowShowRoute('home')}>
              ← 返回应用
            </Button>

            <div className="settings-brand-block">
              <h1>配置中心</h1>
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
                  <span>
                    <span className="settings-nav-title">{item.label}</span>
                  </span>
                </button>
              )
            })}
          </nav>


        </aside>


        <div className="settings-content">
          <header className="settings-content-header">
            <div>
              <h2>{getSectionTitle(activeSection)}</h2>
            </div>

            {(activeSection === 'translation' || activeSection === 'ai') && (
              <Badge variant="outline" className="settings-inline-badge">
                {isSaving ? '正在保存' : '自动保存'}
              </Badge>
            )}
          </header>

          {activeSection === 'general' && (
            <div className="settings-content-stack">
              <section className="settings-surface">
                <div className="settings-surface-heading">
                  <div>
                    <div className="settings-item-title">外观主题</div>
                  </div>
                </div>

                <div className="settings-theme-grid">
                  <button
                    type="button"
                    className={`settings-theme-option ${themeMode === 'light' ? 'is-active' : ''}`}
                    onClick={() => handleThemeChange('light')}
                  >
                    <span className="settings-theme-icon">
                      <Sun size={18} />
                    </span>
                    <span className="settings-theme-label">明亮</span>
                    {themeMode === 'light' && <span className="settings-theme-dot" />}
                  </button>

                  <button
                    type="button"
                    className={`settings-theme-option ${themeMode === 'dark' ? 'is-active' : ''}`}
                    onClick={() => handleThemeChange('dark')}
                  >
                    <span className="settings-theme-icon">
                      <Moon size={18} />
                    </span>
                    <span className="settings-theme-label">暗黑</span>
                    {themeMode === 'dark' && <span className="settings-theme-dot" />}
                  </button>

                  <button
                    type="button"
                    className={`settings-theme-option ${themeMode === 'system' ? 'is-active' : ''}`}
                    onClick={() => handleThemeChange('system')}
                  >
                    <span className="settings-theme-icon">
                      <Monitor size={18} />
                    </span>
                    <span className="settings-theme-label">跟随系统</span>
                    {themeMode === 'system' && <span className="settings-theme-dot" />}
                  </button>
                </div>
              </section>

              <section className="settings-surface">
                <div className="settings-row">
                  <div>
                    <div className="settings-item-title">辅助功能权限</div>
                  </div>

                  <div className="settings-row-aside">
                    <Switch
                      checked={Boolean(status?.granted)}
                      onCheckedChange={() => {
                        void openAccessibilitySettings()
                      }}
                      aria-label="辅助功能权限状态"
                    />
                    <span className={`settings-pill ${status?.granted ? 'is-on' : 'is-off'}`}>
                      {status?.granted ? '已开启' : '未开启'}
                    </span>
                  </div>
                </div>

                <div className="settings-action-row">
                  <Button size="sm" onClick={openAccessibilitySettings}>
                    <LockKeyhole />
                    前往系统设置
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void refreshStatus()}>
                    重新检测
                  </Button>
                </div>
              </section>
            </div>
          )}

          {activeSection === 'translation' && (
            <div className="settings-content-stack">
              <section className="settings-surface">
                <div className="settings-surface-heading">
                  <div>
                    <div className="settings-item-title">翻译引擎</div>
                  </div>
                </div>

                <div className="settings-engine-grid">
                  {enabledEngineEntries.map(([engine, enabled]) => (
                    <div className="settings-engine-item" key={engine}>
                      <div>
                        <div className="settings-engine-name">
                          <Badge variant={enabled ? 'default' : 'outline'} className="settings-engine-badge">
                            {engine}
                          </Badge>
                        </div>
                        <div className="settings-engine-desc">
                          {engine === 'google'
                            ? 'Web translate'
                            : engine === 'deepl'
                              ? 'DeepL web translate'
                              : engine === 'bing'
                                ? 'Bing web translate'
                                : engine === 'youdao'
                                  ? 'Youdao web translate + word mode'
                                  : 'DeepSeek via Vercel AI SDK'}
                        </div>
                      </div>
                      <Switch
                        checked={enabled}
                        onCheckedChange={(checked) => updateEngine(engine, checked)}
                        aria-label={`${engine} engine switch`}
                      />
                    </div>
                  ))}
                </div>
              </section>

              <section className="settings-surface">
                <div className="settings-surface-heading">
                  <div>
                    <div className="settings-item-title">语言偏好</div>
                  </div>
                </div>

                <div className="settings-form-grid">
                  <label className="settings-field">
                    <span className="settings-field-label">第一语言</span>
                    <Select
                      value={settings?.firstLanguage ?? 'en'}
                      onChange={(event) => updateField('firstLanguage', event.target.value)}
                    >
                      {translationLanguages
                        .filter((language) => language.code !== 'auto')
                        .map((language) => (
                          <option key={language.code} value={language.code}>
                            {language.label}
                          </option>
                        ))}
                    </Select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">第二语言</span>
                    <Select
                      value={settings?.secondLanguage ?? 'zh-CN'}
                      onChange={(event) => updateField('secondLanguage', event.target.value)}
                    >
                      {translationLanguages
                        .filter((language) => language.code !== 'auto')
                        .map((language) => (
                          <option key={language.code} value={language.code}>
                            {language.label}
                          </option>
                        ))}
                    </Select>
                  </label>
                </div>

                <div className="settings-action-row">
                  <Button size="sm" variant="outline" onClick={() => void refreshTranslationSettings()}>
                    重新加载
                  </Button>
                </div>
              </section>
            </div>
          )}

          {activeSection === 'ai' && (
            <div className="settings-content-stack">
              <section className="settings-surface">
                <div className="settings-surface-heading">
                  <div>
                    <div className="settings-item-title">AI 引擎配置</div>
                  </div>
                </div>

                <div className="settings-form-grid">
                  <label className="settings-field settings-field-span">
                    <span className="settings-field-label">DeepSeek API Key</span>
                    <Input
                      type="password"
                      value={settings?.ai.deepseekApiKey ?? ''}
                      onChange={(event) => updateAiField('deepseekApiKey', event.target.value)}
                      placeholder="sk-..."
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">Base URL</span>
                    <Input
                      type="text"
                      value={settings?.ai.deepseekBaseUrl ?? ''}
                      onChange={(event) => updateAiField('deepseekBaseUrl', event.target.value)}
                      placeholder="https://api.deepseek.com"
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">Model</span>
                    <Input
                      type="text"
                      value={settings?.ai.deepseekModel ?? ''}
                      onChange={(event) => updateAiField('deepseekModel', event.target.value)}
                      placeholder="deepseek-chat"
                    />
                  </label>
                </div>

                <div className="settings-action-row">
                  <Button size="sm" variant="outline" onClick={() => void refreshTranslationSettings()}>
                    重新加载
                  </Button>
                </div>
              </section>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

const getSectionTitle = (section: SettingsSection) => {
  if (section === 'general') {
    return '常规'
  }

  if (section === 'translation') {
    return '翻译能力配置'
  }

  return 'AI 预留配置'
}
