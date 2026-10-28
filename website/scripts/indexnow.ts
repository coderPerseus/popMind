// Tells the search engines that take IndexNow (Bing, and through it ChatGPT search and Copilot; Yandex,
// Seznam, Naver) that the site's pages changed: run after a deploy. --dry-run lists them without sending.
// Run: bun run seo:indexnow [--dry-run]
import { SITE_URL, paths } from '../lib/content';
import { INDEXNOW_KEY } from '../lib/indexnow';

const host = new URL(SITE_URL).host;
const urlList = [
  paths.zh.home,
  paths.en.home,
  paths.zh.guide,
  paths.en.guide,
  '/llms.txt',
  '/llms-full.txt',
  '/sitemap.xml',
].map((p) => SITE_URL + p);

if (process.argv.includes('--dry-run')) {
  console.log(`IndexNow (dry run), key ${INDEXNOW_KEY} at ${SITE_URL}/${INDEXNOW_KEY}.txt:\n${urlList.join('\n')}`);
  process.exit(0);
}

// The key file must be live first, or the engines refuse the list.
const keyFile = await fetch(`${SITE_URL}/${INDEXNOW_KEY}.txt`);
if (!keyFile.ok || (await keyFile.text()).trim() !== INDEXNOW_KEY) {
  console.error(`The key file ${SITE_URL}/${INDEXNOW_KEY}.txt is not live yet: deploy first.`);
  process.exit(1);
}
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`, urlList }),
});
console.log(`IndexNow: ${res.status} ${res.statusText} for ${urlList.length} URLs`);
process.exit(res.ok ? 0 : 1);
