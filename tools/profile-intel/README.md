# profile-intel

Every Monday at 09:00 IST this job reviews my recent engineering work on GitHub and updates, from one evidence-backed pipeline:

- this profile README: three generated blocks, nothing else;
- thisiskp.in: `src/data/recent-work.json` in `kpdagrt22/thisiskp`, which the "Recently built" section on `/projects` reads (and validates at build time). A merge there deploys the site.

No language model is involved. Every sentence it publishes is either text I already approved in this README, or a deterministic line built from GitHub evidence. It never invents achievements, outcomes, users, revenue, production status or metrics.

## How a run works

```
discover ─► activity ─► classify ─► evidence ─► technologies ─► manifest ─► readme / portfolio ─► scanner ─► publish ─► report
```

| Module | What it does |
| --- | --- |
| `discover.mjs` | Lists every repository the token's owner owns; keeps those pushed to in the window. Skips archived repositories, this profile repository (the pipeline writes here) and two snapshot copies of company repositories (excluded by numeric id in `config.mjs`). |
| `activity.mjs` | For each candidate: commits authored by `kpdagrt22` on the default branch since the window start, merged pull requests (search `is:pr author:kpdagrt22 is:merged merged:>=…`) with their files and commits, and releases. Public repositories outside the account (upstream contributions such as Kubernetes) are read through their merged pull requests. Company organisations (`companyOrgs` in `config.mjs`: RVM CAD's) are counted, never read, even where a repository is public: that work stays in the manual entries. Other private repositories outside the account are counted, never read. |
| `classify.mjs` | Decides meaningful work versus noise and records the reason for every decision: bots (any `[bot]`, Dependabot, Renovate…), dependency bumps, merge commits, formatting, typo and lint-only changes, lockfile-only and generated-only changes, docs-only changes under 300 changed lines, changes under 3 lines, revert pairs (both sides drop; a revert of older work removes that evidence from the manifest), and the pipeline's own commits and PRs. Commits inside a merged PR count once, through the PR. |
| `evidence.mjs` | A public evidence link is stored only if it returns HTTP 200 to a signed-out reader. |
| `technologies.mjs` | Strong evidence only: a language counts when GitHub's linguist puts it at 5,000+ bytes and 3%+ of the repository; a framework counts only when a dependency manifest declares it **and** the code imports it (or loads it through its own config file, such as `next.config.*`). Declared-but-unused dependencies never count. Run only when a repository has new meaningful work that is not documentation; never for forks or upstream repositories, whose code is mostly not mine. |
| `manifest.mjs` | Merges the week's evidence into `data/projects.manifest.json` (rules below). |
| `selection.mjs`, `readme.mjs`, `portfolio.mjs` | Render from the manifest only, with no clock, so an unchanged manifest renders byte-identical output. The two "last changed" dates (the README's `updated` block and `recent-work.json`'s `updated`) move only when the content around them changes. `portfolio.mjs` also holds the site's schema checks (`validateRecentWork`). |
| `scanner.mjs` | Mandatory gate (below). |
| `publish.mjs` | One pull request per target repository (below). |
| `report.mjs` | The weekly report: job summary and `out/report.md`. |
| `run.mjs` | Orchestrates the above. |

### What counts as "meaningful"

Kept: features, fixes, refactors, tests, CI and other code changes of 3+ lines; documentation of 300+ changed lines; merged pull requests (judged on their files); published releases; a new repository with at least 2,000 bytes of real code and at least one commit in the window authored by `kpdagrt22` (a repository whose commits all come from another identity, such as a coding agent's, is not counted as my work). When the per-run budget for commit details runs out (100 per repository, 400 per run), a commit is judged by its message alone and kept only if it is a `feat`, `fix`, `perf` or `refactor`.

### README blocks

The pipeline owns exactly three marked blocks and never changes a byte outside them; every run checks that removing the blocks gives back the base README exactly, and refuses to publish otherwise.

| Block | Where | Content |
| --- | --- | --- |
| `profile-intel:recent` | before `## Path` | "Latest engineering work": up to 6 published projects with meaningful activity in the 90 days before the newest activity, newest first. Public projects link to their latest commits or PRs; private ones are named, with no link. |
| `profile-intel:updated` | right after it | The date the generated content last changed. It moves only when `recent` or `stack` changes. |
| `profile-intel:stack` | under the stack image | "In active use": languages and frameworks with strong evidence from projects active in the same 90 days (learning projects and case studies excluded). |

If `## Path` or the stack image disappears, the run fails rather than guessing where to write.

### Portfolio data: `src/data/recent-work.json` on thisiskp.in

| Field | Content |
| --- | --- |
| `schemaVersion` | `1` |
| `updated` | The date (IST) the file's content last changed. Kept from the copy on thisiskp.in `main` while everything else is identical, so an unchanged week gives an identical file and no PR. The site shows it ("last changed …") and uses it for `/projects`' sitemap `lastmod`, so a changed list is also sent to IndexNow by the site's deploy. |
| `source`, `latestActivity`, `activeWindowDays`, `activeStack` | Where the data comes from, the newest activity date, the 90-day window and the technologies in active use (as in the README's stack block). |
| `recent` | Ids shown under "Recently built", newest first: the same selection as the README's "Latest engineering work" (`recentEntries`). |
| `items[]` | Every published entry with meaningful activity: `id`, `name`, `category`, `role`, `status`, `statusText`, `summary` (+ `summaryFormat`: `markdown` for owner text, `text` for repository descriptions), `technologies`, `technologiesInUse` (strong evidence only), `visibility`, `liveUrl`, `repoUrl` (always `null` when private), `lastMeaningfulActivity`, `evidence` (public only, newest 5). |

The site's build parses the file with a Zod schema (`src/data/recent-work.ts` in thisiskp) and fails on any mismatch, private repository links included; the pipeline runs the same checks first (`validateRecentWork`) and refuses to publish a file the site would reject.

## Manifest: `data/projects.manifest.json`

`schemaVersion: 1`, `owner`, and `entries[]`. Each entry:

| Field | Meaning | Who writes it |
| --- | --- | --- |
| `id` | Stable slug. Auto entries: `repo-…`, `fork-…`, `upstream-…`. | set once |
| `name`, `shortDescription`, `detailedDescription`, `category`, `role`, `status`, `statusText`, `verifiedContributions[]`, `technologies[]`, `liveUrl` | The entry's text. Manual entries: copied verbatim from this README and never rewritten. Auto entries: name = repository name; summary = repository description, or a neutral line from its languages and creation date when there is none; status `null` unless GitHub says archived; `technologies` = the detected ones. | owner (manual) / pipeline (auto) |
| `status` | `active`, `in-development`, `beta`, `live`, `archived` or `null`; `statusText` (optional, manual) is the README's own wording, shown instead. | |
| `repo`, `repoId`, `repoUrl` | Repository as `owner/name`, optional numeric id, and link. Private repositories never have a `repoUrl`. | owner / pipeline |
| `visibility` | `public` / `private`, refreshed from GitHub every run. | pipeline |
| `publication` | `approved` (default: everything with meaningful activity is published) or `hidden`. | owner |
| `source` | `manual` (owner text, frozen) or `auto`. Change an auto entry to `manual` to freeze its text. | owner |
| `readmeSection` | For manual entries, the README section the text was copied from. | owner |
| `firstDiscovered` | Date the entry was added. | set once |
| `lastMeaningfulActivity` | Date (IST) of the newest meaningful evidence. Only ever moves forward, and only with new evidence. | pipeline |
| `lastPortfolioUpdate` | Date the entry's item in `recent-work.json` last changed. | pipeline |
| `technologyEvidence` | `{ name: { kind: language|framework, reason } }`, refreshed when the repository has new meaningful work. For private repositories the reason never names a file. | pipeline |
| `evidence[]` | Newest 12 items, plus the README commit the manual text came from. Public: `type`, `ref`, `date`, `url`, `title`. Private: `type`, an opaque `ref` (a hash) and `date` only. | pipeline |

To hide something: set `"publication": "hidden"`. To hide a repository without writing its name into this public file, use an entry with only an id and its numeric id: `{ "id": "x", "repoId": 123, "publication": "hidden", … }`. Hidden entries are never rendered or exported and receive no evidence.

## Owner decisions (binding)

1. **No approvals.** Every discovered project with meaningful activity is published, private repositories included; forks only when they hold meaningful commits of mine. `publication: "hidden"` is the only exclusion.
2. **Private repositories** may be described (name, a one-line summary from the repository description or the neutral line, technologies, dates, status only when verified) but never with a link to the repository, code or file contents, secrets, tokens, keys, environment-variable names or values, internal hostnames, IPs or URLs, emails, phone numbers, or client or person names. In practice nothing from a private repository is published except its name, its description, the dates of its meaningful changes, and the *names* of the languages and frameworks it uses (detection reads dependency manifests and source imports inside the runner, in memory, and keeps only the names); commit messages and PR titles of private repositories are never published, and a private description that contains a URL, a domain, an environment-variable-like name or anything the scanner flags is replaced by the neutral line.
3. **No human approval.** The workflow opens a PR per target repository (the audit trail), validates it, then merges it through the API when GitHub reports it clean: a merge commit when the repository allows one, otherwise the method it does allow (this repository currently allows only rebase merging, so that is what is used, and the report says so; `kpdagrt22/thisiskp` allows merge commits, so its PRs get one). The branch is deleted afterwards. Repository variable `PROFILE_INTEL_AUTOMERGE=false` (on this repository) is the kill switch for both targets (PRs are left open). A manual run with `dry_run` pushes nothing.
4. **No description → neutral line** built from languages and dates, e.g. "TypeScript and Python codebase, created Jun 2026."

## The output scanner

Everything that would be published is scanned before anything is pushed: the generated README blocks, the manifest, `recent-work.json` (exactly the text that is committed to thisiskp), both PR bodies, `decisions.json`, the added lines of the three diffs (README, manifest, `recent-work.json` against thisiskp `main`), and the report (which is also the job summary). It looks for GitHub tokens (`ghp_`, `gho_`, `ghs_`, `github_pat_`…), `sk-` and Stripe-style keys, Google API keys, AWS access keys, Slack tokens, JWTs, private-key blocks, credentials inside URLs, long hex strings (commit SHAs only where git puts them: `/commit/`, `/blob/`, `owner/repo@`), high-entropy base64 strings, email addresses, phone numbers, IPv4 and IPv6 addresses, URLs to non-public hosts (localhost, IP literals, single-label names, `.internal`, `.local`, `.corp`…), and any link to a private repository. One hit fails the run before anything is written to GitHub; the report then lists the file, line and kind of each finding, never the matched text. The owner's own contact details in the hand-written part of this README are outside the generated blocks and are not scanned or touched.

## Publishing

- Branch `auto/profile-intel`, one commit on top of the exact base commit the run read; one PR per target repository. An open PR from a previous run is updated, never duplicated. Nothing is pushed when the generated files equal the base branch, so **a week without meaningful new work produces no PR**.
- Before merging, the PR must change exactly the expected files, its head must still be the commit the run made, and GitHub must report it `clean`. Anything else leaves it open for review.
- The pipeline never pushes to `main` (enforced in code: it only writes `auto/*` branches).
- Requests retry with backoff on 5xx, 429 and secondary rate limits (bounded per request).
- Portfolio: on (`PORTFOLIO_PUBLISH: 'true'` in the workflow). The run reads **`src/data/recent-work.json`** from `kpdagrt22/thisiskp` `main` at the start (dry runs too), dates and validates the new file against it, and publishes through the same flow: branch `auto/profile-intel` in thisiskp, one commit on the `main` commit it read, one PR (an open one is updated), skipped when nothing differs, merged when GitHub reports it clean unless `PROFILE_INTEL_AUTOMERGE=false`. A merge to thisiskp `main` deploys the site; its deploy builds first, and the build fails on a file that does not match the site's schema, so bad data never ships. If thisiskp cannot be read, the run fails before anything is pushed (with publishing off, it only warns). The portfolio PR is attempted only after the profile PR step succeeded. Set `PORTFOLIO_PUBLISH: 'false'` to stop publishing to the site; the file is still produced in `out/portfolio/`.
- thisiskp has no pull-request checks of its own (its only workflow runs on pushes to `main`), so GitHub reports the portfolio PR clean as soon as it is mergeable; the pipeline's own checks above are the gate before the merge, and the site's build is the gate before the deploy.

## Schedule, secrets, outputs

- `.github/workflows/profile-intel.yml`: cron `30 3 * * 1` (Monday 09:00 IST) and `workflow_dispatch` (inputs `dry_run`, `since_days`, default 7). Concurrency group `profile-intel` (runs queue, never cancel each other); 20-minute timeout; workflow token `contents: read` only.
- Secret `PROFILE_TOKEN`: fine-grained, owner `kpdagrt22`, all repositories, Contents read/write, Pull requests read/write, Metadata read. No administration, workflow or secrets scope.
- Variable `PROFILE_INTEL_AUTOMERGE` (optional, default `true`).
- Every run uploads `out/` as an artifact for 30 days: `report.md`, `decisions.json` (every decision with its reason; private repositories without titles or refs), `profile/README.md` and `README.diff`, `profile/data/projects.manifest.json` and `manifest.diff`, `portfolio/recent-work.json` and `recent-work.diff` (against thisiskp `main`: the site change the run publishes, or would publish), `pr-body.md`. The report is also the job summary.
- A failed run fails the workflow, and GitHub's failed-workflow email is the alert. Nothing partial is published: all outputs are generated and scanned before the first write.
- If the manifest has not changed for longer than the window (a failed run, a PR left open), the next run reaches back to the manifest's last change, up to 35 days, so no week is lost.

## Run it locally

```sh
GH_TOKEN=$(gh auth token) node tools/profile-intel/run.mjs --dry-run --since-days 30
node --test "tools/profile-intel/test/*.test.mjs"
```

A dry run reads `main` of both repositories through the API, writes everything to `out/` (git-ignored) and pushes nothing; add `PORTFOLIO_PUBLISH=true` to have the report say what it would publish to thisiskp (`out/portfolio/recent-work.diff` is written either way). To prove a re-run changes nothing, feed the outputs back in: `--base-from out/profile --portfolio-base-from out/portfolio/recent-work.json`. Node 22+, no npm dependencies.

## Limitations

- **RVM CAD work stays manual.** `PROFILE_TOKEN` sees only repositories owned by `kpdagrt22`. BadaBhai, the Job Portal, the Scheduler and Team RVM live in the company's organisation, so their entries stay manual, copied verbatim from this README, and are never updated automatically. Two of those repositories are public, so the pull request search does return my merged PRs there; by design they are only counted in the report (their titles carry internal detail such as configuration names). To publish them as evidence instead, remove the organisation from `companyOrgs` and set `repo` on the matching manual entries.
- The client material-control system is not in this account either; its entry is manual.
- Commit authorship is matched by the `kpdagrt22` login: commits made from an e-mail address that is not linked to the account, or under a coding agent's own identity, are not found.
- Fork activity counts only on the fork's default branch; work on feature branches of forks shows up once it is merged upstream (as an upstream PR).
- Framework detection samples up to 80 source files per repository; a framework imported only in files outside the sample is not recorded.
- Private repositories: a revert of a change recorded in an earlier week cannot be matched to the stored (hashed) evidence, so `lastMeaningfulActivity` may still reflect it.
- Manual entries are not re-checked against the README automatically; when README text changes, the report warns that the manifest no longer matches it verbatim.

## Rollback

Each weekly change is one merge (or rebased commit) titled "… [profile-intel]", in each repository it touched. Revert it on GitHub or with `git revert` (reverting the thisiskp merge redeploys the previous list). To stop the job, disable the workflow in the Actions tab; to stop merges but keep the PRs, set `PROFILE_INTEL_AUTOMERGE=false`; to stop only the site updates, set `PORTFOLIO_PUBLISH: 'false'` in the workflow.
