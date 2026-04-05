import { useState } from 'react'
import { Button } from '@/app/components/ui/button'
import { useConveyor } from '@/app/hooks/use-conveyor'
import { useI18n } from '@/app/i18n'

export type PermissionDiagnostics = {
  supported: boolean
  isPackaged: boolean
  issue: 'adhoc_signature' | null
  isAdhocSigned: boolean | null
  appPath: string | null
  identifier: string | null
  signature: string | null
  teamIdentifier: string | null
} | null

export function MacPermissionIdentityNotice({
  diagnostics,
  onResetDone,
}: {
  diagnostics: PermissionDiagnostics
  onResetDone?: () => void | Promise<void>
}) {
  const app = useConveyor('app')
  const { t } = useI18n()
  const [isResetting, setIsResetting] = useState(false)

  if (!diagnostics?.supported || diagnostics.issue !== 'adhoc_signature') {
    return null
  }

  const handleReset = async () => {
    setIsResetting(true)
    try {
      await app.resetMacPermissionHistory()
      await onResetDone?.()
    } finally {
      setIsResetting(false)
    }
  }

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
      <div className="font-semibold">{t('permissionGuide.identityChanged.title')}</div>
      <p className="mt-1 text-xs leading-relaxed text-amber-800/90 dark:text-amber-100/85">
        {t('permissionGuide.identityChanged.desc')}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void handleReset()} disabled={isResetting}>
          {isResetting ? t('permissionGuide.identityChanged.resetting') : t('permissionGuide.identityChanged.reset')}
        </Button>
      </div>
    </div>
  )
}
