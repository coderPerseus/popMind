import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatAcceleratorTokens, recordShortcutFromKeyboard } from '@/lib/shortcuts/shared'

const isMac = navigator.platform.toLowerCase().includes('mac')

const MODIFIER_TOKENS: Record<string, string> = isMac
  ? { Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘' }
  : { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Command: 'Win' }

export function ShortcutKeys({ tokens, className }: { tokens: string[]; className?: string }) {
  return (
    <span className={cn('st-keys', className)}>
      {tokens.map((token, index) => (
        <kbd key={`${token}-${index}`} className="st-key">
          {token}
        </kbd>
      ))}
    </span>
  )
}

/**
 * Click to record, like Raycast / macOS System Settings: press a combo to save it,
 * Esc to cancel, Delete to turn the shortcut off.
 */
export function ShortcutRecorder({
  value,
  placeholder,
  recordingLabel,
  invalidLabel,
  clearLabel,
  invalid = false,
  onRecordingChange,
  onChange,
}: {
  value: string
  placeholder: string
  recordingLabel: string
  invalidLabel: string
  clearLabel: string
  invalid?: boolean
  onRecordingChange: (recording: boolean) => void
  onChange: (accelerator: string) => void
}) {
  const [recording, setRecording] = useState(false)
  const [pendingModifiers, setPendingModifiers] = useState<string[]>([])
  const [rejected, setRejected] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const onRecordingChangeRef = useRef(onRecordingChange)
  onRecordingChangeRef.current = onRecordingChange

  useEffect(() => {
    if (!recording) return

    onRecordingChangeRef.current(true)

    const stop = () => {
      setRecording(false)
      setPendingModifiers([])
      setRejected(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const hasModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
      if (event.code === 'Escape' && !hasModifier) {
        stop()
        return
      }
      if ((event.code === 'Backspace' || event.code === 'Delete') && !hasModifier) {
        onChange('')
        stop()
        return
      }

      const result = recordShortcutFromKeyboard(event)
      if (result.kind === 'complete') {
        onChange(result.accelerator)
        stop()
        return
      }

      setPendingModifiers(result.modifiers)
      setRejected(result.kind === 'invalid')
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      event.preventDefault()
      setPendingModifiers((current) =>
        current.filter((modifier) => {
          if (modifier === 'Control') return event.ctrlKey
          if (modifier === 'Alt') return event.altKey
          if (modifier === 'Shift') return event.shiftKey
          if (modifier === 'Command') return event.metaKey
          return false
        })
      )
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node)) stop()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('blur', stop)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('blur', stop)
      onRecordingChangeRef.current(false)
    }
  }, [recording, onChange])

  const tokens = formatAcceleratorTokens(value, isMac)
  const pendingTokens = pendingModifiers.map((modifier) => MODIFIER_TOKENS[modifier] ?? modifier)

  return (
    <span className="st-recorder-wrap">
      <button
        ref={buttonRef}
        type="button"
        className={cn('st-recorder', recording && 'is-recording', (invalid || rejected) && 'is-invalid')}
        onClick={() => setRecording((current) => !current)}
        aria-pressed={recording}
      >
        {recording ? (
          rejected ? (
            <span className="st-recorder-hint">{invalidLabel}</span>
          ) : pendingTokens.length ? (
            <ShortcutKeys tokens={[...pendingTokens, '…']} />
          ) : (
            <span className="st-recorder-hint">{recordingLabel}</span>
          )
        ) : tokens.length ? (
          <ShortcutKeys tokens={tokens} />
        ) : (
          <span className="st-recorder-placeholder">{placeholder}</span>
        )}
      </button>
      {!recording && value ? (
        <button
          type="button"
          className="st-recorder-clear"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={() => onChange('')}
        >
          <X size={11} strokeWidth={2.4} />
        </button>
      ) : null}
    </span>
  )
}
