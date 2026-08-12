# Bulk mark-read endpoint — report

**Executor**: `backend-developer` · **Date**: 2026-08-10
**Scope**: ONE endpoint, `POST /api/v1/members/notifications/read`. Not a batch.
**Commits made**: **NONE.** No `git add`, `git commit`, `git stash` or `git checkout` was run at any point.

---

## 0. Executive summary — the ten lines that matter

1. **The endpoint ships and the ownership property is proven LIVE with two real Postgres identities.** Bob names two of Alice's ids, one fictional id and one of his own → `{"marked":1}`, `HTTP=200`, and **Alice's two rows are still `UNREAD` in the table**. §4.2.
2. 🔴 **The deliberate-failure proof was run TWICE — as a unit test AND against a real running server.** Dropping `userId` from the `where` made **exactly three** tests red (all three in the `RISK-AH` block, all three about ownership) and made the identical live request answer `{"marked":3}` with Alice's rows flipped to `READ`. Reverted; `git diff` shows the mutation left **zero residue**. §7.
3. **Semantics chosen and documented**: non-existent / already-read / another member's ids are **not errors** — each contributes zero to `marked`, `200` either way. Return shape is `{ marked: number }`, **byte-identical in field and meaning to `read-all`**, so the three writes stay consistent. §3.
4. 🔴 **An empty array is a `400`, not a no-op — and the reason is not "the toolbar can't send one".** "These, where these is empty" is the one phrasing that could ever be re-read as "all", and that conflation is the irreversible mistake this endpoint exists to prevent. Refusing it closes the door instead of documenting it shut. §3.2.
5. 🔴 **The cap is `MAX_BULK_MARK_READ_IDS = MAX_PAGE_SIZE` — DERIVED, not copied.** A selection is produced by ticking rows on screen and the inbox renders at most one page, so a request naming more ids than the largest page the same API will serve is not a selection. Deriving means the two numbers cannot drift. §3.3.
6. **RI-3 was the real routing risk and it was proven live, not argued.** `POST .../read` reaches the bulk handler; `POST .../read/read` reaches `:id/read` with `id='read'`. Four segments vs five — different segment counts never unify. §4.4.
7. **Structural gates re-derived MECHANICALLY, not by eye.** `MIN_TOTAL_PAYLOAD_PARAMS` 77 → **78** via the documented `9999` procedure (`Expected: >= 9999 / Received: 78`). `NAMED_PRIMITIVE_PARAM_COUNT` **unchanged at 6**. `UNVALIDATED_DEBT` still `[]`. `EXPECTED_ROUTES` +1. Both prefix ledgers at their floor. `controller-registry.ts` needed **no** change — no new controller. §6.
8. **Everything green, `--skip-nx-cache`, explicit project lists, `nx affected` never used.** `api-notifications` 5 suites / **150** tests, `api-contracts-community` 2 / 33, `ptah-license-server` 5 / **158** (unchanged — I added no test there, only re-derived two constants). Lint **0 errors**; the 2 warnings are pre-existing in `jest.config.ts` and `instrument.ts`, which I did not touch. §8.
9. **DB returned to its exact pre-batch census**, proven by a census on both sides. Server stopped **by PID identity confirmed from two independent sources**, never by port; both Docker containers `Up (healthy)`. §5.
10. 🔴 **HEAD moved again during this dispatch** (`6df1984a7` → `b57d3c8d4`) and the foreign list **shrank**: `libs/frontend/editor/**` and `TASK_2026_173`'s files were committed by the concurrent session and are gone. §1.2.

---

## 1. File set

### 1.1 Mine — 10 modified, 1 new

**New (1):**

- `D:/projects/ptah-extension/libs/api/notifications/src/lib/dto/mark-notifications-read.dto.ts`

**Modified (10):**

