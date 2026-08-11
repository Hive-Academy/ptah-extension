# Requirements Document — TASK_2026_202

Restructure the seeded Builders curriculum from 8 weekly modules to a 10-day
intensive across 5 domains.

---

## 1. Business Context

The seeded course `ptah-builders-cohort-1` is an eight-week, one-module-per-week
cohort. It is assembled by `apps/ptah-license-server/prisma/seed/map-course.ts`
from the 8 "Week N build thread" topics at
`docs/community/discourse-export.json:201-344` (source ids 15…22, listed at
`apps/ptah-license-server/prisma/seed/map-topics.ts:34-36`).

The founder has decided the cohort runs as a **2-week intensive at 3h/day — 10
weekday sessions, ~30 live hours** against roughly 12 in the weekly format. The
seed data therefore no longer describes the product a member will buy, and the
member course page (`libs/web/members/src/lib/learning/`) renders that stale
description directly.

Scope was settled in `.ptah/specs/TASK_2026_202/context.md:22-46`: **five
domains, not the founder's seven**. Billing and social integrations do not
compress to 4 hours each; one social platform is built end-to-end as the
exemplar and the rest become the post-cohort bonus session. That decision is
recorded and is not re-opened here.

This is seed **data plus a mapping module with a hard count assertion**, not
prose. `map-course.ts:194-200` throws when `MODULE_TITLES.length` and
`CURRICULUM_TOPIC_IDS.length` disagree, so the edit is atomic across files by
construction — a half-done change fails the seed loudly instead of silently
titling day 4 with day 5's heading.

---

## 2. In Scope

| Area | Change |
| --- | --- |
| Curriculum content | 8 "Week N" source topics → 10 "Day N" source topics in `docs/community/discourse-export.json` |
| Mapping | `MODULE_TITLES`, `CURRICULUM_TOPIC_IDS`, module/lesson slug scheme, course description |
| Census constants | `EXPECTED_TOPIC_COUNT`, `EXPECTED_POST_COUNT`, `EXPECTED_NON_EMPTY_BODY_POSTS` |
| Title defect | Repair `map-course.ts:38-40` (source topic 21 "Week 7 … Hardening — tests, policies, observability" vs module title "Hardening") and make the class of defect a build failure |
| Tests | `community-seed.spec.ts` count, slug, regex and summary-string assertions |
| Docs | The docblocks that state "eight weeks, one thread each" |
| Runbook | The `releaseAt` schedule the daily cadence needs, and the stale-module cleanup step |

## 3. Out of Scope

- **Authoring lesson body content or video for the 10 sessions.** Only titles,
  the one-line descriptions in §4, and the existing "post here as you work
  through this session" thread-shell body.
- **Any unlock or progress mechanic.** `ModuleLockService`
  (`libs/api/learning/src/lib/courses/module-lock.service.ts:55-110`) and the
  manual-completion basis (`map-course.ts:20-27`) are untouched. A daily cadence
  needs new dates, not new mechanics.
- **Everything in TASK_2026_201** — comp licences, invite email, approval flow.
- **`sequential`** stays `false` (`map-course.ts:278`). Ten daily modules is a
  stronger reason to leave it off, not a reason to turn it on.
- **The bonus session** for the remaining social platforms. It is a Builders
  *session* (`libs/api/community` sessions), not a course module, and it is not
  seeded by this task.
- **Marketing copy that says "six to eight weeks"** —
  `apps/ptah-video-studio/promos/ptah-builders-launch.json:25-37` and
  `ptah-builders-launch-vertical.json:25-34`. Flagged, not fixed: those are
  rendered promos with recorded narration, and re-cutting them is its own task.

---

## 4. The 10 Daily Modules — 🔴 FOUNDER REVIEW REQUIRED

**This is the founder's curriculum. The table below is a draft for him to
approve, amend or reject at Checkpoint 1. No file is edited until he signs off
on the titles.**

Two days per domain. The arc is one coherent vertical slice of a real SaaS —
by the end of Day 10 a signed-up user in an organisation has created a project,
added products, paid for a plan, and had an AI agent draft a post that published
to a live social account, all running on a URL that has been deploying since
Day 2.

