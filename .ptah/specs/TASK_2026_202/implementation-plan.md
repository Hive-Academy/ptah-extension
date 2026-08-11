# Implementation Plan — TASK_2026_202

Curriculum restructure: 8 weekly modules → 10-day intensive, plus C4 reusable
cohort scheduling.

**Contract precedence.** `context.md`'s `## Checkpoint 1 outcomes` (C1–C5)
AMENDS `task-description.md`. Where they disagree, C1–C5 win. In particular
`task-description.md` §4's module table is DEAD — the amended 10-module table in
`context.md:122-133` is the one that ships.

---

## 0. Investigation summary — what was read, and what it settled

| Question | Answer | Evidence |
| --- | --- | --- |
| Where do the 8 curriculum topics live? | One contiguous block | `docs/community/discourse-export.json:201-344` (ids 15…22) |
| Highest allocated topic id | **23** (`welcome-to-the-ptah-community`), and it is the LAST topic in the file | `discourse-export.json:346` |
| Is the length guard real? | Yes, throws before any DB work | `map-course.ts:194-200`; proven by `community-seed.spec.ts:1455-1458` (`db.writes()` empty, transaction never opened) |
| Does the seed have a delete verb? | No — `findUnique`/`create`/`update` only | `community-seed.ts:105-109` |
| Does the seed write `releaseAt`? | No, on either branch | `community-seed.ts:589-592` (module update payload), `:518-528` (the reason) |
| Is `ModuleLockService` touched? | **No.** Two rules, both already correct for daily cadence | `module-lock.service.ts:101-139` |
| Does an admin UI exist for courses? | **No.** `libs/web/admin` has no course surface | Repo scan — `libs/api-contracts/community` has the contracts, no web consumer |
| Is a date/timezone library available? | `temporal-polyfill@^1.0.2` is in `dependencies` and is **imported nowhere** | `package.json:187` |
| What guards a new route? | Four censuses, all exact-equality or list-equality | `route-map.spec.ts:271` (`EXPECTED_ROUTES`), `controller-validation.spec.ts:272` (`MIN_TOTAL_PAYLOAD_PARAMS = 78`), `:298` (`NAMED_PRIMITIVE_PARAM_COUNT = 6`), `nullable-dto.spec.ts:73` (`EXPECTED_NULLABLE_OPTIONALS`) |
| What is the precedent for a bulk, course-scoped, audited write? | `ReorderService` — pure arithmetic in `common/sort-order.ts`, DB + transaction + one audit row in the service | `reorder.service.ts:15-59`, `:146-195` |

### 🔴 Finding 0 — `task-description.md` §10's FR-DATE-2 offset table is WRONG for the founder's start date

FR-DATE-2 states the offsets as a fixed list: *"Day 1 = start, Days 2–5 = +1…+4
days, Day 6 = +7 … Day 10 = +11"*. That table is correct **only for a Monday
start**. C3 fixes the start at **Tuesday 1 September 2026** (verified: 1 Jan 2026
is a Thursday, day-of-year 244 ⇒ Tuesday). The real offsets are therefore
`+0, +1, +2, +3, +6, +7, +8, +9, +10, +13`, and Day 10 lands on **Monday 14
September 2026** — which is exactly the orphan-Monday consequence `context.md`
C3 already records and accepts.

Shipping FR-DATE-2's literal table into the docblock would hand an operator ten
dates that are silently one day early from Day 5 onward. **The offsets are a
function of the start weekday, not a constant.** §5 below replaces the fixed
table with the rule plus two worked tables (Monday case, and the founder's
actual Tuesday case), and the whole point of C4 is that nobody ever has to read
either.

### Finding 1 — `task-description.md` §9 enumerates the spec changes INCOMPLETELY

Six live assertions and comments outside §9's table encode the 8-week shape.
They are listed in §4.2 below. A developer who works §9's table and stops will
leave a red suite and conclude the change is bigger than it is.

---

## 1. Content plan — `docs/community/discourse-export.json`

### 1.1 Id allocation

`CURRICULUM_TOPIC_IDS` becomes:

```ts
export const CURRICULUM_TOPIC_IDS: readonly number[] = [
  15, 16, 17, 18, 19, 20, 21, 22, 24, 25,
] as const;
```

Ids 15…22 are **rewritten in place** (title, slug, body, `createdAt`); **24 and
25 are new** — 23 is taken (§5 of the task description says allocate the next
free ids). Physical placement: the two new topic objects go immediately after
topic 22, so the ten curriculum topics stay one contiguous block in day order.

⚠️ **Consequence, recorded rather than fixed:** file order is then
`… 22, 24, 25, 23`, i.e. ids no longer ascend. Nothing asserts ascending order
(`community-seed.spec.ts:439` sorts before comparing; the mappers build a
`Map` by id), and moving topic 23 would be a forum-half edit — which §3's
blast-radius rule forbids. Day order beats numeric order for a human reading
the curriculum block.

### 1.2 The ten topic objects

For each index `i` (0-based), `n = i + 1`:

- `id`: per §1.1
- `title`: `` `Day ${n} build thread — ${MODULE_TITLES[i]}` `` — **this equality is
  the FR-TITLE-1 contract and is mechanically enforced in §2.4.** The separator
  is space + U+2014 EM DASH + space. A hyphen-minus here fails the seed.
- `slug`: per §1.3
- `categoryId`: `5`, `categoryName`: `"Builders Lounge"` (unchanged — the
  curriculum topics keep their source category; `map-categories.ts` never reads
  `topic_count`, so adding two topics to category 5 changes nothing there)
- `pinned`: `false`
- `createdAt`: `"2026-08-10T00:00:00.000Z"` — see §1.5
- `posts`: exactly one, `postNumber: 1`, `username: "system"`,
  `createdAt: "2026-08-10T00:00:00.000Z"`, `raw` per §1.4
- **`cooked`: OMITTED on all ten** — see §1.6

| n | id | Module title (= `MODULE_TITLES[n-1]`) |
| --- | --- | --- |
| 1 | 15 | The workspace — monorepo, boundaries, first green CI |
| 2 | 16 | The database and the deploy pipe — Postgres, migrations, staging on merge |
| 3 | 17 | Sign-up, sign-in, session |
| 4 | 18 | Users, organisations and the tenancy boundary |
| 5 | 19 | Projects and products — the aggregates and their contracts |
| 6 | 20 | Checkout — plans, prices and the first paid subscription |
| 7 | 21 | Webhooks and entitlements — turning a payment into a durable fact |
| 8 | 22 | The agent in the product — tools, streaming and cost control |
| 9 | 24 | Connecting an integration — OAuth and the token lifecycle |
| 10 | 25 | Publish, fail, retry — and launch |

Titles are taken verbatim from `context.md:122-133`. The one-line "What gets
built" column of that table is NOT authored into any file — §3 of the task
description forbids lesson body authoring, and the thread-shell body in §1.4 is
what ships.

### 1.3 Export topic slugs (FR-SLUG-2)

`day-NN-build-thread-<kebab of the descriptive half>`. All ten satisfy
`/^[a-z0-9]+(-[a-z0-9]+)*$/` (`discourse-export.schema.ts:95-101`) and are unique
across all 19 topics (`:145-148`):

```
day-01-build-thread-the-workspace-monorepo-boundaries-first-green-ci
day-02-build-thread-the-database-and-the-deploy-pipe-postgres-migrations-staging-on-merge
day-03-build-thread-sign-up-sign-in-session
day-04-build-thread-users-organisations-and-the-tenancy-boundary
day-05-build-thread-projects-and-products-the-aggregates-and-their-contracts
day-06-build-thread-checkout-plans-prices-and-the-first-paid-subscription
day-07-build-thread-webhooks-and-entitlements-turning-a-payment-into-a-durable-fact
day-08-build-thread-the-agent-in-the-product-tools-streaming-and-cost-control
day-09-build-thread-connecting-an-integration-oauth-and-the-token-lifecycle
day-10-build-thread-publish-fail-retry-and-launch
```

Kebab rule applied: lowercase, em dashes and commas dropped, spaces → single
hyphen, no double hyphens, no leading/trailing hyphen. Disjoint from the nine
forum slugs. **These are never written to the database for curriculum topics**
— they exist so the export's own uniqueness invariant holds.

### 1.4 The reused thread-shell body

