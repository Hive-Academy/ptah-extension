# Development Tasks — TASK_2026_202

Curriculum restructure: 8 weekly modules → 10-day intensive, plus C4 reusable
cohort scheduling.

**Total Tasks**: 15 | **Batches**: 3 | **Status**: 3/3 complete
**Worktree root**: `D:/projects/ptah-extension/.claude/worktrees/founding-cohort`
**Branch**: `ak/founding-cohort-free-access`

**Contract precedence** — `context.md`'s `## Checkpoint 1 outcomes` (C1–C5) AMENDS
`task-description.md`. `implementation-plan.md` is the authority for HOW. Where
`task-description.md` §4's module table and `implementation-plan.md` §1.2's table
disagree, **§1.2 (= `context.md:122-133`) ships**. `task-description.md` §4 is DEAD.

**CLI delegation is DISABLED** (Checkpoint 0.1). Every batch is executed by a
sub-agent developer. Do not recommend or spawn `codex`, `ptah-cli`, `gemini`, or
any other CLI agent.

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS. No blockers. The architect raised no
clarifications, and C1–C5 closed the three items `task-description.md` left open.

### Assumptions verified against the code

| # | Assumption | Verdict |
| --- | --- | --- |
| 1 | The edit is atomic by construction | ✅ `map-course.ts:194-200` throws `CourseMappingError` before any DB work when `MODULE_TITLES.length !== CURRICULUM_TOPIC_IDS.length`; proven by `community-seed.spec.ts:1455-1458` (`db.writes()` empty, transaction never opened) |
| 2 | The seed has no delete verb | ✅ `community-seed.ts:105-109` exposes only `findUnique`/`create`/`update` — FR-IDEM-2 stands, no delete is added |
| 3 | The seed never writes `releaseAt` | ✅ `community-seed.ts:589-592`, `:518-528`. FR-DATE-1 survives; the scheduler of Batch 3 is the ONLY writer of that column |
| 4 | No environment holds the 8-week course | ✅ C1 — no workflow runs `seed-community` or `prisma:migrate:deploy`; `founder-setup-checklist.md` §2.4 unchecked. R2 drops Critical → Low. The runbook still ships |
| 5 | `temporal-polyfill` is available and unused | ⚠️ Declared at `package.json:187`, imported nowhere. **Unverified that it bundles.** Task 3.0 is a hard gate before any other Batch 3 file |
| 6 | No committed fixture needs editing | ⚠️ `__fixtures__/README.md:16-28` — derived fixtures rebuild from the real export at test time. If one needs editing, **stop and report** (FR-TEST-1) |
| 7 | `task-description.md` §9's spec table is complete | ❌ **FALSE.** The plan found six more live assertions/comments (`implementation-plan.md` §4.2). Batch 2 works the PLAN's list, not §9's |
| 8 | FR-DATE-2's fixed offset table is correct | ❌ **FALSE for a Tuesday start** (plan Finding 0). Offsets are a function of the start weekday. §5.7's corrected pair of tables ships |

### Risks carried into the batches

| # | Risk | Severity | Owning batch | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | `/^Day \d/` written with a single `\d` silently excludes Day 10 — **the single most likely way this ships broken** | HIGH | Batch 2 (Task 2.2) | Titles take `\d{1,2}`, slugs take `(0[1-9]\|10)`, plus the explicit tripwire test that asserts the naive regex FAILS on Day 10 |
| R1b | FR-DATE-2's fixed offset table shipped as-is | HIGH | Batch 1 (Task 1.4) + Batch 3 (Task 3.1) | Plan §5.7's rule + two worked tables in the docblock; the Tuesday-1-Sep dates asserted in a unit test |
| R4 | The anti-vacuity witness at `community-seed.spec.ts:1099-1113` is DELETED to make the suite pass | MEDIUM | Batch 2 (Task 2.3) | It SHALL be **re-founded per §7**, never deleted, and the test must state in its docblock that the property is now weaker and why FR-TITLE-2 is the compensating control |
| R5 | §9's table worked to completion, suite still red | HIGH | Batch 2 (Task 2.1) | Plan §4.2 names the six lines §9 misses. **Use the plan's list, not §9's** |
| R8 | A new route lands without moving a census | HIGH | Batch 3 (Task 3.6) | Both routes bind `dtoPipe(TheDto)`; `route-map.spec.ts` and `controller-validation.spec.ts` fail the build on drift and are updated in the SAME batch that adds the routes |
| R9 | `temporal-polyfill` does not bundle or its v1 surface differs | LOW | Batch 3 (Task 3.0) | Hard gate before any other C file. Fallback (`Intl.DateTimeFormat` two-pass offset resolver) is local to one file because the helper signature was chosen for it |
| R10 | Preview and apply drift apart, making the rehearsal a lie | MEDIUM | Batch 3 (Task 3.4) | ONE service method, ONE return type, `apply` as a flag |
| R12 | `COURSE_DESCRIPTION` phrased "one module per weekday" fails AC 1.2's substring check — `"one module per weekday"` CONTAINS `"one module per week"` | LOW | Batch 1 (Task 1.4) | Take plan §2.5's second phrasing (no `week` stem). Do NOT loosen the assertion instead |

