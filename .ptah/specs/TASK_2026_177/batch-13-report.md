# Batch 13 report — P4-FE: live sessions, replays, request-a-session

**Executor**: `frontend-developer` (resumed mid-batch; the predecessor's process was killed
after task 13.9's files were written but before any of them were committed or run end-to-end)
**Date**: 2026-08-09
**Branch**: `ak/license-server-validation-pipe` — never switched, created, rebased, stashed,
reset, or `git checkout <path>`-ed. `--no-verify` never used. Every commit staged by explicit
path; `git add -A` never run.
**HEAD at start**: `89d28fd24`. **HEAD at end**: `db584deaa`.
**Tasks**: 13.1 – 13.10. **All ten complete.**

---

## Verdict, in one paragraph

The Phase-4 frontend half is built, routed, verified and committed, and **all five exit-gate
clauses passed — clauses 1 and 3 LIVE against the real populated calendar feed** rather than
against a fixture. The predecessor's uncommitted work was substantial and, on the whole,
excellent: five of the ten tasks were done to a standard I would not have improved on, and its
docblocks are the best in this lib. **But it was green without being proven, and that distinction
is this batch's finding.** `nx test` passed 700 tests against it; running Task 13.10 for the
first time immediately found **a real WCAG AA contrast failure on a shipping component**
([F-1](#f-1)) and **a test that passed with the exact binding it claimed to guard deleted**
([F-2](#f-2)). Neither was reachable from the unit suite, and both had been sitting behind a
green board. Two further real defects in `RequestSessionPage` ([F-3](#f-3), [F-4](#f-4)) came out
of a review pass. All four are fixed, each with a regression test that was made to fail before it
was allowed to pass. **Five deliberate-failure proofs** were run and reverted byte-identical,
including one that shows the module-boundary rule is genuinely live here rather than green
against a stale graph (B12's F-11). **B12's F-1 is NOT closed and is reported as still open** —
a `page.route()` stub is a client stub, and the `503` branch it protects lives on an admin route
no member surface calls. The test identity was created by known id and **deleted by that id, with
the census proving it**.

---

## Exit gate — every clause, with its evidence

| #   | Clause                                                                                                                                               | Result                             | Evidence                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | The Live surface renders a POPULATED feed — upcoming, a live-now indicator and replays, distinguished by STATE not by source                         | ✅ **LIVE**                        | [The live feed](#the-live-feed-as-the-member-actually-receives-it) · e2e case 1                             |
| 2   | `calendarAvailable: false` renders with NO error shown to the member, asserted in a unit spec AND a Playwright run, AND proven by deliberate failure | ✅                                 | [Proof 1](#proof-1--collapse-risk-zs-branch-order) · e2e cases 4–5                                          |
| 3   | A member sees their own requests and no other member's, proven with TWO identities                                                                   | ✅ **LIVE**                        | [Own-only, live](#own-only-proven-live-with-two-identities) · e2e case 7                                    |
| 4   | Both themes clean, on POPULATED surfaces                                                                                                             | ✅                                 | e2e cases 9–10, `[data-theme]` asserted attached, 3 surfaces × 2 themes                                     |
| 5   | axe pass on all three new surfaces                                                                                                                   | ✅ **after fixing a real failure** | [F-1](#f-1) — failed first, `e9181716f` fixed it, e2e case 11                                               |
| —   | `members.routes.spec.ts` green, zero placeholder routes under `live/*`                                                                               | ✅                                 | `8a761df03`                                                                                                 |
| —   | markdown chokepoint still green **and re-proven to fail**                                                                                            | ✅                                 | [Proof 4](#proof-4--bind-innerhtml-on-member-authored-notes) — importer list unchanged at **six**           |
| —   | `nx lint web-members` green (the Task 4.7 token rule)                                                                                                | ✅                                 | 0 errors, and the boundary rule proven falsifiable ([Proof 5](#proof-5--import-a-backend-lib-from-libsweb)) |
| —   | Batch-4 one-request hub assertion still passing, unchanged                                                                                           | ✅                                 | 4 hub/route suites, 54 tests, untouched                                                                     |
| —   | production build green with **no NEW budget warning**                                                                                                | ✅                                 | [Build](#build) — exactly the two baseline warnings                                                         |

---

## 🔴 The single most important thing in this report

**The inherited work was green and unproven, and "green" hid two real defects.**

The predecessor left 700 passing tests across 38 suites. Every one of them passed. It had also
written the Task 13.10 e2e spec — but had never _run_ it. On its first execution:

- **axe failed clause 5** on `/members/live/request` with a genuine 3.2:1 contrast violation on a
  component that ships in **both** the admin and member panels ([F-1](#f-1)).
- A review pass then found that `request-session-page.spec.ts`'s guard against B7's
  `<select>` trap was **vacuous** — I deleted the `[selected]` binding it exists to protect and
  **all 34 tests stayed green** ([F-2](#f-2)).

Both failures were invisible to `nx test` by construction, and F-1 was invisible to lint as well,
for three compounding reasons that are worth stating because they generalise:

1. The Task 4.7 token lint rule is **scoped to `libs/web/members/**`**. The offending file is in
`libs/web/panel-ui/\*\*`, which no lint rule reads.
2. Batch 10 wrote **six** `expect(html).not.toContain('text-base-content/40')` assertions — and
   every one of them runs against a **consumer's** rendered HTML with a **populated** fixture. The
   empty state therefore never rendered, and all six passed **vacuously**.
3. `panel-ui` had **no spec for `EmptyState` at all**.

**A green unit board across three layers said nothing about a violation sitting in all three.**

---

## Resume point, established by reading the tree against the 10-task list

The brief I was given stated that Part 1 — the decomposition — had not been done. **That was
wrong, and checking it first saved the batch from being re-planned.** `tasks.md` lines 8230–8822
already held a complete, high-quality 10-task breakdown dated 2026-08-09, in the same format
B9–B12 use, with ground truth, a risk table (RISK-Z/AA/AB/AC/AD) and four assumptions. What was
actually missing was the **batch-index row** (still `⏸️ PENDING` at line 37), the header counts,
and any mapping from the decomposition onto the files already on disk.

| Task                                   | State on arrival                                                               | Where it ended up                       |
| -------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------- |
| 13.1 Test identity                     | ✅ predecessor — 2 users, 2 licences, 1 assignment, 1 request, all by known id | torn down, [proven](#residue)           |
| 13.2 `MemberLiveApiService`            | ✅ predecessor, uncommitted                                                    | `5cc1fdd80`                             |
| 13.3 `MemberSessionRequestsApiService` | ✅ predecessor, uncommitted                                                    | `5cc1fdd80`                             |
| 13.4 §5.3 promotion                    | ✅ predecessor — **declined**, both kept private                               | no barrel edit                          |
| 13.5 `SessionCard`                     | ✅ predecessor, uncommitted                                                    | `fc6e30773`                             |
| 13.6 `LivePage`                        | ✅ predecessor, uncommitted                                                    | `fc6e30773`                             |
| 13.7 `ReplaysPage`                     | ✅ predecessor, uncommitted                                                    | `fc6e30773`                             |
| 13.8 `RequestSessionPage`              | ⚠️ predecessor, uncommitted — **two real bugs** (F-3, F-4)                     | `fc6e30773` + fixes                     |
| 13.9 Route swap                        | ✅ predecessor, uncommitted                                                    | `8a761df03`                             |
| **13.10 The proofs**                   | ⏸️ **spec written, NEVER RUN**                                                 | **the true resume point** — `db584deaa` |

---

## Verdict on the inherited work

**Adopted, not redone. Four defects fixed, and I would have shipped the rest as written.**

What was genuinely good, and worth naming because it should be repeated:

- **The RISK-Z branch order in `LivePage` is correct and correctly argued.** `error → loading →
`calendarAvailable === false` → empty → list`, with four distinct renders over the full
  cross-product, `role="status"` never `role="alert"`, and the degraded note reset to `true` on a
  request failure — because a request that failed outright told us nothing about the calendar and
  a stale `false` would render the degraded note underneath the error. That last detail is the
  kind of thing that is normally found in production.
- **`groupByDay` slices the ISO string rather than parsing a `Date`.** Parsing would group by the
  _reader's_ timezone, so the same feed would break into different days for two members and a
  23:00 UTC session would jump a day for anyone east of London. The docblock says so.
- **`feedItemKey` and `formatDuration` are single exported chokepoints** with the unit in the
  parameter name, quoting the contract line each is defending.
- **The `startActivated` input on `YouTubePlayer` is applied through an `effect`, not a
  constructor read** — and its docblock records that the constructor version _was_ the first
  attempt, compiled fine, kept every spec green, and was noticed only by the browser. A signal
  `input()` is bound after the constructor runs, so it read the default for every caller.

Where it was wrong, it was wrong in the way that matters: **the tests it wrote to protect its own
riskiest decisions did not all actually protect them.** F-2 is the clearest case, and the
`live-page.spec.ts` collision test ([F-5](#f-5)) is the same shape.

---

## Baselines vs post-batch

Baselines are ground truth 7's, measured at `5f9572956` **before any B13 edit**. Post figures are
at `db584deaa`, one project at a time.

| Project                 | Baseline suites / tests | Post-batch suites / tests | Δ             |
| ----------------------- | ----------------------- | ------------------------- | ------------- |
| `web-members`           | 32 / 510                | **38 / 706**              | +6 / **+196** |
| `web-panel-ui`          | 2 / 14                  | **3 / 19**                | +1 / **+5**   |
| `web-core`              | 4 / 25                  | 4 / 25                    | unchanged     |
| `ptah-landing-page-e2e` | —                       | **+11 Playwright cases**  | new spec      |

**Total: +201 unit tests, +11 e2e cases.** `web-core` is unchanged in count and identity — this
batch imported from it (`SESSION_TOPICS`, `validate`, `isMembershipRequiredError`) and edited
none of it.

### Lint / typecheck

```
BASELINE (5f9572956, ground truth 7)
  web-members       ✔ clean
  web-panel-ui      ✔ clean
  web-core          5 warnings
  ptah-landing-page 17 warnings
  0 errors anywhere

POST (db584deaa)
  $ npx nx run-many -t lint,typecheck,test -p web-members,web-panel-ui,web-core --skip-nx-cache
    ✖ 5 problems (0 errors, 5 warnings)     <- web-core, the SAME five
    -> Successfully ran targets lint, typecheck, test for 3 projects

  $ npx nx run-many -t lint,typecheck -p ptah-landing-page-e2e --skip-nx-cache
    -> Successfully ran targets lint, typecheck for project ptah-landing-page-e2e
```

**0 errors, and no new warning in any project this batch touched.**

### Build

```
$ npx nx build ptah-landing-page --configuration=production
  Initial total  1.32 MB
  ▲ WARNING  bundle initial exceeded maximum budget. Budget 1.00 MB was not met by 317.48 kB…
  ▲ WARNING  node_modules/@fullcalendar/angular/skeleton.css exceeded maximum budget…  20.71 kB
```

**Exactly the two pre-existing warnings named in ground truth 7, and no third.** The three new
routes are three separate lazy chunks (`loadComponent` each), which is why adding three real
pages moved the initial bundle not at all. Bundle size remains TASK_2026_187's, out of scope here.

---

## Task 13.1 — the environment, live

`V-HEALTH` → `200`. Token minted by signing the documented `JWTPayload` with `JWT_SECRET` from the
workspace-root `.env`, **in memory, never written to a file**, and sent as the `ptah_auth`
**cookie** — never an `Authorization` header (the corrected `V-CURL`).

```
GET /api/v1/members/entitlement (identity A)
  -> 200 {"entitled":true,"cohorts":[{"key":"founding","name":"Founding Members"}],"isAdmin":false}
```

Both entitlement halves exercised: a `licenses` row **and** a `member_group_assignments` row
against the surviving `founding` group, so the cohort-visibility branch of the feed is live rather
than defaulted.

### The live feed, as the member actually receives it

```
[1] GET /v1/members/live -> 200
    keys = calendarAvailable,live,replays,upcoming
    calendarAvailable = true | upcoming 50 | live 0 | replays.total 0 (page 1, pageSize 25)
    distinct titles = 2   |  distinct days = 44
    sources = calendar    |  states = upcoming
    durationSeconds all null? true   |  youtubeVideoId all null? true
    meetLink present on 50 of 50
    duplicate ids within upcoming = 0
    first = {"id":"qhfl5bspa1s0m6tfld2viphv35_20260809T140000Z","source":"calendar",
             "state":"upcoming","title":"PRO ESTATE MEETING",
             "startsAt":"2026-08-09T14:00:00.000Z","endsAt":"2026-08-09T15:00:00.000Z",
             "youtubeVideoId":null,"meetLink":"https://meet.google.com/yef-rhxk-iwz",
             "durationSeconds":null}
```

**Every one of ground truth 1, 2 and 9 confirmed against the running stack**, and two numbers
justify design decisions the plan asked for:

- **50 items, 44 distinct days, 2 distinct titles.** Forty-four of the fifty read
  `PRO ESTATE MEETING`. A flat `@for` over this reads as a rendering bug, which is precisely why
  Task 13.6 groups by day and reveals 25 at a time (RISK-AB). This is not a hypothetical.
- **`durationSeconds` and `youtubeVideoId` are `null` on all 50.** The no-thumbnail, no-runtime
  card is the **default** case in this workspace, not an edge case — `SessionCard` is built to
  look finished with both absent, and a spec pins it.

### Own-only, proven LIVE with two identities

```
[2] GET /v1/members/session-requests as identity A -> 200
    [{"id":"6affc65b-…","sessionTopicId":"orchestration-workflow",
      "additionalNotes":"B13 frontend verification probe.","status":"pending",
      "scheduledAt":null,"durationMinutes":null,"meetLink":null,
      "declineReason":null,"createdAt":"2026-08-09T12:57:17.841Z"}]

[3] GET /v1/members/session-requests as identity B -> 200
    []
```

**Exactly the nine `MemberSessionRequest` keys**, with `calendarEventId` and `paymentStatus`
absent rather than null. Exit-gate clause 3, observed rather than asserted — and it needs two
identities precisely because `MemberSessionRequest` **has no requester field**, so a leak would
render as one of your own requests with no anomaly to see.

🔴 **NO GOOGLE CALENDAR WRITE WAS PERFORMED.** Read paths only. The one live write this batch
made is `POST /v1/members/session-requests`, which writes a DB row and makes no Calendar call.
`accept` / `reschedule` / `decline` were never called.

---

## Deliberate-failure proofs — five, each reverted and confirmed

Task 13.10 asks for at least three.

### Proof 1 — collapse RISK-Z's branch order

```
$ (mutate) } @else if (liveNow().length === 0) {      // drop the calendarAvailable() guard
● LivePage › 🔴 RISK-Z … › CELL 1 — unavailable + empty: says the calendar could not be read,
                                    NOT "no sessions"
Tests: 1 failed, 27 passed, 28 total
$ REVERTED — grep confirms the guard restored
```

One failure, and it is exactly the cell the task exists for: the degraded-calendar case
collapses into "No sessions scheduled yet", which is the lie told to a paying member.

### Proof 2 — track by `item.id`

```
$ (mutate) export function feedItemKey(item) { return item.id; }
● MemberLiveApiService › feedItemKey › 🔴 gives DIFFERENT keys to two items sharing an id
                                          across sources
● MemberLiveApiService › feedItemKey › puts the source first so no two distinct pairs can collide
Tests: 2 failed, 65 passed, 67 total
$ REVERTED
```

### Proof 3 — recompute `state` from a local clock

```
$ (mutate) isLive = computed(() => { const now = Date.now(); return now >= start && now < end; })
● SessionCard › 🔴 RISK-AC … › shows LIVE NOW for state:live even when startsAt is in the FUTURE
● SessionCard › 🔴 RISK-AC … › does NOT show LIVE NOW for state:upcoming even when startsAt is
                                 in the PAST
● SessionCard › 🔴 RISK-AC … › changes the marker when ONLY `state` changes, startsAt held fixed
Tests: 3 failed, 26 passed, 29 total
$ REVERTED
```

**Three failures in BOTH directions**, which is the point — a clock-recomputing card is wrong for
a future `live` item _and_ for a past `upcoming` one, and a test fixing only one of them misses
half the defect.

### Proof 4 — bind `[innerHTML]` on member-authored notes

```
$ (mutate) <dd … [innerHTML]="notes"></dd>     // in request-session-page.ts
● NFR-S2 — one markdown renderer, one sanitizer, across libs/web/members
    › the negative half — no second path from text to DOM › no file contains innerHTML
Tests: 1 failed, 16 passed, 17 total
$ REVERTED
```

The chokepoint is live and the importer list is **unchanged at six** — none of the three new pages
is on it, which is ASSUMPTION-17 holding.

### Proof 5 — import a backend lib from `libs/web`

🔴 **This one exists because of B12's F-11**, which recorded that a green
`enforce-module-boundaries` under `--skip-nx-cache` can be meaningless, and is the most likely
explanation for B9C reporting zero lint errors against a rule that was red for three batches.

```
$ npx nx reset
    Failed to clean up the workspace data directory.
    Error: EPERM … .nx\workspace-data          <- exactly as B12 recorded; graph still refreshes
$ (mutate) import { LiveFeedService } from '@ptah-api/community';   // in live-page.ts
$ npx nx lint web-members
    21:1  error  A project tagged with "scope:web" can only depend on libs tagged with
                 "scope:shared", "scope:web", "scope:api-contracts"  @nx/enforce-module-boundaries
    ✖ 2 problems (2 errors, 0 warnings)
$ REVERTED — grep '@ptah-api' -> 0 hits
```

**The rule is genuinely live in this session, not green against a stale graph.** The EPERM
persisted even after stopping the dev server, so a second Nx process on this branch holds
`.nx/workspace-data` — B12 saw the same, and the refresh still took effect.

---

## Findings

### F-1

🔴 **A REAL WCAG AA FAILURE ON A SHIPPING COMPONENT, found by running the axe pass.**

Exit-gate clause 5 **failed on its first run**:

```
/members/live/request: [{"id":"color-contrast","impact":"serious","targets":[".max-w-sm"],
  "summary":"Element has insufficient color contrast of 3.2
             (foreground #656b79, background #151c27, font size 9.0pt (12px), weight normal).
             Expected contrast ratio of 4.5:1"}]
```

The element is **not this batch's code**. It is `libs/web/panel-ui/src/lib/empty-state/empty-state.html:9` —
the `hint` paragraph, shipped as `text-xs text-base-content/40`. Ground truth 12 states the rule
in terms: _"`/60` or stronger for anything a member must read, `/40` never"_, and
`panel-theme-spec.md` §2 measures `/40` at 3.18:1. axe measured 3.2:1 on the live surface.

**Why it surfaced here and nowhere else**: `EmptyState`'s hint only renders when a surface is
empty. Every prior axe pass ran against a **populated** surface — and on `/members/live` itself
the feed carries 50 real items, so it does not render there either. `/members/live/request` for a
member with no requests is the first empty state anyone pointed axe at.

**Fixed** in `e9181716f`: the hint moves to `/60`. The **decorative icon keeps `/40`** — it is
`aria-hidden`, it is a graphic rather than text, axe does not measure it, and §2 does not forbid
it there. A new `empty-state.spec.ts` (5 tests, the first spec this component has ever had) pins
the hint's token and scopes the `/40` prohibition to `<p>` elements so the icon stays legal.

**This is a cross-panel improvement**: every admin and member surface that renders an
`EmptyState` hint was below AA and now is not.

### F-2

🔴 **A VACUOUS TEST GUARDING THE EXACT TRAP IT NAMES.**

`request-session-page.spec.ts` carried
`'drives its choice through [selected] per option, not [value] on the select'` — B7's finding,
where a `<select>` whose options come from an `@for` in the same change-detection pass silently
resets to the first option. The test drove the select through a helper doing
`element.value = id; element.dispatchEvent(new Event('change'))` and then asserted the matching
option's `.selected`.

**`element.value = id` is a NATIVE `HTMLSelectElement` setter.** The browser marks the matching
option selected itself, with no Angular involvement, before the `change` handler runs. The
assertion therefore passes whether the template binds `[selected]` per option, `[value]` on the
select, or **nothing at all**.

**Proven, not argued**: I deleted the `[selected]` binding from the template and re-ran.

```
$ (mutate) <option [value]="option.id">        // [selected] removed
Tests: 34 passed, 34 total          <- ALL GREEN with the guarded binding gone
```

**Fixed**: the replacement pushes state from the **signal** (`component.topicId.set(…)`) so the
only thing that can move the DOM is the template binding under test, plus a second case asserting
the binding writes **more than once** (a write-once binding would satisfy the first test and still
strand the select on the member's first pick). Both now fail correctly:

```
$ (same mutation, against the new tests)
● … › drives its choice through [selected] per option, not [value] on the select
● … › reflects a topic change back to the DOM when the signal moves again
Tests: 2 failed, 33 passed, 35 total
```

### F-3

**`listNotice` was sticky and outlived every unrelated change to the list.**

It is set in `withdraw()`'s error paths and was cleared **only** at the top of `withdraw()`.
`load()` never touched it. So a member who failed to withdraw one request and then successfully
submitted another kept reading _"That request has already been answered"_ under a list that had
just changed for a completely different reason.

Worse: the notice block sits **outside** the `listError`/`loading`/list `@if` chain, so a failed
reload rendered a retryable error **and** a notice whose copy ends _"The list below is up to
date"_ — simultaneously, contradicting each other.

**Fixed**: cleared on a successful submit and on a load failure, while deliberately **surviving**
the `withdraw → 403 → reload` path, which is the one flow where it must persist. Two regression
tests, both made to fail first.

### F-4

**No two-in-flight guard on withdraw.**

`withdrawing` holds a **single** id and is the disabled-state source for **every** row. Clicking
Withdraw on row B while row A's `DELETE` was still open overwrote it — which re-enabled row A's
button and permitted a second `DELETE` for the same request before the first resolved.

**Fixed**: `if (this.withdrawing() !== null) return;`. The regression test leaves the first
`DELETE` deliberately unflushed, clicks the second row, and asserts no second request was issued;
`http.verify()` in `afterEach` is what makes a stray request fail it.

### F-5

**A RISK-AA collision test that could not fail, kept and supplemented rather than replaced.**

`live-page.spec.ts`'s _"renders BOTH items when a ptah and a calendar item share an id"_ put the
colliding pair into **two different arrays** (`live` and `upcoming`), which render through **two
separate `@for` blocks**. Angular scopes `track` per block, so each block held exactly one item
and never collided — the test passes identically with `track item.id`.

**Fixed by addition**: a second case puts both colliding items in the **same `upcoming` list on
the same calendar day**, so they land in one inner `@for`. That is also the shape the data
actually produces, since a `LiveSession` may claim a Google event id.

### F-6

**A coverage gap on `ReplaysPage`'s fourth cross-product cell**, now closed — and the correct
render there is **not** the same as `LivePage`'s.

`replays-page.spec.ts` had no test for `calendarAvailable: false` **with** an empty archive. The
right answer differs from RISK-Z's: on `LivePage`, "no sessions" beside a degraded note is a lie,
because the missing calendar is exactly where the sessions would have come from. A replay archive
is built **only** from `LiveSession` rows we own — Google contributes no replays — so _"No replays
have been published yet"_ stays **true** whether or not the calendar answered. The correct render
is **both** messages, and the new test asserts both plus the absence of any `role="alert"`.

### F-7

🔴 **B12's F-1 IS NOT CLOSED BY THIS BATCH AND MUST NOT BE RECORDED AS CLOSED.**

B12 recommended closing its F-1 (the `503 scheduling_unavailable` branch, never exercised live) in
"B13's e2e pass with a stubbed `GoogleAuthProvider`". **This batch cannot do that**, and ground
truth 5 says why: the `503` lives on `POST /v1/admin/session-requests/:id/accept`, an **admin**
route **no member surface calls**, and it is unreachable in this workspace precisely because
Google **is** configured.

Clause 2's `page.route()` interception is a **CLIENT** stub. It proves the frontend renders
`calendarAvailable: false` correctly; it says nothing about the server's branch. **F-1 stays open.**
Closing it needs a throwaway container with `GOOGLE_OAUTH_*` unset, or a server-side test that
stubs `GoogleAuthProvider` — backend work, and it belongs to whoever next touches
`session-requests.service.ts`.

### F-8

**Task 13.4's §5.3 promotion was DECLINED, and `panel-ui` has no barrel edit this batch.**

§5.3's bar is _"a primitive earns a place here when a SECOND panel ACTUALLY RENDERS IT."_ Neither
admin consumer (`builders/sessions/sessions-list`, `admin_sessions_calendar`) is in scope (RK-1),
so `SessionCard` stays private at `libs/web/members/src/lib/live/components/`. Same fork Task 10.1
faced with `ProgressMeter`, same resolution.

**`CalendarMonth` is rejected on its own merits, not merely deferred.** A month grid answers
"what is on the 14th"; the server serves **three ordered lists** with no month boundary and a
paged archive spanning years. Building one means either re-fetching per month (a parameter the
endpoint does not take) or paginating a grid client-side. Overruling this needs a server range
filter **first**.

`libs/web/panel-ui/src/index.ts` is **byte-identical**. The only `panel-ui` change is F-1's
contrast fix plus its new spec — deliberately committed **separately** so it stays revertible
independent of the batch.

### F-9

**`libs/web/members/src/lib/__fixtures__/` is still untracked and is still not mine.**

Ground truth 14 names it: 8 Batch-10 leftover markdown files (`week-1.md` … `week-8.md`), and no
spec in the tree references them. **Left untouched**, as instructed.

### F-10

**There is an untracked, zero-byte file literally named `nx` in the repo root.**

`-rw-r--r-- 1 abdal 197609 0 Aug 9 15:57 nx`. Zero bytes, almost certainly a stray shell
redirection (`… > nx`) from another session. **Left alone and never staged**, as instructed. It is
harmless but it will keep showing up in every `git status` until someone deletes it, and it is not
in `.gitignore`.

---

## Deviations summary

| Spec said                                            | Done                                                                                         | Why                                                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| "B13 has no task decomposition; do Part 1 first"     | **Decomposition already existed**; wrote the index row, header counts and resume map instead | It was on disk at `tasks.md:8230–8822`, dated 2026-08-09, in B9–B12 format. Re-planning would have destroyed good work                          |
| Task 13.4 lists `SessionCard` promotion files        | **No `panel-ui` barrel edit**                                                                | F-8 — §5.3's bar not met; `CalendarMonth` rejected on merits                                                                                    |
| `panel-ui` untouched beyond a possible promotion     | **One-token contrast fix + its first spec**                                                  | F-1 — a real WCAG AA failure blocking exit-gate clause 5. In the declared file set (`libs/web/panel-ui/**`), committed separately               |
| Task 13.10 asks for ≥ 3 deliberate-failure proofs    | **Five**                                                                                     | Proof 4 re-proves the markdown chokepoint (a standing gate); Proof 5 answers B12's F-11 about stale-graph boundary checks                       |
| Inherited specs adopted as-is                        | **Four defects fixed** (F-2 … F-6), each falsified first                                     | A test that cannot fail is worse than no test — it occupies the slot                                                                            |
| B12 suggested B13 close its F-1                      | **NOT closed, reported as open**                                                             | F-7 — a client stub cannot prove a server branch                                                                                                |
| Guard-wiring case asserts on `/members/live/replays` | Moved to `/members/packs`                                                                    | That route became a fetching surface; the assertion was failing on an unanswered `GET /members/live` — a routing test failing on a data request |

---

## Files created / modified — absolute paths

**Created**

```
D:\projects\ptah-extension\libs\web\members\src\lib\services\member-live-api.service.ts
D:\projects\ptah-extension\libs\web\members\src\lib\services\member-live-api.service.spec.ts
D:\projects\ptah-extension\libs\web\members\src\lib\services\member-session-requests-api.service.ts
D:\projects\ptah-extension\libs\web\members\src\lib\services\member-session-requests-api.service.spec.ts
D:\projects\ptah-extension\libs\web\members\src\lib\live\live-fixtures.ts
D:\projects\ptah-extension\libs\web\members\src\lib\live\live-page.ts
D:\projects\ptah-extension\libs\web\members\src\lib\live\live-page.spec.ts
D:\projects\ptah-extension\libs\web\members\src\lib\live\replays-page.ts
D:\projects\ptah-extension\libs\web\members\src\lib\live\replays-page.spec.ts
D:\projects\ptah-extension\libs\web\members\src\lib\live\request-session-page.ts
D:\projects\ptah-extension\libs\web\members\src\lib\live\request-session-page.spec.ts
D:\projects\ptah-extension\libs\web\members\src\lib\live\components\session-card.ts
D:\projects\ptah-extension\libs\web\members\src\lib\live\components\session-card.spec.ts
D:\projects\ptah-extension\libs\web\panel-ui\src\lib\empty-state\empty-state.spec.ts
D:\projects\ptah-extension\apps\ptah-landing-page-e2e\src\specs\members-live.spec.ts
```

**Modified**

```
D:\projects\ptah-extension\libs\web\members\src\lib\members.routes.ts
D:\projects\ptah-extension\libs\web\members\src\lib\members.routes.spec.ts
D:\projects\ptah-extension\libs\web\members\src\lib\member-guard-wiring.spec.ts
D:\projects\ptah-extension\libs\web\members\src\lib\learning\youtube-player.ts        (startActivated)
D:\projects\ptah-extension\libs\web\members\src\lib\learning\youtube-player.spec.ts
D:\projects\ptah-extension\libs\web\panel-ui\src\lib\empty-state\empty-state.html     (F-1, one token)
D:\projects\ptah-extension\apps\ptah-landing-page-e2e\src\support\db.ts               (live fixtures)
D:\projects\ptah-extension\.ptah\specs\TASK_2026_177\tasks.md                         (.ptah is gitignored)
D:\projects\ptah-extension\.ptah\specs\TASK_2026_177\batch-13-report.md               (this file)
```

**NOT touched**: `libs/web/panel-ui/src/index.ts` (byte-identical), `tsconfig.base.json`,
`nx.json`, `eslint.config.mjs`, `schema.prisma`, `prisma/migrations/**`, `app.module.ts`,
`route-map.spec.ts`, `controller-registry.ts`, `controller-validation.spec.ts`, `libs/api/**`,
`libs/backend/**`, `libs/frontend/**`, any other app.

---

## Commits

| SHA         | Tasks     | Subject                                                                       |
| ----------- | --------- | ----------------------------------------------------------------------------- |
| `5cc1fdd80` | 13.2–13.3 | `feat(landing): add the member live feed and session request api services`    |
| `fc6e30773` | 13.5–13.8 | `feat(landing): add the session card and the three member live screens`       |
| `8a761df03` | 13.9      | `feat(landing): swap the three member live placeholder routes for real pages` |
| `e9181716f` | F-1       | `fix(landing): raise the empty-state hint to a wcag aa contrast token`        |
| `db584deaa` | 13.10     | `test(landing): prove the member live surfaces against the running stack`     |

Every commit passed the pre-commit hooks and the commit-message validator **without bypass**.
Every one was staged by explicit path; `git add -A` was never run, and
`marketing/scripts/01-open-source-announcement.md` — the user's unrelated in-flight work — was
never staged.

---

## The e2e run

```
$ npx playwright test --config=apps/ptah-landing-page-e2e/playwright.config.ts members-live
  Running 11 tests using 1 worker
  ok  1  🔴 clause 1 — the Live surface renders a populated feed, live-now first
  ok  2  the upcoming schedule is grouped by day, not a flat wall of rows
  ok  3  the reveal button discloses the rest without a second request
  ok  4  🔴 clause 2 — calendarAvailable:false renders the surface with NO error
  ok  5  a degraded calendar with NOTHING to show still does not say "no sessions"
  ok  6  a replay is playable, and no YouTube request fires until it is
  ok  7  🔴 clause 3 — a member sees their own request and NOT another member's
  ok  8  a pending request can be withdrawn
  ok  9  🔴 clause 4 — the live surfaces render in operator-member (NFR-U5)
  ok 10  🔴 clause 4 — the live surfaces render in operator-member-light (NFR-U5)
  ok 11  🔴 clause 5 — axe finds no violations on any of the three surfaces
  11 passed (34.8s)
```

The **first** run of this suite was `10 passed, 1 failed` — clause 5, on the real contrast defect
in [F-1](#f-1). The green run above is after `e9181716f`.

Case 6 is worth naming: it asserts **zero** requests to any YouTube host until the member
activates a replay, then asserts the resulting `<iframe>` has the `youtube-nocookie` origin **and
sits inside `ptah-youtube-player`** — a structural assertion that the embed came out of the one
chokepoint component rather than a second one built on the replays page (NFR-S3, ASSUMPTION-16).

---

## Residue

The database is back to **exactly** its pre-batch state.

```
$ docker exec ptah_postgres psql -U ptah -d ptah_db -c "
    BEGIN;
    DELETE FROM session_requests          WHERE id='6affc65b-5103-4e8b-b8bd-b5c7513bfec8';
    DELETE FROM member_group_assignments  WHERE id='mga_b13_alpha_founding_0001';
    DELETE FROM licenses WHERE id IN ('b1300000-…-0000000000a1','b1300000-…-0000000000a2');
    DELETE FROM users    WHERE id IN ('b1300000-…-000000000001','b1300000-…-000000000002');
    COMMIT;"
BEGIN / DELETE 1 / DELETE 1 / DELETE 2 / DELETE 2 / COMMIT

$ … census AFTER cleanup
 users 0 | licenses 0 | subscriptions 0 | member_group_assignments 0
 live_sessions 0 | session_requests 0 | admin_audit_log 0
 member_groups 1 | courses 1 | community_categories 4 | community_topics 9
```

**The test identity, in full** — created by known id, deleted by that id, in one
`BEGIN`/`COMMIT`. No `TRUNCATE`, no blanket `DELETE`, no `DELETE … FROM users` without a `WHERE`:

| Row                         | Known id                                                                  |
| --------------------------- | ------------------------------------------------------------------------- |
| user A (cohort: `founding`) | `b1300000-0000-4000-8000-000000000001` — `b13-alpha@ptah-batch13.invalid` |
| user B (no cohort)          | `b1300000-0000-4000-8000-000000000002` — `b13-beta@ptah-batch13.invalid`  |
| licence A                   | `b1300000-0000-4000-8000-0000000000a1` (`B13-BUILDERS-ALPHA-0001`)        |
| licence B                   | `b1300000-0000-4000-8000-0000000000a2` (`B13-BUILDERS-BETA-0002`)         |
| assignment                  | `mga_b13_alpha_founding_0001` → `mgrp_founding_seed_0000000000`           |
| session request             | `6affc65b-5103-4e8b-b8bd-b5c7513bfec8`                                    |

The seeded content survives untouched: `member_groups` 1, `courses` 1, `community_categories` 4,
`community_topics` 9 — exactly ground truth 3's figures.

- **The Google Calendar is untouched.** No event was created, patched or deleted. This batch is
  read-only against Google, and the e2e fixtures leave `live_sessions.calendar_event_id` **NULL**
  by design — claiming an id would have changed what the founder's real feed returns for every
  other spec and every developer.
- **The e2e suite tore down its own fixtures completely**: `live_sessions` 0 and no e2e users
  remained before I ran the identity teardown.
- **Predecessor debris deleted**: `tmp-b13-live.json`, `tmp-b13-req.txt`, `tmp-b13-token.cjs`,
  `tmp-b13-tokens.json`. 🔴 **`tmp-b13-tokens.json` held two live signed JWTs** and
  `tmp-b13-token.cjs` was a minting script reading `JWT_SECRET` out of `.env`. Neither was ever
  staged or committed. This session minted its tokens **in memory** and wrote none to disk.
- **All five deliberate-failure mutations reverted** and confirmed restored.

### Final `git status --porcelain`

```
 M marketing/scripts/01-open-source-announcement.md    <- FOREIGN, the user's in-flight work
?? libs/web/members/src/lib/__fixtures__/              <- FOREIGN, Batch-10 leftover (F-9)
?? nx                                                  <- FOREIGN, zero-byte stray (F-10)
```

---

## Carried forward — what B14 and B15 need to know

1. 🔴 **B12's F-1 is STILL OPEN** (F-7). It was expected to close here and cannot. The `503
scheduling_unavailable` branch needs a **server-side** stub of `GoogleAuthProvider` or a
   throwaway container with `GOOGLE_OAUTH_*` unset. It is backend work and belongs to whoever next
   touches `session-requests.service.ts` — **B14, most likely.**
2. 🔴 **`EmptyState`'s hint is now `/60` (F-1), and the class of defect is not exhausted.** The
   Task 4.7 token lint rule is scoped to `libs/web/members/**` and reads **nothing** in
   `libs/web/panel-ui/**`. Batch 15's full axe pass should point axe at **empty** surfaces
   specifically — every prior pass ran against populated ones, which is why this survived three
   phases. `panel-layout.html` and `stat-tile.html` still carry `/40` on icons; those are legal
   (`aria-hidden`, non-text) but nothing enforces the distinction.
3. 🔴 **`@axe-core/playwright` is STILL not a devDependency.** The spec loads axe-core 4.10.2 from
   a CDN and fails loudly if the load fails. B10 recorded this and so does B13 — **it is now two
   batches old and Batch 15 owns the full a11y pass**, so it should be installed there rather than
   re-recorded a third time.
4. **`MemberPlaceholderData` is down to TWO consumers** — `packs` and `notifications`, both
   Batch 15's. The placeholder component and both helpers are **not dead** and must not be
   deleted; Batch 15 is the change that removes the last two, together with the component.
5. **`member-guard-wiring.spec.ts`'s "placeholder surface is not bounced" case now asserts on
   `/members/packs`.** When Batch 15 makes that a real fetching surface, the case will start
   failing on an unanswered request. Move it again, or answer the request the way the `/members`
   case above it does. **Do not weaken the assertion.**
6. **The feed the member sees in development is the founder's real calendar** — 50 items, 44 of
   them reading `PRO ESTATE MEETING`. Any B15 screenshot, demo or video will show real meeting
   titles. This is not a bug and no batch should "fix" it by filtering.
7. **`YouTubePlayer` gained a `startActivated` input.** It defaults to `false` and every caller
   that passes `true` owns the activation. A caller passing `true` on first render, with no member
   action ahead of it, **would** breach NFR-S3 — a spec asserts the default so that has to be a
   deliberate edit rather than an accident.
8. **B14 must remove `live-sessions.module.spec.ts`'s RISK-L assertion in the same change that
   adds the `NotificationsModule` import** — B12 carried this forward and it is still true.
9. **`libs/web/members` is now 38 suites / 706 tests.** It is the largest frontend lib in the
   workspace by test count, and B15 adds two more surfaces to it. If the suite time becomes a
   problem, the natural seam is `live/` and `learning/`, both of which are self-contained.
