// Main-thread side of the 3D layer: checks the GPU, starts the renderer (in a
// worker when possible), feeds it scroll, pointer, and layout, and falls back to
// the static poster whenever something isn't right.
import { readPalette } from './palette.js';

const root = document.documentElement;
const params = new URLSearchParams(location.search);
const POSTER = params.has('poster') || params.has('og');

let teardown = null;
let host = null;

export function stopStage(reason) {
  teardown?.(reason);
}

export async function startStage() {
  const heroEl = document.querySelector('[data-stage="hero"]');
  const anchorEl = document.querySelector('[data-anchor="assembly"]');
  const statementEl = anchorEl?.closest('.statement');
  if (!heroEl || !anchorEl || !statementEl) return;

  const cleanups = [];
  let canvas = null;
  let done = false;

  const off = (reason) => {
    if (done) return;
    done = true;
    if (reason) console.info(`[3d] Showing the poster instead: ${reason}`);
    root.setAttribute('data-3d', 'off');
    cleanups.forEach((fn) => fn());
    host?.send({ type: 'dispose' });
    const h = host, c = canvas;
    host = null;
    setTimeout(() => { h?.stop(); c?.remove(); }, 900);
  };
  teardown = off;

  const [gpu, gsapMods] = await Promise.all([probeGPU(), loadGsap()]);
  if (!gpu.ok) return off(gpu.reason);
  // Let the hero's entrance animation settle so the text box is measured in place.
  await Promise.all(heroEl.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));

  const measure = () => {
    const sy = window.scrollY;
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top + sy, w: r.width, h: r.height };
    };
    const parts = [...heroEl.querySelectorAll('.hero-inner > :not(.hero-cta), .hero-cta > *')]
      .filter((el) => el.offsetParent !== null)
      .map(box);
    const k = parts.reduce(
      (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), r: Math.max(a.r, b.x + b.w), b: Math.max(a.b, b.y + b.h) }),
      { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity },
    );
    return { hero: box(heroEl), keepOut: { x: k.x, y: k.y, w: k.r - k.x, h: k.b - k.y }, assembly: box(anchorEl) };
  };

  // The laptop's path: assembly box, then held beside (desktop) or above (phone)
  // the services rows, then the website check box.
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
  cleanups.push(resetFade);

  const frameState = () => {
    const now = performance.now();
    const k = 1 - Math.exp(-Math.min(0.1, (now - lastFrame) / 1000) * 10);
    lastFrame = now;
    const vh = innerHeight;
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
        const r = row.getBoundingClientRect();
        const key = ['fix', 'build', 'auto'][i];
        if (key) story[key] += (clamp01((focus - r.top) / r.height) - story[key]) * k;
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

  // Scroll-scrubbed assembly progress.
  // Poster and share-image captures stay frozen at the very start.
  const { gsap } = gsapMods;
  const proxy = { assemble: 0 };
  if (!POSTER) {
    const tween = gsap.to(proxy, {
      assemble: 1,
      ease: 'none',
      scrollTrigger: { trigger: statementEl, start: 'top 85%', endTrigger: anchorEl, end: 'center 52%', scrub: 0.8 },
    });
    tween.progress(tween.scrollTrigger.progress);
    cleanups.push(() => { tween.scrollTrigger?.kill(); tween.kill(); });
  }

  canvas = document.createElement('canvas');
  canvas.className = 'stage-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const coarse = matchMedia('(pointer: coarse)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, POSTER ? 3 : coarse ? 1.5 : 2);
  const size = () => ({ width: canvas.clientWidth, height: canvas.clientHeight });

  const startTimer = setTimeout(() => off('the renderer took too long to start'), 15000);
  cleanups.push(() => clearTimeout(startTimer));

  const onMessage = (msg) => {
    if (done) return;
    if (msg.type === 'ready') {
      clearTimeout(startTimer);
      root.setAttribute('data-3d', 'live');
      root.dataset.renderer = msg.backend;
      root.dataset.renderThread = host.mode;
      if (POSTER) root.dataset.posterReady = 'true';
      else wire();
    } else if (msg.type === 'slow') {
      off(`frame rate too low (${msg.fps} fps)`);
    } else if (msg.type === 'error') {
      off(msg.message);
    } else if (msg.type === 'stats') {
      window.dispatchEvent(new CustomEvent('stage:stats', { detail: { ...msg, thread: host?.mode } }));
    }
  };

  const init = {
    type: 'init',
    ...size(),
    dpr,
    palette: readPalette(),
    layout: measure(),
    forceWebGL: gpu.forceWebGL,
    poster: POSTER,
  };

  const onCheck = (e) => forwardCheck(e.detail);
  addEventListener('check:state', onCheck);
  cleanups.push(() => removeEventListener('check:state', onCheck));

  const useWorker = !params.has('mainthread') && typeof Worker !== 'undefined' && 'transferControlToOffscreen' in canvas;
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
    host.send({ type: 'frame', state: frameState() });
    if (window.__checkState) forwardCheck(window.__checkState);
  } catch (err) {
    return off(String(err?.message || err));
  }

  function wire() {
    let active = true;
    let pending = null;
    let last = '';

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
    cleanups.push(() => gsap.ticker.remove(tick));

    // Only render while a 3D part of the page is near the screen and the tab is visible.
    const near = new Set();
    const sync = () => {
      const on = near.size > 0 && !document.hidden;
      if (on === active) return;
      if (!on) tick();
      active = on;
      host?.send({ type: 'active', value: on });
    };
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? near.add(e.target) : near.delete(e.target)));
      sync();
    }, { rootMargin: '25% 0px' });
    io.observe(heroEl);
    io.observe(statementEl);
    if (storyEl) io.observe(storyEl);
    if (checkEl) io.observe(checkEl);
    document.addEventListener('visibilitychange', sync);
    cleanups.push(() => { io.disconnect(); document.removeEventListener('visibilitychange', sync); });

    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      const move = (e) => { pending = { x: e.clientX, y: e.clientY, t: e.timeStamp }; };
      const leave = () => { pending = { x: null }; };
      addEventListener('pointermove', move, { passive: true });
      root.addEventListener('pointerleave', leave);
      cleanups.push(() => { removeEventListener('pointermove', move); root.removeEventListener('pointerleave', leave); });
    }

    const tiltBtn = heroEl.querySelector('.tilt-toggle');
    // Motion sensors only work on HTTPS (or localhost), so don't offer tilt elsewhere.
    if (tiltBtn && coarse && window.isSecureContext && 'DeviceOrientationEvent' in window) {
      let tilting = false;
      const onTilt = (e) => {
        if (e.gamma == null) return;
        const clamp = (v) => Math.max(-1, Math.min(1, v));
        pending = {
          x: innerWidth / 2 + clamp(e.gamma / 30) * innerWidth * 0.45,
          y: innerHeight * 0.45 + clamp((e.beta - 40) / 30) * innerHeight * 0.35,
          t: e.timeStamp,
          tilt: true,
        };
      };
      const toggle = async () => {
        if (tilting) {
          removeEventListener('deviceorientation', onTilt);
          tilting = false;
          pending = { x: null };
        } else {
          if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            const answer = await DeviceOrientationEvent.requestPermission().catch(() => 'denied');
            if (answer !== 'granted') return;
          }
          addEventListener('deviceorientation', onTilt);
          tilting = true;
        }
        tiltBtn.setAttribute('aria-pressed', String(tilting));
      };
      tiltBtn.hidden = false;
      tiltBtn.addEventListener('click', toggle);
      cleanups.push(() => {
        tiltBtn.hidden = true;
        tiltBtn.removeEventListener('click', toggle);
        removeEventListener('deviceorientation', onTilt);
      });
    }

    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        host?.send({ type: 'resize', ...size() });
        host?.send({ type: 'layout', layout: measure() });
      }, 150);
    });
    ro.observe(canvas);
    ro.observe(document.body);
    cleanups.push(() => { ro.disconnect(); clearTimeout(resizeTimer); });

    // Live numbers for the developer view: dispatch 'stage:want-stats' with detail true/false.
    const wantStats = (e) => host?.send({ type: 'stats', value: !!e.detail });
    addEventListener('stage:want-stats', wantStats);
    cleanups.push(() => removeEventListener('stage:want-stats', wantStats));

    const scheme = matchMedia('(prefers-color-scheme: dark)');
    const repaint = () => host?.send({ type: 'palette', palette: readPalette() });
    scheme.addEventListener('change', repaint);
    cleanups.push(() => scheme.removeEventListener('change', repaint));
  }
}

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
  return { gsap, ScrollTrigger };
}

// A real GPU only. Software renderers make the page slower, not nicer.
async function probeGPU() {
  if (params.get('3d') === 'force-webgl') return { ok: true, forceWebGL: true };
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      const fallback = adapter?.info?.isFallbackAdapter ?? adapter?.isFallbackAdapter;
      if (adapter && !fallback) return { ok: true, forceWebGL: false };
    } catch {
      // fall through to the WebGL 2 check
    }
  }
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
  if (!gl) return { ok: false, reason: 'no hardware WebGL 2 or WebGPU' };
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) return { ok: false, reason: `software renderer (${name})` };
  return { ok: true, forceWebGL: true };
}
