// Checks what crawlers get from the site, page by page, as Googlebot: run against a preview or the live
// site. Run: bun run seo:check [base URL, default http://localhost:4173]
import { SITE_URL, content, paths, type Lang } from '../lib/content';
import { INDEXNOW_KEY } from '../lib/indexnow';

const base = (process.argv[2] ?? 'http://localhost:4173').replace(/\/$/, '');
const UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${what}`);
};

const get = (path: string) => fetch(base + path, { headers: { 'User-Agent': UA }, redirect: 'manual' });

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const one = (html: string, re: RegExp) => html.match(re)?.[1];
const all = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);

const pagesToCheck: { path: string; lang: Lang; page: 'home' | 'guide'; canonical: string }[] = [
  { path: '/', lang: 'zh', page: 'home', canonical: paths.zh.home },
  ...(['zh', 'en'] as Lang[]).flatMap((lang) => [
    { path: paths[lang].home, lang, page: 'home' as const, canonical: paths[lang].home },
    { path: paths[lang].guide, lang, page: 'guide' as const, canonical: paths[lang].guide },
  ]),
];

const titles = new Map<string, string>();
for (const p of pagesToCheck) {
  console.log(`\n${p.path}`);
  const res = await get(p.path);
  check(res.status === 200, `status 200 (got ${res.status})`);
  const html = await res.text();
  const lang = p.lang === 'zh' ? 'zh-CN' : 'en';
  check(one(html, /<html[^>]*\blang="([^"]+)"/) === lang, `<html lang="${lang}">`);
  const title = one(html, /<title>([^<]*)<\/title>/) ?? '';
  check(title.length > 10 && (title.match(/popMind/g) ?? []).length === 1, `one title naming popMind once: ${title}`);
  if (p.path !== '/') {
    check(!titles.has(title), 'title unique among canonical pages');
    titles.set(title, p.path);
  }
  const desc = one(html, /<meta name="description" content="([^"]*)"/) ?? '';
  const [lo, hi] = p.lang === 'zh' ? [40, 120] : [80, 170];
  check(desc.length >= lo && desc.length <= hi, `description, ${desc.length} chars (${lo}–${hi})`);
  check(one(html, /<link rel="canonical" href="([^"]+)"/) === SITE_URL + p.canonical, `canonical ${SITE_URL + p.canonical}`);
  const alt = all(html, /<link rel="alternate" hreflang="([^"]+)"/g).sort().join(',');
  check(alt === 'en,x-default,zh-CN', `hreflang en, zh-CN, x-default (${alt})`);
  for (const tag of ['og:title', 'og:description', 'og:image', 'og:url', 'og:locale']) {
    check(new RegExp(`property="${tag}" content="[^"]+"`).test(html), tag);
  }
  check(/name="twitter:card" content="summary_large_image"/.test(html), 'twitter:card');
  check((html.match(/<h1[\s>]/g) ?? []).length === 1, 'one <h1>');
  check(/<h2[\s>]/.test(html), '<h2> present');
  // Structured data: valid JSON, and its answers and steps are the page's visible text.
  const ld = all(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  check(ld.length === 1, 'one JSON-LD block');
  const data = JSON.parse(ld[0] ?? '{}');
  const graph: any[] = data['@graph'] ?? [];
  const types = graph.map((n) => n['@type']);
  check(types.includes('SoftwareApplication') && types.includes('Organization'), `@graph: ${types.join(', ')}`);
  const visible = decode(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<head>[\s\S]*?<\/head>/, ''));
  if (p.page === 'home') {
    check(/<table[\s>]/.test(html) && /<th scope="row">/.test(html), 'semantic <table> with row headers');
    const faq = graph.find((n) => n['@type'] === 'FAQPage');
    const qa = (faq?.mainEntity ?? []) as any[];
    check(qa.length === content[p.lang].faq.length, `FAQPage has ${qa.length} questions`);
    const missing = qa.filter((q) => !visible.includes(q.name) || !visible.includes(q.acceptedAnswer.text));
    check(missing.length === 0, `FAQ JSON-LD matches visible text${missing.length ? `: ${missing.map((q) => q.name).join(' | ')}` : ''}`);
    // Every page of the site one click away.
    const hrefs = new Set(all(html, /href="([^"#]+)"/g));
    const pages = [paths.zh.home, paths.en.home, paths.zh.guide, paths.en.guide];
    check(pages.every((x) => hrefs.has(x)), 'links to every page');
  } else {
    const how = graph.find((n) => n['@type'] === 'HowTo');
    const steps = (how?.step ?? []) as any[];
    check(steps.length === content[p.lang].guide.steps.length && steps.every((s) => visible.includes(s.text)), 'HowTo steps match visible text');
    check(graph.some((n) => n['@type'] === 'BreadcrumbList'), 'BreadcrumbList');
  }
  check(!/display:\s*none/.test(html.match(/<main[\s\S]*<\/main>/)?.[0] ?? ''), 'no hidden text in <main>');
}

console.log('\nfiles');
const robots = await (await get('/robots.txt')).text();
for (const bot of ['*', 'OAI-SearchBot', 'PerplexityBot', 'ClaudeBot', 'Google-Extended', 'Bytespider']) {
  const block = robots.split(/\n\n/).find((b) => b.startsWith(`User-agent: ${bot}\n`)) ?? '';
  check(block.includes('Disallow: /_void/'), `robots.txt: ${bot} has its Disallow`);
}
check(robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`), 'robots.txt: Sitemap');
const sitemap = await (await get('/sitemap.xml')).text();
const locs = all(sitemap, /<loc>([^<]+)<\/loc>/g);
check(locs.length === 4 && locs.every((l) => sitemap.includes(`hreflang="x-default"`)), `sitemap: ${locs.length} urls with alternates`);
for (const f of ['/llms.txt', '/llms-full.txt']) {
  const res = await get(f);
  check(res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('text/plain'), `${f}: 200 text/plain (${res.headers.get('content-type')})`);
}
const key = await get(`/${INDEXNOW_KEY}.txt`);
check(key.status === 200 && (await key.text()).trim() === INDEXNOW_KEY, 'IndexNow key file');
const missing = await get('/no-such-page');
check(missing.status === 404, `unknown path: 404 (got ${missing.status})`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
