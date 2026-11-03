// Renders the Google Business Profile cover: 1920x1080 and 1200x1200 PNGs, plus
// 400px previews in .cache/review/google/ for checking the headline at small sizes.
//   1. The paper scene comes from the site's real 3D hero (?poster mode), with the
//      hero stretched to each shape, saved as scene-wide.png and scene-square.png.
//      Needs a built site (npm run build) and Chrome with a working GPU.
//   2. cover.html is drawn on top: logo, headline, small line, laptop.
// Usage: node marketing/google/render.mjs [long|short] [--keep-scene]
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import sharp from 'sharp';
import { createServer } from 'node:http';
import { readFile, mkdir, access } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const REVIEW = join(ROOT, '.cache/review/google');
const HEADLINE = process.argv.includes('short') ? 'short' : 'long';
const KEEP_SCENE = process.argv.includes('--keep-scene');
const SHAPES = [
  { name: 'wide', w: 1920, h: 1080, out: 'cover-1920x1080.png' },
  { name: 'square', w: 1200, h: 1200, out: 'cover-1200x1200.png' },
];
const HEADER = 73; // the site header's height above the hero

await mkdir(REVIEW, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });

// 1. The paper scene.
if (!KEEP_SCENE) {
  await access(join(ROOT, 'dist/index.html')).catch(() => { throw new Error('Run npm run build first.'); });
  const site = await preview({ root: ROOT, preview: { port: 4181 }, logLevel: 'warn' });
  const base = site.resolvedUrls.local[0].replace(/\/$/, '');
  for (const s of SHAPES) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h + HEADER }, colorScheme: 'light' });
    const page = await ctx.newPage();
    // Stretch the hero to the cover's shape before the scene lays out its papers.
    await page.addInitScript((h) => document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = `.hero{min-height:${h}px!important;height:${h}px!important}`;
      document.head.append(st);
    }), s.h);
    await page.goto(`${base}/?poster`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.posterReady === 'true', null, { timeout: 30000 });
    await page.waitForTimeout(600);
    const top = await page.evaluate(() => document.querySelector('.hero').getBoundingClientRect().top);
    await page.addStyleTag({ content: 'body *{visibility:hidden!important} canvas.stage-canvas{visibility:visible!important}' });
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(HERE, `scene-${s.name}.png`), clip: { x: 0, y: top, width: s.w, height: s.h } });
    await ctx.close();
  }
  await new Promise((r) => site.httpServer.close(r));
}

// 2. The cover. Serve the repo, falling back to public/ the way Vite does, so /fonts/ resolves.
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
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

for (const s of SHAPES) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, colorScheme: 'light' });
  await page.goto(`http://localhost:${port}/marketing/google/cover.html?shape=${s.name}&headline=${HEADLINE}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => {
    const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); };
    return { px: Number(document.documentElement.dataset.headlinePx), h1: box('h1'), art: box('.art svg'), brand: box('.brand'), safe: box('.safe') };
  });
  const png = await page.screenshot({ type: 'png' });
  await sharp(png).toFile(join(HERE, s.out));
  const small = s.w === 1920 ? 400 : 400;
  await sharp(png).resize({ width: small, kernel: 'lanczos3' }).png().toFile(join(REVIEW, s.out.replace('.png', '-400.png')));
  console.log(`${s.out}: headline ${m.px}px (${(m.px * small / s.w).toFixed(1)}px at ${small} wide) | safe ${m.safe} | h1 ${m.h1} | laptop ${m.art}`);
  await page.close();
}
await browser.close();
server.close();
