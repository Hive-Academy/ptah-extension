# Handoff — The license server's global `ValidationPipe` validates nothing

**For:** a fresh Claude Code session. Start it with `/orchestrate` and this doc.
**Branch:** new branch off `ak/elevate-video-and-tasks` (or `main` once that merges).
**Task type:** BUGFIX (security-adjacent). Likely **Partial** workflow — the root cause is known and
proven; the work is scoping the blast radius and rolling out a fix safely.
**One-line goal:** Make `class-validator` decorators actually run on every endpoint in
`ptah-license-server`, without breaking callers that currently rely on the accidental permissiveness.

> [!CAUTION]
> This is not a theoretical defect. It is **live in production code today**, it silently disarms
> input validation across the entire license server, and it includes **unauthenticated public
> endpoints**. Treat it as higher priority than whatever feature work it competes with.

---

## Discovered during TASK_2026_169

Found while implementing the admin Builders-content feature. Full write-ups:

- `.ptah/specs/TASK_2026_169/implementation-report-backend.md` §5 — original discovery + root cause
- `.ptah/specs/TASK_2026_169/code-logic-review.md` — MAJOR-1 / MAJOR-2, independent confirmation
- `.ptah/specs/TASK_2026_169/context.md` — surrounding feature context (not required reading)

That task fixed **only its own endpoints** plus `member-groups`. Everything else is still affected.
The scoping decision was deliberate — an app-wide behavioural change needs its own reviewed task.
That task is this one.

---

## Root cause (confirmed, not hypothesised)

NestJS resolves a handler parameter's DTO class from `design:paramtypes` metadata, emitted by
TypeScript's `emitDecoratorMetadata`.

- `apps/ptah-license-server/tsconfig.app.json:8` sets `"emitDecoratorMetadata": true`
- `apps/ptah-license-server/project.json:9` builds with `"executor": "@nx/esbuild:esbuild"`
- **esbuild does not implement `emitDecoratorMetadata`.** It is a known, documented esbuild limitation.

Without that metadata, `ValidationPipe.transform()` short-circuits on its first line:

```js
// node_modules/@nestjs/common/pipes/validation.pipe.js (~line 51)
if (!metatype || !this.toValidate(metadata)) return value;
```

`metatype` is `undefined`, so the value is returned **unvalidated and untransformed**. The global
`ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` in `main.ts` is inert.

### Reproduce it in 30 seconds

With the server running (`npm run docker:up`), against endpoints nobody has fixed:

```bash
# Public, unauthenticated:
curl -X POST localhost:3000/api/v1/waitlist -H 'Content-Type: application/json' \
     -d '{"email":"not-an-email","bogusField":"x"}'
# Expect 400. You will likely get 201.
```

Compare against a _fixed_ endpoint to see the difference:

```bash
# Requires an admin ptah_auth cookie — mint one the way scripts/community-gate-smoke.mjs does
curl -X POST localhost:3000/api/v1/admin/groups -b "ptah_auth=<jwt>" \
     -H 'Content-Type: application/json' -d '{"key":"BAD KEY!!","name":"x"}'
# Returns 400 "key must be a lowercase slug..." — this one was fixed in TASK_2026_169
```

---

## The fix that already exists and works

`apps/ptah-license-server/src/common/dto-validation.pipe.ts` exports `dtoPipe(DtoClass)`. It uses
`ValidationPipe`'s `expectedType` option, which **overrides** `metadata.metatype` _before_ the
short-circuit, so both `plainToInstance` (transform, e.g. `@Type(() => Number)`) and
`classValidator.validate` run exactly as if `emitDecoratorMetadata` worked.

Verified against the installed `@nestjs/common` source by two independent agents. Bind it per param:

```ts
@Post()
async create(@Body(dtoPipe(CreatePackDto)) dto: CreatePackDto) { … }
```

