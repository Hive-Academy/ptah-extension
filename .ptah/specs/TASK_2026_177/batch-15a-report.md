# Batch 15A report — P5-FE tasks 15.1–15.7

**Executor**: `frontend-developer` · **Date**: 2026-08-10
**Scope**: tasks 15.1 → 15.7 only. **Stopped at 15.7 as instructed.** 15.8–15.11 are Batch 15B.
**Commits made**: **NONE.** No `git add`, `git commit`, `git stash` or `git checkout` was run at any point.

---

## 0. Executive summary — the eleven lines that matter

1. **All seven tasks complete and green.** `web-members` 38 suites/706 tests → **44/869**; `web-panel-ui` 3/19 → **4/32**; `web-core` 4/25 unchanged. Zero lint errors, and **zero lint warnings in both projects I touched** (they had zero at baseline; I introduced four and removed all four).
2. 🔴 **Ground truth 14 told me to re-measure the baselines because B13's were "32 commits stale". They were re-measured and they are IDENTICAL** — 38/706, 3/19, 4/25, and the same two build warnings at the same 1.32 MB. The premise that they had drifted is itself the stale thing. Details in §2.
3. 🔴 **THE BIGGEST FINDING: Task 15.6's bulk mark-read design cannot be built as written without irreversible data loss.** The server has only "mark ONE row" and "mark THE ENTIRE INBOX" — there is no "mark these ids" endpoint and **no un-read endpoint at all**. Issuing `read-all` for a partial selection, as the task's validation note asks, destroys unread state the member never selected and it cannot be undone. Resolved with a guarded rule; full reasoning in §5.
4. 🔴 **Second finding: `unreadCount` is an AMBIGUOUS IDENTIFIER in `libs/web/members`.** The community domain already owns a different `unreadCount` (per-topic unread replies, A-6) across five pre-existing files. RISK-AN's prescribed structural spec — "assert `unreadCount()` is read in exactly one file" — **fails on correct code** as written. Scoped by TYPE instead. §6.
5. 🔴 **Third finding: RISK-AN's other prescribed assertion — "zero `badge-` classes outside panel-ui" — also fails on correct code.** `member-layout.html` renders cohort chips, `unread-pill.ts` renders per-topic unread, three hub cards carry their own. Re-scoped to what R9.3 actually forbids. §6.
6. 🔴 **Fourth finding: `GET /v1/members/packs?page=1` returns `200`, not `400`.** Task 15.2 justifies "send no params" on the assumption the server would reject them. It would not — the controller binds no DTO, so `forbidNonWhitelisted` never runs. The discipline is real but the stated reason was wrong. §4.
7. **A real bug in my own first draft, caught by my own spec**: the notifications page label computed `page * pageSize` for its upper bound, which claims rows that are not on screen for any short page. Fixed to derive from the rendered rows. §5.4.
8. **`@axe-core/playwright` (ground truth 5) and `EmptyState`'s `/40` hint (B13's F-1)**: F-1 is **already fixed** in `empty-state.html` — the hint is `/60`. The remaining `/40` is on the `aria-hidden` decorative glyph, which is legal. My contrast assertions are scoped to **text-bearing elements**, which is the distinction RISK-AR says was drawn but never enforced. §7.
9. **Seven deliberate-failure proofs**, each making exactly the intended assertion(s) red, each reverted and `diff`-confirmed **byte-identical**. §8.
10. **Live verification against a real server on `:3011`.** All six Batch-14 routes mapped, packs and notifications driven end-to-end through the real forum producer. **DB returned to its exact pre-batch census.** Server stopped **by PID identity, never by port**; both containers `Up (healthy)`. §3.
11. **The foreign file list grew again, as predicted.** `libs/frontend/editor/**` is now foreign (6 files) and HEAD moved `54650edee` → `6df1984a7` during this dispatch. §1.2.

---

## 1. File set

### 1.1 Mine — 4 modified, 14 new

**Modified (4):**

