# Batch 14B report — TASK_2026_177 Phase 5 (P5-BE, tasks 14.7 – 14.12)

**Executor**: `backend-developer`
**Date**: 2026-08-10
**Dispatch**: 14B of 3 (14A = 14.1–14.6, **14B = 14.7–14.12**, 14C = 14.13–14.17)
**Verdict**: 🟢 **ALL SIX TASKS COMPLETE. THE BOARD IS GREEN, NOT AMBER.** RISK-AE is
**closed at both ends** and proven by deliberate failure. **Nothing committed.**

**STOPPED at the dispatch boundary.** Task 14.13 was not started; no producer exists, and no
`forum` or `community` producer call site was touched.

---

## 0. Executive summary — the eight lines that matter

1. **RISK-AE is CLOSED, and the lib-level test alone would NOT have closed it.** I found and
   fixed a hole in the mitigation as written: `notification-retention.service.spec.ts` supplies
   its own `ScheduleModule.forRoot()`, so **deleting the app's registration leaves every test in
   that file green**. Measured, not reasoned about — see §5.3. It needed a second assertion, in
   `app.module.spec.ts`, and both halves are now proven by deliberate failure.
2. 🔴 **I RAN THE GATES AND ONE WAS RED, SO I CLOSED IT RATHER THAN HANDING IT ON.** Adding two
   controllers without registering them fails `controller-validation.spec.ts`'s census
   immediately. That is 14.15's file set in `tasks.md`, and PRE-2 says _"in the same commit that
   creates it"_. **I registered them.** Full reasoning and exactly what 14.15 still owns: §9.
3. **`MIN_TOTAL_PAYLOAD_PARAMS` re-derived mechanically: 76 → 77.** `Expected: >= 9999 /
Received: 77`. `NAMED_PRIMITIVE_PARAM_COUNT` **unchanged at exactly 6**; `UNVALIDATED_DEBT`
   still `[]`; both `route-map` ledgers still at their floor. §7.
4. **The empty-`users` blocker was solved the way the orchestrator directed** — a throwaway
   `users` + `License` + packs + notifications fixture, used for **eleven live proofs**, then
   torn down. The database is back at `users=0, licenses=0, packs=0, mv_true=0, notifs=0,
audit=0`. §6, §6.6.
5. 🔴 **`GET /v1/members/packs` LIVE: three packs seeded, TWO returned to a ZERO-COHORT member,
   the cohort-labelled one among them, and the admin `notes` value appears ZERO times in the
   body.** That is exit-gate clause 1 and half of clause 4, proven against Postgres rather than
   a double. §6.2.
6. **A container named `ptah_license_server` was already holding `:3000` with OLD code**, and
   `curl /api/health` returned `200` from it. I ran my build on **`:3011`** instead and stopped
   it **by PID**. Docker was never touched; both containers are still `Up (healthy)`. §6.1.
7. 🔴 **Two things in the refinement were wrong at the code.** `CronExpression.EVERY_DAY_AT_4AM`
   is `'0 04 * * *'` (five fields, not six), and Task 14.10's RISK-AH validation note asks
   `markRead` to assert `{ marked: 0 }` — a shape `markRead` does not return. §11.
8. **The concurrent session's footprint has GROWN since 14A** and now includes
   `libs/frontend/editor/**` and `.ptah/specs/TASK_2026_173/**`. Named in §1 so they are not
   staged with this batch.

---

## 1. Task-by-task status

| Task      | Title                                                          | Status                             |
| --------- | -------------------------------------------------------------- | ---------------------------------- |
| **14.7**  | `MemberPacksService` — `memberVisible` only, two absences      | ✅ COMPLETE                        |
| **14.8**  | `MemberPacksController` + `MemberPacksModule` (NEW module)     | ✅ COMPLETE                        |
| **14.9**  | `libs/api/notifications` scaffold + `ScheduleModule.forRoot()` | ✅ COMPLETE                        |
| **14.10** | `NotificationsService` — suppression, ownership, count         | ✅ COMPLETE                        |
| **14.11** | `NotificationRetentionService` — 90d, READ only, scheduled     | ✅ COMPLETE                        |
| **14.12** | `MemberNotificationsController` + DTO                          | ✅ COMPLETE                        |
| 14.13     | The forum producers                                            | ⏸️ NOT STARTED — dispatch boundary |

### Exact file set I touched — 28 new, 8 modified

**NEW — member packs (5)**

```
libs/api/community/src/lib/packs/member-packs.service.ts
libs/api/community/src/lib/packs/member-packs.service.spec.ts
libs/api/community/src/lib/packs/member-packs.controller.ts
libs/api/community/src/lib/packs/member-packs.controller.spec.ts
libs/api/community/src/lib/packs/member-packs.module.ts
```

**NEW — `libs/api/notifications` (20 files, 1 lib)**

```
libs/api/notifications/{project.json,package.json,eslint.config.mjs,jest.config.cts,
                        tsconfig.json,tsconfig.lib.json,tsconfig.spec.json,README.md}
libs/api/notifications/src/index.ts
libs/api/notifications/src/lib/notifications.module.ts            + .spec.ts
libs/api/notifications/src/lib/notifications.service.ts           + .spec.ts
libs/api/notifications/src/lib/notification-retention.service.ts  + .spec.ts
libs/api/notifications/src/lib/notification-kinds.ts              + .spec.ts
libs/api/notifications/src/lib/member-notifications.controller.ts + .spec.ts
libs/api/notifications/src/lib/dto/list-notifications.query.dto.ts
```

**MODIFIED (8)**

```
 apps/ptah-license-server/src/app/app.module.spec.ts        |  42 +++++++
 apps/ptah-license-server/src/app/app.module.ts             |  59 +++++++++
 apps/ptah-license-server/src/common/controller-validation.spec.ts | 28 ++++-
 apps/ptah-license-server/src/common/route-map.spec.ts      |  27 +++++
 apps/ptah-license-server/src/testing/controller-registry.ts|  37 +++++-
 libs/api/community/src/index.ts                            |  17 +++
 libs/api/community/src/lib/packs/packs.types.ts            | 134 ++++++++++++++++++---
 tsconfig.base.json                                         |   1 +
 8 files changed, 324 insertions(+), 21 deletions(-)
```

