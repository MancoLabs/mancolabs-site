// Main-thread side of the 3D layer: checks the GPU, starts the renderer (in a
// worker when possible), feeds it scroll, pointer, and layout, and falls back to
// the static poster whenever something isn't right.
import { readPalette } from './palette.js';

const root = document.documentElement;
const params = new URLSearchParams(location.search);
const POSTER = params.has('poster') || params.has('og');
// Phones and tablets: timed animations instead of scroll-scrubbing, which
// stutters with touch momentum scrolling.
const TOUCH = matchMedia('(pointer: coarse)').matches;
// Phones: the canvas scrolls with the page instead of being redrawn to follow it.
const FLOW = TOUCH && matchMedia('(max-width: 699px)').matches;
// Firefox on phones (set by the head script): its toolbar changes the viewport
// height mid-scroll, so height-only changes are ignored there. It normally gets
// the drawings; this matters only when the 3D is forced with ?3d=on.
const FF_MOBILE = root.classList.contains('ff-mobile');

let teardown = null;
let host = null;

export function stopStage(reason) {
  teardown?.(reason);
}

export async function startStage() {
  const kind = document.querySelector('[data-stage]')?.dataset.stage;
  if (kind === 'hero') return startHero();
  if (kind === 'lost') return startLost();
}

// ── Shared launcher ───────────────────────────
// prepare(ctx) runs after the GPU check and returns hooks:
//   layout()      page measurements for the scene
//   started()     right after the renderer is created
//   wire()        once the live scene is on screen
//   onMessage(m)  scene-specific messages from the renderer
async function launch({ scene, prepare }) {
  const ctx = { cleanups: [], done: false, canvas: null, coarse: TOUCH };
  const off = (reason) => {
    if (ctx.done) return;
    ctx.done = true;
    if (reason) console.info(`[3d] Showing the poster instead: ${reason}`);
    root.setAttribute('data-3d', 'off');
    ctx.cleanups.forEach((fn) => fn());
    host?.send({ type: 'dispose' });
    const h = host, c = ctx.canvas;
    host = null;
    setTimeout(() => { h?.stop(); c?.remove(); }, 900);
  };
  ctx.off = off;
  teardown = off;

  const gpu = await probeGPU();
  const canvas = (ctx.canvas = document.createElement('canvas'));
  // Which renderer, and where:
  //   worker + WebGL 2   the default: smooth, and nothing runs on the main thread
  //   main thread        browsers that can't hand a canvas to a worker; WebGPU if available
  // WebGPU inside a worker caused scroll stutter on some machines, so it's only
  // used there when explicitly requested with ?3d=force-webgpu.
  const canWorker = !params.has('mainthread') && typeof Worker !== 'undefined' && 'transferControlToOffscreen' in canvas;
  let useWorker = false;
  let forceWebGL = true;
  if (canWorker && params.get('3d') === 'force-webgpu' && gpu.webgpu) {
    useWorker = true;
    forceWebGL = false;
  } else if (canWorker && gpu.webgl2) {
    useWorker = true;
  } else if (gpu.webgpu || gpu.webgl2) {
    forceWebGL = !gpu.webgpu || params.get('3d') === 'force-webgl';
  } else {
    return off(gpu.reason);
  }

  const hooks = await prepare(ctx);
  if (!hooks || ctx.done) return;

  canvas.className = 'stage-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  if (hooks.mount) hooks.mount(canvas);
  else document.body.prepend(canvas);
  const dpr = Math.min(window.devicePixelRatio || 1, POSTER ? 3 : ctx.coarse ? 1.5 : 2);
  ctx.size = hooks.size || (() => ({ width: canvas.clientWidth, height: canvas.clientHeight }));
  ctx.forceWebGL = forceWebGL;

  const startTimer = setTimeout(() => off('the renderer took too long to start'), 15000);
  ctx.cleanups.push(() => clearTimeout(startTimer));

  const onMessage = (msg) => {
    if (ctx.done) return;
    if (msg.type === 'ready') {
      clearTimeout(startTimer);
      root.setAttribute('data-3d', 'live');
      root.dataset.renderer = msg.backend;
      root.dataset.renderThread = host.mode;
      root.dataset.renderLoop = 'running';
      if (POSTER) root.dataset.posterReady = 'true';
      else {
        wireCommon(ctx, hooks);
        hooks.wire?.(ctx);
      }
    } else if (msg.type === 'slow') off(`frame rate too low (${msg.fps} fps)`);
    else if (msg.type === 'error') off(msg.message);
    else if (msg.type === 'stats') window.dispatchEvent(new CustomEvent('stage:stats', { detail: { ...msg, thread: host?.mode } }));
    else if (msg.type === 'loop') {
      root.dataset.renderLoop = msg.running ? 'running' : 'paused';
      window.dispatchEvent(new CustomEvent('stage:loop', { detail: msg }));
    } else hooks.onMessage?.(msg);
  };

  const init = {
    type: 'init',
    scene,
    ...ctx.size(),
    dpr,
    palette: readPalette(),
    layout: hooks.layout(),
    flow: hooks.flow?.() || null,
    forceWebGL,
    poster: POSTER,
  };

  try {
    if (useWorker) {
      const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => onMessage(e.data);
      worker.onerror = (e) => off(`worker failed: ${e.message || 'unknown error'}`);
      const offscreen = canvas.transferControlToOffscreen();
      host = { send: (m, t) => worker.postMessage(m, t || []), stop: () => worker.terminate(), mode: 'worker' };
      host.send({ ...init, canvas: offscreen }, [offscreen]);
    } else {
      const { Stage } = await import('./stage.js');
      const stage = new Stage(onMessage);
      host = { send: (m) => stage.handle(m), stop() {}, mode: 'main thread' };
      host.send({ ...init, canvas });
    }
    hooks.started?.(ctx);
  } catch (err) {
    off(String(err?.message || err));
  }
}

