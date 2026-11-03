// Meaningful work vs noise. Pure functions only: every decision carries the
// reason it was made, so the weekly report can show why something was kept or
// dropped.

import { BOT_LOGINS, CONFIG, DOCS_RE, GENERATED_RE, LOCKFILE_RE } from './config.mjs';
import { firstLine } from './util.mjs';

export const PIPELINE_MARK = '[profile-intel]';

/** A reason with its specifics removed, for counting ("docs-only change (12 lines…)" -> "docs-only change"). */
export function reasonKey(reason) {
  return String(reason ?? '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/(?:pull request )?#\d+/g, 'a pull request')
    .replace(/\b[0-9a-f]{7,40}\b/g, 'a commit')
    .replace(/:\s.*$/, '')
    .trim();
}

export function isBot({ login, name } = {}) {
  const l = String(login ?? '').toLowerCase();
  const n = String(name ?? '').toLowerCase();
  if (l.endsWith('[bot]') || n.endsWith('[bot]')) return true;
  if (BOT_LOGINS.has(l)) return true;
  return /^(dependabot|renovate)\b/.test(n);
}

const DEP_BUMP_RE = /^(chore|build|fix)\((deps|deps-dev|dependencies)\)|^bump\s+\S+\s+from\s+\S+\s+to\s+\S+|^update dependency\s|^(chore|build):\s*(bump|update|upgrade)\s+(dependencies|deps)\b/i;
// Messages that announce a cosmetic change. They only decide the verdict when
// the diff is small (<= 200 lines) or could not be inspected; whitespace-only
// diffs are caught from the patch itself whatever the message says.
const TRIVIAL_MSG_RE = [
  /\btypos?\b/i,
  /^(?:(?:style|chore|fix)(?:\([^)]*\))?!?:\s*)?(?:remove\s+|trim\s+|fix\s+)?(?:trailing\s+)?whitespace\b/i,
  /\bspelling\b/i,
  /^(style|chore)(\([^)]*\))?!?:\s*(run\s+|apply\s+)?(prettier|black|ruff format|gofmt|eslint --fix|format(ting)?|reformat|lint(ing)?)\b/i,
  /^(fix|chore)(\([^)]*\))?!?:\s*(fix\s+)?(lint|linting|eslint|prettier|format(ting)?)\s+(errors?|warnings?|issues?|only)\b/i,
  /^(re)?format(ting|ted)?\s+(code|files?|only)\b/i,
];

export function isDocsPath(path) {
  if (/(^|\/)requirements[^/]*\.txt$|(^|\/)(CMakeLists|robots)\.txt$/i.test(path)) return false;
  return DOCS_RE.test(path);
}

/** True when every hunk only moves whitespace around. */
export function isWhitespaceOnlyPatch(patch) {
  if (typeof patch !== 'string' || patch.length === 0) return false;
  const removed = [];
  const added = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue;
    if (line.startsWith('-')) removed.push(line.slice(1).replace(/\s+/g, ''));
    else if (line.startsWith('+')) added.push(line.slice(1).replace(/\s+/g, ''));
  }
  if (removed.length === 0 && added.length === 0) return false;
  const a = removed.filter(Boolean).join('');
  const b = added.filter(Boolean).join('');
  return a === b;
}

/** Summarise a list of changed files: { kind, lines, files }. */
export function classifyFiles(files) {
  if (!Array.isArray(files)) return { kind: 'unknown', lines: 0, files: 0 };
  if (files.length === 0) return { kind: 'empty', lines: 0, files: 0 };
  const lines = files.reduce((n, f) => n + (f.additions ?? 0) + (f.deletions ?? 0), 0);
  const names = files.map((f) => f.filename);
  const count = files.length;
  if (names.every((p) => LOCKFILE_RE.test(p))) return { kind: 'lockfile', lines, files: count };
  if (names.every((p) => LOCKFILE_RE.test(p) || GENERATED_RE.test(p))) return { kind: 'generated', lines, files: count };
  if (names.every((p) => isDocsPath(p))) return { kind: 'docs', lines, files: count };
  const withPatch = files.filter((f) => typeof f.patch === 'string');
  if (withPatch.length === files.length && files.every((f) => f.status === 'modified') && withPatch.every((f) => isWhitespaceOnlyPatch(f.patch))) {
    return { kind: 'whitespace', lines, files: count };
  }
  return { kind: 'code', lines, files: count };
}

