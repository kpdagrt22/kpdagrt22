// data/projects.manifest.json: the single source both the profile README and
// thisiskp.in render from. This module validates it, serialises it in a stable
// form, and merges a week's evidence into it.
//
// Ownership rules:
//  - source "manual": every text field (name, descriptions, category, role,
//    status, statusText, verifiedContributions, technologies, liveUrl) is the
//    owner's and is never rewritten. The pipeline only maintains
//    lastMeaningfulActivity, lastPortfolioUpdate, visibility, technologyEvidence
//    and evidence. One privacy exception: if a repository turns private, its
//    repoUrl is cleared and its evidence loses links and titles.
//  - source "auto": created and maintained by the pipeline. Set source to
//    "manual" to freeze an entry's text.
//  - publication "hidden": never rendered or exported, and the pipeline adds
//    nothing to it. Match by repoId to hide a repository without naming it.

import { CONFIG } from './config.mjs';
import { compareBy, istDate, isoSecond, sha256, slugify } from './util.mjs';

export const SCHEMA_VERSION = 1;
export const STATUSES = ['active', 'in-development', 'beta', 'live', 'archived', null];
export const PUBLICATION = ['approved', 'hidden'];
export const SOURCES = ['manual', 'auto'];
export const VISIBILITY = ['public', 'private'];
export const EVIDENCE_TYPES = ['readme', 'commit', 'pr', 'release', 'repo'];

export const ENTRY_KEYS = [
  'id',
  'name',
  'shortDescription',
  'detailedDescription',
  'category',
  'role',
  'status',
  'statusText',
  'verifiedContributions',
  'technologies',
  'repo',
  'repoId',
  'repoUrl',
  'liveUrl',
  'visibility',
  'publication',
  'source',
  'readmeSection',
  'firstDiscovered',
  'lastMeaningfulActivity',
  'lastPortfolioUpdate',
  'technologyEvidence',
  'evidence',
];
const OPTIONAL_KEYS = new Set(['statusText', 'repoId', 'readmeSection']);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const clone = (x) => JSON.parse(JSON.stringify(x));
const lower = (s) => String(s ?? '').toLowerCase();

export function emptyManifest(owner = CONFIG.login) {
  return { schemaVersion: SCHEMA_VERSION, owner, entries: [] };
}

