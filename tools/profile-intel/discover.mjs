// Discover the repositories owned by the account, and decide which ones need a
// closer look this week. Every skip is recorded with its reason.

export function slimRepo(r) {
  return {
    id: r.id,
    fullName: r.full_name,
    name: r.name,
    private: Boolean(r.private),
    fork: Boolean(r.fork),
    archived: Boolean(r.archived),
    htmlUrl: r.html_url,
    description: r.description ?? null,
    homepage: r.homepage || null,
    createdAt: r.created_at,
    pushedAt: r.pushed_at,
    defaultBranch: r.default_branch,
  };
}

/** Pure: split owned repos into candidates and skipped (with reasons). */
export function planDiscovery(repos, { login, sinceIso, exclude = [], excludeIds = [] }) {
  const excluded = new Set(exclude.map((s) => s.toLowerCase()));
  const excludedIds = new Set(excludeIds);
  const owned = repos
    .filter((r) => r.fullName.split('/')[0].toLowerCase() === login.toLowerCase())
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const candidates = [];
  const skipped = [];
  for (const repo of owned) {
    if (excluded.has(repo.fullName.toLowerCase())) {
      skipped.push({ repo, reason: 'excluded: the profile repository itself (the pipeline writes here)' });
    } else if (excludedIds.has(repo.id)) {
      skipped.push({ repo, reason: 'excluded: snapshot copy of a company repository (see config.mjs)' });
    } else if (repo.archived) {
      skipped.push({ repo, reason: 'archived' });
    } else if (!repo.pushedAt || repo.pushedAt < sinceIso) {
      skipped.push({ repo, reason: 'no push since the window started' });
    } else {
      candidates.push(repo);
    }
  }
  return { owned, candidates, skipped };
}

export async function discoverRepos(gh, { login, sinceIso, exclude, excludeIds }) {
  const { items } = await gh.paginate('/user/repos?affiliation=owner&visibility=all&sort=full_name&per_page=100');
  const repos = items.map(slimRepo);
  return planDiscovery(repos, { login, sinceIso, exclude, excludeIds });
}
