// The developer view (Konami code): layout grid, component outlines, live stats.
const COMPONENTS = [
  ['.site-header', 'header'],
  ['.hero', 'hero'],
  ['.hero-inner', 'hero copy'],
  ['[data-anchor="assembly"]', 'assembly anchor'],
  ['.stages .stage', 'service stage'],
  ['.extras .extra', 'service card'],
  ['#checkForm', 'check form'],
  ['#checkResults', 'check results'],
  ['[data-anchor="check"]', 'check anchor'],
  ['.work-card', 'work card'],
  ['.about-bio', 'about'],
  ['.timeline', 'timeline'],
  ['#contactForm', 'contact form'],
  ['.site-footer', 'footer'],
  ['.cs-hero', 'case study hero'],
  ['.browser', 'browser frame'],
  ['.phone', 'phone frame'],
  ['.lost-copy', '404 copy'],
  ['[data-anchor="lost"]', 'paper anchor'],
];

let view = null;

export function toggleDevView() {
  if (view) close();
  else open();
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function open() {
  const grid = el('div', 'dev-grid');
  grid.setAttribute('aria-hidden', 'true');
  const cols = el('div', 'wrap dev-grid-cols');
  for (let i = 0; i < 12; i++) cols.append(el('span'));
  grid.append(cols);

  const boxes = el('div', 'dev-boxes');
  boxes.setAttribute('aria-hidden', 'true');

  const panel = el('section', 'dev-panel dark');
  panel.setAttribute('aria-label', 'Developer view');
  const rows = {};
  const title = el('p', 'dev-title', 'Developer view');
  const closeBtn = el('button', 'dev-close', 'Close');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', close);
  const dl = el('dl');
  for (const [key, label] of [
    ['fps', 'Page FPS'], ['renderer', 'Renderer'], ['thread', '3D runs on'], ['loop', '3D loop'], ['gfps', '3D FPS'],
    ['p95', '3D frame p95 / max'], ['slow', 'Frames over 33 ms'], ['calls', 'Draw calls'], ['dpr', '3D pixel ratio'],
    ['viewport', 'Viewport'], ['lcp', 'LCP'], ['cls', 'CLS'],
  ]) {
    const dd = el('dd', '', '...');
    dl.append(el('dt', '', label), dd);
    rows[key] = dd;
  }
  // Which browser check in the head script matched (Firefox on phones gets the
  // drawings), and the raw user agent it was checked against.
  const match = document.documentElement.dataset.uaMatch || 'none';
  dl.append(
    el('dt', '', 'Browser match'),
    el('dd', '', match === 'none' ? 'none' : `${match} (drawings)`),
    el('dt', 'dev-wide', 'User agent'),
    el('dd', 'dev-wide', navigator.userAgent),
  );
  panel.append(title, dl, closeBtn);

  const live = el('p', 'sr-only');
  live.setAttribute('role', 'status');

  document.body.append(grid, boxes, panel, live);
  document.documentElement.classList.add('dev-on');
  live.textContent = 'Developer view on. Press Escape to close.';

  // Component outlines, positioned in page coordinates so they scroll with it.
  const place = () => {
    boxes.replaceChildren();
    boxes.style.height = `${document.documentElement.scrollHeight}px`;
    for (const [sel, label] of COMPONENTS) {
      for (const node of document.querySelectorAll(sel)) {
        if (node.hidden || !node.offsetParent) continue;
        const r = node.getBoundingClientRect();
        const b = el('div', 'dev-box');
        Object.assign(b.style, { left: `${r.left + scrollX}px`, top: `${r.top + scrollY}px`, width: `${r.width}px`, height: `${r.height}px` });
        b.append(el('span', '', `${label} ${Math.round(r.width)}×${Math.round(r.height)}`));
        boxes.append(b);
      }
    }
  };
  place();
  const ro = new ResizeObserver(() => place());
  ro.observe(document.body);

  // Live numbers.
  let frames = 0;
  let last = performance.now();
  let raf = 0;
  const count = (now) => {
    frames++;
    if (now - last >= 500) {
      rows.fps.textContent = String(Math.round((frames * 1000) / (now - last)));
      frames = 0;
      last = now;
      rows.viewport.textContent = `${innerWidth}×${innerHeight} @${devicePixelRatio}x`;
      const d = document.documentElement.dataset;
      rows.renderer.textContent = d['3d'] === 'live' ? d.renderer : d['3d'] === 'pending' ? 'starting…' : 'poster (no 3D)';
      rows.thread.textContent = d['3d'] === 'live' ? d.renderThread : 'n/a';
      rows.loop.textContent = d['3d'] === 'live' ? d.renderLoop || 'running' : 'n/a';
    }
    raf = requestAnimationFrame(count);
  };
  raf = requestAnimationFrame(count);

  const onStats = (e) => {
    // The renderer reports what it is actually using, so trust it over the page's guess.
    rows.renderer.textContent = e.detail.backend;
    rows.gfps.textContent = String(e.detail.fps);
    rows.p95.textContent = `${e.detail.p95} / ${e.detail.maxMs} ms`;
    rows.slow.textContent = `${e.detail.slow} of ${e.detail.frames}`;
    rows.calls.textContent = String(e.detail.drawCalls);
    rows.dpr.textContent = String(e.detail.dpr);
  };
  addEventListener('stage:stats', onStats);
  dispatchEvent(new CustomEvent('stage:want-stats', { detail: true }));
  if (document.documentElement.dataset['3d'] !== 'live') rows.gfps.textContent = rows.p95.textContent = rows.slow.textContent = rows.calls.textContent = rows.dpr.textContent = 'n/a';

  const observers = [];
  try {
    let cls = 0;
    const lcp = new PerformanceObserver((list) => {
      const e = list.getEntries().at(-1);
      if (e) rows.lcp.textContent = `${(e.startTime / 1000).toFixed(2)} s`;
    });
    lcp.observe({ type: 'largest-contentful-paint', buffered: true });
    const shift = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value;
      rows.cls.textContent = cls.toFixed(3);
    });
    shift.observe({ type: 'layout-shift', buffered: true });
    rows.cls.textContent = cls.toFixed(3);
    observers.push(lcp, shift);
  } catch {
    rows.lcp.textContent = rows.cls.textContent = 'not supported';
  }

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);

  view = () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    observers.forEach((o) => o.disconnect());
    removeEventListener('stage:stats', onStats);
    removeEventListener('keydown', onKey);
    dispatchEvent(new CustomEvent('stage:want-stats', { detail: false }));
    grid.remove();
    boxes.remove();
    panel.remove();
    document.documentElement.classList.remove('dev-on');
    live.textContent = 'Developer view off.';
    setTimeout(() => live.remove(), 1500);
  };
}

function close() {
  view?.();
  view = null;
}
