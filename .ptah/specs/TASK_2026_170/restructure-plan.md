# TASK_2026_170 — Route & Controller Restructure Plan

**Scope expansion after B0.** Fix `v1/admin` as a contested namespace, split the god-controller,
version and relocate auth, and make order-dependence impossible to reintroduce.
Hard cutover. Author: software-architect · Date: 2026-08-01

---

## 0. 🔴 BLOCKER — the auth **directory** move requires touching two protected files. I stopped.

Locked decision 2 says _"move the directory AND version the route"_. The route versioning is fine.
**The directory move is not**, and I am not proceeding on it without an explicit decision.

`src/app/auth/` → `src/auth/` changes the relative import path in **28 files**. Two of them are on the
do-not-touch list:

```
apps/ptah-license-server/src/discourse/community.controller.ts:5
  import { JwtAuthGuard } from '../app/auth/guards/jwt-auth.guard';

apps/ptah-license-server/src/google-sessions/members.controller.ts:14
  import { JwtAuthGuard } from '../app/auth/guards/jwt-auth.guard';
```

After the move both must read `'../auth/guards/jwt-auth.guard'`. There is no way to move the directory
and leave those bytes untouched — and the only mechanism that would (a re-export shim at the old path)
is precisely the aliasing that locked decision 1 forbids.

`discourse/builders-membership.service.ts` — the third protected file — does **not** import from
`app/auth` and is unaffected.

**What is and is not at risk.** The TASK_2026_169 invariant is _"the Builders membership gate never
consults admin identity"_, asserted by G4 (`admin/admin-guards.spec.ts:165-193`): no `ADMIN_EMAILS`,
no `AdminGuard`, no `isAdmin`, no `isBuildersMember || isAdmin` in those three files. An import-path
rewrite cannot violate any of those four assertions, and `community-gate-smoke.mjs` +
`discourse-e2e.mjs` would prove it end-to-end. So the _risk_ is nil; the _rule_ is nonetheless
explicit. That is a decision for the orchestrator, not for me.

### Options

- **Option A (recommended) — narrow, recorded waiver for a one-token import rewrite.**
  Permit exactly `'../app/auth/` → `'../auth/` on those two lines, nothing else. Verify with
  `git diff --stat` showing **1 changed line each**, plus G4 green, plus both smokes exit 0. Record the
  waiver in the implementation report.
- **Option B — defer the directory move to its own task.** Do R4 (`auth` → `v1/auth`) now, which
  touches **zero** protected files, and leave `src/app/auth/` where it is. Costs nothing in this task;
  the import-depth wart (`../../common/…` from `app/auth/`) persists but is documented and correct.
- **Option C — move the directory, leave the two files pointing at a shim.** ❌ Rejected: that is a
  compatibility alias, forbidden by locked decision 1 and by the repo's anti-backward-compat rule.

**Everything else in this plan is unblocked and independent of this decision.** R5 is the only batch
that depends on it; the plan is written so R5 can be dropped without touching R1–R4.

---

## 1. The defect, measured

Seven controllers claim the `v1/admin` namespace. Two of them claim the **identical** prefix
`v1/admin`. `admin/AdminController` carries three GET/PATCH wildcards there, and Nest resolves a
request against controllers **in module-registration order**, so five sibling admin surfaces work only
because their modules appear earlier than `AdminModule` in `app.module.ts`'s `imports` array
(`app/app.module.ts:62-83`). The defence is a comment on an array literal (`app.module.ts:66-71`).

I enumerated the full route table (all 21 controllers, 64 routes) and computed the contests.
**There are ten cross-controller route contests today**, every one of them arbitrated by array order:

| #   | Wildcard (`admin/AdminController`) | Contested sibling route               | Sibling controller         |
| --- | ---------------------------------- | ------------------------------------- | -------------------------- |
| 1   | `GET v1/admin/:model`              | `GET v1/admin/sessions`               | `AdminSessionsController`  |
| 2   | `GET v1/admin/:model`              | `GET v1/admin/groups`                 | `MemberGroupsController`   |
| 3   | `GET v1/admin/:model`              | `GET v1/admin/packs`                  | `AdminPacksController`     |
| 4   | `GET v1/admin/:model/:id`          | `GET v1/admin/community/topics`       | `AdminCommunityController` |
| 5   | `GET v1/admin/:model/:id`          | `GET v1/admin/community/review-queue` | `AdminCommunityController` |
| 6   | `GET v1/admin/:model/:id`          | `GET v1/admin/marketing/segments`     | `AdminMarketingController` |
| 7   | `GET v1/admin/:model/:id`          | `GET v1/admin/packs/:id`              | `AdminPacksController`     |
| 8   | `PATCH v1/admin/:model/:id`        | `PATCH v1/admin/packs/:id`            | `AdminPacksController`     |
| 9   | `PATCH v1/admin/:model/:id`        | `PATCH v1/admin/groups/:id`           | `MemberGroupsController`   |
| 10  | `PATCH v1/admin/:model/:id`        | `PATCH v1/admin/sessions/:eventId`    | `AdminSessionsController`  |

Plus a prefix-identity violation: `admin/AdminController` and `license/AdminController` are both
`@Controller('v1/admin')` (`admin/admin.controller.ts:80`, `license/controllers/admin.controller.ts:26`)
with **different guard chains** — `JwtAuthGuard + AdminGuard` vs `AdminApiKeyGuard` (`x-api-key`,
read at `license/guards/admin-api-key.guard.ts:51`). Adjacent routes, different authentication, no
signal of that anywhere in the URL. The duplicate class name is the symptom.

**One correction to the framing.** The intra-class ordering the source comments fuss over
(`admin.controller.ts:105-110, 129-131, 160-163`) is _almost entirely a non-issue_: within
`admin/AdminController` there is exactly **one** unifiable same-verb pair — `GET stats` vs
`GET :model` — and it is correctly ordered. The real hazard was always cross-controller and
cross-module, which no comment in that file mentions.

---

## 2. Target route map

Global prefix `api` prepended to everything except `webhooks/paddle` and `webhooks/resend`
(`main.ts:57-65`, unchanged). **64 routes before, 64 routes after** — this is a move, not a rewrite.

### 2.1 The design rule

> **Every `:param` segment sits under a literal segment owned exclusively by one controller.**

Stated as three assertable invariants:

- **RI-1 (prefix disjointness).** For any two distinct controllers A, B: `A.prefix ≠ B.prefix`, and
  `A.prefix` is not a proper path-prefix of `B.prefix`.
  _Recorded exception (data, with reason):_ `PublicMarketingController` (`@Controller()`, prefix `''`)
  — see §2.4.
- **RI-2 (no cross-controller contest).** For any two routes on **different** controllers with the
  same HTTP method, no concrete path may match both. (Segment-wise unification: same segment count,
  and at each index either both literal and equal, or at least one is `:param`.) **This is the
  load-bearing invariant** — RI-1 is the human-legible design rule that makes RI-2 easy to satisfy.
- **RI-3 (intra-controller specificity order).** Within one controller, if two same-verb routes are
  unifiable, the one with fewer `:param` segments must be declared first. This is the executable form
  of the "route ordering: MUST be declared BEFORE" comments.

### 2.2 Before → after (only rows that change)