| File                                                                          | Why                                                                                                                               |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `libs/api/notifications/src/lib/member-notifications.controller.ts`           | The `POST read` handler + `Body` import + docblock (four routes → five).                                                          |
| `libs/api/notifications/src/lib/notifications.service.ts`                     | `markManyRead` + one class-docblock line.                                                                                         |
| `libs/api/notifications/src/index.ts`                                         | Export the new DTO.                                                                                                               |
| `libs/api/notifications/README.md`                                            | Route table was stale the moment the route existed; plus the "no mark-unread" decision, recorded where the next reader will look. |
| `libs/api/notifications/src/lib/member-notifications.controller.spec.ts`      | +12 `it`s, two `it.each` tables 4 → 5 cases.                                                                                      |
| `libs/api/notifications/src/lib/notifications.service.spec.ts`                | +8 `it`s, and the stateful double now models `{ in: [...] }`.                                                                     |
| `libs/api-contracts/community/src/lib/member/member-notification.contract.ts` | `MAX_BULK_MARK_READ_IDS`, `MarkNotificationsReadRequest`, docblock.                                                               |
| `libs/api-contracts/community/src/index.ts`                                   | Barrel re-export (declares nothing — R-BARREL still green).                                                                       |
| `apps/ptah-license-server/src/common/route-map.spec.ts`                       | `EXPECTED_ROUTES` +1 with the RI-3 reasoning.                                                                                     |
| `apps/ptah-license-server/src/common/controller-validation.spec.ts`           | `MIN_TOTAL_PAYLOAD_PARAMS` 77 → 78 with the breakdown.                                                                            |

🔴 **Nothing outside `libs/api/notifications/**`, `libs/api-contracts/community/**`and`apps/ptah-license-server/src/common/**`was touched.** No migration (none needed — no schema change). No`libs/web/\*\*`. No `.ptah/specs/`file other than this report. No`tsconfig.base.json`, `nx.json`, `eslint.config.mjs`, `package.json`.

### 1.2 🔴 The foreign footprint — RE-DERIVED AT THE START AND AGAIN AT THE END

**HEAD moved during this dispatch: `6df1984a7` → `b57d3c8d4`** (`fix(editor): de-nest the tab, header and file-row buttons for a11y`).

**Delta:**

