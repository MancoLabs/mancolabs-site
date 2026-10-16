// Email health check: reads a domain's public email settings (mail servers,
// SPF, DMARC, and DKIM under common names) through free DNS-over-HTTPS
// services, then explains in plain English whether mail is likely to reach the
// inbox. Nothing is stored, and no email is sent.
import { sendToContact } from '../contact-handoff.js';

// Cloudflare first, Google if Cloudflare can't be reached. Neither needs a key.
const RESOLVERS = [
  (name, type, signal) => fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal }),
  (name, type, signal) => fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { signal }),
];
const TIMEOUT_MS = 10_000;

// Who handles the mail, from the mail server names. `spf` lists what that
// provider's SPF include usually contains (null: don't check).
const PROVIDERS = [
  [/(^|\.)(google|googlemail)\.com$/, 'Google Workspace', ['_spf.google.com']],
  [/(^|\.)(protection\.outlook|outlook)\.com$/, 'Microsoft 365', ['spf.protection.outlook.com']],
  [/(^|\.)zoho(mail)?\.(com|eu|in|com\.au|jp|com\.cn)$/, 'Zoho Mail', ['zoho']],
  [/(^|\.)secureserver\.net$/, 'GoDaddy', ['secureserver.net']],
  [/(^|\.)messagingengine\.com$/, 'Fastmail', ['messagingengine.com']],
  [/(^|\.)(protonmail\.ch|proton\.me)$/, 'Proton Mail', ['protonmail.ch']],
  [/(^|\.)(icloud|me)\.com$/, 'iCloud Mail', ['icloud.com']],
  [/(^|\.)mx\.cloudflare\.net$/, 'Cloudflare Email Routing', ['mx.cloudflare.net']],
  [/(^|\.)emailsrvr\.com$/, 'Rackspace Email', ['emailsrvr.com']],
  [/(^|\.)(privateemail|registrar-servers)\.com$/, 'Namecheap', ['privateemail.com', 'registrar-servers.com']],
  [/(^|\.)titan\.email$/, 'Titan Mail', ['titan.email']],
  [/(^|\.)hostinger\.com$/, 'Hostinger', ['hostinger.com']],
  [/(^|\.)improvmx\.com$/, 'ImprovMX', ['improvmx.com']],
  [/(^|\.)(ionos\.(com|de|co\.uk|es|fr)|kundenserver\.de|perfora\.net)$/, 'IONOS', null],
  [/(^|\.)yahoodns\.net$/, 'Yahoo', null],
  [/(^|\.)mailgun\.org$/, 'Mailgun', ['mailgun.org']],
  [/(^|\.)sendgrid\.net$/, 'SendGrid', ['sendgrid.net']],
  [/(^|\.)amazonaws\.com$/, 'Amazon SES', ['amazonses.com']],
  // Security filters sit in front of the real mailbox provider, so skip the SPF match.
  [/(^|\.)pphosted\.com$/, 'Proofpoint (an email security filter)', null],
  [/(^|\.)mimecast\.com$/, 'Mimecast (an email security filter)', null],
  [/(^|\.)barracudanetworks\.com$/, 'Barracuda (an email security filter)', null],
];

// DKIM keys live under a name (a "selector") the mail service picks. These are
// the common ones; a custom one can't be guessed.
const SELECTORS = [
  'google', 'selector1', 'selector2', 'k1', 'k2', 'k3', 's1', 's2', 'default', 'dkim', 'mail', 'smtp',
  'zmail', 'zoho', 'fm1', 'fm2', 'fm3', 'protonmail', 'protonmail2', 'protonmail3', 'sig1', 'hs1', 'hs2',
  'mandrill', 'mxvault', 'cm', 'resend', 'mailjet', 'key1', 'everlytickey1',
];

const MESSAGES = {
  empty: 'Type in your domain, like yourbusiness.com.',
  invalid: "That doesn't look like a domain. Try something like yourbusiness.com, or paste your email address.",
  nxdomain: "That domain doesn't seem to exist. Check the spelling and try again.",
  network: "Couldn't reach the DNS lookup service. Check your connection and try again.",
};

class EmailError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

