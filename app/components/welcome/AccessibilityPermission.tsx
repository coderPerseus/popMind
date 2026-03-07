import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useConveyor } from '@/app/hooks/use-conveyor'
import { Button } from '../ui/button'

type PermissionStatus = { granted: boolean; supported: boolean } | null

export function AccessibilityPermission() {
  const app = useConveyor('app')
  const [status, setStatus] = useState<PermissionStatus>(null)

  const check = useCallback(async () => {
    const result = await app.checkAccessibility()
    setStatus(result)
  }, [app])

  useEffect(() => {
    check()
    // Re-poll while not granted so the UI updates automatically
    // after the user enables the permission in System Settings.
    const id = setInterval(check, 2500)
    return () => clearInterval(id)
  }, [check])

  if (!status || !status.supported) return null

  return (
    <AnimatePresence mode="wait">
      {status.granted ? <Granted key="granted" /> : <NotGranted key="pending" onOpen={openSettings} onRecheck={check} />}
    </AnimatePresence>
  )

  async function openSettings() {
    await app.openAccessibilitySettings()
  }
}

function Granted() {
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
      辅助功能权限已开启
    </motion.div>
  )
}

function NotGranted({ onOpen, onRecheck }: { onOpen: () => void; onRecheck: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.3 }}
      className="w-full max-w-sm rounded-2xl border border-border/60 bg-card/80 px-6 py-5 shadow-lg backdrop-blur-md"
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
          <h3 className="text-sm font-semibold text-foreground">需要辅助功能权限</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            popMind 需要「辅助功能」权限来启用全局划词功能。请前往系统设置授权后，权限状态将自动更新。
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" onClick={onOpen}>
          前往系统设置
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
        <Button size="sm" variant="ghost" onClick={onRecheck}>
          重新检测
        </Button>
      </div>
    </motion.div>
  )
}
