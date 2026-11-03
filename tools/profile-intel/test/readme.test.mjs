import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { findBlock, generatedBlocks, renderRecent, renderStack, stripBlocks, updateReadme } from '../readme.mjs';
import { manifest, manualEntry, README, TODAY } from './helpers.mjs';

const withActivity = () =>
  manifest([
    manualEntry({
      lastMeaningfulActivity: '2026-11-01',
      technologyEvidence: { TypeScript: { kind: 'language', reason: 'x' }, 'Next.js': { kind: 'framework', reason: 'y' } },
      evidence: [{ type: 'pr', ref: 'kpdagrt22/demo#7', date: '2026-11-01T08:00:00Z', url: 'https://github.com/kpdagrt22/demo/pull/7', title: 'feat: add [the] *thing*' }],
    }),
  ]);

test('first run only inserts the three blocks; every original byte survives', () => {
  const m = withActivity();
  const out = updateReadme(README, { recent: renderRecent(m), stack: renderStack(m), today: TODAY });
  assert.equal(out.changed, true);
  assert.deepEqual(out.blocksChanged.sort(), ['recent', 'stack', 'updated']);
  assert.equal(stripBlocks(out.text), README);
  // placement: stack under the stack image, recent + updated before "## Path"
  assert.ok(out.text.indexOf('profile-intel:stack:start') > out.text.indexOf('</picture>'));
  assert.ok(out.text.indexOf('profile-intel:stack:end') < out.text.indexOf('<details>'));
  assert.ok(out.text.indexOf('profile-intel:updated:end') < out.text.indexOf('## Path'));
  assert.ok(out.text.indexOf('profile-intel:recent:start') > out.text.indexOf('## Open code'));
});

test('the same content again changes nothing, including the updated date', () => {
  const m = withActivity();
  const first = updateReadme(README, { recent: renderRecent(m), stack: renderStack(m), today: TODAY });
  const second = updateReadme(first.text, { recent: renderRecent(m), stack: renderStack(m), today: '2026-11-17' });
  assert.equal(second.changed, false);
  assert.equal(second.text, first.text);
  assert.deepEqual(second.blocksChanged, []);
});

test('new content changes only what is between the markers, and moves the updated date', () => {
  const m = withActivity();
  const first = updateReadme(README, { recent: renderRecent(m), stack: renderStack(m), today: TODAY });
  m.entries[0].lastMeaningfulActivity = '2026-11-09';
  const second = updateReadme(first.text, { recent: renderRecent(m), stack: renderStack(m), today: '2026-11-10' });
  assert.equal(second.changed, true);
  assert.equal(stripBlocks(second.text), stripBlocks(first.text));
  assert.match(findBlock(second.text, 'updated').inner, /10 Nov 2026/);
});

test('hand edits outside the markers are preserved exactly', () => {
  const m = withActivity();
  const first = updateReadme(README, { recent: renderRecent(m), stack: renderStack(m), today: TODAY });
  const edited = first.text.replace('Career path.', 'Career path, edited by hand.');
  const second = updateReadme(edited, { recent: 'changed', stack: renderStack(m), today: '2026-11-10' });
  assert.ok(second.text.includes('Career path, edited by hand.'));
  assert.equal(stripBlocks(second.text), stripBlocks(edited));
});

test('CRLF files keep CRLF', () => {
  const crlf = README.replace(/\n/g, '\r\n');
  const m = withActivity();
  const out = updateReadme(crlf, { recent: renderRecent(m), stack: renderStack(m), today: TODAY });
  assert.ok(!/(^|[^\r])\n/.test(out.text));
  assert.equal(stripBlocks(out.text.replace(/\r\n/g, '\n')).replace(/\n/g, '\r\n'), crlf);
});

test('missing anchors or broken markers fail instead of guessing', () => {
  assert.throws(() => updateReadme('# no anchors here\n', { recent: 'x', stack: 'y', today: TODAY }), /## Path/);
  const broken = `${README}<!-- profile-intel:recent:start -->\n`;
  assert.throws(() => updateReadme(broken, { recent: 'x', stack: 'y', today: TODAY }), /incomplete/);
});

test('generated text is escaped; owner-approved names are used as written', () => {
  const recent = renderRecent(withActivity());
  assert.ok(recent.includes('[feat: add \\[the\\] \\*thing\\*](https://github.com/kpdagrt22/demo/pull/7)'));
  assert.ok(recent.includes('**[Demo](https://demo.example.org)**'));
});

test('the real profile README: applying blocks changes no byte outside them', () => {
  const real = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
  const m = withActivity();
  const out = updateReadme(real, { recent: renderRecent(m), stack: renderStack(m), today: TODAY });
  assert.equal(stripBlocks(out.text.replace(/\r\n/g, '\n')), stripBlocks(real.replace(/\r\n/g, '\n')));
  // The owner's own contact details live outside the blocks and are not "generated".
  assert.ok(!generatedBlocks(out.text).includes('mailto:'));
});