| #   | Before                          | After                                   | Guard              | Controller before → after                                   |
| --- | ------------------------------- | --------------------------------------- | ------------------ | ----------------------------------------------------------- |
| 1   | `GET v1/admin/:model`           | **`GET v1/admin/records/:model`**       | JWT + Admin        | `admin/AdminController` → `AdminRecordsController`          |
| 2   | `GET v1/admin/:model/:id`       | **`GET v1/admin/records/:model/:id`**   | JWT + Admin        | ↑                                                           |
| 3   | `PATCH v1/admin/:model/:id`     | **`PATCH v1/admin/records/:model/:id`** | JWT + Admin        | ↑                                                           |
| 4   | `POST v1/admin/licenses`        | **`POST v1/integrations/licenses`**     | `AdminApiKeyGuard` | `license/AdminController` → `IntegrationLicensesController` |
| 5   | `GET auth/login`                | **`GET v1/auth/login`**                 | none               | `AuthController` (unchanged class)                          |
| 6   | `GET auth/callback`             | **`GET v1/auth/callback`**              | none               | ↑ ⚠️ WorkOS config, §5.3                                    |
| 7   | `POST auth/logout`              | **`POST v1/auth/logout`**               | none               | ↑                                                           |
| 8   | `GET auth/me`                   | **`GET v1/auth/me`**                    | JWT                | ↑                                                           |
| 9   | `POST auth/magic-link`          | **`POST v1/auth/magic-link`**           | none               | ↑                                                           |
| 10  | `GET auth/verify`               | **`GET v1/auth/verify`**                | none               | ↑ ⚠️ emailed URL, §5.3                                      |
| 11  | `POST auth/stream/ticket`       | **`POST v1/auth/stream/ticket`**        | JWT                | ↑                                                           |
| 12  | `POST auth/login/email`         | **`POST v1/auth/login/email`**          | none               | ↑                                                           |
| 13  | `POST auth/signup`              | **`POST v1/auth/signup`**               | none               | ↑                                                           |
| 14  | `POST auth/verify-email`        | **`POST v1/auth/verify-email`**         | none               | ↑                                                           |
| 15  | `POST auth/resend-verification` | **`POST v1/auth/resend-verification`**  | none               | ↑                                                           |
| 16  | `GET auth/oauth/:provider`      | **`GET v1/auth/oauth/:provider`**       | none               | ↑                                                           |

**Sixteen routes change. Forty-eight do not.** Handlers that merely change _owning class_ without
changing path (the other six on `admin/AdminController`) are listed in §3.

### 2.3 Full after-map, by prefix

| Prefix                         | Controller                            | Guards                 | Routes                                                                                               |
| ------------------------------ | ------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `''`                           | `PublicMarketingController`           | none                   | `GET/POST unsubscribe/:token`, `GET resubscribe/:token`                                              |
| `health`                       | `HealthController`                    | none                   | `GET`                                                                                                |
| `v1/admin/community`           | `AdminCommunityController`            | JWT+Admin              | `GET topics`, `GET review-queue`                                                                     |
| `v1/admin/groups`              | `MemberGroupsController`              | JWT+Admin              | `GET`, `GET :id/members`, `POST`, `PATCH :id`, `POST :id/assign`, `DELETE :id/members/:userId`       |
| **`v1/admin/licenses`**        | **`AdminLicensesController`** ★       | JWT+Admin              | `POST complimentary`                                                                                 |
| `v1/admin/marketing`           | `AdminMarketingController`            | JWT+Admin+Throttler    | `GET segments`, `POST templates`, `POST send`                                                        |
| `v1/admin/packs`               | `AdminPacksController`                | JWT+Admin              | `GET`, `GET :id`, `POST`, `PATCH :id`, `DELETE :id`                                                  |
| **`v1/admin/records`**         | **`AdminRecordsController`** ★        | JWT+Admin              | `GET :model`, `GET :model/:id`, `PATCH :model/:id`                                                   |
| `v1/admin/sessions`            | `AdminSessionsController`             | JWT+Admin              | `GET`, `POST`, `PATCH :eventId`, `DELETE :eventId`                                                   |
| **`v1/admin/stats`**           | **`AdminStatsController`** ★          | JWT+Admin              | `GET`                                                                                                |
| **`v1/admin/users`**           | **`AdminUsersController`** ★          | JWT+Admin              | `POST bulk-email`, `GET :id/deletion-preview`, `DELETE :id`                                          |
| **`v1/admin/waitlist`**        | **`AdminWaitlistController`** ★       | JWT+Admin              | `POST invite`                                                                                        |
| **`v1/auth`**                  | `AuthController`                      | mixed (per-handler)    | 12 routes, §2.2                                                                                      |
| `v1/community`                 | `CommunityController` 🔒              | JWT (method)           | `GET summary`                                                                                        |
| `v1/contact`                   | `ContactController`                   | JWT (method)           | `POST`                                                                                               |
| `v1/events`                    | `EventsController`                    | none                   | `SSE subscribe`, `GET health`                                                                        |
| **`v1/integrations/licenses`** | **`IntegrationLicensesController`** ★ | `AdminApiKeyGuard`     | `POST`                                                                                               |
| `v1/licenses`                  | `LicenseController`                   | mixed                  | `POST verify`, `GET me`, `POST me/reveal-key`                                                        |
| `v1/members`                   | `MembersController` 🔒                | JWT (method)           | `GET sessions`                                                                                       |
| `v1/sessions`                  | `SessionController`                   | JWT (method)           | `GET eligibility`, `POST request`                                                                    |
| `v1/sso`                       | `DiscourseController`                 | none                   | `GET discourse`                                                                                      |
| `v1/subscriptions`             | `SubscriptionController`              | JWT (method)           | `GET status`, `POST validate-checkout`, `POST reconcile`, `POST portal-session`, `GET checkout-info` |
| `v1/waitlist`                  | `WaitlistController`                  | none                   | `POST`                                                                                               |
| `webhooks/paddle`              | `PaddleController`                    | none (HMAC in handler) | `POST`                                                                                               |
| `webhooks/resend`              | `ResendWebhookController`             | `ResendWebhookGuard`   | `POST`                                                                                               |

★ new/renamed · 🔒 protected file, untouched by R1–R4

### 2.4 Proof the after-map satisfies RI-2

The interesting subtree is `v1/admin`. Grouped by verb and by segment-count-after-`v1/admin`:

- **GET, depth 1:** `stats`, `sessions`, `groups`, `packs` — four distinct literals, no `:param`. ✓
- **GET, depth 2:** `records/:model`, `community/topics`, `community/review-queue`, `packs/:id`,
  `marketing/segments`. First segments: `records`, `community`, `packs`, `marketing` — each owned by
  exactly one controller. The two `community/*` share a controller and are distinct literals. ✓
- **GET, depth 3:** `records/:model/:id`, `users/:id/deletion-preview`, `groups/:id/members`. First
  segments `records`/`users`/`groups`, all literal and exclusively owned. ✓
- **PATCH, depth 2:** `sessions/:eventId`, `groups/:id`, `packs/:id` — distinct literal heads. ✓
  **depth 3:** `records/:model/:id` alone. ✓
- **POST, depth 1:** `sessions`, `groups`, `packs`. **depth 2:** `users/bulk-email`,
  `licenses/complimentary`, `waitlist/invite`, `marketing/templates`, `marketing/send`.
  **depth 3:** `groups/:id/assign`. All literal heads, exclusively owned. ✓
