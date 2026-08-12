# Batch 14C report — TASK_2026_177 Phase 5 (P5-BE, tasks 14.13 – 14.17)

**Executor**: `backend-developer`
**Date**: 2026-08-10
**Dispatch**: 14C of 3 (14A = 14.1–14.6, 14B = 14.7–14.12, **14C = 14.13–14.17**)
**Verdict**: 🟢 **ALL FIVE TASKS COMPLETE. THE EXIT GATE IS CLOSED ON ALL SIX CLAUSES.**
**B12's F-1 IS CLOSED**, server-side, on all three methods, and proven by a deliberate failure
that a status-only assertion would have passed. **Nothing committed.**

---

## 0. Executive summary — the nine lines that matter

1. 🔴 **B12's F-1 IS CLOSED AND I PROVED THE CLOSURE IS NOT COSMETIC.** All three of
   `accept` / `reschedule` / `decline` are driven server-side with an `isEnabled() === false`
   double, asserting `503`, the reason constant, **no write on ANY of seven verbs**, and no
   notification. The deliberate-failure proof is the important half: I made `decline` still
   return `503 { scheduling_unavailable }` **and write the row first** — B13's `page.route()`
   stub and any status-only test stay green, and **exactly one assertion goes red**. §4.
2. 🔴 **EXIT-GATE CLAUSE 2 IS CLOSED LIVE, THROUGH THE REAL PATH.** Member A `POST`ed a reply
   to her own topic against the running server: `HTTP 201`, and her unread count did **not**
   move (1 → 1), with `member_notifications` still holding exactly one row. §7.4.
3. 🔴 **RISK-AF IS CLOSED LIVE TOO.** Two real reply events; the one where the topic author IS
   the parent post's author produced **ONE** row (`post.child_reply`), not two. A naive producer
   yields three rows total; the database held two. §7.5.
4. 🔴 **I FOUND A DIRECT CONFLICT BETWEEN 14B's CODE AND TASK 14.16, AND I RESOLVED IT AGAINST
   14B.** `member-packs.module.ts` and `libs/api/community/src/index.ts` both stated that the hub
   would **not** inject `MemberPacksService`. Task 14.16 says it will. I followed the task and
   corrected both docblocks in place, disclosed. The deciding argument is exit-gate clause 1:
   `toMemberPack` is the NFR-S5 chokepoint, and a hub resolver with its own query needs its own
   mapper — giving `notes` two escape routes instead of none. §6.1.
5. 🔴 **F-D HONOURED: THE HUB SECTIONS ARE DATA-DEPENDENT AND I PROVED THE FLIP LIVE.** Same
   five-section envelope, `packs` moving `'empty'` → `'ok'` as `member_visible` was toggled, and
   `notifications` moving `'empty'` → `'ok'` when a real reply landed. A resolver pinned to
   `'ok'` fails two of my assertions — proven by mutation. §6.2, §7.3.
6. **THE FOUR RISK-L SITES WERE REWRITTEN, NOT DELETED — AND NO MODULE GAINED AN IMPORT.**
   `NotificationsModule` is `@Global()`, so all three "imports exactly N modules" counts survive
   **unchanged**. The repo made this exact argument before Phase 5 existed:
   `live-sessions.module.spec.ts:94` asserts `LiveSessionsModule` does not import
   `GoogleSessionsModule` although `LiveFeedService` reads it. §5.
7. **`MIN_TOTAL_PAYLOAD_PARAMS` RE-DERIVED FROM `9999`: still `77`.** 14C adds no controller and
   no payload param. `NAMED_PRIMITIVE_PARAM_COUNT` exactly `6`, `UNVALIDATED_DEBT` `[]`, both
   `route-map` ledgers at their floor, `EXPECTED_ROUTES` unchanged. §8.
8. **Six deliberate-failure proofs, every one reverted and `diff`-confirmed byte-identical.**
   Four are the task's; two are mine (F-1's write clause, F-D's pinned status). §9.
9. 🔴 **HEAD MOVED TWICE MORE DURING THIS DISPATCH AND THE FOREIGN FOOTPRINT NOW INCLUDES
   `libs/shared/src/index.ts`.** Re-derived at the end, not the start. §1.2.

---

## 1. Task-by-task status and the exact file set

| Task      | Title                                                               | Status      |
| --------- | ------------------------------------------------------------------- | ----------- |
| **14.13** | The forum producers — three kinds, one call site, one recipient set | ✅ COMPLETE |
| **14.14** | `session_request.status`, the four RISK-L rewrites, **B12's F-1**   | ✅ COMPLETE |
| **14.15** | The registries, the census constants, the DTO census reach          | ✅ COMPLETE |
| **14.16** | The two hub sections — read the table, derive the status            | ✅ COMPLETE |
| **14.17** | Live verification, deliberate-failure proofs, the exit gate         | ✅ COMPLETE |

### 1.1 14C's file set — 23 modified, 2 new, plus one edit to a 14B file

```
 apps/ptah-license-server/src/app/app.module.ts                      |  85 +++-
 libs/api/community/src/index.ts                                     |  29 ++
 .../google-sessions/google-sessions.module.ts                       |  31 +-
 .../google-sessions/session-requests.service.ts                     | 178 +++++++-
 .../google-sessions/session-requests.service.spec.ts                | 387 ++++++++++++++++
 .../live-sessions/live-sessions.module.ts                           |  32 +-
 .../live-sessions/live-sessions.module.spec.ts                      |  41 +-
 libs/api/core/src/lib/common/nullable-dto.spec.ts                   |  39 +-
 libs/api/forum/src/lib/forum.module.ts                              |  43 +-
 libs/api/forum/src/lib/forum.module.spec.ts                         |  75 +++-
 libs/api/forum/src/lib/posts/posts.service.ts                       | 266 +++++++++++-
 libs/api/forum/src/lib/posts/posts.service.spec.ts                  | 461 +++++++++++++++++-
 libs/api/forum/src/lib/posts/accepted-answer.service.ts             |  86 +++-
 libs/api/forum/src/lib/posts/accepted-answer.service.spec.ts        | 121 +++++-
 libs/api/forum/src/lib/posts/admin-community-posts.controller.spec.ts |  15 +-
 libs/api/learning/src/lib/learning.module.ts                        |  36 +-
 libs/api/learning/src/lib/learning.module.spec.ts                   |  66 ++-
 libs/api/member-hub/src/lib/member-hub.module.ts                    |  36 +-
 libs/api/member-hub/src/lib/sections/packs.section.ts               |  65 ++-
 libs/api/member-hub/src/lib/sections/notifications.section.ts       |  78 +++-
 libs/api/member-hub/src/lib/sections/community.section.spec.ts      |  11 +-
 libs/api/member-hub/src/lib/sections/empty-sections.section.spec.ts |  59 ++-
 libs/api/member-hub/src/lib/sections/learning.section.spec.ts       |   9 +-
 23 files changed, 2062 insertions(+), 187 deletions(-)
```

