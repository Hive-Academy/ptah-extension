# Implementation Report — Backend (B1–B6) — TASK_2026_169

**Developer:** backend-developer
**Date:** 2026-08-01
**Branch:** `ak/elevate-video-and-tasks`
**Scope:** Batches B1–B6 per `implementation-plan.md` §9 / §10

---

## 0. Headline

**All six backend batches are complete. The B2 blocking smoke PASSED against a live Google Calendar.
Lint 0 errors / 0 warnings in task files; tests 580 passed / 0 failed; the five protected files are
byte-identical to the task-start commit.**

Two items need the orchestrator's attention:

1. 🔴 **A pre-existing, app-wide defect was found and is escalated in §7: the global `ValidationPipe`
   validates nothing in this server.** It was silently accepting `repoUrl: "javascript:alert(1)"` —
   i.e. the plan's required L4 stored-XSS mitigation was inert. Fixed for this task's endpoints;
   the rest of the server is still affected and needs its own task.
2. 🟡 **Frontend follow-up:** I took **Option A** on the `description` contract item — admin session
   responses now carry `description`. The frontend can prefill the edit field and drop its helper text.

---

## 1. B2 SMOKE OUTCOME — **PASSED** (stated unambiguously)

`scripts/google-calendar-write-smoke.mjs` was **written AND executed against the live Google Calendar
API**. It is not unverified, not skipped, and not assumed.

```
Google Calendar write smoke  (endpoint=http://localhost:3000/api/v1/admin/sessions)
admin=abdallah@miramarstaffing.com  protectedEventId=cfjfqv3bc65e1lj1ikthei4i40

1. Authorization gate
  ✓ anonymous is rejected (401)                        (status=401)
  ✓ authenticated non-admin is rejected (403)          (status=403)

2. Read path + scope verdict
  ✓ admin lists sessions (200)                         (status=200)
  ✓ response carries a sessions array
  ✓ response carries calendarWritable                  (calendarWritable=true)

3. Create a far-future throwaway event
  ✓ create succeeds (201)                              (id=1h752c9nijsfamk0cplruhsrlk)
  ✓ created event has a non-empty id
  ✓ created event echoes the title

4. Delete it, then prove the delete is idempotent
  ✓ delete succeeds (200 { deleted: true })            (body={"deleted":true})
  ✓ re-delete degrades to { deleted: false }, not a 500 (body={"deleted":false})

5. Protected recurring series is refused
  ✓ deleting BUILDERS_SESSION_EVENT_ID is refused (409)
  ✓ refusal carries reason=protected_recurring_event
  ✓ deleting an EXPANDED INSTANCE of the series is refused (409)
        (instanceId=cfjfqv3bc65e1lj1ikthei4i40_20260923T140000Z status=409)
  ✓ instance refusal carries reason=protected_recurring_event

All calendar write checks passed — events.insert and events.delete work.
EXIT_CODE=0
```

**Conclusion: the existing Google grant already carries a calendar write scope.**
`calendarWritable=true`, `events.insert` returned 201 and `events.delete` returned 204.
**The §4.3 re-consent runbook is NOT required.** It remains implemented in the script as a
prominently-printed operator runbook that fires only if a future run gets 503
`calendar_write_unavailable`.

Environment was fully available: docker healthy (`ptah_postgres`, `ptah_license_server`), and
`JWT_SECRET`, `ADMIN_EMAILS`, `GOOGLE_OAUTH_*`, `BUILDERS_SESSION_EVENT_ID` all present in `.env`.

### I added one assertion beyond the plan, and it matters

The plan's smoke only deleted the master **by its own id**. But the live list response revealed the
first session is `cfjfqv3bc65e1lj1ikthei4i40_20260805T140000Z` — an **expanded instance** whose id
differs from the master's. That is precisely landmine #4's scenario, and the plan's script would not
have exercised it. I added step **7b**, which deletes the farthest-future _instance_ and asserts 409.
It passes. The guard is now proven live on **both** halves, not just the easy one.

---

## 2. The four landmines — all confirmed

