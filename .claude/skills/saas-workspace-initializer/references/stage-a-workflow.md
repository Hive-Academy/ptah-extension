# Stage A discovery, design, roadmap, and foundation

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
5. **Tenancy** — Single-tenant / Multi-tenant, shared DB with row-level isolation / Multi-tenant, dedicated schema or database (ask which next) / Recommend for me

When the user picks "Recommend for me," choose Angular, NestJS, Prisma + ZenStack for multi-tenant (Prisma otherwise), and built-in JWT unless SSO or an external provider was requested. Recommend shared-DB multi-tenancy for B2B SaaS and single-tenancy for B2C or internal tools; ask if the customer model is unclear. Name each choice with a one-sentence rationale before moving on. Discovery answers override these defaults.

### Conditional (ask only when relevant)

6. **Billing model** (only if monetization = Yes): freemium / trial-to-paid / usage-based, seat-based, or hybrid (ask which next) / undecided
7. **Compliance** (only if user mentions enterprise/health/finance): GDPR, SOC2, HIPAA, PCI
8. **Inbound integrations** (only if user mentions external services): which webhooks land on day one
9. **Deployment target** (only if user has a fixed target): Docker/K8s, serverless, PaaS

Record answers in `.ptah/scope-decisions.md` (one section per question, with the chosen value and a one-sentence rationale).

## Step a2) Domain + Workspace Design

Run after discovery, before Step b (Roadmap) and before any scaffolding.

1. Invoke the `ddd-architecture` skill (ptah-core plugin) with the Round 1 answers — jobs-to-be-done, candidate domains, MVP scope. It names the bounded contexts and aggregates. Discovery answers are already available; `ddd-architecture` does not re-ask its own discovery questions when invoked this way (see its "When to Engage User" note).
2. Invoke the [`nx-workspace-architect`](../../nx-workspace-architect/SKILL.md) skill with the bounded contexts from step 1 and the Round 2 stack answers. It derives the lib layout, naming, and tags for the foundation.
3. Both outputs seed Step b's roadmap: the bounded contexts become Phase 3 (Domain Modules) items; the lib layout becomes the Foundation phase's library list.

## Step b) Roadmap

Write `.ptah/roadmap.md` following `roadmap-format.md`. Rules:

- **Markdown checklist**, grouped by phase, top-down dependency order.
- **Phase 1 is always "Foundation"** and contains only what Stage A will scaffold in step (c). Mark every Foundation item as `[x]` once scaffolded.
- Every other phase contains `[ ]` items. Each item has:
  - One-paragraph **charter** (what it builds, why it matters, success signal).
  - **Depends on:** line listing prior roadmap items by slug.
- Group remaining work into phases such as: Tenancy & Auth, Domain Modules, Billing & Monetization, Integrations & Webhooks, Resilience & Events, Deployment & Hardening, QA & Launch. Drop phases that discovery proved out of scope (e.g., no billing in MVP).
- Read `roadmap-format.md` before writing. Match the schema exactly so Stage B sessions can parse it.

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