/** Throws one error listing every problem, so a bad hand edit is easy to fix. */
export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') throw new Error('Manifest is not an object');
  if (m.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (!Array.isArray(m.entries)) errors.push('entries must be an array');
  const ids = new Set();
  const repos = new Map();
  for (const [i, e] of (m.entries ?? []).entries()) {
    const at = `entries[${i}]${e?.id ? ` (${e.id})` : ''}`;
    if (!e || typeof e !== 'object') {
      errors.push(`${at}: not an object`);
      continue;
    }
    for (const k of Object.keys(e)) if (!ENTRY_KEYS.includes(k)) errors.push(`${at}: unknown field "${k}"`);
    for (const k of ENTRY_KEYS) if (!OPTIONAL_KEYS.has(k) && !(k in e)) errors.push(`${at}: missing field "${k}"`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(e.id ?? '')) errors.push(`${at}: id must be lowercase letters, digits and hyphens`);
    if (ids.has(e.id)) errors.push(`${at}: duplicate id`);
    ids.add(e.id);
    if (typeof e.name !== 'string' || !e.name.trim()) errors.push(`${at}: name is required`);
    if (!STATUSES.includes(e.status ?? null)) errors.push(`${at}: status must be one of ${STATUSES.map(String).join(', ')}`);
    if (!PUBLICATION.includes(e.publication)) errors.push(`${at}: publication must be approved or hidden`);
    if (!SOURCES.includes(e.source)) errors.push(`${at}: source must be manual or auto`);
    if (e.visibility !== null && !VISIBILITY.includes(e.visibility)) errors.push(`${at}: visibility must be public, private or null`);
    for (const k of ['verifiedContributions', 'technologies', 'evidence']) if (!Array.isArray(e[k])) errors.push(`${at}: ${k} must be an array`);
    if (e.technologyEvidence === null || typeof e.technologyEvidence !== 'object' || Array.isArray(e.technologyEvidence)) {
      errors.push(`${at}: technologyEvidence must be an object`);
    }
    for (const k of ['firstDiscovered', 'lastMeaningfulActivity', 'lastPortfolioUpdate']) {
      if (e[k] !== null && !DATE_RE.test(e[k] ?? '')) errors.push(`${at}: ${k} must be YYYY-MM-DD or null`);
    }
    for (const k of ['repoUrl', 'liveUrl']) if (e[k] !== null && !/^https:\/\//.test(e[k] ?? '')) errors.push(`${at}: ${k} must be an https URL or null`);
    if (e.visibility === 'private' && e.repoUrl) errors.push(`${at}: a private entry must not carry a repoUrl`);
    if (e.repo) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(e.repo)) errors.push(`${at}: repo must be "owner/name"`);
      const key = lower(e.repo);
      if (repos.has(key)) errors.push(`${at}: repo ${e.repo} is already mapped by ${repos.get(key)}`);
      repos.set(key, e.id);
    }
    for (const [j, ev] of (e.evidence ?? []).entries()) {
      if (!EVIDENCE_TYPES.includes(ev?.type)) errors.push(`${at}: evidence[${j}].type is not one of ${EVIDENCE_TYPES.join(', ')}`);
      if (!ev?.ref) errors.push(`${at}: evidence[${j}].ref is required`);
      if (!TIMESTAMP_RE.test(ev?.date ?? '')) errors.push(`${at}: evidence[${j}].date must be a UTC timestamp, YYYY-MM-DDTHH:MM:SSZ`);
      if (e.visibility === 'private' && ev?.type !== 'readme' && (ev?.url || ev?.title)) {
        errors.push(`${at}: evidence[${j}] of a private entry must not carry a url or title`);
      }
    }
  }
  if (errors.length) throw new Error(`Manifest is invalid:\n- ${errors.join('\n- ')}`);
  return m;
}

function canonicalEvidence(ev) {
  const out = { type: ev.type, ref: ev.ref, date: ev.date };
  if (ev.url) out.url = ev.url;
  if (ev.title) out.title = ev.title;
  return out;
}

export function canonicalEntry(e) {
  const out = {};
  for (const k of ENTRY_KEYS) {
    if (OPTIONAL_KEYS.has(k) && (e[k] === undefined || e[k] === null)) continue;
    out[k] = e[k] === undefined ? null : e[k];
  }
  out.technologyEvidence = Object.fromEntries(
    Object.entries(e.technologyEvidence ?? {})
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, v]) => [name, { kind: v.kind, reason: v.reason }]),
  );
  out.evidence = (e.evidence ?? []).map(canonicalEvidence);
  return out;
}

export function serializeManifest(m) {
  return `${JSON.stringify({ schemaVersion: m.schemaVersion, owner: m.owner, entries: m.entries.map(canonicalEntry) }, null, 2)}\n`;
}

export function parseManifest(text) {
  return validateManifest(JSON.parse(text));
}

export function findEntryForRepo(entries, repo) {
  return (
    entries.find((e) => e.repoId != null && repo.id != null && e.repoId === repo.id) ??
    entries.find((e) => e.repo && lower(e.repo) === lower(repo.fullName)) ??
    null
  );
}

/** Evidence item as stored. Private repositories keep only type, date and an opaque ref. */
export function evidenceItem(decision, { isPrivate }) {
  const date = isoSecond(decision.date);
  if (isPrivate) return { type: decision.type, ref: privateRef(decision.ref), date };
  return { type: decision.type, ref: decision.ref, date, url: decision.url, title: decision.title };
}

export function privateRef(ref) {
  return `private:${sha256(String(ref)).slice(0, 16)}`;
}

const byDateDesc = (a, b) => (a.date === b.date ? (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0) : a.date < b.date ? 1 : -1);

function capEvidence(items, max) {
  const readme = items.filter((e) => e.type === 'readme');
  const rest = items.filter((e) => e.type !== 'readme').sort(byDateDesc).slice(0, max);
  return [...readme, ...rest];
}

