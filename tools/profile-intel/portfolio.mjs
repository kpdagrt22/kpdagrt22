// out/portfolio/recent-work.json, published to src/data/recent-work.json in
// kpdagrt22/thisiskp, where the "Recently built" section on /projects reads it
// (and validates it at build time). Published entries only; private
// repositories never carry a repository link or evidence links.
// buildRecentWork is a pure function of the manifest, like the README blocks.
// The one date that is not, `updated`, works like the README's updated block:
// it is kept from the published file while the content is the same, so an
// unchanged week produces an identical file and no pull request.

import { CONFIG } from './config.mjs';
import { activeStack, activityAnchor, isPublished, publicEvidence, recentEntries, repoLink } from './selection.mjs';
import { compareBy } from './util.mjs';

export const PORTFOLIO_SCHEMA_VERSION = 1;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The part of an entry the portfolio shows. Null when the entry is not exported. */
export function portfolioItem(e) {
  if (!isPublished(e) || !e.lastMeaningfulActivity) return null;
  return {
    id: e.id,
    name: e.name,
    category: e.category,
    role: e.role ?? null,
    status: e.status ?? null,
    statusText: e.statusText ?? null,
    summary: e.shortDescription ?? null,
    summaryFormat: e.source === 'manual' ? 'markdown' : 'text',
    technologies: [...(e.technologies ?? [])],
    technologiesInUse: Object.keys(e.technologyEvidence ?? {}).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
    visibility: e.visibility ?? null,
    liveUrl: e.liveUrl ?? null,
    repoUrl: repoLink(e),
    lastMeaningfulActivity: e.lastMeaningfulActivity,
    evidence: publicEvidence(e, 5).map((ev) => ({ type: ev.type, title: ev.title, url: ev.url, date: ev.date })),
  };
}

export function buildRecentWork(manifest, cfg = CONFIG) {
  const items = manifest.entries
    .map((e) => ({ e, item: portfolioItem(e) }))
    .filter((x) => x.item)
    .sort((a, b) => compareBy('-lastMeaningfulActivity', 'name')(a.e, b.e))
    .map((x) => x.item);
  const stack = activeStack(manifest, cfg);
  return {
    schemaVersion: PORTFOLIO_SCHEMA_VERSION,
    source: `${cfg.profileRepo}/${cfg.manifestPath}`,
    latestActivity: activityAnchor(manifest.entries),
    activeWindowDays: cfg.activeWindowDays,
    // The same selection as the README's "Latest engineering work" (newest
    // first, inside the active window, no course work or case studies), so the
    // profile and the site never disagree about what was recently built.
    recent: recentEntries(manifest, cfg).map((e) => e.id),
    items,
    activeStack: {
      languages: stack.languages.map((t) => t.name),
      frameworks: stack.frameworks.map((t) => t.name),
    },
  };
}

