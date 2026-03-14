import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useConveyor } from '@/app/hooks/use-conveyor'
import { resolveAppLanguage, translateMessage, type I18nKey } from '@/lib/i18n/shared'
import type { AppLanguage } from '@/lib/capability/types'

type I18nContextValue = {
  language: AppLanguage
  t: (key: I18nKey, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue>({
  language: 'zh-CN',
  t: (key, params) => translateMessage('zh-CN', key, params),
})

export function AppI18nProvider({ children }: { children: ReactNode }) {
  const capability = useConveyor('capability')
  const [language, setLanguage] = useState<AppLanguage>('zh-CN')

  useEffect(() => {
    let mounted = true

    void capability.getSettings().then((settings) => {
      if (mounted) {
        setLanguage(resolveAppLanguage(settings.appLanguage))
      }
    })

    const unsubscribe = capability.onState((settings) => {
      setLanguage(resolveAppLanguage(settings.appLanguage))
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [capability])

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      t: (key, params) => translateMessage(language, key, params),
    }),
    [language]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useI18n = () => useContext(I18nContext)
