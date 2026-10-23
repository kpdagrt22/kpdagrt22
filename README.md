# Prakash Kantumutchu (KP)

I lead and build production platforms where AI works on real data — and engineer the access controls, traces and verification that keep it dependable.

Technical Product Manager at RVM Beyond Private Limited (RVM CAD) in Faridabad, Delhi NCR — technical lead of a team of four engineers and hands-on architect and primary builder across three production systems: an AI placement platform for skilled-trade workers, a job portal, and an institute operations platform. Previously AIML Engineer at Boven Technologies and ML-Ops Trainer at Futurense; before software, five years maintaining Airbus A320 family aircraft at Air India (DGCA Category A AME).

**Case studies with sources:** [thisiskp.in](https://thisiskp.in) · [LinkedIn](https://www.linkedin.com/in/prakash-kantumutchu)

## Production Systems & Evidence

The production platforms I lead at RVM CAD are company-owned. Detailed engineering write-ups with architectural trade-offs and verification evidence are published on [thisiskp.in](https://thisiskp.in):

- **[Doors, not keys](https://thisiskp.in/work/doors-not-keys)** — Two read-only MCP connectors (19 tools across two production portals) with OAuth 2.1, hashed rotating tokens, per-call identity rechecks, bounded queries, and a 5-table audit log (15 test files / 141 tests).
- **[AI trace store](https://thisiskp.in/work/ai-trace-store)** — Six LLM call sites wired to a `CHECK`-enforced AES-256-GCM encrypted trace store with worker-scoped DSAR support, role-gated decryption, and audit-before-decrypt.
- **[One-page résumé contract](https://thisiskp.in/work/one-page-resume-contract)** — Bilingual (English + Devanagari) PDF résumé pipeline tested across 14 profile shapes × 2 audiences with a deterministic fit ladder and 32 fabrication tests (56/56 verification checks passing).
- **[Multi-tenancy without a migration](https://thisiskp.in/work/multi-tenancy-without-a-migration)** — Organization-scoped tenancy across 15 tables (postings, credits, candidates, unlocks) rolled out using `off` / `shadow` / `on` mode flags and static query gates.

## What I Work On

- **Safe AI access to real systems** — read-only connectors (MCP) with scoped identities, per-call authorisation checks, bounded queries, and audit logs.
- **AI pipelines that fail closed** — privacy boundaries, encrypted traces, and deterministic checks around model calls.
- **Production platforms end to end** — auth, multi-tenancy, payments, migrations, and CI on live systems.
- **Verification you can trust** — tests and gates that can actually fail.

## Public Code & Products in Development

| Project / Repository | What it is | Status & Verification |
| --- | --- | --- |
| [leadparrot](https://github.com/kpdagrt22/leadparrot) | High-intent buyer signal scanner and human-reviewed reply drafter (Next.js 15, TypeScript, Supabase) | Prototype built by directing AI coding agents · 139 tests passing |
| [servicelead-ai](https://github.com/kpdagrt22/servicelead-ai) | Missed-call SMS recovery and structured AI lead intake for local service businesses | Prototype built by directing AI coding agents · 74 tests passing |
| [reviewloop-ai](https://github.com/kpdagrt22/reviewloop-ai) | Customer review request automation and owner-approved AI reply drafting | Prototype built by directing AI coding agents · 114 tests passing |
| [servicequote-ai](https://github.com/kpdagrt22/servicequote-ai) | Contractor job notes to price-book-matched line-item estimates and proposals | Prototype built by directing AI coding agents · 153 tests passing |
| **StrikeHike** | Free options-analytics and education platform | In development |

**Stack I use daily:** TypeScript, Node.js (NestJS, Express), Next.js, Python (FastAPI), PostgreSQL, Drizzle ORM, Supabase, Docker, GitHub Actions, AWS Lightsail.