function workType(subject) {
  const m = /^(\w+)(\([^)]*\))?!?:/.exec(subject);
  const t = m?.[1]?.toLowerCase();
  const map = { feat: 'feature', fix: 'fix', perf: 'performance', refactor: 'refactor', test: 'tests', ci: 'CI/CD', build: 'build', docs: 'docs', style: 'style', chore: 'maintenance', polish: 'polish' };
  return map[t] ?? 'change';
}

function fileVerdict(summary, { docsSubstantialLines, minCodeLines }) {
  switch (summary.kind) {
    case 'empty':
      return { meaningful: false, reason: 'no file changes' };
    case 'lockfile':
      return { meaningful: false, reason: 'lockfile-only change' };
    case 'generated':
      return { meaningful: false, reason: 'generated or lockfile-only change' };
    case 'whitespace':
      return { meaningful: false, reason: 'whitespace-only change' };
    case 'docs':
      return summary.lines >= docsSubstantialLines
        ? { meaningful: true, reason: `substantial documentation (${summary.lines} lines in ${summary.files} files)` }
        : { meaningful: false, reason: `docs-only change (${summary.lines} lines, under the ${docsSubstantialLines}-line threshold)` };
    case 'code':
      return summary.lines < minCodeLines
        ? { meaningful: false, reason: `trivial change (${summary.lines} changed lines)` }
        : null;
    default:
      return null;
  }
}

/**
 * commit: { sha, message, authorLogin, authorName, parents, files|null }
 * Returns { meaningful, reason, category }.
 */
export function classifyCommit(commit, opts = {}) {
  const o = { ...CONFIG, ...opts };
  const subject = firstLine(commit.message);
  if (isBot({ login: commit.authorLogin, name: commit.authorName })) {
    return { meaningful: false, reason: `bot author (${commit.authorLogin ?? commit.authorName})`, category: 'noise' };
  }
  if (String(commit.message ?? '').includes(PIPELINE_MARK)) {
    return { meaningful: false, reason: "this pipeline's own commit", category: 'noise' };
  }
  if ((commit.parents ?? 1) > 1) {
    return { meaningful: false, reason: 'merge commit (the merged work counts through its pull request or its own commits)', category: 'noise' };
  }
  if (/^revert\b/i.test(subject)) {
    return { meaningful: false, reason: 'revert', category: 'revert' };
  }
  if (DEP_BUMP_RE.test(subject)) {
    return { meaningful: false, reason: 'dependency bump', category: 'noise' };
  }
  const trivialMsg = TRIVIAL_MSG_RE.find((re) => re.test(subject));
  const summary = classifyFiles(commit.files);
  if (trivialMsg && (summary.kind === 'unknown' || summary.lines <= 200)) {
    return { meaningful: false, reason: 'formatting, typo or lint-only change (by its message)', category: 'noise' };
  }
  const verdict = fileVerdict(summary, o);
  if (verdict) return { ...verdict, category: verdict.meaningful ? 'docs' : 'noise' };
  const type = workType(subject);
  if (summary.kind === 'unknown') {
    // Over the detail budget: keep only clearly substantive message types.
    const keep = ['feature', 'fix', 'performance', 'refactor'].includes(type);
    return keep
      ? { meaningful: true, reason: `${type} (judged by its message only: commit-detail budget reached)`, category: type }
      : { meaningful: false, reason: 'not inspected (commit-detail budget reached) and the message does not mark it as a feature or fix', category: 'noise' };
  }
  return { meaningful: true, reason: `${type}: ${summary.files} files, ${summary.lines} changed lines`, category: type };
}