| File                                                                   | Why                                                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/web/members/src/lib/member-layout/member-layout.ts`              | Task 15.7 — the `badgeCount` binding inside the EXISTING `navGroups` computed, plus injecting the store and calling `start()` once.                                      |
| `libs/web/members/src/lib/members.routes.ts`                           | Task 15.4 — `providers: [MemberNotificationsStore]` on the `/members` parent route. **Nothing else touched**; no placeholder route was swapped (that is 15.8/Batch 15B). |
| `libs/web/members/src/lib/member-layout/member-nav-admin-link.spec.ts` | Consequential: it `createComponent`s `MemberLayout` directly, which now needs the route-level provider.                                                                  |
| `libs/web/members/src/lib/member-guard-wiring.spec.ts`                 | Consequential: the panel now polls, so `httpMock.verify()` saw unread-count requests. **Answered, not weakened** — see §9.1.                                             |

**New (14):**

- `libs/web/members/src/lib/services/member-packs-api.service.ts` + `.spec.ts` (15.2)
- `libs/web/members/src/lib/services/member-notifications-api.service.ts` + `.spec.ts` (15.3)
- `libs/web/members/src/lib/state/member-notifications.store.ts` + `.spec.ts` (15.4)
- `libs/web/members/src/lib/packs/packs-page.ts` + `.spec.ts` (15.5)
- `libs/web/members/src/lib/notifications/notifications-page.ts` + `.spec.ts` (15.6)
- `libs/web/members/src/lib/notifications/notification-fixtures.ts` (15.3/15.6 — shared, live-captured)
- `libs/web/panel-ui/src/lib/selection-toolbar/selection-toolbar.spec.ts` (15.6 — its FIRST spec)
- `libs/web/members/src/lib/member-layout/member-nav-badge.spec.ts` (15.7)

🔴 **Nothing outside `libs/web/members/**`and`libs/web/panel-ui/**` was touched.** No `tsconfig.base.json`, no `nx.json`, no `eslint.config.mjs`, no `package.json`, no barrel edit (`SelectionToolbar` and `TagChip` were already exported — ground truth 3/4 confirmed accurate), no `.ptah/specs/` file including this task's own `tasks.md`.

### 1.2 🔴 The foreign footprint — RE-DERIVED AT THE END. It grew again.

**HEAD moved during this dispatch: `54650edee` → `6df1984a7`** (`perf(shared): unify workspace scan exclusions behind one predicate`).

Foreign at the START of my dispatch (already changed from the briefing): `libs/shared/**`, `apps/ptah-electron/**`, `apps/ptah-electron-e2e/**`, four `.ptah/specs/` carriers, `marketing/`.

**Foreign at the END — the delta:**

- ✅ **Gone** (committed by the concurrent session): `libs/shared/src/index.ts`, `libs/shared/.../workspace-scan.constants.*`, all `apps/ptah-electron*/**`.
- 🔴 **NEW and foreign**: `libs/frontend/editor/**` — `editor-panel.component.ts` + `.spec.ts`, `source-control-file.component.ts`, `source-control-panel.component.ts`, and two NEW spec files `source-control-{file,panel}.component.spec.ts`.
- 🔴 **NEW and foreign**: `.tmp-ac6/` (untracked directory), `.ptah/specs/TASK_2026_173/{tasks.md,batch-6-dispatch.md}`, `.ptah/specs/TASK_2026_{171,179,187,197}/.harvested.json`.
- Still foreign: `marketing/scripts/01-open-source-announcement.md`, `.ptah/specs/TASK_2026_{179,184}/task.md`, and **`.ptah/specs/TASK_2026_177/tasks.md` (20 insertions / 20 deletions — NOT mine, present before I started)**.

**Guidance for the team-leader's commit**: stage `libs/web/members/**` and `libs/web/panel-ui/**` explicitly. **Never `git add .` and never `git add .ptah/specs`.**

---

## 2. Task 15.1 — pre-flight, and the stale premise in ground truth 14

### 2.1 🔴 The baselines were re-measured at HEAD and are IDENTICAL to B13's

Ground truth 14 says B13's figures are "32 commits stale and are not the comparison". Measured before the first edit:

```
$ npx nx run-many -t lint,typecheck,test -p web-members,web-panel-ui,web-core --skip-nx-cache
  web-core        Test Suites:  4 passed / Tests:  25 passed     (B13: 4 / 25)
  web-panel-ui    Test Suites:  3 passed / Tests:  19 passed     (B13: 3 / 19)
  web-members     Test Suites: 38 passed / Tests: 706 passed     (B13: 38 / 706)
  NX Successfully ran targets lint, typecheck, test for 3 projects
  (lint: 0 errors. 5 warnings, ALL in web-core. web-panel-ui and web-members: ZERO.)
```

```
$ npx nx build ptah-landing-page --configuration=production
  Initial total  1.32 MB  |  313.67 kB gzipped
  ▲ WARNING bundle initial exceeded maximum budget. Budget 1.00 MB not met by 317.48 kB (total 1.32 MB).
  ▲ WARNING node_modules/@fullcalendar/angular/skeleton.css exceeded 4.00 kB budget by 16.71 kB (total 20.71 kB).
```

🔴 **Every figure matches B13's exactly, including the two build warnings.** `TASK_2026_187`'s bundle work did not move the landing page's initial total. The instruction to re-measure was right; the assumption behind it was not.

**Baseline for `web-members` lint is ZERO warnings** — which is why I removed the four I briefly introduced (§9.2) rather than leaving them.

### 2.2 Live environment — `:3000` is still the OLD container

```
$ docker ps
ptah_license_server  0.0.0.0:3000->3000/tcp  Up 2 hours (healthy)
ptah_postgres        0.0.0.0:5432->5432/tcp  Up 2 hours (healthy)
```

Built and ran my own on **`PORT=3011`**. All six Batch-14 routes mapped:

```
[RouterExplorer] Mapped {/api/v1/members/packs, GET}
[RouterExplorer] Mapped {/api/v1/members/notifications, GET}
[RouterExplorer] Mapped {/api/v1/members/notifications/unread-count, GET}
[RouterExplorer] Mapped {/api/v1/members/notifications/:id/read, POST}
[RouterExplorer] Mapped {/api/v1/members/notifications/read-all, POST}
[NestApplication] Nest application successfully started
$ curl -s -o /dev/null -w '%{http_code}' http://localhost:3011/api/health
200
```

**V-CURL passed — the batch has a backend to build against.**

### 2.3 Pre-batch census — and a schema correction

```
users=0 licenses=0 subs=0 packs=0 mv_true=0 notifs=0 audit=0 topics=9 posts=10 cats=4 groups=1
```

⚠️ **14C's report names the forum tables `topics` / `posts`. Those relations DO NOT EXIST.** They are `community_topics` and `community_posts` (`select ... from topics` → `ERROR: relation "topics" does not exist`). The counts 9/10 match 14C's, so only the names in that report were loose. Recorded here so 15B's teardown SQL does not inherit the wrong identifiers.

### 2.4 Identities and fixtures

Two identities by known id (A = Ada Lovelace, B = Grace with `last_name` NULL, for ASSUMPTION-22), two `builders` **`licenses`** rows, three packs (visible+labelled / visible+unlabelled / hidden, **all three** carrying `notes='B15A-ADMIN-ONLY-SECRET'`), and a real topic + opening post owned by A in the member-visible `general` category.

**JWTs were minted IN MEMORY and written to a shell-sourced file under `/tmp` that was deleted at teardown. No token file remains anywhere in the repo** (B13's residue finding).

---

## 3. 🔴 Live verification — actual output

### 3.1 Packs — R5.1, R5.5, A-1, NFR-S5, all live

```json
$ curl -b "ptah_auth=$TOKEN_A" .../v1/members/packs
[{"id":"b15a_pack_labelled","slug":"b15a-labelled","title":"B15A Labelled Pack",
  "description":"Visible and cohort-labelled.","repoUrl":"https://github.com/x/labelled",
  "tags":["agents","nx"],"cohortName":"Founding Members",
  "accessNote":"Invite lands within 24h of your GitHub handle being shared."},
 {"id":"b15a_pack_unlabelled",...,"tags":[],"cohortName":null,"accessNote":null}]
HTTP=200

$ curl ... | grep -c "B15A-ADMIN-ONLY-SECRET"
0
```

**Three packs seeded, TWO returned, the cohort-labelled one among them — to a member holding ZERO cohort assignments.** A-1 confirmed live: `cohortName` grants nothing. `notes` appears **zero** times. Guard chain: no cookie → `401`.

🔴 **`accessNote` is `null` on the unlabelled pack.** ASSUMPTION-27 is not hypothetical — the null path is the one that ships, which is why `DEFAULT_ACCESS_NOTE` exists and why the fallback has its own DOM-order test.

### 3.2 Notifications — driven through the REAL producer

Empty state first (`{"items":[],"page":1,"pageSize":25,"total":0,"hasMore":false}`, `{"unreadCount":0}`), then B replied to A's topic over HTTP → `201`, and A read back:

```json
{ "items": [{ "id": "cmsnaworh0001u0bi8w9c0yv8", "kind": "topic.reply", "actorName": "Grace", "targetType": "Topic", "targetId": "b15a_topic", "title": "New reply to your topic", "bodyPreview": "**Grace here** — a real reply driving the real producer.", "route": "/members/community/topics/b15a-topic", "readAt": null, "createdAt": "2026-08-10T14:02:38.814Z" }], "page": 1, "pageSize": 25, "total": 1, "hasMore": false }
```

- `actorName: "Grace"` — composed from `first_name` with `last_name` NULL, **never an email** (ASSUMPTION-22 / NFR-S4 confirmed).
- **No `userId`, no `actorId`** on the wire.
- `bodyPreview` carries **literal `**`markdown, unsanitized** — B14 ground truth 4 confirmed. This is why`notification-fixtures.ts`keeps the asterisks: a fixture of plain prose would make an`[innerHTML]` regression invisible.
- `route` = `/members/community/topics/b15a-topic` — passes `/^\/members\//`.

### 3.3 The write endpoints and the edge cases

```
POST .../<id>/read        -> {"readAt":"2026-08-10T14:02:49.470Z"}  HTTP=200   (200, NOT 201 — pinned)
POST .../read-all         -> {"marked":0}                            HTTP=200
GET  ...?pageSize=51      -> HTTP=400                                (rejects, does NOT clamp)
GET  ...?page=2&pageSize=10 -> {"items":[],"page":2,"pageSize":10,"total":1,"hasMore":false}
GET  /v1/members/packs?page=1 -> HTTP=200                            🔴 see §4
GET  /v1/members/packs (no cookie) -> HTTP=401
```

🔴 **`read-all` answered `{"marked":0}`** immediately after the single row had been marked read individually. **`marked` is "rows this call touched", NOT "the new unread count."** A client conflating the two would zero a badge that should not have moved — which is exactly why the service returns `void` and the store re-reads `unread-count` instead.

### 3.4 Teardown, with a census

```
DELETE 1 (notifications) · 2 (community_posts) · 1 (community_topics) · 3 (packs) · 2 (licenses) · 2 (users)

users=0 licenses=0 subs=0 packs=0 mv_true=0 notifs=0 audit=0 topics=9 posts=10 cats=4 groups=1
```

🔴 **Byte-identical to the pre-batch census**, including Batch 8's 9 topics / 10 posts and the 4 categories / 1 member group. One `BEGIN`/`COMMIT`, every `DELETE` scoped by id or by the `b15a_` prefix. **No `TRUNCATE`, no unqualified `DELETE`. `admin_audit_log` is 0 and I deleted nothing from it** — this batch writes no audit row, so unlike 14A there was no residue and no judgement call.

### 3.5 🔴 The server was stopped BY PID IDENTITY, never by port

The backgrounded shell's `$!` gave **7746**, which was the shell job — killing it left `:3011` answering `200`. The real process was found by cross-checking **two independent sources**:

```
$ grep -oE "\[Nest\] [0-9]+" server.log   ->  [Nest] 21816
$ netstat -ano | grep ":3011" | grep LISTENING
  TCP 0.0.0.0:3011 ... LISTENING  21816
$ tasklist /FI "PID eq 21816"  ->  node.exe  21816
$ taskkill /PID 21816 /F       ->  SUCCESS
```

Both sources agreed on 21816, so this was killing **my process by identity**, not "whatever holds the port". Docker proxies `:3000` and `:5432`, not `:3011`. Verified afterwards:

```
HEALTH_3011=DOWN   HEALTH_3000=200
ptah_license_server  Up 3 hours (healthy)
ptah_postgres        Up 3 hours (healthy)
```

**Nothing Docker owns was touched.**

---

## 4. Task 15.2 — `MemberPacksApiService` ✅

One method, bare array, `z.array(memberPackSchema)` imported from `@ptah-contracts/community` and never re-declared. No signals, no cached state, relative URL. **14 tests.**

Also exports `DEFAULT_ACCESS_NOTE` and `accessNoteFor(pack)` as free functions beside the class (the `feedItemKey` / `formatDuration` idiom), so the null-collapse is unit-testable without a component and one place decides what "no access note" reads as.

### 🔴 Stale premise: the "no pagination" justification was wrong

Task 15.2 says a client sending pagination "is describing a different endpoint", and the sibling `member-live-api.service.ts` guards its params because the server answers `400`. **Measured live: `GET /v1/members/packs?page=1` returns `200`.** `MemberPacksController` binds no DTO, so the global `forbidNonWhitelisted` never runs on it.

The rule is still right; the _reason_ is not. So the spec asserts the **absence of parameters directly** — `request.request.params.keys()` is `[]` and `urlWithParams` equals the bare URL — rather than relying on a rejection that would never arrive. The service imports no `HttpParams` at all, and the docblock records the measurement.

Also asserted: an empty array parses (the empty cell depends on it arriving as _data_, not as an error); a body missing `accessNote` or `repoUrl` throws naming the endpoint and the field; an unknown key is stripped; **and a body that DOES carry `notes` has it stripped**, with a whole-shape assertion that the parsed object holds exactly the eight contract keys.

---

## 5. Tasks 15.3, 15.4, 15.6 — the services, the store, the inbox

### 5.1 `MemberNotificationsApiService` ✅ — 22 tests

Four methods. `unreadCount()` parses through **`hubNotificationSummarySchema`** — the same schema the hub section uses, one shape, one parse, two callers. Page params sent only when supplied; `pageSize > MAX_PAGE_SIZE`, `page < 1` and fractional values throw `RangeError` **before** any request (asserted with `http.verify()`); `MAX_PAGE_SIZE` itself is accepted, so the inclusive boundary is pinned.

**The two writes return `Observable<void>` and parse nothing** — the contract says so in terms, and §3.3's live `{"marked":0}` shows why reading `marked` as a count would be wrong. Both are asserted to resolve even against an undeclared body.

### 5.2 `MemberNotificationsStore` ✅ — 41 tests

`@Injectable()` **without** `providedIn`, carrying `CoursePlayerStore`'s eslint-disable and its justification. `POLL_INTERVAL_MS = 60_000`. Timer started by explicit `start()` (idempotent), cleared in `DestroyRef.onDestroy`. Eager fetch on `NavigationEnd` from **one** subscription.

**Two deviations from the task text, both strengthening:**

- 🔴 **`takeUntilDestroyed(this.destroyRef)` on the router subscription.** Task 15.4 names only the interval. `Router.events` **never completes**, so an unbound subscription outlives the panel exactly as surely as a leaked timer — the same leak class through a different door. There is a dedicated test: _"after destroy, a NavigationEnd issues no request either."_
- 🔴 **`inFlightWrites` is a COUNTER, not a boolean.** A partial bulk selection issues several `markRead` calls at once (§5.3); with a boolean the FIRST response clears the flag while the others are outstanding, the poll resumes mid-batch and reads a count the remaining writes have not yet reduced — RISK-AP's flicker through the one door a boolean leaves open.

RISK-AO is table-driven over five routes including **`/members-evil/x`**, which I added: `/^\/members/` without the trailing slash would admit it, and would also admit `//evil.example`. A refused route still marks read, still logs, and — asserted separately — an **accepted** route logs nothing, so the warning is not unconditional. The store also refuses to decrement for an already-read row.

### 5.3 🔴 Task 15.6's bulk mark-read cannot be built as specified. This is the batch's most important finding.

**Task 15.6's validation note**: _"assert bulk mark-read issues **one** `read-all`-shaped request rather than N."_

**The server offers exactly two writes** (`member-notifications.controller.ts`):

- `POST :id/read` — one row
- `POST read-all` — **the member's ENTIRE INBOX**, across every page

There is **no "mark these ids read" endpoint, and no "mark unread" endpoint at all.**

So a `SelectionToolbar` — a control whose entire semantic is _"act on the N things I selected"_ — has no API that can honour it. Issuing `read-all` for a partial selection marks rows read that the member did not select, **including rows on pages they have never seen**, and because nothing can un-read a row, **that destruction is permanent**.

**Resolution — `store.markSelectedRead(ids)` uses `read-all` only when it is provably equivalent to the selection**: every unread row is selected **AND** the loaded page is the whole inbox (`page === 1`, `hasMore === false`, `total === items.length`). Otherwise it issues one `markRead` per selected row.

That gives the task's note what it was actually after — the common "select all, mark read" case costs **one** request — while making the destructive case impossible. Three tests pin it, including _"selecting every row on a page that is NOT the whole inbox avoids read-all"_ (`hasMore: true` means unread rows exist on pages the member has never seen).

**Between one request that does more than it was asked and N requests that do exactly what was asked, on an irreversible operation, N is correct.** Flagging for the team-leader: **the clean fix is a server-side `POST notifications/read` taking an id array.** That is backend work and out of my scope (RK-1).

### 5.4 `NotificationsPage` ✅ — 35 tests · and a real bug my own spec caught

Four-cell branch discipline; `bodyPreview` interpolated only (asserted: `**bold**` shows literally, `<img src=x onerror=...>` arrives as characters, no `ptah-markdown-block`, source contains no `innerHTML`/`bypassSecurityTrust`/markdown import); unread state driven by `readAt === null` **and also carried in text** (`(unread)`/`(read)` in `sr-only`) so it is not colour-alone; no `IntersectionObserver` (ASSUMPTION-28, asserted against the source); open delegates entirely to `store.openRoute` — asserted that a hostile route arriving _through the page_ is still refused, so the page has not become a second door.

🔴 **A genuine bug in my first draft.** The page label computed its upper bound as `min(page * pageSize, total)`. For a **short page** — a last page, or one thinned by a concurrent delete — that claims rows that are not on screen: one item at page 2 of size 10 rendered _"Showing 11–20 of 30"_. Fixed to derive from the rows actually rendered. Both cases are now tested (short page → `11–11`; full page → `11–20`, the anti-vacuity half proving the fix did not simply always report one row).

### 5.5 `SelectionToolbar` — its FIRST spec ✅ — 13 tests

Ground truth 4 is accurate: it exists, is exported, has four admin consumers and **had no spec**. Pins the properties consumers rely on without being able to see them — it renders nothing at 0 (so no consumer needs its own `@if`; also verified for a negative count, since the guard is `> 0`), the noun pluralises, `cleared` emits without the bar mutating its own input, the region is labelled `Bulk actions`, and projected content lands **inside** the landmark and is not duplicated across re-renders.

**This is a cross-panel improvement benefiting the four existing admin consumers.** As Task 15.6 asks, and in the shape of B13's F-1: **it should be committed separately so it stays revertible independently of the member batch.**

---

## 6. Task 15.7 — the badge ✅ — 18 tests

**No template and no primitive were written.** Ground truths 1 and 2 are both accurate. The only production change is inside the existing `navGroups` computed: `MEMBER_NAV_GROUPS` is **mapped** to new objects at every level (group → items → the one item) with `badgeCount` replaced, then the admin branch **composes with** the badged array. `0` is passed, never `undefined` — the shell's `@if (item.badgeCount)` does the hiding.

The item is matched **by route**, not by label or index: a label is display copy a copy-edit may change, an index breaks when a group gains an item, and **both fail silently**, leaving the badge attached to nothing or to the wrong link.

Rendering tests assert the count appears, **moves** with the signal, **disappears at 0**, renders through the **SECONDARY** branch specifically (asserted via the `pl-8` indent — a test written against the primary branch passes for the wrong item), that no other nav item gains a badge, and that **`MEMBER_NAV_GROUPS` is referentially unmutated** after the computed runs.

### 6.1 🔴 RISK-AN's two prescribed structural assertions BOTH fail on correct code

**(a) "assert `unreadCount()` is read in exactly one file."** The COMMUNITY domain already owns a different `unreadCount` — per-topic unread **replies** (A-6) — in five pre-existing, entirely correct files: `member-community-api.service.ts` (`markReadAckSchema`), `feed-page.ts`, `my-threads-page.ts`, `hub/sections/community-activity-card.ts`, and `components/unread-pill.ts`. The identifier is ambiguous in this lib.

**Fix**: the sweep is scoped **by TYPE, not by name** — a file participates only if it names `MemberNotificationsStore` or `MemberNotificationsApiService`. Within that set, exactly **three** files mention the count, each with one role: the API service **transports** it, the store **owns** it, the layout **reads** it. Asserted as a whole set, so a fourth participant is a diff a reviewer reads. A companion test proves the type-scope actually separates the two `unreadCount`s (community files carry the identifier and are correctly excluded).

**(b) "assert zero `badge-` classes outside `panel-ui`."** This fails today on: `member-layout.html` (cohort chips, `badge badge-primary`), `unread-pill.ts`, `account-page.ts`, `hub-page.ts`, `community-activity-card.ts`, `packs-card.ts`. **None of those is the unread notification count.**

**Fix**: assert what R9.3 actually forbids — **a SECOND RENDERING OF THIS COUNT.** No file may hold both the count and a badge class of its own. Plus: `badgeCount` is written in exactly one file; **no member TEMPLATE binds `unreadCount` or `badgeCount` at all** (templates are where the second chip is cheapest to add and least likely to be caught in review); the nav config remains data; the layout injects rather than constructs; and the store is provided **at the route**, with no component `providers` array naming it — because two instances is two counts and two timers, R9.3's failure arriving through DI.

---

## 7. The `/40` contrast question — B13's F-1 is already fixed, and the enforcement gap is real

My first draft asserted `expect(html()).not.toContain('text-base-content/40')` file-wide. **It failed** — on `EmptyState`'s own glyph:

```html
<lucide-angular aria-hidden="true" class="h-10 w-10 text-base-content/40"></lucide-angular>
```

That is **legal**: `/40` on a decorative, `aria-hidden` icon carries no information a member must read, so no contrast ratio applies. **`EmptyState`'s hint text is already `/60`** — B13's F-1 is fixed in the shipped component.

So the assertion was re-scoped to **text-bearing elements**: every element owning a non-whitespace _direct_ text child, excluding `aria-hidden` subtrees and `<svg>` internals. That is precisely the distinction RISK-AR says B13 _drew but did not enforce_. Run across all four cells on both pages — **including the EMPTY cell**, which is where F-1 hid for three phases — plus an anti-vacuity test proving the walk finds real elements rather than passing over an empty set.

**Task 15.10 (Batch 15B) should adopt this same text-bearing scoping for `empty-state.spec.ts`.**

---

## 8. 🔴 Seven deliberate-failure proofs — every one reverted and `diff`-confirmed byte-identical

| #   | Mutation                                                                                                             | Result                                                                                                                                                                                                | Reverted               |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | 🔴 **Second unread chip added to `member-layout.html`** (`badge badge-error` bound to `notifications.unreadCount()`) | **exactly 1** assertion red — _"no member TEMPLATE binds the count or a badgeCount of its own"_. 17/18 still passed.                                                                                  | `git diff` **0 lines** |
| 2   | **Collapsed RISK-AQ branch order on `PacksPage`** (empty tested before error)                                        | **4** red, all in the RISK-AQ block: the error cell rendered _"No packs are available to you yet"_.                                                                                                   | **byte-identical**     |
| 3   | **`openRoute` navigates unconditionally**                                                                            | **5** red — all four hostile routes in the RISK-AO table plus the logging case. The legitimate route still passed.                                                                                    | **byte-identical**     |
| 4   | **`[innerHTML]` bound on `bodyPreview`**                                                                             | **3** red, incl. **`markdown-chokepoint.spec.ts` → _"no file contains innerHTML"_**.                                                                                                                  | **byte-identical**     |
| 5   | **`DestroyRef.onDestroy` teardown removed** (RISK-AM)                                                                | **exactly 1** red — _"after destroy, advancing PAST 60 s issues NO request"_.                                                                                                                         | **byte-identical**     |
| 6   | **In-flight poll-skip removed** (RISK-AP)                                                                            | **exactly 1** red — _"the poll is SKIPPED while a write is in flight — no flicker"_.                                                                                                                  | **byte-identical**     |
| 7   | 🔴 **`accessNote` moved BELOW the repo link** (R5.5)                                                                 | **2** red — both DOM-order cases. **Crucially, _"the authored note appears"_ STILL PASSED** — proving presence alone is true of the broken version and the ORDER assertion is the one doing the work. | **byte-identical**     |

Proof 7 is the one that justifies R5.5's whole framing: a spec that only checked the text was on the page would have shipped the defect.

---

## 9. Consequential edits to existing specs — answered, not weakened

### 9.1 `member-guard-wiring.spec.ts`

Ground truth 7 predicted this file would break — **but for a different reason** (the `/members/packs` placeholder acquiring a fetch, which is Task 15.8's problem in Batch 15B). It broke **now**, for a new reason: once `MemberLayout` renders it calls `start()`, so `httpMock.verify()` saw three unread-count requests.

Fixed by **answering exactly one known, named endpoint** in `afterEach` before `verify()`. Any request that is not `/unread-count` still fails the check, so every existing assertion keeps full strength — this is ground truth 7's own preferred repair ("answer the request the way the `/members` case does") applied to the cause that actually appeared. **The case at `:232-245` was NOT moved and NOT weakened;** it remains Batch 15B's to resolve.

### 9.2 Lint hygiene

I briefly introduced 5 warnings (4 non-null assertions, 1 unused `eslint-disable`). **All removed** — the `!` assertions became explicit `null` checks that throw a named error, which reads better in a failure anyway. `web-members` and `web-panel-ui` are back to **zero warnings**, matching their baseline.

---

## 10. Final gate — actual output

```
$ npx nx run-many -t lint,typecheck,test -p web-members,web-panel-ui,web-core --skip-nx-cache
  web-core      Test Suites:  4 passed /  25 tests   (baseline 4 / 25   — unchanged)
  web-panel-ui  Test Suites:  4 passed /  32 tests   (baseline 3 / 19   — +1 suite, +13)
  web-members   Test Suites: 44 passed / 869 tests   (baseline 38 / 706 — +6 suites, +163)
  NX Successfully ran targets lint, typecheck, test for 3 projects
  lint: 0 errors. 5 warnings, ALL pre-existing in web-core.

$ npx nx run-many -t lint,typecheck,test -p ptah-landing-page --skip-nx-cache
  Test Suites: 1 passed / 7 tests
  NX Successfully ran targets lint, typecheck, test for project ptah-landing-page
  (17 warnings, all pre-existing in files I did not touch)

$ npx nx build ptah-landing-page --configuration=production
  Initial total 1.32 MB | 313.73 kB gzipped   (baseline 1.32 MB | 313.67 kB)
  ▲ WARNING bundle initial exceeded maximum budget ... 1.32 MB
  ▲ WARNING @fullcalendar/angular/skeleton.css ... 20.71 kB
  NO NEW WARNING.
```

`--skip-nx-cache` and explicit project lists throughout. **`nx affected` was never used.**

⚠️ **The two new pages do not yet appear as build chunks** — nothing routes to them until Task 15.8 swaps the placeholders. Batch 15B should expect two new lazy chunks and re-check the budget then.

Markdown chokepoint: **green, importer list unchanged at SIX**, and proven still able to fail (proof 4).

---

## 11. What I deliberately did NOT do

| Not done                                                                                                              | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Any git operation**                                                                                                 | Hard constraint 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Tasks 15.8–15.11**                                                                                                  | Out of scope — Batch 15B.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Swapping the two placeholder routes / deleting `MemberPhasePlaceholder`**                                           | Task 15.8. I added **only** the `providers` array, which Task 15.4 requires. The pages are therefore written and fully unit-tested but not yet reachable.                                                                                                                                                                                                                                                                                                                                                 |
| **Moving or weakening `member-guard-wiring.spec.ts:232-245`**                                                         | Ground truth 7 — Task 15.8's decision. I fixed only the new breakage I caused.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Touching `libs/frontend/editor/**`, `libs/shared/**`, `marketing/**`, `.tmp-ac6/`, other `.ptah/specs/` folders\*\* | Foreign, active concurrent session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Editing `.ptah/specs/TASK_2026_177/tasks.md`**                                                                      | Not mine; already modified before I started.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Any barrel edit in `panel-ui`**                                                                                     | `SelectionToolbar`, `TagChip`, `EmptyState` are all already exported. The docblock's "10 export lines / 11 symbols" count is unchanged and still correct.                                                                                                                                                                                                                                                                                                                                                 |
| **A markdown renderer on either page**                                                                                | NFR-S2. Importer list stays at six.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Websocket / SSE / push / `Notification` / service worker**                                                          | AD-14. `libs/api/licensing`'s `@Sse` endpoint was neither imported nor extended; the store's source is asserted to contain none of those symbols.                                                                                                                                                                                                                                                                                                                                                         |
| **Fixing `/40` on text in `libs/web/auth` and `libs/web/admin`**                                                      | RK-1 — another surface's. **Reported, not fixed**, per Task 15.10.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Adding a server-side "mark these ids read" endpoint**                                                               | Backend work, RK-1. **Flagged in §5.3 as the clean fix.**                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **A pack detail page, search, tag filter, or pagination**                                                             | Scope boundary; R5.7 means there is nothing more to show.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Approving a design against approved screens**                                                                       | 🔴 Ground truth 8 is accurate: **there is NO approved Packs or Notifications screen.** `docs/design-system/stitch_ptah_builders_member_home/` has member home, community feed, discussion thread, course learning and an admin calendar — none of this batch's surfaces. Both pages were derived from `panel-theme-spec.md` and the shipped member surfaces (`courses-page.ts` for the four-cell discipline, `users-list.html` for the toolbar). **No approved screen was matched, and none is implied.** |

---

## 12. Carried forward to Batch 15B

1. 🔴 **§5.3 — the bulk mark-read API gap.** A server-side `POST notifications/read` taking an id array would let the toolbar mean what it says in one request. Until then the guarded rule stands.
2. 🔴 **§6.1 — RISK-AN's prescribed assertions as written in `tasks.md` do not hold.** 15B should not re-attempt them in their original form.
3. **§7 — adopt text-bearing scoping** for `empty-state.spec.ts` in Task 15.10. **B13's F-1 itself is already fixed**; the enforcement gap is what remains.
4. **§2.3 — the forum tables are `community_topics` / `community_posts`.** 14C's report names them wrongly; 15B's `db.ts` fixtures must use the real names.
5. **§4 — `/v1/members/packs` ignores unknown query params (`200`, not `400`).** Any e2e asserting a rejection there will fail.
6. **§10 — two new lazy chunks** will appear once 15.8 routes the pages; re-check the budget then.
7. **§5.5 — commit `selection-toolbar.spec.ts` separately** so the cross-panel improvement stays independently revertible.
8. **B7's five pre-existing e2e failures** were not re-run in this dispatch (no e2e in 15.1–15.7) and remain Batch 15B's to report unchanged.
