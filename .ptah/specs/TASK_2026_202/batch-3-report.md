# Batch 3 report — C4 reusable cohort scheduling

**Task**: TASK_2026_202 · **Batch**: 3 of 3 (final) · **Executor**: backend-developer
**Worktree**: `D:/projects/ptah-extension/.claude/worktrees/founding-cohort`
**Branch**: `ak/founding-cohort-free-access` · **Not committed** — team-leader owns commits.

**Headline**: all nine tasks (3.0–3.8) complete. Both routes ship preview-then-apply with
the confirm-echo guard. **Task 3.0's gate produced a split verdict and the plan's
pre-authorised fallback was taken** — see §1, which is the one decision needing review.

---

## 1. 🔴 Task 3.0 — the `temporal-polyfill` gate: split verdict, fallback taken

The gate names two criteria. **Both PASSED.** A third thing, which the gate did not
name, failed and is fatal.

| Gate criterion                           | Verdict    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does it bundle?                          | ✅ **YES** | `nx build ptah-license-server` succeeded with a real `Temporal` call in `main.ts`. esbuild **inlined** the package — `dist/apps/ptah-license-server/main.cjs` contains `temporal-polyfill/chunks/root.js`, `internal.js`, `apiHelpers.js` and 147 `PlainDate` references. It is absent from the generated `package.json` dependencies, i.e. not externalised. **No deploy change needed**, exactly as §5.4 predicted |
| Does its v1 surface match §5.4's sketch? | ✅ **YES** | `PlainDate.from('2026-09-01').dayOfWeek === 2` (Tuesday ✓), `.toPlainDateTime().toZonedDateTime(tz).toInstant().epochMilliseconds` all behave as written; an unknown zone throws `RangeError`                                                                                                                                                                                                                        |
| **Does it load under the test harness?** | ❌ **NO**  | `temporal-polyfill@1.0.2` is **ESM-only**                                                                                                                                                                                                                                                                                                                                                                            |

### The blocker, measured

`node_modules/temporal-polyfill/package.json` — every one of its ~40 `exports` entries
has an `import` condition and **no `require` condition**; there is no CJS build in the
package at all.

```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in
  D:\projects\ptah-extension\node_modules\temporal-polyfill\package.json
```

Both suites that must stay green run `ts-jest` with `module: commonjs`
(`libs/api/learning/tsconfig.spec.json`, `apps/ptah-license-server/jest.config.ts`), so
a throwaway `import { Temporal } from 'temporal-polyfill'` in a spec fails to load:

```
SyntaxError: Unexpected token 'export'
  D:\projects\ptah-extension\node_modules\temporal-polyfill\index.d.ts:1
```

I then tried the obvious repair —
`transformIgnorePatterns: ['/node_modules/(?!(temporal-polyfill|temporal-spec|temporal-utils)/)']`.
It got the module to _load_ and then failed differently:

```
TypeError: Cannot read properties of undefined (reading 'PlainDate')
```

— the named `Temporal` export does not survive ts-jest's ESM→CJS interop.

**Blast radius if pursued.** The fix would have to be applied to **two** jest configs,
not one: `route-map.spec.ts` and `controller-validation.spec.ts` both import
`ALL_CONTROLLERS` from `src/testing/controller-registry`, which imports
`AdminCourseModulesController` → `CourseScheduleService` → the helper. So the app's
163-test suite would depend on an ESM-in-CJS transform of a third-party package — and
`apps/ptah-license-server/jest.config.ts` is a file TASK_2026_201 Batch 5 may also touch.

### The decision

`implementation-plan.md` §5.4 pre-authorised precisely this outcome:

> _"the fallback is a hand-rolled `Intl.DateTimeFormat` two-pass offset resolver in the
> same pure helper with the **same signature**, which changes ~30 lines of one file and
> nothing else. The helper's signature is chosen so that swap is local."_

I took the fallback. **`WeekdayScheduleInput`, `WeekdaySlot`, `ScheduleInputError` and
`computeWeekdaySchedule` are §5.4's signatures verbatim**, so nothing outside
`weekday-schedule.ts` knows which implementation is behind them and the swap back is a
one-file change if the polyfill ever ships CJS. It also costs the bundle nothing, needs
no jest config change in any project, and works identically under CJS and ESM — `Intl`
carries the same IANA tzdata the polyfill ships.