| Day | Domain | Module title | What gets built in the session |
| --- | --- | --- | --- |
| 1 | 1. Foundation | The workspace — monorepo, boundaries, first green CI | Nx workspace with an API app and a web app, enforced module boundaries, and a CI pipeline that runs lint + typecheck + test on every PR. |
| 2 | 1. Foundation | The database and the deploy pipe — Postgres, migrations, staging on merge | Postgres + an ORM, the first migration, env config through a config service, and a containerised deploy so every merge lands on a staging URL. |
| 3 | 2. Auth + user + tenancy | Sign-up, sign-in, session | A hosted auth provider wired end-to-end: redirect, callback, session cookie, route guard, and a `/me` endpoint the web app actually calls. |
| 4 | 2. Auth + user + tenancy | Users, organisations and the tenancy boundary | User, organisation and membership models, roles, and the single place every query is tenant-scoped so the boundary is one thing to review rather than fifty. |
| 5 | 3. Domain modelling | Projects — the first aggregate and its migrations | The `projects` module: schema, migration, ownership, soft delete, list and detail endpoints, and the web screens that consume them. |
| 6 | 3. Domain modelling | Products — nested resources, validation and the API contract | Products under a project: nested routing, validation at every external boundary, shared wire contracts between API and web, and pagination that survives real row counts. |
| 7 | 4. Billing + entitlements | Checkout — plans, prices and the first paid subscription | Payment provider setup, plan and price configuration, a working checkout session, and the customer portal — a real card charged in test mode. |
| 8 | 4. Billing + entitlements | Webhooks and entitlements — turning a payment into a durable fact | Signature verification, idempotent handlers, the subscription state machine, and plan gates enforced on the server and reflected in the UI. |
| 9 | 5. AI + integrations | The agent in the product — tools, streaming and cost control | A server-side agent endpoint with tools that call your own domain (projects, products), streamed to the browser, with usage and rate limits so it cannot bankrupt you. |
| 10 | 5. AI + integrations | One integration end to end — OAuth, token refresh and publishing | A single social platform connected by OAuth: encrypted token storage, refresh before expiry, publishing an agent-drafted post, and the failure and retry path when the platform says no. |

### Curriculum decisions the founder is being asked to confirm

1. **Two of today's eight modules have no standalone successor.** "Hardening —
   tests, policies, observability" (source topic 21) and "Deploy and launch"
   (source topic 22) are distributed rather than dropped: CI and tests on Day 1,
   deploy on Day 2 and continuously after, tenancy policy on Day 4, webhook
   idempotency on Day 8, rate limits on Day 9. Deploying on Day 2 also removes
   the Day 10 launch crunch that a two-week format cannot absorb.
2. **One social platform, not all of them** — already decided in
   `context.md:33-37`; the remaining platforms are the free post-cohort bonus
   session.
3. **"Agents, memory and skills" (source topic 20) narrows to Day 9** — agent
   integrations inside the product. Memory and skills as a topic in their own
   right do not fit 3 hours alongside tools, streaming and cost control.

---

## 5. The Exact Set of Files That Change Together

Every file below is coupled to at least one other by a value that is asserted,
not merely assumed. `map-course.ts:194-200` is the enforcement point: it throws
`CourseMappingError` before any database work when the two arrays disagree in
length, so a partial edit aborts the seed with a named error rather than
producing a mis-titled curriculum.

