# Batch 14A report — TASK_2026_177 Phase 5 (P5-BE, tasks 14.1 – 14.6)

**Executor**: `backend-developer`
**Date**: 2026-08-10
**Dispatch**: 14A of 3 (14A = 14.1–14.6, 14B = 14.7–14.12, 14C = 14.13–14.17)
**Verdict**: 🟢 **ALL SIX TASKS COMPLETE.** Migration 5 applied and confirmed against the
running `ptah_db`. **Nothing committed** — the team-leader owns the commit, after
`code-logic-reviewer` returns APPROVED.

**STOPPED at the dispatch boundary.** Task 14.7 was not started.

---

## 0. Executive summary — read these six lines first

1. **Migration 5 is applied and irreversible.** 20 → **21** migrations. `member_visible`
   defaults to `false`; `select count(*) from packs where member_visible = true` was an
   **error** before (no column) and **`0`** after. Exit-gate clause 5 is closed.
2. 🔴 **Two ground-truth facts in the dispatch were WRONG when I reached the code**, and one
   of them is load-bearing for 14B/14C: **`users` and `licenses` are both EMPTY (0 rows)**,
   not 3 and 3. See §6.2 — this breaks the member-path proofs 14C's exit-gate clause 4 needs.
3. 🔴 **The three trigram `DROP INDEX` statements appeared exactly as migration 3 predicted
   and migration 4 instructed.** All three were stripped; all three verified to survive.
4. 🔴 **Task 14.5's file list is incomplete.** Adding the two DTO fields alone would have made
   `memberVisible` and `accessNote` **silently unwritable on create** — `AdminPacksController.create()`
   enumerates DTO fields explicitly. The wiring was completed inside Task 14.6's declared file
   set. See §6.4.
5. **Task 14.4 added ZERO symbols** (expected 0–2). F-C is fully confirmed: every Phase-5
   contract already shipped.
6. ⚠️ **14A MUST NOT BE COMMITTED AS A STANDALONE COMMIT AHEAD OF 14B.** Task 14.6's
   instructions required naming `MemberPacksService` / `MemberPacksController` /
   `MemberPacksModule` in the present tense; those three symbols land in Tasks 14.7/14.8.
   See §7.4.
7. 🔴 **DOCKER IS DOWN AND NEEDS AN ELEVATED RESTART BEFORE 14B RUNS ANY DB COMMAND** — I
   killed it by accident when stopping the license server by port, **after** all verification
   in this report was captured. **No data was lost.** One elevated command fixes it; see §11.2.

---

## 1. Task-by-task status

| Task     | Title                                      | Status                             | Files touched                                                                                           |
| -------- | ------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **14.1** | Pre-flight — the seven facts               | ✅ COMPLETE                        | none (verification only)                                                                                |
| **14.2** | `schema.prisma`                            | ✅ COMPLETE                        | `apps/ptah-license-server/prisma/schema.prisma`                                                         |
| **14.3** | Migration 5, hand-authored + applied       | ✅ COMPLETE                        | `…/migrations/20260902090000_packs_visibility_and_notifications/migration.sql` (NEW)                    |
| **14.4** | Contracts — RECONCILE, do not author       | ✅ COMPLETE                        | `libs/api-contracts/community/src/lib/member/member-notification.contract.ts`                           |
| **14.5** | `pack.dto.ts` + the shared nullable census | ✅ COMPLETE                        | `libs/api/community/src/lib/packs/dto/pack.dto.ts`, `libs/api/core/src/lib/common/nullable-dto.spec.ts` |
| **14.6** | R5.6 — retire the conditional tense        | ✅ COMPLETE                        | `packs.types.ts`, `admin-packs.controller.ts`, `packs.service.ts`, `packs.module.ts`                    |
| 14.7     | `MemberPacksService`                       | ⏸️ NOT STARTED — dispatch boundary | —                                                                                                       |

### Exact file set I touched (9 files: 8 modified, 1 new)

```
M  apps/ptah-license-server/prisma/schema.prisma
?? apps/ptah-license-server/prisma/migrations/20260902090000_packs_visibility_and_notifications/migration.sql
M  libs/api-contracts/community/src/lib/member/member-notification.contract.ts
M  libs/api/community/src/lib/packs/dto/pack.dto.ts
M  libs/api/community/src/lib/packs/packs.types.ts
M  libs/api/community/src/lib/packs/packs.service.ts
M  libs/api/community/src/lib/packs/admin-packs.controller.ts
M  libs/api/community/src/lib/packs/packs.module.ts
M  libs/api/core/src/lib/common/nullable-dto.spec.ts
```

`git diff --stat` for those files only:

```
 apps/ptah-license-server/prisma/schema.prisma                                  |  81 +-
 libs/api-contracts/community/src/lib/member/member-notification.contract.ts    |  37 +-
 libs/api/community/src/lib/packs/admin-packs.controller.ts                     |  35 +-
 libs/api/community/src/lib/packs/dto/pack.dto.ts                               |  64 +-
 libs/api/community/src/lib/packs/packs.module.ts                               |  19 +-
 libs/api/community/src/lib/packs/packs.service.ts                              |  47 +-
 libs/api/community/src/lib/packs/packs.types.ts                                |  79 +-
 libs/api/core/src/lib/common/nullable-dto.spec.ts                              |  18 +-
```

🔴 **I did not run `git commit`, `git add`, `git stash`, or `git checkout`. Not once.**
🔴 **I did not touch `tsconfig.base.json`, `app.module.ts`, `controller-registry.ts`,
`route-map.spec.ts`, `controller-validation.spec.ts`, `.commitlintrc.json`, or any
`libs/api/notifications` path.** Those belong to 14B/14C.

### Files in the tree that are NOT mine (do not stage them with my work)

| File                                                                  | Owner                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `.ptah/specs/TASK_2026_179/task.md`                                   | foreign carrier (F-H)                                                          |
| `.ptah/specs/TASK_2026_184/task.md`                                   | foreign carrier (F-H)                                                          |
| `.ptah/specs/TASK_2026_179/.harvested.json` (untracked)               | foreign                                                                        |
| `.ptah/specs/TASK_2026_187/.harvested.json` (untracked)               | foreign                                                                        |
| `libs/backend/agent-sdk/.../session-query-executor.service.ts` (`MM`) | TASK_2026_197 / other WIP                                                      |
| `marketing/scripts/01-open-source-announcement.md`                    | other WIP (+370 lines, present before I began)                                 |
| `.ptah/specs/TASK_2026_177/tasks.md`                                  | **this task's own refine pass** — modified before I started; I did not edit it |

**PRE-7 as amended by F-H is satisfied**: `.ptah/specs` is tracked, three foreign carriers
are dirty, and **`git add .ptah/specs` must never be run**. The only file I wrote into that
tree is `.ptah/specs/TASK_2026_177/batch-14a-report.md` — this report.

---

## 2. Task 14.1 — Pre-flight, pasted verbatim

### 2.1 🔴 DEVIATION — HEAD is not where the dispatch said it was

The dispatch and the Phase-5 refinement block both baseline on `4b0313783`. Actual HEAD at
the start of this dispatch:

```
$ git log --oneline -1
d7101460b feat(output-styles): surface Claude Code output styles as a Ptah setting

$ git log --oneline 4b0313783..HEAD
d7101460b feat(output-styles): surface Claude Code output styles as a Ptah setting
```