All of this is recorded in the helper's file docblock, with the measurements, so the
next reader does not re-litigate it.

**⚠️ For the team-leader**: this is a deviation from the plan's stated mechanism (not
from its interface, behaviour, or any acceptance criterion). If you would rather pay the
two-jest-config cost to keep `Temporal`, the swap is confined to
`libs/api/learning/src/lib/common/weekday-schedule.ts` and the spec would not change.

All probe artefacts were reverted: `git checkout` on `main.ts`, jest config restored from
backup, throwaway spec deleted. Verified clean.

---

## 2. File-by-file changes

### Created (7)

| File                                                                | What                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/api/learning/src/lib/common/weekday-schedule.ts`              | Pure helper: `computeWeekdaySchedule`, `WeekdayScheduleInput`, `WeekdaySlot`, `ScheduleInputError`. Zero dependencies, no DB, no clock, no `process.env` — mirrors `common/sort-order.ts` |
| `libs/api/learning/src/lib/common/weekday-schedule.spec.ts`         | 25 tests. Pure, no Nest, no mock                                                                                                                                                          |
| `libs/api/learning/src/lib/courses/dto/schedule-modules.dto.ts`     | `PreviewModuleScheduleDto` + `ApplyModuleScheduleDto extends` it                                                                                                                          |
| `libs/api/learning/src/lib/courses/course-schedule.service.ts`      | `CourseScheduleService` — one method, one return type, `apply` as a flag                                                                                                                  |
| `libs/api/learning/src/lib/courses/course-schedule.service.spec.ts` | 28 tests against `mock-learning-prisma.ts`                                                                                                                                                |
| `docs/community/curriculum-reseed-runbook.md`                       | Six-section operator runbook (Task 3.8)                                                                                                                                                   |
| —                                                                   | _(`jest.census-probe.config.ts` was temporary; deleted — see §6)_                                                                                                                         |

### Modified (8)

| File                                                                        | What                                                                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `libs/api-contracts/community/src/lib/admin/admin-course.contract.ts`       | `AdminModuleScheduleEntry`, `AdminModuleSchedule`, beside `AdminCourseModule`                              |
| `libs/api-contracts/community/src/index.ts`                                 | Both exported from the barrel                                                                              |
| `libs/api/audit/src/lib/audit-log.types.ts`                                 | `\| 'learning.module.schedule'` after `'learning.module.reorder'`, with the block's established voice      |
| `libs/api/learning/src/lib/courses/admin-course-modules.controller.ts`      | Two handlers, `CourseScheduleService` injected, RI-3 docblock extended                                     |
| `libs/api/learning/src/lib/courses/admin-course-modules.controller.spec.ts` | Route table 4→6, payload params 3→5, plus a new C4 describe block                                          |
| `libs/api/learning/src/lib/learning.module.ts`                              | `CourseScheduleService` in `providers` only; "Seven services"→"Eight"; internal-services paragraph updated |
| `libs/api/learning/src/lib/learning.module.spec.ts`                         | "seven"→"eight" + the exact `toEqual` provider list                                                        |
| `apps/ptah-license-server/src/common/route-map.spec.ts`                     | `EXPECTED_ROUTES` +2, prose total re-derived                                                               |
| `apps/ptah-license-server/src/common/controller-validation.spec.ts`         | `MIN_TOTAL_PAYLOAD_PARAMS` 78→80 + decomposition                                                           |

### Deliberately NOT touched — verified by `git status`

`module-lock.service.ts`, `community-seed.ts`, `courses.service.ts` (the `PATCH :id`
path), `nullable-dto.spec.ts`, `admin-guards.spec.ts`, `prisma/schema.prisma`, and
everything under `libs/api/licensing`, `libs/api/marketing`, `libs/api/community`.

---

## 3. The two DTOs and their `dtoPipe` bindings

```ts
@Post('schedule/preview')  @HttpCode(200)
async previewSchedule(@Req() req, @Body(dtoPipe(PreviewModuleScheduleDto)) dto)

