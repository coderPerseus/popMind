import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useConveyor } from '@/app/hooks/use-conveyor'
import { useI18n } from '@/app/i18n'
import { MacPermissionIdentityNotice, type PermissionDiagnostics } from '@/app/components/permission/MacPermissionIdentityNotice'
import { Button } from '../ui/button'

type PermissionStatus = { granted: boolean; supported: boolean } | null

type PermissionItem = {
  id: 'accessibility' | 'screenRecording'
  title: string
  description: string
  granted: boolean
  onOpen: () => Promise<unknown>
}

export function AccessibilityPermission({ showGrantedState = false }: { showGrantedState?: boolean }) {
  const app = useConveyor('app')
  const { t } = useI18n()
  const [accessibilityStatus, setAccessibilityStatus] = useState<PermissionStatus>(null)
  const [screenRecordingStatus, setScreenRecordingStatus] = useState<PermissionStatus>(null)
  const [diagnostics, setDiagnostics] = useState<PermissionDiagnostics>(null)

  const check = useCallback(async () => {
    const [nextAccessibilityStatus, nextScreenRecordingStatus, nextDiagnostics] = await Promise.all([
      app.checkAccessibility(),
      app.checkScreenRecording(),
      app.getPermissionDiagnostics(),
    ])
    setAccessibilityStatus(nextAccessibilityStatus)
    setScreenRecordingStatus(nextScreenRecordingStatus)
    setDiagnostics(nextDiagnostics)
  }, [app])

  useEffect(() => {
    check()
    // Re-poll while not granted so the UI updates automatically
    // after the user enables the permission in System Settings.
    const id = setInterval(check, 2500)
    return () => clearInterval(id)
  }, [check])

  if (!accessibilityStatus || !screenRecordingStatus) {
    return null
  }

  const items: PermissionItem[] = [
    accessibilityStatus.supported
      ? {
          id: 'accessibility',
          title: t('permissionGuide.accessibility.title'),
          description: t('permissionGuide.accessibility.desc'),
          granted: accessibilityStatus.granted,
          onOpen: () => app.openAccessibilitySettings(),
        }
      : null,
    screenRecordingStatus.supported
      ? {
          id: 'screenRecording',
          title: t('permissionGuide.screenRecording.title'),
          description: t('permissionGuide.screenRecording.desc'),
          granted: screenRecordingStatus.granted,
          onOpen: () => app.openScreenRecordingSettings(),
        }
      : null,
  ].filter((item): item is PermissionItem => item !== null)

  if (!items.length) {
    return null
  }

  const pendingItems = items.filter((item) => !item.granted)

  if (!pendingItems.length && !showGrantedState) {
    return null
  }

  return (
    <AnimatePresence mode="wait">
      {!pendingItems.length ? (
        <Granted key="granted" />
      ) : (
        <NotGranted
          key="pending"
          title={t('permissionGuide.title')}
          description={t('permissionGuide.desc')}
          items={pendingItems}
          diagnostics={diagnostics}
          onRecheck={check}
        />
      )}
    </AnimatePresence>
  )
}

function Granted() {
  const { t } = useI18n()

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.25 }}
      className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-4 py-1.5 text-sm text-emerald-600 dark:text-emerald-400"
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      {t('permissionGuide.granted')}
    </motion.div>
  )
}

function NotGranted({
  title,
  description,
  items,
  diagnostics,
  onRecheck,
}: {
  title: string
  description: string
  items: PermissionItem[]
  diagnostics: PermissionDiagnostics
  onRecheck: () => void
}) {
  const { t } = useI18n()

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.3 }}
      className="w-full rounded-2xl border border-border/60 bg-card/80 px-6 py-5 shadow-lg backdrop-blur-md"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-5 text-amber-500"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <MacPermissionIdentityNotice diagnostics={diagnostics} />

        {items.map((item) => (
          <div key={item.id} className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{item.title}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
              </div>
              <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                {t('common.disabled')}
              </span>
            </div>

            <div className="mt-3">
              <Button size="sm" onClick={() => void item.onOpen()}>
                {t('common.openSettings')}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-3.5"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onRecheck}>
          {t('permissionGuide.refresh')}
        </Button>
      </div>
    </motion.div>
  )
}