/**
 * The meaningful decisions that would actually be stored: not already in the
 * entry, and new enough to survive the cap. Older items that would be dropped
 * straight away are not "new", so re-running a window changes nothing.
 * Returns [{ item, decision }], newest first.
 */
export function storableEvidence(entry, decisions, { isPrivate }, cfg = CONFIG) {
  const existing = entry?.evidence ?? [];
  const known = new Set(existing.map((ev) => ev.ref));
  const byRef = new Map();
  for (const d of decisions) {
    const item = evidenceItem(d, { isPrivate });
    if (!known.has(item.ref) && !byRef.has(item.ref)) byRef.set(item.ref, { item, decision: d });
  }
  const next = capEvidence([...existing, ...[...byRef.values()].map((x) => x.item)], cfg.maxEvidencePerEntry);
  return next.filter((ev) => byRef.has(ev.ref)).map((ev) => byRef.get(ev.ref));
}

function canonTech(te) {
  return JSON.stringify(techKeys(te).map((k) => [k, te[k].kind, te[k].reason]));
}

function techKeys(te) {
  return Object.keys(te ?? {}).sort((a, b) => a.localeCompare(b));
}

function categoryFor(repo) {
  if (repo.outside) return 'upstream';
  if (repo.fork) return 'fork';
  return 'project';
}

