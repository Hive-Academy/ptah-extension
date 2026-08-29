---
name: saas-workspace-initializer
description: Two-stage SaaS bootstrap workflow. Stage A (this skill, single chat session) runs mandatory two-round AskUserQuestion discovery (business, then stack), names bounded contexts and lib layout via the ddd-architecture and nx-workspace-architect skills, writes a phased roadmap to `.ptah/roadmap.md`, and scaffolds only the foundation (Nx workspace, base apps, lint/test/CI, plus tenant/auth/DB primitives if discovery makes them load-bearing). Stage B is each unchecked roadmap item run later as its own task via the orchestration skill or project-manager agent. Use when starting a new SaaS project, initializing an Nx + NestJS + Angular/React workspace, or setting up multi-tenant foundations. Do not use to implement features end-to-end in one session.
---

# SaaS Workspace Initializer

Two-stage bootstrap for SaaS applications. Recommended default stack is Nx + NestJS + Angular/React, but the discovery answers in Step a override the default whenever the user picks a different stack. This skill owns Stage A only: discovery, domain/workspace design, roadmap, and foundation scaffold. Stage B (every other module) runs in separate sessions, one task at a time.

## Shared Stage A contract

This skill is the canonical home of the **Stage A contract** every per-stack initializer specializes: the two-round `AskUserQuestion` discovery protocol (Round 1 business questions are stack-agnostic and reused verbatim; where the `AskUserQuestion` tool is unavailable, the same questions are asked in plain text and answered before the run continues), the `.ptah/roadmap.md` schema in [references/roadmap-format.md](references/roadmap-format.md), and the foundation-scaffold-then-stop rule (Steps c-e). A per-stack initializer such as [`dotnet-solution-initializer`](../dotnet-solution-initializer/SKILL.md) (ptah-dotnet plugin -- the link resolves because every plugin's skills land as siblings in one flat skills namespace at runtime, regardless of which plugin's source directory they ship from; resolve it relative to this file, never against a workspace-relative path) links back here for Round 1 and the roadmap schema instead of duplicating them, and only states its own stack-specific Round 2 questions and foundation triggers. When editing Round 1's questions or the roadmap schema, remember every specializing initializer inherits the change -- verify them too, not just this plugin's own command and companion skills.

## Trigger Keywords

- "new SaaS project", "start SaaS", "create SaaS", "bootstrap SaaS"
- "multi-tenant", "multitenancy"
- "Nx monorepo", "NestJS + Angular", "NestJS + React"
- "initialize workspace", "scaffold workspace"

## Contract

### Stage A — Roadmap + Foundation (this skill, single session)

```
a) Discovery        — mandatory two-round AskUserQuestion: business, then stack
a2) Domain + workspace design — ddd-architecture names bounded contexts/aggregates;
                     nx-workspace-architect derives lib layout + tags
b) Roadmap          — write `.ptah/roadmap.md` (phased checklist with charters)
c) Foundation       — scaffold workspace + only the primitives Stage B depends on
d) Handoff          — emit "Foundation complete. Next tasks (run each in a new session): ..."
e) STOP             — do not implement features in this session
```

### Stage B — Per-module implementation (other sessions, NOT this skill)

Each unchecked item in `.ptah/roadmap.md` is its own task. The user starts a new chat and runs `/orchestrate <roadmap item>` (or invokes the project-manager agent) for that item. The companion skills in this plugin (`nestjs-backend-patterns`, `webhook-architecture`, `resilient-nestjs-patterns`, `saas-platform-patterns`, `nestjs-deployment`) activate per-module during Stage B. `nx-workspace-architect` and `ddd-architecture` already ran once, in Step a2 of this skill, to seed the roadmap; Stage B re-invokes `nx-workspace-architect` per module for each new library's layout. Do not attempt to re-orchestrate the full project from this skill.

## Step a) Discovery — mandatory, two-round `AskUserQuestion`

Discovery is not optional and answers are never assumed. Ask every choice question through the `AskUserQuestion` tool (2-4 options each) — not as prose. If the `AskUserQuestion` tool is unavailable in this harness, ask the same question in plain text, listing the same options, and wait for the answer before proceeding — the tool may degrade, the question may not. Never answer a discovery question on the user's behalf. Never proceed to Step a2 or scaffolding while a required question is unanswered.

If the seed prompt already contains an intake block (product, users, constraints), read it first. Acknowledge what it already answers and skip those questions; still ask everything the intake block leaves open.