**NEW (2)** — Task 14.16's two never-before-tested sections:

```
libs/api/member-hub/src/lib/sections/packs.section.spec.ts          (6,788 B)
libs/api/member-hub/src/lib/sections/notifications.section.spec.ts  (6,473 B)
```

**ONE EDIT TO A 14B FILE**, disclosed rather than buried:
`libs/api/community/src/lib/packs/member-packs.module.ts` — added `exports: [MemberPacksService]`
and corrected one docblock paragraph. Full reasoning in §6.1. It is 14B's untracked file, so it
shows no diffstat line.

🔴 **I did not run `git commit`, `git add`, `git add -A`, `git stash`, or `git checkout`. Not
once.** `git reflog` confirms: the only two entries in this window are the concurrent session's
own commits.
🔴 **I never ran `git add .ptah/specs`.** The only file I wrote there is this report.
🔴 **I did not revert, rewrite or tidy 14A's nine files or 14B's thirty-six**, with the single
disclosed exception above and the fixture widenings §3.5 lists.

### 1.2 🔴 The foreign footprint, RE-DERIVED AT THE END — it grew twice more

**HEAD moved from `d7101460b` → `0e10b822e` → `06b900d85` during this dispatch.** Two further
commits from the concurrent session (`docs(docs): correct four stale task carriers`,
`perf(editor): make dir change dots O(1)…`). Neither touches `libs/api/**`,
`libs/api-contracts/**` or `apps/ptah-license-server/**`.

| File / tree                                                                   | Owner                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------ |
| 🔴 `libs/shared/src/index.ts`                                                 | 🔴 **NEW since 14B — concurrent session**  |
| 🔴 `libs/shared/src/lib/constants/workspace-scan.constants.{ts,spec.ts}`      | 🔴 **NEW, untracked — concurrent session** |
| 🔴 `apps/ptah-electron/src/services/git-watcher.service.{ts,spec.ts}`         | 🔴 **NEW since 14B**                       |
| 🔴 `apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts`      | 🔴 **NEW since 14B**                       |
| 🔴 `apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.script.mjs` | 🔴 **NEW since 14B**                       |
| `.ptah/specs/TASK_2026_173/{tasks.md, batch-5-dispatch.md}`                   | concurrent session                         |
| `.ptah/specs/TASK_2026_{179,184}/task.md`                                     | foreign carriers (F-H)                     |
| `.ptah/specs/TASK_2026_{171,179,187,197}/.harvested.json`                     | foreign, untracked                         |
| `marketing/scripts/01-open-source-announcement.md`                            | other WIP                                  |

⚠️ **`libs/frontend/editor/**`has LEFT the dirty list** — committed in`06b900d85`. ⚠️
**`libs/shared/src/index.ts`has JOINED it, and`libs/shared`is a cross-side barrel.** Batch 14
does not touch`libs/shared` at all, so there is no overlap — but it is the most dangerous file
on this list to stage by accident.

---

## 2. Preconditions and the architecture call

| #     | Confirmation                                                                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| PRE-1 | **Vacuous and verified so.** 14C adds no controller and no payload param — re-derived mechanically in §8.2, not assumed.               |
| PRE-2 | **Nothing owed.** 14B registered both controllers (its §9); I verified the census is green and did not touch `controller-registry.ts`. |
| PRE-6 | **No admin mutation, no audit row.** Confirmed by grep, not predicted — see §8.4. `audit-log.types.ts` diff is **ZERO**.               |
| PRE-7 | Working tree carries a GROWN foreign footprint (§1.2). Nothing outside my file set was edited; no hook bypassed.                       |

**Architecture assessment — Level 2 (SOLID + DRY), not 3 or 4.** Four producers writing one row
each through one existing service. The one genuinely non-trivial piece is the de-duplicated
recipient set, and it is a fifteen-line pure function (`resolveReplyRecipients`) rather than a
strategy hierarchy. No new lib, no new module, no new abstraction. The only pattern I reached for
is "resolve the set before writing", which RISK-AF names in terms.

---

## 3. Task 14.13 — the forum producers

### 3.1 🔴 RISK-AF, in one function, with the mechanism stated

`PostsService.createReply` is the only reply path — there is no `createChildReply` — so it
produces both `topic.reply` and `post.child_reply`. `resolveReplyRecipients` keys a `Map` by
**recipient id**:

- the topic's author earns `topic.reply`;
- the repaired parent's author earns `post.child_reply`, written **second**;
- on a collision `Map.set` **replaces**, so the more specific kind wins.

That ordering IS the de-duplication, so the docblock says so rather than leaving it to be
inferred from line order — and a spec asserts the specific kind wins, which is what goes red if
the two `set` calls are swapped.

🔴 **The actor is NOT filtered here.** R10.2 lives in `create()`. A pre-check would be a second
copy of the rule _and_ would change what the de-duplication means: with the actor removed early,
"the two authors are the same person" and "the topic author is the actor" collapse into one
branch. The spec asserts this against the **source**, scoped to `createReply` and to the resolver
— my first draft scanned the whole file and flagged `updateByAuthor`'s legitimate
`post.authorId !== ctx.userId` authorship check, which is precisely the kind of over-broad
assertion that gets deleted the first time it fires.

### 3.2 🔴 The depth repair changes the recipient, and it cost a design decision

Task 14.13: _"The notification must follow the REPAIRED parent, not the requested one."_
`resolveParentId` returned a bare `string`, so I widened it to `resolveParent` returning
`{ id, authorId }`.

