import type { Content, Lang } from '../lib/content';
import { DOWNLOAD_URL, paths } from '../lib/content';
import Logo from './Logo';

// The nav: 64 high, the mark at the left, the one action at the right. On the guide, the section links
// point back to the home page.
export default function SiteHeader(props: { t: Content; lang: Lang; page: 'home' | 'guide' }) {
  const n = () => props.t.nav;
  const home = () => paths[props.lang].home;
  const other = () => (props.lang === 'zh' ? 'en' : 'zh');
  const section = (id: string) => (props.page === 'home' ? `#${id}` : `${home()}#${id}`);
  return (
    <header class="header">
      <div class="wrap header__inner">
        <a class="brand" href={home()}>
          <Logo size={28} />
          <span>popMind</span>
        </a>
        <nav class="nav" aria-label={props.lang === 'zh' ? '页面导航' : 'Sections'}>
          <a href={section('how')}>{n().how}</a>
          <a href={section('features')}>{n().features}</a>
          <a href={section('models')}>{n().models}</a>
          <a href={section('faq')}>{n().faq}</a>
          <a href={paths[props.lang].guide} aria-current={props.page === 'guide' ? 'page' : undefined}>
            {n().guide}
          </a>
        </nav>
        <div class="header__end">
          <a class="lang" href={paths[other()][props.page]} hreflang={other() === 'zh' ? 'zh-CN' : 'en'}>
            {n().other}
          </a>
          <a class="button button--primary" href={DOWNLOAD_URL}>
            {n().download}
          </a>
        </div>
      </div>
    </header>
  );
}