**A structural test already guards the controllers that use it** — `G7` in
`apps/ptah-license-server/src/admin/admin-guards.spec.ts`. It reads Nest's `ROUTE_ARGS_METADATA`,
asserts every `@Body()`/`@Query()` param binds a `ValidationPipe` with `expectedType` set, names the
offending handler on failure, and has an anti-vacuity guard so it cannot silently pass while
checking nothing. **Extend G7's controller list as you fix each controller** — that is how you make
this fix stay fixed.

---

## Decide the strategy first (Checkpoint 1.5 in the new session)

Two viable approaches. Present both; **Option A is recommended.**

### Option A — Roll out `dtoPipe` per endpoint (recommended)

Bind `dtoPipe(X)` on every `@Body()`/`@Query()` param, controller by controller, extending G7 as you
go. No build-system change, fully incremental, each controller independently reviewable and
revertible, and the blast radius is visible per commit. This is the path TASK_2026_169 already proved
twice.

Downside: verbose, and a future contributor can still forget — which is exactly what G7 exists to catch.

### Option B — Fix decorator metadata at the build level

Make esbuild emit the metadata, e.g. via an esbuild plugin
(`esbuild-plugin-tsc`, `@anatine/esbuild-decorators`) or by moving the build to a compiler that
supports it. One change fixes everything at once and `dtoPipe` could then be deleted.

Downside — and it is serious: **every DTO in the server starts enforcing simultaneously**, including
public endpoints, Paddle/Resend webhook bodies, and the auth flow. A single over-strict decorator
anywhere becomes an instant production 400. It also risks the esbuild build in Docker
(see `Dockerfile.dev:50-55` — the platform-binary handling there is already delicate).

If Option B is chosen: land it behind a full regression pass, and audit **every** DTO for
over-strictness _before_ flipping it, not after.

> A reasonable hybrid: Option A now to close the exposure, Option B later as cleanup once every DTO
> is known-correct because Option A already forced you to read them all.

---

## Blast radius — 16 unprotected DTO files, 10 controllers

**Already protected (do not re-do):** `packs/dto/pack.dto.ts`, `member-groups/dto/member-group.dto.ts`,
`discourse/dto/admin-community.dto.ts`, `google-sessions/dto/admin-session.dto.ts`.

### 🔴 Tier 1 — unauthenticated / public. Fix these first.

Anyone on the internet can hit these, and their validation is currently inert.

| Controller                                           | DTOs                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `waitlist/waitlist.controller.ts`                    | `join-waitlist.dto.ts`                                                                                    |
| `contact/contact.controller.ts`                      | `contact-message.dto.ts`                                                                                  |
| `app/auth/auth.controller.ts`                        | `signup.dto.ts`, `login.dto.ts`, `magic-link.dto.ts`, `verify-email.dto.ts`, `resend-verification.dto.ts` |
| `marketing/controllers/resend-webhook.controller.ts` | (webhook body — **see the warning below**)                                                                |

### 🟡 Tier 2 — authenticated but not admin

| Controller                                  | DTOs                                             |
| ------------------------------------------- | ------------------------------------------------ |
| `license/controllers/license.controller.ts` | `verify-license.dto.ts`, `create-license.dto.ts` |
| `session/session.controller.ts`             | `session-request.dto.ts`                         |
| `subscription/subscription.controller.ts`   | `subscription.dto.ts`                            |

### 🟢 Tier 3 — admin-gated (bounded by `AdminGuard`, still worth fixing)

| Controller                                            | DTOs                                           |
| ----------------------------------------------------- | ---------------------------------------------- |
| `admin/admin.controller.ts`                           | `admin.dto.ts`, `dto/delete-user.dto.ts`       |
| `license/controllers/admin.controller.ts`             | `issue-complimentary-license.dto.ts`           |
| `marketing/controllers/admin-marketing.controller.ts` | `send-campaign.dto.ts`, `save-template.dto.ts` |

Known-inert caps worth calling out: `BulkEmailDto`'s 500-item / 50 000-char limits, and
`SendCampaignDto`'s constraints — a marketing send currently has no enforced ceiling.

