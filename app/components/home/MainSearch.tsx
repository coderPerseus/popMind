import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Lock, Search, Settings2, Sparkles } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { useConveyor } from '@/app/hooks/use-conveyor'
import './styles.css'

type PermissionStatus = {
  granted: boolean
  supported: boolean
}

type CommandItem = {
  id: string
  title: string
  subtitle: string
  badge: string
}

const commandItems: CommandItem[] = [
  {
    id: 'translation',
    title: '划词翻译',
    subtitle: '全局划词入口已经接入，主搜索执行逻辑即将开放。',
    badge: '即将支持',
  },
  {
    id: 'clipboard',
    title: '剪贴板整理',
    subtitle: '后续会补充快捷改写、摘要和多语言处理能力。',
    badge: '规划中',
  },
  {
    id: 'launcher',
    title: '工作流启动器',
    subtitle: '会作为搜索结果的一部分接入，让常用动作直接触发。',
    badge: '占位中',
  },
]

const openSettingsPage = () => {
  window.location.hash = '#/settings'
}

export function MainSearch() {
  const app = useConveyor('app')
  const [query, setQuery] = useState('')
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus | null>(null)

  useEffect(() => {
    app.checkAccessibility().then(setPermissionStatus)
  }, [app])

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return commandItems
    }

    return commandItems.filter((item) => {
      return `${item.title}${item.subtitle}${item.badge}`.toLowerCase().includes(normalized)
    })
  }, [query])

  return (
    <div className="home-shell">
      <div className="home-noise" />

      <section className="home-command-card">
        <header className="home-header">
          <div>
            <p className="home-kicker">popMind</p>
            <h1>一个更轻的搜索入口</h1>
            <p className="home-subtitle">
              主窗口先收敛成 Raycast 风格搜索框，能力列表保留占位，后面再逐步接入动作执行。
            </p>
          </div>

          <Button variant="outline" size="sm" className="home-settings-button" onClick={openSettingsPage}>
            <Settings2 />
            配置
          </Button>
        </header>

        <div className="home-search-shell">
          <div className="home-search-icon">
            <Search />
          </div>
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索动作、能力或即将支持的入口"
            className="home-search-input"
          />
          <div className="home-search-hint">Esc</div>
        </div>

        <div className="home-inline-meta">
          <div className={`home-status-pill ${permissionStatus?.granted ? 'is-ready' : 'is-pending'}`}>
            <Lock size={14} />
            {permissionStatus?.granted ? '辅助功能权限已开启' : '辅助功能权限待开启'}
          </div>
          <div className="home-status-note">当前搜索只展示占位内容，不会触发实际能力。</div>
        </div>

        <div className="home-result-list">
          {filteredItems.map((item) => (
            <article key={item.id} className="home-result-item">
              <div className="home-result-leading">
                <span className="home-result-icon">
                  <Sparkles size={16} />
                </span>
                <div>
                  <div className="home-result-title">{item.title}</div>
                  <div className="home-result-subtitle">{item.subtitle}</div>
                </div>
              </div>

              <div className="home-result-trailing">
                <span className="home-result-badge">{item.badge}</span>
                <ArrowRight size={15} />
              </div>
            </article>
          ))}

          {filteredItems.length === 0 && (
            <div className="home-empty-state">
              <div className="home-empty-title">还没有匹配项</div>
              <div className="home-empty-desc">当前只保留能力占位，你可以先去配置页完成基础设置。</div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