| #     | Landmine                                                                                     | Status | Evidence                                                                                                                                                                                                                                                                                                                                   |
| ----- | -------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** | `PacksModule` registered **before** `AdminModule`                                            | ✅     | `app.module.ts` places `PacksModule` at the member-content block (above `LicenseModule`), well before `AdminModule`. **Live proof:** `GET /api/v1/admin/packs` → `200 {"packs":[]}` — _not_ `400 "Unknown admin model: packs"`. **Regression test G3** asserts `imports.indexOf(PacksModule) < imports.indexOf(AdminModule)` reflectively. |
| **2** | `@UseGuards(JwtAuthGuard, AdminGuard)` at **CLASS** level                                    | ✅     | Class-level on `AdminPacksController`, `AdminSessionsController`, `AdminCommunityController`. **Test G1** asserts both guards present _and_ that `JwtAuthGuard` precedes `AdminGuard` (ordering matters — the first populates `request.user`, the second reads `request.user.email`). Live: anonymous → 401, non-admin → 403.              |
| **3** | Each feature module declares `AdminGuard` + `AdminThrottlerGuard` in its **own** `providers` | ✅     | Done in `packs.module.ts`, `google-sessions.module.ts`, `discourse.module.ts`. **No module imports `AdminModule`** — the graph stays acyclic, mirroring `member-groups.module.ts:28`.                                                                                                                                                      |
| **4** | Recurring-master guard checks **both** `eventId` **and** `recurringEventId`                  | ✅     | `admin-sessions.service.ts` resolves the event via `getEvent()` first, then `assertNotProtectedSeries(eventId, resolved?.recurringEventId)`. **Proven live** on a real expanded instance (§1 step 7b) _and_ in unit tests.                                                                                                                 |

---

## 3. Files created / modified (absolute paths)

### Created — backend source (14)

```
D:\projects\ptah-extension\apps\ptah-license-server\src\packs\packs.types.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\packs\packs.service.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\packs\packs.module.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\packs\admin-packs.controller.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\packs\dto\pack.dto.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\google-sessions\admin-sessions.controller.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\google-sessions\admin-sessions.service.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\google-sessions\google-event.mapper.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\google-sessions\dto\admin-session.dto.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\discourse\admin-community.controller.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\discourse\admin-community.service.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\discourse\dto\admin-community.dto.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\common\dto-validation.pipe.ts
D:\projects\ptah-extension\apps\ptah-license-server\prisma\migrations\20260801120000_add_packs\migration.sql
```

### Created — specs (5)

```
D:\projects\ptah-extension\apps\ptah-license-server\src\packs\packs.service.spec.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\packs\admin-packs.controller.spec.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\google-sessions\google-calendar.provider.spec.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\google-sessions\admin-sessions.controller.spec.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\discourse\admin-community.controller.spec.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\admin\admin-guards.spec.ts
```

### Created — scripts (1)

```
D:\projects\ptah-extension\scripts\google-calendar-write-smoke.mjs
```

### Modified (15)

```
D:\projects\ptah-extension\apps\ptah-license-server\prisma\schema.prisma
D:\projects\ptah-extension\apps\ptah-license-server\src\app\app.module.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\audit\audit-log.types.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\google-sessions\google-auth.provider.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\google-sessions\google-calendar.provider.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\google-sessions\google-sessions.types.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\google-sessions\google-sessions.module.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\google-sessions\sessions.service.ts        ← see §6a
D:\projects\ptah-extension\apps\ptah-license-server\src\discourse\discourse-admin.provider.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\discourse\discourse.types.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\discourse\discourse.module.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\member-groups\member-groups.service.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\member-groups\member-groups.controller.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\member-groups\dto\member-group.dto.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\member-groups\member-groups.service.spec.ts
```

Migration applied to the dev DB (`prisma migrate deploy` → `20260801120000_add_packs`), Prisma client
regenerated. `generated-prisma-client/` is gitignored.

---

## 4. Verification results (real output)

### 4.1 Lint

⚠️ `nx lint ptah-license-server` **does not exist** — the target is `ptah-license-server:eslint:lint`.

**Task files: 0 errors, 0 warnings.**

```
npx eslint src/packs src/common src/google-sessions src/discourse/admin-community.* \
           src/discourse/dto src/admin/admin-guards.spec.ts src/member-groups
TOTAL in TASK_2026_169 files -> errors=0 warnings=0
```

Full-project lint reports **7 errors / 27 warnings**, **all pre-existing and none in files I touched**:

