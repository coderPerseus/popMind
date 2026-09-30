// Parsing of `popmind-clip://<kind>/<id>` URLs (pure; used by the protocol handler and its tests).
import type { ClipAssetKind } from '@/lib/clipboard/store/contract'

/** `file-icon/<itemId>` is served by the protocol handler itself (Finder icon of the item's first file). */
export type ClipAssetUrlKind = ClipAssetKind | 'file-icon'

const assetKinds: readonly ClipAssetUrlKind[] = ['thumb', 'image', 'app-icon', 'file-icon']

export type ParsedClipAssetUrl = { kind: ClipAssetUrlKind; id: string }

/**
 * `popmind-clip://thumb/<itemId>`, `popmind-clip://image/<itemId>`, `popmind-clip://app-icon/<bundleId>`,
 * `popmind-clip://file-icon/<itemId>`.
 * Query strings (cache busting) and fragments are ignored. Returns null for anything else.
 */
export const parseClipAssetUrl = (rawUrl: string): ParsedClipAssetUrl | null => {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  const kind = url.hostname.toLowerCase() as ClipAssetUrlKind
  if (!assetKinds.includes(kind)) return null

  let id: string
  try {
    id = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  } catch {
    return null
  }

  // Ids are opaque tokens / bundle ids: never allow path tricks or empty values.
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..') || id.includes('\0')) return null

  return { kind, id }
}