// "you@shop.com", "https://www.shop.com/about", or "shop.com" all become "shop.com".
export function normalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) throw new EmailError('empty');
  if (s.includes('@')) s = s.slice(s.lastIndexOf('@') + 1);
  s = s.replace(/^[a-z][a-z\d+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  try {
    s = new URL(`http://${s}`).hostname; // handles accented domain names
  } catch {
    throw new EmailError('invalid');
  }
  s = s.replace(/^www\./, '');
  const labels = s.split('.');
  if (labels.length < 2 || labels.some((l) => !/^[a-z\d]([a-z\d-]{0,61}[a-z\d])?$/.test(l)) || /^\d+$/.test(labels.at(-1))) {
    throw new EmailError('invalid');
  }
  if (/^(localhost|local|internal|lan|home|test|invalid|example)$/.test(labels.at(-1))) throw new EmailError('invalid');
  return s;
}

async function query(name, type) {
  for (const resolve of RESOLVERS) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
    try {
      const res = await resolve(name, type, timeout.signal);
      if (!res.ok) continue;
      const data = await res.json();
      return { status: data.Status, answers: data.Answer || [] };
    } catch {
      // try the next service
    } finally {
      clearTimeout(timer);
    }
  }
  throw new EmailError('network');
}

// TXT records come back quoted (Cloudflare) or bare (Google), sometimes in pieces.
const txtValue = (data) => {
  const parts = String(data).match(/"((?:[^"\\]|\\.)*)"/g);
  return parts ? parts.map((p) => p.slice(1, -1).replace(/\\(.)/g, '$1')).join('') : String(data);
};
const txtsOf = (r) => r.answers.filter((a) => a.type === 16).map((a) => txtValue(a.data).trim());

function readMx(r) {
  const hosts = r.answers
    .filter((a) => a.type === 15)
    .map((a) => {
      const [prio, host] = String(a.data).trim().split(/\s+/);
      return { prio: Number(prio), host: (host || '').replace(/\.$/, '').toLowerCase() };
    })
    .sort((a, b) => a.prio - b.prio);
  if (!hosts.length) return { status: 'none', hosts: [] };
  if (hosts.length === 1 && !hosts[0].host) return { status: 'null', hosts: [] }; // "0 ." means "no mail here, on purpose"
  const match = PROVIDERS.find(([re]) => hosts.some((h) => re.test(h.host)));
  return { status: 'ok', hosts: hosts.map((h) => h.host), provider: match?.[1] || null, spfHints: match?.[2] || null };
}

const isSpf = (t) => /^v=spf1(\s|$)/i.test(t);

// Follows include: and redirect= the way inboxes do, counting the DNS lookups
// they cost. Inboxes give up past 10, so a longer list fails for everyone.
async function expandSpf(record) {
  const texts = [];
  let lookups = 0;
  const visit = async (rec, depth) => {
    texts.push(rec.toLowerCase());
    for (const term of rec.split(/\s+/).slice(1)) {
      if (/^[+~?-]?(a|mx|ptr|exists)([:/]|$)/i.test(term)) lookups++;
      const target = term.match(/^[+~?-]?include:(.+)$/i)?.[1] || term.match(/^redirect=(.+)$/i)?.[1];
      if (!target) continue;
      lookups++;
      if (lookups > 10 || depth >= 6) continue;
      const next = txtsOf(await query(target, 'TXT').catch(() => ({ answers: [] }))).find(isSpf);
      if (next) await visit(next, depth + 1);
    }
  };
  await visit(record, 0);
  return { texts, lookups };
}

async function readSpf(txts, mx) {
  const recs = txts.filter(isSpf);
  if (!recs.length) return { status: 'missing' };
  if (recs.length > 1) return { status: 'multiple', records: recs };
  const record = recs[0];
  const all = record.match(/(?:^|\s)([+~?-]?)all(?=\s|$)/i);
  const redirect = /(?:^|\s)redirect=/i.test(record);
  if (all && (all[1] === '+' || all[1] === '')) return { status: 'open', record };
  if (!all && !redirect) return { status: 'unfinished', record };
  if (all && all[1] === '?') return { status: 'unfinished', record };
  const { texts, lookups } = await expandSpf(record);
  if (lookups > 10) return { status: 'too-long', record, lookups };
  if (mx.spfHints && !mx.spfHints.some((hint) => texts.some((t) => t.includes(hint)))) return { status: 'no-provider', record };
  return { status: 'ok', record, strict: all?.[1] === '-' };
}

function readDmarc(txts) {
  const recs = txts.filter((t) => /^v=DMARC1(\s*;|$)/i.test(t));
  if (!recs.length) return { status: 'missing' };
  if (recs.length > 1) return { status: 'invalid', record: recs.join(' / ') };
  const record = recs[0];
  const tags = Object.fromEntries(
    record.split(';').map((p) => p.trim().split('=').map((x) => x.trim().toLowerCase())).filter((p) => p.length === 2),
  );
  const policy = tags.p;
  if (!['none', 'quarantine', 'reject'].includes(policy)) return { status: 'invalid', record };
  if (policy === 'none') return { status: 'monitor', record, policy };
  const pct = tags.pct ? Number(tags.pct) : 100;
  return { status: 'enforced', record, policy, partial: pct < 100 };
}