/**
 * pr: { number, title, body, authorLogin, headRef, files|null }
 */
export function classifyPullRequest(pr, opts = {}) {
  const o = { ...CONFIG, ...opts };
  const title = firstLine(pr.title);
  if (isBot({ login: pr.authorLogin })) {
    return { meaningful: false, reason: `bot author (${pr.authorLogin})`, category: 'noise' };
  }
  if (pr.headRef === o.branch || title.includes(PIPELINE_MARK)) {
    return { meaningful: false, reason: "this pipeline's own pull request", category: 'noise' };
  }
  if (/^revert\b/i.test(title)) {
    return { meaningful: false, reason: 'revert', category: 'revert' };
  }
  if (DEP_BUMP_RE.test(title)) {
    return { meaningful: false, reason: 'dependency bump', category: 'noise' };
  }
  const summary = classifyFiles(pr.files);
  const trivialMsg = TRIVIAL_MSG_RE.find((re) => re.test(title));
  if (trivialMsg && (summary.kind === 'unknown' || summary.lines <= 200)) {
    return { meaningful: false, reason: 'formatting, typo or lint-only change (by its title)', category: 'noise' };
  }
  const verdict = fileVerdict(summary, o);
  if (verdict) return { ...verdict, category: verdict.meaningful ? 'docs' : 'noise' };
  const type = workType(title);
  if (summary.kind === 'unknown') {
    return { meaningful: true, reason: `${type}: merged pull request (files not inspected)`, category: type };
  }
  return { meaningful: true, reason: `${type}: merged pull request, ${summary.files} files, ${summary.lines} changed lines`, category: type };
}

const keyOf = (subject, authorDate) => `${subject}\u0000${authorDate ?? ''}`;

/** Commits that belong to a merged pull request (by SHA, squash title, or rebased subject+date). */
export function buildCoverage(prs) {
  const bySha = new Map();
  const byKey = new Map();
  const byNumber = new Map();
  for (const pr of prs) {
    byNumber.set(pr.number, pr);
    if (pr.mergeCommitSha) bySha.set(pr.mergeCommitSha, pr.number);
    for (const c of pr.commits ?? []) {
      bySha.set(c.sha, pr.number);
      byKey.set(keyOf(firstLine(c.message), c.authorDate), pr.number);
    }
  }
  return { bySha, byKey, byNumber };
}

