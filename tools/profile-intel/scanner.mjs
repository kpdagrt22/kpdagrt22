// Mandatory output scanner. Everything the pipeline would publish (README
// blocks, the manifest, recent-work.json, pull request bodies, the report and
// job summary) passes through here first; any finding fails the run before a
// single byte is pushed.
//
// Findings carry the kind and the line number, never the matched text, so a
// failure report cannot itself leak what it found.

const SECRET_PATTERNS = [
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{30,}/g],
  ['github-token', /\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ['api-key', /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}/g],
  ['api-key', /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['api-key', /\bAIza[0-9A-Za-z_-]{30,}/g],
  ['aws-key', /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/g],
  ['slack-token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g],
  ['private-key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g],
  ['credential-url', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"'<>]+:[^\s/@"'<>]+@/gi],
];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/g;

const PHONE_PATTERNS = [
  // International form: +91 98765 43210, +1-415-555-0100, +44 20 7946 0958
  /(?<![\w+])\+\d{1,3}[\s.-]?\(?\d{1,5}\)?(?:[\s.-]?\d{2,5}){2,4}(?![\w])/g,
  // Indian mobile without the country code: 9876543210, 98765 43210
  /(?<![A-Za-z0-9.,/#:-])[6-9]\d{4}[\s-]?\d{5}(?![A-Za-z0-9])/g,
  // North American: (415) 555-0100, 415-555-0100, 415.555.0100
  /(?<![A-Za-z0-9])(?:\(\d{3}\)\s?|\d{3}[-.])\d{3}[-.]\d{4}(?![A-Za-z0-9])/g,
];

const IPV4_RE = /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\w.]*\d)/g;

const H = '[0-9A-Fa-f]{1,4}';
const IPV6_RE = new RegExp(
  `(?<![\\w:.])(?:(?:${H}:){7}${H}|(?:${H}:){0,6}${H}?::(?:${H}:){0,6}${H}|(?:${H}:){1,7}:(?=[^\\w:]|$)|::(?:${H}:){0,6}${H})(?![\\w:])`,
  'g',
);

const URL_RE = /\b(?:https?|ftp|wss?):\/\/[^\s<>"'`)\]]+/gi;

const NON_PUBLIC_TLDS = new Set(['local', 'localhost', 'internal', 'intranet', 'lan', 'corp', 'home', 'localdomain', 'private', 'test', 'invalid', 'example', 'arpa', 'svc', 'cluster']);

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
}

/** True when a URL points somewhere a signed-out reader on the internet cannot reach. */
export function isNonPublicHost(host) {
  if (!host) return true;
  if (!host.includes('.')) return true; // localhost, single-label intranet names
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return true; // IP literals
  const tld = host.split('.').pop();
  if (NON_PUBLIC_TLDS.has(tld)) return true;
  if (/(^|\.)(internal|intranet|corp|local|lan)\./.test(host)) return true;
  return false;
}

function shannon(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

// A 7-40 character hex run is a git object id when it sits in one of these
// places; anywhere else a long hex string is treated as a possible secret.
const SHA_CONTEXT_RE = /(?:\/(?:commit|commits|blob|tree|releases\/tag)\/|[\w.-]+\/[\w.-]+@|\bcommit\s|\bsha[:=\s"]+)$/i;

function hexFindings(text) {
  const out = [];
  for (const m of text.matchAll(/(?<![0-9A-Za-z])[0-9a-fA-F]{32,}(?![0-9A-Za-z])/g)) {
    const before = text.slice(Math.max(0, m.index - 80), m.index);
    const isSha = m[0].length === 40 && /^[0-9a-f]+$/.test(m[0]) && SHA_CONTEXT_RE.test(before);
    if (!isSha) out.push({ kind: 'long-hex', index: m.index, end: m.index + m[0].length });
  }
  return out;
}

function highEntropy(token) {
  if (/^[0-9a-fA-F]+$/.test(token)) return false; // hex is judged separately
  if (!/[A-Z]/.test(token) || !/[a-z]/.test(token) || !/\d/.test(token)) return false;
  // Hyphenated or slashed words (slugs, paths) are not secrets.
  const parts = token.split(/[-_/]/).filter(Boolean);
  if (parts.length >= 3 && parts.every((p) => p.length <= 24 && /^[A-Za-z]+\d*$|^\d+$/.test(p))) return false;
  return shannon(token) >= 4.2;
}

// URL paths are judged by the URL rule (is the host public?), so they are
// blanked before the entropy check; query values and fragments still count.
function base64Findings(text) {
  const out = [];
  const blanked = text.replace(URL_RE, (u) => {
    const q = u.search(/[?#]/);
    return q === -1 ? ' '.repeat(u.length) : ' '.repeat(q) + u.slice(q).replace(/[?#&=]/g, ' ');
  });
  for (const m of blanked.matchAll(/[A-Za-z0-9+/_=-]{40,}/g)) {
    if (highEntropy(m[0])) out.push({ kind: 'high-entropy-string', index: m.index, end: m.index + m[0].length });
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scan one text. Options:
 *   privateRepos: full names ("owner/name") whose URLs must never appear.
 * Returns [{ kind, line }], sorted, de-duplicated.
 */
export function scanText(text, { privateRepos = [] } = {}) {
  const s = String(text ?? '');
  const hits = [];
  for (const [kind, re] of SECRET_PATTERNS) for (const m of s.matchAll(re)) hits.push({ kind, index: m.index, end: m.index + m[0].length });
  for (const m of s.matchAll(EMAIL_RE)) hits.push({ kind: 'email', index: m.index });
  for (const re of PHONE_PATTERNS) for (const m of s.matchAll(re)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) hits.push({ kind: 'phone-number', index: m.index });
  }
  for (const m of s.matchAll(IPV4_RE)) hits.push({ kind: 'ipv4', index: m.index });
  for (const m of s.matchAll(IPV6_RE)) {
    if (m[0].split(':').filter(Boolean).length >= 2 || m[0].startsWith('::')) hits.push({ kind: 'ipv6', index: m.index });
  }
  for (const m of s.matchAll(URL_RE)) {
    if (isNonPublicHost(hostOf(m[0]))) hits.push({ kind: 'non-public-url', index: m.index });
  }
  // Generic rules (long hex, high entropy) only report what no specific rule already named.
  const specific = hits.filter((h) => h.end !== undefined);
  const overlaps = (g) => specific.some((h) => g.index < h.end && h.index < g.end);
  hits.push(...[...hexFindings(s), ...base64Findings(s)].filter((g) => !overlaps(g)));
  for (const full of privateRepos) {
    const re = new RegExp(`(?:github\\.com[/:]|api\\.github\\.com/repos/|raw\\.githubusercontent\\.com/)${escapeRe(full)}(?![\\w.-])`, 'gi');
    for (const m of s.matchAll(re)) hits.push({ kind: 'private-repo-link', index: m.index });
  }
  const seen = new Set();
  return hits
    .map((h) => ({ kind: h.kind, line: lineOf(s, h.index) }))
    .sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind))
    .filter((h) => {
      const k = `${h.kind}:${h.line}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function isClean(text, opts) {
  return scanText(text, opts).length === 0;
}

/** files: [{ name, text }]. Returns { ok, findings: [{ file, kind, line }] }. */
export function scanOutputs(files, opts) {
  const findings = [];
  for (const f of files) for (const h of scanText(f.text, opts)) findings.push({ file: f.name, ...h });
  return { ok: findings.length === 0, findings };
}

/** Plain-language summary of findings, safe to print (no matched values). */
export function describeFindings(findings) {
  return findings.map((f) => `${f.file}: line ${f.line}: ${f.kind}`).join('\n');
}

// Private-repository text is held to a stricter rule before it is even
// considered: no URLs, no environment-variable-like names, nothing the scanner
// would flag. Callers fall back to a neutral line when this returns false.
const ENV_NAME_RE = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9]\b/;
export function isSafePrivateText(text) {
  const s = String(text ?? '');
  if (!s.trim()) return false;
  if (/(?:https?|ftp|wss?):\/\/|www\.|\b[\w-]+\.(?:com|in|org|net|io|dev|app|co|ai)\b/i.test(s)) return false;
  if (ENV_NAME_RE.test(s)) return false;
  return isClean(s);
}