- ✅ **Gone** (committed by the concurrent session mid-dispatch): all of `libs/frontend/editor/**` (6 files, foreign at 15A's end), `.ptah/specs/TASK_2026_173/tasks.md`, `batch-6-dispatch.md`, `batch-6-report.md`.
- **Still foreign, untouched by me:**
  - `libs/web/members/**` and `libs/web/panel-ui/**` — Batch 15A's uncommitted frontend work. Store wiring to this endpoint is **Batch 15B's**, not mine.
  - `marketing/scripts/01-open-source-announcement.md`
  - `.ptah/specs/TASK_2026_177/tasks.md` (**not mine — modified before I started**), `TASK_2026_179/task.md`, `TASK_2026_184/task.md`
  - `.ptah/specs/TASK_2026_{171,179,187,197}/.harvested.json`, `.ptah/specs/TASK_2026_177/batch-15a-report.md`
- **No new foreign directory appeared** this time.

**Guidance for the team-leader's commit**: stage the eleven paths in §1.1 explicitly. **Never `git add .` and never `git add .ptah/specs`.** PRE-2 binds the route and its registration into one commit — `route-map.spec.ts` and `controller-validation.spec.ts` must land WITH the controller, or the build is red at HEAD.

---

## 2. What was built

```
POST /api/v1/members/notifications/read
Guards: JwtAuthGuard → MemberGuard (class level, unchanged)
Body:   { "ids": string[] }        1..50 entries, each 1..64 chars
Status: 200 (@HttpCode(200) — nothing is created)
Body:   { "marked": number }
```

- **Contract**: `MAX_BULK_MARK_READ_IDS` + `MarkNotificationsReadRequest` in `member/member-notification.contract.ts`, re-exported from the barrel.
- **DTO**: `MarkNotificationsReadDto implements MarkNotificationsReadRequest`, bound with `dtoPipe`.
- **Service**: `NotificationsService.markManyRead(ctx, ids)` — ONE `updateMany`.
- **Route path is `read`**, so the trio reads **one / these / all**: `:id/read`, `read`, `read-all`.

### 2.1 Why the ids travel in a `@Body()` and not `?ids=a,b,c`

Three independent reasons, any one sufficient:

1. `NAMED_PRIMITIVE_PARAM_COUNT` is an **exact equality at 6**. One `@Query('ids')` makes it 7 and fails the build — deliberately.
2. A query string's length is bounded by the **server's URL limit**, not by anything this code controls. `@ArrayMaxSize` can only bound a body.
3. Every proxy in the path logs a query string.

---

## 3. The semantics, decided and documented

### 3.1 Ids that do not exist / are already read / belong to another member

**All three are `200`, all three contribute zero to `marked`, none is reported individually.**

This is not leniency, it is the same reasoning that already governs `POST :id/read` (which answers `{ readAt: null }` for both a missing id and someone else's). A per-id failure list tells a caller **which of the cuids they guessed are real** — an existence oracle. Proven live in §4.3: naming only Alice's ids and naming only fictional ids produce the **identical** `{"marked":0}`.

**Return shape**: `{ marked: number }` — the same field, the same type and the same meaning `read-all` already returns. `marked` is **"rows this call moved"**, never "the new unread count" (15A's §3.3 recorded a client conflating those would zero a badge that should not have moved). Asserted directly: `expect(Object.keys(many)).toEqual(Object.keys(all))`.

### 3.2 🔴 An empty array is a `400`

The weak argument is "the toolbar renders nothing at zero selected, so it is a client bug". The **real** argument is stronger and is why this was not made a silent no-op:

> "Mark these, where _these_ is empty" is the one phrasing that could ever be re-read as "mark all". Conflating **these** with **all** is precisely the irreversible mistake that made `read-all` unusable for a partial selection in the first place. Refusing an empty array closes that door permanently, rather than leaving a comment asking the next reader not to open it.

Live: `{"ids":[]}` → `{"message":["ids should not be empty"],"statusCode":400}`.

🔴 **And the service is written to be safe even if that rejection were removed.** The ids are spread into the `where` **unconditionally**. The tempting `id: ids.length ? { in: ids } : undefined` is a catastrophe wearing a guard clause — Prisma treats `undefined` as **no constraint**, so an empty selection would mark the member's whole inbox read, silently, with a `200`. There is a dedicated service test for this (`an EMPTY selection marks NOTHING — it does not mark everything`) and the test double models `{ in: [...] }` specifically so it can tell `in: []` from `undefined`.

### 3.3 The cap — derived, not invented

```ts
export const MAX_BULK_MARK_READ_IDS = MAX_PAGE_SIZE; //  = 50
```

The only honest way a member produces a selection is by ticking rows that are on screen, and the inbox cannot render more than one page. A request naming more ids than the largest page the same API will serve **is not a selection**. Deriving rather than copying means raising the page ceiling cannot leave the two in disagreement — there is no second edit to forget. Asserted: `expect(MAX_BULK_MARK_READ_IDS).toBe(MAX_PAGE_SIZE)`.

A member who wants their whole inbox marked read still has `read-all`, which takes no ids and is not bounded by this. **This cap constrains "these N", never "all".**

### 3.4 What was NOT added

| Not added                                   | Why                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mark-unread**                             | Explicitly considered and NOT chosen (user decision). Also recorded in the lib README with the technical reason: an un-read write gives `readAt` a second meaning, and the badge, the 90-day retention prune (READ rows only) and the client's optimistic decrement all read that column as monotonic.                                                                 |
| Websocket / SSE / email / push / digest     | AD-14. `libs/api/licensing`'s `@Sse` endpoint was neither imported nor extended — the existing source-text assertions in the controller spec still pass.                                                                                                                                                                                                               |
| Admin notification surface                  | Out of scope; the contracts lib says so in terms.                                                                                                                                                                                                                                                                                                                      |
| Notification preferences / per-kind opt-out | Out of scope.                                                                                                                                                                                                                                                                                                                                                          |
| A producer for the `announcement` kind      | Untouched — still declared with no producer, by design.                                                                                                                                                                                                                                                                                                                |
| A migration                                 | None needed. No schema change.                                                                                                                                                                                                                                                                                                                                         |
| `@ArrayUnique()`                            | Would turn a harmless client quirk into a `400`. `in` is set membership, so a duplicate is counted once (tested, and proven live in §4.3 where `b15c_a1` appears twice and `marked` is 2, not 3).                                                                                                                                                                      |
| A Zod schema for the request                | The contract file's own established rule: no schema without a boundary to guard. A client does not parse its own outgoing body; the boundary that must reject a malformed one is the **server's**, and there it is the DTO. The type and the cap are declared because those are the two things that CAN drift across the two sides. Recorded in the contract docblock. |

---

## 4. 🔴 LIVE verification — actual output

Server: my own build on **`PORT=3011`**. `:3000` remains the OLD container predating `54650edee` and was never used. All five notification routes mapped:

```
[RouterExplorer] Mapped {/api/v1/members/notifications, GET}
[RouterExplorer] Mapped {/api/v1/members/notifications/unread-count, GET}
[RouterExplorer] Mapped {/api/v1/members/notifications/:id/read, POST}
[RouterExplorer] Mapped {/api/v1/members/notifications/read, POST}
[RouterExplorer] Mapped {/api/v1/members/notifications/read-all, POST}
HEALTH_3011=200
```

**Fixtures** (14B §6.3 shape): two `users` — Alice `b15c…000a` and Bob `b15c…000b` — each with an active `builders` `licenses` row (`created_by='b15c-fixture'`), and seven `member_notifications`: `b15c_a1..a5` owned by Alice (`a4` pre-read at `2026-07-01T09:00:00Z`) and `b15c_b1..b2` owned by Bob. **JWTs minted IN MEMORY** and written to a file under `/tmp` that was deleted at teardown — `git status` shows no token or `.env` residue.

```
no cookie -> POST /read           HTTP=401
baseline   A: {"unreadCount":4}   B: {"unreadCount":2}
```

### 4.1 The four routes still behave as Batch 14 pinned them

```
POST /b15c_a3/read  -> {"readAt":"2026-08-10T14:57:35.865Z"}   HTTP=200
POST /read-all      -> {"marked":1}                            HTTP=200
GET  /unread-count  -> {"unreadCount":N}                       HTTP=200
```

`read-all` by Alice left Bob's `b15c_b2` **`UNREAD`** — still ownership-scoped.

### 4.2 🔴 O-1 — THE OWNERSHIP PROOF, two distinct identities, against Postgres

Bob names **two of Alice's ids**, **one fictional id**, and **one of his own**:

```
$ curl -b "ptah_auth=$BOB" -X POST .../notifications/read \
    -d '{"ids":["b15c_a1","b15c_a2","b15c_does_not_exist","b15c_b1"]}'
{"marked":1}
HTTP=200

$ psql -c "select id, read_at is null ..."
b15c_a1|UNREAD      <- Alice's. Named by Bob. UNTOUCHED.
b15c_a2|UNREAD      <- Alice's. Named by Bob. UNTOUCHED.
b15c_a3|UNREAD
b15c_a4|read
b15c_a5|UNREAD
b15c_b1|read        <- Bob's own. The ONLY row that moved.
b15c_b2|UNREAD

A: {"unreadCount":4}   <- unchanged from baseline
B: {"unreadCount":1}
```

**`marked: 1`, not 3.** Alice's real ids and the fictional id are indistinguishable in the response — Bob learns nothing about whether `b15c_a1` exists.

### 4.3 O-2 and the partial-selection property

```
B -> ONLY Alice's ids   : {"marked":0}
B -> ONLY fictional ids : {"marked":0}      <- identical. No existence oracle.
```

```
$ A: POST /read {"ids":["b15c_a1","b15c_a2","b15c_a4","b15c_a1"]}
{"marked":2}   HTTP=200

b15c_a1|2026-08-10 14:57:12.083   <- moved
b15c_a2|2026-08-10 14:57:12.083   <- moved
b15c_a3|UNREAD                    🔴 NOT SELECTED, STILL UNREAD
b15c_a4|2026-07-01 09:00:00       🔴 ALREADY READ, TIMESTAMP NOT REWRITTEN
b15c_a5|UNREAD                    🔴 NOT SELECTED, STILL UNREAD
```

Four properties in one call: the partial selection moved **only** what was named (the thing `read-all` destroys); the already-read row kept its **original** July timestamp and was not counted; the **duplicated** `b15c_a1` was counted once; `marked` is 2, not 4.

### 4.4 🔴 RI-3 — proven live, not argued

The failure mode being excluded is severe: if `POST .../read` were swallowed by `:id/read` with `id='read'`, a bulk request would silently mark **one** row and report success.

```
POST /read           -> 400, body naming `ids` constraints   <- the BULK handler
POST /read/read      -> {"readAt":null}  HTTP=200            <- :id/read, id='read'
POST /b15c_a3/read   -> {"readAt":"…"}   HTTP=200            <- :id/read, real id
POST /read-all       -> {"marked":1}     HTTP=200            <- unchanged
```

`POST /read` returning a **DTO validation error** is conclusive: `markRead` binds no body and would have answered `200 {"readAt":…}`. Four segments vs five; `unifiable()`'s own hand-computed table pins that differing segment counts never unify, so `KNOWN_CONTESTED` gains nothing.

### 4.5 Boundary validation — every bound exercised live

```
empty array    : {"message":["ids should not be empty"]}                          400
bare string    : {"message":[…,"ids must be an array"]}                            400
numeric elem   : {"message":[…,"each value in ids must be a string"]}              400
empty elem     : {"message":["each value in ids must be longer than or equal to 1 characters"]} 400
over-long elem : {"message":["each value in ids must be shorter than or equal to 64 characters"]} 400
unknown prop   : {"message":["property all should not exist"]}                     400
missing ids    : {"message":[…]}                                                   400
50 ids (cap)   : {"marked":0}                                                      200
51 ids (cap+1) : {"message":["ids must contain no more than 50 elements"]}          400
```

Two things worth naming. **`forbidNonWhitelisted` is live on this route** — `{"ids":[…],"all":true}` is rejected, which is only true because the param binds `dtoPipe` (esbuild emits no `emitDecoratorMetadata`, so a bare `@Body()` would make every line above inert). And **no message names a column, a constraint or a Prisma detail** — NFR-S7 holds; these answer _"is this the shape of an id?"_, never _"is this id real?"_.

---

## 5. Teardown, census, and how the server was stopped

```
Pre-batch : users=0 licenses=0 subs=0 packs=0 mv_true=0 notifs=0 audit=0 topics=9 posts=10 cats=4 groups=1
DELETE 7 (member_notifications, id LIKE 'b15c\_%')
DELETE 2 (licenses, created_by='b15c-fixture')
DELETE 2 (users, by the two fixture emails)
Post-batch: users=0 licenses=0 subs=0 packs=0 mv_true=0 notifs=0 audit=0 topics=9 posts=10 cats=4 groups=1
```

🔴 **Byte-identical**, including Batch 8's 9 topics / 10 posts and the 4 categories / 1 member group. One `BEGIN`/`COMMIT`, every `DELETE` scoped by a `b15c` prefix or by an exact fixture value. **No `TRUNCATE`, no unqualified `DELETE`.** `admin_audit_log` is `0` and I deleted nothing from it — this endpoint writes no audit row, so unlike 14A there was no residue and no judgement call.

### 🔴 Stopped BY PID IDENTITY, from two independent sources

```
$ grep -oE "\[Nest\] [0-9]+" server.log   ->  [Nest] 27072
$ netstat -ano | grep ":3011" | grep LISTENING
  TCP 0.0.0.0:3011 ... LISTENING  27072
$ tasklist /FI "PID eq 27072"  ->  node.exe  27072
$ taskkill /PID 27072 /F       ->  SUCCESS
```

The kill was guarded by an explicit `if [ "$LOGPID" = "$NETPID" ]` — on a mismatch it would have refused rather than killed whatever held the port. The same two-source procedure was used for **all three** server instances this dispatch (clean → mutated → restored). Afterwards:

```
HEALTH_3011=000   HEALTH_3000=200
ptah_license_server  Up 3 hours (healthy)
ptah_postgres        Up 3 hours (healthy)
```

**Nothing Docker owns was touched.**

---

## 6. The structural gates

| Gate                                      | Before                | After                                         | How                                                                                                                                                   |
| ----------------------------------------- | --------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPECTED_ROUTES`                         | 5 notification routes | **+1** (`POST v1/members/notifications/read`) | Added with the RI-3 reasoning in a comment.                                                                                                           |
| `discovered exactly N routes`             | —                     | passes                                        | Derived from `EXPECTED_ROUTES.length`.                                                                                                                |
| `MIN_TOTAL_PAYLOAD_PARAMS`                | 77                    | **78**                                        | **Mechanically re-derived**, not eyeballed.                                                                                                           |
| `NAMED_PRIMITIVE_PARAM_COUNT`             | 6                     | **6**                                         | Unchanged — asserted by exact equality and it passed untouched.                                                                                       |
| `UNVALIDATED_DEBT`                        | `[]`                  | `[]`                                          | Unchanged.                                                                                                                                            |
| `PREFIX_EXCEPTIONS` / `KNOWN_PREFIX_DEBT` | floor                 | floor                                         | Same controller prefix; RI-1 still sees `v1/members/notifications` once.                                                                              |
| `KNOWN_CONTESTED`                         | `[]`                  | `[]`                                          | Four segments vs five.                                                                                                                                |
| `controller-registry.ts`                  | 40 entries            | **40**                                        | 🔴 **No change needed** — one route on an EXISTING controller, no new `*.controller.ts`, so the file census assertion is untouched.                   |
| `contract-boundary.spec.ts`               | green                 | green                                         | The new contract import is `member/ → shared/`, which R-CONTAIN permits; the barrel gained re-exports only, so R-BARREL still sees zero declarations. |

**The `MIN_TOTAL_PAYLOAD_PARAMS` derivation, by the file's own documented procedure:**

```
$ # set the constant to 9999
$ npx nx test ptah-license-server --skip-nx-cache --testPathPatterns=controller-validation
  ● … › anti-vacuity › discovers at least 9999 payload params server-wide
    Expected: >= 9999
    Received:    78
$ # restore to 78 and write the breakdown
```

The breakdown closes: `71 + 1 = 72` whole-object, `72 + 6 = 78` total. The docblock records that the obvious alternative shape (`?ids=a,b,c`) would have read 78 against a named count of **7**, and the arithmetic would not have closed — which is the third reason the ids are a `@Body()`.

---

## 7. 🔴 The deliberate-failure proof — run twice, as a test AND live

**Mutation**: delete `userId: ctx.userId` from `markManyRead`'s `where`. Nothing else.

### 7.1 Unit half — EXACTLY three red, all three about ownership

```
Test Suites: 1 failed, 4 passed, 5 total
Tests:       3 failed, 147 passed, 150 total

● NotificationsService › 🔴 RISK-AH … › markManyRead puts userId AND the id set in one where
● NotificationsService › 🔴 RISK-AH … › 🔴 identity B cannot mark identity A's notifications read in bulk
● NotificationsService › 🔴 RISK-AH … › naming ONLY another member's ids answers exactly what naming nothing real answers
```

**The 147 that stayed green are the interesting half.** Every other assertion about this endpoint — the partial-selection test, the already-read test, the duplicate test, the empty-selection test, the whole controller spec, all nine live-mirrored validation cases — passed against a service that lets any member mark any other member's notifications read. Each of those uses **one** identity, so none of them can see the leak. The ownership property is carried by exactly those three tests and by nothing else, which is why the dispatch was right to demand two distinct identities.

### 7.2 Live half — the vulnerability, demonstrated against Postgres

Rebuilt, restarted on `:3011`, reset all seven rows to unread, replayed the **identical** O-1 request:

```
BLIND  : {"marked":3}  HTTP=200
b15c_a1|READ      🔴 ALICE'S ROW, MARKED READ BY BOB
b15c_a2|READ      🔴 ALICE'S ROW, MARKED READ BY BOB
b15c_b1|READ
```

### 7.3 Reverted, and confirmed

```
$ git diff libs/api/notifications/src/lib/notifications.service.ts | grep "^-"
--- a/libs/api/notifications/src/lib/notifications.service.ts
- * `markRead` and `markAllRead` are `updateMany` with `userId: ctx.userId` in the
```

**The only deleted line versus HEAD is the one class-docblock line I intentionally rewrote.** The mutation left no residue. `where: { id: { in: [...ids] }, userId: ctx.userId, readAt: null }` is restored verbatim.

Rebuilt and restarted a third time; the identical request against the restored server:

```
FIXED  : {"marked":1}  HTTP=200
b15c_a1|UNREAD   b15c_a2|UNREAD   b15c_b1|READ
```

**Same request, same fixtures, opposite outcome.** The mutation/restore cycle is proven at the HTTP layer, not only in Jest.

---

## 8. Final gate — actual output

```
$ npx nx run-many -t eslint:lint,typecheck,test \
    -p api-notifications,api-contracts-community,ptah-license-server --skip-nx-cache

  api-contracts-community   Test Suites: 2 passed / Tests:  33 passed   (unchanged)
  api-notifications         Test Suites: 5 passed / Tests: 150 passed   (+22: 12 new
                              controller `it`s, two `it.each` tables 4→5, 8 new service `it`s)
  ptah-license-server       Test Suites: 5 passed / Tests: 158 passed   (unchanged — I
                              added no test there, only re-derived two constants)

  eslint: 0 errors.
    2 warnings, BOTH pre-existing, in apps/ptah-license-server/jest.config.ts and
    src/instrument.ts — neither file was touched by this change.

  NX  Successfully ran targets eslint:lint, typecheck, test for 3 projects
```

`--skip-nx-cache` and explicit project lists on every run. **`nx affected` was never used.** The structural gates were additionally run in isolation (`--testPathPatterns="controller-validation|route-map"` → 2 suites / 63 tests, all green).

---

## 9. Notable implementation details a reviewer should look at first

1. **`libs/api/notifications/src/lib/notifications.service.ts` — `markManyRead`.** Three lines of code and forty of docblock, and the ratio is right: the code is `updateMany` with three `where` clauses, and every one of them is load-bearing in a way that is invisible from the call site.
2. **`notifications.service.spec.ts` — `isInFilter` / `matches`.** The stateful double now models `{ in: [...] }` **and throws loudly on any operator it does not model**, so an implementation reaching for `not`/`gte`/`contains` fails with a named error instead of matching zero rows and passing quietly.
3. **`mark-notifications-read.dto.ts`.** Six decorators, each with its own recorded failure mode. The one worth reading is `@IsArray()`: without it a bare string `"n_1"` is spread by `[...ids]` into `['n','_','1']`, `in` matches nothing, and the failure is a silent `{"marked":0}` rather than an error anyone sees.
4. **The contract's "no Zod schema" decision** is argued in the file, in the terms the file already uses, rather than being a silent omission.

---

## 10. Carried forward to Batch 15B

1. 🔴 **15A's §5.3 guarded rule can now be deleted.** `store.markSelectedRead(ids)` currently issues `read-all` only when it is _provably equivalent_ to the selection, and otherwise N `markRead` calls. Both branches are now obsolete: `POST read` is one request that means exactly what the toolbar says, in every case, including the partial one. 15B should replace the whole rule with a single call.
2. **`MAX_BULK_MARK_READ_IDS` is exported from `@ptah-contracts/community`** — import it rather than hard-coding 50, and note it is _derived_ from `MAX_PAGE_SIZE`, so a client that guards on `MAX_PAGE_SIZE` and a client that guards on the cap agree by construction.
3. **The response `{ marked }` should stay unparsed**, consistent with the other two writes: decrement optimistically, then re-read `GET .../unread-count`. `marked` is "rows this call moved", **not** the new unread count.
4. **An empty selection must never be sent** — it is a `400`. `SelectionToolbar` renders nothing at 0, so no new client guard is required; do not add one that turns the `400` into a silent no-op.
5. **`inFlightWrites` as a counter (15A §5.2) is still correct** even though the bulk path is now one request — the single-row `markRead` path still issues several concurrent writes when a member opens rows quickly.
6. **`:3000` is still the OLD container** and does not serve this route. Any 15B live check must build and run its own server on another port.
