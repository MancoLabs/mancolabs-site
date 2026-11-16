import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PARTIALS = resolve(ROOT, 'partials');
const LAB_DATA = resolve(ROOT, 'lab/projects.json');

// The Google Calendar booking page (appointment schedule). The only place it's
// set: pages get it as %BOOKING_URL% (the /book/ embed), and src/booking.js as
// __BOOKING_URL__ (the booking dialog).
const BOOKING_URL = 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ09Tt_ucjDKf7oiy8Qgpe10qV1UOmH8xZRYv9msWshFyRZvGLJq3le7yLuntfP9VLUhS3PyLoel?gv=true';

const PAGES = {
  main: 'index.html',
  notFound: '404.html',
  chen: 'work/chen/index.html',
  analemma: 'work/analemma/index.html',
  minicine: 'work/minicine/index.html',
  werla: 'work/werla/index.html',
  graffitiGrimoire: 'work/graffiti-grimoire/index.html',
  tools: 'tools/index.html',
  launch: 'launch/index.html',
  care: 'care/index.html',
  government: 'government/index.html',
  book: 'book/index.html',
  lab: 'lab/index.html',
};

// Three HTML directives, expanded before Vite processes each page:
//   <!-- @include header.html -->   inlines partials/header.html
//   <!-- @picture src="work/x/live-desktop" widths="480,800" sizes="..." alt="..." -->
//     becomes a <picture> with AVIF and WebP sources from src/assets/.
//     Any other attributes (width, height, loading, class...) go on the <img>.
//   <!-- @lab-projects -->   the project list on /lab/, from lab/projects.json
// Plus %BOOKING_URL%, replaced with the booking page address above.
function htmlTemplating() {
  const include = /<!--\s*@include\s+([\w.-]+)\s*-->/g;
  const picture = /<!--\s*@picture\s+([\s\S]*?)-->/g;
  const labList = /<!--\s*@lab-projects\s*-->/g;
  const parseAttrs = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const expandPicture = (_, raw) => {
    const { src, widths, sizes = '100vw', alt = '', ...rest } = parseAttrs(raw);
    const ws = widths.split(',').map((w) => Number(w.trim()));
    const srcset = (ext) => ws.map((w) => `/src/assets/${src}-${w}.${ext} ${w}w`).join(', ');
    const fallback = `/src/assets/${src}-${ws[Math.min(1, ws.length - 1)]}.webp`;
    const attrs = Object.entries({ loading: 'lazy', decoding: 'async', ...rest })
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    return `<picture><source type="image/avif" srcset="${srcset('avif')}" sizes="${sizes}"><img src="${fallback}" srcset="${srcset('webp')}" sizes="${sizes}" alt="${alt}" ${attrs}></picture>`;
  };

  // One <li> per project: the still from src/assets/lab/<slug>/ (npm run
  // lab-previews), with its loop on top when there is one. The loop has
  // preload="none", so nothing downloads until src/lab/previews.js plays it.
  const labProject = (p, i) => {
    const dir = `lab/${p.slug}`;
    const hasLoop = existsSync(resolve(ROOT, 'src/assets', dir, 'loop.mp4'));
    const still = expandPicture('', `src="${dir}/still" widths="480,800,1200" sizes="(min-width: 1140px) 595px, (min-width: 900px) calc(55vw - 32px), calc(100vw - 40px)" alt="${esc(p.alt)}" width="1440" height="900"${i === 0 ? ' loading="eager"' : ''}`);
    const loop = hasLoop
      ? `<video class="lab-loop" muted loop playsinline preload="none" disablepictureinpicture disableremoteplayback aria-hidden="true" tabindex="-1" width="960" height="600">` +
        `<source src="/src/assets/${dir}/loop.webm" type='video/webm; codecs="av01.0.04M.08"'>` +
        `<source src="/src/assets/${dir}/loop.mp4" type='video/mp4; codecs="avc1.64001F"'></video>` +
        `<button class="lab-toggle" type="button" data-name="${esc(p.name)}" aria-label="Pause the ${esc(p.name)} preview" hidden>` +
        `<svg class="i-pause" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><rect x="2.5" y="1.5" width="3" height="11" rx="0.5"/><rect x="8.5" y="1.5" width="3" height="11" rx="0.5"/></svg>` +
        `<svg class="i-play" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M3.5 1.8v10.4a.6.6 0 0 0 .9.5l8.3-5.2a.6.6 0 0 0 0-1L4.4 1.3a.6.6 0 0 0-.9.5z"/></svg></button>`
      : '';
    return `<li class="lab-item" id="${esc(p.slug)}">
          <div class="lab-media"${hasLoop ? ' data-lab-preview' : ''}>${still}${loop}</div>
          <div class="lab-body">
            <h2 class="lab-name">${esc(p.name)}</h2>
            <p class="lab-desc">${esc(p.description)}</p>
            <p class="lab-links"><a class="btn" href="${esc(p.demo)}" rel="noopener">Try it<span class="sr-only">: ${esc(p.name)}</span></a><a class="text-link" href="${esc(p.code)}" rel="noopener">Code<span class="sr-only"> for ${esc(p.name)} on GitHub</span></a></p>
          </div>
        </li>`;
  };
  const labProjects = () => JSON.parse(readFileSync(LAB_DATA, 'utf8')).map(labProject).join('\n        ');

  const render = (html) =>
    html
      .replace(include, (_, file) => render(readFileSync(resolve(PARTIALS, file), 'utf8')))
      .replace(labList, labProjects)
      .replace(picture, expandPicture)
      .replaceAll('%BOOKING_URL%', BOOKING_URL);

  return {
    name: 'html-templating',
    transformIndexHtml: { order: 'pre', handler: render },
    configureServer(server) {
      server.watcher.add([PARTIALS, LAB_DATA]);
      server.watcher.on('change', (file) => {
        if (resolve(file).startsWith(PARTIALS) || resolve(file) === LAB_DATA) server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

export default defineConfig({
  appType: 'mpa',
  plugins: [htmlTemplating()],
  define: { __BOOKING_URL__: JSON.stringify(BOOKING_URL) },
  build: {
    rolldownOptions: {
      input: Object.fromEntries(Object.entries(PAGES).map(([name, file]) => [name, resolve(ROOT, file)])),
    },
  },
});
