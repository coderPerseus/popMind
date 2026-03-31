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

export function MacPermissionIdentityNotice({ diagnostics }: { diagnostics: PermissionDiagnostics }) {
  const { t } = useI18n()

  if (!diagnostics?.supported || diagnostics.issue !== 'adhoc_signature') {
    return null
  }

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
      <div className="font-semibold">{t('permissionGuide.identityChanged.title')}</div>
      <p className="mt-1 text-xs leading-relaxed text-amber-800/90 dark:text-amber-100/85">
        {t('permissionGuide.identityChanged.desc')}
      </p>
    </div>
  )
}
