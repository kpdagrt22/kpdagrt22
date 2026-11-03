// Technology evidence for a public repository. Two kinds only:
//  - languages: GitHub linguist bytes above a share and size threshold;
//  - frameworks: declared in a dependency manifest AND used (imported from
//    source, or wired in through the framework's own config file).
// A dependency that is declared but never used is not evidence.

import { CONFIG, FRAMEWORKS, LANGUAGE_IGNORE, SOURCE_SKIP_RE } from './config.mjs';
import { getLanguages } from './activity.mjs';
import { mapLimit } from './util.mjs';

export function languageEvidence(languages, cfg = CONFIG) {
  const total = Object.values(languages).reduce((a, b) => a + b, 0);
  const out = {};
  if (total === 0) return out;
  const ordered = Object.entries(languages).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [lang, bytes] of ordered) {
    if (LANGUAGE_IGNORE.has(lang)) continue;
    if (bytes >= cfg.languageMinBytes && bytes / total >= cfg.languageMinShare) {
      out[lang] = { kind: 'language', reason: `GitHub linguist: at least ${Math.round(cfg.languageMinShare * 100)}% of the repository's code` };
    }
  }
  return out;
}

const normPy = (name) => name.toLowerCase().replace(/[_.]+/g, '-');

const MANIFEST_RE = /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile)$/;

export function isDependencyManifest(path) {
  return MANIFEST_RE.test(path) && !SOURCE_SKIP_RE.test(path);
}

/** Parse a dependency manifest into { eco, deps:Set }. Never throws on odd input. */
export function parseDependencies(path, text) {
  const base = path.split('/').pop();
  const deps = new Set();
  if (base === 'package.json') {
    try {
      const pkg = JSON.parse(text);
      for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const name of Object.keys(pkg?.[k] ?? {})) deps.add(name);
      }
    } catch {
      /* unreadable package.json: no evidence */
    }
    return { eco: 'npm', deps };
  }
  if (/^requirements.*\.txt$/.test(base)) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, '').trim();
      if (!line || line.startsWith('-')) continue;
      const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line);
      if (m) deps.add(normPy(m[1]));
    }
    return { eco: 'py', deps };
  }
  if (base === 'pyproject.toml') {
    for (const block of text.matchAll(/^\s*[\w-]*dependencies\s*=\s*\[([\s\S]*?)\]/gm)) {
      for (const q of block[1].matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)/g)) deps.add(normPy(q[1]));
    }
    let inPoetry = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('[')) {
        inPoetry = /^\[tool\.poetry\.(group\.[^.\]]+\.)?(dev-)?dependencies\]$/.test(line);
        continue;
      }
      if (inPoetry) {
        const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(line);
        if (m && m[1].toLowerCase() !== 'python') deps.add(normPy(m[1]));
      }
    }
    return { eco: 'py', deps };
  }
  if (base === 'Pipfile') {
    let inPkgs = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('[')) {
        inPkgs = line === '[packages]' || line === '[dev-packages]';
        continue;
      }
      const m = inPkgs && /^"?([A-Za-z0-9][A-Za-z0-9._-]*)"?\s*=/.exec(line);
      if (m) deps.add(normPy(m[1]));
    }
    return { eco: 'py', deps };
  }
  return { eco: 'unknown', deps };
}

const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const under = (dir, p) => dir === '' || p.startsWith(`${dir}/`);

