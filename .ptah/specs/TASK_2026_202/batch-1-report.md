# Batch 1 report — Content, mapping and census (TASK_2026_202)

**Executor**: `backend-developer` (sub-agent)
**Worktree**: `D:/projects/ptah-extension/.claude/worktrees/founding-cohort`
**Branch**: `ak/founding-cohort-free-access`
**Status**: COMPLETE. Typecheck green, lint green, `community-seed.spec.ts` RED with
11 failing tests — expected, and Batch 2's job.
**Not committed.** The team-leader owns commits.

---

## 🔴 Read this first — two things the team-leader must act on

### 1. The worktree is NOT exclusively mine, and it lost my edits once

At **00:42:01** an external process reset this worktree's tracked files to HEAD,
silently discarding four of my five edited files. I caught it because
`git status` stopped listing them. I re-applied everything and re-verified from
disk; **the final state below is confirmed by reading the files back, not by
trusting that my writes landed.**

Corroborating evidence that another agent is working in this same worktree:

| Path                                                                                                  | Mine?       |
| ----------------------------------------------------------------------------------------------------- | ----------- |
| `apps/ptah-license-server/prisma/schema.prisma` (modified, 20 lines)                                  | ❌ NOT MINE |
| `apps/ptah-license-server/prisma/migrations/20260911090000_waitlist_approved_at/`                     | ❌ NOT MINE |
| `apps/ptah-license-server/prisma/migrations/20260911090100_remove_founding_waitlist_invite_template/` | ❌ NOT MINE |
| `.ptah/specs/TASK_2026_201/`                                                                          | ❌ NOT MINE |

Those are TASK_2026_201 artefacts (comp licences, invite email, approval flow) —
explicitly listed under "Deliberately NOT touched" in `tasks.md`.

**Consequence for the Batch 1 exit gate.** `tasks.md` says _"`git diff --stat`
shows exactly five files"_. It shows **six**: my five plus the foreign
`schema.prisma`. **Stage the five by name; do not `git add -A`.** And re-verify
the five before committing, in case the reset recurs.

### 2. Nothing else tripped a stop condition

| Stop condition                                          | Result                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| 1 — the forum half moves                                | ✅ NOT TRIPPED. See "Forum-half proof" below               |
| 2 — a committed fixture needs editing                   | ✅ NOT TRIPPED. `git diff --stat -- __fixtures__` is empty |
| 3 — a non-comment line changes in `community-seed.ts`   | ✅ NOT TRIPPED. Mechanically checked                       |
| 5 — `IMPORTED_TOPIC_IDS` / `SKIP_EMPTY_BODY_POSTS` diff | ✅ NOT TRIPPED. Mechanically checked                       |

---

## File-by-file changes

### 1. `docs/community/discourse-export.json` (Task 1.1)

Method: the file round-trips **byte-identically** through
`JSON.stringify(obj, null, 2) + '\n'` — verified before touching it — so the ten
topics were rewritten programmatically. That is what makes the forum-half
zero-diff claim mechanical rather than visual. The throwaway script was deleted.

- Topics **15…22 rewritten in place**; **24 and 25 added** immediately after 22.
- File order is now `4, 5, 6, 8, 9, 10, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 23`
  — the ten curriculum topics are one contiguous block in **day order**, and ids
  no longer ascend. Accepted per plan §1.1; moving topic 23 would be a forum-half
  edit.
- `cooked` **dropped on all ten**. Verified first: repo-wide `grep` for `cooked`
  outside `node_modules` returns only spec/plan markdown and one comment in
  `libs/api-contracts/community/src/lib/member/member-topic.contract.ts:28-30`
  that _forbids_ such a field. **No code reads it.** The nine forum topics keep
  theirs (11 `"cooked"` occurrences, unchanged).
- `createdAt` on both topic and post: `"2026-08-10T00:00:00.000Z"`, identical
  across all ten. In the past at commit time with a full day of margin
  (today is 2026-08-11), so `community-seed.spec.ts:1142` cannot flake.
