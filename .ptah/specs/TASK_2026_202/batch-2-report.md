# Batch 2 report — The spec rewrite (TASK_2026_202)

**Executor**: `backend-developer` (sub-agent)
**Worktree**: `D:/projects/ptah-extension/.claude/worktrees/founding-cohort`
**Branch**: `ak/founding-cohort-free-access`
**File touched**: `apps/ptah-license-server/prisma/seed/community-seed.spec.ts` — **and nothing else**
**Status**: COMPLETE. Suite GREEN (70/70 in `community-seed`, 163/163 for the whole
project), typecheck green, lint green, Prettier clean, and the FR-IDEM-1 database
exit gate PASSED.
**Not committed.** The team-leader owns commits.

---

## 🔴 Read this first

### 1. No stop condition was tripped

| Stop condition                                          | Result                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1 — the forum half moves (`:446-463`, `:500`)           | ✅ NOT TRIPPED. Proven by hunk headers, below                              |
| 2 — a committed fixture needs editing                   | ✅ NOT TRIPPED. `git diff --stat -- __fixtures__` is **empty**             |
| 3 — a non-comment line changes in `community-seed.ts`   | ✅ NOT TRIPPED. File not opened for edit; `git status` shows it unmodified |
| 5 — `IMPORTED_TOPIC_IDS` / `SKIP_EMPTY_BODY_POSTS` diff | ✅ NOT TRIPPED. `map-topics.ts` unmodified                                 |

Batch 1's four source files (`map-course.ts`, `map-topics.ts`,
`discourse-export.schema.ts`, `community-seed.ts`) and `discourse-export.json` are
all at `7257cbae1` with **zero working-tree diff**. Two of them were temporarily
mutated for the mutation experiments below and restored byte-for-byte; `git status`
confirms.

### 2. The FR-IDEM-1 database gate was run WITHOUT resetting the shared database

`tasks.md`'s Batch 2 gate says `npx nx run ptah-license-server:prisma:reset`. I did
**not** run that. The `ptah_postgres` container in this environment was already up
and healthy (10 h uptime) alongside a running `ptah_license_server`, and the
TASK_2026_201 session is concurrently active in this same worktree with migrations
in flight. A `prisma:reset` would have destroyed state that is not mine.

Instead I created a throwaway database `ptah_seedgate` in the same container,
applied `prisma migrate deploy` to it, ran the seed twice against it, verified the
rows, and **dropped it**. Same evidence, no blast radius. Confirmed dropped:
`\l | grep -c seedgate` → `0`.

### 3. Three files in `git status` are NOT mine

`libs/api/licensing/.../license.service.ts`, `.../license.service.spec.ts` and
`libs/api/marketing/.../waitlist.service.ts` are TASK_2026_201 Batch 2. **Do not
stage them with this batch.** Stage `community-seed.spec.ts` by name.

### 4. `tasks.md` still names a lint target that does not exist

`nx lint ptah-license-server` — no such target, exactly as Batch 1 reported. The
real one is `npx nx run ptah-license-server:"eslint:lint"`. Batch 3's verification
block has the same error and will hit it.

---

## Every assertion changed, and its new value

Line numbers are **pre-edit** (the `7257cbae1` blob), matching the plan's tables.

### §4.1 — the plan's table, worked in full