function readDkim(results) {
  const isKey = (t) => /(^|;)\s*v=DKIM1/i.test(t) || /(^|;)\s*p=[A-Za-z0-9+/]{20,}/.test(t);
  const found = [];
  results.forEach((r, i) => {
    if (!r) return;
    const key = r.answers.some((a) => a.type === 16 && isKey(txtValue(a.data)));
    const pointer = r.answers.some((a) => a.type === 5);
    if (key || pointer) found.push(SELECTORS[i]);
  });
  // A wildcard record answers for every name, which proves nothing.
  if (found.length > SELECTORS.length / 2) return { status: 'unknown', found: [] };
  return { status: found.length ? 'found' : 'unknown', found };
}

export async function inspectDomain(domain) {
  const [mxR, txtR, dmarcR, ...dkimR] = await Promise.all([
    query(domain, 'MX'),
    query(domain, 'TXT'),
    query(`_dmarc.${domain}`, 'TXT'),
    ...SELECTORS.map((s) => query(`${s}._domainkey.${domain}`, 'TXT').catch(() => null)),
  ]);
  if (mxR.status === 3) throw new EmailError('nxdomain');
  const mx = readMx(mxR);
  const spf = await readSpf(txtsOf(txtR), mx);
  const dmarc = readDmarc(txtsOf(dmarcR));
  const dkim = readDkim(dkimR);
  const spfPoints = spf.status === 'ok' ? 2 : spf.status === 'unfinished' || spf.status === 'no-provider' ? 1 : 0;
  const dmarcPoints = dmarc.status === 'enforced' ? 2 : dmarc.status === 'monitor' ? 1 : 0;
  const overall = spfPoints === 2 && dmarcPoints === 2 ? 'good' : spfPoints + dmarcPoints === 0 ? 'poor' : 'partial';
  return { domain, mx, spf, dmarc, dkim, overall };
}

// ── Plain English ─────────────────────────────
const VERDICT = {
  good: ['Set up to stay out of the spam folder', 'Your domain has the main protections inboxes look for.'],
  partial: ['Partly set up', "Some of the protections inboxes look for are missing or unfinished, so some of your email may land in spam."],
  poor: ['Not set up to stay out of the spam folder', 'Your domain is missing the main protections inboxes look for. Your email is more likely to land in spam, and it\'s easier for someone to send fake email in your name.'],
};

function rows(r) {
  const { mx, spf, dmarc, dkim } = r;
  const provider =
    mx.status === 'ok'
      ? mx.provider
        ? ['info', 'Found', `Based on your mail servers, your email looks like it's handled by ${mx.provider}.`]
        : ['info', 'Found', `Your mail servers are ${mx.hosts.slice(0, 2).join(' and ')}. We couldn't tell which company runs them.`]
      : mx.status === 'null'
        ? ['info', 'None', "This domain says it doesn't receive email, on purpose."]
        : ['poor', 'None', "No mail servers are listed, so this domain can't receive email."];
  const spfRow = {
    ok: ['good', 'Good', 'Your domain lists which services are allowed to send email for it. Inboxes check this to decide whether to trust your mail.'],
    'no-provider': ['okay', 'Check this', `Your sender list doesn't seem to include ${mx.provider}, which handles your email. If you send email through ${mx.provider}, those messages may look suspicious to inboxes.`],
    'too-long': ['poor', 'Problem', `Your sender list points to too many other lists (${spf.lookups} lookups, and the limit is 10). Inboxes stop checking partway, so your email may not count as verified.`],
    unfinished: ['okay', 'Needs work', "Your domain lists which services may send email for it, but doesn't tell inboxes what to do with mail from anyone else. That weakens it."],
    open: ['poor', 'Problem', 'Your sender list allows anyone at all to send email as your domain, which defeats its purpose.'],
    multiple: ['poor', 'Problem', 'Your domain has more than one sender list (SPF record). Only one is allowed, so inboxes may ignore them all. They need to be combined into one.'],
    missing: ['poor', 'Missing', "Your domain doesn't list which services are allowed to send email for it (an SPF record). Many inboxes treat that as a warning sign."],
  }[spf.status];
  const dkimRow =
    dkim.status === 'found'
      ? ['good', 'Found', `Your email is digitally signed (found under the name "${dkim.found[0]}"), so inboxes can check that messages really came from you.`]
      : ['info', 'Not found under common names', "We looked for a digital signature (DKIM) under the names most services use and didn't find one. Some services use a custom name we can't guess, so this doesn't mean it's missing. Your email provider's settings can confirm it's turned on."];
  const dmarcRow = {
    enforced: dmarc.partial
      ? ['okay', 'Partly on', `Your domain tells inboxes to ${dmarc.policy === 'reject' ? 'reject' : 'send to spam'} some fake email that pretends to be from you, but not all of it yet.`]
      : ['good', 'Good', `Your domain tells inboxes to ${dmarc.policy === 'reject' ? 'reject' : 'send to spam'} fake email that pretends to be from you.`],
    monitor: ['okay', 'Monitoring only', "You have a DMARC record, but it's set to watch only (p=none), so fake email pretending to be from you isn't blocked yet."],
    invalid: ['poor', 'Problem', "There's a DMARC record, but it has a mistake, so inboxes will likely ignore it."],
    missing: ['poor', 'Missing', "There's no DMARC record. It protects your name from fake senders, and Gmail and Yahoo require one from businesses that send a lot of email."],
  }[dmarc.status];
  return [
    ['Email provider', ...provider],
    ['Sender list (SPF)', ...spfRow],
    ['Digital signature (DKIM)', ...dkimRow],
    ['Spoofing protection (DMARC)', ...dmarcRow],
  ];
}

