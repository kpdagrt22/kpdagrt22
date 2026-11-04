// Publishing the portfolio data to thisiskp.in (src/data/recent-work.json in
// kpdagrt22/thisiskp): what the file holds, when its date moves, the checks the
// site's build applies, and the pull request flow. No network.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CONFIG } from '../config.mjs';
import { buildRecentWork, serializeRecentWork, stampUpdated, validateRecentWork } from '../portfolio.mjs';
import { publishTarget } from '../publish.mjs';
import { recentEntries } from '../selection.mjs';
import { parseArgs } from '../run.mjs';
import { scanText } from '../scanner.mjs';
import { fakeGitHub, manifest, manualEntry, TODAY } from './helpers.mjs';

const SITE = 'kpdagrt22/thisiskp';
const PATH = 'src/data/recent-work.json';
const BASE = 'b'.repeat(40);
const HEAD = 'c'.repeat(40);

function privateAuto(over = {}) {
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
    ...over,
  });
}

function sample() {
  return manifest([
    manualEntry({ lastMeaningfulActivity: '2026-11-03', technologyEvidence: { 'Next.js': { kind: 'framework', reason: 'declared and imported' } } }),
    privateAuto(),
    manualEntry({ id: 'course', name: 'Course work', category: 'learning', repoUrl: 'https://github.com/kpdagrt22/course', liveUrl: null, lastMeaningfulActivity: '2026-11-03' }),
    manualEntry({ id: 'cs', name: 'A case study', category: 'case-study', repo: null, repoUrl: null, liveUrl: 'https://thisiskp.in/work/x', lastMeaningfulActivity: '2026-11-01' }),
  ]);
}

const site = (m = sample(), base = null, today = TODAY) => stampUpdated(buildRecentWork(m), base, today);

test('recent lists what the README lists, in the same order (no course work or case studies)', () => {
  const m = sample();
  const json = buildRecentWork(m);
  assert.deepEqual(json.recent, recentEntries(m).map((e) => e.id));
  assert.deepEqual(json.recent, ['demo', 'repo-quant-tool']);
  // Every published item is still exported; only the selection is narrower.
  assert.deepEqual(json.items.map((i) => i.id).sort(), ['course', 'cs', 'demo', 'repo-quant-tool']);
});

test('updated: today for a new file, kept while the content is the same, today again when it changes', () => {
  const first = serializeRecentWork(site(sample(), null, '2026-11-02'));
  assert.equal(JSON.parse(first).updated, '2026-11-02');
  // Same manifest a week later: byte-identical, so publishTarget sees no change and opens no PR.
  assert.equal(serializeRecentWork(site(sample(), first, '2026-11-09')), first);
  // New evidence: the date moves to the run's date.
  const m = sample();
  m.entries[1].lastMeaningfulActivity = '2026-11-08';
  assert.equal(site(m, first, '2026-11-09').updated, '2026-11-09');
  // An unreadable base, or one dated after today, counts as a change.
  assert.equal(site(sample(), '{not json', '2026-11-09').updated, '2026-11-09');
  assert.equal(site(sample(), first.replace('2026-11-02', '2026-12-01'), '2026-11-09').updated, '2026-11-09');
  // The date sits right after schemaVersion, where the site reads it.
  assert.deepEqual(Object.keys(JSON.parse(first)).slice(0, 2), ['schemaVersion', 'updated']);
});

