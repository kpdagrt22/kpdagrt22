import { createHash } from 'node:crypto';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const IST_OFFSET_MS = 330 * 60 * 1000; // Asia/Kolkata is UTC+05:30 all year

/** Calendar date (YYYY-MM-DD) of a timestamp in India Standard Time. */
export function istDate(isoOrMs) {
  const t = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  if (Number.isNaN(t)) throw new Error(`Invalid timestamp: ${isoOrMs}`);
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "2026-11-03" -> "3 Nov 2026" (fixed English, independent of the runner's locale). */
/** A timestamp as "YYYY-MM-DDTHH:MM:SSZ" (UTC, whole seconds), the form evidence is stored in. */
export function isoSecond(isoOrMs) {
  const t = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  if (Number.isNaN(t)) throw new Error(`Invalid timestamp: ${isoOrMs}`);
  return new Date(Math.floor(t / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

export function humanDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? '');
  if (!m) throw new Error(`Invalid date: ${ymd}`);
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function addDays(ymd, n) {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`Invalid date: ${ymd}`);
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Start of the activity window: midnight UTC, `days` days before the current
 * UTC day. Flooring to the day keeps two runs on the same day identical.
 */
export function windowStart(nowMs, days) {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const ymd = addDays(day, -days);
  return { date: ymd, iso: `${ymd}T00:00:00Z` };
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function toLf(text) {
  return text.replace(/\r\n/g, '\n');
}

export function withEol(text, eol) {
  const lf = toLf(text);
  return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

export function firstLine(text) {
  return String(text ?? '').split(/\r?\n/, 1)[0].trim();
}

export function compareBy(...keys) {
  return (a, b) => {
    for (const k of keys) {
      const desc = k.startsWith('-');
      const key = desc ? k.slice(1) : k;
      const av = a[key] ?? '';
      const bv = b[key] ?? '';
      if (av < bv) return desc ? 1 : -1;
      if (av > bv) return desc ? -1 : 1;
    }
    return 0;
  };
}