### 🔴 Stop conditions — any of these means STOP AND REPORT, do not work around

1. **The forum half moves.** 4 categories, 9 topics, 10 posts, 1 skipped empty
   body. `community-seed.spec.ts:446-463` and `:500` must show **zero diff**.
   Movement there is a blast-radius failure, not a fixable test.
2. **A committed fixture needs editing** (`__fixtures__/*`) — FR-TEST-1.
3. **A non-comment line changes in `community-seed.ts`** — Batch 1 is
   comments/docblocks only in that file.
4. **`temporal-polyfill` fails to bundle** — Task 3.0.
5. **`IMPORTED_TOPIC_IDS` or `SKIP_EMPTY_BODY_POSTS` diff** in `map-topics.ts`.

---

## Batch 1: Content, mapping and census — the seed's new shape ✅ COMPLETE

**Commit**: `7257cbae1` — `feat(license-server): restructure seed curriculum into ten daily modules`
**Verified by**: team-leader MODE 2. See `batch-1-report.md` § Team-Leader Verification.

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer` re-invoked with the reviewer's issue list
**Execution Mode**: sequential
**Rationale**: Five files coupled by two hard runtime guards — the length assertion
at `map-course.ts:194-200` and the Zod exact census at
`discourse-export.schema.ts:130-148`. Every proper subset fails loudly, so the batch
is atomic by construction and cannot be split or parallelised without producing a
red tree for no benefit. Seed-domain work, one reviewer lens.
**Tasks**: 5 | **Dependencies**: None
**Authority**: `implementation-plan.md` §1, §2, §3, §6 Batch A

> ⚠️ **The suite is RED at the end of this batch. That is expected and correct.**
> Batch 2 closes it. Do not edit `community-seed.spec.ts` in this batch.

---

### Task 1.1: Rewrite the ten curriculum topics in the export ✅ COMPLETE

**File**: `D:/projects/ptah-extension/.claude/worktrees/founding-cohort/docs/community/discourse-export.json`
**Spec Reference**: `implementation-plan.md` §1.1–§1.6 (plan item A1)
**Satisfies**: Requirement 1, Requirement 5 (5.1–5.4), FR-SLUG-2, FR-TITLE-1

**Implementation Details**

- Rewrite topics **15…22 in place** (title, slug, body, `createdAt`); **ADD ids 24
  and 25** — 23 is taken by `welcome-to-the-ptah-community` and is the LAST topic
  in the file. Place 24 and 25 immediately after topic 22 so the ten curriculum
  topics stay one contiguous block **in day order**.
- Titles come from plan §1.2's table verbatim (= `context.md:122-133`), as
  `` `Day ${n} build thread — ${MODULE_TITLES[n-1]}` ``.
- Slugs per §1.3's ten literals.
- Body: the §1.4 thread shell, reused verbatim ten times, header line
  `**Day ${n}: ${MODULE_TITLES[n-1]}**` (colon, not em dash), `this week` →
  `this session`.
- `createdAt` on BOTH topic and post: `"2026-08-10T00:00:00.000Z"`, identical
  across all ten.
- `username: "system"` on every post; exactly one post per topic, `postNumber: 1`.
- Drop `cooked` on all ten. **Verify first**: `grep -rn "cooked"` repo-wide
  outside `node_modules`; if anything reads it, keep the key and report.
- Add the top-level `curriculumNote` sibling key of §1.6.

**Validation Notes**

- 🔴 **Every em dash must be a real U+2014 in UTF-8 without BOM.** A CP1252 save
  injects U+FFFD and `discourse-export.schema.ts:76-81` rejects the file before the
  transaction opens. The failure will look unrelated.
- 🔴 The title separator is **space + U+2014 + space**. A hyphen-minus fails the
  Task 1.4 guard.
- No trailing whitespace, no CR — the body is copied byte-for-byte into the lesson
  (`map-course.ts:261`) and byte fidelity is asserted.
- File order becomes `… 22, 24, 25, 23`. **Accepted** — nothing asserts ascending
  ids, and moving topic 23 would be a forum-half edit (stop condition 1).
- Do not author lesson content. The "What gets built" column of the table is NOT
  written into any file.

---

### Task 1.2: Move the census constants ✅ COMPLETE

**File**: `.../apps/ptah-license-server/prisma/seed/discourse-export.schema.ts`
**Spec Reference**: `implementation-plan.md` §3 (plan item A2)
**Dependencies**: Task 1.1
**Satisfies**: Requirement 2.3

- `EXPECTED_TOPIC_COUNT` 17 → **19**; `EXPECTED_POST_COUNT` 19 → **21**;
  `EXPECTED_NON_EMPTY_BODY_POSTS` 18 → **20**. `EXPECTED_CATEGORY_COUNT` stays **4**.
- Rewrite the `:35-54` docblock ("🔴 THIS IS 18, NOT 19…") as "20, NOT 21",
  preserving the whole small-action-post argument verbatim, plus one sentence
  recording that TASK_2026_202 moved the pair and that
  `NON_EMPTY = POST_COUNT − 1` is unchanged.

---

### Task 1.3: `CURRICULUM_TOPIC_IDS` → ten ids ✅ COMPLETE

**File**: `.../apps/ptah-license-server/prisma/seed/map-topics.ts`
**Spec Reference**: `implementation-plan.md` §2.1 (plan item A3)
**Dependencies**: Task 1.1

- `[15, 16, 17, 18, 19, 20, 21, 22, 24, 25] as const`.
- Docblocks `:19-20` and `:33` — "the remaining 8 — source ids 15…22" → ten.
- 🔴 `IMPORTED_TOPIC_IDS` and `SKIP_EMPTY_BODY_POSTS` **untouched** (stop condition 5).

---

### Task 1.4: `MODULE_TITLES`, `day-NN` slugs, description, and the FR-TITLE-2 guard ✅ COMPLETE

**File**: `.../apps/ptah-license-server/prisma/seed/map-course.ts`
**Spec Reference**: `implementation-plan.md` §2.2–§2.6, §5.7 (plan item A4)
**Dependencies**: Task 1.3
**Satisfies**: Requirement 1.2, Requirement 2.1/2.4, FR-SLUG-1, FR-TITLE-1, FR-TITLE-2, FR-DATE-2, FR-DATE-3

- `MODULE_TITLES` → §1.2's ten titles, in order, `readonly` + `as const` preserved.
- `:244` slug → `` `day-${String(index + 1).padStart(2, '0')}` `` — a positional
  literal, **never** `buildSlug()` (rule 1 of §6 preserved). Rewrite `:138` and the
  `:166-174` `buildSlug()` paragraph to name `day-01`…`day-10`, and record in the
  docblock why the padding is load-bearing (prefix trap; lexical = numeric order;
  width 2 is sized to `MODULE_TITLES.length`).
- Export `curriculumTopicTitle(day, moduleTitle)` and add the FR-TITLE-2 guard
  **inside the `CURRICULUM_TOPIC_IDS.map(...)` callback, after the `title ===
  undefined` check at `:246-250` and before the returned row** — pure code that
  runs before `$transaction` opens. Message per plan §2.4.
- `COURSE_DESCRIPTION` → plan §2.5's **second** phrasing (the one without the
  `week` stem). ⚠️ R12: `"one module per weekday"` contains `"one module per week"`.
- Make `:217`'s message computed (`${CURRICULUM_TOPIC_IDS.length}`); `:198`
  "silently drop a week" → "a day".
- File docblock `:2-41` per §2.6, including: the ONE-MODULE-PER-SESSION argument
  kept and strengthened; `sequential: false` unchanged and why; **the `:36-40`
  "wrong today, not merely fragile" note REWRITTEN, not deleted**, to record that
  TASK_2026_202 repaired it and it is now a build failure; the Requirement 5.4
  editorial sentence; C2's rationale (uneven domains, agent after entitlements,
  deploy on Day 2).
- Add the **§5.7 offset block**: the rule ("offsets are a function of the start
  weekday, not a constant") plus the Monday table AND the Tuesday-1-Sep-2026 table
  ending Day 10 on Mon 14 Sep, with the "known, accepted, do not re-raise" note.

**Validation Notes**

- 🔴 R1b: do NOT ship `task-description.md` §10's fixed `+0…+4, +7…+11` list. It
  is correct only for a Monday start (plan Finding 0).
- The guard must throw `CourseMappingError`, not a bare `Error`.

---

### Task 1.5: `community-seed.ts` — comments and docblocks ONLY ✅ COMPLETE

**File**: `.../apps/ptah-license-server/prisma/seed/community-seed.ts`
**Spec Reference**: `implementation-plan.md` §2.7 (plan item A5)
**Dependencies**: Task 1.4

- `:26-30` → ten and ten, "Day N"; `:273-277` → `1 + 10 + 10`, ~98 round trips,
  60s budget sentence kept; `:297-298` → `10 + 10 = 20`; `:520-527` → ten modules,
  plus the sentence that the schedule is now set by
  `POST /v1/admin/course-modules/schedule` and that this exclusion is therefore
  MORE important — two writers of one column, one owner.

**Validation Notes**

- 🔴 **No executable line changes.** A non-comment diff here is stop condition 3.

---

**Batch 1 Verification** (run from the worktree root)

```
npx nx typecheck ptah-license-server
npx nx lint ptah-license-server
```

Both green. The Jest suite is RED at this point — expected, Batch 2 closes it.
`git diff --stat` shows exactly five files, none of them under `__fixtures__/`.

---

## Batch 2: The spec rewrite ✅ COMPLETE

**Commit**: `bf73ba610` — `test(license-server): cover the ten-day curriculum and close the day-10 regex trap`

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer` re-invoked with the reviewer's issue list
**Execution Mode**: sequential
**Rationale**: One file, ~35 edit sites, three of which are judgement calls
(the Day-10 regex trap, the re-founded witness, the forum-half zero-diff
constraint) that a parallel or mechanical pass gets wrong. Same seed-domain
reviewer lens as Batch 1.
**Tasks**: 3 | **Dependencies**: **Batch 1 (strict)**
**Authority**: `implementation-plan.md` §4, §6 Batch B
**File** (all three tasks): `.../apps/ptah-license-server/prisma/seed/community-seed.spec.ts`

