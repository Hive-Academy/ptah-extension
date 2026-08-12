# Batch 8 report — P2-MIG: the MG-1 community seed + the MG-5 close-out

**Executor**: `backend-developer`
**Date**: 2026-08-05
**Branch**: `ak/license-server-validation-pipe` (never switched, never rebased)
**HEAD at start and at end**: `46f0cde07` — it did not move during this batch.
**Tasks**: 8.1 – 8.8, all complete.
**Nothing was staged or committed.** No `git add`, `commit`, `rm`, `stash`, `reset`,
`checkout <path>` or `restore` was run. `--no-verify` was never used. No migration was
created, edited or applied; `migrate reset` and `db push` were never run.

---

## 🔴 Read this first — the one number that does not match the exit gate

**The seed creates 4 categories, 9 topics and 10 posts. The exit gate says 11 posts.**

The export's 11th post — topic 13 ("Start here — how this cohort works", pinned), post #2 —
has `raw: ""`. Not `null`; the empty string. Its rendered field is empty too. plan §7.1
records "`raw` populated: **19 of 19. Zero nulls.** 12,474 chars" — the character total is
exactly right and "zero nulls" is literally true, but one of the 19 carries no body.

Task 8.3 prescribes `raw: z.string().min(1)`. **Implemented literally, the seed aborts on the
real export and can never run at all**, so the exit gate would be unreachable rather than
red. The three options and what was chosen are in
[Finding 2](#finding-2--one-post-has-an-empty-raw-and-the-plan-says-none-does). The short
version: the post is skipped, counted, named in the summary, asserted in the spec, and
controlled by one constant (`SKIP_EMPTY_BODY_POSTS`) so reversing the decision is a one-line
change. Every other exit-gate item is met.

**This is the one item worth a decision from the user.** Recommended follow-up: re-capture
the export without Discourse small-action posts, at which point the counts become 17 topics /
18 posts, `EXPECTED_NON_EMPTY_BODY_POSTS` and `EXPECTED_POST_COUNT` move together, and the
skip constant can be deleted.

---

## Exit gate — every item, with its evidence

| #   | Gate item                                                                         | Result            | Evidence                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Seed runs against local `ptah_db`, creates 4 categories / 9 topics / **11** posts | ⚠️ **4 / 9 / 10** | [§Task 8.2 run 1](#run-1--first-execution). The 11th post is the empty-body one.                                                                                             |
| 2   | Every `bodyMarkdown` **byte-identical** to the export `raw`                       | ✅                | [§Byte fidelity](#byte-fidelity--sha-256-per-body-database-vs-file). SHA-256 + byte length per post, DB vs file, `diff` empty.                                               |
| 3   | Every topic and post carries the export's original `createdAt`, not `now()`       | ✅                | [§Timestamps](#timestamps--the-source-instant-not-nowc). `psql` shows 2026-07-22 / 07-24 / 08-01; zero rows dated today.                                                     |
| 4   | A second run produces **zero** creates                                            | ✅                | [§Run 2](#run-2--idempotency). `created 0` on all three lines, `updated 4/9/10`, row counts unchanged.                                                                       |
| 5   | A `raw: null` fixture aborts and writes nothing                                   | ✅                | Spec (zero recorded calls) **and** a live run against `ptah_db` with the row-set md5 unchanged. [§Abort proofs](#the-two-abort-fixtures--proven-twice-in-the-spec-and-live). |
| 6   | A U+FFFD fixture aborts and writes nothing                                        | ✅                | Same, same.                                                                                                                                                                  |
| 7   | Summary reports `unmatched usernames: system (19 posts)`                          | ✅                | Present verbatim in every run's output below.                                                                                                                                |
| 8   | **No `User` row is created**                                                      | ✅                | `users` = 3 before and after. Spec drives the seed against a **poisoned** `user` delegate that throws on any property access.                                                |
| 9   | The string `cooked` appears nowhere under `prisma/seed/`                          | ✅                | 11 files scanned, 0 occurrences; the export file itself still contains it, so the strip is real. Asserted in-spec and proven by deliberate failure.                          |
| 10  | `decommission-runbook.md` §5 carries the execution log + the MG-5.2 decision      | ✅                | New §5b addendum. [§Task 8.8](#task-88--mg-5-close-out--complete).                                                                                                           |

**Batch gate**:

```
npx nx run-many -t eslint:lint,typecheck,test -p ptah-license-server,api-forum --skip-nx-cache
-> Successfully ran targets eslint:lint, typecheck, test for 2 projects
   api-forum              436 tests / 18 suites   (unchanged from Batch 6)
   ptah-license-server    111 tests / 5 suites    (was 73 -> +38 from community-seed.spec.ts)
   eslint                 0 errors, 2 warnings — BOTH pre-existing and foreign to this batch:
                            apps/ptah-license-server/jest.config.ts:1  unused eslint-disable
                            apps/ptah-license-server/src/instrument.ts:1 unused eslint-disable
                          (Batch 6 recorded the same two.)
   typecheck              clean
```

---

## Task 8.1 — Pre-flight ✅

### Check 1 — the cohort key (RISK-G)

```
$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select key, name, is_default from member_groups;"
founding|Founding Members|t

$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select count(*) from member_group_assignments;"
0
```

Exactly one row, `key='founding'`, `is_default=true`. RISK-G stays closed. **The seed does
not hard-code it** — it resolves `MemberGroup where isDefault: true` at run time and aborts
with an actionable message if none exists (asserted in the spec).
`member_group_assignments` is **still empty**; nothing was seeded into it, and the zero-cohort
state that makes several gates meaningful is intact.

### Check 2 — the five forum tables exist and are empty

```
community_categories
community_post_reactions
community_posts
community_topic_read_state
community_topics

categories|0   topics|0   posts|0   reactions|0   readstate|0
```

All five present, all five at **0 rows at the moment Batch 8 started**. See
[§Row counts](#final-row-counts-in-all-five-community_-tables) for whose data is in them now.

### Check 3 — the export 🔴 **the expected commit in `tasks.md` is stale**

```
$ git log --oneline -1 -- docs/community/discourse-export.json
a22b03eb6 fix: capture real markdown in the Discourse export

$ node -e "...counts..."
categories 4 topics 17 posts 19
```

Counts are exactly as expected. **The commit is not.** `tasks.md` Task 8.1 and the batch
brief both say "committed `6614f9e92`". The full history is:

```
a22b03eb6 fix: capture real markdown in the Discourse export        <- HEAD of this file
6614f9e92 docs: snapshot the local Discourse content before migration
```

`6614f9e92` is the **defective** snapshot — the one whose 19 `raw` fields came back `null`,
which is the entire reason RK-9 exists. `a22b03eb6` is the fix. Quoting `6614f9e92` as the
verification target would have had a checker confirm the presence of the broken file.
`implementation-plan.md` §7.1 has it right ("Re-verified against `a22b03eb6`"); `tasks.md` and
the brief inherited the stale hash. The working tree copy is clean (unmodified).

---

## Task 8.2 — Seed runner plumbing ✅

**Files**

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.ts` (NEW, 490 lines)
- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\prisma-client.ts` (NEW, 91 lines)
- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\tsconfig.json` (NEW)
- `D:\projects\ptah-extension\apps\ptah-license-server\project.json` (MODIFIED — one target added)

**`prisma-client.ts` is a file the plan does not list.** It exists because the Prisma-7
adapter wiring is the one thing Task 8.2 warns "looks exactly like a mapping bug three tasks
later", and it is worth being isolated and separately provable.

### Decisions

**`ts-node`, not `tsx`.** `tsx` is in neither `dependencies` nor `devDependencies` (verified),
so `npx tsx` would network-install an unpinned binary on every run. Used the repo convention
`npx ts-node --project <tsconfig> <script>` — `package.json:67,79,80` already do exactly this
for three other scripts, and `ts-node ^10.9.2` is a real devDependency.

**Connectivity proved before any mapping existed**, as Task 8.2 demands:

```
PROBE OK categories=0 users=3
EXIT=0
```

**`DATABASE_URL` resolution is two-stage.** `prisma.config.ts` loads
`apps/ptah-license-server/.env`, which **does not exist** in this workspace; the real value is
in the workspace-root `.env`. `prisma-client.ts` tries both, app-local first. `dotenv` never
overwrites an already-set variable, so an inline `DATABASE_URL=... npx nx run ...` still wins.
A missing URL throws the named `MissingDatabaseUrlError` **before any file is read**.

**Importing the generated Prisma client — and why there is an eslint-disable.**
The client is generated to `libs/api/core/src/lib/generated-prisma-client/` and is
**gitignored**. Two routes existed:

| Route                                           | Why not / why                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import { PrismaClient } from '@ptah-api/core'` | The barrel also exports `prisma.module`, `sentry.module` and the DTO pipe, so a standalone `ts-node` script would load `@nestjs/common` and `@sentry/nestjs` for nothing. It also needs `tsconfig-paths` to resolve the alias — **not a direct dependency of this workspace**, only a transitive one. Depending on a transitive package is how a seed breaks on the next `npm install`. |
| Relative path + scoped disable                  | **Chosen.** No alias resolution, no NestJS.                                                                                                                                                                                                                                                                                                                                             |

The disable is **load-bearing, and that was verified rather than assumed** — removing it:

```
apps\ptah-license-server\prisma\seed\prisma-client.ts
  35:1  error  Projects cannot be imported by a relative or absolute path,
               and must begin with a npm scope  @nx/enforce-module-boundaries
```

The workspace has unused-disable reporting on (it produced the two pre-existing warnings
above), and it did **not** flag this one — independent confirmation the rule really fires.

**Nx target** added to `project.json`:

```jsonc
"seed-community": {
  "executor": "nx:run-commands",
  "options": {
    "command": "npx ts-node --project apps/ptah-license-server/prisma/seed/tsconfig.json apps/ptah-license-server/prisma/seed/community-seed.ts"
  }
}
```

**CLI**: `--refresh-bodies` and nothing else. An unrecognised flag aborts rather than being
ignored — a misspelled `--refresh-bodys` that silently does nothing is worse than one that
fails. **Exit code is non-zero on abort**, verified through the target:

```
$ npx nx run ptah-license-server:seed-community --args="--force"
[community-seed] Error: Unrecognised argument "--force". The community seed accepts only --refresh-bodies.
NX  Running target seed-community for project ptah-license-server failed
NX_EXIT=1
```

---

## Task 8.3 — The Zod export schema ✅

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\discourse-export.schema.ts` (225 lines)

Implements §7.2 with three deliberate departures, each argued in the file's docblocks.

### 🔴 Departure 1 — the rendered-HTML field is **not declared at all**

Task 8.3 requires `cooked: z.unknown()`. **Task 8.7 assertion 7 and the exit gate require the
string to appear nowhere under `prisma/seed/`.** These two instructions are directly
contradictory: the declaration would be the first violation of the assertion that enforces it.

Resolved by **omitting the field entirely**. A Zod object schema strips undeclared keys, so
the field is absent from the parsed value **at run time** as well as from its type — there is
nothing left to read, not merely nothing usefully typed. That is strictly stronger than
`z.unknown()`, which keeps the value in memory. Both halves are asserted:

```
✓ the parsed export does not carry the field at run time either
    Object.keys(post) === ['createdAt','postNumber','raw','username']
✓ but the field IS present in the source file — so the strip is real
```

The same conflict exists in **plan §7.5's summary block**, whose literal text is
``bodies: 19/19 imported from `raw`; 0 from `cooked`; 0 transformed``. That middle clause
cannot be printed by a module that must not contain the string. It is omitted; the `0
transformed` claim is kept and is asserted byte-wise.

### 🔴 Departure 2 — `raw: z.string()` + an exact census, not `.min(1)`

See [Finding 2](#finding-2--one-post-has-an-empty-raw-and-the-plan-says-none-does).
`z.string()` still rejects `null`, which is the RK-9 control the exit gate names.
`EXPECTED_NON_EMPTY_BODY_POSTS = 18` is checked by **equality**, following the repo's existing
census idiom (`EXPECTED_ROUTES`, `NAMED_PRIMITIVE_PARAM_COUNT`): a regression to empty bodies
aborts (0 ≠ 18) and a fix to the phantom post also aborts (19 ≠ 18), which is correct — that
is a content change a human should acknowledge.

### Departure 3 — two assertions added

- **Topic slug regex** `^[a-z0-9]+(-[a-z0-9]+)*$`, the exact character set
  `libs/api/forum/src/lib/common/slug.ts` emits. This is how the slug **rules** are reproduced
  (see Task 8.5 for why the **values** are not regenerated).
- **Topic-slug uniqueness across all 17.** They are the upsert key for the entire import; a
  duplicate would make idempotency silently wrong rather than loudly broken.

### Zod 4 API, verified against the installed 4.3.6

`z.string().datetime()` still exists and parses `2026-07-22T02:50:30.976Z`, **and** so does
`z.iso.datetime()`. Used `z.iso.datetime()` — the v4 form; `.datetime()` on `ZodString` is the
deprecated v3 spelling.

Everything is validated **before a single write** (MG-1.2) — the transaction is not even
opened on an invalid file, which the spec asserts as `expect(db.calls).toEqual([])`.

---

## Task 8.4 — Category mapping, de-HTML, cohort resolution ✅

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\map-categories.ts` (167 lines)

```
$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
    "select slug, visibility, cohort_keys, sort_order, description from community_categories order by sort_order;"

general|member|{}|10|Create topics here that don’t fit into any other existing category.
builders-lounge|cohort|{founding}|20|
site-feedback|member|{}|30|Discussion about this site, its organization, how it works, and how we can improve it.
staff|staff|{}|40|Private category for staff discussions. Topics are only visible to admins and moderators.
```

Four rows exactly as tabled. `builders-lounge` carries `{founding}`, resolved from the
database rather than hard-coded. **No HTML tag anywhere in `description`** — the em-dash and
the curly apostrophe survive intact, which is the point of not round-tripping through an
encoder.

Mapped by **source `categoryId`**, implementing plan §7.1's correction to MG-1.6. Asserted:
`start-here-how-this-cohort-works` and `questions-ask-anything-here` are in Builders Lounge
(source 5), not General, and `welcome-to-the-ptah-community` is in General (source 4).

**`stripHtmlToPlainText` is not a sanitiser and says so.** It is a one-shot transform over
four known sentences from a committed file. It **aborts** rather than storing anything it
cannot flatten — a surviving `<`/`>`, or any HTML entity, throws. Both branches are tested.
A `null` source description stays `null` rather than becoming `''`.

The `staff` category lands with `visibility: 'staff'`; under ASSUMPTION-4 the dev account
(an admin) will see it. Expected, not a leak.

---

## Task 8.5 — Topic and post mapping ✅

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\map-topics.ts` (212 lines)

```
$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select count(*) from community_topics;"
9
$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select count(*) from community_posts;"
10
```

### Timestamps — the source instant, not `now()`

```
$ ... "select slug, pinned, post_count, created_at, last_posted_at from community_topics order by created_at;"

guidelines                             |f|1|2026-07-22 02:50:30.976|2026-07-22 02:50:32.206
welcome-to-discourse                   |t|0|2026-07-22 02:50:32.555|2026-07-22 02:50:32.786
admin-guide-getting-started            |f|0|2026-07-22 02:50:33.229|2026-07-22 02:50:33.559
welcome-to-the-ptah-builders-community |f|0|2026-07-24 19:57:47.384|2026-07-24 19:57:47.937
show-us-what-you-shipped-this-week     |f|0|2026-07-24 19:57:48.774|2026-07-24 19:57:49.417
feature-requests-and-roadmap-discussion|f|0|2026-07-24 19:57:50.074|2026-07-24 19:57:50.372
start-here-how-this-cohort-works       |t|0|2026-08-01 20:49:17.704|2026-08-01 20:49:18.165
questions-ask-anything-here            |f|0|2026-08-01 20:49:22.283|2026-08-01 20:49:22.649
welcome-to-the-ptah-community          |f|0|2026-08-01 20:49:40.718|2026-08-01 20:49:41.055
```

Every timestamp is the export's. Today is **2026-08-05**; the negative check:

```
$ ... "select count(*) from community_topics where created_at::date = current_date;"  -> 0
$ ... "select count(*) from community_posts  where created_at::date = current_date;"  -> 0
```

`pinned` is `t` for exactly `welcome-to-discourse` (source 5) and
`start-here-how-this-cohort-works` (source 13). ✅

### Authorship

```
$ ... "select count(*) from community_posts where author_id is not null;"  -> 0
$ ... "select count(*) from users;"                                        -> 3   (3 before, 3 after)
```

### `postCount` — one consequence of the skip

AD-11 counts **replies only**. `guidelines` (source 4) = 1. Everything else = 0, **including
`start-here-how-this-cohort-works` (source 13), which the plan expects to be 1** — its only
reply is the empty-body post that was skipped. This is the second visible effect of
[Finding 2](#finding-2--one-post-has-an-empty-raw-and-the-plan-says-none-does) and it is the
one that argues hardest for the skip: had the post been imported, this topic would show
"1 reply" and render a blank grey box under a pinned welcome thread.

### 🔴 Deviation — `findUnique` + `create`/`update`, not `upsert`

§7.4 says "every write is `prisma.upsert` on a natural unique". **`upsert` cannot tell the
caller which branch it took**, and "a second run produces zero creates" is the exit gate's
central observable. An upsert-based seed prints the identical summary whether it created 9
topics or updated 9 — which is exactly the failure the idempotency check exists to catch.

The property AD-15 actually requires is preserved exactly: every read and every write is keyed
on `Category.slug`, `Topic.slug` or `Post @@unique([topicId, postNumber])`. No synthetic
`sourceRef` column exists (RK-1 rejected one). **The match key is asserted, not just claimed**:

```
✓ matches on the natural keys, not on row order or a synthetic id
    every category/topic findUnique where-clause has keys exactly ['slug']
    every post findUnique where-clause has keys exactly ['topicId_postNumber']
```

The pre-read also supplies the before-image `--refresh-bodies` logs per row, which `upsert`
cannot produce either.

### 🔴 Deviation — the export's `slug` is reused, not regenerated

The brief points at `libs/api/forum/src/lib/common/slug.ts` "for the slug rules the seed must
reproduce". **Calling `buildSlug()` here would break idempotency outright.** Its collision
resolver takes the set of slugs already in use: on run 2 it would see run 1's `guidelines`,
resolve to `guidelines-2`, and create a duplicate topic. The generator is documented as
create-path-only, and this is not the create path.

So the **rules** are reproduced as a schema constraint (the charset regex + uniqueness) while
the **values** stay the ones the source published. 16 of the 17 source slugs are byte-identical
to `slugify(title)` anyway; the one exception is topic 5, whose title ends in the `:wave:`
emoji shortcode that Discourse dropped and `slugify` would render as a trailing `-wave`.

### Other properties, all asserted

- Post #2 is a **top-level** reply — `parentId: null` on every row (RK-12: depth 3 is
  unrepresentable, and a reply to the opening body is depth 1).
- `lastPostedAt` computed from the imported posts, in the same transaction (AD-11).
- **One `$transaction` for the whole import.** `{ maxWait: 10s, timeout: 60s }` — the default
  5s interactive budget is tight for ~60 round trips on a cold pool, and a timeout there would
  present as a mapping bug.
- No curriculum topic is imported: asserted both by id and by a `^week-\d` slug guard.
- The 17 source ids are covered exactly once by `IMPORTED_TOPIC_IDS ∪ CURRICULUM_TOPIC_IDS`,
  with no overlap — asserted against the file, so a re-captured export with a new topic fails
  here rather than being silently dropped.
- Discourse's own seed content (topics 5, 4, 6) is imported, **not** soft-deleted. §7.1 records
  the observation and takes no action; R8.2 lets an admin remove them in one action each.

---

## Task 8.6 — Summary output and the `--refresh-bodies` log ✅

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\summary.ts` (120 lines)

Data-driven (an array of rows, not a template literal) so Batch 11 **appends** `courses`,
`modules` and `lessons` entries rather than rewriting the format.

### Run 1 — first execution

```
$ npx nx run ptah-license-server:seed-community --skip-nx-cache

Community seed complete
  categories:  created 4  updated 0
  topics:      created 9  updated 0
  posts:       created 10 updated 0
  unmatched usernames: system (19 posts) -> attributed to the system author (A-4); the count is the SOURCE total — this batch writes a subset and Batch 11 writes the rest from the same posts
  bodies: 10/10 imported from `raw`; 0 transformed
  skipped: start-here-how-this-cohort-works post #2 — empty source body (Discourse small-action marker, not content); see SKIP_EMPTY_BODY_POSTS
  assertions: source topics 17 = 8 curriculum (batch 11) + 9 topics OK
  assertions: source posts 19 = 10 written here + 1 skipped (empty source body) + 8 curriculum bodies (batch 11) OK

NX  Successfully ran target seed-community for project ptah-license-server
```

### Run 2 — idempotency

```
$ npx nx run ptah-license-server:seed-community --skip-nx-cache

Community seed complete
  categories:  created 0  updated 4
  topics:      created 0  updated 9
  posts:       created 0  updated 10
  unmatched usernames: system (19 posts) -> ...
  ...

--- row counts after run 2 ---
categories|4   topics|9   posts|10
```

**Zero creates, non-zero updates, row counts unchanged.** ✅

### Deviations from §7.5's literal block

| §7.5                                     | Here                                         | Why                                                                                                                                                                                   |
| ---------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ``0 from `cooked` `` on the bodies line  | omitted                                      | The literal string cannot appear in this directory (Task 8.7 assertion 7).                                                                                                            |
| `→`                                      | `->`                                         | An arrow in stdout is at the mercy of the console code page on Windows and would garble captured evidence.                                                                            |
| `unmatched usernames: system (19 posts)` | same, **plus a trailing clause**             | The substring is preserved exactly. The clause explains that 19 is the SOURCE total while this run wrote 10, so the arithmetic is not read as a bug — which §8.6 explicitly asks for. |
| `assertions: source posts 19 = 11 + 8`   | `19 = 10 written + 1 skipped + 8 curriculum` | The arithmetic still closes to 19, and the skipped post is named rather than absorbed.                                                                                                |

`--refresh-bodies` logs **one line per overwritten row** with the topic slug, post number and
both lengths — enough to reconstruct what was destroyed. Verified end-to-end in the spec
(edit a body → default re-run leaves it → `--refresh-bodies` restores it and logs exactly one
entry) and through the target:

```
$ npx nx run ptah-license-server:seed-community --args="--refresh-bodies"
  categories:  created 0  updated 4
  topics:      created 0  updated 9
  posts:       created 0  updated 10
  (no `refreshed:` lines — no stored body differs from the export, which is correct)
```

---

## Task 8.7 — `community-seed.spec.ts`, the RK-9 mitigation ✅

**Files**

- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.spec.ts` (844 lines, **38 tests**)
- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\__fixtures__\malformed.json`
- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\__fixtures__\structurally-invalid.json`
- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\__fixtures__\README.md`

```
$ npx nx test ptah-license-server --testPathPatterns=community-seed --skip-nx-cache
Test Suites: 1 passed, 1 total
Tests:       38 passed, 38 total
```

### The mechanism: a recording double, not an empty table

Asserting "the fixture wrote nothing" by counting rows proves nothing — an empty table is also
what a seed that never ran produces. The spec drives the **real** write path against an
in-memory Prisma stand-in that records every call, so _wrote nothing_ is asserted as **zero
recorded calls**, and _matched on the right key_ is asserted by inspecting the actual
where-clauses.

The double carries a **poisoned `user` delegate** — a `Proxy` that throws on any property
access. Omitting `user` would prove only that the seed does not compile against it; a poisoned
one proves it does not call it at run time (A-4).

### Fixtures: two committed, two derived

`malformed.json` and `structurally-invalid.json` are committed and tiny — neither needs to
resemble the export, because both fail before content is examined. The **`raw: null` and
U+FFFD fixtures are derived at test time** from the real export into `os.tmpdir()`, mutating
exactly one field. Rationale in `__fixtures__/README.md`: a hand-copied 42 KB fixture is a
snapshot of the export as of the day it was copied, and this export **has already been
re-captured once** (`a22b03eb6` fixed `6614f9e92` — the very defect these fixtures test).
Deriving them keeps the only difference the single mutation under test. A control test asserts
the _unmutated_ copy validates, so each abort is provably caused by its mutation.

### Assertion-by-assertion

| #   | Task 8.7 assertion                                                   | State                                                            |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | Counts: 4 / 17 / 19 source, 9 topics + **10** posts written          | ✅ (10, not 11 — Finding 2)                                      |
| 2   | A malformed file aborts and writes nothing                           | ✅ 3 tests: not-JSON, wrong-shape, missing-file                  |
| 3   | `raw: null` aborts                                                   | ✅ + control                                                     |
| 4   | U+FFFD aborts                                                        | ✅ + error-message match                                         |
| 5   | Second run produces zero creates                                     | ✅ + the match-key assertion                                     |
| 6   | No overwrite by default; `--refresh-bodies` overwrites and logs each | ✅ 4 tests                                                       |
| 7   | `cooked` appears nowhere under `prisma/seed/`                        | ✅ 3 tests                                                       |
| 8   | Round-trip through `libs/frontend/markdown`'s `'member'` preset      | ❌ **NOT IMPLEMENTED** — see below                               |
| 9   | No `User` row created                                                | ✅ 3 tests                                                       |
| +   | **Byte fidelity**, per post                                          | ✅ 2 tests, one of them added after the first was proven vacuous |

### ❌ Assertion 8 — not implemented, and the reason is not the one Task 8.7 predicted

Task 8.7 anticipated `@nx/enforce-module-boundaries` rejecting the import. **It does not.**
`ptah-license-server` is `scope:app`, which `onlyDependOnLibsWithTags` permits to depend on
`scope:shared`, and `libs/frontend/markdown` is `["scope:shared","type:ui"]`. The boundary is
open. Three different things block it:

1. `apps/ptah-license-server/jest.config.ts` sets `testEnvironment: 'node'`. DOMPurify needs a
   DOM. Changing it would affect all 111 tests in the project.
2. **The `'member'` sanitizer is not exported.** `createMemberSanitizer()` is module-private
   and reachable only through Angular DI (`provideMarkdown({ sanitize: { provide: SANITIZE,
useFactory: createMemberSanitizer } })`). Exercising it means bootstrapping an Angular
   injector inside a NestJS jest project, or exporting a new symbol from
   `libs/frontend/markdown` — **foreign territory** under this batch's rules.
3. Task 8.7's own fallback — assert it in a `web-members` spec — is **Batch 7's territory**,
   which is running concurrently.

Task 8.7 says: _"Do not weaken the assertion to a regex over markdown syntax — that tests
nothing."_ Agreed, and none was written. **Recommended owner: Batch 7 or a follow-up**, using a
body fixture copied from the export inside `libs/web/members`. The three preconditions are
cheap: export `createMemberSanitizer` (or a `renderMemberMarkdown` helper) from
`libs/frontend/markdown`, and assert the round-trip in a jsdom-environment spec that already
exists on that side.

### 🔴 Byte fidelity was **vacuous** as first written, and that was found by testing it

The first version compared each stored `bodyMarkdown` to the export `raw` byte for byte. It
passes — and it **also passes when `.trim()` is added to the mapper**:

```
PROOF 3: bodyMarkdown: post.raw  ->  post.raw.trim()
Tests: 37 passed, 37 total     <- SHOULD HAVE FAILED
```

The reason:

```
$ node -e "...": posts whose raw differs after trim: 0
                 posts containing CR: 0
```

A byte comparison against a corpus that happens to be **invariant under the transform** cannot
detect that transform. This is the same shape as Batch 6's carried-forward item 2 (the trigram
`EXPLAIN` that was vacuous at 0 rows).

Fixed by adding a test that maps a derived fixture whose body is hostile to every plausible
normalisation — leading/trailing whitespace, a tab, CRLF, an HTML entity, a literal tag, a
non-ASCII em-dash and a trailing blank line — and asserts byte equality. Re-proven:

```
clean:               Tests: 38 passed, 38 total
with .trim() added:  ● byte fidelity › preserves a body that is sensitive to every plausible transform
                     Tests: 1 failed, 37 passed, 38 total
```

### Deliberate-failure proofs — RK-9's assertions were **seen to fail**

Task 8.7: _"They must be seen to fail against a correct implementation before they are
believed."_ Five mutations were applied one at a time and each was reverted immediately;
`diff` against pre-mutation backups confirms all three touched files are byte-identical to
their originals.

| #   | Mutation                                             | Expected                | Observed                                                |
| --- | ---------------------------------------------------- | ----------------------- | ------------------------------------------------------- |
| 1   | Drop the U+FFFD refinement from the schema           | assertion 4 red         | ✅ `1 failed, 36 passed`                                |
| 2   | `raw: z.string().nullable().transform(v => v ?? '')` | assertion 3 red         | ✅ `1 failed, 36 passed`                                |
| 3   | `bodyMarkdown: post.raw.trim()`                      | byte fidelity red       | ⚠️ **green** first time — see above. Red after the fix. |
| 4   | Drop the explicit `createdAt` from the topic write   | timestamp assertion red | ✅ `1 failed, 37 passed`                                |
| 5   | Append a comment containing the forbidden field name | assertion 7 red         | ✅ named the file and the assertion                     |

```
$ diff /tmp/schema.bak     .../discourse-export.schema.ts  -> schema OK
$ diff /tmp/maptopics.bak  .../map-topics.ts               -> map-topics OK
$ diff /tmp/seed.bak       .../community-seed.ts           -> community-seed OK
$ npx tsc --noEmit --project .../prisma/seed/tsconfig.json -> TSC OK
```

### Byte fidelity — SHA-256 per body, database vs file

Not eyeballed. Postgres hashed the stored UTF-8 bytes; Node hashed the file's `raw` bytes;
the two sorted lists were `diff`ed.

```
$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select t.slug||'#'||p.post_number||' '||encode(sha256(convert_to(p.body_markdown,'UTF8')),'hex')
          ||' len='||octet_length(convert_to(p.body_markdown,'UTF8'))
   from community_posts p join community_topics t on t.id=p.topic_id order by t.slug, p.post_number;"

admin-guide-getting-started#1            de37f11eb558b6d4850274a9420e3ee68b18a3fec631436cfc2b7d23cc640fb4 len=1974
feature-requests-and-roadmap-discussion#1 1639eb3043dfe2c08b0e24af75babbe5f564a313738ba50e586884fc78f659f0 len=61
guidelines#1                             4cc49c7fb7ca4dd1d1c285f41d5acf322b9fe7e2cc27af5906a13d129bbd71a9 len=5238
guidelines#2                             fa6931358bb01d1a2ca8c57baea78d4c5bac24faeecaf54ca8dfeae044d4ff0a len=80
questions-ask-anything-here#1            f11fb551d4b34f6f151900570745072378f5776005478455314e2b1ca0db99b9 len=310
show-us-what-you-shipped-this-week#1     7d5ec1f7d6c3ee1d768b79d55487e0cc996d4d619bce88e2141deaf558614513 len=76
start-here-how-this-cohort-works#1       cc2a93b8460debde0562815ff2f075380825c226a3c6c08329dc3965842c018e len=888
welcome-to-discourse#1                   bb2d8027d19e3781bd44f44b3afcf61f1a88aeddc3123133565c82b5a64b94c3 len=845
welcome-to-the-ptah-builders-community#1 d06f95a7fd31af6660795a0ae9b04f5b09a06de82e0cb2b7b149021df7e77a25 len=146
welcome-to-the-ptah-community#1          370c893ed20d39027607be21675a01f09bb8ac8e41527916dbc75617eb115af8 len=435

$ diff /tmp/export_hashes.txt /tmp/db_only.txt
db lines: 10  export lines: 10
NO DIFFERENCES — all 10 bodies byte-identical (SHA-256 + byte length)
```

Byte **length** is included alongside the digest so a hash collision is not the only thing
standing between a mangled body and a green check.

### The two abort fixtures — proven twice, in the spec and live

The spec proves _writes nothing_ as zero recorded calls. A **live** run against `ptah_db`
proves it against the real adapter, real transaction and real constraints — and was run with
`refreshBodies: true`, the most destructive mode available:

```
BEFORE:  4/9/10 md5=6867f22f8ab484f18f06f3cbbae9d8a1

LIVE raw-null  ABORTED (ExportValidationError): The Discourse export failed validation; nothing was written.
                 || topics.0.posts.0.raw: Invalid input: expected string, received null
LIVE U-FFFD    ABORTED (ExportValidationError): The Discourse export failed validation; nothing was written.
                 || topics.0.posts.0.raw: raw contains a U+FFFD replacement character (mojibake); re-capture the export with UTF-8
LIVE malformed ABORTED (ExportValidationError): The Discourse export at ...\live-bad.json is not valid JSON:
                 Expected property name or '}' in JSON at position 2

AFTER:   4/9/10 md5=6867f22f8ab484f18f06f3cbbae9d8a1   (identical)
```

The md5 is over `id || body_markdown` for every post, so it detects a changed body as well as a
changed row count. The temporary harness file was deleted; `git status` confirms no stray file.

### AD-8 quarantine — the grep, and the self-reference trap

```
files scanned: 11
files containing the field name: 0  []
the export file DOES contain it: true
```

The spec's needle is assembled from fragments (`['coo','ked'].join('')`), because the assertion
greps **every file under `prisma/seed/`, this spec included** — a literal would make the test
that enforces the quarantine the first thing to violate it. The scan also asserts it saw at
least 8 files, so a glob that silently matches nothing cannot pass.

---

## Task 8.8 — MG-5 close-out ✅ (complete)

**File**: `D:\projects\ptah-extension\.ptah\specs\task_2026_177\decommission-runbook.md` — new
**§5b addendum**, inserted before §6. §5's existing table was **not** rewritten.

### 🔴 Correction — `tasks.md` Task 8.8 is wrong about the runbook's state

Task 8.8 says _"The runbook was written and left unexecuted by Batch 5."_ **It is fully
executed.** §5's log has all nine steps ticked or explicitly marked `DECLINED` / `N/A`, with
timestamps and evidence, and §6 records three findings from the run. The file header already
reads `**Status**: ✅ EXECUTED 2026-08-04`. There was nothing to backfill.

What §5 genuinely did **not** cover — and what the addendum adds:

1. **The local `discourse_dev` container.** §0 says "do not stop it, do not delete it… until
   Batch 8 has verified the seed against it". It was deleted by the user. Consequence: none.
   §0's premise was wrong — MG-1.1 requires the importer to read **only** the committed export,
   and it does. §0 is left unedited; rewriting a runbook's premise after the fact is how a
   record stops being a record.
2. **MG-5.2 — decided, option (b): accept `NXDOMAIN`.** Per this batch's brief (which
   supersedes `tasks.md` Task 8.8 — see the divergence below). Recorded with its reasoning:
   the `A` record was deleted in §5 step 6 and the authoritative nameservers return
   `NXDOMAIN`, so there is no host to redirect _from_; and §6.1 establishes zero human-authored
   posts, so there is no link equity to preserve. Option (a) is documented as a ten-minute
   change if a published external link ever surfaces. **MG-5.2 is closed as not-applicable,
   not silently dropped.**
3. **MG-5.3's gate is moot.** It protected authored content that lived only inside a forum.
   That content has been on disk and in git since `6614f9e92` / `a22b03eb6`, and the forum it
   gated against no longer exists. Retired, not waived.

### Divergence between `tasks.md` and the batch brief — resolved in favour of the brief

`tasks.md` Task 8.8: _"⚠️ ONE OPEN DECISION — MG-5.2 cannot be executed as written. Return it
to the orchestrator; do not decide it inside this batch."_
The brief: _"Also closed and not to be re-opened: MG-5.2's `301` … is not applicable."_

Followed the brief, and recorded **both** the decision and the still-available alternative so
the orchestrator can overturn it in one edit if it disagrees.

### 🔴 THE ONE ACTION FOR THE USER

> **Check the GitHub repository secrets for a leftover `ptah-theme-deploy` or other
> `DISCOURSE_*` secret and delete it** — `Settings → Secrets and variables → Actions`, and
> check the _Dependabot_ and _Environments_ tabs too, since an environment-scoped secret does
> not appear in the repository list.

A second forum API key (`id=2 ptah-theme-deploy`) existed on the server and appeared in no env
file — almost certainly supplied to the deleted `deploy-community-theme.yml` workflow from an
Actions secret. It was **revoked server-side on 2026-08-04** and the service it authenticated
against is destroyed, so this is hygiene rather than live exposure — but a credential that
outlives its service is exactly what gets reused. **An agent cannot read repository secrets and
did not try.**

**PRE-7 honoured**: no infrastructure command was run from this batch.

---

## Final row counts in all five `community_*` tables

```
community_categories       | 4
community_topics           | 9
community_posts            | 10
community_post_reactions   | 0
community_topic_read_state | 0

users                      | 3   (3 at pre-flight, 3 now)
member_groups              | 1
member_group_assignments   | 0   (still empty — nothing was seeded to make anything pass)
licenses: DEV-BUILDERS-VALIDATION-0001  present and intact
```

### Whose data is this?

**All of it is Batch 8's.** At pre-flight (Task 8.1, before any write) all five tables were at
**0 rows** — Batch 6's live-verification residue had already been removed and Batch 7 had not
yet written anything. Every row now present was created by `seed-community`, and the counts
match the seed's own summary exactly.

**Nothing was truncated or blanket-deleted.** The only `DELETE`-shaped operation performed in
this batch was none: the seed only creates and updates, the live abort proofs wrote nothing
(md5 unchanged), and no cleanup was needed because the tables started empty.

⚠️ Batch 7 was working concurrently and its files appeared in the working tree during this
batch. If it runs a live verification after this report, these counts will move. The
distinguishing marks of Batch 8's rows: `authorId IS NULL` on every row, `createdAt` in
July/August **2026-07-22 … 2026-08-01**, and the nine slugs listed under Task 8.5.

---

## Batch 6 carried-forward item 2 — re-checked, still open

Batch 6 asked B8 to _"re-run the unforced `EXPLAIN` after B8 seeds content and `ANALYZE`"_.
Done:

```
$ ANALYZE community_posts; ANALYZE community_topics;

-- unforced
Seq Scan on community_posts  (cost=0.00..2.12 rows=1 width=26)
  Filter: (body_markdown ~~* '%cohort%'::text)

-- set enable_seqscan = off
Bitmap Heap Scan on community_posts  (cost=77.03..81.04 rows=1 width=26)
  ->  Bitmap Index Scan on community_posts_body_trgm  (cost=0.00..77.03 rows=1 width=0)
        Index Cond: (body_markdown ~~* '%cohort%'::text)
```

**The seed does not unblock this.** 10 rows is still a heap the planner correctly prefers to
scan. The forced form proves the index exists, has the right operator class and is usable, but
the unforced check needs thousands of rows to be meaningful. **Keep using the forced form**;
the item stays carried forward past Batch 8.

---

## Findings — things that contradict `tasks.md` or the plan

### Finding 1 — the export's commit hash in `tasks.md` is the **defective** snapshot

`tasks.md` Task 8.1 and the brief both name `6614f9e92`. The file's actual HEAD is
`a22b03eb6`; `6614f9e92` is the earlier snapshot whose 19 `raw` fields were `null` — the
defect RK-9 exists for. A checker following the instruction literally would confirm the
presence of the broken file. `implementation-plan.md` §7.1 is correct. **Recommend correcting
`tasks.md` Task 8.1 check 3 to `a22b03eb6`.**

### Finding 2 — one post has an empty `raw`, and the plan says none does

Topic 13, post #2: `raw` is `""`, and so is the rendered field. plan §7.1's "19 of 19, zero
nulls, 12,474 chars" is true about nulls and about the character total, and misleading about
bodies. `raw: z.string().min(1)` as specified aborts on the real export.

Both fields being empty is the signature of a Discourse **small-action** post — the grey
one-line marker written when a topic is pinned, which topic 13 was — not a capture failure. A
capture failure leaves the rendered text populated and only the markdown missing, which is
exactly what `a22b03eb6` fixed. **But the seed cannot prove that distinction and must not try:
AD-8 forbids it from reading the rendered field at all**, so the only signal available in code
is `raw.length === 0`.

| Option               | Consequence                                                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Abort, as specified  | The seed can never run against the real export. Exit gate unreachable.                                                                                                                                                      |
| Import it            | A blank reply rendered under a pinned welcome thread, and `Topic.postCount = 1` promising a reply with no content. A user-visible defect.                                                                                   |
| **Skip it** ← chosen | 10 posts not 11; `postCount = 0` on topic 13. Nothing wrong is written, and nothing recoverable is lost — the post carried no content. Counted, named in the summary, asserted in the spec, and controlled by one constant. |

The genuinely correct fix is **upstream**: re-capture the export without small-action posts.
Then `EXPECTED_POST_COUNT` becomes 18, `EXPECTED_NON_EMPTY_BODY_POSTS` matches it,
`SKIP_EMPTY_BODY_POSTS` is deleted, and the exit gate's 11 becomes an honest 10.

### Finding 3 — Task 8.3 and Task 8.7 contradict each other outright

Task 8.3 mandates `cooked: z.unknown()` in the schema. Task 8.7 assertion 7 and the exit gate
mandate that the string appear nowhere under `prisma/seed/`. Both cannot hold. Resolved by
omitting the field entirely — Zod strips undeclared keys, which is stronger than `z.unknown()`
because the value is gone at run time, not merely untyped. **plan §7.5's summary block has the
same problem** — its literal text contains the field name.

### Finding 4 — `upsert` is incompatible with the exit gate it is supposed to satisfy

§7.4 mandates `prisma.upsert`; the exit gate mandates that a second run report zero creates.
`upsert` cannot report which branch it took. Used `findUnique` + `create`/`update` on the same
natural keys, and asserted the keys explicitly. AD-15 and RK-1 are unaffected.

### Finding 5 — `buildSlug()` must **not** be used by the seed

The brief points at `libs/api/forum/src/lib/common/slug.ts` as "the slug rules the seed must
reproduce". Calling it would break idempotency: `resolveSlugCollision` takes the set of taken
slugs, so run 2 would turn `guidelines` into `guidelines-2` and create a duplicate. The file's
own docblock says it is create-path-only. Rules reproduced as a schema constraint; values
reused from the source.

### Finding 6 — the byte-fidelity check was vacuous, and only testing it revealed that

Adding `.trim()` to the mapper left all 37 assertions green, because not one of the export's
18 non-empty bodies has leading or trailing whitespace or a CR. Fixed with a hostile-body
test. **Generalisable lesson**: a byte comparison against a corpus that happens to be invariant
under a transform detects nothing — same shape as B6's trigram `EXPLAIN` at 0 rows. Any future
"we compared it byte for byte" claim should say what the corpus is _sensitive to_.

### Finding 7 — Task 8.7 assertion 8's predicted blocker is not the real one

The module boundary **permits** `scope:app → scope:shared`, so `libs/frontend/markdown` is
importable in principle. The real blockers are `testEnvironment: 'node'`, the fact that
`createMemberSanitizer` is not exported (Angular-DI-only), and the fallback location being
Batch 7's territory. Not implemented; not faked. Owner recommended above.

### Finding 8 — `tasks.md` Task 8.8's premise is wrong

The decommission runbook **was** executed by Batch 5, with a complete §5 log and a §6 findings
section. Task 8.8 describes it as "written and left unexecuted".

### Finding 9 — `tasks.md` and the brief disagree on whether MG-5.2 is decidable here

`tasks.md` says return it undecided; the brief says it is closed as not-applicable. Followed
the brief and recorded the alternative so the decision is reversible in one edit.

### Finding 10 — the `typecheck` target does not cover `prisma/seed/`

`typecheck` runs `tsc --noEmit -p tsconfig.app.json`, whose `include` is `["src/**/*.ts"]`.
The seed lives under `prisma/`, so **the gate's typecheck target never sees it**. Coverage
comes from two other places, both verified:

- `ts-jest` type-checks the spec **and everything it imports** under `tsconfig.spec.json` — the
  spec imports all five seed modules, so the `test` target does cover them.
- `apps/ptah-license-server/prisma/seed/tsconfig.json` (created by Task 8.2) runs clean
  standalone: `npx tsc --noEmit --project .../prisma/seed/tsconfig.json` → `TSC OK`.

`eslint .` **does** cover the directory (cwd is the project root, not `src/`), which is how the
boundary error surfaced. Worth knowing before someone adds a seed file the spec does not
import — it would be linted but not type-checked.

### Finding 11 — `@nx/enforce-module-boundaries` blocks the only lightweight route to `PrismaClient`

The generated client is gitignored and re-exported only through `@ptah-api/core`, whose barrel
pulls in NestJS and whose alias needs `tsconfig-paths` — a **transitive-only** package. A
scoped, documented `eslint-disable-next-line` on one relative import was the lowest-risk
option; it was verified to be load-bearing rather than decorative. If a maintainer prefers, the
clean fix is a `@ptah-api/prisma-client` path alias pointing at the generated directory — but
that is `tsconfig.base.json`, which this batch is forbidden to touch, so it is **reported, not
done**, exactly as rule 3 requires.

---

## Deviations summary

| Spec said                  | Done                                                                 | Reason                                                             |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 11 posts                   | **10**                                                               | Finding 2.                                                         |
| `raw: z.string().min(1)`   | `z.string()` + `EXPECTED_NON_EMPTY_BODY_POSTS = 18` (exact equality) | Finding 2. `null` still aborts.                                    |
| `cooked: z.unknown()`      | field omitted entirely                                               | Finding 3. Stronger.                                               |
| `prisma.upsert` everywhere | `findUnique` + `create`/`update`, same natural keys                  | Finding 4.                                                         |
| `npx tsx`                  | `npx ts-node --project`                                              | `tsx` is not a dependency. Repo convention.                        |
| §7.5's exact summary block | same shape, three edits                                              | Task 8.6 table.                                                    |
| Task 8.7 assertion 8       | not implemented, reported                                            | Finding 7. Not weakened to a regex.                                |
| Files listed in Task 8.2   | `+ prisma-client.ts`                                                 | Isolates the Prisma-7 adapter wiring so it is separately provable. |
| Fixtures all committed     | 2 committed, 2 derived                                               | `__fixtures__/README.md`.                                          |

---

## Files created / modified — absolute paths

**Created (all under `apps/ptah-license-server/prisma/seed/`, this batch's territory)**

```
D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.ts             490
D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\community-seed.spec.ts        844
D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\discourse-export.schema.ts    225
D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\map-categories.ts             167
D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\map-topics.ts                 212
D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\prisma-client.ts               91
D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\summary.ts                    120
D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\tsconfig.json
D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\__fixtures__\malformed.json
D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\__fixtures__\structurally-invalid.json
D:\projects\ptah-extension\apps\ptah-license-server\prisma\seed\__fixtures__\README.md
```

**Modified**

```
D:\projects\ptah-extension\apps\ptah-license-server\project.json                 (+6 lines: the seed-community target)
D:\projects\ptah-extension\.ptah\specs\task_2026_177\decommission-runbook.md     (+§5b addendum, §5 untouched)
D:\projects\ptah-extension\.ptah\specs\task_2026_177\batch-8-report.md           (this file)
```

**No shared registry file was touched.** `tsconfig.base.json`, `nx.json`, `eslint.config.mjs`,
`app.module.ts`, `route-map.spec.ts`, `controller-validation.spec.ts`, `schema.prisma` and
`prisma/migrations/**` are all unmodified. **No migration was created** — Batch 6's tables were
sufficient, exactly as the brief predicted.

---

## Final `git status --porcelain`, annotated

```
 M apps/ptah-license-server/project.json                                        <- MINE (Task 8.2)
?? apps/ptah-license-server/prisma/seed/                                        <- MINE (11 new files)

M  libs/backend/platform-cli/src/settings/cli-settings-registration.ts          <- FOREIGN, STAGED
M  libs/backend/platform-core/src/file-settings-keys.spec.ts                    <- FOREIGN, STAGED
M  libs/backend/platform-core/src/file-settings-keys.ts                         <- FOREIGN, STAGED
M  libs/backend/platform-electron/src/settings/electron-settings-registration.ts <- FOREIGN, STAGED
A  libs/backend/platform-vscode/src/settings/vscode-settings-adapter.tasks-routing.spec.ts <- FOREIGN, STAGED
M  libs/backend/platform-vscode/src/settings/vscode-settings-registration.ts    <- FOREIGN, STAGED
M  libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.spec.ts        <- FOREIGN, STAGED
M  libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts             <- FOREIGN, STAGED
M  libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts               <- FOREIGN, STAGED
M  libs/backend/settings-core/src/di/tokens.ts                                  <- FOREIGN, STAGED
M  libs/backend/settings-core/src/index.ts                                      <- FOREIGN, STAGED
A  libs/backend/settings-core/src/repositories/tasks-settings.ts                <- FOREIGN, STAGED
A  libs/backend/settings-core/src/schema/tasks-schema.spec.ts                   <- FOREIGN, STAGED
A  libs/backend/settings-core/src/schema/tasks-schema.ts                        <- FOREIGN, STAGED
M  libs/shared/src/index.ts                                                     <- FOREIGN, STAGED
M  libs/shared/src/lib/types/rpc.types.ts                                       <- FOREIGN, STAGED
M  libs/shared/src/lib/types/rpc/rpc-tasks.types.ts                             <- FOREIGN, STAGED
A  libs/shared/src/lib/types/task-saved-view.types.spec.ts                      <- FOREIGN, STAGED
A  libs/shared/src/lib/types/task-saved-view.types.ts                           <- FOREIGN, STAGED

 M libs/web/members/jest.config.cts                                             <- BATCH 7 (concurrent)
 M libs/web/panel-ui/src/index.ts                                               <- BATCH 7 (PRE-3 / RISK-M: the barrel count moves)
?? libs/web/members/src/lib/community/                                          <- BATCH 7
?? libs/web/members/src/lib/services/member-community-api.service.ts            <- BATCH 7
?? libs/web/members/src/lib/services/member-community-api.service.spec.ts       <- BATCH 7
?? libs/web/members/src/lib/services/member-search-api.service.ts               <- BATCH 7
?? libs/web/members/src/lib/services/member-search-api.service.spec.ts          <- BATCH 7
?? libs/web/panel-ui/src/lib/tag-chip/                                          <- BATCH 7
?? libs/web/panel-ui/src/lib/thread-row/                                        <- BATCH 7
```

### 🔴 Warning for whoever commits next

**The unrelated task-specs/settings process has STAGED its 19 files into the index** (the `M `
and `A ` in column 1 — they were unstaged `_M` at the start of this batch). A bare
`git commit` right now would sweep all 19 foreign files into Batch 8's commit.

**Stage path-by-path.** For this batch that is exactly:

```
git add apps/ptah-license-server/project.json apps/ptah-license-server/prisma/seed
git diff --cached --name-only | grep -Ev '^apps/ptah-license-server/(project\.json|prisma/seed/)' # must print nothing
```

Note that `.ptah/**` is gitignored (`.gitignore:128`), so the runbook addendum and this report
are not committable and do not need excluding.

HEAD did not move during this batch (`46f0cde07` at start and at end), so no rebase or conflict
was encountered.

---

## Handover notes for Batch 11

- The summary printer is **data-driven**: append `{ label: 'courses', counts }` etc. to
  `summary.entities` in `community-seed.ts`. Do not rewrite `formatSummary`.
- `CURRICULUM_TOPIC_IDS` (15…22) is exported from `map-topics.ts` and already asserted to be
  disjoint from `IMPORTED_TOPIC_IDS` and to cover the 17 source ids exactly.
- The post arithmetic B11 completes is now **`19 = 10 written + 1 skipped + 8 curriculum`**,
  not `11 + 8`. If Finding 2 is fixed upstream first, it becomes `18 = 10 + 8` and the skipped
  term disappears.
- Course/module/lesson tables **do not exist yet** — Batch 9's migration 3 creates them. The
  seed's `SeedTransactionClient` is a structural type; extend it with the new delegates and the
  recording double extends with them.
- The AD-8 source-text assertion covers **every file** added to `prisma/seed/`, including
  B11's. Assemble any needed literal from fragments, as the spec does.
