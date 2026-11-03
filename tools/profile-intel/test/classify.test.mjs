import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyCommit, classifyPullRequest, classifyRepoActivity, isBot, isWhitespaceOnlyPatch, reasonKey } from '../classify.mjs';
import { commit, pr, repo, sha } from './helpers.mjs';

test('a real feature commit is meaningful, with its reason', () => {
  const d = classifyCommit(commit());
  assert.equal(d.meaningful, true);
  assert.match(d.reason, /^feature: 1 files, 45 changed lines$/);
});

test('bots never count: [bot] suffix, dependabot, renovate', () => {
  assert.equal(isBot({ login: 'dependabot[bot]' }), true);
  assert.equal(isBot({ login: 'renovate' }), true);
  assert.equal(isBot({ name: 'renovate[bot]' }), true);
  assert.equal(isBot({ login: 'kpdagrt22' }), false);
  const d = classifyCommit(commit({ authorLogin: 'github-actions[bot]' }));
  assert.equal(d.meaningful, false);
  assert.match(d.reason, /^bot author/);
  const p = classifyPullRequest(pr({ authorLogin: 'dependabot[bot]', title: 'Bump next from 15.0.0 to 15.0.1' }));
  assert.equal(p.meaningful, false);
});

test('dependency bumps by a human are still noise', () => {
  assert.equal(classifyCommit(commit({ message: 'chore(deps): bump zod to 3.24' })).meaningful, false);
  assert.equal(classifyPullRequest(pr({ title: 'Bump vite from 6.0.1 to 6.0.2' })).meaningful, false);
});

test('merge-only commits are noise', () => {
  const d = classifyCommit(commit({ parents: 2, message: 'Merge pull request #3 from kpdagrt22/x' }));
  assert.equal(d.meaningful, false);
  assert.match(d.reason, /^merge commit/);
});

test('formatting, typo and lint-only changes are noise', () => {
  for (const message of ['style: run prettier', 'fix typo in header', 'chore: fix lint errors', 'Fix spelling in docs page', 'chore: trim trailing whitespace']) {
    const d = classifyCommit(commit({ message, files: [{ filename: 'src/a.ts', status: 'modified', additions: 4, deletions: 4 }] }));
    assert.equal(d.meaningful, false, message);
  }
  // A whitespace-only diff is noise whatever the message says.
  const ws = classifyCommit(commit({ message: 'feat: tidy', files: [{ filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-const a = 1;\n+const a =  1;' }] }));
  assert.equal(ws.meaningful, false);
  assert.match(ws.reason, /whitespace-only/);
  assert.equal(isWhitespaceOnlyPatch('@@\n-a b\n+a  b'), true);
  assert.equal(isWhitespaceOnlyPatch('@@\n-a\n+b'), false);
  // A real feature that mentions whitespace in passing is not noise.
  assert.equal(classifyCommit(commit({ message: 'feat: normalise whitespace in imported CSV headers' })).meaningful, true);
});

test('lockfile-only and generated-only changes are noise', () => {
  const lock = classifyCommit(commit({ message: 'feat: update', files: [{ filename: 'package-lock.json', status: 'modified', additions: 900, deletions: 300 }] }));
  assert.equal(lock.meaningful, false);
  assert.match(lock.reason, /lockfile-only/);
  const gen = classifyCommit(commit({ message: 'feat: build', files: [{ filename: 'dist/app.min.js', status: 'modified', additions: 900, deletions: 0 }, { filename: 'pnpm-lock.yaml', status: 'modified', additions: 3, deletions: 1 }] }));
  assert.equal(gen.meaningful, false);
  assert.match(gen.reason, /generated/);
});

test('docs-only changes count only when substantial', () => {
  const small = classifyCommit(commit({ message: 'docs: readme', files: [{ filename: 'README.md', status: 'modified', additions: 20, deletions: 3 }] }));
  assert.equal(small.meaningful, false);
  assert.match(small.reason, /docs-only change \(23 lines, under the 300-line threshold\)/);
  const big = classifyCommit(commit({ message: 'docs: architecture guide', files: [{ filename: 'docs/architecture.md', status: 'added', additions: 420, deletions: 0 }] }));
  assert.equal(big.meaningful, true);
  assert.match(big.reason, /substantial documentation/);
  // requirements.txt is a dependency file, not docs
  const req = classifyCommit(commit({ message: 'feat: add fastapi', files: [{ filename: 'requirements.txt', status: 'modified', additions: 3, deletions: 0 }] }));
  assert.equal(req.meaningful, true);
});

test("the pipeline's own commits and pull requests never count", () => {
  assert.equal(classifyCommit(commit({ message: 'chore(profile-intel): weekly profile update [profile-intel]' })).meaningful, false);
  assert.equal(classifyPullRequest(pr({ headRef: 'auto/profile-intel', title: 'Weekly profile update' })).meaningful, false);
});

test('revert pairs cancel out: pull requests', () => {
  const r = repo();
  const out = classifyRepoActivity({
    repo: r,
    prs: [pr({ number: 7 }), pr({ number: 8, title: 'Revert "feat: add the thing"', body: 'Reverts kpdagrt22/demo#7', htmlUrl: 'https://github.com/kpdagrt22/demo/pull/8' })],
  });
  assert.equal(out.meaningful.length, 0);
  const reasons = out.decisions.map((d) => d.reason).sort();
  assert.deepEqual(reasons, ['revert of #7 (revert pair)', 'reverted by #8 (revert pair)']);
});

test('revert pairs cancel out: commits; a revert of older work is reported for removal', () => {
  const r = repo();
  const original = commit({ sha: sha('aaaa1111'), message: 'feat: risky change' });
  const revert = commit({ sha: sha('bbbb2222'), message: `Revert "feat: risky change"\n\nThis reverts commit ${original.sha}.` });
  const out = classifyRepoActivity({ repo: r, commits: [original, revert] });
  assert.equal(out.meaningful.length, 0);
  const older = classifyRepoActivity({ repo: r, commits: [commit({ sha: sha('cccc3333'), message: 'Revert "feat: x"\n\nThis reverts commit dddd4444dddd4444.' })] });
  assert.equal(older.meaningful.length, 0);
  assert.deepEqual(older.reverted, [{ type: 'commit', shaPrefix: 'dddd4444dddd4444', repo: 'kpdagrt22/demo' }]);
});

test('commits inside a merged pull request are counted once, through the PR', () => {
  const r = repo();
  const c = commit({ sha: sha('eeee5555') });
  const p = pr({ commits: [{ sha: c.sha, message: c.message, authorDate: c.authorDate }] });
  const out = classifyRepoActivity({ repo: r, commits: [c], prs: [p] });
  assert.equal(out.meaningful.length, 1);
  assert.equal(out.meaningful[0].type, 'pr');
  assert.match(out.decisions.find((d) => d.type === 'commit').reason, /part of pull request #7/);
});

test('every decision records a reason, and reasons reduce to stable keys', () => {
  const out = classifyRepoActivity({ repo: repo(), commits: [commit(), commit({ parents: 2 })], prs: [pr()] });
  for (const d of out.decisions) assert.ok(d.reason && typeof d.reason === 'string');
  assert.equal(reasonKey('docs-only change (12 lines, under the 300-line threshold)'), 'docs-only change');
  assert.equal(reasonKey('part of pull request #12, which is counted instead'), 'part of a pull request, which is counted instead');
  assert.equal(reasonKey('feature: 3 files, 40 changed lines'), 'feature');
});