⚠️ `packs.types.ts`'s 134 lines are **14A's docblock rewrite plus my `toMemberPack`** — the
stat is against HEAD, not against 14A. My contribution to that file is the `MemberPack` type
import and the mapper.

🔴 **I did not run `git commit`, `git add`, `git stash`, or `git checkout`. Not once.**
🔴 **I did not touch, revert or "clean up" any of 14A's nine files** beyond adding
`toMemberPack` to `packs.types.ts`, which is Task 14.7's declared modification.
🔴 **I never ran `git add .ptah/specs`.** The only file I wrote there is this report.

### Files in the tree that are NOT mine

| File / tree                                                            | Owner                                     |
| ---------------------------------------------------------------------- | ----------------------------------------- |
| `libs/frontend/editor/**` (6 files, incl. 1 new spec)                  | 🔴 **NEW since 14A** — concurrent session |
| `.ptah/specs/TASK_2026_173/{tasks.md,.m4-run.log,batch-4-dispatch.md}` | 🔴 **NEW since 14A** — concurrent session |
| `.ptah/specs/TASK_2026_{179,184}/task.md`                              | foreign carriers (F-H)                    |
| `.ptah/specs/TASK_2026_{171,179,187,197}/.harvested.json`              | foreign, untracked                        |
| `marketing/scripts/01-open-source-announcement.md`                     | other WIP                                 |
| 14A's nine files (schema, migration, contract, DTOs, packs docblocks)  | **this batch's own 14A half**             |

⚠️ **`libs/backend/agent-sdk/.../session-query-executor.service.ts` is GONE from the dirty
list** — the concurrent session committed it. The constraint-3 exclusion list has otherwise
**grown**, not shrunk.

---

## 2. Preconditions confirmed before writing code

| #     | Confirmation                                                                                                                                                                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PRE-1 | `dto-validation.pipe.ts` read. The one payload param in this batch (`@Query(dtoPipe(ListNotificationsQueryDto))`) binds it; `MemberPacksController` has **no** payload param at all, so PRE-1 is satisfied **vacuously rather than waived** — asserted in its spec as "exactly one handler parameter". |
| PRE-2 | Both new controllers registered in `controller-registry.ts` (38 → 40). See §9 for why that landed here and not in 14.15.                                                                                                                                                                               |
| PRE-6 | No admin mutation in this batch, so no audit row and no `tx` threading of one. `NotificationsService.create` **does** accept an optional `tx` in the same shape `AuditLogService.write` does (ASSUMPTION-21).                                                                                          |
| PRE-7 | Working tree carries unrelated WIP from a concurrent session; nothing outside my file set was edited, no hook was bypassed.                                                                                                                                                                            |

**Environment re-verified before the first DB command** (the orchestrator's state, independently
reconfirmed):

```
$ npx prisma migrate status
21 migrations found in prisma/migrations
Database schema is up to date!

$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "…"
0|0|0|0|0        # packs | mv_true | notifs | users | audit
```

---

## 3. Task 14.7 — `MemberPacksService`

### 3.1 The `where` is `{ memberVisible: true }` and the assertion is EXACT

```ts
const rows = await this.prisma.pack.findMany({
  where: { memberVisible: true },
  include: COHORT_INCLUDE,
  orderBy: { title: 'asc' },
});
return rows.map((row) => toMemberPack(row));
```

The spec asserts the `where` object by `toEqual`, **not** `toMatchObject`, and the docblock
explains why: `toMatchObject` passes against `{ memberVisible: true, cohortKey: { in: [] } }`,
which is precisely the implementation that would return **nothing** for a zero-cohort member.
A second test serialises the whole `findMany` argument and asserts it contains neither
`ctx.userId` nor the strings `cohortKey` / `cohortKeys`.

### 3.2 🔴 The two absences — the control, written as source text

`CohortResolver` is `@Global()` and injectable from anywhere without a module import (ground
truth 12), so **nothing structural stops it** and only a source-text assertion can catch it.
Written the way `admin-courses.controller.spec.ts:484-504` writes it — against **import
statements and `@Inject(...)`**, never raw substrings, because the class docblock names all
three services in prose:

```
it.each: imports no CohortResolver / MembershipService / MemberGroupsService
it.each: injects no … by token
it:      imports neither module barrel that would make one reachable
it:      MemberPacksService.length === 1   (one constructor parameter)
it:      does not import ./packs.service or ./packs.module
```

**Per finding F-B, `BuildersMembershipService` does not exist and is named nowhere** — the live
symbols `MembershipService` and `MemberGroupsService` are what the assertions pin. A pattern
naming the deleted class would be permanently vacuous, which is worse than none.

### 3.3 RISK-AK — the fixture double APPLIES the `where`

`packs` holds zero rows in this workspace, so a double that ignores the `where` proves nothing.
`buildFiltering()` compares every key of the `where` by scalar equality and hands back the
matching rows. It is **not** a re-implementation of Postgres — it understands equality and
nothing else, so an implementation that added `cohortKey: { in: [] }` produces a clause it
cannot match, every row is filtered out, and the test **fails loudly**.

Three fixtures in, two out, cohort-labelled one among them. A fourth test proves the hidden
fixture differs from a visible one in **exactly** `{id, memberVisible, slug, title}` — otherwise
the filter assertion could be passing for a reason nobody chose. _(That test caught a real
defect in my first draft: my hand-written `HIDDEN` also differed in `tags`.)_

### 3.4 NFR-S5, both halves — exit-gate clause 1

```
it: does not carry `notes` as a key, for a pack whose notes is non-empty
it: the notes VALUE appears nowhere in the serialised response   <- catches a smuggled value
it: emits exactly the eight MemberPack fields, and names each forbidden admin field individually
it: the mapper is explicit, not a spread — an unknown FUTURE column cannot ride along
```

The last one is the one I added beyond the task's four: it constructs a row with a column that
does not exist yet and asserts the mapper drops it. A spread-then-delete mapper passes every
other assertion in this file and fails that one.

### 3.5 Deviation — `_ctx`, not `ctx`

Task 14.7 writes `list(ctx: MemberContext)`. `@typescript-eslint/no-unused-vars` is configured
`['warn', { argsIgnorePattern: '^_' }]`, so a plain `ctx` produces a lint warning on every run,
and **the repo already has the idiom**: `libs/api/member-hub/src/lib/sections/packs.section.ts:26`
and `notifications.section.ts:29` both take `_ctx: MemberContext`. I used `_ctx` and argued it in
the docblock. It also says the thing better than prose can: _"deliberately unread"_ is now
visible **at the signature**, not only three paragraphs above it. A spec asserts the docblock
carries `_ctx`, `DELIBERATELY UNREAD` and `A-1`, so the next reader cannot fold
`_ctx.cohortKeys` into the `where` without deleting an assertion that explains why not.