@Post('schedule')          @HttpCode(200)
async applySchedule(@Req() req, @Body(dtoPipe(ApplyModuleScheduleDto)) dto)
```

Both carry `@UseGuards(AdminThrottlerGuard)` + `@Throttle(ADMIN_WRITES)`; class-level
`@UseGuards(JwtAuthGuard, AdminGuard)` already covers them. `…/preview` is declared
first.

**Both bindings are whole-object `@Body(dtoPipe(...))`.** There is no `@Query()`
anywhere on this controller, so `NAMED_PRIMITIVE_PARAM_COUNT` stays at its exact 6 —
which is what lets the `+2` arithmetic close at 80.

**Asserted, not assumed** (`admin-course-modules.controller.spec.ts`):

- `expectedTypeOf('previewSchedule') === PreviewModuleScheduleDto`
- `expectedTypeOf('applySchedule') === ApplyModuleScheduleDto`
- the existing PRE-1 loop now covers all five payload params: `named: false, bound: true`

`@Matches(/^\d{4}-\d{2}-\d{2}$/)` on `startDate`, **not `@IsISO8601()`** — asserted by a
case sending `2026-09-01T17:00:00.000Z` and expecting a `400`, so a datetime cannot be
silently truncated by `timeOfDay`.

No field in either DTO is nullable-optional; `EXPECTED_NULLABLE_OPTIONALS` stays at 13
(re-verified green).

---

## 4. How the confirm-echo guard is enforced and tested

**Enforced** in `CourseScheduleService.assertEcho`, called **inside the `$transaction`,
against the same `findMany` snapshot the writes see** (`reorder.service.ts:49-54` /
D-6.6a's reasoning), and **before any write**:

- `confirmModuleCount` is checked **first** — if the module count is wrong the computed
  last date is also wrong, and reporting the date first would send the operator to fix
  the wrong field.
- Each refusal is a `BadRequestException` naming **expected and received** for the
  failing field, and pointing at the preview endpoint.

**Tested** — every one of these asserts _zero_ `courseModule.update` calls and _zero_
audit rows:

| Case                                                                                                                      | Test location                                 |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `confirmLastReleaseDate` wrong by one day (`2026-09-11` for `2026-09-14` — the answer the WRONG fixed offset table gives) | service spec                                  |
| The refusal message names both values                                                                                     | service spec (regex over expected + received) |
| `confirmModuleCount` 10 against a 12-module course                                                                        | service spec                                  |
| 🔴 **Transposed `2026-01-09` for `2026-09-01`** — the named failure mode                                                  | service spec                                  |
| Wrong `confirmLastReleaseDate` through the real controller                                                                | controller spec                               |
| Wrong `confirmModuleCount` through the real controller                                                                    | controller spec                               |
| Echo is **not** checked on a preview                                                                                      | service spec                                  |

**And the classes are distinct on the wire**, which is what makes the guard
unbypassable — both directions run through the real `ValidationPipe`:

- apply payload → `/preview` = `400`, message contains `confirmModuleCount` **and**
  `confirmLastReleaseDate` (two non-whitelisted keys)
- preview payload → `/schedule` = `400`, same two names (two missing required keys)
- each payload **is** accepted by its own endpoint, so neither rejection is vacuous

⚠️ One trap worth recording: `BadRequestException.message` is the generic string
`"Bad Request Exception"`; the per-property constraint failures live in `getResponse()`.
My first version of these three tests passed `ok: false` but asserted the wrong string.
The helper now reads the response body, and the reason is a comment in the spec — an
assertion on `.message` would have made all three pass for the wrong reason.

---

## 5. Timezone and DST handling, with evidence

**Design**: weekday arithmetic runs on the **civil calendar** (a `Date.UTC` day counter
used purely as a DST-free calendar), and each slot is converted to an instant
**independently** at the end. Nothing accumulates, so nothing can drift.

**The resolver** is a two-pass `Intl.DateTimeFormat` offset resolver with a
**round-trip verification**: read the zone's offset one day either side of the target,
form the candidate instants, convert each back and keep those that reproduce the exact
local wall clock.

- ordinary → both offsets agree, one candidate, it round-trips
- **fall back** (local time happens twice) → both round-trip, the **earlier** is taken
- **spring forward** (local time never happens) → neither round-trips, the
  pre-transition offset is used, landing the release **after** the gap

Both DST readings match `Temporal`'s `'compatible'` default, which is what §5.4
specified.

### Evidence — all green

| Property                           | Assertion                                                                                                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The founder's cohort**           | Tuesday 1 Sep 2026 × 10 → the ten §5.7 dates, **Day 10 on Mon 14 Sep**, weekday labels asserted too                                                                                                                                       |
| The offsets are **not** a constant | Monday-start and Tuesday-start tables both asserted, plus an explicit test that Day 4 is one day apart and **Day 5 is three days apart**                                                                                                  |
| 🔴 **DST-crossing cohort**         | Berlin, 22 Oct 2026 × 6 across the 25 Oct fall-back: every instant is still **09:00 local**, and the UTC offsets **differ** — `07:00Z` before, `08:00Z` after. **A `+24h` implementation fails exactly this and nothing else catches it** |
| Spring-forward cohort              | Berlin, 26 Mar 2026 × 4 across the 29 Mar transition — `08:00Z` → `07:00Z`                                                                                                                                                                |
| Fall-back → earlier instant        | `Africa/Cairo`, Thu 29 Oct 2026 at 23:30 (happens twice) → the **earlier** `20:30Z`                                                                                                                                                       |
| Spring-forward → forward shift     | `Africa/Cairo`, Fri 24 Apr 2026 at 00:30 (never happens) → `22:30Z` = **01:30 local, same day**                                                                                                                                           |
| UTC is not double-applied          | instants equal the naive concatenation                                                                                                                                                                                                    |
| Sign and half-hour offsets         | `America/New_York` (−4) and `Asia/Kolkata` (+5:30)                                                                                                                                                                                        |
| Midnight does not roll back a day  | `00:00` Berlin → `2026-08-31T22:00:00.000Z`, `localDate` still `2026-09-01`                                                                                                                                                               |

⚠️ **Why Cairo and not Berlin for the fold/gap cases**: every European transition is on a
**Sunday**, and this scheduler skips weekends — so no European cohort can ever be
scheduled _into_ a fold or gap, and a Berlin test would assert against a date the feature
can never produce. Egypt moves its clocks on the last **Friday** of April and last
**Thursday** of October. Both tests assert the **tzdata precondition first**, so if a
future ICU ships different Egyptian rules the precondition fails and names the reason
rather than the resolver appearing broken.

**Rejected inputs** → `ScheduleInputError` → `BadRequestException` with a written
sentence, never `error.message`:

- 🔴 **weekend start is an error, not a roll-forward to Monday** (Sat and Sun both tested)
- unresolvable zone (`Mars/Olympus`) — and a test asserts the response does **not**
  contain the string `Mars/Olympus`
- `2026-02-30` — shaped right, not a real day. `Date.UTC` silently rolls it to 2 March,
  which would have scheduled a cohort two days off with no error anywhere. The DTO regex
  cannot catch this; the round-trip check in `parseCivilDate` does
- `count` < 1 or non-integer

---

## 6. Structural guards

| Guard                                                         | Change                                                                                                                  | How verified                                                                                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPECTED_ROUTES`                                             | **+2**, in sorted position in the P3 block, with a comment on why the pair does not unify and why the preview is a POST | Exact-count assertion green                                                                                                                     |
| Prose running total                                           | **137 → 139**, re-derived with its decomposition; the P3 block heading now records 27 + 2 = 29                          | The `:229-238` docblock's warning about stale prose totals was the reason to do this properly                                                   |
| `PREFIX_EXCEPTIONS` / `KNOWN_PREFIX_DEBT` / `KNOWN_CONTESTED` | **unchanged**                                                                                                           | Green — no new controller, no new prefix                                                                                                        |
| `MIN_TOTAL_PAYLOAD_PARAMS`                                    | **78 → 80**                                                                                                             | Re-derived by the documented `:217-222` procedure: set 9999, ran, read `Received: 80`, restored, wrote the `+2` decomposition into the docblock |
| `NAMED_PRIMITIVE_PARAM_COUNT`                                 | **unchanged at 6**                                                                                                      | Exact-equality assertion green                                                                                                                  |
| `ALL_CONTROLLERS` / `UNVALIDATED_DEBT` / `EXCLUDED`           | **unchanged**                                                                                                           | Green                                                                                                                                           |
| `EXPECTED_NULLABLE_OPTIONALS`                                 | **unchanged at 13**                                                                                                     | `api-core` green (26/26)                                                                                                                        |
| `admin-guards.spec.ts` G1/G3                                  | **unchanged**                                                                                                           | Green                                                                                                                                           |
| `learning.module.spec.ts` five controllers / five prefixes    | **unchanged**                                                                                                           | Green                                                                                                                                           |