**The obvious implementation was wrong and a pre-existing test caught it.** A nested
`select: { parent: { … } }` would fetch the grandparent's author in the first query — but AD-5's
**RULE-NESTED** requires a relation read reaching a soft-deletable model to carry `NOT_DELETED`,
and a nested `parent` select cannot. So the repair path issues a second filtered `findFirst`.

🔴 **And that second read supplies the AUTHOR ONLY.** My first version returned the row's `id`,
which the RK-12 fixtures exposed immediately: those specs use `mockResolvedValue` (not `Once`),
so the second call returned the same object and the repair silently re-pointed to the **wrong**
post. The mock artefact revealed a real fragility — a query that exists to answer a notification
question had acquired the power to move a post. The repaired id is now
`parentPost.parentId`, returned verbatim.

⚠️ **A repaired parent that is a TOMBSTONE yields `authorId: null`, so nobody is notified while
the reply still attaches to it.** R1.3.5 keeps the tombstone in the tree so children are not
orphaned; telling a member "someone replied to your post" about a post they cannot read is a
different matter. Asserted.

### 3.3 Titles carry no name, and that is a decision the task did not ask for

`'New reply to your topic'` / `'New reply to your post'` / `'Your answer was accepted'` — none
interpolates the actor. `title` is frozen in the row; `actorName` is composed at **read** time
from the actor relation. Interpolating a name would (a) freeze another member's identity into a
column nobody re-reads, which is exactly what NFR-S4 keeps off member responses, and (b) go stale
independently of the live `actorName` beside it. **Flagged because 14B's hand-seeded live fixture
used `"Axel replied to your topic"`** — the contract carries both fields, and the client composes
the sentence.

### 3.4 `AcceptedAnswerService.accept` gained a transaction, and R1.5.2 is unweakened

There was no `$transaction` to enlist in, so ASSUMPTION-21's default made me add one. **This is
the change most likely to look like a regression, so it is asserted directly**: still exactly one
`topic.update`, still zero `updateMany`, still no compensating "clear the previous one" step —
the shape R1.5.2's docblock rejects because it has a state in which two posts are accepted.

### 3.5 Fixture widenings to pre-existing specs — disclosed

`createReply` and `requireVisibleTopic` now select `authorId`/`slug`, so five pre-existing local
mock overrides needed those keys. Each is a one-line fixture widening with a comment, in
`posts.service.spec.ts` (the AD-11 world model) and `accepted-answer.service.spec.ts` (two
tests). `admin-community-posts.controller.spec.ts` gained a constructor double. **No assertion
was weakened or removed.**

```
$ npx nx test api-forum --skip-nx-cache
Test Suites: 21 passed, 21 total
Tests:       531 passed, 531 total
```

---

## 4. 🔴 Task 14.14 — B12's F-1, and the two things that make the closure real

### 4.1 The closure

`session-requests.service.spec.ts` gained a describe block that drives **all three** methods
against a `GoogleCalendarProvider` double whose `isEnabled()` returns `false`, asserting per
method:

1. `reason: SCHEDULING_UNAVAILABLE` — **the exported constant**, not a hand-typed literal;
2. `status: 503`;
3. 🔴 **the DB row is untouched — over EVERY write verb**;
4. no notification was created;
5. and nothing was said to Google either.

```
$ npx nx test api-community --skip-nx-cache --testPathPatterns="session-requests"
Test Suites: 1 passed, 1 total
Tests:       48 passed, 48 total
```

### 4.2 🔴 Clause 3 is asserted over SEVEN verbs, and that is the difference

`expect(update).not.toHaveBeenCalled()` is the assertion a reader reaches for, and it is nearly
worthless here: **`accept`'s real write is an `updateMany`.** `writesAttempted()` filters
`create | createMany | update | updateMany | upsert | delete | deleteMany` and asserts `[]`, plus
`$transaction` never called.

### 4.3 🔴 THE PROOF THAT THE CLOSURE IS NOT COSMETIC

I mutated `decline` so it **still returns `503 { scheduling_unavailable }`** and writes the row
first:

```
MUTATED: decline still returns 503 { scheduling_unavailable } — but writes the row first

  ● SessionRequestsService › 🔴 B12's F-1 — the 503 branch, SERVER-SIDE, on all three methods
      › decline — 503 { reason: scheduling_unavailable }, DB row UNTOUCHED, no notification
    - Expected  - 1
    + Received  + 3
    - Array []
Tests:       1 failed, 47 passed, 48 total
=== RESTORED === BYTE-IDENTICAL
```

**Exactly one test.** B13's `page.route()` stub would have passed this mutation. A status-only
server test would have passed it. Only the clause B12 actually asked for catches it. **F-1 is
closed, and this is the evidence.**

### 4.4 🔴 `decline`'s third branch — the one B12 named only `accept` for

`decline`'s guard is nested inside `if (request.calendarEventId !== null)`, **after**
`requireOpen`. A fixture without an event id takes the happy path and **succeeds** — so a test
written carelessly would pass having proved the opposite of its name. The fixture carries
`calendarEventId`, and a **control** asserts that declining a _pending_ request still works with
Google off, because `decline`'s docblock promises an admin can run the queue with the integration
unconfigured.

### 4.5 The producer, and the two decisions in it

🔴 **`actorId` is `null` on all three.** None of the three signatures carries the acting admin's
id — it reaches only the `AuditHook`. Threading it into a member-facing row would put a staff
member's name on `actorName`, which is the class of identity NFR-S4 excludes. `null` renders the
contract's system-generated case.

⚠️ **The consequence, stated rather than hidden**: an admin who requests a session for themselves
and accepts it receives a notification for their own action, because R10.2 compares against a
`null` actor. That is a real gap; the alternative puts a staff identity on every member's
notification to close a case requiring an admin to be their own requester.

🔴 **`accept` does not enlist, and I made that STRUCTURAL rather than conventional.** A
notification inside `accept`'s `try` reaches the RISK-U compensating `deleteEvent` — a failed
notification would **delete a real Calendar event the member is already invited to**. My first
version put the call inside the `try` and relied on `notifyOwner` never throwing. I hoisted `row`
out of the `try` so the notify call is outside the compensation window **by scope**, and asserted
it: a failing notification leaves `deleteEvent` uncalled and the row written.

