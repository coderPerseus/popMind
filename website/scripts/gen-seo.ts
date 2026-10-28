// Writes the site's files for crawlers into public/, from the same words and facts the pages show, before
// every build (package.json): robots.txt, sitemap.xml, llms.txt and llms-full.txt for AI search, and the
// IndexNow key file. Run: bun scripts/gen-seo.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOWNLOAD_URL, REPO_URL, RELEASES_URL, SITE_URL, content, paths, type Lang } from '../lib/content';
import { CONTENT_UPDATED, DOWNLOAD_SIZE, LICENSE, MIN_MACOS, VERSION } from '../lib/facts';
import { INDEXNOW_KEY } from '../lib/indexnow';

const pub = join(import.meta.dir, '..', 'public');
const write = (name: string, text: string) => writeFileSync(join(pub, name), text);

// The public pages, each with its twin in the other language. "/" is /zh's copy, canonical there.
const pages = [
  { page: 'home', priority: '1.0' },
  { page: 'guide', priority: '0.8' },
] as const;

// robots.txt: everyone may read the pages; Void's page data is not for indexing. Bots with a block of their
// own ignore the "*" block, so each one repeats the Disallow.
const bots = ['*', 'Googlebot', 'Bingbot', 'Baiduspider', 'OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'PerplexityBot', 'ClaudeBot', 'Claude-Web', 'Google-Extended', 'Applebot-Extended', 'Bytespider', 'YouBot'];
write(
  'robots.txt',
  bots.map((b) => `User-agent: ${b}\nAllow: /\nDisallow: /_void/\n`).join('\n') + `\nSitemap: ${SITE_URL}/sitemap.xml\n`,
);

// sitemap.xml: every page in each language, with its alternates and the date its words last changed.
const urls = pages.flatMap(({ page, priority }) =>
  (['zh', 'en'] as Lang[]).map(
    (lang) => `  <url>
    <loc>${SITE_URL}${paths[lang][page]}</loc>
    <lastmod>${CONTENT_UPDATED}</lastmod>
    <priority>${priority}</priority>
    <xhtml:link rel="alternate" hreflang="zh-CN" href="${SITE_URL}${paths.zh[page]}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE_URL}${paths.en[page]}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}${paths.zh[page]}"/>
  </url>`,
  ),
);
write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`,
);

// llms.txt: who popMind is, in a few lines, and where everything is.
const llms = `# popMind

> popMind is a free, open-source (${LICENSE}) macOS app for Apple silicon Macs (macOS ${MIN_MACOS} or later) that acts on the text you select in any app: translate it, have AI explain it and ask follow-ups, copy it, or hand it to ChatGPT, Grok, Perplexity or Google. It also has a ⌥Space launcher (apps, math, /tr, -ai, /ex) and a ⌥V clipboard history. AI features use your own API keys (OpenAI, Anthropic, Google Gemini, Kimi, DeepSeek, custom relays, local Gemma). Chinese name: popMind（macOS 划词 AI 工具）. Current version: ${VERSION}.

- Website: ${SITE_URL}${paths.en.home} (English), ${SITE_URL}${paths.zh.home} (简体中文)
- Download (latest, ${DOWNLOAD_SIZE} disk image): ${DOWNLOAD_URL}
- Source code: ${REPO_URL}
- Releases and changelog: ${RELEASES_URL}

## Pages

- [popMind — home (English)](${SITE_URL}${paths.en.home}): what it does, features, models, specs, shortcuts, FAQ
- [popMind — 首页（简体中文）](${SITE_URL}${paths.zh.home}): 功能、模型、规格、快捷键、常见问题
- [Install guide (English)](${SITE_URL}${paths.en.guide}): download, first launch on macOS, Accessibility permission
- [安装引导（简体中文）](${SITE_URL}${paths.zh.guide}): 下载、首次打开、辅助功能权限

## Optional

- [Full facts, features and FAQ in Markdown](${SITE_URL}/llms-full.txt)
`;
write('llms.txt', llms);

// llms-full.txt: the same, with every fact, feature, shortcut and answer the pages show, in both languages.
const section = (lang: Lang) => {
  const t = content[lang];
  const lines: string[] = [];
  lines.push(`## ${lang === 'zh' ? '简体中文' : 'English'}`, '', `### ${t.hero.title}`, '', t.hero.lead, '');
  lines.push(`### ${t.howTitle}`, '');
  for (const h of t.how) lines.push(`- **${h.title}** (${h.keys.join(' ')}): ${h.body}`);
  lines.push('');
  lines.push(`### ${t.places.title}`, '', t.places.lead, '', `${t.places.apps.join(', ')}, ${t.places.more}.`, '');
  lines.push(`### ${t.personasTitle}`, '');
  for (const s of t.personas) {
    lines.push(`#### ${s.tag}: ${s.title}`, '', s.lead, '');
    for (const p of s.points) lines.push(`- **${p.title}**: ${p.body}`);
    lines.push('');
  }
  lines.push(`### ${t.privacy.title}`, '', t.privacy.lead, '');
  for (const p of t.privacy.items) lines.push(`- **${p.title}**: ${p.body}`);
  lines.push('', `### ${t.models.title}`, '', t.models.lead, '');
  for (const g of t.models.groups) lines.push(`- **${g.name}**: ${g.items.join(', ')}`);
  lines.push('', `### ${t.specs.specsCaption}`, '', `| ${lang === 'zh' ? '项目' : 'Item'} | ${lang === 'zh' ? '内容' : 'Value'} |`, '| --- | --- |');
  for (const [k, v] of t.specs.specs) lines.push(`| ${k} | ${v} |`);
  lines.push('', `### ${t.specs.keysCaption}`, '', `| ${t.specs.keysHead[0]} | ${t.specs.keysHead[1]} |`, '| --- | --- |');
  for (const [k, ks] of t.specs.keys) lines.push(`| ${k} | ${ks.join(' ')} |`);
  lines.push('', `### ${t.faqTitle}`, '');
  for (const f of t.faq) lines.push(`**${f.q}**`, '', f.a, '');
  lines.push(`### ${t.guide.title}`, '', t.guide.lead, '');
  t.guide.steps.forEach((s, i) => lines.push(`${i + 1}. **${s.title}**: ${s.body}`));
  lines.push('');
  return lines.join('\n');
};
write('llms-full.txt', `${llms}\n${section('en')}\n${section('zh')}`);

// The IndexNow key file, which shows search engines the URLs submitted come from this site.
write(`${INDEXNOW_KEY}.txt`, INDEXNOW_KEY);

console.log(`seo: robots.txt, sitemap.xml (${urls.length} urls), llms.txt, llms-full.txt, ${INDEXNOW_KEY}.txt`);
