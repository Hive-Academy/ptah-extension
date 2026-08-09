# Batch 7.1 report — closing the two items Batch 7 reported as blocked

**Executed** 2026-08-05 by `frontend-developer`.
**Branch** `ak/license-server-validation-pipe` — never switched, never created, never rebased.
**HEAD at start** `d2b32d055` · **HEAD at end** `a2d36a24c` (the unrelated task-specs/tasks-UI
process committed twice mid-batch; none of its files is this batch's).
**Nothing was committed or staged.** No `git add`, `commit`, `stash`, `reset`,
`rm`, `checkout <path>` or `restore` was run. `--no-verify` was never used. No sub-agent and no
CLI delegation was used. `nx affected` was never used — every command carries an explicit
project list.

---

## 0. Headline verdict

**Both blocked items are closed, and neither was closed by lowering a bar.**

- **Task 7.6 — My Threads is built** against the `?mine=true` the server actually shipped, and
  the **fourth Phase-2 route now points at it**, completing Task 7.8. All four Phase-2 routes
  are real lazy chunks.
- **The unread `test.fail()` is now a normal, passing test** — and it asserts _more_ than it did
  as an expected failure, because a single observation cannot tell "accurate" from "accidentally
  right". It steps **1 → 2 → 0** across two foreign replies and a read.

The §8.2 P2 frontend exit gate is met in full: **five of five graded items**, where Batch 7 had
four. Batch 7's blocked item and Batch 7's expected-failure are both gone from the ledger.

| Item                                           | Batch 7                           | Batch 7.1                                     |
| ---------------------------------------------- | --------------------------------- | --------------------------------------------- |
| Journey: create → reply one level → react      | ✅                                | ✅                                            |
| Journey: **accurate unread count**             | ⛔ `test.fail()` (F-1)            | ✅ real assertion, live                       |
| NFR-S2 chokepoint green **and proven to fail** | ✅                                | ✅ re-proven, naming the NEW page             |
| No reply indents more than one level           | ✅                                | ✅ unchanged                                  |
| Both themes clean (NFR-U5)                     | ✅ (my-threads was a placeholder) | ✅ my-threads is the REAL page, **populated** |
| Admin moderation surface in the sidebar        | ✅                                | ✅ unchanged                                  |
| Task 7.8 — four placeholder routes swapped     | ⚠️ three of four                  | ✅ **four of four**                           |

One thing worth stating plainly up front: **the reason both of these closed is that Batch 7
reported them instead of faking them.** F-1's measurement table is what turned a one-line
suspicion into a four-site fix (including a _write_ path a one-liner would have broken), and
F-3's "no client workaround is sound" is what produced a `mine=true` boolean rather than an
`authorId=` enumeration hole. Neither would have happened from a page that shipped everyone's
threads under a heading that said "My threads".

---

## 1. Task 7.6 — My Threads

### 1.1 Files

**Created**

- `D:\projects\ptah-extension\libs\web\members\src\lib\community\my-threads-page.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\community\my-threads-page.spec.ts`

**Modified**

- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-community-api.service.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-community-api.service.spec.ts`

The file list in `tasks.md` named two files. The service pair is the third and fourth, and it is
one line of behaviour: `ListTopicsQuery` grows `mine?: boolean` and `listTopics` sets
`mine=true`. Putting that in the page instead would mean the page building `HttpParams`, which
is the one thing `MemberCommunityApiService`'s docblock says pages do not do.

### 1.2 I used the parameter as it was BUILT, not as F-3 proposed it

F-3 proposed `mine?: boolean` **or** `authorId`. Batch 6.1 shipped `mine`, deliberately, and the
distinction is an authorisation decision rather than an ergonomic one — so the client was written
against the shipped shape and asserts that it _cannot_ express the other:

```
it('sends NO author identity of any kind — the server knows who is asking')
  expect(params.has('authorId')).toBe(false)
  expect(params.has('userId')).toBe(false)
  expect(params.has('authorEmail')).toBe(false)
  expect(params.keys().sort()).toEqual(['mine', 'page'])
```

Verified live, both directions:

```
GET …/community/topics?mine=true        -> 200
GET …/community/topics?authorId=<my id> -> 400  property authorId should not exist
GET …/community/my-threads              -> 404  (no new route — it is a where clause)
```

**`mine: false` is OMITTED from the wire, not sent as `mine=false`.** The server's transform
accepts only `true` / `'true'` / `'1'` precisely because Express hands query values over as
strings and `'false'` is a truthy string. So `?mine=false` already resolves to `false` and is
byte-for-byte equivalent to omitting it (measured: identical unfiltered total). Sending it anyway
would decorate every ordinary feed request with a parameter that reads like a toggle a reader
could flip to `'false'` and expect the opposite of. One spec pins that.

### 1.3 Decisions, and what I rejected

| Decision                                           | Why                                                                                                                                                                                                                                                                  | Rejected alternative                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| A separate `MyThreadsPage`, not a `FeedPage` input | `FeedPage` owns a category rail, a category filter and the topic composer, none of which belong here. An `@Input mine` would make one component answer to two screens and would leave three features that must be conditionally switched off.                        | `<ptah-feed-page [mine]="true">`      |
| **One** request, not two                           | No category rail here, so the rail's request buys nothing. `MemberTopicSummary` already carries `categoryName`, `replyCount` and `unreadCount`, so **no second call is needed to decorate rows** — the page stays inside the server's five-query budget without one. | Reusing `FeedPage`'s two-request load |
| Reuse `ThreadRow` from `@ptah-web/panel-ui`        | Third consumer. §5.3's promotion rule cuts both ways: having been promoted for a second consumer, it is what the third one uses.                                                                                                                                     | A local row component                 |
| No variant input on `ThreadRow`                    | Nothing this page needs is absent from it. Adding one would change a shared primitive for a cosmetic gain across three consumers. See F-11 for the one place I _considered_ it and did not.                                                                          | `[showAuthor]="false"`                |
| The empty-state CTA is a **link to the feed**      | The composer lives on the feed and stays there — one composer, one place a thread is written.                                                                                                                                                                        | A second `TopicComposer` on this page |

### 1.4 Empty vs unavailable — the R6.4 distinction, honoured

The brief flagged this and it is the most load-bearing thing on the page. `'empty'` and
`'unavailable'` are different facts and a member acts on them differently:

- **Empty** → `EmptyState`, copy pointing at the composer, **resolved** (`aria-busy` absent).
  "You have not started a thread yet." · "Start your first thread" → `/members/community`.
- **Unavailable** → `role="alert"` with a retry button, **and the previous page is cleared** so a
  retry that fails cannot leave stale rows under an error banner.

Telling a member "you have not started a thread yet" after a 500 says their writing is gone.
Three specs enforce the separation, one of them negatively (`expect(…'ptah-empty-state')).toBeNull()`
on the failure path).

**The genuinely-empty case is the expected one here, not an edge case.** Against the committed
seed the dev account authors nothing — measured before writing a line of the page:

```
GET …/community/topics?mine=true  ->  {"items":[],"page":1,"pageSize":25,"total":0,"hasMore":false}
GET …/community/topics            ->  total 7        (all 9 seed topics author_id = system;
                                                      7 visible to this account)