`reschedule` and `decline` both enlist and roll back on failure; `decline` carries
`declineReason` into `bodyPreview` (R4.8 — already member-visible, so this delivers it sooner,
not newly).

🔴 **`cancelOwn` and `submit` produce NOTHING, and both are asserted.** `create()` would suppress
`cancelOwn` anyway; the point is that no producer is wired there, so a future change to `create()`
cannot make that path start writing.

---

## 5. 🔴 The four RISK-L sites — rewritten, and NO module gained an import

**The decision Task 14.14 demanded I take deliberately: `NotificationsModule` stays out of every
imports array.** Three reasons, in order of weight:

1. **The repo already settled this exact shape.** `live-sessions.module.spec.ts:94` asserts that
   `LiveSessionsModule` does **not** import `GoogleSessionsModule` "although `LiveFeedService`
   reads it" — because that module is `@Global()` and exports the service. `NotificationsModule`
   is the same shape.
2. **`NotificationsModule`'s own docblock (14B's) argues it in terms**: four consumers across
   three libs, and an explicit import in each would put an edge into it from every producer lib.
   Adding the import would contradict the module I am consuming.
3. **Three "imports exactly N modules" assertions survive UNCHANGED** rather than being
   re-derived. That is the stronger outcome the task describes.

**What changed in all four is the prose and the assertion's REASON**, and each spec now also
asserts the stale claim is gone (Task 14.6's rule applied to Phase 5's own docblocks):

