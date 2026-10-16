// The Free Website Check: form, progress, results, and the laptop screen.
import { normalizeUrl, runCheck, CheckError } from './psi.js';
import { band } from './issues.js';
import { sendToContact, fillContact } from '../contact-handoff.js';

const MESSAGES = {
  empty: 'Type in your website address, like yourbusiness.com.',
  invalid: "That doesn't look like a web address. Try something like yourbusiness.com.",
  private: "That address only works on your own network, so Google can't reach it. Try your public website address.",
  setup: "The website check isn't available right now. You can still get a free consultation below.",
  busy: 'A lot of people are checking sites right now. Please try again in a minute.',
  unreachable: "Google couldn't load that site. Check that the address is right and the site is online, then try again.",
  timeout: 'That site took too long to test. It might be very slow, or Google might be busy. Please try again.',
  network: "Couldn't reach Google's PageSpeed service. Check your connection and try again.",
  google: "Google's PageSpeed service had a problem with that check. Please try again in a minute.",
};
const INPUT_ERRORS = new Set(['empty', 'invalid', 'private']);
const STEPS = [
  [0, 'Loading your page the way a phone would'],
  [9, 'Measuring how quickly it shows up'],
  [18, 'Checking accessibility and search basics'],
  [32, 'Still working. Some sites take a little longer'],
];
const CATS = [
  ['performance', 'Performance'],
  ['accessibility', 'Accessibility'],
  ['bestPractices', 'Best practices'],
  ['seo', 'SEO'],
];
const CACHE_MS = 30 * 60 * 1000;
// Every score 90 or above: the site is in good shape, so the list reads as
// optional polish rather than problems to fix.
const isStrong = (scores) => CATS.every(([key]) => scores[key] >= 90);
const SELF_URL = 'https://mancolabs.dev/';
const A11Y_NOTE = 'Automated tests like this catch only some accessibility problems. A full review also includes testing by hand, such as using the site with only a keyboard and with a screen reader.';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  el.append(...children.filter((c) => c != null));
  return el;
}
const svg = (tag, attrs) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

