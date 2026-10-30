import mygo from '../../mygo.json';
import shortcutDefaults from '../../internal/settings/defaults/shortcuts.json';

// The product's facts, read from the app's own files so the site never drifts from what ships: the
// version and the oldest macOS from mygo.json, the shortcuts from the app's defaults. Numbers the app
// does not hold (the download's size) are measured on the release and noted with it.

export const VERSION: string = mygo.version;
export const MIN_MACOS: string = mygo.macos.minimumSystemVersion.replace(/\.0$/, '');
export const LICENSE = 'GPL-3.0';
// The disk image of the release above, as GitHub lists it.
export const DOWNLOAD_SIZE = '6.5 MB';
// When the site's words last changed, for the sitemap and the structured data.
export const CONTENT_UPDATED = '2026-10-28';

const keyNames: Record<string, string> = { Alt: '⌥', CommandOrControl: '⌘', Command: '⌘', Shift: '⇧', Control: '⌃', Space: 'Space' };

// keys turns an accelerator ("CommandOrControl+Shift+I") into the keys a Mac shows (⌘ ⇧ I).
export function keys(accelerator: string): string[] {
  return accelerator.split('+').map((k) => keyNames[k] ?? k);
}

// The shortcuts the app sets by default and handles (the screenshot ones are not wired yet).
export const SHORTCUTS = {
  toggleHome: keys(shortcutDefaults.toggleHome),
  clipboardHistory: keys(shortcutDefaults.clipboardHistory),
  inputTranslation: keys(shortcutDefaults.inputTranslation),
  hideBubble: keys(shortcutDefaults.hideBubble),
};

// Windows: released from v0.9.0. The download buttons send Windows visitors to the installer (the name
// is the stable one CI uploads); false sends them to the releases page instead.
export const WINDOWS_READY = true;
export const WINDOWS_ASSET = 'popMind-windows-x64-setup.exe';
