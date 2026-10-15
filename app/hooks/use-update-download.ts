import { useCallback, useEffect, useState } from 'react'
import { useConveyor } from '@/app/hooks/use-conveyor'
import type { UpdateDownloadState } from '@/lib/app/release'

/** Tracks the in-app update download, which keeps running in the main process across windows. */
export const useUpdateDownload = () => {
  const appApi = useConveyor('app')
  const [downloadState, setDownloadState] = useState<UpdateDownloadState>({ status: 'idle' })

  useEffect(() => {
    let cancelled = false
    const unsubscribe = appApi.onUpdateDownloadState((next) => setDownloadState(next))

    void appApi
      .getUpdateDownloadState()
      .then((current) => {
        if (!cancelled) setDownloadState(current)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [appApi])

  const startDownload = useCallback(() => {
    void appApi
      .downloadAndInstallUpdate()
      .then((result) => setDownloadState(result))
      .catch((error: unknown) =>
        setDownloadState({
          status: 'failed',
          version: null,
          message: error instanceof Error ? error.message : String(error),
        })
      )
  }, [appApi])

  return { downloadState, startDownload }
}

export const getDownloadPercent = (state: UpdateDownloadState) => {
  if (state.status !== 'downloading' || !state.totalBytes) return null
  return Math.min(100, Math.floor((state.receivedBytes / state.totalBytes) * 100))
}
