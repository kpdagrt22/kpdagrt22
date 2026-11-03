// Publishing: one pull request per target repository, from the pipeline-owned
// branch auto/profile-intel. Never pushes to the base branch. When nothing
// differs from the base branch, nothing is written at all.
//
// Flow: commit on top of the base commit the run read from -> force-move the
// pipeline branch -> open the PR, or update the one already open -> check the
// PR touches exactly the expected files -> (auto-merge on) wait for GitHub to
// report it clean, merge it with the head SHA pinned, delete the branch.

import { CONFIG } from './config.mjs';
import { GitHubError } from './github.mjs';
import { sleep as realSleep } from './util.mjs';

const enc = encodeURIComponent;
const MERGE_ORDER = ['merge', 'squash', 'rebase'];

export function assertSafeBranch(branch, baseBranch) {
  if (!branch || branch === baseBranch || /^(main|master|trunk|develop|gh-pages)$/i.test(branch) || !branch.startsWith('auto/')) {
    throw new Error(`Refusing to write to branch "${branch}": the pipeline only writes to auto/* branches, never to ${baseBranch}`);
  }
}

/** Files whose generated content differs from the base branch. */
export function changedFiles(files) {
  return files.filter((f) => f.content !== f.baseContent);
}

async function findOpenPr(gh, { repo, owner, branch, baseBranch }) {
  const list = await gh.get(`/repos/${repo}/pulls?state=open&head=${enc(`${owner}:${branch}`)}&base=${enc(baseBranch)}&per_page=10`);
  return (list ?? []).sort((a, b) => a.number - b.number)[0] ?? null;
}

/** Merge methods to try, preferred first, filtered by what the repository allows (when it says). */
export function mergeMethods(repoInfo, preferred = 'merge') {
  const allowed = { merge: repoInfo?.allow_merge_commit, squash: repoInfo?.allow_squash_merge, rebase: repoInfo?.allow_rebase_merge };
  const order = [preferred, ...MERGE_ORDER.filter((m) => m !== preferred)];
  const known = order.filter((m) => allowed[m] === true);
  const unknown = order.filter((m) => allowed[m] === undefined);
  return known.length ? known : unknown.length ? unknown : order;
}

/**
 * target: { repo, owner, baseBranch, baseSha, branch, files: [{ path, content, baseContent }],
 *           title, body, commitMessage, mergeTitle }
 * opts:   { dryRun, automerge, log, sleepImpl, now, pollMs, waitMs }
 * Returns { status, changedPaths, pr?, mergeMethod?, note? }
 *   status: unchanged | dry-run | open | merged
 */