### 3.6 `COHORT_INCLUDE` re-declared rather than imported

`packs.service.ts` does not export it. Importing it would create an import edge from the member
read path into the file that owns every pack **mutation** and the audit writes — one line away
from a member service that can reach `PacksService` itself. Two four-token object literals is not
the kind of duplication DRY is about; the coupling is the hazard `MemberPacksModule` exists to
prevent. Argued in the constant's own docblock.

```
$ npx nx test api-community --skip-nx-cache --testPathPatterns=member-packs
Test Suites: 1 passed, 1 total
Tests:       21 passed, 21 total
```

---

## 4. Task 14.8 — `MemberPacksController` + `MemberPacksModule`

**A new module, in the same directory.** `MemberPacksModule` imports `IdentityModule` and
`MembershipModule`, provides `MemberPacksService`, declares one controller, is **not**
`@Global()`, and imports **nothing** from `PacksModule` in either direction.

### 4.1 Co-location is not co-registration — asserted five ways

```
it: MemberPacksModule declares exactly one controller, and it is this one
it: PacksModule does NOT declare it — the far-away failure is admin-guards G6
it: every controller still in PacksModule is mounted under v1/admin/   <- G6, restated locally
it: the two modules share no import edge in either direction
it: provides its OWN service and not PacksService
it: is NOT @Global — the member read path stays unreachable from elsewhere
it: does not re-provide MemberGuard (MembershipModule is @Global and exports it)
```

G6 is restated **inside `libs/api/community`** as well as asserted in the app, so the diagnosis
arrives in the lib that caused it rather than only in another project's suite.

### 4.2 A bare array, and no `@Query` at all

Plan §3.6 says `MemberPack[]`; plan §1.2 rejects an index on `member_visible` because the table
is _"tens of rows, always read in full"_. Paginating would contradict both. The absence of any
query parameter is also what keeps `NAMED_PRIMITIVE_PARAM_COUNT` at exactly 6, and it is pinned:
`expect(MemberPacksController.prototype.list).toHaveLength(1)`.

### 4.3 Correction I made to my own first draft

`MemberPacksModule` initially imported only `IdentityModule`. `MemberGuard` is named in
`@UseGuards`, so it must be resolvable in **this** module's injector — it happens to work in the
app because `MembershipModule` is `@Global()`, but the module would not resolve in isolation.
**`ForumModule` imports `MembershipModule` explicitly for exactly this reason** (its spec pins
the import list at five modules). I matched that. This is the Batch-3 `JwtAuthGuard` bug in a new
costume, and the reason `app.module.spec.ts` exists.

```
$ npx nx test api-community --skip-nx-cache --testPathPatterns="member-packs|packs.module"
Test Suites: 2 passed, 2 total
Tests:       36 passed, 36 total

$ npx nx test ptah-license-server --skip-nx-cache --testPathPatterns="admin-guards"
Test Suites: 1 passed, 1 total
Tests:       27 passed, 27 total      <- G1 and G6 green and UNMODIFIED
```

---

## 5. Tasks 14.9 + 14.11 — the lib, and RISK-AE

### 5.1 The scaffold, and the tag decision (RISK-F)

`api-notifications` takes **`["scope:api", "type:util"]`** — `api-membership`'s exact tag set, as
the task directs. The tag census I ran first:

```
core, identity, audit, membership, youtube  -> scope:api + type:util
forum, learning, community, member-hub      -> scope:api + type:feature
api-contracts-community                     -> scope:api-contracts + type:util
```

Every dependency this lib has (`@ptah-api/core`, `@ptah-api/identity`, `@ptah-api/membership`,
`@ptah-contracts/community`) is `type:util`, so the tag is **legal** under
`onlyDependOnLibsWithTags: ['type:util']`. It is also the **right** tag rather than merely a
legal one, and the spec says so: `type:util` **forbids this lib from ever depending on `forum`,
`learning` or `community`**. The producers depend on notifications and never the reverse, and
that direction is now enforced by lint instead of by intention. A companion test greps every
non-spec source in the lib for those four package names and asserts zero hits.

**One `tsconfig.base.json` alias added, and the file touched no further:**
`"@ptah-api/notifications": ["./libs/api/notifications/src/index.ts"]`.

`npx nx show project api-notifications` resolved only after `npx nx reset` — the Nx daemon had
cached the project graph from before the lib existed. Worth knowing; not a defect.

### 5.2 `ScheduleModule.forRoot()` landed in Task 14.9, in `app.module.ts`

Registered beside `EventEmitterModule.forRoot()`, with a 16-line comment stating that it exists
for `NotificationRetentionService`, that it is the first scheduled job in this server, that a
`@Cron` without it is inert/silent/unit-test-green forever, that it is **not** inside
`NotificationsModule` because that module is `@Global()` and a `forRoot()` there would register
the scheduler root more than once, and that the "trial-reminder cron" in this app's `CLAUDE.md`
is **not** `@nestjs/schedule` and is not a precedent.

### 5.3 🔴 THE RISK-AE PROOF — and the hole I found in the mitigation as written

The task's mitigation says: _"reflect the `SchedulerRegistry` out of a booted
`Test.createTestingModule` and assert a cron job with the job's name is registered"_, and 14.17
should then _"remove `ScheduleModule.forRoot()` and watch this one test — and only this one — go
red."_

**I built that, then tested the claim, and the claim is false as stated.**

`notification-retention.service.spec.ts` supplies its **own** `ScheduleModule.forRoot()` in its
imports — it has to, because it boots `NotificationsModule` in isolation. So the app's
registration is invisible to it:

```
# app.module.ts's ScheduleModule.forRoot() REMOVED
$ npx nx test api-notifications --skip-nx-cache --testPathPatterns=retention
Test Suites: 1 passed, 1 total
Tests:       17 passed, 17 total          <- 🔴 STILL GREEN. RISK-AE would have shipped OPEN.
```

**RISK-AE therefore needs TWO assertions, in two projects, and now has them.**