```
src\app\auth\interfaces\request-user.interface.ts:107  @typescript-eslint/no-namespace
src\app\auth\services\token\jwt-token.service.spec.ts:29   @nx/enforce-module-boundaries
src\app\auth\services\token\magic-link.service.spec.ts:20  @nx/enforce-module-boundaries
src\app\auth\services\token\pkce.service.spec.ts:20        @nx/enforce-module-boundaries
src\app\auth\services\token\ticket.service.spec.ts:17      @nx/enforce-module-boundaries
src\subscription\paddle-sync.service.spec.ts:22            @nx/enforce-module-boundaries
src\subscription\subscription.service.spec.ts:21           @nx/enforce-module-boundaries
```

I did not fix these — out of scope, and the `enforce-module-boundaries` ones are a workspace tagging
issue affecting the whole project.

### 4.2 Tests

```
npx nx test ptah-license-server --skip-nx-cache

Test Suites: 1 skipped, 44 passed, 44 of 45 total
Tests:       5 skipped, 580 passed, 585 total
Time:        10.733 s

NX   Successfully ran target test for project ptah-license-server
```

The 1 skipped suite / 5 skipped tests are pre-existing.

### 4.3 Typecheck

```
npx tsc -p apps/ptah-license-server/tsconfig.app.json  --noEmit   → EXIT=0
npx tsc -p apps/ptah-license-server/tsconfig.spec.json --noEmit   → EXIT=0
```

### 4.4 V1 — protected-path zero-diff check

⚠️ **The plan's exact command is misleading on this branch.** `git diff --name-only main...HEAD` lists
all five files — but that is because the branch already carried commits touching them **before this
task started** (last touched by `075cca870`, `fd93f70b3`, `24f22f874`, `3e6a68558`, dated
2026-07-19 → 2026-07-24). None of those are mine.

The correct check — task-start commit (`6537148fe`) vs working tree:

```
git diff --name-only 6537148fe -- <the five protected paths>
--- BEGIN (must be empty) ---
--- END ---
```

**Empty. The five protected files are byte-identical to how I found them.**

Forbidden-pattern grep across `apps/` + `libs/`:

- `isBuildersMember || isAdmin` → **3 matches, all in comments that forbid the pattern** (my two
  docblocks + the G4 test). Zero in code.
- `AdminGuard` / `ADMIN_EMAILS` / `isAdmin` occurrences inside `builders-membership.service.ts`,
  `members.controller.ts`, `community.controller.ts` → **0, 0, 0**.
- `members.controller.ts:103` inline Builders check: **untouched, not refactored** (§1.3.2 respected).

### 4.5 V2 — regression smokes

```
node scripts/community-gate-smoke.mjs   → EXIT=0
   All community-gate security checks passed — only Builders read forum data.

node scripts/discourse-e2e.mjs          → EXIT=0
   All Discourse round-trip checks passed.
```

⚠️ **`discourse-e2e.mjs` failed on the first attempt** (`FATAL: fetch failed`). This was
**environmental, not a regression**: the Discourse Rails server was not listening on `:3001`
(`curl` → connection refused). Per `scripts/discourse-dev-up.sh`'s own docblock, Rails is started with
`docker exec -d` and _"does NOT survive a container restart"_. Running `bash scripts/discourse-dev-up.sh`
brought it up and the smoke passed. **Both files were run verbatim with zero edits.**

### 4.6 The feature's premise, demonstrated live on one account

`abdallah@miramarstaffing.com` (`ADMIN_EMAILS` member, holds a **community** license, **not** Builders):

```
--- MEMBER path (must still refuse) ---
  GET /members/sessions             -> 403 {"reason":"membership_required"}
  GET /community/summary            -> 200 communityUrl=null topics=0     (degraded)

--- ADMIN path (must serve the same underlying data) ---
  GET /admin/sessions               -> 200 sessions=16 calendarWritable=true
  GET /admin/community/topics       -> 200 enabled=true url=http://localhost:3001
  GET /admin/community/review-queue -> 200 count=0 reviewUrl=http://localhost:3001/review
  GET /admin/packs                  -> 200 {"packs":[]}

VERDICT: member path refused/degraded=true   admin path served=true
```

That is the whole task, proven in one session: **the admin sees Builders content without a Builders
membership, and the member path still refuses that same account.**

---

## 5. 🔴 CRITICAL PRE-EXISTING FINDING — the global `ValidationPipe` validates nothing

