import { For, Show } from 'solid-js';
import { content, paths, type Lang } from '../lib/content';
import { PlatformNote } from './PlatformNote';
import DownloadButton from './DownloadButton';
import Icon, { icons } from './Icon';
import Logo from './Logo';
import SelectDemo from './SelectDemo';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';

// The page, as the hz landing pages go, and told the way people use popMind: the first screen with its
// one big bubble and the demo, the apps it works in, then who it is for, one use case each beside the
// app's own window (rendered by its tests), the four ways in, privacy, the models, specs and shortcuts,
// questions, the dark ending and the footer. Its one action is downloading.

const howIcons = [icons.languages, icons.search, icons.pen, icons.clipboard];
const privacyIcons = [icons.code, icons.hardDrive, icons.send, icons.shieldCheck];

// The pictures' sizes, in pixels (2x), as TestRenderSiteAssets makes them.
const shotSize: Record<string, [number, number]> = {
  translate: [840, 860],
  explain: [920, 1080],
  input: [880, 248],
  clipboard: [3000, 680],
};

export default function Home(props: { lang: Lang }) {
  const t = content[props.lang];
  return (
    <div class="site" lang={props.lang === 'zh' ? 'zh-CN' : 'en'}>
      <SiteHeader t={t} lang={props.lang} page="home" />
      <main>
        <section class="hero wrap">
          <p class="eyebrow">{t.hero.eyebrow}</p>
          <h1 class="bubble display">{t.hero.title}</h1>
          <p class="lead">{t.hero.lead}</p>
          <div class="actions">
            <DownloadButton t={t} />
            <a class="button button--large" href="#how">
              {t.hero.how}
            </a>
          </div>
          <PlatformNote t={t} />
          <p class="note">
            {t.hero.note} ·{' '}
            <a class="link" href={paths[props.lang].guide}>
              {t.nav.guide}
            </a>
          </p>
        </section>
        <div class="wrap">
          <div class="showcase">
            <SelectDemo t={t} />
          </div>
        </div>

        <section class="wrap section places">
          <h2 class="h2">{t.places.title}</h2>
          <p class="section-lead">{t.places.lead}</p>
          <ul class="places__list">
            <For each={t.places.apps}>{(a) => <li class="chip">{a}</li>}</For>
            <li class="chip chip--more">{t.places.more}</li>
          </ul>
        </section>

        <section id="how" class="section">
          <div class="wrap">
            <h2 class="h2">{t.personasTitle}</h2>
          </div>
          <For each={t.personas}>
            {(s, i) => {
              const wide = s.shot === 'clipboard';
              const [w, h] = shotSize[s.shot];
              return (
                <article
                  id={s.key}
                  class="wrap split persona"
                  classList={{ 'split--flip': i() % 2 === 1, 'split--wide': wide }}
                >
                  <div class="split__text">
                    <p class="eyebrow">{s.tag}</p>
                    <h3 class="h2 persona__title">{s.title}</h3>
                    <p class="section-lead">{s.lead}</p>
                    <ul class="points">
                      <For each={s.points}>
                        {(p) => (
                          <li>
                            <strong>{p.title}</strong>
                            <span>{p.body}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                  <figure class="split__art shot">
                    <img
                      src={`/shots/${props.lang}/${s.shot}.png`}
                      width={w / 2}
                      height={h / 2}
                      alt={s.alt}
                      loading="lazy"
                      decoding="async"
                    />
                    <Show when={'example' in s && s.example}>
                      {(ex) => (
                        <figcaption class="example">
                          <Icon d={icons.arrowRight} size={20} />
                          <span class="example__out" lang="en">
                            {ex().to}
                          </span>
                        </figcaption>
                      )}
                    </Show>
                  </figure>
                </article>
              );
            }}
          </For>
        </section>

        <section id="features" class="wrap section">
          <h2 class="h2">{t.howTitle}</h2>
          <div class="cards cards--four">
            <For each={t.how}>
              {(s, i) => (
                <article class="card">
                  <div class="card__keys">
                    <span class="card__icon">
                      <Icon d={howIcons[i()]} size={20} />
                    </span>
                    <For each={s.keys}>{(k) => <kbd class="key">{k}</kbd>}</For>
                  </div>
                  <h3 class="h3">{s.title}</h3>
                  <p>{s.body}</p>
                </article>
              )}
            </For>
          </div>
        </section>

        <section id="privacy" class="wrap section">
          <h2 class="h2">{t.privacy.title}</h2>
          <p class="section-lead">{t.privacy.lead}</p>
          <div class="cards cards--four">
            <For each={t.privacy.items}>
              {(p, i) => (
                <article class="card card--line">
                  <span class="card__icon card__icon--brand">
                    <Icon d={privacyIcons[i()]} size={20} />
                  </span>
                  <h3 class="h3">{p.title}</h3>
                  <p>{p.body}</p>
                </article>
              )}
            </For>
          </div>
        </section>

        <section id="models" class="wrap section">
          <h2 class="h2">{t.models.title}</h2>
          <p class="section-lead">{t.models.lead}</p>
          <div class="models">
            <For each={t.models.groups}>
              {(g) => (
                <div class="models__group">
                  <h3 class="models__name">{g.name}</h3>
                  <ul class="models__list">
                    <For each={g.items}>{(m) => <li class="tag tag--gray">{m}</li>}</For>
                  </ul>
                </div>
              )}
            </For>
          </div>
        </section>

        <section class="wrap section">
          <h2 class="h2">{t.facts.title}</h2>
          <div class="facts">
            <For each={t.facts.items}>
              {(s) => (
                <div class="fact">
                  <strong>{s.value}</strong>
                  <span>{s.label}</span>
                </div>
              )}
            </For>
          </div>
        </section>

        <section id="specs" class="wrap section">
          <h2 class="h2">{t.specs.title}</h2>
          <p class="section-lead">{t.specs.lead}</p>
          <div class="tables">
            <table class="table">
              <caption>{t.specs.specsCaption}</caption>
              <tbody>
                <For each={t.specs.specs}>
                  {([k, v]) => (
                    <tr>
                      <th scope="row">{k}</th>
                      <td>{v}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <table class="table">
              <caption>{t.specs.keysCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.specs.keysHead[0]}</th>
                  <th scope="col">{t.specs.keysHead[1]}</th>
                </tr>
              </thead>
              <tbody>
                <For each={t.specs.keys}>
                  {([k, ks]) => (
                    <tr>
                      <th scope="row">{k}</th>
                      <td>
                        <span class="keys">
                          <For each={ks}>{(key) => <kbd class="key key--small">{key}</kbd>}</For>
                        </span>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </section>

        <section id="faq" class="wrap section faq">
          <h2 class="h2">{t.faqTitle}</h2>
          <For each={t.faq}>
            {(f) => (
              <details>
                <summary>
                  {f.q}
                  <Icon d={icons.chevronDown} size={20} />
                </summary>
                <p>{f.a}</p>
              </details>
            )}
          </For>
        </section>

        <section class="ending">
          <div class="wrap ending__inner">
            <Logo size={72} />
            <h2 class="h2">{t.cta.title}</h2>
            <p>{t.cta.lead}</p>
            <DownloadButton t={t} label="cta" note />
          </div>
        </section>
      </main>
      <SiteFooter t={t} />
    </div>
  );
}