**(a) The lib half** — the decorator and the scheduler agree. Four assertions, and `.init()`
rather than `.compile()`, because `ScheduleExplorer` discovers in `onModuleInit` and
`SchedulerOrchestrator` mounts into `SchedulerRegistry` in `onApplicationBootstrap`
(verified by reading `node_modules/@nestjs/schedule/dist/{schedule.explorer,scheduler.orchestrator}.js`,
v6.1.3). A spec that stopped at `compile()` would pass against a `ScheduleModule` that was never
registered — the exact bug.

```
it: the module graph boots at all
it: 🔴 a cron job named PRUNE_JOB_NAME is in the SchedulerRegistry
it: the registered job is the ONLY cron in this module
it: 🔴 firing the registered job runs THE PRUNE, with both clauses
it: ASSUMPTION-23 — it runs DAILY at 04:00, not hourly
it: 🔴 WITHOUT ScheduleModule.forRoot() the job is registered NOWHERE
```

The last one is the **deliberate failure made permanent and automatic**: it boots the identical
graph with that one line removed and asserts the registry is empty — _and that `prune()` is
still perfectly callable_, which is exactly why a spec that only calls it stays green forever.

The `fireOnTick` assertion is made through the booted graph's **own** Prisma double rather than a
`jest.spyOn(service, 'prune')`. `SchedulerOrchestrator` binds the method reference at
registration time, so a spy applied afterwards is not what the job holds. **My first draft used
the spy and it reported a false negative** — which is the good direction, but a test written the
other way round would have reported a false **positive**. Recorded in the test's comment.

**(b) The app half** — `app.module.spec.ts` reflects `AppModule`'s `imports` metadata and asserts
a `ScheduleModule` entry (checking both the class and the `DynamicModule.module` shape). It
asserts on metadata rather than by resolving `SchedulerRegistry` because that suite deliberately
stops at `compile()`, and `init()` would fire `PrismaService.onModuleInit` → `$connect()`.

**Deliberate-failure run, both halves, actual output:**

```
# ScheduleModule.forRoot() removed from app.module.ts
$ npx nx test ptah-license-server --skip-nx-cache --testPathPatterns="app.module"
  ● AppModule — boot smoke test › registers ScheduleModule.forRoot() — the first cron in this server (RISK-AE)
Test Suites: 1 failed, 1 total
Tests:       1 failed, 2 passed, 3 total      <- EXACTLY ONE, and it names RISK-AE

$ npx nx test api-notifications --skip-nx-cache --testPathPatterns=retention
Tests:       17 passed, 17 total              <- the lib half, correctly blind to the app

# restored
$ npx nx test ptah-license-server --skip-nx-cache --testPathPatterns="app.module"
Tests:       3 passed, 3 total
```

⚠️ **`app.module.spec.ts` is not in Task 14.9's declared file list.** I added it because the
task's own risk is not otherwise closed. Disclosed here rather than buried; §9 has the full
scope accounting.

### 5.4 The prune itself — 90 days, READ rows only

`{ readAt: { not: null }, createdAt: { lt: cutoff } }`, `RETENTION_DAYS = 90` and
`PRUNE_JOB_NAME` as named constants, `now` an explicit parameter with a default, caught-and-
logged failure that returns `{ deleted: 0 }` and never throws.

The double **applies both clauses and throws on an operator it does not model**, so an
implementation that dropped the `readAt` clause deletes the unread rows and the survivor
assertions catch it. Five fixtures, one casualty, each survivor asserted individually:

| fixture                  | read? | age  | outcome                                       |
| ------------------------ | ----- | ---- | --------------------------------------------- |
| `read-ancient`           | yes   | 91 d | **deleted**                                   |
| `unread-ancient`         | no    | 91 d | survives — 🔴 the clause that matters         |
| `read-recent`            | yes   | 89 d | survives                                      |
| `unread-recent`          | no    | 89 d | survives                                      |
| `read-exactly-at-cutoff` | yes   | 90 d | survives — **the cutoff is EXCLUSIVE (`lt`)** |

The inclusive/exclusive choice is pinned and argued: at the boundary the two errors are not
symmetrical — keeping a row a day too long costs a row, deleting it a day too early loses it
forever.

```
$ npx nx test api-notifications --skip-nx-cache --testPathPatterns=retention
Test Suites: 1 passed, 1 total
Tests:       17 passed, 17 total
```

**Exit-gate clause 3 is closed.**

---

## 6. Task 14.10 + 14.12, and the LIVE verification

### 6.1 🔴 The environment surprise: `:3000` was already taken by OLD code

`curl http://localhost:3000/api/health` returned **`200`** — from a **container**:

```
$ docker ps --format '{{.Names}}\t{{.Ports}}\t{{.Status}}'
ptah_license_server   0.0.0.0:3000->3000/tcp   Up 42 minutes (healthy)
ptah_postgres         0.0.0.0:5432->5432/tcp   Up 42 minutes (healthy)
```

A `V-HEALTH` of `200` on `:3000` would have been **a false pass** — that server predates every
line of this batch. My own start attempt surfaced it as `EADDRINUSE`.

**I did not kill anything by port** (the 14A lesson). I ran the built bundle on **`PORT=3011`**,
kept its PID in a file, and stopped it with `kill $(cat …pid)`. Docker was untouched throughout —
both containers are still `Up (healthy)` at the end of this dispatch.

Two other 14A environment notes confirmed: **`jq` is still absent**, and **`/tmp` still differs
between bash and node** — my first token file was written by node to `D:\tmp` and read by bash
from `C:\Users\…\Temp`, producing three `401`s. Signed inline through stdout instead.

### 6.2 🔴 The build maps all five routes — from the real `RouterExplorer`

```
$ npx nx build ptah-license-server --skip-nx-cache      # green; @nestjs/schedule needs no external
$ PORT=3011 node -r dotenv/config dist/apps/ptah-license-server/main.cjs
[RoutesResolver]  MemberPacksController {/api/v1/members/packs}:
[RouterExplorer]  Mapped {/api/v1/members/packs, GET} route
[RoutesResolver]  MemberNotificationsController {/api/v1/members/notifications}:
[RouterExplorer]  Mapped {/api/v1/members/notifications, GET} route
[RouterExplorer]  Mapped {/api/v1/members/notifications/unread-count, GET} route
[RouterExplorer]  Mapped {/api/v1/members/notifications/:id/read, POST} route
[RouterExplorer]  Mapped {/api/v1/members/notifications/read-all, POST} route
[NestApplication] Nest application successfully started

$ curl -s -o /dev/null -w '%{http_code}' http://localhost:3011/api/health
200
```

