// Resolves the CSS color variables (including color-mix() roles) to hex, so the
// 3D scene always uses exactly the site's colors.
const VARS = {
  paper: '--paper', paper2: '--paper-2', paper3: '--paper-3',
  ink: '--ink', inkSoft: '--ink-soft', inkFaint: '--ink-faint',
  accent: '--accent', accentDeep: '--accent-deep',
  bg: '--bg', bgDark: '--bg-dark', glow: '--glow', frame: '--ill-frame', base: '--ill-base',
};

const hex = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

function toHex(css) {
  let m = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (m) return `#${hex(+m[1])}${hex(+m[2])}${hex(+m[3])}`;
  m = css.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (m) return `#${hex(m[1] * 255)}${hex(m[2] * 255)}${hex(m[3] * 255)}`;
  return '#000000';
}

export function readPalette() {
  const probe = document.createElement('i');
  probe.style.display = 'none';
  document.body.append(probe);
  const out = {};
  for (const [key, name] of Object.entries(VARS)) {
    probe.style.color = `var(${name})`;
    out[key] = toHex(getComputedStyle(probe).color);
  }
  probe.remove();
  out.dark = matchMedia('(prefers-color-scheme: dark)').matches;
  return out;
}
