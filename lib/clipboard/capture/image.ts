// Image decoding for capture (main process, Electron nativeImage). PNG is taken as is (size from the header);
// tiff / jpeg / heic are decoded and re-encoded to PNG.
import { nativeImage } from 'electron'
import { UTI_PNG } from '@/lib/clipboard/capture/pasteboard-types'
import type { DecodedImage, PasteCandidate } from '@/lib/clipboard/capture/normalize'
import { parsePngSize } from '@/lib/clipboard/store/png'

export const decodeClipboardImage = async (reps: PasteCandidate['imageReps']): Promise<DecodedImage | null> => {
  for (const rep of reps) {
    if (rep.type === UTI_PNG) {
      const size = parsePngSize(rep.data)
      if (size) {
        return { png: rep.data, width: size.width, height: size.height, itemIndex: rep.itemIndex }
      }
    }

    try {
      const image = nativeImage.createFromBuffer(rep.data)
      if (image.isEmpty()) {
        continue
      }

      const { width, height } = image.getSize()
      const png = image.toPNG()
      if (png.length > 0 && width > 0 && height > 0) {
        return { png, width, height, itemIndex: rep.itemIndex }
      }
    } catch {
      // Try the next representation.
    }
  }

  return null
}
