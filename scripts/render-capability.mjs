// Renders print/capability-statement.html to public/capability-statement.pdf
// (US Letter, tagged for screen readers) with your installed Chrome. Fails if
// the PDF isn't exactly one page. Also saves a PNG preview to .cache/.
// Usage: npm run capability
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/capability-statement.pdf');
const PREVIEW = join(ROOT, '.cache/capability-statement.png');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

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
const url = `http://localhost:${server.address().port}/print/capability-statement.html`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ colorScheme: 'light' });
await page.goto(url, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
if (!fonts.includes('Inter') || !fonts.includes('DM Sans')) throw new Error(`Fonts didn't load: ${fonts.join(', ')}`);

// A screen preview of the sheet, for a quick look.
await page.setViewportSize({ width: 900, height: 1150 });
await mkdir(dirname(PREVIEW), { recursive: true });
await page.locator('body').screenshot({ path: PREVIEW });

await page.emulateMedia({ media: 'print', colorScheme: 'light' });
const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true, tagged: true });
await browser.close();
server.close();

const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
if (pages !== 1) {
  console.error(`The capability statement is ${pages} pages. It must fit on one: trim the copy in print/capability-statement.html.`);
  process.exit(1);
}
await writeFile(OUT, pdf);
console.log(`Wrote public/capability-statement.pdf (1 page, ${Math.round(pdf.length / 1024)} KB). Preview: .cache/capability-statement.png`);