function records(r) {
  const { mx, spf, dmarc, dkim } = r;
  return [
    ['Mail servers (MX)', mx.hosts.length ? mx.hosts.join(', ') : 'none'],
    ['SPF', spf.record || spf.records?.join(' / ') || 'none found'],
    ['DMARC', dmarc.record || 'none found'],
    ['DKIM', dkim.found.length ? `found under: ${dkim.found.join(', ')}` : 'not found under common names'],
  ];
}

function summaryText(r) {
  const lines = rows(r).map(([name, , label]) => `${name}: ${label}`);
  return [
    `I ran the free email health check on ${r.domain}.`,
    `Result: ${VERDICT[r.overall][0]}.`,
    ...lines,
    '',
    r.overall === 'good' ? "I'd like a second opinion on my email setup." : "I'd like help with my email setup.",
  ].join('\n');
}

// ── Page ──────────────────────────────────────
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

export function initEmailCheck(section) {
  const form = section.querySelector('form');
  const input = form.querySelector('input');
  const submit = form.querySelector('button[type="submit"]');
  const errorEl = section.querySelector('.field-error');
  const statusEl = section.querySelector('[role="status"]');
  const resultsEl = section.querySelector('.tool-results');
  let running = false;

  const showError = (kind) => {
    errorEl.textContent = MESSAGES[kind] || MESSAGES.network;
    errorEl.hidden = false;
    if (kind !== 'network') {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
  };
  const clearError = () => {
    errorEl.hidden = true;
    errorEl.textContent = '';
    input.removeAttribute('aria-invalid');
  };

  const render = (r) => {
    const [headline, line] = VERDICT[r.overall];
    const list = h('ul', { class: 'mail-rows', role: 'list' });
    for (const [name, tone, label, explain] of rows(r)) {
      list.append(h('li', { class: `mail-row is-${tone}` }, h('div', { class: 'mail-head' }, h('strong', { text: name }), h('span', { class: 'status-chip', text: label })), h('p', { text: explain })));
    }
    const raw = h('details', { class: 'mail-raw' }, h('summary', { text: 'Show the records we found' }), h('dl', {}, ...records(r).flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])));
    const cta = h('a', { class: 'btn', href: '/#contact', text: r.overall === 'good' ? 'Want a second opinion? Free consultation.' : 'Want help with your email setup? Free consultation.' });
    cta.addEventListener('click', (e) => {
      e.preventDefault();
      sendToContact({ message: summaryText(r), service: r.overall === 'good' ? null : 'Fix something' });
    });
    resultsEl.replaceChildren(
      h('h3', { id: 'mailResultsTitle', tabindex: '-1', text: `Results for ${r.domain}` }),
      h('p', { class: `mail-verdict is-${r.overall}` }, h('strong', { text: headline }), ' ', line),
      list,
      raw,
      cta,
    );
    resultsEl.hidden = false;
    statusEl.textContent = `Results are ready for ${r.domain}.`;
    resultsEl.querySelector('h3').focus();
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (running) return;
    clearError();
    let domain;
    try {
      domain = normalizeDomain(input.value);
    } catch (err) {
      return showError(err.kind);
    }
    running = true;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    statusEl.textContent = `Looking up the email settings for ${domain}.`;
    try {
      render(await inspectDomain(domain));
    } catch (err) {
      statusEl.textContent = '';
      resultsEl.hidden = true;
      showError(err instanceof EmailError ? err.kind : 'network');
    } finally {
      running = false;
      submit.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
  section.dataset.toolReady = 'true';
}
