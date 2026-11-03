// What the README and the portfolio show, decided once. Everything here is a
// pure function of the manifest: no clock, so a week without new evidence
// renders byte-for-byte the same output.

import { CONFIG } from './config.mjs';
import { addDays, compareBy } from './util.mjs';

export function isPublished(e) {
  return e.publication === 'approved';
}

/** Newest meaningful activity date across published entries (the rendering anchor). */
export function activityAnchor(entries) {
  let max = null;
  for (const e of entries) if (isPublished(e) && e.lastMeaningfulActivity && (!max || e.lastMeaningfulActivity > max)) max = e.lastMeaningfulActivity;
  return max;
}

export function windowStartFor(anchor, cfg = CONFIG) {
  return anchor ? addDays(anchor, -cfg.activeWindowDays) : null;
}

/** Entries for "Latest engineering work": newest first, inside the active window. */
export function recentEntries(manifest, cfg = CONFIG, { limit = cfg.latestMaxEntries } = {}) {
  const anchor = activityAnchor(manifest.entries);
  if (!anchor) return [];
  const since = windowStartFor(anchor, cfg);
  return manifest.entries
    .filter((e) => isPublished(e) && e.lastMeaningfulActivity && e.lastMeaningfulActivity >= since)
    .filter((e) => !cfg.latestExcludeCategories.includes(e.category))
    .sort(compareBy('-lastMeaningfulActivity', 'name'))
    .slice(0, limit);
}

/** Public, linkable evidence of an entry, newest first. Private entries have none. */
export function publicEvidence(e, limit = 3) {
  if (e.visibility !== 'public') return [];
  return e.evidence
    .filter((ev) => ev.type !== 'readme' && ev.url && ev.title)
    .sort((a, b) => (a.date === b.date ? (a.ref < b.ref ? -1 : 1) : a.date < b.date ? 1 : -1))
    .slice(0, limit);
}

export function repoLink(e) {
  return e.visibility === 'public' && e.repoUrl ? e.repoUrl : null;
}

/**
 * Technologies in active use: strong evidence (technologyEvidence) from
 * published entries with meaningful activity inside the active window.
 */
export function activeStack(manifest, cfg = CONFIG) {
  const anchor = activityAnchor(manifest.entries);
  if (!anchor) return { anchor: null, since: null, languages: [], frameworks: [] };
  const since = windowStartFor(anchor, cfg);
  const langs = new Map();
  const fws = new Map();
  for (const e of manifest.entries) {
    if (!isPublished(e) || !e.lastMeaningfulActivity || e.lastMeaningfulActivity < since) continue;
    // Course work and case studies are not what I build with today.
    if (cfg.latestExcludeCategories.includes(e.category)) continue;
    for (const [name, v] of Object.entries(e.technologyEvidence ?? {})) {
      const map = v.kind === 'language' ? langs : fws;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(e.id);
    }
  }
  const list = (map) =>
    [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' })).map(([name, ids]) => ({ name, entries: ids.sort() }));
  return { anchor, since, languages: list(langs), frameworks: list(fws) };
}
