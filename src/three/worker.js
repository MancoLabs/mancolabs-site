import { Stage } from './stage.js';

// Workers don't see the page's fonts; load Inter for text drawn on the laptop screen.
if (typeof FontFace !== 'undefined' && self.fonts) {
  const inter = new FontFace('Inter', 'url(/fonts/inter-latin-wght.woff2)', { weight: '100 900' });
  self.fonts.add(inter);
  inter.load().catch(() => {});
}

const stage = new Stage((msg) => self.postMessage(msg));
self.onmessage = (e) => stage.handle(e.data);
