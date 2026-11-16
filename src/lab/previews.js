// The looping previews on /lab/. Each card shows its still image until:
//   1. the visitor has scrolled, moved the pointer, touched, or pressed a key, and
//   2. the card is on screen.
// Then its muted loop downloads (it has preload="none") and plays, and it pauses
// again when the card leaves the screen. Nothing loads with the page itself.
// With reduced motion or data saver on, nothing plays on its own: the button
// says "Play" and the loop starts only if they press it. Every loop has a pause
// button, since it runs longer than 5 seconds (WCAG 2.2.2).

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const saveData = !!navigator.connection?.saveData;

export function initLabPreviews(medias) {
  const items = [...medias].map((media) => ({
    media,
    video: media.querySelector('video'),
    button: media.querySelector('.lab-toggle'),
    name: media.querySelector('.lab-toggle')?.dataset.name ?? '',
    wanted: !reduceMotion.matches && !saveData,
    onScreen: false,
  }));
  let engaged = false;

  const label = (item) => {
    item.media.dataset.wanted = String(item.wanted);
    item.button.setAttribute('aria-label', `${item.wanted ? 'Pause' : 'Play'} the ${item.name} preview`);
  };

  const sync = (item) => {
    const { video } = item;
    if (item.wanted && item.onScreen && engaged) {
      if (!video.paused) return;
      video.play().catch((err) => {
        // iOS Low Power Mode and some browsers block it until a tap: show "Play".
        if (err?.name === 'NotAllowedError') { item.wanted = false; label(item); }
      });
    } else if (!video.paused) {
      video.pause();
    }
  };
  const syncAll = () => items.forEach(sync);

  for (const item of items) {
    // The loop covers the still from its first frame on, and stays after a pause.
    item.video.addEventListener('playing', () => item.media.classList.add('is-live'));
    item.button.addEventListener('click', () => {
      item.wanted = !item.wanted;
      engaged = true;
      label(item);
      sync(item);
    });
    label(item);
    item.button.hidden = false;
  }

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const item = items.find((i) => i.media === entry.target);
      item.onScreen = entry.isIntersecting;
      sync(item);
    }
  }, { threshold: 0.25 });
  items.forEach((item) => io.observe(item.media));

  // The first sign of a person on the page starts the loops that are on screen.
  const stop = new AbortController();
  const engage = () => {
    engaged = true;
    stop.abort();
    syncAll();
  };
  for (const type of ['scroll', 'wheel', 'pointermove', 'pointerdown', 'touchstart', 'keydown']) {
    addEventListener(type, engage, { passive: true, signal: stop.signal });
  }

  // Turning reduced motion on mid-visit stops every loop.
  reduceMotion.addEventListener('change', () => {
    if (!reduceMotion.matches) return;
    for (const item of items) { item.wanted = false; label(item); }
    syncAll();
  });
}