export function serializeRecentWork(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/**
 * Add `updated`: the date (IST) the list last changed. When the file already
 * published on the site has the same content, its date is kept; otherwise it
 * is today. A missing or unreadable base counts as a change.
 */
export function stampUpdated(core, baseText, today) {
  if (!YMD.test(today ?? '')) throw new Error(`Invalid date: ${today}`);
  let base = null;
  try {
    base = baseText ? JSON.parse(baseText) : null;
  } catch {
    base = null;
  }
  let updated = today;
  if (base && typeof base === 'object' && YMD.test(base.updated ?? '') && base.updated <= today) {
    const { updated: _kept, ...rest } = base;
    if (serializeRecentWork(rest) === serializeRecentWork(core)) updated = base.updated;
  }
  const { schemaVersion, ...rest } = core;
  return { schemaVersion, updated, ...rest };
}

/**
 * The checks thisiskp.in's build applies to src/data/recent-work.json (its Zod
 * schema in src/data/recent-work.ts), run here first so the pipeline never
 * opens a pull request the site's build would reject. Throws with every problem.
 */
export function validateRecentWork(obj) {
  const problems = [];
  const bad = (where, what) => problems.push(`${where}: ${what}`);
  const isDate = (v) => typeof v === 'string' && YMD.test(v);
  const isHttps = (v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  };
  const strings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.trim() !== '');
  if (!obj || typeof obj !== 'object') throw new Error('recent-work.json: not an object');
  if (obj.schemaVersion !== PORTFOLIO_SCHEMA_VERSION) bad('schemaVersion', `expected ${PORTFOLIO_SCHEMA_VERSION}`);
  if (!isDate(obj.updated)) bad('updated', 'not a YYYY-MM-DD date');
  if (obj.latestActivity !== null && !isDate(obj.latestActivity)) bad('latestActivity', 'not a date or null');
  if (!Array.isArray(obj.items)) bad('items', 'not an array');
  const ids = new Set();
  for (const [i, it] of (Array.isArray(obj.items) ? obj.items : []).entries()) {
    const at = `items[${i}]${it?.id ? ` (${it.id})` : ''}`;
    if (typeof it?.id !== 'string' || !it.id) bad(at, 'id missing');
    else if (ids.has(it.id)) bad(at, 'duplicate id');
    else ids.add(it.id);
    if (typeof it?.name !== 'string' || !it.name.trim()) bad(at, 'name missing');
    if (typeof it?.category !== 'string' || !it.category) bad(at, 'category missing');
    if (it?.visibility !== 'public' && it?.visibility !== 'private') bad(at, 'visibility must be public or private');
    if (it?.summary !== null && typeof it?.summary !== 'string') bad(at, 'summary must be text or null');
    if (it?.summaryFormat !== 'markdown' && it?.summaryFormat !== 'text') bad(at, 'summaryFormat must be markdown or text');
    if (!strings(it?.technologies) || !strings(it?.technologiesInUse)) bad(at, 'technologies must be lists of names');
    if (!isDate(it?.lastMeaningfulActivity)) bad(at, 'lastMeaningfulActivity is not a date');
    if (it?.liveUrl !== null && !isHttps(it?.liveUrl)) bad(at, 'liveUrl must be an https URL or null');
    if (it?.repoUrl !== null && !(isHttps(it?.repoUrl) && new URL(it.repoUrl).hostname === 'github.com')) bad(at, 'repoUrl must be a github.com URL or null');
    if (!Array.isArray(it?.evidence) || !it.evidence.every((ev) => isHttps(ev?.url) && typeof ev?.title === 'string' && isDate(String(ev?.date ?? '').slice(0, 10)))) {
      bad(at, 'evidence must be a list of { title, https url, date }');
    }
    if (it?.visibility === 'private' && (it.repoUrl !== null || (Array.isArray(it.evidence) && it.evidence.length))) {
      bad(at, 'a private repository must have no repository link and no evidence links');
    }
  }
  if (!Array.isArray(obj.recent) || !obj.recent.every((id) => ids.has(id))) bad('recent', 'must list ids of items');
  else if (new Set(obj.recent).size !== obj.recent.length) bad('recent', 'lists an id twice');
  if (problems.length) throw new Error(`recent-work.json would fail the site's schema: ${problems.join('; ')}`);
  return obj;
}

/**
 * Stamp lastPortfolioUpdate = today on entries whose exported item changed
 * between the old and the new manifest. Returns the ids that changed.
 */
export function stampPortfolioUpdates(oldManifest, newManifest, today) {
  const before = new Map(oldManifest.entries.map((e) => [e.id, JSON.stringify(portfolioItem(e))]));
  const changed = [];
  for (const e of newManifest.entries) {
    const now = JSON.stringify(portfolioItem(e));
    if (now === 'null') continue;
    if (before.get(e.id) !== now) {
      e.lastPortfolioUpdate = today;
      changed.push(e.id);
    }
  }
  return changed;
}
