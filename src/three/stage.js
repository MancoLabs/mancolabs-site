// Owns the renderer and the render loop. Runs inside a Web Worker when the
// browser can hand a canvas to one, otherwise on the main thread. Either way it
// only talks through handle(message) and post(message).
import { WebGPURenderer, PerspectiveCamera, Scene } from 'three/webgpu';
import { HeroScene } from './hero-scene.js';
import { LostScene } from './lost-scene.js';
import { AboutBackdrop } from './about-backdrop.js';

const CAM_Z = 12;
const FOV = 30;
const SCENES = { hero: HeroScene, lost: LostScene };

// The live scene only replaces the poster after this many smooth frames in a row.
const WARM_FRAMES = 12;
const SMOOTH_DT = 1 / 40;
const WARM_TIMEOUT = 5;

export class Stage {
  constructor(post) {
    this.post = post;
    this.state = { scrollY: 0, assemble: 0 };
    this.time = 0;
    this.mainActive = true;
    this.aboutActive = false;
    this.running = false;
    this.ready = false;
    this.warm = { streak: 0, elapsed: 0 };
    this.watch = { dts: [], acc: 0, strikes: 0 };
  }

  handle(msg) {
    switch (msg.type) {
      case 'init': return this.init(msg);
      case 'resize': return this.resize(msg);
      case 'layout': this.scene3?.setLayout(msg.layout); return;
      case 'frame': Object.assign(this.state, msg.state); return;
      case 'pointer': this.scene3?.setPointer(msg.x, msg.y, msg.t, msg.down); return;
      case 'palette': this.scene3?.setPalette(msg.palette); this.about?.setPalette(msg.palette); return;
      case 'check': this.scene3?.setCheck?.(msg); return;
      case 'active': this.mainActive = msg.value; return this.sync();
      case 'about-init': return this.initAbout(msg);
      case 'about-resize': this.about?.resize(msg.width, msg.height); return;
      case 'about-pointer': this.about?.setPointer(msg.x, msg.y, msg.width, msg.height); return;
      case 'about-active': this.aboutActive = msg.value; return this.sync();
      case 'stats': this.wantStats = msg.value; return;
      case 'dispose': return this.dispose();
    }
  }

  async init({ canvas, width, height, dpr, palette, layout, forceWebGL, poster, scene = 'hero' }) {
    try {
      this.poster = poster;
      this.dpr = dpr;
      this.forceWebGL = forceWebGL;
      this.palette = palette;
      const renderer = new WebGPURenderer({ canvas, alpha: true, antialias: dpr < 1.75, forceWebGL });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      await renderer.init();
      this.renderer = renderer;
      this.backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';

      this.camera = new PerspectiveCamera(FOV, width / height, 0.1, 60);
      this.camera.position.set(0, 0, CAM_Z);
      this.view = { width, height, camZ: CAM_Z, ppu: 0 };
      this.updateView(width, height);

      this.scene = new Scene();
      this.scene3 = new SCENES[scene]({ palette, mobile: width < 700 });
      this.scene3.setLayout(layout);
      this.scene.add(this.scene3.root);
      this.scene3.update(0, 0, this.state, this.view);

      // Compile every shader and upload every texture now, including parts that
      // only appear later (the laptop, the services effects), so nothing has to
      // compile in the middle of a scroll.
      const restore = this.scene3.showAllForCompile?.();
      for (const t of this.scene3.textures?.() || []) renderer.initTexture?.(t);
      await renderer.compileAsync(this.scene, this.camera);
      // Then draw everything once while the canvas is still invisible: some GPU
      // drivers only finish setting up a shader the first time it draws.
      renderer.render(this.scene, this.camera);
      restore?.();

      this.frames = 0;
      this.sync();
    } catch (err) {
      this.post({ type: 'error', message: String(err?.message || err) });
    }
  }

