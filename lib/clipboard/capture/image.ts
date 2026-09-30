// Image decoding for capture. PNG is taken as is (size from the header). Everything else (tiff / heic / jpeg) is
// re-encoded to PNG by the native addon on a worker thread: Electron's nativeImage cannot decode TIFF or HEIC, and
// re-encoding a large JPEG with it would block the main process.
import { nativeImage } from 'electron'
import { clipboardNative } from '@/lib/clipboard/native-bridge'
import { UTI_PNG } from '@/lib/clipboard/capture/pasteboard-types'
import type { DecodedImage, PasteCandidate } from '@/lib/clipboard/capture/normalize'
import { parsePngSize } from '@/lib/clipboard/store/png'

const decodeWithNativeImage = (data: Buffer) => {
  const image = nativeImage.createFromBuffer(data)
  if (image.isEmpty()) {
    return null
  }

  const { width, height } = image.getSize()
  return { png: image.toPNG(), width, height }
}

export const decodeClipboardImage = async (reps: PasteCandidate['imageReps']): Promise<DecodedImage | null> => {
  for (const rep of reps) {
    if (rep.type === UTI_PNG) {
      const size = parsePngSize(rep.data)
      if (size) {
        return { png: rep.data, width: size.width, height: size.height, itemIndex: rep.itemIndex }
      }
    }

    try {
      const converted = (await clipboardNative.convertImageToPng(rep.data)) ?? decodeWithNativeImage(rep.data)
      if (converted && converted.png.length > 0 && converted.width > 0 && converted.height > 0) {
        return { ...converted, itemIndex: rep.itemIndex }
      }
    } catch {
      // Try the next representation.
    }
  }

  return null
}