| Site                                | Old reason               | New reason, and what now bites                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forum.module.{ts,spec.ts}`         | "the lib does not exist" | `@Global()`. **Plus a new paired assertion**: `posts.service.ts` and `accepted-answer.service.ts` DO import and `@Inject` `NotificationsService`. Without it, deleting both producers leaves the file green while R10.1 ships with no forum notifications.                                                       |
| `google-sessions.module.ts`         | same                     | `@Global()`, and the module is named as the `session_request.status` producer with `cancelOwn`'s absence explained.                                                                                                                                                                                              |
| `learning.module.{ts,spec.ts}`      | same                     | **Two** independent reasons: this lib produces nothing AND the import would be redundant. 🔴 The assertion is now a **source scan** of the whole lib, because with a `@Global()` module a producer added here would never appear in the imports metadata — the old assertion would have stayed green through it. |
| `live-sessions.module.{ts,spec.ts}` | same                     | AD-6 (the producer is one directory away, in `google-sessions/`) + `@Global()`. Same source scan.                                                                                                                                                                                                                |

⚠️ **The price, stated in `ForumModule`'s docblock rather than hidden**:
`Test.createTestingModule({ imports: [ForumModule] })` no longer resolves in total isolation. The
injection is deliberately **not** `@Optional()` — an `@Optional()` would mean forgetting
`NotificationsModule` in `app.module.ts` silently stops every forum notification for ever, with a
plausible reply on every request. That is RISK-AE's failure mode in a different costume.

**`app.module.ts`'s three RISK-L comments were false the moment 14B registered the module** (they
said "it does not exist until Batch 14"). All three rewritten, plus the `NotificationsModule`
registration comment, which now records the decision above.

---

## 6. Task 14.16 — and the conflict I had to resolve

### 6.1 🔴 14B's CODE AND TASK 14.16 DISAGREE. I FOLLOWED THE TASK.

`member-packs.module.ts` said: _"The hub's `packs` section (Task 14.16) reads the table through
its own resolver, **not by injecting this service**."_ `libs/api/community/src/index.ts` said the
same. **Task 14.16 says: "`PacksSection` injects `MemberPacksService`."**

I exported the service, imported `MemberPacksModule` into `MemberHubModule`, and **corrected both
docblocks in place with the correction marked as such.** The reasoning:

1. 🔴 **Exit-gate clause 1 decides it.** `toMemberPack` — the explicit-field mapper that makes
   `notes` structurally unable to reach a member — lives **inside** `MemberPacksService`. A hub
   resolver with its own `prisma.pack.findMany` needs its own `where` **and its own mapper**:
   `memberVisible: true` would have two homes and `notes` two places to leak from. 14B's own
   spec spent four assertions making that leak impossible in one place.
2. **The repo's established idiom is the opposite of the docblock.** `CommunitySection` injects
   `TopicsReadService`; `LearningSection` injects `CourseReadService`. **No hub section touches
   Prisma.** `ForumModule` exports two read services for exactly this consumer.
3. **14B's stated concern is unharmed.** The worry was "a consumer could read the pack table past
   the `MemberGuard` chain". `MemberHubController` is behind the _same_ `JwtAuthGuard` +
   `MemberGuard` chain. The module is **still not `@Global()`**, so a consumer must IMPORT it —
   visible on the graph and in `member-hub.module.ts`. `PacksService` (every mutation, every
   audit write) remains unreachable, and no import edge exists between the two pack modules.

**If the team-leader disagrees, the revert is three lines** (`exports`, the barrel line, the
`MemberHubModule` import) plus a rewrite of `PacksSection` — but it would reopen clause 1's
structural guarantee.

### 6.2 🔴 F-D: the status is derived, and I proved a pinned one fails

Both sections compute their status. Each new spec covers the three cells the task names —
populated, genuinely empty, collaborator throws (**propagates**, is not swallowed) — plus a
fourth I added: _"the status is not a constant — the SAME resolver answers both ways"_, which a
hard-coded value fails even if someone only ever seeded rows.

Both resolvers assert, against their own source, that they contain **no `try {`** and **no
`status: 'unavailable'`** — `hub-section.ts`'s port rule is that `'unavailable'` is returned only
for a NAMEABLE condition, and there is none here. A `try/catch` would report a Postgres outage as
`'empty'` and make the composer's `Promise.allSettled` — the single R6.4 fault boundary —
untestable.

### 6.3 🔴 MY OWN TEST CAUGHT A REAL FRAGILITY IN MY OWN CODE

`NotificationsSection` originally passed the service's envelope straight through, with a comment
saying "the service allocates a fresh literal anyway, so the property holds either way". **My
`two resolutions do not share one payload object` test failed** — a double returning one object
exposed that the guarantee belonged to a _collaborator's allocation habits_, not to the resolver.
Phase 1 had that guarantee (`{ ...EMPTY_NOTIFICATIONS }`) and my passthrough had quietly dropped
it. Now `data: { ...summary }`, with the reasoning at the line.

### 6.4 `empty-sections.section.spec.ts` — two subjects removed, and one assertion MOVED not dropped

Both sections left because both can now say `'ok'`, which that file's own opening paragraph
anticipated. **The sweep now covers two sections instead of four — a narrowing, disclosed and
compensated**: each new file asserts its own `'unavailable'` absence and its own non-catching.
The `EMPTY_NOTIFICATIONS` copy assertion **moved** into `notifications.section.spec.ts`, keeping
both halves and gaining the two-resolutions case; a pointer comment says so at the old site.

⚠️ **Two files outside Task 14.16's declared list needed edits**:
`community.section.spec.ts` and `learning.section.spec.ts` construct all five sections for the
R6.4 fault-injection cases. Each got a collaborator that **answers with nothing**, so each file
still injects exactly one fault.

```
$ npx nx run-many -t typecheck,test -p api-member-hub --skip-nx-cache
Test Suites: 9 passed, 9 total
Tests:       125 passed, 125 total
```

---

## 7. 🔴 LIVE VERIFICATION — actual output

### 7.1 Environment — `:3000` is still the OLD container

```
$ docker ps
ptah_license_server   0.0.0.0:3000->3000/tcp   Up 2 hours (healthy)
ptah_postgres         0.0.0.0:5432->5432/tcp   Up 2 hours (healthy)

$ … "select count(*) …"      # users | licenses | packs | mv_true | notifs | audit | topics | posts
0 | 0 | 0 | 0 | 0 | 0 | 9 | 10
```

14B's warning holds. I built, ran on **`PORT=3011`**, kept the PID in a file and stopped it with
`kill $(cat …pid)`. 🔴 **Nothing was killed by port.** Both containers are `Up (healthy)` at the
end of this dispatch.

```
$ npx nx build ptah-license-server --skip-nx-cache      # green
$ PORT=3011 node -r dotenv/config dist/apps/ptah-license-server/main.cjs
[RouterExplorer]  Mapped {/api/v1/members/packs, GET}
[RouterExplorer]  Mapped {/api/v1/members/hub, GET}
[RouterExplorer]  Mapped {/api/v1/members/notifications, GET}
[RouterExplorer]  Mapped {/api/v1/members/notifications/unread-count, GET}
[RouterExplorer]  Mapped {/api/v1/members/notifications/:id/read, POST}
[RouterExplorer]  Mapped {/api/v1/members/notifications/read-all, POST}
[NestApplication] Nest application successfully started

$ curl -s -o /dev/null -w '%{http_code}' http://localhost:3011/api/health
200
```

**Fixture** (14B's shape, extended): two entitled members with **zero cohort assignments** —
`Ada Lovelace` and `Grace` (last name NULL, for ASSUMPTION-22) — two `builders` licenses, three
packs (visible+labelled / visible+unlabelled / hidden, **all three** carrying
`notes='B14C-ADMIN-ONLY-SECRET'`), and **a REAL forum topic + opening post owned by Ada** in the
member-visible `general` category, so the producers could be driven through HTTP.

### 7.2 🔴 Exit-gate clauses 1 and 4 — packs, live

```json
$ curl -b "ptah_auth=$TOKEN_A" …/v1/members/packs
[{"id":"b14c_pack_labelled","slug":"b14c-labelled","title":"B14C A Labelled",
  "description":"Visible + cohort-labelled.","repoUrl":"https://github.com/x/a","tags":[],
  "cohortName":"Founding Members","accessNote":"Invite within 24h."},
 {"id":"b14c_pack_unlabelled",…,"cohortName":null,"accessNote":null}]
HTTP=200

$ curl … | grep -c "B14C-ADMIN-ONLY-SECRET"
0
```

**Three packs seeded, TWO returned to a ZERO-COHORT member, the cohort-labelled one among them.**
The admin note appears **zero** times. Guard chain: no cookie → `401`; authenticated but
unentitled → `{"reason":"membership_required"}` `403`.

### 7.3 🔴 F-D — the hub sections flip, with no envelope change

```
# packs hidden
sections: learning,community,sessions,packs,notifications
packs        -> {"status":"empty","data":[]}
notifications-> {"status":"empty","data":{"unreadCount":0}}

# the two packs made visible again
sections: learning,community,sessions,packs,notifications
packs.status -> ok | count = 2
notes in whole hub body: 0 occurrences
```

**Same five sections, same envelope, `'empty'` → `'ok'` on data alone.** R6.6 holding across four
phases, and NFR-S5 holding on the hub payload too.

### 7.4 🔴 EXIT-GATE CLAUSE 2, LIVE, THROUGH THE REAL PATH

Grace replies to Ada's topic via `POST /v1/members/community/topics/b14c_topic/posts` → `201`,
and the producer wrote exactly one row:

```
 user_id | kind        | actor_id | target_type | target_id  | title                   | route
 …000a   | topic.reply | …000b    | Topic       | b14c_topic | New reply to your topic | /members/community/topics/b14c-topic
```

Read back by Ada:

```json
{"items":[{"id":"cmsn9zi24…","kind":"topic.reply","actorName":"Grace","targetType":"Topic",
 "targetId":"b14c_topic","title":"New reply to your topic",
 "bodyPreview":"**Grace here** — a real reply that drives the real producer.",
 "route":"/members/community/topics/b14c-topic","readAt":null,…}],
 "page":1,"pageSize":25,"total":1,"hasMore":false}
```

`actorName: "Grace"` composed from `firstName` with a NULL `lastName` (ASSUMPTION-22 / ground
truth 3), **never an email**; no `actorId`, no `userId` (NFR-S4); the markdown `**` survives
unrendered (ground truth 4). Badge `{"unreadCount":1}`; hub `notifications` →
`{"status":"ok","data":{"unreadCount":1}}`.

**Then Ada replies to her OWN topic:**

```
reply HTTP=201
A's unread count AFTER her own reply: {"unreadCount":1}

 total_notification_rows | for_ada
                       1 |       1
```

🔴 **`201` — the reply committed — and the count did not move. One row in the table, still
Grace's.** Exit-gate clause 2, live, through the real path. A suppression that had been treated as
a failure would have rolled the reply back; a producer that pre-checked would have been
indistinguishable here, which is why §3.1's source assertion exists as well.

### 7.5 🔴 RISK-AF, LIVE

Grace replies with `parentId` = Ada's own reply — so the topic author **is** the parent post's
author:

```
reply HTTP=201
       kind       | target_type |         target_id         | route
 topic.reply      | Topic       | b14c_topic                | /members/community/topics/b14c-topic
 post.child_reply | Post        | cmsn9zty4…                | /members/community/topics/b14c-topic#post-cmsna04eq…
(2 rows)
```

**Two reply events, two rows.** The second produced **ONE** row with the more specific kind — a
naive producer yields three. `targetId` is the parent post and the route anchors the **new**
reply, the divergence argued in the producer's docblock.

### 7.6 🔴 RISK-AH, live

```
POST …/<Ada's id>/read      as Grace -> {"readAt":null}  HTTP=200
POST …/does-not-exist/read  as Grace -> {"readAt":null}  HTTP=200   <- INDISTINGUISHABLE
Ada's row in the DB afterwards        -> NULL — UNTOUCHED
POST …/<Ada's id>/read      as Ada   -> {"readAt":"2026-08-10T13:37:32.744Z"}  HTTP=200
```

No `404`, so no existence oracle over guessable cuids; the owner's write works.

### 7.7 Teardown, with a census

```
DELETE 2 (notifications) · 4 (posts) · 1 (topic) · 3 (packs) · 2 (licenses) · 2 (users)

 users | licenses | packs | mv_true | notifs | audit | topics | posts
     0 |        0 |     0 |       0 |      0 |     0 |      9 |    10
```

🔴 **Byte-identical to the pre-dispatch census, including Batch 8's 9 topics / 10 posts.** One
`BEGIN`/`COMMIT`, every `DELETE` scoped by id or by the `b14c-` prefix. **No `TRUNCATE`, no
unqualified `DELETE`.** `admin_audit_log` is `0` and I deleted nothing from it — this batch writes
no audit row, so unlike 14A there was no residue and no judgement call.

---

## 8. The structural gates — actual output

### 8.1 Full batch gate, nine projects

```
$ npx nx run-many -t eslint:lint,typecheck,test \
    -p api-notifications,api-community,api-contracts-community,api-member-hub,api-forum,\
       api-learning,api-core,api-audit,ptah-license-server --skip-nx-cache

 NX   Successfully ran targets eslint:lint, typecheck, test for 9 projects

    api-contracts-community   2 suites /  33 tests
    api-core                  3 suites /  26 tests
    api-audit                 1 suite  /   5 tests
    api-notifications         5 suites / 128 tests
    api-member-hub            9 suites / 125 tests   (7/108 before 14C -> +2 suites, +17)
    api-community            19 suites / 448 tests   (+29 tests)
    api-forum                21 suites / 531 tests   (+50 tests)
    api-learning             20 suites / 482 tests   (+1 test)
    ptah-license-server       5 suites / 158 tests   (UNCHANGED — 14C adds no route)
```

### 8.2 🔴 RISK-AL — `MIN_TOTAL_PAYLOAD_PARAMS` re-derived, not assumed

```
$ (constant set to 9999)
$ npx nx test ptah-license-server --skip-nx-cache --testPathPatterns=controller-validation
    Expected: >= 9999
    Received:    77
=== RESTORED === BYTE-IDENTICAL
```

**Still 77.** 14C adds no controller and no payload param, and that is now measured rather than
argued.

| Constant                          | 14B  | 14C     | Note                          |
| --------------------------------- | ---- | ------- | ----------------------------- |
| `MIN_TOTAL_PAYLOAD_PARAMS`        | 77   | **77**  | re-derived from `9999`        |
| `NAMED_PRIMITIVE_PARAM_COUNT`     | 6    | **6**   | 🔴 exact equality             |
| `UNVALIDATED_DEBT`                | `[]` | `[]`    | untouched                     |
| `PREFIX_EXCEPTIONS` (`route-map`) | 1    | **1**   | at its floor                  |
| `KNOWN_PREFIX_DEBT` (`route-map`) | `[]` | `[]`    | at its floor                  |
| `EXPECTED_ROUTES`                 | 137  | **137** | 14C adds no route             |
| `ALL_CONTROLLERS`                 | 40   | **40**  | 14C adds no controller        |
| `EXPECTED_NULLABLE_OPTIONALS`     | 13   | **13**  | 14C adds no nullable optional |
| `LIBS_WITH_DTOS`                  | 8    | **9**   | `'notifications'` — see below |

### 8.3 `LIBS_WITH_DTOS` — a coverage strengthening, and the suite did NOT force it

The per-lib reach assertion is **one-directional**: it fails when a _listed_ lib is not reached
and says nothing about an unlisted one. `libs/api/notifications` has been scanned for null-holes
since 14B created it — the walk is rooted at `libs/api` with no by-name exclusions. **Adding the
entry fixes no build and closes no hole.** What it adds: if a future refactor moved the root or
made the recursion skip a lib, the new lib would drop out of the census **silently** and every
"no violations" assertion would keep passing over one fewer library. The constant's docblock says
this in terms, because a reviewer would otherwise assume the suite demanded it.

```
$ npx nx test api-core --skip-nx-cache --testPathPatterns=nullable-dto
Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total
```

### 8.4 🔴 `audit-log.types.ts` — expected diff ZERO, and now CONFIRMED

14B predicted it; I verified it. The only occurrence of `AuditLogService` anywhere in
`libs/api/notifications` is a docblock explaining its absence. My four producers touch no audit
action — the audit references in `posts.service.ts` are the pre-existing moderation hooks
(`post.deleted`, `post.restored`), unchanged. **`AdminAuditAction` / `AdminAuditTargetType` gain
nothing. The file is untouched.**

### 8.5 Lint — 0 errors, and every warning attributed

```
api-forum            5 warnings — categories.service.ts, read-state.service.spec.ts,
                                  search.service.spec.ts   (NONE touched by 14C)
api-core             1 warning  — sentry/sentry.module.ts  (14A/14B already reported)
ptah-license-server  2 warnings — jest.config.ts, src/instrument.ts (unused eslint-disable
                                  directives; NEITHER touched by 14C)
api-notifications, api-community, api-contracts-community, api-member-hub,
api-learning, api-audit — clean
```

**0 errors everywhere. Zero warnings in any file 14C touched.**

### 8.6 Migration state

```
$ npx prisma migrate status
21 migrations found in prisma/migrations
Database schema is up to date!
```

14C creates no migration and does not touch `schema.prisma`.

---

## 9. 🔴 Six deliberate-failure proofs — every one reverted and `diff`-confirmed

| #     | Mutation                                                                                 | Result                                                                                                                                                                                                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Remove `ScheduleModule.forRoot()` from `app.module.ts`                                   | **1 failed, 2 passed** — `registers ScheduleModule.forRoot() … (RISK-AE)`, and **only** that. `api-notifications` retention stayed **17/17 green**, re-confirming 14B's §5.3 finding that the lib half alone would NOT have closed RISK-AE. Re-run because 14C edited `app.module.ts`.                     |
| **2** | Drop `readAt: { not: null }` from the prune                                              | **5 failed, 12 passed** — including `an UNREAD notification survives no matter how old it is`.                                                                                                                                                                                                             |
| **3** | Collapse the recipient set to two unconditional writes                                   | **3 failed, 52 passed** — the path-level `RISK-AF: topic author IS the parent author ⇒ EXACTLY ONE row` first, then both pure-function cases.                                                                                                                                                              |
| **4** | Add `notes` to `toMemberPack`                                                            | ⚠️ The naive edit **would not compile** — `MemberPack` rejects the key, which is a stronger outcome than a red test. I re-ran it behind an `as unknown as MemberPack` cast so it compiles: **3 failed, 33 passed**, red in **both halves** (key-absence AND value-absence) plus the eight-field assertion. |
| **5** | 🔴 `decline` still returns `503 { scheduling_unavailable }` **but writes the row first** | **1 failed, 47 passed** — only `DB row UNTOUCHED`. **This is B12's F-1 proof.** §4.3.                                                                                                                                                                                                                      |
| **6** | 🔴 Pin `PacksSection` to `status: 'ok'` (finding F-D)                                    | **2 failed, 6 passed** — `the query ran and found NOTHING ⇒ empty` and `the status is not a constant`.                                                                                                                                                                                                     |

Every mutation was restored from a backup and confirmed **BYTE-IDENTICAL** by `diff`.

---

## 10. 🔴 EXIT GATE — all six clauses

| #   | Clause                                                         | Owner             | Status                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `MemberPack` asserts `notes` absent under all circumstances    | 14.7              | ✅ **CLOSED.** Unit (both halves + a future-column probe) **and live: 0 occurrences** in `/members/packs` AND in the whole `/members/hub` body. Deliberate-failure proof #4.                              |
| 2   | A member's own action creates NO notification for them         | 14.10 / **14.13** | ✅ **CLOSED — the producer half is now done.** Driven through the real `createReply` in unit tests **and live**: Ada replied to her own topic, `201`, count unchanged at 1, table still one row. §7.4.    |
| 3   | Retention prune deletes READ rows > 90 d and nothing else      | 14.11             | ✅ **CLOSED.** Re-verified under 14C's tree; RISK-AE still proven at both ends (proofs #1, #2).                                                                                                           |
| 4   | `GET /members/packs` filters on `memberVisible: true` only     | 14.7              | ✅ **CLOSED.** 3 seeded → **2 returned to a zero-cohort member**, the cohort-labelled one among them, live against Postgres. Re-run by 14.17 as its own proof, not inherited.                             |
| 5   | Migration 5 makes no existing pack member-visible              | 14.3              | ✅ CLOSED (14A). `mv_true = 0` again after teardown.                                                                                                                                                      |
| 6   | **B12's F-1 closed on all three of accept/reschedule/decline** | **14.14**         | ✅ **CLOSED.** Server-side, `isEnabled() === false` double, all three methods, `503` + reason constant + **row untouched over 7 write verbs** + no notification. **Proven non-cosmetic by proof #5.** §4. |

**Standing structural gates**: `route-map` ✅ (137 routes, both ledgers at their floor) ·
`controller-validation` ✅ (**77 re-derived** / 6 exact / `[]`) · nullable-DTO census ✅ (13
unchanged, `LIBS_WITH_DTOS` 8 → 9) · `admin-guards` G1 ✅ · packs **G6 ✅ green and
byte-unmodified** · `app.module.spec` ✅ boots · `prisma migrate status` ✅ 21 / up to date.

---

## 11. What I deliberately did NOT do

1. **No `announcement` producer** (ASSUMPTION-20). The fifth kind is declared in
   `NOTIFICATION_KINDS`, accepted by the service, routed by `buildNotificationRoute('LiveSession')`
   and covered by the round-trip test — **and nothing writes it.** R10.1's admin-publish action
   has no admin surface in this task, so a producer would be dead code. **Four of five kinds have
   producers, and all four are 14C's.**
2. **No lesson-comment producer.** `LearningModule` writes nothing; its spec now asserts that by
   scanning the lib's source.
3. **No websocket, no SSE, no email, no push, no digest.** Poll only (AD-14). `libs/api/licensing`'s
   `@Sse` endpoint was neither imported, extended nor read.
4. **No notification preferences, mute settings, per-kind opt-out, or admin surface.**
5. **No `sendUpdates` change on `accept`.** The member is told in-app; Google still sends nothing.
6. **Did not add `NotificationsModule` to any imports array.** §5 — a deliberate decision, argued
   from the repo's own precedent, not a deferral.
7. **Did not touch `controller-registry.ts`, `route-map.spec.ts`, `EXPECTED_ROUTES`, or
   `controller-validation.spec.ts`'s constants** — 14B's registrations are correct and 14C adds
   no route, no controller and no payload param. Verified mechanically (§8.2), not assumed.
8. **Did not touch `audit-log.types.ts`.** §8.4.
9. **Did not run `prisma format`, touch `schema.prisma`, or create a migration.**
10. **Did not kill anything by port, and did not stop or reconfigure the `ptah_license_server`
    container holding `:3000` with pre-Phase-5 code.** It is not mine.
11. **Did not commit, stage, stash or checkout anything.**

---

## 12. What turned out wrong when I reached the code

| Source                                                   | Verdict                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| 🔴 **14B's `member-packs.module.ts` + community barrel** | **CONTRADICTS TASK 14.16.** Both stated the hub would not inject `MemberPacksService`. I followed the task and corrected both, disclosed. Exit-gate clause 1 is the deciding argument. §6.1.                                                                                                 |
| 🔴 **My own first `resolveParent`**                      | Returned the second read's `id`, letting a notification-motivated query move a post. Caught by the pre-existing RK-12 fixtures. Fixed: the repaired id is `parentPost.parentId` verbatim. §3.2.                                                                                              |
| 🔴 **My own first `NotificationsSection`**               | Passed the collaborator's object straight through, silently dropping Phase 1's "hand out a copy" guarantee. Caught by my own new test. Fixed with a spread. §6.3.                                                                                                                            |
| 🔴 **My own first actor-check assertion**                | A file-wide `not.toMatch(/[!=]== ctx.userId/)` flagged `updateByAuthor`'s legitimate authorship check — an assertion that would have been deleted the first time it fired. Scoped to `createReply` and the resolver. §3.1.                                                                   |
| ⚠️ **Task 14.16's file list**                            | **INCOMPLETE.** `community.section.spec.ts` and `learning.section.spec.ts` also construct both sections (composer fault-injection). Both needed collaborators. §6.4.                                                                                                                         |
| ⚠️ **Task 14.13's file list**                            | **INCOMPLETE** in the same way: `admin-community-posts.controller.spec.ts` constructs `PostsService` and needed the new constructor argument.                                                                                                                                                |
| ⚠️ **Proof #4 as written**                               | _"Add `notes` to `toMemberPack`"_ does not compile — `MemberPack` rejects the key. Re-run behind a cast. A stronger result than the task expected, and worth restating in Task 16.5's style. §9.                                                                                             |
| ⚠️ **Task 14.14's "the four RISK-L sites"**              | There are four _files_ with RISK-L prose but **five** surfaces: `app.module.ts` carried three stale RISK-L comments of its own, all false since 14B. Rewritten. §5.                                                                                                                          |
| ✅ **14B's §5.3 RISK-AE finding**                        | **STILL TRUE after 14C edited `app.module.ts`.** Removing `ScheduleModule.forRoot()` reds exactly one app-level test and leaves the lib's 17 green. Proof #1.                                                                                                                                |
| ✅ **14B's `CronExpression.EVERY_DAY_AT_4AM` finding**   | Not re-encountered — 14C touches no cron.                                                                                                                                                                                                                                                    |
| ✅ **14B's `markRead` shape finding**                    | Confirmed live: `markRead` returns `{ readAt }`, not `{ marked }`. §7.6.                                                                                                                                                                                                                     |
| ✅ **Ground truth 5, 6, 7**                              | **ALL CORRECT.** Four modules carried RISK-L blocks; `session-requests.service.ts` is under `google-sessions/`; `SCHEDULING_UNAVAILABLE` has **three** call sites and all three are now exercised.                                                                                           |
| ✅ **Ground truth 3 / ASSUMPTION-22**                    | **CORRECT and proven live** — `"Grace"` from `firstName` with a NULL `lastName`, never an email.                                                                                                                                                                                             |
| ✅ **Ground truth 4**                                    | **CORRECT.** `bodyPreview` stored as raw markdown; the `**` survived to the wire unrendered.                                                                                                                                                                                                 |
| ✅ **F-D**                                               | **CORRECT, and it was a live trap.** Both hub sections would have been wrong pinned to `'ok'`. Proof #6.                                                                                                                                                                                     |
| ✅ **RISK-AJ**                                           | **CORRECT.** A hostile slug (`../../admin?x=1#y`) becomes one percent-encoded path segment; asserted.                                                                                                                                                                                        |
| ⚠️ **14A §11.4 / §11.5**                                 | `jq` still absent. `/tmp` still differs — my first token file was written by `node` and read by `bash`; a **dotenv stdout banner** also corrupted it (a new variant: `dotenv` prints `◇ injected env (41)` to stdout, which `source` then tried to execute). Filtered with `grep '^TOKEN_'`. |
| ⚠️ **`licenses` schema**                                 | The plan-shaped seed failed: `licenses` has **`plan`**, not `tier`, and **no `email` column**. Corrected against `\d licenses`.                                                                                                                                                              |
| ⚠️ **`community_categories`**                            | `visibility` values are `member                                                                                                                                                                                                                                                              | cohort | staff`— there is **no`'public'`**. And the column is `cohort_keys`, not `cohort_key`. |

---

## 13. Handoff to the team-leader — five things

1. 🔴 **Batch 14 is ONE commit.** 14A's §7.4 raised it (its docblocks name symbols that land in
   14B) and 14C compounds it: `ForumModule`'s docblock now describes producers that exist only in
   14C's diff, and `member-packs.module.ts`'s export is required by 14C's `MemberHubModule`.
   Splitting the batch produces at least two commits that do not build or do not typecheck.
2. 🔴 **§6.1 is the one decision that needs a reviewer's eye.** I overrode two 14B docblocks to
   follow Task 14.16. The reasoning is exit-gate clause 1, the repo's own hub-section idiom, and
   the fact that the property 14B was protecting is preserved. Reverting is mechanical if the
   team-leader disagrees.
3. 🔴 **The foreign footprint grew again and now includes `libs/shared/src/index.ts`** (§1.2).
   Batch 14 touches no `libs/shared` file, so there is no overlap — but that is the most dangerous
   file on the list to stage by accident. **Never `git add -A`; never `git add .ptah/specs`.**
4. **`:3000` is STILL the pre-Phase-5 container** and `curl :3000/api/health` returns `200` from
   it. Any future live verification must use another port and stop by PID.
5. **The database is back to `users=0, licenses=0, packs=0, mv_true=0, notifs=0, audit=0,
topics=9, posts=10`** — byte-identical to the state 14B left. Batch 15 (P5-FE) will need its
   own throwaway seed; §7.1's shape and the one-transaction teardown in §7.7 both work.

**No blocking clarification is required.** The one decision I surfaced (§6.1) is disclosed, is
argued from the exit gate rather than from taste, and stops nothing.
