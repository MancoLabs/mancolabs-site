// The 404 page: one lost invoice floating over the page. Push it with the
// mouse, or tap near it on a phone, and it bounces off the edges of the screen.
import { Group, Mesh, PlaneGeometry, MeshBasicNodeMaterial, CanvasTexture, SRGBColorSpace, DoubleSide, Color, Vector3 } from 'three/webgpu';
import { uniform, uv, vec2, vec4, float, mix, sin, abs, dot, smoothstep, select, texture, frontFacing, normalWorld, normalLocal, positionLocal, positionGeometry, length } from 'three/tsl';
import { ATLAS_SIZE, ATLAS_RECTS, makeCanvas, drawPaperAtlas } from './textures.js';

const LIGHT = new Vector3(-0.35, 0.82, 0.48).normalize();

export class LostScene {
  constructor({ palette, mobile }) {
    this.root = new Group();
    this.mobile = mobile;
    this.u = {
      time: uniform(0),
      speed: uniform(0),
      light: uniform(LIGHT.clone()),
      back: uniform(new Color()),
      ink: uniform(new Color()),
    };
    this.atlasCanvas = makeCanvas(ATLAS_SIZE, ATLAS_SIZE);
    this.atlas = new CanvasTexture(this.atlasCanvas);
    this.atlas.colorSpace = SRGBColorSpace;
    this.atlas.anisotropy = 4;

    const [x, y, w, h] = ATLAS_RECTS[0];
    this.aspect = w / h;
    const rect = vec4(x / ATLAS_SIZE, 1 - (y + h) / ATLAS_SIZE, w / ATLAS_SIZE, h / ATLAS_SIZE);
    const { time, speed, light, back, ink } = this.u;

    const mat = new MeshBasicNodeMaterial({ side: DoubleSide });
    mat.positionNode = positionLocal.add(
      normalLocal.mul(sin(positionGeometry.x.mul(5).add(time.mul(2))).mul(float(0.02).add(speed.mul(0.06)))),
    );
    const tex = texture(this.atlas, rect.xy.add(uv().mul(rect.zw)));
    mat.colorNode = select(frontFacing, tex.rgb, back).mul(mix(float(0.8), float(1), abs(dot(normalWorld, light))));
    this.paper = new Mesh(new PlaneGeometry(1, 1, 6, 6), mat);

    const shadowMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    shadowMat.colorNode = ink;
    shadowMat.opacityNode = smoothstep(0.5, 0.05, length(uv().sub(vec2(0.5)))).mul(0.16);
    this.shadow = new Mesh(new PlaneGeometry(1, 1), shadowMat);

    this.root.add(this.shadow, this.paper);
    this.setPalette(palette);

    this.state = { x: 0, y: 0, vx: 0, vy: 0, angle: -0.18, spin: 0, placed: false };
    this.pointer = { x: 0, y: 0, active: false, lastX: 0, lastY: 0, lastT: 0, speed: 0 };
  }

  setPalette(P) {
    this.palette = P;
    drawPaperAtlas(this.atlasCanvas.getContext('2d'), P);
    this.atlas.needsUpdate = true;
    this.u.back.value.set(P.paper3);
    this.u.ink.value.set(P.ink);
  }

  setLayout(layout) {
    this.layout = layout;
  }

  setPointer(x, y, t, down) {
    const p = this.pointer;
    if (x == null) { p.active = false; return; }
    if (p.active && t > p.lastT) p.speed = Math.hypot(x - p.lastX, y - p.lastY) / ((t - p.lastT) / 1000);
    p.active = true;
    p.x = x; p.y = y; p.lastX = x; p.lastY = y; p.lastT = t;
    if (down) this.tap = { x, y };
  }

  toWorld(px, py, z, view, out) {
    const k = (view.camZ - z) / view.camZ;
    return out.set(((px - view.width / 2) / view.ppu) * k, (-(py - view.height / 2) / view.ppu) * k, z);
  }

  update(time, dt, state, view) {
    const s = this.state;
    const hPx = this.mobile ? 120 : 160;
    const wPx = hPx * this.aspect;
    if (!s.placed) {
      const a = this.layout.anchor;
      s.x = a.x + a.w / 2;
      s.y = a.y + a.h / 2;
      s.placed = true;
    }
    if (dt > 0) {
      // Gentle drift, like it's caught in a draft.
      s.vx += Math.sin(time * 0.31) * 10 * dt;
      s.vy += Math.cos(time * 0.23) * 8 * dt;

      const p = this.pointer;
      const reach = Math.max(wPx, hPx) * 0.9;
      if (p.active) {
        const dx = s.x - p.x, dy = s.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < reach && d > 1) {
          const f = (1 - d / reach) ** 2 * (500 + Math.min(p.speed, 4000) * 1.6) * dt;
          s.vx += (dx / d) * f;
          s.vy += (dy / d) * f;
          s.spin += (dx > 0 ? -1 : 1) * f * 0.004;
        }
        p.speed *= Math.exp(-dt * 6);
      }
      if (this.tap) {
        const dx = s.x - this.tap.x, dy = s.y - this.tap.y;
        const d = Math.hypot(dx, dy);
        if (d < reach * 1.4) {
          const kick = 1100 * (1 - d / (reach * 1.4)) + 250;
          s.vx += (dx / (d || 1)) * kick;
          s.vy += (dy / (d || 1)) * kick;
          s.spin += (Math.random() - 0.5) * 6;
        }
        this.tap = null;
      }

      s.vx *= Math.exp(-dt * 0.9);
      s.vy *= Math.exp(-dt * 0.9);
      s.spin *= Math.exp(-dt * 1.4);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.angle += s.spin * dt;

      // Bounce off the screen edges (below the header).
      const mx = wPx * 0.45, top = 72 + hPx * 0.45, bottom = view.height - hPx * 0.45;
      if (s.x < mx) { s.x = mx; s.vx = Math.abs(s.vx) * 0.7; }
      if (s.x > view.width - mx) { s.x = view.width - mx; s.vx = -Math.abs(s.vx) * 0.7; }
      if (s.y < top) { s.y = top; s.vy = Math.abs(s.vy) * 0.7; }
      if (s.y > bottom) { s.y = bottom; s.vy = -Math.abs(s.vy) * 0.7; }
    }

    const speed = Math.hypot(s.vx, s.vy);
    this.u.time.value = time;
    this.u.speed.value = Math.min(1, speed / 900);
    const tiltX = Math.max(-0.7, Math.min(0.7, s.vy * 0.0012)) + Math.sin(time * 0.7) * 0.12;
    const tiltY = Math.max(-0.7, Math.min(0.7, s.vx * 0.0012)) + Math.cos(time * 0.5) * 0.15;
    this.toWorld(s.x, s.y, 0.6, view, this.paper.position);
    this.paper.rotation.set(tiltX, tiltY, s.angle);
    this.paper.scale.set(wPx / view.ppu, hPx / view.ppu, 1);
    this.toWorld(s.x + 14, s.y + 22, -0.4, view, this.shadow.position);
    this.shadow.rotation.set(0, 0, s.angle);
    this.shadow.scale.set((wPx * 1.25) / view.ppu, (hPx * 1.1) / view.ppu, 1);
  }

  dispose() {
    this.root.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    this.atlas.dispose();
  }
}