| # | File | What changes | Why it is coupled |
| --- | --- | --- | --- |
| 1 | `docs/community/discourse-export.json:201-344` | The 8 curriculum topics become 10, retitled "Day N build thread — …", with new slugs, new bodies and two new source ids (23 is taken by an existing topic — allocate the next free ids, e.g. 24 and 25) | It is the seed's single content source (`community-seed.ts:73-77`, MG-1.1). Its topic ids ARE `CURRICULUM_TOPIC_IDS`; its topic titles ARE the lesson titles (`map-course.ts:260`); its post #1 `raw` IS the lesson body (`map-course.ts:261`) |
| 2 | `apps/ptah-license-server/prisma/seed/map-topics.ts:34-36` | `CURRICULUM_TOPIC_IDS` → 10 ids | Zipped index-for-index with `MODULE_TITLES` at `map-course.ts:213`. **`map-course.ts:194-200` hard-throws if the lengths differ** |
| 3 | `apps/ptah-license-server/prisma/seed/map-course.ts:88-97` | `MODULE_TITLES` → 10 titles | Same zip. Also `map-course.ts:245-250` throws per-index if a title is missing |
| 4 | `map-course.ts:244` | `` `week-${index + 1}` `` → the padded daily scheme in §6 | The module slug is also the lesson slug (`map-course.ts:258`, §7.3) and is the natural key both writes are idempotent on (`community-seed.ts:585`, `:627`) |
| 5 | `map-course.ts:60-62` | `COURSE_DESCRIPTION` — "The eight-week Ptah Builders cohort, one module per week" | Member-visible copy under the course title. It is written on both the create AND the update branch (`community-seed.ts:546`), so a re-seed corrects it in place |
| 6 | `apps/ptah-license-server/prisma/seed/discourse-export.schema.ts:56-61` | `EXPECTED_TOPIC_COUNT` 17→19, `EXPECTED_POST_COUNT` 19→21, `EXPECTED_NON_EMPTY_BODY_POSTS` 18→20 | Zod enforces these as exact censuses (`:130-148`). Two new topics with one post each make the current export fail validation before a single write |
| 7 | `apps/ptah-license-server/prisma/seed/community-seed.spec.ts` | See §9 for the enumerated assertions | It asserts the counts, the literal slug list, the `Week \d` title regex and the summary strings |
| 8 | `map-course.ts:1-41`, `:80-87`, `:138`, `community-seed.ts:26-30`, `:520-527` | Docblocks that say "8", "eight weeks", "one module per week", "` week-1` … `week-8`", "weekly release" | These docblocks are the design record. Leaving them describing a format that no longer exists is the defect this task is repairing, one level up |

**Not coupled, and deliberately not touched:**

- `apps/ptah-license-server/prisma/seed/map-categories.ts` — builds the 4
  categories. It never reads `topic_count`, so adding two topics to category 5
  changes nothing there.
- `apps/ptah-license-server/prisma/seed/__fixtures__/malformed.json` and
  `structurally-invalid.json` — both fail before any content is examined
  (`__fixtures__/README.md:13-14`). The two other fixtures are **derived at test
  time from the real export** (`README.md:16-28`), so they track the new export
  automatically. **No committed fixture needs editing**; if one does, that is a
  signal the change went wider than intended.
- `apps/ptah-license-server/prisma/schema.prisma` — no schema change. Ten
  modules is a data shape the current schema already expresses, which is exactly
  what `map-course.ts:9-13` bought by refusing to collapse the weeks into one
  module.

---

## 6. Slug and Identity Requirements

### The existing rules, as the seed states them

1. **Slugs are literals, never generated.** `map-course.ts:168-174`:
   `buildSlug()` is create-path-only and its collision resolver takes the set of
   slugs already in use, so a second run would see run 1's `week-1`, resolve
   `week-1-2` and create a duplicate module — destroying the one property the
   exit gate is built on. The same finding was established for topics in
   `map-topics.ts:132-142`.
2. **The lesson slug equals its module slug** (§7.3, `map-course.ts:258`,
   asserted at `community-seed.spec.ts:1064-1072`).
3. **Slugs must match `^[a-z0-9]+(-[a-z0-9]+)*$`** — the character set the
   generator emits (`discourse-export.schema.ts:95-101`).
4. **Module identity is `@@unique([courseId, slug])`** (`community-seed.ts:585`);
   lesson identity is `@@unique([moduleId, slug])` (`:627`).

### FR-SLUG-1 — Zero-padded daily slugs

Module and lesson slugs SHALL be `day-01`, `day-02` … `day-10`.

- **Zero padding is required, not cosmetic.** `day-1` … `day-10` unpadded makes
  `day-1` a strict prefix of `day-10`. Every `startsWith`, every `LIKE 'day-1%'`
  and every regex written without an anchor then matches two modules. Padding
  also makes lexical order equal numeric order, so a slug-sorted admin list
  reads correctly.
