// Shared fixtures for the profile-intel tests. No network.

export const TODAY = '2026-11-03';

export function repo(over = {}) {
  const name = over.name ?? 'demo';
  const fullName = over.fullName ?? `kpdagrt22/${name}`;
  return {
    id: over.id ?? 1000,
    fullName,
    name,
    private: false,
    fork: false,
    archived: false,
    htmlUrl: `https://github.com/${fullName}`,
    description: 'A demo service',
    homepage: null,
    createdAt: '2026-01-10T10:00:00Z',
    pushedAt: '2026-11-02T10:00:00Z',
    defaultBranch: 'main',
    ...over,
  };
}

let shaCounter = 0;
export function sha(seed) {
  const base = (seed ?? `c${++shaCounter}`).replace(/[^0-9a-f]/g, 'a');
  return (base + '0'.repeat(40)).slice(0, 40);
}

export function commit(over = {}) {
  const s = over.sha ?? sha();
  return {
    sha: s,
    message: 'feat: add the thing',
    authorLogin: 'kpdagrt22',
    authorName: 'KP',
    authorDate: '2026-11-01T08:00:00Z',
    date: '2026-11-01T08:00:00Z',
    parents: 1,
    htmlUrl: `https://github.com/kpdagrt22/demo/commit/${s}`,
    files: [{ filename: 'src/app.ts', status: 'modified', additions: 40, deletions: 5, patch: '@@\n-a\n+b' }],
    ...over,
  };
}

export function pr(over = {}) {
  return {
    number: 7,
    title: 'feat: add the thing',
    body: '',
    authorLogin: 'kpdagrt22',
    headRef: 'feat/thing',
    mergedAt: '2026-11-02T08:00:00Z',
    mergeCommitSha: null,
    htmlUrl: 'https://github.com/kpdagrt22/demo/pull/7',
    files: [{ filename: 'src/app.ts', status: 'modified', additions: 80, deletions: 10 }],
    commits: [],
    ...over,
  };
}

export function manualEntry(over = {}) {
  return {
    id: 'demo',
    name: 'Demo',
    shortDescription: 'Owner-approved description.',
    detailedDescription: null,
    category: 'flagship',
    role: 'built solo',
    status: 'live',
    verifiedContributions: ['Owner-approved bullet.'],
    technologies: ['Next.js'],
    repo: 'kpdagrt22/demo',
    repoUrl: 'https://github.com/kpdagrt22/demo',
    liveUrl: 'https://demo.example.org',
    visibility: 'public',
    publication: 'approved',
    source: 'manual',
    readmeSection: 'Flagship work',
    firstDiscovered: '2026-11-01',
    lastMeaningfulActivity: null,
    lastPortfolioUpdate: null,
    technologyEvidence: {},
    evidence: [],
    ...over,
  };
}

export function manifest(entries = []) {
  return { schemaVersion: 1, owner: 'kpdagrt22', entries };
}

export const README = [
  '# Hello',
  '',
  'Intro text with an email: someone@example.com',
  '',
  '## Stack',
  '',
  '<picture>',
  '  <img src="assets/stack-light.svg" alt="stack">',
  '</picture>',
  '',
  '<details>',
  '<summary>Stack as text</summary>',
  '</details>',
  '',
  '## Open code',
  '',
  '- something',
  '',
  '## Path',
  '',
  'Career path.',
  '',
].join('\n');

/** A fake GitHub client that serves canned responses and records every call. */
export function fakeGitHub(routes = {}) {
  const calls = [];
  const match = (method, path) => {
    for (const [key, handler] of Object.entries(routes)) {
      const [m, p] = key.split(' ');
      if (m === method && (p === path || (p.endsWith('*') && path.startsWith(p.slice(0, -1))))) return handler;
    }
    return null;
  };
  async function request(method, path, opts = {}) {
    calls.push({ method, path, body: opts.body });
    const h = match(method, path);
    if (!h) {
      if (opts.allow404) return { status: 404, data: null, headers: new Map() };
      throw new Error(`unexpected ${method} ${path}`);
    }
    const data = typeof h === 'function' ? h(opts.body, path) : h;
    return { status: 200, data, headers: new Map() };
  }
  return {
    calls,
    request,
    get: async (p, o) => (await request('GET', p, o)).data,
    post: async (p, b) => (await request('POST', p, { body: b })).data,
    patch: async (p, b) => (await request('PATCH', p, { body: b })).data,
    paginate: async (p, opts = {}) => {
      const d = (await request('GET', p)).data;
      return { items: (opts.itemsKey ? d?.[opts.itemsKey] : d) ?? [], first: d, truncated: false };
    },
    writes: () => calls.filter((c) => c.method !== 'GET'),
  };
}
