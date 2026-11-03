// Evidence items and link verification. An item is stored only if its link
// resolves (HTTP 200) for a signed-out reader. Items already in the manifest
// were verified when they were added and are not re-fetched.

import { checkPublicUrl } from './github.mjs';
import { mapLimit } from './util.mjs';

export const EVIDENCE_TYPES = ['commit', 'pr', 'release', 'repo'];

export function toEvidence(decision) {
  return { type: decision.type, ref: decision.ref, url: decision.url, date: decision.date, title: decision.title };
}

/**
 * items: evidence items to verify. known: Set of refs already stored.
 * Returns { verified, dropped } and throws when a link cannot be checked at all
 * (network trouble), so a run never publishes on half-checked evidence.
 */
export async function verifyEvidence(items, { known = new Set(), check = checkPublicUrl, concurrency = 4 } = {}) {
  const todo = items.filter((i) => !known.has(i.ref));
  const keep = items.filter((i) => known.has(i.ref));
  const results = await mapLimit(todo, concurrency, async (item) => ({ item, res: await check(item.url) }));
  const verified = [...keep];
  const dropped = [];
  for (const { item, res } of results) {
    if (res.ok) verified.push(item);
    else if (res.status === 404 || res.status === 410 || res.status === 451) dropped.push({ item, reason: `link does not resolve for a signed-out reader (HTTP ${res.status})` });
    else throw new Error(`Could not verify ${item.url} (HTTP ${res.status || 'network error'}); nothing was published.`);
  }
  return { verified, dropped };
}