### 6.3 The throwaway fixture (the empty-`users` blocker, solved as directed)

Three `users` (an entitled member with `first_name='Bea', last_name='Fourteen'`; an actor with
`first_name='Axel', last_name=NULL`; a **nameless, unentitled** third), one `builders` `License`,
three `packs` (visible+labelled / visible+unlabelled / hidden — all three carrying
`notes='B14B-ADMIN-ONLY-SECRET'`), and four notifications (one belonging to a **different**
member). All ids prefixed `b14b`, all torn down (§6.6).

### 6.4 🔴 LIVE PROOFS — packs

**P1 — `GET /v1/members/packs` as an ENTITLED, ZERO-COHORT member:**

```json
[{"id":"b14b_pack_labelled","slug":"b14b-labelled","title":"B14B A Labelled",
  "description":"Visible + cohort-labelled.","repoUrl":"https://github.com/x/a","tags":[],
  "cohortName":"Founding Members","accessNote":"Invite within 24h."},
 {"id":"b14b_pack_unlabelled","slug":"b14b-unlabelled","title":"B14B B Unlabelled",
  "description":"Visible + unlabelled.","repoUrl":"https://github.com/x/b","tags":[],
  "cohortName":null,"accessNote":null}]
HTTP=200
```

**Three packs in the table, TWO returned. The cohort-labelled one is among them and the member
has NO cohort assignments.** That is A-1 proven against Postgres, not against a double. The
hidden pack is absent. Exactly the eight `MemberPack` fields.

**P2 — NFR-S5 live (exit-gate clause 1):**

```
$ curl -s -b "ptah_auth=$T" …/members/packs | grep -c "B14B-ADMIN-ONLY-SECRET"
0
```

All three seeded packs carry that note. **It appears zero times in the response body.**

**P3 / P4 — the guard chain:**

```
no cookie                       -> HTTP=401
authenticated but NOT entitled  -> {"reason":"membership_required"}   HTTP=403
```

The `403` body is the exact shape `isMembershipRequiredError()` parses, so an unentitled visitor
routes to the upgrade surface rather than an error page.

### 6.5 🔴 LIVE PROOFS — notifications

**N1 — `GET /v1/members/notifications`** (four rows seeded, one owned by another member):

```json
{"items":[
 {"id":"b14b_n1","kind":"topic.reply","actorName":"Axel","targetType":"Topic","targetId":"t1",
  "title":"Axel replied to your topic","bodyPreview":"an excerpt",
  "route":"/members/community/topics/a-topic","readAt":null,"createdAt":"2026-08-10T12:45:30.041Z"},
 {"id":"b14b_n2","kind":"announcement","actorName":null,…,"route":"/members/live",…},
 {"id":"b14b_n3","kind":"post.accepted","actorName":"A member",…,"readAt":"2026-08-08T12:45:30.041Z",…}],
 "page":1,"pageSize":25,"total":3,"hasMore":false}
HTTP=200
```

Four assertions land in that one body:

- **the other member's row is absent, and `total` is 3, not 4** — the count runs under the same
  `where`, so a member never sees a total counting rows they cannot read;
- **newest first**;
- 🔴 **ASSUMPTION-22 / ground truth 3, all three cases at once**: `"Axel"` composed from
  `first_name` with a null `last_name`; `null` for the genuinely actor-less `announcement`;
  **`"A member"` for an actor who exists with both name columns null** — and **never an email**;
- **no `userId` and no `actorId` own key** anywhere in the payload (NFR-S4).

**N2 — the badge (RISK-AI):** `{"unreadCount":2}` → `HTTP=200`.

**N3 / N4 — NFR-P5 and the whitelist:**

```
?pageSize=51 -> {"message":["pageSize must not be greater than 50"],…,"statusCode":400}  HTTP=400
?authorId=me -> {"message":["property authorId should not exist"],…,"statusCode":400}    HTTP=400
```

**A `400`, not a clamp** — and the second proves `dtoPipe`'s `forbidNonWhitelisted` is live on
this parameter, which is the half that would be silently missing with a bare `@Query()`.

**N5 — 🔴 RISK-AH, ownership, live:** entitled member A `POST`s to entitled-member-C's
notification id:

```
POST …/notifications/b14b_n4/read        -> {"readAt":null}  HTTP=200
POST …/notifications/does-not-exist/read -> {"readAt":null}  HTTP=200     <- INDISTINGUISHABLE
b14b_n4 in the database afterwards       -> read_at = NULL              <- UNTOUCHED
```

No `404`, so there is no existence oracle over guessable cuids; and the other member's row is
provably still unread.

**N6 — `200` not `201`, and idempotent:**

```
POST …/b14b_n1/read (1st) -> {"readAt":"2026-08-10T12:45:57.947Z"}  HTTP=200
POST …/b14b_n1/read (2nd) -> {"readAt":"2026-08-10T12:45:57.947Z"}  HTTP=200   <- DID NOT MOVE
```

**N7 — `read-all`:**

```
unread-count before -> {"unreadCount":1}
POST read-all       -> {"marked":1}   HTTP=200
unread-count after  -> {"unreadCount":0}
POST read-all again -> {"marked":0}   HTTP=200
```