export function initCheck(section) {
  const form = section.querySelector('#checkForm');
  const input = section.querySelector('#checkUrl');
  const submit = form.querySelector('button[type="submit"]');
  const errorEl = section.querySelector('#checkError');
  const statusEl = section.querySelector('#checkStatus');
  const progressEl = section.querySelector('#checkProgress');
  const resultsEl = section.querySelector('#checkResults');
  const selfBtn = section.querySelector('#checkSelf');
  const screen = section.querySelector('.check-screen');
  let running = false;
  let filmTimer = 0;

  selfBtn.hidden = false;

  const emit = (detail) => {
    window.__checkState = detail;
    window.dispatchEvent(new CustomEvent('check:state', { detail }));
  };

  const showError = (kind) => {
    errorEl.textContent = MESSAGES[kind] || MESSAGES.google;
    errorEl.hidden = false;
    if (INPUT_ERRORS.has(kind)) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
  };
  const clearError = () => {
    errorEl.hidden = true;
    errorEl.textContent = '';
    input.removeAttribute('aria-invalid');
  };

  // Poster-mode laptop screen (the 3D laptop gets the same states through check:state).
  const setScreen = (state, { host = '', screenshot = null, frames = [] } = {}) => {
    clearInterval(filmTimer);
    screen.dataset.state = state;
    screen.querySelector('.cs-domain').textContent = host || 'Your site here';
    const img = screen.querySelector('.cs-shot');
    if (state !== 'result' || !screenshot) {
      img.hidden = true;
      return;
    }
    img.hidden = false;
    if (reduceMotion() || frames.length < 2) {
      img.src = screenshot;
      return;
    }
    let i = 0;
    img.src = frames[0];
    filmTimer = setInterval(() => {
      i++;
      if (i < frames.length) img.src = frames[i];
      else {
        img.src = screenshot;
        clearInterval(filmTimer);
      }
    }, 200);
  };

  let stepTimer = 0;
  const startProgress = (host) => {
    const t0 = performance.now();
    const tick = () => {
      const s = (performance.now() - t0) / 1000;
      const step = [...STEPS].reverse().find(([at]) => s >= at)[1];
      progressEl.querySelector('.cp-step').textContent = `${step}…`;
      progressEl.querySelector('.cp-time').textContent = `${Math.floor(s)}s`;
    };
    progressEl.hidden = false;
    tick();
    stepTimer = setInterval(tick, 1000);
    statusEl.textContent = `Checking ${host}. This usually takes 20 to 40 seconds.`;
  };
  const stopProgress = () => {
    clearInterval(stepTimer);
    progressEl.hidden = true;
  };

  const cacheKey = (url) => `ml-check:${url}`;
  const fromCache = (url) => {
    try {
      const hit = JSON.parse(sessionStorage.getItem(cacheKey(url)));
      return hit && Date.now() - hit.at < CACHE_MS ? hit.result : null;
    } catch {
      return null;
    }
  };
  const toCache = (url, result) => {
    try {
      sessionStorage.setItem(cacheKey(url), JSON.stringify({ at: Date.now(), result }));
    } catch {
      // storage full or blocked: skip caching
    }
  };

  async function start(raw) {
    if (running) return;
    clearError();
    let url;
    try {
      url = normalizeUrl(raw);
    } catch (err) {
      return showError(err.kind);
    }
    const host = new URL(url).hostname.replace(/^www\./, '');

    const cached = fromCache(url);
    if (cached) return show(cached, host);

    running = true;
    form.setAttribute('aria-busy', 'true');
    submit.disabled = true;
    selfBtn.disabled = true;
    resultsEl.hidden = true;
    startProgress(host);
    setScreen('scanning', { host });
    emit({ state: 'scanning', host });

    try {
      const result = await runCheck(url);
      toCache(url, result);
      show(result, host);
    } catch (err) {
      const kind = err instanceof CheckError ? err.kind : 'google';
      if (kind === 'setup') console.warn('[website check] PageSpeed key problem:', err.message);
      statusEl.textContent = '';
      showError(kind);
      setScreen('idle');
      emit({ state: 'idle' });
    } finally {
      running = false;
      form.removeAttribute('aria-busy');
      submit.disabled = false;
      selfBtn.disabled = false;
      stopProgress();
    }
  }

  function show(result, host) {
    stopProgress();
    renderResults(result, host);
    setScreen('result', { host, screenshot: result.screenshot, frames: result.frames });
    emit({ state: 'result', host, screenshot: result.screenshot, frames: result.frames });
    statusEl.textContent = `Results are ready for ${host}.`;
    resultsEl.hidden = false;
    resultsEl.querySelector('h3').focus({ preventScroll: false });
  }

  function renderResults(result, host) {
    const { scores, issues } = result;
    const gauges = h('ul', { class: 'gauges', role: 'list' });
    for (const [key, label] of CATS) {
      const score = scores[key];
      const b = band(score);
      const C = 2 * Math.PI * 42;
      const ring = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' });
      ring.append(
        svg('circle', { class: 'g-track', cx: 50, cy: 50, r: 42 }),
        svg('circle', { class: 'g-fill', cx: 50, cy: 50, r: 42, 'stroke-dasharray': C.toFixed(2), 'stroke-dashoffset': C.toFixed(2) }),
      );
      const num = h('span', { class: 'g-num', 'aria-hidden': 'true', text: reduceMotion() ? String(score) : '0' });
      const li = h(
        'li',
        { class: `gauge is-${b.key}` },
        h('div', { class: 'g-dial' }, ring, num),
        h('span', { class: 'g-label', 'aria-hidden': 'true', text: label }),
        h('span', { class: 'g-band', 'aria-hidden': 'true', text: b.label }),
        h('span', { class: 'sr-only', text: `${label}: ${score} out of 100, ${b.label.toLowerCase()}.` }),
      );
      gauges.append(li);
      const fill = ring.querySelector('.g-fill');
      const target = C * (1 - score / 100);
      if (reduceMotion()) fill.style.strokeDashoffset = target;
      else {
        requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.strokeDashoffset = target; }));
        const t0 = performance.now();
        const count = (now) => {
          const p = Math.min(1, (now - t0) / 1200);
          num.textContent = String(Math.round(score * (1 - (1 - p) ** 3)));
          if (p < 1) requestAnimationFrame(count);
        };
        requestAnimationFrame(count);
      }
    }

    const strong = isStrong(scores);
    const list = issues.length
      ? h('ol', { class: 'issues' }, ...issues.map((i) => h('li', {}, h('strong', { text: i.title }), h('p', { text: i.body }))))
      : h('p', { class: 'issues-none', text: 'Nothing major to fix. Nice work.' });
    const intro = strong && issues.length
      ? [h('p', { class: 'issues-intro', text: "Your site is in good shape. None of these are urgent. They're small things that could make it a little better." })]
      : [];

    const cta = h('a', { class: 'btn', href: '#contact', text: issues.length && !strong ? 'Want these fixed? Free consultation.' : 'Want a second opinion? Free consultation.' });
    cta.addEventListener('click', (e) => {
      e.preventDefault();
      // No contact form on this page (the /tools/ page): carry the summary to the home page's.
      if (!document.getElementById('contactForm')) return sendToContact(contactSummary(host, result));
      prefillContact(host, result);
      document.getElementById('contact')?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' });
      history.replaceState(null, '', '#contact');
      document.getElementById('name')?.focus({ preventScroll: true });
    });

    resultsEl.replaceChildren(
      h('h3', { id: 'checkResultsTitle', tabindex: '-1', text: `Results for ${host}` }),
      h('p', { class: 'results-note', text: 'Mobile test by Google PageSpeed Insights. Scores can move a few points between runs.' }),
      gauges,
      h('h4', { text: strong ? 'Minor suggestions' : 'Top things to fix' }),
      ...intro,
      list,
      a11yDetails(result.accessibility),
      cta,
    );
  }

  // Every failing automated accessibility check, grouped by issue. Collapsed by default.
  function a11yDetails(report) {
    if (!report) return null; // a result cached before this section existed
    const { groups, passed, total } = report;
    const n = groups.length;
    const where = (g) => {
      if (g.page && !g.count) return 'This affects the whole page.';
      const places = `Found in ${g.count} ${g.count === 1 ? 'place' : 'places'}`;
      return g.examples.length ? `${places}, for example ${g.examples.map((x) => `"${x}"`).join(' and ')}.` : `${places}.`;
    };
    return h(
      'details',
      { class: 'a11y' },
      h('summary', { text: n ? `Accessibility details: ${n} ${n === 1 ? 'issue' : 'issues'} found` : 'Accessibility details: no problems found' }),
      h('p', { class: 'a11y-intro', text: `Google's automated test passed ${passed} of ${total} accessibility checks.` }),
      n
        ? h('ol', { class: 'issues a11y-list' }, ...groups.map((g) => h('li', {}, h('strong', { text: g.title }), h('p', { text: g.body }), h('p', { class: 'a11y-where', text: where(g) }))))
        : h('p', { class: 'issues-none', text: "It didn't find any accessibility problems." }),
      h('p', { class: 'a11y-note', text: A11Y_NOTE }),
    );
  }

  function contactSummary(host, { scores, issues }) {
    const strong = isStrong(scores);
    const message = [
      `I ran the free website check on ${host}.`,
      `Performance ${scores.performance}, Accessibility ${scores.accessibility}, Best practices ${scores.bestPractices}, SEO ${scores.seo}.`,
      ...(issues.length ? ['', strong ? 'Minor suggestions:' : 'Top issues:', ...issues.map((i) => `- ${i.title}`)] : []),
      '',
      strong ? "I'd like a second opinion." : "I'd like help with these.",
    ].join('\n');
    // A strong site isn't necessarily broken, so leave the service as it is.
    return { message, service: strong ? null : 'Fix something' };
  }

  function prefillContact(host, result) {
    fillContact(contactSummary(host, result));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    start(input.value);
  });
  selfBtn.addEventListener('click', () => {
    input.value = 'mancolabs.dev';
    start(SELF_URL);
  });
  section.dataset.checkReady = 'true';
}