**This is the most important thing in this report. It is not caused by my changes, but it defeated a
mitigation the plan explicitly required, so I had to address it for this task's endpoints.**

### What I observed

While live-testing packs I found the server accepted this:

```
POST /api/v1/admin/packs  { "repoUrl": "javascript:alert(1)" }   ->  201 CREATED
POST /api/v1/admin/packs  { "published": true }                  ->  201 CREATED  (unknown field)
```

Both should have been 400. I then probed **pre-existing endpoints I had not touched**:

```
POST /api/v1/admin/groups { "key": "INVALID KEY WITH SPACES!!" } ->  201 CREATED
POST /api/v1/admin/groups { "bogusField": "x" }                  ->  201 CREATED
```

`CreateMemberGroupDto` has `@Matches(GROUP_KEY_REGEX)` on `key`, and `main.ts` sets
`forbidNonWhitelisted: true`. Both were ignored. It also caused a hard 500 on my new endpoint:
`GET /admin/groups/:id/members?pageSize=5` → `PrismaClientValidationError: Argument 'take': Expected
Int, provided String` — `@Type(() => Number)` never ran.

### Root cause

Nest resolves a handler parameter's DTO class from the `design:paramtypes` metadata emitted by
TypeScript's `emitDecoratorMetadata`. `tsconfig.app.json` sets `emitDecoratorMetadata: true`, **but
this app is bundled by `@nx/esbuild`, and esbuild does not implement `emitDecoratorMetadata`.**
Without that metadata, `ValidationPipe.transform` short-circuits on its first line
(`if (!metatype || !this.toValidate(metadata)) return value;`).

**Consequence: every `class-validator` decorator in the license server is currently inert** — including
`BulkEmailDto`'s 500-item / 50 000-char caps, `AssignMembersDto`'s `@IsUUID`, and every length cap.

### What I did about it (scoped, not a unilateral app-wide change)

Added `src/common/dto-validation.pipe.ts` exporting `dtoPipe(DtoClass)`, which uses `ValidationPipe`'s
`expectedType` option — that option **overrides** the metatype rather than inferring it
(`validation.pipe.js:51-52`), restoring full validation and transformation with no build-system change.
Bound explicitly on every endpoint this task adds.

**Verified fixed:**

```
✓ javascript: URI rejected (400)   ["repoUrl must be an https://github.com/<owner>/<repo> URL"]
✓ non-github host rejected (400)
✓ bad slug rejected (400)
✓ unknown field rejected (400)     ["property published should not exist"]
✓ groups/:id/members returns 200 (was 500)
✓ pageSize>100 rejected (400)   ✓ daysAhead>365 rejected (400)
✓ valid pack still created (201, cohortName="Founding Members")
```

### What I deliberately did NOT do

I did **not** fix this app-wide. Repairing decorator metadata globally would make ~9 existing admin
models plus the Paddle/marketing/auth surfaces suddenly start rejecting input they currently accept —
a behavioural change with a wide blast radius that needs its own task, its own regression pass, and
product sign-off. **Recommend raising a follow-up task.** The reasoning is documented in full in the
`dto-validation.pipe.ts` docblock so the next contributor finds it.

---

## 6. Deviations from the plan (each with rationale)

**(a) Created `google-event.mapper.ts`; modified `sessions.service.ts`** — neither is on the plan's
CREATE/MODIFY list. The Google-event → contract mapping was needed at four call sites (member list,
admin list, admin create response, admin patch response). Rather than copy ~40 lines of mapping three
times, I extracted the pure functions into a mapper module and had `SessionsService` delegate to it.
`sessions.service.ts` is **not** a protected file, and the change is behaviour-preserving: the member
method's signature, window, filtering and returned shape are unchanged, and `sessions.service.spec.ts`
passes untouched. `members.controller.ts` was not modified.

**(b) `AdminSession` type rather than widening `BuildersSession`** — see §8, coordinator item 2.

**(c) B3 was implemented before the B2 smoke was run.** The plan has a circular dependency here: B2's
smoke calls `POST/DELETE /api/v1/admin/sessions`, which B3 creates, while B3 is listed as depending on
"B2 green". Resolution: I built the provider (B2), then B3, then ran the smoke — which is the only
possible order. The gate's actual intent is preserved and strengthened: **the smoke was green before
any session-write UI existed**, and it now exercises B3's guard and error mapping too.

