import {
  Group, Mesh, InstancedMesh, PlaneGeometry, ExtrudeGeometry, TubeGeometry, Shape, CatmullRomCurve3,
  MeshBasicNodeMaterial, CanvasTexture, SRGBColorSpace, DoubleSide, Color, Vector3, Quaternion, Matrix4,
  Euler, InstancedBufferAttribute, DynamicDrawUsage, Box3,
} from 'three/webgpu';
import {
  Fn, uniform, texture, uv, vec2, vec4, float, mix, sin, abs, dot, max, smoothstep, step, select, floor, fract, hash,
  frontFacing, normalWorld, normalLocal, positionLocal, positionGeometry, positionView,
  instancedBufferAttribute, instancedDynamicBufferAttribute,
} from 'three/tsl';
import {
  ATLAS_SIZE, ATLAS_RECTS, PAPER_ASPECT, SCREEN_W, SCREEN_H, BUILD_PIECES, ICON_CELL,
  makeCanvas, drawPaperAtlas, drawScreen, drawGrid, drawIcons, drawCheck,
} from './textures.js';

// Laptop body, in scene units. The closed lid's top surface sits at y = 0 so the
// paper tiles land on it no matter how far the body has grown downward.
const LW = 3.2, LD = 2.2, LID_T = 0.07, BASE_T = 0.11;
const LID_OPEN = 1.86; // radians (about 107 degrees)
const SW = LW * 0.92, SH = SW / 1.6; // screen, same shape as the screen texture
const LIGHT = new Vector3(-0.35, 0.82, 0.48).normalize();

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
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