- One post per topic, `postNumber: 1`, `username: "system"`, `categoryId: 5`,
  `categoryName: "Builders Lounge"`, `pinned: false`.
- Body: the §1.4 thread shell reused verbatim ten times — header
  `**Day ${n}: ${MODULE_TITLES[n-1]}**` (colon), `this week` → `this session`.
  No trailing whitespace, no CR, no U+FFFD anywhere in the file.
- Top-level `curriculumNote` added as a sibling of `note`.

**Census after the edit** (all read back from disk): 19 topics · 21 posts ·
20 non-empty bodies · 4 categories · all 19 slugs unique.

### 2. `apps/ptah-license-server/prisma/seed/discourse-export.schema.ts` (Task 1.2)

- `EXPECTED_TOPIC_COUNT` 17 → **19**; `EXPECTED_POST_COUNT` 19 → **21**;
  `EXPECTED_NON_EMPTY_BODY_POSTS` 18 → **20**. `EXPECTED_CATEGORY_COUNT` stays **4**.
- The `🔴 THIS IS 18, NOT 19` docblock rewritten as `🔴 THIS IS 20, NOT 21`, with
  the whole small-action-post argument preserved verbatim and the two inline
  arithmetic sentences moved (`0 ≠ 20`, `21 ≠ 20`), plus a new paragraph
  recording that TASK_2026_202 moved the pair and that `NON_EMPTY = POST_COUNT − 1`
  is unchanged.

### 3. `apps/ptah-license-server/prisma/seed/map-topics.ts` (Task 1.3)

- `CURRICULUM_TOPIC_IDS` → `[15, 16, 17, 18, 19, 20, 21, 22, 24, 25] as const`,
  `readonly number[]` preserved.
- `IMPORTED_TOPIC_IDS` and `SKIP_EMPTY_BODY_POSTS` **byte-identical** — proven by
  a grep over `git diff -U0` for those declarations and every id line; empty.
- Docblocks: "The remaining 8 — source ids 15…22" → ten, naming 24 and 25; the
  `CURRICULUM_TOPIC_IDS` docblock now also records **why 23 is not a gap to be
  filled** (it is `welcome-to-the-ptah-community`, a forum topic).
- ⚠️ **One edit beyond the named scope, flagged for review.** `buildTopicRows`'s
  docblock said the export slugs are _"unique across all 17"_ and _"16 of the 17
  are byte-identical to `slugify(title)`"_. Both became false. I corrected them
  to "all 19" / "8 of the 9 imported here", and added that the ten curriculum
  slugs are deliberately **not** `slugify(title)` (they carry the `day-NN`
  prefix) but are never written to the database, so uniqueness in the export is
  the only invariant they owe. Comment-only; no constant moved.

### 4. `apps/ptah-license-server/prisma/seed/map-course.ts` (Task 1.4)

**Executable changes** (four):

| What                 | Change                                                                              |
| -------------------- | ----------------------------------------------------------------------------------- |
| `MODULE_TITLES`      | The ten C2 titles, in day order; `readonly string[]` + `as const` preserved         |
| `COURSE_DESCRIPTION` | Plan §2.5's **second** phrasing (see R12 below)                                     |
| Module/lesson slug   | `` `week-${index + 1}` `` → `` `day-${String(index + 1).padStart(2, '0')}` ``       |
| FR-TITLE-2 guard     | New; plus `curriculumTopicTitle()` exported                                         |
| `:217` message       | Now computed: `MG-1.5 names ${CURRICULUM_TOPIC_IDS.length} curriculum topics by id` |
| `:198` message       | "silently drop a week" → "a day"                                                    |

`SORT_ORDER_STEP` stays **100**. `sequential` stays **false**. No delete verb
added. Guard placement is exactly as specified: inside the
`CURRICULUM_TOPIC_IDS.map(...)` callback, **after** the `title === undefined`
check and **before** the returned row — pure code, runs before `$transaction`
opens. It throws `CourseMappingError`, not a bare `Error`.

