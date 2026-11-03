// The weekly report: plain language, written for the owner. It becomes the job
// summary and out/report.md in the run artifact, both of which are public on a
// public repository, so private repositories appear by name and counts only:
// never a commit message, pull request title, file path or link.

import { mdEscape } from './readme.mjs';
import { humanDate } from './util.mjs';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function countBy(items, key) {
  const m = new Map();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Reasons are generated text; for private repositories, drop anything that looks like a SHA. */
export function privateReason(reason) {
  return String(reason).replace(/\b[0-9a-f]{7,40}\b/g, 'a commit');
}

function repoLabel(repo) {
  if (repo.private) return `${mdEscape(repo.fullName)} (private)`;
  return `[${mdEscape(repo.fullName)}](${repo.htmlUrl})`;
}

function decisionLine(d, isPrivate) {
  if (isPrivate) return null;
  const what = d.type === 'pr' ? 'pull request' : d.type === 'repo' ? 'repository' : d.type;
  return `- ${what}: [${mdEscape(d.title)}](${d.url}): ${mdEscape(d.reason)}`;
}

function prLine(name, result) {
  if (!result) return `- ${name}: not attempted`;
  if (result.status === 'disabled') return `- ${name}: ${result.note}`;
  if (result.status === 'unchanged') return `- ${name}: no changes, so no pull request`;
  if (result.status === 'dry-run') return `- ${name}: would change ${result.changedPaths.join(', ')} (dry run: nothing pushed)`;
  if (result.status === 'skipped') return `- ${name}: ${result.note}`;
  const pr = result.pr ? (result.private ? `pull request #${result.pr.number} (private repository, no link)` : `[pull request #${result.pr.number}](${result.pr.url})`) : 'pull request';
  const state = result.status === 'merged' ? `merged (${result.mergeMethod})` : 'open';
  return `- ${name}: ${pr}, ${state}${result.note ? `; ${result.note}` : ''}`;
}

export function renderReport(r) {
  const L = [];
  L.push(`# Profile intelligence report, ${humanDate(r.today)}`);
  L.push('');
  L.push(`Mode: **${r.dryRun ? 'dry run (nothing was pushed)' : 'live'}**. Window: ${humanDate(r.window.since)} to ${humanDate(r.today)} (${plural(r.window.days, 'day')}${r.window.catchUp ? ', extended to cover the time since the manifest last changed' : ''}).`);
  L.push('');

  const meaningful = r.repos.flatMap((x) => x.meaningful);
  const filtered = r.repos.flatMap((x) => x.filtered);
  L.push('## Summary');
  L.push('');
  L.push(`- Repositories: ${r.discovery.owned} owned; ${r.discovery.candidates} inspected (pushed to in the window); ${r.discovery.skipped} skipped.`);
  const typeName = { pr: ['pull request', 'pull requests'], repo: ['new repository', 'new repositories'], commit: ['commit', 'commits'], release: ['release', 'releases'] };
  L.push(`- Meaningful contributions: ${meaningful.length} (${countBy(meaningful, (d) => d.type).map(([k, n]) => plural(n, ...(typeName[k] ?? [k]))).join(', ') || 'none'}).`);
  L.push(`- Filtered out as noise: ${filtered.length}.`);
  const added = r.changes.filter((c) => c.kind === 'added');
  const addedIds = new Set(added.map((c) => c.id));
  const updated = [...new Set(r.changes.filter((c) => !addedIds.has(c.id)).map((c) => c.id))];
  L.push(`- Projects added: ${added.length ? added.map((c) => mdEscape(c.name)).join(', ') : 'none'}.`);
  L.push(`- Projects updated: ${updated.length ? updated.map((id) => mdEscape(r.names[id] ?? id)).join(', ') : 'none'}.`);
  const tech = r.changes.filter((c) => c.kind === 'technology');
  L.push(`- Technology changes: ${tech.length ? tech.map((c) => `${mdEscape(c.name)}: ${mdEscape(c.detail)}`).join('; ') : 'none'}.`);
  L.push(`- README: ${r.readme.changed ? `changed (blocks: ${r.readme.blocksChanged.join(', ')}; +${r.readme.stat.added}/-${r.readme.stat.removed} lines)` : 'unchanged'}. Manifest: ${r.manifestChanged ? 'changed' : 'unchanged'}. Portfolio data: ${r.portfolio.changed ? 'changed' : 'unchanged'} (${plural(r.portfolio.items, 'item')}).`);
  L.push(`- Output scanner: ${r.scanner.ok ? `passed (${plural(r.scanner.files, 'output')} checked)` : 'FAILED, nothing was published'}.`);
  L.push(`- Errors: ${r.errors.length ? r.errors.length : 'none'}.`);
  L.push('');

  L.push('## Pull requests');
  L.push('');
  L.push(prLine('Profile README (kpdagrt22/kpdagrt22)', r.publish.profile));
  L.push(prLine('Portfolio (thisiskp.in)', r.publish.portfolio));
  L.push('');

  L.push('## Meaningful contributions');
  L.push('');
  const withWork = r.repos.filter((x) => x.meaningful.length);
  if (!withWork.length) L.push('None in this window.');
  for (const x of withWork) {
    const entry = r.entryFor[x.repo.fullName];
    L.push(`### ${repoLabel(x.repo)}${entry ? ` → ${mdEscape(entry)}` : ''}`);
    L.push('');
    if (x.repo.private) {
      const kinds = countBy(x.meaningful, (d) => d.category).map(([k, n]) => `${n} ${k}`).join(', ');
      L.push(`- ${plural(x.meaningful.length, 'meaningful change')} (${kinds}). Titles withheld: private repository.`);
    } else {
      for (const d of x.meaningful) L.push(decisionLine(d, false));
    }
    if (x.newEvidence !== undefined) L.push(`- New to the manifest this run: ${x.newEvidence}.`);
    L.push('');
  }

  L.push('## Filtered out');
  L.push('');
  if (!filtered.length) L.push('Nothing was filtered.');
  else {
    L.push('| Reason | Count |');
    L.push('| --- | --- |');
    for (const [reason, n] of countBy(filtered, (d) => d.reasonKey)) L.push(`| ${mdEscape(reason)} | ${n} |`);
    const publicFiltered = r.repos.filter((x) => !x.repo.private).flatMap((x) => x.filtered.map((d) => ({ d, x })));
    if (publicFiltered.length) {
      L.push('');
      L.push('<details><summary>Filtered items in public repositories</summary>');
      L.push('');
      for (const { d, x } of publicFiltered) L.push(`- ${mdEscape(x.repo.fullName)}: [${mdEscape(d.title)}](${d.url}): ${mdEscape(d.reason)}`);
      L.push('');
      L.push('</details>');
    }
  }
  L.push('');

  L.push('## Repositories inspected');
  L.push('');
  if (!r.repos.length) L.push('None: no repository was pushed to in the window.');
  else {
    L.push('| Repository | Commits | Merged PRs | Releases | Meaningful | Notes |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    for (const x of r.repos) {
      L.push(`| ${repoLabel(x.repo)}${x.repo.fork ? ' (fork)' : ''}${x.repo.outside ? ' (upstream)' : ''} | ${x.counts.commits} | ${x.counts.prs} | ${x.counts.releases} | ${x.meaningful.length} | ${mdEscape(x.notes.join('; '))} |`);
    }
  }
  L.push('');
  L.push(`Skipped without inspection: ${countBy(r.discovery.skippedReasons, (s) => s).map(([k, n]) => `${n} ${k}`).join('; ') || 'none'}.`);
  if (r.outside.companyPrs) {
    L.push('');
    L.push(`${plural(r.outside.companyPrs, 'merged pull request')} in company repositories (${r.outside.companyOrgs.map(mdEscape).join(', ')}) counted, not read: that work is covered by the manual entries copied from the README.`);
  }
  if (r.outside.privatePrs) {
    L.push('');
    L.push(`${plural(r.outside.privatePrs, 'merged pull request')} in ${plural(r.outside.privateRepos, 'private repository', 'private repositories')} outside this account were not inspected.`);
  }
  if (r.searchIncomplete) {
    L.push('');
    L.push('Note: GitHub reported the pull request search as incomplete; some merged pull requests may be missing.');
  }
  L.push('');

  L.push('## Technology evidence');
  L.push('');
  if (!r.tech.length) L.push('No detection ran: no new meaningful work in a repository the pipeline owns.');
  for (const t of r.tech) {
    L.push(`- ${repoLabel(t.repo)}: ${Object.entries(t.evidence).map(([name, v]) => `${mdEscape(name)} (${mdEscape(v.reason)})`).join('; ') || 'nothing above the evidence threshold'}`);
    for (const n of t.notes) L.push(`  - ${mdEscape(t.repo.private ? n.replace(/: .*$/, '') : n)}`);
  }
  L.push('');

  if (r.warnings.length) {
    L.push('## Warnings');
    L.push('');
    for (const w of r.warnings) L.push(`- ${mdEscape(w)}`);
    L.push('');
  }
  if (r.errors.length) {
    L.push('## Errors');
    L.push('');
    for (const e of r.errors) L.push(`- ${mdEscape(e)}`);
    L.push('');
  }
  L.push(`<sub>API requests: ${r.apiCalls}. Generated by tools/profile-intel; rules in tools/profile-intel/README.md.</sub>`);
  return `${L.join('\n')}\n`;
}

/** Minimal report used when the scanner blocks a run: locations only, no content. */
export function renderBlockedReport({ today, dryRun, findings }) {
  return [
    `# Profile intelligence report, ${humanDate(today)}`,
    '',
    `Mode: **${dryRun ? 'dry run' : 'live'}**. **The output scanner blocked this run; nothing was published.**`,
    '',
    'Findings (kind and line only; the matched text is deliberately not shown):',
    '',
    ...findings.map((f) => `- ${f.file}: line ${f.line}: ${f.kind}`),
    '',
    'Fix the source (repository description, manifest text) or set `publication: "hidden"` on the entry, then re-run.',
    '',
  ].join('\n');
}
