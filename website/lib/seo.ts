import { AUTHOR_URL, DOWNLOAD_URL, REPO_URL, RELEASES_URL, SITE_URL, content, paths, type Lang } from './content';
import { CONTENT_UPDATED, DOWNLOAD_SIZE, LICENSE, MIN_MACOS, VERSION } from './facts';

// What search engines, AI search and link previews read of a page: its title and description, its
// canonical address and its twin in the other language, the share card, and structured data (schema.org)
// built from the same words the page shows: the app, its maker and the questions on the home pages; the
// steps on the install guides. "/" shows the Chinese home page, whose canonical address is /zh.

export type Page = 'home' | 'guide';

const words = {
  zh: {
    home: {
      title: 'popMind — 选中文本，AI 即刻响应 | macOS 划词翻译与 AI 解释',
      description:
        'popMind 是一款免费开源的 macOS 划词 AI 工具：在任何应用里选中文字，就能翻译、AI 解释、追问、复制或跳转 ChatGPT。还有 ⌥Space 搜索框和剪贴板历史，用你自己的 API Key。',
    },
    guide: {
      title: 'popMind 安装引导 — 下载、首次打开与授权',
      description: '五步装好 popMind：下载 DMG 拖进“应用程序”，第一次打开时在“隐私与安全性”里允许运行，授予辅助功能权限，再按需配置 AI 模型和 API Key。',
    },
    keywords: 'Mac 划词翻译, macOS 翻译软件, 划词 AI, AI 解释, Mac 剪贴板历史, Spotlight 替代, 开源翻译工具, popMind',
    locale: 'zh_CN',
    currency: 'CNY',
    homeLabel: '首页',
  },
  en: {
    home: {
      title: 'popMind — select text, AI responds | Translate and explain on macOS',
      description:
        'Free, open-source select-to-AI for macOS: select text in any app to translate it, have AI explain it, or ask follow-ups. Plus a launcher and clipboard history.',
    },
    guide: {
      title: 'Install popMind — download, first launch and permissions',
      description:
        'Install popMind in five steps: drag it to Applications, allow it in Privacy & Security on first launch, grant Accessibility, and set up AI if you like.',
    },
    keywords: 'mac translate selected text, macOS translation app, select to AI, AI explain text, mac clipboard history, spotlight alternative, open source, popMind',
    locale: 'en_US',
    currency: 'USD',
    homeLabel: 'Home',
  },
};

// serializeJsonLd writes data for a <script type="application/ld+json">, with "<" escaped so that no
// text in it (an answer quoting HTML) can close the script.
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

const org = {
  '@type': 'Organization',
  '@id': `${SITE_URL}/#org`,
  name: 'popMind',
  url: SITE_URL,
  logo: `${SITE_URL}/icon.png`,
  sameAs: [REPO_URL],
  founder: { '@type': 'Person', name: 'luckySnail', url: AUTHOR_URL },
};

function app(lang: Lang) {
  const t = content[lang];
  return {
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#app`,
    name: 'popMind',
    alternateName: ['PopMind', 'pop mind'],
    description: words[lang].home.description,
    url: SITE_URL + paths[lang].home,
    applicationCategory: 'UtilitiesApplication',
    applicationSubCategory: lang === 'zh' ? '划词翻译与 AI 助手' : 'Translation and AI assistant',
    operatingSystem: `macOS ${MIN_MACOS} or later (Apple silicon)`,
    softwareVersion: VERSION,
    fileSize: DOWNLOAD_SIZE,
    downloadUrl: DOWNLOAD_URL,
    installUrl: SITE_URL + paths[lang].guide,
    releaseNotes: RELEASES_URL,
    license: `https://spdx.org/licenses/${LICENSE}.html`,
    isAccessibleForFree: true,
    inLanguage: ['zh-CN', 'en'],
    image: `${SITE_URL}/og.png`,
    screenshot: ['translate', 'explain', 'launcher', 'clipboard'].map((s) => `${SITE_URL}/shots/${lang}/${s}.png`),
    featureList: [...t.how.map((h) => h.title), ...t.personas.flatMap((s) => s.points.map((p) => p.title))],
    audience: t.personas.map((p) => ({ '@type': 'Audience', audienceType: p.tag })),
    publisher: { '@id': org['@id'] },
    author: org.founder,
    dateModified: CONTENT_UPDATED,
    offers: { '@type': 'Offer', price: '0', priceCurrency: words[lang].currency },
  };
}

function faq(lang: Lang) {
  return {
    '@type': 'FAQPage',
    '@id': `${SITE_URL}${paths[lang].home}#faq`,
    inLanguage: lang === 'zh' ? 'zh-CN' : 'en',
    mainEntity: content[lang].faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

function howTo(lang: Lang) {
  const g = content[lang].guide;
  const url = SITE_URL + paths[lang].guide;
  return [
    {
      '@type': 'HowTo',
      '@id': `${url}#howto`,
      name: words[lang].guide.title,
      description: words[lang].guide.description,
      inLanguage: lang === 'zh' ? 'zh-CN' : 'en',
      tool: { '@type': 'HowToTool', name: `macOS ${MIN_MACOS}+` },
      step: g.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.title, text: s.body, url: `${url}#step-${i + 1}` })),
      about: { '@id': `${SITE_URL}/#app` },
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: words[lang].homeLabel, item: SITE_URL + paths[lang].home },
        { '@type': 'ListItem', position: 2, name: g.title, item: url },
      ],
    },
  ];
}

export function structuredData(lang: Lang, page: Page) {
  const graph = page === 'home' ? [org, app(lang), faq(lang)] : [org, app(lang), ...howTo(lang)];
  return { '@context': 'https://schema.org', '@graph': graph };
}

export function seoHead(lang: Lang, page: Page = 'home') {
  const w = words[lang];
  const p = w[page];
  const url = SITE_URL + paths[lang][page];
  const image = `${SITE_URL}/og.png`;
  return {
    title: p.title,
    htmlAttrs: { lang: lang === 'zh' ? 'zh-CN' : 'en' },
    meta: [
      { name: 'description', content: p.description },
      { name: 'keywords', content: w.keywords },
      { name: 'robots', content: 'index, follow, max-image-preview:large' },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'popMind' },
      { property: 'og:title', content: p.title },
      { property: 'og:description', content: p.description },
      { property: 'og:url', content: url },
      { property: 'og:image', content: image },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: p.title },
      { property: 'og:locale', content: w.locale },
      { property: 'og:locale:alternate', content: lang === 'zh' ? words.en.locale : words.zh.locale },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: p.title },
      { name: 'twitter:description', content: p.description },
      { name: 'twitter:image', content: image },
    ],
    link: [
      { rel: 'canonical', href: url },
      { rel: 'alternate', hreflang: 'zh-CN', href: SITE_URL + paths.zh[page] },
      { rel: 'alternate', hreflang: 'en', href: SITE_URL + paths.en[page] },
      { rel: 'alternate', hreflang: 'x-default', href: SITE_URL + paths.zh[page] },
      { rel: 'alternate', type: 'text/plain', title: 'llms.txt', href: `${SITE_URL}/llms.txt` },
    ],
    script: [{ type: 'application/ld+json', innerHTML: serializeJsonLd(structuredData(lang, page)) }],
  };
}
