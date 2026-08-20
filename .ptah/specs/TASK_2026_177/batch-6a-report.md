# Batch 6A report — TASK_2026_177, Tasks 6.1–6.5

**Executor**: `backend-developer`
**Date**: 2026-08-04
**Branch**: `ak/license-server-validation-pipe` (not switched, not rebased)
**HEAD at start and end**: `097853b39` — **nothing committed, nothing staged.**

**Verdict**: all five tasks complete and green. One irreversible step (migration 2)
applied successfully. **One spec command was found to be impossible on the installed
Prisma version** — see [Contradictions](#contradictions-found) §C-1. Both required
proofs-by-deliberate-failure were performed and both are reported with the failing
run and the reverted-green run.

---

## PRE-1 confirmation

I read `D:\projects\ptah-extension\libs\api\core\src\lib\common\dto-validation.pipe.ts`
in full **before** writing anything, as the first action of the batch.

Confirmed understanding: `main.ts`'s global `ValidationPipe` is **inert**, because
`@nx/esbuild` does not implement `emitDecoratorMetadata`, so `metadata.metatype` is
`undefined` and `ValidationPipe.transform` short-circuits. `dtoPipe(TheDto)` restores
validation by setting `expectedType`, which is applied **before** that short-circuit.
The rule is unconditional: every whole-object `@Body()` / `@Query()` param must bind
`dtoPipe(TheDto)`; a bare `@Body() dto: X` is silently unvalidated.
`passthroughDtoPipe` has exactly one legitimate call site (`AdminRecordsController.update`)
and a second should be rejected in review.

**Batch 6A contains no controllers and no DTOs**, so no `dtoPipe` binding was required
in this batch. The rule binds Tasks 6.6+ (and RISK-I: every `@Query()` in this batch's
successors must bind a whole-object DTO, or `NAMED_PRIMITIVE_PARAM_COUNT = 6`'s
exact-equality assertion fails the build).

**PRE-2** (controller registry) is likewise not applicable to 6A — no controllers were
created. It binds Task 6.13.

---

## Task 6.1 — Scaffold `libs/api/forum` ✅

### Files created

| Path                                                           | Note                                                |
| -------------------------------------------------------------- | --------------------------------------------------- |
| `D:\projects\ptah-extension\libs\api\forum\project.json`       | `api-forum`, `["scope:api","type:feature"]`         |
| `D:\projects\ptah-extension\libs\api\forum\tsconfig.json`      |                                                     |
| `D:\projects\ptah-extension\libs\api\forum\tsconfig.lib.json`  |                                                     |
| `D:\projects\ptah-extension\libs\api\forum\tsconfig.spec.json` |                                                     |
| `D:\projects\ptah-extension\libs\api\forum\jest.config.cts`    |                                                     |
| `D:\projects\ptah-extension\libs\api\forum\eslint.config.mjs`  | **not in the spec's file list — see deviation D-1** |
| `D:\projects\ptah-extension\libs\api\forum\package.json`       | **not in the spec's file list — see deviation D-1** |
| `D:\projects\ptah-extension\libs\api\forum\README.md`          |                                                     |
| `D:\projects\ptah-extension\libs\api\forum\src\index.ts`       |                                                     |

### Files modified

- `D:\projects\ptah-extension\tsconfig.base.json` — one line added:
  `"@ptah-api/forum": ["./libs/api/forum/src/index.ts"]`, placed between `member-hub`
  and `community` to match the file's existing api ordering. **+1 line, 0 removed.**

### Decisions

**D-1 — added `eslint.config.mjs` and `package.json`, which Task 6.1's file list omits.**
The task names `libs/api/member-hub` as the pattern to follow and that lib has both.
They are load-bearing, not cosmetic:

- `eslint.config.mjs` is what makes Nx **infer** the `eslint:lint` target. Without it
  `npx nx eslint:lint api-forum` — the task's own verification command, and the handoff's
  documented lint entry point for `libs/api/*` — does not exist. Confirmed by
  `nx show project api-forum`, which reports `eslint:lint` as an inferred
  `nx:run-commands` target sourced from the config file.
- `package.json` carries `"name": "@ptah-api/forum"`, which is what puts
  `packageName` into the project's `js` metadata and the `npm:private` tag on it —
  matching every sibling api lib.

**D-2 — the barrel currently exports nothing (`export {};`).** §2.5 fixes the public
surface at `ForumModule` + `TopicsReadService` + `ReadStateService`. None of the three
exists until Tasks 6.6–6.14, and Batch 6A owns none of them. Exporting `common/`
instead would contradict the README's own boundary statement in the same commit. The
docblock states the intended three-symbol end state and that `common/` is deliberately
internal, so the next executor adds three `export *` lines and nothing more.

`export {}` (rather than an empty file) keeps `index.ts` a module rather than a script.

### Verification — actual output

```
$ npx nx show project api-forum
{"root":"libs/api/forum","targets":{"eslint:lint":{...},"test":{...},"typecheck":{...}},
 "name":"api-forum","tags":["npm:private","scope:api","type:feature"],
 "metadata":{"js":{"packageName":"@ptah-api/forum","packageVersion":"0.0.1"}},
 "sourceRoot":"libs/api/forum/src","projectType":"library","implicitDependencies":[]}
```

```
$ npx nx run-many -t eslint:lint,typecheck -p api-forum --skip-nx-cache
> nx run api-forum:typecheck
> npx tsc --noEmit --project libs/api/forum/tsconfig.lib.json
> nx run api-forum:"eslint:lint"
> eslint .

 NX   Successfully ran targets eslint:lint, typecheck for project api-forum
```

Project resolves with the correct tags; zero boundary violations.

> ⚠️ **`npx nx show project api-forum` failed the first time with `Could not find project api-forum`.**
> A stale Nx project graph — `npx nx reset` fixed it and it has resolved on every call
> since. Worth knowing for whoever adds the next lib.

---

## Task 6.2 — Phase-2 wire contracts in `@ptah-contracts/community` ✅

### Files

| Path                                                                                               | Change                  |
| -------------------------------------------------------------------------------------------------- | ----------------------- |
| `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\member\member-topic.contract.ts`  | EXTENDED (+335 / −5)    |
| `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\member\member-search.contract.ts` | NEW                     |
| `D:\projects\ptah-extension\libs\api-contracts\community\src\lib\admin\admin-topic.contract.ts`    | NEW                     |
| `D:\projects\ptah-extension\libs\api-contracts\community\src\index.ts`                             | +29 lines of re-exports |

The 5 removed lines in `member-topic.contract.ts` are the Phase-1 docblock paragraph
that said the fuller types "are added by Batch 6 (P2-BE), in THIS file" — replaced by
the Phase-2 scope statement now that they are there.

### What was declared

**Member** (`member-topic.contract.ts`), each with a Zod schema `satisfies z.ZodType<T>`:

- `MemberCategory` — `id, slug, name, description|null, visibility, sortOrder, topicCount, unreadCount`
- `MemberPost` — `id, postNumber, parentId|null, bodyMarkdown, authorName|null, accepted, deleted, reactions, myReactions, createdAt, editedAt|null`
- `MemberTopicSummary` — feed row; no body
- `MemberTopicDetail` — `acceptedPost: MemberPost | null` **plus** `posts: Paged<MemberPost>`

`HubTopicSummary` is untouched and is **not** unified with `MemberTopicSummary` — the
docblock states why (the hub card must stay inside R6.2's one-request budget).

**Member search** (`member-search.contract.ts`): `SearchMatch`, `SearchExcerpt`,
`SEARCH_KINDS`/`SearchKind`/`isSearchKind`, `SearchTopicHit`, `SearchPostHit`,
`SearchLessonHit`, `MemberSearchResults`, all with schemas.

**Admin** (`admin/admin-topic.contract.ts`): `AdminCategory`, `AdminTopicSummary`,
`AdminPost` — re-declared, **no `extends`, no import from `member/` in either
direction**.

### Decisions

**D-3 — `MemberCategory.unreadCount` counts TOPICS with unread activity, not posts.**
Neither `tasks.md` nor the plan pins this and the two readings differ. Chosen because
it is the badge a category row renders ("3 threads with new replies"), it is bounded
above by `topicCount`, and the alternative (summing per-topic unread posts) produces a
number no surface displays while being trivially confusable with
`MemberTopicSummary.unreadCount` at a call site. Both are the same query cost. Stated
explicitly in the field docblock. **Cheap to overrule** — one field, one docblock.

**D-4 — admin contracts carry NO Zod schemas.** This matches `admin-pack.contract.ts`
and `admin-session-request.contract.ts`, which are types only (verified: zero `z.`
references in either). Member schemas exist because the **member panel** parses them at
its HTTP boundary; `libs/web/admin` carries its own response envelopes. Adding unparsed
schemas would be decoration that drifts. The barrel therefore re-exports the admin
types with `export type { ... }`, matching the existing admin lines.

**D-5 — `MemberTopicDetail.acceptedPost` is `null` when the accepted post is off the
requested page's slice.** §3.3 does not say. Declared this way so a client can rely on
`acceptedPost` being present regardless of paging, which is the whole reason the hoist
exists. Documented in the type docblock.

**D-6 — `SEARCH_KINDS` lives in `member-search.contract.ts`, not `shared/`.** Admin
search is a plain `?search` string on `GET /v1/admin/community/topics` with no kinds
parameter, so there is no second consumer. Putting it in `shared/` would widen the
"only shared vocabularies" rule for a type only one side uses.

### Verification — actual output

```
$ npx nx run-many -t eslint:lint,typecheck,test -p api-contracts-community --skip-nx-cache
> nx run api-contracts-community:"eslint:lint"
> eslint .
> nx run api-contracts-community:typecheck
> npx tsc --noEmit --project libs/api-contracts/community/tsconfig.lib.json
> nx run api-contracts-community:test
Test Suites: 1 passed, 1 total
Tests:       23 passed, 23 total

 NX   Successfully ran targets eslint:lint, typecheck, test for api-contracts-community
```

`contract-boundary.spec.ts` stays green with the new `admin/` file — the first time it
has had a second admin file to police. Its `stray files` assertion also passed, meaning
both new files landed inside the scanned side directories.

### 🔴 PROOF BY DELIBERATE FAILURE — Task 6.2

**The violation introduced** (temporary): added
`import type { MemberTopicSummary } from '../member/member-topic.contract';` and changed
`export interface AdminTopicSummary {` to `export interface AdminTopicSummary extends MemberTopicSummary {`.

**Failing run — actual output:**

```
● Contract boundary — member/ and admin/ are structurally disjoint › the real source tree › has no boundary violation of any rule

  + "R-CONTAIN: admin/admin-topic.contract.ts references member/ (\"../member/member-topic.contract\",
     string literal). member/ and admin/ never reference each other, in either direction, with no
     exceptions. Re-declare the fields (RK-8): an inheritance or intersection link is how Pack.notes
     reaches a member response.",
  + "R-HERITAGE: admin/admin-topic.contract.ts: AdminTopicSummary extends MemberTopicSummary, which
     came from member/. This is the AdminSession-extends-BuildersSession shape inverted into a hazard:
     a field added to the base widens the other side's response as a side effect. Re-declare the
     fields instead (RK-8, NFR-S4)."

Test Suites: 1 failed, 1 total
Tests:       1 failed, 22 passed, 23 total
```

**Both rules fired**, which is the designed behaviour (the import is the containment
breach, the `extends` is the leak).

**Reverted-green run — actual output:**

```
Test Suites: 1 passed, 1 total
Tests:       23 passed, 23 total
```

Revert verified by grep: the only remaining occurrences of `extends` in
`admin-topic.contract.ts` are inside prose docblocks (lines 9, 10, 21, 24); there is no
`MemberTopicSummary` import and no heritage clause.

---

## Task 6.3 — Prisma schema: five forum models + four `User` back-relations ✅

### File

`D:\projects\ptah-extension\apps\ptah-license-server\prisma\schema.prisma`

### What landed

`Category`, `Topic`, `Post`, `PostReaction`, `TopicReadState` **verbatim from §1.3** —
every `@@index`, every `onDelete`, and **every rejected-index comment** (the
visibility/cohortKeys rejection, the `deletedAt` rejection, the redundant
`@@index([postId])` rejection, and the `TopicReadState` no-surrogate-id note). The
§1.3 prose justifying `onDelete: Restrict` on `Topic.category` and `Post.parent` was
carried in as schema comments too, so the reasoning sits next to the constraint.

`User` gained exactly the four Phase-2 back-relations:

```prisma
topics           Topic[]          @relation("TopicAuthor")
posts            Post[]           @relation("PostAuthor")
postReactions    PostReaction[]
topicReadStates  TopicReadState[]
```

`authorId` is `String? @db.Uuid` on both `Topic` and `Post`, matching `User.id`'s
`@db.Uuid`. The generated DDL confirms this landed correctly: `"author_id" UUID`, and
the FK targets `"users"("id")`.

### Decisions

**D-7 — only the four Phase-2 back-relations were added.** §1.7 lists eight; the other
four (`lessonProgress`, `lessonComments`, `notifications`, `actedNotifications`) name
models that do not exist until Phases 3 and 5 and would not validate.

**D-8 — the five models were APPENDED at the end of the file**, after `Waitlist`, under
a banner comment, rather than interleaved near `MemberGroup`. This is what keeps the
diff to two hunks and zero incidental reformatting of neighbouring models.

I added one thing §1.3 does not contain: a banner above the block recording that the
two trigram indexes exist only in SQL and are invisible to this schema. That warning has
to live where a schema reader will see it, not only in the migration.

### Verification — actual output

```
$ DATABASE_URL="postgresql://ptah:ptah_dev_password@localhost:5432/ptah_db" npx prisma validate --schema prisma/schema.prisma
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma\schema.prisma.
The schema at prisma\schema.prisma is valid 🚀
```

```
$ git diff --stat apps/ptah-license-server/prisma/schema.prisma
 apps/ptah-license-server/prisma/schema.prisma | 170 ++++++++++++++++++++++++++
 1 file changed, 170 insertions(+)

$ git diff -U0 apps/ptah-license-server/prisma/schema.prisma | grep -E "^@@|^-[^-]"
@@ -37,0 +38,13 @@ model User {
@@ -314,0 +328,157 @@ model Waitlist {
```

**Zero deletions, two hunks** — the four `User` back-relations and the appended block.
No incidental reformatting of neighbouring models, as required.

No migration folder was created and no `prisma migrate` command was run in this task.

---

## Task 6.4 — Migration 2: `20260812090000_community_forum` ✅

### File

`D:\projects\ptah-extension\apps\ptah-license-server\prisma\migrations\20260812090000_community_forum\migration.sql` (NEW, 8431 bytes)

### Step 1 — privilege pre-flight (RISK-H), run BEFORE writing anything

```
$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select current_user, rolsuper from pg_roles where rolname = current_user;"
ptah|t

$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select name, default_version, installed_version from pg_available_extensions where name = 'pg_trgm';"
pg_trgm|1.6|

$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select version();"
PostgreSQL 16.13 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit

$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select table_name from information_schema.tables where table_name like 'community_%' order by 1;"
(no rows)
```

Matches the spec's stated expectation exactly: `ptah | t`, `pg_trgm | 1.6 |` with an
empty installed version, and no pre-existing `community_*` tables.

**Production was NOT re-verified this session.** The production `DATABASE_URL` is not
present in this workspace and the droplet's Postgres is a container not exposed
publicly, so the two queries could not be run against it from here. I did not go
looking for production credentials.

> 🔴 **Name this a PRE-DEPLOY GATE, not a passed check.** The handoff (§6) records that
> a previous session ran the checks live against production and got
> `current_user=ptah, usesuper=t` with `pg_trgm 1.6` available — that is the evidence
> RISK-H was downgraded HIGH→LOW on. That evidence is second-hand as far as this batch
> is concerned. Because the Dockerfile CMD is `npx prisma migrate deploy && node main.cjs`,
> a failing `CREATE EXTENSION` in production is a **process that never starts**, not a
> degraded feature. Re-run the two queries against production before the deploy that
> carries this migration.

### Step 2 — generate the DDL without `migrate dev`

⚠️ **The spec's command does not exist on this Prisma version.** See
[C-1](#c-1--prisma-7-removed---from-url-the-spec-command-for-task-64-step-2). The
equivalent that preserves the required semantics was used instead:

```
$ DATABASE_URL="postgresql://ptah:ptah_dev_password@localhost:5432/ptah_db" \
  npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

`prisma.config.ts` sets `datasource.url` from `process.env['DATABASE_URL']`, so
`--from-config-datasource` reads **the live database**, exactly as `--from-url` did:
**no shadow database is created and nothing is reset.** Confirmed by outcome — the
seeded dev entitlement survived (see below).

### Step 3 — reading the generated SQL BEFORE anything else

The generated script contains **five `CREATE TABLE`s and their indexes and nothing
else**:

- `community_categories`, `community_topics`, `community_posts`,
  `community_post_reactions`, `community_topic_read_state`
- 12 `CREATE INDEX` / `CREATE UNIQUE INDEX`
- 10 `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`

Audited mechanically:

```
$ grep -c "^CREATE TABLE" .../migration.sql
5

$ grep -nE "^(ALTER|DROP)" .../migration.sql | grep -v "ADD CONSTRAINT"
(none)
```

**No unrelated `ALTER` or `DROP` of any kind** — i.e. **zero drift between
`schema.prisma` and the live database** before this migration. Nothing needed to be
stopped or reported here.

> One artefact worth knowing about: Prisma 7 writes a dotenv banner line
> (`◇ injected env (0) from .env ...`) to **stdout**, ahead of the script. Redirecting
> the command straight into `migration.sql` embeds that line and produces a SQL file
> whose first line is not SQL. I stripped it and asserted the result begins with
> `-- CreateTable`. Anyone hand-authoring migrations 3–5 will hit this.

### Step 4 — the hand-written block

Appended below a `-- ---` separator, with a comment block that states: these indexes
are invisible to Prisma's model; a later `migrate diff` will therefore never mention
them; a later migration can silently drop them, so **the generated SQL of every
subsequent migration in this app must be read**; and that losing them is a _silent
performance_ failure rather than an error, because search still returns correct results
by sequential scan. It also records why `CREATE EXTENSION` is deliberately **not**
wrapped in a swallow-all `DO $$ ... EXCEPTION` block (RISK-H's explicit instruction),
and the privilege evidence with the "re-check on a managed provider" caveat.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "community_topics_title_trgm" ON "community_topics" USING gin (title gin_trgm_ops);
CREATE INDEX "community_posts_body_trgm"   ON "community_posts"  USING gin (body_markdown gin_trgm_ops);
```

### Step 5 — apply and regenerate

```
$ npx prisma migrate deploy
18 migrations found in prisma/migrations
Applying migration `20260812090000_community_forum`
The following migration(s) have been applied:
migrations/
  └─ 20260812090000_community_forum/
    └─ migration.sql
All migrations have been successfully applied.

$ npx prisma generate
✔ Generated Prisma Client (7.7.0) to .\..\..\libs\api\core\src\lib\generated-prisma-client in 177ms
```

`prisma migrate reset`, `prisma db push` and `prisma migrate dev` were **not** run.

### 🔴 THE FOUR VERIFICATION OUTPUTS, VERBATIM

**V1 — `npx prisma migrate status`**

```
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma\schema.prisma.
Datasource "db": PostgreSQL database "ptah_db", schema "public" at "localhost:5432"

18 migrations found in prisma/migrations

Database schema is up to date!
```

**V2 — `select extname from pg_extension where extname = 'pg_trgm';`**

```
pg_trgm
```

**V3 — `select indexname from pg_indexes where indexname like '%_trgm';`**

```
community_topics_title_trgm
community_posts_body_trgm
```

**V4 — `select table_name from information_schema.tables where table_name like 'community_%' order by 1;`**

```
community_categories
community_post_reactions
community_posts
community_topic_read_state
community_topics
```

All four match the expected result: migration applied and nothing pending · `pg_trgm`
present · **both** trigram indexes present · five `community_*` tables.

**Two extra checks I ran, because "an index exists" is weaker than "the right index
exists":**

```
$ select indexdef from pg_indexes where indexname like '%_trgm' order by indexname;
CREATE INDEX community_posts_body_trgm ON public.community_posts USING gin (body_markdown gin_trgm_ops)
CREATE INDEX community_topics_title_trgm ON public.community_topics USING gin (title gin_trgm_ops)
```

They are genuinely GIN indexes with the `gin_trgm_ops` operator class, not btrees that
merely carry the name.

```
$ select license_key, plan, status from licenses where license_key like 'DEV-%';
DEV-BUILDERS-VALIDATION-0001|builders|active

$ select count(*) from licenses;
4
```

**The seeded dev entitlement that three later exit gates depend on is intact.** Nothing
was reset. This is the check that proves `--from-config-datasource` behaved like
`--from-url` and not like `migrate dev`.

And the running server is unaffected:

```
$ curl http://localhost:3000/api/health  ->  200
```

### Note on the checksum drift (RISK-K)

Not repaired, per the spec's considered instruction — it belongs to the owner of
`4db8de4df` (PRE-7). It did **not** obstruct this batch, because `migrate deploy` does
not verify checksums of already-applied migrations the way `migrate dev` does. It has
**not** gone away: migrations 3, 4 and 5 will each hit it, and every developer running
`prisma migrate dev` on this workspace hits it. Recommendation stands — its own task
after Phase 2, using option (a) plus a follow-up migration.

---

## Task 6.5 — `common/`: soft delete, visibility, slugs, and the AD-5 structural spec ✅

### Files created

| Path                                                                                  | Purpose                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\api\forum\src\lib\common\soft-delete.ts`             | `NOT_DELETED`, `deletedFilter()`                                    |
| `D:\projects\ptah-extension\libs\api\forum\src\lib\common\edit-window.ts`             | ASSUMPTION-5 — **not in 6.5's file list, see D-9**                  |
| `D:\projects\ptah-extension\libs\api\forum\src\lib\common\visibility.ts`              | `buildCategoryVisibilityWhere`, `buildTopicCategoryVisibilityWhere` |
| `D:\projects\ptah-extension\libs\api\forum\src\lib\common\visibility.spec.ts`         | 15 tests                                                            |
| `D:\projects\ptah-extension\libs\api\forum\src\lib\common\slug.ts`                    | `slugify`, `resolveSlugCollision`, `buildSlug`                      |
| `D:\projects\ptah-extension\libs\api\forum\src\lib\common\slug.spec.ts`               | 15 tests                                                            |
| `D:\projects\ptah-extension\libs\api\forum\src\lib\common\soft-delete-filter.spec.ts` | 19 tests — the AD-5 structural spec                                 |

### 🔴 ASSUMPTION-5 — the constant, its value, and its location

> **Value: 24 hours.**
> **Location: `D:\projects\ptah-extension\libs\api\forum\src\lib\common\edit-window.ts`**

```ts
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const EDIT_WINDOW_HOURS = 24;
export function isWithinEditWindow(createdAt: Date, now: Date): boolean;
```

Measured from `createdAt`, **not** `editedAt` — otherwise each edit restarts the clock
and the window never closes. The boundary instant is CLOSED (`<`, strict), so the two
branches can never both be true.

**Admins are exempt structurally, not by a branch.** An admin edit goes through
`PATCH /v1/admin/community/topics/:id` behind `AdminGuard` (R8.2), which does not
consult this constant at all and writes an audit row instead. That means the member
path has no admin escape hatch to get wrong, and every admin edit is audited — which an
inline `if (isAdmin)` would not be. Task 6.7 consumes `EDIT_WINDOW_MS` in exactly one
place.

**D-9 — `edit-window.ts` is a file Task 6.5's list does not name.** The batch brief
requires the constant to be declared in `common/` in this batch; Task 6.5 is the only
6A task that creates `common/`. It went in its own file rather than into `soft-delete.ts`
because they are unrelated concerns. **If the value is wrong, it is one constant in one
file to change.**

### `soft-delete.ts`

`export const NOT_DELETED = { deletedAt: null } as const;` — OQ-5 option (a). The
docblock records the three concrete reasons middleware (option b) was rejected: it
hides the filter from the reader; it forces the admin `?includeDeleted` path to fight
it with a bypass flag, which is the thing that gets copy-pasted into a member read; and
a structural test cannot see an interceptor.

I also added `deletedFilter(includeDeleted: boolean)` for the admin path, documented as
**not** satisfying the structural spec — an admin read using it still needs its
`// AD-5-EXEMPT:` comment, so the decision stays in front of a reviewer.

### `visibility.ts`

`buildCategoryVisibilityWhere(ctx: MemberContext): Prisma.CategoryWhereInput` produces
an `OR` of at most three branches, exactly as specified. **When `ctx.cohortKeys` is
empty the cohort branch is omitted entirely**, and the docblock gives the reason the
spec required: `hasSome: []` would happen to be correct in Postgres, but that
correctness rests on a property a reviewer cannot check by reading the file, whereas an
absent branch is correct for a visible reason.

The three literal values are pinned with `satisfies Visibility` against
`@ptah-contracts/community`, so a change to `VISIBILITIES` breaks the compile — the
column is a Postgres `String`, not an enum, so nothing at the database layer would
catch that drift.

**ASSUMPTION-4 is implemented and documented as instructed**: `ctx.isAdmin` satisfies
the `staff` branch, the docblock states in full that this is the one place `isAdmin`
enters a member-side decision, and it enumerates the limits — read-only, member
endpoints only, no write authority (moderation stays behind `AdminGuard`), and no
cohort content (an admin with no assignments still does not match branch 2).

I also added `buildTopicCategoryVisibilityWhere(ctx)`, which nests the same clause under
`category` for reads that start at `Topic`. Without it, a topic read would filter the
topic and then check its category separately — which decides the topic exists before it
checks, and reopens the 403/404 gap the file exists to close.

### `visibility.spec.ts`

**These tests assert which categories are visible, not what the where-clause looks
like.** A pure shape comparison passes for a clause that is the right shape and the
wrong meaning. Each case runs the generated clause through a ~15-line model of the two
Prisma operators actually emitted (`OR`, `hasSome` array-overlap) against six fixture
categories, and asserts the resulting visible set. The model **throws** on an operator
it does not implement, so a future third branch breaks the test loudly instead of
evaluating to `false` and hiding a category from everyone.

All four cases the spec demands are present, plus three more:

| Case                                                      | Result                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| entitled non-admin, zero cohorts                          | sees `member` only                                                                          |
| entitled non-admin with `founding`                        | sees `member` + that cohort's (incl. multi-key ANY-match)                                   |
| admin                                                     | additionally sees `staff`                                                                   |
| nobody sees a cohort category whose keys they do not hold | asserted                                                                                    |
| **entitled non-admin does NOT see a `staff` category**    | asserted — the R1.1.3 assertion                                                             |
| being an admin does not grant cohort content              | asserted                                                                                    |
| the `OR` is never empty                                   | asserted (an empty `OR` matches nothing in Prisma and would make the whole forum invisible) |

Plus: the emitted clause omits `hasSome` entirely for a zero-cohort member (asserted
both structurally and via `JSON.stringify(...).not.toContain('hasSome')`), and
`cohortKeys` is **copied** into a mutable array rather than aliasing the request-scoped
`MemberContext`.

### `slug.ts`

Deterministic: lowercase → non-alphanumeric runs to `-` → truncate to 80 → trim leading/
trailing `-`, then a collision suffix starting at `-2` resolved against a caller-supplied
taken-set. Generated once at creation, never regenerated (R1.2.2) — stated in the
docblock, with the reason (shared links, bookmarks, and `Notification.route`, which
plan §1.6 stores at write time for exactly this).

Three decisions worth flagging:

- **Truncation runs BEFORE the trailing-hyphen trim**, so a cut landing mid-separator
  cannot leave a dangling `-`. Asserted.
- **`FALLBACK_SLUG_STEM = 'topic'`** for a title that normalises to nothing (`"???"`,
  emoji, non-Latin script — all legal titles). Without it the first such topic silently
  takes the **empty string** as its permanent public identifier. The spec does not
  mention this case; it is a real one and it fails silently.
- **The result may exceed the 80-char cap by the width of the suffix**, per the spec's
  literal wording ("cap at 80 chars, then a collision suffix"). Documented with the
  reason this is right rather than sloppy: truncating the stem to make room makes two
  different long titles collide _more_ often, which is the opposite of what the suffix
  is for.

`resolveSlugCollision` is bounded by `taken.size + 2` rather than looping unbounded.
The docblock states plainly that **this is not a concurrency control** — the `@unique`
index decides, and the create path must catch `P2002` and retry.

### `soft-delete-filter.spec.ts` — the AD-5 structural spec

Parses every `*.service.ts` under `libs/api/forum/src/lib/` and enforces three rules
plus an exemption census:

| Rule          | What it catches                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RULE-FILTER` | a `findMany`/`findFirst`/`findFirstOrThrow`/`count`/`aggregate`/`groupBy` on `topic` or `post` whose `where` does not mention `NOT_DELETED`                                            |
| `RULE-UNIQUE` | `findUnique`/`findUniqueOrThrow` on a soft-deletable model — banned outright                                                                                                           |
| `RULE-NESTED` | an unfiltered relation read (`posts`, `topics`, `children`, `parent`, `acceptedPost`) inside an `include`/`select`, including `posts: true` and `_count: { select: { topics: true } }` |
| `RULE-REASON` | an `// AD-5-EXEMPT:` comment with no stated reason                                                                                                                                     |

Three design points beyond the spec's minimum, each earning its keep:

1. **`RULE-UNIQUE` exists because `findUnique` _cannot_ carry the filter.** Its `where`
   accepts only unique fields, so `findUnique({ where: { id, ...NOT_DELETED } })` does
   not compile. It is the one read shape that can look filtered and not be. The failure
   message says to use `findFirst`.
2. **`RULE-NESTED` exists because the top-level scan misses the reads that matter
   most.** `_count: { select: { topics: true } }` counts tombstones and silently
   inflates every reply count in the product, and no call-expression scan sees it.
3. **A literal `{ deletedAt: null }` is deliberately REJECTED** even though it is
   semantically identical. Accepting it would make the constant optional and the grep
   incomplete, which is the entirety of AD-5's value. There is a probe asserting this.

**The exemption mechanism** is `// AD-5-EXEMPT: <reason>` on the line directly above the
read (line-based, so it is what a reviewer sees and what
`grep -rn "AD-5-EXEMPT"` finds). **The census**, `EXPECTED_EXEMPTIONS`, is currently
`[]`, and the spec fails if the set of exemptions taken differs from it — so a new
unfiltered read cannot be waved through by typing a comment; it must be typed into a
list a reviewer reads. Task 6.13's admin `?includeDeleted` read is the first expected
entry.

> ⚠️ **Honest statement of current coverage, also written into the file's docblock.**
> Batch 6A ships no services, so the real-tree scan finds **zero files today** and its
> "no violations" assertion is vacuous. What is not vacuous is the
> `analyze() actually detects` block — 13 probes running fabricated sources through the
> **same** `analyze()`, asserting each rule fires, that the exemption is recorded, that
> violations are reported exhaustively rather than short-circuiting, and — the half
> usually missing — that **six legal shapes are NOT flagged**. There is also an
> assertion that the loader is pointed at `src/lib` and can see `common/`, which guards
> against the failure mode where the scan silently covers nothing forever rather than
> only until Task 6.6.

**The negative control immediately earned its keep.** On the first run it failed and
caught a real bug in my analyser: `findMany({ where })` is a
`ShorthandPropertyAssignment`, not a `PropertyAssignment`, and my `propertyOf` only
matched the longhand — so the idiomatic hoisted-`where` pattern (which
`packs.service.ts` uses) was reported as _having no `where` at all_. That is a **false
positive on the most common correct shape**, which is precisely how a structural spec
gets deleted by the third developer who hits it. Fixed, with the reason recorded at the
function.

### Verification — actual output

```
$ npx nx test api-forum --testPathPattern="visibility|slug|soft-delete-filter"
   (run as the full suite — these are the only three spec files in the lib)
Test Suites: 3 passed, 3 total
Tests:       49 passed, 49 total

$ npx nx run-many -t eslint:lint,typecheck,test -p api-forum --skip-nx-cache
 NX   Successfully ran targets eslint:lint, typecheck, test for project api-forum
```

### 🔴 PROOF BY DELIBERATE FAILURE — Task 6.5

⚠️ **Method note, because it deviates from the instruction's literal wording.** The
brief says "temporarily remove one `NOT_DELETED` spread from a member read". **There
are no member reads in the repo** — every service lands in Tasks 6.6+. Removing a spread
from a _probe_ would only have re-proved the probe block. So I staged a **real service
file** to exercise the real-tree path — loader, file discovery, and analysis — which is
the part the probes cannot cover:

**Step A — real `libs/api/forum/src/lib/topics/tmp-proof.service.ts` WITH the spread**
(`where: { ...NOT_DELETED, categoryId }`):

```
Test Suites: 3 passed, 3 total
Tests:       49 passed, 49 total
```

**Step B — spread removed** (`where: { categoryId }`) — **FAILS**:

```
● AD-5 — every member read filters soft-deleted rows › the real source tree › has no unfiltered read

  + "RULE-FILTER: topics/tmp-proof.service.ts: topic.findMany() does not spread `NOT_DELETED`
     in its `where`, so it returns SOFT-DELETED rows (AD-5). Its `where` never mentions the
     constant — note that a literal `{ deletedAt: null }` is NOT accepted, on purpose: one
     greppable identifier is the whole point. Add `...NOT_DELETED`, or add
     \"// AD-5-EXEMPT: <reason>\" on the line above and list it in EXPECTED_EXEMPTIONS."

Test Suites: 1 failed, 2 passed, 3 total
Tests:       1 failed, 48 passed, 49 total
```

The failure names the **real file by path**, so the loader, the discovery walk and the
analysis are all proven on the real tree — not just on fabricated strings.

**Step C — probe file deleted, reverted-green:**

```
$ ls -R libs/api/forum/src
libs/api/forum/src:      index.ts  lib
libs/api/forum/src/lib:  common
libs/api/forum/src/lib/common:
  edit-window.ts  slug.spec.ts  slug.ts  soft-delete-filter.spec.ts
  soft-delete.ts  visibility.spec.ts  visibility.ts

Test Suites: 3 passed, 3 total
Tests:       49 passed, 49 total
 NX   Successfully ran targets eslint:lint, typecheck, test for project api-forum
```

The `topics/` directory was removed with the file; nothing remains.

---

## Wider verification (nothing else broke)

`tsconfig.base.json` is a global Nx input, so `nx show projects --affected --uncommitted`
lists the entire workspace (~90 projects). Rather than run everything, I ran the whole
of my own territory:

```
$ npx nx run-many -t typecheck -p api-forum,api-contracts-community,api-core,api-member-hub,
    api-membership,api-community,api-admin,api-audit,api-identity,api-licensing,api-billing,
    api-marketing,api-email,ptah-license-server --skip-nx-cache
 NX   Successfully ran target typecheck for 14 projects

$ npx nx run-many -t test -p <same 14>
 NX   Successfully ran target test for 14 projects

$ npx nx run-many -t eslint:lint -p api-forum,api-contracts-community,api-core,api-member-hub,
    api-membership,api-community,api-admin,api-audit,api-identity,ptah-license-server --skip-nx-cache
 NX   Successfully ran target eslint:lint for 10 projects

$ npx nx run-many -t lint,test -p web-members,web-core,web-admin,web-panel-ui --skip-nx-cache
 NX   Successfully ran targets lint, test for 4 projects
   (web-members 25 tests, web-core 44, web-admin 123 — 0 errors; the 14 lint warnings are
    pre-existing `explicit-member-accessibility` warnings, untouched by this batch)
```

`ptah-license-server`'s suite includes `route-map.spec.ts` and
`controller-validation.spec.ts`. Both are **green** — expected, since 6A adds no routes
and no controllers; they become live gates at Tasks 6.13/6.14.

> Nx flagged `api-forum:test` as a **flaky task**. It is not flaky — it failed twice on
> purpose (once from the analyser bug the negative control caught, once from the
> required Task 6.5 proof) and passed every other run. Nx's heuristic saw pass→fail→pass
> on the same input hash. Ignore it.

---

## Contradictions found

The previous two batches each found something; here are three.

### C-1 — Prisma 7 removed `--from-url`, the spec command for Task 6.4 step 2

**This is the significant one, and it will hit migrations 3, 4 and 5 identically.**

`tasks.md` Task 6.4 step 2 prescribes:

```
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel ... --script
```

Actual result on the installed Prisma **7.7.0**:

```
Error:
`--from-url` was removed. Please use `--[from/to]-config-datasource` in combination with
a Prisma config file that contains the appropriate datasource instead.
```

`--to-schema-datamodel` is likewise gone, replaced by `--to-schema`. The working
equivalent — which I used, and which preserves the two properties the spec depends on
(**reads the live DB; creates no shadow database; resets nothing**) — is:

```
DATABASE_URL="..." npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

This works because `prisma.config.ts:12` sets `datasource.url` from
`process.env['DATABASE_URL']`. The equivalence is not merely asserted: the seeded dev
entitlement `DEV-BUILDERS-VALIDATION-0001` is still present and `active` after the run,
which is exactly what a reset would have destroyed.

**Recommendation**: update Task 6.4's step 2 in `tasks.md`, and the §1.8 note, before
Batch 9 hand-authors migration 3.

### C-2 — Prisma 7 pollutes stdout, so the spec's `>` redirect produces invalid SQL

`prisma migrate diff --script` emits a dotenv banner
(`◇ injected env (0) from .env // tip: ...`) on **stdout**, before the script. The
spec's step 2 redirects stdout straight into `migration.sql`, which would make the
migration's first line non-SQL. I stripped it and asserted the file begins with
`-- CreateTable`. Same fix needed for migrations 3–5. (Prisma's own `-o/--output` flag
would avoid it and may be the better command to prescribe.)

### C-3 — the handoff's §4.1 claim that "RISK-K is closed" is contradicted by `tasks.md`, and `tasks.md` is right in spirit

`handoff.md` §4.1 states that after `097853b39` _"`prisma migrate dev` now works
normally. Migration 2 does NOT need B5's hand-authoring workaround. RISK-K is closed."_
`tasks.md` Task 6.4 says the opposite and instructs hand-authoring plus `migrate deploy`.

I followed `tasks.md` (per the precedence rule) and **did not test `migrate dev`**, since
running it is precisely the risk — it is the command that demands a full reset. So I
cannot say which is factually right about the checksum, only that the instruction I
followed was the safe one and it worked. The two documents disagree in writing and a
future reader could reasonably follow the handoff and reset the database. **Worth
reconciling**: one of the two sentences should be deleted.

### Minor findings

- **`nx show project api-forum` failed on first call** (`Could not find project`) until
  `npx nx reset`. Stale project graph; not a code issue, but it will look like one.
- **The generated Prisma client is gitignored** (`.gitignore:87`,
  `libs/api/core/src/lib/generated-prisma-client`, 0 files tracked). `prisma generate`
  produced `Category.ts`, `Topic.ts`, `Post.ts`, `PostReaction.ts`, `TopicReadState.ts`
  there, and `Prisma.CategoryWhereInput` resolves — but **none of it appears in
  `git status`**, so a reviewer cannot see it and a fresh clone must run
  `prisma generate` before `libs/api/forum` typechecks. Expected, and worth stating
  since Task 6.5's `visibility.ts` is the first file in this task to depend on it.
- **No `slugify` helper existed anywhere under `libs/api/`** before this batch — slugs
  were caller-supplied and regex-validated only. `slug.ts` is the first. Three
  `slugify` implementations exist outside `libs/api/` (`skill-synthesis`,
  `agent-generation`, `web-members`); none is reachable from `scope:api` and none was
  reused.

---

## Scope discipline

**Not started, as instructed**: Tasks 6.6–6.15 (services, DTOs, controllers, module
wiring, the `audit-log.types.ts` `community.*` actions, `MIN_TOTAL_PAYLOAD_PARAMS`).
**Not touched**: `libs/api/community` (AD-6 split stays deferred). `NotificationsModule`
(RISK-L) is referenced nowhere in anything I wrote. No trust levels, spam heuristics,
flag queues, digests, websockets, reaction counters, reconciliation job, `tsvector` or
external search (RK-1).

**Git**: no `git commit`, `git add`, `git stage` or `git rm` was run. No
`--no-verify`. No branch was created, switched or rebased. HEAD is unchanged at
`097853b39` and every change is unstaged in the working tree.

---

## Final `git status --porcelain`, annotated

```
 M apps/ptah-license-server/prisma/schema.prisma                              <- MINE (6.3)
 M libs/api-contracts/community/src/index.ts                                  <- MINE (6.2)
 M libs/api-contracts/community/src/lib/member/member-topic.contract.ts       <- MINE (6.2)
 M tsconfig.base.json                                                         <- MINE (6.1)
?? apps/ptah-license-server/prisma/migrations/20260812090000_community_forum/ <- MINE (6.4)
?? libs/api-contracts/community/src/lib/admin/admin-topic.contract.ts         <- MINE (6.2)
?? libs/api-contracts/community/src/lib/member/member-search.contract.ts      <- MINE (6.2)
?? libs/api/forum/                                                            <- MINE (6.1, 6.5)
```

```
$ git diff --stat
 apps/ptah-license-server/prisma/schema.prisma        | 170 +++++++++++
 libs/api-contracts/community/src/index.ts            |  29 ++
 .../src/lib/member/member-topic.contract.ts          | 335 ++++++++++++++++++++-
 tsconfig.base.json                                   |   1 +
 4 files changed, 530 insertions(+), 5 deletions(-)
```

The 5 deletions are the Phase-1 "added by Batch 6, in THIS file" docblock paragraph in
`member-topic.contract.ts`, replaced by its Phase-2 successor.

**Untracked files, expanded (19 files):**

```
apps/ptah-license-server/prisma/migrations/20260812090000_community_forum/migration.sql
libs/api-contracts/community/src/lib/admin/admin-topic.contract.ts
libs/api-contracts/community/src/lib/member/member-search.contract.ts
libs/api/forum/eslint.config.mjs
libs/api/forum/jest.config.cts
libs/api/forum/package.json
libs/api/forum/project.json
libs/api/forum/README.md
libs/api/forum/src/index.ts
libs/api/forum/src/lib/common/edit-window.ts
libs/api/forum/src/lib/common/slug.spec.ts
libs/api/forum/src/lib/common/slug.ts
libs/api/forum/src/lib/common/soft-delete-filter.spec.ts
libs/api/forum/src/lib/common/soft-delete.ts
libs/api/forum/src/lib/common/visibility.spec.ts
libs/api/forum/src/lib/common/visibility.ts
libs/api/forum/tsconfig.json
libs/api/forum/tsconfig.lib.json
libs/api/forum/tsconfig.spec.json
```

### 🔴 CONCURRENT FOREIGN WIP: NONE

The working tree was clean at batch start (`git status --porcelain` returned nothing)
and **every entry above is mine**. Nothing appeared in `libs/backend/**`,
`libs/frontend/**`, `libs/shared/**`, `apps/ptah-extension-vscode/**`,
`apps/ptah-electron/**`, `content-manifest.json` or `skills-lock.json` at any point
during this batch — no `tmp-leak-*` files, no unrelated modifications. Nothing foreign
was touched, and the orchestrator can stage all eight paths above without a filter.

---

## What the next executor should know

1. **Task 6.4's command in `tasks.md` is wrong for this Prisma version** (C-1/C-2).
   Fix it before Batch 9 authors migration 3.
2. **`soft-delete-filter.spec.ts` is armed but has nothing to read.** The first
   `*.service.ts` written in Task 6.6 is the moment it starts biting. Expect it to fire
   — that is it working.
3. **`EXPECTED_EXEMPTIONS` is `[]`.** Task 6.13's admin `?includeDeleted` read is the
   first entry, and adding it is a deliberate review event.
4. **The barrel is `export {};`.** Tasks 6.6/6.10/6.14 replace it with exactly three
   `export *` lines — `ForumModule`, `TopicsReadService`, `ReadStateService` — and
   nothing more.
5. **Two open decisions are now cheap to overrule and cost more later**: ASSUMPTION-5's
   24 hours (`common/edit-window.ts`) and D-3's `MemberCategory.unreadCount` semantics.
   Both are one-line changes today; after Batch 7 renders them, both become
   frontend-visible contract changes.