| Line             | Kind         | Before                                                              | After                                                                                                                                                                |
| ---------------- | ------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 418              | test name    | `…4 categories, 17 topics and 19 posts`                             | `…4 categories, 19 topics and 21 posts`                                                                                                                              |
| 427              | test name    | `the 17 source topics split into 8 curriculum + 9 imported…`        | `the 19 source topics split into 10 curriculum + 9 imported…`                                                                                                        |
| 428              | assertion    | `expect(CURRICULUM_TOPIC_IDS).toHaveLength(8)`                      | `…toHaveLength(10)`                                                                                                                                                  |
| 429              | assertion    | `IMPORTED_TOPIC_IDS` `9`                                            | **unchanged**                                                                                                                                                        |
| 433-443          | assertion    | overlap + coverage                                                  | **unchanged** (and it is what proves ids 24/25 reached the export, not only the array)                                                                               |
| 446-463          | assertions   | forum half                                                          | **UNCHANGED — zero diff**                                                                                                                                            |
| 465              | test name    | `carries 18 non-empty source bodies…`                               | `carries 20 non-empty source bodies…`                                                                                                                                |
| 500              | assertion    | `expect(compared).toBe(10)`                                         | **UNCHANGED — zero diff**                                                                                                                                            |
| 988              | assertion    | `not.toMatch(/^week-\d/)`                                           | `not.toMatch(/^day-\d/)`                                                                                                                                             |
| 998              | test name    | `writes 1 course, 8 modules and 8 lessons…`                         | `writes 1 course, 10 modules and 10 lessons…`                                                                                                                        |
| 1003             | assertion    | `result.modules` `{ created: 8, updated: 0 }`                       | `{ created: 10, updated: 0 }`                                                                                                                                        |
| 1004             | assertion    | `result.lessons` `{ created: 8, updated: 0 }`                       | `{ created: 10, updated: 0 }`                                                                                                                                        |
| 1006-1007        | assertion    | `CURRICULUM_TOPIC_IDS.length`                                       | **unchanged** (generic)                                                                                                                                              |
| 1010-1012        | assertions   | community half inside the curriculum test                           | **unchanged**                                                                                                                                                        |
| 1024             | comment      | `the "Week N build thread — " prefix retained`                      | `the "Day N build thread — " prefix retained`                                                                                                                        |
| 1030             | 🔴 assertion | `toMatch(/^Week \d build thread — /)`                               | `toMatch(/^Day \d{1,2} build thread — /)` + a 4-line comment stating the FR-SLUG-3 rule                                                                              |
| 1036             | assertion    | `not.toMatch(/^week-\d/)`                                           | `not.toMatch(/^day-\d/)`                                                                                                                                             |
| 1040             | test name    | `…sparsely at 100…800…`                                             | `…sparsely at 100…1000…`                                                                                                                                             |
| 1047-1056        | assertion    | `'week-1' … 'week-8'` (8 literals)                                  | `'day-01' … 'day-10'` (10 literals)                                                                                                                                  |
| 1057-1059        | assertion    | `[100 … 800]`                                                       | `[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]`                                                                                                                |
| 1061             | assertion    | `SORT_ORDER_STEP` `toBe(100)`                                       | **unchanged**                                                                                                                                                        |
| 1065             | 🔴 assertion | `toMatch(/^week-[1-8]$/)`                                           | `toMatch(/^day-(0[1-9]\|10)$/)` + comment on why not `\d{1,2}`                                                                                                       |
| 1075-1097        | assertions   | course row + resolved cohort key                                    | **unchanged**                                                                                                                                                        |
| 1099-1113        | 🔴 test      | the anti-vacuity witness                                            | **RE-FOUNDED — see the dedicated section**                                                                                                                           |
| 1118             | assertion    | `db.lessons.size` `toBe(8)`                                         | `toBe(10)`                                                                                                                                                           |
| 1148             | assertion    | `lessonWrites` `toHaveLength(8)`                                    | `toHaveLength(10)`                                                                                                                                                   |
| 1162             | comment      | `from eight threads written across three weeks`                     | `from ten sessions authored in one editorial pass`                                                                                                                   |
| 1168             | assertion    | `structural` `toHaveLength(9)`                                      | `toHaveLength(11)` + `// 1 course + 10 modules.`                                                                                                                     |
| 1344             | assertion    | `CURRICULUM_TOPIC_IDS.length`                                       | **unchanged** (generic)                                                                                                                                              |
| 1351             | comment      | `The eight curriculum bodies are no different`                      | `The ten curriculum bodies are no different`                                                                                                                         |
| 1365, 1401, 1431 | code         | `CURRICULUM_TOPIC_IDS[0]` / `[3]`                                   | **unchanged** (index-based)                                                                                                                                          |
| 1383             | 🔴 code      | `'week-1'` **and** `#week-1` in ONE template literal                | `'day-01'` **and** `#day-01`, plus a new 3-line comment naming the two-occurrence trap so the next rename does not half-land                                         |
| 1513-1518        | assertions   | `MODULE_TITLES.length === CURRICULUM_TOPIC_IDS.length`              | **unchanged**                                                                                                                                                        |
| 1540-1542        | assertion    | computed                                                            | **unchanged**                                                                                                                                                        |
| 1543-1544        | comment      | `19 = 10 written + 1 skipped + 8 curriculum, NOT the plan's 11 + 8` | `21 = 10 written + 1 skipped + 10 curriculum, NOT the plan's 11 + 10`, plus a sentence recording that `10 written` / `1 skipped` are the FORUM half and did not move |
| 1545-1547        | assertion    | the `summary.assertions[1]` literal                                 | **unchanged** — already computed off `EXPECTED_POST_COUNT` and `CURRICULUM_TOPIC_IDS.length`                                                                         |
| 1565             | test name    | `reports 18 bodies imported…`                                       | `reports 20 bodies imported…`                                                                                                                                        |
| 1568-1590        | assertions   | constant-driven                                                     | **unchanged**                                                                                                                                                        |

