import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nextLink, retryDelay } from '../github.mjs';
import { autoSummary, neutralSummary } from '../run.mjs';
import { confirmFrameworks, frameworkCandidates, genericReason, languageEvidence, parseDependencies } from '../technologies.mjs';
import { repo } from './helpers.mjs';

test('languages need both a share and a byte threshold; build glue is ignored', () => {
  const ev = languageEvidence({ TypeScript: 90_000, Python: 8_000, Shell: 50_000, CSS: 40_000, Go: 1_000 });
  assert.deepEqual(Object.keys(ev), ['TypeScript', 'Python']);
});

test('dependency manifests parse for npm and Python', () => {
  assert.deepEqual([...parseDependencies('package.json', JSON.stringify({ dependencies: { next: '1' }, devDependencies: { vitest: '1' } })).deps], ['next', 'vitest']);
  assert.deepEqual([...parseDependencies('requirements.txt', 'FastAPI==0.1\n# c\n-r other.txt\npandas>=2\n').deps], ['fastapi', 'pandas']);
  assert.deepEqual([...parseDependencies('pyproject.toml', '[project]\ndependencies = [\n "pydantic>=2",\n "sqlalchemy"\n]\n').deps].sort(), ['pydantic', 'sqlalchemy']);
  assert.deepEqual([...parseDependencies('package.json', '{not json').deps], []);
});

test('a framework counts only when declared AND used; declared-but-unused does not', async () => {
  const manifests = [{ path: 'package.json', eco: 'npm', deps: new Set(['react', 'express', 'zod']) }];
  const candidates = frameworkCandidates(manifests);
  const files = { 'src/App.tsx': "import { useState } from 'react';", 'src/schema.ts': "import { z } from 'zod';", 'src/util.ts': 'export const x = 1;' };
  const tree = Object.keys(files).map((path) => ({ path, size: 100 }));
  const { confirmed, unconfirmed } = await confirmFrameworks(candidates, tree, async (p) => files[p] ?? null);
  assert.deepEqual([...confirmed.keys()].sort(), ['React', 'Zod']);
  assert.deepEqual(unconfirmed, ['Express']);
});

test('private repositories get generic technology reasons (no file paths)', () => {
  assert.equal(genericReason('declared in apps/web/package.json; imported in apps/web/src/secret-client.ts'), 'declared in a dependency manifest; imported in source');
});

test('no description: a neutral line from languages and dates, never a guess', () => {
  assert.equal(neutralSummary({ TypeScript: 90_000, Python: 20_000 }, '2026-06-10T12:00:00Z'), 'TypeScript and Python codebase, created Jun 2026.');
  assert.equal(neutralSummary({}, '2026-10-31T20:00:00Z'), 'Repository created Nov 2026.'); // IST date
  assert.equal(autoSummary(repo({ description: 'Unified portal, see https://internal.example.org', private: true }), { Python: 9_000 }), 'Python codebase, created Jan 2026.');
  assert.equal(autoSummary(repo({ description: 'A planetary trading study', private: true }), {}), 'A planetary trading study');
  assert.equal(autoSummary(repo({ fork: true }), {}), 'Fork with meaningful commits of my own.');
});

test('GitHub client: backoff rules and pagination links', () => {
  const h = (o) => new Map(Object.entries(o));
  assert.equal(retryDelay({ status: 502, headers: h({}), text: '', attempt: 1 }), 2000);
  assert.equal(retryDelay({ status: 429, headers: h({ 'retry-after': '7' }), text: '', attempt: 0 }), 7000);
  assert.equal(retryDelay({ status: 403, headers: h({}), text: 'You have exceeded a secondary rate limit', attempt: 0 }), 60_000);
  assert.equal(retryDelay({ status: 404, headers: h({}), text: '', attempt: 0 }), null);
  assert.equal(retryDelay({ status: 403, headers: h({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1000' }), text: '', attempt: 0, now: 990_000 }), 11_000);
  assert.equal(nextLink('<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"'), 'https://api.github.com/x?page=2');
  assert.equal(nextLink(null), null);
});