---

### Task 2.1: Work the plan's assertion table — including the six §9 misses ✅ COMPLETE

**Spec Reference**: `implementation-plan.md` §4.1 and §4.2
**Satisfies**: Requirement 4.1, Requirement 4.4

- Apply every row of plan §4.1's table.
- 🔴 **Then apply §4.2's six extras**: `1204-1206` (`updated: 8` → `10`, ×2),
  `1208-1209` (`toBe(8)` → `10`, ×2), `1418` comment (17/18 → 19/20), `1525`
  comment ("17 more writes" → 21), `1528` (`toBe(8)` → `10`). Lines `652` and
  `1497` — the `week one` probe strings inside the mojibake fixtures — are **left
  alone**.
- 🔴 `1383` has **two** occurrences of `week-1` in one template literal
  (`'week-1'` and `#week-1`) → `'day-01'` / `#day-01`.
- ADD: `day-01`…`day-10` each match `/^[a-z0-9]+(-[a-z0-9]+)*$/` (FR-SLUG-1 says
  *verify, do not assume*); the ten export slugs match it and are unique across
  all 19; the FR-TITLE-2 negative case (mutate one curriculum title via
  `fixtureFromExport`, expect `CourseMappingError`, `db.writes()` empty, zero
  `open` calls — the shape of `:1425-1459`); the FR-TITLE-1 positive pinned
  against **hand-written literals** for Day 1 and Day 10.

