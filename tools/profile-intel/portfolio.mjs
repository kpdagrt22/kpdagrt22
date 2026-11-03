// out/portfolio/recent-work.json, the data thisiskp.in will read from
// src/data/recent-work.json once that side is wired up. Published entries
// only; private repositories never carry a repository link or evidence links.
// Like the README blocks it is a pure function of the manifest, with no
// timestamps, so an unchanged week produces an identical file.

import { CONFIG } from './config.mjs';
import { activeStack, activityAnchor, isPublished, publicEvidence, repoLink } from './selection.mjs';
import { compareBy } from './util.mjs';

export const PORTFOLIO_SCHEMA_VERSION = 1;

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