```

It resolves to `EmptyState` in both themes, screenshotted, `aria-busy` count `0` in both.

### 1.5 The composition specs — visibility + soft-delete + `mine`

The brief called this out as "the kind of thing a 'my stuff' filter is expected to bypass and must
not". Two halves, because the client half and the server half are different claims.

**Half one — the server composes.** Proven live against `:3000` → Postgres. My own topic in my
own probe category, nothing seeded touched:

```
1) create MY topic in a member-visible category            visible on ?mine=true: true
2) DELETE …/topics/:id   (author soft delete)      -> {"deleted":true}
   ?mine=true total 1 | contains it: FALSE
   row still mine: deleted_at=2026-08-05 05:00:04.976 author=674888a2-…-8c30d971edc1
3) restore deleted_at = NULL
   ?mine=true contains it: TRUE                    ← control: the filter really is what removed it
4) narrow the CATEGORY to cohort ['founding'] (member_group_assignments = 0 rows)
   ?mine=true total 1 | contains it: FALSE
   row untouched: deleted_at=NULL author=674888a2-…-8c30d971edc1
```

Step 3 is the part that makes 2 and 4 mean anything: without it, "absent" could just be a broken
query. The row is still mine, still not deleted — and the author filter does not hand it back,
because it ADDs to the visibility and soft-delete restrictions rather than standing in for them.

**Half two — the client adds nothing.** The frontend statement of the same property is that it
re-filters _nothing_, because a second copy of an access rule in a browser is a rule that can be
turned off with devtools, and a client-side filter would also make the pager's totals lie:

```
it('renders exactly the rows the SERVER returned and re-filters none of them')
it('preserves the SERVER ordering — pinned first, then last activity')
```

### 1.6 Verification

```
$ npx nx test web-members --skip-nx-cache --testPathPatterns=my-threads-page
Test Suites: 1 passed, 1 total
Tests:       18 passed, 18 total