And the database afterwards shows **`b14b_n3` still carrying its ORIGINAL `2026-08-08`
timestamp** (read-all did not rewrite already-read rows) and **`b14b_n4` still unread** (it
touched exactly one member's rows).

### 6.6 Teardown, with a census proving it

```
DELETE 4   (member_notifications)
DELETE 3   (packs)
DELETE 1   (licenses)
DELETE 3   (users)

 users | licenses | packs | mv_true | notifs | audit
-------+----------+-------+---------+--------+-------
     0 |        0 |     0 |       0 |      0 |     0
```

**Byte-identical to the pre-dispatch state.** ⚠️ **`admin_audit_log` is `0` and I deleted
nothing from it** — this batch performs no admin mutation, so unlike 14A there was no audit
residue and no judgement call to make.

### 6.7 One design decision inside `list()` worth review

`kind` and `target_type` are `String` columns (Prisma has no enum for them), so the mapper must
narrow. A row outside the contract vocabulary is **skipped with a `warn` log**, not thrown on and
not cast. The argument: the client parses the whole page with `memberNotificationSchema`, whose
`z.enum` rejects the **entire response** — so emitting a bad row costs a member their whole
inbox, while skipping it costs one entry and logs why. Only `NotificationsService.create` writes
this table and its input is typed, so such a row means someone wrote SQL directly. Asserted in
the spec. **Flagged because it is a decision the task did not ask for**, taken because
TypeScript forces a choice and the alternatives were a cast (a lie) or a throw (worse).

```
$ npx nx run-many -t eslint:lint,typecheck,test -p api-notifications --skip-nx-cache
Test Suites: 5 passed, 5 total
Tests:       127 passed, 127 total
 NX   Successfully ran targets eslint:lint, typecheck, test for project api-notifications
```

---

## 7. The structural gates — actual output, and the census constants

### 7.1 The one gate that was RED, and the exact failure

Adding two controllers without registering them:

```
● … › the controller census is complete › every *.controller.ts under the controller roots
    appears in ALL_CONTROLLERS
    - "libs/api/community/src/lib/packs/member-packs.controller.ts"
    - "libs/api/notifications/src/lib/member-notifications.controller.ts"
Test Suites: 1 failed, 3 passed, 4 total
Tests:       1 failed, 90 passed, 91 total
```

**Exactly one test, naming exactly the two controllers.** `route-map` and `admin-guards` were
green throughout, because `route-map` reads `ALL_CONTROLLERS` rather than the filesystem.

### 7.2 🔴 `MIN_TOTAL_PAYLOAD_PARAMS` — re-derived mechanically, 76 → 77

Using the procedure the constant's own docblock prescribes (set to `9999`, read the actual):

```
$ npx nx test ptah-license-server --skip-nx-cache --testPathPatterns=controller-validation
    Expected: >= 9999
    Received:    77
```

**76 → 77**, and the per-controller breakdown is written into the constant so the arithmetic
closes:

| handler                                     | binding                                      | contributes |
| ------------------------------------------- | -------------------------------------------- | ----------- |
| `MemberNotificationsController.list`        | `@Query(dtoPipe(ListNotificationsQueryDto))` | **+1**      |
| `MemberNotificationsController.unreadCount` | none                                         | 0           |
| `MemberNotificationsController.markRead`    | `@Param('id')` — a PATH segment              | 0           |
| `MemberNotificationsController.markAllRead` | none                                         | 0           |
| `MemberPacksController.list`                | none — **a bare array, no pagination**       | 0           |

**+1 from two controllers and five routes**, and the zeroes are the interesting half:
`paramBindings` filters on `PARAMTYPE.BODY | QUERY`, and `MemberPacksController` contributes
nothing because plan §1.2 rejected the index that would have justified paginating it.

### 7.3 The other constants — unchanged, and that is the load-bearing half

| Constant                          | Before | After   | Note                                                           |
| --------------------------------- | ------ | ------- | -------------------------------------------------------------- |
| `NAMED_PRIMITIVE_PARAM_COUNT`     | 6      | **6**   | 🔴 EXACT equality. `page`/`pageSize` ride the DTO.             |
| `UNVALIDATED_DEBT`                | `[]`   | `[]`    | unchanged                                                      |
| `PREFIX_EXCEPTIONS` (`route-map`) | 1      | **1**   | at its floor; nothing added                                    |
| `KNOWN_PREFIX_DEBT` (`route-map`) | `[]`   | `[]`    | at its floor; nothing added                                    |
| `EXPECTED_ROUTES`                 | 132    | **137** | +5: 1 member pack + 4 member notification. **No admin route.** |
| `ALL_CONTROLLERS`                 | 38     | **40**  | PRE-2                                                          |
| `EXPECTED_NULLABLE_OPTIONALS`     | 13     | **13**  | 14B adds no nullable optional — see below                      |

`ListNotificationsQueryDto`'s two fields carry `@IsOptionalNotNull()` and neither declared type
includes `null`, so **the census correctly does not see them**. That absence is a property, not
an omission: I read the census's analysis before writing the DTO to confirm it.

### 7.4 Final gate output

```
$ npx nx test ptah-license-server --skip-nx-cache \
    --testPathPatterns="route-map|controller-validation|admin-guards|app.module|controller-registry"
Test Suites: 4 passed, 4 total
Tests:       93 passed, 93 total

$ npx nx test ptah-license-server --skip-nx-cache          # the WHOLE suite
Test Suites: 5 passed, 5 total
Tests:       158 passed, 158 total

$ npx nx run ptah-license-server:eslint:lint --skip-nx-cache
 NX   Successfully ran target eslint:lint for project ptah-license-server

$ npx nx test api-core --skip-nx-cache --testPathPatterns=nullable-dto
Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total

$ npx nx run-many -t eslint:lint,typecheck,test \
    -p api-notifications,api-community,api-core,api-contracts-community --skip-nx-cache
 NX   Successfully ran targets eslint:lint, typecheck, test for 4 projects

    api-notifications        5 suites / 127 tests
    api-community           21 suites / 500 tests   (19/433 at HEAD -> +2 suites, +67 tests)
    api-core                 3 suites /  26 tests
    api-contracts-community  2 suites /  33 tests

$ npx nx run-many -t test -p api-forum,api-learning --skip-nx-cache
    api-forum               20 suites / 481 tests    (RISK-L specs untouched and GREEN)
    api-learning            … green

$ npx nx build ptah-license-server --skip-nx-cache
 NX   Successfully ran target build

$ npx prisma migrate status
21 migrations found in prisma/migrations
Database schema is up to date!
```

**The only lint warning in the whole run is the pre-existing one 14A already reported**
(`libs/api/core/src/lib/sentry/sentry.module.ts:12 'Inject' is defined but never used`), in a
file neither dispatch has touched. **0 errors everywhere.**

⚠️ **The four RISK-L specs are green and untouched.** Registering `NotificationsModule` in
`app.module.ts` does **not** break them: each asserts its own feature module's metadata, not the
app's. `forum.module.spec.ts`'s "imports the five modules that DO exist" and
`live-sessions.module.spec.ts`'s "exactly the six modules" are both still true. **Task 14.14's
rewrite is still needed and is still 14C's** — it becomes necessary when the producers add the
import, not when the app registers the module.

---

## 8. What I deliberately did NOT do, and why

1. **Did not start Task 14.13 or anything after it.** No producer exists. No `forum` or
   `community` producer call site was opened, let alone edited. `PostsService.createReply` and
   `SessionRequestsService.{accept,reschedule,decline}` are untouched.
2. **Did not commit, stage, stash or checkout anything.**
3. **Did not write an `announcement` producer** (ASSUMPTION-20). The kind is in the enum, the
   service accepts it, `buildNotificationRoute('LiveSession')` resolves it, the exhaustive
   round-trip test covers it, and **nothing writes it**. Four of five kinds have producers — and
   those four are 14C's.
4. **Did not touch the four RISK-L sites.** Task 14.14, and they are correctly still asserting
   the absence.
5. **No websocket, no SSE, no email, no push, no digest.** `libs/api/licensing`'s `@Sse`
   endpoint was neither imported, extended nor read. Asserted structurally, **against the
   decorator application and the import list rather than raw text** — my first draft used
   `not.toMatch(/@Sse\b/)` and it failed on the docblock that explains why `@Sse` is absent,
   which is the G6 idiom's whole lesson relearned.
6. **No notification preferences, mute settings or per-kind opt-out. No admin surface.**
7. **Did not declare the two write-response envelopes in the contracts lib.** 14A's decision
   (fire-and-refetch); the handlers return the shapes, nothing parses them.
8. **Did not add `libs/api/notifications/src/lib/common/`.** ASSUMPTION-19, and a spec asserts
   the directory does not exist and that the lib's only subdirectory is `dto`.
9. **Did not copy `toPaged`.** One paged read in the lib; the five-line envelope is built inline
   at its single call site rather than becoming a fourth `common/pagination.ts`.
10. **Did not run `prisma format`, did not touch `schema.prisma`, did not create a migration.**
    Migration 5 is 14A's and is applied; this dispatch adds no column.
11. **Did not add `'notifications'` to `LIBS_WITH_DTOS`.** Task 14.15's, and — as that task
    says — the per-lib reach assertion is **one-directional**, so a lib not listed does not
    fail. It is a coverage strengthening, not a build fix, and it belongs with the batch that
    can state that in its own report.
12. **Did not kill anything by port.** §6.1.
13. **Did not stop, restart or reconfigure the `ptah_license_server` container** that is holding
    `:3000` with pre-Phase-5 code. It is not mine and stopping it is an environment decision, not
    a code one. **Flagged in §12 — anyone curling `:3000` right now is testing old code.**

---

## 9. 🔴 SCOPE: the three registry files, and exactly what 14.15 still owns

**The dispatch's task scope (14.7–14.12) and its verification protocol disagreed, and I had to
resolve it.** The protocol asks me to report `route-map.spec.ts` _(both ledgers still empty)_ and
`controller-validation.spec.ts` _(`MIN_TOTAL_PAYLOAD_PARAMS` **re-derived and raised from 76**)_ —
neither of which is meaningful unless the two new controllers are registered. `tasks.md` assigns
those files to Task 14.15, whose dependency is 14.14.

**I registered them.** Three reasons, in order of weight:

1. **PRE-2 is a precondition on _me_** — _"every new controller is added to
   `controller-registry.ts` **in the same commit that creates it**"_, applying to _"every backend
   batch with a controller"_. Batch 14 is one commit either way, but the batch that creates a
   controller is the batch that owes the registration.
2. **The alternative is handing `code-logic-reviewer` a red board.** §7.1 is a real failing test,
   not a cosmetic one.
3. **`MIN_TOTAL_PAYLOAD_PARAMS` is a FLOOR and only fails downward** (RISK-AL). Leaving it at 76
   passes and is wrong, and the measurement is only available to the batch that added the params.

I also registered **`MemberPacksModule` in `app.module.ts`** — without it the controller exists,
compiles, is censused, and **404s**. Shipping a controller that does not serve is not a smaller
scope, it is an incomplete feature.

**What Task 14.15 still owns, unchanged:**

- `libs/api/core/src/lib/common/nullable-dto.spec.ts` — add `'notifications'` to
  `LIBS_WITH_DTOS`. One-directional; a deliberate strengthening.
- `libs/api/audit/src/lib/audit-log.types.ts` — **expected diff: ZERO**, and I can now confirm
  it rather than predict it: this batch writes no audit row and adds no admin mutation. The pack
  `memberVisible` toggle rides the existing `PATCH /admin/packs/:id` action (14A proved it live).
- Any registry work the **producers** (14.13/14.14) turn out to need.

**If the team-leader disagrees with this call, nothing needs undoing** — the registry entries are
correct for the controllers that exist, and 14.15 would have written the same lines.

---

## 10. Exit-gate status after 14B

| #   | Clause                                                     | Owner | Status                                                                                                                     |
| --- | ---------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | `MemberPack` serialization asserts `notes` absent          | 14.7  | ✅ **CLOSED.** Unit (both halves + a future-column probe) **and live**: 0 occurrences                                      |
| 2   | A member's own action creates NO notification for them     | 14.10 | ⚠️ **HALF CLOSED.** Asserted directly on `create()` four ways. **The producer-path half is 14.13's**, and the task says so |
| 3   | Retention prune deletes READ rows >90d and nothing else    | 14.11 | ✅ **CLOSED.** 5 fixtures / 1 casualty / 4 survivors + **RISK-AE proven at both ends**                                     |
| 4   | `GET /members/packs` filters on `memberVisible: true` only | 14.7  | ✅ **CLOSED.** 3 seeded → 2 returned to a **zero-cohort member**, live, against Postgres                                   |
| 5   | Migration 5 makes no existing pack member-visible          | 14.3  | ✅ CLOSED (14A)                                                                                                            |
| 6   | B12's F-1 closed on all three of accept/reschedule/decline | 14.14 | ⏸️ 14C                                                                                                                     |

**Clause 4 was 14C's per the plan. It is closed now** — the throwaway fixture the orchestrator
authorised made the member path available a batch early. 14.17 should still run its own
three-pack proof; this one is evidence, not a substitute for the exit gate's own run.

**Standing structural gates**: `route-map` ✅ (137 routes, both ledgers at their floor) ·
`controller-validation` ✅ (77 / 6 / `[]`) · nullable-DTO census ✅ (13, unchanged) ·
`admin-guards` G1 ✅ · packs **G6 ✅ green and byte-unmodified** · `app.module.spec` ✅ boots,
**plus the new RISK-AE assertion** · `prisma migrate status` ✅ 21 / up to date.

---

## 11. What turned out wrong when I reached the code

| Source                         | Verdict                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RISK-AE's mitigation**       | 🔴 **INCOMPLETE AS WRITTEN.** The lib-level `SchedulerRegistry` assertion cannot see the app's registration, so 14.17's _"remove it and watch this one test go red"_ would have watched **nothing** go red. Proven by measurement; fixed with a second assertion. §5.3.                                                                                                                 |
| **ASSUMPTION-23**              | ⚠️ `CronExpression.EVERY_DAY_AT_4AM` is **`'0 04 * * *'` — FIVE fields**, not the six-field form much of `@nestjs/schedule`'s vocabulary uses. My first assertion used `'0 0 4 * * *'` and failed. Pinned as a literal with a comment so an "obvious" edit to a six-field string that parses as something else is caught here, not at 4am.                                              |
| **Task 14.10 validation note** | 🔴 **WRONG SHAPE.** It says the RISK-AH spec _"drives identity B against identity A's notification id and asserts `{ marked: 0 }`"_. `markRead` returns `{ readAt }`; `{ marked }` is `markAllRead`'s. I asserted the **correct** property for each: `markRead` → `{ readAt: null }` **and A's row still unread**; `markAllRead` by a non-owner → `{ marked: 0 }`. Both, unit and live. |
| **Task 14.7's `ctx` param**    | ⚠️ Adjusted to `_ctx` — lint warning otherwise, and the repo's own idiom. §3.5.                                                                                                                                                                                                                                                                                                         |
| **Task 14.8's module imports** | ⚠️ `MembershipModule` had to be imported as well as `IdentityModule`, or the module does not resolve in isolation. `ForumModule` sets the precedent. §4.3.                                                                                                                                                                                                                              |
| **Ground truth 13**            | ✅ **CORRECT, and 14A's correction to it also holds.** `packs` = 0, `member_groups` = 1 (`founding`). `users`/`licenses` were still **0**, as 14A found and the plan does not say.                                                                                                                                                                                                      |
| **Ground truth 8 / F-F**       | ✅ **CORRECT.** `grep ScheduleModule\|@Cron` over `libs/api` + the app returned zero before this batch. Mine is the first.                                                                                                                                                                                                                                                              |
| **Ground truth 11 (RI-1)**     | ✅ **CORRECT.** Both new prefixes are segment-wise disjoint from all nine existing member prefixes and from each other; neither ledger gained an entry.                                                                                                                                                                                                                                 |
| **Ground truth 12**            | ✅ **CORRECT.** `CohortResolver` is `@Global()` and injectable from anywhere — which is why §3.2's assertion is a control rather than decoration.                                                                                                                                                                                                                                       |
| **Ground truth 3**             | ✅ **CORRECT and proven LIVE.** `User` has `firstName`/`lastName` and no `name`; all three actorName cases appeared in one response body. §6.5.                                                                                                                                                                                                                                         |
| **F-E / RISK-AG**              | ✅ **CORRECT.** G6 reads `controllersOf(PacksModule)`; a member controller there fails it. A separate module keeps it green and unmodified.                                                                                                                                                                                                                                             |
| **F-B**                        | ✅ **CORRECT.** `BuildersMembershipService` does not exist; `MembershipService` and `MemberGroupsService` are what the absence assertions pin.                                                                                                                                                                                                                                          |
| **14A §11.2 (Docker down)**    | ✅ **RESOLVED before I started** — 21 migrations, schema up to date, engine healthy. No elevated command was needed from me.                                                                                                                                                                                                                                                            |
| **14A §11.4 / §11.5**          | ✅ **BOTH STILL TRUE.** `jq` absent; `/tmp` differs between bash and node (it cost me three `401`s). §6.1.                                                                                                                                                                                                                                                                              |
| **`nx show project`**          | ⚠️ Returned _"Could not find project"_ for a brand-new lib until `npx nx reset`. Daemon cache, not a scaffold defect. Worth knowing for 14C if it adds a lib (it does not).                                                                                                                                                                                                             |

---

## 12. Handoff to 14C — five things

1. 🔴 **A `ptah_license_server` CONTAINER IS RUNNING ON `:3000` WITH PRE-PHASE-5 CODE, AND
   `curl :3000/api/health` RETURNS `200` FROM IT.** Any live verification against `:3000` is a
   **false pass**. Either `docker stop ptah_license_server` first (an environment decision I did
   not take on someone else's behalf), or serve on another port as I did. **Never free the port
   by killing the process listening on it** — Docker Desktop proxies it, and that is what took
   the daemon down during 14A.
2. **The three registry files are already done for 14B's two controllers** (§9). Task 14.15's
   remaining work is `LIBS_WITH_DTOS += 'notifications'`, confirming the audit-vocabulary diff is
   zero (**it is**), plus whatever the producers need. `MIN_TOTAL_PAYLOAD_PARAMS` is **77** — if
   14C adds a payload param, re-derive again from `9999`.
3. **Task 14.14's four RISK-L rewrites are still necessary and still untouched.** Registering
   `NotificationsModule` in `app.module.ts` did not break them; adding the import to
   `ForumModule` / `LearningModule` / `LiveSessionsModule` will, by design.
4. **The producers' contract with `NotificationsService.create` is: pass `actorId` and NEVER
   pre-check it against `recipientId`.** The suppression exists exactly once, and
   `notifications.service.spec.ts` asserts by regex that the equality appears **once** in the
   whole service. RISK-AF's de-duplicated recipient set is 14.13's and is not addressed here.
   Every producer must build its `route` through `buildNotificationRoute` — it **throws** on a
   missing `topicSlug`/`postId` rather than storing a permanent 404.
5. **`users` and `licenses` are EMPTY again.** The fixture is torn down. 14C's exit-gate clause 4
   and the producer proofs need the same throwaway seed; §6.3's shape works and the teardown is a
   four-statement `DELETE … WHERE id LIKE 'b14b_%'` census.

**No blocking clarification is required to proceed with 14C.** The one decision I surfaced for
the team-leader — the registry scope of §9 — is disclosed, is correct for the controllers that
exist either way, and stops nothing.