/** Pure: framework candidates from parsed manifests. */
export function frameworkCandidates(manifests) {
  const out = [];
  const seen = new Set();
  for (const m of manifests) {
    const dir = dirOf(m.path);
    for (const fw of FRAMEWORKS) {
      if (fw.eco !== m.eco) continue;
      const dep = fw.eco === 'py' ? normPy(fw.dep) : fw.dep;
      if (!m.deps.has(dep)) continue;
      const key = `${fw.name}\u0000${dir}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ fw, dir, manifestPath: m.path });
    }
  }
  return out;
}

const ENTRY_NAMES = new Set(['layout', 'page', 'app', 'main', 'index', 'server', 'api', 'routes', 'router', '__init__', 'conftest', 'settings', 'models', 'schemas', 'globals', 'global', 'scene', 'canvas', 'client']);

export function fileScore(path, fw) {
  const base = path.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
  const tokens = fw.dep.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  let score = 0;
  if (tokens.some((t) => path.toLowerCase().includes(t))) score -= 4;
  if (ENTRY_NAMES.has(base)) score -= 2;
  if (/(^|\/)(tests?|__tests__|spec)\//.test(path) || /\.(test|spec)\./.test(path)) score += fw.name.match(/test|Playwright|Vitest|Jest|pytest/i) ? -3 : 2;
  return score * 100 + path.split('/').length;
}

/**
 * Pure core of framework confirmation, given the tree and a file reader.
 * readFile(path) -> Promise<string|null>
 */
export async function confirmFrameworks(candidates, treeFiles, readFile, { budget = CONFIG.sourceFilesPerRepo, maxBytes = CONFIG.sourceFileMaxBytes } = {}) {
  const confirmed = new Map();
  const pending = [];
  for (const c of candidates) {
    if (confirmed.has(c.fw.name)) continue;
    const scoped = treeFiles.filter((f) => under(c.dir, f.path) && !SOURCE_SKIP_RE.test(f.path));
    const cfgFile = c.fw.config && scoped.find((f) => c.fw.config.test(f.path));
    if (cfgFile) {
      confirmed.set(c.fw.name, `declared in ${c.manifestPath}; configured in ${cfgFile.path}`);
      continue;
    }
    const extFile = c.fw.ext && scoped.find((f) => c.fw.ext.test(f.path));
    if (extFile) {
      confirmed.set(c.fw.name, `declared in ${c.manifestPath}; used by ${extFile.path}`);
      continue;
    }
    const files = scoped
      .filter((f) => c.fw.files.test(f.path) && (f.size ?? 0) <= maxBytes)
      .sort((a, b) => fileScore(a.path, c.fw) - fileScore(b.path, c.fw) || a.path.localeCompare(b.path));
    pending.push({ ...c, queue: files.map((f) => f.path) });
  }

  const cache = new Map();
  let spent = 0;
  const read = async (path) => {
    if (cache.has(path)) return cache.get(path);
    spent++;
    const text = await readFile(path);
    cache.set(path, text ?? '');
    return text ?? '';
  };
  const open = () => pending.filter((p) => !confirmed.has(p.fw.name) && p.queue.length > 0);
  // Round-robin: every candidate gets a fair share of the file budget.
  while (spent < budget && open().length > 0) {
    for (const p of open()) {
      if (spent >= budget) break;
      const path = p.queue.shift();
      const text = await read(path);
      for (const q of pending) {
        if (confirmed.has(q.fw.name)) continue;
        if (!under(q.dir, path) || !q.fw.files.test(path)) continue;
        if (q.fw.use.test(text)) confirmed.set(q.fw.name, `declared in ${q.manifestPath}; imported in ${path}`);
      }
    }
  }
  return { confirmed, filesRead: spent, unconfirmed: pending.filter((p) => !confirmed.has(p.fw.name)).map((p) => p.fw.name) };
}

export function genericReason(reason) {
  if (/configured in/.test(reason)) return 'declared in a dependency manifest; configured in the repository';
  if (/used by/.test(reason)) return 'declared in a dependency manifest; used by source files';
  return 'declared in a dependency manifest; imported in source';
}

function decodeBlob(blob) {
  if (!blob) return null;
  if (blob.encoding === 'base64') return Buffer.from(blob.content ?? '', 'base64').toString('utf8');
  return blob.content ?? null;
}

/** Fetching wrapper: languages + manifests + sampled source files. */
export async function detectTechnologies(gh, repo, { cfg = CONFIG, languageCache = new Map() } = {}) {
  const evidence = { ...languageEvidence(await getLanguages(gh, repo, languageCache), cfg) };
  const tree = await gh.request('GET', `/repos/${repo.fullName}/git/trees/${encodeURIComponent(repo.defaultBranch)}?recursive=1`, { allow404: true });
  if (tree.status !== 200 || !tree.data?.tree) return { evidence, notes: ['no readable tree'] };
  const files = tree.data.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha, size: e.size ?? 0 }));
  const bySha = new Map(files.map((f) => [f.path, f.sha]));
  const readFile = async (path) => decodeBlob(await gh.get(`/repos/${repo.fullName}/git/blobs/${bySha.get(path)}`));

  const manifestFiles = files
    .filter((f) => isDependencyManifest(f.path))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))
    .slice(0, 12);
  const manifests = (
    await mapLimit(manifestFiles, 4, async (f) => {
      const text = await readFile(f.path);
      return text === null ? null : { path: f.path, ...parseDependencies(f.path, text) };
    })
  ).filter(Boolean);

  const candidates = frameworkCandidates(manifests);
  const { confirmed, filesRead, unconfirmed } = await confirmFrameworks(candidates, files, readFile, {
    budget: cfg.sourceFilesPerRepo,
    maxBytes: cfg.sourceFileMaxBytes,
  });
  for (const [name, reason] of [...confirmed.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Private repositories: never publish file paths, only the kind of proof.
    evidence[name] = { kind: 'framework', reason: repo.private ? genericReason(reason) : reason };
  }
  const notes = [];
  if (tree.data.truncated) notes.push('tree truncated by GitHub; some files not considered');
  if (unconfirmed.length) notes.push(`declared but no use found in ${filesRead} sampled files, so not recorded: ${unconfirmed.join(', ')}`);
  return { evidence, notes };
}
