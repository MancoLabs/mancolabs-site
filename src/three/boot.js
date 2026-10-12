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
    host.send({ type: 'frame', state: { scrollY: window.scrollY, assemble: proxy.assemble } });
  } catch (err) {
    return off(String(err?.message || err));
  }

  function wire() {
    let active = true;
    let pending = null;
    let last = { y: -1, a: -1 };

    const tick = () => {
      if (!active || !host) return;
      const y = window.scrollY;
      if (y !== last.y || proxy.assemble !== last.a) {
        last = { y, a: proxy.assemble };
        host.send({ type: 'frame', state: { scrollY: y, assemble: proxy.assemble } });
      }
      if (pending) {
        host.send({ type: 'pointer', ...pending });
        pending = null;
      }
    };
    gsap.ticker.add(tick);
    cleanups.push(() => gsap.ticker.remove(tick));

    // Only render while the hero or the assembly is near the screen and the tab is visible.
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
    if (tiltBtn && coarse && 'DeviceOrientationEvent' in window) {
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
