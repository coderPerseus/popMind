import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/app/components/ui/badge'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Select } from '@/app/components/ui/select'
import { Switch } from '@/app/components/ui/switch'
import { useConveyor } from '@/app/hooks/use-conveyor'
import { translationLanguages } from '@/lib/translation/shared'
import type { TranslationSettings } from '@/lib/translation/types'
import { Bot, Languages, LockKeyhole, SearchCheck, Sparkles } from 'lucide-react'
import './styles.css'

type PermissionStatus = {
  granted: boolean
  supported: boolean
}

type SettingsSection = 'general' | 'translation' | 'ai'

type NavItem = {
  id: SettingsSection
  label: string
  description: string
  icon: typeof SearchCheck
}

const navItems: NavItem[] = [
  {
    id: 'general',
    label: '常规',
    description: '主窗口形态与系统权限',
    icon: SearchCheck,
  },
  {
    id: 'translation',
    label: '翻译',
    description: '引擎与语言偏好',
    icon: Languages,
  },
  {
    id: 'ai',
    label: 'AI 配置',
    description: 'DeepSeek 预留接入信息',
    icon: Bot,
  },
]

const openHomePage = () => {
  window.location.hash = '#/'
}

export function SettingsPage() {
  const app = useConveyor('app')
  const translation = useConveyor('translation')
  const [status, setStatus] = useState<PermissionStatus | null>(null)
  const [settings, setSettings] = useState<TranslationSettings | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')

  const refreshStatus = useCallback(async () => {
    const result = await app.checkAccessibility()
    setStatus(result)
  }, [app])

  const refreshTranslationSettings = useCallback(async () => {
    const result = await translation.getSettings()
    setSettings(result)
  }, [translation])

  useEffect(() => {
    void refreshStatus()
    void refreshTranslationSettings()

    const timer = window.setInterval(() => {
      void refreshStatus()
    }, 2500)

    return () => window.clearInterval(timer)
  }, [refreshStatus, refreshTranslationSettings])

  const openAccessibilitySettings = async () => {
    await app.openAccessibilitySettings()
  }

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
  }

  const updateField = <K extends keyof TranslationSettings>(key: K, value: TranslationSettings[K]) => {
    setSettings((current) => (current ? { ...current, [key]: value } : current))
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
  }

  const saveTranslationSettings = async () => {
    if (!settings) {
      return
    }

    setIsSaving(true)

    try {
      const next = await translation.updateSettings({
        enabledEngines: settings.enabledEngines,
        firstLanguage: settings.firstLanguage,
        secondLanguage: settings.secondLanguage,
        defaultSourceLanguage: settings.defaultSourceLanguage,
        ai: settings.ai,
      })
      setSettings(next)
    } finally {
      setIsSaving(false)
    }
  }

  const enabledEngineEntries = useMemo(() => {
    if (!settings) {
      return []
    }

    return Object.entries(settings.enabledEngines) as Array<[keyof TranslationSettings['enabledEngines'], boolean]>
  }, [settings])

  return (
    <div className="settings-shell">
      <div className="settings-backdrop settings-backdrop-one" />
      <div className="settings-backdrop settings-backdrop-two" />

      <section className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-sidebar-top">
            <Button variant="ghost" className="settings-back-button" onClick={openHomePage}>
              返回应用
            </Button>

            <div className="settings-brand-block">
              <div className="settings-eyebrow">Preferences</div>
              <h1>配置中心</h1>
              <p>保持主窗口极简，把系统权限、翻译偏好和后续能力入口集中收在这里。</p>
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
                    <Icon size={16} />
                  </span>
                  <span>
                    <span className="settings-nav-title">{item.label}</span>
                    <span className="settings-nav-desc">{item.description}</span>
                  </span>
                </button>
              )
            })}
          </nav>

          <div className="settings-sidebar-card">
            <div className="settings-sidebar-card-title">当前主窗口</div>
            <div className="settings-sidebar-card-value">Raycast 式搜索框</div>
            <p>默认亮色模式。当前只展示搜索入口和能力占位，不执行实际动作。</p>
          </div>
        </aside>

        <div className="settings-content">
          <header className="settings-content-header">
            <div>
              <div className="settings-section-kicker">{navItems.find((item) => item.id === activeSection)?.label}</div>
              <h2>{getSectionTitle(activeSection)}</h2>
              <p>{getSectionDescription(activeSection)}</p>
            </div>

            {(activeSection === 'translation' || activeSection === 'ai') && (
              <Button onClick={() => void saveTranslationSettings()} disabled={!settings || isSaving}>
                {isSaving ? '保存中...' : '保存配置'}
              </Button>
            )}
          </header>

          {activeSection === 'general' && (
            <div className="settings-content-stack">
              <section className="settings-surface">
                <div className="settings-surface-heading">
                  <div>
                    <div className="settings-item-title">主窗口逻辑</div>
                    <div className="settings-item-desc">
                      默认进入轻量搜索框，小窗用于快速输入，设置页扩展为双栏结构。
                    </div>
                  </div>
                  <Badge variant="outline" className="settings-inline-badge">
                    Light by default
                  </Badge>
                </div>

                <div className="settings-stat-grid">
                  <div className="settings-stat-card">
                    <div className="settings-stat-label">首页模式</div>
                    <div className="settings-stat-value">搜索框</div>
                    <div className="settings-stat-meta">匹配 Raycast 的轻量入口感受</div>
                  </div>
                  <div className="settings-stat-card">
                    <div className="settings-stat-label">默认主题</div>
                    <div className="settings-stat-value">明亮模式</div>
                    <div className="settings-stat-meta">仍可通过窗口菜单切换深色</div>
                  </div>
                  <div className="settings-stat-card">
                    <div className="settings-stat-label">当前能力</div>
                    <div className="settings-stat-value">占位展示</div>
                    <div className="settings-stat-meta">结果列表先作为后续动作的承载区</div>
                  </div>
                </div>
              </section>

              <section className="settings-surface">
                <div className="settings-row">
                  <div>
                    <div className="settings-item-title">辅助功能权限</div>
                    <div className="settings-item-desc">
                      授权后才能启用系统级划词检测。状态会自动轮询刷新，无需重启应用。
                    </div>
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
                    <div className="settings-item-desc">
                      Google 仍是 MVP 默认路径，其他引擎先保留开关，方便后续逐个落地。
                    </div>
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
                          ? 'MVP default engine'
                          : engine === 'deepl'
                            ? 'Available now via DeepL web translate'
                            : engine === 'bing'
                              ? 'Available now via Bing web translate'
                            : 'Reserved for follow-up integration'}
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
                    <div className="settings-item-desc">
                      源语言仍保持自动检测，目标语言只维护最常用的第一语言和第二语言。
                    </div>
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
                  <Button size="sm" onClick={() => void saveTranslationSettings()} disabled={!settings || isSaving}>
                    {isSaving ? '保存中...' : '保存翻译配置'}
                  </Button>
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
                    <div className="settings-item-desc">
                      当前只预留 DeepSeek 的本地密钥配置，等 AI 翻译或改写能力接入时直接复用。
                    </div>
                  </div>
                  <Badge variant="outline" className="settings-inline-badge">
                    Reserved
                  </Badge>
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
                  <Button size="sm" onClick={() => void saveTranslationSettings()} disabled={!settings || isSaving}>
                    <Sparkles />
                    {isSaving ? '保存中...' : '保存 AI 配置'}
                  </Button>
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
    return '主窗口与系统权限'
  }

  if (section === 'translation') {
    return '翻译能力配置'
  }

  return 'AI 预留配置'
}

const getSectionDescription = (section: SettingsSection) => {
  if (section === 'general') {
    return '这里收纳主窗口呈现方式与系统交互相关设置，保持入口极简但状态可控。'
  }

  if (section === 'translation') {
    return '当前主要维护翻译引擎开关和语言偏好，方便后续把搜索动作接到翻译链路上。'
  }

  return 'AI 能力还没有正式上线，先把账号信息和模型名预留出来，后面直接接通。'
}
