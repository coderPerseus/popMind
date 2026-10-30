import { Show, createSignal, onMount } from 'solid-js';
import type { Content } from '../lib/content';
import { WINDOWS_READY } from '../lib/facts';
import { detectPlatform, type Platform } from '../lib/platform';

// Under the first screen's buttons: a word for Windows and phone visitors, nothing on a Mac.
export function PlatformNote(props: { t: Content }) {
  const [platform, setPlatform] = createSignal<Platform>('mac');
  onMount(() => setPlatform(detectPlatform()));
  const text = () => {
    if (platform() === 'windows' && !WINDOWS_READY) return props.t.download.windowsSoonNote;
    if (platform() === 'mobile') return props.t.download.mobileNote;
    return '';
  };
  return (
    <Show when={text()}>
      <p class="note platform-note">{text()}</p>
    </Show>
  );
}
