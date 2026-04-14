import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const preferredEnglishVoices = ['Samantha', 'Alex', 'Daniel', 'Karen', 'Moira', 'Tessa', 'Fiona', 'Serena']

let cachedEnglishVoice: string | null | undefined

const resolveEnglishVoice = async () => {
  if (cachedEnglishVoice !== undefined) {
    return cachedEnglishVoice
  }

  try {
    const { stdout } = await execFileAsync('say', ['-v', '?'])
    const voices = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\S+)\s+([A-Za-z_]+)\s+#/)
        return match ? { name: match[1], locale: match[2] } : null
      })
      .filter((item): item is { name: string; locale: string } => Boolean(item))

    const preferredVoice = preferredEnglishVoices.find((voice) => voices.some((item) => item.name === voice))
    if (preferredVoice) {
      cachedEnglishVoice = preferredVoice
      return cachedEnglishVoice
    }

    cachedEnglishVoice = voices.find((item) => item.locale.toLowerCase().startsWith('en_'))?.name ?? null
    return cachedEnglishVoice
  } catch {
    cachedEnglishVoice = null
    return cachedEnglishVoice
  }
}

export class MacOsSpeechController {
  private child: ReturnType<typeof spawn> | null = null
  private generation = 0

  isSpeaking() {
    return this.child != null
  }

  async speak(text: string, onComplete: () => void) {
    if (process.platform !== 'darwin') {
      return false
    }

    const normalizedText = text.trim()
    if (!normalizedText) {
      return false
    }

    this.stop()

    const currentGeneration = ++this.generation
    const voice = await resolveEnglishVoice()
    const args = voice ? ['-v', voice] : []
    const child = spawn('say', args, {
      stdio: ['pipe', 'ignore', 'pipe'],
    })

    this.child = child

    child.once('error', () => {
      if (this.generation !== currentGeneration) {
        return
      }

      this.child = null
      onComplete()
    })

    child.once('exit', () => {
      if (this.generation !== currentGeneration) {
        return
      }

      this.child = null
      onComplete()
    })

    child.stdin.end(normalizedText)
    return true
  }

  stop() {
    if (!this.child) {
      return
    }

    this.generation += 1
    const child = this.child
    this.child = null
    child.kill('SIGTERM')
  }
}