- `day-01` satisfies the slug character set (rule 3 above) — verify, do not
  assume.
- The slug SHALL be produced positionally from the index, e.g.
  `` `day-${String(index + 1).padStart(2, '0')}` ``, replacing
  `map-course.ts:244`. This is a literal derived from position, not a call to
  `buildSlug()`, so rule 1 is preserved.
- The new slug set is **disjoint from `week-1` … `week-8`**, which is what makes
  §8's stale-module behaviour a visible overlay rather than a silent overwrite.

### FR-SLUG-2 — Export topic slugs

The 10 curriculum topics in `discourse-export.json` SHALL carry slugs of the
form `day-01-build-thread-<kebab of the descriptive half>` — unique across all
19 topics (`discourse-export.schema.ts:145-148` enforces uniqueness) and
matching the slug regex. These slugs are never written to the database for
curriculum topics; they exist so the export's own uniqueness invariant holds.

### FR-SLUG-3 — Title asymmetry is intentional

Human-facing titles use "Day 1", not "Day 01". Only slugs are padded. Any spec
regex written against titles SHALL therefore accept **one or two digits**:
`/^Day \d{1,2} build thread — /`, not `/^Day \d build thread — /`. The current
`/^Week \d build thread — /` at `community-seed.spec.ts:1030` would silently
fail on "Day 10" — this is the single most likely way this change ships broken.

---

## 7. The Pre-Existing Title Defect

`map-course.ts:36-40` records it: source topic 21 is titled "Week 7 build thread
— Hardening — tests, policies, observability" while `MODULE_TITLES[6]` is simply
`'Hardening'`. The docblock says a derivation "would also be wrong today, not
merely fragile".

### FR-TITLE-1

For every index `i`, the source topic title SHALL equal
`` `Day ${i + 1} build thread — ` + MODULE_TITLES[i] ``. The two halves stay
independently authored in two files; the equality is a **consistency check
between them**, the same species as the length assertion at
`map-course.ts:194-200`.

### FR-TITLE-2

That consistency SHALL be enforced mechanically — either a second guard in
`buildCourseRows` beside the length check, or an assertion in
`community-seed.spec.ts`. A guard in `buildCourseRows` is preferred: it fails
the seed, not only the test suite, and this defect class has already survived
one review.

### ⚠️ Consequence the developer must handle, not delete

`community-seed.spec.ts:1099-1113` uses precisely this divergence as its
**anti-vacuity witness** that `MODULE_TITLES` is editorial rather than derived
from the topic titles. Repairing the defect removes that witness. The test SHALL
be re-founded, not deleted, on the divergence that remains true by design: the
lesson title retains the `Day N build thread — ` prefix (`map-course.ts:112-115`)
while the module title does not, so `module.title !== module.lesson.title` holds
for all 10 and still proves the module title is not a copy of `source.title`.

---

## 8. Idempotency of Re-Seeding — Derived From the Code, Not Assumed

**Question:** re-running the seed against a database that already holds the
8-week course — does it update, duplicate, or fail?

**Answer: none of those three. It overlays.** This is fully derivable from
`community-seed.ts` and is stated here as fact:

| Entity | Behaviour on a DB holding the 8-week course | Evidence |
| --- | --- | --- |
| Course | **Updated in place.** `COURSE_SLUG` is unchanged, so `findUnique({where:{slug}})` hits and the update branch runs. The new description, title and sort order land correctly | `community-seed.ts:539-562` |
| 10 new modules | **Created.** `day-01`…`day-10` do not exist under `courseId_slug` | `community-seed.ts:584-612` |
| 10 new lessons | **Created**, with their source `createdAt` | `community-seed.ts:626-651` |
| 8 old `week-N` modules | **Left in place, published, visible.** They are never read and never deleted | `SeedTransactionClient`'s `Delegate` (`community-seed.ts:105-109`) exposes only `findUnique`, `create` and `update`. **The seed has no delete verb at all** |
| 8 old lessons | Left in place under their orphaned modules | same |

**Net observable defect:** the member course page renders **18 modules**, eight
of them describing a format that no longer exists, with `sortOrder` values
100–800 colliding with the new 100–1000. No duplicate content, no crash, no
error — which is why this is the highest-risk item: it fails quietly and looks
like a content mistake rather than a seeding one.

