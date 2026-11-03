import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectActivity } from '../activity.mjs';
import { CONFIG } from '../config.mjs';
import { planDiscovery } from '../discover.mjs';
import { fakeGitHub, repo } from './helpers.mjs';

const SINCE = '2026-10-04T00:00:00Z';

test('company pull requests are counted, never fetched; a new repo with no commits by the login is not my work', async () => {
  const fresh = repo({ name: 'agent-made', fullName: 'kpdagrt22/agent-made', private: true, createdAt: '2026-10-31T09:00:00Z' });
  const gh = fakeGitHub({
    'GET /search/issues*': {
      total_count: 1,
      incomplete_results: false,
      items: [
        {
          repository_url: 'https://api.github.com/repos/RVM-BEYOND-PRIVATE-LIMITED/badabhai-platform',
          number: 2510,
          title: 'fix(payer-auth): bridge SOME_SETTING to staging',
          pull_request: { merged_at: '2026-11-02T10:00:00Z' },
          html_url: 'https://github.com/RVM-BEYOND-PRIVATE-LIMITED/badabhai-platform/pull/2510',
          user: { login: 'kpdagrt22' },
        },
      ],
    },
    'GET /repos/kpdagrt22/agent-made/commits*': [],
    'GET /repos/kpdagrt22/agent-made/releases*': [],
    'GET /repos/kpdagrt22/agent-made/languages': { TypeScript: 50_000 },
  });
  const out = await collectActivity(gh, { login: 'kpdagrt22', candidates: [fresh], sinceIso: SINCE, sinceDate: '2026-10-04', cfg: CONFIG });
  assert.equal(out.companyPrs, 1);
  assert.deepEqual(out.outsideRepos, []);
  assert.ok(!gh.calls.some((c) => c.path.includes('RVM-BEYOND-PRIVATE-LIMITED')), 'a company repository was read');
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].newRepo.meaningful, false);
  assert.match(out.results[0].newRepo.reason, /none of its commits in the window are authored by kpdagrt22/);
});

test('discovery skips archived, excluded and quiet repositories, with reasons', () => {
  const repos = [
    repo({ id: 1, name: 'kpdagrt22', fullName: 'kpdagrt22/kpdagrt22' }),
    repo({ id: 2, name: 'old', fullName: 'kpdagrt22/old', pushedAt: '2026-01-01T00:00:00Z' }),
    repo({ id: 3, name: 'arch', fullName: 'kpdagrt22/arch', archived: true }),
    repo({ id: 4, name: 'snap', fullName: 'kpdagrt22/snap' }),
    repo({ id: 5, name: 'live', fullName: 'kpdagrt22/live' }),
    repo({ id: 6, name: 'theirs', fullName: 'someone/theirs' }),
  ];
  const plan = planDiscovery(repos, { login: 'kpdagrt22', sinceIso: SINCE, exclude: ['kpdagrt22/kpdagrt22'], excludeIds: [4] });
  assert.deepEqual(plan.candidates.map((r) => r.name), ['live']);
  assert.equal(plan.owned.length, 5);
  assert.deepEqual(plan.skipped.map((s) => s.reason).sort(), [
    'archived',
    'excluded: snapshot copy of a company repository (see config.mjs)',
    'excluded: the profile repository itself (the pipeline writes here)',
    'no push since the window started',
  ]);
});