### Round 1 — Business (ask first, always)

1. **What are you building?** Free text. If the intake block already answers this, restate it back to the user for confirmation instead of re-asking.
2. **Who is the customer?** — B2B / B2C / Internal tool / Recommend for me
3. **Core jobs-to-be-done.** Ask for 2-3 candidate domains (e.g., "Orders, Users, Billing"). Free text; offer example domain sets as options if the user is unsure.
4. **MVP scope.** What ships first vs. later. Free text.
5. **Monetization?** — Yes / No / Undecided

Do not start Round 2 until every Round 1 question is answered.

### Round 2 — Stack (ask after Round 1 is complete)

1. **Frontend** — Angular / React / Recommend for me
   - Angular -> loads `angular-frontend-patterns` in Stage B
   - React -> loads `react-best-practices` + `react-nx-patterns` in Stage B
2. **API** — NestJS / Other / Recommend for me
3. **DB/ORM** — Prisma + ZenStack / Other / Recommend for me
4. **Auth shape** — Built-in JWT / External provider (Clerk, Auth0, WorkOS, Cognito, Supabase Auth, etc.) / SSO/SAML required from day one / Recommend for me
5. **Tenancy** — Single-tenant / Multi-tenant, shared DB with row-level isolation / Multi-tenant, schema per tenant / Multi-tenant, database per tenant / Recommend for me

When the user picks "Recommend for me," name the default from Step c's tables and give a one-sentence rationale before moving on. Discovery answers override every default in this skill — the Step c defaults apply only when the user asks for a recommendation.

### Conditional (ask only when relevant)

6. **Billing model** (only if monetization = Yes): freemium, trial-to-paid, usage-based, seat-based, or hybrid
7. **Compliance** (only if user mentions enterprise/health/finance): GDPR, SOC2, HIPAA, PCI
8. **Inbound integrations** (only if user mentions external services): which webhooks land on day one
9. **Deployment target** (only if user has a fixed target): Docker/K8s, serverless, PaaS

Record answers in `.ptah/scope-decisions.md` (one section per question, with the chosen value and a one-sentence rationale).

## Step a2) Domain + Workspace Design

Run after discovery, before Step b (Roadmap) and before any scaffolding.

1. Invoke the [`ddd-architecture`](../ddd-architecture/SKILL.md) skill (ptah-core plugin) with the Round 1 answers — jobs-to-be-done, candidate domains, MVP scope. It names the bounded contexts and aggregates. Discovery answers are already available; `ddd-architecture` does not re-ask its own discovery questions when invoked this way (see its "When to Engage User" note).
2. Invoke the [`nx-workspace-architect`](../nx-workspace-architect/SKILL.md) skill with the bounded contexts from step 1 and the Round 2 stack answers. It derives the lib layout, naming, and tags for the foundation.
3. Both outputs seed Step b's roadmap: the bounded contexts become Phase 3 (Domain Modules) items; the lib layout becomes the Foundation phase's library list.

## Step b) Roadmap

Write `.ptah/roadmap.md` following `references/roadmap-format.md`. Rules:

- **Markdown checklist**, grouped by phase, top-down dependency order.
- **Phase 1 is always "Foundation"** and contains only what Stage A will scaffold in step (c). Mark every Foundation item as `[x]` once scaffolded.
- Every other phase contains `[ ]` items. Each item has:
  - One-paragraph **charter** (what it builds, why it matters, success signal).
  - **Depends on:** line listing prior roadmap items by slug.
- Group remaining work into phases such as: Tenancy & Auth, Domain Modules, Billing & Monetization, Integrations & Webhooks, Resilience & Events, Deployment & Hardening, QA & Launch. Drop phases that discovery proved out of scope (e.g., no billing in MVP).
- Read `references/roadmap-format.md` before writing. Match the schema exactly so Stage B sessions can parse it.

## Step c) Foundation Scaffold

Scaffold ONLY what is load-bearing for Stage B. Decide scope from discovery answers. Do not bundle features.

### Always include

- Nx workspace with the frontend and API frameworks chosen in Round 2 discovery (NestJS is the default API framework).
- Base apps: one frontend (`apps/web`), one API (`apps/api`).
- ESLint with module-boundary rules; Prettier; Jest/Vitest test config.
- `libs/shared/domain` (base classes), `libs/api-interfaces` (DTOs/contracts), following the lib layout from Step a2.
- Minimal CI (lint + typecheck + test on PR). No deploy pipeline yet.
- README pointing future contributors at `.ptah/roadmap.md`.

