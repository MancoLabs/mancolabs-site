// Google PageSpeed Insights (v5), mobile, all four categories.
import { topIssues } from './issues.js';

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CATEGORIES = ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO'];
// Drops field data and translations we don't use. (The API can't trim inside audits.)
const FIELDS = 'lighthouseResult(lighthouseVersion,finalDisplayedUrl,runtimeError,categories,audits)';
const TIMEOUT_MS = 90_000;

export class CheckError extends Error {
  constructor(kind, detail = '') {
    super(detail || kind);
    this.kind = kind; // empty | invalid | private | setup | busy | unreachable | timeout | network | google
  }
}

export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new CheckError('empty');
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new CheckError('invalid');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new CheckError('invalid');
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.startsWith('[') ||
    /^(127|10)\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)
  ) throw new CheckError('private');
  if (!host.includes('.') || host.endsWith('.')) throw new CheckError('invalid');
  u.hash = '';
  return u.toString();
}

const ERROR_CODES = /FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS_FAILURE|NO_FCP|NOT_HTML|INVALID_URL|PAGE_HUNG|NO_DOCUMENT_REQUEST|unable to (process|reach|resolve)|Unable to resolve/i;

export async function runCheck(url, { signal } = {}) {
  const key = import.meta.env.VITE_PSI_API_KEY;
  if (!key) throw new CheckError('setup', 'VITE_PSI_API_KEY is not set');

  const q = new URL(ENDPOINT);
  q.searchParams.set('url', url);
  q.searchParams.set('strategy', 'mobile');
  for (const c of CATEGORIES) q.searchParams.append('category', c);
  q.searchParams.set('fields', FIELDS);
  q.searchParams.set('key', key);

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  signal?.addEventListener('abort', () => timeout.abort());

  let res;
  try {
    res = await fetch(q, { signal: timeout.signal });
  } catch {
    throw new CheckError(timeout.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => null);
  const message = data?.error?.message || '';
  if (res.status === 429) throw new CheckError('busy', message);
  if (res.status === 403 || /API key|referer|referrer/i.test(message)) throw new CheckError('setup', message);
  if (!res.ok) throw new CheckError(ERROR_CODES.test(message) || res.status === 400 ? 'unreachable' : 'google', message);

  const lh = data.lighthouseResult;
  if (lh.runtimeError?.code && lh.runtimeError.code !== 'NO_ERROR') throw new CheckError('unreachable', lh.runtimeError.message);

  const score = (id) => Math.round((lh.categories[id]?.score ?? 0) * 100);
  return {
    url: lh.finalDisplayedUrl || url,
    scores: {
      performance: score('performance'),
      accessibility: score('accessibility'),
      bestPractices: score('best-practices'),
      seo: score('seo'),
    },
    issues: topIssues(lh),
    screenshot: lh.audits['final-screenshot']?.details?.data || null,
    frames: (lh.audits['screenshot-thumbnails']?.details?.items || []).map((i) => i.data).filter(Boolean),
  };
}
