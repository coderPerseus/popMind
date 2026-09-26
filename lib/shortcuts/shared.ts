// Shared (main + renderer) shortcut definitions. Keep this file free of Electron imports.

export const shortcutActionIds = [
  'toggleHome',
  'clipboardHistory',
  'inputTranslation',
  'screenshotTranslate',
  'screenshotSearch',
  'hideBubble',
] as const

export type ShortcutActionId = (typeof shortcutActionIds)[number]

/** Electron accelerator per action. An empty string means the shortcut is turned off. */
export type ShortcutBindings = Record<ShortcutActionId, string>

export type ShortcutRegistrationState = 'registered' | 'disabled' | 'failed' | 'conflict' | 'suspended'

export interface ShortcutStatus {
  id: ShortcutActionId
  accelerator: string
  state: ShortcutRegistrationState
}

export const defaultShortcutBindings: ShortcutBindings = {
  toggleHome: 'Alt+Space',
  clipboardHistory: 'Alt+V',
  inputTranslation: 'CommandOrControl+Shift+I',
  screenshotTranslate: 'CommandOrControl+Alt+T',
  screenshotSearch: 'CommandOrControl+Alt+S',
  hideBubble: 'CommandOrControl+Shift+X',
}

const MODIFIER_ORDER = ['Control', 'Alt', 'Shift', 'Command'] as const
type Modifier = (typeof MODIFIER_ORDER)[number]

const MODIFIER_ALIASES: Record<string, Modifier | 'CommandOrControl'> = {
  command: 'Command',
  cmd: 'Command',
  super: 'Command',
  meta: 'Command',
  control: 'Control',
  ctrl: 'Control',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'Alt',
  shift: 'Shift',
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
}

const splitAccelerator = (accelerator: string) => {
  const parts = accelerator.split('+')
  // "Command+Plus" is how Electron spells "+", but tolerate a trailing literal "+" too.
  if (accelerator.endsWith('++')) {
    parts.splice(parts.length - 2, 2, 'Plus')
  }
  return parts.map((part) => part.trim()).filter(Boolean)
}

/** Stable form used for duplicate detection: "CommandOrControl" is resolved for the current platform. */
export const canonicalizeAccelerator = (accelerator: string, isMac = true) => {
  const parts = splitAccelerator(accelerator)
  if (!parts.length) return ''

  const modifiers = new Set<Modifier>()
  let key = ''

  for (const part of parts) {
    const alias = MODIFIER_ALIASES[part.toLowerCase()]
    if (alias === 'CommandOrControl') {
      modifiers.add(isMac ? 'Command' : 'Control')
    } else if (alias) {
      modifiers.add(alias)
    } else {
      key = part.length === 1 ? part.toUpperCase() : part
    }
  }

  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].filter(Boolean).join('+')
}

const MAC_MODIFIER_SYMBOLS: Record<Modifier, string> = {
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Command: '⌘',
}

const OTHER_MODIFIER_LABELS: Record<Modifier, string> = {
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Command: 'Win',
}

const KEY_LABELS: Record<string, string> = {
  Space: 'Space',
  Return: '↩',
  Enter: '↩',
  Tab: '⇥',
  Backspace: '⌫',
  Delete: '⌦',
  Escape: 'Esc',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  PageUp: '⇞',
  PageDown: '⇟',
  Home: '↖',
  End: '↘',
  Plus: '+',
}

/** Split an accelerator into display tokens, e.g. "CommandOrControl+Shift+I" → ["⇧", "⌘", "I"]. */
export const formatAcceleratorTokens = (accelerator: string, isMac = true) => {
  const canonical = canonicalizeAccelerator(accelerator, isMac)
  if (!canonical) return []

  return splitAccelerator(canonical).map((part) => {
    if ((MODIFIER_ORDER as readonly string[]).includes(part)) {
      return isMac ? MAC_MODIFIER_SYMBOLS[part as Modifier] : OTHER_MODIFIER_LABELS[part as Modifier]
    }
    return KEY_LABELS[part] ?? part
  })
}

export const normalizeShortcutBindings = (value: unknown, fallback = defaultShortcutBindings): ShortcutBindings => {
  const source = value && typeof value === 'object' ? (value as Partial<Record<string, unknown>>) : {}
  const next = { ...fallback }

  for (const id of shortcutActionIds) {
    const accelerator = source[id]
    if (typeof accelerator === 'string') {
      next[id] = accelerator.trim()
    }
  }

  return next
}

// Map KeyboardEvent.code to an Electron accelerator key. Using `code` (not `key`) keeps
// Option-combos on macOS from turning into special characters such as "å".
const CODE_TO_KEY: Record<string, string> = {
  Space: 'Space',
  Enter: 'Return',
  NumpadEnter: 'Return',
  Tab: 'Tab',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
}

export const keyFromKeyboardCode = (code: string) => {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return CODE_TO_KEY[code] ?? null
}

export type RecordedShortcut =
  | { kind: 'pending'; modifiers: string[] }
  | { kind: 'invalid'; modifiers: string[] }
  | { kind: 'complete'; accelerator: string }

/** Turn a keydown into an accelerator. Requires ⌘/⌃/⌥ unless the key is a function key. */
export const recordShortcutFromKeyboard = (event: {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): RecordedShortcut => {
  const modifiers: Modifier[] = []
  if (event.ctrlKey) modifiers.push('Control')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Command')

  const key = keyFromKeyboardCode(event.code)
  if (!key) {
    return { kind: 'pending', modifiers }
  }

  const isFunctionKey = /^F\d+$/.test(key)
  const hasPrimaryModifier = modifiers.some((modifier) => modifier !== 'Shift')
  if (!hasPrimaryModifier && !isFunctionKey) {
    return { kind: 'invalid', modifiers }
  }

  return { kind: 'complete', accelerator: [...modifiers, key].join('+') }
}
