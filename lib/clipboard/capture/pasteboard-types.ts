// Pasteboard type lists (spec §5.1). Only allow-listed types are ever read, so apps are not forced to
// render huge lazy data (Office PDF / EMF, etc.) and volatile per-copy types never reach the store.
import { POPMIND_PASTEBOARD_MARKER } from '@/lib/clipboard/types'

export const UTI_TEXT_UTF8 = 'public.utf8-plain-text'
export const UTI_TEXT_UTF16 = 'public.utf16-plain-text'
export const UTI_HTML = 'public.html'
export const UTI_RTF = 'public.rtf'
export const UTI_RTFD = 'com.apple.flat-rtfd'
export const UTI_URL = 'public.url'
export const UTI_URL_NAME = 'public.url-name'
export const UTI_FILE_URL = 'public.file-url'
export const UTI_PNG = 'public.png'

/** Preferred first: PNG is stored as is, the others are decoded and re-encoded to PNG. */
export const IMAGE_UTI_PRIORITY = [UTI_PNG, 'public.tiff', 'public.jpeg', 'public.heic'] as const

export const META_TYPES = ['org.nspasteboard.source', 'com.apple.is-remote-clipboard', POPMIND_PASTEBOARD_MARKER]

export const PASTEBOARD_ALLOW_TYPES: string[] = [
  UTI_TEXT_UTF8,
  UTI_TEXT_UTF16,
  UTI_HTML,
  UTI_RTF,
  UTI_RTFD,
  UTI_URL,
  UTI_URL_NAME,
  ...IMAGE_UTI_PRIORITY,
  UTI_FILE_URL,
  ...META_TYPES,
]

/** Change on every copy of identical content, so they must not influence identity or be stored. */
const VOLATILE_EXACT = new Set([
  'org.chromium.source-url',
  'org.chromium.internal.source-rfh-token',
  'org.chromium.web-custom-data',
  'com.apple.WebKit.custom-pasteboard-data',
  'com.apple.linkpresentation.metadata',
])

export const isVolatileType = (type: string) =>
  type.startsWith('dyn.') || type.startsWith('com.microsoft.ole.source.') || VOLATILE_EXACT.has(type)

/** Word bookmark / cross-reference copies carry both of these and produce junk entries (spec §9 #9). */
export const OFFICE_LINK_TYPES = ['com.microsoft.Link-Source', 'com.microsoft.ObjectLink']

export const isOfficeLinkCopy = (allTypes: string[]) => OFFICE_LINK_TYPES.every((type) => allTypes.includes(type))

export const isImageType = (type: string) => (IMAGE_UTI_PRIORITY as readonly string[]).includes(type)

/** Types worth keeping in `clip_representations` (also used to trim imported legacy payloads). */
export const isStorableType = (type: string) =>
  PASTEBOARD_ALLOW_TYPES.includes(type) && !META_TYPES.includes(type) && !isVolatileType(type)