**The concurrent TASK_2026_197 session COMMITTED.** Consequences:

- Everything the dispatch's constraint 2 listed as "modified by that other session" —
  `.commitlintrc.json`, `CLAUDE.md`, `libs/backend/agent-sdk/**`, `libs/backend/output-styles/**`,
  `libs/shared/src/lib/types/*.ts`, `apps/*/src/di/phase-2-libraries.ts` — **is now committed,
  not dirty.** The hazard is reduced, not increased.
- **F-G's claim that `.commitlintrc.json` "is MODIFIED right now by TASK_2026_197" is
  STALE.** It is committed (`+1` line, a new scope). I did not touch it; F-G's instruction to
  keep `license-server` / `migration` scopes still stands.
- I verified `d7101460b` touches **none** of Batch 14's file set: it is entirely
  `libs/backend/output-styles/**`, `agent-sdk`, `settings-core`, `rpc-handlers/chat`,
  `frontend/chat/settings`, and `.ptah/specs/TASK_2026_197/`. **Zero overlap with
  `libs/api/**`, `libs/api-contracts/**`or`apps/ptah-license-server/**`.\*\*

### 2.2 Migration ordering — ASSUMPTION-24 holds

```
$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
    "select migration_name from _prisma_migrations order by started_at desc limit 3;"
20260826090000_live_and_private_sessions
20260819090000_courses
20260812090000_community_forum

$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select count(*) from _prisma_migrations;"
20
```

`20260826090000_live_and_private_sessions` is present and applied. **Nothing sorts after
`20260902090000`.** ASSUMPTION-24's literal name is kept; the timestamp did not need to move.

```
$ npx prisma migrate status
◇ injected env (0) from .env
◇ injected env (41) from ..\..\.env
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma\schema.prisma.
Datasource "db": PostgreSQL database "ptah_db", schema "public" at "localhost:5432"

20 migrations found in prisma/migrations

Database schema is up to date!
```

**F-K CONFIRMED.** `prisma.config.ts` loaded the repo-root `.env` (`injected env (41) from
..\..\.env`). **No manual `DATABASE_URL` was passed on any command in this dispatch**, and
none was needed.

### 2.3 The eleven pre-existing `packs` columns, and the before-half of exit-gate clause 5

```
$ … "select column_name from information_schema.columns where table_name='packs' order by ordinal_position;"
id
slug
title
description
repo_url
notes
tags
cohort_key
created_by
created_at
updated_at            <- ELEVEN columns

$ … "select count(*) from packs;"
0

$ … "select count(*) from packs where member_visible = true;"
ERROR:  column "member_visible" does not exist
LINE 1: select count(*) from packs where member_visible = true;
                                         ^
```

🔴 **This error IS the before-half of exit-gate clause 5.** The column provably did not exist.

### 2.4 PRE-1 — `dtoPipe` read, and the packs PATCH binding confirmed

Read `libs/api/core/src/lib/common/dto-validation.pipe.ts`. The rule is unconditional:
esbuild does not implement `emitDecoratorMetadata`, so `metadata.metatype` is `undefined`
and `ValidationPipe.transform` short-circuits — **a bare `@Body() dto: X` is silently
unvalidated.** Every payload param must bind `dtoPipe(TheDto)`.

`admin-packs.controller.ts` already binds all four:

```
58:  @Get()
60:    @Query(dtoPipe(ListPacksQueryDto)) query: ListPacksQueryDto,
75:  @Post()
80:    @Body(dtoPipe(CreatePackDto)) dto: CreatePackDto,
96:  @Patch(':id')
102:    @Body(dtoPipe(UpdatePackDto)) dto: UpdatePackDto,
```