### FR-IDEM-1 — Zero creates on the second run of the NEW seed

Against a **fresh** database the seed SHALL produce 1 course, 10 modules and 10
lessons created and 0 updated; a second run SHALL produce **0 creates**. This is
the existing exit-gate observable (`community-seed.ts:203-211`) and it must
survive the restructure unchanged.

### FR-IDEM-2 — Documented cleanup, not a new delete path

The seed SHALL NOT gain a delete verb. Removing content is not a seed's job and
adding `delete` to `SeedTransactionClient` would put a destructive operation in
a script whose whole safety argument (`community-seed.ts:79-92`) is that a
re-run cannot destroy work done in the product.

Instead, the task SHALL deliver a written cleanup runbook for any environment
that already holds the 8-week course:

- **Non-production:** `nx run ptah-license-server:prisma:reset` then
  `nx run ptah-license-server:seed-community`.
- **Production/staging:** soft-delete the eight stale modules through
  `DELETE /api/v1/admin/course-modules/:id`
  (`libs/api/learning/src/lib/courses/admin-course-modules.controller.ts:227`).
  It is a soft delete with an audit row, and every member read filters
  tombstones at the nested `where` (same file, `:212-226`), so the eight
  disappear from the member view without losing the record that they existed.

**Which environments are affected is a fact I cannot read from the code — see
§12.**

---

## 9. Test and Assertion Changes

`community-seed.spec.ts` currently encodes the 8-week shape in at least the
following places. Each SHALL be updated, and none SHALL be weakened to a
tautology to make it pass.

| Line(s) | Assertion | Required change |
| --- | --- | --- |
| 418-424 | "exactly 4 categories, 17 topics and 19 posts" — title and body | 19 topics, 21 posts; update the test name too |
| 427-443 | `CURRICULUM_TOPIC_IDS` has 8; split covers every source id | 10; the coverage check is generic and keeps working |
| 446-462 | Writes 9 topics and 10 posts | Unchanged — the forum half is untouched. **If this moves, the change went too wide** |
| 465-472 | 18 non-empty bodies = post count − 1 | 20; the `− 1` relation still holds (one small-action post) |
| 984-989, 1035-1037 | Imported topics do not match `/^week-\d/` | `/^day-\d/` |
| 998-1012 | 1 course, 8 modules, 8 lessons | 10 and 10 |
| 1029-1031 | `/^Week \d build thread — /` | `/^Day \d{1,2} build thread — /` — see FR-SLUG-3 |
| 1040-1072 | Literal slug list `week-1`…`week-8`, sortOrders 100…800, `/^week-[1-8]$/` | `day-01`…`day-10`, 100…1000, `/^day-(0[1-9]\|10)$/` |
| 1099-1113 | The "Hardening" anti-vacuity witness | Re-found per §7 |
| 1115-1126, 1145-1155, 1157-1168 | `db.lessons.size` 8, `lessonWrites` 8, structural writes 9 | 10, 10, 11 |
| 1344, 1365, 1383, 1401, 1431 | Byte-fidelity and refresh-body tests keyed on `'week-1'` | Re-key to `'day-01'` |
| 1515 | `MODULE_TITLES` length equals `CURRICULUM_TOPIC_IDS` length | Unchanged and still the right check |
| 1540-1547, 1568-1584 | Summary strings with literal counts | Recompute: `source topics 19 = 10 curriculum + 9 topics`, `source posts 21 = 10 written + 1 skipped + 10 curriculum`, bodies `20/20` |

### FR-TEST-1 — Fixtures

No committed fixture is expected to change (`__fixtures__/README.md:6-14`). The
derived fixtures rebuild from the real export at test time (`:16-28`). If a
committed fixture needs editing to make the suite pass, stop and report — it
means something outside the intended blast radius moved.

---

## 10. Date-Unlock Consequence

### The mechanism, unchanged

- `CourseModule.releaseAt` (`apps/ptah-license-server/prisma/schema.prisma:715`)
  is the only date gate. A future value ⇒ locked with
  `reason: 'not_released'` and `unlocksAt: releaseAt`; `releaseAt === now` ⇒
  **unlocked** (`libs/api/learning/src/lib/courses/module-lock.service.ts:55-73`,
  `:109-110`).