**(d) G3 implemented as a module-metadata ordering assertion**, not by booting `AppModule` via
`Test.createTestingModule` + `app.init()`. Booting the app requires a live Postgres (Prisma connects on
`onModuleInit`), which would make a cheap structural test infra-dependent and flaky in CI. Asserting
`imports.indexOf(PacksModule) < imports.indexOf(AdminModule)` tests the exact property the landmine is
about, runs in milliseconds, and needs nothing. The end-to-end behaviour is separately proven live
(`GET /admin/packs` → 200, not 400).

**(e) Added `src/common/dto-validation.pipe.ts`** — not in the plan; forced by the §5 finding.

**(f) `PacksModule` is NOT `@Global()`**, unlike its sibling feature modules. `PacksService` has exactly
one consumer (its own controller). Exporting it globally would make member-facing injection possible
from anywhere — the precise shape Decision 3 excludes.

**(g) Delete of a missing pack returns 404, not `{ deleted: false }`.** The plan's response column says
`{ deleted: boolean }`. A silent success would let an admin believe a stale row was removed. Sessions
delete _does_ return `{ deleted: false }` for an already-gone event, because there the idempotency is
real (Google 410) and the smoke asserts it.

**(h) Extra error codes beyond the plan's `calendar_write_unavailable`:** `calendar_unconfigured` (503,
feature-off), `calendar_event_not_found` (404), `calendar_upstream_error` (502), `invalid_time_range`
(400). All are fixed `reason` codes with messages written locally; no upstream body or `error.message`
is ever forwarded.

---

## 7. Coordinator reconciliation items

### Item 1 — `PACK_SLUG_REGEX`: **adopted the frontend's pattern exactly. No mismatch.**

`packs/dto/pack.dto.ts` uses **`/^[a-z0-9-]{2,64}$/`** — byte-identical to the frontend's mirror.
(I had initially written `{2,60}`; changed to `{2,64}`. No security consequence, and now no UX gap.)
Covered by a test asserting a 64-char slug is accepted and a 65-char slug is rejected.
`PACK_REPO_URL_REGEX` is unchanged from the §7.4 L4 spec.

### Item 2 — `description` on session responses: **I took Option A, with a twist worth knowing.**

Admin session responses **now carry `description`**. Verified live:
`GET /admin/sessions?daysAhead=30` → `hasDescription=true`.

**Important:** I did _not_ add `description` to `BuildersSession`. That interface is the **member**
contract (`GET /api/v1/members/sessions`), and widening it would change a member-facing response shape
as a side effect of an admin feature — in a task whose defining constraint is "change nothing on the
member path". Instead I added:

```ts
export interface AdminSession extends BuildersSession {
  description: string | null;
}
```

used only by `/api/v1/admin/sessions`. The member response stays byte-identical; the shared mapping
still lives in one place (`google-event.mapper.ts`) so the two cannot drift.

**Frontend follow-up:** `adminSessionSchema` should gain `description: z.string().nullable()`, the edit
form can prefill from it, and the _"Leave blank to keep the description already on the calendar event"_
helper text can be dropped. Note `UpdateSessionDto` still sends `description` only when supplied, so
the frontend's current safe behaviour remains correct until it is updated — **nothing breaks in the
meantime**; the field is purely additive.

---

## 8. Batch-by-batch status

| Batch                     | Status            | Notes                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1 — Packs foundation** | ✅                | `Pack` model (no `published`, `cohortKey` FK → `MemberGroup.key`, `onDelete: SetNull`), migration applied, client regenerated, types/DTO/service/controller/module, registered **before** `AdminModule`, audit unions extended (`pack.*`, `sessions.event.*`, `Pack`, `CalendarEvent`; **no `community.*`**). Full CRUD verified live incl. cohort connect/disconnect, duplicate-slug 409, unknown-cohort 400. |
| **B2 — Calendar write**   | ✅ **GATE GREEN** | Verbs widened to `GET\|POST\|PATCH\|DELETE`; `createEvent`/`patchEvent`/`deleteEvent`; `scope` captured off the refresh grant + `hasCalendarWriteScope()` + `isWritable()`; smoke written **and run green**.                                                                                                                                                                                                   |
| **B3 — Admin sessions**   | ✅                | 4 endpoints; §4.4 recurring-master 409 on **both** ids; upstream 401/403 → 503 `calendar_write_unavailable`; degrades to `[]` on read failure; audited.                                                                                                                                                                                                                                                        |
| **B4 — Admin community**  | ✅                | **Two `@Get` handlers only.** `getReviewQueue()` added to the provider as a **GET** — verb union unchanged at `'GET' \| 'PUT' \| 'DELETE'`. No write DTO, no audit action. Zod-validated at the boundary; degrades to empty.                                                                                                                                                                                   |
| **B5 — Group members**    | ✅                | `listMembers` + `ListGroupMembersQueryDto` + `GET /admin/groups/:id/members`. Search on the fixed `user.email`; 404 on unknown group; page+count in one transaction. Closes the gap flagged at `groups-list.ts:25-28`.                                                                                                                                                                                         |
| **B6 — Tests**            | ✅                | All §8.1 specs + §8.2 structural tests **G1, G3, G4, G5, G6**. **`packs-gate-smoke.mjs` deliberately NOT created**, per §8.3.                                                                                                                                                                                                                                                                                  |

