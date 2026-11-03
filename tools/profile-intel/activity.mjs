// Collect the account's activity for the window: commits it authored on each
// repository's default branch, pull requests it authored that were merged, and
// releases it published. Read-only.

import { CONFIG, LANGUAGE_IGNORE } from './config.mjs';
import { buildCoverage, coveringPr } from './classify.mjs';
import { GitHubError } from './github.mjs';
import { mapLimit } from './util.mjs';

const enc = encodeURIComponent;

export function slimCommit(c) {
  return {
    sha: c.sha,
    message: c.commit?.message ?? '',
    authorLogin: c.author?.login ?? null,
    authorName: c.commit?.author?.name ?? null,
    authorDate: c.commit?.author?.date ?? null,
    date: c.commit?.committer?.date ?? c.commit?.author?.date,
    parents: c.parents?.length ?? 1,
    htmlUrl: c.html_url,
    files: null,
  };
}

const slimFile = (f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch });

export async function searchMergedPRs(gh, { login, sinceDate }) {
  const q = enc(`is:pr author:${login} is:merged merged:>=${sinceDate}`);
  const { items, first } = await gh.paginate(`/search/issues?q=${q}&per_page=100`, { itemsKey: 'items', max: 1000 });
  const prs = items
    .map((it) => ({
      repoFullName: it.repository_url.replace('https://api.github.com/repos/', ''),
      number: it.number,
      title: it.title,
      mergedAt: it.pull_request?.merged_at ?? null,
      htmlUrl: it.html_url,
      authorLogin: it.user?.login ?? null,
    }))
    .sort((a, b) => (a.repoFullName === b.repoFullName ? a.number - b.number : a.repoFullName.localeCompare(b.repoFullName)));
  return {
    prs,
    total: first?.total_count ?? prs.length,
    incomplete: Boolean(first?.incomplete_results) || (first?.total_count ?? 0) > 1000,
  };
}

async function listCommits(gh, repo, { login, sinceIso }) {
  try {
    const { items } = await gh.paginate(
      `/repos/${repo.fullName}/commits?sha=${enc(repo.defaultBranch)}&author=${enc(login)}&since=${enc(sinceIso)}&per_page=100`,
      { max: 500 },
    );
    return items.map(slimCommit);
  } catch (err) {
    if (err instanceof GitHubError && err.status === 409) return []; // empty repository
    throw err;
  }
}

async function loadPullRequest(gh, repo, number, { prFilesCap }) {
  const p = await gh.get(`/repos/${repo.fullName}/pulls/${number}`);
  let files = null;
  if ((p.changed_files ?? 0) <= prFilesCap) {
    const { items } = await gh.paginate(`/repos/${repo.fullName}/pulls/${number}/files?per_page=100`, { max: prFilesCap });
    files = items.map(slimFile);
  }
  const { items: commits } = await gh.paginate(`/repos/${repo.fullName}/pulls/${number}/commits?per_page=100`, { max: 250 });
  return {
    number: p.number,
    title: p.title,
    body: p.body ?? '',
    authorLogin: p.user?.login ?? null,
    headRef: p.head?.ref ?? null,
    mergedAt: p.merged_at,
    mergeCommitSha: p.merge_commit_sha ?? null,
    htmlUrl: p.html_url,
    files,
    commits: commits.map((c) => ({ sha: c.sha, message: c.commit?.message ?? '', authorDate: c.commit?.author?.date ?? null })),
  };
}

async function listReleases(gh, repo, { login, sinceIso }) {
  const data = await gh.get(`/repos/${repo.fullName}/releases?per_page=30`);
  return (data ?? [])
    .filter((r) => !r.draft && r.published_at && r.published_at >= sinceIso && r.author?.login?.toLowerCase() === login.toLowerCase())
    .map((r) => ({ tag: r.tag_name, name: r.name ?? '', publishedAt: r.published_at, htmlUrl: r.html_url }))
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}

export async function getLanguages(gh, repo, cache) {
  if (cache.has(repo.fullName)) return cache.get(repo.fullName);
  const data = (await gh.get(`/repos/${repo.fullName}/languages`)) ?? {};
  cache.set(repo.fullName, data);
  return data;
}

export function codeBytes(languages) {
  return Object.entries(languages).reduce((n, [lang, bytes]) => n + (LANGUAGE_IGNORE.has(lang) ? 0 : bytes), 0);
}

/**
 * For each candidate repo: commits, merged PRs (with files and commits),
 * releases, and whether it is a new repository with real code.
 */