- Per-module unlock is exactly why the curriculum was modelled as N modules
  rather than one module of N lessons (`map-course.ts:9-13`). **A daily cadence
  therefore needs ten `releaseAt` writes and no schema or mechanic change** —
  which is the whole point of that decision paying off.

### FR-DATE-1 — The seed still does not write `releaseAt`

`releaseAt` is deliberately excluded from the module update payload
(`community-seed.ts:520-524`, `:589-592`) so a re-run cannot silently
unschedule modules an admin has date-gated. That exclusion SHALL survive. The
seed continues to create modules with `releaseAt = null`, i.e. all open.

### FR-DATE-2 — The schedule is an admin action, documented here

The release schedule lives in the database, set through
`PATCH /api/v1/admin/course-modules/:id` with `UpdateModuleDto.releaseAt`
(`libs/api/learning/src/lib/courses/admin-course-modules.controller.ts:176`).
The task SHALL deliver, in the `map-course.ts` docblock, a table of the ten
weekday offsets from a cohort start date (Day 1 = start, Days 2–5 = +1…+4 days,
Day 6 = +7 … Day 10 = +11 — i.e. skipping the weekend), so an operator sets ten
dates from one input instead of counting weekdays by hand.

### FR-DATE-3 — Sparse ordering survives

`SORT_ORDER_STEP` stays 100 and the ten modules occupy 100…1000
(`map-course.ts:71`, `:256`). Ten modules with gaps of 100 still leaves room for
the bonus session to be inserted later without a renumber (R8.8).

---

## 11. Functional Requirements and Acceptance Criteria

### Requirement 1 — The course a member sees describes a 10-day intensive

**User Story:** As a Builders member opening the course, I want the curriculum to
show the ten daily sessions I actually attend, so that the product matches what I
paid for.

**Acceptance Criteria**

1. WHEN the member course page loads THEN it SHALL list exactly 10 modules,
   titled per §4, in day order.
2. WHEN the course description renders THEN it SHALL describe a two-week,
   ten-session intensive and SHALL NOT contain the string "eight-week" or "one
   module per week" (`map-course.ts:60-62`).
3. WHEN a module is opened THEN it SHALL contain exactly one lesson whose title
   is the full source topic title including the `Day N build thread — ` prefix
   (`map-course.ts:112-115`).
4. WHEN any module's `sortOrder` is read THEN the ten values SHALL be
   100, 200 … 1000 with no duplicates.

**BDD**

```gherkin
Scenario: Ten daily modules replace eight weekly ones
  Given a database with no ptah-builders-cohort-1 course
  When the community seed runs
  Then exactly 1 course, 10 modules and 10 lessons are created
  And every module slug matches /^day-(0[1-9]|10)$/
  And every lesson slug equals its module's slug
  And no module slug matches /^week-/
```

### Requirement 2 — A partial edit fails loudly

**User Story:** As the developer making this change, I want an inconsistent edit
to abort the seed with a named error, so that a mis-titled curriculum cannot
reach a member.

**Acceptance Criteria**

1. WHEN `MODULE_TITLES.length !== CURRICULUM_TOPIC_IDS.length` THEN
   `buildCourseRows` SHALL throw `CourseMappingError` before any database work
   (`map-course.ts:194-200`, unchanged).
2. WHEN a curriculum topic id names a topic absent from the export THEN the seed
   SHALL abort with the present ids listed (`map-course.ts:216-219`).
3. WHEN the export carries any count other than 19 topics / 21 posts / 20
   non-empty bodies THEN Zod SHALL reject the file before the transaction opens
   (`discourse-export.schema.ts:130-148`, `community-seed.ts:217-220`).
4. WHEN a source topic title does not equal
   `` `Day ${n} build thread — ` + MODULE_TITLES[n-1] `` THEN the seed SHALL
   abort (FR-TITLE-2).

### Requirement 3 — The seed stays idempotent and non-destructive

**User Story:** As an operator, I want to re-run the seed safely against any
environment, so that a content correction does not require a database reset.