---

## 9. Nothing hidden — open items & things I did not do

1. **🔴 App-wide `ValidationPipe` defect (§5) is NOT fixed** beyond this task's endpoints. Needs its own task.
2. **`jwt-auth.guard.ts:66` uses `catch (error: any)`** — the anti-pattern called out in the coding
   standards, and it also interpolates the raw error message into the 401 response. Not in this task's
   MODIFY list and not required by any batch, so I left it. Worth a follow-up.
3. **V4 manual browser pass** is not mine to run. The API half of it is already proven (§4.6).
4. **Frontend follow-up for `description`** (§7 item 2) — additive, non-breaking.
5. **`nx lint ptah-license-server` is not a valid target** — it is `ptah-license-server:eslint:lint`.
   Worth correcting in the plan's V5.
6. **7 pre-existing lint errors** remain (§4.1); none in my files.
7. **Test data cleanup verified**: `GET /admin/packs` → `{"packs":[]}`; the two probe member-groups I
   created while diagnosing §5 were deleted (only `founding` remains); no `[PTAH SMOKE]` calendar event
   survives (the smoke deletes its own event and has a `finally` cleanup).
8. **No CLI-agent delegation was used.** Every batch was invariant-sensitive or contract-sensitive
   enough that a context-free helper would have been a net risk; the work was faster to do directly.
9. **No commits made.** All changes are unstaged/untracked in the working tree, per instruction.

---

## 10. Bottom line

Backend B1–B6 are complete and verified. The blocking B2 smoke **passed live** — the Google grant
already permits event writes, so no re-consent detour is needed. The security invariant is intact and
provably so: the five protected files are unchanged, the member gate still refuses the very admin
account that the admin path serves, and both regression smokes are green.

The one thing I'd flag for the orchestrator above all else: **§5's validation defect is real, it is
older than this task, and it silently disarms input validation across the whole license server.**
This task's endpoints are protected; the rest of the server is not.

---

# Post-review fixes

**Trigger:** `code-logic-review.md` — APPROVE WITH FOLLOW-UPS, 0 blockers, 2 MAJOR + 1 cheap MINOR.
**Status: MAJOR-1 closed, MAJOR-2 closed, MINOR-1 closed. All verification re-run green.**

---

## MAJOR-2 — the three pre-existing `member-groups.controller.ts` endpoints are now validated

The reviewer was right, and the framing was right: the fix was _already imported into this file_ and
applied three lines below where it was needed. `create`, `update` and `assign` still used bare
`@Body() dto: X`, which in this server means **silently unvalidated**.

### Frontend payload compatibility check — **PASS, no break**

