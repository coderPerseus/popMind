import { AUTHOR_URL, REPO_URL, RELEASES_URL, paths, type Content } from '../lib/content';

// The footer: the tagline, every page of the site (each one click from any page), where the project lives,
// and who makes it.
export default function SiteFooter(props: { t: Content }) {
  const f = () => props.t.footer;
  return (
    <footer class="footer">
      <div class="wrap footer__inner">
        <span>{f().tagline}</span>
        <nav class="footer__links" aria-label="Site">
          <a href={paths.zh.home} hreflang="zh-CN">
            中文
          </a>
          <a href={paths.zh.guide} hreflang="zh-CN">
            安装引导
          </a>
          <a href={paths.en.home} hreflang="en">
            English
          </a>
          <a href={paths.en.guide} hreflang="en">
            Install guide
          </a>
        </nav>
        <span class="footer__links">
          <a href={REPO_URL}>{f().github}</a>
          <a href={RELEASES_URL}>{f().releases}</a>
          <a href={`${REPO_URL}/issues`}>{f().feedback}</a>
          <span>© 2026 popMind</span>
          <span>
            {f().by}{' '}
            <a href={AUTHOR_URL} target="_blank" rel="noopener">
              luckySnail
            </a>
          </span>
        </span>
      </div>
    </footer>
  );
}