**Acceptance Criteria**

1. WHEN the seed runs twice against a fresh database THEN the second run SHALL
   report **0 creates** across courses, modules and lessons.
2. WHEN the seed runs against a database with existing modules THEN it SHALL NOT
   issue any delete — `SeedTransactionClient` SHALL still expose only
   `findUnique`, `create` and `update` (`community-seed.ts:105-109`).
3. WHEN a module has an admin-set `releaseAt` THEN a re-run SHALL leave it
   untouched (`community-seed.ts:589-592`).
4. WHEN a lesson body has been edited in the product THEN a re-run without
   `--refresh-bodies` SHALL leave it untouched (`community-seed.ts:654-655`).
5. WHEN an environment already holds the 8-week course THEN the delivered
   runbook SHALL state the cleanup step (FR-IDEM-2), and the task SHALL NOT
   claim the overlay is harmless.

### Requirement 4 — The suite proves the new shape, without going vacuous

**Acceptance Criteria**

1. WHEN `nx test ptah-license-server` runs THEN `community-seed.spec.ts` SHALL
   pass green with every assertion in §9 updated.
2. WHEN the byte-fidelity test runs THEN every mapped `bodyMarkdown` SHALL still
   be byte-identical to the export `raw` — no trim, no re-wrap
   (`community-seed.spec.ts:476-489`, `map-course.ts:116-122`).
3. WHEN the anti-vacuity title test runs THEN it SHALL assert a divergence that
   is true by design (§7), not one deleted to make the suite pass.
4. WHEN the forum-half assertions run THEN they SHALL be **unchanged** — 4
   categories, 9 topics, 10 posts, 1 skipped empty body. Any movement there is a
   blast-radius failure.
5. WHEN `nx run ptah-license-server:seed-community` runs against a local
   database THEN it SHALL exit 0 and print a summary whose two computed
   assertion lines both read `OK` (`community-seed.ts:305-321`).

### Requirement 5 — The export stays honest about what it is

**User Story:** As a future maintainer, I want to know that the curriculum
topics are editorial content maintained in place, so that I do not try to
re-capture them from a forum that was destroyed on 2026-08-04
(`community-seed.ts:12-16`).

**Acceptance Criteria**

1. WHEN the ten curriculum topics are written THEN each SHALL carry
   `username: "system"` so `collectUnmatchedUsernames`
   (`community-seed.ts:337-349`) still reports one entry —
   `system (21 posts)` — and `community-seed.spec.ts:852-855` stays a
   single-row assertion.
2. WHEN a curriculum topic's `raw` is authored THEN it SHALL contain no U+FFFD
   character and SHALL be non-empty (`discourse-export.schema.ts:76-81`,
   `map-course.ts:236-242`).
3. WHEN a rewritten or newly authored curriculum topic is given a `createdAt`
   THEN it SHALL be a fixed ISO instant **already in the past at commit time** —
   `community-seed.spec.ts:1142` asserts lesson `createdAt` is strictly before
   test start, so a same-day or future instant makes the suite flaky. Because
   this pass rewrites the title and body of all ten, the authoring instant of
   this restructure is the honest value for all ten, not the 2026-08-01 capture
   instant.
4. WHEN the export is read THEN a note in the file and in `map-course.ts`'s
   docblock SHALL record that the curriculum topics are editorial and are not a
   Discourse capture, while the nine forum topics are.

### Non-Functional Requirements

- **Correctness over speed.** The transaction budget (`community-seed.ts:278`,
  60s) already covers ~94 round trips; 10 modules adds ~8 more. No change.
- **Security.** No new external boundary, no new input. Lesson bodies continue
  through `libs/frontend/markdown` at render time.
- **Reviewability.** Every count in the summary stays computed, never restated
  (`community-seed.ts:305-307`).
- **Style.** `nx lint ptah-license-server` and `nx typecheck ptah-license-server`
  green; `readonly string[]` / `as const` shapes preserved.

---

## 12. Risks

