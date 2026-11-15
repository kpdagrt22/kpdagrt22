import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { applyGuards, measureWeekly, parseSources, renderFiguresBlock, serializeFigures, updateFiguresBlock } from '../figures.mjs';

const email = (user) => [user, 'example.com'].join('@');

const previous = {
  schemaVersion: 1,
  source: 'CL15',
  measuredAt: '2026-11-01',
  figures: [
    { id: 'merged-prs', value: 100, display: '100', label: 'merged PRs', cadence: 'weekly', measuredAt: '2026-11-01' },
    { id: 'strikehike-commits', value: 50, display: '50', label: 'StrikeHike commits', cadence: 'weekly', measuredAt: '2026-11-01' },
    { id: 'badabhai-api-tests', value: 10, display: '10', label: 'tests', cadence: 'manual', measuredAt: '2026-11-01' },
    { id: 'some-weekly', value: 100, display: '100', label: 'other', cadence: 'weekly', measuredAt: '2026-11-01' },
  ],
};

test('zero, empty and error values hold the last value', () => {
  const r = applyGuards(previous, { 'merged-prs': 0, 'strikehike-commits': '' }, { today: '2026-11-15' });
  assert.equal(r.figures[0].value, 100);
  assert.equal(r.figures[0].status, 'held');
  assert.equal(r.figures[1].value, 50);
});

test('a drop of more than 25% holds; a smaller rise publishes', () => {
  const drop = applyGuards(previous, { 'some-weekly': 70 }, { today: '2026-11-15' });
  assert.equal(drop.figures[3].value, 100);
  assert.equal(drop.statuses.find((s) => s.id === 'some-weekly').status, 'HELD-DROP');
  const rise = applyGuards(previous, { 'merged-prs': 120 }, { today: '2026-11-15' });
  assert.equal(rise.figures[0].value, 120);
  assert.equal(rise.figures[0].display, '120');
});

test('monotonic counts never go down', () => {
  const r = applyGuards(previous, { 'strikehike-commits': 49 }, { today: '2026-11-15' });
  assert.equal(r.figures[1].value, 50);
  assert.equal(r.statuses.find((s) => s.id === 'strikehike-commits').status, 'HELD-MONOTONIC');
});

test('more than one third held means publish nothing', () => {
  const r = applyGuards(
    { figures: [
      { id: 'merged-prs', value: 100, display: '100', label: 'a', cadence: 'weekly' },
      { id: 'strikehike-commits', value: 50, display: '50', label: 'b', cadence: 'weekly' },
      { id: 'sfc-commits-kp', value: 10, display: '10', label: 'c', cadence: 'weekly' },
    ] },
    { 'merged-prs': 0 },
    { today: '2026-11-15', maxHeldRatio: 1 / 3 },
  );
  assert.equal(r.publish, false);
  assert.equal(r.held, 3);
});

test('UNCONFIGURED figures keep their last value and are ignored by the one-third rule', () => {
  const r = applyGuards(
    { figures: [
      { id: 'merged-prs', value: 100, display: '100', label: 'a', cadence: 'weekly', measuredAt: '2026-11-01' },
      { id: 'badabhai-prs-kp', value: 869, display: '869', label: 'b', cadence: 'weekly', measuredAt: '2026-11-01' },
      { id: 'scheduler-routes-after', value: 692, display: '692', label: 'c', cadence: 'weekly', measuredAt: '2026-11-01' },
    ] },
    { 'merged-prs': 110 },
    { today: '2026-11-15', unconfigured: new Set(['badabhai-prs-kp', 'scheduler-routes-after']) },
  );
  assert.equal(r.publish, true);
  assert.equal(r.configured, 1);
  assert.equal(r.held, 0);
  assert.equal(r.unconfigured, 2);
  assert.equal(r.figures[1].value, 869);
  assert.equal(r.figures[1].status, 'unconfigured');
  const json = JSON.parse(serializeFigures(previous, r, '2026-11-15'));
  assert.equal(json.figures[0].status, undefined);
});

test('README block renders and updates the three headline figures', () => {
  const text = renderFiguresBlock(previous.figures, '15 Nov 2026');
  assert.match(text, /profile-intel:figures:start/);
  assert.match(text, /100/);
  assert.match(text, /profile-intel:figures:end/);
  const updated = updateFiguresBlock(`before\n${text}\nafter`, previous.figures, '16 Nov 2026');
  assert.equal(updated.changed, true);
  assert.match(updated.text, /16 Nov 2026/);
});

function fakeClient(failOn) {
  const logs = [];
  return {
    logs,
    async get(p) {
      if (failOn && p.includes(failOn)) throw Object.assign(new Error(`GET ${p}: 403`), { status: 403 });
      if (p.startsWith('/search/issues')) return { total_count: 1 };
      return {};
    },
    async request(method, p) {
      if (failOn && p.includes(failOn)) throw Object.assign(new Error(`GET ${p}: 403`), { status: 403 });
      return { status: 200, data: [], headers: { get: () => '' } };
    },
    async paginate() {
      return { items: [] };
    },
    async post() {
      throw Object.assign(new Error('POST /graphql failed'), { status: 500 });
    },
  };
}