function wireCommon(ctx, hooks) {
  // The canvas is 100lvh and the body only changes size when the layout really
  // does, so a phone's address bar sliding in and out never lands here.
  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (hooks.relayout) return hooks.relayout();
      host?.send({ type: 'resize', ...ctx.size() });
      host?.send({ type: 'layout', layout: hooks.layout() });
    }, 150);
  });
  ro.observe(ctx.canvas);
  ro.observe(document.body);

  // Live numbers for the developer view: dispatch 'stage:want-stats' with detail true/false.
  const wantStats = (e) => host?.send({ type: 'stats', value: !!e.detail });
  addEventListener('stage:want-stats', wantStats);

  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const repaint = () => host?.send({ type: 'palette', palette: readPalette() });
  scheme.addEventListener('change', repaint);

  ctx.cleanups.push(() => {
    ro.disconnect();
    clearTimeout(resizeTimer);
    removeEventListener('stage:want-stats', wantStats);
    scheme.removeEventListener('change', repaint);
  });
}

// A viewport height that ignores the phone address bar (100svh).
function stableViewport() {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100vh;height:100svh;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  let vh = probe.offsetHeight || innerHeight;
  let w = innerWidth;
  const ro = new ResizeObserver(() => {
    if (FF_MOBILE && innerWidth === w) return; // the toolbar moved, not the phone
    w = innerWidth;
    vh = probe.offsetHeight || innerHeight;
  });
  ro.observe(probe);
  return { get: () => vh, dispose: () => { ro.disconnect(); probe.remove(); } };
}