Verbatim reuse of the existing shell (`discourse-export.json:214`), with exactly
two edits: the bold header line, and `this week` → `this session`.

```
**Day 1: The workspace — monorepo, boundaries, first green CI**

Post here as you work through this session.

- What you shipped
- What broke, and what the error actually said
- Anything you want reviewed before it merges

Screenshots and diffs welcome. If you are behind, say so — the point is
to finish, not to keep pace with a schedule.
```

- Header line is `**Day ${n}: ${MODULE_TITLES[n-1]}**` — a colon, not the title's
  em-dash separator, matching today's shell.
- Non-empty ⇒ clears `map-course.ts:236-242`'s abort and
  `EXPECTED_NON_EMPTY_BODY_POSTS`.
- ⚠️ **Every em dash must be a real U+2014 in UTF-8.** An editor that writes
  CP1252 injects U+FFFD and `discourse-export.schema.ts:76-81` rejects the file
  before the transaction opens. This is the mojibake control doing its job, but
  it will look like an unrelated failure. Save as UTF-8 without BOM.
- This body IS the lesson body (`map-course.ts:261`), copied byte-for-byte, so
  it must contain no trailing whitespace and no CR.

### 1.5 `createdAt` (Requirement 5.3)

**One fixed instant for all ten: `2026-08-10T00:00:00.000Z`**, on both the topic
and its post.

- Already in the past at commit time, with a full day of margin —
  `community-seed.spec.ts:1142` asserts lesson `createdAt` is strictly before
  test start, so a same-day-to-the-hour instant would be flaky on a fast CI clock.
- 2026-08-10 is when this restructure was opened. It is the honest authoring
  instant for all ten, per Requirement 5.3 — not the 2026-08-01 capture instant,
  because this pass rewrites the title and body of every one of them.
- **Identical across all ten, deliberately.** Ascending fake instants would
  imply a drafting sequence that did not happen.

### 1.6 `cooked` is dropped, and the export declares itself editorial (Requirement 5.4)

The schema does not declare Discourse's rendered field at all
(`discourse-export.schema.ts:11-22`), so a Zod object strip removes it at parse
time — dropping it from the ten curriculum topics is a runtime no-op. It is
dropped because **hand-authoring rendered HTML for editorial content fabricates
a capture artefact**, which is the opposite of AD-8's quarantine.

⚠️ **Verify first:** `grep -rn "cooked" --include=*.ts --include=*.js .` outside
`node_modules` returned nothing under `apps/ptah-license-server/prisma`. Run it
repo-wide before deleting; if any tool reads it, keep the key and report.

Requirement 5.4 also needs a note **in the file**. Add a sibling key to the
existing top-level `note`:

```json
"curriculumNote": "Topics 15-22, 24 and 25 are EDITORIAL curriculum content maintained in place, not a Discourse capture. The forum this export came from was destroyed on 2026-08-04; do not try to re-capture them. The nine remaining topics ARE a capture."
```

⚠️ Zod strips undeclared keys, so this key is invisible to the seed and needs no
schema change. If a future maintainer wants it asserted, that is a schema edit
and a census entry — not this task.

---

## 2. Mapping changes — `map-topics.ts` and `map-course.ts`

### 2.1 `map-topics.ts`

- `CURRICULUM_TOPIC_IDS` → the ten ids of §1.1.
- Docblock `:19-20` — "The remaining 8 — source ids 15…22" → "The remaining 10 —
  source ids 15…22, 24 and 25", and `:33` "Source ids 15…22 — Batch 11's
  curriculum" likewise.
- `IMPORTED_TOPIC_IDS` and `SKIP_EMPTY_BODY_POSTS` are **untouched**. Any diff
  there is a blast-radius failure.

### 2.2 `MODULE_TITLES` (`map-course.ts:88-97`)

The ten titles of §1.2's table, in order, `readonly string[]` + `as const`
preserved. Docblock `:80-87` "MG-1.5's eight descriptive module titles, in week
order" → ten, in day order.

### 2.3 The `day-NN` slug scheme (FR-SLUG-1) — `map-course.ts:244`

```ts
// FR-SLUG-1: `day-01` … `day-10`. Positional literal, NOT `buildSlug()`.
const slug = `day-${String(index + 1).padStart(2, '0')}`;
```

Docblock additions, because the padding is load-bearing and reads as cosmetic:

- Unpadded, `day-1` is a strict prefix of `day-10`: every `startsWith`, every
  `LIKE 'day-1%'` and every unanchored regex would then match two modules.
- Padded, lexical order equals numeric order, so a slug-sorted admin list reads
  correctly.
- `day-01` satisfies `/^[a-z0-9]+(-[a-z0-9]+)*$/` — **asserted in the spec, not
  assumed** (§4.1).
- Width 2 is sized to this curriculum. A course of more than 99 modules would
  need width 3; `MODULE_TITLES.length` is the bound and it is 10.
- The new slug set is **disjoint from `week-1`…`week-8`**, which is what makes
  §6's overlay a visible addition rather than a silent overwrite.

Rewrite `:138` (`` /** `week-1` … `week-8` … */ ``) and `:166-174`'s
`buildSlug()` paragraph to name `day-01` … `day-10`.

### 2.4 The title-consistency guard (FR-TITLE-2)

**In `buildCourseRows`, not only in the spec.** It fails the seed, not just the
suite, and this defect class has already survived one review
(`map-course.ts:36-40`).

Placement: inside the `CURRICULUM_TOPIC_IDS.map(...)` callback, **after** the
`title === undefined` check at `:246-250` and **before** the returned row. Pure
code that runs before `$transaction` opens — the same position that makes the
empty-body abort write nothing (`community-seed.spec.ts:1455-1458`).

```ts
/** FR-TITLE-1. The separator is space + U+2014 + space. */
export function curriculumTopicTitle(day: number, moduleTitle: string): string {
  return `Day ${day} build thread — ${moduleTitle}`;
}

// …inside the map:
const expected = curriculumTopicTitle(index + 1, title);
if (source.title !== expected) {
  throw new CourseMappingError(
    `Curriculum topic ${sourceTopicId} is titled "${source.title}" but ` +
      `MODULE_TITLES[${index}] makes it "${expected}". The two halves are ` +
      'authored in two files and their agreement is the check — repair the ' +
      'export title or the module title, do not derive one from the other. ' +
      'This is the defect map-course.ts:36-40 recorded for source topic 21.',
  );
}
```

⚠️ **`curriculumTopicTitle` is exported for the seed, but the spec must NOT use
it as its only oracle** — a spec that calls the same function cannot detect a
wrong prefix. §4.1 pins Day 1 and Day 10 against hand-written literals as well.

While here, make `:217`'s message computed rather than literal:
`` `MG-1.5 names ${CURRICULUM_TOPIC_IDS.length} curriculum topics by id` `` —
same reasoning as the summary's computed counts (`community-seed.ts:305-307`).
Likewise `:198`'s "silently drop a week" → "a day".

### 2.5 `COURSE_DESCRIPTION` (`map-course.ts:60-62`)

```ts
export const COURSE_DESCRIPTION =
  'The two-week Ptah Builders intensive — ten daily sessions, one module per ' +
  'weekday, assembled from the cohort build threads.';
```

Acceptance criterion 1.2 requires it to contain neither `"eight-week"` nor
`"one module per week"`. ⚠️ **`"one module per weekday"` CONTAINS the substring
`"one module per week"`.** A spec written as `not.toContain('one module per
week')` would fail on the string above. Either write the description without
that stem — recommended:

```ts
export const COURSE_DESCRIPTION =
  'The two-week Ptah Builders intensive: ten daily sessions across five ' +
  'domains, assembled from the cohort build threads.';
```

— or write the assertion against `/one module per week\b/`. **Take the first
option.** A description phrased to dodge an assertion is a description phrased
for a test.

Also rewrite the `:52-58` docblock ("eight weeks, one thread each").

### 2.6 The `map-course.ts` file docblock

Lines 2-41 are the design record and are the defect this task repairs one level
up (§5 item 8). Required edits:

- `:4-7` — "8 Week N build thread topics into one Course, 8 CourseModule rows"
  → ten and ten.
- `:9-13` — keep the ONE-MODULE-PER-SESSION argument; it is now **stronger**, not
  weaker: a daily cadence needs ten `releaseAt` writes and no schema change, and
  §5's scheduling action is that decision paying off. Rewrite "per-week modules"
  → "per-session modules" and add the pointer to `CourseScheduleService`.
