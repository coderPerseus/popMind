import { For } from 'solid-js';
import { content, paths, type Lang } from '../lib/content';
import DownloadButton from './DownloadButton';
import Icon, { icons } from './Icon';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';

// The install guide: what macOS asks the first time and what to answer, step by step, with the disk image's
// window as the first step's picture.
export default function Guide(props: { lang: Lang }) {
  const t = content[props.lang];
  const g = t.guide;
  return (
    <div class="site" lang={props.lang === 'zh' ? 'zh-CN' : 'en'}>
      <SiteHeader t={t} lang={props.lang} page="guide" />
      <main class="wrap guide">
        <a class="back" href={paths[props.lang].home}>
          <Icon d={icons.arrowLeft} size={16} />
          {g.back}
        </a>
        <h1 class="bubble display">{g.title}</h1>
        <p class="lead">{g.lead}</p>
        <ol class="steps">
          <For each={g.steps}>
            {(s, i) => (
              <li class="step" id={`step-${i() + 1}`}>
                <span class="step__num">{i() + 1}</span>
                <div class="step__body">
                  <h2 class="h3">{s.title}</h2>
                  <p>{s.body}</p>
                  {'image' in s && s.image && (
                    <figure class="shot step__shot">
                      <img src="/dmg-window.png" width="640" height="400" alt={g.dmgAlt} loading="lazy" />
                    </figure>
                  )}
                </div>
              </li>
            )}
          </For>
        </ol>
        <DownloadButton t={t} note />
      </main>
      <SiteFooter t={t} />
    </div>
  );
}