// ── Home page ─────────────────────────────────
function startHero() {
  const heroEl = document.querySelector('[data-stage="hero"]');
  const anchorEl = document.querySelector('[data-anchor="assembly"]');
  const statementEl = anchorEl?.closest('.statement');
  if (!heroEl || !anchorEl || !statementEl) return;
  const gsapReady = loadGsap();

  return launch({
    scene: 'hero',
    prepare: async (ctx) => {
      const { gsap, ScrollTrigger } = await gsapReady;
      // Let the hero's entrance animation settle so the text box is measured in place.
      await Promise.all(heroEl.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
      const viewport = stableViewport();
      ctx.cleanups.push(viewport.dispose);
      const bandEl = heroEl.querySelector('.hero-band');
      if (FLOW) return prepareFlow(ctx, { gsap, ScrollTrigger, viewport, bandEl, anchorEl });

      const measure = () => {
        const sy = window.scrollY;
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top + sy, w: r.width, h: r.height };
        };
        const parts = [...heroEl.querySelectorAll('.hero-inner > :not(.hero-cta):not(.hero-band), .hero-cta > *')]
          .filter((el) => el.offsetParent !== null)
          .map(box);
        const k = parts.reduce(
          (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), r: Math.max(a.r, b.x + b.w), b: Math.max(a.b, b.y + b.h) }),
          { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity },
        );
        return {
          hero: box(heroEl),
          keepOut: { x: k.x, y: k.y, w: k.r - k.x, h: k.b - k.y },
          assembly: box(anchorEl),
          band: bandEl && bandEl.offsetParent !== null ? box(bandEl) : null,
        };
      };

      // Assembly progress. Desktop: scrubbed to scroll. Touch: plays on its own
      // (about 1.3 s) when you pass the trigger, and in reverse when you go back.
      // Poster captures stay frozen at the start.
      const proxy = { assemble: 0 };
      if (!POSTER) {
        if (TOUCH) {
          let tween = null;
          const playTo = (to) => {
            tween?.kill();
            tween = gsap.to(proxy, { assemble: to, duration: 1.35 * Math.abs(to - proxy.assemble), ease: 'none' });
          };
          const st = ScrollTrigger.create({
            trigger: anchorEl,
            start: 'top 72%',
            onEnter: () => playTo(1),
            onLeaveBack: () => playTo(0),
          });
          if (st.progress > 0 || window.scrollY > st.start) proxy.assemble = 1;
          ctx.cleanups.push(() => { st.kill(); tween?.kill(); });
        } else {
          const tween = gsap.to(proxy, {
            assemble: 1,
            ease: 'none',
            scrollTrigger: { trigger: statementEl, start: 'top 85%', endTrigger: anchorEl, end: 'center 52%', scrub: 0.8 },
          });
          tween.progress(tween.scrollTrigger.progress);
          ctx.cleanups.push(() => { tween.scrollTrigger?.kill(); tween.kill(); });
        }
      }

      // The laptop's path: assembly box, then held beside (desktop) or above
      // (phone) the services rows, then the website check box.
      const storyEl = document.querySelector('[data-anchor="story"]');
      const checkEl = document.querySelector('[data-anchor="check"]');
      const rows = storyEl ? [...storyEl.querySelectorAll('.stage')] : [];
      const firstVisual = storyEl?.querySelector('.stage-visual');
      const fadeEls = storyEl
        ? [...storyEl.closest('section').querySelectorAll('.sec-head > *'), ...storyEl.querySelectorAll('.stage-copy > :not(ul), .stage-copy li')]
        : [];
      const desktopMQ = matchMedia('(min-width: 961px)');
      const story = { enter: 0, fix: 0, build: 0, auto: 0, exit: 0 };
      let fading = false;
      let lastFrame = performance.now();
      const resetFade = () => {
        if (!fading) return;
        fading = false;
        fadeEls.forEach((el) => { el.style.opacity = ''; });
      };
      ctx.cleanups.push(resetFade);

      const frameState = () => {
        const now = performance.now();
        const dt = Math.min(0.1, (now - lastFrame) / 1000);
        lastFrame = now;
        const k = 1 - Math.exp(-dt * 10);
        const vh = viewport.get();
        const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
        const A = box(anchorEl);
        let laptop = { ...A, s: 1 };
        let fade = null;
        if (storyEl && firstVisual && checkEl) {
          const desktop = desktopMQ.matches;
          const list = storyEl.getBoundingClientRect();
          const V = box(firstVisual);
          const C = box(checkEl);
          const pinY = desktop ? (vh - V.h) / 2 + 36 : 84;
          const S = { x: V.x, y: Math.min(Math.max(list.top, pinY), list.bottom - V.h), w: V.w, h: V.h };
          story.enter = clamp01((vh - list.top) / Math.max(1, vh - pinY));
          const past = pinY + V.h - list.bottom;
          const span = C.y + C.h / 2 - vh / 2 - (list.bottom - pinY - V.h);
          story.exit = span > 0 ? clamp01(past / span) : past > 0 ? 1 : 0;
          const focus = desktop ? vh * 0.5 : pinY + V.h + (vh - pinY - V.h) * 0.45;
          rows.forEach((row, i) => {
            const key = ['fix', 'build', 'auto'][i];
            if (!key) return;
            const r = row.getBoundingClientRect();
            if (TOUCH) {
              // Touch: each stage plays through on its own once its row reaches
              // the reading area, and rewinds if you scroll back above it.
              const target = r.top < focus ? 1 : 0;
              const step = dt / 1.3;
              story[key] = target > story[key] ? Math.min(1, story[key] + step) : Math.max(0, story[key] - step);
            } else {
              story[key] += (clamp01((focus - r.top) / r.height) - story[key]) * k;
            }
          });
          if (desktop) {
            // Glide between boxes in the right-hand column; shrink while passing behind the cards.
            if (story.exit > 0) laptop = { ...lerpBox(S, C, ease(story.exit)), s: 1 - 0.92 * Math.sin(Math.PI * story.exit) };
            else if (story.enter > 0) laptop = { ...lerpBox(A, S, ease(story.enter)), s: 1 };
          } else {
            // Phones: ride up with the assembly box, stay at the top while the text
            // scrolls underneath (and fades), leave with the end of the rows, and
            // reappear at the check while both are off screen. It never crosses text.
            const P = { x: V.x, y: Math.min(pinY, list.bottom - V.h), w: V.w, h: V.h };
            if (P.y + P.h < 0 && story.exit > 0) laptop = { ...C, s: 1 };
            else if (A.y > pinY) laptop = { ...A, s: 1 };
            else {
              laptop = { ...P, s: 1 };
              const line = P.y + P.h - 12;
              fade = fadeEls.map((el) => clamp01((el.getBoundingClientRect().top - line) / 56));
            }
          }
        }
        if (fade) {
          fading = true;
          fadeEls.forEach((el, i) => { el.style.opacity = fade[i] < 1 ? fade[i].toFixed(3) : ''; });
        } else resetFade();
        return { scrollY: window.scrollY, assemble: proxy.assemble, laptop, story: { ...story } };
      };

      let aboutCanvas = null;

      return {
        layout: measure,
        started: () => {
          host.send({ type: 'frame', state: frameState() });
          const onCheck = (e) => forwardCheck(e.detail);
          addEventListener('check:state', onCheck);
          ctx.cleanups.push(() => removeEventListener('check:state', onCheck));
          if (window.__checkState) forwardCheck(window.__checkState);
        },
        onMessage: (msg) => {
          if (msg.type === 'about-ready') aboutCanvas?.classList.add('is-on');
          if (msg.type === 'about-error') aboutCanvas?.remove();
        },
        wire: () => {
          let active = true;
          let pending = null;
          let last = '';
          const aboutEl = document.querySelector('.about');

          const tick = () => {
            if (!active || !host) return;
            const state = frameState();
            const key = JSON.stringify(state);
            if (key !== last) {
              last = key;
              host.send({ type: 'frame', state });
            }
            if (pending) {
              host.send({ type: 'pointer', ...pending });
              pending = null;
            }
          };
          gsap.ticker.add(tick);
          ctx.cleanups.push(() => gsap.ticker.remove(tick));

          // Only render while a 3D part of the page is near the screen and the tab is visible.
          const near = new Set();
          let aboutNear = false;
          let aboutOn = false;
          const sync = () => {
            const on = near.size > 0 && !document.hidden;
            if (on !== active) {
              if (!on) tick();
              active = on;
              host?.send({ type: 'active', value: on });
            }
            const a = aboutNear && !document.hidden;
            if (a !== aboutOn && aboutCanvas) {
              aboutOn = a;
              host?.send({ type: 'about-active', value: a });
            }
          };
          const io = new IntersectionObserver((entries) => {
            for (const e of entries) (e.isIntersecting ? near.add(e.target) : near.delete(e.target));
            sync();
          }, { rootMargin: '25% 0px' });
          for (const el of [heroEl, statementEl, storyEl, checkEl]) if (el) io.observe(el);
          // The About canvas keeps its last frame, so it only needs to draw while actually on screen.
          const aboutIo = new IntersectionObserver((entries) => {
            aboutNear = entries.at(-1).isIntersecting;
            sync();
          });
          document.addEventListener('visibilitychange', sync);
          ctx.cleanups.push(() => { io.disconnect(); aboutIo.disconnect(); document.removeEventListener('visibilitychange', sync); });

          // About: its own small canvas inside the section, drawn by the same renderer thread.
          if (aboutEl) {
            aboutCanvas = document.createElement('canvas');
            aboutCanvas.className = 'about-canvas';
            aboutCanvas.setAttribute('aria-hidden', 'true');
            aboutEl.prepend(aboutCanvas);
            const aSize = () => ({ width: Math.max(1, Math.round(aboutEl.clientWidth)), height: Math.max(1, Math.round(aboutEl.clientHeight)) });
            if (host.mode === 'worker' && 'transferControlToOffscreen' in aboutCanvas) {
              const offscreen = aboutCanvas.transferControlToOffscreen();
              host.send({ type: 'about-init', canvas: offscreen, ...aSize() }, [offscreen]);
            } else {
              host.send({ type: 'about-init', canvas: aboutCanvas, ...aSize() });
            }
            const aro = new ResizeObserver(() => host?.send({ type: 'about-resize', ...aSize() }));
            aro.observe(aboutEl);
            aboutIo.observe(aboutEl);
            const c = aboutCanvas;
            ctx.cleanups.push(() => { aro.disconnect(); c.remove(); });
          }

          if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
            let inAbout = false;
            const move = (e) => {
              pending = { x: e.clientX, y: e.clientY, t: e.timeStamp };
              if (!aboutCanvas) return;
              const r = aboutEl.getBoundingClientRect();
              const inside = e.clientY >= r.top && e.clientY <= r.bottom;
              if (inside) host?.send({ type: 'about-pointer', x: e.clientX - r.left, y: e.clientY - r.top, width: r.width, height: r.height });
              else if (inAbout) host?.send({ type: 'about-pointer', x: null });
              inAbout = inside;
            };
            const leave = () => {
              pending = { x: null };
              host?.send({ type: 'about-pointer', x: null });
            };
            addEventListener('pointermove', move, { passive: true });
            root.addEventListener('pointerleave', leave);
            ctx.cleanups.push(() => { removeEventListener('pointermove', move); root.removeEventListener('pointerleave', leave); });
          }
        },
      };
    },
  });
}

