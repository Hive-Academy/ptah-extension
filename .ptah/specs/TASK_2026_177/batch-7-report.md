# Batch 7 report — P2-FE community screens + the NFR-S2 chokepoint test

**Executed** 2026-08-05 by `frontend-developer`.
**Branch** `ak/license-server-validation-pipe` — never switched, never rebased.
**HEAD at start** `46f0cde07` · **HEAD at end** `26c23f190` (the unrelated task-specs
process committed once more mid-batch; none of its files is this batch's).
**Nothing was committed or staged by this batch.** No `git add`, `commit`, `stash`,
`reset`, `checkout <path>` or `restore` was run. `--no-verify` was never used. No sub-agent
or CLI delegation was used.

---

## 0. Headline verdict

**10 of 11 tasks delivered. Task 7.6 (My Threads) is BLOCKED on a missing server capability
and is reported rather than faked; Task 7.8 consequently swaps three routes, not four.**

Four of the five graded items are met and evidenced below. **The fifth — "sees accurate
unread counts" — is NOT met, and the cause is a measured server-side off-by-one in
`libs/api/forum` that no frontend change can compensate for** (F-1). It is captured as a
`test.fail()` that will turn red the day the server is fixed, rather than as a weakened
assertion that would encode the defect as the requirement.

Three real defects were found by running things, not by reading them:

| #       | Finding                                                                                                 | Severity                    |
| ------- | ------------------------------------------------------------------------------------------------------- | --------------------------- |
| **F-1** | `unreadCount` under-reports by **exactly one** on every topic that has ever been read. Measured 4 ways. | 🔴 blocks a §8.2 gate item  |
| **F-2** | `POST …/topics/:id/posts` with `parentId: null` returns **500**, not 400.                               | 🔴 was breaking the journey |
| **F-3** | There is **no author filter** on the member feed, so "My Threads" (R9.2) cannot be built at all.        | 🔴 blocks Task 7.6          |

---

## 1. Task-by-task

### Task 7.1 — promote `ThreadRow` and `TagChip` into `@ptah-web/panel-ui` ✅

**Created**

- `D:\projects\ptah-extension\libs\web\panel-ui\src\lib\thread-row\thread-row.ts`
- `D:\projects\ptah-extension\libs\web\panel-ui\src\lib\thread-row\thread-row.html`
- `D:\projects\ptah-extension\libs\web\panel-ui\src\lib\thread-row\thread-row.spec.ts`
- `D:\projects\ptah-extension\libs\web\panel-ui\src\lib\tag-chip\tag-chip.ts`
- `D:\projects\ptah-extension\libs\web\panel-ui\src\lib\tag-chip\tag-chip.html`
- `D:\projects\ptah-extension\libs\web\panel-ui\src\lib\tag-chip\tag-chip.spec.ts`

**Modified**

- `D:\projects\ptah-extension\libs\web\panel-ui\src\index.ts`

**Decisions**

- `ThreadRow` emits nothing and injects nothing. Navigation is the consumer's, because the
  two consumers navigate differently (a member to `/members/community/topics/:slug`, an
  operator to a moderation drawer). The caller wraps the row in whatever it needs.
- The second metadata line is `<ng-content>`, not a `meta: string` input. The member feed
  puts a category chip and a `<time datetime>` there; the admin table puts an author email
  and a deletion timestamp. A flattened string would lose the `<time>` semantics on one
  side and would grow one input per surface as phases 3–5 land.
- `TagChip` reuses `BadgeVariant` rather than declaring a second vocabulary, and is
  deliberately the **icon-less** counterpart to `StatusBadge` — a category name is not a
  status, and a checkmark beside "Announcements" would read as one. `tag-chip.spec.ts`
  asserts it renders no `lucide-angular`, so the two cannot silently converge.
- Both are legitimate **only because Task 7.10 shipped in this same batch**.
  `community-moderation.spec.ts` contains an explicit assertion naming that dependency, so
  if the admin surface is ever deleted the promotion is deleted with it (§5.3).

**Deviation** — the file list named two files per primitive; I shipped **three** (`.ts`,
`.html`, `.spec.ts`). All six pre-existing `panel-ui` primitives use `templateUrl`, and
"pattern to follow: `status-badge.ts`" is the stronger instruction. Consistency inside the
lib beat the literal file count.

**RISK-M — the authoritative count.** `libs/web/panel-ui/src/index.ts` now carries a header
docblock recording **10 export lines / 11 symbols**, naming all eleven, and stating that
PRE-3's "nine symbols / 8 export lines" is stale and that later batches must read the
barrel rather than the precondition. It also records §5.3's promotion rule and why the five
member community components stayed private.

```
$ grep -c "^export \*" libs/web/panel-ui/src/index.ts
10
```

**NFR-U2 — hand-checked, because the lint rule does not reach here.** `libs/web/panel-ui`
is outside the Task 4.7 rule's `libs/web/members/**` scope. **I checked by hand and I am
stating that I did.** Every new panel-ui file was scanned for raw hex, the `ink-*` ramp,
the `amber-*` ramp, every Material-3 token name, and `border-base-300`:

```
=== NFR-U2 hand check: libs/web/panel-ui NEW files ===
--- libs/web/panel-ui/src/lib/thread-row/thread-row.ts      (clean)
--- libs/web/panel-ui/src/lib/thread-row/thread-row.html    (clean)
--- libs/web/panel-ui/src/lib/tag-chip/tag-chip.ts          (clean)
--- libs/web/panel-ui/src/lib/tag-chip/tag-chip.html        (clean)
--- libs/web/panel-ui/src/index.ts                          (clean)

=== tokens actually used in the two new primitives ===
text-base-content
text-base-content/60
text-primary
text-success
```

`thread-row.spec.ts` additionally asserts `border-base-300` is absent from the rendered
markup, so the one token most likely to creep back in is now covered by a test rather than
by my having looked. `libs/web/admin/.../community-moderation.{ts,html}` was hand-checked
the same way (also outside the lint scope) and is clean.

**Verification**

```
$ npx nx test web-panel-ui --skip-nx-cache
Test Suites: 2 passed, 2 total
Tests:       14 passed, 14 total

$ npx nx lint web-panel-ui --skip-nx-cache
✔ All files pass linting

$ npx nx typecheck web-admin web-members --skip-nx-cache
Successfully ran target typecheck for 2 projects
```

---

### Task 7.2 — member community + search API services ✅

**Created**

- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-community-api.service.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-community-api.service.spec.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-search-api.service.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\services\member-search-api.service.spec.ts`

Fourteen methods across the two services, each parsing with a schema exported by
`@ptah-contracts/community` — `memberCategorySchema`, `memberTopicSummarySchema`,
`memberTopicDetailSchema`, `memberPostSchema`, `memberSearchResultsSchema`,
`pagedSchema(...)`. No wire shape is re-declared. The only locally declared schemas are the
small acknowledgement envelopes (`{ deleted }`, `{ unreadCount }`, `{ topicsMarked }`,
`{ acceptedPostId }`, `{ counts, mine }`), which the contracts lib does not model.

**`isMembershipRequiredError` is reused from `@ptah-web/core`, not re-implemented, and
deliberately not re-exported** — a re-export would give one symbol two import paths. Two
spec cases cover it: a `403 { reason: 'membership_required' }` is recognised, and a
`403 { reason: 'topic_locked' }` is **not** (conflating them would bounce a member to
`/pricing` for replying to a closed thread).

**NFR-P5 and a contradiction I had to resolve.** Task 7.2 says "the service should not be
able to express" a `pageSize > 50`. Batch 6C's carried-forward item 6 says "Do not
re-implement those caps client-side as validation; mirror them as UI affordances only."
Read literally the two conflict. I resolved it by scope, and documented the reasoning in
the code:

- `page`/`pageSize` are **never member input** on these surfaces — they are constants the
  calling page chooses. An out-of-range value is a programmer error, so `pageParams()`
  throws a `RangeError` before any request is made, one frame from the cause instead of as
  an opaque 400 in the network tab. A _clamp_ was rejected: the server rejects rather than
  clamps precisely so a caller asking for 500 rows does not believe it received them all.
- `q` **is** member input, so `MemberSearchApiService` sends it exactly as typed and lets
  the server judge it. There is a spec asserting a one-character `q` reaches the wire. The
  UI affordance is a disabled button.

That is 6C's rule honoured where it applies and 7.2's rule honoured where it applies.

**Verification**

```
$ npx nx test web-members --skip-nx-cache --testPathPatterns="member-community-api|member-search-api"
Test Suites: 2 passed, 2 total
Tests:       32 passed, 32 total
```

Cases include, per service: a well-formed response parses · a response **missing a required
field throws** (proving the parse is live) · an **unknown extra field is stripped** rather
than rejected (the `z.object()` asymmetry RISK-C depended on) · the shared 403 helper
recognises the gate · `ReactionCounts` totality is enforced (a sparse `counts` map throws).

---

### Task 7.3 — five private community components ✅

**Created** (all under `D:\projects\ptah-extension\libs\web\members\src\lib\community\components\`)

- `topic-composer.ts` + `topic-composer.spec.ts`
- `reply-composer.ts` + `reply-composer.spec.ts`
- `reaction-bar.ts` + `reaction-bar.spec.ts`
- `accepted-answer-badge.ts` + `accepted-answer-badge.spec.ts`
- `unread-pill.ts` + `unread-pill.spec.ts`

All five stay private to `libs/web/members`, each with its reason in its docblock.

**Decisions**

- Composers are plain markdown textareas with a preview; the preview renders through
  `<ptah-markdown-block variant="auto">` and nothing else. `variant="auto"` is load-bearing,
  not cosmetic: the component default is `'invert'` for the dark-only webview and would put
  near-white text on the near-white `base-200` of `operator-member-light`. Both composer
  specs assert the rendered class contains `dark:prose-invert`.
- **Neither composer imports `FormsModule`.** `ngModel` writes its value back through a
  microtask, so a keystroke and the derived `canSubmit()` are one tick apart — invisible in
  a browser, and it made every spec race. State is two signals bound with `[value]` +
  `(input)`. Consequences documented in code: `(submit)` is the **native** event, not
  `(ngSubmit)` (which without `FormsModule` binds a listener for a DOM event that never
  fires, silently breaking Enter-to-submit), and `maxlength` is `[attr.maxlength]`, not
  `[maxlength]` (which is a `FormsModule` directive input, not a DOM property — it failed
  with `NG0303` until fixed).
- `TopicComposer`'s `<select>` drives its choice through `[selected]` **per option**, not
  `[value]` on the select: the options come from an `@for` in the same change-detection
  pass, and a select whose value is bound before its options exist silently resets to the
  first one — which would submit a thread into the wrong category. There is a spec for it.
- `ReactionBar` iterates `REACTION_TYPES` from the contract rather than writing four
  buttons, so a fifth wire value becomes a compile error in the label `Record`. It emits
  once per click and holds no state; optimism and reconciliation belong to the thread page,
  because the authoritative counts come back in the `PUT` response and only the page can
  hold them.
- Every reaction button carries an action-describing `aria-label`
  ("Remove your Insightful reaction (2)"), because "Insightful 2" tells a screen-reader
  user neither what pressing it does nor whether they already reacted.
- `UnreadPill` renders nothing at 0 **or below**, and takes a `noun` input so its accessible
  label says whether it is counting replies or threads — the `MemberCategory.unreadCount`
  (topics) vs `MemberTopicSummary.unreadCount` (posts) trap from the handoff, made
  un-confusable at the call site. A naive `noun + 's'` shipped "3 unread replys" until a
  spec caught it; it is now a `Record` over the union.
- `AcceptedAnswerBadge` wraps `StatusBadge` (R9.7) and takes a `hoisted` flag, because the
  same post is badged twice on a thread page and the two copies should not read identically.

**NFR-U3** — every load-bearing muted string is `text-base-content/60` or stronger. `/40`
appears nowhere in the files I wrote.

**Verification**

```
$ npx nx test web-members --skip-nx-cache --testPathPatterns="community/components"
Test Suites: 5 passed, 5 total
Tests:       35 passed, 35 total

$ npx nx lint web-members --skip-nx-cache
✔ All files pass linting
```

Required cases all present: reaction toggle **emits once per click** and a second click
emits again (toggling off is the caller's decision) · both composer previews go through
`<ptah-markdown-block>` · `UnreadPill` renders nothing at 0.

**Build-config change (deviation, not in any file list)** —
`D:\projects\ptah-extension\libs\web\members\jest.config.cts`. These are the first specs in
the lib to render `<ptah-markdown-block>`, and `marked` ships its ESM build as a bare
`lib/marked.esm.js`, so Jest died on its `export` keyword. Added `marked|ngx-markdown` to
`transformIgnorePatterns` — the identical pair `apps/ptah-landing-page/jest.config.ts`
already carries, for the identical reason, with the cross-reference written into the
comment. **The specs use the real `provideMarkdownRendering({ extensions: 'member' })`
rather than mocking the renderer**, so NFR-S2's single-chokepoint claim is asserted against
the path a browser actually takes and not only against source text.

---

### Task 7.4 — community feed page ✅

**Created**

- `D:\projects\ptah-extension\libs\web\members\src\lib\community\feed-page.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\community\feed-page.spec.ts`

Category rail in server `sortOrder` · topics as `ThreadRow`, pinned first · unread counts
from the wire with the correct noun on each · pagination · `EmptyState` · inline composer.

**Decisions**

- **Two requests on load, deliberately, and the spec asserts the count.** R6.2's
  one-request budget is the _hub's_ — an aggregate of five unrelated sections on the first
  screen a paying member sees. This is one domain with two lists whose change rates differ;
  an aggregate here would re-send the rail on every pagination click. Pinning the number
  means a future card that fetches for itself shows up as a diff.
- **Nothing is re-sorted client-side.** Re-sorting would reorder only the current page,
  which looks like working software and breaks the moment a member reaches page 2.
- Paginate, do not accumulate (NFR-U6) — a spec asserts page one's row is _gone_ after
  stepping to page two.
- Changing category resets to page 1 (page 4 of "All threads" is not page 4 of one
  category).
- A **failed rail does not blank the feed**; a **failed feed shows a retryable error, not
  an empty state**. "No threads yet" after a 500 tells a member the community is empty. It
  is not; we failed.
- The empty copy names the active filter ("No threads in Help yet.") and its action points
  at the composer rather than reporting a count (R1.7.3, R6.3).
- `MemberCategory.visibility` renders as a `TagChip` label and never removes an option —
  the list was already filtered in SQL and re-filtering it in the browser would
  re-implement a decision the server made correctly (R1.1.3).

**Trap hit and recorded:** an HTML comment inside an inline template contained a backtick,
which terminated the template literal and produced a bare `SyntaxError: Invalid shorthand
property initializer` pointing at the _spec's import line_. Worth knowing — the error names
neither the file nor the cause.

**Verification**

```
$ npx nx test web-members --skip-nx-cache --testPathPatterns=feed-page
Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
```

Manual `V-BROWSER` at `http://localhost:4200/members/community` in both themes — automated,
see §3.4.

---

### Task 7.5 — thread page ✅

**Created**

- `D:\projects\ptah-extension\libs\web\members\src\lib\community\thread-page.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\community\thread-page.spec.ts`

**Decisions**

- **The indent is a boolean and nothing else.** `isReply = post.parentId !== null`; the
  template has exactly two branches; there is no recursive component. A depth-3 row cannot
  be drawn because the renderer has no way to express it — a stronger guarantee than a
  clamp, because a clamp has to be correct and an absent capability does not. See §3.3.
- Post #1 is the body (AD-9), rendered above the divider and only present on page 1. On
  page 2+ the page renders replies alone, and there is a spec asserting that is correct
  rather than a missing body.
- The accepted answer renders **twice** — hoisted and in place — from one response, and
  `patchPost()` updates **both copies** when one is reacted to, because they are the same
  post sent twice and updating one would show two different counts on one screen.
- Tombstones render a stated placeholder and **never reach the markdown renderer**: passing
  `''` renders nothing and leaves a silently blank row.
- The read marker posts **once per open**, at the highest `postNumber` on the page. A
  progress write per change detection would spend the member's 60/min budget on scrolling.
  Asserted, including that a re-render and a reply-triggered reload emit no second write.
- `404` and `403` render differently. `404` covers absent **and** invisible
  indistinguishably (R1.1.3) — the copy is "This thread is not available", and a spec
  asserts the words "not allowed / forbidden / permission" appear nowhere. `403` matches on
  the machine `reason` (`'topic_locked'`), never on the server's sentence.
- Reactions are optimistic and reconciled **wholesale** from the `PUT` response (a merge
  would keep a locally-guessed count alive if the two disagreed); a failed toggle restores
  the pre-click snapshot rather than re-toggling.

**Deviation (F-4)** — the slug is read from `ActivatedRoute` as a signal, **not** declared
as `input.required<string>()`. A route input needs `withComponentInputBinding()` on
`provideRouter`, and `apps/ptah-landing-page/src/app/app.config.ts` does not install it.
Adding it is an app-wide router change affecting how every existing routed component
receives parameters — out of scope for this lib and not something to slip in for one page's
ergonomics. Recorded in the code so a later batch that enables it knows this is the first
consumer waiting. The signal (not a snapshot) matters: navigating thread → thread reuses
the component instance, and there is a spec for it.

**Verification**

```
$ npx nx test web-members --skip-nx-cache --testPathPatterns=thread-page
Test Suites: 1 passed, 1 total
Tests:       19 passed, 19 total
```

**Spec-technique note worth carrying forward:** `ngx-markdown` parses in a promise, so
rendered body text arrives a microtask after `detectChanges()`. Asserting on `textContent`
would make each of these cases a timing test of a third-party library. The spec instead
reads the **bound `content` input** of each `<ptah-markdown-block>` via
`By.directive(MarkdownBlockComponent)` — which is also the more precise question: _which
text reaches the one sanitizer_.

---

### Task 7.6 — My Threads page ⛔ **BLOCKED — reported, not faked** (F-3)

**Nothing was created.** The page cannot be built from `libs/web/**`.

**The gap.** "My Threads" is the feed with an author filter (R9.2). Batch 6 shipped no way
to express one:

- `ListTopicsQueryDto` accepts `categoryId`, `sort` (`recent | unread`), `page`, `pageSize`
  — and nothing else.
- The app's global `ValidationPipe` runs with `forbidNonWhitelisted: true`, so an invented
  `?authorId=me` is a **400**, not an ignored parameter.
- `TopicsReadService.listFeed` has no `authorId` clause. `implementation-plan.md:350`
  provisions `@@index([authorId])` "for My Threads (R9.2)" — the index exists, the query
  never arrived.

**Nothing on the client can substitute.** `MemberSessionStore` carries `entitled`,
`isAdmin` and `cohorts` — **no user id**. `MemberTopicSummary.authorName` is a display
name; matching on it would be identity by string comparison, would break on two members
sharing a name, and would silently show one member another's threads. The remaining option
— paging the whole feed and filtering client-side — is the fan-out Task 7.6's own
validation note forbids ("report it rather than fanning out requests here").

**What I did instead.** The route keeps its placeholder, with a docblock at
`members.routes.ts` stating the gap, why no client workaround is sound, and the exact
unblocking change: **one optional `mine?: boolean` on `ListTopicsQueryDto` and one
`authorId: ctx.userId` clause in `TopicsReadService.listFeed`.** The placeholder's member-
facing copy was updated to something honest that points at the feed.

**I chose this over three alternatives**, all worse: shipping a page that lists everyone's
threads under "My Threads" (a correctness bug a reviewer would catch); shipping a page that
always renders `EmptyState` (a stub with extra steps); or writing an unroutable component
(dead code). **This is the one item where I would take a different instruction happily** —
see §6.

---

### Task 7.7 — search page and `HighlightTextPipe` ✅

**Created**

- `D:\projects\ptah-extension\libs\web\members\src\lib\shared\highlight-text.pipe.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\shared\highlight-text.pipe.spec.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\search\search-page.ts`
- `D:\projects\ptah-extension\libs\web\members\src\lib\search\search-page.spec.ts`

**The pipe returns `{ text, match }[]` and never an HTML string.** The template renders the
runs as sibling `<span>`s with `{{ }}` interpolation, so every character reaches the DOM as
a text node Angular escapes. Its docblock states the concrete XSS this forecloses and why
the offsets-not-markup design exists at all.

**Malformed offsets degrade to plain text, all-or-nothing.** Rejecting the whole list
rather than dropping bad entries is deliberate: dropping entries would highlight a
_different_ set of characters than the server intended while looking entirely correct — a
silent wrong answer. Plain text is a visible, honest degradation. Four rejection classes,
each a real shape a buggy producer emits: non-integer or negative `start`, non-positive
`length`, `start + length > text.length`, and out-of-order/overlapping.

Search page: three groups always rendered · the `lessons` group renders an `EmptyState` in
Phase 2 rather than being hidden (hiding it would make Batch 10 a _shape_ change instead of
a _value_ change) · `EmptyState` on no results, never "0 results" · a failed search renders
an error and **clears stale results**, because leaving the previous hits under a new query's
error shows a member results for something they did not ask for · **no markdown renderer on
the page at all**, asserted.

**Verification**

```
$ npx nx test web-members --skip-nx-cache --testPathPatterns="search-page|highlight-text"
Test Suites: 2 passed, 2 total
Tests:       29 passed, 29 total
```

Required cases: multiple matches in one excerpt · zero matches · **out-of-range offsets
render plain text rather than throwing** · the output contains no HTML string anywhere. The
last is asserted twice — once in the pipe (a hostile excerpt reassembles byte-identically
and the pipe adds no tag of its own) and once in the page (`<img src=x onerror=…>` appears
as visible characters, `querySelector('img')` is null, and `innerHTML` contains `&lt;img`).

---

### Task 7.8 — swap the placeholder routes ⚠️ **three of four**

**Modified** — `D:\projects\ptah-extension\libs\web\members\src\lib\members.routes.ts`

`community` → `FeedPage`, `community/topics/:slug` → `ThreadPage`, `search` → `SearchPage`.
`community/my-threads` keeps its placeholder for F-3. No route path changed. No
`canActivate` was added anywhere. The other placeholder routes are untouched.

**Verification**

```
$ npx nx test web-members --skip-nx-cache --testPathPatterns=members.routes.spec
Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total

$ npx nx build ptah-landing-page --skip-nx-cache
Application bundle generation complete. [13.862 seconds]
Prerendered 6 static routes.
Successfully ran target build for project ptah-landing-page and 1 task it depends on
```

(Two pre-existing budget warnings — initial bundle 1.31 MB vs a 1.00 MB budget, and
FullCalendar's skeleton.css. Both predate this batch.)

**RK-11 deliberate-failure probe — run and reverted.** A temporary
`{ path: ':model', loadComponent: loadPlaceholder, … }` was injected before the `account`
route:

```
FAILING RUN (probe present)
  ● no route path's FIRST segment is a parameter                        - 1 / + 3
  ● every parameter segment is drawn from the allowlist                 - 1 / + 3
  ● declares no ':model' route                                          - 1 / + 3
  ● the literal strings ':model' and ':model/:id' appear nowhere        Expected substring: not "':model'"
  ● matches the route table plan §5.2 specifies, exactly                - 0 / + 1
Tests: 5 failed, 4 passed, 9 total

REVERTED RUN
$ grep -c "':model'" libs/web/members/src/lib/members.routes.ts
0
Tests: 9 passed, 9 total
```

Five of nine assertions fire, including the source-text one that catches a commented-out
copy-paste. The probe is gone from the tree.

---

### Task 7.9 — the NFR-S2 chokepoint spec ✅ **and proven to fail**

**Created** — `D:\projects\ptah-extension\libs\web\members\src\lib\markdown-chokepoint.spec.ts`

Globs `libs/web/members/**/*.{ts,html}` and asserts zero occurrences of `innerHTML`,
`bypassSecurityTrustHtml`, `from 'marked'`, `from 'dompurify'`, `from 'ngx-markdown'` —
each with the reason it is forbidden written into the failure message, so the output says
what to do instead.

**Comments are stripped before scanning, and that is load-bearing.** Half the files in this
lib _discuss_ `[innerHTML]` in their docblocks — telling the next reader not to use it is
exactly the documentation this rule wants. Matching raw text would make every warning a
violation and the only way to stay green would be to delete the warnings. Stripping uses
`ts.transpileModule({ removeComments: true })` rather than a regexp, because a regexp
cannot tell `//` inside a URL from a line comment and truncating at `https://` would create
a place a needle could hide. HTML comments inside inline templates are stripped separately.
There is an anti-vacuity case proving the stripper removes both comment forms **and**
preserves code and URLs.

**The positive half** — a negative-only spec passes trivially on a file that renders
nothing. Four positive assertions:

1. Every component referencing `bodyMarkdown` / `bodyExcerpt` / `titleExcerpt` renders
   `<ptah-markdown-block>`, with **one declared exemption** (`search-page.ts`, whose
   excerpts are plain text by design — R1.7.5).
2. That rule is not vacuous — it matches at least the three known renderers by name.
3. Every markdown block passes `variant="auto"` (NFR-U5 travels with every renderer).
4. `@ptah-extension/markdown` is imported by **exactly** three files, asserted by name, so a
   fourth renderer is a diff rather than a discovery.

Plus: the exemption list is asserted to have exactly one entry with a >40-character
justification, and the exempt page is asserted to _really_ run no markdown pipeline — so if
search ever grows one, the exemption becomes wrong and the spec fails.

**Self-match is excluded by absolute path, not by name pattern**, and other `.spec.ts`
files are excluded with the reason stated (a spec legitimately reads `element.innerHTML` to
assert a string's absence — `thread-page.spec.ts` does exactly that). An anti-vacuity case
asserts the exclusion did not over-reach: `lib/member-layout/member-layout.html` is still
scanned.

**GREEN RUN**

```
$ npx nx test web-members --skip-nx-cache --testPathPatterns=markdown-chokepoint
Test Suites: 1 passed, 1 total
Tests:       17 passed, 17 total
```

**DELIBERATE-FAILURE PROOF — the graded item.** The opening post's renderer in
`thread-page.ts` was replaced with `<div [innerHTML]="opening.bodyMarkdown"></div>`:

```
NFR-S2 VIOLATION INJECTED into thread-page.ts

  ● NFR-S2 — one markdown renderer, one sanitizer, across libs/web/members
    › the negative half — no second path from text to DOM
    › no file contains innerHTML

    - Array []
    + Array [
    +   "lib/community/thread-page.ts — Binds a string into the DOM as HTML,
    +    bypassing the one sanitizer. Render through <ptah-markdown-block> instead.",

Test Suites: 1 failed, 1 total
Tests:       1 failed, 16 passed, 17 total
```

**It fails, and it names the file.** Reverted from a byte-exact backup:

```
$ grep -c "innerHTML" libs/web/members/src/lib/community/thread-page.ts
1                                  # ← the docblock warning, correctly ignored

$ npx nx test web-members --skip-nx-cache --testPathPatterns="markdown-chokepoint|thread-page"
Test Suites: 2 passed, 2 total
Tests:       36 passed, 36 total
```

That last `grep` is itself the evidence that comment-stripping works: the string is present
in the file and the spec is green.

**PRE-4 / OQ-2 — `libs/frontend/markdown` was NOT modified.** No change to the `'member'`
preset was needed, so there is nothing to re-verify against the VS Code webview consumer.
The lib is untouched by this batch (confirmed in the final `git status`).

---

### Task 7.10 — a NEW admin moderation surface ✅

**Created**

- `D:\projects\ptah-extension\libs\web\admin\src\lib\builders\community\community-moderation.ts`
- `D:\projects\ptah-extension\libs\web\admin\src\lib\builders\community\community-moderation.html`
- `D:\projects\ptah-extension\libs\web\admin\src\lib\builders\community\community-moderation.spec.ts`

**Modified**

- `D:\projects\ptah-extension\libs\web\admin\src\lib\services\admin-builders-api.service.ts`
- `D:\projects\ptah-extension\libs\web\admin\src\lib\admin.routes.ts`
- `D:\projects\ptah-extension\libs\web\admin\src\lib\admin-layout\admin-nav.config.ts`

**A new surface, not a restoration.** Six write methods the deleted read-only screen never
had: `moderateCommunityTopic` (pin / lock / move / retitle), `deleteCommunityTopic`,
`restoreCommunityTopic`, `deleteCommunityPost`, `restoreCommunityPost`, plus
`listCommunityCategories` / `listCommunityTopics`. Both removal-site comments
(`admin.routes.ts:167-169`, `admin-builders-api.service.ts:398-403`) were **replaced** by
their successors, so neither file carries a tombstone and its replacement. G5 was not
restored, and the code says so.

**New Zod envelopes** for `AdminCategory`, `AdminTopicSummary` and `Paged<AdminTopicSummary>`,
each bound to its contract type with `satisfies z.ZodType<T>` — a compile-time proof that
the runtime parse and the wire type agree, so a contract rename breaks the build here
instead of returning `undefined` in a template. The docblock quotes
`admin-topic.contract.ts`'s own reason for shipping types-without-Zod and states that this
file is the admin surface it referred to.

**Deviation — no `AdminPost` schema.** Task 7.10 named three types. Batch 6 gave `AdminPost`
**no read endpoint**: the posts controller exposes `DELETE :id` and `POST :id/restore` only,
and deliberately no list (RK-1 — an unpaged scan of the largest table serving a screen
nobody asked for). A schema for a shape that never arrives on any response parses nothing
and drifts unnoticed — precisely the "decoration that drifts" the contract lib declines to
ship. Recorded as a docblock where the schema would go, to be added the day a read endpoint
exists.

**Sidebar** — `Community` added to the existing **Builders Content** group beside Packs and
Sessions, with `Member Groups` left under People & Community. A spec asserts both.

**Reuse (R9.7)** — `ThreadRow`, `TagChip`, `StatusBadge`, `EmptyState`, `SelectionToolbar`
and `DetailDrawer`, all from `@ptah-web/panel-ui`. The `ThreadRow` assertion is explicitly
labelled as the §5.3 licence for Task 7.1's promotion.

**Decisions worth flagging**

- Bulk lock/unlock issues **one PATCH per topic**. There is no bulk endpoint, and that is
  right: a bulk route recording one audit row for twelve topics would make the log useless
  for exactly the case it exists for (PRE-6).
- A no-op move (selecting the current category) writes nothing — a no-op PATCH would still
  produce an audit row saying a moderator moved a thread that never moved. Spec'd.
- The drawer resolves its topic **from the current rows by id**, not from a held object, so
  it follows a reload rather than showing the state the operator clicked on.
- No markdown is rendered on this screen. An operator triages metadata; a body reaches them
  through the member thread view. Rendering member markdown here would put a second consumer
  on the `'member'` preset that the NFR-S2 spec — scoped to `libs/web/members` — does not
  police. Asserted.
- `MemberThemeService` / `ptah.members.theme` are not imported (AD-13).

**Verification**

```
$ npx nx test web-admin --skip-nx-cache --testPathPatterns=community-moderation
Test Suites: 1 passed, 1 total
Tests:       21 passed, 21 total

$ npx nx lint web-admin --skip-nx-cache
✖ 9 problems (0 errors, 9 warnings)        # all pre-existing, see §5

$ npx nx typecheck web-admin ptah-landing-page --skip-nx-cache
Successfully ran target typecheck for 2 projects
```

**Manual verification, automated against the live server** (§3.5) — signed in as
`abdallah@miramarstaffing.com`, **Community** appears in the sidebar under Builders Content,
the page loads, and a pin round-trips and survives a full reload.

---

### Task 7.11 — e2e, both themes, and the R6.2 re-run ✅

**Created** — `D:\projects\ptah-extension\apps\ptah-landing-page-e2e\src\specs\members-community.spec.ts`
**Modified** —

- `D:\projects\ptah-extension\apps\ptah-landing-page-e2e\src\specs\members-content.spec.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page-e2e\src\support\db.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page-e2e\src\specs\admin-crud.spec.ts` _(third file — deviation, see below)_

**Deviation** — the file list named two e2e files. The admin half of the §8.2 gate ("the
new admin moderation surface is reachable from the admin sidebar") is an _admin_ surface, so
its two tests went into `admin-crud.spec.ts`, which is the admin e2e home and is inside this
batch's declared file set. A unit spec asserting the nav config proves the config, not the
chrome.

**Fixture hygiene under a concurrent seed.** Nothing counts rows, asserts a table is empty,
or truncates. Every fixture carries a timestamped slug and teardown deletes strictly by the
ids it minted. `cleanupCommunityCategory` removes children first and clears
`accepted_post_id` before the posts, because it FKs one.

Everything below is real: no community response is stubbed anywhere.

---

## 2. Deviations, consolidated

| #   | Spec said                                                       | What I did                                          | Why                                                                                                                                                      |
| --- | --------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | 7.1: two files per primitive                                    | Three (`.ts` + `.html` + `.spec.ts`)                | All six existing `panel-ui` primitives use `templateUrl`; "pattern to follow: status-badge.ts" is the stronger instruction.                              |
| D-2 | 7.6: build `MyThreadsPage`; 7.8: swap four routes               | Route left on its placeholder; three routes swapped | **F-3** — no server-side author filter exists and no sound client substitute does. Task 7.6's own validation note prescribes reporting over fanning out. |
| D-3 | 7.5: implied route-input binding                                | `ActivatedRoute` signal                             | **F-4** — `withComponentInputBinding()` is not installed, and installing it is an app-wide router change out of this lib's scope.                        |
| D-4 | 7.10: Zod envelopes for three admin types                       | Two (`AdminCategory`, `AdminTopicSummary`)          | `AdminPost` has no read endpoint; a schema that parses nothing is the drift the contract lib declines to ship.                                           |
| D-5 | 7.11: two e2e files                                             | Three                                               | The admin gate item belongs in the admin e2e file.                                                                                                       |
| D-6 | (unlisted)                                                      | `libs/web/members/jest.config.cts`                  | `marked` is ESM-only; without it no spec can render `<ptah-markdown-block>`. Mirrors the landing app's identical exception.                              |
| D-7 | 7.11: "the journey … sees an accurate unread count" as one test | Split: journey (green) + `test.fail()` for unread   | **F-1** — asserting current behaviour would encode a defect as the requirement; deleting the case would lose it.                                         |

---

## 3. The five graded items

### 3.1 — A member creates a topic, replies one level, reacts, and sees accurate unread counts ⚠️ **four of five clauses**

Driven end-to-end against the live stack (`:4200` → `:3000` → Postgres), no stubs:

```
ok  22 [chromium] › members-community.spec.ts:53 › a member creates a topic,
       replies one level, reacts, and reads the thread clean (7.0s)
```

Create → open (body rendered as real markdown: `**opening post**` became `<strong>`) →
top-level reply → nested reply → indent invariant asserted over the live DOM → `like`
reaction flips to "Remove your Like reaction (1)" → the read thread carries no unread badge.

**The unread clause is NOT met**, because of F-1 below. It is a separate `test.fail()`
carrying the full measurement table and root cause, so the suite is green today and turns
**red the day the server is fixed** — which is exactly when someone must come back and
promote it.

### 3.2 — The NFR-S2 spec is green AND proven to fail ✅

Both runs are in §Task 7.9 above: 17/17 green; with an injected `[innerHTML]` it fails and
names `lib/community/thread-page.ts`; reverted and green again.

### 3.3 — No reply indents more than one level regardless of the data ✅

**Unit** — asserted against deliberately malformed depth-3 fixture data (`post_1 ← post_2 ←
post_3 ← post_4`, which the server should never emit):

```
✓ NEVER indents past one level, even when the fixture data says depth 3
✓ renders a top-level reply and a nested reply at DIFFERENT indents
```

The second is the negative control — a renderer that indented _nothing_ would also satisfy
"never more than one level". The first asserts every non-null parent renders at the same
indent **and** that the distinct margin-class set has size 1 whatever the data.

**Live** — the e2e journey collects `data-reply` over the real DOM after posting a nested
reply and asserts the distinct set is ≤ 2 and consists only of `'true'`/`'false'`.

The UI is not the only thing enforcing it (the server repairs depth-3 server-side) and it
does not break on deeper data — it renders it at depth 2.

### 3.4 — Both themes clean (NFR-U5) ✅

```
ok 33 › the community surfaces render in operator-member (NFR-U5) (4.7s)
ok 36 › the community surfaces render in operator-member-light (NFR-U5) (8.0s)
```

Each run visits **feed, my-threads and search**, asserts `ptah-member-layout` is visible,
asserts `[data-theme="<theme>"]` is actually attached (so the panel is really on the theme
under test, not merely rendered), and attaches a full-page screenshot per surface per theme
— **six screenshots** in the Playwright report. The thread page's light-mode correctness is
covered separately by the unit assertion that every `<ptah-markdown-block>` receives
`variant="auto"` (the default `'invert'` is NFR-U5's exact failure mode).

No pixel baseline was committed: a baseline for a surface this new would encode today's
layout as a requirement. The full axe pass is Batch 15's (§8.2 P5).

**The two carried defects were neither fixed nor worsened**: no `data-theme` binding was
moved, and no secondary-nav opacity was changed.

### 3.5 — The admin moderation surface is reachable from the sidebar ✅

```
ok  9 [chromium] › admin-crud.spec.ts:143 › Community is in the sidebar under
       Builders Content and its page loads (1.4s)
ok 11 [chromium] › admin-crud.spec.ts:185 › a pin round-trips against the live
       server, then is undone (6.0s)
```

Signed in as `abdallah@miramarstaffing.com`. The first navigates from `/admin/overview` by
**clicking the sidebar link**, asserts its `href`, and asserts the queue resolved to rows or
an `EmptyState` (never a raw error). The second creates a topic, pins it, **reloads the
whole page** to prove the pin was persisted rather than toggled locally, unpins it and
deletes it.

The unit spec adds: the nav group's items are exactly `['Packs','Sessions','Community']`,
`Member Groups` is still under People & Community, and `builders/community` is declared
before the `:model` catch-all.

---

## 4. Findings — things that contradict `tasks.md`, the plan, or Batch 6

### 🔴 F-1 — `unreadCount` under-reports by exactly one on every topic that has been read

**This blocks a §8.2 exit-gate clause and it is frontend-visible: a thread with one unread
reply renders no badge at all.**

Measured against the running stack, reading `post_count` and the stored marker out of
Postgres alongside each API response.

**With no read marker** (never opened) — correct:

```
TRUE UNREAD | server unreadCount | post_count | marker
     1      |         1          |     1      |   0
     2      |         2          |     2      |   0
     3      |         3          |     3      |   0
     4      |         4          |     4      |   0
```

**With a read marker** (the state every real thread is in after one visit) — off by one,
every time:

```
TRUE UNREAD | server unreadCount | post_count | marker
     1      |         0          |     2      |   2
     2      |         1          |     3      |   2
     3      |         2          |     4      |   2
     4      |         3          |     5      |   2
```

**Root cause.** `unreadCount(postCount, lastReadPostNumber)` in
`libs/api/forum/src/lib/read-state/read-state.service.ts:25` computes
`max(0, postCount - lastReadPostNumber)` — **but the operands are in different units.**
`Topic.postCount` counts **replies** and excludes post #1, because post #1 _is_ the topic
body (AD-9, AD-11). `lastReadPostNumber` is a **postNumber**, which counts post #1.

With no marker the default is `0` and the arithmetic is _accidentally_ correct, which is why
R1.6.3 ("a never-opened topic reports its whole reply count") works and why this went
unnoticed through Batch 6's own verification.

**The client cannot compensate.** `PostsService.createReply` advances the author's own
marker to the new post's `postNumber` server-side, and the marker is monotonic by design.
Verified: with a stored marker of `2`, `POST topics/:id/read {lastReadPostNumber: 1}`
returned `{"unreadCount":0}` and left the stored marker at `2`. A client sending a corrected
lower value is simply ignored.

**The fix is one line, server-side:**

```ts
return Math.max(0, postCount - Math.max(0, lastReadPostNumber - 1));
```

**Also affects the hub.** `MemberTopicSummary.unreadCount` feeds `HubTopicSummary.unreadCount`
and the "Unread replies" stat tile, so every unread number a member sees is low by one per
read topic. Worth fixing before Batch 14's notification badge reads the same number.

Captured as `members-community.spec.ts` →
`test.fail('sees an accurate unread count after a reply it did not write (server off-by-one)')`
with the full table and root cause in its docblock.

### 🔴 F-2 — `POST …/topics/:id/posts` with `parentId: null` returns 500

Verified live:

```
POST …/topics/:id/posts  {"bodyMarkdown":"…","parentId":null}  -> 500 {"statusCode":500,"message":"Internal server error"}
POST …/topics/:id/posts  {"bodyMarkdown":"…"}                  -> 201 {"id":"…","postNumber":2,"parentId":null,…}
```

`CreatePostDto.parentId` is `@IsOptional() @IsString() @MinLength(1) @MaxLength(64)`, and
class-validator's `@IsOptional()` skips validation for **both** `undefined` and `null` — so
an explicit `null` passes the DTO untouched and then fails below it as an unhandled
exception. **A `null` here should be a 400 at worst, never a 500.**

This was breaking the journey e2e. **Fixed client-side**: `createPost` now omits the key
when `parentId` is nullish. That is the right client behaviour regardless (`undefined` is
how JSON says "unspecified"), and the signature still _accepts_ `null` so a caller holding
`MemberPost.parentId` — which is `string | null` — need not convert. Two specs cover it, and
`thread-page.spec.ts` asserts the wire body has no `parentId` key.

The server defect stands and should be fixed: either narrow the DTO to reject `null`
explicitly, or handle it where it currently throws.

### 🔴 F-3 — no author filter on the member feed → "My Threads" (R9.2) cannot be built

Full detail in Task 7.6 above. `implementation-plan.md:350` provisions `@@index([authorId])`
"for My Threads (R9.2)"; the index exists, the query parameter never arrived. With
`forbidNonWhitelisted: true` an invented parameter is a 400, and the client holds no user
id, so there is no workaround from `libs/web/**`.

### 🟡 F-4 — `withComponentInputBinding()` is not installed

`apps/ptah-landing-page/src/app/app.config.ts` calls
`provideRouter(routes, withInMemoryScrolling(...))`. Route parameters therefore cannot be
bound as component inputs. `ThreadPage` is the first component that wanted it and reads
`ActivatedRoute` instead. Enabling it is a one-word change with app-wide reach; recorded in
the code so whoever does it knows where the first consumer is.

### 🟡 F-5 — `AdminPost` is a contract type with no endpoint that returns it

Batch 6's admin posts controller exposes `DELETE :id` and `POST :id/restore` only — the
absence of a list is a deliberate RK-1 decision, stated in that controller's docblock. But
it leaves `AdminPost` unreachable: nothing can produce one, so nothing can parse one. Either
a read endpoint arrives, or the type should be reconsidered when B12/B14 revisit the area.

### 🟡 F-6 — `ThreadRow.unreadCount` and `UnreadPill` are near-duplicates, by instruction

§5.3 specifies `unreadCount` as a `ThreadRow` input; Task 7.3 separately specifies a
standalone `UnreadPill`. Both render "N new". I kept both — `ThreadRow`'s badge for rows
(always replies) and `UnreadPill` for the category rail (threads) — and closed the real
hazard by giving each an accessible label that states **which number it is**
(`"3 unread replies"` vs `"3 unread threads"`). Both are asserted, including in the feed
spec, which is where binding them the wrong way round would otherwise be invisible.

### 🟡 F-7 — two pre-existing e2e specs assert strings that no longer exist in the source

Not caused by this batch, and each fails on a label that was renamed by earlier work:

```
$ grep -rl "Total Signups"              libs apps --include=*.ts --include=*.html | grep -v e2e | wc -l
0
$ grep -rl "Join the Builders Waitlist" libs apps --include=*.ts --include=*.html | grep -v e2e | wc -l
0
```

`admin-crud.spec.ts:30` and `pricing-waitlist.spec.ts:26`. Same class as the red-on-purpose
precedent `members-content.spec.ts` documents. I did not "fix" them by weakening the
assertions — that is someone's real regression to triage.

### 🟢 F-8 — trap worth carrying forward

A backtick inside an HTML comment in an Angular **inline template** terminates the template
literal and produces `SyntaxError: Invalid shorthand property initializer` pointing at the
_importing spec's_ line 1. It names neither the file nor the cause. Cost ~10 minutes;
noting it so it costs the next person zero.

### 🟢 F-9 — corroboration of two Batch 6 carried-forward items

- Batch 6C item 6 is right and still live: Jest 30's flag is `--testPathPatterns`. Every
  command in this report uses it.
- 6C's `V-CURL` correction is right: all live probes in this report authenticate with
  `-b "ptah_auth=$TOKEN"` / a `cookie:` header. A Bearer header returns 401.

---

## 5. Final verification gate

```
$ npx nx run-many -t lint,typecheck,test \
    -p web-members,web-panel-ui,web-admin,web-core,ptah-landing-page --skip-nx-cache

Linting "web-core"...        ✖ 5 problems  (0 errors, 5 warnings)
Linting "web-panel-ui"...    ✔ All files pass linting
Linting "web-members"...     ✔ All files pass linting
Linting "web-admin"...       ✖ 9 problems  (0 errors, 9 warnings)
Linting "ptah-landing-page"... ✖ 17 problems (0 errors, 17 warnings)

web-core         Test Suites:  4 passed  |  Tests:  25 passed
web-panel-ui     Test Suites:  2 passed  |  Tests:  14 passed
web-admin        Test Suites: 10 passed  |  Tests: 144 passed
web-members      Test Suites: 18 passed  |  Tests: 191 passed
ptah-landing-page Test Suites: 1 passed  |  Tests:   7 passed

NX  Successfully ran targets lint, typecheck, test for 5 projects
```

**0 errors.** All 31 warnings are pre-existing, in files this batch did not touch
(`admin-detail.html`, `delete-user-modal.ts`, `issue-comp-license-modal.ts`, and
landing/core files). `web-members` and `web-panel-ui` — the two libs that gained the most
code — are warning-free.

```
$ npx nx run-many -t lint,typecheck -p ptah-landing-page-e2e --skip-nx-cache
✔ All files pass linting
Successfully ran targets lint, typecheck
```

### Full e2e suite

```
$ E2E_ADMIN_EMAIL=abdallah@miramarstaffing.com npx playwright test --config=playwright.config.ts --reporter=list
36 passed | 1 skipped | 5 failed
```

**All 5 failures are in specs this batch did not author, on assertions unrelated to it:**

| Spec                                | Failure                           | Mine?                                |
| ----------------------------------- | --------------------------------- | ------------------------------------ |
| `admin-crud.spec.ts:16`             | `getByText('Total Signups')`      | No — string absent from source (F-7) |
| `admin-founding-invites.spec.ts:28` | founding-invite batch mode        | No — waitlist, untouched             |
| `admin-founding-invites.spec.ts:65` | founding-invite selected rows     | No — waitlist, untouched             |
| `auth.spec.ts:65`                   | logout endpoint                   | No — auth, untouched                 |
| `pricing-waitlist.spec.ts:22`       | `Join the Builders Waitlist` link | No — string absent from source (F-7) |

The skipped one is `auth.spec.ts:91` (real WorkOS sign-in), skipped by its own guard.

Every spec this batch created or extended passes:

```
ok  9 admin-crud.spec.ts:143  Community is in the sidebar under Builders Content and its page loads
ok 11 admin-crud.spec.ts:185  a pin round-trips against the live server, then is undone
ok 22 members-community.spec.ts:53  a member creates a topic, replies one level, reacts, and reads the thread clean
x  25 members-community.spec.ts:209 sees an accurate unread count … (server off-by-one)   ← expected failure, counted as passing
ok 27 members-content.spec.ts:126 the live hub still costs exactly one request now that community returns real data
ok 30 members-community.spec.ts:271 search finds the thread, highlights the match, and emits no markup
ok 33 members-community.spec.ts:324 the community surfaces render in operator-member (NFR-U5)
ok 36 members-community.spec.ts:324 the community surfaces render in operator-member-light (NFR-U5)
```

Note `admin-crud.spec.ts` tests 4–8 (the ones that were passing before) still pass, which is
positive evidence that the nav-config, route and service edits did not disturb the existing
admin surface.

### R6.2 re-run — the hub is still ONE request ✅

```
ok 27 [chromium] › members-content.spec.ts:126 › the live hub still costs exactly
       one request now that community returns real data (4.4s)
```

Batch 4's original stubbed assertion (`members-content.spec.ts:41`) is **unchanged and still
passing**. I _added_ a second test rather than editing it, because the stubbed version
proves the page issues one request while the live one proves the property survives the thing
that could break it: `sections.community` now returns real data, and the obvious way to ship
that regression is for the community card to start fetching its own topics — invisible to a
stubbed hub. The new test counts every `/api/v1/members/*` request the hub route issues,
waits 1.5 s to give any lazy child the chance to fetch, asserts the hub count is exactly 1,
and asserts **zero** `…/community` and `…/search` calls. That is R6.6's claim tested rather
than restated.

---

## 6. Clarifications needed

Only one, and it is F-3 / Task 7.6.

**Question.** "My Threads" cannot be built from the frontend: the member feed has no author
filter, and the client holds no user id. I left the route on its placeholder and reported
the gap, because the three alternatives were a page that shows everyone's threads under
"My Threads", a page that always renders `EmptyState`, or unroutable dead code.

**If you would rather have the screen now**, the cheapest correct path is a small backend
change (one optional `mine?: boolean` on `ListTopicsQueryDto`, one
`authorId: ctx.userId` clause in `TopicsReadService.listFeed`) — but `libs/api/**` was
outside this batch's territory, and Batch 8 was running concurrently, so I did not take it
unilaterally. **Say the word and it is a ~30-line follow-up** — the backend change, the page
(which is deliberately thin: the feed with a filter, reusing `ThreadRow` and the same
pagination), its spec, and the route swap.

The same dispatch would be the natural home for F-1's one-line `read-state.service.ts` fix,
which would also let the `test.fail()` be promoted to a normal test and close the last §8.2
clause.

---

## 7. Live-verification residue

**Everything created through the API or seeded for a test was removed**, and nothing that
was not mine was touched.

- e2e fixture categories (`e2e-community-*`) and every topic, post, reaction and read-state
  row inside them: created and removed by `cleanupCommunityCategory`, by id.
- Direct API probes (three throwaway scripts, run outside the repo, since deleted): their
  categories/topics/posts/users/subscriptions all removed.
- The admin pin/delete e2e leaves a **soft-deleted** topic by design (that is what a soft
  delete is). I hard-removed the two it produced afterwards, since they were mine.

```
$ select count(*) from community_categories where slug like 'e2e-community-%' or slug like 'probe%';
0
$ select count(*) from community_topics where title like 'E2E%' or title like '%probe%';
0
```

**Batch 8's seed is intact and was never truncated or filtered:**

```
categories=4   topics=9   posts=10
```

**The 18 `community.*` audit rows those moderation writes produced were deliberately NOT
deleted** — they are an accurate record of moderation that really happened, written by the
mechanism under test. (Batch 6C made the same call for the same reason; 9 of the 18 are
theirs.)

**`member_group_assignments` was not seeded.** The e2e fixture category is
`visibility: 'member'` precisely so it does not need to be.

---

## 8. Concurrent WIP (PRE-7 / RK-10) — annotated `git status --porcelain`

```
### MINE — libs/web/** and apps/ptah-landing-page-e2e/**
 M apps/ptah-landing-page-e2e/src/specs/admin-crud.spec.ts
 M apps/ptah-landing-page-e2e/src/specs/members-content.spec.ts
 M apps/ptah-landing-page-e2e/src/support/db.ts
 M libs/web/admin/src/lib/admin-layout/admin-nav.config.ts
 M libs/web/admin/src/lib/admin.routes.ts
 M libs/web/admin/src/lib/services/admin-builders-api.service.ts
 M libs/web/members/jest.config.cts
 M libs/web/members/src/lib/members.routes.ts
 M libs/web/panel-ui/src/index.ts
?? apps/ptah-landing-page-e2e/src/specs/members-community.spec.ts
?? libs/web/admin/src/lib/builders/community/
?? libs/web/members/src/lib/community/
?? libs/web/members/src/lib/markdown-chokepoint.spec.ts
?? libs/web/members/src/lib/search/
?? libs/web/members/src/lib/services/member-community-api.service.spec.ts
?? libs/web/members/src/lib/services/member-community-api.service.ts
?? libs/web/members/src/lib/services/member-search-api.service.spec.ts
?? libs/web/members/src/lib/services/member-search-api.service.ts
?? libs/web/members/src/lib/shared/
?? libs/web/panel-ui/src/lib/tag-chip/
?? libs/web/panel-ui/src/lib/thread-row/

### BATCH 8 of THIS task (concurrent, disjoint — the MG-1 seed)
 M apps/ptah-license-server/project.json
?? apps/ptah-license-server/prisma/seed/

### FOREIGN — the unrelated task-specs/settings feature
 M libs/frontend/tasks-ui/src/index.ts
 M libs/frontend/tasks-ui/src/lib/components/filter/task-filter-bar.component.spec.ts
 M libs/frontend/tasks-ui/src/lib/components/filter/task-filter-bar.component.ts
 M libs/frontend/tasks-ui/src/lib/components/tasks-view.component.spec.ts
 M libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts
?? libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.views-durability.spec.ts
?? libs/frontend/tasks-ui/src/lib/components/filter/task-view-menu.component.spec.ts
?? libs/frontend/tasks-ui/src/lib/components/filter/task-view-menu.component.ts
?? libs/frontend/tasks-ui/src/lib/services/task-views.service.spec.ts
?? libs/frontend/tasks-ui/src/lib/services/task-views.service.ts
```

**The claim `tasks.md` makes for Batch 7 held.** My set is exactly `libs/web/**` +
`apps/ptah-landing-page-e2e/**`; Batch 8's is `apps/ptah-license-server/prisma/**` +
`apps/ptah-license-server/project.json`. **Disjoint.** No shared-registry file was touched
by this batch — `tsconfig.base.json`, `nx.json`, `eslint.config.mjs`, `app.module.ts`,
`route-map.spec.ts` and `app.config.ts` are all unmodified (F-4 is the one place I wanted
`app.config.ts` and did not take it). `libs/frontend/markdown` is untouched, so PRE-4's
shared preset needs no re-verification.

The foreign process committed `26c23f190` mid-batch, moving HEAD as the handoff predicted.
Verified by `git show --name-only`: none of this task's paths was in it.

**Environment note:** the pre-existing `nx serve ptah-landing-page` on `:4200` died partway
through the e2e work (it was not started by me). I restarted it and left it running, so
`:4200` is up. One earlier e2e failure was a stale `<vite-error-overlay>` from that server
recompiling mid-write — an artifact of the dev server, not of the code; it cleared on the
next run.
