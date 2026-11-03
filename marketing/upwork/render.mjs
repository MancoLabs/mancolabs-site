// Renders a cover page to PNG in light and dark: 1600x1200, 1000x750, and a 300px
// preview for checking readability at thumbnail size.
// Usage: node marketing/upwork/render.mjs [cover|cover-consult ...] [light|dark ...]
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const PREVIEW = join(ROOT, '.cache/review/upwork');
const ARGS = process.argv.slice(2);
const SCHEMES = ARGS.filter((a) => a === 'light' || a === 'dark');
if (!SCHEMES.length) SCHEMES.push('light', 'dark');
const PAGES = ARGS.filter((a) => !SCHEMES.includes(a));
if (!PAGES.length) PAGES.push('cover');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

// Serve the repo, falling back to public/ the way Vite does, so /fonts/ resolves.
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

await mkdir(PREVIEW, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
for (const name of PAGES) {
  for (const scheme of SCHEMES) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1, colorScheme: scheme });
    await page.goto(`http://localhost:${port}/marketing/upwork/${name}.html`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).join(', '));
    // The headline must stay inside the 90px side margins.
    const h1 = await page.evaluate(() => Math.round(document.querySelector('h1').getBoundingClientRect().right));
    const png = await page.screenshot({ type: 'png' });
    await sharp(png).toFile(join(HERE, `${name}-${scheme}-1600x1200.png`));
    await sharp(png).resize({ width: 1000, kernel: 'lanczos3' }).png().toFile(join(HERE, `${name}-${scheme}-1000x750.png`));
    await sharp(png).resize({ width: 300, kernel: 'lanczos3' }).png().toFile(join(PREVIEW, `${name}-${scheme}-300.png`));
    console.log(`${name} ${scheme}: done (headline right edge ${h1}px${h1 > 1510 ? ', TOO WIDE' : ''}; fonts loaded: ${fonts})`);
    await page.close();
  }
}
await browser.close();
server.close();
