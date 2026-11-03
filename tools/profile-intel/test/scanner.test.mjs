import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isNonPublicHost, isSafePrivateText, scanOutputs, scanText } from '../scanner.mjs';

const kinds = (text, opts) => scanText(text, opts).map((f) => f.kind);

// Fake credentials are assembled at runtime so this file never contains a
// string that looks like a real one.
const rnd = (n, alphabet = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789') => Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join('');

test('catches GitHub tokens (classic and fine-grained)', () => {
  assert.deepEqual(kinds(`token ${'ghp'}_${rnd(36)}`), ['github-token']);
  assert.deepEqual(kinds(`${'github'}_pat_${rnd(22)}_${rnd(59)}`), ['github-token']);
});

test('catches sk- keys, AWS keys, Slack tokens, Google keys, JWTs and private keys', () => {
  assert.ok(kinds(`${'sk'}-${rnd(40)}`).includes('api-key'));
  assert.ok(kinds(`${'sk'}-ant-${rnd(40)}`).includes('api-key'));
  assert.deepEqual(kinds(`aws ${'AK'}IA${rnd(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')}`), ['aws-key']);
  assert.ok(kinds(`${'xo'}xb-${rnd(12, '0123456789')}-${rnd(24)}`).includes('slack-token'));
  assert.ok(kinds(`${'AI'}za${rnd(35)}`).includes('api-key'));
  assert.ok(kinds(`${'ey'}J${rnd(20)}.${'ey'}J${rnd(20)}.${rnd(20)}`).includes('jwt'));
  assert.deepEqual(kinds(`-----BEGIN ${'RSA'} PRIVATE KEY-----\nMIIE`), ['private-key']);
  assert.deepEqual(kinds(`-----BEGIN ${'OPENSSH'} PRIVATE KEY-----`), ['private-key']);
});

test('catches long hex and high-entropy base64 strings', () => {
  assert.deepEqual(kinds(`secret=${'9f'.repeat(20)}ab`), ['long-hex']);
  assert.deepEqual(kinds(`value ${'a1b2c3d4'.repeat(4)}`), ['long-hex']);
  assert.ok(kinds(`blob ${'Zm9vYmFyQmF6UXV4'}${'K7pL2mN8qR4sT6vW1xY3zA5bC9dE0fG'}`).includes('high-entropy-string'));
});

test('allows commit SHAs where git puts them', () => {
  const s = 'a'.repeat(8) + '0123456789abcdef0123456789abcdef';
  assert.deepEqual(kinds(`https://github.com/kpdagrt22/x/commit/${s}`), []);
  assert.deepEqual(kinds(`"ref": "kpdagrt22/x@${s}"`), []);
  assert.deepEqual(kinds(`https://github.com/kpdagrt22/kpdagrt22/blob/${s}/README.md`), []);
  // ...but not a bare 40-hex value
  assert.deepEqual(kinds(`password ${s}`), ['long-hex']);
});

test('catches email addresses, not package scopes or release refs', () => {
  assert.deepEqual(kinds('write to someone@example.co.in today'), ['email']);
  assert.deepEqual(kinds('uses @supabase/supabase-js and @tanstack/react-query'), []);
  assert.deepEqual(kinds('kpdagrt22/demo@v1.2.0'), []);
});

test('catches phone numbers in common formats', () => {
  for (const p of ['+91 98765 43210', '+91-9876543210', '9876543210', '98765 43210', '(415) 555-0100', '415-555-0100', '+44 20 7946 0958']) {
    assert.deepEqual(kinds(`call ${p} now`), ['phone-number'], p);
  }
});

test('phone and IP rules ignore dates, timestamps, counts and versions', () => {
  const benign = [
    '2026-11-03',
    '2026-11-03T03:30:00Z',
    '3,048 commits and 1,056 pull requests',
    'Next.js 16, OpenAPI 3.1, version 0.14.0',
    'API routes 116 → 534; 2,556 tests',
    'https://github.com/kpdagrt22/kpdagrt22/actions/runs/40651828897',
    'std::vector and crate::module',
  ];
  for (const t of benign) assert.deepEqual(kinds(t), [], t);
});

test('catches IPv4 and IPv6 addresses', () => {
  assert.deepEqual(kinds('server at 10.0.12.7 is up'), ['ipv4']);
  assert.ok(kinds('listen on 192.168.1.10:8080').includes('ipv4'));
  assert.deepEqual(kinds('host fe80::1ff:fe23:4567:890a here'), ['ipv6']);
  assert.deepEqual(kinds('loopback ::1 only'), ['ipv6']);
  assert.deepEqual(kinds('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), ['ipv6']);
});

test('catches URLs to non-public hosts and credentials in URLs', () => {
  assert.deepEqual(kinds('see http://localhost:3000/admin'), ['non-public-url']);
  assert.deepEqual(kinds('see https://grafana.internal/d/1'), ['non-public-url']);
  assert.deepEqual(kinds('see https://build01/job'), ['non-public-url']);
  assert.ok(kinds('see http://10.1.2.3/health').includes('non-public-url'));
  assert.ok(kinds(`postgres://app:${'hunter2'}@db.example.com/x`).includes('credential-url'));
  assert.deepEqual(kinds('see https://thisiskp.in/work and https://github.com/kpdagrt22/leadparrot'), []);
  assert.equal(isNonPublicHost('strikehike.com'), false);
  assert.equal(isNonPublicHost('db.corp.example.com'), true);
});

test('catches links to private repositories, without confusing a longer public name', () => {
  const opts = { privateRepos: ['kpdagrt22/strikehike', 'kpdagrt22/thisiskp'] };
  assert.deepEqual(kinds('https://github.com/kpdagrt22/strikehike', opts), ['private-repo-link']);
  assert.deepEqual(kinds('https://github.com/kpdagrt22/thisiskp/pull/4', opts), ['private-repo-link']);
  assert.deepEqual(kinds('https://api.github.com/repos/kpdagrt22/thisiskp/contents', opts), ['private-repo-link']);
  assert.deepEqual(kinds('https://github.com/kpdagrt22/strikehike-monorepo', opts), []);
  assert.deepEqual(kinds('the private repository kpdagrt22/thisiskp (named, not linked)', opts), []);
});

test('findings report kind and line, never the matched value', () => {
  const secret = `${'ghp'}_${rnd(36)}`;
  const { ok, findings } = scanOutputs([{ name: 'x.md', text: `line one\n${secret}` }]);
  assert.equal(ok, false);
  assert.deepEqual(findings, [{ file: 'x.md', kind: 'github-token', line: 2 }]);
  assert.ok(!JSON.stringify(findings).includes(secret));
});

test('private text must also avoid URLs, domains and environment-variable names', () => {
  assert.equal(isSafePrivateText('Planetary trading prediction system'), true);
  assert.equal(isSafePrivateText('Talks to api.acme-client.com'), false);
  assert.equal(isSafePrivateText('Reads DATABASE_URL at start-up'), false);
  assert.equal(isSafePrivateText(''), false);
});