test("the site's schema checks: the built file passes, a private repository link does not", () => {
  const ok = site();
  assert.doesNotThrow(() => validateRecentWork(ok));
  const cases = [
    [(j) => (j.items.find((i) => i.visibility === 'private').repoUrl = 'https://github.com/kpdagrt22/quant_tool'), /private repository must have no repository link/],
    [(j) => j.items.find((i) => i.visibility === 'private').evidence.push({ type: 'pr', title: 't', url: 'https://github.com/x/y/pull/1', date: '2026-11-01' }), /no evidence links/],
    [(j) => (j.items[0].liveUrl = 'http://demo.example.org'), /liveUrl must be an https URL/],
    [(j) => (j.items[0].repoUrl = 'https://gitlab.com/kpdagrt22/demo'), /repoUrl must be a github.com URL/],
    [(j) => (j.updated = '3 Nov 2026'), /updated: not a YYYY-MM-DD date/],
    [(j) => j.recent.push('missing'), /recent: must list ids of items/],
    [(j) => (j.items[1].id = j.items[0].id), /duplicate id/],
    [(j) => (j.items[0].lastMeaningfulActivity = null), /lastMeaningfulActivity is not a date/],
  ];
  for (const [mutate, message] of cases) {
    const j = structuredClone(ok);
    mutate(j);
    assert.throws(() => validateRecentWork(j), message);
  }
});

test('the published file names private repositories without a link and passes the output scanner', () => {
  const text = serializeRecentWork(site());
  const item = JSON.parse(text).items.find((i) => i.id === 'repo-quant-tool');
  assert.equal(item.repoUrl, null);
  assert.deepEqual(item.evidence, []);
  assert.ok(!text.includes('github.com/kpdagrt22/quant_tool'));
  assert.deepEqual(scanText(text, { privateRepos: ['kpdagrt22/quant_tool', SITE] }), []);
});

function siteRoutes({ allow = { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true }, files = [PATH] } = {}) {
  return {
    [`GET /repos/${SITE}/git/commits/${BASE}`]: { tree: { sha: 't'.repeat(40) } },
    [`POST /repos/${SITE}/git/trees`]: { sha: 'u'.repeat(40) },
    [`POST /repos/${SITE}/git/commits`]: { sha: HEAD },
    [`POST /repos/${SITE}/git/refs`]: {},
    [`GET /repos/${SITE}/pulls?state=open*`]: [],
    [`POST /repos/${SITE}/pulls`]: { number: 9, html_url: `https://github.com/${SITE}/pull/9` },
    [`GET /repos/${SITE}/pulls/9/files*`]: files.map((filename) => ({ filename })),
    [`GET /repos/${SITE}/pulls/9`]: { state: 'open', mergeable: true, mergeable_state: 'clean', head: { sha: HEAD } },
    // kpdagrt22/thisiskp allows every merge method (checked 4 Nov 2026), so a merge commit is used.
    [`GET /repos/${SITE}`]: allow,
    [`PUT /repos/${SITE}/pulls/9/merge`]: { merged: true },
    [`DELETE /repos/${SITE}/git/refs/heads/auto/profile-intel`]: null,
  };
}

const portfolioTarget = (content, baseContent) => ({
  repo: SITE,
  owner: 'kpdagrt22',
  baseBranch: 'main',
  baseSha: BASE,
  branch: CONFIG.branch,
  files: [{ path: PATH, content, baseContent }],
  title: 'Recent work data [profile-intel]',
  body: 'body',
  commitMessage: 'chore(profile-intel): refresh recent work data [profile-intel]',
  mergeTitle: 'Merge recent work data [profile-intel]',
});

test('the portfolio target is the file the site reads', () => {
  assert.equal(CONFIG.portfolioRepo, SITE);
  assert.equal(CONFIG.portfolioTargetPath, PATH);
});