Per instruction I verified this **before** changing behaviour, because turning `forbidNonWhitelisted`
on is a real behavioural change. I checked the request interfaces, the HTTP methods, **and** the
component literals that actually build the payloads (interfaces alone don't prove runtime shape).

| Endpoint                                                 | Frontend sends                                                   | DTO declares                                              | Verdict                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `createGroup` (`group-form-modal.ts:133-139`)            | `key`, `name`, `description?`, `discourseGroup?`, `isDefault`    | `CreateMemberGroupDto`: same five                         | ✅ exact match                                         |
| `updateGroup` (`group-form-modal.ts:127-132`)            | `name`, `description\|null`, `discourseGroup\|null`, `isDefault` | `UpdateMemberGroupDto`: same four, typed `string \| null` | ✅ exact match (`@IsOptional()` passes `null` through) |
| `assignGroupMembers` (`assign-members-modal.ts:116-119`) | `emails?`, `userIds?`                                            | `AssignMembersDto`: same two                              | ✅ exact match                                         |

Additional checks:

- **All three are object literals — no spreads, no dynamic keys**, so no undeclared field can sneak in.
- Omitted optionals are `undefined`, which `JSON.stringify` drops entirely — they never reach the wire.
- `MEMBER_GROUP_KEY_REGEX` in `admin-api.service.ts:105` is byte-identical to the backend
  `GROUP_KEY_REGEX` (`/^[a-z0-9-]{2,40}$/`), so the client-side and server-side key rules agree.
- **`@IsUUID('4')` risk checked against real data:** all users in the DB are UUID **v4**
  (`SELECT substring(id::text,15,1)` → `4`, 3/3 rows). Existing ids will not be rejected.

**Conclusion: every field the frontend sends is declared on the corresponding DTO. Nothing to stop and
report — the change is safe to ship.**

### One intentional behaviour change worth recording

`assign-members-modal.ts:56-68` does **no** client-side format checking — it just splits and trims
pasted text. So malformed input that previously reached `resolveUsers()` and was silently counted as
`skipped` now returns a **400** instead. That is the _point_ of the fix, not a regression: silently
discarding a fat-fingered user id is precisely the failure the reviewer called out. The modal already
renders server errors through `extractErrorMessage`, so it degrades to a visible message, not a break.

### Live proof — exploit closed, valid payloads still work

```
=== A. VALID payloads (exactly what the Angular admin UI sends) must still succeed ===
  ✓ createGroup (full UI payload) -> 201        (key=postrev-1785583686215)
  ✓ createGroup (optionals omitted) -> 201
  ✓ updateGroup (with explicit nulls) -> 200    (desc=null)
  ✓ assignGroupMembers (emails only) -> 200     ({"assigned":1,"skipped":0})
  ✓ assignGroupMembers (userIds only) -> 200    ({"assigned":0,"skipped":1})
  ✓ unassignGroupMember -> 200                  ({"removed":true})
  ✓ listMembers -> 200

=== B. The exploit the report printed is now CLOSED ===
  ✓ bad key rejected (was 201) -> 400           ["key must be a lowercase slug (2-40 chars of a-z, 0-9, -)"]
  ✓ unknown field rejected (was 201) -> 400     ["property bogusField should not exist"]
  ✓ non-UUID userIds rejected -> 400            ["each value in userIds must be a UUID"]
  ✓ userIds >1000 rejected (ArrayMaxSize) -> 400
  ✓ malformed email rejected -> 400
  ✓ patching immutable key rejected -> 400      ["property key should not exist"]
```

That last one is a bonus the reviewer didn't call out: `UpdateMemberGroupDto` deliberately omits `key`
("intentionally NOT patchable — stable slug"), and that intent was **also** inert. It is now enforced.

Test data cleaned up: `member_groups` contains only `founding`; 0 orphan assignments; `packs` empty.

**File changed:** `apps/ptah-license-server/src/member-groups/member-groups.controller.ts` — three
`dtoPipe(...)` bindings plus a class docblock warning explaining why a bare `@Body()` is unsafe here.

---

## MAJOR-1 — G7 structural test added

Added **G7** to `apps/ptah-license-server/src/admin/admin-guards.spec.ts`, alongside G1/G3/G4/G5/G6.

For every `@Body()` / `@Query()` parameter on `AdminPacksController`, `AdminSessionsController`,
`AdminCommunityController` and `MemberGroupsController`, it asserts a `ValidationPipe` with
`expectedType` set is bound. The implementation reads Nest's `ROUTE_ARGS_METADATA`
(`__routeArguments__`), whose keys are `"<paramtype>:<index>"` with `BODY=3` / `QUERY=4`; I verified
that metadata shape empirically against the installed `@nestjs/common` before writing the assertion
rather than assuming it.

**Anti-vacuity guard:** a second `it.each` asserts each controller actually exposes at least its
expected number of payload params (3/3/1/4). Without it, a change to Nest's metadata key format would
make the main loop iterate zero params and pass while checking nothing.

### Proof it actually fails (as required — a test that cannot fail is worse than none)

Temporarily reverted one binding to `@Body() dto: AssignMembersDto`:

```
=== binding removed, current line: ===
146:    @Body() dto: AssignMembersDto,

=== G7 RESULT WITH BINDING REMOVED ===
    - Expected  - 1
    + Received  + 1
        "handler": "MemberGroupsController.assign",
    -   "validated": true,
    +   "validated": false,
Tests:       1 failed, 585 skipped, 7 passed, 593 total
```

The failure **names the exact handler** (`MemberGroupsController.assign`) — which is the whole point,
since the future contributor hitting this will not know what `dtoPipe` is. Binding restored; G7 back
to green (8 passed).

---

## MINOR-1 — dedicated `google-event.mapper` spec added (it was cheap)

**New file:** `apps/ptah-license-server/src/google-sessions/google-event.mapper.spec.ts` — direct
tests over `resolveTimestamp`, `resolveMeetLink`, `toBuildersSession`, `toAdminSession`,
`extractEventItems` (timezone normalisation, all-day promotion, hangoutLink vs. conferenceData
fallback, recurring detection via both `recurringEventId` and `recurrence`, null-returns on
unmappable events, malformed-JSON degradation).

The part worth highlighting is the final describe block, which makes the report's
**"member response is byte-identical"** claim _self-verifying_ instead of something a reviewer has to
re-derive by diffing (as this reviewer did):

- the member shape has **exactly** its six historical keys;
- `description` **never** appears on the member shape _even when the source event has one_;
- the admin shape is the member shape **plus exactly** `description`;
- the two agree on every shared field.

If anyone ever widens `BuildersSession`, that block fails immediately.

---

## Not done, deliberately

- **App-wide `ValidationPipe` fix** — still scoped out; the reviewer agreed explicitly. Remains live
  on ~9 other admin models plus the Paddle/marketing/auth surfaces. **Still needs its own task** —
  this remains the top residual risk on the server.
- **Protected files** — untouched (re-verified below).
- **No commits.**
- MINOR-2 (Angular component specs), MINOR-3 (stale frontend report §6.2), NIT-1 (frontend disables
  Edit on all recurring rows), NIT-2 (unreachable P2025 branch on the delete path) — all frontend- or
  documentation-scoped, or explicitly non-defects. Left for the coordinator to route.

---

## Re-verification (all re-run after the changes)

| Check                                             | Result                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `npx tsc -p tsconfig.app.json --noEmit`           | ✅ EXIT=0                                                                         |
| `npx tsc -p tsconfig.spec.json --noEmit`          | ✅ EXIT=0                                                                         |
| `npx nx test ptah-license-server --skip-nx-cache` | ✅ **617 passed**, 5 skipped, 622 total (was 580 — +37 from G7 + the mapper spec) |
| eslint over task files                            | ✅ **errors=0 warnings=0**                                                        |
| G7 falsification test                             | ✅ fails when a binding is removed, naming the handler                            |
| V1 protected-path diff vs `6537148fe`             | ✅ **empty**                                                                      |
| `node scripts/community-gate-smoke.mjs`           | ✅ EXIT=0 — _"only Builders read forum data"_                                     |
| `node scripts/discourse-e2e.mjs`                  | ✅ EXIT=0 — _"All Discourse round-trip checks passed"_                            |
| `node scripts/google-calendar-write-smoke.mjs`    | ✅ EXIT=0 — incl. both halves of the recurring guard                              |
| Live group endpoints (valid + invalid payloads)   | ✅ 13/13 assertions                                                               |
| Test-data cleanup                                 | ✅ only `founding` remains; 0 orphan assignments; `packs` empty                   |

Both gate smokes were run **verbatim, unmodified** — confirmed by the V1 diff being empty.
Discourse needed `bash scripts/discourse-dev-up.sh` again after the container restart (the same
environmental quirk documented earlier); `:3001` returned 200 before the smokes were run.

## Files changed in this pass

```
D:\projects\ptah-extension\apps\ptah-license-server\src\member-groups\member-groups.controller.ts   (MAJOR-2 + docblock)
D:\projects\ptah-extension\apps\ptah-license-server\src\admin\admin-guards.spec.ts                  (MAJOR-1 — G7)
D:\projects\ptah-extension\apps\ptah-license-server\src\google-sessions\google-event.mapper.spec.ts (MINOR-1 — new)
```