// ── Phones: the canvas scrolls with the page ──
// A phone scrolls the page on its own thread, so 3D that is redrawn to follow
// the scroll always lands a frame late and jitters against the page. Here
// nothing in the 3D follows the scroll. One canvas covers the hero band down to
// the laptop box and lives in a position: sticky holder, so the browser itself
// carries it up and holds it over the services rows. Past the rows it moves into
// the website check box while both are off screen. Inside it, only timed
// animations run: the assembly, the services effects, the scanning light.
const PIN_Y = 84;
const M_TOP = 48, M_BOTTOM = 64, M_CHECK = 48; // room around the boxes for papers and icons

function prepareFlow(ctx, { gsap, ScrollTrigger, viewport, bandEl, anchorEl }) {
  const storyEl = document.querySelector('[data-anchor="story"]');
  const checkEl = document.querySelector('[data-anchor="check"]');
  const headEl = storyEl?.closest('section')?.querySelector('.sec-head');
  const firstVisual = storyEl?.querySelector('.stage-visual');
  if (!bandEl || !storyEl || !checkEl || !headEl || !firstVisual) {
    ctx.off('unexpected page layout');
    return null;
  }

  // The sticky holder sits at the top of a wrapper around the services heading
  // and rows, so it lets go where the rows end. It takes no room in the layout:
  // the holder is zero height, and a spacer (cancelled by a negative margin)
  // stretches the wrapper so the laptop's bottom, not the holder's, meets the end.
  const run = document.createElement('div');
  run.className = 'flow-run';
  headEl.before(run);
  run.append(headEl, storyEl);
  const pin = document.createElement('div');
  pin.className = 'flow-pin';
  pin.setAttribute('aria-hidden', 'true');
  const spacer = document.createElement('div');
  spacer.setAttribute('aria-hidden', 'true');
  run.prepend(pin);
  run.append(spacer);
  root.classList.add('flow-3d');
  ctx.cleanups.push(() => {
    root.classList.remove('flow-3d');
    run.before(headEl, storyEl);
    run.remove();
  });

  // Geometry, in page pixels, measured once and again only when the layout changes.
  // Each canvas is a window onto a virtual screen (vw x vh), with off0/off1 giving
  // where the window sits on it (see Stage.applyFlow).
  let G = null;
  const measure = () => {
    const sy = window.scrollY;
    const doc = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + sy, w: r.width, h: r.height }; };
    const vw = document.documentElement.clientWidth;
    const vh = viewport.get();
    const A = doc(anchorEl), B = doc(bandEl), R = doc(run), list = doc(storyEl), C = doc(checkEl);
    const D = R.y - A.y; // the holder sits D below the laptop box
    const top = B.y - M_TOP; // page y of the run canvas's top edge
    G = {
      vw, vh, D,
      extra: Math.max(0, D - A.h),
      run: {
        left: -R.x, top: top - R.y, width: vw, height: A.y + A.h + M_BOTTOM - top,
        laptop: { x: A.x, y: A.y - top, w: A.w, h: A.h },
        band: { x: B.x, y: B.y - top, w: B.w, h: B.h },
        off0: top, // the page at the top, as the band always looked
        off1: PIN_Y - (A.y - top), // the laptop pinned PIN_Y from the top
      },
      check: {
        left: -C.x, top: -M_CHECK, width: vw, height: C.h + 2 * M_CHECK,
        laptop: { x: C.x, y: M_CHECK, w: C.w, h: C.h },
        off0: (vh - C.h) / 2 - M_CHECK, off1: (vh - C.h) / 2 - M_CHECK,
      },
      // Switch canvases halfway between the end of the rows and the check box.
      gapMid: (list.y + list.h + M_BOTTOM + C.y - M_CHECK) / 2,
    };
    pin.style.top = `${PIN_Y + D}px`;
    spacer.style.height = `${G.extra}px`;
    run.style.marginBottom = `${-G.extra}px`;
  };
  measure();

  let canvas = null;
  let mode = window.scrollY + G.vh / 2 > G.gapMid ? 'check' : 'run';
  const intro = { p: 0 };
  let introTween = null;
  const place = (m) => {
    mode = m;
    const g = G[m];
    const parent = m === 'run' ? pin : checkEl;
    if (canvas.parentNode !== parent) parent.append(canvas);
    Object.assign(canvas.style, { left: `${g.left}px`, top: `${g.top}px`, width: `${g.width}px`, height: `${g.height}px` });
    if (m === 'run') {
      introTween?.kill();
      introTween = null;
      intro.p = 0;
    }
  };
  const flowConfig = () => {
    const g = G[mode];
    return { vw: G.vw, vh: G.vh, width: g.width, height: g.height, off0: g.off0, off1: g.off1 };
  };
  const sceneLayout = () => ({ hero: G.run.band, keepOut: G.run.band, band: G.run.band, assembly: G.run.laptop });

  // Assembly: timed. The papers leave the band once it has scrolled out of view
  // and fly back when it returns. Poster captures stay at the start.
  const proxy = { assemble: 0 };
  if (!POSTER) {
    let tween = null;
    const playTo = (to) => {
      tween?.kill();
      tween = gsap.to(proxy, { assemble: to, duration: 1.35 * Math.abs(to - proxy.assemble), ease: 'none' });
    };
    const st = ScrollTrigger.create({ trigger: bandEl, start: 'bottom top', onEnter: () => playTo(1), onLeaveBack: () => playTo(0) });
    if (st.progress > 0 || window.scrollY > st.start) proxy.assemble = 1;
    ctx.cleanups.push(() => { st.kill(); tween?.kill(); });
  }

  // Services: each stage plays through on its own once its row reaches the
  // reading area under the laptop, and rewinds if you scroll back above it.
  const rows = [...storyEl.querySelectorAll('.stage')];
  const fadeEls = [...headEl.children, ...storyEl.querySelectorAll('.stage-copy > :not(ul), .stage-copy li')];
  const story = { enter: 0, fix: 0, build: 0, auto: 0, exit: 0 };
  let fading = false;
  const resetFade = () => {
    if (!fading) return;
    fading = false;
    fadeEls.forEach((el) => { el.style.opacity = ''; });
  };
  ctx.cleanups.push(resetFade);
  let lastFrame = performance.now();

  const frameState = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const vh = viewport.get();
    const want = window.scrollY + vh / 2 > G.gapMid ? 'check' : 'run';
    if (want !== mode) {
      place(want);
      host?.send({ type: 'flow', flow: flowConfig() });
    }
    const list = storyEl.getBoundingClientRect();
    const vH = firstVisual.getBoundingClientRect().height;
    story.enter = clamp01((vh - list.top) / Math.max(1, vh - PIN_Y));
    const focus = PIN_Y + vH + (vh - PIN_Y - vH) * 0.45;
    rows.forEach((row, i) => {
      const key = ['fix', 'build', 'auto'][i];
      if (!key) return;
      const target = row.getBoundingClientRect().top < focus ? 1 : 0;
      const step = dt / 1.3;
      story[key] = target > story[key] ? Math.min(1, story[key] + step) : Math.max(0, story[key] - step);
    });
    story.exit = mode === 'check' ? 1 : 0;

    // Text fades as it slides under the pinned laptop.
    let faded = false;
    if (mode === 'run') {
      const laptopTop = pin.getBoundingClientRect().top - G.D;
      if (laptopTop <= PIN_Y + 0.5) {
        const line = laptopTop + G.run.laptop.h - 12;
        fadeEls.forEach((el) => {
          const f = clamp01((el.getBoundingClientRect().top - line) / 56);
          el.style.opacity = f < 1 ? f.toFixed(3) : '';
        });
        fading = faded = true;
      }
    }
    if (!faded) resetFade();

    // Website check: the laptop opens once its box is in view.
    if (mode === 'check' && !POSTER && intro.p === 0 && !introTween) {
      const r = checkEl.getBoundingClientRect();
      if (r.top < vh * 0.8 && r.bottom > vh * 0.2) {
        introTween = gsap.to(intro, { p: 1, duration: 0.9, ease: 'power2.out' });
      }
    }
    const assemble = mode === 'run' ? proxy.assemble : 0.78 + 0.22 * intro.p;
    return { scrollY: 0, assemble, laptop: G[mode].laptop, story: { ...story } };
  };

  const mq = matchMedia('(max-width: 699px)');
  const onMq = () => { if (!mq.matches) ctx.off('the page switched to the wide layout'); };
  mq.addEventListener('change', onMq);
  ctx.cleanups.push(() => { mq.removeEventListener('change', onMq); introTween?.kill(); });

  let aboutCanvas = null;
  return {
    layout: sceneLayout,
    mount: (c) => {
      canvas = c;
      canvas.classList.add('flow');
      place(mode);
    },
    size: () => ({ width: G[mode].width, height: G[mode].height }),
    flow: flowConfig,
    relayout: () => {
      const before = FF_MOBILE && JSON.stringify(G);
      measure();
      // Firefox on phones: nothing really moved, so don't resize (and blank) the canvas.
      if (before && before === JSON.stringify(G)) return;
      place(mode);
      host?.send({ type: 'flow', flow: flowConfig() });
      host?.send({ type: 'layout', layout: sceneLayout() });
    },
    started: () => {
      host.send({ type: 'frame', state: frameState() });
      const onCheck = (e) => forwardCheck(e.detail);
      addEventListener('check:state', onCheck);
      ctx.cleanups.push(() => removeEventListener('check:state', onCheck));
      if (window.__checkState) forwardCheck(window.__checkState);
    },
    onMessage: (msg) => {
      if (msg.type === 'about-ready') aboutCanvas?.classList.add('is-on');
      if (msg.type === 'about-error') aboutCanvas?.remove();
    },
    wire: () => {
      let active = true;
      let last = '';
      const aboutEl = document.querySelector('.about');
      // The state is worked out every frame (the mode switch and the timed stages
      // depend on it) but only sent while the canvas is near the screen.
      const tick = () => {
        if (!host) return;
        const state = frameState();
        if (!active) return;
        const key = JSON.stringify(state);
        if (key !== last) {
          last = key;
          host.send({ type: 'frame', state });
        }
      };
      gsap.ticker.add(tick);
      ctx.cleanups.push(() => gsap.ticker.remove(tick));

      // Render only while the canvas is near the screen and the tab is visible.
      let near = true;
      let aboutNear = false;
      let aboutOn = false;
      const sync = () => {
        const on = near && !document.hidden;
        if (on !== active) {
          active = on;
          if (on) {
            last = '';
            tick();
          }
          host?.send({ type: 'active', value: on });
        }
        const a = aboutNear && !document.hidden;
        if (a !== aboutOn && aboutCanvas) {
          aboutOn = a;
          host?.send({ type: 'about-active', value: a });
        }
      };
      const io = new IntersectionObserver((entries) => {
        near = entries.at(-1).isIntersecting;
        sync();
      }, { rootMargin: '25% 0px' });
      io.observe(canvas);
      const aboutIo = new IntersectionObserver((entries) => {
        aboutNear = entries.at(-1).isIntersecting;
        sync();
      });
      document.addEventListener('visibilitychange', sync);
      ctx.cleanups.push(() => { io.disconnect(); aboutIo.disconnect(); document.removeEventListener('visibilitychange', sync); });

      // About: its own small canvas inside the section, as on desktop.
      if (aboutEl) {
        aboutCanvas = document.createElement('canvas');
        aboutCanvas.className = 'about-canvas';
        aboutCanvas.setAttribute('aria-hidden', 'true');
        aboutEl.prepend(aboutCanvas);
        const aSize = () => ({ width: Math.max(1, Math.round(aboutEl.clientWidth)), height: Math.max(1, Math.round(aboutEl.clientHeight)) });
        if (host.mode === 'worker' && 'transferControlToOffscreen' in aboutCanvas) {
          const offscreen = aboutCanvas.transferControlToOffscreen();
          host.send({ type: 'about-init', canvas: offscreen, ...aSize() }, [offscreen]);
        } else {
          host.send({ type: 'about-init', canvas: aboutCanvas, ...aSize() });
        }
        const aro = new ResizeObserver(() => host?.send({ type: 'about-resize', ...aSize() }));
        aro.observe(aboutEl);
        aboutIo.observe(aboutEl);
        const c = aboutCanvas;
        ctx.cleanups.push(() => { aro.disconnect(); c.remove(); });
      }
    },
  };
}