- **DELETE, depth 2:** `users/:id`, `sessions/:eventId`, `packs/:id`. **depth 4:**
  `groups/:id/members/:userId`. ✓

Outside `v1/admin`: `v1/integrations` is a fresh subtree with one owner; `v1/auth` has one owner and
its only `:param` (`oauth/:provider`) is under the literal `oauth`; at api-root the literals are `v1`,
`health`, `unsubscribe`, `resubscribe` — all distinct, and the only `:param`s (`unsubscribe/:token`,
`resubscribe/:token`) sit under literals nobody else claims. **RI-2 holds everywhere.**

**RI-3 after the split:** there are **zero** unifiable same-verb pairs left inside any single
controller. The `GET stats` / `GET :model` pair that motivated the ordering comments no longer exists
— they are in different classes on different prefixes. The comments at `admin.controller.ts:105-110,
129-131, 160-163` are deleted with the split.

### 2.5 Two things deliberately **not** changed

**`PublicMarketingController` keeps its empty prefix.** It violates RI-1 (the empty prefix is a
prefix of everything) but satisfies RI-2. Versioning it to e.g. `v1/email` would change
`/api/unsubscribe/:token`, and that URL is **generated into outbound marketing email** at
`marketing/services/marketing.service.ts:348` (`` `${ctx.baseUrl}/unsubscribe/${token}` ``). Those
links live in recipients' inboxes indefinitely and there is no way to update a sent email. Under a
hard cutover with no alias, changing it silently breaks unsubscribe — which is a deliverability and
CAN-SPAM/RFC-8058 problem, not a cosmetic one. **Record it in the RI-1 exception list with that
reason; do not move it.** The related follow-up (versioning it behind a permanent redirect) belongs in
`future-enhancements.md`.

**`HealthController` stays unversioned at `health` → `/api/health`.** It is wired into three live
healthchecks: `apps/ptah-license-server/Dockerfile:139`,
`apps/ptah-license-server/Dockerfile.dev:81`, and `docker-compose.prod.yml:75`. Versioning it buys
nothing and breaks container orchestration. Unversioned health endpoints are the convention.

---

## 3. The controller split

`admin/admin.controller.ts` is 306 lines carrying **four unrelated concerns** — user administration,
licence issuance, waitlist invitation, and generic model CRUD — across 9 routes and 6 payload params,
under one class with three wildcards. Split by resource.

All five new controllers keep the **identical guard chain and throttle decorators** the handlers have
today. Handler bodies are moved verbatim; `AdminService` is not split (see §3.6).

### 3.1 `AdminRecordsController`

- **File:** `apps/ptah-license-server/src/admin/admin-records.controller.ts`
- **Prefix:** `@Controller('v1/admin/records')` · **Class guards:** `@UseGuards(JwtAuthGuard, AdminGuard)`
- **Module:** `AdminModule`
- **Handlers moved from `admin.controller.ts`:**

| Verb  | Path           | Method   | Payload param | DTO               |
| ----- | -------------- | -------- | ------------- | ----------------- |
| GET   | `':model'`     | `list`   | `@Query()`    | `ListQueryDto`    |
| GET   | `':model/:id'` | `show`   | —             | —                 |
| PATCH | `':model/:id'` | `update` | `@Body()`     | `UpdateRecordDto` |

- Keeps the private `assertModel()` helper and the `AdminListResponse` interface. Injects
  `AdminService` only.
- ⚠️ `update` is the F1 handler — it must bind **`passthroughDtoPipe(UpdateRecordDto)`**, not
  `dtoPipe`. That binding happens in B7a, not here.

### 3.2 `AdminUsersController`

- **File:** `apps/ptah-license-server/src/admin/admin-users.controller.ts`
- **Prefix:** `@Controller('v1/admin/users')` · **Class guards:** `JwtAuthGuard, AdminGuard`
- **Module:** `AdminModule`

| Verb   | Path                     | Method                | Method guards / throttle                              | Payload param | DTO             |
| ------ | ------------------------ | --------------------- | ----------------------------------------------------- | ------------- | --------------- |
| POST   | `'bulk-email'`           | `bulkEmailUsers`      | `@HttpCode(200)`                                      | `@Body()`     | `BulkEmailDto`  |
| GET    | `':id/deletion-preview'` | `userDeletionPreview` | —                                                     | —             | —               |
| DELETE | `':id'`                  | `deleteUser`          | `@UseGuards(AdminThrottlerGuard)`, `@Throttle(5/min)` | `@Body()`     | `DeleteUserDto` |

- Injects `AdminService`. Paths are **unchanged** — `v1/admin/users/*` today, `v1/admin/users/*` after.

> **Why `v1/admin/users` and `v1/admin/records/users` both exist, and why that is correct.**
> They are different resources. `records/users` is the _generic table view_ driven by
> `ADMIN_MODELS['users']`; `users/:id` is _user-specific administration_ — cascade delete with typed
> confirmation, impact preview, bulk mail — none of which the generic CRUD can express. Naming them
> apart makes the distinction visible in the URL. **Consequence to handle:** see §4.2, `admin-auth.guard.ts`.

### 3.3 `AdminStatsController`

- **File:** `apps/ptah-license-server/src/admin/admin-stats.controller.ts`
- **Prefix:** `@Controller('v1/admin/stats')` · **Class guards:** `JwtAuthGuard, AdminGuard`
- **Module:** `AdminModule`
- `GET @Get()` → `stats` (was `@Get('stats')`). Injects `AdminService`. **No payload param** — so it
  must **not** be added to `UNVALIDATED_DEBT` (§6.2).

### 3.4 `AdminWaitlistController`

- **File:** `apps/ptah-license-server/src/admin/admin-waitlist.controller.ts`
- **Prefix:** `@Controller('v1/admin/waitlist')` · **Class guards:** `JwtAuthGuard, AdminGuard`
- **Module:** `AdminModule`
- `POST @Post('invite')` → `inviteWaitlist`, `@HttpCode(200)`, `@UseGuards(AdminThrottlerGuard)`,
  `@Throttle(10/min)`. `@Body()` → **`InviteWaitlistDto`**.
- Injects `WaitlistService` + `AuditLogService`. Path unchanged.

### 3.5 `AdminLicensesController`

- **File:** `apps/ptah-license-server/src/admin/admin-licenses.controller.ts`
- **Prefix:** `@Controller('v1/admin/licenses')` · **Class guards:** `JwtAuthGuard, AdminGuard`
- **Module:** `AdminModule`
- `POST @Post('complimentary')` → `issueComplimentaryLicense`, `@UseGuards(AdminThrottlerGuard)`,
  `@Throttle(20/min)`. `@Body()` → **`IssueComplimentaryLicenseDto`** (stays in `license/dto/`).
