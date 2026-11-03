#!/usr/bin/env node
// Weekly profile intelligence: GitHub activity -> evidence -> manifest ->
// profile README blocks + portfolio data -> scanned -> pull requests.
//
//   GH_TOKEN=$(gh auth token) node tools/profile-intel/run.mjs --dry-run --since-days 30
//
// Options:
//   --dry-run            compute, scan and write out/, push nothing (env DRY_RUN=true)
//   --since-days N       days of activity to review, 1-90 (env SINCE_DAYS, default 7)
//   --out DIR            where the report and outputs go (default out)
//   --base-from DIR      dry runs only: read README.md and data/projects.manifest.json
//                        from DIR instead of main (to prove a re-run changes nothing)
// Environment:
//   GH_TOKEN                  token (PROFILE_TOKEN in Actions); never printed
//   PROFILE_INTEL_AUTOMERGE   "false" leaves pull requests open (default true)
//   PORTFOLIO_PUBLISH         "true" also publishes to the portfolio repository (default false)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectActivity, getLanguages } from './activity.mjs';
import { classifyRepoActivity, reasonKey } from './classify.mjs';
import { CONFIG } from './config.mjs';
import { diffStat, unifiedDiff } from './diff.mjs';
import { discoverRepos } from './discover.mjs';
import { verifyEvidence } from './evidence.mjs';
import { checkPublicUrl, createClient } from './github.mjs';
import { findEntryForRepo, mergeRun, parseManifest, serializeManifest, storableEvidence, validateManifest } from './manifest.mjs';
import { buildRecentWork, serializeRecentWork, stampPortfolioUpdates } from './portfolio.mjs';
import { publishTarget } from './publish.mjs';
import { generatedBlocks, renderRecent, renderStack, updateReadme } from './readme.mjs';
import { privateReason, renderBlockedReport, renderReport } from './report.mjs';
import { describeFindings, isClean, isNonPublicHost, isSafePrivateText, scanOutputs } from './scanner.mjs';
import { detectTechnologies, languageEvidence } from './technologies.mjs';
import { humanDate, istDate, MONTHS, windowStart } from './util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

export function parseArgs(argv, env = {}) {
  const args = {
    dryRun: env.DRY_RUN === 'true',
    sinceDays: env.SINCE_DAYS ? Number(env.SINCE_DAYS) : 7,
    out: 'out',
    baseFrom: null,
    automerge: (env.PROFILE_INTEL_AUTOMERGE ?? 'true').trim().toLowerCase() !== 'false',
    portfolioPublish: (env.PORTFOLIO_PUBLISH ?? 'false').trim().toLowerCase() === 'true',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--since-days') args.sinceDays = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--base-from') args.baseFrom = argv[++i];
    else throw new Error(`Unknown option ${a}`);
  }
  if (!Number.isInteger(args.sinceDays) || args.sinceDays < 1 || args.sinceDays > 90) throw new Error('--since-days must be a whole number from 1 to 90');
  if (args.baseFrom && !args.dryRun) throw new Error('--base-from is only allowed with --dry-run');
  return args;
}

const log = (msg) => console.log(`[profile-intel] ${msg}`);

async function getText(gh, repo, filePath, ref) {
  const res = await gh.request('GET', `/repos/${repo}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`, {
    accept: 'application/vnd.github.raw',
    allow404: true,
  });
  return res.status === 404 ? null : String(res.data);
}

