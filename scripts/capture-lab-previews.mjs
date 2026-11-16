// Captures each Lab project's live demo for its card on /lab/: a still image
// (AVIF/WebP) and a short muted loop (AV1 WebM plus H.264 MP4), written to
// src/assets/lab/<slug>/. Uses your installed Chrome and ffmpeg.
// Usage: npm run lab-previews [-- slug ...]
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PROJECTS = JSON.parse(await readFile('lab/projects.json', 'utf8'));
const RAW = '.cache/lab-previews';
const OUT = 'src/assets/lab';
const VIEW = { width: 1440, height: 900 };
const RECORD_S = 8.6; // seconds recorded
const FADE_S = 0.6; // the end crossfades into the start, so the loop has no visible seam
const VIDEO = { width: 960, height: 600 };
const STILL_WIDTHS = [480, 800, 1200];

// Replaces Math.random with a fixed sequence, for demos that pick things at random.
const SEEDED_RANDOM = `(() => { let s = 1234567; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();`;

// What each demo does on camera. `play(page, ms)` runs while recording, for `ms`
// milliseconds, and can return false to throw the take away and record again;
// `prepare(page)` runs before. Optional: `viewport` (a smaller 16:10 size zooms in
// on a narrow app; frames still come out at 1440 by 900), `init` (a script run
// before the page's own), and `reload`. A project with no recipe is simply loaded
// and recorded, which suits anything that moves on its own.
const RECIPES = {
  // The default beat playing, with its step sequencer open over the playlist.
  steplab: {
    async prepare(page) {
      await page.getByRole('button', { name: /click to start/i }).click();
      await page.waitForTimeout(600);
      await page.getByRole('button', { name: 'Edit Beat' }).click();
      await page.waitForTimeout(600);
      await page.getByRole('button', { name: /^play$/i }).first().click();
      await page.waitForTimeout(1500);
    },
  },
  // The default scale playing; each dot lights up as it sounds. Play again when it ends.
  sixline: {
    async play(page, ms) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const play = page.locator('button', { hasText: /^\s*Play\s*$/ }).first();
        if (await play.isVisible()) await play.click();
        await page.waitForTimeout(200);
      }
    },
  },
  // A hand from the deal: call or check whenever it's your turn.
  'pocket-pixels': {
    reload: true,
    async play(page, ms) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        await page.keyboard.press('c');
        await page.waitForTimeout(250);
      }
    },
  },
  // A stack of effects (comet, fireworks, rainbow paint, constellations) following a
  // cursor on a smooth path that comes back to where it started, with a few clicks.
  'cursor-playground': {
    async prepare(page) {
      await page.getByRole('button', { name: 'Comet show' }).click();
      for (const name of ['Rainbow paint', 'Constellations']) await page.getByRole('switch', { name }).click();
      await page.keyboard.press('h');
      // Hiding the panel focuses its "Show panel" button; drop the focus ring.
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForTimeout(3500); // the title fades out after 3 seconds
      // Already moving when the camera starts, so the "Show panel" hint has faded.
      await figureEight(page, RECORD_S * 1000, -0.4, 0, []);
    },
    async play(page, ms) {
      await figureEight(page, ms, 0, 1, [0.22, 0.55, 0.82]);
    },
  },
  // An Intervals round at Beginner, zoomed in on the game's column: two right
  // answers, then a miss that shows the right one and "Hear yours". The seeded
  // Math.random makes the round ask the same questions every time; a take
  // without both a right answer and a miss is recorded again.
  earcade: {
    viewport: { width: 1024, height: 640 },
    init: SEEDED_RANDOM,
    async prepare(page) {
      await page.getByRole('button', { name: /^Intervals/ }).click();
      await page.getByRole('button', { name: /^Beginner/ }).click();
    },
    async play(page, ms) {
      const end = Date.now() + ms;
      let right = 0, wrong = 0;
      for (let q = 0; q < 3; q++) {
        if (q) await page.keyboard.press('Enter'); // next question
        // If the notes didn't play by themselves, press Play.
        const play = page.locator('button[data-act="main"]', { hasText: /^\s*Play\s*$/i });
        if (await play.isVisible().catch(() => false)) await play.click();
        await page.waitForTimeout(1000); // the two notes play
        await page.locator('button[data-choice="m3"]').click();
        await page.waitForTimeout(150);
        if (await page.locator('button[data-choice].is-wrong').count()) wrong++; else right++;
        if (q < 2) await page.waitForTimeout(1400);
      }
      await page.waitForTimeout(Math.max(end - Date.now(), 0));
      return right > 0 && wrong > 0;
    },
  },
};

// Moves the mouse around a figure eight, one lap per `cycleMs`, from fraction
// `from` to `to` of a lap, clicking at the fractions in `clicks`.
async function figureEight(page, cycleMs, from, to, clicks) {
  const start = Date.now();
  const ms = (to - from) * cycleMs;
  while (Date.now() - start < ms) {
    const f = from + (Date.now() - start) / cycleMs;
    const a = f * Math.PI * 2;
    await page.mouse.move(VIEW.width / 2 + Math.sin(a) * 430, VIEW.height / 2 + Math.sin(2 * a) * 210);
    if (clicks.length && f >= clicks[0]) { clicks.shift(); await page.mouse.down(); await page.mouse.up(); }
    await page.waitForTimeout(10);
  }
}

// SVT_LOG=1: the AV1 encoder prints errors only.
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit', env: { ...process.env, SVT_LOG: '1' } });

const only = process.argv.slice(2);
const projects = only.length ? PROJECTS.filter((p) => only.includes(p.slug)) : PROJECTS;
if (!projects.length) throw new Error(`No project matches ${only.join(', ')}. Slugs: ${PROJECTS.map((p) => p.slug).join(', ')}`);

