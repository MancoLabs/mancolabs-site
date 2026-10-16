// "Free consultation" buttons on the free tools. On a page with the contact
// form, they fill it in and move to it. Elsewhere (the /tools/ page) they save
// the summary for this browser tab and open the home page's form, which picks
// it up (initPrefill in main.js).
export const PREFILL_KEY = 'ml-prefill';

export function sendToContact({ message, service = null }) {
  const form = document.getElementById('contactForm');
  if (!form) {
    try {
      sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ message, service, at: Date.now() }));
    } catch {
      // storage blocked: the form just opens empty
    }
    location.href = '/#contact';
    return;
  }
  fillContact({ message, service });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.getElementById('contact')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  history.replaceState(null, '', '#contact');
  document.getElementById('name')?.focus({ preventScroll: true });
}

// Never overwrites something the visitor typed themselves.
export function fillContact({ message, service = null }) {
  const field = document.getElementById('message');
  const select = document.getElementById('service');
  if (field && (!field.value.trim() || field.value === field.dataset.prefill)) {
    field.value = message;
    field.dataset.prefill = message;
  }
  if (select && service) select.value = service;
}