export async function collectActivity(gh, { login, candidates, sinceIso, sinceDate, cfg = CONFIG, log = () => {}, languageCache = new Map() }) {
  const search = await searchMergedPRs(gh, { login, sinceDate });
  const candidateNames = new Set(candidates.map((r) => r.fullName.toLowerCase()));
  const ownedPrefix = `${login.toLowerCase()}/`;

  const prsByRepo = new Map();
  const outside = new Map();
  const company = new Map();
  const companyOrgs = new Set((cfg.companyOrgs ?? []).map((o) => o.toLowerCase()));
  for (const pr of search.prs) {
    const key = pr.repoFullName.toLowerCase();
    if (candidateNames.has(key)) {
      if (!prsByRepo.has(key)) prsByRepo.set(key, []);
      prsByRepo.get(key).push(pr.number);
    } else if (companyOrgs.has(key.split('/')[0])) {
      company.set(pr.repoFullName, (company.get(pr.repoFullName) ?? 0) + 1);
    } else if (!key.startsWith(ownedPrefix)) {
      if (!outside.has(pr.repoFullName)) outside.set(pr.repoFullName, []);
      outside.get(pr.repoFullName).push(pr);
    }
    // PRs in owned repos that are not candidates (the profile repo, archived
    // repos) are ignored on purpose; discovery recorded why.
  }

  const budget = { total: cfg.commitDetailCapTotal };
  const results = [];
  // Sequential per repository keeps the request rate gentle and the order stable.
  for (const repo of candidates) {
    const commits = await listCommits(gh, repo, { login, sinceIso });
    const prNumbers = prsByRepo.get(repo.fullName.toLowerCase()) ?? [];
    const prs = await mapLimit(prNumbers, 3, (n) => loadPullRequest(gh, repo, n, cfg));
    const releases = await listReleases(gh, repo, { login, sinceIso });

    const coverage = buildCoverage(prs);
    const needDetail = commits.filter((c) => c.parents <= 1 && coveringPr(c, coverage) === null);
    let perRepo = cfg.commitDetailCapPerRepo;
    const detailTargets = [];
    for (const c of needDetail) {
      if (perRepo <= 0 || budget.total <= 0) break;
      perRepo--;
      budget.total--;
      detailTargets.push(c);
    }
    await mapLimit(detailTargets, 4, async (c) => {
      const d = await gh.get(`/repos/${repo.fullName}/commits/${c.sha}`);
      c.files = (d.files ?? []).map(slimFile);
    });

    let newRepo = null;
    if (!repo.fork && repo.createdAt >= sinceIso) {
      const bytes = codeBytes(await getLanguages(gh, repo, languageCache));
      if (commits.length === 0) {
        // Created by the account, but none of its commits are attributable to
        // the login (another identity, or an agent's): not evidence of my work.
        newRepo = { meaningful: false, reason: `new repository, but none of its commits in the window are authored by ${login}` };
      } else {
        newRepo =
          bytes >= cfg.newRepoMinCodeBytes
            ? { meaningful: true, reason: `new repository with code (${bytes.toLocaleString('en-US')} bytes in recognised languages)` }
            : { meaningful: false, reason: `new repository without real code yet (${bytes} bytes)` };
      }
    }

    const skippedDetail = needDetail.length - detailTargets.length;
    if (skippedDetail > 0) log(`${repo.private ? 'a private repository' : repo.fullName}: ${skippedDetail} commits judged by message only (detail budget)`);
    results.push({ repo, commits, prs, releases, newRepo });
  }

  // Repositories outside this account. Public ones (upstream contributions)
  // are classified from their merged pull requests; private ones (company
  // repositories the token may see) are counted only, never read.
  const outsideRepos = [];
  for (const [fullName, prs] of [...outside.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const info = await gh.request('GET', `/repos/${fullName}`, { allow404: true });
    const isPublic = info.status === 200 && info.data && info.data.private === false;
    outsideRepos.push({ fullName, private: !isPublic, prs: prs.length });
    if (!isPublic) continue;
    const repo = {
      id: info.data.id,
      fullName: info.data.full_name,
      name: info.data.name,
      private: false,
      fork: false,
      archived: Boolean(info.data.archived),
      outside: true,
      htmlUrl: info.data.html_url,
      description: null,
      homepage: null,
      createdAt: info.data.created_at,
      pushedAt: info.data.pushed_at,
      defaultBranch: info.data.default_branch,
    };
    const loaded = await mapLimit(
      prs.map((p) => p.number),
      3,
      (n) => loadPullRequest(gh, repo, n, cfg),
    );
    results.push({ repo, commits: [], prs: loaded, releases: [], newRepo: null });
  }

  const companyPrs = [...company.values()].reduce((a, b) => a + b, 0);
  return { results, outsideRepos, companyPrs, search: { total: search.total, incomplete: search.incomplete } };
}