export function coveringPr(commit, coverage) {
  if (coverage.bySha.has(commit.sha)) return coverage.bySha.get(commit.sha);
  const subject = firstLine(commit.message);
  const k = coverage.byKey.get(keyOf(subject, commit.authorDate));
  if (k !== undefined) return k;
  const squash = /\(#(\d+)\)\s*$/.exec(subject);
  if (squash && coverage.byNumber.has(Number(squash[1]))) return Number(squash[1]);
  return null;
}

/**
 * Classify one repository's activity for the window.
 * input: { repo, commits, prs, releases, newRepo: { meaningful, reason } | null }
 * Returns { decisions, meaningful, reverted } where `reverted` lists evidence
 * refs that were undone and must leave the manifest.
 */
export function classifyRepoActivity({ repo, commits = [], prs = [], releases = [], newRepo = null }, opts = {}) {
  const full = repo.fullName;
  const decisions = [];
  const coverage = buildCoverage(prs);

  const prDecisions = new Map();
  for (const pr of prs) {
    const d = classifyPullRequest(pr, opts);
    prDecisions.set(pr.number, d);
  }

  // Revert pairs: a revert and the change it undoes both stop counting.
  const reverted = [];
  for (const pr of prs) {
    if (prDecisions.get(pr.number)?.category !== 'revert') continue;
    const m = /Reverts\s+([\w.-]+\/[\w.-]+)#(\d+)/i.exec(pr.body ?? '');
    const quoted = /^revert\s+"(.+)"\s*$/i.exec(firstLine(pr.title));
    let target = null;
    if (m && m[1].toLowerCase() === full.toLowerCase()) target = Number(m[2]);
    else if (quoted) target = prs.find((p) => firstLine(p.title) === quoted[1])?.number ?? null;
    if (target !== null && prDecisions.has(target)) {
      prDecisions.set(target, { meaningful: false, reason: `reverted by #${pr.number} (revert pair)`, category: 'noise' });
      prDecisions.set(pr.number, { meaningful: false, reason: `revert of #${target} (revert pair)`, category: 'noise' });
    } else {
      prDecisions.set(pr.number, { meaningful: false, reason: target !== null ? `revert of #${target}, merged before this window` : 'revert', category: 'noise' });
      if (target !== null) reverted.push({ type: 'pr', ref: `${full}#${target}`, repo: full });
    }
  }

  const commitDecisions = new Map();
  for (const c of commits) {
    const n = coveringPr(c, coverage);
    if (n !== null && (c.parents ?? 1) <= 1) {
      const prD = prDecisions.get(n);
      const how = prD?.meaningful ? 'which is counted instead' : 'which was filtered as noise';
      commitDecisions.set(c.sha, { meaningful: false, reason: `part of pull request #${n}, ${how}`, category: 'covered' });
    } else {
      commitDecisions.set(c.sha, classifyCommit(c, opts));
    }
  }

  const shaIndex = new Map(commits.map((c) => [c.sha, c]));
  for (const c of commits) {
    if (commitDecisions.get(c.sha)?.category !== 'revert') continue;
    const m = /This reverts commit ([0-9a-f]{7,40})/i.exec(c.message ?? '');
    if (!m) continue;
    const target = [...shaIndex.keys()].find((s) => s.startsWith(m[1].toLowerCase()));
    if (target) {
      commitDecisions.set(target, { meaningful: false, reason: `reverted by ${c.sha.slice(0, 7)} (revert pair)`, category: 'noise' });
      commitDecisions.set(c.sha, { meaningful: false, reason: `revert of ${target.slice(0, 7)} (revert pair)`, category: 'noise' });
    } else {
      commitDecisions.set(c.sha, { meaningful: false, reason: `revert of ${m[1].slice(0, 7)}, which landed before this window`, category: 'noise' });
      reverted.push({ type: 'commit', shaPrefix: m[1].toLowerCase(), repo: full });
    }
  }
  for (const pr of prs) {
    const d = prDecisions.get(pr.number);
    decisions.push({
      type: 'pr',
      ref: `${full}#${pr.number}`,
      url: pr.htmlUrl,
      date: pr.mergedAt,
      title: firstLine(pr.title),
      ...d,
    });
  }
  for (const c of commits) {
    const d = commitDecisions.get(c.sha);
    decisions.push({
      type: 'commit',
      ref: `${full}@${c.sha}`,
      url: c.htmlUrl,
      date: c.date,
      title: firstLine(c.message),
      ...d,
    });
  }
  for (const r of releases) {
    decisions.push({
      type: 'release',
      ref: `${full}@${r.tag}`,
      url: r.htmlUrl,
      date: r.publishedAt,
      title: r.name || r.tag,
      meaningful: true,
      reason: 'published release',
      category: 'release',
    });
  }
  if (newRepo) {
    decisions.push({
      type: 'repo',
      ref: full,
      url: repo.htmlUrl,
      date: repo.createdAt,
      title: 'Repository created',
      ...newRepo,
      category: newRepo.meaningful ? 'new-repo' : 'noise',
    });
  }

  decisions.sort((a, b) => (a.date === b.date ? (a.ref < b.ref ? -1 : 1) : a.date < b.date ? 1 : -1));
  return { decisions, meaningful: decisions.filter((d) => d.meaningful), reverted };
}