> [!WARNING]
> **Webhook controllers need care.** `/webhooks/paddle` and `/webhooks/resend` use `rawBody` and are
> excluded from the global `api` prefix (`main.ts`). Their payload shapes are dictated by Paddle and
> Resend, not by us, and those providers add fields without notice. Turning on
> `forbidNonWhitelisted` there **will** reject valid webhooks the first time a provider adds a field.
> Either leave webhooks alone, or use `whitelist: true` **without** `forbidNonWhitelisted` for them
> specifically. Do not treat them like the other controllers.

---

## Method — do this per controller, not in one sweep

For each controller, in tier order:

1. **Read the DTO first.** Ask "would a real, currently-working caller fail this?" Over-strict
   decorators are the actual risk here, not the binding.
2. **Check what real callers send.** For frontend-driven endpoints, read the calling code in
   `apps/ptah-landing-page/src/app/services/` — the _component literals_ that build the payload, not
   just the TypeScript interfaces. Interfaces do not prove runtime shape. TASK_2026_169 did exactly
   this for `member-groups` and documented the method.
3. **Check real data.** Before trusting `@IsUUID('4')`, confirm existing rows are actually v4:
   `SELECT substring(id::text,15,1) FROM users LIMIT 5;` → should be `4`. That check caught nothing
   last time, but it is cheap and it would have caught a real break.
4. **Bind `dtoPipe(X)`**, extend G7's controller list.
5. **Exercise it live** — valid payload still succeeds, invalid payload now 400s. Both directions.
6. **Commit per controller** so any single one is independently revertible.

### Expect behaviour changes and treat them as findings

Some input that silently "worked" will now 400. That is the point, but each instance is a finding
worth recording, not something to paper over. Real example from TASK_2026_169: malformed user IDs in
`assign-members` were previously counted as silently `skipped`; now they 400. That is strictly
better, but a caller depending on the old behaviour would notice.

Also expect to find **intent that was never enforced.** `UpdateMemberGroupDto` deliberately omits
`key` ("intentionally NOT patchable — stable slug") and that was inert too. There will be more of
these. They are the most valuable thing you will find.

---

## Constraints

- `catch (error: unknown)` narrowed via `instanceof Error`. Never expose raw `error.message` to
  clients. Never log webhook bodies.
- `ConfigService` via DI, never `process.env`.
- Do **not** weaken any DTO just to make a caller pass without first confirming the caller is
  legitimate. Fix the caller when the DTO is right.
- Do not touch these — they are protected by the TASK_2026_169 security invariant and have their own
  regression smokes (`scripts/community-gate-smoke.mjs`, `scripts/discourse-e2e.mjs`):
  `discourse/builders-membership.service.ts`, `discourse/community.controller.ts`,
  `google-sessions/members.controller.ts`.

## Verification

```bash
npx nx test ptah-license-server --skip-nx-cache        # 617 tests green at time of writing
npx eslint apps/ptah-license-server/src/<touched>
node scripts/community-gate-smoke.mjs                  # must exit 0
node scripts/discourse-e2e.mjs                         # must exit 0 (may need scripts/discourse-dev-up.sh first)
```

Plus a live curl matrix per controller — valid payload succeeds, invalid payload 400s.

## Related follow-up, same file family

`apps/ptah-license-server/src/app/auth/jwt-auth.guard.ts:66` uses `catch (error: any)` (the
anti-pattern the coding standards call out) **and** interpolates the raw error message into the 401
response. Small, adjacent to Tier 1 work, worth folding in.

## Dev environment

- `npm run docker:up` — postgres + license-server (:3000) + Discourse dev (Rails :3001 + Ember).
  Rails is started with `docker exec -d` and **does not survive a container restart** — re-run
  `bash scripts/discourse-dev-up.sh` if `:3001` refuses connections.
- Mint a `ptah_auth` cookie for local admin testing the way `scripts/community-gate-smoke.mjs` does
  (HMAC over `header.payload` with `JWT_SECRET`).
- Dev `ADMIN_EMAILS=abdallah@miramarstaffing.com`.
