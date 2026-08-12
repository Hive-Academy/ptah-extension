# Batch 11 report — P3-MIG: seed the curriculum course (8 Week topics)

**Executor**: `backend-developer`
**Date**: 2026-08-05
**Branch**: `ak/license-server-validation-pipe` (never switched, never created, never rebased)
**HEAD at start and at end**: `aa38f5f42` — it did not move during this batch.
**Tasks**: 11.1 – 11.7. **Six complete. Task 11.6 deliberately re-assigned to Batch 10** — see
[the ownership decision](#task-116--the-member-preset-round-trip--owned-by-batch-10-option-a).
**Nothing was staged or committed.** No `git add`, `commit`, `rm`, `stash`, `reset`,
`checkout <path>` or `restore`. `--no-verify` was never used. **No `prisma migrate`, `db push`
or `migrate reset` was run**, and no `deletedBy` column was added (9B's F-1 stays open for
migration 4).

---

## Verdict, in one paragraph

`seed-community` now writes **1 course, 8 modules and 8 lessons** on top of Batch 8's unchanged
4 categories / 9 topics / 10 posts, and a second and third run report **zero creates on all six
entity lines**. Every lesson body is byte-identical to its source `raw` (SHA-256 + byte length,
database against file, `diff` empty), the new byte check is **provably sensitive** (a `.trim()`
on the lesson mapper turns it red), and the course is invisible to the entitled admin dev
account — `404`, never `403` — until a cohort assignment exists, after which it is `200`; the
assignment was removed by id and `member_group_assignments` is back to `0`. Two things did not
go to plan and both are recorded below: **`api-learning:eslint:lint` fails at HEAD for a reason
that has nothing to do with this batch** ([F-1](#f-1)), and **Task 11.6's file lands inside
`libs/web/members`, which Batch 10 is writing to right now**, so it was handed to Batch 10 as
`tasks.md` itself recommends — with the round-trip nonetheless **executed out-of-tree against
the real `'member'` sanitizer and proven green** ([§11.6](#task-116--the-member-preset-round-trip--owned-by-batch-10-option-a)).

---

## Exit gate — every item, with its evidence

| #   | Gate item                                                                                                                     | Result                    | Evidence                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `seed-community` creates 1 course, 8 modules, 8 lessons on top of unchanged 4/9/10                                            | ✅                        | [Run 1](#run-1--first-execution)                                                                                                                                              |
| 2   | A second run produces **zero creates on all six lines**                                                                       | ✅                        | [Run 2](#run-2--idempotency) · [Run 3](#run-3--still-zero-creates)                                                                                                            |
| 3   | Every `bodyMarkdown` byte-identical to source `raw`, SHA-256 + byte length, DB vs file                                        | ✅                        | [Byte fidelity](#byte-fidelity--sha-256-per-lesson-database-vs-file) — `diff` empty                                                                                           |
| 4   | The summary matches §7.5's shape, with both assertion lines closing                                                           | ✅                        | [Task 11.4](#task-114--the-summary-and-the-arithmetic-)                                                                                                                       |
| 5   | `slug=ptah-builders-cohort-1`, `visibility='cohort'`, `cohortKeys` resolved from the DB, `published=true`, `sequential=false` | ✅                        | [Live course row](#the-course-row-live)                                                                                                                                       |
| 6   | The cohort key **aborts loudly** if no default `MemberGroup` exists                                                           | ✅                        | Spec: zero recorded calls, no course/module/lesson call at all                                                                                                                |
| 7   | `youtubeVideoId` null on all 8 ⇒ manual completion only                                                                       | ✅                        | [ASSUMPTION-8, confirmed against the running rule](#assumption-8--confirmed-against-the-code-that-actually-decides)                                                           |
| 8   | AD-8 quarantine still holds, **including this batch's new files**                                                             | ✅                        | 12 files scanned, 0 occurrences; proven by deliberate failure                                                                                                                 |
| 9   | The new byte check is **SENSITIVE**, proven by a deliberate transform                                                         | ✅                        | [Proof 1](#proof-1--trim-on-the-lesson-mapper--the-sensitive-case-goes-red)                                                                                                   |
| 10  | Live: course + 8 modules + 8 lessons exist, community seed untouched, dev entitlement intact                                  | ✅                        | [Final row counts](#final-row-counts--and-whose-data-is-whose)                                                                                                                |
| 11  | Task 8.7 assertion 8 CLOSED (Task 11.6)                                                                                       | ⚠️ **Proven, not landed** | Round-trip executed and green against the real preset; **the spec file is Batch 10's to land** — [§11.6](#task-116--the-member-preset-round-trip--owned-by-batch-10-option-a) |

### Batch gate

```
$ npx nx run-many -t eslint:lint,typecheck,test -p ptah-license-server --skip-nx-cache
-> Successfully ran targets eslint:lint, typecheck, test for project ptah-license-server
   Test Suites: 5 passed, 5 total
   Tests:       151 passed, 151 total          (124 after Batch 9C -> +27 from this batch)
   typecheck    clean
   eslint       0 errors, 2 warnings — BOTH pre-existing and foreign:
                  apps/ptah-license-server/jest.config.ts:1   unused eslint-disable
                  apps/ptah-license-server/src/instrument.ts:1 unused eslint-disable
                (Batches 6 and 8 recorded the same two.)

$ npx nx run-many -t eslint:lint,typecheck,test -p ptah-license-server,api-learning --skip-nx-cache
   api-learning   test       21 suites / 492 tests   PASS
   api-learning   typecheck  PASS
   api-learning   eslint     ✖ 12 errors            FAIL  <- FOREIGN AND PRE-EXISTING, see F-1
```

```
$ npx nx test ptah-license-server --skip-nx-cache --testPathPatterns=community-seed
Test Suites: 1 passed, 1 total
Tests:       65 passed, 65 total          (Batch 8 left it at 38)

$ npx tsc --noEmit --project apps/ptah-license-server/prisma/seed/tsconfig.json
TSC OK
```

---

## Task 11.1 — Pre-flight ✅

All four checks, pasted verbatim.

```
$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc
  "select table_name from information_schema.tables
    where table_name in ('courses','course_modules','course_lessons','lesson_progress','lesson_comments') order by 1;"
course_lessons
course_modules
courses
lesson_comments
lesson_progress

$ ... "select 'courses',count(*) from courses union all ... ;"
courses|0   modules|0   lessons|0   progress|0   comments|0

$ ... "select key, name, is_default from member_groups;"
founding|Founding Members|t
$ ... "select count(*) from member_group_assignments;"
0

$ ... "select 'categories',count(*) from community_categories union all ...;"
categories|4   topics|9   posts|10

$ git log --oneline -1 -- docs/community/discourse-export.json
a22b03eb6 fix: capture real markdown in the Discourse export

$ node -e "const d=require('./docs/community/discourse-export.json'); ..."
categories 4 topics 17 posts 19
```

**Every expected value matched**, including the corrected commit `a22b03eb6` (**not**
`6614f9e92`, the defective snapshot whose 19 `raw` fields were null — Batch 8's Finding 1,
which `tasks.md` has since had corrected in the Batch 11 section).

**All five course tables were at 0 rows at the moment this batch started.** Batch 10 had not yet
seeded its probe course; it did so at `09:31:38`, **eight minutes before** this seed's first
write at `09:41:10`. Its rows were left completely alone — see
[Final row counts](#final-row-counts--and-whose-data-is-whose).

`member_group_assignments` was `0` at pre-flight, was raised to `1` for exactly the two `curl`s
Task 11.7 prescribes, and is `0` again. Nothing was seeded into it to make anything pass.

Also captured: `users = 3`, `licenses.DEV-BUILDERS-VALIDATION-0001 = active/builders`.

---

## Task 11.2 — `map-course.ts` ✅

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\map-course.ts` (NEW, 297 lines)

Pure — no Prisma, no `process.env`, no clock read. That is what lets Task 11.5 assert the whole
mapping, byte fidelity included, without a database.

### The decisions, and why

| Decision                                                    | Reasoning                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`MODULE_TITLES` carries no topic ids**                    | It is zipped in order with `CURRICULUM_TOPIC_IDS` imported from `map-topics.ts`. A second copy of the ids in this file is how the two halves drift until a topic lands in both or in neither. A length mismatch aborts.                                                                                           |
| **Module titles are a literal table, not derived**          | §7.3 requires it, and a derivation would be **wrong today**, not merely fragile — see [F-5](#f-5).                                                                                                                                                                                                                |
| **Slugs are the `week-1` … `week-8` literals from §7.3**    | `buildSlug()` is create-path-only and its collision resolver takes the set of taken slugs, so run 2 would resolve `week-1-2` and create a duplicate module. Batch 8's Finding 5 applies verbatim.                                                                                                                 |
| **`sortOrder` sparse: 100, 200 … 800; lessons at 100**      | R8.8 / Task 9.8's `SORT_ORDER_STEP`. One later insert must not force a full renumber.                                                                                                                                                                                                                             |
| **`sequential: false`**                                     | The source has no completion gate; MG-1.5 asks to preserve ordering, not to invent gating. Stated in the docblock.                                                                                                                                                                                                |
| **One module per week**                                     | R2.4.1's date-based unlock operates on **modules**, so per-week modules make weekly release expressible later without a restructure. §7.3's sentence is carried into the docblock.                                                                                                                                |
| **`youtubeVideoId: null` AND `videoDurationSeconds: null`** | R2.3.4 + ASSUMPTION-8. See [below](#assumption-8--confirmed-against-the-code-that-actually-decides).                                                                                                                                                                                                              |
| **`createdBy: null`**                                       | A-4. Consequence recorded in the docblock: **Task 9.14's `setAnswered` "admin OR lesson author" therefore resolves to admin-only for every seeded lesson**, because it keys on `Course.createdBy`. Correct, not a defect.                                                                                         |
| **An empty curriculum post #1 ABORTS, it does not skip**    | The community half skips one empty small-action reply because the thread still reads without it. A lesson body is the entire lesson; there is nothing to skip to and a blank lesson is a member-visible defect. `SKIP_EMPTY_BODY_POSTS` deliberately does not reach this file. Asserted, twice — see [F-8](#f-8). |
| **`Course.description` supplied**                           | Required column, unspecified by §7.3 — see [F-4](#f-4).                                                                                                                                                                                                                                                           |

### Timestamps — stated per model, because a reviewer will check

| Model          | `createdAt`                                            | Why                                                                                                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Course`       | **`@default(now())`** — not written                    | §7.3 specifies source timestamps for topics and posts (MG-1.7) and says nothing about the course. The course is a **new editorial object** assembled in 2026-08 from eight threads written across three weeks; stamping it with one of their instants would be a fabricated claim about when the curriculum was authored. |
| `CourseModule` | **`@default(now())`** — not written                    | Same reasoning, one level down: a module's identity is its MG-1.5 title, which no source topic supplies.                                                                                                                                                                                                                  |
| `Lesson`       | **the source topic's `createdAt`, written explicitly** | A lesson **is** a source body, so its date is a true fact about it. MG-1.7's principle, applied.                                                                                                                                                                                                                          |

Live confirmation of all three:

```
courses      ptah-builders-cohort-1   created_at 2026-08-05 09:41:10.061   <- now()
modules      week-1 … week-8          created_at 2026-08-05 09:41:10.07…   <- now()
lessons      week-1                   created_at 2026-08-01 20:49:24.242   <- source topic 15
             week-8                   created_at 2026-08-01 20:49:38.644   <- source topic 22
$ ... "select count(*) from course_lessons … where created_at::date = current_date;"  -> 0
```

⚠️ **One sub-decision worth naming**: the lesson carries its **topic's** `createdAt`, not its
**post #1's**. The two differ by ~0.4 s in every case (topic `20:49:24.242` vs post
`20:49:24.648`). Task 11.2 says "carry its source topic's", so that is what was written; the
post instant is the defensible alternative and the difference is sub-second.

### ASSUMPTION-8 — confirmed against the code that actually decides

The plan says `youtubeVideoId: null ⇒ manual completion only`. **The id is not what decides.**
`libs/api/learning/src/lib/progress/completion.ts:152`:

```ts
export function isAutoComplete(furthestPositionSeconds: number, videoDurationSeconds: number | null): boolean {
  if (!hasUsableDuration(videoDurationSeconds)) return false;
  ...
}
```

`false` for an unusable duration, always — "there is no position, however large, that
auto-completes it." So the seed writes **both** columns null, and the manual-only state was
confirmed as the _running code_ evaluates it, not merely as the plan describes it:

```
$ ... "select l.youtube_video_id is null, l.video_duration_seconds is null from course_lessons l …"
   -> t | t   on all 8

$ curl -s -b "ptah_auth=$TOKEN" .../members/courses/ptah-builders-cohort-1/lessons/week-1
   slug week-1 | youtubeVideoId null | videoDurationSeconds null | bodyMarkdown bytes 327
```

That makes the no-video lesson layout the **default** case in this workspace, not an edge case —
worth knowing for Batch 10.

---

## Task 11.3 — Wiring, natural keys, the abort ✅

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.ts` (MODIFIED)

- `SeedTransactionClient` (a **structural** type) gained `course`, `courseModule` and `lesson`
  delegates, so the recording double in the spec picks them up from the same interface — no
  second stand-in, and the existing "wrote nothing" abort proofs now cover the new writes too.
- **One `$transaction` for the whole import**, forum rows first, curriculum last, **no
  interleaving** — asserted on the recorded call sequence.
- The cohort key is resolved by the **existing** `resolveCohortKey` — one resolver used twice,
  not a second lookup that could disagree.
- **No new CLI flag.** `parseArgs` still accepts `--refresh-bodies` and nothing else.

### The natural keys, and why they are stable

| Model          | Key                          | Why it is stable                                                                                                                                                                                                          |
| -------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Course`       | `slug` (`@unique`)           | `ptah-builders-cohort-1` is a **literal in `map-course.ts`**, not derived from anything the export can change, and it is the public URL segment — changing it is a deliberate, visible act.                               |
| `CourseModule` | `@@unique([courseId, slug])` | `week-N` is derived from the **position** in `CURRICULUM_TOPIC_IDS`, which `map-topics.ts` already asserts to be exactly 8 ids covering the 17 source topics. It survives a topic being retitled, re-slugged or re-dated. |
| `Lesson`       | `@@unique([moduleId, slug])` | The lesson slug **equals** its module slug (§7.3), so it inherits the same stability and cannot drift from its parent.                                                                                                    |

No synthetic `sourceRef` column exists — RK-1 rejected one and the schema has none.
**`findUnique` + explicit `create`/`update`, never `upsert`** (Batch 8's Finding 4): `upsert`
cannot report which branch it took, and "zero creates on the second run" is the exit gate's
central observable. The match keys are **asserted, not claimed**:

```
✓ matches on Course.slug, [courseId, slug] and [moduleId, slug] — asserted, not claimed
    every course       findUnique where-clause has keys exactly ['slug']
    every courseModule findUnique where-clause has keys exactly ['courseId_slug']
    every lesson       findUnique where-clause has keys exactly ['moduleId_slug']
```

### The transaction budget — re-checked and measured, not assumed

Task 11.3 asks for the timeout to be re-checked with a **measured** wall time. Batch 8's import
was ~60 round trips; this batch adds 1 + 8 + 8 natural-key reads and the same number of writes,
~34 more, for ~94 in total. Rather than eyeball it, the ceiling was lowered to **1 second** and
the seed re-run:

```
$ (probe) { maxWait: 10_000, timeout: 1_000 }
$ npx nx run ptah-license-server:seed-community --skip-nx-cache
Community seed complete
  categories:  created 0  updated 4
  ...
  lessons:     created 0  updated 8
EXIT=0                                       <- the WHOLE transaction fits inside 1s
$ diff /tmp/b11bak/community-seed.ts.bak .../community-seed.ts
PROBE REVERTED: community-seed.ts byte-identical
```

**The timeout was therefore left at Batch 8's `60_000`** — already ~60× the measured cost.
Raising it would only delay a real hang. Full target wall time including Nx and `ts-node`
startup: `real 0m7.727s`.

### The update payloads are narrower than the create payloads — three columns beyond §7.4

§7.4 names `bodyMarkdown` as the exclusion. Three more were excluded for the **same class of
harm** — a re-run destroying work done in the product:

| Excluded from `update`                      | What a re-run would otherwise destroy                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Course.createdBy`                          | An admin who has since claimed the course.                                                          |
| `CourseModule.releaseAt`                    | **R2.4.1's weekly-release schedule** — a re-run would silently unschedule eight date-gated modules. |
| `Lesson.youtubeVideoId` + the video columns | An attached recording — and, via ASSUMPTION-8, **every member's completion basis for that lesson**. |

Stated in the writer's docblock. This is a deviation from a literal reading of §7.4 and is
[recorded as F-10](#f-10).

---

## Task 11.4 — The summary and the arithmetic ✅

**Files**: `summary.ts` (MODIFIED), `community-seed.ts` (MODIFIED — the assertions block)

`formatSummary` was **not rewritten**. Three rows were appended to `entities`, and the printer
gained exactly one branch — the lesson variant of the `refreshed:` line.

### Run 1 — first execution

```
$ npx nx run ptah-license-server:seed-community --skip-nx-cache

Community seed complete
  categories:  created 0  updated 4
  topics:      created 0  updated 9
  posts:       created 0  updated 10
  courses:     created 1  updated 0
  modules:     created 8  updated 0
  lessons:     created 8  updated 0
  unmatched usernames: system (19 posts) -> attributed to the system author (A-4); the count is the SOURCE total, now fully accounted for across forum posts and lesson bodies by the assertions below
  bodies: 18/18 imported from `raw`; 0 transformed
  skipped: start-here-how-this-cohort-works post #2 — empty source body (Discourse small-action marker, not content); see SKIP_EMPTY_BODY_POSTS
  assertions: source topics 17 = 8 curriculum + 9 topics OK
  assertions: source posts 19 = 10 written + 1 skipped (empty source body) + 8 curriculum bodies OK

NX  Successfully ran target seed-community for project ptah-license-server
```

The community lines read `created 0 updated 4/9/10` because Batch 8's rows were **already
committed to this database**; this batch adds to them rather than replacing them, exactly as
Task 11.1 required. The **course lines are the creates**: 1 / 8 / 8.

### Run 2 — idempotency

```
$ npx nx run ptah-license-server:seed-community --skip-nx-cache

Community seed complete
  categories:  created 0  updated 4
  topics:      created 0  updated 9
  posts:       created 0  updated 10
  courses:     created 0  updated 1
  modules:     created 0  updated 8
  lessons:     created 0  updated 8
  unmatched usernames: system (19 posts) -> attributed to the system author (A-4); the count is the SOURCE total, now fully accounted for across forum posts and lesson bodies by the assertions below
  bodies: 18/18 imported from `raw`; 0 transformed
  skipped: start-here-how-this-cohort-works post #2 — empty source body (Discourse small-action marker, not content); see SKIP_EMPTY_BODY_POSTS
  assertions: source topics 17 = 8 curriculum + 9 topics OK
  assertions: source posts 19 = 10 written + 1 skipped (empty source body) + 8 curriculum bodies OK
```

**Zero creates on every one of the six lines. Non-zero updates on every one.** Row counts
identical.

### Run 3 — still zero creates

Identical output, with `real 0m7.727s`. Pasted output is the same six lines; not repeated.

### The arithmetic — every number computed, none restated

```ts
`source topics ${EXPECTED_TOPIC_COUNT} = ${CURRICULUM_TOPIC_IDS.length} curriculum + ${IMPORTED_TOPIC_IDS.length} topics …``source posts  ${EXPECTED_POST_COUNT}  = ${importedBodies} written + ${skippedEmptyBodies.length} skipped … + ${curriculumBodies} curriculum bodies …`;
```

`17`, `19`, `8`, `9`, `10` and `1` are all derived from `discourse-export.schema.ts`'s
`EXPECTED_*` constants and the mapped rows. A re-captured export moves the line rather than
making it a lie. **The arithmetic is `19 = 10 + 1 + 8`, not the plan's `11 + 8`** — the export's
11th post is the empty small-action marker Batch 8 skips, and any assertion assuming 11 would be
wrong. Asserted in the spec against the constants, not against literals.

### Batch 8's three §7.5 deviations — preserved, with one wording update

1. The `` 0 from `<rendered-field>` `` clause stays **omitted** — the literal cannot appear in
   this directory (AD-8's quarantine is a source-text assertion over every file here, and
   [Batch 8's Finding 3](#) records that §7.5's own text has this problem). **Not "fixed".**
2. `->` stays instead of `→` (Windows console code page). **Not "fixed".**
3. The `unmatched usernames` trailing clause **was updated**, as Task 11.4 requires. Batch 8's
   wording said the count was a superset of what the run wrote. After this batch it is not:

   | Before                                                                                                         | After                                                                                                                  |
   | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
   | `…the count is the SOURCE total — this batch writes a subset and Batch 11 writes the rest from the same posts` | `…the count is the SOURCE total, now fully accounted for across forum posts and lesson bodies by the assertions below` |

   The substring `unmatched usernames: system (19 posts)` is preserved exactly, and the spec
   asserts both the new phrase's presence and the old phrase's absence.

### One further deviation: the `bodies:` line moved from `10/10` to `18/18`

Not asked for, and argued: `bodies` counts what **this run wrote**, which is now 10 forum post
bodies + 8 lesson bodies = **18**, and 18 is exactly `EXPECTED_NON_EMPTY_BODY_POSTS`. §7.5's
literal `19/19` was never achievable (one source post has no body); `18/18` is the honest form of
the same claim and it now closes against a named constant. Asserted.

---

## Task 11.5 — the spec, and the byte check made SENSITIVE ✅

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.spec.ts` (MODIFIED)

```
Tests: 65 passed, 65 total      (Batch 8 left it at 38 -> +27)
```

The recording double gained `course`, `courseModule` and `lesson` delegates keyed on the
schema's own uniques (`slug`, `${courseId}#${slug}`, `${moduleId}#${slug}`). The **poisoned
`user` `Proxy`** and the derived-fixture discipline are unchanged and now cover 17 more writes.
`map-course.ts` **is imported by this spec**, so `ts-jest` type-checks it (Batch 8's Finding 10:
the `typecheck` target's `include` is `src/**/*.ts` and never sees `prisma/`).

All ten cases Task 11.5 lists are present:

| #   | Case                                                                                                                                                                      | Where                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | Counts 1 / 8 / 8; `CURRICULUM_TOPIC_IDS` now **consumed**, and the `^week-\d` topic guard still passes                                                                    | `curriculum course — counts and the consumed split` |
| 2   | Natural keys asserted exactly                                                                                                                                             | `…natural keys and idempotency`                     |
| 3   | Second run: zero creates on all three new models **and on all six entity lines**                                                                                          | same                                                |
| 4   | `--refresh-bodies` reaches lessons: edit → default run leaves it → flagged run restores it and logs **exactly one** line naming module slug, lesson slug and both lengths | `…--refresh-bodies reaches lessons`                 |
| 5   | Cohort abort writes nothing, and explicitly does **not** fall back to `visibility: 'member'` or an empty `cohortKeys`                                                     | `…the aborts`                                       |
| 6   | **Byte fidelity, made sensitive** — hostile lesson body                                                                                                                   | `…byte fidelity, MADE SENSITIVE`                    |
| 7   | Empty curriculum post #1 **aborts** (two tests — see [F-8](#f-8))                                                                                                         | `…the aborts`                                       |
| 8   | `raw: null` and U+FFFD still abort with zero course/module/lesson calls                                                                                                   | same                                                |
| 9   | No `User` row; `createdBy` null on the course                                                                                                                             | `…A-4 and the summary arithmetic`                   |
| 10  | Quarantine floor **11 → 12**, plus `map-course.ts` asserted in the scanned set **by name**                                                                                | `assertion 7`                                       |

### Deliberate-failure proofs — four mutations, each reverted and diffed

Task 8.7's rule — _"they must be seen to fail against a correct implementation before they are
believed"_ — applied four times (Task 11.5 asks for at least three).

#### Proof 1 — `.trim()` on the lesson mapper → the sensitive case goes red

```
$ sed -i 's/bodyMarkdown: openingPost.raw,/bodyMarkdown: openingPost.raw.trim(),/' map-course.ts
$ npx nx test ptah-license-server --skip-nx-cache --testPathPatterns=community-seed

● community seed — MG-1 › curriculum course — byte fidelity, MADE SENSITIVE (RK-9)
  › preserves a LESSON body that is sensitive to every plausible transform
Tests: 1 failed, 64 passed, 65 total
```

**This is the whole point of the task.** The naïve check — comparing all 8 stored bodies to the
export byte for byte — stays **green** under `.trim()`, because every Week-N body begins with
`**` and ends with `.`; the corpus is invariant under the transform, exactly as Batch 8 found
for posts. The sensitive case uses a derived fixture whose curriculum body is
`'  \r\n\t**bold** &amp; <b>tag</b> — em nbsp\r\n\r\n  '` — hostile to `.trim()`, line-ending
normalisation, entity decoding, tag stripping, re-encoding and paragraph re-wrapping — and
asserts byte equality **on the lesson the writer actually stored**, not only on what the mapper
built.

```
$ cp .bak map-course.ts && diff .bak map-course.ts
REVERT-1 OK: map-course.ts byte-identical
```

#### Proof 2 — drop the explicit `createdAt` from the lesson create

```
● community seed — MG-1 › curriculum course — counts and the consumed split (MG-1.5)
  › writes lesson createdAt from the source topic, and NOT now()
Tests: 1 failed, 64 passed, 65 total

REVERT-2 OK: community-seed.ts byte-identical
```

#### Proof 3 — drop `map-course.ts` from the quarantine scan's walk

```
● assertion 7 … › the field name appears in no file under prisma/seed/
● assertion 7 … › covers Batch 11's new module by name, not just by count
Tests: 2 failed, 63 passed, 65 total

REVERT-3 OK: community-seed.spec.ts byte-identical
```

⚠️ **Two failures, and the second one is the finding.** The by-name assertion fired as expected —
but so did the **floor**. Moving the floor from 11 to 12 was not decorative: with `map-course.ts`
removed from the walk the directory yields 11 files and the `>= 12` guard catches it. A floor
that does not move with the directory lets a new file drop silently out of the scan.

#### Proof 4 — the forbidden field name appended to `map-course.ts`

```
● assertion 7 … › the field name appears in no file under prisma/seed/
    - Expected  - 1
    + Received  + 3
    + Array [
    +   "D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\map-course.ts",
Tests: 1 failed, 64 passed, 65 total

REVERT-4 OK: map-course.ts byte-identical
```

The quarantine demonstrably greps this batch's new file. The spec's needle is still assembled
from fragments (`['coo','ked'].join('')`) so the test enforcing the quarantine is not the first
thing to violate it.

#### Tree restored

```
$ for f in map-course.ts community-seed.ts community-seed.spec.ts summary.ts; do diff .bak $f; done
  map-course.ts identical
  community-seed.ts identical
  community-seed.spec.ts identical
  summary.ts identical
$ npx nx test ptah-license-server --skip-nx-cache --testPathPatterns=community-seed  -> 65 passed
$ npx tsc --noEmit --project .../prisma/seed/tsconfig.json                            -> TSC OK
```

(The 1-second transaction-ceiling probe in Task 11.3 was a fifth temporary mutation, also
reverted and diffed byte-identical.)

---

## Task 11.6 — the `'member'` preset round-trip — **owned by Batch 10 (option (a))**

### The ownership decision, and the evidence for it

`tasks.md` Task 11.6 places its two files inside `libs/web/members/**` and states the rule
explicitly: option **(b)** — Batch 11 owns it — is _"acceptable only if B10 has already landed or
is not running"_, and _"two batches editing `libs/web/members` concurrently is exactly the
collision `context.md`'s serialisation rule exists to prevent."_ This batch's own brief lists
`libs/web/**` as **foreign and forbidden**.

**Batch 10 is running and is writing to that exact directory, right now.** At the start of this
batch `libs/web/members/src/lib/` had no `learning/`. Two hours later:

```
$ git status --porcelain libs/web/
?? libs/web/members/src/lib/learning/
?? libs/web/members/src/lib/services/member-learning-api.service.spec.ts
?? libs/web/members/src/lib/services/member-learning-api.service.ts
```

…and its probe rows are live in the database (`b10-probe-course`, created `09:31:38`).

**Decision: option (a). Batch 10 owns Task 11.6's two files.** Nothing under `libs/web/**` was
created, modified or deleted by this batch. This is `tasks.md`'s own recommendation for exactly
this situation, and it is [recorded as F-2](#f-2).

### But the round-trip was executed, and it is green

Handing the file over is not the same as leaving the question open. The round-trip was run
**out-of-tree** (a harness in `%TEMP%`, deleted afterwards — repo residue verified nil) against
the **real, unmodified `'member'` sanitizer**: `provide-markdown-rendering.ts` was bundled with
esbuild and `provideMarkdownRendering({ extensions: 'member' })` was called for real, and the
`SANITIZE` provider's `useFactory` — i.e. `createMemberSanitizer` itself — was invoked on
`marked@17.0.6` output inside jsdom.

**`libs/frontend/markdown` was READ and NOT modified.** No new export was added or needed:
`createMemberSanitizer` is reachable through the already-public `provideMarkdownRendering`
return value, which corrects Batch 8's Finding 7 blocker #2 — see [F-9](#f-9).

**What is stubbed and what is not.** Stubbed: `ngx-markdown`'s three DI symbols
(`provideMarkdown`, `MARKED_EXTENSIONS`, `SANITIZE`) — Angular provider plumbing. **Not stubbed:**
the DOMPurify instance, `MEMBER_ALLOWED_TAGS`, `MEMBER_ALLOWED_ATTR`, `MEMBER_ALLOWED_URI_REGEXP`,
`enforceMemberLinkPolicy`, `stripsToDataUri` — every security-critical line. The `'member'` preset
installs **no marked extensions**, so calling `marked.parse` directly is the same parse
`MarkdownService` performs.

#### All 8 seeded bodies, through the real preset

```
week-1 srcBytes=327 subsequence=true strong=1 ul=1 li=3/3 p=3 script=false iframe=false on*=false => OK
week-2 srcBytes=326 subsequence=true strong=1 ul=1 li=3/3 p=3 script=false iframe=false on*=false => OK
week-3 srcBytes=313 subsequence=true strong=1 ul=1 li=3/3 p=3 script=false iframe=false on*=false => OK
week-4 srcBytes=311 subsequence=true strong=1 ul=1 li=3/3 p=3 script=false iframe=false on*=false => OK
week-5 srcBytes=311 subsequence=true strong=1 ul=1 li=3/3 p=3 script=false iframe=false on*=false => OK
week-6 srcBytes=312 subsequence=true strong=1 ul=1 li=3/3 p=3 script=false iframe=false on*=false => OK
week-7 srcBytes=331 subsequence=true strong=1 ul=1 li=3/3 p=3 script=false iframe=false on*=false => OK
week-8 srcBytes=304 subsequence=true strong=1 ul=1 li=3/3 p=3 script=false iframe=false on*=false => OK
ALL 8 SEEDED BODIES ROUND-TRIP WITHOUT CONTENT LOSS
```

`subsequence=true` is Task 11.6's assertion class 1 in its strongest cheap form: every
non-whitespace character of the source, with markdown syntax characters stripped, appears **in
order** in the rendered `textContent`. Class 2 (structure) is `strong=1`, `ul=1`,
`li = the source's `- ` bullet count`, `p=3`. Class 3 (nothing added) is
`script=false iframe=false on*=false`.

The week-1 output in full:

```html
<p><strong>Week 1: Foundation — workspace, boundaries, CI</strong></p>
<p>Post here as you work through this week.</p>
<ul>
  <li>What you shipped</li>
  <li>What broke, and what the error actually said</li>
  <li>Anything you want reviewed before it merges</li>
</ul>
<p>Screenshots and diffs welcome. If you are behind, say so — the point is to finish, not to keep pace with a schedule.</p>
```

**No allowlist rule dropped anything.** The em-dash survives, the `**bold**` becomes `<strong>`,
the three bullets become three `<li>`, and the soft line break inside the last paragraph is
preserved as a newline. There is **no finding against the preset**.

#### The hostile control — proving the harness is not a pass-through

```
input:  safe **bold**
        <img src=x onerror=alert(1)>
        <script>alert(2)</script>
        [link](javascript:alert(3))
        <img src="data:text/html;base64,PHN2Zz4=">

output: <p>safe <strong>bold</strong></p>
        <img src="x">
        <p><a rel="noopener noreferrer nofollow" target="_blank">link</a></p>
        <img>

script element    : null          <- tag AND contents removed (allowlist + FORBID_CONTENTS)
iframe element    : null
any on* attribute : false         <- onerror stripped
anchor href       : null          <- javascript: refused by MEMBER_ALLOWED_URI_REGEXP
anchor rel/target : "noopener noreferrer nofollow" / "_blank"   <- link policy applied
img srcs          : "x", null     <- the data: URI stripped by enforceMemberLinkPolicy
```

That reproduces, live, the exact `data:`-through-`DATA_URI_TAGS` hole the preset's docblock says
`ALLOWED_URI_REGEXP` alone cannot close — and shows the hook closing it.

### Handover to Batch 10 — everything needed to land the file

- **Path**: `libs/web/members/src/lib/learning/seeded-body-round-trip.spec.ts` and
  `libs/web/members/src/lib/__fixtures__/curriculum-body.md`.
- **The fixture is the week-1 seeded body**, byte-identical to `course_lessons.body_markdown`
  and to the export's topic 15 post #1 `raw`:
  **SHA-256 `156db7279710174e722558b249fbe38abaa386669a1183e8483352e034037cd4`, 327 bytes.**
  Reproduce with:
  `docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select body_markdown from course_lessons l join course_modules m on m.id=l.module_id join courses c on c.id=m.course_id where c.slug='ptah-builders-cohort-1' and m.slug='week-1';"`
  Verify with the SHA above; do not hand-write it.
- **Expected results are all four blocks above** — they will pass; the preset does not mangle
  this content.
- 🔴 **`tasks.md` Task 11.6 is wrong about one prerequisite.** It says the new spec "must be
  inside `markdown-chokepoint.spec.ts`'s `.spec.ts` exclusion — B7 excluded other spec files by
  absolute path". B7 excluded **only itself** by absolute path
  (`markdown-chokepoint.spec.ts:174`); every other spec is excluded by
  `.filter((path) => !path.endsWith('.spec.ts'))` at `:183`. **No change to
  `markdown-chokepoint.spec.ts` is required.** And its collector (`:136`) takes only `.ts` and
  `.html`, so the `.md` fixture is not scanned at all.
- Assertion class 4 (reading the bound `content` input via
  `By.directive(MarkdownBlockComponent)`) is the **one class this out-of-tree run did not
  cover** — it needs the Angular `TestBed` and is the reason the durable spec belongs on the
  frontend side.

**Batch 8's Task 8.7 assertion 8 is therefore _answered_ but not yet _closed in the repo_.**
Closing it is one file in Batch 10's territory, with the expected output already known.

---

## Task 11.7 — Live verification, residue, exit gate ✅

Token minted per `V-TOKEN` for the dev user `674888a2-b28b-4d83-87c8-8c30d971edc1`
(`abdallah@miramarstaffing.com`) with `JWT_SECRET` from the workspace-root `.env`, 20-minute
expiry, sent as the **`ptah_auth` cookie** (`-b`, never `-H` — `JwtAuthGuard` reads
`request.cookies['ptah_auth']`). **The minting script was deleted afterwards.**

### The 404 IS the gate passing

```
=== BEFORE: member_group_assignments ===
0
=== [1] GET /api/v1/members/courses/ptah-builders-cohort-1 ===
404
=== [2] GET /api/v1/members/courses ===
length 1 | slugs b10-probe-course | contains cohort course: false

=== INSERT the probe assignment ===
b11-probe-assignment
INSERT 0 1
member_group_assignments -> 1
=== [3] GET /api/v1/members/courses/ptah-builders-cohort-1 ===
200
=== [4] GET /api/v1/members/courses ===
length 2 | slugs ptah-builders-cohort-1,b10-probe-course | contains cohort course: true

=== DELETE the probe assignment BY ID, in one transaction ===
BEGIN / DELETE 1 / COMMIT
member_group_assignments -> 0
=== [5] GET /api/v1/members/courses/ptah-builders-cohort-1 ===
404
    GET /members/courses -> length 1 | slugs b10-probe-course | contains cohort course: false
```

**One account proved both halves of A-2.** Entitled, admin, zero cohorts ⇒ the cohort course is
**invisible (`404`, never `403`)**; add the assignment ⇒ `200`; remove it ⇒ `404` again. Nothing
was "fixed" by seeding an assignment or by downgrading the course to `visibility: 'member'`.

⚠️ **`GET /members/courses` returns `1`, not the gate's `0`.** The one course is
**`b10-probe-course`** — Batch 10's, `visibility: 'member'`, created 09:31, **not this seed's**.
The meaningful assertion, and the one made, is that `ptah-builders-cohort-1` is **absent** from
the list. [Recorded as F-3](#f-3).

### The course row, live

```
$ ... "select slug, visibility, cohort_keys, published, sequential, sort_order, title, description from courses where slug='ptah-builders-cohort-1';"
ptah-builders-cohort-1|cohort|{founding}|t|f|100|Ptah Builders — Cohort 1|The eight-week Ptah Builders cohort, one module per week, assembled from the cohort build threads.
```

`cohortKeys = {founding}` **resolved from `MemberGroup where isDefault: true` at run time**, not
hard-coded — the spec proves this by building the same rows against a different key and watching
the row follow.

### Ordering and the video nulls

```
$ ... "select m.sort_order, m.slug, m.title, l.slug, l.sort_order, l.youtube_video_id is null, l.video_duration_seconds is null, m.release_at is null …"
100|week-1|Foundation — workspace, boundaries, CI          |week-1|100|t|t|t
200|week-2|The domain — modelling and migrations           |week-2|100|t|t|t
300|week-3|Authentication and tenancy                      |week-3|100|t|t|t
400|week-4|Billing and entitlements                        |week-4|100|t|t|t
500|week-5|The first vertical slice                        |week-5|100|t|t|t
600|week-6|Agents, memory and skills                       |week-6|100|t|t|t
700|week-7|Hardening                                       |week-7|100|t|t|t
800|week-8|Deploy and launch                               |week-8|100|t|t|t
```

Modules at 100…800 in §7.3's order, one lesson each at 100, `youtube_video_id is null` **true**
on all 8 (and `video_duration_seconds` too), `release_at` null on all 8.

Lesson titles retain the source prefix, as §7.3 requires:

```
week-1|Week 1 build thread — Foundation — workspace, boundaries, CI
…
week-7|Week 7 build thread — Hardening — tests, policies, observability
week-8|Week 8 build thread — Deploy and launch
```

Through the member API, with the assignment temporarily present:

```
slug ptah-builders-cohort-1 | modules 8 | resumeLesson {"slug":"week-1","title":"Week 1 build thread — Foundation — workspace, boundaries, CI","moduleTitle":"Foundation — workspace, boundaries, CI"}
  100 week-1 | Foundation — workspace, boundaries, CI | lessons 1 | week-1 dur=null
  …
  800 week-8 | Deploy and launch                     | lessons 1 | week-8 dur=null
```

### Byte fidelity — SHA-256 per lesson, database vs file

Not eyeballed. Postgres hashed the stored UTF-8 bytes; Node hashed the export's `raw` bytes; the
two lists were `diff`ed. **Byte length is carried alongside the digest** so a hash collision is
not the only thing standing between a mangled body and a green check.

```
$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc
  "select m.slug||'/'||l.slug||' '||encode(sha256(convert_to(l.body_markdown,'UTF8')),'hex')
          ||' len='||octet_length(convert_to(l.body_markdown,'UTF8'))
     from course_lessons l join course_modules m on m.id=l.module_id
     join courses c on c.id=m.course_id where c.slug='ptah-builders-cohort-1'
    order by m.sort_order;"

week-1/week-1 156db7279710174e722558b249fbe38abaa386669a1183e8483352e034037cd4 len=327
week-2/week-2 3d083f49f6cc502275e8be5bc5cfdedcbbce88c6251cfa87b68cf82b5028fd00 len=326
week-3/week-3 5c503addf5dcdb9db759ada80fbfb8ed28df2ef8034718bd24fd287ce40fd26c len=313
week-4/week-4 96f7e7f56206421de5ae8b3cc70ef9a3417197eff076f1a876fc89b855c4f219 len=311
week-5/week-5 081aec0643917699870e84ac2d5fbbc8f41e17d080747b441fa261ba7f920445 len=311
week-6/week-6 e6f561e3aef9c3695accf1ecd8c756581393f8e8a4083fb737effc134a1089b8 len=312
week-7/week-7 28128c5b3eb0759d565b138b3d6dcc006969a85b72b14c5014765922dd8438a3 len=331
week-8/week-8 d12d537a5ca3898811ac5d200c4ed9124d45cc070b5d1c4fabe4c9beaef26b0c len=304

$ diff /tmp/db_lessons.txt /tmp/file_lessons.txt
db lines: 8  file lines: 8
NO DIFFERENCES — all 8 lesson bodies byte-identical (SHA-256 + byte length), DB vs file
```

⚠️ **What this corpus is SENSITIVE to** — Batch 8's Finding 6 demands the claim be qualified.
On its own, **it is not sensitive to `.trim()`, CRLF normalisation, entity decoding or
re-wrapping**, because every Week-N body already begins with `**`, ends with `.`, contains no CR
and no HTML entity. The sensitivity comes from the hostile-fixture case in the spec
([Proof 1](#proof-1--trim-on-the-lesson-mapper--the-sensitive-case-goes-red)), which was **seen
to fail**. These hashes prove the database matches the file; the spec proves the comparison can
detect a transform at all. Both are needed and neither substitutes for the other.

### Residue

- **`member_group_assignments` is back to `0`**, verified after the delete.
- The one probe row was inserted and deleted **by id** (`b11-probe-assignment`) inside a
  `BEGIN`/`COMMIT`.
- **No Batch 10 row was touched.** No `TRUNCATE`, no blanket `DELETE`.
- The out-of-tree preset harness (`%TEMP%\b11-preset-roundtrip`) and the token script were
  deleted; `git status` confirms no stray file in the repo.
- **The seed's own rows stay** — they are the deliverable.

---

## Final row counts — and whose data is whose

```
community_categories        | 4     <- BATCH 8, unchanged
community_topics            | 9     <- BATCH 8, unchanged
community_posts             | 10    <- BATCH 8, unchanged
community_post_reactions    | 0
community_topic_read_state  | 0

courses                     | 2     <- 1 MINE (ptah-builders-cohort-1) + 1 BATCH 10 (b10-probe-course)
course_modules              | 10    <- 8 MINE (week-1…week-8)          + 2 BATCH 10
course_lessons              | 11    <- 8 MINE (week-1…week-8)          + 3 BATCH 10
lesson_progress             | 2     <- ALL BATCH 10 (0 against my lessons — verified)
lesson_comments             | 4     <- ALL BATCH 10 (0 against my lessons — verified)

users                       | 3     (3 at pre-flight, 3 now — no User row created)
member_groups               | 1
member_group_assignments    | 0     (0 at pre-flight, 0 now)
licenses: DEV-BUILDERS-VALIDATION-0001  active | builders  — present and intact
```

**Distinguishing marks.** Mine are everything under `Course.slug = 'ptah-builders-cohort-1'`,
module slugs `week-1`…`week-8`, `visibility='cohort'`, `cohort_keys={founding}`,
`created_by IS NULL`. Batch 10's are the `b10-` prefixed slugs, `visibility='member'`,
`created_by = 674888a2-…`, created at `09:31`.

**The community seed is byte-for-byte untouched**, and not merely by row count:

```
$ ... "select md5(string_agg(id||body_markdown, '' order by id)) from community_posts;"
6867f22f8ab484f18f06f3cbbae9d8a1
```

**That is the identical md5 Batch 8 recorded** for its live abort proofs. The fingerprint is over
`id || body_markdown` per post, so it detects a changed body as well as a changed row count.

Zero community rows and zero seeded lessons are dated today:

```
community_topics  where created_at::date = current_date  -> 0
community_posts   where created_at::date = current_date  -> 0
my course_lessons where created_at::date = current_date  -> 0
```

---

## Findings — things that contradict `tasks.md`, the plan, or a prior report

### F-1

**🔴 `api-learning:eslint:lint` fails at HEAD with 12 errors, and Batch 9C reported it green.**

The batch gate this brief prescribes is
`-p ptah-license-server,api-learning`. `ptah-license-server` passes completely.
**`api-learning` fails lint** — 12 × `@nx/enforce-module-boundaries`:

```
libs/api/learning/src/lib/courses/reorder.service.ts:8
libs/api/learning/src/lib/learning.module.ts:4
libs/api/learning/src/lib/lessons/lesson-video.service.ts:10
libs/api/learning/src/lib/progress/progress.service.ts:8      … and 8 more
  error  Static imports of lazy-loaded libraries are forbidden.
  Library "api-core" is lazy-loaded in these files:
  - libs/api/learning/src/lib/courses/courses.service.spec.ts
```

**Root cause**, one line, committed in Batch 9B's `4d1c57707`:

```ts
libs/api/learning/src/lib/courses/courses.service.spec.ts:741
      require('@ptah-api/core').Prisma.PrismaClientKnownRequestError.prototype,
```

Nx classifies that `require()` as a **lazy load** of `api-core`, which then makes every static
`import` of `@ptah-api/core` in the same lib illegal.

**It is not this batch's.** `git status --porcelain libs/api` is empty and
`git diff --stat HEAD -- libs/api/learning/` is empty: the lib is byte-identical to HEAD. This
batch's only changes are under `apps/ptah-license-server/prisma/seed/`, which cannot reach it.
It reproduces after `nx reset` (which itself partially failed with `EPERM` on
`.nx/workspace-data` — a concurrent Nx process holds it, consistent with Batch 10 running).
Batch 9C's report claims _"Zero lint errors"_ across six projects, so this most likely passed
against a stale project graph.

**Not fixed** — `libs/api/learning/**` is outside this batch's file set and hard rule 4 says
report it. **The fix is one line**: replace the `require()` with the static import the file
already has available, or hoist it. Recommended owner: whoever next touches `api-learning`.

### F-2

**Task 11.6's file set is inside Batch 10's territory, and Batch 10 is actively writing there.**
Resolved as `tasks.md` itself recommends — **option (a)**, Batch 10 owns it. Evidence, the
handover package and the executed-and-green round-trip are in
[§11.6](#task-116--the-member-preset-round-trip--owned-by-batch-10-option-a). Batch 8's
assertion 8 is answered but not yet closed in the repo.

### F-3

**Task 11.7's `GET /members/courses | jq 'length'` expects `0`; it returns `1`.** The one course
is Batch 10's `b10-probe-course` (`visibility: 'member'`, so legitimately visible to an entitled
member). Task 11.1 anticipated exactly this — _"if the course tables are NOT empty, Batch 10 is
probably running… do not delete its rows"_ — but the exit-gate line was not updated to match.
**The assertion that carries the meaning is `contains cohort course: false`**, which is what was
checked. Recommend rewording the gate to "the seeded course is absent from the list" rather than
a bare count, since a shared database makes any count assertion fragile.

### F-4

**`Course.description` is a required `String` and §7.3 supplies no value.** Left unstated it
would be `''`, which renders as a blank paragraph under the course title. One editorial sentence
was written (`COURSE_DESCRIPTION` in `map-course.ts`), derived from nothing in the source and
saying only what the mapping itself establishes. **Reversible in one line** if MG-1.5 has
different copy in mind.

### F-5

**MG-1.5's module title 7 and the source topic title genuinely disagree today.** §7.3 warns that
deriving module titles from topic titles "would silently change the moment a topic is retitled".
It is already wrong, not merely fragile:

|                       |                                                                    |
| --------------------- | ------------------------------------------------------------------ |
| Source topic 21 title | `Week 7 build thread — Hardening — tests, policies, observability` |
| MG-1.5 module title   | `Hardening`                                                        |

A derivation that strips the `Week N build thread — ` prefix would produce
`Hardening — tests, policies, observability`. The spec asserts the pair explicitly as an
anti-vacuity case, so the literal table is provably editorial rather than computed.

### F-6

**The mapper's empty-curriculum-body abort cannot be reached with a single-field fixture.** The
schema's `EXPECTED_NON_EMPTY_BODY_POSTS = 18` census fires first: blanking one curriculum body
drops the count to 17 and `ExportValidationError` is raised before mapping. Both controls are
therefore tested:

- **single mutation** → aborts at the census, `db.calls` empty;
- **compensated mutation** (blank a curriculum body _and_ fill topic 13's empty small-action
  reply, holding the non-empty total at 18) → aborts with `CourseMappingError`, message matched,
  `db.writes()` empty and **the transaction never opened**.

Worth recording because it means the mapper guard is **defence in depth**, not the first line —
and without the compensated fixture the test would have proved only that the schema works.

### F-7

**Batch 8's `refreshedBodies` type had to change shape.** Task 11.3 requires `--refresh-bodies`
to reach lessons through _the same_ logger. `SeedSummary.refreshedBodies` is now a discriminated
union (`kind: 'post' | 'lesson'`) instead of a single post-shaped record. `formatSummary` was
**not** rewritten — it gained one ternary. Batch 8's existing assertions on the post variant
still pass unchanged. A second array would have let the flag appear to work while leaving lesson
bodies stale for ever, which is precisely the silent failure Task 11.5 case 4 exists to catch.

### F-8

**The `bodies:` summary line moved from `10/10` to `18/18`.** Not requested. §7.5's literal
`19/19` was never achievable — one source post has no body — and `18` is exactly
`EXPECTED_NON_EMPTY_BODY_POSTS`, so the line now closes against a named constant instead of
against a number that has been wrong since the export was captured. Asserted in the spec.

### F-9

**Batch 8's Finding 7 blocker #2 is softer than reported.** It says
_"exercising `createMemberSanitizer` means bootstrapping an Angular injector … or exporting a new
symbol from `libs/frontend/markdown`."_ Neither is required: the factory is reachable from the
**already-public** `provideMarkdownRendering({ extensions: 'member' })` return value —
`providers[0].sanitize.useFactory` — with no Angular runtime at all. That is how this batch ran
the round-trip without touching the markdown lib. Blockers #1 (`testEnvironment: 'node'`) and #3
(the natural home is the frontend side) stand.

### F-10

**Three columns beyond `bodyMarkdown` are excluded from the update payloads.** §7.4 names only
`bodyMarkdown`. `Course.createdBy`, `CourseModule.releaseAt` and the `Lesson` video columns were
also excluded, because a re-run overwriting any of them destroys work done in the product —
`releaseAt` most sharply, since a re-run would silently unschedule eight date-gated modules. This
is a deliberate widening of §7.4's principle, argued in the writer's docblock. **If the intent
was that the seed re-asserts the full editorial shape on every run, this is the one decision to
overturn**, and it is three lines.

### F-11

**`tasks.md` Task 11.6's description of the chokepoint exclusion is inaccurate.** See the
handover note in [§11.6](#handover-to-batch-10--everything-needed-to-land-the-file): B7 excludes
only _itself_ by absolute path and all other specs by `.endsWith('.spec.ts')`, and the collector
takes only `.ts`/`.html`, so neither the new spec nor the `.md` fixture needs any change there.
Batch 10 should not spend time on a prerequisite that does not exist.

### F-12

**9B's F-1 confirmed and left alone.** `Course`, `CourseModule` and `Lesson` still have no
`deletedBy` column. This batch writes none, adds none, and ran no migration. It stays for
migration 4 / Batch 12.

---

## Deviations summary

| Spec said                                        | Done                                                                                                     | Why                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Task 11.6 lands in `libs/web/members`            | **Not landed; handed to Batch 10 (option (a))**, round-trip executed and green out-of-tree               | F-2 — B10 is writing that directory now   |
| `GET /members/courses` returns `0`               | returns `1` (B10's probe course); asserted "cohort course absent" instead                                | F-3                                       |
| §7.3 gives no `Course.description`               | one editorial sentence                                                                                   | F-4 — required column                     |
| `refreshedBodies` appended to unchanged          | shape widened to a discriminated union; `formatSummary` gained one branch, not a rewrite                 | F-7                                       |
| `bodies: 10/10`                                  | `bodies: 18/18`                                                                                          | F-8                                       |
| §7.4 excludes `bodyMarkdown` from updates        | also excludes `createdBy`, `releaseAt`, the video columns                                                | F-10                                      |
| Gate `-p ptah-license-server,api-learning` green | `api-learning:eslint:lint` red at HEAD                                                                   | F-1 — foreign, pre-existing, one-line fix |
| Quarantine floor 11 → 12                         | done, **and the move was proven load-bearing** (Proof 3 failed on the floor as well as the by-name case) | —                                         |

---

## Files created / modified — absolute paths

**Created**

```
D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\map-course.ts               297 lines
```

**Modified**

```
D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.ts
D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.spec.ts
D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\summary.ts
D:\projects\ptah-extension\.ptah\specs\task_2026_177\batch-11-report.md   (this file; .ptah is gitignored)
```

**`apps/ptah-license-server/project.json` was NOT touched** — the `seed-community` target already
existed, exactly as the Batch 11 header predicted:

```
$ git diff --stat -- apps/ptah-license-server/project.json
(empty)
```

**No shared registry file was touched.** `tsconfig.base.json`, `nx.json`, `eslint.config.mjs`,
`app.module.ts`, `route-map.spec.ts`, `controller-registry.ts`, `controller-validation.spec.ts`,
`schema.prisma` and `prisma/migrations/**` are all unmodified. **No file under `libs/**` or any
other app was created, modified or deleted by this batch.\*\*

---

## Final `git status --porcelain`, annotated

```
 M apps/ptah-license-server/prisma/seed/community-seed.spec.ts     <- MINE (Task 11.5)
 M apps/ptah-license-server/prisma/seed/community-seed.ts          <- MINE (Tasks 11.3, 11.4)
 M apps/ptah-license-server/prisma/seed/summary.ts                 <- MINE (Task 11.4)
?? apps/ptah-license-server/prisma/seed/map-course.ts              <- MINE (Task 11.2, NEW)

?? libs/web/members/src/lib/learning/                              <- BATCH 10 (concurrent)
?? libs/web/members/src/lib/services/member-learning-api.service.ts      <- BATCH 10
?? libs/web/members/src/lib/services/member-learning-api.service.spec.ts <- BATCH 10

M  libs/frontend/tasks-ui/src/index.ts                                          <- FOREIGN, STAGED
M  libs/frontend/tasks-ui/src/lib/components/board/task-board.component.spec.ts <- FOREIGN, STAGED
M  libs/frontend/tasks-ui/src/lib/components/board/task-board.component.ts      <- FOREIGN, STAGED
M  libs/frontend/tasks-ui/src/lib/components/board/task-card.component.spec.ts  <- FOREIGN, STAGED
M  libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts       <- FOREIGN, STAGED
M  libs/frontend/tasks-ui/src/lib/components/board/task-column.component.ts     <- FOREIGN, STAGED
A  libs/frontend/tasks-ui/src/lib/components/bulk/task-bulk-bar.component.ts    <- FOREIGN, STAGED
A  libs/frontend/tasks-ui/src/lib/components/bulk/task-bulk-summary.component.spec.ts <- FOREIGN, STAGED
A  libs/frontend/tasks-ui/src/lib/components/bulk/task-bulk-summary.component.ts      <- FOREIGN, STAGED
M  libs/frontend/tasks-ui/src/lib/components/palette/palette-entries.spec.ts    <- FOREIGN, STAGED
M  libs/frontend/tasks-ui/src/lib/components/palette/palette-entries.ts         <- FOREIGN, STAGED
M  libs/frontend/tasks-ui/src/lib/components/tasks-view.component.spec.ts       <- FOREIGN, STAGED
M  libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts            <- FOREIGN, STAGED
M  libs/frontend/tasks-ui/src/lib/services/tasks-store.service.spec.ts          <- FOREIGN, STAGED
M  libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts               <- FOREIGN, STAGED
```

### 🔴 Warning for whoever commits next — unchanged from Batch 8, with a different victim

**The unrelated task-specs/settings process has STAGED 15 files into the index again** (the
`M ` / `A ` in column 1). Batch 8's report warned of 19 such files; the set has changed but the
hazard has not. A bare `git commit` would sweep them into Batch 11's commit, **and would also
sweep in Batch 10's three untracked `libs/web/members` paths** if `-A` were used.

**Stage path-by-path. For this batch that is exactly one directory:**

```
git add apps/ptah-license-server/prisma/seed
git diff --cached --name-only | grep -Ev '^apps/ptah-license-server/prisma/seed/'   # must print nothing
```

`.ptah/**` is gitignored, so this report is not committable and needs no excluding.
**HEAD did not move during this batch** (`aa38f5f42` at start and at end), so no rebase or
conflict was encountered.

---

## Carried forward

1. 🔴 **F-1 — `api-learning:eslint:lint` is red at HEAD.** One line
   (`courses.service.spec.ts:741`). Blocks the six-project gate for every subsequent batch.
2. 🔴 **F-2 — Task 11.6's spec file must be landed by Batch 10.** The round-trip is proven green
   and the handover package (fixture SHA, expected assertions, the corrected chokepoint
   prerequisite) is in [§11.6](#handover-to-batch-10--everything-needed-to-land-the-file).
   **Batch 8's Task 8.7 assertion 8 is answered but not yet closed in the repo.**
3. **9B's F-1 — no `deletedBy` on `Course`/`CourseModule`/`Lesson`.** Untouched, for migration 4.
4. **Batch 8's Finding 2 — the empty small-action post.** Still the honest reason the arithmetic
   is `10 + 1 + 8` rather than `11 + 8`. Re-capturing the export without small-action posts
   collapses it to `18 = 10 + 8` and lets `SKIP_EMPTY_BODY_POSTS` be deleted.
5. **Batch 6's carried item 2 — the unforced trigram `EXPLAIN`.** Unchanged by this batch: the
   curriculum adds 8 rows to `course_lessons`, not to `community_posts`, so the planner still
   correctly prefers a sequential scan. Keep using the forced form.
6. **Batch 10 owns the shared course tables too.** Its `b10-probe-course` and its 2 progress /
   4 comment rows are still live. Whoever verifies next must not assert emptiness on
   `courses`, `course_modules`, `course_lessons`, `lesson_progress` or `lesson_comments`.
