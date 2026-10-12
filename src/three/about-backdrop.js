// The About section's background: slow noise in the palette's dark greens, with
// a soft glow that follows the cursor. Rendered on its own canvas inside the
// section, by the same worker as the main scene.
//
// Contrast: the mix toward accent-deep is capped at 0.3, which keeps the
// section's smallest text (accent on ink) above 4.5:1 even at the glow's peak.
import { WebGPURenderer, Scene, OrthographicCamera, Mesh, PlaneGeometry, MeshBasicNodeMaterial, Color, Vector2 } from 'three/webgpu';
import { uniform, uv, vec2, vec3, mix, exp, min, mx_noise_float } from 'three/tsl';

export class AboutBackdrop {
  async init({ canvas, width, height, palette, forceWebGL }) {
    const renderer = new WebGPURenderer({ canvas, antialias: false, alpha: false, forceWebGL });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    await renderer.init();
    this.renderer = renderer;

    this.u = {
      time: uniform(0),
      aspect: uniform(width / Math.max(1, height)),
      pointer: uniform(new Vector2(0.5, 0.5)),
      glow: uniform(0),
      ink: uniform(new Color(palette.ink)),
      deep: uniform(new Color(palette.accentDeep)),
    };
    this.target = { x: 0.5, y: 0.5, on: 0 };

    const { time, aspect, pointer, glow, ink, deep } = this.u;
    const p = vec2(uv().x.mul(aspect), uv().y);
    const t = time.mul(0.05);
    const n1 = mx_noise_float(vec3(p.mul(1.6), t)).mul(0.5).add(0.5);
    const n2 = mx_noise_float(vec3(p.mul(4.2).add(7.3), t.mul(1.6))).mul(0.5).add(0.5);
    const d = p.sub(vec2(pointer.x.mul(aspect), pointer.y)).length();
    const halo = exp(d.mul(d).mul(-7)).mul(glow);
    const amount = min(n1.mul(0.13).add(n2.mul(0.04)).add(halo.mul(0.16)), 0.3);
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = mix(ink, deep, amount);

    this.scene = new Scene();
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene.add(new Mesh(new PlaneGeometry(2, 2), mat));
    await renderer.compileAsync(this.scene, this.camera);
  }

  resize(width, height) {
    this.renderer?.setSize(width, height, false);
    if (this.u) this.u.aspect.value = width / Math.max(1, height);
  }

  // x, y in section pixels, or null when the pointer leaves the section.
  setPointer(x, y, width, height) {
    if (x == null) { this.target.on = 0; return; }
    this.target.x = x / width;
    this.target.y = 1 - y / height;
    this.target.on = 1;
  }

  setPalette(P) {
    this.u?.ink.value.set(P.ink);
    this.u?.deep.value.set(P.accentDeep);
  }

  render(time, dt) {
    if (!this.renderer) return;
    const k = 1 - Math.exp(-dt * 5);
    const { pointer, glow } = this.u;
    pointer.value.x += (this.target.x - pointer.value.x) * k;
    pointer.value.y += (this.target.y - pointer.value.y) * k;
    glow.value += (this.target.on - glow.value) * k;
    this.u.time.value = time;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.scene?.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    this.renderer?.dispose();
    this.renderer = null;
  }
}
