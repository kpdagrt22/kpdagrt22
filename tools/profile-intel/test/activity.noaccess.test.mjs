import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNoAccess } from '../activity.mjs';
import { GitHubError } from '../github.mjs';

test('a 403 "not accessible by personal access token" is a skippable no-access error', () => {
  const err = new GitHubError('GET /repos/x/y/commits: HTTP 403 Resource not accessible by personal access token', { status: 403 });
  assert.equal(isNoAccess(err), true);
});

test('rate limits and other errors are not treated as no-access', () => {
  assert.equal(isNoAccess(new GitHubError('HTTP 403 API rate limit exceeded', { status: 403 })), false);
  assert.equal(isNoAccess(new GitHubError('HTTP 500 Server Error', { status: 500 })), false);
  assert.equal(isNoAccess(new Error('Resource not accessible')), false);
});
