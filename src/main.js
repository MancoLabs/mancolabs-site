const root = document.documentElement;
// Tells the inline head script that JS arrived, so it keeps reveal animations armed.
root.dataset.ready = '';

initHeader();
initReveal();
initContactForm();
initPrefill();
initCheckLoader();
initTools();
initStage();
initWork();
initScrollProgress();
initKonami();
initLogoTaps();
afterIdle(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  import('./anim/motion.js').then((m) => m.initMotion());
});

function afterIdle(fn) {
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 300));
  const go = () => idle(fn, { timeout: 3000 });
  if (document.readyState === 'complete') go();
  else addEventListener('load', go, { once: true });
}

// The email check and the paperwork calculator on /tools/. Both are small, so
// they load right away rather than waiting for the page to go idle.
function initTools() {
  const email = document.querySelector('[data-tool="email"]');
  const cost = document.querySelector('[data-tool="cost"]');
  if (email) import('./tools/email-check.js').then((m) => m.initEmailCheck(email));
  if (cost) import('./tools/cost.js').then((m) => m.initCost(cost));
}

// A free tool on another page sent its summary here (see contact-handoff.js).
// Fill in the contact form with it, once, and never over the visitor's own words.
function initPrefill() {
  const message = document.getElementById('message');
  if (!message) return;
  let data = null;
  try {
    data = JSON.parse(sessionStorage.getItem('ml-prefill'));
    sessionStorage.removeItem('ml-prefill');
  } catch {
    return;
  }
  if (!data?.message || Date.now() - data.at > 30 * 60 * 1000) return;
  if (!message.value.trim()) {
    message.value = data.message;
    message.dataset.prefill = data.message;
  }
  const service = document.getElementById('service');
  if (service && data.service) service.value = data.service;
  if (location.hash !== '#contact') return;
  // The browser's own jump to #contact resets focus, so wait until it has happened.
  const focusName = () => requestAnimationFrame(() => document.getElementById('name')?.focus({ preventScroll: true }));
  if (document.readyState === 'complete') focusName();
  else addEventListener('load', focusName, { once: true });
}

function initWork() {
  const cards = document.querySelectorAll('.work-card');
  if (cards.length) import('./work/tilt.js').then((m) => m.initTilt(cards));
  if (document.querySelector('[data-before-after]')) import('./work/before-after.js').then((m) => m.initBeforeAfter());
}

// A slim bar under the header. Browsers with CSS scroll timelines drive it in
// CSS (see main.css); others get this small scroll listener.
function initScrollProgress() {
  const bar = document.querySelector('.scroll-progress');
  if (!bar || CSS.supports('animation-timeline: scroll()')) return;
  let frame = 0;
  const update = () => {
    frame = 0;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.setProperty('--p', max > 0 ? (scrollY / max).toFixed(4) : '0');
  };
  addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(update); }, { passive: true });
  update();
}

// On the home page the header logo scrolls to the top instead of reloading.
// Seven quick taps open the developer view (the Konami code needs a keyboard).
function initLogoTaps() {
  const logo = document.querySelector('.site-header .brand');
  if (!logo) return;
  let taps = 0;
  let last = 0;
  logo.addEventListener('click', (e) => {
    if (location.pathname !== '/' && location.pathname !== '/index.html') return;
    e.preventDefault();
    history.replaceState(null, '', '/');
    scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const now = performance.now();
    taps = now - last < 800 ? taps + 1 : 1;
    last = now;
    if (taps === 7) {
      taps = 0;
      import('./devview.js').then((m) => m.toggleDevView());
    }
  });
}

// Up, up, down, down, left, right, left, right, B, A: toggles the developer view.
function initKonami() {
  const code = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  let at = 0;
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const key = e.key.toLowerCase();
    at = key === code[at] ? at + 1 : key === code[0] ? 1 : 0;
    if (at === code.length) {
      at = 0;
      import('./devview.js').then((m) => m.toggleDevView());
    }
  });
}

// The website check's code loads once the page is idle, or right away if
// someone submits before then.
function initCheckLoader() {
  const section = document.getElementById('check');
  if (!section) return;
  const form = section.querySelector('#checkForm');
  let loading = null;
  const load = () => (loading ||= import('./check/check.js').then((m) => m.initCheck(section)));
  form.addEventListener('submit', (e) => {
    if (section.dataset.checkReady) return;
    e.preventDefault();
    load().then(() => form.requestSubmit());
  });
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 300));
  const go = () => idle(load, { timeout: 3000 });
  if (document.readyState === 'complete') go();
  else addEventListener('load', go, { once: true });
}

// The 3D layer loads only after the page has finished loading and the browser
// is idle, and only if the inline head check marked this device as capable.
function initStage() {
  if (root.getAttribute('data-3d') !== 'pending' || !document.querySelector('[data-stage]')) return;
  const start = () =>
    import('./three/boot.js')
      .then((m) => m.startStage())
      .catch((err) => {
        console.info('[3d] Showing the poster instead:', err);
        root.setAttribute('data-3d', 'off');
      });
  if (/[?&](poster|og)\b/.test(location.search)) return start();
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  const go = () => idle(start, { timeout: 2000 });
  if (document.readyState === 'complete') go();
  else addEventListener('load', go, { once: true });
}

function initHeader() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const toggle = header.querySelector('.menu-toggle');
  const links = header.querySelector('.navlinks');
  // Mark the menu link for the page you're on (only whole pages, like /tools/).
  for (const a of links.querySelectorAll('a')) {
    const url = new URL(a.href);
    if (!url.hash && url.pathname !== '/' && url.pathname === location.pathname) a.setAttribute('aria-current', 'page');
  }

  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    header.classList.toggle('menu-open', open);
  };

  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  links.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && header.classList.contains('menu-open')) {
      setOpen(false);
      toggle.focus();
    }
  });
  matchMedia('(min-width: 881px)').addEventListener('change', () => setOpen(false));

  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 12);
  onScroll();
  addEventListener('scroll', onScroll, { passive: true });
}

function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;
  if (!('IntersectionObserver' in window)) {
    root.classList.remove('reveal-armed');
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -5% 0px' },
  );
  els.forEach((el) => io.observe(el));
}

function initContactForm() {
  const form = document.getElementById('contactForm');
  if (!form) return;
  const msg = document.getElementById('formMsg');
  const button = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    msg.className = '';
    msg.textContent = 'Sending…';
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const out = await res.json();
      if (!out.success) throw new Error(out.message);
      msg.className = 'ok';
      msg.textContent = "Thanks! I'll be in touch soon.";
      form.reset();
    } catch {
      msg.className = 'err';
      msg.textContent = 'Something went wrong. Please email hello@mancolabs.dev or call (318) 642-4582.';
    } finally {
      button.disabled = false;
    }
  });
}