- `:15-18` — `sequential: false` unchanged. Add: ten daily modules is a stronger
  reason to leave it off, not a reason to turn it on (task description §3).
- `:36-40` — the "wrong today, not merely fragile" note. **Do not delete it.**
  Rewrite it to record that the defect was repaired by TASK_2026_202 and is now
  a build failure (§2.4), and that the module titles remain an editorial table
  in this file whose agreement with the export is checked rather than derived.
- Add the FR-DATE-2 offset block of §5.7.
- Add the Requirement 5.4 sentence: curriculum topics are editorial, maintained
  in place, and are not a Discourse capture.
- Add the C2 rationale worth preserving (`context.md:135-142`): domains are
  deliberately uneven (Domain modelling 1 day, AI + integrations 3); the agent
  lands AFTER entitlements so its cost control enforces real plan limits; deploy
  stays on Day 2 to remove the Day-10 launch crunch.

### 2.7 `community-seed.ts` — comments and docblocks only, no logic

| Line | Today | Becomes |
| --- | --- | --- |
| `:26-30` | "THE 8 Week N TOPICS ARE NOT IMPORTED… ONE Course, 8 CourseModule rows and 8 Lesson rows" | ten and ten, "Day N" |
| `:273-277` | "Batch 11 adds 1 + 8 + 8 … ~94 in total" | `1 + 10 + 10` … ~98 round trips. The 60s budget is unchanged and the sentence saying why stays |
| `:297-298` | "10 forum post bodies + 8 lesson bodies = the export's 18 non-empty ones" | `10 + 10 = 20` |
| `:520-527` | "`CourseModule.releaseAt` — R2.4.1's weekly-release schedule. Re-running the seed must not silently unschedule eight modules an admin has date-gated" | ten modules; and add: the schedule is now set by `POST /v1/admin/course-modules/schedule` (§5), which makes this exclusion more important, not less — the seed and the scheduler are two writers of one column and only one of them owns it |

**No executable line in `community-seed.ts` changes.** If a diff there is not a
comment, the change went too wide.

---

## 3. Census constants — `discourse-export.schema.ts`

| Constant | Line | 8-week | 10-day | Why |
| --- | --- | --- | --- | --- |
| `EXPECTED_CATEGORY_COUNT` | `:59` | 4 | **4 (unchanged)** | Forum half |
| `EXPECTED_TOPIC_COUNT` | `:60` | 17 | **19** | +2 curriculum topics |
| `EXPECTED_POST_COUNT` | `:61` | 19 | **21** | +2 topics × 1 post |
| `EXPECTED_NON_EMPTY_BODY_POSTS` | `:56` | 18 | **20** | Still `POST_COUNT − 1`; the one skipped small-action post is unchanged |

Verification is automatic and happens three ways, all before any write:

1. `discourseExportSchema` — `.length(EXPECTED_TOPIC_COUNT)` on `topics`
   (`:131`), the post-count refine (`:133-136`), the non-empty refine
   (`:137-144`), the slug-uniqueness refine (`:145-148`).
2. `community-seed.ts:220` calls `readDiscourseExport` **before** the
   transaction opens, so a census mismatch writes nothing
   (`community-seed.spec.ts:1419-1422` asserts `db.calls` is `[]`).
3. The summary's two computed assertion lines (`community-seed.ts:308-321`) both
   read `OK` only if `10 + 9 === 19` and `10 + 1 + 10 === 21`.

Docblock updates required, or the file lies about its own numbers:

- `:35-54` — "🔴 THIS IS 18, NOT 19, AND THE PLAN SAYS 19". Rewrite as "20, NOT
  21", preserving the whole small-action-post argument verbatim; add one
  sentence recording that TASK_2026_202 moved the pair 18/19 → 20/21 by adding
  two curriculum topics, so the invariant `NON_EMPTY = POST_COUNT − 1` is
  unchanged and the exact-census control is intact.
- `:58` — "MG-1.6's counts" stays; the numbers move with it.

---

## 4. The spec rewrite — `community-seed.spec.ts`

### 4.1 §9's table, worked through

| Line(s) | Change |
| --- | --- |
| 418 | Test name → "exactly 4 categories, 19 topics and 21 posts". Body already uses the constants — no assertion edit |
| 427 | Test name → "the 19 source topics split into 10 curriculum + 9 imported" |
| 428-429 | `toHaveLength(8)` → `10`; `IMPORTED_TOPIC_IDS` stays `9` |
| 433-443 | Generic (overlap + coverage). **Unchanged** — and it is the assertion that proves ids 24/25 were added to the export as well as to the array |
| 446-463 | **UNCHANGED.** 4 categories, 9 topics, 10 posts, 1 skipped body. 🔴 If this moves, the change went too wide |
| 465 | Test name → "carries 20 non-empty source bodies, one fewer than the post count". Body uses constants — unchanged |
| 500 | `expect(compared).toBe(10)` — forum-half byte fidelity. **Unchanged** |
| 988 | `/^week-\d/` → `/^day-\d/` |
| 998 | Test name → "1 course, 10 modules and 10 lessons" |
| 1003-1004 | `created: 8` → `10` (×2) |
| 1006-1007 | `CURRICULUM_TOPIC_IDS.length` — generic, unchanged |
| 1010-1012 | **UNCHANGED** (the forum half is untouched by the curriculum writer) |
| 1024 | Comment "Week N build thread —" → "Day N build thread —" |
| 1029-1031 | 🔴 `/^Week \d build thread — /` → `/^Day \d{1,2} build thread — /`. **See §4.3** |
| 1036 | `/^week-\d/` → `/^day-\d/` |
| 1040 | Test name → "sparsely at 100…1000" |
| 1047-1056 | Literal slug list → `'day-01' … 'day-10'` |
| 1057-1059 | `100…800` → `100, 200, 300, 400, 500, 600, 700, 800, 900, 1000` |
| 1065 | `/^week-[1-8]$/` → `/^day-(0[1-9]\|10)$/` |
| 1075-1097 | Course row + resolved cohort key. **Unchanged** |
| 1099-1113 | The anti-vacuity witness. **Re-founded, not deleted — §4.4** |
| 1118 | `db.lessons.size).toBe(8)` → `10` |
| 1148 | `lessonWrites).toHaveLength(8)` → `10` |
| 1162 | Comment "eight threads written across three weeks" → "ten sessions authored in one editorial pass in 2026-08" |
| 1168 | `structural).toHaveLength(9)` → `11` (1 course + 10 modules) |
| 1344 | `CURRICULUM_TOPIC_IDS.length` — generic, unchanged |
| 1351-1352 | Comment "The eight curriculum bodies" → "ten" |
| 1365, 1401, 1431 | `CURRICULUM_TOPIC_IDS[0]` / `[3]` — index-based, unchanged |
| 1383 | 🔴 `'week-1'` and `#week-1` → `'day-01'` and `#day-01` (**two occurrences in one template literal**) |
| 1513-1518 | `MODULE_TITLES` length equals `CURRICULUM_TOPIC_IDS` length. **Unchanged and still the right check** |
| 1540-1542 | Computed already — unchanged |
| 1543-1547 | Comment `19 = 10 written + 1 skipped + 8 curriculum` → `21 = 10 written + 1 skipped + 10 curriculum`. The literal `10 written` and `1 skipped` in the assertion string **stay** — the forum half did not move |
| 1565 | Test name "reports 18 bodies imported" → "20". Body uses constants — unchanged |
| 1568-1573 | Constant-driven — unchanged |
| 1576-1590 | Constant-driven (`system (21 posts)` falls out of `EXPECTED_POST_COUNT`) — unchanged |

New assertions to ADD:

- `day-01` … `day-10` each match `/^[a-z0-9]+(-[a-z0-9]+)*$/` — FR-SLUG-1 says
  *verify, do not assume*.
- Every one of the ten export curriculum slugs matches the same regex and is
  unique across all 19 (the schema enforces it; assert it once so a failure
  names the slug).
- FR-TITLE-2 negative: a fixture built with `fixtureFromExport` that mutates one
  curriculum topic title, expect `CourseMappingError` and `db.writes()` empty
  and zero `open` calls — the shape of `:1425-1459`.