function joinAnd(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Decision 4: no description -> a neutral line from languages and dates, never a guess. */
export function neutralSummary(languages, createdAt) {
  const langs = Object.keys(languageEvidence(languages ?? {})).slice(0, 3);
  const ymd = istDate(createdAt);
  const created = `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
  return langs.length ? `${joinAnd(langs)} codebase, created ${created}.` : `Repository created ${created}.`;
}

export function autoSummary(repo, languages) {
  if (repo.outside) return 'Merged pull requests to an upstream repository.';
  if (repo.fork) return 'Fork with meaningful commits of my own.';
  const d = (repo.description ?? '').replace(/\s+/g, ' ').trim();
  const ok = d && (repo.private ? isSafePrivateText(d) : isClean(d));
  return ok ? d : neutralSummary(languages, repo.createdAt);
}

function runUrl(env) {
  if (!env.GITHUB_RUN_ID || !env.GITHUB_REPOSITORY) return null;
  return `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

function prBody({ today, window, changes, readme, scannerFiles, reportUrl, target }) {
  const addedIds = new Set(changes.filter((c) => c.kind === 'added').map((c) => c.id));
  const added = changes.filter((c) => c.kind === 'added').map((c) => c.name);
  const updated = [...new Set(changes.filter((c) => !addedIds.has(c.id)).map((c) => c.name))];
  const tech = changes.filter((c) => c.kind === 'technology').map((c) => `${c.name}: ${c.detail}`);
  return [
    `Weekly update generated by tools/profile-intel from GitHub activity between ${humanDate(window.since)} and ${humanDate(today)}. [profile-intel]`,
    '',
    target === 'profile'
      ? `- README blocks changed: ${readme.blocksChanged.length ? readme.blocksChanged.join(', ') : 'none'}`
      : '- Portfolio data: src/data/recent-work.json regenerated from the profile manifest',
    `- Projects added: ${added.length ? added.join(', ') : 'none'}`,
    `- Projects updated: ${updated.length ? updated.join(', ') : 'none'}`,
    `- Technology changes: ${tech.length ? tech.join('; ') : 'none'}`,
    '',
    'Checked before this pull request was opened:',
    `- output scanner (secrets, emails, phone numbers, IP addresses, non-public URLs, private repository links): passed on ${scannerFiles} outputs`,
    '- README content outside the profile-intel markers: byte-identical to the base branch',
    '- manifest schema: valid',
    '',
    'Merged automatically once GitHub reports it clean, unless the repository variable PROFILE_INTEL_AUTOMERGE is false. Undo by reverting the merge.',
    reportUrl ? `\nFull report: ${reportUrl}` : '',
  ]
    .join('\n')
    .trim()
    .concat('\n');
}

async function writeOut(outDir, rel, text) {
  const p = path.join(outDir, rel);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, text, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2), process.env);
  const outDir = path.resolve(args.out);
  const nowMs = Date.now();
  const today = istDate(nowMs);
  const errors = [];
  const warnings = [];
  const gh = createClient({ token: process.env.GH_TOKEN, log });
  log(`${args.dryRun ? 'dry run' : 'live run'}; window ${args.sinceDays} days; auto-merge ${args.automerge ? 'on' : 'off'}; portfolio publishing ${args.portfolioPublish ? 'on' : 'off'}`);

  // 1. The base this run builds on.
  const baseRef = await gh.get(`/repos/${CONFIG.profileRepo}/git/ref/heads/${CONFIG.baseBranch}`);
  const baseSha = baseRef.object.sha;
  let readmeBase;
  let manifestBase;
  let manifestText;
  if (args.baseFrom) {
    readmeBase = await readFile(path.join(args.baseFrom, CONFIG.readmePath), 'utf8');
    manifestBase = await readFile(path.join(args.baseFrom, CONFIG.manifestPath), 'utf8');
    manifestText = manifestBase;
    warnings.push(`Base read from a local directory (--base-from) instead of ${CONFIG.baseBranch}: a dry-run simulation of the run after a merge.`);
  } else {
    readmeBase = await getText(gh, CONFIG.profileRepo, CONFIG.readmePath, baseSha);
    if (readmeBase === null) throw new Error(`${CONFIG.readmePath} not found on ${CONFIG.baseBranch}`);
    manifestBase = await getText(gh, CONFIG.profileRepo, CONFIG.manifestPath, baseSha);
    manifestText = manifestBase;
    if (manifestBase === null) {
      manifestText = await readFile(path.join(REPO_ROOT, CONFIG.manifestPath), 'utf8');
      warnings.push(`${CONFIG.manifestPath} is not on ${CONFIG.baseBranch} yet; started from the seed in this checkout.`);
    }
  }
  const manifest = parseManifest(manifestText);

  // 2. Window. If the manifest has not changed for longer than the window
  //    (a failed run, a pull request left open), reach back to cover the gap.
  let since = windowStart(nowMs, args.sinceDays);
  let catchUp = false;
  if (manifestBase !== null && !args.baseFrom) {
    const hist = await gh.get(`/repos/${CONFIG.profileRepo}/commits?sha=${baseSha}&path=${encodeURIComponent(CONFIG.manifestPath)}&per_page=1`);
    const last = hist?.[0]?.commit?.committer?.date?.slice(0, 10);
    const floor = windowStart(nowMs, CONFIG.maxCatchUpDays).date;
    if (last && last < since.date) {
      const d = last > floor ? last : floor;
      since = { date: d, iso: `${d}T00:00:00Z` };
      catchUp = true;
    }
  }
  const windowDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since.date}T00:00:00Z`)) / 86_400_000);
  log(`window ${since.date} to ${today}${catchUp ? ' (catch-up)' : ''}`);

  // 3. Discover and collect.
  const disc = await discoverRepos(gh, { login: CONFIG.login, sinceIso: since.iso, exclude: CONFIG.excludeRepos, excludeIds: CONFIG.excludeRepoIds });
  log(`${disc.owned.length} owned repositories; ${disc.candidates.length} pushed to in the window`);
  const languageCache = new Map();
  const privateRepoNames = disc.owned.filter((r) => r.private).map((r) => r.fullName);
  const act = await collectActivity(gh, { login: CONFIG.login, candidates: disc.candidates, sinceIso: since.iso, sinceDate: since.date, log, languageCache });
  if (act.noAccess.length) {
    const msg = `The token cannot read ${act.noAccess.length} repositories (${act.noAccess.map((r) => r.fullName).join(', ')}): give PROFILE_TOKEN Contents read on all repositories.`;
    log(msg);
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::warning::${msg}`);
  }

  // 4. Classify, find what is new, verify public links, detect technologies.
  const repoReports = [];
  const mergeReports = [];
  const techResults = [];
  for (const res of act.results) {
    const { repo } = res;
    const c = classifyRepoActivity(res);
    const notes = [];
    // Public titles are published as written unless the scanner objects to one.
    for (const d of c.decisions) {
      if (!repo.private && !isClean(`${d.title}\n${d.url}`, { privateRepos: privateRepoNames })) {
        d.title = '(title withheld by the output scanner)';
        notes.push('one title withheld by the output scanner');
      }
    }
    const entry = findEntryForRepo(manifest.entries, repo);
    const hidden = entry?.publication === 'hidden';
    let meaningful = c.meaningful;
    let fresh = [];
    if (hidden) notes.push('entry is hidden: nothing recorded');
    else {
      // Only evidence that would actually be stored is new; its public links
      // are checked, and a dead link makes room for the next item.
      const checked = new Set();
      for (;;) {
        fresh = storableEvidence(entry, meaningful, { isPrivate: repo.private }).map((x) => x.decision);
        const todo = repo.private ? [] : fresh.filter((d) => !checked.has(d.ref));
        if (!todo.length) break;
        const { dropped } = await verifyEvidence(todo.map((d) => ({ ref: d.ref, url: d.url })));
        for (const d of todo) checked.add(d.ref);
        if (dropped.length) {
          const bad = new Set(dropped.map((x) => x.item.ref));
          for (const x of dropped) warnings.push(`${repo.fullName}: evidence dropped, ${x.reason}: ${x.item.url}`);
          meaningful = meaningful.filter((d) => !bad.has(d.ref));
        }
      }
    }

    let tech = null;
    let summary;
    let liveUrl;
    if (!hidden && fresh.length) {
      // Technologies are re-read only alongside new work on the code itself:
      // a documentation update does not make a stack "in active use".
      if (!repo.fork && !repo.outside && fresh.some((d) => d.category !== 'docs')) {
        const t = await detectTechnologies(gh, repo, { languageCache });
        tech = t;
        techResults.push({ repo, evidence: t.evidence, notes: t.notes });
      }
      if (!entry || entry.source === 'auto') {
        const langs = repo.outside || repo.fork ? {} : await getLanguages(gh, repo, languageCache);
        summary = autoSummary(repo, langs);
        liveUrl = null;
        const hp = repo.homepage;
        if (hp && !repo.fork && !repo.outside && /^https:\/\//.test(hp)) {
          let host = null;
          try {
            host = new URL(hp).hostname;
          } catch {
            /* not a URL */
          }
          if (host && !isNonPublicHost(host) && isClean(hp) && (await checkPublicUrl(hp)).ok) liveUrl = hp;
          else notes.push('homepage not used: it does not resolve publicly');
        }
      }
    }
    if (c.reverted.length) notes.push(`${c.reverted.length} earlier change(s) reverted in this window`);

    repoReports.push({
      repo,
      counts: { commits: res.commits.length, prs: res.prs.length, releases: res.releases.length },
      meaningful,
      filtered: c.decisions.filter((d) => !d.meaningful).map((d) => ({ ...d, reasonKey: reasonKey(d.reason) })),
      decisions: c.decisions,
      notes,
      newEvidence: hidden ? undefined : fresh.length,
    });
    if (!hidden) mergeReports.push({ repo, meaningful, reverted: c.reverted, summary, liveUrl, tech });
  }

  // 5. Merge into the manifest, then render everything from the manifest.
  const { manifest: merged, changes } = mergeRun(manifest, { today, owned: disc.owned, reports: mergeReports });
  const portfolioChangedIds = stampPortfolioUpdates(manifest, merged, today);
  validateManifest(merged);
  const newManifestText = serializeManifest(merged);
  const recent = renderRecent(merged);
  const stack = renderStack(merged);
  const readme = updateReadme(readmeBase, { recent, stack, today });
  const recentWorkText = serializeRecentWork(buildRecentWork(merged));
  const oldRecentWorkText = serializeRecentWork(buildRecentWork(manifest));

  // Seed text that no longer appears in the README is worth a look (not an error).
  for (const e of merged.entries) {
    if (e.source !== 'manual' || !e.readmeSection) continue;
    for (const k of ['shortDescription', 'detailedDescription']) {
      if (e[k] && !readme.text.replace(/\r\n/g, '\n').includes(e[k])) warnings.push(`Manual entry "${e.id}": ${k} no longer appears verbatim in the README; update the manifest if the README text changed.`);
    }
  }

  const privateRepos = privateRepoNames;
  const window = { since: since.date, days: windowDays, catchUp };
  const reportUrl = runUrl(process.env);

  // 6. Scan every output that could be published, before anything is pushed.
  const readmeDiff = unifiedDiff(readmeBase.replace(/\r\n/g, '\n'), readme.text.replace(/\r\n/g, '\n'), { from: 'a/README.md', to: 'b/README.md' });
  const manifestDiff = unifiedDiff(manifestBase ?? '', newManifestText, { from: `a/${CONFIG.manifestPath}`, to: `b/${CONFIG.manifestPath}` });
  const addedLines = (d) => d.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
  const decisionsJson = `${JSON.stringify(
    repoReports.map((x) => ({
      repo: x.repo.fullName,
      visibility: x.repo.private ? 'private' : 'public',
      decisions: x.decisions.map((d) =>
        x.repo.private
          ? { type: d.type, date: istDate(d.date), meaningful: d.meaningful, reason: privateReason(d.reason) }
          : { type: d.type, ref: d.ref, url: d.url, date: istDate(d.date), title: d.title, meaningful: d.meaningful, reason: d.reason },
      ),
    })),
    null,
    2,
  )}\n`;
  const outputs = [
    { name: 'README.md (generated blocks)', text: generatedBlocks(readme.text) },
    { name: CONFIG.manifestPath, text: newManifestText },
    { name: 'portfolio/recent-work.json', text: recentWorkText },
    { name: 'decisions.json', text: decisionsJson },
    { name: 'README.diff (added lines)', text: addedLines(readmeDiff) },
    { name: 'manifest.diff (added lines)', text: addedLines(manifestDiff) },
  ];
  // The pull request bodies and the report are scanned too.
  const scannedCount = outputs.length + 3;
  const finalBody = prBody({ today, window, changes, readme, scannerFiles: scannedCount, reportUrl, target: 'profile' });
  const portfolioBody = prBody({ today, window, changes, readme, scannerFiles: scannedCount, reportUrl, target: 'portfolio' });
  outputs.push({ name: 'pull request body (profile)', text: finalBody }, { name: 'pull request body (portfolio)', text: portfolioBody });
  const scan = scanOutputs(outputs, { privateRepos });
  await mkdir(outDir, { recursive: true });
  if (!scan.ok) {
    console.error(`[profile-intel] output scanner blocked the run:\n${describeFindings(scan.findings)}`);
    await writeOut(outDir, 'report.md', renderBlockedReport({ today, dryRun: args.dryRun, findings: scan.findings }));
    process.exitCode = 1;
    return;
  }

  await writeOut(outDir, 'profile/README.md', readme.text);
  await writeOut(outDir, 'profile/README.diff', readmeDiff || '(no change)\n');
  await writeOut(outDir, `profile/${CONFIG.manifestPath}`, newManifestText);
  await writeOut(outDir, 'profile/manifest.diff', manifestDiff || '(no change)\n');
  await writeOut(outDir, 'portfolio/recent-work.json', recentWorkText);
  await writeOut(outDir, 'decisions.json', decisionsJson);

  // 7. Publish (one PR per target), only after every output passed the scanner.
  const publish = { profile: null, portfolio: null };
  await writeOut(outDir, 'pr-body.md', finalBody);
  try {
    publish.profile = await publishTarget(
      gh,
      {
        repo: CONFIG.profileRepo,
        owner: CONFIG.login,
        baseBranch: CONFIG.baseBranch,
        baseSha,
        branch: CONFIG.branch,
        files: [
          { path: CONFIG.readmePath, content: readme.text, baseContent: readmeBase },
          { path: CONFIG.manifestPath, content: newManifestText, baseContent: manifestBase },
        ],
        title: `Weekly profile update, ${humanDate(today)} [profile-intel]`,
        body: finalBody,
        commitMessage: `chore(profile-intel): weekly profile update, ${humanDate(today)} [profile-intel]`,
        mergeTitle: `Merge weekly profile update, ${humanDate(today)} [profile-intel]`,
      },
      { dryRun: args.dryRun, automerge: args.automerge, log },
    );
    log(`profile: ${publish.profile.status}${publish.profile.pr ? ` #${publish.profile.pr.number}` : ''}`);
  } catch (err) {
    errors.push(`Profile publishing failed: ${err.message}`);
  }

  if (!args.portfolioPublish) {
    publish.portfolio = {
      status: 'disabled',
      note: `publishing is off (PORTFOLIO_PUBLISH=false) until thisiskp.in reads ${CONFIG.portfolioTargetPath}; the file is ready in out/portfolio/recent-work.json${recentWorkText !== oldRecentWorkText ? ' (changed this run)' : ''}`,
    };
  } else if (errors.length) {
    publish.portfolio = { status: 'skipped', note: 'not attempted because the profile step failed' };
  } else {
    try {
      const pRef = await gh.get(`/repos/${CONFIG.portfolioRepo}/git/ref/heads/${CONFIG.baseBranch}`);
      const pBase = await getText(gh, CONFIG.portfolioRepo, CONFIG.portfolioTargetPath, pRef.object.sha);
      publish.portfolio = await publishTarget(
        gh,
        {
          repo: CONFIG.portfolioRepo,
          owner: CONFIG.login,
          baseBranch: CONFIG.baseBranch,
          baseSha: pRef.object.sha,
          branch: CONFIG.branch,
          files: [{ path: CONFIG.portfolioTargetPath, content: recentWorkText, baseContent: pBase }],
          title: `Recent work data, ${humanDate(today)} [profile-intel]`,
          body: portfolioBody,
          commitMessage: `chore(profile-intel): refresh recent work data, ${humanDate(today)} [profile-intel]`,
          mergeTitle: `Merge recent work data, ${humanDate(today)} [profile-intel]`,
        },
        { dryRun: args.dryRun, automerge: args.automerge, log },
      );
      publish.portfolio.private = true;
    } catch (err) {
      errors.push(`Portfolio publishing failed: ${err.message}`);
    }
  }

  // 8. Report: scanned like everything else, then written.
  const names = Object.fromEntries(merged.entries.map((e) => [e.id, e.name]));
  const entryFor = {};
  for (const x of repoReports) {
    const e = findEntryForRepo(merged.entries, x.repo);
    if (e) entryFor[x.repo.fullName] = e.name;
  }
  const report = renderReport({
    today,
    dryRun: args.dryRun,
    window,
    discovery: {
      owned: disc.owned.length,
      candidates: disc.candidates.length,
      skipped: disc.skipped.length,
      skippedReasons: disc.skipped.map((s) => s.reason),
    },
    repos: repoReports,
    outside: {
      privateRepos: act.outsideRepos.filter((o) => o.private).length,
      privatePrs: act.outsideRepos.filter((o) => o.private).reduce((n, o) => n + o.prs, 0),
      companyPrs: act.companyPrs,
      noAccess: act.noAccess,
      companyOrgs: CONFIG.companyOrgs,
    },
    searchIncomplete: act.search.incomplete,
    changes,
    names,
    entryFor,
    readme: { changed: readme.changed, blocksChanged: readme.blocksChanged, stat: diffStat(readmeBase.replace(/\r\n/g, '\n'), readme.text.replace(/\r\n/g, '\n')) },
    manifestChanged: newManifestText !== manifestBase,
    portfolio: { changed: recentWorkText !== oldRecentWorkText, items: JSON.parse(recentWorkText).items.length, stamped: portfolioChangedIds.length },
    tech: techResults,
    publish,
    scanner: { ok: true, files: scannedCount },
    warnings,
    errors,
    apiCalls: gh.calls,
  });
  const reportScan = scanOutputs([{ name: 'report.md', text: report }], { privateRepos });
  if (!reportScan.ok) {
    console.error(`[profile-intel] output scanner blocked the report:\n${describeFindings(reportScan.findings)}`);
    await writeOut(outDir, 'report.md', renderBlockedReport({ today, dryRun: args.dryRun, findings: reportScan.findings }));
    process.exitCode = 1;
    return;
  }
  await writeOut(outDir, 'report.md', report);
  log(`report written to ${path.relative(process.cwd(), path.join(outDir, 'report.md'))}; ${gh.calls} API requests`);
  if (errors.length) {
    for (const e of errors) console.error(`[profile-intel] ${e}`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(async (err) => {
    // Fail loudly, with a report that is safe to publish.
    const raw = err?.message ?? String(err);
    const msg = isClean(raw) ? raw : 'the error message was withheld because it tripped the output scanner';
    console.error(`[profile-intel] failed: ${msg}`);
    try {
      const outDir = path.resolve(parseArgs(process.argv.slice(2), process.env).out);
      const today = istDate(Date.now());
      const text = `# Profile intelligence report, ${humanDate(today)}\n\n**The run failed; nothing was published.**\n\n${msg}\n`;
      await writeOut(outDir, 'report.md', text);
    } catch {
      /* the log line above is the fallback */
    }
    process.exitCode = 1;
  });
}