### §4.2 — the six §9 misses

| Line      | Kind                   | Before                                                               | After                                                                      |
| --------- | ---------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1205      | assertion              | `second.modules` `{ created: 0, updated: 8 }`                        | `updated: 10`                                                              |
| 1206      | assertion              | `second.lessons` `{ created: 0, updated: 8 }`                        | `updated: 10`                                                              |
| 1208      | assertion              | `db.modules.size` `toBe(8)`                                          | `toBe(10)`                                                                 |
| 1209      | assertion              | `db.lessons.size` `toBe(8)`                                          | `toBe(10)`                                                                 |
| 1417-1418 | comment                | `17 non-empty bodies where EXPECTED_NON_EMPTY_BODY_POSTS demands 18` | `19 … demands 20`                                                          |
| 1525      | comment                | `now with 17 more writes to do it in`                                | `now with 21 more writes to do it in (1 course + 10 modules + 10 lessons)` |
| 1528      | assertion              | `db.lessons.size` `toBe(8)`                                          | `toBe(10)`                                                                 |
| 652, 1497 | mojibake probe strings | `Ptah … week one`                                                    | **LEFT ALONE**, per the plan                                               |

Confirmed by `git diff`: there is **no hunk at 652 or 1497**.

### Recomputed literal counts — nothing weakened to a tautology

Every literal that moved was **recomputed**, never deleted or replaced with a
generic expression:

- `source topics 19 = 10 curriculum + 9 forum` — asserted at `:1540-1542`, still
  computed on both sides, and confirmed live by the seed run (`assertions: source
topics 19 = 10 curriculum + 9 topics OK`).
- `source posts 21 = 10 written + 1 skipped + 10 curriculum` — asserted at
  `:1545-1547`, confirmed live (`assertions: source posts 21 = 10 written + 1
skipped (empty source body) + 10 curriculum bodies OK`).
- bodies `20/20` — `:1568-1573`, confirmed live (`bodies: 20/20 imported from
\`raw\`; 0 transformed`).
- structural writes `11` = 1 course + 10 modules — a **hand-written literal**, not
  `1 + CURRICULUM_TOPIC_IDS.length`, deliberately: the whole point of `:1168` is a
  second, independent count.

The byte-fidelity assertions were not touched at all: `:494-496` (forum, buffer
comparison against `raw`), `:500` (`compared toBe(10)`), `:1332-1341` (lesson body
compared as UTF-8 buffers both at the mapper and at the writer), `:1344`
(`compared toBe(CURRICULUM_TOPIC_IDS.length)`), and both hostile-body tests. No
trim, no re-wrap, no normalisation was introduced anywhere.

### Four comment/name corrections beyond the plan's list — flagged for review

The plan's tables do not name these four. Each was made **factually false** by the
census move, and each is comment- or test-name-only — no assertion changed.