⚠️ **Note for the TASK_2026_201 Batch 5 merge**: my edits to `route-map.spec.ts` and
`controller-validation.spec.ts` are purely **additive** — two array entries in sorted
position, one constant, and appended docblock paragraphs in the files' existing
"re-derived in every batch" style. No existing line was reworded or moved.

---

## 7. Verification results

Run from the worktree root.

| Command                                               | Result                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npx nx test api-learning --skip-nx-cache`            | ✅ **548/548**, 22 suites (was 495; +53 new)                                                   |
| `npx nx test api-core --skip-nx-cache`                | ✅ 26/26                                                                                       |
| `npx nx test api-audit --skip-nx-cache`               | ✅ 5/5                                                                                         |
| `npx nx test api-contracts-community --skip-nx-cache` | ✅ 33/33                                                                                       |
| `npx nx run api-learning:typecheck`                   | ✅ clean                                                                                       |
| `npx nx run api-contracts-community:typecheck`        | ✅ clean                                                                                       |
| `npx nx run api-audit:typecheck`                      | ✅ clean                                                                                       |
| `npx nx run api-learning:"eslint:lint"`               | ✅ 0 errors, 0 warnings                                                                        |
| `npx nx run ptah-license-server:"eslint:lint"`        | ✅ 0 errors (2 pre-existing warnings in `jest.config.ts` and `instrument.ts`, untouched by me) |
| `npx nx test ptah-license-server`                     | ⚠️ **163/163 pass, but see below**                                                             |
| `npx nx run ptah-license-server:typecheck`            | ⚠️ **1 error, not mine — see below**                                                           |
| `npx nx build ptah-license-server`                    | ⚠️ same 1 error                                                                                |

### 🔴 The license-server target is blocked by TASK_2026_201's uncommitted work

```
libs/api/admin/src/lib/admin-waitlist.controller.ts:75:40 - error TS2339:
  Property 'inviteBatch' does not exist on type 'WaitlistService'.
