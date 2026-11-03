// Minimal GitHub REST client: built-in fetch, bounded retries with backoff,
// primary and secondary rate-limit awareness, Link-header pagination.
// The token is only ever sent to https://api.github.com and is never logged.

import { sleep as realSleep } from './util.mjs';

const API = 'https://api.github.com';
const MAX_WAIT_MS = 5 * 60 * 1000; // a single wait longer than this fails the run instead
const TOTAL_WAIT_BUDGET_MS = 8 * 60 * 1000; // per request

export class GitHubError extends Error {
  constructor(message, { status = 0, path = '' } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.path = path;
  }
}

export function nextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m) return m[1];
  }
  return null;
}

/**
 * How long to wait before retrying, or null when the error is not retryable.
 * Exported for tests.
 */
export function retryDelay({ status, headers, text, attempt, now = Date.now() }) {
  const get = (h) => (typeof headers?.get === 'function' ? headers.get(h) : headers?.[h]) ?? null;
  const retryAfter = Number(get('retry-after'));
  const remaining = get('x-ratelimit-remaining');
  const reset = Number(get('x-ratelimit-reset'));
  const secondary = /secondary rate limit|abuse detection|abuse rate/i.test(text ?? '');

  if (status === 429 || (status === 403 && (remaining === '0' || secondary))) {
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
    if (remaining === '0' && Number.isFinite(reset) && reset > 0) return Math.max(reset * 1000 - now, 0) + 1000;
    // Secondary limits without a hint: GitHub asks for at least a minute.
    return 60_000 * 2 ** Math.min(attempt, 2);
  }
  if (status >= 500 && status <= 599) return 1000 * 2 ** attempt;
  return null;
}

export function createClient({
  token,
  userAgent = 'kpdagrt22-profile-intel',
  maxRetries = 5,
  log = () => {},
  fetchImpl = globalThis.fetch,
  sleepImpl = realSleep,
  mutationGapMs = 1000,
} = {}) {
  if (!token) {
    throw new Error('GH_TOKEN is not set. Locally: GH_TOKEN=$(gh auth token) node tools/profile-intel/run.mjs --dry-run');
  }
  let lastMutation = 0;
  let calls = 0;

  async function request(method, pathOrUrl, { body, accept = 'application/vnd.github+json', allow404 = false } = {}) {
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${API}${pathOrUrl}`;
    if (!url.startsWith(`${API}/`)) throw new Error(`Refusing to send the token outside ${API}`);
    const shortPath = url.slice(API.length).split('?')[0];
    let waited = 0;

    for (let attempt = 0; ; attempt++) {
      if (method !== 'GET') {
        // GitHub asks integrations to space out mutating requests.
        const gap = lastMutation + mutationGapMs - Date.now();
        if (gap > 0) await sleepImpl(gap);
        lastMutation = Date.now();
      }
      calls++;
      let res;
      try {
        res = await fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            accept,
            'x-github-api-version': '2022-11-28',
            'user-agent': userAgent,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        if (attempt >= maxRetries) {
          throw new GitHubError(`${method} ${shortPath}: network error after ${attempt + 1} attempts (${err.message})`, { path: shortPath });
        }
        const d = 1000 * 2 ** attempt;
        waited += d;
        log(`network error on ${method} ${shortPath}; retry ${attempt + 1}/${maxRetries} in ${d / 1000} s`);
        await sleepImpl(d);
        continue;
      }

      if (res.ok) {
        if (res.status === 204) return { data: null, headers: res.headers, status: 204 };
        const isJson = (res.headers.get('content-type') ?? '').includes('json') && !accept.includes('raw');
        const data = isJson ? await res.json() : await res.text();
        return { data, headers: res.headers, status: res.status };
      }
      if (res.status === 404 && allow404) {
        await res.text().catch(() => '');
        return { data: null, headers: res.headers, status: 404 };
      }

      const text = await res.text().catch(() => '');
      let message = text;
      try {
        message = JSON.parse(text).message ?? text;
      } catch {
        /* not JSON */
      }
      const delay = retryDelay({ status: res.status, headers: res.headers, text, attempt });
      if (delay === null || attempt >= maxRetries || delay > MAX_WAIT_MS || waited + delay > TOTAL_WAIT_BUDGET_MS) {
        throw new GitHubError(`${method} ${shortPath}: HTTP ${res.status} ${String(message).slice(0, 200)}`, {
          status: res.status,
          path: shortPath,
        });
      }
      waited += delay;
      log(`HTTP ${res.status} on ${method} ${shortPath}; retry ${attempt + 1}/${maxRetries} in ${Math.ceil(delay / 1000)} s`);
      await sleepImpl(delay);
    }
  }

  async function get(path, opts) {
    return (await request('GET', path, opts)).data;
  }

  async function paginate(path, { max = Infinity, itemsKey = null } = {}) {
    const out = [];
    let url = path;
    let first = null;
    while (url) {
      const { data, headers } = await request('GET', url);
      if (first === null) first = data;
      const items = itemsKey ? data?.[itemsKey] ?? [] : data ?? [];
      out.push(...items);
      if (out.length >= max) return { items: out.slice(0, max), first, truncated: true };
      url = nextLink(headers.get('link'));
    }
    return { items: out, first, truncated: false };
  }

  return {
    request,
    get,
    paginate,
    post: async (path, body) => (await request('POST', path, { body })).data,
    patch: async (path, body) => (await request('PATCH', path, { body })).data,
    get calls() {
      return calls;
    },
  };
}

/**
 * Checks a link the way a signed-out reader would see it: no token, follow
 * redirects, HTTP 200 required. Returns { ok, status }.
 */
export async function checkPublicUrl(url, { fetchImpl = globalThis.fetch, sleepImpl = realSleep, retries = 4 } = {}) {
  if (!/^https:\/\//.test(url)) return { ok: false, status: 0 };
  let method = 'HEAD';
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        redirect: 'follow',
        headers: { 'user-agent': 'kpdagrt22-profile-intel (link check)' },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      if (attempt >= retries) return { ok: false, status: 0, error: err.message };
      await sleepImpl(1500 * 2 ** attempt);
      continue;
    }
    if (res.status === 405 && method === 'HEAD') {
      method = 'GET';
      continue;
    }
    if (res.status === 200) return { ok: true, status: 200 };
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const ra = Number(res.headers.get('retry-after'));
      await sleepImpl(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : 2000 * 2 ** attempt);
      continue;
    }
    return { ok: false, status: res.status };
  }
}