| Line | Was                                                                                  | Now                                 | Why                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 507  | `not one of the export's **18** non-empty bodies has leading or trailing whitespace` | `**20**`                            | Export census moved. The claim itself is still true (all ten new curriculum bodies begin `**` and end `.`) — only the number was stale |
| 848  | test name `…counting all **19** source posts`                                        | `…counting all **21** source posts` | The body is `EXPECTED_POST_COUNT`-driven and passed either way; only the name lied                                                     |
| 1429 | `keeping the non-empty total at **18**`                                              | `**20**`                            | Same sentence as `:1418`, two lines of setup later; the plan caught one and not the other                                              |
| 1543 | `NOT the plan's 11 + **8**`                                                          | `NOT the plan's 11 + **10**`        | Part of the `:1543-1544` comment the plan does list; the trailing clause is the same arithmetic                                        |

The `37` in the `:507` and `:1349` docblocks was left alone on purpose: it records
the size of a **past** experiment (Batch 6/8's `.trim()` mutation), not a current
census, so it is history rather than a stale fact.

Revert any of the four if the scope line matters more than the accuracy — none is
load-bearing.

---

## The Day-10 trap: explicit evidence it is closed

### The assertions

- Titles (unpadded, `Day 1` … `Day 10`) → `/^Day \d{1,2} build thread — /` at the
  `:1030` loop, at the tripwire, and inside the re-founded witness
  (`not.toMatch(/^Day \d{1,2} build thread/)`).
- Slugs (padded, `day-01` … `day-10`) → `/^day-(0[1-9]|10)$/` at `:1065` and in the
  new charset test. `\d{1,2}` was **deliberately not used** for slugs: it would also
  admit an unpadded `day-1` this seed must never emit, and the comment says so.
- Export slugs → `/^day-(0[1-9]|10)-build-thread-/`.

### The new tripwire test

`community seed — MG-1 › curriculum course — counts and the consumed split (MG-1.5)
› Day 10 is covered by the title regex — the one-digit form is NOT`

It asserts on `modules[9]` — the Day-10 row specifically, not "every module", so
the failure names the day:

- `dayTen.lesson.title` **matches** `/^Day \d{1,2} build thread — /`
- `dayTen.lesson.title` **does not match** `/^Day \d build thread — /` ← the tripwire
- `dayTen.slug` is `'day-10'`
- the plan's prefix-trap pair: `'day-1'.startsWith('day-1') && 'day-10'.startsWith('day-1')` is `true`
- …plus two **non-tautological** additions against the real slugs, because the pair
  above is true by inspection: `modules.filter(m => m.slug.startsWith('day-01'))`
  has length 1, and `…startsWith('day-1')` also has length 1. Under the unpadded
  scheme the second would have been 2. That is the padding earning its keep.

### 🔴 Proof by execution, not by reading

I narrowed the `:1030` quantifier back to the naive `/^Day \d build thread — /`,
ran the suite, and restored it. Result:

```
Tests: 1 failed, 69 passed, 70 total
  Expected pattern: /^Day \d build thread — /
  Received string:  "Day 10 build thread — Publish, fail, retry — and launch"
```

Exactly one of the ten titles fails, and it is Day 10 — which is precisely why R1
reads as a data defect. The trap is live, and the tripwire holds it closed.

---

## The re-founded anti-vacuity witness

**It was re-founded, not deleted.** The test still exists at the same place in the
same describe block, renamed to
`takes the module titles from the table, and a module title is never its lesson title`.

### The old basis, and why it had to go

The old witness leaned on a real divergence: source topic 21 read `Week 7 build
thread — Hardening — tests, policies, observability` while `MODULE_TITLES[6]` read
only `Hardening`. No derivation from the source title produces `Hardening`, so the
table was **provably** editorial. Batch 1's FR-TITLE-1 repaired exactly that
defect, so the divergence is gone by design and the old three assertions
(`modules.find(m => m.slug === 'week-7')`, `toBe('Hardening')`,
`toContain('tests, policies, observability')`) are now unsatisfiable.

### The new basis — the prefix asymmetry, true for all ten by design

```ts
expect(modules.map((m) => m.title)).toEqual([...MODULE_TITLES]);
expect(modules).toHaveLength(10);
modules.forEach((m, i) => {
  expect(m.lesson.title).not.toBe(m.title);
  expect(m.lesson.title).toBe(`Day ${i + 1} build thread — ${m.title}`);
  expect(m.title).not.toMatch(/^Day \d{1,2} build thread/);
});
```

The lesson title keeps the `Day N build thread — ` prefix; the module title never
carries it. That holds for all ten and cannot be repaired away.

### The honest "now weaker, and why" docblock

A 26-line docblock sits above the test. It states, in the file's own voice: what
the old witness proved; that TASK*2026_202 removed its basis; that deleting the
test with the defect would quietly lose the guard (R4); and — under a
`⚠️ WHAT THIS NO LONGER PROVES` heading — that after FR-TITLE-1 a derivation
`source.title.slice('Day N build thread — '.length)` **would** produce the right
answer, so the surviving property is only the weaker *"a module title is not a COPY
of its source title"\_. It names FR-TITLE-2 in `buildCourseRows` as the compensating
control — two halves authored in two files whose agreement is now a build failure
rather than a hope — and points at the new mismatch-abort test as where that guard
is exercised.

### 🔴 Proof it still fails on a vacuous implementation

Reading a test cannot show it is load-bearing, so I mutated the source. In
`map-course.ts` I changed the module row from `title` (the table) to
`title: source.title` — the exact vacuous "copy the source title" implementation
the witness exists to reject — ran the suite, and restored the file.

```
● community seed — MG-1 › curriculum course — counts and the consumed split (MG-1.5)
  › takes the module titles from the table, and a module title is never its lesson title
Tests: 1 failed, 69 passed, 70 total
```

**One test failed, and it was the witness.** Nothing else in the 70 catches that
implementation — including the `toEqual([...MODULE_TITLES])` line, which the copy
also satisfies at the moment the export and the table agree. That is the anti-vacuity
property, demonstrated rather than asserted. `map-course.ts` was restored
byte-for-byte; `git status` shows it unmodified.

---

## The forum half — byte-identical, proven mechanically

`git diff -U0` produces 33 hunks. Their pre-image line ranges are:

```
418 · 427-428 · 465 · 507 · 848 · 988 · 998 · 1003-1004 · 1024 · 1030 · 1036 ·
1040 · 1048-1055 · 1058 · 1065 · 1099 · 1104-1112 · 1118 · 1148 · 1162 · 1168 ·
1205-1206 · 1208-1209 · 1351 · 1381 · 1383 · 1417-1418 · 1429 · 1460 · 1525 ·
1528 · 1543-1544 · 1565
```

- **No hunk falls in `446-463`.** The diff jumps 427-428 → 465.
- **No hunk touches `500`.** The diff jumps 465 → 507.

So `expect(result.categories).toEqual({ created: 4, updated: 0 })`,
`result.topics` `9`, `result.posts` `10`, the single
`skippedEmptyBodies` entry, `db.categories.size` `4` / `db.topics.size` `9` /
`db.posts.size` `10`, and `expect(compared).toBe(10)` are **character-for-character
what `7257cbae1` committed**. The adjacent forum-half assertions the plan did not
list are equally untouched — `:575` `expect(rowWrites).toHaveLength(19); // 9 topics

- 10 posts`still reads`19`, correctly, because `9 + 10` did not move.

Live confirmation from the database gate: `categories: created 4`, `topics: created
9`, `posts: created 10`, one skipped empty body.

---

## New tests added (5)

All five are in `community-seed.spec.ts`; the suite went 65 → 70.

| Describe                               | Test                                                                                      | Covers                |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------- |
| counts and the consumed split (MG-1.5) | `Day 10 is covered by the title regex — the one-digit form is NOT`                        | §4.3, R1, FR-SLUG-3   |
| counts and the consumed split (MG-1.5) | `titles the Day 1 and Day 10 lessons exactly, checked against literals not the helper`    | FR-TITLE-1 positive   |
| counts and the consumed split (MG-1.5) | `emits module slugs that conform to the forum slug character set — verified, not assumed` | FR-SLUG-1             |
| counts and the consumed split (MG-1.5) | `the ten curriculum export slugs are well formed and unique across all 19`                | FR-SLUG-1 / FR-SLUG-2 |
| the aborts (MG-1.2, RK-9)              | `aborts when an export title and MODULE_TITLES disagree, writing and reading nothing`     | FR-TITLE-2 negative   |

Two notes on how they are written:

1. **`curriculumTopicTitle()` is never called by the spec.** The plan warns that a
   test whose only oracle is the mapper's own helper cannot detect a wrong prefix.
   The FR-TITLE-1 test pins `modules[0].lesson.title` and `modules[9].lesson.title`
   against **hand-written string literals**:
   `'Day 1 build thread — The workspace — monorepo, boundaries, first green CI'`
   and `'Day 10 build thread — Publish, fail, retry — and launch'`. Verified live
   against the seeded database, above.
2. **The FR-TITLE-2 negative has the `:1425-1459` shape**: it mutates one
   curriculum title via `fixtureFromExport` (topic 21 → `'Day 7 build thread —
Hardening'`, the historical defect restored on purpose), then asserts
   `CourseMappingError`, the message naming the topic, `db.writes()` empty, **zero
   `open` calls** (so no transaction was ever started), and all three curriculum
   maps empty.

---

## Verification results

| Command                                                                             | Result                                                                                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npx nx test ptah-license-server --skip-nx-cache --testPathPatterns=community-seed` | ✅ **70 passed, 0 failed**                                                                                |
| `npx nx test ptah-license-server --skip-nx-cache`                                   | ✅ **5 suites, 163 tests, all passed**                                                                    |
| `npx nx run ptah-license-server:typecheck`                                          | ✅ **GREEN (exit 0)**                                                                                     |
| `npx nx run ptah-license-server:"eslint:lint"`                                      | ✅ **GREEN — 0 errors**, 2 pre-existing warnings (`jest.config.ts`, `src/instrument.ts`), neither touched |
| `npx prettier --check …/community-seed.spec.ts`                                     | ✅ **clean** (ran `--write` once mid-batch; re-verified after)                                            |
| `git diff --stat -- …/prisma/seed/__fixtures__`                                     | ✅ **EMPTY** — FR-TEST-1 holds, no committed fixture needed editing                                       |
| `git diff` on `:446-463` and `:500`                                                 | ✅ **zero diff**                                                                                          |

`nx lint ptah-license-server` was **not** run — it does not exist. See note 4 above.

### The FR-IDEM-1 exit gate (Requirement 3.1, 4.5) — PASSED

Against `ptah_seedgate`, a throwaway database in the running `ptah_postgres`
container, created and dropped by this batch (see note 2 for why not `prisma:reset`).
`prisma migrate deploy` applied every migration; a default `member_groups` row
(`founding`, `is_default = t`) came from the migrations.

**Run 1** — exit 0:

```
categories:  created 4  updated 0
topics:      created 9  updated 0
posts:       created 10 updated 0
courses:     created 1  updated 0
modules:     created 10 updated 0
lessons:     created 10 updated 0
bodies: 20/20 imported from `raw`; 0 transformed
assertions: source topics 19 = 10 curriculum + 9 topics OK
assertions: source posts 21 = 10 written + 1 skipped (empty source body) + 10 curriculum bodies OK
```

1 course / 10 modules / 10 lessons created, **0 updated**, and both computed
assertion lines read `OK`. ✅

**Run 2** — exit 0:

```
categories:  created 0  updated 4
topics:      created 0  updated 9
posts:       created 0  updated 10
courses:     created 0  updated 1
modules:     created 0  updated 10
lessons:     created 0  updated 10
```

**Zero creates on all six entity lines.** ✅

**Persisted rows** (read back with `psql`, not inferred):

- `course_modules`: slugs `day-01 … day-10`, `sort_order` `100, 200, … 1000`, titles
  exactly `MODULE_TITLES`, and **`release_at IS NULL` on all ten** — C5, open by
  default, and the seed remains a non-writer of that column.
- `course_lessons`: slugs `day-01 … day-10`, titles `Day 1 build thread — …`
  through `Day 10 build thread — Publish, fail, retry — and launch` — the unpadded
  title / padded slug asymmetry confirmed in the database, not only in the mapper.

Throwaway database dropped afterwards; `\l | grep -c seedgate` → `0`.

---

## Definition-of-Done lines this batch closes

- [x] The Day-10 regex tripwire exists and asserts the naive `\d` form FAILS
- [x] The anti-vacuity witness is RE-FOUNDED, with the honest "now weaker, and why" note
- [x] `community-seed.spec.ts` green; forum-half assertions show **zero diff**; no committed fixture edited
- [x] `seed-community` exits 0 twice in a row, second run **0 creates**

---

## Incomplete / carried forward

1. **Nothing in Batch 2 is unfinished.** All three tasks are done and every gate,
   including the database one, was run.
2. **Four comment/test-name corrections beyond the plan's tables** (`:507`, `:848`,
   `:1429`, and the trailing clause of `:1543`). All comment- or name-only; all
   listed above with their justification. Revert freely if the scope line matters
   more.
3. **`prisma:reset` was deliberately not run.** The gate was met on a throwaway
   database instead, for the reason in note 2. If the team-leader wants the literal
   `prisma:reset` path, it should be run when no other session holds the container.
4. **`tasks.md` names a non-existent lint target** in the Batch 2 and Batch 3
   verification blocks. Batch 3 will hit it. Use
   `npx nx run ptah-license-server:"eslint:lint"`.
5. **`libs/api/licensing` and `libs/api/marketing` modifications are TASK_2026_201's**
   and were excluded from every assessment here. I did not read, edit, stage or
   revert them.
6. Batch 3 (C4 scheduling) is untouched and remains independent of this batch.

---

## Team-Leader Verification

**Verdict: PASS.** Committed as `bf73ba610` —
`test(license-server): cover the ten-day curriculum and close the day-10 regex trap`.
One file staged by name; 232 insertions, 52 deletions.

Nothing in the report was taken on trust. Every claim below was re-proven here.

### 1. The Day-10 regex trap is closed — re-proven by mutation

Not read, executed. I narrowed the `:1034` quantifier from `\d{1,2}` back to the
naive `\d`, ran the suite, and restored the file:

```
Tests: 1 failed, 69 passed, 70 total
Received string: "Day 10 build thread — Publish, fail, retry — and launch"
```

Exactly one title fails and it is Day 10 — the trap is live and the assertion is
load-bearing. The explicit Day-10 case exists as its own test
(`Day 10 is covered by the title regex — the one-digit form is NOT`), asserting on
`modules[9]` specifically with `not.toMatch(/^Day \d build thread — /)`, so it is a
permanent tripwire rather than a property of the loop. Title regexes take
`\d{1,2}`; slug regexes take `/^day-(0[1-9]|10)$/`. FR-SLUG-3 holds.

### 2. The witness was re-founded, and the new basis is independently load-bearing

Two mutations, because one was not sufficient to answer the question.

**Mutation A — the vacuous copy** (`title,` → `title: source.title` in the returned
module row, leaving the FR-TITLE-2 guard's local intact): `1 failed, 69 passed`,
and the failure is the witness. The witness does fail against a vacuous
implementation, as required.

**Mutation B — lesson title loses its prefix** (`title: source.title` → `title` in
the lesson row): `4 failed, 66 passed`. The witness fails at
`community-seed.spec.ts:1144`, `expect(m.lesson.title).not.toBe(m.title)` — which is
exactly the `module.title !== module.lesson.title` property §4.4 requires, firing on
a defect `toEqual([...MODULE_TITLES])` cannot see. The re-founding is real, not
cosmetic.

**One correction to the report.** It claims the vacuous copy "also satisfies" the
`toEqual([...MODULE_TITLES])` line. That is false: under Mutation A `toEqual` fails
first at `:1140` and Jest short-circuits, so the new `forEach` basis never executes.
The report's conclusion survives — the witness fails, and Mutation B shows the new
basis catches what `toEqual` cannot — but the stated reasoning overstated the case.
No code change needed; recorded so the next reader is not misled.

### 3. No assertion weakened to a tautology

Constants re-derived from the real export rather than from the report: `node` over
`docs/community/discourse-export.json` → `categories 4, topics 19, posts 21,
nonEmpty 20`, matching `EXPECTED_CATEGORY_COUNT/TOPIC/POST/NON_EMPTY` in
`discourse-export.schema.ts` exactly. The arithmetic holds: 19 = 10 + 9,
21 = 10 + 1 + 10, 20/20 bodies. Byte-fidelity survives untouched — `:494-496`
Buffer comparison, `:500` `compared toBe(10)`, `:1478`
`compared toBe(CURRICULUM_TOPIC_IDS.length)`. `structural toHaveLength(11)` is a
hand-written literal, correctly kept as an independent second count.

### 4. The forum half is byte-identical — proven mechanically

`git diff -U0` hunk headers jump 427-428 → 465 → 507. **No hunk falls in 446-463 and
none touches 500.** Read the block directly to confirm: 4 categories, 9 topics,
10 posts, the single `start-here-how-this-cohort-works` skipped body. Stop condition
1 not tripped.

### 5. No committed fixture changed

`git diff --stat -- .../prisma/seed/__fixtures__` is empty. FR-TEST-1 holds.

### 6. Re-keying complete

`'week-1'` → `'day-01'` throughout, including both occurrences in the
`${moduleId}#${lessonSlug}` template literal. The only surviving `week` strings are
the two mojibake probes at `:652` and `:1674` (`Ptah … week one`), which the plan
explicitly leaves alone — they are U+FFFD probe payloads, not slugs.

### 7. Gates

| Gate                                              | Result                                                      |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `npx nx test ptah-license-server --skip-nx-cache` | ✅ 5 suites, **163/163**, `community-seed` 70/70            |
| `npx nx run ptah-license-server:typecheck`        | ✅ green                                                    |
| `npx nx run ptah-license-server:"eslint:lint"`    | ✅ **0 errors**, 2 pre-existing warnings in untouched files |
| `npx prettier --check` on the spec                | ✅ clean                                                    |

`nx lint ptah-license-server` **does not exist** — confirmed independently. This is a
`tasks.md` defect, not a batch failure, and it recurs in Batch 3's verification
block. The real target is `eslint:lint`.

### 8. The FR-IDEM-1 evidence is sufficient — the throwaway database was the right call

Accepted, on the spec's own wording. `task-description.md` §8 states FR-IDEM-1
"against a **fresh** database". A new database with `prisma migrate deploy` applied
_is_ that fresh database; `prisma:reset` on the shared container would have produced
the same precondition while destroying a concurrently active session's state.
Equivalent evidence, no blast radius — correct shared-worktree discipline, and the
database was confirmed dropped.

The scenario a fresh database cannot exercise — re-seeding over an existing 8-week
course, which orphans `week-1`…`week-8` alongside the new rows and renders 18 modules
— is **out of scope by design**, not an evidence gap: the seed exposes no delete verb
(FR-IDEM-2), §8 documents the overlay behaviour, risk item 4 records that no
environment currently holds the 8-week course, and the cleanup runbook is tracked as
**Task 3.8** in Batch 3. It is not lost.

### Scope note

The four comment/test-name corrections beyond the plan's tables (`:507`, `:848`,
`:1429`, the trailing clause of `:1543`) are **kept**. Each was made factually false
by the census move; all are comment- or name-only and change no assertion. Leaving
stale numbers in place to honour a scope line would be the worse trade.

`libs/api/licensing` and `libs/api/marketing` were neither read, staged nor reverted.
TASK_2026_201 committed them independently as `79a735f65` during this verification.

**Batch 3 (C4 — reusable cohort scheduling) is unblocked.**
