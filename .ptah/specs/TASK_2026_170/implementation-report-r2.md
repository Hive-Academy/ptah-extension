# TASK_2026_170 — Batch R2 Implementation Report

**Batch**: R2 — Split `admin/AdminController` into five controllers; `route-map.spec.ts` with RI-1/RI-2/RI-3; delete the three redundant defences; update callers and the B0 ledger
**Executor**: `backend-developer` (sub-agent)
**Branch**: `ak/license-server-validation-pipe` (HEAD `26124aba1`, R1)
**Date**: 2026-08-01
**Status**: 🟢 **GREEN** — all gates pass, five falsification proofs captured failing and restored, the lockout path verified end-to-end against the running server.

---

## 0. Headline

| Gate                                                | Result                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npx nx test ptah-license-server --skip-nx-cache`   | **654 passed, 5 skipped, 659 total** (from 638/5/643) — Δ reconciled exactly in §5.1 |
| `npx eslint …/src/admin …/src/common …/src/testing` | exit 0, zero output                                                                  |
| `npx tsc -p tsconfig.app.json --noEmit`             | exit 0                                                                               |
| `npx tsc -p tsconfig.spec.json --noEmit`            | exit 0                                                                               |
| `npx nx lint ptah-landing-page`                     | **0 errors**, 49 pre-existing warnings, **none in either touched file**              |
| `node scripts/community-gate-smoke.mjs`             | exit 0, **verbatim/unmodified**                                                      |
| `node scripts/discourse-e2e.mjs`                    | exit 0, **verbatim/unmodified**                                                      |
| `node scripts/google-calendar-write-smoke.mjs`      | exit 0, **verbatim/unmodified**                                                      |
| Registered route table (`RouterExplorer` log)       | **65 → 65**, diff is exactly the 3 R2 rows                                           |
| Live route matrix (41 checks)                       | all pass                                                                             |
| `MIN_TOTAL_PAYLOAD_PARAMS` re-derived by probe      | **Received: 39** — exactly, not "≥ 39"                                               |

🔴 **The lockout is closed and proven live**: `GET /api/v1/admin/records/users?pageSize=1` → **200**, `GET /api/v1/admin/users?pageSize=1` → **404**, and `admin-auth.guard.ts` was updated in the same working tree (§7.1).

⚠️ **One live-test side effect occurred and was fully reverted, except for three emails that cannot be recalled.** Read §8 before anything else — it is a hazard B7d will hit again.

**Seven findings**, four of them corrections to the plan (§9).

---

## 1. Files changed

### CREATE (6)

| File                                                                                         | What                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\apps\ptah-license-server\src\admin\admin-records.controller.ts`  | `v1/admin/records` — `GET :model`, `GET :model/:id`, `PATCH :model/:id`, `assertModel()`, `AdminListResponse` |
| `D:\projects\ptah-extension\apps\ptah-license-server\src\admin\admin-users.controller.ts`    | `v1/admin/users` — `POST bulk-email`, `GET :id/deletion-preview`, `DELETE :id`, `AdminBulkEmailResponse`      |
| `D:\projects\ptah-extension\apps\ptah-license-server\src\admin\admin-stats.controller.ts`    | `v1/admin/stats` — `GET ()`                                                                                   |
| `D:\projects\ptah-extension\apps\ptah-license-server\src\admin\admin-waitlist.controller.ts` | `v1/admin/waitlist` — `POST invite`                                                                           |
| `D:\projects\ptah-extension\apps\ptah-license-server\src\admin\admin-licenses.controller.ts` | `v1/admin/licenses` — `POST complimentary`                                                                    |
| `D:\projects\ptah-extension\apps\ptah-license-server\src\common\route-map.spec.ts`           | The route map as an executable artefact. 13 tests.                                                            |

### DELETE (1)

| File                                                                                | Why                                                  |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `D:\projects\ptah-extension\apps\ptah-license-server\src\admin\admin.controller.ts` | Emptied by the split. All 9 handlers moved verbatim. |

### MODIFY (9)

| File                                                           | What                                                                                                                                                                     | Behaviour change?                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `…\src\admin\admin.module.ts`                                  | 1 controller → 5. `imports` array **byte-identical**. Docblock records the split rationale.                                                                              | No                                    |
| `…\src\admin\admin.service.ts`                                 | One `import type` line became two (`AdminListResponse` from `admin-records.controller`, `AdminBulkEmailResponse` from `admin-users.controller`).                         | No — both are type-only, fully elided |
| `…\src\admin\admin-guards.spec.ts`                             | **G3 deleted** + its two now-unused imports (`AppModule`, `AdminModule`); docblock rewritten into a removal note pointing at `route-map.spec.ts`. G1/G4/G5/G6 untouched. | No — test-only                        |
| `…\src\app\app.module.ts`                                      | **Ordering comment (66-71) deleted**, replaced by a provenance note saying the order is now free. `imports` array **byte-identical in content**.                         | No — comment only                     |
| `…\src\packs\admin-packs.controller.ts`                        | **⚠️ ROUTING docblock (47-51) deleted.**                                                                                                                                 | No — comment only                     |
| `…\src\common\controller-validation.spec.ts`                   | B0 ledger: `admin/AdminController` → 4 lines (B7a–B7d). `MIN_TOTAL_PAYLOAD_PARAMS` docblock gains the split-arithmetic rationale.                                        | No — value still 39                   |
| `…\src\common\dto-validation.pipe.ts`                          | Two stale references to `AdminController.update` / `src/admin/admin.controller.ts` corrected to `AdminRecordsController.update` / `admin-records.controller.ts`.         | No — comment only                     |
| `…\src\testing\controller-registry.ts`                         | `admin/AdminController` entry → 5 entries; docblock's duplicate-class-name paragraph corrected to past tense with the R2/R3 resolution.                                  | No                                    |
| `apps\ptah-landing-page\src\app\guards\admin-auth.guard.ts`    | 🔴 Probe path → `/api/v1/admin/records/users`; docblock updated + a ⚠️ block explaining why the path is load-bearing and why `stats` is the wrong probe.                 | **Yes — required.** §7.1              |
| `apps\ptah-landing-page\src\app\services\admin-api.service.ts` | `list`/`get`/`update` → `${base}/records/…` (3 call sites + their `validate()` error labels); class docblock records the `records` vs `users` distinction.               | **Yes — required.**                   |

### Nothing was staged. Nothing was committed.

`git status --short` at the end of R2:

```
 M apps/ptah-landing-page/src/app/guards/admin-auth.guard.ts
 M apps/ptah-landing-page/src/app/services/admin-api.service.ts
 M apps/ptah-license-server/src/admin/admin-guards.spec.ts
 D apps/ptah-license-server/src/admin/admin.controller.ts
 M apps/ptah-license-server/src/admin/admin.module.ts
 M apps/ptah-license-server/src/admin/admin.service.ts
 M apps/ptah-license-server/src/app/app.module.ts
 M apps/ptah-license-server/src/common/controller-validation.spec.ts
 M apps/ptah-license-server/src/common/dto-validation.pipe.ts
 M apps/ptah-license-server/src/packs/admin-packs.controller.ts
 M apps/ptah-license-server/src/testing/controller-registry.ts
 M libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts     <-- NOT MINE, DO NOT STAGE
?? apps/ptah-landing-page/src/app/pages/admin/builders/**/*.spec.ts    <-- 6 files, NOT MINE
?? apps/ptah-license-server/src/admin/admin-licenses.controller.ts
?? apps/ptah-license-server/src/admin/admin-records.controller.ts
?? apps/ptah-license-server/src/admin/admin-stats.controller.ts
?? apps/ptah-license-server/src/admin/admin-users.controller.ts
?? apps/ptah-license-server/src/admin/admin-waitlist.controller.ts
?? apps/ptah-license-server/src/common/route-map.spec.ts
```

**Exact `git add` for the orchestrator (16 paths; note `git add` handles the deletion):**

```bash
git add apps/ptah-license-server/src/admin/admin-records.controller.ts \
        apps/ptah-license-server/src/admin/admin-users.controller.ts \
        apps/ptah-license-server/src/admin/admin-stats.controller.ts \
        apps/ptah-license-server/src/admin/admin-waitlist.controller.ts \
        apps/ptah-license-server/src/admin/admin-licenses.controller.ts \
        apps/ptah-license-server/src/admin/admin.controller.ts \
        apps/ptah-license-server/src/admin/admin.module.ts \
        apps/ptah-license-server/src/admin/admin.service.ts \
        apps/ptah-license-server/src/admin/admin-guards.spec.ts \
        apps/ptah-license-server/src/app/app.module.ts \
        apps/ptah-license-server/src/packs/admin-packs.controller.ts \
        apps/ptah-license-server/src/common/route-map.spec.ts \
        apps/ptah-license-server/src/common/controller-validation.spec.ts \
        apps/ptah-license-server/src/common/dto-validation.pipe.ts \
        apps/ptah-license-server/src/testing/controller-registry.ts \
        apps/ptah-landing-page/src/app/guards/admin-auth.guard.ts \
        apps/ptah-landing-page/src/app/services/admin-api.service.ts
```