**Validation Notes**

- 🔴 R5: `task-description.md` §9's table is **INCOMPLETE**. Working it to
  completion and stopping leaves a red suite. Use the plan's list.
- 🔴 `curriculumTopicTitle` is exported, but the spec must NOT use it as its only
  oracle — a spec that calls the same function cannot detect a wrong prefix.
- 🔴 Lines `446-463` and `500` — the forum half — must show **zero diff**
  (stop condition 1).
- No assertion may be weakened to a tautology to make the suite pass.

---

### Task 2.2: Close the Day-10 regex trap (R1) ✅ COMPLETE

**Spec Reference**: `implementation-plan.md` §4.3
**Dependencies**: Task 2.1
**Satisfies**: FR-SLUG-3, Requirement 4.1

- `:1030` → `/^Day \d{1,2} build thread — /`. `:1065` → `/^day-(0[1-9]|10)$/`.
  `:988` and `:1036` → `/^day-\d/`.
- ADD the tripwire test of §4.3 verbatim in intent: Day 10's title matches
  `\d{1,2}` **and `not.toMatch(/^Day \d build thread — /)`**, its slug is
  `day-10`, and the `startsWith` pair asserting the unpadded prefix trap.

**Validation Notes**

- 🔴 **This is R1, rated the single most likely way this change ships broken.**
  The naive rename passes eight of ten titles, so the failure reads as a data
  defect rather than a quantifier defect.
- The rule: any regex against a **TITLE** takes `\d{1,2}` (titles are unpadded);
  any regex against a **SLUG** takes the explicit alternation (slugs are padded).

---

### Task 2.3: Re-found the anti-vacuity witness ✅ COMPLETE

**Spec Reference**: `implementation-plan.md` §4.4, `task-description.md` §7
**Dependencies**: Task 2.1
**Satisfies**: Requirement 4.3

- `:1099-1113` currently witnesses on the `Hardening` divergence, which
  FR-TITLE-1 **removes by design**. Replace it with §4.4's test: `modules.map(m =>
  m.title)` equals `[...MODULE_TITLES]`, ten modules, and for each — `m.lesson.title
  !== m.title`, `m.lesson.title === \`Day ${i+1} build thread — ${m.title}\``,
  and `m.title` does NOT match `/^Day \d{1,2} build thread/`.

**Validation Notes**

- 🔴 R4: **RE-FOUND, NEVER DELETE.** Deleting it to make the suite green quietly
  loses the guard.
- 🔴 The test docblock must state **honestly that the property is now WEAKER** —
  after FR-TITLE-1 a derivation would produce the right answer, so the surviving
  property is only "the module title is not a COPY of the source title" — and
  that FR-TITLE-2 is the compensating control (two independently authored halves
  whose agreement is now a build failure). Without that sentence the next
  reviewer reads the weakening as a regression.

---

**Batch 2 Verification** (run from the worktree root)

```
npx nx test ptah-license-server --skip-nx-cache
npx nx typecheck ptah-license-server
npx nx lint ptah-license-server
git diff --stat -- apps/ptah-license-server/prisma/seed/__fixtures__
```

- Suite green. The fixture diff must be **empty** (FR-TEST-1) — if not, STOP AND
  REPORT.
