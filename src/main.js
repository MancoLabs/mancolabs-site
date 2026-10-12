const root = document.documentElement;
// Tells the inline head script that JS arrived, so it keeps reveal animations armed.
root.dataset.ready = '';

initHeader();
initReveal();
initContactForm();
initCheckLoader();
initStage();

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
