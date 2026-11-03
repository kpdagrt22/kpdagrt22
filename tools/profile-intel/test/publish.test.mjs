import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeRun, serializeManifest } from '../manifest.mjs';
import { buildRecentWork, serializeRecentWork, stampPortfolioUpdates } from '../portfolio.mjs';
import { assertSafeBranch, mergeMethods, publishTarget } from '../publish.mjs';
import { renderRecent, renderStack, updateReadme } from '../readme.mjs';
import { fakeGitHub, manifest, manualEntry, README, repo, TODAY } from './helpers.mjs';

const REPO = 'kpdagrt22/kpdagrt22';
const BASE = 'b'.repeat(40);
const target = (files) => ({
  repo: REPO,
  owner: 'kpdagrt22',
  baseBranch: 'main',
  baseSha: BASE,
  branch: 'auto/profile-intel',
  files,
  title: 'Weekly profile update [profile-intel]',
  body: 'body',
  commitMessage: 'chore(profile-intel): update [profile-intel]',
  mergeTitle: 'Merge [profile-intel]',
});

/** Run the whole pure pipeline (merge -> render) the way run.mjs does. */
function weeklyOutputs(baseManifest, baseReadme, reports, today) {
  const { manifest: merged } = mergeRun(baseManifest, { today, owned: [repo()], reports });
  stampPortfolioUpdates(baseManifest, merged, today);
  const readme = updateReadme(baseReadme, { recent: renderRecent(merged), stack: renderStack(merged), today });
  return { manifestText: serializeManifest(merged), readmeText: readme.text, recentWork: serializeRecentWork(buildRecentWork(merged)), merged };
}

const evidence = {
  type: 'pr',
  ref: 'kpdagrt22/demo#7',
  url: 'https://github.com/kpdagrt22/demo/pull/7',
  date: '2026-11-01T08:00:00Z',
  title: 'feat: add the thing',
  meaningful: true,
  reason: 'feature',
  category: 'feature',
};

test('a week with no meaningful new work opens no pull request (and makes no API writes)', async () => {
  // Week 1 produced and merged these outputs; week 2 sees nothing new.
  const base = manifest([manualEntry()]);
  const week1 = weeklyOutputs(base, README, [{ repo: repo(), meaningful: [evidence], reverted: [] }], TODAY);
  const week2 = weeklyOutputs(week1.merged, week1.readmeText, [{ repo: repo(), meaningful: [evidence], reverted: [] }], '2026-11-10');
  assert.equal(week2.manifestText, week1.manifestText);
  assert.equal(week2.readmeText, week1.readmeText);
  assert.equal(week2.recentWork, week1.recentWork);

  const gh = fakeGitHub({});
  const res = await publishTarget(
    gh,
    target([
      { path: 'README.md', content: week2.readmeText, baseContent: week1.readmeText },
      { path: 'data/projects.manifest.json', content: week2.manifestText, baseContent: week1.manifestText },
    ]),
    { dryRun: false, automerge: true },
  );
  assert.equal(res.status, 'unchanged');
  assert.deepEqual(gh.calls, []);
});

test('dry run never writes', async () => {
  const gh = fakeGitHub({});
  const res = await publishTarget(gh, target([{ path: 'README.md', content: 'new', baseContent: 'old' }]), { dryRun: true });
  assert.equal(res.status, 'dry-run');
  assert.deepEqual(gh.calls, []);
});

function happyRoutes({ openPr = null, mergeable = 'clean', allowMerge = true } = {}) {
  const C = 'c'.repeat(40);
  return {
    [`GET /repos/${REPO}/git/commits/${BASE}`]: { tree: { sha: 't'.repeat(40) } },
    [`POST /repos/${REPO}/git/trees`]: { sha: 'u'.repeat(40) },
    [`POST /repos/${REPO}/git/commits`]: { sha: C },
    [`GET /repos/${REPO}/git/ref/heads/auto/profile-intel`]: { object: { sha: 'old' } },
    [`PATCH /repos/${REPO}/git/refs/heads/auto/profile-intel`]: {},
    [`GET /repos/${REPO}/pulls?state=open*`]: openPr ? [openPr] : [],
    [`PATCH /repos/${REPO}/pulls/5`]: { number: 5, html_url: `https://github.com/${REPO}/pull/5` },
    [`POST /repos/${REPO}/pulls`]: { number: 6, html_url: `https://github.com/${REPO}/pull/6` },
    [`GET /repos/${REPO}/pulls/5/files*`]: [{ filename: 'README.md' }],
    [`GET /repos/${REPO}/pulls/6/files*`]: [{ filename: 'README.md' }],
    [`GET /repos/${REPO}/pulls/5`]: { state: 'open', mergeable: mergeable !== 'dirty', mergeable_state: mergeable, head: { sha: C } },
    [`GET /repos/${REPO}/pulls/6`]: { state: 'open', mergeable: mergeable !== 'dirty', mergeable_state: mergeable, head: { sha: C } },
    [`GET /repos/${REPO}`]: { allow_merge_commit: allowMerge, allow_squash_merge: false, allow_rebase_merge: true },
    [`PUT /repos/${REPO}/pulls/5/merge`]: { merged: true },
    [`PUT /repos/${REPO}/pulls/6/merge`]: { merged: true },
    [`DELETE /repos/${REPO}/git/refs/heads/auto/profile-intel`]: null,
  };
}