### Include only when discovery makes them load-bearing

The triggers and additions below are the default when the user picks "Recommend for me" in Round 2. An explicit Round 2 answer (e.g., a different ORM) overrides the corresponding row.

| Trigger from discovery                                                  | Add to foundation                                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Multi-tenant from day one (any tenant model other than single-tenant)   | Prisma + ZenStack baseline, tenant context middleware stub, `libs/shared/infrastructure/tenant` |
| External auth provider OR SSO required day one                          | `libs/shared/infrastructure/auth` with provider interface stub (no concrete provider yet)       |
| Persistent storage required for first domain (true for almost all SaaS) | Prisma library + initial `schema.prisma` with `User` + `Tenant` (if multi-tenant) only          |
| Billing in MVP                                                          | Nothing in foundation — billing lives entirely in Stage B (`saas-platform-patterns`)            |
| Webhooks in MVP                                                         | Nothing in foundation — webhook layer lives in Stage B (`webhook-architecture`)                 |
| Real-time/SSE in MVP                                                    | Nothing in foundation — events live in Stage B (`resilient-nestjs-patterns`)                    |
| Compliance flagged (SOC2/HIPAA/PCI)                                     | Add audit-log primitive to Prisma schema; defer the rest to a Compliance phase                  |

If a trigger does not fire, do NOT scaffold the corresponding library. Stage B will create it with the right context.

### Verification before handoff

- `npm install` succeeds.
- `nx run-many -t lint,typecheck,test` passes (with empty/placeholder tests where needed).
- `nx graph` renders without errors.
- `.ptah/roadmap.md` and `.ptah/scope-decisions.md` exist and are committed-ready.

## Step d) Handoff

Emit exactly this block, with the next phase's items expanded:

```
Foundation complete.

Roadmap written to .ptah/roadmap.md.
Scope decisions recorded in .ptah/scope-decisions.md.

Next tasks (run each in a NEW chat session, one at a time):

  /orchestrate <slug-1>   # <charter one-liner>
  /orchestrate <slug-2>   # <charter one-liner>
  ...

Each task will activate the relevant companion skill
(nx-workspace-architect, nestjs-backend-patterns, webhook-architecture,
resilient-nestjs-patterns, saas-platform-patterns, nestjs-deployment)
and pick up dependencies from the roadmap.
```

List only the next phase's items (typically Tenancy & Auth or Domain Modules). Do not list every roadmap item.

## Step e) STOP

After the handoff block, the session is done. Do not:

- Implement any feature library, controller, or service beyond the foundation table above.
- Pre-create empty stubs for future roadmap items.
- Re-enter discovery for items already on the roadmap.
- Spawn parallel orchestrations for multiple roadmap items.

If the user pushes for "just one more thing" in the same session, decline and point them at `/orchestrate <slug>` in a fresh chat. Stage A's value is a clean handoff; bundling kills it.

## References

### Stage A artifacts

- [references/roadmap-format.md](references/roadmap-format.md) — `.ptah/roadmap.md` schema, charter format, dependency notation, full example.

### Companion skills

- [nx-workspace-architect](../nx-workspace-architect/SKILL.md) — lib layout + tags in Step a2, then library structure for new modules during Stage B

The rest activate per-module during Stage B only:

- [nestjs-backend-patterns](../nestjs-backend-patterns/SKILL.md) — provider pattern, auth, multitenancy, Prisma
- [webhook-architecture](../webhook-architecture/SKILL.md) — 3-layer webhook handling
- [resilient-nestjs-patterns](../resilient-nestjs-patterns/SKILL.md) — orchestration, retries, events, dynamic modules
- [saas-platform-patterns](../saas-platform-patterns/SKILL.md) — billing, licensing, subscriptions
- [nestjs-deployment](../nestjs-deployment/SKILL.md) — Docker, hardening, migrations

### External skills

- [ddd-architecture](../ddd-architecture/SKILL.md) — ptah-core plugin; bounded contexts/aggregates in Step a2, then domain modeling for Stage B charters
- [orchestration](../orchestration/SKILL.md) — ptah-core plugin; runs each Stage B roadmap item
- [angular-frontend-patterns](../angular-frontend-patterns/SKILL.md)
- [react-best-practices](../react-best-practices/SKILL.md)
- [react-nx-patterns](../react-nx-patterns/SKILL.md)