- `git diff` on `community-seed.spec.ts:446-463` and `:500` shows **zero diff**.

**Then, against a local database — the FR-IDEM-1 exit gate (Requirement 3.1, 4.5):**

```
npm run docker:db:start
npx nx run ptah-license-server:prisma:reset
npx nx run ptah-license-server:seed-community      # run 1
npx nx run ptah-license-server:seed-community      # run 2
```

- Run 1: exit 0, **1 course / 10 modules / 10 lessons created, 0 updated**, and
  the summary's two computed assertion lines (`community-seed.ts:305-321`) both
  read `OK`.
- Run 2: exit 0 and **0 creates** across courses, modules and lessons.

---

## Batch 3: C4 — reusable cohort scheduling ✅ COMPLETE

**Recommended Executor**: `backend-developer` (sub-agent)
**Fallback Executor**: `backend-developer` re-invoked with the reviewer's issue list
**Execution Mode**: sequential
**Rationale**: Server work — NestJS controller/service/DTO/contract/audit plus
three build-gating censuses — a different skill surface and a different review
lens from the seed batches. It shares **no file** with Batches 1 or 2, so it is
independent of Batch 2 and could start once Task 1.4 lands (Task 3.8's runbook
reads Task 1.4's offset table). Sequential because Task 3.0 is a hard gate and
Tasks 3.4–3.6 build on 3.1–3.3.
**Tasks**: 9 | **Dependencies**: **Task 1.4** (for Task 3.8's table only). Independent of Batch 2.
**Authority**: `implementation-plan.md` §5, §6 Batch C

---

### Task 3.0: 🔴 GATE — verify `temporal-polyfill` bundles ✅ COMPLETE

**Files**: none created
**Spec Reference**: `implementation-plan.md` §5.4, R9
**Dependencies**: None

Add a throwaway import of `temporal-polyfill` (declared at `package.json:187`,
imported nowhere in the workspace — this task is its first consumer), then:

```
npx nx build ptah-license-server
```

**Validation Notes**

- 🔴 **No other Batch 3 file is written until this passes.** If the polyfill does
  not bundle, or its v1 surface differs from §5.4's sketch, **STOP AND REPORT** —
  the fallback is a hand-rolled `Intl.DateTimeFormat` two-pass offset resolver in
  the same pure helper with the **same signature**, which is why the swap is
  local to one file.
- It is pure JS and is not in the license server's esbuild `external` list, so it
  bundles and needs no deploy change — verify, do not assume.

---

### Task 3.1: The pure weekday-schedule helper ✅ COMPLETE

**File**: `.../libs/api/learning/src/lib/common/weekday-schedule.ts` (CREATE)
**Spec Reference**: `implementation-plan.md` §5.4 (plan item C1)
**Dependencies**: Task 3.0
**Satisfies**: C4 requirement, FR-DATE-2

- `WeekdayScheduleInput`, `WeekdaySlot`, `ScheduleInputError`,
  `computeWeekdaySchedule(input): readonly WeekdaySlot[]` — signatures per §5.4.
- Mirrors `common/sort-order.ts` exactly: pure arithmetic, no database, no clock,
  no `process.env`.
- Algorithm: `Temporal.PlainDate` from `startDate`; `dayOfWeek >= 6` throws;
  walk forward one **calendar** day, emit when `dayOfWeek <= 5`, until `count`
  slots; instant via
  `plainDate.toPlainDateTime(plainTime).toZonedDateTime(timeZone).toInstant()`.

**Validation Notes**

- 🔴 A **weekend start date is an error, not a roll-forward to Monday.** Silently
  changing the date the admin typed just moves who made the mistake.
- 🔴 **The offsets are NOT a constant** — they depend on the start weekday
  (Finding 0). Record this in the docblock.
- 🔴 Weekday arithmetic on the **LOCAL CALENDAR**, then convert. A `+24h` UTC walk
  drifts across a DST transition and near midnight drifts a whole calendar DAY.
  Cohort 1 (September) would not show it; cohort 2 in late October would — and C4
  exists so cohorts 2 and 3 need no code change.
- 🔴 `count` comes from the database, **never a literal**. Never assume ten.
- Record in the docblock that this is the workspace's first `temporal-polyfill`
  consumer, and that DST ambiguity resolves via `Temporal`'s `'compatible'`
  default.

---

### Task 3.2: The helper's unit spec ✅ COMPLETE

**File**: `.../libs/api/learning/src/lib/common/weekday-schedule.spec.ts` (CREATE)
**Spec Reference**: `implementation-plan.md` §5.10 (plan item C2)
**Dependencies**: Task 3.1

All of §5.10's pure cases: Monday start ×10 → `+0…+4, +7…+11`; 🔴 **Tuesday 1
September 2026 ×10 → the ten dates of §5.7 including Day 10 on Mon 14 Sep** (the
founder's actual cohort, asserted); `count` of 1 / 3 / 12 (never assumes ten —
C4's reusability clause made a test); Saturday and Sunday starts →
`ScheduleInputError`; `'Mars/Olympus'` → `ScheduleInputError`; a **DST-crossing
cohort** (late-October `Europe/Berlin` at `09:00`, every instant still 09:00
local, UTC offsets differing across the transition — the case a `+24h`
implementation fails and nothing else catches); `UTC` → instants equal the naive
concatenation.

---

### Task 3.3: Contracts, barrel export and the audit action ✅ COMPLETE

**Files** (plan items C3, C4, C5):
- `.../libs/api-contracts/community/src/lib/admin/admin-course.contract.ts` (MODIFY)
- `.../libs/api-contracts/community/src/index.ts` (MODIFY)
- `.../libs/api/audit/src/lib/audit-log.types.ts` (MODIFY)

**Spec Reference**: `implementation-plan.md` §5.8
**Dependencies**: Task 3.1

- `AdminModuleScheduleEntry` and `AdminModuleSchedule` per §5.8, beside
  `AdminCourseModule` (`:111-134`), both exported from the barrel.
- 🔴 **ONE type for both routes**, distinguished by `applied` (R10). A preview
  returning a different shape from the apply is not a rehearsal.
- `| 'learning.module.schedule'` after `'learning.module.reorder'`
  (`audit-log.types.ts:98`), with a comment in that block's established voice:
  one row per schedule not per module; `targetId` undefined; metadata carries the
  inputs plus `{ slug, from, to }` per changed module. **No audit row on preview.**

---

### Task 3.4: DTOs and the `CourseScheduleService` ✅ COMPLETE

**Files** (plan items C6, C7):
- `.../libs/api/learning/src/lib/courses/dto/schedule-modules.dto.ts` (CREATE)
- `.../libs/api/learning/src/lib/courses/course-schedule.service.ts` (CREATE)

**Spec Reference**: `implementation-plan.md` §5.3, §5.5, §5.6
**Dependencies**: Task 3.3

- `PreviewModuleScheduleDto` (`courseId`, `startDate`, `timeOfDay`, `timeZone`)
  and `ApplyModuleScheduleDto extends` it with the two REQUIRED echo fields
  `confirmModuleCount` and `confirmLastReleaseDate` — validators per §5.3.
- New `@Injectable()`, **not** a method on `CoursesService` (~1100 lines).
  Precedent: `ReorderService`. **One method, one return type, `apply` as a flag.**
- Transaction order per §5.6: course `findFirst` + `NOT_DELETED` → 404; module
  `findMany` with **`DETERMINISTIC_ORDER_BY`, never `slug`**; empty → 400;
  `computeWeekdaySchedule({ ...input, count: modules.length })`; if `apply`,
  compare both confirm fields **inside the transaction against the same snapshot
  the writes see** (`reorder.service.ts:49-54`, D-6.6a) → `BadRequestException`
  naming expected and received, before any write; update **only entries where
  `changed`**; then exactly one `audit?.(tx, null)`.

**Validation Notes**

- 🔴 `@Matches(/^\d{4}-\d{2}-\d{2}$/)`, **not `@IsISO8601()`** — the latter accepts
  a datetime whose time-of-day would be silently overridden by `timeOfDay`.
- 🔴 **Extension, not one class with optional confirms** (`reorder.dto.ts:13-19`) —
  `forbidNonWhitelisted` would otherwise ACCEPT a field the endpoint ignores.
- 🔴 **No nullable-optional field** in either DTO. `EXPECTED_NULLABLE_OPTIONALS`
  (`nullable-dto.spec.ts:73`) stays at thirteen. "Unschedule" is `PATCH :id` with
  `releaseAt: null`, which already exists.
- 🔴 **Total re-schedule, never a merge.** Skipping already-dated modules leaves a
  course on two schedules — silent, partial, member-visible. Overwrite, but show
  `currentReleaseAt` + `changed` + `changedCount` first, write only changed rows,
  and record `{ slug, from, to }` in the audit metadata so a wrong re-schedule is
  recoverable.
- 🔴 **Never return `error.message` verbatim to a client.** Catch
  `ScheduleInputError` and re-throw `BadRequestException` with a written sentence
  (`'Unknown time zone. Use an IANA identifier such as "Europe/Berlin".'`,
  `'The cohort start date falls on a weekend. Supply the first weekday of the
  cohort.'`); log the original.
- `ModuleLockService`, the seed's `releaseAt` exclusion, and
  `PATCH /v1/admin/course-modules/:id` are **untouched**.

---

### Task 3.5: The two routes on `AdminCourseModulesController` ✅ COMPLETE

**File**: `.../libs/api/learning/src/lib/courses/admin-course-modules.controller.ts` (MODIFY)
**Spec Reference**: `implementation-plan.md` §5.2 (plan item C9)
**Dependencies**: Task 3.4

```
POST v1/admin/course-modules/schedule/preview   → 200, computes, writes nothing, audits nothing
POST v1/admin/course-modules/schedule           → 200, computes, applies, one audit row
```

Both `@HttpCode(200)`, both `@UseGuards(AdminThrottlerGuard)` + `@Throttle(ADMIN_WRITES)`,
both `@Body(dtoPipe(...))`. Class-level `@UseGuards(JwtAuthGuard, AdminGuard)` already
covers them. Declare `…/schedule/preview` **before** `…/schedule` (RI-3, mirroring the
`route-map.spec.ts:333-335` precedent).

**Validation Notes**

- 🔴 **Both params are whole-object `@Body(dtoPipe(TheDto))`.** A single
  `@Query('courseId')` would make `MIN_TOTAL_PAYLOAD_PARAMS` read 80 against a
  `NAMED_PRIMITIVE_PARAM_COUNT` of 7 and the Task 3.6 arithmetic would not close.
- POST for the preview, not GET: the rehearsal must accept the **same** input
  shape as the apply, and a GET forces a second query-shaped DTO that would drift.
- Controller prefix unchanged ⇒ `PREFIX_EXCEPTIONS`, `KNOWN_PREFIX_DEBT` and
  `KNOWN_CONTESTED` all stay at their floor. No new controller file.

---

### Task 3.6: 🔴 Move the censuses that gate the build ✅ COMPLETE

**Files** (plan items C11–C14):
- `.../libs/api/learning/src/lib/learning.module.ts` (MODIFY)
- `.../libs/api/learning/src/lib/learning.module.spec.ts` (MODIFY)
- `.../apps/ptah-license-server/src/common/route-map.spec.ts` (MODIFY)
- `.../apps/ptah-license-server/src/common/controller-validation.spec.ts` (MODIFY)

**Spec Reference**: `implementation-plan.md` §5.8, §5.9 (R8)
**Dependencies**: Task 3.5

- `learning.module.ts`: add `CourseScheduleService` to `providers`. **NOT to
  `exports`, NOT to the barrel** — `learning.module.spec.ts:148` asserts the
  barrel exports no write or authoring service by any name. Docblock `:31`
  "Seven services" → eight.
- `learning.module.spec.ts:282-297`: "declares the seven services" → eight, and
  the exact `toEqual` provider list gains `CourseScheduleService`. `:298-329`
  (five controllers, five disjoint prefixes) **unchanged**.
- `route-map.spec.ts`: `EXPECTED_ROUTES` **+2**, inserted in the P3 curriculum
  block in sorted position; re-derive the prose running total at `:242-255` with
  its decomposition (the `:229-238` docblock records what happened last time a
  prose total was not re-derived).
- `controller-validation.spec.ts`: `MIN_TOTAL_PAYLOAD_PARAMS` **78 → 80** using
  the documented procedure at `:217-222` — set 9999, run
  `npx nx test ptah-license-server --skip-nx-cache --testPathPatterns=controller-validation`,
  read the actual from `Received:`, restore, write the `+2` decomposition into the
  docblock. `NAMED_PRIMITIVE_PARAM_COUNT` **unchanged at 6**;
  `ALL_CONTROLLERS`/`UNVALIDATED_DEBT`/`EXCLUDED` unchanged.
- `nullable-dto.spec.ts` `EXPECTED_NULLABLE_OPTIONALS` unchanged at thirteen;
  `admin-guards.spec.ts` G1/G3 unchanged.

**Validation Notes**

- 🔴 R8, HIGH: `controller-validation.spec.ts` and `route-map.spec.ts` **fail the
  build on drift** and must move in the SAME batch that adds the routes. A batch
  that adds routes without these edits does not compile green.

---

### Task 3.7: Service and controller specs ✅ COMPLETE

**Files** (plan items C8, C10):
- `.../libs/api/learning/src/lib/courses/course-schedule.service.spec.ts` (CREATE)
- `.../libs/api/learning/src/lib/courses/admin-course-modules.controller.spec.ts` (MODIFY)

**Spec Reference**: `implementation-plan.md` §5.10
**Dependencies**: Task 3.6

Service, against `mock-learning-prisma.ts` — all of §5.10: preview issues **zero**
`courseModule.update` and **zero** audit writes; apply issues one update per
**changed** module and exactly **one** audit row with `targetId` null; a second
identical apply → `changedCount: 0` and zero updates; a wrong
`confirmLastReleaseDate` (by one day) and a wrong `confirmModuleCount` each →
`BadRequestException` with zero updates and zero audit rows; a manual `releaseAt`
→ `changed: true`, `currentReleaseAt` populated, overwritten, `from` in the audit
metadata; a soft-deleted module excluded; soft-deleted/missing course → 404; zero
live modules → 400 with nothing written; `findMany` recorded args assert
`DETERMINISTIC_ORDER_BY`, **not** slug.

Controller — both handlers bind `dtoPipe` with the right `expectedType`; the apply
handler passes an audit hook with action `'learning.module.schedule'` and the
preview passes **none**; declaration order + the RI-3 comment extended; 🔴 the two
DTO-distinctness cases: apply payload → `/preview` is a **400** (two
non-whitelisted keys) and preview payload → `/schedule` is a **400** (two missing
required keys). Those two are what prove the classes are distinct on the wire.

---

### Task 3.8: The operator runbook ✅ COMPLETE

**File**: `.../docs/community/curriculum-reseed-runbook.md` (CREATE)
**Spec Reference**: `implementation-plan.md` §5.11 (plan item C15)
**Dependencies**: Task 1.4 (the §5.7 offset table), Task 3.5 (the two routes)
**Satisfies**: FR-IDEM-2, FR-DATE-2, Requirement 3.5

Six sections per §5.11: (1) which environments hold the 8-week course — **NONE**
(C1), with the `ci.yml:89` / `nightly-coverage.yml:62` / unchecked
`founder-setup-checklist.md` §2.4 evidence, and no cleanup performed by this task;
(2) the overlay stated as fact anyway, because it is correct and will be needed
the first time anyone re-seeds a persistent database — 18 modules, `sortOrder`
100–800 colliding with 100–1000, no crash, no error; (3) cleanup if it ever
applies (non-prod `prisma:reset` + re-seed; prod/staging soft-delete via
`DELETE /api/v1/admin/course-modules/:id`); (4) the seed gains no delete verb,
ever; (5) setting the cohort schedule — the two `curl` calls, preview then apply,
with the founder's cohort-1 values and the §5.7 table as the expected preview
output, stating that `timeOfDay`/`timeZone` are per-cohort operator inputs and
that **C5's default is OPEN** — nobody ships the first cohort pre-gated;
(6) cohorts 2 and 3 as a procedure with no code change (C4's acceptance criterion).

**Validation Notes**

- ⚠️ **Marketplace rule** (CLAUDE.md): this file must contain none of `copilot`,
  `codex`, `claude`, `openai`, `anthropic`. It has no reason to.

---

**Batch 3 Verification** (run from the worktree root)

```
npx nx build ptah-license-server
npx nx test ptah-license-server --skip-nx-cache
npx nx test api-learning --skip-nx-cache
npx nx test api-core --skip-nx-cache
npx nx typecheck ptah-license-server
npx nx lint ptah-license-server
```

All green. Then the whole-task regression against a local database — the seed and
the scheduler are two writers of one column and only one owns it:

```
npx nx run ptah-license-server:prisma:reset
npx nx run ptah-license-server:seed-community      # run 1 — 1/10/10 created, 0 updated
npx nx run ptah-license-server:seed-community      # run 2 — 0 creates
```

Second run must report **0 creates** and both computed summary assertion lines
must read `OK`. Every module still carries `releaseAt = null` after both runs
(C5 — open by default).

---

## Sequencing

```
Batch 1 (content + mapping + census)  ──►  Batch 2 (spec)
                                      └──►  Batch 3 (C4 scheduling)
```

Batch 1 → Batch 2 is **strict**. Batch 3 shares no file with either and depends on
Batch 1 only for Task 3.8's offset table; the orchestrator may run it after
Batch 2 or after Batch 1's commit, but not in parallel with either — CLI
delegation is disabled and each batch takes a single `backend-developer`.

---

## Definition of Done — all three batches

- [x] Founder approved the module table (C2; it REPLACES `task-description.md` §4)
- [ ] `discourse-export.json`: 19 topics / 21 posts / 20 non-empty bodies, 10 curriculum
- [ ] `CURRICULUM_TOPIC_IDS` and `MODULE_TITLES` both hold 10, in order
- [ ] Module and lesson slugs are `day-01`…`day-10`
- [ ] `COURSE_DESCRIPTION` contains neither `eight-week` nor `one module per week`
- [ ] The title-consistency guard is in `buildCourseRows` and fails on a deliberate mismatch
- [ ] The Day-10 regex tripwire exists and asserts the naive `\d` form FAILS
- [ ] The anti-vacuity witness is RE-FOUNDED, with the honest "now weaker, and why" note
- [ ] `community-seed.spec.ts` green; forum-half assertions show **zero diff**; no committed fixture edited
- [ ] `seed-community` exits 0 twice in a row, second run **0 creates**
- [ ] Docblocks in `map-course.ts` and `community-seed.ts` no longer describe an eight-week course
- [ ] The start-weekday-dependent offset rule and the cleanup runbook are written down
- [ ] **C4:** two routes, both `dtoPipe`-bound, both in `EXPECTED_ROUTES`; preview writes and audits nothing; apply refuses a wrong `confirmLastReleaseDate` or `confirmModuleCount` with zero writes; a second identical apply reports `changedCount: 0`; the Tuesday-1-Sep-2026 schedule asserted in a unit test; `ModuleLockService`, the seed's `releaseAt` exclusion and `PATCH :id` all unchanged

---

## Deliberately NOT touched

`map-categories.ts`; `prisma/seed/__fixtures__/*`; `prisma/schema.prisma` (no
migration — ten modules and a `DateTime` column are shapes the schema already
expresses); `module-lock.service.ts`; `libs/web/*` (no admin course UI exists —
a recorded follow-up, not a gap); `apps/ptah-video-studio/promos/*` ("six to eight
weeks", R7 — its own task); anything from TASK_2026_201.