**Docblock changes**: file docblock rewritten per §2.6 —

- 8/8 → 10/10; ONE-MODULE-PER-**SESSION** argument kept and strengthened, with
  the pointer to `CourseScheduleService` and `POST /v1/admin/course-modules/schedule`;
- `sequential: false` unchanged, with the new argument that ten daily modules are
  a _stronger_ reason to leave it off (a member one day behind would be locked
  out of the rest of a two-week cohort — and every lesson body says the opposite);
- the `:36-40` "wrong today, not merely fragile" note **rewritten, not deleted**:
  it now records the topic-21 defect, that TASK_2026_202 repaired it, that it is
  now a build failure, and that the two halves are still independently authored
  because a derivation would have nothing left to disagree with;
- the Requirement 5.4 editorial sentence (curriculum topics are editorial,
  maintained in place, not a capture; "re-capture the export" is not a remedy);
- C2's rationale — uneven domains, Products folded into Day 5, agent after
  entitlements, deploy on Day 2, integration split across Days 9–10;
- the **§5.7 offset block**: the rule ("a function of the start weekday, not a
  constant"), the Monday table, and the Tuesday-1-Sep-2026 table ending Day 10 on
  Mon 14 Sep, with the "known, accepted, do not re-raise" note.

`buildCourseRows`'s docblock now carries the four-reason padding argument
(prefix trap · lexical = numeric · width 2 sized to `MODULE_TITLES.length` ·
disjoint from `week-1…week-8`) and the FR-SLUG-3 rule (titles unpadded → `\d{1,2}`;
slugs padded → `(0[1-9]|10)`).

### 5. `apps/ptah-license-server/prisma/seed/community-seed.ts` (Task 1.5)

**Comments and docblocks only — mechanically verified.** `git diff -U0` filtered
to lines that are not `*`, `//` or `/*` returns **nothing**.

- `:26-30` → 10 topics, 10 modules, 10 lessons, "Day N".
- `:273-277` → `1 + 10 + 10` reads and writes, ~42 more round trips, ~98 total;
  the 60s-budget sentence kept verbatim.
- `:297-298` → `10 + 10 = 20`.
- `:520-527` → ten modules, plus the new paragraph: the schedule is now set by
  `POST /v1/admin/course-modules/schedule`, which makes this exclusion **more**
  important — two writers of one column, one owner — and seeded modules stay
  `releaseAt = null` (C5, open by default).
- ⚠️ **One edit beyond the named scope, flagged.** `:305-307` said _"`17`, `19`,
  `9`, `8` and `10` are all derived from the census constants"_. Those literals
  were stale. Corrected to `19`, `21`, `9`, `10`, `10`, with one added sentence
  noting that TASK_2026_202 is the proof of that comment's own claim — every
  number moved and not one character of the code below did.

---

## The ten topic ids, and why

| Day | id                             | Allocation                                                                                                                                              |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–8 | 15, 16, 17, 18, 19, 20, 21, 22 | **Rewritten in place.** Title, slug, body and `createdAt` all replaced; the id is reused because the topic _is_ that day's build thread, just re-scoped |
| 9   | **24**                         | **New.** 23 was already taken by `welcome-to-the-ptah-community`, a forum topic and the last topic in the file; 24 is the next free id                  |
| 10  | **25**                         | **New.** Next free id after 24                                                                                                                          |

Renumbering to make ids contiguous was rejected: it would have required editing
topic 23, which is forum-half content and stop condition 1.

---

## The ten module titles and slugs

| Day | id  | `MODULE_TITLES[n-1]`                                                      | Module + lesson slug | Export topic slug                                                                           |
| --- | --- | ------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| 1   | 15  | The workspace — monorepo, boundaries, first green CI                      | `day-01`             | `day-01-build-thread-the-workspace-monorepo-boundaries-first-green-ci`                      |
| 2   | 16  | The database and the deploy pipe — Postgres, migrations, staging on merge | `day-02`             | `day-02-build-thread-the-database-and-the-deploy-pipe-postgres-migrations-staging-on-merge` |
| 3   | 17  | Sign-up, sign-in, session                                                 | `day-03`             | `day-03-build-thread-sign-up-sign-in-session`                                               |
| 4   | 18  | Users, organisations and the tenancy boundary                             | `day-04`             | `day-04-build-thread-users-organisations-and-the-tenancy-boundary`                          |
| 5   | 19  | Projects and products — the aggregates and their contracts                | `day-05`             | `day-05-build-thread-projects-and-products-the-aggregates-and-their-contracts`              |
| 6   | 20  | Checkout — plans, prices and the first paid subscription                  | `day-06`             | `day-06-build-thread-checkout-plans-prices-and-the-first-paid-subscription`                 |
| 7   | 21  | Webhooks and entitlements — turning a payment into a durable fact         | `day-07`             | `day-07-build-thread-webhooks-and-entitlements-turning-a-payment-into-a-durable-fact`       |
| 8   | 22  | The agent in the product — tools, streaming and cost control              | `day-08`             | `day-08-build-thread-the-agent-in-the-product-tools-streaming-and-cost-control`             |
| 9   | 24  | Connecting an integration — OAuth and the token lifecycle                 | `day-09`             | `day-09-build-thread-connecting-an-integration-oauth-and-the-token-lifecycle`               |
| 10  | 25  | Publish, fail, retry — and launch                                         | `day-10`             | `day-10-build-thread-publish-fail-retry-and-launch`                                         |

Source topic title for each is `` `Day ${n} build thread — ${MODULE_TITLES[n-1]}` ``,
separator **space + U+2014 + space**. Titles use "Day 1"; slugs use `day-01`. The
asymmetry is intentional and is now documented in `buildCourseRows`'s docblock.

`sortOrder` runs `100, 200, …, 1000` — `SORT_ORDER_STEP` unchanged at 100.

`COURSE_DESCRIPTION` is now:

> `'The two-week Ptah Builders intensive: ten daily sessions across five domains, assembled from the cohort build threads.'`

Contains neither `eight-week` nor `one module per week`. **R12 avoided**: the
readable phrasing "one module per weekday" _contains_ the forbidden substring, so
plan §2.5's second option shipped and the assertion was not loosened. The
docblock records this so nobody "improves" the wording back into the trap.

---

## Evidence: the title-consistency guard fires

A throwaway spec (`prisma/seed/tmp-guard-evidence.spec.ts`, run then **deleted**)
exercised four properties against the real export. **4 passed, 0 failed.**

**Negative case — deliberate mismatch.** Mutating source topic 21's title to
`'Day 7 build thread — Hardening'` (the exact historical defect) throws
`CourseMappingError` with:

```
Curriculum topic 21 is titled "Day 7 build thread — Hardening" but
MODULE_TITLES[6] makes it "Day 7 build thread — Webhooks and entitlements —
turning a payment into a durable fact". The two halves are authored in two files
and their agreement is the check — repair the export title or the module title,
do not derive one from the other. This is the defect this file recorded for
source topic 21 before TASK_2026_202 turned it into a build failure.
```

**Second negative case — separator.** Replacing the U+2014 separator in topic
15's title with a hyphen-minus also throws `CourseMappingError`. The separator is
genuinely load-bearing, not decorative.

**Positive cases.** Ten modules; slugs exactly `day-01`…`day-10`; `sortOrder`
`100…1000`; module titles `toEqual([...MODULE_TITLES])`; Day 1 and Day 10 lesson
titles pinned against **hand-written literals**, not `curriculumTopicTitle()`;
Day 10's title matches `/^Day \d{1,2} build thread — /` and **does not** match
`/^Day \d build thread — /` (the R1 trap, confirmed live); every slug matches
both `/^[a-z0-9]+(-[a-z0-9]+)*$/` and `/^day-(0[1-9]|10)$/`; every lesson
`createdAt` is `2026-08-10T00:00:00.000Z`.

---

## Verification results

| Command                                                             | Result                                                                                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npx nx typecheck ptah-license-server`                              | ✅ **GREEN**                                                                                                                |
| `npx nx run ptah-license-server:eslint:lint`                        | ✅ **GREEN** — 0 errors, 2 pre-existing warnings in `jest.config.ts` and `src/instrument.ts`, neither touched by this batch |
| `npx nx test ptah-license-server --testPathPatterns=community-seed` | ❌ **RED — 11 failed, 54 passed.** Expected; Batch 2                                                                        |

> ⚠️ `nx lint ptah-license-server` **does not exist** — the project's target is
> named `eslint:lint`. `tasks.md` names the wrong command in the Batch 1, 2 and 3
> verification blocks. Use `npx nx run ptah-license-server:"eslint:lint"`.

**Forum-half proof (stop condition 1).** Beyond `git diff`, I compared the nine
imported topics (ids 5, 23, 13, 14, 8, 9, 10, 4, 6) plus `categories`,
`exportedFrom` and `note` between `HEAD` and the working copy after
`JSON.parse`. All four comparisons returned **byte-identical**.
`community-seed.spec.ts` and `__fixtures__/` show **zero diff** — untouched.
The forum-half tests at `:446-463` and `:500` are among the 54 that pass.

---

## Now-failing spec assertions — Batch 2's starting list

11 tests fail. Jest stops at the **first** failing assertion per test, so this is
the _first_ line in each — Batch 2 will surface more inside the same tests
(`1004`, `1006`, `1036`, `1057-1059`, `1065`, `1206`, `1208-1209`) as it works
down. **Use plan §4.1 + §4.2 as the authority, not this list** — this is the
starting point, not the total.

| #   | Line   | Test                                                                                                              | Failure                                                                                                                                                                |
| --- | ------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `428`  | assertion 1: the census (MG-1.6) › _"the 17 source topics split into 8 curriculum + 9 imported, with no overlap"_ | `toHaveLength(8)` received `10`                                                                                                                                        |
| 2   | `1003` | curriculum course › _"writes 1 course, 8 modules and 8 lessons"_                                                  | `created: 8` received `10`                                                                                                                                             |
| 3   | `1030` | › _"CURRICULUM_TOPIC_IDS is now CONSUMED by a writer"_                                                            | `/^Week \d build thread — /` — 🔴 **this is R1's line**                                                                                                                |
| 4   | `1047` | › _"lays the modules out sparsely at 100…800"_                                                                    | slug list `'week-1'…'week-8'` vs `'day-01'…'day-10'`                                                                                                                   |
| 5   | `1110` | › _"takes the module titles from MG-1.5, not from the topic titles"_                                              | `modules.find(m => m.slug === 'week-7')` is `undefined`; expected title `'Hardening'`. 🔴 **This is the anti-vacuity witness — RE-FOUND per §4.4, do not delete (R4)** |
| 6   | `1118` | › _"leaves youtubeVideoId AND videoDurationSeconds null"_                                                         | `db.lessons.size` `toBe(8)` received `10`                                                                                                                              |
| 7   | `1148` | › _"writes lesson createdAt from the source topic, and NOT now()"_                                                | `lessonWrites` length `8` received `10`                                                                                                                                |
| 8   | `1168` | › _"does NOT stamp the course or its modules with a source instant"_                                              | `structural` length `9` received `11`                                                                                                                                  |
| 9   | `1205` | idempotency › _"a second run produces ZERO creates"_                                                              | `{ created: 0, updated: 8 }` received `updated: 10`. 🔴 **§9's table misses this — plan §4.2**                                                                         |
| 10  | `1385` | byte fidelity › _"preserves a LESSON body sensitive to every plausible transform"_                                | `stored` is `undefined` — `:1383`'s template literal has **two** `week-1` occurrences (`'week-1'` and `#week-1`)                                                       |
| 11  | `1528` | A-4 and the summary arithmetic › _"creates no User row while writing the curriculum"_                             | `db.lessons.size` `toBe(8)` received `10`. 🔴 **§9's table misses this — plan §4.2**                                                                                   |

**Passing and must stay passing** — the census tests at `:418` and `:465` are
constant-driven and already pass at 19/21/20; the forum-half tests at `:446-463`
and `:500` pass; `:1513-1518` (`MODULE_TITLES.length === CURRICULUM_TOPIC_IDS.length`)
passes.

---

## Incomplete / carried forward

1. **Nothing in Batch 1 is unfinished.** All five tasks are done and verified
   from disk.
2. **Two out-of-scope comment corrections were made** (`map-topics.ts`
   `buildTopicRows` docblock; `community-seed.ts:305-307`). Both were factually
   false after the census move. Both are comment-only. Called out above so the
   reviewer can revert either if the scope line matters more than the accuracy.
3. **The foreign `schema.prisma` + two migration folders + `.ptah/specs/TASK_2026_201/`
   are in this worktree and are not mine.** Do not stage them with this batch.
4. **`tasks.md` names a non-existent lint target** in all three batch
   verification blocks. Batches 2 and 3 will hit the same error.
5. Not run, by design: `seed-community` against a live database. That is Batch 2's
   FR-IDEM-1 exit gate and requires the suite to be green first.

---

## Team-Leader Verification

**Verdict**: ✅ **APPROVED AND COMMITTED**
**Commit**: `7257cbae1` — `feat(license-server): restructure seed curriculum into ten daily modules`
**Files in commit**: exactly the five in scope. `git show --name-only` confirms it.

Every claim below was re-derived from disk or from the staged blob, not taken from
the report.

### 1. Counts and order

`MODULE_TITLES.length === 10`, `CURRICULUM_TOPIC_IDS.length === 10`, and
`CURRICULUM_TOPIC_IDS` is exactly `[15, 16, 17, 18, 19, 20, 21, 22, 24, 25]` —
asserted live, not read. Census constants are 19 / 21 / 20 with
`EXPECTED_CATEGORY_COUNT` still 4; the export itself parses to **19 topics, 21
posts, 20 non-empty bodies, 4 categories, 19 unique slugs**.

### 2. The module table is C2's, not `task-description.md` §4's

All ten titles compared character-for-character against `context.md`'s AMENDED C2
table. All ten match, including the two that distinguish C2 from the dead §4:
Day 5 is `Projects and products — the aggregates and their contracts` (Products
folded in, not its own day), and Days 9–10 split the integration
(`Connecting an integration — OAuth and the token lifecycle` /
`Publish, fail, retry — and launch`).

### 3. Slugs

``const slug = `day-${String(index + 1).padStart(2, '0')}` `` — positional, derived
from the index, **not** `buildSlug()`. Built live: module slugs are exactly
`day-01`…`day-10`, lesson slugs equal them, `sortOrder` runs `100…1000`. Every
slug matches both `/^[a-z0-9]+(-[a-z0-9]+)*$/` and `/^day-(0[1-9]|10)$/`. Titles
are unpadded ("Day 1", "Day 10") — the asymmetry is intentional and documented.

### 4. FR-TITLE-2 guard — verified by execution, not by reading

The guard is in `buildCourseRows`, inside the `CURRICULUM_TOPIC_IDS.map(...)`
callback, after the `title === undefined` check and before the returned row, and
throws `CourseMappingError`. I did not take the report's word for it: I wrote my
own throwaway spec (`tl-verify.spec.ts`, run then **deleted** — it is not in the
commit) and ran it. **5 passed, 0 failed.** It proved:

- mutating source topic 21's title to `'Day 7 build thread — Hardening'` throws
  `CourseMappingError` matching `/Curriculum topic 21 is titled/`;
- replacing the U+2014 separator in topic 15 with a hyphen-minus also throws;
- Day 10's lesson title matches `/^Day \d{1,2} build thread — /` and **does not**
  match `/^Day \d build thread — /` — R1's trap, confirmed live;
- `'day-01'.startsWith('day-1') === false` — the padding actually closes the
  prefix trap;
- Day 1 and Day 10 lesson titles equal hand-written literals, not
  `curriculumTopicTitle()` output;
- `curriculumTopicTitle(i+1, MODULE_TITLES[i])` equals the export title for all ten.

### 5. Forum half — zero movement (stop condition 1)

Beyond `git diff`, I parsed `HEAD` and the working copy and compared by value:
the nine imported topics (ids 5, 23, 13, 14, 8, 9, 10, 4, 6), `categories`,
`exportedFrom` and `note` are all **identical**. The only top-level key added is
`curriculumNote`. The one empty-body post is still topic 13 post #2. The forum
test `writes 9 topics and 10 posts` (4 categories / 9 topics / 10 posts / 1
skipped) is among the passing 54. `community-seed.spec.ts` and `__fixtures__/`
show **zero diff** — neither was touched.

### 6. `createdAt`

`2026-08-10T00:00:00.000Z` on both topic and post for all ten, identical. Today
is 2026-08-11, so it is in the past at commit time. No U+FFFD, no CR, no BOM, no
trailing whitespace; the file round-trips byte-identically through
`JSON.stringify(obj, null, 2) + '\n'`.

### 7. Invariants held

No delete verb — the seed's `Delegate<TRow>` still exposes only
`findUnique`/`create`/`update`. `SORT_ORDER_STEP` is 100 and `course.sequential`
is `false`, both asserted at runtime. `IMPORTED_TOPIC_IDS` and
`SKIP_EMPTY_BODY_POSTS` are unchanged (stop condition 5). `community-seed.ts` is
comment-only: filtering `git diff -U0` to non-comment lines returns **nothing**
(stop condition 3).

### 8. Build and test

| Command                                                             | Result                                                                                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npx nx run ptah-license-server:typecheck`                          | ✅ GREEN (exit 0)                                                                                         |
| `npx nx run ptah-license-server:"eslint:lint"`                      | ✅ GREEN — 0 errors, 2 pre-existing warnings in `jest.config.ts` and `src/instrument.ts`, neither touched |
| `npx nx test ptah-license-server --testPathPatterns=community-seed` | ❌ **11 failed, 54 passed** — expected                                                                    |

The 11 failures are exactly the 11 the report names, by test name. **All are
spec-side**: each is a hardcoded `8`, `17` or `week-N` expectation left in
`community-seed.spec.ts`. None indicates a source defect — my independent spec
proved the source produces the correct ten-day shape against the same export.
Batch 2 owns that file and is next, so committing red here is the intended
sequence, not a shortcut. **No `--no-verify` was used; the pre-commit hook
(lint-staged + `ptah-electron:validate-deps`) passed on its own.**

### Two out-of-scope comment corrections — ACCEPTED

The developer flagged two comment-only edits beyond the named scope
(`map-topics.ts` `buildTopicRows` docblock; `community-seed.ts:305-307`). Both
statements were made **factually false** by the census move — "unique across all
17", and a list of literals that no longer matched the constants. Leaving a
knowingly-false comment to preserve a scope line would be the worse trade. Both
are comment-only and neither moves a constant. Kept.

### Notes carried to the orchestrator

1. **The worktree is shared and moved during verification.** The foreign
   `schema.prisma` modification and the two `20260911090*` migration folders were
   present when I started and had **vanished** by the time I staged — the
   TASK_2026_201 session reverted its own working tree. My five files were
   unaffected, and I re-verified the **staged blobs** (not just the disk files)
   before committing for exactly this reason. Nothing foreign entered the commit.
2. **`tasks.md` names a lint target that does not exist** in all three batch
   verification blocks. There is no `nx lint ptah-license-server`; the target is
   `eslint:lint`. Batches 2 and 3 will hit this. Use
   `npx nx run ptah-license-server:"eslint:lint"`.
3. `.ptah/specs/TASK_2026_202/` is untracked and was **not** committed, per the
   instruction to stage only the five source paths.
