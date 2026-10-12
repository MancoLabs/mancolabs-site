import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PARTIALS = resolve(ROOT, 'partials');

const PAGES = {
  main: 'index.html',
  notFound: '404.html',
  analemma: 'work/analemma/index.html',
  minicine: 'work/minicine/index.html',
  werla: 'work/werla/index.html',
};

// Two HTML directives, expanded before Vite processes each page:
//   <!-- @include header.html -->   inlines partials/header.html
//   <!-- @picture src="work/x/live-desktop" widths="480,800" sizes="..." alt="..." -->
//     becomes a <picture> with AVIF and WebP sources from src/assets/.
//     Any other attributes (width, height, loading, class...) go on the <img>.
function htmlTemplating() {
  const include = /<!--\s*@include\s+([\w.-]+)\s*-->/g;
  const picture = /<!--\s*@picture\s+([\s\S]*?)-->/g;
  const parseAttrs = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

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

  const render = (html) =>
    html
      .replace(include, (_, file) => render(readFileSync(resolve(PARTIALS, file), 'utf8')))
      .replace(picture, expandPicture);

  return {
    name: 'html-templating',
    transformIndexHtml: { order: 'pre', handler: render },
    configureServer(server) {
      server.watcher.add(PARTIALS);
      server.watcher.on('change', (file) => {
        if (resolve(file).startsWith(PARTIALS)) server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

export default defineConfig({
  appType: 'mpa',
  plugins: [htmlTemplating()],
  build: {
    rolldownOptions: {
      input: Object.fromEntries(Object.entries(PAGES).map(([name, file]) => [name, resolve(ROOT, file)])),
    },
  },
});
