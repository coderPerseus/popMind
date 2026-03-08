import { useEffect, useRef, useState } from 'react'
import { Search, Settings2 } from 'lucide-react'
import { useConveyor } from '@/app/hooks/use-conveyor'
import { getThemeLogoUrl } from '@/app/theme-assets'
import './styles.css'

export function MainSearch() {
  const { windowShowRoute } = useConveyor('window')
  const [query, setQuery] = useState('')
  const [logoUrl, setLogoUrl] = useState(() => getThemeLogoUrl())
  const inputRef = useRef<HTMLInputElement>(null)

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

  // Escape key: hide the main window (window-manager intercepts close → hide)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.close()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

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
          placeholder="搜索动作、能力…"
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
        <div className="ms-empty" />
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
