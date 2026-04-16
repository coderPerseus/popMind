const LEADING_OR_TRAILING_QUOTES = /^[`"'“”‘’]+|[`"'“”‘’]+$/g
const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g

export const ELEVENLABS_PRESET_VOICE_IDS = [
  'JBFqnCBsd6RMkjVDRZzb',
  'EXAVITQu4vr4xnSDxMaL',
  'Xb7hH8MSUJpSbSDYk0k2',
] as const

export const DEFAULT_ELEVENLABS_VOICE_ID = ELEVENLABS_PRESET_VOICE_IDS[0]

export const normalizeElevenLabsVoiceId = (value: string) => {
  return value.trim().replace(ZERO_WIDTH_CHARS, '').replace(LEADING_OR_TRAILING_QUOTES, '')
}