  async initAbout({ canvas, width, height }) {
    try {
      const about = new AboutBackdrop();
      await about.init({ canvas, width, height, palette: this.palette, forceWebGL: this.forceWebGL });
      this.about = about;
      about.render(this.time, 0);
      this.post({ type: 'about-ready' });
      this.sync();
    } catch (err) {
      this.post({ type: 'about-error', message: String(err?.message || err) });
    }
  }

  updateView(width, height) {
    this.view.width = width;
    this.view.height = height;
    this.view.ppu = height / (2 * Math.tan((FOV * Math.PI) / 360) * CAM_Z);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  resize({ width, height }) {
    if (!this.renderer) return;
    this.renderer.setSize(width, height, false);
    this.updateView(width, height);
  }

  // Run the loop only while something visible needs drawing. Pausing keeps the
  // scene and everything on the GPU, so resuming is immediate.
  sync() {
    if (!this.renderer) return;
    const want = this.mainActive || (this.aboutActive && !!this.about);
    if (want === this.running) return;
    this.running = want;
    if (want) {
      this.last = performance.now();
      this.resumedAt = this.ready ? performance.now() : null;
      this.watch = { dts: [], acc: 0, strikes: 0 };
      this.renderer.setAnimationLoop((now) => this.frame(now));
    } else {
      // One last frame with the latest scroll position, then stop.
      this.scene3.update(this.time, 0, this.state, this.view);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setAnimationLoop(null);
      this.post({ type: 'loop', running: false });
    }
  }

  frame(now) {
    const raw = (now - this.last) / 1000;
    const dt = Math.min(0.05, raw);
    this.last = now;
    if (!this.poster) this.time += dt;
    if (this.mainActive || !this.ready) {
      this.scene3.update(this.time, this.poster ? 0 : dt, this.state, this.view);
      this.renderer.render(this.scene, this.camera);
    }
    if (this.aboutActive) this.about?.render(this.time, dt);
    this.frames++;
    if (this.resumedAt != null) {
      this.post({ type: 'loop', running: true, resumeMs: Math.round(performance.now() - this.resumedAt) });
      this.resumedAt = null;
    }
    if (!this.ready) this.warmUp(raw);
    else if (!this.poster) this.watchdog(raw);
  }

  // Wait for a run of smooth frames before swapping the poster for the live scene.
  warmUp(dt) {
    const w = this.warm;
    if (this.frames <= 3) return;
    w.elapsed += dt;
    w.streak = dt < SMOOTH_DT || this.poster ? w.streak + 1 : 0;
    if (w.streak >= WARM_FRAMES) {
      this.ready = true;
      this.post({ type: 'ready', backend: this.backend });
    } else if (w.elapsed > WARM_TIMEOUT) {
      this.post({ type: 'slow', fps: Math.round(1 / Math.max(dt, 1e-3)) });
    }
  }

  // Lower the resolution if frames run long; give up (poster mode) if even that fails.
  watchdog(dt) {
    const w = this.watch;
    if (dt > 0.25) return; // a paused or backgrounded tab, not a slow frame
    w.dts.push(dt);
    w.acc += dt;
    if (w.acc < 2) return;
    const sorted = [...w.dts].sort((a, b) => a - b);
    const avg = w.acc / w.dts.length;
    const fps = 1 / avg;
    if (avg > 1 / 42 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.renderer.setSize(this.view.width, this.view.height, false);
    } else if (fps < 30) {
      if (++w.strikes >= 2) this.post({ type: 'slow', fps: Math.round(fps) });
    } else {
      w.strikes = 0;
    }
    if (this.wantStats) {
      this.post({
        type: 'stats',
        fps: Math.round(fps),
        p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 1000 * 10) / 10,
        maxMs: Math.round(sorted.at(-1) * 1000),
        slow: w.dts.filter((d) => d > 1 / 30).length,
        frames: w.dts.length,
        backend: this.backend,
        dpr: this.dpr,
        drawCalls: this.renderer.info.render.drawCalls,
      });
    }
    w.dts = [];
    w.acc = 0;
  }

  dispose() {
    this.renderer?.setAnimationLoop(null);
    this.scene3?.dispose();
    this.about?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.post({ type: 'disposed' });
  }
}