- FR-TITLE-1 positive, pinned against **hand-written literals** for the two
  anchors:
  `'Day 1 build thread — The workspace — monorepo, boundaries, first green CI'`
  and `'Day 10 build thread — Publish, fail, retry — and launch'`.
- §4.3's Day-10 regex tripwire.

### 4.2 The six places §9's table MISSES

Found by reading the file; each is a live assertion or a comment that still
says 8. **These are the reason a §9-only pass leaves the suite red.**

| Line | What | Change |
| --- | --- | --- |
| 1204-1206 | `second.modules` / `second.lessons` `{ created: 0, updated: 8 }` | `updated: 10` (×2) |
| 1208-1209 | `db.modules.size` / `db.lessons.size` `toBe(8)` | `10` (×2) |
| 1418 | Comment "17 non-empty bodies where EXPECTED_NON_EMPTY_BODY_POSTS demands 18" | 19 / 20 |
| 1525 | Comment "now with 17 more writes to do it in" | 21 more (1 course + 10 modules + 10 lessons) |
| 1528 | `expect(db.lessons.size).toBe(8)` | `10` |
| 652, 1497 | `` `Ptah … week one` `` inside the U+FFFD mojibake fixtures | **Leave alone.** They are arbitrary probe strings, not curriculum assertions. Editing them widens the diff for nothing |

### 4.3 🔴 R1 — the `/^Day \d/` regex trap, and the tripwire that closes it

`community-seed.spec.ts:1030` is `/^Week \d build thread — /`. The mechanical
rename to `/^Day \d build thread — /` **passes eight of ten titles and fails
"Day 10"** — `\d` matches exactly one digit. Risk R1 is rated the single most
likely way this change ships broken, and the reason is that the failure looks
like a data problem, not a regex problem.

FR-SLUG-3 is the rule: **titles are unpadded, slugs are padded.** Any regex
against a TITLE takes `\d{1,2}`; any regex against a SLUG takes the explicit
alternation `(0[1-9]|10)`.

Two edits and one new test:

```ts
// line 1030
expect(title).toMatch(/^Day \d{1,2} build thread — /);

// line 1065
expect(lesson.slug).toMatch(/^day-(0[1-9]|10)$/);
```

```ts
it('Day 10 is covered by the title regex — the one-digit form is NOT', () => {
  const data = readDiscourseExport(EXPORT_PATH);
  const { modules } = buildCourseRows(data, DEFAULT_COHORT_KEY);
  const dayTen = modules[9];

  expect(dayTen?.lesson.title).toMatch(/^Day \d{1,2} build thread — /);
  // 🔴 THE TRIPWIRE (R1). The naive rename of the old /^Week \d …/ regex
  // silently excludes exactly one of the ten titles, and the eight that pass
  // make the failure read as a data defect rather than a quantifier defect.
  expect(dayTen?.lesson.title).not.toMatch(/^Day \d build thread — /);
  expect(dayTen?.slug).toBe('day-10');
  // …and the unpadded slug form is a prefix trap, which is why FR-SLUG-1 pads.
  expect('day-1'.startsWith('day-1') && 'day-10'.startsWith('day-1')).toBe(true);
});
```

The last two lines are why the padding exists, asserted rather than asserted-in-
a-comment.

### 4.4 The anti-vacuity witness, RE-FOUNDED (§7)

`:1099-1113` uses the `Hardening` divergence — source topic 21's title vs
`MODULE_TITLES[6]` — as its witness that the title table is editorial rather than
derived. FR-TITLE-1 **removes that divergence by design**, so the witness must be
re-founded on the divergence that remains true for all ten.

```ts
it('takes the module titles from the table, and a module title is never its lesson title', () => {
  const data = readDiscourseExport(EXPORT_PATH);
  const { modules } = buildCourseRows(data, DEFAULT_COHORT_KEY);
  expect(modules.map((m) => m.title)).toEqual([...MODULE_TITLES]);

  // 🔴 THE RE-FOUNDED WITNESS (§7). The old one was source topic 21's
  // "Hardening" divergence, and TASK_2026_202 repaired exactly that defect —
  // so it is GONE, and deleting the test with it would quietly lose the guard
  // (R4). What survives by DESIGN is the prefix asymmetry: the lesson title
  // retains "Day N build thread — " (map-course.ts:112-115) and the module
  // title does not, for all ten.
  expect(modules).toHaveLength(10);
  modules.forEach((m, i) => {
    expect(m.lesson.title).not.toBe(m.title);
    expect(m.lesson.title).toBe(`Day ${i + 1} build thread — ${m.title}`);
    expect(m.title).not.toMatch(/^Day \d{1,2} build thread/);
  });
});
```

⚠️ **State honestly in the test docblock that the property is now WEAKER.**
Before FR-TITLE-1, the witness proved the table could not be *derived* from the
source titles. After it, a derivation `source.title.slice(prefix.length)` would
produce the right answer, so the surviving property is only "the module title is
not a COPY of the source title" — which is what §7 asks for. The compensating
control is FR-TITLE-2: the two halves stay independently authored in two files
and their agreement is now a **build failure** rather than a hope. Say that in
the test, or the next reviewer will read the weakening as a regression.

### 4.5 Fixtures (FR-TEST-1)

`__fixtures__/malformed.json` and `structurally-invalid.json` fail before any
content is examined; the two derived fixtures rebuild from the real export at
test time (`__fixtures__/README.md:16-28`). **No committed fixture should need
editing. If one does, stop and report** — it means something outside the
intended blast radius moved.

---

## 5. C4 — reusable cohort scheduling

**Requirement (`context.md:159-202`):** one admin action takes a cohort start
date and writes `releaseAt` on every module of a course, in day order, on
weekday offsets skipping weekends. Must work for cohort 2 and 3 with no code
change; `COURSE_SLUG` is `ptah-builders-cohort-1`, so a future cohort is a NEW
course row — the action is keyed on a **course**, and must not assume ten
modules.

**Untouched, and asserted as untouched:** `ModuleLockService`
(`module-lock.service.ts:55-139`), the seed's `releaseAt` exclusion
(`community-seed.ts:589-592`), and `PATCH /v1/admin/course-modules/:id`
(`admin-course-modules.controller.ts:176`), which keeps working afterwards
because concrete instants are written.

### 5.1 The failure mode being designed against, and the guard

> *A mis-typed start date silently shifting ten member-visible dates.*

Three properties, together:

1. **Preview-then-apply, as two routes.** Precedent in this server:
   `GET v1/admin/users/:id/deletion-preview` — a destructive admin action gets a
   rehearsal endpoint. The preview computes and returns the identical payload
   the apply returns, writes nothing, and audits nothing.
2. 🔴 **The apply request must ECHO the outcome.** `ApplyModuleScheduleDto`
   carries two extra REQUIRED fields the preview does not:
   `confirmModuleCount` and `confirmLastReleaseDate`. Both are compared against
   the freshly computed schedule **inside the transaction**; a mismatch is a
   `400` naming both values and nothing is written.

   This is the load-bearing part, and it is why a `confirm: true` boolean was
   rejected. A boolean is satisfied by copy-paste. `confirmLastReleaseDate`
   cannot be supplied correctly without having either read a preview or done the
   weekday arithmetic by hand — and **every plausible mis-typing of the start
   date moves the last date**: a wrong year, a wrong month, a transposed
   `2026-01-09` for `2026-09-01`, an off-by-one day. `confirmModuleCount`
   catches the other half of the same failure: an admin who believes he is
   scheduling ten modules and is in fact scheduling a course that has twelve.
3. **Total re-schedule, never a merge.** See §5.5.

**Apply-directly was rejected**, and so was a single route with a `dryRun` flag:
a required flag forces the caller to type a word, not to look at a date, so it
defends nothing. There is no admin UI for courses in `libs/web/admin` today —
this action is driven by `curl` — which makes a machine-checkable echo the only
guard that actually fires.

### 5.2 Endpoint shape and placement

Both on the **existing** `AdminCourseModulesController`
(`@Controller('v1/admin/course-modules')`), because the action writes
`CourseModule` rows and because `courseId` in the BODY is this controller's
established idiom for a course-scoped bulk write (`ReorderModulesDto:60-72`,
and `reorder.service.ts:82-90` for the reason: inferring the parent would
silently renumber a course the admin was not editing).