// ── 404 page ──────────────────────────────────
function startLost() {
  const anchorEl = document.querySelector('[data-anchor="lost"]');
  if (!anchorEl) return;
  return launch({
    scene: 'lost',
    prepare: async () => ({
      layout: () => {
        const r = anchorEl.getBoundingClientRect();
        return { anchor: { x: r.left, y: r.top, w: r.width, h: r.height } };
      },
      wire: (ctx) => {
        // Any pointer: moving near the paper pushes it, a click or tap kicks it.
        const send = (e, down) => host?.send({ type: 'pointer', x: e.clientX, y: e.clientY, t: e.timeStamp, down });
        const move = (e) => send(e, false);
        const down = (e) => send(e, true);
        const leave = () => host?.send({ type: 'pointer', x: null });
        const visible = () => host?.send({ type: 'active', value: !document.hidden });
        addEventListener('pointermove', move, { passive: true });
        addEventListener('pointerdown', down, { passive: true });
        root.addEventListener('pointerleave', leave);
        document.addEventListener('visibilitychange', visible);
        ctx.cleanups.push(() => {
          removeEventListener('pointermove', move);
          removeEventListener('pointerdown', down);
          root.removeEventListener('pointerleave', leave);
          document.removeEventListener('visibilitychange', visible);
        });
      },
    }),
  });
}