⚠️ `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` was already dirty when R2 started (R1's report §1 flagged the same file). **Do not stage it.** The six untracked landing-page specs were not touched. _(The briefing said seven; there are six — same six B0 and R1 both listed.)_

---

## 2. The split, handler by handler — a move, not a rewrite

All nine handlers moved with their bodies, decorators and guard chains intact. Every `@UseGuards`, `@Throttle`, `@HttpCode` and payload decorator is byte-preserved.

| Handler                     | Before (`admin/AdminController`, `v1/admin`) | After                                              | Method guards / throttle                                                   | Payload params |
| --------------------------- | -------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- | -------------- |
| `list`                      | `@Get(':model')`                             | `AdminRecordsController` `@Get(':model')`          | —                                                                          | `@Query()`     |
| `show`                      | `@Get(':model/:id')`                         | ↑ `@Get(':model/:id')`                             | —                                                                          | —              |
| `update`                    | `@Patch(':model/:id')`                       | ↑ `@Patch(':model/:id')`                           | —                                                                          | `@Body()`      |
| `bulkEmailUsers`            | `@Post('users/bulk-email')`                  | `AdminUsersController` `@Post('bulk-email')`       | `@HttpCode(200)`                                                           | `@Body()`      |
| `userDeletionPreview`       | `@Get('users/:id/deletion-preview')`         | ↑ `@Get(':id/deletion-preview')`                   | —                                                                          | —              |
| `deleteUser`                | `@Delete('users/:id')`                       | ↑ `@Delete(':id')`                                 | `@UseGuards(AdminThrottlerGuard)` + `@Throttle(5/60s)`                     | `@Body()`      |
| `stats`                     | `@Get('stats')`                              | `AdminStatsController` `@Get()`                    | —                                                                          | **none**       |
| `inviteWaitlist`            | `@Post('waitlist/invite')`                   | `AdminWaitlistController` `@Post('invite')`        | `@HttpCode(200)` + `@UseGuards(AdminThrottlerGuard)` + `@Throttle(10/60s)` | `@Body()`      |
| `issueComplimentaryLicense` | `@Post('licenses/complimentary')`            | `AdminLicensesController` `@Post('complimentary')` | `@UseGuards(AdminThrottlerGuard)` + `@Throttle(20/60s)`                    | `@Body()`      |

All five carry `@Controller('v1/admin/<resource>')` + `@UseGuards(JwtAuthGuard, AdminGuard)` at **class** level, in that order (JWT populates `request.user` before `AdminGuard` reads `.email`). Verified live: 401 anonymous / 403 non-admin on every one (§7.2 group 3).

**Injections narrowed to what each controller actually uses** — `AdminService` (records, users, stats), `LicenseService` (licenses), `WaitlistService` + `AuditLogService` (waitlist). The old class injected all four. `AdminModule`'s `imports` array is unchanged because it already covered every one.

**Only three paths changed** (`v1/admin/:model{,/:id}` → `v1/admin/records/…`). The other six handlers changed owning class only.

**Param arithmetic: 2 + 2 + 1 + 1 + 0 = 6**, identical to the old class's 6. Proven by probe in §5.2.

---

## 3. `route-map.spec.ts` — what it asserts

13 tests, infra-free (no Postgres, no Nest bootstrap, no docker). Reads `PATH_METADATA` off each controller class and off each handler descriptor, and `METHOD_METADATA` off each descriptor, over R1's shared registry — **the controller list is imported, never re-declared** (`import { ALL_CONTROLLERS } from '../testing/controller-registry'`).

Both decorator quirks the plan named are handled and were verified by a throwaway metadata probe before the spec was written: `@Sse('subscribe')` reports `METHOD_METADATA === RequestMethod.GET`; `@Get('discourse')` + `@Redirect()` carries method metadata on the `@Get`. The enumerator also uses `method === undefined` rather than a falsy check — `RequestMethod.GET === 0`, and a falsy check would have silently dropped every GET route and made the whole spec vacuous.

| Group             | Tests | Asserts                                                                                                                                                                                                                                 |
| ----------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPECTED_ROUTES` | 2     | The 65-entry route table matches exactly; no two handlers declare the same verb+path                                                                                                                                                    |
| RI-1              | 3     | No prefix identical to or a proper path-prefix of another; `KNOWN_PREFIX_DEBT` has no stale entry; each `PREFIX_EXCEPTIONS` entry still has the prefix it was excused for                                                               |
| RI-2              | 2     | No two routes on different controllers can match the same concrete path; `KNOWN_CONTESTED` has no stale entry                                                                                                                           |
| RI-3              | 1     | Within one controller, a wildcard is never declared before a route it would shadow                                                                                                                                                      |
| anti-vacuity      | 5     | ≥1 route per registry controller; exactly 65 routes; the segment parser **throws** on `*` / `:id?` / `{id}` / `:id(\d+)`; `unifiable()` matches an 11-case hand-computed table; `isProperPathPrefix()` compares segments not characters |

**The anti-vacuity group is not decoration.** Every other assertion is "the violation set is empty", which passes trivially if the enumerator finds nothing or `unifiable()` never returns true. The `unifiable()` table encodes the defect itself (`v1/admin/:model` × `v1/admin/packs` → **true**) next to its fix (`v1/admin/records/:model` × `v1/admin/packs` → **false**), so the fix and the test of the test are the same six lines.

### Two ledgers, both un-rottable in both directions

- **`KNOWN_CONTESTED` (RI-2) ships EMPTY.** All ten contests from plan §1 were closed by R2 in one move. Retained with both guard directions live so the next contributor who introduces one has to write the line and defend it in review.
- **`KNOWN_PREFIX_DEBT` (RI-1) ships with 10 entries, all owned by R3.** `license/controllers/admin.controller.ts` is still `@Controller('v1/admin')`, a proper path-prefix of all ten `v1/admin/*` siblings. **This constant is not in the plan — see finding N2.**

`PREFIX_EXCEPTIONS` holds exactly `marketing/PublicMarketingController` with the §2.5 reason (email-embedded `/api/unsubscribe/:token`), and asserts the controller still has the prefix it was excused for, so the excuse cannot outlive its subject.

---

## 4. 🔴 Falsification — five proofs, each captured failing AND restored

Every probe was applied, run, captured, reverted, and the revert verified **byte-identical by `md5sum -c`**. The suite is green at rest.

### 4.1 RI-2 — restore the wildcard at the bare `v1/admin` prefix (the defect this task exists to close)

Probe: `admin-records.controller.ts` `@Controller('v1/admin/records')` → `@Controller('v1/admin')`.

**FAILING OUTPUT (RI-2 assertion):**

```
● Route map … › RI-2 — no cross-controller route contest › no two routes on different controllers can match the same concrete path

    - Array []
    + Array [
    +   "GET v1/admin/:model [admin/AdminRecordsController.list]  X  GET v1/admin/groups [member-groups/MemberGroupsController.list]",
    +   "GET v1/admin/:model [admin/AdminRecordsController.list]  X  GET v1/admin/packs [packs/AdminPacksController.list]",
    +   "GET v1/admin/:model [admin/AdminRecordsController.list]  X  GET v1/admin/sessions [google-sessions/AdminSessionsController.list]",
    +   "GET v1/admin/:model [admin/AdminRecordsController.list]  X  GET v1/admin/stats [admin/AdminStatsController.stats]",
    +   "GET v1/admin/:model/:id [admin/AdminRecordsController.show]  X  GET v1/admin/community/review-queue [discourse/AdminCommunityController.reviewQueue]",
    +   "GET v1/admin/:model/:id [admin/AdminRecordsController.show]  X  GET v1/admin/community/topics [discourse/AdminCommunityController.topics]",
    +   "GET v1/admin/:model/:id [admin/AdminRecordsController.show]  X  GET v1/admin/marketing/segments [marketing/AdminMarketingController.getSegments]",
    +   "GET v1/admin/:model/:id [admin/AdminRecordsController.show]  X  GET v1/admin/packs/:id [packs/AdminPacksController.get]",
    +   "PATCH v1/admin/:model/:id [admin/AdminRecordsController.update]  X  PATCH v1/admin/groups/:id [member-groups/MemberGroupsController.update]",
    +   "PATCH v1/admin/:model/:id [admin/AdminRecordsController.update]  X  PATCH v1/admin/packs/:id [packs/AdminPacksController.update]",
    +   "PATCH v1/admin/:model/:id [admin/AdminRecordsController.update]  X  PATCH v1/admin/sessions/:eventId [google-sessions/AdminSessionsController.update]",
    + ]
```

**Eleven pairs, each naming both contesting handlers.** Ten are exactly plan §1's table, row for row. The eleventh — `GET v1/admin/:model  X  GET v1/admin/stats` — is the pair plan §1 called _"almost entirely a non-issue"_ because it was intra-class; the split makes it cross-controller, so it is now caught by RI-2 as well. **The plan's measured defect is reproduced exactly, plus one it had correctly classified as lower risk.**

The same probe also fired RI-1 (12 violations, including `admin/AdminRecordsController == license/AdminController @ v1/admin (IDENTICAL PREFIX)`), the `KNOWN_PREFIX_DEBT` staleness assertion, and the `EXPECTED_ROUTES` diff.

**RESTORED:** `md5sum -c` → `OK`. `Tests: 13 passed, 13 total`.

### 4.2 RI-1(a) — two controllers with the same prefix

Probe: `AdminStatsController` `@Controller('v1/admin/stats')` → `@Controller('v1/admin/users')`.

```
● Route map … › RI-1 — prefix disjointness › no controller prefix is identical to, or a proper path-prefix of, another

    - Array []
    + Array [
    +   "admin/AdminStatsController == admin/AdminUsersController @ v1/admin/users (IDENTICAL PREFIX)",
    +   "license/AdminController @ v1/admin  <  admin/AdminStatsController @ v1/admin/users",
    + ]
```

**Names both controllers.** Restored, `md5sum -c` → `OK`.

### 4.3 RI-1(b) — remove a `KNOWN_PREFIX_DEBT` line while the violation still exists

Probe: delete `'license/AdminController @ v1/admin  <  packs/AdminPacksController @ v1/admin/packs'`. **No source edit** — this falsifies the proper-path-prefix detector against live data.

```
● … › no controller prefix is identical to, or a proper path-prefix of, another
    + Array [
    +   "license/AdminController @ v1/admin  <  packs/AdminPacksController @ v1/admin/packs",
    + ]
```

### 4.4 RI-1(c) — a stale `KNOWN_PREFIX_DEBT` line

Probe: add a bogus entry for a violation that does not exist.

```
● … › KNOWN_PREFIX_DEBT contains no stale entry (delete the line once it is fixed)
    + Array [
    +   "health/HealthController @ health  <  bogus/NopeController @ health/nope",
    + ]
```

4.3 + 4.4 together prove the ledger is un-rottable in both directions, the same property B0 proved for `UNVALIDATED_DEBT`.

### 4.5 RI-3 — a wildcard declared before a literal it would shadow

Probe: insert `@Get('archived')` into `AdminRecordsController` **after** `@Get(':model')`.

```
● Route map … › RI-3 — intra-controller specificity ordering › a wildcard is never declared before a route it would shadow

    - Array []
    + Array [
    +   "admin/AdminRecordsController: GET v1/admin/records/:model (list, declared #0) shadows the more specific
    +    GET v1/admin/records/archived (archived, declared #1) — swap them",
    + ]
```

**CONTROL RUN — the same probe route declared BEFORE the wildcard:**

```
● … › the registered route table is exactly what is written down
● … › discovered exactly 65 routes
```

Only the two route-inventory assertions fire; **RI-3 passes**. This proves RI-3 asserts _ordering_, not merely the existence of a unifiable pair — a distinction a single probe could not have shown. Both probes reverted; `md5sum -c` → `OK`.

### 4.6 (bonus) `EXPECTED_ROUTES` names the route

Probe: delete `'GET v1/admin/records/:model'` from the list.

```
● … › the registered route table is exactly what is written down
    +   "GET v1/admin/records/:model",
● … › discovered exactly 64 routes
```

### 4.7 (bonus) `AdminStatsController` must NOT enter `UNVALIDATED_DEBT`

Probe: add `'admin/AdminStatsController'` to the ledger.

```
● Server-wide input validation — structural guard › UNVALIDATED_DEBT — the shrinking ledger
  › admin/AdminStatsController still has at least one unbound param (delete this line once it does not)

      Object {
        "label": "admin/AdminStatsController",
    -   "unbound": true,
    +   "unbound": false,
      }
```

B0's staleness assertion catches it, exactly as plan §6.2 predicted. It sits in `ALL_CONTROLLERS` → `ENFORCED` and passes vacuously.

---

## 5. Test-count reconciliation

### 5.1 The delta is +16, accounted for line by line

```
Test Suites: 1 skipped, 47 passed, 47 of 48 total
Tests:       5 skipped, 654 passed, 659 total
 NX   Successfully ran target test for project ptah-license-server
```

|                                                                                                                                                           | Δ   | Running    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------- |
| Baseline after R1                                                                                                                                         | —   | **638**    |
| `+` `route-map.spec.ts` (new suite)                                                                                                                       | +13 | 651        |
| `−` G3 removed from `admin-guards.spec.ts` (1 `it`)                                                                                                       | −1  | 650        |
| `+` `UNVALIDATED_DEBT` 9 → 12 entries (1 admin line became 4) ⇒ 3 more staleness `it.each` cases                                                          | +3  | 653        |
| `+` `ENFORCED` 11 → 12 controllers (`ALL_CONTROLLERS` 21 → 25, ledger +3, so enforced +1 = `AdminStatsController`) ⇒ 1 more per-controller `it.each` case | +1  | **654** ✅ |

Isolated confirmations: `route-map` → **13 passed, 13 total**. `controller-validation` → **33 passed, 33 total** (was 29; +4 = +3 staleness +1 enforced). Suite count 47 → 48 total is the one new spec file. The 5 skipped tests and 1 skipped suite are pre-existing and untouched.

**No test was renamed and none was weakened.** The only deletion is G3, which §6 justifies.

### 5.2 `MIN_TOTAL_PAYLOAD_PARAMS` re-derived by probe — reads exactly 39

Using B0 §3 N2's technique (temporarily set the constant to 999 and read the received value):

```
● Server-wide input validation — structural guard › anti-vacuity › discovers at least 999 payload params server-wide

    expect(received).toBeGreaterThanOrEqual(expected)

    Expected: >= 999
    Received:    39
```

**39, not "≥ 39".** Identical to the pre-R2 figure. The 1→5 split moved 6 params (2+2+1+1+0) and lost none. Constant restored to 39; `md5sum -c` → `OK`.

---

## 6. The three deleted defences, and the assertion that replaced each

| Deleted                                                                                    | Replaced by                                                                                                 | Proof it is genuinely covered                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G3** — `admin-guards.spec.ts` _"registers PacksModule before AdminModule in AppModule"_  | **RI-2**, `route-map.spec.ts` — _"no two routes on different controllers can match the same concrete path"_ | §4.1. G3 could only ever say "this array is in this order"; RI-2 says "no ordering of this array can route a request to the wrong handler", and its failure output names `packs/AdminPacksController.list` as one of the eleven contesting pairs — the exact scenario G3 existed to prevent, now caught by cause rather than by proxy. |
| **`app.module.ts:66-71`** — the ⚠️ ordering comment on `PacksModule`                       | **RI-1 + RI-2**                                                                                             | §4.1 / §4.2. Replaced in place by a 8-line provenance note stating the opposite instruction ("order this array for readability; a routing bug can no longer hide in it") so the warning is not re-added by someone who remembers it.                                                                                                   |
| **`admin-packs.controller.ts:47-51`** — the ⚠️ ROUTING docblock repeating the same warning | **RI-2**                                                                                                    | §4.1, where `packs/AdminPacksController.list` and `.get` both appear by name in the failure output.                                                                                                                                                                                                                                    |

G3's removal note lives in `admin-guards.spec.ts`'s top docblock and explains _why it was deleted rather than moved_ — the same courtesy B0 paid when it moved G7. `AdminRecordsController`'s docblock carries the full explanation of why the `records` segment exists, so the reasoning is findable from the code that embodies it, not only from a spec.

---

## 7. Live verification against the running server

Docker: `ptah_license_server` (healthy), `ptah_postgres` (healthy), `discourse_dev` (up). Admin `ptah_auth` cookie minted the way `scripts/community-gate-smoke.mjs:40-45` does — HMAC-SHA256 over `header.payload` with `JWT_SECRET` read from `.env` at runtime, `ADMIN_EMAILS[0]` = `abdallah@miramarstaffing.com`. **The secret was never written into any file**; the matrix scripts were throwaways under `.ptah/` (gitignored) and were deleted after the run.

### 7.1 🔴 The lockout — verified in both directions

```
PASS  200 want=200  GET /api/v1/admin/records/users?pageSize=1   :: {"data":[{"id":"6e3c86d6-…","workosId":"user_01KRE…
PASS  404 want=404  GET /api/v1/admin/users?pageSize=1           :: {"message":"Cannot GET /api/v1/admin/users?pageSize=1","error":"Not Found","statusCode":404}
```

The new path returns **200 with a real paginated envelope** for an admin — which is what `admin-auth.guard.ts` needs to allow navigation — and the old path returns a clean **404**, proving the `:model` wildcard is genuinely gone rather than shadowed. Both landed in this working tree, in the same change set as the server split.

`stats` was **not** used as the probe (per the plan and the briefing): it runs the full waitlist-funnel + member-count aggregation, and the guard fires on every admin route activation. That reasoning is now a ⚠️ block in the guard's docblock so the next person does not "simplify" it.

### 7.2 Full matrix — 41 checks, all pass

**Group 2 — the 3 moved routes, new works / old 404s:**

```
PASS 200 GET    /api/v1/admin/records/waitlist?pageSize=1    :: {"data":[{"id":"cmrz51ive…","email":"…","source":"early-adopter…
PASS 404 GET    /api/v1/admin/waitlist?pageSize=1            :: Cannot GET …
PASS 200 GET    /api/v1/admin/records/users/<uid>            :: {"id":"6e3c86d6-…","workosId":"user_01KRE…
PASS 404 GET    /api/v1/admin/users/<uid>                    :: Cannot GET …
PASS 405 PATCH  /api/v1/admin/records/subscriptions/<id>     :: {"message":"Model is read-only","error":"Method Not Allowed","statusCode":405}
PASS 404 PATCH  /api/v1/admin/subscriptions/<id>             :: Cannot PATCH …
PASS 400 PATCH  /api/v1/admin/records/licenses/<id>          :: {"message":"No editable fields supplied. Editable: plan, status, expiresAt",…}
PASS 404 PATCH  /api/v1/admin/users/<uid>                    :: Cannot PATCH …
PASS 400 PATCH  /api/v1/admin/records/nope/1                 :: {"message":"Unknown admin model: nope","error":"Bad Request","statusCode":400}
```

The last four are the interesting ones: the **405** proves `MethodNotAllowedException` on `ADMIN_MODELS[key].readOnly` moved intact; the **400 "No editable fields supplied"** proves the request reaches `AdminService.update`; the **400 "Unknown admin model: nope"** proves the private `assertModel()` helper moved with the class. A 404 on any of those would have meant the handler was never reached.

**Group 3 — the guard chain moved with the handlers (9 checks):**

```
PASS 401 GET    /api/v1/admin/records/users   (anonymous)  :: "No authentication token provided. Please login."
PASS 403 GET    /api/v1/admin/records/users   (non-admin)  :: "This account is not an admin"
PASS 401 PATCH  /api/v1/admin/records/users/1 (anonymous)
PASS 401 GET    /api/v1/admin/stats           (anonymous)
PASS 403 GET    /api/v1/admin/stats           (non-admin)
PASS 401 DELETE /api/v1/admin/users/<uid>     (anonymous)
PASS 403 POST   /api/v1/admin/waitlist/invite (non-admin)
PASS 403 POST   /api/v1/admin/licenses/complimentary (non-admin)
PASS 403 POST   /api/v1/admin/users/bulk-email (non-admin)
```

401 for anonymous and 403 for an authenticated non-admin on **all five** new controllers — `JwtAuthGuard` → `AdminGuard`, in order, on every one.

**Group 4 — unchanged paths on the split controllers:**

```
PASS 200 GET    /api/v1/admin/stats                          :: {"waitlist":{"total":3,"notified":0,…},"members":{…
PASS 200 GET    /api/v1/admin/users/<uid>/deletion-preview   :: {"userId":"6e3c86d6-…","cascaded":{…
PASS 200 POST   /api/v1/admin/waitlist/invite                :: {"invited":3,"skipped":0}     <-- see §8
PASS 404 POST   /api/v1/admin/licenses/complimentary         :: {"code":"USER_NOT_FOUND",…}   (reaches LicenseService)
PASS 500 POST   /api/v1/admin/users/bulk-email               :: (reaches AdminUsersController.bulkEmailUsers — Sentry frame confirms)
PASS 400 DELETE /api/v1/admin/users/<uid>                    :: {"code":"CONFIRM_EMAIL_MISMATCH",…}
```

Every one of these is a **domain-level** response, not a 404 — the handlers are wired. The `bulk-email` 500 is an empty-body `dto.userIds.length` dereference, i.e. the exact pre-existing behaviour B7b's `dtoPipe(BulkEmailDto)` will convert into a 400; the container stack trace names `AdminUsersController.bulkEmailUsers`, confirming the new class is the one serving it.

**Group 5 — the ten former contests still resolve to their own controllers (10 checks):**

```
PASS 200 GET   /api/v1/admin/packs                     :: {"packs":[]}
PASS 200 GET   /api/v1/admin/groups                    :: {"groups":[{"id":"mgrp_founding_seed…
PASS 200 GET   /api/v1/admin/sessions?daysAhead=60     :: {"sessions":[{"id":"cfjfqv3bc…
PASS 200 GET   /api/v1/admin/community/topics          :: {"communityUrl":"http://localhost:3001","topics":[],"enabled":true}
PASS 200 GET   /api/v1/admin/community/review-queue    :: {"items":[],"count":0,"reviewUrl":…}
PASS 200 GET   /api/v1/admin/marketing/segments        :: {"segments":{"all":{"total":3,…
PASS 404 GET   /api/v1/admin/packs/does-not-exist      :: {"message":"Pack does-not-exist not found",…}
PASS 404 PATCH /api/v1/admin/groups/does-not-exist     :: {"message":"Member group does-not-exist not found",…}
PASS 404 PATCH /api/v1/admin/sessions/does-not-exist   :: {"reason":"calendar_event_not_found",…}
PASS 404 GET   /api/v1/admin/groups/…/members          :: {"message":"Member group … not found",…}
```

🔴 **These resolving is no longer order-dependent, and the assertion that guarantees it is RI-2** (`route-map.spec.ts`, _"no two routes on different controllers can match the same concrete path"_), falsified in §4.1. Note the four 404s carry each controller's **own domain message** ("Pack … not found", "Member group … not found", `calendar_event_not_found`) — not `"Unknown admin model: packs"`, which is what a fall-through to the generic CRUD would have produced. That is the difference between "the right controller answered" and "the array happened to be in the right order", and it is now asserted structurally as well as observed live.

**Group 6 — R3/R4 territory untouched by R2:**

```
PASS 401 POST /api/v1/admin/licenses            (x-api-key)  :: {"message":"Invalid API key",…}  <-- still AdminApiKeyGuard, still here
PASS 404 POST /api/v1/integrations/licenses                  :: does not exist yet (R3)
PASS 200 GET  /api/auth/me                                   :: still unversioned (R4)
PASS 404 GET  /api/v1/auth/me                                :: does not exist yet (R4)
PASS 200 GET  /api/health                                    :: {"status":"ok",…,"database":"connected"}
```

The `x-api-key` route rejecting a wrong key with 401 (not 404) proves R2 did not disturb the _other_ `AdminController` or its guard — and that the two auth models still coexist under `v1/admin`, which is precisely the RI-1 debt R3 clears.

### 7.3 Registered route table — 65 before, 65 after

Captured from Nest's own `RouterExplorer` log, sliced to the most recent bootstrap only (`awk` on `Starting Nest application`, because the bind-mounted dev container reloads on every source write and an unsliced `docker logs` window otherwise mixes boots — including one that had a falsification probe in it):

```bash
docker logs ptah_license_server | awk '/Starting Nest application/{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}' \
  | grep -oE 'Mapped \{[^}]*\}' | sort -u > /tmp/routes-after.txt
```

```
$ wc -l /tmp/routes-before.txt /tmp/routes-after.txt
  65 /tmp/routes-before.txt
  65 /tmp/routes-after.txt

$ diff /tmp/routes-before.txt /tmp/routes-after.txt
17,19d16
< Mapped {/api/v1/admin/:model, GET}
< Mapped {/api/v1/admin/:model/:id, GET}
< Mapped {/api/v1/admin/:model/:id, PATCH}
37a35,37
> Mapped {/api/v1/admin/records/:model, GET}
> Mapped {/api/v1/admin/records/:model/:id, GET}
> Mapped {/api/v1/admin/records/:model/:id, PATCH}
```

**Exactly three `-` and three `+`**, equal line counts, and they are precisely rows 1–3 of plan §2.2. Rows 4–16 belong to R3 (`v1/integrations/licenses`) and R4 (`v1/auth/*`) and correctly have not moved. **Zero routes were accidentally created or destroyed.**

Full after-table (65 lines):

```
Mapped {/api/auth/callback, GET}                     Mapped {/api/v1/admin/records/:model, GET}
Mapped {/api/auth/login, GET}                        Mapped {/api/v1/admin/records/:model/:id, GET}
Mapped {/api/auth/login/email, POST}                 Mapped {/api/v1/admin/records/:model/:id, PATCH}
Mapped {/api/auth/logout, POST}                      Mapped {/api/v1/admin/sessions, GET}
Mapped {/api/auth/magic-link, POST}                  Mapped {/api/v1/admin/sessions, POST}
Mapped {/api/auth/me, GET}                           Mapped {/api/v1/admin/sessions/:eventId, DELETE}
Mapped {/api/auth/oauth/:provider, GET}              Mapped {/api/v1/admin/sessions/:eventId, PATCH}
Mapped {/api/auth/resend-verification, POST}         Mapped {/api/v1/admin/stats, GET}
Mapped {/api/auth/signup, POST}                      Mapped {/api/v1/admin/users/:id, DELETE}
Mapped {/api/auth/stream/ticket, POST}               Mapped {/api/v1/admin/users/:id/deletion-preview, GET}
Mapped {/api/auth/verify, GET}                       Mapped {/api/v1/admin/users/bulk-email, POST}
Mapped {/api/auth/verify-email, POST}                Mapped {/api/v1/admin/waitlist/invite, POST}
Mapped {/api/health, GET}                            Mapped {/api/v1/community/summary, GET}
Mapped {/api/resubscribe/:token, GET}                Mapped {/api/v1/contact, POST}
Mapped {/api/unsubscribe/:token, GET}                Mapped {/api/v1/events/health, GET}
Mapped {/api/unsubscribe/:token, POST}               Mapped {/api/v1/events/subscribe, GET}
Mapped {/api/v1/admin/community/review-queue, GET}   Mapped {/api/v1/licenses/me, GET}
Mapped {/api/v1/admin/community/topics, GET}         Mapped {/api/v1/licenses/me/reveal-key, POST}
Mapped {/api/v1/admin/groups, GET}                   Mapped {/api/v1/licenses/verify, POST}
Mapped {/api/v1/admin/groups, POST}                  Mapped {/api/v1/members/sessions, GET}
Mapped {/api/v1/admin/groups/:id, PATCH}             Mapped {/api/v1/sessions/eligibility, GET}
Mapped {/api/v1/admin/groups/:id/assign, POST}       Mapped {/api/v1/sessions/request, POST}
Mapped {/api/v1/admin/groups/:id/members, GET}       Mapped {/api/v1/sso/discourse, GET}
Mapped {/api/v1/admin/groups/:id/members/:userId, DELETE}  Mapped {/api/v1/subscriptions/checkout-info, GET}
Mapped {/api/v1/admin/licenses, POST}                Mapped {/api/v1/subscriptions/portal-session, POST}
Mapped {/api/v1/admin/licenses/complimentary, POST}  Mapped {/api/v1/subscriptions/reconcile, POST}
Mapped {/api/v1/admin/marketing/segments, GET}       Mapped {/api/v1/subscriptions/status, GET}
Mapped {/api/v1/admin/marketing/send, POST}          Mapped {/api/v1/subscriptions/validate-checkout, POST}
Mapped {/api/v1/admin/marketing/templates, POST}     Mapped {/api/v1/waitlist, POST}
Mapped {/api/v1/admin/packs, GET}                    Mapped {/webhooks/paddle, POST}
Mapped {/api/v1/admin/packs, POST}                   Mapped {/webhooks/resend, POST}
Mapped {/api/v1/admin/packs/:id, DELETE}
Mapped {/api/v1/admin/packs/:id, GET}
Mapped {/api/v1/admin/packs/:id, PATCH}
```

`/tmp/routes-before.txt` is identical except that it carries `/api/v1/admin/:model{,/:id}` in place of the three `records` rows.

**This 65-line table and `EXPECTED_ROUTES` in `route-map.spec.ts` were derived independently** — the spec from decorator metadata, this from Nest's router — and they agree entry for entry. That mutual agreement is the strongest evidence in this report that the spec measures the real thing.

### 7.4 Smoke gates — verbatim, unmodified, all exit 0

`git diff --stat -- scripts/` is empty. All three touch only unchanged paths, exactly as plan §5.4 predicted.

```
node scripts/community-gate-smoke.mjs        -> exit 0   ✓ gate discriminates … cleaned up seeded users
node scripts/discourse-e2e.mjs               -> exit 0   ✓ auth_overrides_email = true … cleaned up seeded users
node scripts/google-calendar-write-smoke.mjs -> exit 0   ✓ deleting BUILDERS_SESSION_EVENT_ID is refused (409)
                                                         ✓ deleting an EXPANDED INSTANCE of the series is refused (409)
```

`google-calendar-write-smoke.mjs` hits `/api/v1/admin/sessions*` — an unchanged path served by `AdminSessionsController`, which previously depended on module ordering to win against the wildcard. **It is therefore a genuine verbatim regression gate on the split**, and it created and deleted a real calendar event during the run (its own cleanup, reported by the script).

---

## 8. ⚠️ Live-test side effect: three real emails were sent, DB reverted

**What happened.** The matrix called `POST /api/v1/admin/waitlist/invite` with `{ batchSize: 0 }`, intending a no-op. `WaitlistService.inviteBatch` treats `0` as absent and falls back to its default batch, so it **invited all 3 waitlist rows**:

```
[EmailService] Founding invite sent to abdallah.khalil.nada@gmail.com
[EmailService] Founding invite sent to abdallahn11@gmail.com
[EmailService] Founding invite sent to abdallah@pro-estate.net
[WaitlistService] Waitlist invite wave complete: invited=3 skipped=0
```

All three are the repo owner's own addresses (the dev DB's only waitlist rows). **The emails are real and cannot be recalled.**

**Cleanup performed and verified:**

| Row                                           | Action                                                                                                | Verified                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 3 × `waitlist.notified_at` stamped            | `UPDATE waitlist SET notified_at = NULL WHERE notified_at IS NOT NULL` → `UPDATE 3`                   | `SELECT id,email,notified_at` shows all three NULL       |
| 1 × `admin_audit_log` row (`waitlist.invite`) | `DELETE … WHERE action='waitlist.invite' AND created_at > now() - interval '30 minutes'` → `DELETE 1` | `SELECT count(*) WHERE action='waitlist.invite'` → **0** |

**Post-state confirmed through the API**, not just the DB:

```
GET /api/v1/admin/stats -> waitlist funnel now: {"total":3,"notified":0,"converted":0,"last7Days":0}
```

Identical to the pre-probe reading captured earlier in the same run. **The database is back to its exact pre-R2 state.** No other check in the matrix mutated data: `complimentary` 404'd on a non-existent user, `bulk-email` 500'd on an empty body before any send, `users DELETE` was refused by `CONFIRM_EMAIL_MISMATCH`, and every `does-not-exist` write 404'd.

**Recorded for B7d.** This endpoint has no dry-run and no zero-batch escape hatch: **there is no safe way to exercise `POST /api/v1/admin/waitlist/invite` against a database with waitlist rows.** B7d's curl matrix must either seed a disposable row and assert on that, or exercise the route with a body that fails validation _before_ the handler runs (which, once `dtoPipe(InviteWaitlistDto)` is bound, `@Max(1000)` finally makes possible — e.g. `{ batchSize: 99999 }` → 400 with no send). Worth a line in `tasks.md`.

---

## 9. Findings

### N1 — 🟠 The plan says 64 routes. It is 65. Its own §2.3 table says 65 too.

`restructure-plan.md` §2 states _"64 routes before, 64 routes after"_ and §5.2's acceptance says _"the line counts are equal at 64"_. Both are off by one.

- Nest's `RouterExplorer` log reports **65** unique mapped routes, before and after (§7.3).
- The plan's **own** §2.3 per-prefix table sums to 65: 3+1+2+6+1+3+5+3+4+1+3+1+12+1+1+2+1+3+1+2+1+5+1+1+1.
- `route-map.spec.ts`'s independently-derived `EXPECTED_ROUTES` has 65 entries.

Three independent derivations say 65; only the plan's prose says 64. **The prose figure is wrong; nothing else is.** `EXPECTED_ROUTES`'s docblock records this explicitly so the next batch does not "fix" the list down to 64. R3/R4 should expect **65**, and the §9 checklist item _"64 lines each"_ should read 65.

### N2 — 🟠 The plan gave RI-1 no home for R3-pending debt. I added `KNOWN_PREFIX_DEBT`.

Plan §5.1 group 2 specifies RI-1 with _"a `PREFIX_EXCEPTIONS` list … containing **exactly** `marketing/PublicMarketingController`"_. But after R2 and **before R3**, `license/controllers/admin.controller.ts` is still `@Controller('v1/admin')`, which is a proper path-prefix of all ten `v1/admin/*` sibling prefixes. RI-1 as specified would have been red on the R2 commit.

Three options existed:

- **(a)** Put `license/AdminController` in `PREFIX_EXCEPTIONS` — ❌ breaks the plan's "exactly one entry", and worse, files temporary debt in a list of _permanent designed_ exceptions, which has no staleness guard and would silently survive R3.
- **(b)** Weaken RI-1 to controller-level ("this controller has ≥1 violation") — ❌ would mask a _new_ violation involving the same controller.
- **(c, chosen)** A separate `KNOWN_PREFIX_DEBT` ledger of the 10 explicit pairs, with the same un-rottable double guard the plan already designed for `KNOWN_CONTESTED`.

(c) keeps `PREFIX_EXCEPTIONS` exactly as the plan wrote it, makes R3's job ten deletable lines, and is falsified in both directions (§4.3, §4.4). **R3 must delete all ten `KNOWN_PREFIX_DEBT` entries** — the staleness assertion will fail if it forgets, and the main assertion will fail if it deletes them early.

### N3 — 🟡 `KNOWN_CONTESTED` is emptied entirely by R2, not by "R2 and R3"

Plan §5.1 group 3 says the RI-2 ledger is seeded with the ten §1 pairs and that _"R2 and R3 empty it"_. In fact **R2 closes all ten** — every one involved an `admin/AdminController` wildcard, and all three wildcards moved under `v1/admin/records`. Verified: with the ledger empty, RI-2 is green (§0), and restoring the old prefix reproduces all ten plus one (§4.1).

What R3 actually clears is **RI-1's** prefix debt (N2), not RI-2's contest ledger. The two were conflated in the plan's prose. `KNOWN_CONTESTED` therefore ships as `[]` with a docblock listing the ten historical pairs, and the mechanism retained with both guard directions live.

### N4 — 🟡 Two caller edits the plan's §4 inventory missed (both found by grep, both fixed)

Plan §4.1 lists exactly four functional line edits, and that is correct — an independent CLI-agent sweep of every `/api/v1/admin*` and `/api/auth*` runtime literal outside the server (excluding `node_modules`/`dist`) returned **exactly** those four as the only hits on a moving path, everything else being `packs/*`, `groups/*`, `sessions/*`, `community/*`, `marketing/*`, `users/*`, `licenses/complimentary`, `waitlist/invite` or `stats`. I re-verified every hit against source myself.

But two **non-functional** references to the moved path/class were not in the plan's list and would have been left wrong:

| File:line                                                             | Problem                                                                                                                | Fixed                                                                                                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/ptah-landing-page/src/app/guards/admin-auth.guard.ts:9`         | Docblock says _"Probes `GET /api/v1/admin/users?pageSize=1`"_ — the plan lists only `:32`                              | ✅ + a ⚠️ block explaining why the path is load-bearing and why `stats` is not an acceptable substitute |
| `apps/ptah-license-server/src/common/dto-validation.pipe.ts:60,82-83` | `passthroughDtoPipe`'s docblock names `AdminController.update` and `src/admin/admin.controller.ts` — a file R2 deletes | ✅ → `AdminRecordsController.update` / `admin-records.controller.ts`                                    |

The second one matters more than it looks: that docblock is the single authoritative explanation of the only legitimate `passthroughDtoPipe` call site, and **B7a's whole job is to add that call site**. Pointing it at a deleted file would have sent B7a's author to a dead path.

### N5 — 🟡 `admin.service.ts` imports two interfaces from the deleted controller; §4 does not mention it

`admin.service.ts:23-27` had `import type { AdminBulkEmailResponse, AdminListResponse } from './admin.controller'`. The plan's §3.1 assigns `AdminListResponse` to `AdminRecordsController` but says nothing about `AdminBulkEmailResponse` or about the consumer. Resolved by splitting into two `import type` lines (`AdminListResponse` ← `admin-records.controller`, `AdminBulkEmailResponse` ← `admin-users.controller`), matching each interface to the handler that returns it.

**No runtime cycle is created.** Both are `import type` and are fully elided; `tsconfig` sets neither `verbatimModuleSyntax` nor `importsNotUsedAsValues`. This is the same shape the file already had (the old import was also `import type`), and `tsc` + the built container both confirm it.

### N6 — 🟢 The plan's `AdminStatsController` warning is correct, and now proven

Plan §6.2's ⚠️ — _"`admin/AdminStatsController` must NOT go into `UNVALIDATED_DEBT`"_ — is exactly right. §4.7 shows B0's staleness assertion catching it. It is in `ALL_CONTROLLERS` → `ENFORCED` and passes vacuously, which is also where the +1 in §5.1's reconciliation comes from.

### N7 — 🟢 Protected files untouched

`discourse/builders-membership.service.ts`, `discourse/community.controller.ts`, `google-sessions/members.controller.ts` and all of `src/app/auth/` are byte-identical (absent from `git status`). G4 — the TASK_2026_169 security invariant — is green, and both `community-gate-smoke.mjs` and `discourse-e2e.mjs` pass verbatim. Nothing in the R2 restructure came close to needing them.

---

## 10. Acceptance criteria

- [x] `admin/AdminController` split into 5 controllers at `v1/admin/{records,users,stats,waitlist,licenses}`; all handler bodies, guard chains and throttle decorators moved verbatim (§2). `admin.controller.ts` deleted. All five registered in `AdminModule` with its `imports` array unchanged.
- [x] `route-map.spec.ts` created per §5.1, consuming R1's shared registry (no re-declared controller list), infra-free, asserting RI-1/RI-2/RI-3 with `EXPECTED_ROUTES` and both ledgers as data.
- [x] **Falsification captured failing AND restored for each of RI-1, RI-2, RI-3** — plus a control run proving RI-3 tests ordering not existence, plus two ledger-direction proofs, plus `EXPECTED_ROUTES` and the `AdminStatsController` ledger probe. **Seven proofs total.** Every revert verified byte-identical by `md5sum -c`.
- [x] G3, the `app.module.ts:66-71` comment, and the `admin-packs.controller.ts:47-51` docblock deleted — each with the replacing assertion named and demonstrated (§6).
- [x] `admin-api.service.ts` ×3 and `admin-auth.guard.ts` ×1 updated **in the same change set**; the guard probe verified live at 200 new / 404 old (§7.1).
- [x] B0 ledger updated: `ALL_CONTROLLERS` 21 → 25 (in `controller-registry.ts`, per R1 handoff note 3), `UNVALIDATED_DEBT` 9 → 12 with B7a–B7d annotations, `AdminStatsController` correctly absent. Coverage lost across the split: **none** — proven by `MIN_TOTAL_PAYLOAD_PARAMS` reading exactly 39 (§5.2) and by the census being green with the 5 new files.
- [x] Suite **654 passed / 5 skipped / 659 total**, delta +16 reconciled line by line (§5.1).
- [x] All eight gates pass; three smoke scripts verbatim and unmodified, exit 0.
- [x] Registered route table 65 → 65, diff exactly the 3 R2 rows (§7.3).
- [x] Seeded data cleaned up and post-state verified through the API (§8).
- [x] Nothing staged, nothing committed. Protected files and `src/app/auth/` untouched.
- [x] One CLI agent used, read-only, for an independent path-literal sweep; every hit re-verified against source by me. The split design and the invariant design were not delegated.

---

## 11. Handoff notes

1. 🔴 **`admin-auth.guard.ts` and the server split MUST ship in one commit.** They are already in one working tree. Splitting them across two commits reintroduces the lockout for the duration.
2. **R3 must delete all ten `KNOWN_PREFIX_DEBT` entries** in `route-map.spec.ts` when it moves `license/AdminController` to `v1/integrations/licenses` — the staleness assertion fails if it forgets, the main assertion fails if it deletes them early. It must also update `EXPECTED_ROUTES` (`POST v1/admin/licenses` → `POST v1/integrations/licenses`) and the registry entry.
3. **The route count is 65, not 64** (N1). R3/R4 should expect 65 and the §9 checklist should be corrected.
4. **`KNOWN_CONTESTED` is already empty** (N3). R3 has nothing to remove from it.
5. **R2's ledger edit spans two files**, as R1's handoff predicted: `ALL_CONTROLLERS` in `src/testing/controller-registry.ts`, `UNVALIDATED_DEBT` in `src/common/controller-validation.spec.ts`. R3/R4/R5 inherit that split.
6. **B7 → B7a/B7b/B7c/B7d targets now exist as real classes** with the ledger lines already annotated per batch. B7a's `passthroughDtoPipe` docblock in `dto-validation.pipe.ts` now points at the correct file (N4).
7. ⚠️ **B7d: there is no safe way to live-test `POST /api/v1/admin/waitlist/invite`** against a DB with waitlist rows — `batchSize: 0` is not a no-op and it sends real email (§8).
8. **Do not stage `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts`** — pre-existing, not mine, same as R1 reported.
9. **The dev container bind-mounts `src/` and hot-reloads.** When capturing `RouterExplorer` output, slice the log to the most recent `Starting Nest application` — an unsliced `docker logs --since` window will mix boots and can silently include a route from a falsification probe. I hit this exactly once and caught it because the count read 66.