```
POST v1/admin/course-modules/schedule/preview   → 200, computes, writes nothing
POST v1/admin/course-modules/schedule           → 200, computes, applies, audits
```

Both `@HttpCode(200)` (neither creates a resource), both
`@UseGuards(AdminThrottlerGuard)` + `@Throttle(ADMIN_WRITES)`, both
`@Body(dtoPipe(...))`. Class-level `@UseGuards(JwtAuthGuard, AdminGuard)` already
covers them.

**Why POST for the preview rather than GET.** The preview must be a faithful
rehearsal of the apply, which means the two must accept the *same* input shape.
A `GET` forces a second, query-shaped DTO, and the two would drift the first
time either changed. A POST that writes nothing is the smaller cost.

**Routing invariants, checked against `route-map.spec.ts`:**

- **RI-1** — controller prefix unchanged, so `PREFIX_EXCEPTIONS` and
  `KNOWN_PREFIX_DEBT` both stay at their floor.
- **RI-2** — `POST v1/admin/course-modules/schedule` is 4 literal segments and
  `…/schedule/preview` is 5. The only other 5-segment admin POSTs are
  `v1/admin/courses/:id/restore`, `v1/admin/lessons/:id/refresh-metadata` and
  `v1/admin/sessions/:eventId/invitations` — segment 3 differs in every case, so
  no unification. `unifiable()` returns false for differing segment counts, so
  neither contests `POST v1/admin/course-modules`. `KNOWN_CONTESTED` stays empty.
- **RI-3** — no same-verb unifiable pair is created. Declare `…/schedule/preview`
  before `…/schedule` anyway, at zero cost, mirroring the
  `POST v1/admin/lessons/refresh-metadata` precedent note at `route-map.spec.ts:333-335`.

### 5.3 DTOs — ⚠️ both bind `dtoPipe`

`libs/api/learning/src/lib/courses/dto/schedule-modules.dto.ts`

```ts
export class PreviewModuleScheduleDto {
  /** The course whose modules are being scheduled. Missing or soft-deleted → 404. */
  @IsString() @MinLength(1) @MaxLength(64)
  courseId!: string;

  /**
   * Day 1's LOCAL calendar date in `timeZone`. `YYYY-MM-DD` and nothing else.
   * ⚠️ NOT `@IsISO8601()` — that accepts a full datetime, and a caller who
   * supplied one would have their time-of-day silently overridden by `timeOfDay`.
   */
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string;

  /**
   * The local wall-clock time each module opens, `HH:mm`, 24h. REQUIRED and
   * deliberately undefaulted: a default is a decision about when a member's
   * module unlocks, taken by whoever wrote the constant.
   */
  @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  timeOfDay!: string;

  /**
   * IANA identifier — `Europe/Berlin`, `UTC`. The regex is a cheap boundary
   * reject; the real check is `Intl` resolving it, in the pure helper.
   */
  @IsString() @MaxLength(64)
  @Matches(/^(UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/)
  timeZone!: string;
}

export class ApplyModuleScheduleDto extends PreviewModuleScheduleDto {
  /** Must equal the number of LIVE modules the course actually has. */
  @IsInt() @Min(1) @Max(500)
  confirmModuleCount!: number;

  /** Must equal the computed local date of the LAST module. `YYYY-MM-DD`. */
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  confirmLastReleaseDate!: string;
}
```

- **Extension, not one class with optional confirms.** `reorder.dto.ts:13-19`
  rejects the optional-field shape because `forbidNonWhitelisted` would then
  ACCEPT a field the endpoint ignores. Extension gives two classes, no optional
  fields, and a strict superset: the apply payload sent to `/preview` is a `400`
  (two non-whitelisted keys) and the preview payload sent to `/schedule` is a
  `400` (two missing required keys). **Both directions must be spec cases** —
  they are what prove the classes are genuinely distinct on the wire.
- 🔴 **No field is nullable-optional.** `EXPECTED_NULLABLE_OPTIONALS`
  (`nullable-dto.spec.ts:73`) stays at thirteen. A `null` here has no meaning:
  "unschedule everything" is `PATCH :id` with `releaseAt: null`, per module, and
  it already exists.

### 5.4 Timezone handling — explicit, and the reason

`releaseAt` is a `DateTime` (an instant). A bare date has no instant, and
"skips weekends" is a **calendar-local** notion. Getting this wrong ships a
module that unlocks a day early for some members — the exact hazard the task
names. Three decisions:

1. **The admin supplies the zone.** `(startDate, timeOfDay, timeZone)` is the
   complete input. The server's own zone, the container's `TZ`, and UTC-by-
   assumption are all rejected: a container timezone change would silently move
   ten member-visible dates, with no diff anywhere.
2. **Weekday arithmetic happens on the LOCAL CALENDAR, then converts to an
   instant.** Advancing by `+24h` in UTC is wrong across a DST transition: the
   local wall-clock release time drifts by an hour, and near midnight that
   becomes a drift of a calendar DAY. Cohort 1 (September, no transition) would
   not show it; cohort 2 in late October or March would — and C4 exists
   precisely so cohorts 2 and 3 need no code change.
3. **`Temporal`, via `temporal-polyfill`.** It is already a declared dependency
   (`package.json:187`) and is imported nowhere in the workspace — this is its
   first consumer, which must be recorded in the helper's docblock. It is pure
   JS, not listed in the license server's esbuild `external` list, so it is
   bundled and needs no deploy change.

   ⚠️ **Verification gate, before any other C4 file is written:** add the import,
   run `nx build ptah-license-server` and `nx test ptah-license-server
   --testPathPatterns=weekday-schedule`. If the polyfill does not bundle or its
   v1 surface differs from the sketch below, **stop and report** — the fallback
   is a hand-rolled `Intl.DateTimeFormat` two-pass offset resolver in the same
   pure helper with the same signature, which changes ~30 lines of one file and
   nothing else. The helper's signature is chosen so that swap is local.

**The pure helper** — `libs/api/learning/src/lib/common/weekday-schedule.ts`,
mirroring `common/sort-order.ts` exactly: pure arithmetic used by a bulk-write
service, no database, no clock, no `process.env`, unit-tested without a mock.

```ts
export interface WeekdayScheduleInput {
  readonly startDate: string;  // YYYY-MM-DD, local to timeZone
  readonly timeOfDay: string;  // HH:mm, local to timeZone
  readonly timeZone: string;   // IANA
  readonly count: number;      // number of live modules — NEVER assumed to be 10
}

export interface WeekdaySlot {
  readonly day: number;        // 1-based
  readonly localDate: string;  // YYYY-MM-DD in timeZone
  readonly weekday: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
  readonly instant: Date;      // what is written to CourseModule.releaseAt
}

/** Thrown for an unresolvable zone, a weekend start, or count < 1. */
export class ScheduleInputError extends Error { /* name = 'ScheduleInputError' */ }

export function computeWeekdaySchedule(
  input: WeekdayScheduleInput,
): readonly WeekdaySlot[];
```

Algorithm: parse `startDate` as a `Temporal.PlainDate`; if `dayOfWeek >= 6`
throw `ScheduleInputError`; then walk forward one calendar day at a time,
emitting a slot whenever `dayOfWeek <= 5`, until `count` slots exist. Each slot's
instant is `plainDate.toPlainDateTime(plainTime).toZonedDateTime(timeZone).toInstant()`,
converted with `new Date(instant.epochMilliseconds)`.

Decisions the helper's docblock must record:

- 🔴 **A weekend start date is a `400`, not a roll-forward to Monday.** Silently
  changing the date the admin typed is the same class of harm as a mis-typed
  date shifting ten dates — it just moves who made the mistake.
- 🔴 **The offsets are NOT a constant.** They depend on the start weekday. See
  §0 Finding 0 and the table in §5.7.
- **DST ambiguity is resolved by `Temporal`'s `'compatible'` default** (spring
  forward → the later instant, fall back → the earlier). A release time inside a
  skipped hour is not a case an admin should have to reason about, and both
  readings differ by one hour, never by a day.
- **`count` comes from the database, never from a literal.** A course with 12
  modules gets 12 dates. C4's reusability clause is enforced here.

### 5.5 Modules that already carry a manual `releaseAt`

🔴 **The action is a TOTAL re-schedule of every live module in the course. It
overwrites, and it shows you what it will overwrite before it does.**

