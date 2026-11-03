import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { mergeRun, parseManifest, privateRef, serializeManifest, validateManifest } from '../manifest.mjs';
import { manifest, manualEntry, repo, TODAY } from './helpers.mjs';

const decision = (over = {}) => ({
  type: 'commit',
  ref: 'kpdagrt22/demo@' + 'a'.repeat(40),
  url: 'https://github.com/kpdagrt22/demo/commit/' + 'a'.repeat(40),
  date: '2026-11-01T08:00:00Z',
  title: 'feat: add the thing',
  meaningful: true,
  reason: 'feature: 1 files, 45 changed lines',
  category: 'feature',
  ...over,
});

const run = (m, reports, owned = [repo()], today = TODAY) => mergeRun(m, { today, owned, reports });

test('the committed manifest is valid, canonical, and links no private repository', () => {
  // Invariants only: this runs in CI before every weekly run, on whatever main holds.
  const text = readFileSync(new URL('../../../data/projects.manifest.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const m = parseManifest(text);
  assert.equal(serializeManifest(m), text);
  assert.ok(m.entries.filter((e) => e.visibility === 'private').every((e) => e.repoUrl === null));
  assert.ok(m.entries.filter((e) => e.source === 'manual').every((e) => e.readmeSection || e.publication === 'hidden'));
});

test('merging the same evidence twice changes nothing (idempotent)', () => {
  const m0 = manifest([manualEntry()]);
  const r = { repo: repo(), meaningful: [decision()], reverted: [], tech: { evidence: { TypeScript: { kind: 'language', reason: 'linguist' } } } };
  const first = run(m0, [r]);
  const second = run(first.manifest, [r], [repo()], '2026-11-10');
  assert.equal(serializeManifest(second.manifest), serializeManifest(first.manifest));
  assert.deepEqual(second.changes, []);
  assert.equal(first.manifest.entries[0].lastMeaningfulActivity, '2026-11-01');
});

test('a week with no meaningful work changes nothing, not even dates', () => {
  const m0 = manifest([manualEntry({ lastMeaningfulActivity: '2026-10-20', evidence: [] })]);
  const out = run(m0, [{ repo: repo(), meaningful: [], reverted: [] }], [repo()], '2026-11-10');
  assert.equal(serializeManifest(out.manifest), serializeManifest(m0));
  assert.deepEqual(out.changes, []);
});

test('manual text is never rewritten, even when GitHub says otherwise', () => {
  const e = manualEntry();
  const before = JSON.stringify([e.name, e.shortDescription, e.detailedDescription, e.category, e.role, e.status, e.verifiedContributions, e.technologies, e.liveUrl]);
  const out = run(manifest([e]), [
    { repo: repo({ description: 'Something else entirely', homepage: 'https://elsewhere.example.org' }), meaningful: [decision()], reverted: [], summary: 'Something else entirely', liveUrl: 'https://elsewhere.example.org', tech: { evidence: { Go: { kind: 'language', reason: 'x' } } } },
  ]);
  const a = out.manifest.entries[0];
  assert.equal(JSON.stringify([a.name, a.shortDescription, a.detailedDescription, a.category, a.role, a.status, a.verifiedContributions, a.technologies, a.liveUrl]), before);
  assert.deepEqual(Object.keys(a.technologyEvidence), ['Go']); // pipeline-owned field does update
});

test('a new repository with meaningful work becomes an approved auto entry', () => {
  const r = repo({ name: 'quant_tool', fullName: 'kpdagrt22/quant_tool', private: true, description: null });
  const out = run(manifest([]), [{ repo: r, meaningful: [decision({ ref: 'kpdagrt22/quant_tool@' + 'b'.repeat(40) })], reverted: [], summary: 'Python codebase, created Jan 2026.', liveUrl: null, tech: null }], [r]);
  const e = out.manifest.entries[0];
  assert.equal(e.id, 'repo-quant-tool');
  assert.equal(e.source, 'auto');
  assert.equal(e.publication, 'approved');
  assert.equal(e.visibility, 'private');
  assert.equal(e.repoUrl, null);
  assert.equal(e.firstDiscovered, TODAY);
  assert.equal(e.shortDescription, 'Python codebase, created Jan 2026.');
  // private evidence: opaque ref and a date, no link, no title
  assert.deepEqual(e.evidence, [{ type: 'commit', ref: privateRef('kpdagrt22/quant_tool@' + 'b'.repeat(40)), date: '2026-11-01T08:00:00Z' }]);
  assert.deepEqual(out.changes.map((c) => c.kind), ['added', 'evidence']);
  validateManifest(out.manifest);
});

test('hidden entries receive nothing, and can be matched by repoId without naming the repo', () => {
  const hidden = manualEntry({ id: 'secret-thing', repo: null, repoId: 4242, repoUrl: null, visibility: 'private', publication: 'hidden', liveUrl: null });
  const r = repo({ id: 4242, name: 'secret', fullName: 'kpdagrt22/secret', private: true });
  const out = run(manifest([hidden]), [{ repo: r, meaningful: [decision()], reverted: [] }], [r]);
  assert.equal(out.manifest.entries.length, 1);
  assert.deepEqual(out.manifest.entries[0].evidence, []);
  assert.equal(out.manifest.entries[0].repo, null);
});

test('a repository that turns private loses its link and evidence titles', () => {
  const e = manualEntry({ evidence: [{ type: 'commit', ref: 'kpdagrt22/demo@' + 'c'.repeat(40), date: '2026-10-01T09:00:00Z', url: 'https://github.com/kpdagrt22/demo/commit/' + 'c'.repeat(40), title: 'feat: x' }] });
  const out = run(manifest([e]), [], [repo({ private: true })]);
  const a = out.manifest.entries[0];
  assert.equal(a.visibility, 'private');
  assert.equal(a.repoUrl, null);
  assert.equal(a.evidence[0].url, undefined);
  assert.equal(a.evidence[0].title, undefined);
  validateManifest(out.manifest);
});

test('a revert of earlier work takes that evidence back out', () => {
  const ref = 'kpdagrt22/demo@' + 'd'.repeat(40);
  const e = manualEntry({ evidence: [{ type: 'commit', ref, date: '2026-10-01T09:00:00Z', url: 'https://github.com/kpdagrt22/demo/commit/' + 'd'.repeat(40), title: 'feat: x' }] });
  const out = run(manifest([e]), [{ repo: repo(), meaningful: [], reverted: [{ type: 'commit', shaPrefix: 'd'.repeat(10), repo: 'kpdagrt22/demo' }] }]);
  assert.deepEqual(out.manifest.entries[0].evidence, []);
});

test('evidence is capped, newest first, and owner-approved README evidence is always kept', () => {
  const readmeEv = { type: 'readme', ref: 'kpdagrt22/kpdagrt22@' + 'e'.repeat(40) + ':README.md', date: '2026-10-28T14:09:19Z', url: 'https://github.com/kpdagrt22/kpdagrt22/blob/' + 'e'.repeat(40) + '/README.md', title: 'README' };
  const many = Array.from({ length: 20 }, (_, i) =>
    decision({ ref: `kpdagrt22/demo@${String(i).padStart(2, '0')}${'f'.repeat(38)}`, url: `https://github.com/kpdagrt22/demo/commit/${String(i).padStart(2, '0')}${'f'.repeat(38)}`, date: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z` }),
  );
  const out = run(manifest([manualEntry({ evidence: [readmeEv] })]), [{ repo: repo(), meaningful: many, reverted: [] }]);
  const ev = out.manifest.entries[0].evidence;
  assert.equal(ev[0].type, 'readme');
  assert.equal(ev.length, 1 + 12);
  assert.equal(ev[1].date, '2026-10-20T00:00:00Z');
});

test('validation rejects a private entry with a repository link', () => {
  assert.throws(() => validateManifest(manifest([manualEntry({ visibility: 'private' })])), /private entry must not carry a repoUrl/);
});