$ npx nx test web-members --skip-nx-cache --testPathPatterns=member-community-api
Test Suites: 1 passed, 1 total
Tests:       26 passed, 26 total          (was 22 — four new, all about `mine`)
```

Required by Task 7.6: green ✅ · `EmptyState` on the empty case ✅ · both themes ✅ (§4.4).

**NFR-S2 — the new page is inside the chokepoint's scope, proven by breaking it.** The brief
warned that `markdown-chokepoint.spec.ts` globs `libs/web/members/**` and that the page is in
scope from the moment it exists. A `<span [innerHTML]="topic.title">` was injected into
`my-threads-page.ts` and the spec named it by path:

```
FAILING RUN (probe present)
  ● the negative half — no second path from text to DOM › no file contains innerHTML
    + "lib/community/my-threads-page.ts — Binds a string into the DOM as HTML, bypassing the
       one sanitizer. Render through <ptah-markdown-block> instead."
Tests: 1 failed, 16 passed, 17 total

REVERTED RUN
$ grep -c innerHTML libs/web/members/src/lib/community/my-threads-page.ts
0
Tests: 17 passed, 17 total
```

The page imports no markdown renderer and needs none — `MemberTopicSummary` carries no body at
all. The chokepoint's `importers.sort()` assertion still names exactly three files, none of them
this one, so that assertion did not have to move. A hostile title is asserted to reach the DOM as
text (`querySelector('img')` is null, `innerHTML` contains `&lt;img`).

**NFR-U2 tokens.** `base-100`/`base-200` surfaces, `border-hairline` boundaries,
`bg-surface-high` hover, `base-content/60` for muted text. No `border-base-300` anywhere.
`web-members` lint (which carries the Task 4.7 rule for this glob) is **✔ All files pass**.

---

## 2. Task 7.8 — all four Phase-2 routes now point at real components

**Modified** — `D:\projects\ptah-extension\libs\web\members\src\lib\members.routes.ts`

| Path                       | Batch 7               | Batch 7.1           | Chunk                             |
| -------------------------- | --------------------- | ------------------- | --------------------------------- |
| `community`                | `FeedPage`            | `FeedPage`          | `chunk-QSLEI2NJ.js` · 15.33 kB    |
| `community/topics/:slug`   | `ThreadPage`          | `ThreadPage`        | `chunk-QTRJYPFX.js` · 18.47 kB    |
| **`community/my-threads`** | **`loadPlaceholder`** | **`MyThreadsPage`** | **`chunk-YEFUGDAD.js` · 5.71 kB** |
| `search`                   | `SearchPage`          | `SearchPage`        | `chunk-3D2P574D.js` · 10.61 kB    |

**No route path changed.** No `canActivate` was added anywhere — `MEMBER_ROUTES` still declares
zero guards, and `MemberGuard` still lives on `/members` in `@ptah-web/core`.
`libs/web/members/src/index.ts` still exports `MEMBER_ROUTES` and nothing else. The six remaining
placeholder routes (`courses`, `courses/:slug`, `courses/:slug/lessons/:lessonSlug`, `packs`,
`live`, `live/replays`, `live/request`, `notifications`) are untouched — Batches 10, 13 and 15 own
theirs, and `loadPlaceholder` is still the target of eight of them.

The blocked-route docblock was **rewritten, not deleted**. It now records why the screen was a
placeholder for one batch and how the server closed it, because "this was reported rather than
faked, and reporting it is what got it fixed" is the part a future reader benefits from.

**Verification**

```
$ npx nx test web-members --skip-nx-cache --testPathPatterns=members.routes.spec
Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total

$ npx nx build ptah-landing-page --skip-nx-cache
Application bundle generation complete. [13.797 seconds]
Prerendered 6 static routes.
Successfully ran target build for project ptah-landing-page and 1 task it depends on
```

(The two budget warnings — initial bundle 1.31 MB vs a 1.00 MB budget, and FullCalendar's
`skeleton.css` — are byte-identical to Batch 7's and predate both batches.)

**RK-11 deliberate-failure probe, re-run because this batch touched the file again.** A temporary
`{ path: ':model', loadComponent: loadPlaceholder, … }` was injected before `account`:

```
FAILING RUN (probe present)
  ● no route path's FIRST segment is a parameter
  ● every parameter segment is drawn from the allowlist
  ● declares no ':model' route
  ● the literal strings ':model' and ':model/:id' appear nowhere in the source
  ● matches the route table plan §5.2 specifies, exactly
Tests: 5 failed, 4 passed, 9 total

REVERTED RUN
$ grep -c "':model'" libs/web/members/src/lib/members.routes.ts
0
Tests: 9 passed, 9 total
```

Five of nine assertions fire, including the source-text one that catches a commented-out
copy-paste. The probe is gone from the tree. Task 7.8's verification block asked for exactly
this, and — as it predicted — the swap introduced no new parameter, so the spec passed untouched
before the probe and after it.

---

## 3. The unread gap — closed, measured, and not accommodated

**Modified** — `D:\projects\ptah-extension\apps\ptah-landing-page-e2e\src\specs\members-community.spec.ts`

`test.fail('sees an accurate unread count after a reply it did not write (server off-by-one)')`
is now `test('sees an accurate unread count after replies it did not write')`.

### 3.1 Batch 7's BEFORE table beside a fresh AFTER measurement

Same shape, same markers, `post_count` and the stored marker read straight out of Postgres
alongside each API response — measured **today, by this batch**, not copied:

```
TRUE UNREAD | BATCH 7 (before) | BATCH 7.1 (after) | post_count | marker
     1      |        0         |         1         |     2      |   2
     2      |        1         |         2         |     3      |   2
     3      |        2         |         3         |     4      |   2
     4      |        3         |         4         |     5      |   2
```

Raw output of the after run:

```
TRUE UNREAD | server unreadCount | post_count | marker
          1 |                  1 |          2 |      2
          2 |                  2 |          3 |      2
          3 |                  3 |          4 |      2
          4 |                  4 |          5 |      2
```

And the marker-`1` boundary Batch 6.1 added (body read, no replies read), which Batch 7's table
never reached:

```
post_count 1 marker 1 -> unreadCount 1
post_count 2 marker 1 -> unreadCount 2
post_count 3 marker 1 -> unreadCount 3
```

**Every row is now correct. No number is still wrong**, so there is nothing to report as an
outstanding measurement.

### 3.2 The converted test asserts MORE than the `test.fail()` did

The expected-failure asserted one thing: exactly `1` unread. That catches the off-by-one that
shipped and nothing else. The promoted test steps a progression, because three other ways of
being wrong look identical to being right at a single observation:

| Step                    | Assertion                                            | The failure it catches that "exactly 1" does not                                                                                    |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1 foreign reply         | `aria-label="1 unread reply"` **and** text `1 new`   | the shipped off-by-one; also a label/chip that disagree                                                                             |
| 2 foreign replies       | `aria-label="2 unread replies"` **and** text `2 new` | a badge that is really a boolean; a count that saturates                                                                            |
| open the thread, return | **zero** unread badges on the row                    | the WRITE half — a marker still written in reply-count units. A read-side-only repair would make this row come back reading "1 new" |

That third step is the one that matters most and it is not decoration: F-1 turned out to be four
sites, and the fourth (`markCategoryRead`) wrote a reply count into a post-number column. Batch
6.1's own note is that a one-line read-side fix would have produced a **newer and more visible**
defect — "1 unread immediately after mark-all-read". The step-3 assertion is that failure's
frontend shape.

### 3.3 Proven non-vacuous, not merely green

A passing test proves nothing if the locator can't fail. The expected label was temporarily
flipped to the value Batch 7 measured:

```
PROBE (expecting the BEFORE value)
  ● sees an accurate unread count after replies it did not write
    Expect "toHaveAttribute" with timeout 15000ms
    33 × locator resolved to <span aria-label="1 unread reply" class="badge badge-primary …"> 1 new </span>
       - unexpected value "1 unread reply"
    > 268 | await expect(badge).toHaveAttribute('aria-label', '0 unread replies');
  1 failed

REVERTED
  ok 2 … sees an accurate unread count after replies it did not write (7.5s)
```

The live DOM says `1 unread reply` where Batch 7 measured `0`. The assertion is exact, the
element is real, and the fix is observable end to end through the browser rather than only at the
API.

### 3.4 What I did NOT do

I did not assert whatever the server returned. The numbers above were measured _first_, against
the requirement (`post_count − (marker − 1)`), and the test was written to the requirement. Had
they still been wrong the report would carry the table and the test would still be a
`test.fail()` — that was the standing instruction and it did not need to be used.

I also did not touch `libs/api/forum/**`. The fix was Batch 6.1's and is committed
(`229c4a85c`); this batch only consumed it.

### 3.5 A second e2e for R9.2, added

`test('My Threads lists the member’s own thread and excludes another author’s')`.

A "my stuff" filter that returned everything looks perfectly healthy in a screenshot, so the
negative half is the half that tests it. The spec creates the member's own thread **through the
UI**, seeds a thread by a **different author in the same category** (new `seedForeignTopic`
helper in `support/db.ts`), asserts **both are on the unfiltered feed** — the control that makes
the absence mean something — then asserts on `/members/community/my-threads` that the member's
thread is present, the other author's is absent, exactly one `ptah-thread-row` is rendered, and
no `aria-busy` remains.

---

## 4. The §8.2 P2 frontend exit gate, restated with evidence

> a member creates a topic, replies one level, reacts, **sees accurate unread counts** · the
> NFR-S2 no-second-renderer test is green and proven to fail when violated · both themes clean
> (NFR-U5) · no reply indents more than one level regardless of the data (R1.3.4) · **the new
> admin moderation surface is reachable from the admin sidebar**.

### 4.1 The journey ✅ — now including the unread clause

Driven end to end against the live stack (`:4200` → `:3000` → Postgres). Nothing in
`members-community.spec.ts` stubs a community response.

```
$ npx playwright test src/specs/members-community.spec.ts --reporter=list

  ok 1 members-community.spec.ts:53  a member creates a topic, replies one level, reacts,
                                     and reads the thread clean (6.5s)
  ok 2 members-community.spec.ts:210 sees an accurate unread count after replies it did
                                     not write (7.5s)
  ok 3 members-community.spec.ts:334 My Threads lists the member’s own thread and excludes
                                     another author’s (8.0s)
  ok 4 members-community.spec.ts:394 search finds the thread, highlights the match, and
                                     emits no markup (5.1s)
  ok 5 members-community.spec.ts:447 the community surfaces render in operator-member (NFR-U5) (4.4s)
  ok 6 members-community.spec.ts:447 the community surfaces render in operator-member-light (NFR-U5) (5.2s)

  6 passed (38.9s)
```

Test 1 carries create → open (`**opening post**` really became `<strong>`) → top-level reply →
nested reply → the indent invariant over the live DOM → `like` flipping to
"Remove your Like reaction (1)". Test 2 carries the fifth clause. **There is no `test.fail()`
anywhere in this file any more.**

### 4.2 NFR-S2 green AND proven to fail ✅

Two independent probes this batch, both reverted:

```
17/17 green · injected [innerHTML] in my-threads-page.ts -> FAILS, naming
  "lib/community/my-threads-page.ts" · reverted -> 17/17 green
```

The positive half still holds: `@ptah-extension/markdown` is imported by exactly three files
(`thread-page.ts`, `topic-composer.ts`, `reply-composer.ts`), and every `<ptah-markdown-block>`
still passes `variant="auto"`. The new page adds no fourth importer.

### 4.3 One-level indent (R1.3.4) ✅ — unchanged, re-run

```
✓ NEVER indents past one level, even when the fixture data says depth 3
✓ renders a top-level reply and a nested reply at DIFFERENT indents
ok 1 [e2e] … the live DOM's distinct `data-reply` set is ≤ 2 and is only 'true'/'false'
```

Not touched by this batch; re-run green as part of `web-members` 19/213.

### 4.4 Both themes clean (NFR-U5) ✅ — and my-threads is now the REAL page

The theme loop already visited `/members/community/my-threads`; in Batch 7 that was a
placeholder, so the item passed over a screen that did not exist. It now renders `MyThreadsPage`.

I **strengthened the loop rather than leaving it**: it seeds one topic authored by the member
under test and asserts `ptah-thread-row` count is 1 before screenshotting, because an empty page
renders a centred icon on `base-200` — the least theme-sensitive thing this surface can show. The
row is where the token work is (`divide-hairline`, `bg-surface-high` hover, `base-content/60`
metadata, `badge-primary` unread chip).

Both themes were also inspected directly, populated and empty, at 1280×900:

| Surface                                                  | `operator-member`                                                                         | `operator-member-light`                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| My Threads, 3 rows (pinned / locked+accepted / 2 unread) | clean — hairline dividers, amber `badge-primary` chip, `base-content/60` metadata legible | clean — same structure, no inverted text, chip legible on light |
| My Threads, empty                                        | `EmptyState` resolves, CTA legible                                                        | `EmptyState` resolves, CTA legible                              |

`aria-busy` count was `0` on the empty page in both themes — it resolves, it does not hang.

No pixel baseline was committed, for the reason Batch 7 gave: a baseline for a surface this new
encodes today's layout as a requirement. The full axe pass remains Batch 15's (§8.2 P5).

**The two carried cosmetic defects were neither fixed nor worsened.** No `data-theme` binding was
moved and no secondary-nav opacity was changed; the new page introduces no `data-theme` of its
own and no nav markup. They stay carried to Batch 15.

### 4.5 The admin moderation surface is in the sidebar ✅ — unchanged, re-verified

```
ok 10 admin-crud.spec.ts:143  Community is in the sidebar under Builders Content and its
                              page loads (1.1s)
ok 11 admin-crud.spec.ts:183  a pin round-trips against the live server, then is undone (4.7s)
```

Untouched by this batch; re-run as regression evidence that the route-table edit did not disturb
the admin surface.

### 4.6 The remaining Batch 7 exit-gate lines

| Line                                                            | Status                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Every empty surface renders `EmptyState`, never a bare zero     | ✅ — My Threads was the last surface without one; three specs on it                                                            |
| `panel-ui` exports 10 lines, header records the count (RISK-M)  | ✅ unchanged — no promotion this batch; My Threads consumes, it does not promote                                               |
| The Batch 4 one-request hub assertion still passes (R6.2, R6.6) | ✅ `ok 4 members-content.spec.ts:126 the live hub still costs exactly one request now that community returns real data (6.0s)` |

---

## 5. Full verification gate

```
$ npx nx run-many -t lint,typecheck,test \
    -p web-members,web-panel-ui,web-admin,web-core,ptah-landing-page --skip-nx-cache

Linting "web-core"...          ✖ 5 problems  (0 errors, 5 warnings)
Linting "web-panel-ui"...      ✔ All files pass linting
Linting "web-members"...       ✔ All files pass linting
Linting "web-admin"...         ✖ 9 problems  (0 errors, 9 warnings)
Linting "ptah-landing-page"... ✖ 17 problems (0 errors, 17 warnings)

web-core          Test Suites:  4 passed  |  Tests:  25 passed
web-panel-ui      Test Suites:  2 passed  |  Tests:  14 passed
web-admin         Test Suites: 10 passed  |  Tests: 144 passed
web-members       Test Suites: 19 passed  |  Tests: 213 passed     (was 18 / 191)
ptah-landing-page Test Suites:  1 passed  |  Tests:   7 passed

Successfully ran targets lint, typecheck, test for 5 projects
```

Warning counts are byte-identical to Batch 7's and all are pre-existing style warnings in files
this batch did not touch. `web-members` is `+1 suite / +22 tests`: 18 in `my-threads-page.spec.ts`
and 4 in `member-community-api.service.spec.ts`.

The e2e project is outside that list, so it was gated separately:

```
$ npx nx run-many -t lint,typecheck -p ptah-landing-page-e2e --skip-nx-cache
> tsc --noEmit --project apps/ptah-landing-page-e2e/tsconfig.spec.json
Linting "ptah-landing-page-e2e"...  ✔ All files pass linting
Successfully ran targets lint, typecheck for project ptah-landing-page-e2e
```

### Full e2e suite

```
$ E2E_ADMIN_EMAIL=abdallah@miramarstaffing.com npx playwright test --reporter=list
37 passed | 1 skipped | 5 failed  (1.4m)
```

**All 5 failures are byte-identical to Batch 7's** — same specs, same lines, none of them this
batch's or Batch 7's:

| Spec                                | Failure                           | Mine?                                        |
| ----------------------------------- | --------------------------------- | -------------------------------------------- |
| `admin-crud.spec.ts:16`             | `getByText('Total Signups')`      | No — string absent from source (Batch 7 F-7) |
| `admin-founding-invites.spec.ts:28` | founding-invite batch mode        | No — waitlist, untouched                     |
| `admin-founding-invites.spec.ts:65` | founding-invite selected rows     | No — waitlist, untouched                     |
| `auth.spec.ts:65`                   | logout endpoint                   | No — auth, untouched                         |
| `pricing-waitlist.spec.ts:22`       | `Join the Builders Waitlist` link | No — string absent from source (Batch 7 F-7) |

36 → 37 passing is exactly accounted for: the `test.fail` (which Playwright counted as passing)
became a real pass, and the new My Threads test is the `+1`. The skipped one is `auth.spec.ts:91`
(real WorkOS sign-in), skipped by its own guard. **Batch 7's F-7 stands and is still someone's
regression to triage — I did not weaken those assertions.**

---

## 6. Findings — things that contradict the specs or the shipped backend

### 🟡 F-10 — `?mine=true` filters `Topic.authorId` only; "topics they replied in" is still unserveable

`tasks.md` Task 7.6 says _"The member's own topics **(and topics they replied in)**"_. The shipped
clause is a single `authorId` on `Topic`:

```ts
...(resolved.mine ? { authorId: ctx.userId } : {})
```

`implementation-plan.md:350` provisions `@@index([authorId])` on **both** `Topic` and `Post` "for
My Threads (R9.2)". The `Topic` index now has a reader; **`Post.@@index([authorId])` still has
none.** So "threads I participated in" cannot be expressed today.

I built the authored-topics view and **the page says what it shows** — "Threads you started,
newest activity first." — rather than implying the wider set under a heading that would then be
wrong. The alternative, a client-side union, means paging the whole feed to find posts I wrote,
which is the fan-out Task 7.6's own validation note forbids and the same reasoning that produced
F-3 in the first place.

**The unblocking change is server-side and small**, the same shape as the one that closed F-3:
extend the `mine` clause to `OR: [{ authorId }, { posts: { some: { authorId, ...NOT_DELETED } } }]`.
That is one extra join and `my-threads.spec.ts` already asserts the five-query budget, so whoever
does it has the test that says whether it still fits. Recorded in the page's own docblock so the
next reader does not have to find this report.

### 🟢 F-11 — `ThreadRow` renders an author on a page where every row is the same author

On My Threads the metadata line reads `<author> · N replies · <category> · <time>`, and the author
is always the member. With a DB-seeded fixture that has no display name it renders "Unknown",
which looks odd next to a heading that says "My threads". (Real WorkOS accounts carry a name; the
"Unknown" is a fixture artefact of `seedUser`, which inserts id + email only. `ThreadRow` renders
`null` as a stated "Unknown" by design, so the metadata line does not silently change shape.)

**I did not add a `[showAuthor]` input**, and that is a deliberate YAGNI call rather than an
oversight: it would change a shared primitive with three consumers for a cosmetic gain on one, and
the brief's own guidance ("prefer an input over a second component") is about what to do _if a
variant is needed_ — this one is not. Noting it so the choice is visible rather than invisible. If
a designer wants it, it is one input and one binding.

### 🟢 F-12 — the admin moderation e2e leaves soft-delete tombstones, correctly

Running `admin-crud.spec.ts` twice left two `E2E moderation probe …` rows in `community_topics`
with `deleted_at` set. That is **the endpoint working as specified** (R1.2.7 / AD-5 — admin delete
is a tombstone, not a removal), not a fixture leak: the spec's teardown calls the API, and the API
soft-deletes. They are invisible to members via `NOT_DELETED`. I hard-deleted the two rows my runs
created so the census is exactly what Batch 8 committed. Worth knowing before someone reads a
non-zero topic count as seed drift.

### 🟢 F-13 — corroboration of three carried items

- Batch 6C item 6 still holds: Jest 30's flag is `--testPathPatterns`. Every command here uses it.
- `V-CURL` still holds: every live probe authenticates with `-b "ptah_auth=$TOKEN"`. A Bearer
  header returns 401.
- Batch 7 F-4 still holds: `withComponentInputBinding()` is still not installed. `MyThreadsPage`
  reads no route parameter, so it did not need it and did not work around it.

**Nothing else contradicts the shipped backend.** Batch 6.1's `?mine=true` behaves exactly as its
report describes, including the `'false'`-is-not-truthy transform and the no-new-route property,
both re-verified live rather than inherited.

---

## 7. Live-verification residue — the seed is exactly as Batch 8 left it

Everything created for verification was created through the API or by id-scoped SQL, and removed
by id. Final census, and it matches Batch 8's committed seed byte for byte:

```
$ SELECT counts…
4 categories, 9 topics, 10 posts, authors: system

$ SELECT count(*) FROM users WHERE email LIKE 'e2e-%' OR email LIKE 'b71-%'
0

$ SELECT count(*) FROM member_group_assignments
0        ← untouched and still deliberately empty
```

Created and removed: 2 probe topics (one via `POST topics`, one for the composition probe), 1
probe category, 7 probe replies, 1 probe user, 1 read-state row, 2 screenshot users with
subscriptions, 3 screenshot topics, 1 screenshot category, and the 2 admin-e2e tombstones my own
suite runs produced. **No seeded row was deleted or modified.** The one seed _category_ I
temporarily narrowed to a cohort was my own probe category, not a seeded one — the seed's
`general` / `site-feedback` / `staff` / `builders-lounge` rows were never written to.

Token handling: the `ptah_auth` JWT was minted to a file under the shell's temp dir, used from a
shell variable, and `rm -f`'d at the end of the probe run. The screenshot scripts lived in
`C:\Users\abdal\AppData\Local\Temp\b71` — outside the repo — and that directory was deleted.
**No token, script or screenshot is in the working tree.**

---

## 8. Concurrent WIP (PRE-7 / RK-10) — annotated `git status --porcelain`

```
 M apps/ptah-landing-page-e2e/src/specs/members-community.spec.ts
 M apps/ptah-landing-page-e2e/src/support/db.ts
 M libs/frontend/tasks-ui/src/lib/components/board/task-board.component.ts
 M libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts
 M libs/frontend/tasks-ui/src/lib/components/board/task-column.component.ts
 M libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts
 M libs/web/members/src/lib/members.routes.ts
 M libs/web/members/src/lib/services/member-community-api.service.spec.ts
 M libs/web/members/src/lib/services/member-community-api.service.ts
?? libs/frontend/tasks-ui/src/lib/components/keyboard-target.ts
?? libs/frontend/tasks-ui/src/lib/components/palette/
?? libs/frontend/tasks-ui/src/lib/no-editor-dependency.spec.ts
?? libs/web/members/src/lib/community/my-threads-page.spec.ts
?? libs/web/members/src/lib/community/my-threads-page.ts
```

### MINE — `libs/web/**` and `apps/ptah-landing-page-e2e/**`, exactly the declared file set

| File                                                                        | Change                                                               |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `?? libs/web/members/src/lib/community/my-threads-page.ts`                  | Task 7.6 — the page                                                  |
| `?? libs/web/members/src/lib/community/my-threads-page.spec.ts`             | Task 7.6 — 18 cases                                                  |
| ` M libs/web/members/src/lib/members.routes.ts`                             | Task 7.8 — the fourth route swap + rewritten docblock                |
| ` M libs/web/members/src/lib/services/member-community-api.service.ts`      | `mine?: boolean` on the query + one `params.set`                     |
| ` M libs/web/members/src/lib/services/member-community-api.service.spec.ts` | 4 new cases about `mine`                                             |
| ` M apps/ptah-landing-page-e2e/src/specs/members-community.spec.ts`         | `test.fail` → real test; new My Threads test; theme loop seeds a row |
| ` M apps/ptah-landing-page-e2e/src/support/db.ts`                           | new `seedForeignTopic` helper                                        |

```
5 files changed, 412 insertions(+), 118 deletions(-)   (+ 2 untracked)
```

### FOREIGN — the unrelated tasks-UI / task-specs process. NOT TOUCHED.

```
 M libs/frontend/tasks-ui/src/lib/components/board/task-board.component.ts
 M libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts
 M libs/frontend/tasks-ui/src/lib/components/board/task-column.component.ts
 M libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts
?? libs/frontend/tasks-ui/src/lib/components/keyboard-target.ts
?? libs/frontend/tasks-ui/src/lib/components/palette/
?? libs/frontend/tasks-ui/src/lib/no-editor-dependency.spec.ts
```

All under `libs/frontend/**`, all out of bounds, none read for anything other than confirming it
is not mine. That process committed twice during this batch (`…batch 8`, `…batch 9 — the
saved-views menu`); `HEAD` moved `d2b32d055 → a2d36a24c` and none of those commits contains a file
from this batch. `tsconfig.base.json`, `nx.json` and `eslint.config.mjs` are unmodified —
`git status` shows none of them, and no path alias was needed.

`nx affected` was never invoked, precisely so that in-flight work could not be pulled into a
verification run.

---

## 9. Carried forward

1. **F-10** — `?mine=true` covers authored topics only. "Topics they replied in" (R9.2, Task 7.6)
   needs one `OR` clause and a re-run of the five-query budget assertion. `Post.@@index([authorId])`
   is still a provisioned index with no reader.
2. **Batch 7 F-7** — `admin-crud.spec.ts:16` and `pricing-waitlist.spec.ts:22` still assert strings
   that no longer exist in the source. Not weakened, still red, still someone's regression.
3. **Batch 7 F-5** — `AdminPost` is still a contract type with no endpoint that returns it.
4. **Batch 7 F-4** — `withComponentInputBinding()` is still not installed.
5. **The two cosmetic defects remain carried to Batch 15**: the light-mode right-edge gutter, and
   the secondary-nav contrast (still needs _measuring_, not adjusting by eye).
6. **F-11** — a `[showAuthor]` input on `ThreadRow` if a designer wants the author line dropped on
   My Threads. Deliberately not added.
