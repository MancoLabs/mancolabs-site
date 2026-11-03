// Portfolio images for Upwork and Google Business Profile (1600x1200 PNG).
//   1. Captures each live site, desktop and phone, into raw/ (same sizes as the
//      site's screenshot script), and reports anything fixed on screen (pop-ups,
//      cookie banners). The website's own images in src/assets/ are not touched.
//   2. Pulls WERLA's old theme from git (the portfolio screenshots before the
//      redesign) for a before-and-after image.
//   3. Lays each one out with frame.html.
// Usage: node marketing/portfolio/render.mjs [--keep-captures]
import { chromium, devices } from 'playwright-core';
import sharp from 'sharp';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const RAW = join(HERE, 'raw');
const REVIEW = join(ROOT, '.cache/review/portfolio');
const SITES = [
  { slug: 'chen', url: 'https://chennwla.org/' },
  { slug: 'werla', url: 'https://werla.net/' },
  { slug: 'analemma', url: 'https://analemma.us/' },
  // minicine.org's layout is fixed-width and leaves 1440px mostly empty.
  { slug: 'minicine', url: 'https://www.minicine.org/', desktopWidth: 1100 },
];
// The last commit with WERLA's old theme in the portfolio (captured October 12, 2026).
const WERLA_BEFORE = 'c69d11b';

await mkdir(RAW, { recursive: true });
await mkdir(REVIEW, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });

// 1. Fresh captures.
if (!process.argv.includes('--keep-captures')) {
  for (const s of SITES) {
    for (const kind of ['desktop', 'mobile']) {
      const w = s.desktopWidth ?? 1440;
      const opts = kind === 'desktop'
        ? { viewport: { width: w, height: Math.round(w * 0.625) }, deviceScaleFactor: 2 }
        : { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
      const ctx = await browser.newContext(opts);
      const page = await ctx.newPage();
      await page.goto(s.url, { waitUntil: 'load', timeout: 90_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(2500);
      const overlays = await page.evaluate(() => {
        const found = [];
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
          const r = el.getBoundingClientRect();
          if (r.width * r.height > 0) found.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        const dialogs = document.querySelectorAll('dialog[open], [role=dialog]:not([hidden]), [aria-modal=true]').length;
        return { fixed: found, dialogs, cookie: /\bcookies?\b/i.test(document.body.innerText.slice(0, 4000)) };
      });
      await page.screenshot({ path: join(RAW, `${s.slug}-${kind}.png`) });
      console.log(`captured ${s.slug} ${kind} | fixed: ${overlays.fixed.join(', ') || 'none'} | dialogs: ${overlays.dialogs} | "cookie" text: ${overlays.cookie}`);
      await ctx.close();
    }
  }
}

// 2. WERLA's old theme, from git.
for (const [file, out] of [['live-desktop-1600.webp', 'werla-before-desktop.png'], ['live-mobile-600.webp', 'werla-before-mobile.png']]) {
  const buf = execFileSync('git', ['show', `${WERLA_BEFORE}:src/assets/work/werla/${file}`], { cwd: ROOT, maxBuffer: 20 * 1024 * 1024 });
  await sharp(buf).png().toFile(join(RAW, out));
}

// 3. Layouts. Serve the repo, falling back to public/ the way Vite does, so /fonts/ resolves.
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const base of [ROOT, join(ROOT, 'public')]) {
    try {
      const body = await readFile(join(base, path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      return res.end(body);
    } catch {}
  }
  res.writeHead(404).end();
}).listen(0);
const port = server.address().port;

const JOBS = [
  ...SITES.map((s) => ({ query: `slug=${s.slug}`, out: `${s.slug}-1600x1200.png` })),
  { query: 'slug=werla&ba=1', out: 'werla-before-after-1600x1200.png' },
];
for (const job of JOBS) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, colorScheme: 'light' });
  await page.goto(`http://localhost:${port}/marketing/portfolio/frame.html?${job.query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  const png = await page.screenshot({ type: 'png' });
  const info = await sharp(png).png({ compressionLevel: 9 }).toFile(join(HERE, job.out));
  await sharp(png).resize({ width: 400 }).png().toFile(join(REVIEW, job.out.replace('.png', '-400.png')));
  console.log(`${job.out}: ${Math.round(info.size / 1024)} KB`);
  await page.close();
}
await browser.close();
server.close();