Rejected: **skip** modules that already have a date. That leaves a course whose
modules sit on two different schedules, half from the action and half from an
earlier hand edit — silent, partial, and member-visible, which is the exact
failure class this design exists to prevent.

Rejected: **overwrite silently.** That is the harm.

Chosen, and it is three mechanisms rather than one:

1. The preview returns `currentReleaseAt` for **every** module and a `changed`
   flag per entry, plus a `changedCount`. An admin can see, before applying,
   exactly which manual dates are about to move.
2. The apply writes **only the entries where `changed` is true**. An unchanged
   row is not touched, so its `updatedAt` does not move. This is what makes
   "a second identical apply reports `changedCount: 0` and issues zero
   `courseModule.update` calls" an assertable exit-gate observable — the same
   shape as the seed's "second run, zero creates" (`community-seed.ts:203-211`).
3. The audit row's metadata records `{ slug, from, to }` for every changed
   module, so a wrong re-schedule is fully recoverable from the log. The list is
   bounded by the course's live module count — tens of rows, the same set the
   response already renders in full.

A per-module override through `PATCH /v1/admin/course-modules/:id` still works
afterwards and is only ever clobbered by the **next deliberate re-schedule**,
which is what "deliberate" means. That is C4's stated constraint, satisfied.

### 5.6 The service, and its transaction

`libs/api/learning/src/lib/courses/course-schedule.service.ts` — a **new
`@Injectable()`**, not a method on `CoursesService` (already ~1100 lines). The
precedent is `ReorderService`: bulk, course-scoped, one audit row, pure
arithmetic in a sibling helper.

```ts
@Injectable()
export class CourseScheduleService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async schedule(
    input: ScheduleInput,          // the DTO fields, already parsed
    apply: boolean,
    audit?: AuditHook,             // supplied ONLY when apply === true
  ): Promise<AdminModuleSchedule>;
}
```

**One code path for both routes**, with `apply` deciding whether the write loop
and the audit hook run. Two code paths would let the preview and the apply drift,
which would make the rehearsal a lie — and the rehearsal is the whole guard.

Inside a single `this.prisma.$transaction`, in order:

