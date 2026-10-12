// Scroll-in headline reveals and magnetic buttons. Loaded after the page is
// idle, never with reduced motion. Everything here is decoration: without it
// the headings and buttons simply sit still.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, SplitText);

export function initMotion() {
  initHeadlines();
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) initMagnetic();
}

// Section headings slide up line by line as they come into view. The hero
// headline is left alone: it's the largest thing on first paint and must not wait.
function initHeadlines() {
  const heads = document.querySelectorAll('.sec-head h2, .about h2, .contact h2, .check h2, .cs-body h2');
  for (const el of heads) {
    // Skip anything already on screen, so nothing visible disappears and re-animates.
    if (el.getBoundingClientRect().top < innerHeight * 0.92) continue;
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      autoSplit: true,
      onSplit: (self) =>
        gsap.from(self.lines, {
          yPercent: 110,
          duration: 0.9,
          ease: 'expo.out',
          stagger: 0.08,
          scrollTrigger: { trigger: el, start: 'top 90%', once: true },
        }),
    });
  }
}

// Buttons lean toward the pointer while it's over them, then spring back.
function initMagnetic() {
  for (const btn of document.querySelectorAll('[data-magnetic]')) {
    const x = gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power3.out' });
    const y = gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power3.out' });
    btn.addEventListener('pointermove', (e) => {
      const r = btn.getBoundingClientRect();
      x(((e.clientX - r.left) / r.width - 0.5) * Math.min(14, r.width * 0.12));
      y(((e.clientY - r.top) / r.height - 0.5) * 10);
    });
    btn.addEventListener('pointerleave', () => {
      gsap.to(btn, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.45)' });
    });
  }
}