test('first publish to thisiskp: one file on auto/profile-intel, a PR, a merge commit, branch deleted; never main', async () => {
  const gh = fakeGitHub(siteRoutes());
  const content = serializeRecentWork(site());
  const res = await publishTarget(gh, portfolioTarget(content, null), { dryRun: false, automerge: true, sleepImpl: async () => {} });
  assert.equal(res.status, 'merged');
  assert.equal(res.mergeMethod, 'merge');
  assert.equal(res.note, undefined);
  assert.deepEqual(res.changedPaths, [PATH]);
  const tree = gh.calls.find((c) => c.method === 'POST' && c.path.endsWith('/git/trees'));
  assert.deepEqual(tree.body.tree.map((t) => t.path), [PATH]);
  assert.equal(tree.body.tree[0].content, content);
  const ref = gh.calls.find((c) => c.method === 'POST' && c.path.endsWith('/git/refs'));
  assert.equal(ref.body.ref, 'refs/heads/auto/profile-intel');
  assert.ok(gh.writes().every((c) => c.path.startsWith(`/repos/${SITE}/`) && !/heads\/main|refs\/main/.test(c.path)));
  const merge = gh.calls.find((c) => c.method === 'PUT');
  assert.deepEqual([merge.body.merge_method, merge.body.sha], ['merge', HEAD]);
});

test('an unchanged week writes nothing to thisiskp (so nothing deploys)', async () => {
  const first = serializeRecentWork(site(sample(), null, '2026-11-02'));
  const again = serializeRecentWork(site(sample(), first, '2026-11-09'));
  const gh = fakeGitHub({});
  const res = await publishTarget(gh, portfolioTarget(again, first), { dryRun: false, automerge: true });
  assert.equal(res.status, 'unchanged');
  assert.deepEqual(gh.calls, []);
});

test('thisiskp kill switch and guards: auto-merge off leaves the PR open; extra files are never merged', async () => {
  const content = serializeRecentWork(site());
  const off = fakeGitHub(siteRoutes());
  const res = await publishTarget(off, portfolioTarget(content, null), { dryRun: false, automerge: false });
  assert.equal(res.status, 'open');
  assert.ok(!off.calls.some((c) => c.method === 'PUT'));

  const extra = fakeGitHub(siteRoutes({ files: [PATH, 'src/pages/projects.astro'] }));
  await assert.rejects(publishTarget(extra, portfolioTarget(content, null), { dryRun: false, automerge: true, sleepImpl: async () => {} }), /expected \[src\/data\/recent-work\.json\]/);
  assert.ok(!extra.calls.some((c) => c.method === 'PUT'));

  // If the site ever disallows merge commits, the method it allows is used and the report says so.
  const squash = fakeGitHub(siteRoutes({ allow: { allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: false } }));
  const s = await publishTarget(squash, portfolioTarget(content, null), { dryRun: false, automerge: true, sleepImpl: async () => {} });
  assert.equal(s.mergeMethod, 'squash');
  assert.match(s.note, /merge commits are not allowed on kpdagrt22\/thisiskp/);
});

test('switches: PORTFOLIO_PUBLISH and the kill switch parse as documented; local bases are dry-run only', () => {
  assert.equal(parseArgs([], {}).portfolioPublish, false);
  assert.equal(parseArgs([], { PORTFOLIO_PUBLISH: 'true' }).portfolioPublish, true);
  assert.equal(parseArgs([], { PORTFOLIO_PUBLISH: 'false' }).portfolioPublish, false);
  assert.equal(parseArgs([], { PROFILE_INTEL_AUTOMERGE: 'false' }).automerge, false);
  assert.equal(parseArgs(['--dry-run', '--portfolio-base-from', 'x.json'], {}).portfolioBaseFrom, 'x.json');
  assert.throws(() => parseArgs(['--portfolio-base-from', 'x.json'], {}), /only allowed with --dry-run/);
});

test('the workflow publishes the portfolio, keeps the kill switch, and its own token stays read-only', () => {
  const yml = readFileSync(new URL('../../../.github/workflows/profile-intel.yml', import.meta.url), 'utf8');
  assert.match(yml, /PORTFOLIO_PUBLISH: 'true'/);
  assert.match(yml, /PROFILE_INTEL_AUTOMERGE: \$\{\{ vars\.PROFILE_INTEL_AUTOMERGE \|\| 'true' \}\}/);
  assert.match(yml, /permissions:\r?\n\s+contents: read/);
});
