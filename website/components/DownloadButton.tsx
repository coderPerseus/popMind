import { Show, createSignal, onMount } from 'solid-js';
import { DOWNLOAD_URL, RELEASES_URL, WINDOWS_DOWNLOAD_URL, type Content } from '../lib/content';
import { WINDOWS_READY } from '../lib/facts';
import { detectPlatform, type Platform } from '../lib/platform';
import Icon, { icons } from './Icon';

// The download button, for the visitor's system: the Mac's disk image; on Windows, the installer once it
// ships (WINDOWS_READY), until then the releases page; on a phone, a note to come back on a computer.
// It renders the Mac button first (what the prerendered page and crawlers get) and switches after load.
export default function DownloadButton(props: { t: Content; size?: 'large' | 'small'; label?: 'short' | 'cta'; note?: boolean }) {
  const [platform, setPlatform] = createSignal<Platform>('mac');
  onMount(() => setPlatform(detectPlatform()));
  const d = () => props.t.download;
  const href = () => {
    switch (platform()) {
      case 'windows':
        return WINDOWS_READY ? WINDOWS_DOWNLOAD_URL : RELEASES_URL;
      default:
        return DOWNLOAD_URL;
    }
  };
  const text = () => {
    const p = platform();
    if (props.label === 'short') return p === 'windows' && !WINDOWS_READY ? d().windowsSoon : d().short;
    if (p === 'windows') return WINDOWS_READY ? d().windows : d().windowsSoon;
    if (p === 'mobile') return d().mobile;
    if (props.label === 'cta') return props.t.cta.button;
    return d().mac;
  };
  const note = () => {
    const p = platform();
    if (p === 'windows' && !WINDOWS_READY) return d().windowsSoonNote;
    if (p === 'mobile') return d().mobileNote;
    return '';
  };
  return (
    <>
      <a
        class="button button--primary"
        classList={{ 'button--large': props.size !== 'small' }}
        href={href()}
        data-platform={platform()}
      >
        <Show when={props.size !== 'small'}>
          <Icon d={icons.download} size={20} />
        </Show>
        {text()}
      </a>
      <Show when={props.note && note()}>
        <p class="note platform-note">{note()}</p>
      </Show>
    </>
  );
}
