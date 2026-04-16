import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type { CapabilitySettings } from '@/lib/capability/types'
import { normalizeElevenLabsVoiceId } from '@/lib/speech-service/shared'
import { isSpeechProviderReady } from '@/lib/translation/shared'

const execFileAsync = promisify(execFile)
const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io'
const ELEVENLABS_DEFAULT_MODEL = 'eleven_multilingual_v2'
const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128'
const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech'
const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini-tts'
const OPENAI_DEFAULT_VOICE = 'alloy'
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

const getErrorMessage = async (response: Response) => {
  try {
    const text = (await response.text()).trim()
    return text || `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

export class MacOsSpeechController {
  private child: ReturnType<typeof spawn> | null = null
  private generation = 0
  private activeRequest: AbortController | null = null
  private activeAudioFile: string | null = null

  isSpeaking() {
    return this.child != null || this.activeRequest != null
  }

  async speak(settings: CapabilitySettings, text: string, onComplete: () => void) {
    if (process.platform !== 'darwin') {
      return false
    }

    const normalizedText = text.trim()
    if (!normalizedText) {
      return false
    }

    this.stop()

    const currentGeneration = ++this.generation
    const providerId = settings.speechService.activeProvider

    if (providerId === 'elevenlabs') {
      if (!isSpeechProviderReady(settings, providerId)) {
        return false
      }

      return this.speakWithElevenLabs(settings, normalizedText, currentGeneration, onComplete)
    }

    if (providerId === 'openai') {
      return this.speakWithOpenAi(settings, normalizedText, currentGeneration, onComplete)
    }

    return this.speakWithSystem(normalizedText, currentGeneration, onComplete)
  }

  stop() {
    this.generation += 1
    this.activeRequest?.abort()
    this.activeRequest = null

    if (this.child) {
      const child = this.child
      this.child = null
      child.kill('SIGTERM')
    }

    void this.cleanupAudioFile()
  }

  private async speakWithSystem(text: string, generation: number, onComplete: () => void) {
    const voice = await resolveEnglishVoice()
    const args = voice ? ['-v', voice] : []
    const child = spawn('say', args, {
      stdio: ['pipe', 'ignore', 'pipe'],
    })

    this.child = child

    child.once('error', () => {
      if (this.generation !== generation) {
        return
      }

      this.child = null
      onComplete()
    })

    child.once('exit', () => {
      if (this.generation !== generation) {
        return
      }

      this.child = null
      onComplete()
    })

    child.stdin.end(text)
    return true
  }

  private async speakWithElevenLabs(
    settings: CapabilitySettings,
    text: string,
    generation: number,
    onComplete: () => void
  ) {
    const config = settings.speechService.providers.elevenlabs
    const voiceId = normalizeElevenLabsVoiceId(config.voiceId)
    const controller = new AbortController()
    this.activeRequest = controller

    const response = await fetch(
      `${ELEVENLABS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
          'xi-api-key': config.apiKey.trim(),
        },
        body: JSON.stringify({
          text,
          model_id: config.modelId.trim() || ELEVENLABS_DEFAULT_MODEL,
          language_code: 'en',
        }),
      }
    )

    if (!response.ok) {
      throw new Error(await getErrorMessage(response))
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer())
    if (this.generation !== generation) {
      return false
    }

    const filePath = join(tmpdir(), `popmind-elevenlabs-${Date.now()}-${randomUUID()}.mp3`)
    await writeFile(filePath, audioBuffer)

    if (this.generation !== generation) {
      await rm(filePath, { force: true })
      return false
    }

    this.activeRequest = null
    this.activeAudioFile = filePath

    const child = spawn('afplay', [filePath], {
      stdio: 'ignore',
    })

    this.child = child

    child.once('error', () => {
      if (this.generation !== generation) {
        return
      }

      this.child = null
      void this.cleanupAudioFile().finally(onComplete)
    })

    child.once('exit', () => {
      if (this.generation !== generation) {
        return
      }

      this.child = null
      void this.cleanupAudioFile().finally(onComplete)
    })

    return true
  }

  private async speakWithOpenAi(settings: CapabilitySettings, text: string, generation: number, onComplete: () => void) {
    const config = settings.speechService.providers.openai
    const apiKey = config.apiKey.trim()
    if (!apiKey) {
      return false
    }

    const controller = new AbortController()
    this.activeRequest = controller

    const response = await fetch(OPENAI_SPEECH_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model.trim() || OPENAI_DEFAULT_MODEL,
        voice: config.voice.trim() || OPENAI_DEFAULT_VOICE,
        input: text,
        response_format: 'mp3',
      }),
    })

    if (!response.ok) {
      throw new Error(await getErrorMessage(response))
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer())
    if (this.generation !== generation) {
      return false
    }

    const filePath = join(tmpdir(), `popmind-openai-tts-${Date.now()}-${randomUUID()}.mp3`)
    await writeFile(filePath, audioBuffer)

    if (this.generation !== generation) {
      await rm(filePath, { force: true })
      return false
    }

    this.activeRequest = null
    this.activeAudioFile = filePath

    const child = spawn('afplay', [filePath], {
      stdio: 'ignore',
    })

    this.child = child

    child.once('error', () => {
      if (this.generation !== generation) {
        return
      }

      this.child = null
      void this.cleanupAudioFile().finally(onComplete)
    })

    child.once('exit', () => {
      if (this.generation !== generation) {
        return
      }

      this.child = null
      void this.cleanupAudioFile().finally(onComplete)
    })

    return true
  }

  private async cleanupAudioFile() {
    const filePath = this.activeAudioFile
    this.activeAudioFile = null

    if (!filePath) {
      return
    }

    try {
      await rm(filePath, { force: true })
    } catch {
      return
    }
  }
}
