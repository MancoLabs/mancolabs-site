// Owns the renderer and the render loop. Runs inside a Web Worker when the
// browser can hand a canvas to one, otherwise on the main thread. Either way it
// only talks through handle(message) and post(message).
import { WebGPURenderer, PerspectiveCamera, Scene } from 'three/webgpu';
import { HeroScene } from './hero-scene.js';

const CAM_Z = 12;
const FOV = 30;

export class Stage {
  constructor(post) {
    this.post = post;
    this.state = { scrollY: 0, assemble: 0 };
    this.time = 0;
    this.active = true;
    this.ready = false;
    this.watch = { acc: 0, n: 0, strikes: 0 };
  }

  handle(msg) {
    switch (msg.type) {
      case 'init': return this.init(msg);
      case 'resize': return this.resize(msg);
      case 'layout': if (this.hero) this.hero.setLayout(msg.layout); return;
      case 'frame': Object.assign(this.state, msg.state); return;
      case 'pointer': this.hero?.setPointer(msg.x, msg.y, msg.t, msg.tilt); return;
      case 'palette': this.hero?.setPalette(msg.palette); return;
      case 'check': this.hero?.setCheck(msg); return;
      case 'active': return this.setActive(msg.value);
      case 'stats': this.wantStats = msg.value; return;
      case 'dispose': return this.dispose();
    }
  }

  async init({ canvas, width, height, dpr, palette, layout, forceWebGL, poster }) {
    try {
      this.poster = poster;
      this.dpr = dpr;
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
      this.hero = new HeroScene({ palette, mobile: width < 700 });
      this.hero.setLayout(layout);
      this.scene.add(this.hero.root);
      this.hero.update(0, 0, this.state, this.view);
      await renderer.compileAsync(this.scene, this.camera);

      this.frames = 0;
      this.last = performance.now();
      renderer.setAnimationLoop((now) => this.frame(now));
    } catch (err) {
      this.post({ type: 'error', message: String(err?.message || err) });
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

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.poster) this.time += dt;
    this.hero.update(this.time, this.poster ? 0 : dt, this.state, this.view);
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    if (!this.ready && this.frames >= 3) {
      this.ready = true;
      this.post({ type: 'ready', backend: this.backend });
    }
    if (!this.poster && this.frames > 90) this.watchdog(dt);
  }

  // Lower the resolution if frames run long; give up (poster mode) if even that fails.
  watchdog(dt) {
    const w = this.watch;
    w.acc += dt;
    w.n++;
    if (w.acc < 2) return;
    const avg = w.acc / w.n;
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
      this.post({ type: 'stats', fps: Math.round(fps), backend: this.backend, dpr: this.dpr, drawCalls: this.renderer.info.render.drawCalls });
    }
    w.acc = 0;
    w.n = 0;
  }

  setActive(on) {
    if (!this.renderer || on === this.active) return;
    this.active = on;
    if (on) {
      this.last = performance.now();
      this.watch = { acc: 0, n: 0, strikes: 0 };
      this.renderer.setAnimationLoop((now) => this.frame(now));
    } else {
      this.hero.update(this.time, 0, this.state, this.view);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setAnimationLoop(null);
    }
  }

  dispose() {
    this.renderer?.setAnimationLoop(null);
    this.hero?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.post({ type: 'disposed' });
  }
}
