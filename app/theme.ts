import type { ThemeMode } from '@/lib/theme/shared'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export const applyResolvedTheme = (isDark: boolean) => {
  const root = document.documentElement
  root.classList.toggle('dark', isDark)
  root.style.colorScheme = isDark ? 'dark' : 'light'
}

export const applyThemeMode = (mode: ThemeMode) => {
  const isDark = mode === 'dark' || (mode === 'system' && window.matchMedia(DARK_QUERY).matches)
  applyResolvedTheme(isDark)
}

export const syncDocumentThemeWithSystemPreference = () => {
  const media = window.matchMedia(DARK_QUERY)
  const sync = () => applyResolvedTheme(media.matches)

  sync()
  media.addEventListener('change', sync)

  return () => media.removeEventListener('change', sync)
}
