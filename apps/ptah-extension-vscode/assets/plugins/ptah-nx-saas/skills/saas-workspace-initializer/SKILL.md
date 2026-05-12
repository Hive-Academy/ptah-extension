---
name: saas-workspace-initializer
description: Two-stage SaaS bootstrap workflow. Stage A (this skill, single chat session) discovers framework + scope, writes a phased roadmap to `.ptah/roadmap.md`, and scaffolds only the foundation (Nx workspace, base apps, lint/test/CI, plus tenant/auth/DB primitives if discovery makes them load-bearing). Stage B is each unchecked roadmap item run later as its own task via the orchestration skill or project-manager agent. Use when starting a new SaaS project, initializing an Nx + NestJS + Angular/React workspace, or setting up multi-tenant foundations. Do not use to implement features end-to-end in one session.
---

# SaaS Workspace Initializer

Two-stage bootstrap for SaaS applications on Nx + NestJS + Angular/React. This skill owns Stage A only: discovery, roadmap, and foundation scaffold. Stage B (every other module) runs in separate sessions, one task at a time.

## Trigger Keywords

- "new SaaS project", "start SaaS", "create SaaS", "bootstrap SaaS"
- "multi-tenant", "multitenancy"
- "Nx monorepo", "NestJS + Angular", "NestJS + React"
- "initialize workspace", "scaffold workspace"

## Contract

### Stage A — Roadmap + Foundation (this skill, single session)

```
a) Discovery        — framework + SaaS scope questions
b) Roadmap          — write `.ptah/roadmap.md` (phased checklist with charters)
c) Foundation       — scaffold workspace + only the primitives Stage B depends on
d) Handoff          — emit "Foundation complete. Next tasks (run each in a new session): ..."
e) STOP             — do not implement features in this session
```

### Stage B — Per-module implementation (other sessions, NOT this skill)

Each unchecked item in `.ptah/roadmap.md` is its own task. The user starts a new chat and runs `/orchestrate <roadmap item>` (or invokes the project-manager agent) for that item. The companion skills in this plugin (`nx-workspace-architect`, `nestjs-backend-patterns`, `webhook-architecture`, `resilient-nestjs-patterns`, `saas-platform-patterns`, `nestjs-deployment`) activate per-module during Stage B. Do not attempt to re-orchestrate the full project from this skill.

## Step a) Discovery

Ask only what is needed to make foundation decisions. Skip questions that have no impact on Stage A scaffolding — push them into the relevant roadmap item's charter instead.

### Required (always ask)

1. **Frontend framework**: Angular or React?
   - Angular -> loads `angular-frontend-patterns` in Stage B
   - React -> loads `react-best-practices` + `react-nx-patterns` in Stage B
2. **SaaS shape**: B2B, B2C, or both?
3. **Tenant model**:
   - Single-tenant (one customer per deployment)
   - Multi-tenant — shared DB with row-level isolation
   - Multi-tenant — schema per tenant
   - Multi-tenant — database per tenant
4. **Authentication shape**:
   - Built-in JWT
   - External provider (Clerk, Auth0, WorkOS, Cognito, Supabase Auth, etc.)
   - SSO/SAML required from day one
5. **Core domains**: 2-3 bounded contexts (e.g., Orders, Users, Billing)

### Conditional (ask only when relevant)

6. **Billing model** (only if monetization is in MVP scope): freemium, trial-to-paid, usage-based, seat-based, or hybrid
7. **Compliance** (only if user mentions enterprise/health/finance): GDPR, SOC2, HIPAA, PCI
8. **Inbound integrations** (only if user mentions external services): which webhooks land on day one
9. **Deployment target** (only if user has a fixed target): Docker/K8s, serverless, PaaS

Record answers in `.ptah/scope-decisions.md` (one section per question, with the chosen value and a one-sentence rationale).

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

- Nx workspace with the chosen frontend preset.
- Base apps: one frontend (`apps/web`), one NestJS API (`apps/api`).
- ESLint with module-boundary rules; Prettier; Jest/Vitest test config.
- `libs/shared/domain` (base classes), `libs/api-interfaces` (DTOs/contracts).
- Minimal CI (lint + typecheck + test on PR). No deploy pipeline yet.
- README pointing future contributors at `.ptah/roadmap.md`.

### Include only when discovery makes them load-bearing

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

### Companion skills (activate per-module during Stage B)

- [nx-workspace-architect](../nx-workspace-architect/SKILL.md) — library structure for new modules
- [nestjs-backend-patterns](../nestjs-backend-patterns/SKILL.md) — provider pattern, auth, multitenancy, Prisma
- [webhook-architecture](../webhook-architecture/SKILL.md) — 3-layer webhook handling
- [resilient-nestjs-patterns](../resilient-nestjs-patterns/SKILL.md) — orchestration, retries, events, dynamic modules
- [saas-platform-patterns](../saas-platform-patterns/SKILL.md) — billing, licensing, subscriptions
- [nestjs-deployment](../nestjs-deployment/SKILL.md) — Docker, hardening, migrations

### External skills

- [ddd-architecture](../../ptah-core/skills/ddd-architecture/SKILL.md) — domain modeling for Stage B charters
- [orchestration](../../ptah-core/skills/orchestration/SKILL.md) — runs each Stage B roadmap item
- [angular-frontend-patterns](../../ptah-angular/skills/angular-frontend-patterns/SKILL.md)
- [react-best-practices](../../ptah-react/skills/react-best-practices/SKILL.md)
- [react-nx-patterns](../../ptah-react/skills/react-nx-patterns/SKILL.md)