function canvasTexture(canvas) {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class HeroScene {
  constructor({ palette, mobile, seed = 7 }) {
    this.root = new Group();
    this.mobile = mobile;
    this.seed = seed;
    // Phones get a smaller set that fits in the band under the headline.
    [this.cols, this.rows] = mobile ? [6, 4] : [12, 8];
    this.count = this.cols * this.rows;

    this.u = {
      time: uniform(0),
      light: uniform(LIGHT.clone()),
      bg: uniform(new Color()),
      back: uniform(new Color()),
      frame: uniform(new Color()),
      deck: uniform(new Color()),
      screenOff: uniform(new Color()),
      accent: uniform(new Color()),
      accentDeep: uniform(new Color()),
      paper: uniform(new Color()),
      paper3: uniform(new Color()),
      fuse: uniform(0),
      power: uniform(0),
      dim: uniform(1),
      glitch: uniform(0),
      grid: uniform(0),
      checkMix: uniform(0),
      scan: uniform(0),
    };

    this.atlasCanvas = makeCanvas(ATLAS_SIZE, ATLAS_SIZE);
    this.atlas = canvasTexture(this.atlasCanvas);
    this.screenCanvas = makeCanvas(SCREEN_W, SCREEN_H);
    this.screenTex = canvasTexture(this.screenCanvas);
    this.gridCanvas = makeCanvas(SCREEN_W, SCREEN_H);
    this.gridTex = canvasTexture(this.gridCanvas);
    this.checkCanvas = makeCanvas(SCREEN_W, SCREEN_H);
    this.checkTex = canvasTexture(this.checkCanvas);
    this.iconCanvas = makeCanvas(ICON_CELL * 4, ICON_CELL);
    this.iconTex = canvasTexture(this.iconCanvas);
    this.check = { state: 'idle', host: '', film: null, scanTarget: 0, shown: -2 };

    this.buildPapers();
    this.buildLaptop();
    this.buildPieces();
    this.buildAutomate();
    this.setPalette(palette);
    this.poses = { closed: this.measurePose(0), open: this.measurePose(1) };

    // Scratch objects reused every frame.
    this._m = new Matrix4(); this._q = new Quaternion(); this._q2 = new Quaternion(); this._qt = new Quaternion();
    this._p = new Vector3(); this._p2 = new Vector3(); this._s = new Vector3(); this._axis = new Vector3();
    this._flat = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
    this._ident = new Quaternion();
    this._laptopQ = new Quaternion();
    this.pointer = { x: 0, y: 0, active: false, energy: 0, lastX: 0, lastY: 0, lastT: 0 };
  }

  // ── Papers ────────────────────────────────────
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
    mat.alphaToCoverage = true; // smooth cut-out edges where multisampling is on

    this.papers = new InstancedMesh(geo, mat, n);
    this.papers.instanceMatrix.setUsage(DynamicDrawUsage);
    this.papers.frustumCulled = false;
    this.root.add(this.papers);
  }

  // ── Laptop ────────────────────────────────────
  buildLaptop() {
    const u = this.u;
    this.laptop = new Group();
    this.body = new Group(); // grows from flat to full thickness while the tiles fuse
    this.laptop.add(this.body);

    const frameMat = shadedMaterial(u.frame, u.light);
    const deckMat = shadedMaterial(u.deck, u.light);

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

    // Screen: the tidy site, broken during "Fix", a blank grid during "Build",
    // and the visitor's site with a scanning light during the website check.
    const sUv = uv();
    const tStep = floor(u.time.mul(9));
    const sliceN = hash(floor(sUv.y.mul(24)).add(tStep.mul(17)));
    const shift = sliceN.sub(0.5).mul(0.18).mul(step(0.62, sliceN)).mul(u.glitch);
    const site = texture(this.screenTex, vec2(fract(sUv.x.add(shift)), sUv.y)).rgb;
    const blockN = hash(floor(sUv.x.mul(16)).add(floor(sUv.y.mul(10)).mul(37)).add(tStep.mul(5)));
    const corrupt = step(float(1).sub(u.glitch.mul(0.2)), blockN);
    const blockCol = mix(u.accentDeep, u.paper3, step(0.5, fract(blockN.mul(13.7))));
    const lines = float(1).sub(u.glitch.mul(0.16).mul(step(0.5, fract(sUv.y.mul(140)))));
    const broken = mix(site, blockCol, corrupt).mul(lines);
    const built = mix(broken, texture(this.gridTex, sUv).rgb, u.grid);
    const checked = mix(built, texture(this.checkTex, sUv).rgb, u.checkMix);
    const d = sUv.y.sub(float(1).sub(fract(u.time.mul(0.3))));
    const band = smoothstep(0.07, 0, abs(d)).add(smoothstep(0.22, 0, d).mul(step(0, d)).mul(0.3)).mul(u.scan);
    const screenMat = new MeshBasicNodeMaterial();
    screenMat.colorNode = mix(u.screenOff, mix(checked, u.accent, band.mul(0.5)), u.power);
    this.screen = new Mesh(new PlaneGeometry(SW, SH), screenMat);
    this.screen.rotation.x = Math.PI / 2; // faces down when closed, toward the viewer when open
    this.screen.position.set(0, -0.003, LD / 2 + 0.02);
    this.lid.add(this.screen);
    this.body.add(this.lid);

    this.root.add(this.laptop);
  }

  // ── "Build": pieces of the site fly in and snap onto the screen ──
  buildPieces() {
    const n = BUILD_PIECES.length;
    const rects = new Float32Array(n * 4);
    const rnd = mulberry32(11);
    this.pieces = BUILD_PIECES.map(([x, y, w, h], i) => {
      rects.set([x / SCREEN_W, 1 - (y + h) / SCREEN_H, w / SCREEN_W, h / SCREEN_H], i * 4);
      const landed = new Vector3(((x + w / 2) / SCREEN_W - 0.5) * SW, (0.5 - (y + h / 2) / SCREEN_H) * SH, 0.006);
      const a = rnd() * Math.PI * 2;
      return {
        landed,
        start: landed.clone().add(new Vector3(Math.cos(a) * 1.7, Math.sin(a) * 1.1, 1.3 + rnd() * 0.9)),
        q: new Quaternion().setFromEuler(new Euler((rnd() - 0.5) * 1.4, (rnd() - 0.5) * 1.4, (rnd() - 0.5) * 1.0)),
        size: new Vector3((w / SCREEN_W) * SW, (h / SCREEN_H) * SH, 1),
        delay: 0.14 + i * 0.065,
      };
    });
    const aRect = instancedBufferAttribute(new InstancedBufferAttribute(rects, 4));
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = texture(this.screenTex, aRect.xy.add(uv().mul(aRect.zw))).rgb;
    this.pieceMesh = new InstancedMesh(new PlaneGeometry(1, 1), mat, n);
    this.pieceMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.pieceMesh.frustumCulled = false;
    this.pieceMesh.visible = false;
    this.screen.add(this.pieceMesh);
  }

  // ── "Automate": tool icons link up into a network around the laptop ──
  buildAutomate() {
    this.auto = new Group();
    this.auto.visible = false;
    this.laptop.add(this.auto);

    // Screen points with the lid open, in laptop space.
    this.lid.rotation.x = -LID_OPEN;
    this.laptop.updateMatrixWorld(true);
    const onScreen = (x, y) => this.screen.localToWorld(new Vector3(x, y, 0.02));
    const center = onScreen(0, 0);
    this.screenCenter = center;
    const icons = [
      center.clone().add(new Vector3(-2.55, 0.75, 0.6)),  // spreadsheet
      center.clone().add(new Vector3(-2.35, -0.75, 0.9)), // email
      center.clone().add(new Vector3(2.55, 0.75, 0.6)),   // calendar
      center.clone().add(new Vector3(2.35, -0.75, 0.9)),  // invoice
    ];
    this.iconTargets = icons;
    const ends = {
      lu: onScreen(-SW / 2, SH * 0.18), ld: onScreen(-SW / 2, -SH * 0.25),
      ru: onScreen(SW / 2, SH * 0.18), rd: onScreen(SW / 2, -SH * 0.25), top: onScreen(0, SH / 2),
    };
    this.lid.rotation.x = 0;
    this.laptop.updateMatrixWorld(true);

    const cells = new Float32Array([0, 1, 2, 3]);
    const aCell = instancedBufferAttribute(new InstancedBufferAttribute(cells, 1));
    const iconMat = new MeshBasicNodeMaterial({ side: DoubleSide });
    const itex = texture(this.iconTex, vec2(uv().x.add(aCell).div(4), uv().y));
    iconMat.colorNode = itex.rgb;
    iconMat.opacityNode = itex.a;
    iconMat.alphaTest = 0.5;
    iconMat.alphaToCoverage = true;
    this.iconMesh = new InstancedMesh(new PlaneGeometry(0.92, 0.92), iconMat, 4);
    this.iconMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.iconMesh.frustumCulled = false;
    this.auto.add(this.iconMesh);

    const mid = (a, b, bulge) => a.clone().add(b).multiplyScalar(0.5).add(bulge);
    const [ss, em, ca, inv] = icons;
    const paths = [
      [ss, ends.lu, new Vector3(0.3, 0.25, 0.2)],
      [em, ends.ld, new Vector3(0.3, -0.2, 0.2)],
      [ca, ends.ru, new Vector3(-0.3, 0.25, 0.2)],
      [inv, ends.rd, new Vector3(-0.3, -0.2, 0.2)],
      [ss, em, new Vector3(-0.35, 0, 0.1)],
      [ca, inv, new Vector3(0.35, 0, 0.1)],
      [ss, ca, null],
    ];
    const u = this.u;
    this.links = paths.map(([a, b, bulge], i) => {
      const pts = bulge ? [a, mid(a, b, bulge), b] : [a, ends.top.clone().add(new Vector3(-1.1, 0.75, 0.3)), ends.top.clone().add(new Vector3(1.1, 0.75, 0.3)), b];
      const curve = new CatmullRomCurve3(pts);
      const reveal = uniform(0);
      const along = uv().x;
      const pulse = smoothstep(0.86, 1, fract(along.mul(2).sub(u.time.mul(0.55)).add(i * 0.37)));
      const shown = step(along, reveal);
      const core = new MeshBasicNodeMaterial();
      core.colorNode = mix(u.accentDeep, u.paper, pulse);
      core.opacityNode = shown;
      core.alphaTest = 0.5;
      const halo = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      halo.colorNode = u.accent;
      halo.opacityNode = shown.mul(float(0.12).add(pulse.mul(0.35)));
      const coreMesh = new Mesh(new TubeGeometry(curve, 48, 0.03, 6, false), core);
      const haloMesh = new Mesh(new TubeGeometry(curve, 48, 0.09, 8, false), halo);
      coreMesh.frustumCulled = haloMesh.frustumCulled = false;
      this.auto.add(coreMesh, haloMesh);
      return { reveal };
    });
  }

  // Size and center of the laptop (at scale 1) when closed and when open, so it
  // can be fitted inside its placeholder box in the page.
  measurePose(open) {
    this.laptop.position.set(0, 0, 0);
    this.laptop.scale.setScalar(1);
    this.laptop.rotation.set(lerp(0.95, 0.24, open), lerp(-0.16, -0.42, open), 0);
    this.body.scale.y = 1;
    this.lid.rotation.x = -open * LID_OPEN;
    this.auto.visible = false;
    this.pieceMesh.visible = false;
    this.laptop.updateMatrixWorld(true);
    const box = new Box3().setFromObject(this.laptop);
    return { center: box.getCenter(new Vector3()), size: box.getSize(new Vector3()) };
  }

  setPalette(P) {
    this.palette = P;
    drawPaperAtlas(this.atlasCanvas.getContext('2d'), P);
    drawScreen(this.screenCanvas.getContext('2d'), P);
    drawGrid(this.gridCanvas.getContext('2d'), P);
    drawIcons(this.iconCanvas.getContext('2d'), P);
    for (const t of [this.atlas, this.screenTex, this.gridTex, this.iconTex]) t.needsUpdate = true;
    this.check.shown = -2; // redraw the check screen in the new colors
    // Draw it now too: WebGPU can't upload a canvas that has never been drawn on.
    if (!this.check.film) this.drawCheckScreen(0);
    const u = this.u;
    u.bg.value.set(P.bg);
    u.back.value.set(P.paper3);
    u.frame.value.set(P.frame);
    u.deck.value.set(P.base);
    u.screenOff.value.set(P.ink);
    u.accent.value.set(P.accent);
    u.accentDeep.value.set(P.accentDeep);
    u.paper.value.set(P.paper);
    u.paper3.value.set(P.paper3);
    u.dim.value = P.dark ? 0.86 : 1;
  }

  // From the website check: 'idle', 'scanning', or 'result' with screenshot bitmaps.
  setCheck({ state, host = '', frames = [], final = null }) {
    const c = this.check;
    c.film?.frames.forEach((b) => b.close?.());
    c.film?.final?.close?.();
    c.state = state;
    c.host = host;
    c.scanTarget = state === 'scanning' ? 1 : 0;
    c.film = state === 'result' ? { frames, final, start: null } : null;
    c.shown = -2;
  }

  drawCheckScreen(time) {
    const c = this.check;
    let index = -1;
    let image = null;
    if (c.film) {
      if (c.film.start == null) c.film.start = time;
      const i = Math.floor((time - c.film.start) / 0.2);
      index = i < c.film.frames.length ? i : c.film.frames.length;
      image = index < c.film.frames.length ? c.film.frames[index] : c.film.final;
    }
    if (index === c.shown) return;
    c.shown = index;
    drawCheck(this.checkCanvas.getContext('2d'), this.palette, { host: c.state === 'idle' ? '' : c.host, image });
    this.checkTex.needsUpdate = true;
  }

  // Positions are stored relative to a page box (the hero, or on phones the
  // band under the headline), so the papers scroll with the page.
  setLayout(layout) {
    this.layout = layout;
    const rnd = mulberry32(this.seed);
    const { hero, keepOut } = layout;
    const band = this.mobile ? layout.band : null;
    const n = this.count;
    const types = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3];
    const minPx = band ? 38 : 58, maxPx = band ? 56 : 108;
    // Phones: a jittered grid inside the band, so every paper is fully on screen.
    const bandCols = 8, bandRows = Math.ceil(n / 8);
    const cells = [...Array(bandCols * bandRows).keys()].sort(() => rnd() - 0.5);
    this.items = [];
    for (let i = 0; i < n; i++) {
      const type = types[Math.floor(rnd() * types.length)];
      const aspect = PAPER_ASPECT[type];
      const depth = band ? lerp(-0.8, 0.5, rnd()) : lerp(-3.4, 1.3, rnd() ** 0.85);
      const size = lerp(minPx, maxPx, rnd());
      const hPx = type === 3 ? size * (band ? 1.15 : 1.35) : size;
      const wPx = hPx * aspect;
      let u = 0, v = 0;
      if (band) {
        const cell = cells[i];
        const cu = (cell % bandCols + 0.5 + (rnd() - 0.5) * 0.7) / bandCols;
        const cv = (Math.floor(cell / bandCols) + 0.5 + (rnd() - 0.5) * 0.5) / bandRows;
        const half = Math.max(wPx, hPx) * 0.55 + 6;
        u = Math.min(1 - half / band.w, Math.max(half / band.w, cu));
        v = Math.min(1 - half / band.h, Math.max(half / band.h, cv));
      } else {
        for (let a = 0; a < 60; a++) {
          u = -0.05 + rnd() * 1.1;
          v = -0.06 + rnd() * 1.12;
          const px = hero.x + u * hero.w, py = hero.y + v * hero.h;
          const m = Math.max(wPx, hPx) * 0.6 + 40;
          const inside = px > keepOut.x - m && px < keepOut.x + keepOut.w + m && py > keepOut.y - m && py < keepOut.y + keepOut.h + m;
          if (!inside) break;
        }
      }
      const e = band
        ? new Euler((rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.7, (rnd() - 0.5) * 1.4)
        : new Euler((rnd() - 0.5) * 1.2, (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 2.4);
      if (!band && rnd() < 0.12) e.x += Math.PI;
      this.items.push({
        type, u, v, depth, wPx, hPx, inBand: !!band,
        q: new Quaternion().setFromEuler(e),
        axis: new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
        spin: (band ? 0.015 + rnd() * 0.035 : 0.04 + rnd() * 0.12) * (rnd() < 0.5 ? -1 : 1),
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

  setPointer(x, y, t) {
    const p = this.pointer;
    if (x == null) { p.active = false; return; }
    if (p.active && t > p.lastT) {
      const speed = Math.hypot(x - p.lastX, y - p.lastY) / Math.max(8, t - p.lastT); // px per ms
      p.energy = Math.min(1, Math.max(p.energy, speed * 0.9));
    }
    p.active = true;
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
    const story = state.story || { enter: 0, fix: 0, build: 0, auto: 0, exit: 0 };
    const u = this.u;
    u.time.value = time;

    const fuse = smooth(0.6, 0.74, A);
    const open = smooth(0.74, 0.95, A);
    const openE = easeInOut(open);
    u.fuse.value = fuse;
    u.power.value = smooth(0.86, 1, A);

    // Story stages, all driven by scroll position.
    const exitHide = smooth(0, 0.35, story.exit);
    const autoE = smooth(0, 0.35, story.auto) * (1 - exitHide);
    u.glitch.value = Math.min(smooth(0.2, 0.9, story.enter), 1 - smooth(0.2, 0.75, story.fix));
    u.grid.value = smooth(0.02, 0.14, story.build) * (1 - smooth(0.86, 0.96, story.build));
    u.checkMix.value = smooth(0.35, 0.8, story.exit);
    const c = this.check;
    u.scan.value += (c.scanTarget - u.scan.value) * (1 - Math.exp(-dt * 4));
    if (u.checkMix.value > 0) this.drawCheckScreen(time);

    // The laptop is fitted inside the box the page tells it to occupy.
    const R = state.laptop || { x: assembly.x, y: assembly.y - sy, w: assembly.w, h: assembly.h, s: 1 };
    const { closed, open: opened } = this.poses;
    const fit = Math.min(R.w / (opened.size.x * view.ppu), R.h / (opened.size.y * view.ppu)) * 0.97;
    const scale = fit * (R.s ?? 1) * lerp(1, 0.72, autoE);
    this.laptop.rotation.set(lerp(0.95, 0.24, openE) - 0.08 * autoE, lerp(-0.16, -0.42, openE) + 0.32 * autoE, 0);
    this.laptop.scale.setScalar(Math.max(scale, 1e-4));
    // Pose centers were measured with rotation applied, so only scale them.
    const center = this._p2.lerpVectors(closed.center, opened.center, openE).multiplyScalar(scale);
    this.toWorld(R.x + R.w / 2, R.y + R.h / 2, 0, view, this.laptop.position).sub(center);
    this.body.scale.y = Math.max(0.02, fuse);
    this.lid.rotation.x = -open * LID_OPEN;
    this.laptop.visible = fuse > 0 && scale > 1e-3;
    this.updatePieces(story.build, u.grid.value);
    this.updateAutomate(time, story.auto, exitHide);
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

    for (let i = 0; i < this.count; i++) {
      const it = this.items[i];
      const pr = clamp01((A - it.delay * 0.34) / 0.3);
      const p = easeInOut(pr);
      this.morph[i] = p;

      // Free-floating pose
      const box = it.inBand ? this.layout.band : hero;
      const parallax = it.inBand ? 0 : it.depth < 0 ? -it.depth * 0.06 : -it.depth * 0.05;
      const px = box.x + it.u * box.w;
      const py = box.y - sy + it.v * box.h + sy * parallax;
      const pos = this.toWorld(px, py, it.depth, view, this._p);
      const sway = it.inBand ? 0.3 : 1;
      pos.x += (Math.sin(time * 0.13 + it.ph[0]) * 0.1 + Math.sin(time * 0.07 + it.ph[2]) * 0.06) * sway;
      pos.y += Math.sin(time * 0.11 + it.ph[1]) * 0.12 * sway;
      pos.z += Math.sin(time * 0.09 + it.ph[3]) * 0.2 * sway;

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
        const fitTile = lerp(0.9, 1.0, fuse);
        w = lerp(w, it.tileW * scale * fitTile, p);
        h = lerp(h, it.tileD * scale * fitTile, p);
      }
      this._s.set(w, h, 1);
      this._m.compose(pos, q, this._s);
      this.papers.setMatrixAt(i, this._m);
    }
    this.papers.instanceMatrix.needsUpdate = true;
    this.morphAttr.needsUpdate = true;
  }

  updatePieces(build, grid) {
    const show = grid > 0.01;
    this.pieceMesh.visible = show;
    if (!show) return;
    this.pieces.forEach((pc, i) => {
      const q = clamp01((build - pc.delay) / 0.24);
      const pos = this._p.lerpVectors(pc.start, pc.landed, easeOutBack(q));
      const rot = this._q.copy(pc.q).slerp(this._ident, easeOutCubic(q));
      const s = q > 0 ? 1 : 1e-4;
      this._s.copy(pc.size).multiplyScalar(s).setZ(1);
      this._m.compose(pos, rot, this._s);
      this.pieceMesh.setMatrixAt(i, this._m);
    });
    this.pieceMesh.instanceMatrix.needsUpdate = true;
  }

  updateAutomate(time, auto, exitHide) {
    let any = 0;
    this.iconTargets.forEach((target, i) => {
      const p = smooth(0.06 + i * 0.06, 0.4 + i * 0.06, auto) * (1 - exitHide);
      any = Math.max(any, p);
      const e = easeOutCubic(p);
      const pos = this._p.lerpVectors(this.screenCenter, target, e);
      pos.y += Math.sin(time * 1.2 + i * 1.7) * 0.04 * e;
      this._s.setScalar(Math.max(e, 1e-4));
      this._m.compose(pos, this._ident, this._s);
      this.iconMesh.setMatrixAt(i, this._m);
    });
    this.iconMesh.instanceMatrix.needsUpdate = true;
    this.links.forEach((link, i) => {
      link.reveal.value = smooth(0.32 + i * 0.04, 0.64 + i * 0.04, auto) * (1 - exitHide);
    });
    this.auto.visible = any > 0.001;
  }

  // Make every part visible for one compile pass, so no shader compiles mid-scroll.
  showAllForCompile() {
    const parts = [this.papers, this.laptop, this.pieceMesh, this.auto];
    const before = parts.map((o) => o.visible);
    const bodyY = this.body.scale.y;
    // Three.js skips anything outside the camera when compiling, and the laptop
    // starts below the fold, so switch culling off until this is restored.
    const culled = [];
    this.root.traverse((o) => { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
    parts.forEach((o) => { o.visible = true; });
    this.body.scale.y = 1;
    return () => {
      parts.forEach((o, i) => { o.visible = before[i]; });
      culled.forEach((o) => { o.frustumCulled = true; });
      this.body.scale.y = bodyY;
    };
  }

  textures() {
    return [this.atlas, this.screenTex, this.gridTex, this.checkTex, this.iconTex];
  }

  dispose() {
    this.check.film?.frames.forEach((b) => b.close?.());
    this.check.film?.final?.close?.();
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    for (const t of [this.atlas, this.screenTex, this.gridTex, this.checkTex, this.iconTex]) t.dispose();
  }
}
