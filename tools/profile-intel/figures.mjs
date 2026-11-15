// Weekly figures: measure what the GitHub API can measure, hold everything else,
// and never publish a bad or partial file. Pure guard functions are exported for tests.
import { writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const MONOTONIC = new Set([
  'commits-12m', 'merged-prs', 'badabhai-prs-kp', 'badabhai-prs-all', 'badabhai-commits-kp',
  'badabhai-commits-all', 'badabhai-migrations', 'badabhai-event-contracts', 'badabhai-adrs',
  'badabhai-deploy-commits', 'badabhai-deploy-records', 'job-portal-commits-kp', 'job-portal-commits-all',
  'job-portal-routes', 'job-portal-migrations', 'job-portal-playwright', 'job-portal-mcp-tools',
  'scheduler-routes-before', 'scheduler-routes-after', 'scheduler-screens-before', 'scheduler-screens-after',
  'scheduler-migrations-before', 'scheduler-migrations-after', 'scheduler-services-before',
  'scheduler-services-after', 'scheduler-commits-kp', 'scheduler-commits-all', 'scheduler-prs-kp',
  'scheduler-prs-all', 'scheduler-mcp-tools', 'team-rvm-commits-kp', 'team-rvm-commits-all',
  'team-rvm-deploys', 'team-rvm-contract-paths', 'team-rvm-contract-operations', 'team-rvm-migrations',
  'team-rvm-rollbacks', 'team-rvm-adrs', 'sfc-commits-kp', 'sfc-commits-all', 'strikehike-commits', 'strikehike-historical-events',
]);

export const ALIASES = ['badabhai', 'job-portal', 'scheduler-backend', 'scheduler-frontend', 'team-rvm', 'sfc', 'snapshot-copies'];

/** Parse FIGURES_SOURCES (alias -> owner/repo, snapshot-copies -> [owner/repo]). Null if missing or invalid. */
export function parseSources(raw) {
  try {
    const m = JSON.parse(raw ?? '');
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    for (const a of ALIASES) {
      if (a === 'snapshot-copies') {
        if (!Array.isArray(m[a]) || m[a].some((v) => typeof v !== 'string' || !v.includes('/'))) return null;
      } else if (m[a] !== undefined && (typeof m[a] !== 'string' || !m[a].includes('/'))) return null;
    }
    if (m['unlinked-extra'] !== undefined && (!Array.isArray(m['unlinked-extra']) || m['unlinked-extra'].some((v) => typeof v !== 'string' || !v.includes('/')))) return null;
    if (m['unlinked-authors'] !== undefined && (!Array.isArray(m['unlinked-authors']) || m['unlinked-authors'].some((v) => typeof v !== 'string' || !v.includes('@')))) return null;
    return m;
  } catch {
    return null;
  }
}

const valueOf = (f) => (typeof f === 'number' ? f : Number(f?.value));

/**
 * Returns the next figures array plus a status for every weekly figure.
 * Figures listed in `unconfigured` (e.g. when FIGURES_TOKEN is missing or lacks access
 * to an organisation repository) keep their last value, are marked UNCONFIGURED, and
 * are ignored by the one-third HELD rule.
 */
export function applyGuards(previous, measured, { today, maxHeldRatio = 1 / 3, unconfigured = new Set() } = {}) {
  const unconfSet = unconfigured instanceof Set ? unconfigured : new Set(unconfigured);
  const statuses = [];
  let configured = 0;
  let held = 0;
  let unconfiguredCount = 0;
  const figures = previous.figures.map((old) => {
    if (old.cadence !== 'weekly') return { ...old, status: 'manual' };
    if (unconfSet.has(old.id)) {
      unconfiguredCount += 1;
      statuses.push({ id: old.id, status: 'UNCONFIGURED' });
      return { ...old, status: 'unconfigured' };
    }
    configured += 1;
    const next = measured[old.id];
    const num = Number(next);
    const prevVal = valueOf(old);
    const bad =
      next === undefined ||
      next === null ||
      next === '' ||
      Number.isNaN(num) ||
      (num === 0 && prevVal > 0) ||
      num < 0;
    const drop = !bad && prevVal > 0 ? (prevVal - num) / prevVal : 0;
    const monotonic = !bad && MONOTONIC.has(old.id) && num < prevVal;
    if (bad || drop > 0.25 || monotonic) {
      held += 1;
      statuses.push({ id: old.id, status: bad ? 'HELD' : monotonic ? 'HELD-MONOTONIC' : 'HELD-DROP' });
      return { ...old, status: 'held' };
    }
    statuses.push({ id: old.id, status: 'measured' });
    return {
      ...old,
      value: num,
      display: num.toLocaleString('en-US'),
      measuredAt: today,
      status: 'measured',
    };
  });
  const heldRatio = configured ? held / configured : 0;
  return {
    figures,
    statuses,
    held,
    configured,
    unconfigured: unconfiguredCount,
    heldRatio,
    publish: heldRatio <= maxHeldRatio,
  };
}

export function serializeFigures(previous, guardResult, today) {
  const out = {
    schemaVersion: previous.schemaVersion ?? 1,
    source: previous.source ?? 'CL15',
    measuredAt: today,
    figures: guardResult.figures.map(({ status: _status, ...rest }) => rest),
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function renderFiguresBlock(figures, today) {
  const get = (id) => figures.find((f) => f.id === id);
  const bits = [];
  for (const id of ['commits-12m', 'merged-prs', 'deployed-systems']) {
    const f = get(id);
    if (f) bits.push(`**${f.display}** ${f.label}`);
  }
  return [
    '<!-- profile-intel:figures:start -->',
    `**Live figures** <sub>(measured ${today})</sub><br>`,
    bits.join(' · '),
    '<!-- profile-intel:figures:end -->',
  ].join('\n');
}

export function updateFiguresBlock(readmeText, figures, humanToday) {
  const block = renderFiguresBlock(figures, humanToday);
  const re = /<!-- profile-intel:figures:start -->[\s\S]*?<!-- profile-intel:figures:end -->/;
  if (!re.test(readmeText)) return { text: readmeText, changed: false };
  const eol = readmeText.includes('\r\n') ? '\r\n' : '\n';
  const next = readmeText.replace(re, block.replace(/\n/g, eol));
  return { text: next, changed: next !== readmeText };
}

export async function writeFiguresAtomically(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

async function countLinkPages(client, apiPath, alias = 'figure') {
  const sep = apiPath.includes('?') ? '&' : '?';
  const res = await client.request('GET', `${apiPath}${sep}per_page=1`, { allow404: true });
  if (res.status === 404 || res.status === 403 || res.status === 401) {
    const err = new Error(`${alias}: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 409) return 0;
  const link = res.headers?.get?.('link') ?? '';
  const m = /[?&]page=(\d+)>;\s*rel="last"/.exec(link);
  if (m) return Number(m[1]);
  return Array.isArray(res.data) ? res.data.length : 0;
}

async function getRawFile(client, repo, filePath, ref = 'main', alias = 'figure') {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  const res = await client.request('GET', `/repos/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`, {
    accept: 'application/vnd.github.raw',
    allow404: true,
  });
  if (res.status === 404 || res.status === 403 || res.status === 401) {
    const err = new Error(`${alias}: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return String(res.data ?? '');
}

async function getTreeBlobs(client, repo, ref = 'main', alias = 'figure') {
  const res = await client.request('GET', `/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, {
    allow404: true,
  });
  if (res.status === 404 || res.status === 403 || res.status === 401) {
    const err = new Error(`${alias}: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return (res.data?.tree ?? []).filter((t) => t.type === 'blob');
}

async function countUnlinkedCommits(client, fullName, branch, sinceIso = null, alias = 'figure', emails = []) {
  const shas = new Set();
  if (!emails.length) return 0;
  const sinceParam = sinceIso ? `&since=${encodeURIComponent(sinceIso)}` : '';
  try {
    for (const email of emails) {
      const { items } = await client.paginate(
        `/repos/${fullName}/commits?sha=${encodeURIComponent(branch)}&author=${encodeURIComponent(email)}&per_page=100${sinceParam}`,
      );
      for (const c of items) {
        if (!c?.author?.login && c?.sha) shas.add(c.sha);
      }
    }
  } catch (e) {
    const err = new Error(`${alias}: ${e.status ?? 'error'}`);
    err.status = e.status;
    throw err;
  }
  return shas.size;
}

async function orgGet(client, apiPath, alias) {
  try {
    return await client.get(apiPath);
  } catch (e) {
    const err = new Error(`${alias}: ${e.status ?? 'error'}`);
    err.status = e.status;
    throw err;
  }
}

async function orgPost(client, apiPath, body, alias) {
  try {
    return await client.post(apiPath, body);
  } catch (e) {
    const err = new Error(`${alias}: ${e.status ?? 'error'}`);
    err.status = e.status;
    throw err;
  }
}

async function searchIssueCount(client, q, alias = 'figure') {
  try {
    const res = await client.get(`/search/issues?q=${encodeURIComponent(q)}&per_page=1`);
    return typeof res?.total_count === 'number' ? res.total_count : null;
  } catch (e) {
    const err = new Error(`${alias}: ${e.status ?? 'error'}`);
    err.status = e.status;
    throw err;
  }
}

const configError = (alias) => Object.assign(new Error(`${alias}: not configured`), { configured: true });
const isAccessError = (err) =>
  err && (err.status === 401 || err.status === 403 || err.status === 404 || /HTTP (401|403|404)/.test(String(err.message)));

/**
 * Measures every weekly figure using the CL15 definitions.
 * Returns `{ measured, unconfigured, notices }`.
 */
export async function measureWeekly(gh, { figuresGh = null, today = '2026-11-15', log = () => {} } = {}) {
  const measured = {};
  const unconfigured = new Set();
  const notices = [];
  const orgClient = figuresGh ?? gh;
  const src = parseSources(process.env.FIGURES_SOURCES);
  const unlinkedAuthors = Array.isArray(src?.['unlinked-authors']) ? src['unlinked-authors'] : [];
  const repoOf = (a) => src?.[a] ?? null;
  const aliasOf = (full) => { for (const a of ALIASES) { const v = src?.[a]; if (Array.isArray(v) ? v.includes(full) : v === full) return a; } return 'repository'; };
  if (process.env.GITHUB_ACTIONS === 'true' && src) {
    for (const v of Object.values(src)) {
      for (const s of Array.isArray(v) ? v : [v]) {
        if (typeof s !== 'string') continue;
        console.log(`::add-mask::${s}`);
        if (s.includes('/')) for (const part of s.split('/')) if (part) console.log(`::add-mask::${part}`);
      }
    }
  }
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}T00:00:00Z`;

  const markUnconfigured = (ids, reason) => {
    for (const id of ids) unconfigured.add(id);
    notices.push(reason);
    log(`figures notice: ${reason}`);
  };
  if (src && !unlinkedAuthors.length) {
    notices.push('Unlinked-author aliases are not configured; commit counts cover linked authors only.');
  }

  // 1. Global merged PRs & StrikeHike commits (owner's token).
  try {
    const pr = await searchIssueCount(gh, 'is:pr is:merged author:kpdagrt22', 'github');
    if (pr !== null) measured['merged-prs'] = pr;
  } catch (err) {
    log(`merged-prs error: ${err.message}`);
  }

  try {
    measured['strikehike-commits'] = await countLinkPages(gh, '/repos/kpdagrt22/strikehike-monorepo/commits?sha=main', 'strikehike');
    const raw = await getRawFile(gh, 'kpdagrt22/strikehike-monorepo', 'backend/data/historical_events.json', 'main', 'strikehike');
    const parsed = JSON.parse(raw);
    const n = Array.isArray(parsed) ? parsed.length : Array.isArray(parsed?.events) ? parsed.events.length : null;
    if (typeof n === 'number') measured['strikehike-historical-events'] = n;
  } catch (err) {
    log(`strikehike: ${err.message}`);
  }

  // 2. BadaBhai figures.
  const bbRepo = repoOf('badabhai');
  const bbIds = [
    'badabhai-prs-kp', 'badabhai-prs-all', 'badabhai-commits-kp', 'badabhai-commits-all',
    'badabhai-migrations', 'badabhai-event-contracts', 'badabhai-adrs',
    'badabhai-deploy-commits', 'badabhai-deploy-records', 'badabhai-deploy-failed',
  ];
  try {
    if (!bbRepo) throw configError('badabhai');
    const [commitsAll, commitsKpLogin, commitsKpUnlinked, prsKp, prsAll, tree, registrySrc] = await Promise.all([
      countLinkPages(orgClient, `/repos/${bbRepo}/commits?sha=main`, 'badabhai'),
      countLinkPages(orgClient, `/repos/${bbRepo}/commits?sha=main&author=kpdagrt22`, 'badabhai'),
      countUnlinkedCommits(orgClient, bbRepo, 'main', null, 'badabhai', unlinkedAuthors),
      searchIssueCount(orgClient, `repo:${bbRepo} is:pr is:merged author:kpdagrt22`, 'badabhai'),
      searchIssueCount(orgClient, `repo:${bbRepo} is:pr is:merged`, 'badabhai'),
      getTreeBlobs(orgClient, bbRepo, 'main', 'badabhai'),
      getRawFile(orgClient, bbRepo, 'packages/event-schema/src/registry.ts', 'main', 'badabhai'),
    ]);
    measured['badabhai-commits-all'] = commitsAll;
    measured['badabhai-commits-kp'] = commitsKpLogin + commitsKpUnlinked;
    if (prsKp !== null) measured['badabhai-prs-kp'] = prsKp;
    if (prsAll !== null) measured['badabhai-prs-all'] = prsAll;
    measured['badabhai-migrations'] = tree.filter((t) => /migrations\/.*\.sql$/.test(t.path)).length;
    measured['badabhai-adrs'] = tree.filter((t) => /^docs\/decisions\/\d+.*\.md$/.test(t.path)).length;
    measured['badabhai-event-contracts'] = (registrySrc.match(/\bpayload:\s*p\./g) ?? []).length;

    // Production deployments via GraphQL.
    const query = `query($o:String!,$r:String!,$c:String){repository(owner:$o,name:$r){deployments(first:100,after:$c,environments:["production"],orderBy:{field:CREATED_AT,direction:ASC}){pageInfo{hasNextPage endCursor} nodes{commitOid latestStatus{state}}}}}`;
    let cursor = null;
    const nodes = [];
    for (;;) {
      const [bbOwner, bbName] = bbRepo.split('/');
      const res = await orgPost(orgClient, '/graphql', { query, variables: { o: bbOwner, r: bbName, c: cursor } }, 'badabhai');
      const dep = res?.data?.repository?.deployments;
      if (!dep) break;
      nodes.push(...(dep.nodes ?? []));
      if (!dep.pageInfo?.hasNextPage) break;
      cursor = dep.pageInfo.endCursor;
    }
    if (nodes.length > 0) {
      measured['badabhai-deploy-records'] = nodes.length;
      measured['badabhai-deploy-failed'] = nodes.filter((n) => ['FAILURE', 'ERROR'].includes(n.latestStatus?.state)).length;
      measured['badabhai-deploy-commits'] = new Set(
        nodes.filter((n) => ['SUCCESS', 'INACTIVE'].includes(n.latestStatus?.state)).map((n) => n.commitOid),
      ).size;
    }
  } catch (err) {
    if (err.configured) markUnconfigured(bbIds, 'badabhai is not configured (FIGURES_SOURCES missing or unparsable).');
    else if (isAccessError(err)) markUnconfigured(bbIds, 'badabhai is not readable with the configured token; figures left UNCONFIGURED.');
    else log(`badabhai: ${err.message}`);
  }

  // 3. Job Portal figures.
  const jpRepo = repoOf('job-portal');
  const jpIds = [
    'job-portal-commits-kp', 'job-portal-commits-all', 'job-portal-routes',
    'job-portal-migrations', 'job-portal-playwright', 'job-portal-mcp-tools',
  ];
  try {
    if (!jpRepo) throw configError('job-portal');
    const [commitsAll, commitsKp, tree, mcpIndex] = await Promise.all([
      countLinkPages(orgClient, `/repos/${jpRepo}/commits?sha=main`, 'job-portal'),
      countLinkPages(orgClient, `/repos/${jpRepo}/commits?sha=main&author=kpdagrt22`, 'job-portal'),
      getTreeBlobs(orgClient, jpRepo, 'main', 'job-portal'),
      getRawFile(orgClient, jpRepo, 'lib/mcp/tools/index.ts', 'main', 'job-portal'),
    ]);
    measured['job-portal-commits-all'] = commitsAll;
    measured['job-portal-commits-kp'] = commitsKp;
    measured['job-portal-routes'] = tree.filter((t) => /^(?:src\/)?app\/api\/.*\/route\.ts$/.test(t.path)).length;
    measured['job-portal-migrations'] = tree.filter((t) => /^supabase\/migrations\/.*\.sql$/.test(t.path)).length;
    measured['job-portal-playwright'] = tree.filter((t) => /^tests\/e2e\/.*\.spec\.ts$/.test(t.path)).length;
    const portalBlock = mcpIndex.match(/PORTAL_TOOLS[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? '';
    measured['job-portal-mcp-tools'] = portalBlock
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter((l) => l && /Tool,?$/.test(l)).length;
  } catch (err) {
    if (err.configured) markUnconfigured(jpIds, 'job-portal is not configured (FIGURES_SOURCES missing or unparsable).');
    else if (isAccessError(err)) markUnconfigured(jpIds, 'job-portal is not readable with the configured token; figures left UNCONFIGURED.');
    else log(`job-portal: ${err.message}`);
  }

  // 4. Scheduler figures.
  const sbRepo = repoOf('scheduler-backend');
  const sfRepo = repoOf('scheduler-frontend');
  const schedIds = [
    'scheduler-routes-before', 'scheduler-routes-after', 'scheduler-screens-before', 'scheduler-screens-after',
    'scheduler-migrations-before', 'scheduler-migrations-after', 'scheduler-services-before', 'scheduler-services-after',
    'scheduler-commits-kp', 'scheduler-commits-all', 'scheduler-prs-kp', 'scheduler-prs-all', 'scheduler-mcp-tools',
  ];
  try {
    if (!sbRepo) throw configError('scheduler-backend');
    if (!sfRepo) throw configError('scheduler-frontend');
    const [bTree, appTsx, bKp, fKp, bCmp, fCmp, bPrKp, fPrKp, bPrAll, fPrAll, mcpIdx, mcpTeam] = await Promise.all([
      getTreeBlobs(orgClient, sbRepo, 'main', 'scheduler-backend'),
      getRawFile(orgClient, sfRepo, 'client/App.tsx', 'main', 'scheduler-frontend'),
      countLinkPages(orgClient, `/repos/${sbRepo}/commits?sha=main&author=kpdagrt22`, 'scheduler-backend'),
      countLinkPages(orgClient, `/repos/${sfRepo}/commits?sha=main&author=kpdagrt22`, 'scheduler-frontend'),
      orgGet(orgClient, `/repos/${sbRepo}/compare/080f41c...main`, 'scheduler-backend'),
      orgGet(orgClient, `/repos/${sfRepo}/compare/6a6e144...main`, 'scheduler-frontend'),
      searchIssueCount(orgClient, `repo:${sbRepo} is:pr is:merged author:kpdagrt22`, 'scheduler-backend'),
      searchIssueCount(orgClient, `repo:${sfRepo} is:pr is:merged author:kpdagrt22`, 'scheduler-frontend'),
      searchIssueCount(orgClient, `repo:${sbRepo} is:pr is:merged`, 'scheduler-backend'),
      searchIssueCount(orgClient, `repo:${sfRepo} is:pr is:merged`, 'scheduler-frontend'),
      getRawFile(orgClient, sbRepo, 'lib/mcp/tools/index.js', 'main', 'scheduler-backend'),
      getRawFile(orgClient, sbRepo, 'lib/mcp/tools/teamApp.js', 'main', 'scheduler-backend'),
    ]);

    measured['scheduler-routes-before'] = 116;
    measured['scheduler-screens-before'] = 24;
    measured['scheduler-migrations-before'] = 1;
    measured['scheduler-services-before'] = 0;

    measured['scheduler-migrations-after'] = bTree.filter((t) => /^supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(t.path)).length;
    measured['scheduler-services-after'] = bTree.filter((t) => /^services\//.test(t.path)).length;
    measured['scheduler-screens-after'] = new Set(appTsx.match(/(?:from|import\()\s*"\.\/pages\/[^"]+"/g) ?? []).size;
    measured['scheduler-commits-kp'] = bKp + fKp;
    if (typeof bCmp?.total_commits === 'number' && typeof fCmp?.total_commits === 'number') {
      measured['scheduler-commits-all'] = bCmp.total_commits + fCmp.total_commits;
    }
    if (bPrKp !== null && fPrKp !== null) measured['scheduler-prs-kp'] = bPrKp + fPrKp;
    if (bPrAll !== null && fPrAll !== null) measured['scheduler-prs-all'] = bPrAll + fPrAll;

    const TEAM_ARRAY = ['TEAM', 'APP', 'TOOLS'].join('_');
    const countArrayTools = (src, name) => {
      const body = src.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`))?.[1] ?? '';
      return body
        .split(/[\r\n,]+/)
        .map((s) => s.replace(/\/\/.*$/, '').trim())
        .filter((s) => s && !s.startsWith('...') && /Tool$/.test(s)).length;
    };
    measured['scheduler-mcp-tools'] =
      countArrayTools(mcpIdx, 'SCHEDULER_TOOLS') +
      countArrayTools(mcpIdx, 'HR_TOOLS') +
      countArrayTools(mcpTeam, TEAM_ARRAY);

    const routeBlobs = bTree.filter((t) => /^routes\//.test(t.path));
    let routeCount = 0;
    for (const blob of routeBlobs) {
      const raw = await getRawFile(orgClient, sbRepo, blob.path, 'main', 'scheduler-backend');
      routeCount += (raw.match(/\brouter\.(get|post|put|patch|delete)\(/g) ?? []).length;
    }
    measured['scheduler-routes-after'] = routeCount;
  } catch (err) {
    if (err.configured) markUnconfigured(schedIds, 'scheduler repositories are not configured (FIGURES_SOURCES missing or unparsable).');
    else if (isAccessError(err)) markUnconfigured(schedIds, 'scheduler repositories are not readable with the configured token; figures left UNCONFIGURED.');
    else log(`scheduler: ${err.message}`);
  }

  // 5. Team RVM figures.
  const trRepo = repoOf('team-rvm');
  const trIds = [
    'team-rvm-commits-kp', 'team-rvm-commits-all', 'team-rvm-deploys',
    'team-rvm-contract-paths', 'team-rvm-contract-operations',
    'team-rvm-migrations', 'team-rvm-rollbacks', 'team-rvm-adrs',
  ];
  try {
    if (!trRepo) throw configError('team-rvm');
    const [commitsAll, commitsKp, tree, openapiSrc, runsRes] = await Promise.all([
      countLinkPages(orgClient, `/repos/${trRepo}/commits?sha=main`, 'team-rvm'),
      countLinkPages(orgClient, `/repos/${trRepo}/commits?sha=main&author=kpdagrt22`, 'team-rvm'),
      getTreeBlobs(orgClient, trRepo, 'main', 'team-rvm'),
      getRawFile(orgClient, trRepo, 'packages/contracts/openapi.yaml', 'main', 'team-rvm'),
      orgGet(orgClient, `/repos/${trRepo}/actions/workflows/deploy-ess.yml/runs?branch=main&status=success&per_page=100`, 'team-rvm'),
    ]);
    measured['team-rvm-commits-all'] = commitsAll;
    measured['team-rvm-commits-kp'] = commitsKp;
    measured['team-rvm-migrations'] = tree.filter((t) => /^db\/migrations\/.*\.sql$/.test(t.path)).length;
    measured['team-rvm-rollbacks'] = tree.filter((t) => /^db\/rollbacks\/.*\.sql$/.test(t.path)).length;
    measured['team-rvm-adrs'] = tree.filter((t) => /^docs\/adr\/\d+.*\.md$/.test(t.path)).length;
    measured['team-rvm-contract-paths'] = (openapiSrc.match(/^  \/[^\s:]+:/gm) ?? []).length;
    measured['team-rvm-contract-operations'] = (openapiSrc.match(/^    (get|post|put|patch|delete):/gm) ?? []).length;
    const runs = (runsRes?.workflow_runs ?? []).filter((r) => r.created_at >= '2026-10-16T12:50:00Z');
    measured['team-rvm-deploys'] = runs.length;
  } catch (err) {
    if (err.configured) markUnconfigured(trIds, 'team-rvm is not configured (FIGURES_SOURCES missing or unparsable).');
    else if (isAccessError(err)) markUnconfigured(trIds, 'team-rvm is not readable with the configured token; figures left UNCONFIGURED.');
    else log(`team-rvm: ${err.message}`);
  }

  // 6. Singh Furncraft figures.
  const sfcRepo = repoOf('sfc');
  const sfcIds = ['sfc-commits-kp', 'sfc-commits-all'];
  try {
    if (!sfcRepo) throw configError('sfc');
    const [commitsAll, commitsKp] = await Promise.all([
      countLinkPages(orgClient, `/repos/${sfcRepo}/commits?sha=main`, 'sfc'),
      countLinkPages(orgClient, `/repos/${sfcRepo}/commits?sha=main&author=kpdagrt22`, 'sfc'),
    ]);
    measured['sfc-commits-all'] = commitsAll;
    measured['sfc-commits-kp'] = commitsKp;
  } catch (err) {
    if (err.configured) markUnconfigured(sfcIds, 'sfc is not configured (FIGURES_SOURCES missing or unparsable).');
    else if (isAccessError(err)) markUnconfigured(sfcIds, 'sfc is not readable with the configured token; figures left UNCONFIGURED.');
    else log(`sfc: ${err.message}`);
  }

  // 7. 12-month default-branch commits across all non-fork, non-snapshot repositories.
  // Requires org access as well to include RVM and SFC repositories in the global total.
  const snapshots = new Set(src?.['snapshot-copies'] ?? []);
  if (unconfigured.has('badabhai-commits-kp') || unconfigured.has('scheduler-commits-kp') || !src?.['snapshot-copies']) {
    markUnconfigured(['commits-12m'], 'commits-12m requires FIGURES_SOURCES and organisation repository access; left UNCONFIGURED.');
  } else {
    try {
      const [{ items: owned }, { items: member }] = await Promise.all([
        gh.paginate('/user/repos?affiliation=owner&per_page=100'),
        orgClient.paginate('/user/repos?affiliation=collaborator,organization_member&per_page=100'),
      ]);
      const byName = new Map();
      for (const r of [...owned, ...member]) {
        if (r?.full_name && !r.fork && !snapshots.has(r.full_name) && r.default_branch) {
          byName.set(r.full_name, r);
        }
      }
      let total12m = 0;
      for (const [fullName, repo] of byName.entries()) {
        if (repo.pushed_at && repo.pushed_at < yearAgo) continue;
        const client = fullName.startsWith('kpdagrt22/') ? gh : orgClient;
        const loginCount = await countLinkPages(
          client,
          `/repos/${fullName}/commits?sha=${encodeURIComponent(repo.default_branch)}&author=kpdagrt22&since=${encodeURIComponent(yearAgo)}`,
          aliasOf(fullName),
        );
        total12m += loginCount;
        const unlinkedRepos = new Set([repoOf('badabhai'), ...(Array.isArray(src?.['unlinked-extra']) ? src['unlinked-extra'] : [])].filter(Boolean));
        if (unlinkedRepos.has(fullName)) {
          total12m += await countUnlinkedCommits(client, fullName, repo.default_branch, yearAgo, aliasOf(fullName), unlinkedAuthors);
        }
      }
      measured['commits-12m'] = total12m;
    } catch (err) {
      log(`commits-12m: ${err.message}`);
    }
  }

  return {
    measured,
    unconfigured,
    notices,
    methods: {
      'commits-12m': unlinkedAuthors.length
        ? 'unlinked-author aliases from FIGURES_SOURCES included'
        : 'unlinked-author aliases not configured',
    },
  };
}
