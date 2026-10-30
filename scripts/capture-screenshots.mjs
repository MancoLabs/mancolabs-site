// Captures the live client sites (and the archived WERLA "before") and writes
// responsive AVIF/WebP images to src/assets/work/. Uses your installed Chrome.
// Usage: npm run screenshots [-- slug ...]
import { chromium, devices } from 'playwright-core';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const RAW = '.cache/screenshots';
const OUT = 'src/assets/work';

// No WERLA "before": every Wayback capture before July 2026 is missing the old
// site's navigation and cover stylesheets, so none shows the real old design.
const SHOTS = [
  { slug: 'chen', name: 'live', url: 'https://chennwla.org/' },
  { slug: 'analemma', name: 'live', url: 'https://analemma.us/' },
  // Narrower viewport: minicine.org's layout is fixed-width and leaves 1440px mostly empty.
  { slug: 'minicine', name: 'live', url: 'https://www.minicine.org/', desktopWidth: 1100 },
  { slug: 'werla', name: 'live', url: 'https://werla.net/' },
];

const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const MOBILE = { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };

const VARIANTS = [
  { ctx: 'desktop', widths: [480, 800, 1280, 1600] },
  { ctx: 'mobile', widths: [300, 600] },
];

const only = process.argv.slice(2);
const shots = only.length ? SHOTS.filter((s) => only.includes(s.slug)) : SHOTS;

await mkdir(RAW, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });

async function capture(shot, kind) {
  const w = shot.desktopWidth ?? 1440;
  const opts = kind === 'desktop' ? { ...DESKTOP, viewport: { width: w, height: Math.round(w * 0.625) } } : MOBILE;
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  await page.goto(shot.url, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(2500);
  const file = path.join(RAW, `${shot.slug}-${shot.name}-${kind}.png`);
  await page.screenshot({ path: file });
  await context.close();
  return file;
}

for (const shot of shots) {
  const raw = {
    desktop: await capture(shot, 'desktop'),
    mobile: await capture(shot, 'mobile'),
  };
  await mkdir(path.join(OUT, shot.slug), { recursive: true });
  for (const v of VARIANTS) {
    const src = raw[v.ctx];
    for (const w of v.widths) {
      const base = path.join(OUT, shot.slug, `${shot.name}-${v.ctx}-${w}`);
      const img = sharp(src).resize({ width: w });
      await img.clone().avif({ quality: 55, effort: 6 }).toFile(`${base}.avif`);
      await img.clone().webp({ quality: 78 }).toFile(`${base}.webp`);
    }
  }
  console.log(`captured ${shot.slug}/${shot.name}`);
}

await browser.close();