- Injects `LicenseService` (already available via `AdminModule`'s `forwardRef(() => LicenseModule)`).
  Path unchanged.

### 3.6 `IntegrationLicensesController` — the name collision, resolved as a consequence

- **File:** `license/controllers/admin.controller.ts` → **`license/controllers/integration-licenses.controller.ts`**
- **Class:** `AdminController` → **`IntegrationLicensesController`**
- **Prefix:** `@Controller('v1/admin')` → **`@Controller('v1/integrations/licenses')`**;
  handler `@Post('licenses')` → **`@Post()`**
- **Guards unchanged:** `@UseGuards(AdminApiKeyGuard)` + `@Throttle(30/min)` at class level.
- **Module:** `LicenseModule` (unchanged registration, import path updated).
- **Spec:** `license/controllers/admin.controller.spec.ts` → `integration-licenses.controller.spec.ts`,
  class references and the `describe('POST /api/v1/admin/licenses …')` string updated.

**This is not a bare rename.** The route moves because the _guard_ is the resource boundary: this is a
machine/ops integration authenticated by an `x-api-key` header, not a dashboard route authenticated by
an admin's session cookie. Putting it under `v1/admin` made two different trust models look like
neighbours; `v1/integrations` says what it is. The class name then follows the route, and the
duplicate `AdminController` disappears as a side effect — **after R3 there is no duplicated controller
class name anywhere in the server.**

_Alternative considered and rejected:_ keeping it at `v1/admin/licenses` with a method-level
`AdminApiKeyGuard`. Method-level `@UseGuards` **adds to** the class chain, it does not replace it, so
the two auth models cannot coexist on one class. Merging them into one controller would mean either
weakening the cookie guard or double-guarding the integration route.

**Also fix while in the file:** its docblock says `X-API-Key`, `main.ts:55` advertises
`X-Admin-API-Key` in CORS `allowedHeaders`, and the guard reads `request.headers['x-api-key']`
(`admin-api-key.guard.ts:51`). The guard is authoritative; the CORS entry is dead. Correct the comment
only — do not touch the guard or CORS in this task.

### 3.7 Modules — nothing needs splitting

- **`AdminModule`** goes from 1 controller to 5, keeping one `AdminService`, one `AdminGuard`, one
  `AdminThrottlerGuard`. Its existing imports (`ConfigModule`, `AuthModule`, `EmailModule`,
  `WaitlistModule`, `forwardRef(() => LicenseModule)`) already cover every new controller's
  dependencies — verified against each handler's injections. **No import changes.** The module
  boundary "the native admin dashboard backend" is genuinely one concern; the _controllers_ split by
  resource, which is the right axis. Splitting `AdminService` too would be a rewrite, and this is a
  move.
- **`LicenseModule`** keeps two controllers; only the import specifier and class name change.
- **`AuthModule`** — directory move only (R5, gated), no membership change.
- **`app.module.ts`** — the `imports` array is **unchanged in content**; only the ordering comment at
  lines 66-71 is deleted (R2, once ordering genuinely stops mattering).

---

## 4. Caller inventory and updates

Traced by grepping literal path strings across the whole repo (two CLI agents, every hit re-verified
by me against source). **The headline is how small this is** — a direct consequence of choosing
`v1/admin/records/:model` for the wildcards while leaving every literal sub-resource on the path it
already has.

### 4.1 Admin surface — **4 functional line edits, total**

| File:line                                                          | Before                                                     | After                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------- |
| `apps/ptah-landing-page/src/app/services/admin-api.service.ts:387` | `` `${this.base}/${model}` ``                              | `` `${this.base}/records/${model}` ``       |
| `…/admin-api.service.ts:405`                                       | `` `${this.base}/${model}/${id}` ``                        | `` `${this.base}/records/${model}/${id}` `` |
| `…/admin-api.service.ts:421`                                       | `` `${this.base}/${model}/${id}` ``                        | `` `${this.base}/records/${model}/${id}` `` |
| `apps/ptah-landing-page/src/app/guards/admin-auth.guard.ts:32`     | `.get('/api/v1/admin/users', { params: { pageSize: 1 } })` | `.get('/api/v1/admin/records/users', …)`    |

`this.base` is `'/api/v1/admin'` (`admin-api.service.ts:367`) — unchanged.

⚠️ **`admin-auth.guard.ts` is the one caller that would break silently and catastrophically.** It
probes `GET /api/v1/admin/users?pageSize=1` to decide whether the current session is an admin. Today
that resolves to the `:model` wildcard. After the split, `AdminUsersController` has **no root `@Get()`**
— the probe 404s, the guard treats it as "not an admin", and **every admin is locked out of the entire
dashboard**. It must move in the same commit as R2. (`records/users?pageSize=1` preserves the exact
semantics; `stats` would also work but does heavy aggregation on every route activation.)

**Verified unaffected** (checked every request path, not the method names):

- `apps/ptah-landing-page/src/app/services/admin-builders-api.service.ts` — **zero edits.** All 12 of
  its calls are `packs/*`, `sessions/*`, `community/*`, `groups/*` (lines 263-417), none of which move.
- `admin-api.service.ts` lines 436, 446, 462 (`users/*`), 474 (`licenses/complimentary`), 486/496/506
  (`marketing/*`), 519 (`waitlist/invite`), 530 (`stats`), 536-589 (`groups/*`) — **all unchanged.**
- `apps/ptah-landing-page-e2e/src/specs/admin-founding-invites.spec.ts:33,70` — mocks
  `**/api/v1/admin/waitlist/invite`, unchanged. **Zero e2e edits for the admin split.**
- `scripts/google-calendar-write-smoke.mjs` — hits `/api/v1/admin/sessions*` only. **Unchanged**, so it
  stays a verbatim, unmodified regression gate.

### 4.2 `POST v1/admin/licenses` → `v1/integrations/licenses` — **zero callers**

Confirmed independently three times (two CLI traces + my own grep): nothing in `apps/`, `libs/`,
`scripts/`, or the e2e suites posts to this route. It is `x-api-key`-gated and invoked, if at all, by
out-of-repo ops tooling. Only `license/controllers/admin.controller.spec.ts` references it, and that
moves with the file. Documentation references are listed in §4.5.

### 4.3 `auth` → `v1/auth` — 3 constants, 4 test globs, 1 server-side URL builder

Every landing-page auth call routes through one of three constants, so the SPA cost is **three lines**:

| File:line                                                                   | Before                      | After            |
| --------------------------------------------------------------------------- | --------------------------- | ---------------- |
| `apps/ptah-landing-page/src/app/pages/auth/services/auth-api.service.ts:38` | `baseUrl = '/api/auth'`     | `'/api/v1/auth'` |
| `apps/ptah-landing-page/src/app/services/auth.service.ts:39`                | `baseUrl = '/api/auth'`     | `'/api/v1/auth'` |
| `apps/ptah-landing-page/src/app/services/sse-events.service.ts:129`         | `authBaseUrl = '/api/auth'` | `'/api/v1/auth'` |

Downstream call sites all interpolate those constants and need **no edit**: `auth.service.ts:66,90,108`
(`/me`, `/me`, `/logout`); `auth-api.service.ts:47,57,68,80,93` (`/login/email`, `/signup`,
`/verify-email`, `/resend-verification`, `/magic-link`) and `:110`
(`` `${environment.apiBaseUrl}${this.baseUrl}/oauth/${provider}` ``).

Server-side:

| File:line                                                                       | Change                                                                          |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/ptah-license-server/src/app/auth/auth.controller.ts:89`                   | `@Controller('auth')` → `@Controller('v1/auth')`                                |
| `apps/ptah-license-server/src/app/auth/services/token/magic-link.service.ts:91` | `` `${frontendUrl}/api/auth/verify?token=${token}` `` → `/api/v1/auth/verify?…` |
| `…/magic-link.service.spec.ts:72,106`                                           | expectation strings                                                             |

> ⚠️ **Do not "fix" the origin while changing the path.** `magic-link.service.ts:91` builds the link
> against `frontendUrl`, not the API host, which looks wrong next to
> `environment.production.ts:18`'s `apiBaseUrl: 'https://api.ptah.live'` — it implies `ptah.live`
> proxies `/api`. Whether that is correct is a **separate** question. Changing only the path keeps this
> a move; changing the origin is a behaviour change and is out of scope.

Playwright route globs (4 edits + 2 comments):

- `apps/ptah-landing-page-e2e/src/specs/auth.spec.ts:15, 21, 69` (+ comment `:84`)
- `apps/ptah-landing-page-e2e/src/specs/profile.spec.ts:40`
- `apps/ptah-landing-page-e2e/src/support/auth.ts:84` — comment only
- `apps/ptah-landing-page-e2e/src/specs-checkout/checkout-flow.spec.ts:10` — comment only

DTO header comments (`app/auth/dto/{login,signup,verify-email,resend-verification,magic-link}.dto.ts`)
each cite `POST /api/auth/...` and should be corrected in the same commit.

### 4.4 The auth **directory** move (R5, gated on §0) — 28 import sites

`grep -rn "app/auth" src | grep -v "^src/app/auth/"` returns 28 lines across 26 files. All are
`'../app/auth/…'` → `'../auth/…'` or `'../../app/auth/…'` → `'../../auth/…'`, plus
`app/app.module.ts:9` `'./auth/auth.module'` → `'../auth/auth.module'`. Two of them are the protected
files in §0. Also affected: `common/controller-validation.spec.ts` lines 7, 93, 208, 267 (§6).

### 4.5 Documentation and external configuration

Not runtime callers, but wrong the moment R2–R5 land:

- `apps/ptah-license-server/COOKIES.md:15-19, 48, 65, 71, 77, 83` — the auth-flow diagram.
- `docs/deploy/e2e-test-handoff.md:197-240` — endpoint tables (auth + `/admin/licenses/complimentary`).
- `docs/deployment/PRE_PUBLISH_AUDIT_HANDOFF.md:43, 56` — cites `/api/auth/oauth/github` and the
  `EventSource`-bypasses-the-interceptor incident. Useful as a reverse-checklist.
- `docs/handoff-license-server-validation-pipe.md:65` — curl example against `v1/admin/groups`
  (unchanged path; no edit needed).
- `apps/ptah-license-server/.env.example` / `.env.prod.example` — `WORKOS_REDIRECT_URI` comment.
- **`.env` + WorkOS dashboard** — see §5.3. This is the only genuinely out-of-repo change.

**Confirmed clean:** no nginx/`.conf` files exist in the repo; no proxy path rewriting to update.
`apps/ptah-electron` and `apps/ptah-cli` contain **zero** license-server path literals — they consume
`libs/backend/vscode-core`'s `LicenseFetcher`, which calls only `/api/v1/licenses/verify`
(`license-fetcher.ts:108`), an unchanged path. **No extension-side change of any kind.**

---

## 5. Verification

### 5.1 The route map becomes an executable artifact

**New file: `apps/ptah-license-server/src/common/route-map.spec.ts`.** Infra-free for the same reason
B0's census is (TASK_2026_169 report §6(d): booting `AppModule` drags Prisma's `onModuleInit` in). It
reads `PATH_METADATA` off each controller class and off each handler descriptor, and `METHOD_METADATA`
off each descriptor, using the shared registry from §6.1.

Five groups:

1. **`EXPECTED_ROUTES` — the route map, as an array.**
   ```ts
   /** The complete registered route table. Sorted "<VERB> <path>", api prefix omitted.
    *  Counted from source on <date>: 64 routes. Any change to the server's HTTP
    *  surface must show up as a diff HERE, in review, before it ships. */
   const EXPECTED_ROUTES: readonly string[] = [
     /* 64 entries */
   ];
   ```
   asserted with `expect(actual.sort()).toEqual(EXPECTED_ROUTES)`. This is strictly better than a
   count: the failure diff **names the route** that appeared, vanished, or moved. It is also the
   before/after artifact §5.2 needs, versioned in git, updated one batch at a time.
2. **RI-1**, with an `PREFIX_EXCEPTIONS` list expressed as data (`{ label, reason }`, same shape as
   B0's `EXCLUDED`) containing exactly `marketing/PublicMarketingController` and the §2.5 reason.
   Assert each exception still has the prefix it is excused for, so it cannot outlive its subject.
3. **RI-2**, with a `KNOWN_CONTESTED` ledger seeded with the ten pairs from §1 and **the same
   un-rottable double guard B0 proved**: a pair listed but no longer contesting fails the staleness
   assertion; a pair removed while still contesting fails the main assertion. R2 and R3 empty it.
4. **RI-3**, per controller.
5. **Anti-vacuity:** assert the enumerator discovered routes for every controller in the registry
   (`>= 1` each), and that no segment form outside `literal | :param` was seen — the parser must
   **throw** on `*`, `{}`, or an optional-param form rather than silently pass. Today none exist; the
   day someone adds one, the test says so instead of quietly under-checking.

Two decorator quirks the enumerator must handle, both verified in source:
`events.controller.ts:76` uses `@Sse('subscribe')` (Nest sets `METHOD_METADATA` to `RequestMethod.GET`)
and `discourse.controller.ts` pairs `@Get('discourse')` with `@Redirect()`. Neither is a verb
decorator the naive reader expects.

**Falsification is mandatory**, exactly as B0 did it (its report §4 sets the bar). Four probes,
captured failing **and** restored:
(a) move `AdminRecordsController` back to `@Controller('v1/admin')` → RI-1 **and** RI-2 fail, naming
the contesting pair; (b) delete one line from `EXPECTED_ROUTES` → the diff names it; (c) remove a
`KNOWN_CONTESTED` entry while the contest still exists → main assertion fails; (d) add a bogus
`KNOWN_CONTESTED` entry → staleness fails.

**Deleted in the same commit as the spec** (R2), because the invariant becomes enforced rather than
requested:

- `app/app.module.ts:66-71` — the ordering comment.
- **`admin/admin-guards.spec.ts` G3** (`app-guards.spec.ts:142-163`, _"registers PacksModule before
  AdminModule"_). This is the ordering comment's test-shaped twin. Once the wildcards live under
  `v1/admin/records`, module order genuinely does not matter, and leaving G3 would freeze an arbitrary
  array ordering as if it were an invariant. Its replacement is RI-2, which asserts the property G3
  was proxying for. Its removal note in the file docblock must point at `route-map.spec.ts` — the same
  courtesy B0 paid when it moved G7.
- `packs/admin-packs.controller.ts:47-51` — the ⚠️ ROUTING docblock repeating the same warning.

### 5.2 Enumerating the _real_ registered route table (before/after)

The spec above reads metadata. To prove the **actually registered** table is what we think it is, use
Nest's own router log — `RouterExplorer` emits one `Mapped {<path>, <METHOD>} route` line per route at
log level `log`, which `main.ts:24-27` enables in both dev and prod:

```bash
docker compose restart ptah_license_server
docker compose logs --no-log-prefix ptah_license_server \
  | grep -oE 'Mapped \{[^}]*\}' | sort -u > /tmp/routes-before.txt
# … land R2/R3/R4, rebuild …
docker compose logs --no-log-prefix ptah_license_server \
  | grep -oE 'Mapped \{[^}]*\}' | sort -u > /tmp/routes-after.txt
diff /tmp/routes-before.txt /tmp/routes-after.txt
```

**Acceptance:** the diff contains exactly the 16 rows of §2.2 (each as one `-`/`+` pair) and the line
counts are equal at **64**. Any extra line is a route accidentally created or destroyed by the move.
Paste both files and the diff into the implementation report.

### 5.3 Full-surface old-404 / new-200 curl matrix

Hard cutover means both directions must be proven for every changed route:

| Case                                                                                                                                                                                                                                                          | Expect                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Old path, any verb** — e.g. `GET /api/v1/admin/users?pageSize=1`, `PATCH /api/v1/admin/users/<id>`, `POST /api/v1/admin/licenses`, `POST /api/auth/login/email`                                                                                             | **404** (no alias survived)                                                      |
| **New path, valid request**                                                                                                                                                                                                                                   | the same status the old path returned before the move (200/201/…)                |
| **New path, wrong auth**                                                                                                                                                                                                                                      | 401 anonymous / 403 non-admin — the guard chain must have moved with the handler |
| **Unchanged neighbours** — `POST /api/v1/admin/waitlist/invite`, `GET /api/v1/admin/stats`, `GET /api/v1/admin/packs`, `GET /api/v1/admin/groups`, `GET /api/v1/admin/sessions`, `GET /api/v1/admin/marketing/segments`, `GET /api/v1/admin/community/topics` | unchanged status — proves the split did not disturb the neighbours               |

Mint the `ptah_auth` cookie the way `scripts/community-gate-smoke.mjs:40-45` does; use
`x-api-key: $ADMIN_SECRET` for `v1/integrations/licenses`.

**One case deserves its own line:** `GET /api/v1/admin/records/users?pageSize=1` must return 200 for
an admin, because `admin-auth.guard.ts` gates the entire dashboard on it (§4.1).

### 5.4 Gates

```bash
npx nx test ptah-license-server --skip-nx-cache   # 638 + route-map.spec − G3's 1 test
npx eslint apps/ptah-license-server/src/<touched>
npx tsc -p apps/ptah-license-server/tsconfig.app.json  --noEmit
npx tsc -p apps/ptah-license-server/tsconfig.spec.json --noEmit
node scripts/community-gate-smoke.mjs            # verbatim, unmodified — exit 0
node scripts/discourse-e2e.mjs                   # verbatim, unmodified — exit 0
node scripts/google-calendar-write-smoke.mjs     # verbatim, unmodified — exit 0
npx nx e2e ptah-landing-page-e2e                 # required for R4 (auth globs)
```

**All three smoke scripts touch only unchanged paths** (`v1/community/summary`, `v1/sso/discourse`,
`v1/admin/sessions*`) — verified line by line. They therefore remain clean, un-edited regression gates
across the entire restructure, which is exactly the property TASK_2026_169 relied on. If any of them
needs an edit, something moved that was not supposed to.

---

## 6. Impact on B0's `controller-validation.spec.ts`

Read `implementation-report-b0.md` before touching it. Nothing about B0's _design_ changes; the
inputs do.

### 6.1 Extract the shared registry (do this first, in R1)

`route-map.spec.ts` needs the same 21-entry controller list `controller-validation.spec.ts:81-191`
holds. Duplicating it would create exactly the drift both specs exist to prevent.

**Move `ALL_CONTROLLERS` (and `SRC` / `findControllerFiles`) to
`apps/ptah-license-server/src/testing/controller-registry.ts`**, and have both specs import it.
`src/testing/` is the established home for test-only modules in this app
(`mock-prisma.factory.ts`, `nest-module-builder.ts`, `testcontainers/postgres.ts`, `fixtures/paddle/`,
barrel at `testing/index.ts`), and I verified it is **not reachable from `main.ts`** — no non-spec file
imports it — so esbuild does not bundle it.

Two mechanical traps:

- `SRC = join(__dirname, '..')` is `__dirname`-relative. From `src/testing/` that still resolves to
  `src/`, same as from `src/common/` — but it must be re-derived deliberately, not copied.
- Do **not** add the registry to `testing/index.ts`. The barrel is imported by real test harnesses;
  pulling 21 controller classes (and their whole DI graph) into every consumer is a needless cost.
  Import it by direct path.

_Alternative if extraction is judged too risky mid-flight:_ duplicate the list in `route-map.spec.ts`
and add a cross-check assertion in each (`both specs list the same labels`). Worse, but honest.

### 6.2 Concrete edits, in the order the batches land

| Constant                       | Edit                                                                                                                                                                                                                                             | Batch        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `ALL_CONTROLLERS`              | remove `admin/AdminController` (`admin/admin.controller.ts`); add 5: `admin/AdminRecordsController`, `admin/AdminUsersController`, `admin/AdminStatsController`, `admin/AdminWaitlistController`, `admin/AdminLicensesController`                | R2           |
| `ALL_CONTROLLERS`              | `license/AdminController` → `license/IntegrationLicensesController`, file `license/controllers/integration-licenses.controller.ts`                                                                                                               | R3           |
| `ALL_CONTROLLERS`              | the two `AdminController as …` **aliased imports collapse to plain imports** — after R3 no duplicated class name remains in the server                                                                                                           | R3           |
| `ALL_CONTROLLERS`              | `app/auth/AuthController` → `auth/AuthController`, file `auth/auth.controller.ts`                                                                                                                                                                | R5 (gated)   |
| `UNVALIDATED_DEBT`             | `'admin/AdminController' // B7` → four lines: `admin/AdminRecordsController` (B7a), `admin/AdminUsersController` (B7b), `admin/AdminLicensesController` (B7c), `admin/AdminWaitlistController` (B7d)                                             | R2           |
| `UNVALIDATED_DEBT`             | `'license/AdminController' // B9` → `'license/IntegrationLicensesController' // B9`                                                                                                                                                              | R3           |
| `UNVALIDATED_DEBT`             | `'app/auth/AuthController' // B3` → `'auth/AuthController' // B3`                                                                                                                                                                                | R5 (gated)   |
| `MIN_TOTAL_PAYLOAD_PARAMS`     | **stays 39** — see below                                                                                                                                                                                                                         | verify in R2 |
| `NAMED_PRIMITIVE_PARAM_COUNT`  | **stays 8** — update the docblock's file paths (`app/auth/auth.controller.ts:246,…` → `auth/auth.controller.ts:…`)                                                                                                                               | R5 (gated)   |
| `EXCLUDED`                     | unchanged (`marketing/ResendWebhookController`)                                                                                                                                                                                                  | —            |
| census (`findControllerFiles`) | **automatic** — it scans the tree, so new/moved/renamed files are picked up with no edit; the `ALL_CONTROLLERS[].file` fields must match or the census fails, and the "each entry names the class its file exports" assertion catches the rename | —            |

⚠️ **`admin/AdminStatsController` must NOT go into `UNVALIDATED_DEBT`.** It has zero payload params, so
B0's staleness assertion (_"still has at least one unbound param"_) would fail on it. It goes into
`ALL_CONTROLLERS` only, joining `ENFORCED`, where it passes vacuously — exactly as the other seven
param-free controllers already do (B0 report §6 C2).

### 6.3 How the ledger stays meaningful across a 1→5 split

The coordinator's concern — _"a controller that becomes three must not silently drop off"_ — is
already structurally answered by B0's design, in three independent ways:

1. **The census** (B0 §3 N1, falsified at §4.4) scans `src/**/*.controller.ts` and fails if any file is
   missing from `ALL_CONTROLLERS`. The four new admin controller files **cannot** be forgotten.
2. **The main assertion** covers every controller in `ALL_CONTROLLERS` that is not in the ledger or
   `EXCLUDED`. So the failure mode for "added the controller, forgot the ledger line" is _the strict
   one_: the controller is enforced immediately and fails until it is bound or ledgered. Silent
   omission is impossible in that direction.
3. **The staleness assertion** rejects a ledger entry for a controller with nothing left to bind, so
   the split cannot smuggle in a decorative line.

The one thing none of these catches is the _arithmetic_: that the 6 payload params on
`admin/AdminController` end up as 2+2+1+1+0 = 6 across the five new controllers, and not 5.
**`MIN_TOTAL_PAYLOAD_PARAMS = 39` is that check** — the split moves params, never adds or removes them,
so the total must be **identical** before and after. R2's acceptance criteria must state that
explicitly, and the developer should temporarily raise the constant to 999 to print the received value
(the technique B0 used at §3 N2) and confirm it reads **39**, not "≥ 39".

### 6.4 Other spec fallout

- `admin/admin-guards.spec.ts` — G3 deleted (§5.1). G1's `it.each` list and its
  _"is mounted under `v1/admin/`"_ assertion are unaffected (the four controllers it names do not
  move). Its import of `JwtAuthGuard` at line 13 changes in R5.
- `discourse/community.controller.spec.ts:20,21` imports from `../app/auth/…`. **The spec is not on the
  protected list** (only `community.controller.ts` is), so it is editable in R5.
- `admin/admin.service.spec.ts` — untouched: `AdminService` is not split.
- `license/controllers/admin.controller.spec.ts` — renamed with its subject in R3.

---

## 7. Revised batch plan

R-batches slot in **before B1**. B0 is already committed, so every ledger edit below is a modification
to a tracked file (no `git add` of a new path, and none of the `.ptah/**` gitignore trouble from
B0 report §3 N3).

### 7.1 The R batches

| Batch     | Content                                                                                                                                                                                                                                                                                                                                                 | Files                                                                                                                                                                                                      | Parallel?        | Executor                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------- |
| **R1**    | Extract the shared controller registry to `src/testing/controller-registry.ts`; both specs import it. **No route change, no behaviour change.** Suite must be green and the 29 B0 tests unchanged in count.                                                                                                                                             | `src/testing/controller-registry.ts` (new), `src/common/controller-validation.spec.ts`                                                                                                                     | **First, alone** | sub-agent                                             |
| **R2**    | Split `admin/AdminController` into 5 controllers; register in `AdminModule`; **`route-map.spec.ts`** with `EXPECTED_ROUTES` + `KNOWN_CONTESTED` seeded and the falsification proofs; delete G3, the `app.module.ts:66-71` comment, and `admin-packs.controller.ts:47-51`; update `admin-api.service.ts` ×3 + `admin-auth.guard.ts` ×1; update B0 ledger | 5 new + `admin.controller.ts` deleted, `admin.module.ts`, `route-map.spec.ts`, `admin-guards.spec.ts`, `app.module.ts`, `admin-packs.controller.ts`, `controller-validation.spec.ts`, 2 landing-page files | after R1         | **sub-agent** — highest judgement density in the task |
| **R3**    | `license/AdminController` → `IntegrationLicensesController` @ `v1/integrations/licenses`; rename file + spec; `LicenseModule` import; fix the `X-API-Key` docblock; empty the rest of `KNOWN_CONTESTED`; update B0 ledger + `EXPECTED_ROUTES`                                                                                                           | 4 files                                                                                                                                                                                                    | after R2         | sub-agent                                             |
| **R4**    | `auth` → `v1/auth`: `auth.controller.ts:89`, `magic-link.service.ts:91` + spec, 5 DTO header comments, 3 landing-page constants, 4 Playwright globs, `COOKIES.md`, docs; update `EXPECTED_ROUTES`                                                                                                                                                       | ~16 files                                                                                                                                                                                                  | after R3         | sub-agent — **operational precondition, §7.3**        |
| **R5** 🔒 | `src/app/auth/` → `src/auth/`: 28 import sites incl. 2 protected files; `controller-validation.spec.ts` label/file/docblock                                                                                                                                                                                                                             | ~28 files                                                                                                                                                                                                  | after R4         | **GATED on §0**                                       |

**Why R1 is alone and first:** it is the only batch that touches a spec B0 just proved, and it must be
demonstrably a no-op (same 29 tests, same names, green) before anything moves. Landing it inside R2
would make R2's failure modes ambiguous.

**Why R2–R5 are strictly sequential:** all four edit `EXPECTED_ROUTES` and the B0 ledger. Parallelising
them buys a couple of hours and costs a merge conflict in the two files whose whole purpose is to be
the single source of truth. Not worth it.

**No CLI-agent batches here.** Every R batch either changes a route (hard cutover, 404 on a miss) or
edits a structural guard. B0's report §9 already flagged that copied docblock text needs reviewer
attention; a context-free helper is a net risk on this work. This differs from §8 of the original
plan, where five B batches were CLI-eligible — those are single-line pipe bindings with a curl matrix
behind them.

### 7.2 What happens to B1–B9

| Batch                  | Status                     | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **B1** waitlist        | ✅ unchanged               | `v1/waitlist` does not move                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **B2** license verify  | ✅ unchanged               | `v1/licenses/verify` does not move. Still gated on data check D1                                                                                                                                                                                                                                                                                                                                                                                             |
| **B3** auth            | ⚠️ **amended**             | Ledger label `app/auth/AuthController` → `auth/AuthController` **iff R5 lands**. The `dtoPipe` import becomes `'../common/dto-validation.pipe'` (one level) after R5, and remains `'../../common/dto-validation.pipe'` if R5 is dropped — B0 report §2 already corrected the original plan's `../../../`, and R5 changes it again. **State the resolved depth in `tasks.md` after §0 is decided.** The `jwt-auth.guard.ts` fix (C4) moves with the directory |
| **B4** contact         | ✅ unchanged               |                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **B5** session         | ✅ unchanged               |                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **B6** subscription    | ✅ unchanged               |                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **B7** admin           | 🔴 **dissolved into four** | see below                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **B8** admin-marketing | ✅ unchanged               | `v1/admin/marketing/*` does not move. Still includes the `marketing-compose.ts` `name`-cap caller fix                                                                                                                                                                                                                                                                                                                                                        |
| **B9** license admin   | ⚠️ **retargeted**          | Now `license/controllers/integration-licenses.controller.ts`, class `IntegrationLicensesController`, ledger label `license/IntegrationLicensesController`. `CreateLicenseDto` and its SAFE/zero-blast-radius assessment are unchanged                                                                                                                                                                                                                        |

**B7 → B7a/B7b/B7c/B7d.** One commit per controller, matching the plan's commit-per-controller rule:

| New batch | Controller                | Param bindings                                                                | Notes                                                                                                                                                                                                                 |
| --------- | ------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B7a**   | `AdminRecordsController`  | `@Query(dtoPipe(ListQueryDto))`, `@Body(passthroughDtoPipe(UpdateRecordDto))` | 🔴 **Carries F1.** The only legitimate `passthroughDtoPipe` call site in the server. Its curl matrix case C is inverted: an unknown field must still return **200**, and that is the assertion proving F1 was handled |
| **B7b**   | `AdminUsersController`    | `@Body(dtoPipe(BulkEmailDto))`, `@Body(dtoPipe(DeleteUserDto))`               | `bulkEmail` has no in-repo caller — zero blast radius                                                                                                                                                                 |
| **B7c**   | `AdminLicensesController` | `@Body(dtoPipe(IssueComplimentaryLicenseDto))`                                | The never-enforced XOR / `@ValidateIf` / `@Transform` finding; check the `{userId:''}` caller edge                                                                                                                    |
| **B7d**   | `AdminWaitlistController` | `@Body(dtoPipe(InviteWaitlistDto))`                                           | `@Max(1000)` newly enforced                                                                                                                                                                                           |

`AdminStatsController` needs no batch — no payload param.

**Tier ordering is preserved after the R batches:**
R1 → R2 → R3 → R4 → (R5) → **Tier 1** {B1, B2, B3} → **Tier 2** {B4, B5, B6} → **Tier 3** {B7a, B7b,
B7c, B7d, B8, B9}. Within a tier the original parallelism and executor assignments stand.

### 7.3 Operational preconditions (out-of-repo, must happen BEFORE the deploy that carries R4)

1. **WorkOS redirect URI.** `auth.service.ts:40-41` reads `WORKOS_REDIRECT_URI` via `ConfigService`
   (correct — no `process.env`). The value must change from `…/api/auth/callback` to
   `…/api/v1/auth/callback` in `.env` **and** in the WorkOS dashboard's allowed-redirect list. WorkOS
   requires exact matches. **Register the new URI first, keep the old one registered until the deploy
   is confirmed, then remove it.** That transient overlap is _provider configuration_, not code — it
   does not violate the no-dual-mounting decision, and there is no safe alternative.
2. **Magic links already sent** point at `/api/auth/verify?token=…`. They 404 after the cutover.
   Blast radius is genuinely small: magic-link TTL is **2 minutes** (`auth.controller.ts:405`,
   `magic-link.service.ts`), so the exposure is a ≤2-minute window at deploy. Deploy off-peak and note
   it; do not build an alias for it.
3. **Discourse `discourse_connect_url`** is set to `/api/v1/sso/discourse` in the forum's
   SiteSettings (`.env.example:265`, `docs/deploy/discourse-digitalocean.md:180,221`).
   **That path does not change in this plan** — listed here only so nobody "helpfully" versions it.

---

## 8. Ordering and risk

### 8.1 The restructure must fully precede the DTO binding

**The decisive argument is about what each change is verified by.** A move is verified by _nothing
changed_ — identical route count, identical param census, three smoke scripts green without edits. A
binding is verified by _something changed_ — an invalid payload that used to 201 now 400s.
**Interleave them and neither verification is clean:** a 400 during testing could be the new
validation working, or a moved handler landing on the wrong guard chain, or a stale caller hitting a
dead path. You lose the ability to attribute a failure, which is the entire value of
commit-per-controller.

Three mechanical reasons reinforce it: B7's target class ceases to exist; B9's target is renamed; B3's
target file may move. Binding a DTO onto a class about to be split into five means doing the work
twice and reviewing it twice.

B1, B2, B4, B5 and B6 touch controllers that do not move and _could_ interleave. **Do not.** The
sequencing cost is a few hours; the benefit is that every R commit can assert "the route table is
identical except for these named lines" against a tree with no other in-flight behaviour change.

### 8.2 What makes this hard cutover more dangerous than it looks

Ranked by how quietly it fails:

1. 🔴 **`admin-auth.guard.ts:32` locks every admin out of the dashboard** if it is not updated in the
   same commit as R2. The probe returns 404, the guard reads that as "not an admin", and there is no
   error message anywhere that says "route moved". §4.1.
2. 🔴 **The WorkOS redirect URI is outside this repo.** Deploy R4 without updating WorkOS and OAuth
   login breaks for everyone, with an error surfaced by WorkOS, not by us. §7.3.
3. 🟠 **`PublicMarketingController`'s email-embedded URLs are unfixable after the fact.** This plan
   does not move them — but if anyone "completes" the versioning work later, `/api/unsubscribe/:token`
   is baked into every marketing email ever sent. §2.5.
4. 🟠 **Docker healthchecks are functional config, not documentation.** `/api/health` appears in three
   files that are not TypeScript and will not fail a typecheck. §2.5.
5. 🟡 **The `EventSource` SSE path bypasses the Angular HTTP interceptor**
   (`sse-events.service.ts:128`, and `docs/deployment/PRE_PUBLISH_AUDIT_HANDOFF.md:56` records this as
   a prior production incident). `sseBaseUrl` (`/api/v1/events`) does not change, but `authBaseUrl`
   (`/api/auth`, line 129) does — and a bug in that file will not be caught by any interceptor-level
   test. Exercise the stream ticket path manually in R4.
6. 🟡 **`git mv` on 28 import sites is easy to half-do.** A missed import is a compile error, which is
   the _good_ failure mode — but a missed **string** (a docblock path, a spec label, a `tasks.md`
   reference) is silent. Grep for `app/auth` across the repo after R5 and expect zero hits outside
   documentation you have chosen to leave.
7. 🟢 **Not a risk, worth saying:** the extension, Electron and CLI need **no change at all**. They
   reach the server only through `libs/backend/vscode-core`'s `LicenseFetcher`, which calls
   `/api/v1/licenses/verify` — unchanged. No client release is coupled to this work.

### 8.3 Rollback

Each R batch is one coherent unit: a route change plus its callers plus its `EXPECTED_ROUTES` rows.
`git revert` on any single R commit restores that route, its callers and its expectations together —
the spec is what makes that atomic, because a partial revert leaves `EXPECTED_ROUTES` disagreeing with
the code and the suite goes red immediately. R2 cannot be reverted while R3/R4 are live (they edit the
same files); reverting R2 means reverting forward from it. R4 additionally requires reverting the
WorkOS redirect URI, which is why the old URI should stay registered until the deploy is confirmed.

---

## 9. Handoff checklist

- [ ] **§0 decided** — Option A (waiver) or Option B (defer R5). Nothing else is blocked by it.
- [ ] R1 lands alone and is provably a no-op (29 B0 tests, same names, green).
- [ ] R2's `route-map.spec.ts` has all four falsification proofs captured failing **and** restored.
- [ ] `MIN_TOTAL_PAYLOAD_PARAMS` re-derived by probe after R2 and confirmed to read exactly **39**.
- [ ] `admin-auth.guard.ts:32` updated **in the same commit as R2** — this is the lockout.
- [ ] `routes-before.txt` / `routes-after.txt` / their diff pasted into the report; 64 lines each.
- [ ] Old-path-404 proven for all 16 changed routes; new-path-200 proven for all 16.
- [ ] Three smoke scripts run **verbatim, unmodified**, exit 0. If one needs an edit, stop.
- [ ] WorkOS redirect URI registered **before** the R4 deploy; old one removed **after** confirmation.
- [ ] Post-R5: `grep -rn "app/auth" apps/ptah-license-server/src` returns zero hits outside docs.
- [ ] `tasks.md` updated: B7 → B7a–B7d, B9 retargeted, B3's import depth resolved per §0.