// ── Helpers ───────────────────────────────────

// The website check's progress, shown on the laptop screen. Screenshots go to
// the renderer as bitmaps (transferred, not copied, when it runs in a worker).
async function forwardCheck(d) {
  const msg = { type: 'check', state: d.state, host: d.host || '', frames: [], final: null };
  if (d.state === 'result') {
    const bitmap = async (src) => createImageBitmap(await (await fetch(src)).blob());
    try {
      msg.frames = await Promise.all((d.frames || []).map(bitmap));
      msg.final = d.screenshot ? await bitmap(d.screenshot) : null;
    } catch {
      msg.frames = [];
      msg.final = null;
    }
  }
  host?.send(msg, [...msg.frames, ...(msg.final ? [msg.final] : [])]);
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerpBox = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t });

async function loadGsap() {
  const [{ gsap }, { ScrollTrigger }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger')]);
  gsap.registerPlugin(ScrollTrigger);
  // The phone address bar sliding in and out must never re-measure the page.
  ScrollTrigger.config({ ignoreMobileResize: true });
  return { gsap, ScrollTrigger };
}

// Real GPU support only. Software renderers make the page slower, not nicer.
async function probeGPU() {
  if (params.get('3d') === 'force-webgl') return { webgl2: true, webgpu: false };
  let webgpu = false;
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      webgpu = !!adapter && !(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter);
    } catch {
      webgpu = false;
    }
  }
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
  let webgl2 = !!gl;
  let reason = gl ? '' : 'no hardware WebGL 2 or WebGPU';
  if (gl) {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) {
      webgl2 = false;
      reason = `software renderer (${name})`;
    }
  }
  return { webgl2, webgpu, reason };
}