export async function publishTarget(gh, target, opts = {}) {
  const { dryRun = true, automerge = true, log = () => {}, sleepImpl = realSleep, now = () => Date.now() } = opts;
  const pollMs = opts.pollMs ?? CONFIG.mergePollMs;
  const waitMs = opts.waitMs ?? CONFIG.mergeWaitMs;
  const { repo, owner, baseBranch, baseSha, branch } = target;
  assertSafeBranch(branch, baseBranch);

  const changed = changedFiles(target.files);
  const changedPaths = changed.map((f) => f.path).sort();
  if (changed.length === 0) {
    return { status: 'unchanged', changedPaths };
  }
  if (dryRun) return { status: 'dry-run', changedPaths };

  // 1. One commit on top of the base commit this run read from.
  const baseCommit = await gh.get(`/repos/${repo}/git/commits/${baseSha}`);
  const tree = await gh.post(`/repos/${repo}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree: changed.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
  });
  const commit = await gh.post(`/repos/${repo}/git/commits`, { message: target.commitMessage, tree: tree.sha, parents: [baseSha] });
  log(`${repo}: commit ${commit.sha.slice(0, 7)} on ${baseSha.slice(0, 7)}`);

  // 2. Point the pipeline branch at it (create, or force-move: the branch is ours).
  const ref = `heads/${branch}`;
  const existing = await gh.request('GET', `/repos/${repo}/git/ref/${ref}`, { allow404: true });
  if (existing.status === 404) {
    try {
      await gh.post(`/repos/${repo}/git/refs`, { ref: `refs/${ref}`, sha: commit.sha });
    } catch (err) {
      if (!(err instanceof GitHubError && err.status === 422)) throw err;
      await gh.patch(`/repos/${repo}/git/refs/${ref}`, { sha: commit.sha, force: true });
    }
  } else {
    await gh.patch(`/repos/${repo}/git/refs/${ref}`, { sha: commit.sha, force: true });
  }

  // 3. Open the PR, or update the one already open.
  let pr = await findOpenPr(gh, { repo, owner, branch, baseBranch });
  if (pr) {
    pr = await gh.patch(`/repos/${repo}/pulls/${pr.number}`, { title: target.title, body: target.body });
    log(`${repo}: updated open pull request #${pr.number}`);
  } else {
    try {
      pr = await gh.post(`/repos/${repo}/pulls`, { title: target.title, body: target.body, head: branch, base: baseBranch, maintainer_can_modify: false });
    } catch (err) {
      // A retried POST can race itself; adopt the PR that now exists.
      if (!(err instanceof GitHubError && err.status === 422)) throw err;
      pr = await findOpenPr(gh, { repo, owner, branch, baseBranch });
      if (!pr) throw err;
      pr = await gh.patch(`/repos/${repo}/pulls/${pr.number}`, { title: target.title, body: target.body });
    }
    log(`${repo}: opened pull request #${pr.number}`);
  }
  const prInfo = { number: pr.number, url: pr.html_url };

  // 4. Validate what the PR actually contains.
  const { items: prFiles } = await gh.paginate(`/repos/${repo}/pulls/${pr.number}/files?per_page=100`);
  const prPaths = prFiles.map((f) => f.filename).sort();
  if (JSON.stringify(prPaths) !== JSON.stringify(changedPaths)) {
    throw new Error(`${repo}#${pr.number}: the pull request changes [${prPaths.join(', ')}], expected [${changedPaths.join(', ')}]; left open, not merged`);
  }

  if (!automerge) return { status: 'open', changedPaths, pr: prInfo, note: 'auto-merge is switched off (PROFILE_INTEL_AUTOMERGE=false)' };

  // 5. Wait until GitHub reports the PR clean (mergeable, every check passed).
  const deadline = now() + waitMs;
  let state = null;
  let head = commit.sha;
  for (;;) {
    const p = await gh.get(`/repos/${repo}/pulls/${pr.number}`);
    state = p.mergeable_state;
    head = p.head?.sha ?? head;
    if (p.state !== 'open') throw new Error(`${repo}#${pr.number} is ${p.state}; not merging`);
    if (head !== commit.sha) throw new Error(`${repo}#${pr.number}: head moved to ${head.slice(0, 7)} during the run; not merging`);
    if (p.mergeable === true && (state === 'clean' || state === 'has_hooks')) break;
    if (state === 'dirty' || state === 'draft' || p.mergeable === false) {
      return { status: 'open', changedPaths, pr: prInfo, note: `GitHub reports the pull request as ${state}; left open for review` };
    }
    if (now() >= deadline) {
      return { status: 'open', changedPaths, pr: prInfo, note: `GitHub still reports ${state ?? 'unknown'} after ${Math.round(waitMs / 1000)} s; left open` };
    }
    await sleepImpl(pollMs);
  }

  // 6. Merge (merge commit preferred), pinned to the SHA that was validated.
  const repoInfo = await gh.get(`/repos/${repo}`);
  let merged = null;
  let lastErr = null;
  for (const method of mergeMethods(repoInfo, 'merge')) {
    try {
      await gh.request('PUT', `/repos/${repo}/pulls/${pr.number}/merge`, {
        body: { merge_method: method, sha: commit.sha, commit_title: target.mergeTitle },
      });
      merged = method;
      break;
    } catch (err) {
      lastErr = err;
      if (err instanceof GitHubError && err.status === 405 && /not allowed|merge method/i.test(err.message)) continue;
      throw err;
    }
  }
  if (!merged) throw lastErr ?? new Error(`${repo}#${pr.number}: no merge method is allowed`);

  // 7. Delete the branch. A failure here is reported but does not undo the merge.
  let note = merged === 'merge' ? undefined : `merge commits are not allowed on ${repo}; merged with "${merged}" instead`;
  try {
    await gh.request('DELETE', `/repos/${repo}/git/refs/${ref}`, { allow404: true });
  } catch (err) {
    note = [note, `branch ${branch} could not be deleted: ${err.message}`].filter(Boolean).join('; ');
  }
  return { status: 'merged', changedPaths, pr: prInfo, mergeMethod: merged, note };
}
