import { nativeMacOSAddon } from '@/lib/native/macos-addon'

export class VisionOcrService {
  isSupported() {
    return process.platform === 'darwin' && Boolean(nativeMacOSAddon?.recognizeTextInImageAsync)
  }

  async recognizeText(imagePath: string) {
    if (!this.isSupported() || !nativeMacOSAddon?.recognizeTextInImageAsync) {
      throw new Error('unsupported')
    }

    return nativeMacOSAddon.recognizeTextInImageAsync(imagePath)
  }
}
