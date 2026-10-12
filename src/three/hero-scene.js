import {
  Group, Mesh, InstancedMesh, PlaneGeometry, ExtrudeGeometry, Shape, MeshBasicNodeMaterial,
  CanvasTexture, SRGBColorSpace, DoubleSide, Color, Vector3, Quaternion, Matrix4, Euler,
  InstancedBufferAttribute, DynamicDrawUsage, Box3,
} from 'three/webgpu';
import {
  Fn, uniform, texture, uv, vec4, float, mix, sin, abs, dot, max, smoothstep, step, select,
  frontFacing, normalWorld, normalLocal, positionLocal, positionGeometry, positionView, instancedBufferAttribute, instancedDynamicBufferAttribute,
} from 'three/tsl';
import {
  ATLAS_SIZE, ATLAS_RECTS, PAPER_ASPECT, SCREEN_W, SCREEN_H, makeCanvas, drawPaperAtlas, drawScreen,
} from './textures.js';

// Laptop body, in scene units. The closed lid's top surface sits at y = 0 so the
// paper tiles land on it no matter how far the body has grown downward.
const LW = 3.2, LD = 2.2, LID_T = 0.07, BASE_T = 0.11;
const LID_OPEN = 1.86; // radians (about 107 degrees)
const LIGHT = new Vector3(-0.35, 0.82, 0.48).normalize();

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a, b, t) => a + (b - a) * t;

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundedRect(w, h, r) {
  const s = new Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// A slab lying in the XZ plane, spanning y from -thickness to 0.
function slab(w, d, thickness, radius) {
  const g = new ExtrudeGeometry(roundedRect(w, d, radius), {
    depth: thickness - 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 6,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -thickness + 0.015, 0);
  return g;
}

function shadedMaterial(colorUniform, light) {
  const m = new MeshBasicNodeMaterial();
  m.colorNode = colorUniform.mul(mix(float(0.58), float(1), max(dot(normalWorld, light), 0)));
  return m;
}

export class HeroScene {
  constructor({ palette, mobile, seed = 7 }) {
    this.root = new Group();
    this.mobile = mobile;
    this.seed = seed;
    [this.cols, this.rows] = mobile ? [8, 6] : [12, 8];
    this.count = this.cols * this.rows;

    this.u = {
      time: uniform(0),
      light: uniform(LIGHT.clone()),
      bg: uniform(new Color()),
      back: uniform(new Color()),
      frame: uniform(new Color()),
      deck: uniform(new Color()),
      screenOff: uniform(new Color()),
      fuse: uniform(0),
      power: uniform(0),
      dim: uniform(1),
    };

    this.atlasCanvas = makeCanvas(ATLAS_SIZE, ATLAS_SIZE);
    this.atlas = new CanvasTexture(this.atlasCanvas);
    this.atlas.colorSpace = SRGBColorSpace;
    this.atlas.anisotropy = 4;
    this.screenCanvas = makeCanvas(SCREEN_W, SCREEN_H);
    this.screenTex = new CanvasTexture(this.screenCanvas);
    this.screenTex.colorSpace = SRGBColorSpace;
    this.screenTex.anisotropy = 4;

    this.buildPapers();
    this.buildLaptop();
    this.poses = { closed: this.measurePose(0), open: this.measurePose(1) };
    this.setPalette(palette);

    // Scratch objects reused every frame.
    this._m = new Matrix4(); this._q = new Quaternion(); this._q2 = new Quaternion(); this._qt = new Quaternion();
    this._p = new Vector3(); this._p2 = new Vector3(); this._s = new Vector3(); this._axis = new Vector3();
    this._flat = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
    this._laptopQ = new Quaternion();
    this.pointer = { x: 0, y: 0, active: false, energy: 0, lastX: 0, lastY: 0, lastT: 0 };
  }

  buildPapers() {
    const n = this.count;
    const geo = new PlaneGeometry(1, 1, 4, 4);
    this.info = new Float32Array(n * 4); // seed, type, curl, unused
    this.morph = new Float32Array(n);
    this.infoAttr = new InstancedBufferAttribute(this.info, 4);
    this.morphAttr = new InstancedBufferAttribute(this.morph, 1);
    this.morphAttr.setUsage(DynamicDrawUsage);
    const aInfo = instancedBufferAttribute(this.infoAttr);
    const aMorph = instancedDynamicBufferAttribute(this.morphAttr);
    const { time, light, bg, back, frame, fuse, dim } = this.u;

    const mat = new MeshBasicNodeMaterial({ side: DoubleSide });
    // Flutter and a gentle curl while the paper is free; flat once it lands.
    // Instancing runs before positionNode, so measure along the paper's own
    // surface (positionGeometry) and push along its own normal.
    mat.positionNode = Fn(() => {
      const g = positionGeometry;
      const free = float(1).sub(aMorph);
      const wave = sin(g.x.mul(5).add(time.mul(1.6)).add(aInfo.x.mul(6.283))).mul(0.035);
      const curl = g.x.mul(g.x).mul(aInfo.z);
      return positionLocal.add(normalLocal.mul(wave.add(curl).mul(free)));
    })();

    const rect = (i) => {
      const [x, y, w, h] = ATLAS_RECTS[i];
      return vec4(x / ATLAS_SIZE, 1 - (y + h) / ATLAS_SIZE, w / ATLAS_SIZE, h / ATLAS_SIZE);
    };
    const t = aInfo.y;
    const r = rect(0)
      .add(rect(1).sub(rect(0)).mul(step(0.5, t)))
      .add(rect(2).sub(rect(1)).mul(step(1.5, t)))
      .add(rect(3).sub(rect(2)).mul(step(2.5, t)));
    const tex = texture(this.atlas, r.xy.add(uv().mul(r.zw)));
    const albedo = select(frontFacing, tex.rgb, back);
    const shade = mix(float(0.8), float(1), abs(dot(normalWorld, light)));
    const landed = smoothstep(0.98, 1, aMorph);
    const lit = mix(albedo.mul(shade).mul(dim), frame.mul(shade), fuse.mul(landed));
    const fog = smoothstep(11.5, 16, positionView.z.negate()).mul(0.5);
    mat.colorNode = mix(lit, bg, fog);
    mat.opacityNode = tex.a;
    mat.alphaTest = 0.5;

    this.papers = new InstancedMesh(geo, mat, n);
    this.papers.instanceMatrix.setUsage(DynamicDrawUsage);
    this.papers.frustumCulled = false;
    this.root.add(this.papers);
  }

  buildLaptop() {
    const { light, frame, deck, screenOff, power } = this.u;
    this.laptop = new Group();
    this.body = new Group(); // grows from flat to full thickness while the tiles fuse
    this.laptop.add(this.body);

    const frameMat = shadedMaterial(frame, light);
    const deckMat = shadedMaterial(deck, light);

    const base = new Mesh(slab(LW, LD, BASE_T, 0.14), frameMat);
    base.position.y = -LID_T;
    this.body.add(base);

    const deckMesh = new Mesh(new PlaneGeometry(LW * 0.86, LD * 0.5), deckMat);
    deckMesh.rotation.x = -Math.PI / 2;
    deckMesh.position.set(0, -LID_T + 0.002, -LD * 0.12);
    const pad = new Mesh(new PlaneGeometry(LW * 0.26, LD * 0.24), deckMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0, -LID_T + 0.002, LD * 0.3);
    this.body.add(deckMesh, pad);

    // Lid pivots on its back edge (the hinge).
    this.lid = new Group();
    this.lid.position.set(0, -LID_T, -LD / 2);
    const lidMesh = new Mesh(slab(LW, LD, LID_T, 0.14), frameMat);
    lidMesh.position.set(0, LID_T, LD / 2);
    this.lid.add(lidMesh);

    const screenMat = new MeshBasicNodeMaterial();
    screenMat.colorNode = mix(screenOff, texture(this.screenTex).rgb, power);
    const screen = new Mesh(new PlaneGeometry(LW * 0.9, LD * 0.86), screenMat);
    screen.rotation.x = Math.PI / 2; // faces down when closed, toward the viewer when open
    screen.position.set(0, -0.003, LD / 2 + 0.02);
    this.lid.add(screen);
    this.body.add(this.lid);

    this.root.add(this.laptop);
  }

  // Size and center of the laptop (at scale 1) when closed and when open, so it
  // can be fitted inside its placeholder box in the page.
  measurePose(open) {
    this.laptop.position.set(0, 0, 0);
    this.laptop.scale.setScalar(1);
    this.laptop.rotation.set(lerp(0.95, 0.24, open), lerp(-0.16, -0.42, open), 0);
    this.body.scale.y = 1;
    this.lid.rotation.x = -open * LID_OPEN;
    this.laptop.updateMatrixWorld(true);
    const box = new Box3().setFromObject(this.laptop);
    return { center: box.getCenter(new Vector3()), size: box.getSize(new Vector3()) };
  }

  setPalette(P) {
    this.palette = P;
    drawPaperAtlas(this.atlasCanvas.getContext('2d'), P);
    drawScreen(this.screenCanvas.getContext('2d'), P);
    this.atlas.needsUpdate = true;
    this.screenTex.needsUpdate = true;
    this.u.bg.value.set(P.bg);
    this.u.back.value.set(P.paper3);
    this.u.frame.value.set(P.frame);
    this.u.deck.value.set(P.base);
    this.u.screenOff.value.set(P.ink);
    this.u.dim.value = P.dark ? 0.86 : 1;
  }

  // Positions are stored relative to the hero box, so the field scrolls with the page.
  setLayout(layout) {
    this.layout = layout;
    const rnd = mulberry32(this.seed);
    const { hero, keepOut } = layout;
    const n = this.count;
    const types = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3];
    const minPx = this.mobile ? 42 : 58, maxPx = this.mobile ? 76 : 108;
    this.items = [];
    for (let i = 0; i < n; i++) {
      const type = types[Math.floor(rnd() * types.length)];
      const aspect = PAPER_ASPECT[type];
      const depth = lerp(-3.4, 1.3, rnd() ** 0.85);
      const size = lerp(minPx, maxPx, rnd());
      const hPx = type === 3 ? size * 1.35 : size;
      const wPx = hPx * aspect;
      let u = 0, v = 0;
      for (let a = 0; a < 60; a++) {
        u = -0.05 + rnd() * 1.1;
        v = -0.06 + rnd() * 1.12;
        const px = hero.x + u * hero.w, py = hero.y + v * hero.h;
        const m = Math.max(wPx, hPx) * 0.6 + 40;
        const inside = px > keepOut.x - m && px < keepOut.x + keepOut.w + m && py > keepOut.y - m && py < keepOut.y + keepOut.h + m;
        if (!inside) break;
      }
      const e = new Euler((rnd() - 0.5) * 1.2, (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 2.4);
      if (rnd() < 0.12) e.x += Math.PI;
      this.items.push({
        type, u, v, depth, wPx, hPx,
        q: new Quaternion().setFromEuler(e),
        axis: new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
        spin: (0.04 + rnd() * 0.12) * (rnd() < 0.5 ? -1 : 1),
        ph: [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28],
        arc: 0.4 + rnd() * 1.1,
        off: new Vector3(), vel: new Vector3(),
      });
      this.info[i * 4] = rnd();
      this.info[i * 4 + 1] = type;
      this.info[i * 4 + 2] = (rnd() - 0.5) * 0.5;
    }
    this.infoAttr.needsUpdate = true;
    // Pair papers with lid tiles left-to-right so paths cross less.
    const byU = this.items.map((it, i) => [it.u + (rnd() - 0.5) * 0.25, i]).sort((a, b) => a[0] - b[0]);
    const tiles = [];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) tiles.push([c, r, (c + (rnd() - 0.5) * 3) / this.cols]);
    tiles.sort((a, b) => a[2] - b[2]);
    const tw = LW / this.cols, td = LD / this.rows;
    byU.forEach(([, idx], k) => {
      const [c, r] = tiles[k];
      const it = this.items[idx];
      it.tile = new Vector3(-LW / 2 + tw * (c + 0.5), 0.004, -LD / 2 + td * (r + 0.5));
      it.tileW = tw; it.tileD = td;
      // Back rows land first, so the lid fills in from the hinge toward you.
      it.delay = (r / this.rows) * 0.75 + rnd() * 0.25;
    });
  }

  setPointer(x, y, t, tilt) {
    const p = this.pointer;
    if (x == null) { p.active = false; return; }
    if (p.active && t > p.lastT) {
      const speed = Math.hypot(x - p.lastX, y - p.lastY) / Math.max(8, t - p.lastT); // px per ms
      p.energy = Math.min(1, Math.max(p.energy, speed * (tilt ? 1.2 : 0.9)));
    }
    p.active = true; p.tilt = tilt;
    p.x = x; p.y = y; p.lastX = x; p.lastY = y; p.lastT = t;
  }

  toWorld(px, py, z, view, out) {
    const k = (view.camZ - z) / view.camZ;
    return out.set(((px - view.width / 2) / view.ppu) * k, (-(py - view.height / 2) / view.ppu) * k, z);
  }

  update(time, dt, state, view) {
    const { hero, assembly } = this.layout;
    const sy = state.scrollY;
    const A = state.assemble;
    this.u.time.value = time;

    const fuse = smooth(0.6, 0.74, A);
    const open = smooth(0.74, 0.95, A);
    const openE = easeInOut(open);
    this.u.fuse.value = fuse;
    this.u.power.value = smooth(0.86, 1, A);

    // Laptop is fitted inside its placeholder box in the page and follows it.
    const { closed, open: opened } = this.poses;
    const scale = Math.min(assembly.w / (opened.size.x * view.ppu), assembly.h / (opened.size.y * view.ppu)) * 0.97;
    const cx = assembly.x + assembly.w / 2;
    const cy = assembly.y - sy + assembly.h / 2;
    this.laptop.rotation.set(lerp(0.95, 0.24, openE), lerp(-0.16, -0.42, openE), 0);
    this.laptop.scale.setScalar(scale);
    const center = this._p2.lerpVectors(closed.center, opened.center, openE).multiplyScalar(scale);
    this.toWorld(cx, cy, 0, view, this.laptop.position).sub(center);
    this.body.scale.y = Math.max(0.02, fuse);
    this.lid.rotation.x = -open * LID_OPEN;
    this.laptop.visible = fuse > 0;
    this.laptop.updateMatrixWorld(true);
    this._laptopQ.setFromEuler(this.laptop.rotation);

    const papersVisible = fuse < 1;
    this.papers.visible = papersVisible;
    if (!papersVisible) return;

    // Pointer push: energy decays when the pointer rests.
    const ptr = this.pointer;
    ptr.energy *= Math.exp(-dt * 2.2);
    const radius = this.mobile ? 150 : 210;
    const push = ptr.active ? (0.3 + ptr.energy) * 52 : 0;
    const heroTop = hero.y - sy;

    for (let i = 0; i < this.count; i++) {
      const it = this.items[i];
      const pr = Math.min(1, Math.max(0, (A - it.delay * 0.34) / 0.3));
      const p = easeInOut(pr);
      this.morph[i] = p;

      // Free-floating pose
      const parallax = it.depth < 0 ? -it.depth * 0.06 : -it.depth * 0.05;
      const px = hero.x + it.u * hero.w;
      const py = heroTop + it.v * hero.h + sy * parallax;
      const pos = this.toWorld(px, py, it.depth, view, this._p);
      pos.x += Math.sin(time * 0.13 + it.ph[0]) * 0.1 + Math.sin(time * 0.07 + it.ph[2]) * 0.06;
      pos.y += Math.sin(time * 0.11 + it.ph[1]) * 0.12;
      pos.z += Math.sin(time * 0.09 + it.ph[3]) * 0.2;

      if (push && p < 1) {
        const dx = px - ptr.x, dy = py - ptr.y;
        const d = Math.hypot(dx, dy);
        if (d < radius && d > 0.001) {
          const f = (1 - d / radius) ** 2 * push * dt;
          it.vel.x += (dx / d) * f;
          it.vel.y -= (dy / d) * f;
          it.vel.z += f * 0.35;
        }
      }
      // Spring back to rest
      it.vel.addScaledVector(it.off, -6 * dt).multiplyScalar(Math.exp(-dt * 2.6));
      it.off.addScaledVector(it.vel, dt);
      pos.add(it.off);

      const q = this._q.copy(it.q).multiply(this._qt.setFromAxisAngle(it.axis, time * it.spin));
      const tiltAmt = Math.min(0.9, it.vel.length() * 0.35);
      if (tiltAmt > 0.001) {
        this._axis.set(-it.vel.y, it.vel.x, 0).normalize();
        q.premultiply(this._qt.setFromAxisAngle(this._axis, tiltAmt));
      }
      let w = it.wPx / view.ppu, h = it.hPx / view.ppu;

      // Blend toward the tile on the laptop lid
      if (p > 0) {
        const target = this._p2.copy(it.tile).applyMatrix4(this.laptop.matrixWorld);
        pos.lerp(target, p);
        pos.y += Math.sin(p * Math.PI) * it.arc * (1 - p * 0.4);
        const tq = this._q2.copy(this._laptopQ).multiply(this._flat);
        q.slerp(tq, p);
        const fit = lerp(0.9, 1.0, fuse);
        w = lerp(w, it.tileW * scale * fit, p);
        h = lerp(h, it.tileD * scale * fit, p);
      }
      this._s.set(w, h, 1);
      this._m.compose(pos, q, this._s);
      this.papers.setMatrixAt(i, this._m);
    }
    this.papers.instanceMatrix.needsUpdate = true;
    this.morphAttr.needsUpdate = true;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.atlas.dispose();
    this.screenTex.dispose();
  }
}