const browser = await chromium.launch({ channel: 'chrome' });

// Records one take with the DevTools screencast: every frame Chrome paints, with
// its time. Returns null when the recipe throws the take away.
async function record(project, recipe) {
  const viewport = recipe.viewport ?? VIEW;
  const context = await browser.newContext({ viewport, deviceScaleFactor: VIEW.width / viewport.width, reducedMotion: 'no-preference' });
  if (recipe.init) await context.addInitScript(recipe.init);
  const page = await context.newPage();
  await page.goto(project.demo, { waitUntil: 'load', timeout: 60_000 });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(1000);
  await recipe.prepare?.(page);

  const cdp = await context.newCDPSession(page);
  const frames = [];
  let gotFirst;
  const firstFrame = new Promise((resolve) => (gotFirst = resolve));
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    gotFirst();
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIEW.width, maxHeight: VIEW.height });
  // A still screen paints nothing new, so start the clock only once the first frame is in.
  await Promise.race([firstFrame, page.waitForTimeout(3000)]);
  // A demo that starts on load is reloaded once the camera is rolling.
  if (recipe.reload) await page.reload({ waitUntil: 'load' });
  const t0 = Date.now() / 1000;
  let good = true;
  if (recipe.play) good = (await recipe.play(page, RECORD_S * 1000)) !== false;
  else await page.waitForTimeout(RECORD_S * 1000);
  const t1 = Math.max(Date.now() / 1000, t0 + RECORD_S);
  await cdp.send('Page.stopScreencast');
  await context.close();
  return good ? { frames, t0, t1 } : null;
}

for (const project of projects) {
  const recipe = RECIPES[project.slug] ?? {};
  const raw = path.join(RAW, project.slug);
  await rm(raw, { recursive: true, force: true });
  await mkdir(path.join(raw, 'frames'), { recursive: true });

  let take = null;
  for (let attempt = 1; attempt <= 5 && !take; attempt++) {
    take = await record(project, recipe);
    if (!take) console.log(`${project.slug}: take ${attempt} didn't show what the recipe wants, recording again`);
  }
  if (!take) throw new Error(`${project.slug}: no usable take in 5 tries`);
  const { frames, t0, t1 } = take;

  // Keep the frames from t0 on (a reload paints a blank page first), each shown
  // until the next one arrived.
  const first = frames.findLastIndex((f) => f.t <= t0 + 0.05);
  const kept = frames.slice(Math.max(first, 0)).filter((f) => f.t < t1);
  if (kept.length < 20) throw new Error(`${project.slug}: only ${kept.length} frames recorded`);
  let list = '';
  for (const [i, f] of kept.entries()) {
    const file = `f${String(i).padStart(5, '0')}.jpg`;
    await writeFile(path.join(raw, 'frames', file), Buffer.from(f.data, 'base64'));
    const next = kept[i + 1]?.t ?? t1;
    list += `file 'frames/${file}'\nduration ${Math.max(next - Math.max(f.t, t0), 0.001).toFixed(4)}\n`;
  }
  list += `file 'frames/f${String(kept.length - 1).padStart(5, '0')}.jpg'\n`;
  await writeFile(path.join(raw, 'frames.txt'), list);

  // 30 fps master, then the loop: drop the first FADE_S seconds and crossfade the
  // last FADE_S seconds into them, so the last frame leads straight into the first.
  const master = path.join(raw, 'master.mp4');
  const loop = path.join(raw, 'loop.mp4');
  ffmpeg('-f', 'concat', '-safe', '0', '-i', path.join(raw, 'frames.txt'), '-fps_mode', 'cfr', '-r', '30', '-c:v', 'libx264', '-crf', '10', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', master);
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', master]).toString());
  const offset = (dur - 2 * FADE_S).toFixed(3);
  ffmpeg('-i', master, '-filter_complex',
    `[0:v]split[x][y];[x]trim=start=${FADE_S},setpts=PTS-STARTPTS[a];[y]trim=end=${FADE_S},setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=${FADE_S}:offset=${offset}[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-crf', '10', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', loop);

  const dir = path.join(OUT, project.slug);
  await mkdir(dir, { recursive: true });
  const scale = `scale=${VIDEO.width}:${VIDEO.height}:flags=lanczos`;
  ffmpeg('-i', loop, '-vf', scale, '-c:v', 'libsvtav1', '-crf', '40', '-preset', '5', '-g', '300', '-pix_fmt', 'yuv420p', '-an', path.join(dir, 'loop.webm'));
  ffmpeg('-i', loop, '-vf', scale, '-c:v', 'libx264', '-crf', '27', '-preset', 'slow', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path.join(dir, 'loop.mp4'));
  // AV1 is usually smaller; when it isn't (fine noise like pixel stars), keep just the MP4.
  const [webm, mp4] = await Promise.all(['loop.webm', 'loop.mp4'].map((f) => stat(path.join(dir, f))));
  if (webm.size >= mp4.size) await rm(path.join(dir, 'loop.webm'));

  // The still is the loop's first frame, so nothing jumps when the video takes over.
  const still = path.join(raw, 'still.png');
  ffmpeg('-i', loop, '-frames:v', '1', still);
  for (const w of STILL_WIDTHS) {
    const img = sharp(still).resize({ width: w });
    await img.clone().avif({ quality: 55, effort: 6 }).toFile(path.join(dir, `still-${w}.avif`));
    await img.clone().webp({ quality: 78 }).toFile(path.join(dir, `still-${w}.webp`));
  }
  console.log(`captured ${project.slug}: ${kept.length} frames over ${dur.toFixed(1)}s`);
}

await browser.close();