test('figures.mjs names no private repositories', () => {
  const src = readFileSync(new URL('../figures.mjs', import.meta.url), 'utf8');
  const banned = ['PRIVATE' + '-LIMITED', 'RVM' + 'Beyond', 'Scheduler' + '_Backend', 'Scheduler' + '_frontend', 'Singh' + 'furncraft', 'singh' + 'funcraft', 'team' + '_app'];
  for (const bad of banned) {
    assert.ok(!src.includes(bad), `figures.mjs contains ${bad}`);
  }
  const repos = new Set([...src.matchAll(/kpdagrt22\/[A-Za-z0-9_.-]+/g)].map((m) => m[0]));
  for (const r of repos) assert.ok(['kpdagrt22/thisiskp', 'kpdagrt22/strikehike-monorepo'].includes(r), `unexpected repository path ${r}`);
});

test('tools/ and data/ contain no email literals', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== 'test') walk(p);
      } else files.push(p);
    }
  };
  walk(join(root, 'tools'));
  walk(join(root, 'data'));
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  for (const f of files) assert.ok(!email.test(readFileSync(f, 'utf8')), `${f} contains an email literal`);
});

test('unlinked authors are validated in FIGURES_SOURCES only', () => {
  const good = parseSources(JSON.stringify({ badabhai: 'owner/repo', 'snapshot-copies': [], 'unlinked-authors': [email('author')] }));
  assert.ok(good);
  assert.deepEqual(good['unlinked-authors'], [email('author')]);
  assert.equal(parseSources(JSON.stringify({ badabhai: 'owner/repo', 'snapshot-copies': [], 'unlinked-authors': email('author') })), null);
  assert.equal(parseSources(JSON.stringify({ badabhai: 'owner/repo', 'snapshot-copies': [], 'unlinked-authors': ['not-an-email'] })), null);
});

test('the commits method says when unlinked authors are absent', async () => {
  const old = process.env.FIGURES_SOURCES;
  process.env.FIGURES_SOURCES = JSON.stringify({ badabhai: 'owner/repo', 'snapshot-copies': [] });
  try {
    const r = await measureWeekly(fakeClient(), { today: '2026-11-15', log: () => {} });
    assert.ok(r.notices.some((n) => /Unlinked-author aliases are not configured/.test(n)));
    assert.match(r.methods['commits-12m'], /not configured/);
  } finally {
    if (old === undefined) delete process.env.FIGURES_SOURCES;
    else process.env.FIGURES_SOURCES = old;
  }
});

test('display uses the site grouping', () => {
  const prev = { figures: [{ id: 'some-weekly', value: 1, display: '1', cadence: 'weekly', measuredAt: '2026-11-01' }] };
  const r = applyGuards(prev, { 'some-weekly': 123456 }, { today: '2026-11-15' });
  assert.equal(r.figures[0].display, '123,456');
});

test('a failing request reports the alias, never the path', async () => {
  const old = process.env.FIGURES_SOURCES;
  process.env.FIGURES_SOURCES = JSON.stringify({ badabhai: 'private-org/secret-repo' });
  const logs = [];
  try {
    const r = await measureWeekly(fakeClient('private-org/secret-repo'), { today: '2026-11-15', log: (m) => logs.push(m) });
    const text = [...r.notices, ...logs].join(' ');
    assert.ok(r.unconfigured.has('badabhai-prs-kp'));
    assert.ok(/badabhai/.test(text));
    assert.ok(!text.includes('secret-repo'), 'the path leaked into a notice or log');
  } finally {
    if (old === undefined) delete process.env.FIGURES_SOURCES;
    else process.env.FIGURES_SOURCES = old;
  }
});

test('a missing or unparsable FIGURES_SOURCES leaves organisation figures UNCONFIGURED', async () => {
  const old = process.env.FIGURES_SOURCES;
  try {
    for (const value of [undefined, '{not json']) {
      if (value === undefined) delete process.env.FIGURES_SOURCES;
      else process.env.FIGURES_SOURCES = value;
      assert.equal(parseSources(value), null);
      const r = await measureWeekly(fakeClient(), { today: '2026-11-15', log: () => {} });
      for (const id of ['badabhai-prs-kp', 'job-portal-commits-kp', 'scheduler-routes-after', 'team-rvm-commits-kp', 'sfc-commits-kp', 'commits-12m']) {
        assert.ok(r.unconfigured.has(id), `${id} should be UNCONFIGURED`);
      }
    }
  } finally {
    if (old === undefined) delete process.env.FIGURES_SOURCES;
    else process.env.FIGURES_SOURCES = old;
  }
});