| # | Risk | Probability | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | A regex written as `\d` instead of `\d{1,2}` silently excludes Day 10 | **High** | High | FR-SLUG-3; §9 names every regex line. Add an explicit Day-10 case to the suite |
| R2 | An environment already holds the 8-week course, producing an 18-module overlay | Medium | **Critical** (member-visible, silent) | §8 + FR-IDEM-2 runbook; §12 clarification Q1 must be answered before deploy |
| R3 | Unpadded `day-1` vs `day-10` prefix collision in a later query or admin filter | Medium | High | FR-SLUG-1 zero padding |
| R4 | The anti-vacuity title test is deleted rather than re-founded, quietly losing the guard | Medium | Medium | §7's explicit consequence note; style-reviewer checkpoint |
| R5 | Census constants updated in the schema but not in the spec's literal strings, or vice versa | Medium | Low | Both fail loudly; §9 enumerates them |
| R6 | Scope creep into lesson body authoring | Medium | Medium | §3; the thread-shell body is reused verbatim for all ten |
| R7 | Marketing copy still says "six to eight weeks" after the curriculum changes | High | Medium | Flagged in §3; raise as a follow-up task, do not fix here |
| R8 | Founder rejects the module titles at Checkpoint 1 after code is written | Medium | Medium | §4 is reviewed **before** any file is edited; the arrays are the only thing that changes if titles move |

---

## 13. Definition of Done

- [ ] Founder has approved the §4 table (or supplied replacements).
- [ ] `discourse-export.json` holds 19 topics / 21 posts / 20 non-empty bodies,
      10 of them curriculum.
- [ ] `CURRICULUM_TOPIC_IDS` and `MODULE_TITLES` both hold 10 entries, in order.
- [ ] Module and lesson slugs are `day-01`…`day-10`.
- [ ] `COURSE_DESCRIPTION` describes the intensive.
- [ ] The title-consistency guard exists and fails on a deliberate mismatch.
- [ ] `community-seed.spec.ts` green; forum-half assertions untouched.
- [ ] `nx run ptah-license-server:seed-community` exits 0 twice in a row, second
      run 0 creates.
- [ ] Docblocks in `map-course.ts` and `community-seed.ts` no longer describe an
      eight-week course.
- [ ] The `releaseAt` weekday-offset table and the stale-module cleanup runbook
      are written down.

---

## Clarifications Needed

Three items are genuinely unresolved. Q1 blocks deployment (not development);
Q2 and Q3 are founder decisions at Checkpoint 1.

### 1. Which environments already hold `ptah-builders-cohort-1`?

Not derivable from the repository — it is a database fact. §8 proves that a
re-seed against such an environment leaves eight stale `week-N` modules visible
alongside the ten new ones, silently.

- **Option A (Recommended)** — No environment has run `seed-community` against a
  persistent database yet. Then nothing to clean up; the runbook ships as
  documentation only.
- **Option B** — Staging has it. Reset staging
  (`prisma:reset` + re-seed) before the change lands.
- **Option C** — Production has it. Soft-delete the eight modules through
  `DELETE /api/v1/admin/course-modules/:id` in the same deploy window, in the
  documented order, before members see the course.

### 2. What is the cohort start date?

FR-DATE-2 delivers the weekday-offset table; turning it into ten concrete
`releaseAt` values needs the Day 1 date.

- **Option A (Recommended)** — Supply a date now; the developer writes the ten
  resolved dates into the runbook table.
- **Option B** — Ship offsets only; the operator resolves them when the cohort
  is scheduled. Does not block this task.
- **Option C** — Run the cohort with all ten modules open from day one
  (`releaseAt = null`, which is what the seed already produces) and use the live
  session calendar as the only pacing signal.

### 3. Do "Hardening" and "Deploy and launch" survive as standalone sessions?

§4 distributes them (deploy on Day 2, hardening across Days 1/4/8/9) rather than
giving each a session, because five domains × two days is exactly ten.

- **Option A (Recommended)** — Distribute, as drafted. Deploying on Day 2
  removes the Day 10 launch crunch a two-week format cannot absorb.
- **Option B** — Keep a dedicated hardening session and drop one Domain-3 day
  (products folds into Day 5).
- **Option C** — Keep both and make it 12 days. Rejected by
  `context.md:22-46`'s scope decision unless the founder reopens it.
