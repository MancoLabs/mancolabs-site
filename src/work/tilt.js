// Subtle 3D tilt and a soft highlight that follows the pointer. Mouse and
// trackpad only, never with reduced motion.
export function initTilt(cards) {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  for (const card of cards) {
    let rect = null;
    let frame = 0;
    card.addEventListener('pointerenter', () => {
      rect = card.getBoundingClientRect();
      card.classList.add('is-tilting');
    });
    card.addEventListener('pointermove', (e) => {
      if (!rect) return;
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        card.style.setProperty('--rx', `${((0.5 - y) * 6).toFixed(2)}deg`);
        card.style.setProperty('--ry', `${((x - 0.5) * 8).toFixed(2)}deg`);
        card.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
        card.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
      });
    });
    card.addEventListener('pointerleave', () => {
      cancelAnimationFrame(frame);
      rect = null;
      card.classList.remove('is-tilting');
      for (const p of ['--rx', '--ry', '--gx', '--gy']) card.style.removeProperty(p);
    });
  }
}
