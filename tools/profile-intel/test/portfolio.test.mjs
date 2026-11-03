import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRecentWork, serializeRecentWork, stampPortfolioUpdates } from '../portfolio.mjs';
import { renderRecent, renderStack } from '../readme.mjs';
import { scanText } from '../scanner.mjs';
import { manifest, manualEntry, TODAY } from './helpers.mjs';

function privateAuto() {
  return manualEntry({
    id: 'repo-quant-tool',
    name: 'quant_tool',
    source: 'auto',
    category: 'project',
    repo: 'kpdagrt22/quant_tool',
    repoUrl: null,
    liveUrl: null,
    visibility: 'private',
    shortDescription: 'Python codebase, created Jan 2026.',
    lastMeaningfulActivity: '2026-11-02',
    technologyEvidence: { Python: { kind: 'language', reason: 'linguist' } },
    evidence: [{ type: 'commit', ref: 'private:0123456789abcdef', date: '2026-11-02T05:00:00Z' }],
  });
}

test('private repositories are never linked: not in the README, not in recent-work.json', () => {
  // Even a private entry that somehow still carries a repoUrl is not linked.
  const leaky = { ...privateAuto(), repoUrl: 'https://github.com/kpdagrt22/quant_tool' };
  const m = manifest([leaky, manualEntry({ lastMeaningfulActivity: '2026-11-01' })]);
  const json = serializeRecentWork(buildRecentWork(m));
  const md = renderRecent(m) + renderStack(m);
  for (const text of [json, md]) {
    assert.ok(!text.includes('github.com/kpdagrt22/quant_tool'), 'private repo URL leaked');
    assert.deepEqual(scanText(text, { privateRepos: ['kpdagrt22/quant_tool'] }), []);
  }
  const item = JSON.parse(json).items.find((i) => i.id === 'repo-quant-tool');
  assert.equal(item.repoUrl, null);
  assert.deepEqual(item.evidence, []);
  assert.ok(md.includes('private repository'));
});

test('hidden entries and entries without activity are not exported', () => {
  const m = manifest([
    manualEntry({ id: 'hidden-one', publication: 'hidden', lastMeaningfulActivity: '2026-11-02' }),
    manualEntry({ id: 'no-activity', repo: null }),
    privateAuto(),
  ]);
  const ids = buildRecentWork(m).items.map((i) => i.id);
  assert.deepEqual(ids, ['repo-quant-tool']);
  assert.ok(!renderRecent(m).includes('Demo'));
});

test('recent-work.json has no clock in it: same manifest, same bytes', () => {
  const m = manifest([privateAuto()]);
  assert.equal(serializeRecentWork(buildRecentWork(m)), serializeRecentWork(buildRecentWork(JSON.parse(JSON.stringify(m)))));
  assert.ok(!serializeRecentWork(buildRecentWork(m)).includes(TODAY));
});

test('lastPortfolioUpdate moves only when the exported item changes', () => {
  const a = manifest([privateAuto()]);
  const b = JSON.parse(JSON.stringify(a));
  assert.deepEqual(stampPortfolioUpdates(a, b, TODAY), []);
  b.entries[0].lastMeaningfulActivity = '2026-11-05';
  assert.deepEqual(stampPortfolioUpdates(a, b, TODAY), ['repo-quant-tool']);
  assert.equal(b.entries[0].lastPortfolioUpdate, TODAY);
});