1. `tx.course.findFirst({ where: { id, ...NOT_DELETED }, select: { id, slug } })`
   → `NotFoundException('Course not found')` (`reorder.service.ts:100-104`'s idiom).
2. `tx.courseModule.findMany({ where: { ...NOT_DELETED, courseId }, orderBy: [...DETERMINISTIC_ORDER_BY], select: { id, slug, title, sortOrder, releaseAt } })`.
   🔴 **`DETERMINISTIC_ORDER_BY`, never `slug`.** "Day order" is the order every
   member read uses (`sort-order.ts:50-54`). A course authored through the admin
   API has slugs derived from titles, not `day-NN`, so a slug sort would be
   arbitrary there and C4 must work for such a course.
3. Empty list → `BadRequestException('This course has no live modules to schedule.')`.
4. `computeWeekdaySchedule({ ...input, count: modules.length })`, zipped with the
   modules index-for-index.
5. **If `apply`:** compare `confirmModuleCount` against `modules.length` and
   `confirmLastReleaseDate` against the last slot's `localDate`. Either mismatch
   → `BadRequestException` naming expected and received for the failing field,
   **before any write**. ⚠️ Checked INSIDE the transaction against the same
   snapshot the writes see — `reorder.service.ts:49-54` (D-6.6a) makes exactly
   this call, for exactly this reason: a module created by another admin between
   check and write would otherwise be scheduled without ever appearing in the
   request.
6. **If `apply`:** for each changed entry,
   `tx.courseModule.update({ where: { id }, data: { releaseAt } })`; then one
   `audit?.(tx, null)`.
7. Return the `AdminModuleSchedule` with `applied: apply`.

Wrapped in the `withMappedPrismaErrors` idiom so `mapPrismaError`
(`courses.service.ts:885`) produces the one documented body per rule.

`ScheduleInputError` from the helper is caught and re-thrown as
`BadRequestException` with a written sentence — `'Unknown time zone. Use an IANA
identifier such as "Europe/Berlin".'`, `'The cohort start date falls on a
weekend. Supply the first weekday of the cohort.'`. **Never `error.message`
verbatim to the client** (CLAUDE.md / NestJS rules); the original is logged.

### 5.7 The FR-DATE-2 offset table, delivered as documentation of what the action computes

Goes in the `map-course.ts` docblock (§2.6). Corrected per Finding 0:

> **The rule.** Day 1 is the cohort start date. Each subsequent day advances one
> calendar day in the cohort's own time zone, skipping Saturday and Sunday,
> until every module has a date. The offsets below are therefore a **function of
> the start weekday**, not a constant.
>
> **Monday start** — offsets `+0 +1 +2 +3 +4 · +7 +8 +9 +10 +11`; a clean 5 + 5
> across two weeks.
>
> **Tuesday 1 September 2026 (the cohort-1 decision, `context.md` C3)** —
> offsets `+0 +1 +2 +3 +6 · +7 +8 +9 +10 +13`:
>
> | Day | Date | Weekday |
> | --- | --- | --- |
> | 1 | 2026-09-01 | Tue |
> | 2 | 2026-09-02 | Wed |
> | 3 | 2026-09-03 | Thu |
> | 4 | 2026-09-04 | Fri |
> | 5 | 2026-09-07 | Mon |
> | 6 | 2026-09-08 | Tue |
> | 7 | 2026-09-09 | Wed |
> | 8 | 2026-09-10 | Thu |
> | 9 | 2026-09-11 | Fri |
> | 10 | 2026-09-14 | Mon |
>
> ⚠️ Day 10 alone on Monday 14 September is a **known, accepted consequence**
> (`context.md` C3). A Monday 31 August start would give 5 + 5 ending Friday 11
> September. The founder was shown this and supplied 1 September. Because the
> schedule is one admin action, it can be revisited without a code change. **Do
> not re-raise it.**
>
> Nobody needs to read this table. `POST /v1/admin/course-modules/schedule`
> computes it. It is here so the arithmetic is reviewable.

### 5.8 Contracts, audit action, and module wiring

- `libs/api-contracts/community/src/lib/admin/admin-course.contract.ts` — add
  `AdminModuleScheduleEntry` and `AdminModuleSchedule` beside `AdminCourseModule`
  (`:111-134`), export both from the barrel.

  ```ts
  export interface AdminModuleScheduleEntry {
    moduleId: string; slug: string; title: string; sortOrder: number;
    day: number;                    // 1-based position in DETERMINISTIC_ORDER_BY
    weekday: string;                // Mon…Fri, never Sat/Sun
    localDate: string;              // YYYY-MM-DD in `timeZone`
    releaseAt: string;              // ISO 8601 instant to be / that was written
    currentReleaseAt: string | null;// what the row carries today
    changed: boolean;               // currentReleaseAt !== releaseAt
  }

  export interface AdminModuleSchedule {
    courseId: string; courseSlug: string;
    timeZone: string; startDate: string; timeOfDay: string;
    moduleCount: number;
    lastReleaseDate: string;        // the value `confirmLastReleaseDate` must echo
    changedCount: number;
    entries: AdminModuleScheduleEntry[];
    applied: boolean;               // false on /preview, true on /schedule
  }
  ```

  **One type for both routes**, distinguished by `applied`. A preview that
  returned a different shape from the apply would not be a rehearsal.

- `libs/api/audit/src/lib/audit-log.types.ts` — add
  `| 'learning.module.schedule'` after `'learning.module.reorder'` (`:98`), with
  a comment in that block's established voice: one row per schedule, not one per
  module (`reorder.service.ts:43-48`'s decision 3 — "the admin scheduled this
  course" is one intent); `targetId` is `undefined` because there is no single
  target row; metadata carries the inputs plus `{ slug, from, to }` per changed
  module, which for a course with no `deletedBy`-style column is the only record
  of what the previous dates were. **No audit row on `/preview`** — a log full of
  rehearsals is a log nobody reads.

- `libs/api/learning/src/lib/learning.module.ts` — add `CourseScheduleService`
  to `providers`. **Do NOT add it to `exports` or to the barrel** —
  `learning.module.spec.ts:148` asserts the barrel exports no write or authoring
  service by any name.
  - `learning.module.spec.ts:282-297` — "declares the seven services" → eight,
    and the exact `toEqual` provider list gains `CourseScheduleService`.
  - The module docblock's "Seven services" (`:31`) → eight.
  - `:298-329` — five controllers at five disjoint prefixes: **unchanged**, no
    new controller.

### 5.9 Census updates — the part that will be missed

| File | Constant | Change | How to re-derive |
| --- | --- | --- | --- |
| `apps/ptah-license-server/src/common/route-map.spec.ts` | `EXPECTED_ROUTES` | **+2**: `'POST v1/admin/course-modules/schedule'`, `'POST v1/admin/course-modules/schedule/preview'`, inserted in the P3 curriculum block in sorted position | The array is the artefact. Add both lines, run the suite, and write the new running total in the prose block (`:242-255`) with the decomposition — the docblock at `:229-238` records what happened last time a prose total was not re-derived |
| same | `PREFIX_EXCEPTIONS`, `KNOWN_PREFIX_DEBT`, `KNOWN_CONTESTED` | **unchanged, all three** | Prefix is unchanged and nothing unifies (§5.2) |
| `apps/ptah-license-server/src/common/controller-validation.spec.ts` | `MIN_TOTAL_PAYLOAD_PARAMS` | **78 → 80** (+2 whole-object `@Body`) | Use the documented procedure at `:217-222`: set it to `9999`, run `npx nx test ptah-license-server --skip-nx-cache --testPathPatterns=controller-validation`, read the actual from `Received:`, restore, and write the `+2` decomposition into the docblock |
| same | `NAMED_PRIMITIVE_PARAM_COUNT` | **unchanged at 6** | 🔴 Load-bearing (RISK-I). Both new params are `@Body(dtoPipe(...))`. A single `@Query('courseId')` would make the total read 80 against a named count of 7 and the arithmetic would not close |
| same | `ALL_CONTROLLERS` census, `UNVALIDATED_DEBT`, `EXCLUDED` | **unchanged** | No new controller file |
| `libs/api/core/src/lib/common/nullable-dto.spec.ts` | `EXPECTED_NULLABLE_OPTIONALS` | **unchanged at thirteen** | §5.3: no nullable optional in either new DTO |
| `apps/ptah-license-server/src/admin/admin-guards.spec.ts` | G1, G3 | **unchanged** | G1 is class-level; G3 is a `.some(verb !== GET)` |

### 5.10 New spec files and cases

`common/weekday-schedule.spec.ts` — pure, no Nest, no DB, no clock:

- Monday start, `count: 10` → the `+0…+4, +7…+11` table.
- 🔴 **Tuesday 1 September 2026, `count: 10` → the ten dates of §5.7**, including
  Day 10 on Monday 14 September. This is the founder's actual cohort, asserted.
- `count: 3`, `count: 12`, `count: 1` → never assumes ten (C4's reusability
  clause, made a test).
- Saturday and Sunday starts → `ScheduleInputError`.
- Unknown zone (`'Mars/Olympus'`) → `ScheduleInputError`.
- **A DST-crossing cohort**: a start in late October for `Europe/Berlin` at
  `09:00`, asserting that every instant is still 09:00 local — i.e. the UTC
  offsets differ across the transition. This is the case a `+24h` implementation
  fails and nothing else catches.
- `UTC` zone → instants equal the naive concatenation, proving the conversion is
  not accidentally double-applied.

`course-schedule.service.spec.ts` — against `mock-learning-prisma.ts`:

- Preview issues **zero** `courseModule.update` calls and **zero** audit writes.
- Apply issues one update per **changed** module and exactly **one** audit row
  with `targetId` null.
- A second identical apply → `changedCount: 0` and zero updates.
- `confirmLastReleaseDate` wrong by one day → `BadRequestException`, zero
  updates, zero audit rows.
- `confirmModuleCount` wrong → same.
- A module carrying a manual `releaseAt` → `changed: true` and
  `currentReleaseAt` populated in the response; it IS overwritten; the audit
  metadata carries its `from`.
- Soft-deleted module in the course → excluded from `count` and never written
  (`NOT_DELETED` on the `findMany`).
- Soft-deleted / missing course → `404`.
- Course with zero live modules → `400`, nothing written.
- Modules are read with `DETERMINISTIC_ORDER_BY`, asserted on the recorded
  `findMany` args — not by slug.

`admin-course-modules.controller.spec.ts` (extend the existing file):

- Both handlers bind `dtoPipe` with the right `expectedType` (the local mirror of
  `controller-validation.spec.ts`).
- The apply handler passes an `auditHook` with action `'learning.module.schedule'`;
  the preview handler passes **no** audit hook.
- Declaration order and the RI-3 note (the existing file already asserts the
  `reorder` / `:id` pair — extend the comment, no new unifiable pair).
- 🔴 The two DTO-distinctness cases of §5.3: apply payload → `/preview` is a
  `400`; preview payload → `/schedule` is a `400`.

`apps/ptah-license-server/src/common/controller-validation.spec.ts` covers the
new routes automatically once the constants move.

### 5.11 The runbook — `docs/community/curriculum-reseed-runbook.md` (new)

FR-IDEM-2 and FR-DATE-2, in one operator-facing document. Sections:

1. **Which environments hold the 8-week course: NONE** (C1). No GitHub workflow
   runs `seed-community` or `prisma:migrate:deploy` — `ci.yml:89` and
   `nightly-coverage.yml:62` run `prisma:generate` only, for typegen — and
   `docs/deploy/founder-setup-checklist.md` §2.4 is still unchecked. **No cleanup
   is performed by this task.** Risk R2 is Low.
2. **The overlay, stated as fact anyway.** §8 of the task description is proven
   from `community-seed.ts` and stays in the runbook because it is correct and
   will be needed the first time anyone re-seeds a persistent database: 1 course
   updated in place, 10 modules and 10 lessons created, and the 8 `week-N`
   modules **left in place, published and member-visible** — the seed has no
   delete verb (`community-seed.ts:105-109`). Net observable: an 18-module
   course page with `sortOrder` 100–800 colliding with 100–1000. No crash, no
   error. That is why it is written down.
3. **Cleanup, if it ever applies.** Non-production:
   `nx run ptah-license-server:prisma:reset` then
   `nx run ptah-license-server:seed-community`. Production/staging: soft-delete
   the eight through `DELETE /api/v1/admin/course-modules/:id`
   (`admin-course-modules.controller.ts:227`) — an audited soft delete, and every
   member read filters tombstones at the nested `where`.
4. **The seed gains no delete verb, ever** (`community-seed.ts:79-92`).
5. **Setting the cohort schedule** — the two `curl` calls, preview then apply,
   with the founder's cohort-1 values and the §5.7 table as the expected preview
   output. State plainly that `timeOfDay` and `timeZone` are operator inputs the
   founder chooses per cohort, and that C5's default is **open**: the seed
   produces `releaseAt = null` and nobody should ship the first cohort pre-gated.
6. **Cohort 2 and 3**: create the new course, seed or author its modules, run the
   same two calls with the new `courseId` and start date. No code change. That is
   C4's acceptance criterion, written as a procedure.

⚠️ **Marketplace rule** (CLAUDE.md): this file must contain none of `copilot`,
`codex`, `claude`, `openai`, `anthropic`. It has no reason to.

---

## 6. File-by-file change plan, in batches

### Batch A — content, mapping, census. ONE commit.

The length guard (`map-course.ts:194-200`) and the Zod census make every proper
subset of this batch fail loudly, so splitting it produces a red tree for no
benefit.

| # | File | Verb | What |
| --- | --- | --- | --- |
| A1 | `docs/community/discourse-export.json` | MODIFY | Rewrite topics 15–22; add 24, 25; drop `cooked` on all ten; add `curriculumNote` |
| A2 | `apps/ptah-license-server/prisma/seed/discourse-export.schema.ts` | MODIFY | 17→19, 19→21, 18→20 + the two docblocks |
| A3 | `apps/ptah-license-server/prisma/seed/map-topics.ts` | MODIFY | `CURRICULUM_TOPIC_IDS` + two docblocks |
| A4 | `apps/ptah-license-server/prisma/seed/map-course.ts` | MODIFY | `MODULE_TITLES`, `day-NN` slug, `COURSE_DESCRIPTION`, `curriculumTopicTitle` + the FR-TITLE-2 guard, computed error messages, the whole file docblock, the §5.7 offset block |
| A5 | `apps/ptah-license-server/prisma/seed/community-seed.ts` | MODIFY | **Comments and docblocks only** (§2.7) |

Gate: `nx typecheck ptah-license-server` and `nx lint ptah-license-server` green.
The suite is red at the end of Batch A — expected, Batch B closes it.

### Batch B — the spec. Depends on A.

| # | File | Verb | What |
| --- | --- | --- | --- |
| B1 | `apps/ptah-license-server/prisma/seed/community-seed.spec.ts` | MODIFY | §4.1 table, §4.2's six extras, §4.3's regexes + tripwire, §4.4's re-founded witness, the new FR-SLUG/FR-TITLE cases |

Gate: `nx test ptah-license-server` green; **no committed fixture edited**
(FR-TEST-1 — if one is, stop and report); the forum-half block at `:446-463` and
`:500` shows **zero diff**.

### Batch C — C4 scheduling. Independent of B; §5.11's runbook depends on A4's table.

| # | File | Verb | What |
| --- | --- | --- | --- |
| C0 | — | VERIFY | `temporal-polyfill` bundles under `nx build ptah-license-server`. Fails ⇒ stop and report (§5.4) |
| C1 | `libs/api/learning/src/lib/common/weekday-schedule.ts` | CREATE | Pure helper + `ScheduleInputError` |
| C2 | `libs/api/learning/src/lib/common/weekday-schedule.spec.ts` | CREATE | §5.10's pure cases |
| C3 | `libs/api-contracts/community/src/lib/admin/admin-course.contract.ts` | MODIFY | `AdminModuleScheduleEntry`, `AdminModuleSchedule` |
| C4 | `libs/api-contracts/community/src/index.ts` | MODIFY | Export both |
| C5 | `libs/api/audit/src/lib/audit-log.types.ts` | MODIFY | `'learning.module.schedule'` + comment |
| C6 | `libs/api/learning/src/lib/courses/dto/schedule-modules.dto.ts` | CREATE | The two DTOs |
| C7 | `libs/api/learning/src/lib/courses/course-schedule.service.ts` | CREATE | The service |
| C8 | `libs/api/learning/src/lib/courses/course-schedule.service.spec.ts` | CREATE | §5.10's service cases |
| C9 | `libs/api/learning/src/lib/courses/admin-course-modules.controller.ts` | MODIFY | Two handlers, `dtoPipe` on both, audit hook on apply only |
| C10 | `libs/api/learning/src/lib/courses/admin-course-modules.controller.spec.ts` | MODIFY | §5.10's controller cases |
| C11 | `libs/api/learning/src/lib/learning.module.ts` | MODIFY | Provider + docblock "seven"→"eight" |
| C12 | `libs/api/learning/src/lib/learning.module.spec.ts` | MODIFY | Provider list + count |
| C13 | `apps/ptah-license-server/src/common/route-map.spec.ts` | MODIFY | +2 `EXPECTED_ROUTES`, re-derived prose total |
| C14 | `apps/ptah-license-server/src/common/controller-validation.spec.ts` | MODIFY | `MIN_TOTAL_PAYLOAD_PARAMS` 78→80 + decomposition |
| C15 | `docs/community/curriculum-reseed-runbook.md` | CREATE | §5.11 |

Gate: `nx test ptah-license-server`, `nx test api-learning`, `nx test api-core`,
`nx lint`, `nx typecheck` all green.

### Deliberately NOT touched

`map-categories.ts`; `__fixtures__/*`; `prisma/schema.prisma` (no migration —
ten modules and a `DateTime` column are shapes the schema already expresses);
`module-lock.service.ts`; `libs/web/*` (there is no admin course UI to update —
recorded as a follow-up, not a gap in this task);
`apps/ptah-video-studio/promos/*` ("six to eight weeks" — R7, flagged, its own
task); anything from TASK_2026_201.

---

## 7. Sequencing and risk

```
A (content + mapping + census)  ──►  B (spec)
                                └──►  C (scheduling)   [C15 reads A4's table]
```

A → B is strict. C shares no file with A or B and can run in parallel from C0
once A4 lands. Recommended: one developer takes A+B (seed domain), one takes C
(NestJS domain) — they are different skill surfaces and different review lenses.

| # | Risk | P | I | Mitigation in this plan |
| --- | --- | --- | --- | --- |
| R1 | `\d` instead of `\d{1,2}` silently excludes Day 10 | **High** | High | §4.3's two edits **and** the explicit tripwire test that asserts the naive regex FAILS on Day 10 |
| R1b | FR-DATE-2's fixed offset table is shipped as-is and is wrong for a Tuesday start | **High** | High | §0 Finding 0; §5.7 replaces it with the rule plus two worked tables; §5.10 asserts the Tuesday-1-Sep dates in a unit test |
| R2 | An environment already holds the 8-week course | Low | Critical | C1 closes it: no environment is seeded. Runbook ships as documentation (§5.11) |
| R3 | `day-1` / `day-10` prefix collision | Medium | High | FR-SLUG-1 padding, asserted with the `startsWith` case in §4.3 |
| R4 | The anti-vacuity witness is deleted rather than re-founded | Medium | Medium | §4.4 gives the replacement verbatim **and** requires the test to state that the property is now weaker and why |
| R5 | §9's table worked to completion, suite still red | **High** | Low | §4.2 names the six lines §9 misses |
| R6 | Scope creep into lesson body authoring | Medium | Medium | §1.4 is the whole body, reused verbatim ten times |
| R7 | Marketing copy still says "six to eight weeks" | High | Medium | Out of scope; raise as a follow-up |
| R8 | New route lands without moving a census | **High** | Medium | §5.9 tables every one, with the re-derivation procedure for each |
| R9 | `temporal-polyfill` does not bundle, or its v1 surface differs | Low | Medium | C0 is a gate before any other C file; the fallback is local to C1 because the helper's signature was chosen for it |
| R10 | Preview and apply drift apart, making the rehearsal a lie | Medium | **High** | §5.6: one service method, one return type, `apply` as a flag. Asserted by the DTO-distinctness cases and by the shared `AdminModuleSchedule` |
| R11 | The two new export topics land with a `createdAt` that is not safely in the past | Low | Medium | §1.5 fixes 2026-08-10T00:00:00.000Z, a full day of margin against `:1142` |
| R12 | `COURSE_DESCRIPTION` phrased "one module per weekday" fails AC 1.2's substring check | Medium | Low | §2.5 — take the phrasing without the `week` stem, not a looser assertion |

### Definition of done (task description §13, with C1–C5 applied)

- [x] Founder approved the module table — C2, and it REPLACES §4's
- [ ] `discourse-export.json`: 19 topics / 21 posts / 20 non-empty bodies, 10 curriculum
- [ ] `CURRICULUM_TOPIC_IDS` and `MODULE_TITLES` both hold 10, in order
- [ ] Module and lesson slugs are `day-01`…`day-10`
- [ ] `COURSE_DESCRIPTION` describes the intensive and contains neither `eight-week` nor `one module per week`
- [ ] The title-consistency guard is in `buildCourseRows` and fails on a deliberate mismatch
- [ ] `community-seed.spec.ts` green; forum-half assertions show zero diff
- [ ] `seed-community` exits 0 twice in a row, second run 0 creates
- [ ] Docblocks in `map-course.ts` and `community-seed.ts` no longer describe an eight-week course
- [ ] The weekday-offset rule (start-weekday dependent) and the cleanup runbook are written down
- [ ] **C4:** two routes, both `dtoPipe`-bound, both in `EXPECTED_ROUTES`; preview writes nothing and audits nothing; apply refuses a wrong `confirmLastReleaseDate` or `confirmModuleCount` with zero writes; a second identical apply reports `changedCount: 0`; the Tuesday-1-Sep-2026 schedule is asserted in a unit test; `ModuleLockService`, the seed's `releaseAt` exclusion and `PATCH :id` are all unchanged

---

## Clarifications Needed

None. C1–C5 closed the three open items in `task-description.md`, and every
decision C4 left to the architect — endpoint shape, placement, DTO, helper
location, audit action, idempotency, manual-`releaseAt` handling,
preview-vs-apply, and timezone handling — is settled in §5 with evidence.

Two items are recorded as inputs rather than blockers: the founder chooses
`timeOfDay` and `timeZone` per cohort at the moment he runs the action (§5.11
step 5), and C5 keeps the default **open** until he does.