Found 1 error.
```

**This is not my change.** Proof:

- `git show HEAD:libs/api/marketing/.../waitlist.service.ts | grep -c inviteBatch` → **1**
- `grep -c inviteBatch` on the working tree → **0**

The method exists in `HEAD` and was removed by the **uncommitted** edit to
`libs/api/marketing/src/lib/waitlist/waitlist.service.ts` — one of the three lib trees I
was explicitly told not to touch, being edited concurrently by TASK_2026_201 Batch 3 in
this same worktree. `libs/api/community/member-groups` also became dirty mid-session,
from the same source. Earlier in this session, before that edit landed,
`nx build ptah-license-server` **succeeded**.

**So I verified the 163 tests without touching their files**: a temporary
`jest.census-probe.config.ts` identical to `jest.config.ts` except `diagnostics: false`
(which suppresses only the type error, not any assertion).

```
Test Suites: 5 passed, 5 total
Tests:       163 passed, 163 total
```

and, narrowed to the structural guards after all my census edits were in place:

```
controller-validation | route-map | admin-guards
Test Suites: 3 passed, 3 total
Tests:       90 passed, 90 total
```

**The probe config was deleted.** `git status` confirms it is gone.

**Action for the team-leader**: once TASK_2026_201 restores or renames `inviteBatch`,
`nx test ptah-license-server`, `:typecheck` and `:build` should all go green with no
further change from this batch. Please re-run them before committing.

---

## 8. Constraints — each confirmed

- ✅ **The seed never writes `releaseAt`.** `community-seed.ts` is not in my diff.
- ✅ **`ModuleLockService` not modified.** Not in my diff.
- ✅ **Concrete `releaseAt` values written**, so `PATCH /v1/admin/course-modules/:id`
  still works. That controller path is untouched; its tri-state spec still passes.
- ✅ **Works for cohorts 2 and 3 with no code change.** `count` comes from
  `modules.length`, never a literal — asserted with `count: 1`, `3`, `12` in the helper
  spec and a 12-module and a 1-module course in the service spec.
- ✅ **Timezone explicit and required as IANA.** No default anywhere; `Intl` resolution is
  the real check.
- ✅ **Both routes bind `dtoPipe`.** Asserted per-handler with the exact `expectedType`.
- ✅ **No audit row on `/preview`.** Asserted at both service and controller level.
- ✅ `catch (error: unknown)` narrowed with `instanceof Error` throughout; no
  `process.env`; no raw `error.message` to clients; no `@ts-ignore`; `libs/api/**`
  imports nothing from `libs/backend/**` or `libs/frontend/**`.

### Pre-existing `releaseAt` values (plan §5.5) — a total re-schedule

Overwrites, and shows what it will overwrite first, via three mechanisms:

1. Preview returns `currentReleaseAt` for **every** module plus `changed` and
   `changedCount`.
2. Apply writes **only** changed rows, so `updatedAt` does not move on the rest — which
   is what makes **"a second identical apply → `changedCount: 0`, zero updates"** an
   assertable observable (tested).
3. Audit metadata carries `{ slug, from, to }` per changed module — the only record of
   the previous dates, since `CourseModule` has no column for them (tested, including
   `from: null` for a previously unscheduled module).

⚠️ **One deliberate deviation from the plan's sketch.** §5.6 specified
`audit?.(tx, null)` using `CoursesService`'s `AuditHook` type `(tx, targetId)`. That
signature **cannot carry the change list**, and the controller builds the hook before the
service has computed anything — so the metadata would have shipped empty and the recovery
record would have been lost. I added a narrow `ScheduleAuditHook = (tx, changed)` type
alongside it. Still exactly **one** audit call, still `targetId: undefined`, still inside
the mutation's own transaction (PRE-6), still using the shared `auditHook(...)` writer —
the controller just closes over it. Documented in the type's docblock.

---

## 9. FR-DATE-2 offset table — as documentation of what the action computes

Delivered in `docs/community/curriculum-reseed-runbook.md` §5.2 and in the helper's
docblock. **`task-description.md` §10's table is wrong for a Tuesday start** and is not
reproduced anywhere.

> **The rule.** Day 1 is the cohort start date. Each subsequent day advances one calendar
> day in the cohort's own time zone, skipping Saturday and Sunday. **The offsets are a
> function of the start weekday, not a constant.**
>
> **Monday start** — `+0 +1 +2 +3 +4 · +7 +8 +9 +10 +11` (clean 5 + 5).
> **Tuesday 1 September 2026 (C3)** — `+0 +1 +2 +3 +6 · +7 +8 +9 +10 +13`:

| Day | Date       | Weekday |     | Day | Date           | Weekday |
| --- | ---------- | ------- | --- | --- | -------------- | ------- |
| 1   | 2026-09-01 | Tue     |     | 6   | 2026-09-08     | Tue     |
| 2   | 2026-09-02 | Wed     |     | 7   | 2026-09-09     | Wed     |
| 3   | 2026-09-03 | Thu     |     | 8   | 2026-09-10     | Thu     |
| 4   | 2026-09-04 | Fri     |     | 9   | 2026-09-11     | Fri     |
| 5   | 2026-09-07 | Mon     |     | 10  | **2026-09-14** | **Mon** |

Day 10 alone on Monday 14 September is the known, accepted C3 consequence — **do not
re-raise it.** These ten dates are asserted in `weekday-schedule.spec.ts` and again in
`course-schedule.service.spec.ts`.

The runbook contains none of the marketplace-flagged trademark strings (verified by grep).

---

## 10. Incomplete / needs the team-leader

1. 🔴 **`nx test ptah-license-server`, `:typecheck` and `:build` cannot be run green**
   until TASK_2026_201's uncommitted `libs/api/marketing` edit is resolved (§7). All
   three fail on a single error in a file I did not touch. I verified the equivalent
   (163/163) out-of-band. **Please re-run all three before committing.**
2. ⚠️ **The `temporal-polyfill` fallback (§1)** is a mechanism deviation from the plan and
   is the one decision worth a second opinion. The interface, behaviour and every
   acceptance criterion are unchanged, and the swap back is one file.
3. **Not run**: the whole-task database regression (`prisma:reset` + two
   `seed-community` runs). It needs `npm run docker:db:start` and belongs to the
   task-level exit gate rather than to Batch 3 — Batch 3 shares no file with the seed. The
   C5 property it checks (every module still `releaseAt = null` after both runs) is
   structurally guaranteed here: `community-seed.ts` is not in my diff.
4. **No admin UI.** `libs/web/admin` has no course surface, so this action is driven by
   `curl` per the runbook. Already recorded in the plan as a follow-up, not a gap.

---

## Team-Leader Verification

**Verdict**: ✅ **APPROVED — COMMITTED as `ee346fbde`**
(`feat(api-learning): schedule a cohort curriculum from one start date`)

**TASK_2026_202 is now FULLY COMPLETE** — 3 of 3 batches landed
(`7257cbae1`, `bf73ba610`, `ee346fbde`).

### 🔴 This batch got its OWN commit — the brief's combined-commit premise was wrong

The dispatch brief told me to land this batch and TASK_2026_201 Batch 3 as one
commit, because both edit `route-map.spec.ts` and `controller-validation.spec.ts`
and a split was expected to leave one commit knowingly red. **It does not.** Two
facts:

1. `MIN_TOTAL_PAYLOAD_PARAMS` is asserted with `toBeGreaterThanOrEqual`
   (`controller-validation.spec.ts:595`) — a **floor**, not an exact count. The
   one line the two batches genuinely share is not a hard constraint on
   intermediate states.
2. Outside the two guard files the batches share **no file at all**.

So this batch's guard-file state — `MIN_TOTAL_PAYLOAD_PARAMS = 80`, ledger 139,
invite route still listed — was reconstructed and committed first, then 201's
`-1` was composed on top. That intermediate state is the one you actually left on
disk before 201 edited around it, so nothing was invented. Verified green in
isolation before committing:

`typecheck` ✅ · `ptah-license-server` ✅ **163/163** (5 suites) · `api-learning`
✅ **548/548** · `api-admin` ✅ 32 · `api-marketing` ✅ 39 · `api-community` ✅ 448
· `eslint:lint` ✅ 0 errors.

### § 10.1 is resolved

Your three blocked targets now run green. On the final tree (after 201 landed):
`typecheck` ✅ · `nx test ptah-license-server` ✅ **162/162** (163 − 1, exactly as
predicted) · `eslint:lint` ✅ 0 errors. The `jest.census-probe.config.ts`
workaround is no longer needed and is confirmed absent.

### The seven verification points

6. **Both routes bind `dtoPipe(TheDto)`** — ✅. Checked the actual parameter
   decorators, not the DTO definitions:
   `admin-course-modules.controller.ts:176` `@Body(dtoPipe(PreviewModuleScheduleDto))`
   and `:214` `@Body(dtoPipe(ApplyModuleScheduleDto))`. No `@Query()` anywhere on
   the controller, so `NAMED_PRIMITIVE_PARAM_COUNT` legitimately stays at 6.
7. **Confirm-echo guard is real and tested** — ✅. `assertEcho` runs **inside** the
   `$transaction`, against the same `findMany` snapshot the writes see, and
   **before** any `update`. Both fields are compared against freshly computed
   values (`modules.length` and `slots[last].localDate`), not against anything
   the client supplied. Wrong values are rejected: the off-by-one-day case
   (`2026-09-11` for `2026-09-14` — the answer the WRONG fixed offset table
   gives), the transposed `2026-01-09` / `2026-09-01` case, and a wrong
   `confirmModuleCount`, each asserting **zero** `courseModule.update` calls and
   zero audit rows, at both service and controller level. The
   `BadRequestException.message`/`getResponse()` trap you recorded in § 4 was the
   right catch — an assertion on `.message` would have passed for the wrong reason.
8. **⚠️ The `Intl` fallback preserves DST-correct day advancement — SCRUTINISED
   AND UPHELD.** This was the one point that could have rejected the batch, and
   it holds for a structural reason, not by luck: **the day advance never touches
   a time zone at all.** `civil` is a `Date.UTC`-based pure day counter, so
   `civil += MS_PER_DAY` is exact calendar arithmetic in a scale that has no DST;
   the zone is applied once per slot, independently, in
   `localWallClockToInstant`, and nothing accumulates. That is precisely the
   property `Temporal` was specified for, and it survives the swap intact.
   Verified by test rather than by reading: **`Europe/Berlin`, 22 Oct 2026 × 6,
   crossing the 25 Oct fall-back** — every slot holds `09:00` local while the UTC
   instants move `07:00Z` → `08:00Z` across the transition
   (`weekday-schedule.spec.ts:335-348`). A `+24h` implementation fails exactly
   that assertion. The late-March spring-forward case (`08:00Z` → `07:00Z`) and
   the two `Africa/Cairo` fold/gap cases are present too, and your reason for
   using Cairo rather than Berlin for the fold/gap — European transitions fall on
   a Sunday, which this scheduler can never schedule into — is correct and is
   why those tests assert something reachable.
   The two-pass round-trip resolver was read line by line: ordinary → one
   candidate; fold → both round-trip, `.sort()` then `[0]` takes the earlier;
   gap → neither round-trips, falls back to the pre-transition offset, landing
   after the gap. Both readings match `Temporal`'s `'compatible'` default, as
   §5.4 required. **Mechanism deviation accepted.**
9. **Timezone required as an explicit IANA identifier** — ✅. `timeZone` is a
   required DTO field with no default anywhere; the regex is a shape check and
   `Intl.DateTimeFormat` construction is the real validation. No server-zone,
   container `TZ`, or UTC-by-assumption path exists.
10. **`ModuleLockService` unmodified, seed still never writes `releaseAt`** — ✅,
    confirmed by diff: neither `module-lock.service.ts` nor `community-seed.ts`
    nor `prisma/` appears anywhere in the commit.
11. **No audit row on `/preview`** — ✅. Structurally guaranteed: `audit?.()` is
    called only inside `if (apply)`, and `previewSchedule` passes no hook at all.
    Asserted at both levels, including a case proving the service works with no
    hook supplied.
12. **Keyed on a course, does not assume ten modules** — ✅. `count` is
    `modules.length` from the transaction's own read, never a literal; asserted
    with 1, 3 and 12-module courses. `courseId` is the request key, so cohort 2
    (a new course row) needs no code change.

### One note, not a defect

`ScheduleAuditHook` diverging from `CoursesService`'s `AuditHook` (§ 8) is the
right call — the plan's `(tx, targetId)` signature could not carry the change
list, and without `{ slug, from, to }` in the audit metadata a re-schedule run
against a wrong start date would be unrecoverable, since `CourseModule` has no
column holding a previous `releaseAt`. Still one audit call, still inside the
mutation's transaction, still through the shared writer.

### Remaining, for the task-level exit gate

The database regression (`prisma:reset` + two `seed-community` runs) is still not
run and correctly belongs to the task exit gate rather than to this batch. The
C5 property it checks is structurally guaranteed here because `community-seed.ts`
is not in the diff.

**Staged by name only.** `.ptah/specs/TASK_2026_201/` and `TASK_2026_202/` remain
untracked, as instructed. No hooks bypassed.