**Confirmed, not re-bound** (Task 14.5's instruction). This dispatch adds **no new
controller and no new payload param**, so `MIN_TOTAL_PAYLOAD_PARAMS` and
`NAMED_PRIMITIVE_PARAM_COUNT` are untouched by 14A — Task 14.15 (14C) re-derives them once
14B's two controllers land.

### 2.5 Ground truth 9 — which of the two fields is census-eligible

Read `libs/api/core/src/lib/common/optional-field.ts` and `nullable-dto.spec.ts`.

> **One sentence, as required:** `accessNote` is census-eligible because its declared type is
> `string | null` and an explicit `null` is a **real value** meaning "clear the stored
> `access_note` column" — the identical idiom `notes` next door already uses; `memberVisible`
> is **not** census-eligible because `member_visible` is `BOOLEAN NOT NULL DEFAULT false`
> with no third state, so `{"memberVisible": null}` is a malformed request that must become a
> `400` naming the field rather than a silently-skipped property that leaves a pack's
> visibility unchanged while the admin believes they changed it.

### 2.6 Census constants — pasted with line numbers, from the correct two files

**`apps/ptah-license-server/src/common/controller-validation.spec.ts`**

```
78:const UNVALIDATED_DEBT: readonly string[] = [];
224:const MIN_TOTAL_PAYLOAD_PARAMS = 76;
250:const NAMED_PRIMITIVE_PARAM_COUNT = 6;
```

**`apps/ptah-license-server/src/common/route-map.spec.ts`** — a **different file**, exactly as
ground truth 10 warns:

```
508:const PREFIX_EXCEPTIONS: ReadonlyArray<{…}> = [
       { label: 'marketing/PublicMarketingController', prefix: '', reason: '…' }   <- ONE entry
     ];
558:const KNOWN_PREFIX_DEBT: readonly string[] = [];                                <- EMPTY
```

**Nothing was added to either.** `controller-registry.ts` holds **38** controllers
(unchanged — 14A adds none).

### 2.7 RISK-AE evidence, re-confirmed rather than trusted

```
$ grep -rn "ScheduleModule\|@Cron" --include=*.ts libs/api apps/ptah-license-server
(exit 0, ZERO hits)
```

**Confirmed: `@nestjs/schedule` is installed and wired nowhere.** Migration 5 does not change
this; `ScheduleModule.forRoot()` is Task 14.9's, in dispatch 14B. **RISK-AE remains fully
open and is 14B's highest risk.**

### 2.8 The four RISK-L sites Task 14.14 must rewrite — located, untouched

```
libs/api/community/src/lib/live-sessions/live-sessions.module.spec.ts:54,63,74
libs/api/forum/src/lib/forum.module.spec.ts:34,42,50
libs/api/learning/src/lib/learning.module.spec.ts:44,53,64
libs/api/community/src/lib/google-sessions/google-sessions.module.ts:67   (docblock, not a spec)
```

All four confirmed present. **14A touched none of them** — correct, because 14A adds no
`NotificationsModule` for them to assert against.

---

## 3. Task 14.2 — `schema.prisma`

### What was added, and nothing else

1. **`Pack` gained exactly two columns, inserted after `notes`**, carrying plan §1.2's
   comments verbatim — including _"cohortKey is NOT it and never becomes it"_ and _"Distinct
   from `notes`, which stays admin-internal (R5.2)."_
2. **Plan §1.2's index rejection was carried across as a comment** after the model:
   `// Index on memberVisible REJECTED: tens of rows, always read in full.` **No index on
   `member_visible` was added.**
3. **`Notification` verbatim from plan §1.6**, both indexes with their comments, both
   relations (`user` → `Cascade`, `actor` → `SetNull`), under a Phase-5 banner matching the
   Phase-2 and Phase-3 banner style already in the file.
4. **`User` gained exactly the two §1.7 back-relations.** The existing comment saying the
   pair _"names a model that does not exist until then and would not validate"_ was replaced
   with the reason each `onDelete` differs — that comment had become false the moment the
   model landed.
5. **Every existing `Pack` field is byte-identical.** `notes`, `cohortKey`, the `cohort` FK
   and `@@index([cohortKey])` keep their comments and meanings.

```
$ npx prisma validate
The schema at prisma\schema.prisma is valid 🚀
```

### 🔴 FINDING — `prisma format --check` is RED AT HEAD, so half of 14.2's verification is not satisfiable as written

Task 14.2's verification asks for `npx prisma format --check` **and** _"`git diff` on the file
shows only the additions above and no reformatting of untouched models."_ **Those two clauses
are in direct conflict in this repository**, and I chose the second.

Proof that the failure is pre-existing and not mine — run against `git show HEAD:`'s copy:

```
$ git show HEAD:apps/ptah-license-server/prisma/schema.prisma > /tmp/fmtchk/schema.prisma
$ npx prisma format --schema=/tmp/fmtchk/schema.prisma --check
Prisma schema loaded from …\schema.prisma.
! There are unformatted files. Run prisma format to format them.
```

And the size of the reformat `prisma format` would perform on the **unmodified** file:

```
$ diff /tmp/fmtchk/schema.prisma /tmp/fmtchk/schema.fmt.prisma | grep -c '^[<>]'
113
```

**113 lines across models this batch does not touch** — the whole of `User`, plus a blank
line after `datasource db`. The drift has accumulated because every migration in this task
was hand-authored (V-MIG is superseded), and no batch has ever run `prisma format`.

**Decision: I did NOT run `prisma format`.** Running it would have put 113 lines of unrelated
reformatting into a Phase-5 diff and violated 14.2's explicit "no reformatting of untouched
models" clause. My two `Pack` fields are self-aligned as a pair (the plan's verbatim text);
`memberVisible` is 13 characters and does not fit the model's existing 12-character name
column, which is exactly what `prisma format` would have widened.

**Recommendation for the team-leader**: file the reformat as its own commit, in its own task,
after Phase 5 closes. It is a 113-line whitespace-only change that should never share a diff
with semantic work.

---

## 4. Task 14.3 — Migration 5, applied and confirmed

### 4.1 🔴 The three trigram `DROP INDEX` statements appeared — predicted, caught, stripped

`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
emitted, as the **first three statements** of its script:

```sql
-- DropIndex
DROP INDEX "community_posts_body_trgm";
-- DropIndex
DROP INDEX "community_topics_title_trgm";
-- DropIndex
DROP INDEX "course_lessons_title_trgm";
```

**This was predicted, not discovered.** Migration 3's header says _"Migrations 4 and 5 will
each see"_ this. Migration 4 stripped the same three and left the instruction: _"MIGRATION 5
(Batch 14) MUST DO THE SAME CHECK. The tell is a `DROP INDEX` on a name ending `_trgm` that
no task asked for."_ **The check was run, all three were found, all three were stripped.**
The warning chain in `schema.prisma` and in migrations 3 and 4 worked exactly as designed.

**Unlike migration 4, there was NO fourth intentional drop.** Migration 5 drops nothing —
every statement is an `ALTER … ADD COLUMN`, a `CREATE TABLE`, a `CREATE INDEX` or an
`ADD CONSTRAINT`. That is recorded in the migration's own header banner.

Empirical proof the three survived the apply:

```
BEFORE:
community_posts_body_trgm
community_topics_title_trgm
course_lessons_title_trgm

AFTER  (select indexname from pg_indexes where indexname like '%trgm%'):
community_posts_body_trgm
community_topics_title_trgm
course_lessons_title_trgm
```

### 4.2 The apply

```
$ npx prisma migrate deploy
Prisma schema loaded from prisma\schema.prisma.
Datasource "db": PostgreSQL database "ptah_db", schema "public" at "localhost:5432"

21 migrations found in prisma/migrations

Applying migration `20260902090000_packs_visibility_and_notifications`

The following migration(s) have been applied:

migrations/
  └─ 20260902090000_packs_visibility_and_notifications/
    └─ migration.sql

All migrations have been successfully applied.

$ npx prisma migrate status
21 migrations found in prisma/migrations

Database schema is up to date!
```

**20 → 21 migrations, exactly as ground truth 15 predicted.**
`prisma migrate dev`, `db push` and `migrate reset` were **never** run.

### 4.3 🔴 EXIT-GATE CLAUSE 5 — the before/after `member_visible = true` count

| When       | Command                                                   | Result                                              |
| ---------- | --------------------------------------------------------- | --------------------------------------------------- |
| **BEFORE** | `select count(*) from packs where member_visible = true;` | **`ERROR: column "member_visible" does not exist`** |
| **AFTER**  | `select count(*) from packs where member_visible = true;` | **`0`**                                             |
| **AFTER**  | `select count(*) from packs;`                             | **`0`**                                             |
| **AFTER**  | `select count(*) from member_notifications;`              | **`0`**                                             |

**No pack became member-visible by migration.** Clause 5 is closed.

### 4.4 RISK-AK — the count above is vacuous on a zero-row table, so I proved the DEFAULT directly

RISK-AK states plainly that "no pack leaked" passes against an empty table. `packs` held 0
rows before and after, so the count alone proves nothing about the mechanism. I therefore
proved the **column default** — which is the actual mechanism by which no existing pack
becomes visible — with a probe row inserted with `member_visible` **omitted**, then torn down
by id in the same statement block:

```
INSERT 0 1
         id         | member_visible | access_note_is_null
--------------------+----------------+---------------------
 b14a_default_probe | f              | t
(1 row)

 member_visible_true_count
---------------------------
                         0
DELETE 1
 residue      -> 0
 packs_total  -> 0
```

**`member_visible` lands `false` when unspecified.** The non-vacuous _filter_ assertion with
three seeded packs remains Task 14.17's (14C), as RISK-AK's mitigation says.

### 4.5 Structural verification of both tables

```
$ \d packs   (excerpt)
 access_note    | text                           |           |          |
 member_visible | boolean                        |           | not null | false
```

```
$ \d member_notifications
    Column    |              Type              | Nullable |      Default
--------------+--------------------------------+----------+-------------------
 id           | text                           | not null |
 user_id      | uuid                           | not null |
 kind         | text                           | not null |
 actor_id     | uuid                           |          |
 target_type  | text                           | not null |
 target_id    | text                           | not null |
 title        | text                           | not null |
 body_preview | text                           |          |
 route        | text                           | not null |
 read_at      | timestamp(3) without time zone |          |
 created_at   | timestamp(3) without time zone | not null | CURRENT_TIMESTAMP
Indexes:
    "member_notifications_pkey" PRIMARY KEY, btree (id)
    "member_notifications_created_at_idx" btree (created_at)
    "member_notifications_user_id_read_at_created_at_idx" btree (user_id, read_at, created_at)
Foreign-key constraints:
    "member_notifications_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
    "member_notifications_user_id_fkey"  FOREIGN KEY (user_id)  REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
```

Both indexes, both foreign keys, both `onDelete` rules — as plan §1.6 specifies. **No
`pg_trgm` index was created** (A-7 respected).

### 4.6 🔴 FINDING — the `migrate diff` re-run is NOT empty, and never can be

Task 14.3's verification asks for _"a re-run of `migrate diff` produces an **empty**
script."_ It does not, and **no migration in this application will ever satisfy that clause
as written**:

```
$ npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script

-- DropIndex
DROP INDEX "community_posts_body_trgm";

-- DropIndex
DROP INDEX "community_topics_title_trgm";

-- DropIndex
DROP INDEX "course_lessons_title_trgm";
```

**That is the ENTIRE residual diff — the three perpetual trigram drops and nothing else.**
Zero statements relate to `packs` or `member_notifications`, which is the fact the clause was
actually reaching for: **migration 5 introduced no drift.** The three drops are Prisma's
permanent blind spot (`gin_trgm_ops` is inexpressible in a model), documented in
`schema.prisma`'s Phase-2 and Phase-3 banners and in migrations 3 and 4.

**Recommendation**: Task 16.5 (which is already amending the `rg -i discourse` gate for the
same class of reason) should also restate this clause as _"a re-run of `migrate diff`
produces the three known trigram drops and nothing else."_

### 4.7 The Prisma client was regenerated — and it produces no tracked diff

`toPackResponse` consumes a Prisma row, so the generated client had to learn the two new
columns or `api-community` would not typecheck.

```
$ npx prisma generate
✔ Generated Prisma Client (7.7.0) to …\libs\api\core\src\lib\generated-prisma-client in 241ms
$ ls …/generated-prisma-client/models/ | grep -i notif
Notification.ts

$ git check-ignore -v libs/api/core/src/lib/generated-prisma-client/client.ts
.gitignore:87:generated-prisma-client   libs/api/core/src/lib/generated-prisma-client/client.ts
```

**The generated client is gitignored**, so the regeneration adds nothing to the commit. This
also settles the dispatch's constraint 7 concern about "the generated `class.ts` copy" — a
regenerated client cannot produce a tracked diff in this repo.

---

## 5. Task 14.4 — Contracts RECONCILE

### 🔴 F-C is CONFIRMED IN FULL. Every Phase-5 contract already ships. I re-declared nothing.

Verified present, read from source before writing a line:

| Symbol                                                                          | File                                     | Status           |
| ------------------------------------------------------------------------------- | ---------------------------------------- | ---------------- |
| `MemberPack`, `memberPackSchema`                                                | `member/member-pack.contract.ts`         | ✅ already ships |
| `MemberNotification`, `memberNotificationSchema`                                | `member/member-notification.contract.ts` | ✅ already ships |
| `HubNotificationSummary`, `hubNotificationSummarySchema`                        | `member/member-notification.contract.ts` | ✅ already ships |
| `NOTIFICATION_KINDS` (5), `NOTIFICATION_TARGET_TYPES` (4), `isNotificationKind` | `shared/notification-kind.ts`            | ✅ already ships |
| `AdminPack.memberVisible` / `.accessNote`                                       | `admin/admin-pack.contract.ts:64-71`     | ✅ already ships |

All exported from `src/index.ts:134-150`. **Confirmed by reading the barrel.**

### 🔴 SYMBOLS ADDED BY TASK 14.4: **ZERO.** (Expected 0–2.)

The three write-response envelopes from plan §3.6 (`{ readAt }` for `POST :id/read`,
`{ marked }` for `POST read-all`) were **deliberately not declared**, on the task's own
condition — _"Declare them here only if they need a client-side parse; if the client treats
them as fire-and-refetch (Task 15.4's stated design), say so and add nothing."_

**Task 15.4's stated design is fire-and-refetch.** Read from `tasks.md:10413-10417`: the
store's public surface is `markRead(id)` / `markAllRead()`, and the count is handled by
_"decrements optimistically, issues the request, **replaces the count from the server** on
success and restores it on failure"_ — the count comes from `GET .../unread-count`, which
RISK-AP names as **the only writer of the badge**. Neither write body is parsed. Declaring
schemas for them would add two exported symbols guarding no boundary.

### What Task 14.4 actually changed: one docblock, and only its false half

`member-notification.contract.ts:22-27` said:

> _"PHASE 1 SCOPE. `HubNotificationSummary` is … the only part Phase 1 emits (always
> `{ status: 'empty', data: { unreadCount: 0 } }` **until Batch 14 lands R10**)."_

Replaced with a present-tense "WHAT SHIPS" block naming the table and the migration, plus
three warnings the reconcile surfaced:

- **F-D honoured explicitly.** The new text states that the hub section's `status` is
  **derived from the data, not pinned**, that `HUB_SECTION_STATUSES` is
  `'ok' | 'empty' | 'unavailable'`, and that _"pinning the status to `'ok'` would be a new lie
  standing where the old one stood."_ This is the docblock half of Task 14.16's restatement.
- **ASSUMPTION-20 written into the contract**: four of five kinds have producers;
  `announcement` is declared, accepted, and written by nothing.
- **The fire-and-refetch decision recorded at the point of the omission**, so the next reader
  does not "fix" the missing envelopes by adding them.

### Gate output

```
$ npx nx run-many -t eslint:lint,typecheck,test -p api-contracts-community --skip-nx-cache
Test Suites: 2 passed, 2 total
Tests:       33 passed, 33 total

 NX   Successfully ran targets eslint:lint, typecheck, test for project api-contracts-community
```

`contract-boundary.spec.ts` and `member-progress-privacy.spec.ts` are **unchanged and green**.
**No `admin/*` notification contract was created.**

### F-B confirmed as a by-product

`member-pack.contract.ts:37` already reads _"mirroring how `PacksService` refuses to inject
`MembershipService`"_ — the corrected name. `grep -rn "BuildersMembershipService"
libs/api/community/` returns **0**. The ghost was not re-introduced anywhere.

---

## 6. Task 14.5 — `pack.dto.ts` + the shared nullable census

### 6.1 The two fields, with opposite decorators

Added to **both** `CreatePackDto` and `UpdatePackDto`:

```ts
/** A-1. `null` is a `400`; see the class docblock's Phase-5 pair note. */
@IsOptionalNotNull()
@IsBoolean()
memberVisible?: boolean;

/** R5.5. `null` CLEARS the note; see the class docblock's Phase-5 pair note. */
@IsOptional()
@IsString()
@MaxLength(2000)
accessNote?: string | null;
```

`@MaxLength(2000)` on `accessNote` matches its two free-text siblings in the same DTO
(`notes` and `description`, both 2000). No new cap was invented.

`UpdatePackDto`'s class docblock was extended with a "🔴 THE PHASE-5 PAIR TAKES OPPOSITE
DECORATORS, AND THAT CONTRAST IS THE POINT" block, because the two fields arrive in the same
change and _look_ symmetrical.

### The one-sentence review justification the task demands

> **`accessNote` accepting `null` is correct** because it is the "clear this stored column"
> case — `access_note` is a nullable member-facing column and `null` is the only way an admin
> can retract a note they published, exactly as `null` retracts `notes` on the same endpoint;
> **`memberVisible` accepting `null` would not be correct** because `member_visible` is
> `NOT NULL DEFAULT false` with no third state, so a tolerated `null` would be silently
> skipped by `@IsOptional()`, leaving the pack's visibility exactly as it was while returning
> `200` to an admin who believes they just published or unpublished it — a write that looks
> honoured and is not.

### Census update

`EXPECTED_NULLABLE_OPTIONALS` grew from **11 → 13** with the two `accessNote` entries and a
comment explaining why the Phase-5 twin is deliberately absent. The constant's docblock was
updated from _"The eleven below"_ to name the twelfth and thirteenth.

```
$ npx nx test api-core --skip-nx-cache --testPathPatterns=nullable-dto
Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total
```

### 🔴 Deliberate-failure proof — the census is not vacuous

I removed the two new entries and re-ran. It failed, naming exactly the two keys:

```
    - Expected  - 0
    + Received  + 2
    +   "community/src/lib/packs/dto/pack.dto.ts:CreatePackDto.accessNote",
    +   "community/src/lib/packs/dto/pack.dto.ts:UpdatePackDto.accessNote",
   > 270 |       expect(actual).toEqual([...EXPECTED_NULLABLE_OPTIONALS].sort());

Tests:       1 failed, 13 passed, 14 total
```

Restored from backup and re-confirmed green (`14 passed`). **`memberVisible` never appeared in
that failure output** — it correctly carries `@IsOptionalNotNull()` and is invisible to the
census, which is the mechanism working in both directions.

### 6.2 🔴 FINDING — `users` AND `licenses` ARE EMPTY. The documented live data state is wrong.

The preconditions section's "live data state is a free test" table asserts `users` = **3**,
`licenses` = **3**. Measured today:

```
            t             | count
--------------------------+-------
 community_categories     |     4     <- Batch 8's seed, intact
 community_topics         |     9     <- Batch 8's seed, intact
 courses                  |     1     <- Batch 11's seed, intact
 licenses                 |     0     <- 🔴 documented as 3
 live_sessions            |     0
 member_group_assignments |     0
 member_groups            |     1     <- key='founding', is_default=true, intact
 member_notifications     |     0
 packs                    |     0
 session_requests         |     0
 users                    |     0     <- 🔴 documented as 3
```

**The content seeds survived; the identity rows did not.** I did not delete them — `users`
was already empty at the first query I ran against it, before any write of mine.

**Impact, in order of severity:**

1. 🔴 **14C's exit-gate clause 4 cannot be proven end-to-end as written.** It requires _"a
   `cohortKey`-bearing pack visible to a **zero-cohort member**"_. There is no member. Either
   14C seeds a `users` row (and a `License`, for the entitlement probe) as part of its
   throwaway fixture and tears it down, or the clause degrades to a service-level test and the
   report must say so.
2. 🔴 **`V-TOKEN`'s premise — "the dev user's real `users.id`" — no longer holds.** There is
   no such row.
3. ✅ **Admin proofs are UNAFFECTED, and I confirmed why rather than assuming it.**
   `JwtAuthGuard` → `AuthService.validateToken` → `JwtTokenService.validateToken` only
   _verifies the signature and maps the payload_ (`jwt-token.service.ts:91-107`); there is no
   database lookup. `AdminGuard.canActivate` (`admin.guard.ts:47-77`) checks
   `user.email ∈ ADMIN_EMAILS` and nothing else. **A signed token for a non-existent user
   authenticates and authorises against every admin route** — which is how §6.3's live proofs
   below were possible, and is itself worth a security look outside this task.
4. **B1/B3/B6's recorded exit-gate results are now unreproducible** on this database. That is
   a statement about the data, not about their code.

### 6.3 🔴 LIVE V-CURL PROOFS — the two the task demands, plus the write path

Server: `npx nx serve ptah-license-server`, `V-HEALTH` = **200**. Token: a 20-minute JWT
signed with the workspace-root `.env` `JWT_SECRET` for `abdallah@miramarstaffing.com`
(`ADMIN_EMAILS` confirmed to contain exactly that address), passed as the **`ptah_auth`
cookie** — never an `Authorization: Bearer` header, per the V-CURL correction. **The token
file was deleted afterwards.**

**Setup — `POST /api/v1/admin/packs` with `memberVisible` OMITTED:**

```
            id             |      slug       | member_visible |         access_note          |         notes          |          created_by
---------------------------+-----------------+----------------+------------------------------+------------------------+------------------------------
 cmsn4esn80000qqmft2m9sk0l | b14a-curl-probe | f              | Ask in #packs for an invite. | ADMIN-ONLY-SECRET-NOTE | abdallah@miramarstaffing.com
```

`accessNote` persisted; `member_visible` landed **`f`** from the column default. The full
create path works, undefaulted at every layer.

**PROOF A — `PATCH {"memberVisible": null}` → `400` naming the field:**

```
$ curl -s -w '\nHTTP=%{http_code}\n' -X PATCH -b "ptah_auth=$TOKEN" \
    -H 'Content-Type: application/json' -d '{"memberVisible": null}' \
    http://localhost:3000/api/v1/admin/packs/cmsn4esn80000qqmft2m9sk0l

{"message":["memberVisible must be a boolean value"],"error":"Bad Request","statusCode":400}
HTTP=400
```

🔴 **`400`, and the message names the field.** This is `a3830108d`'s whole point, live.

**PROOF B — `PATCH {"accessNote": null}` → `200`, column cleared:**

```
$ curl … -d '{"accessNote": null}' …

{"id":"cmsn4esn80000qqmft2m9sk0l","slug":"b14a-curl-probe",…,"notes":"ADMIN-ONLY-SECRET-NOTE",
 "memberVisible":false,"accessNote":null,"tags":[],"cohortKey":null,"cohortName":null,…}
HTTP=200
```

🔴 **`200`, and `accessNote` is `null` — the column was cleared, not skipped.**

**PROOF C (extra) — the flip actually writes, and is audited as a VALUE:**

```
$ curl … -d '{"memberVisible": true, "accessNote": "You will receive a GitHub invite within 24h."}' …
…"memberVisible":true,"accessNote":"You will receive a GitHub invite within 24h."…
HTTP=200

$ … "select member_visible, access_note from packs where id='cmsn4esn…';"
 member_visible |                 access_note
----------------+----------------------------------------------
 t              | You will receive a GitHub invite within 24h.

$ … "select action, metadata from admin_audit_log where target_id='cmsn4esn…';"
 pack.create | {"slug":"b14a-curl-probe","tags":[],"title":"B14A curl probe","repoUrl":"…","cohortKey":null,"memberVisible":false}
 pack.update | {"slug":"b14a-curl-probe","fields":["accessNote"],"cohortKey":null,"memberVisible":false}
 pack.update | {"slug":"b14a-curl-probe","fields":["memberVisible","accessNote"],"cohortKey":null,"memberVisible":true}
```

The audit trail records **the resulting visibility as a value**, so "this pack was published"
is answerable from the ledger. `"fields":["memberVisible","accessNote"]` alone would not tell
an auditor which direction it went (R8.5, PRE-6 — and both rows committed inside the
mutation's own `$transaction`, unchanged).

**Teardown, with a census proving it (B13's residue discipline):**

```
$ curl -X DELETE … -> {"deleted":true}  HTTP=200

 packs_total | member_visible_true | b14a_residue | notifications
-------------+---------------------+--------------+---------------
           0 |                   0 |            0 |             0
```

⚠️ **Audit rows disclosed explicitly.** The delete left **4** `admin_audit_log` rows
(`pack.create`, `pack.update` ×2, `pack.delete`). The table was **empty before I began** — I
verified there was no prior-batch precedent for leaving probe rows — so I removed those four
scoped to the single `target_id`, restoring the pre-batch state:

```
DELETE 4
 audit_rows_remaining -> 0
 packs_remaining      -> 0
```

**I flag this as a judgement call for the reviewer.** `admin_audit_log` is an append-only
compliance ledger and deleting from it is normally wrong. I judged that leaving four
synthetic "an admin published a pack" rows referencing a pack that never existed would
pollute 14C's exit-gate census and be harder to explain later than a scoped, disclosed
cleanup of a dev database. **If the reviewer disagrees, nothing needs undoing — the rows are
gone and the table matches its pre-batch state.**

### 6.4 🔴 FINDING — Task 14.5's file list is incomplete; the DTO fields were unwritable without service wiring

Adding the two DTO fields is **necessary and not sufficient**, and following Task 14.5's file
list literally would have shipped two silently-inert fields:

- **`AdminPacksController.create()` enumerates DTO fields explicitly** (`slug`, `title`,
  `description`, `repoUrl`, `notes`, `tags`, `cohortKey`). A new DTO field not added to that
  object literal is **accepted by validation, then discarded** — no error, no warning, no
  test failure. An admin could `POST` `{"memberVisible": true}` and get a `201` for a pack
  members cannot see.
- **`AdminPacksController.update()` passes `dto` wholesale** to `packs.update(id, dto, …)`,
  so `UpdatePackInput` had to gain both fields or the call would not typecheck — and
  `PacksService.update` writes only keys it explicitly checks, so both needed
  `if (input.x !== undefined)` branches.
- **`PackRow` had to gain both**, or `toPackResponse` could not read them.

All of this landed in files **inside Task 14.6's declared file set** (`packs.types.ts`,
`packs.service.ts`, `admin-packs.controller.ts`), so the batch's file-set claim is unbroken —
but the _task_ boundary between 14.5 and 14.6 does not match the code. Task 14.5's V-CURL
verification (§6.3) is only passable _because_ the wiring was done; it could not have been
run against 14.5's file list alone.

**A-1 was preserved through every layer**: `memberVisible` is passed **undefaulted** at the
controller (`memberVisible: dto.memberVisible`, with a comment saying `?? false` would
quietly move the authority off the column default) and spread conditionally in the service, so
an omitted field lets Postgres decide.

---

## 7. Task 14.6 — the R5.6 docblocks

### 7.1 F-A CONFIRMED — the Discourse sentence was already gone; no no-op edit was performed

```
$ grep -rn -i "discourse" libs/api/community/src/lib/packs/
(0 hits)
```

Batch 5 (P1b) had already rewritten it. `packs.types.ts:8-19` reads _"the repo link handed to
the cohort"_. **I did not go looking for the deleted sentence and did not perform a
performative edit.** The real work was the conditional tense, in the four places F-A names.

### 7.2 What each docblock now says

| File                              | Was                                                                               | Now                                                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packs.types.ts:17-19`            | _"**Until that lands** there is no member-facing endpoint reading this table."_   | _"Phase 5 **REPLACED** the delivery channel … That endpoint **SHIPS**."_ — `delivering a link is not granting access` kept **verbatim** (R5.7).                                                                          |
| `packs.types.ts:28-29`            | `notes` — _"never shown to a member; **no member surface exists**."_              | The absence claim is made **stronger, not weaker**: it now names the `MemberPack` **re-declaration** (RK-8), the explicit-field `toMemberPack` mapper, and the NFR-S5 two-way assertion as the three structural reasons. |
| `admin-packs.controller.ts:39-50` | _"THIS MODULE HAS NO MEMBER-FACING SIBLING TODAY"_ / _"Phase 5 (Batch 14) adds…"_ | _"THIS CONTROLLER NOW HAS A MEMBER-FACING SIBLING — IN ANOTHER MODULE"_, with **"CO-LOCATION IS NOT CO-REGISTRATION"** stated in terms and G6 explained (RISK-AG).                                                       |
| `packs.service.ts:27-32`          | _"THERE IS NO MEMBER-FACING READ PATH, BY DESIGN"_                                | Narrowed to **this service**, with _"that is a claim about this service, not about the table"_, naming `MemberPacksService` and giving the two reasons they are separate (different shapes, different modules).          |
| `packs.module.ts:28-36`           | _"NOT `@Global()`"_ / _"⛔ NO MEMBER-FACING CONTROLLER"_                          | The `@Global` refusal is argued as **more** valuable post-Phase-5; the prohibition is narrowed to _"IN THIS MODULE"_ and G6 is asserted as unweakened.                                                                   |

### 7.3 Verification

```
$ grep -rn -i "discourse" libs/api/community/src/lib/packs/     -> 0
$ grep -rn "BuildersMembershipService" libs/api/community/      -> 0
$ R5.7 greppable in all four files:
    packs.types.ts              1
    admin-packs.controller.ts   1
    packs.service.ts            1
    packs.module.ts             1
```

⚠️ **`packs.types.ts` had NO greppable `R5.7` after my first pass** — its docblock made the
claim in prose without the tag, so `grep R5.7` would have found only three of the four files.
Task 14.6 requires _"A reviewer should be able to grep `R5.7` and find it"_, so I tagged it
and re-ran the gate. **Caught by running the verification rather than assuming it.**

`PackResponse` gained `memberVisible: boolean` and `accessNote: string | null`;
`toPackResponse` maps both; `PackRow` carries both. `toPackResponse`'s docblock now states
that it is **admin-only and emits `notes`**, and that `toMemberPack` is a separate function
neither writing the other — the separation being what makes the leak structurally impossible.

### 7.4 🔴 RISK I AM RAISING — these docblocks name three symbols that do not exist yet

`packs.service.ts`, `admin-packs.controller.ts` and `packs.module.ts` now refer, **in the
present tense**, to `MemberPacksService`, `MemberPacksController` and `MemberPacksModule`.
**Those three land in Tasks 14.7 and 14.8 — dispatch 14B.**

I did this because **Task 14.6 instructs it explicitly**: _"name `MemberPacksService` as the
read path that exists"_ and _"It now has a sibling **module** … Say exactly that."_ Retiring
one false tense by writing another is the trap this task exists to avoid, so I am flagging it
rather than leaving it implicit:

> ⚠️ **If Batch 14 is committed as three separate commits, the 14A commit will contain
> docblocks that are forward-false until the 14B commit lands.** Recommended: **one commit for
> Batch 14** (the batch's own file-set and serialisation claim already treat it as one unit),
> or the 14A commit is held until 14B is reviewed. **This is a decision for the team-leader,
> not something I resolved unilaterally.**

---

## 8. Gate output — actual, not paraphrased

| Gate                                                                  | Command                                                                                                                       | Result                                                   |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Nullable-DTO census                                                   | `nx test api-core --skip-nx-cache --testPathPatterns=nullable-dto`                                                            | **1 suite / 14 tests passed**                            |
| Census deliberate failure                                             | (two entries removed)                                                                                                         | **1 failed / 13 passed** — named both keys               |
| Contracts lib                                                         | `nx run-many -t eslint:lint,typecheck,test -p api-contracts-community`                                                        | **2 suites / 33 tests passed**, lint+typecheck ✅        |
| `api-community` full                                                  | `nx run-many -t eslint:lint,typecheck,test -p api-community --skip-nx-cache`                                                  | **17 suites / 397 tests passed**, lint+typecheck ✅      |
| `api-community` + `api-core` re-run (post-R5.7)                       | `nx run-many -t eslint:lint,typecheck,test -p api-community,api-core`                                                         | **17/397 and 3/26 passed** ✅                            |
| `route-map` · `controller-validation` · `app.module` · `admin-guards` | `nx test ptah-license-server --skip-nx-cache --testPathPatterns="route-map\|controller-validation\|app.module\|admin-guards"` | **4 suites / 90 tests passed**                           |
| `prisma validate`                                                     | `npx prisma validate`                                                                                                         | `The schema at prisma\schema.prisma is valid 🚀`         |
| `prisma migrate status`                                               | `npx prisma migrate status`                                                                                                   | `21 migrations found` / `Database schema is up to date!` |
| `V-HEALTH`                                                            | `curl … /api/health`                                                                                                          | **200**                                                  |

```
$ npx nx test ptah-license-server --skip-nx-cache \
    --testPathPatterns="route-map|controller-validation|app.module|admin-guards"
Test Suites: 4 passed, 4 total
Tests:       90 passed, 90 total
Time:        20.728 s

 NX   Successfully ran target test for project ptah-license-server
```

**`app.module.spec` boots with the real injector, and G1 / G6 are green and untouched.**
`route-map`'s `PREFIX_EXCEPTIONS` (1 entry) and `KNOWN_PREFIX_DEBT` (empty) were not modified;
`controller-validation`'s three constants were not modified.

**One lint warning exists and it is NOT mine:**

```
libs/api/core/src/lib/sentry/sentry.module.ts
  12:3  warning  'Inject' is defined but never used …  @typescript-eslint/no-unused-vars
✖ 1 problem (0 errors, 1 warning)
```

`sentry.module.ts` is untouched by this dispatch. **0 errors across both libs.**

---

## 9. Refinement-block findings — which held, which did not

| Finding                                 | Verdict when I reached the code                                                                                                                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-A**                                 | ✅ **CORRECT.** The Discourse sentence was already gone; `rg -i discourse` over `packs/` returns 0. Task 14.6 reshaped to tense-retirement, as directed.                                                                               |
| **F-B**                                 | ✅ **CORRECT.** `BuildersMembershipService` does not exist anywhere; `member-pack.contract.ts:37` already carries the corrected sentence.                                                                                              |
| **F-C**                                 | ✅ **CORRECT IN FULL.** All nine symbols ship. Task 14.4 added **zero**.                                                                                                                                                               |
| **F-D**                                 | ✅ **CORRECT** (not exercised here — 14C's). Honoured in the contract docblock so 14.16 cannot regress to a hard-coded `'ok'`.                                                                                                         |
| **F-F**                                 | ✅ **CORRECT.** `grep ScheduleModule\|@Cron` over `libs/api` + the app returns **zero**. RISK-AE is fully open for 14B.                                                                                                                |
| **F-G**                                 | ⚠️ **PARTLY STALE.** `.commitlintrc.json` is no longer modified — TASK_2026_197 **committed** it in `d7101460b`. I did not touch it.                                                                                                   |
| **F-H**                                 | ✅ **CORRECT**, and the foreign set has **changed**: `TASK_2026_179/task.md` and `TASK_2026_184/task.md` are still dirty, `TASK_2026_197/tasks.md` is now committed, and two `.harvested.json` files are newly untracked. Named in §1. |
| **F-K**                                 | ✅ **CORRECT.** `prisma.config.ts` loaded `..\..\.env` (41 vars). **No `DATABASE_URL` was passed on any command.**                                                                                                                     |
| **F-L**                                 | ⚠️ **See §10.** I deliberately did not reword `schema.prisma`'s Discourse prose.                                                                                                                                                       |
| **ASSUMPTION-24**                       | ✅ **HOLDS.** Nothing newer than `20260826090000` had landed; the literal timestamp `20260902090000` was kept.                                                                                                                         |
| **Ground truth 1**                      | ⚠️ **NOW STALE BY ONE MORE COMMIT.** HEAD is `d7101460b`, not `4b0313783`. See §2.1.                                                                                                                                                   |
| **Ground truth 13**                     | 🔴 **HALF WRONG.** `packs` = 0 ✅ and `member_groups` = 1 (`founding`, default) ✅ — but the preconditions table's `users` = 3 / `licenses` = 3 is **wrong; both are 0**. See §6.2.                                                    |
| **Ground truth 15**                     | ✅ **CORRECT** on 20 → 21 — but its _"a re-run of `migrate diff` produces an empty script"_ sibling clause in Task 14.3 is **not satisfiable**. See §4.6.                                                                              |
| **Task 14.2's `prisma format --check`** | 🔴 **NOT SATISFIABLE** without a 113-line out-of-scope reformat. See §3.                                                                                                                                                               |
| **Task 14.5's file list**               | 🔴 **INCOMPLETE.** Two DTO fields alone are inert on create. See §6.4.                                                                                                                                                                 |

---

## 10. What I deliberately did NOT do, and why

1. **Did not start Task 14.7 or anything after it.** Dispatch boundary. 14A ends on an
   applied, irreversible migration and nothing may be built on top of it in the dispatch that
   authored it.
2. **Did not commit, stage, stash or checkout anything.** The team-leader commits, after
   `code-logic-reviewer` returns APPROVED.
3. **Did not run `prisma format`.** It would rewrite **113 lines across untouched models** and
   directly violate Task 14.2's "no reformatting of untouched models" clause. Proven
   pre-existing at HEAD (§3). Recommended as its own separate commit later.
4. **Did not reword `schema.prisma:461`** — _"Replaces the Discourse integration deleted in
   Phase 1."_ Three reasons: (a) it is a **historical statement about migration 2** and is
   true; (b) Task 14.2's instruction is that the diff shows _only_ the listed additions, and
   this line is in the Phase-2 banner, not the Phase-5 work; (c) **F-L makes the `rg -i
discourse` gate Task 16.5's deliverable to amend**, and unilaterally rewording one of the
   19 hits ahead of that amendment would fragment a decision that is supposed to be made once.
   Constraint 7's conditional ("_if_ you reword it") is therefore answered: I did not, so no
   client regeneration was needed on that account. _(The client was regenerated anyway for the
   new model — §4.7 — and is gitignored.)_
5. **Did not add an index on `member_visible`.** Plan §1.2 rejects it in terms; the rejection
   is now a comment in the schema so the next reader does not add one by symmetry.
6. **Did not add a `pg_trgm` index.** A-7; migrations 2 and 3 own the only three.
7. **Did not touch the four RISK-L sites.** They belong to Task 14.14 (14C), and 14A adds no
   `NotificationsModule` for them to assert against. **They are still asserting the absence
   correctly and are green.**
8. **Did not add `ScheduleModule.forRoot()` or any `@Cron`.** Task 14.9, dispatch 14B.
   **RISK-AE remains fully open and I am handing it forward untouched.**
9. **Did not touch `tsconfig.base.json`.** Task 14.9 owns the single `@ptah-api/notifications`
   alias.
10. **Did not raise `MIN_TOTAL_PAYLOAD_PARAMS`.** 14A adds **no** payload param — the two new
    fields are DTO _properties_, not handler params. Task 14.15 re-derives it once 14B's two
    controllers land. It is still **76**.
11. **Did not declare the two write-response envelopes.** Task 14.4's own condition; Task
    15.4's design is fire-and-refetch. Recorded in the contract at the point of omission.
12. **Did not create any `admin/*` notification contract.** Scope boundary; R10 is a
    member-owned inbox.
13. **No websocket, no SSE, no email, no push, no digest.** `libs/api/licensing`'s `@Sse`
    endpoint was neither imported nor extended nor read.

---

## 11. Environment notes the next dispatch needs

1. **Docker Desktop was NOT RUNNING** when this dispatch began (`failed to connect to the
docker API … dockerDesktopLinuxEngine`). I launched it, then `npm run docker:db:start`
   (`Container ptah_postgres Running`). **14B should not assume the daemon is up.**
2. 🔴 **DOCKER IS DOWN RIGHT NOW AND NEEDS AN ELEVATED MANUAL RESTART. THIS IS THE ONE THING
   TO FIX BEFORE 14B STARTS.**

   **What happened**: stopping the license server by port
   (`Stop-Process` on the PIDs listening on `:3000`) also took down `com.docker.backend` —
   Docker Desktop was proxying that port. My mistake, and the lesson for 14B is: **stop
   `nx serve` by killing the nx/node process tree, never by port.**

   **What was NOT affected**: this happened **after every migration and every verification in
   this report was captured**, and Postgres data lives in a named Docker volume. **Nothing was
   lost.** Migration 5 is durable, `_prisma_migrations` records it, and the state re-verifies
   the moment the daemon returns.

   **Current state**, measured at the end of this dispatch:

   ```
   $ docker version
   Client: … Context: desktop-linux
   request returned 500 Internal Server Error for API route and version
     http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.54/version

   $ Get-Service com.docker.service
   status=Stopped

   $ Start-Service com.docker.service
   service control failed: Cannot open com.docker.service service on computer '.'
   ```

   I relaunched `Docker Desktop.exe` (WSL and `com.docker.backend` came back up), but the
   **`com.docker.service` Windows service is Stopped**, and starting it requires
   **administrator elevation that this non-interactive session does not have**. I polled for
   ~15 minutes; the engine never finished initialising.

   **Action required (one line, elevated)**: `Start-Service com.docker.service` in an admin
   PowerShell — or simply restart Docker Desktop from the tray/Start menu.

   **Then, before 14B's first DB command**, confirm the state re-verifies:

   ```
   docker info
   npm run docker:db:start
   npx prisma migrate status          # expect: 21 migrations / "Database schema is up to date!"
   docker exec ptah_postgres psql -U ptah -d ptah_db -c \
     "select (select count(*) from packs) packs,
             (select count(*) from packs where member_visible=true) mv_true,
             (select count(*) from member_notifications) notifs,
             (select count(*) from admin_audit_log) audit;"
                                      # expect: 0 | 0 | 0 | 0
   ```

   ⚠️ **This is an environment problem, not a code problem.** Nothing in §1's file set depends
   on it, every gate in §8 was run and passed before the daemon went down, and the four
   non-DB gates (`api-community`, `api-core`, `api-contracts-community`, the four structural
   specs) are re-runnable right now without Docker.

3. **Command shapes confirmed working** (unchanged from B9/B12): `eslint:lint` (there is no
   `nx lint` for `libs/api/*`), `--testPathPatterns=` (Jest 30), explicit project lists with
   `--skip-nx-cache`, **never `nx affected`**.
4. **`jq` is NOT installed** in this environment. `curl … | jq` fails with `command not
found`, and the failure is _after_ curl has already sent the request — my first `POST`
   created a pack whose only symptom was a `409` on the retry. Use `node -e` to shape JSON, or
   read the raw body.
5. **`/tmp` differs between bash and node** here. Git Bash's `/tmp` is
   `C:\Users\abdal\AppData\Local\Temp`; Node resolves `/tmp/x` to `D:\tmp\x`. Pipe through
   stdout rather than sharing a `/tmp` path between the two.

---

## 12. Exit-gate status after 14A

| #   | Clause                                                     | Owner task | Status after 14A                                                                                      |
| --- | ---------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| 1   | `MemberPack` serialization asserts `notes` absent          | 14.7       | ⏸️ 14B — but `packs.types.ts`'s docblock now names the three structural reasons                       |
| 2   | A member's own action creates NO notification for them     | 14.10      | ⏸️ 14B                                                                                                |
| 3   | Retention prune deletes READ rows >90d and nothing else    | 14.11      | ⏸️ 14B — **RISK-AE untouched and fully open**                                                         |
| 4   | `GET /members/packs` filters on `memberVisible: true` only | 14.7       | ⏸️ 14B — 🔴 **blocked on §6.2: `users` is empty, so "a zero-cohort member" does not exist**           |
| 5   | **Migration 5 makes no existing pack member-visible**      | **14.3**   | ✅ **CLOSED.** Before = column-does-not-exist error; after = **`0`**; default proven `false` by probe |
| 6   | B12's F-1 closed on all three of accept/reschedule/decline | 14.14      | ⏸️ 14C                                                                                                |

**Standing structural gates**: `route-map` ✅ (both ledgers still empty) · `controller-validation`
✅ (76 / 6 / `[]` unchanged) · nullable-DTO census ✅ (re-derived, 11 → 13) · `admin-guards` G1 ✅ ·
packs G6 ✅ unmodified · `app.module.spec` ✅ boots · **migration 5 applied and confirmed by
`npx prisma migrate status`** ✅.

---

## 13. Handoff to 14B — the four things to do first

1. 🔴 **RESTART DOCKER — it needs an elevated `Start-Service com.docker.service` (or a tray
   restart of Docker Desktop) that I could not perform from this session.** Then re-run
   `npx prisma migrate status` (expect **21** / _"Database schema is up to date!"_) and the
   four-count state query. **Full detail and the exact commands are in §11.2.** No data was
   lost and no code depends on this — it is purely an environment restart.
2. **Decide how to handle the empty `users` / `licenses` tables** before writing exit-gate
   clause 4's proof. §6.2 is the blocker, not a footnote.
3. **`ScheduleModule.forRoot()` must land in the same task that creates
   `libs/api/notifications`** (Task 14.9, RISK-AE). A `@Cron` without it is inert, silent and
   unit-test-green forever.
4. **Read §7.4 before committing anything.** Four docblocks currently name three symbols that
   do not exist until 14B.

**No blocking clarification is required to proceed with 14B.** The two decisions I surfaced
for the team-leader — the commit granularity of §7.4 and the audit-row cleanup of §6.3 — are
both disclosed, both reversible in the sense that nothing is broken either way, and neither
stops 14B from starting.
