// Before/after comparison. The slider is a real <input type="range"> laid over
// the images, so it works with a keyboard, a screen reader, a mouse, or touch.
export function initBeforeAfter(root = document) {
  for (const fig of root.querySelectorAll('[data-before-after]')) {
    const frame = fig.querySelector('.ba-frame');
    const range = fig.querySelector('.ba-range');
    if (!frame || !range || range.dataset.ready) continue;
    range.dataset.ready = 'true';
    const update = () => {
      const v = Number(range.value);
      frame.style.setProperty('--pos', `${v}%`);
      range.setAttribute('aria-valuetext', `${v}% before, ${100 - v}% after`);
    };
    range.addEventListener('input', update);
    update();
  }
}