function autoId(repo, taken) {
  const prefix = repo.outside ? 'upstream' : repo.fork ? 'fork' : 'repo';
  const base = `${prefix}-${slugify(repo.outside ? repo.fullName.replace('/', '-') : repo.name)}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * Merge one run's findings into the manifest. Pure.
 *
 * input:
 *   today:   YYYY-MM-DD (IST), stamped only on what actually changed
 *   owned:   every repository the account owns (slim form), to refresh visibility
 *   reports: [{ repo, meaningful: [decision], reverted: [...], summary, liveUrl, tech }]
 *            repo.outside = true for repositories outside the account
 *            summary = the auto-entry description to use (already privacy-checked)
 *            tech = { evidence } when detection ran for this repo, else null
 * Returns { manifest, changes, newEvidence }.
 */
export function mergeRun(manifest, { today, owned = [], reports = [] }, cfg = CONFIG) {
  const m = clone(manifest);
  const changes = [];
  const note = (entry, kind, detail) => changes.push({ id: entry.id, name: entry.name, kind, detail });
  const ownedByName = new Map(owned.map((r) => [lower(r.fullName), r]));
  const ownedById = new Map(owned.map((r) => [r.id, r]));

  // 1. Visibility and archive state come from GitHub on every run.
  for (const e of m.entries) {
    if (!e.repo && e.repoId == null) continue;
    const info = (e.repoId != null && ownedById.get(e.repoId)) || (e.repo && ownedByName.get(lower(e.repo)));
    if (!info || e.publication === 'hidden') continue;
    const vis = info.private ? 'private' : 'public';
    if (e.visibility !== vis) {
      note(e, 'visibility', `${e.visibility ?? 'unknown'} → ${vis}`);
      e.visibility = vis;
    }
    if (vis === 'private') {
      if (e.repoUrl) {
        e.repoUrl = null;
        note(e, 'privacy', 'repository is private: repository link removed');
      }
      const before = JSON.stringify(e.evidence);
      e.evidence = e.evidence.map((ev) => (ev.type === 'readme' ? ev : { type: ev.type, ref: ev.ref.startsWith('private:') ? ev.ref : privateRef(ev.ref), date: ev.date }));
      if (JSON.stringify(e.evidence) !== before) note(e, 'privacy', 'repository is private: evidence links and titles removed');
    } else if (e.source === 'auto' && !e.repoUrl && info.htmlUrl) {
      e.repoUrl = info.htmlUrl;
    }
    if (e.source === 'auto') {
      const status = info.archived ? 'archived' : e.status === 'archived' ? null : e.status;
      if (status !== e.status) {
        note(e, 'status', `${e.status ?? 'none'} → ${status ?? 'none'}`);
        e.status = status;
      }
    }
  }

  // 2. New evidence, repository by repository, in a stable order.
  const newEvidence = [];
  const taken = new Set(m.entries.map((e) => e.id));
  for (const r of [...reports].sort((a, b) => a.repo.fullName.localeCompare(b.repo.fullName))) {
    const isPrivate = Boolean(r.repo.private);
    let entry = findEntryForRepo(m.entries, r.repo);
    if (entry?.publication === 'hidden') continue;

    // Reverts of changes recorded in an earlier week take that evidence back out.
    if (entry && r.reverted?.length) {
      const before = entry.evidence.length;
      entry.evidence = entry.evidence.filter((ev) => {
        return !r.reverted.some((x) => {
          if (x.type === 'pr') return ev.ref === x.ref || ev.ref === privateRef(x.ref);
          return ev.type === 'commit' && ev.ref.toLowerCase().startsWith(`${lower(x.repo)}@${x.shaPrefix}`);
        });
      });
      if (entry.evidence.length !== before) note(entry, 'reverted', `${before - entry.evidence.length} evidence item(s) removed: reverted`);
    }

    if (!r.meaningful?.length) continue;
    if (!entry) {
      entry = {
        id: autoId(r.repo, taken),
        name: r.repo.outside ? r.repo.fullName : r.repo.name,
        shortDescription: r.summary ?? null,
        detailedDescription: null,
        category: categoryFor(r.repo),
        role: r.repo.outside || r.repo.fork ? 'contributor' : 'repository owner',
        status: r.repo.archived ? 'archived' : null,
        verifiedContributions: [],
        technologies: [],
        repo: r.repo.fullName,
        repoUrl: isPrivate ? null : r.repo.htmlUrl ?? null,
        liveUrl: r.liveUrl ?? null,
        visibility: isPrivate ? 'private' : 'public',
        publication: 'approved',
        source: 'auto',
        firstDiscovered: today,
        lastMeaningfulActivity: null,
        lastPortfolioUpdate: null,
        technologyEvidence: {},
        evidence: [],
      };
      taken.add(entry.id);
      m.entries.push(entry);
      note(entry, 'added', `new ${entry.visibility} ${entry.category} entry`);
    }

    const fresh = storableEvidence(entry, r.meaningful, { isPrivate }, cfg).map((x) => x.item);
    if (fresh.length === 0) {
      // A brand-new entry always has fresh evidence; this only skips known work.
      continue;
    }
    newEvidence.push(...fresh.map((ev) => ({ id: entry.id, ...ev })));
    entry.evidence = capEvidence([...entry.evidence, ...fresh], cfg.maxEvidencePerEntry);
    const latest = istDate(fresh.reduce((a, ev) => (ev.date > a ? ev.date : a), ''));
    if (!entry.lastMeaningfulActivity || latest > entry.lastMeaningfulActivity) {
      entry.lastMeaningfulActivity = latest;
    }
    note(entry, 'evidence', `${fresh.length} new meaningful item(s)`);

    if (r.tech) {
      const before = techKeys(entry.technologyEvidence);
      const after = techKeys(r.tech.evidence);
      if (canonTech(entry.technologyEvidence) !== canonTech(r.tech.evidence)) {
        entry.technologyEvidence = clone(r.tech.evidence);
        const added = after.filter((t) => !before.includes(t));
        const removed = before.filter((t) => !after.includes(t));
        if (added.length || removed.length) {
          note(entry, 'technology', [added.length ? `added ${added.join(', ')}` : '', removed.length ? `removed ${removed.join(', ')}` : ''].filter(Boolean).join('; '));
        }
      }
      if (entry.source === 'auto') entry.technologies = after;
    }
    if (entry.source === 'auto') {
      if (r.summary && r.summary !== entry.shortDescription) entry.shortDescription = r.summary;
      if (r.liveUrl !== undefined && r.liveUrl !== entry.liveUrl && !r.repo.fork && !r.repo.outside) entry.liveUrl = r.liveUrl;
    }
  }

  return { manifest: m, changes, newEvidence };
}

/** Entries that may appear anywhere public. */
export function publishedEntries(m) {
  return m.entries.filter((e) => e.publication === 'approved');
}

/** Stable "most recent first" order. */
export function byRecentActivity(entries) {
  return [...entries].sort(compareBy('-lastMeaningfulActivity', 'name'));
}