test('an existing open pull request is updated, not duplicated, then merged and its branch deleted', async () => {
  const gh = fakeGitHub(happyRoutes({ openPr: { number: 5 } }));
  const res = await publishTarget(gh, target([{ path: 'README.md', content: 'new', baseContent: 'old' }]), { dryRun: false, automerge: true, sleepImpl: async () => {} });
  assert.equal(res.status, 'merged');
  assert.equal(res.pr.number, 5);
  assert.equal(res.mergeMethod, 'merge');
  const writes = gh.writes().map((c) => `${c.method} ${c.path}`);
  assert.ok(!writes.includes(`POST /repos/${REPO}/pulls`), 'opened a second PR');
  assert.ok(writes.includes(`PATCH /repos/${REPO}/pulls/5`));
  assert.ok(writes.includes(`DELETE /repos/${REPO}/git/refs/heads/auto/profile-intel`));
  // Never a write to main
  assert.ok(gh.writes().every((c) => !/heads\/main|refs\/main/.test(c.path)));
  const merge = gh.calls.find((c) => c.method === 'PUT');
  assert.equal(merge.body.merge_method, 'merge');
  assert.equal(merge.body.sha, 'c'.repeat(40));
});

test('when merge commits are disabled, it uses the method the repository allows and says so', async () => {
  const gh = fakeGitHub(happyRoutes({ allowMerge: false }));
  const res = await publishTarget(gh, target([{ path: 'README.md', content: 'new', baseContent: 'old' }]), { dryRun: false, automerge: true, sleepImpl: async () => {} });
  assert.equal(res.status, 'merged');
  assert.equal(res.mergeMethod, 'rebase');
  assert.match(res.note, /merge commits are not allowed/);
  assert.deepEqual(mergeMethods({ allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true }), ['merge', 'squash', 'rebase']);
});

test('kill switch: auto-merge off leaves the pull request open', async () => {
  const gh = fakeGitHub(happyRoutes());
  const res = await publishTarget(gh, target([{ path: 'README.md', content: 'new', baseContent: 'old' }]), { dryRun: false, automerge: false });
  assert.equal(res.status, 'open');
  assert.ok(!gh.calls.some((c) => c.method === 'PUT'));
});

test('a pull request GitHub does not report clean is left open', async () => {
  const gh = fakeGitHub(happyRoutes({ mergeable: 'dirty' }));
  const res = await publishTarget(gh, target([{ path: 'README.md', content: 'new', baseContent: 'old' }]), { dryRun: false, automerge: true, sleepImpl: async () => {} });
  assert.equal(res.status, 'open');
  assert.match(res.note, /dirty/);
  assert.ok(!gh.calls.some((c) => c.method === 'PUT'));
});

test('a pull request that touches unexpected files is not merged', async () => {
  const routes = happyRoutes();
  routes[`GET /repos/${REPO}/pulls/6/files*`] = [{ filename: 'README.md' }, { filename: '.github/workflows/x.yml' }];
  const gh = fakeGitHub(routes);
  await assert.rejects(
    publishTarget(gh, target([{ path: 'README.md', content: 'new', baseContent: 'old' }]), { dryRun: false, automerge: true, sleepImpl: async () => {} }),
    /expected \[README.md\]/,
  );
  assert.ok(!gh.calls.some((c) => c.method === 'PUT'));
});

test('the pipeline refuses to write anywhere but an auto/* branch', () => {
  assert.throws(() => assertSafeBranch('main', 'main'), /never to main/);
  assert.throws(() => assertSafeBranch('feature/x', 'main'), /auto\/\*/);
  assert.doesNotThrow(() => assertSafeBranch('auto/profile-intel', 'main'));
});
