# TASK_2026_170 — Context

**Type**: BUGFIX (security-adjacent)
**Workflow**: Partial (Architect → Team-Leader → Developers → QA)
**Created**: 2026-08-01
**Source**: `docs/handoff-license-server-validation-pipe.md` (discovered during TASK_2026_169)

## User Intent

The global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` in
`apps/ptah-license-server/src/main.ts` is **inert**. Nx builds the license server with
`@nx/esbuild:esbuild`, and esbuild does not implement `emitDecoratorMetadata`. Without
`design:paramtypes`, `ValidationPipe.transform()` short-circuits on `if (!metatype ...) return value`
and every `@Body()` / `@Query()` payload is returned unvalidated and untransformed — including on
unauthenticated public endpoints.

Goal: make `class-validator` decorators actually run on every endpoint, without breaking callers
that currently rely on the accidental permissiveness.

## Decisions (Checkpoint 1.5 + 0.1)

| Decision       | Choice                                                                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fix strategy   | **Hybrid** — Option A (`dtoPipe` per endpoint) now; Option B (esbuild `emitDecoratorMetadata` plugin) recorded as a follow-up in `future-enhancements.md`, not implemented here.                                                                                          |
| Scope          | **All three tiers** — 10 controllers / 16 DTO files, executed in tier order (public → authenticated → admin), commit per controller.                                                                                                                                      |
| Webhooks       | **Leave alone** — `/webhooks/paddle` and `/webhooks/resend` are explicitly out of scope. Third-party payload shapes change without notice; `forbidNonWhitelisted` would 400 valid webhooks. Record the exclusion explicitly (allowlist comment + G7 exclusion note).      |
| CLI delegation | **Enabled** — `claude cli` (`pc-80b7d104-ddb5-4ab1-adab-d033f7d4de13`). Also available: `ollama cloud` (`pc-d8f4e156-fa15-4dc6-92ba-8e088e7e9ae9`). `cursor` not installed. Max 3 concurrent. Orchestrator is the sole spawner for batches; team-leader is advisory only. |

## Scope expansion after B0 — route & controller restructure

User: _"lets systematically and architecturally fix the 2 defects by properly splitting the
controllers and having solid routes."_ Plan: `restructure-plan.md`.

**The defect, measured**: seven controllers claim the `v1/admin` namespace; two claim the _identical_
prefix `v1/admin` with **different guard chains** (`JwtAuthGuard + AdminGuard` vs `AdminApiKeyGuard`).
`admin/AdminController`'s three wildcards (`@Get(':model')`, `@Get(':model/:id')`,
`@Patch(':model/:id')`) produce **ten cross-controller route contests**, every one arbitrated by
module order in `app.module.ts`'s `imports` array. The only defence is a comment at
`app.module.ts:66-71`. No test asserts route resolution.

| Decision              | Choice                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route cutover         | **Hard cutover** — routes and callers change together. No aliases, no dual-mounting.                                                                                                                                                                                                                                                     |
| Auth route            | **`auth` → `v1/auth`** (R4).                                                                                                                                                                                                                                                                                                             |
| Auth _directory_ move | ❌ **DEFERRED to its own task** (R5 dropped). `src/app/auth/` → `src/auth/` would rewrite an import line in two do-not-touch files (`discourse/community.controller.ts:5`, `google-sessions/members.controller.ts:14`). Risk was nil, but the do-not-touch rule stays absolute. The `src/app/` nesting wart persists as documented debt. |

**Batch sequence**: R1 → R2 → R3 → R4 → Tier 1 {B1, B2, B3} → Tier 2 {B4, B5, B6} → Tier 3 {B7a–d, B8, B9}.

### Two risks that fail silently — both must be honoured

1. 🔴 **`admin-auth.guard.ts:32` must move in the same commit as R2.** It probes
   `GET /api/v1/admin/users?pageSize=1` to decide if the session is an admin. That resolves to the
   `:model` wildcard today. After the split `AdminUsersController` has no root `@Get()`, so the probe
   404s, the guard reads "not an admin", and **every admin is locked out of the dashboard** with no
   error anywhere saying the route moved. Becomes `records/users?pageSize=1`.
2. 🔴 **`WORKOS_REDIRECT_URI` is out-of-repo and gates the R4 deploy.** Must change from
   `…/api/auth/callback` to `…/api/v1/auth/callback` in `.env` **and** the WorkOS dashboard
   allowed-redirect list (WorkOS requires exact matches). Register the new URI first, keep the old one
   until the deploy is confirmed, then remove it — that overlap is provider config, not code, so it
   does not violate the no-dual-mounting decision. Deploy R4 without it and OAuth login breaks for
   everyone, with the error surfaced by WorkOS rather than by us.
   Secondary: already-sent magic links point at `/api/auth/verify` and 404 after cutover — TTL is
   2 minutes (`auth.controller.ts:405`), so the window is small. Deploy off-peak.

## Existing, proven assets (do not re-invent)

- `apps/ptah-license-server/src/common/dto-validation.pipe.ts` → `dtoPipe(DtoClass)` uses
  `ValidationPipe`'s `expectedType` option, which overrides `metadata.metatype` _before_ the
  short-circuit, so `plainToInstance` + `classValidator.validate` both run.
- `apps/ptah-license-server/src/admin/admin-guards.spec.ts` → structural test **G7** reads Nest's
  `ROUTE_ARGS_METADATA` and asserts every `@Body()`/`@Query()` param binds a `ValidationPipe` with
  `expectedType`. Has an anti-vacuity guard. **Extend its controller list per controller fixed.**

## Already protected — do NOT redo

`packs/dto/pack.dto.ts`, `member-groups/dto/member-group.dto.ts`,
`discourse/dto/admin-community.dto.ts`, `google-sessions/dto/admin-session.dto.ts`.

## Do NOT touch (TASK_2026_169 security invariant + own smokes)

`discourse/builders-membership.service.ts`, `discourse/community.controller.ts`,
`google-sessions/members.controller.ts`.

## Folded-in follow-up

`apps/ptah-license-server/src/app/auth/jwt-auth.guard.ts:66` — `catch (error: any)` anti-pattern
**and** raw `error.message` interpolated into the 401 response. Adjacent to Tier 1 work.

## Verification gates

```bash
npx nx test ptah-license-server --skip-nx-cache   # 617 tests green at handoff time
npx eslint apps/ptah-license-server/src/<touched>
node scripts/community-gate-smoke.mjs             # must exit 0
node scripts/discourse-e2e.mjs                    # must exit 0
```

Plus a live curl matrix per controller — valid payload still succeeds, invalid payload now 400s.

## Git note

Working tree had unrelated uncommitted changes at task start (agent-sdk, rpc-handlers,
tribunal-panel, landing-page specs) on branch `ak/elevate-video-and-tasks`. Branch creation for this
task is deferred to the first commit so those changes are not swept in.

## Phase log

- [x] Checkpoint 0.1 — CLI agent discovery (enabled, `claude cli`)
- [x] Checkpoint 1.5 — technical clarification (hybrid / all tiers / webhooks excluded)
- [x] software-architect → `implementation-plan.md` (corrects the handoff in 7 places; findings F1/F2/F3)
- [x] Checkpoint 2 — architecture review → **APPROVED** by user
- [x] Branch created: `ak/license-server-validation-pipe`
- [x] team-leader MODE 1 → `tasks.md` (B0–B9; found 2 further plan defects: duplicate `AdminController`
      class name breaks the `string[]` ledger; `app/auth` import depth is `../../common/`, not `../../../`)
- [x] Data checks D1–D7 → `data-checks.md` — all pass; **D1 satisfied only against a 3-row dev corpus,
      recorded as a production release gate**
- [ ] B0 — foundation (passthroughDtoPipe, controller-validation.spec.ts, G7 removal, main.ts docblock)
- [ ] Tier 1 — B1 waitlist, B2 license (public), B3 auth + jwt-auth.guard
- [ ] Tier 2 — B4 contact, B5 session, B6 subscription
- [ ] Tier 3 — B7 admin (carries F1), B8 admin-marketing + caller fix, B9 license admin
- [ ] QA
