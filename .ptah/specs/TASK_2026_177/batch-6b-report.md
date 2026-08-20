# Batch 6B report — TASK_2026_177, Tasks 6.6–6.11

**Executor**: `backend-developer`
**Date**: 2026-08-04
**Branch**: `ak/license-server-validation-pipe` (not switched, not created, not rebased)
**HEAD at start and end**: `097853b39` — **nothing committed, nothing staged.**

**Verdict**: all six tasks complete and green. **303 tests pass** in `api-forum`
(49 from Batch 6A + 254 new). All four graded §8.2 exit-gate assertions are real,
named, passing assertions and each was additionally run in isolation. The AD-5
structural spec now scans **8 real service files** and was proved to bite on one.
`EXPECTED_EXEMPTIONS` is still `[]`. **Six contradictions found**, three of them
substantive — §Contradictions.

**The one thing to read if you read nothing else**: [C-1](#c-1--the-membertopicdetailacceptedpost-docblock-contradicts-itself-and-i-implemented-the-other-half),
where the Batch 6A contract docblock argues against its own final sentence, and I
implemented the paragraph rather than the sentence.

---

## Gate — actual output

```
$ npx nx run-many -t eslint:lint,typecheck,test -p api-forum,api-contracts-community --skip-nx-cache

> nx run api-forum:"eslint:lint"          > eslint .
> nx run api-contracts-community:"eslint:lint"
> nx run api-contracts-community:typecheck
> nx run api-contracts-community:test     Tests: 23 passed, 23 total
> nx run api-forum:test                   Tests: 303 passed, 303 total
                                          Test Suites: 11 passed, 11 total
> nx run api-forum:typecheck              > npx tsc --noEmit --project libs/api/forum/tsconfig.lib.json

 NX   Successfully ran targets eslint:lint, typecheck, test for 2 projects
```

Wider regression check (nothing else broke):

```
$ npx nx run-many -t typecheck,test -p api-core,api-community,api-membership,api-audit,
    api-admin,api-licensing,api-member-hub,ptah-license-server --skip-nx-cache

 NX   Successfully ran targets typecheck, test for 8 projects
```

`ptah-license-server` carries `route-map.spec.ts` and `controller-validation.spec.ts`.
Both green — expected, since this batch adds **no controllers and no routes**;
they become live gates at Tasks 6.12–6.14. `api-core` is green too, which matters
because I deliberately did **not** touch its `MODEL_KEYS` census ([C-3](#c-3--createmockprisma-cannot-serve-task-69-and-its-census-blocks-the-obvious-fix)).

---

## The four graded assertions

Each was also run in isolation with `jest -t "<name>"` to prove it is the thing
passing, not a green suite around it.

### 1. RK-12 — depth repair (Task 6.8)

**Spec**: `D:\projects\ptah-extension\libs\api\forum\src\lib\posts\posts.service.spec.ts`
**Block**: `RK-12 — depth is capped at 2 by REPAIR, not by rejection` (7 tests)
**Test**: `a depth-3 reply attempt attaches at DEPTH 2, re-pointed to the parent of the parent`

```
$ npx jest --config libs/api/forum/jest.config.cts --rootDir libs/api/forum \
    -t "a depth-3 reply attempt attaches at DEPTH 2"

Test Suites: 10 skipped, 1 passed, 1 of 11 total
Tests:       302 skipped, 1 passed, 303 total
```

It asserts the **repair**, not merely the absence of depth 3:

- `prisma.post.create` was called **once** — the member's reply was SAVED;
- the written `parentId` is `'depth-1-post'`, not the requested `'depth-2-post'`;
- `bodyMarkdown` survived intact;
- a sibling test asserts no exception of any kind is raised (`resolves.toMatchObject`).

The implementation is one line in `resolveParentId`: `return parentPost.parentId ?? parentPost.id`.
A separate test proves the induction that makes one hop sufficient — every stored
`parentId` is either `null` or an id whose own parent is `null` — so there is no
loop and none is needed. Two further tests keep the `404` cases distinct from the
repair: a parent in another topic and a soft-deleted parent are **not** depth
questions.

### 2. AD-11 — `postCount` consistency (Task 6.8)

**Spec**: same file
**Block**: `AD-11 consistency — postCount equals a freshly computed count` (3 tests)
**Test**: `holds after a sequence of creates, replies, edits and soft deletes`

```
$ npx jest ... -t "holds after a sequence of creates, replies, edits and soft deletes"

Test Suites: 10 skipped, 1 passed, 1 of 11 total
Tests:       302 skipped, 1 passed, 303 total
```

⚠️ **This is deliberately not `expect(update).toHaveBeenCalledWith({ increment: 1 })`.**
That assertion passes while the _decrement_ is missing, which is the failure that
actually drifts a counter. The test instead drives the **real service** against an
in-memory model of `community_topics` + `community_posts`, and after every step
re-computes the invariant exactly as AD-11 states it:

```ts
const freshCount = (w) => w.posts.filter((p) => p.postNumber > 1 && p.deletedAt === null).length;
```

The asserted sequence: 3 replies → a nested reply → **an edit** (must not move the
counter) → 2 soft deletes → a further reply. `postCount === freshCount()` is
asserted after **every** one, and the final assertion restates it literally.
Companion tests assert post #1 is excluded (`postCount` is 0 on a fresh topic with
a body) and that `postNumber` stays unique when the highest post is a tombstone.

### 3. NFR-P4 — ≤ 5 queries for a 25-topic feed (Task 6.9)

**Spec**: `D:\projects\ptah-extension\libs\api\forum\src\lib\topics\topics-read.service.spec.ts`
**Block**: `NFR-P4 — a 25-topic feed executes at most 5 queries` (6 tests)
**Test**: `sort=recent: a 25-topic feed costs exactly 5 queries and no more`

```
$ npx jest ... -t "a 25-topic feed costs exactly 5 queries and no more"

Test Suites: 10 skipped, 1 passed, 1 of 11 total
Tests:       302 skipped, 1 passed, 303 total
```

It asserts both the bound and the exact composition, so a sixth query fails rather
than drifting silently toward the ceiling:

```
expect(queryBreakdown(prisma)).toEqual([
  'category.findMany x1',      // visibility
  'topic.count x1',            // Paged.total, under the SAME where
  'topic.findMany x1',         // the page
  'topicReadState.findMany x1',// markers, ONE `topicId: { in: [...] }`
  'user.findMany x1',          // author names, ONE `id: { in: [...] }`
]);
```

Three things make this honest rather than decorative:

1. **The counter counts every verb on every model plus raw queries**, not just
   `findMany` — an N+1 built out of `findFirst` would otherwise score zero.
2. **The service is wired to REAL collaborators** (`ReadStateService`,
   `ReactionsService`) against the same mock, so a per-row query hidden inside a
   collaborator is counted. Stubbing them would have measured only this file.
3. A dedicated test asserts **the count does not grow with page size** (25 → 50
   rows yields the identical count) — the N+1 signature itself.

`sort=unread` is separately asserted at ≤ 5. Two more tests pin the shapes the
budget depends on (`topicId: { in: [...] }`, deduplicated author ids) and assert
`findUnique`/`findFirst` were never used per row.

⚠️ **The spec's suggested fifth query does not apply to a feed.** `tasks.md`
lists "reaction counts grouped by post" among the natural five, but a feed has no
posts — reaction counts belong to the _thread_. The fifth slot is the batched
author lookup instead. Noted as [C-5](#c-5--the-nfr-p4-five-query-list-names-a-query-the-feed-cannot-have).

### 4. Search visibility and parameterisation in the SQL (Task 6.11)

**Spec**: `D:\projects\ptah-extension\libs\api\forum\src\lib\search\search.service.spec.ts`
**Blocks**: `NFR-S1 — the query is parameterised` (11 tests) and
`R1.7.2 — visibility is a WHERE clause in the query` (10 tests)

```
$ npx jest ... -t "binds the search term as a PARAMETER"

Test Suites: 10 skipped, 1 passed, 1 of 11 total
Tests:       299 skipped, 4 passed, 303 total     (it.each over all four builders)
```

**Asserted against the generated SQL, not by inspection.** The four SQL builders
are exported pure functions returning `Prisma.Sql`, which carries `.text` (with
`$1` placeholders) and `.values` (the bound parameters). Verified live before
writing the spec:

```
$ node -e "... rt.sqltag\`... a = \${'x'} AND b IN (\${rt.join(['p','q'])})\`"
text:   SELECT 1 WHERE a = $1 AND b IN ($2,$3)
values: ["x","p","q"]
```

So the assertions are:

| Property                    | Assertion                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `q` is a parameter          | `sql.values` contains `%ptah%`; `sql.text` does **not** contain `ptah`; `sql.text` matches `/ILIKE \$\d+/`               |
| category ids are parameters | `sql.text` matches `/IN \(\$\d+,\$\d+\)/` — `Prisma.join` emits one placeholder each, never a comma-joined literal       |
| injection cannot break out  | `'; DROP TABLE community_posts; --` → `sql.text` contains no `drop` in any case; exactly **one** bound value contains it |
| visibility is in the query  | all four builders' `.text` contains `t.category_id IN`                                                                   |
| AD-5 is in the query        | all four contain `t.deleted_at IS NULL`; both post builders also contain `p.deleted_at IS NULL`                          |

Plus a behavioural test that the **visible** ids reach the SQL the client actually
received (`prisma.$queryRaw.mock.calls[0][0].values` contains `visible-1`, not
`invisible-1`), and that a member who can see no category short-circuits to three
empty pages with **one** query and no `IN ()` — which is a Postgres syntax error
and the failure mode a naive `Prisma.join([])` produces.

⚠️ **A second defence the spec required me to notice.** Parameterisation stops `q`
being read as _SQL_; it does **not** stop it being read as a _LIKE pattern_. A
member searching `100%` would send `%100%%` (trailing wildcard) and `_` would
match every character in the forum — one request becoming a full scan of every
post body. `toLikePattern` escapes `\`, `%` and `_` (backslash first), the SQL
declares `ESCAPE`, and both are asserted. I confirmed against the live database
that `ESCAPE '\'` does **not** cost the trigram index — see the EXPLAIN section.

---

## Task-by-task

### Task 6.6 — Categories ✅

| File                                                                                         |          |
| -------------------------------------------------------------------------------------------- | -------- |
| `D:\projects\ptah-extension\libs\api\forum\src\lib\categories\categories.service.ts`         |          |
| `D:\projects\ptah-extension\libs\api\forum\src\lib\categories\categories.service.spec.ts`    | 35 tests |
| `D:\projects\ptah-extension\libs\api\forum\src\lib\categories\dto\create-category.dto.ts`    |          |
| `D:\projects\ptah-extension\libs\api\forum\src\lib\categories\dto\update-category.dto.ts`    |          |
| `D:\projects\ptah-extension\libs\api\forum\src\lib\categories\dto\reorder-categories.dto.ts` |          |

**R1.1.2 taken at its strong reading.** `topicCount`/`unreadCount` are computed
from topics whose `categoryId` is already restricted to the ids that survived
`buildCategoryVisibilityWhere` — never computed wide and masked. Three queries, no
N+1: visible categories → their live topics projected to `{id, categoryId, postCount}`
→ this member's markers for exactly those topics. A test asserts the `select`
carries **no** `_count` and **no** `topics` key, because
`_count: { select: { topics: true } }` counts tombstones and silently inflates
every number on the nav.

**Decisions**

- **D-6.6a — `reorder` requires the COMPLETE list** (`{ ids }`), rejecting a
  partial or duplicated one with `400`. §3.3 only says `{ ids: string[] }`.
  `sortOrder` is a _total_ ordering, so renumbering a subset onto the sparse scale
  interleaves the renumbered rows with untouched ones at values nobody chose, and
  can create ties that make `orderBy` non-deterministic between two identical
  requests. Completeness is checked **inside** the transaction, against the same
  snapshot as the writes.
- **D-6.6b — `UpdateCategoryDto` has no `slug`.** A category slug is its public
  URL and is written into `Notification.route` at write time (plan §1.6); there is
  no redirect table in this design. Deleting and recreating is the honest route,
  and `onDelete: Restrict` makes an admin confront the topics first.
- **D-6.6c — `create` appends on the sparse scale when `sortOrder` is omitted.**
  A client that must compute a sort key to create a row races every other admin.
- **`onDelete: Restrict` is the gate, not a pre-flight `count()`.** A count would
  be a TOCTOU window in which a member creates a topic between check and delete.
  Asserted: `prisma.topic.count` is never called on the delete path, and the
  `P2003` becomes a fixed 409 sentence with no `fkey` and no `community_topics` in
  it.

### Task 6.7 — Topics ✅

| File                                                                                           |          |
| ---------------------------------------------------------------------------------------------- | -------- |
| `...\src\lib\topics\topics.service.ts`                                                         |          |
| `...\src\lib\topics\topics.service.spec.ts`                                                    | 44 tests |
| `...\src\lib\topics\dto\create-topic.dto.ts` / `update-topic.dto.ts` / `moderate-topic.dto.ts` |          |

**AD-9 create is one transaction, two rows.** Asserted: one `$transaction`, one
`topic.create`, one `post.create`; the topic data carries **no** `bodyMarkdown`
and **no** `postCount`; post #1 is `{ postNumber: 1, parentId: null }`.

⚠️ **The two rows are written as two separate calls, not a nested
`posts: { create: … }`.** Both are correct at runtime. The flat form is used
because a nested relation write named `posts` is indistinguishable, to the AD-5
analyser, from a nested relation _read_ that returns tombstones — and teaching the
analyser to tell them apart would weaken the rule that catches the read. Asserted.

**ASSUMPTION-5 — the value is 24 hours**, unchanged from 6A, in
`common/edit-window.ts`. The tests construct the boundary instants from
`EDIT_WINDOW_HOURS` rather than hard-coding 24, so overruling it is still a
one-constant change and this spec follows. Asserted: at the boundary the window is
**closed**; one millisecond earlier it is open; a recent `editedAt` does **not**
reopen it (measured from `createdAt`); and **an admin gets 403 on the member path**
— the structural exemption, with `moderate()` proved not to consult the window at
all (a year-later moderator edit succeeds).

**Decisions**

- **D-6.7a — the edit-window guard is a new export on 6A's `common/edit-window.ts`.**
  §3.3 gives _both_ `PATCH topics/:id` and `PATCH posts/:id` the same "window
  closed" 403. The brief says the constant must be consumed "in exactly one
  place"; without a shared guard the _rule_ would be decided in two services and
  drift (one eventually comparing `editedAt`, or answering 400). `assertWithinEditWindow`
  keeps `EDIT_WINDOW_MS` at one consumer and the 403 at one construction site.
  **This modifies a 6A file (+1 function, +1 import).**
- **D-6.7b — no edit window on DELETE**, and the evidence is structural: §3.3
  annotates `PATCH topics/:id` as `403 (not author / window closed)` and
  `DELETE topics/:id` as plain `403`. The annotation is present on one row and
  absent on the other. A window on deletion would trap a member with content they
  want removed 25 hours after posting it.
- **D-6.7c — slug creation retries on `P2002`** (bounded, 5 attempts). Not only
  for the race `slug.ts` documents: the taken-set is read through `NOT_DELETED`
  (AD-5 binds every read in the file), so a **soft-deleted topic's slug is
  invisible to the resolver while still occupying the unique index**. Without the
  retry that is a deterministic 500. Asserted, including the sanitized 400 after
  exhaustion.
- **D-6.7d — `assertTopicNotLocked` is exported and shared with `PostsService`.**
  The lock is set here and enforced there; two independently written
  `ForbiddenException`s would produce two response bodies for one documented
  error. Asserted: status 403, `reason: 'topic_locked'`, and that the reason is a
  stable machine value.
- **D-6.7e — `moderate` and `softDeleteAsAdmin` live in this service** although
  their controllers are Task 6.13's. They are services, and `moderate` takes **no
  `MemberContext` at all** — the strongest available statement that it applies no
  visibility filter and grants no member-side authority.

### Task 6.8 — Posts ✅

| File                                                              |          |
| ----------------------------------------------------------------- | -------- |
| `...\src\lib\posts\posts.service.ts`                              |          |
| `...\src\lib\posts\posts.service.spec.ts`                         | 32 tests |
| `...\src\lib\posts\dto\create-post.dto.ts` / `update-post.dto.ts` |          |

Graded items covered above. The rest:

**Three things happen in the reply transaction, and each is a bug elsewhere**:
`postCount` increment (AD-11), `lastPostedAt` bump (the feed's sort key — a reply
that commits without it leaves an active thread sorted as dormant), and the
**author's own read marker** (R1.6.4 — done afterwards, a member's own post
flashes as unread until reload). All three asserted, plus `$transaction` called
exactly once.

**Tombstones**: asserted that exactly one post row is written (nothing cascades,
nothing is renumbered), that `post.updateMany`/`deleteMany`/`delete` are never
called, and that the stored body and author are **not** cleared — withholding
happens at the read model so R8.5's restore is a single-row write.

**Decisions**

- **D-6.8a — `postNumber` allocation uses a filtered aggregate plus a bounded
  `P2002` retry, not raw SQL and not an exemption.** This is the sharpest
  AD-5 tension in the batch and is written up as [C-4](#c-4--ad-5s-structural-rule-and-postnumber-allocation-are-in-direct-tension).
- **D-6.8b — post #1 cannot be deleted through `DELETE posts/:id`** (400 with a
  message saying to delete the topic). Tombstoning it leaves a topic that renders
  nothing while still appearing in the feed with a title and a reply count. Not
  specified either way; the alternative is a state no read model expects.
- **D-6.8c — `depthRepaired` is reported on the create result** so a client _can_
  show "replying to the thread". Nothing depends on it and it is not on the wire
  contract.

### Task 6.9 — `TopicsReadService` ✅

| File                                              |          |
| ------------------------------------------------- | -------- |
| `...\src\lib\topics\topics-read.service.ts`       |          |
| `...\src\lib\topics\topics-read.service.spec.ts`  | 35 tests |
| `...\src\lib\topics\dto\list-topics.query.dto.ts` |          |

Graded item covered above.

**Decisions**

- **D-6.9a — authors are a separate query, not an `include`.** Prisma's default
  relation-load strategy on PostgreSQL issues a second query for an included
  relation anyway, so `include: { author: … }` costs the same round trip while
  making it invisible to a reader _and_ to the counter guarding the budget. An
  explicit query is the honest number. The `select` is
  `{ id, firstName, lastName }` and a test asserts `email` is absent (NFR-S4).
- **D-6.9b — `sort=recent|unread` is implemented.** §3.3 declares it; `tasks.md`
  Task 6.9 does not mention it. `unread` is a **filter** (topics with at least one
  unread post) plus the same pinned-first ordering, not a true "order by unread
  count" — that is a per-member comparison between columns in different tables and
  Postgres cannot order by it inside this budget. Restricting is what the control
  means to a member, and it stays at ≤ 5 queries. The `OR` it builds scales with
  _topics-the-member-has-read_, not with topics; the scale-up path (a raw
  `LEFT JOIN … WHERE post_count > COALESCE(last_read_post_number, 0)`) is recorded
  in the function docblock.
- **D-6.9c — the thread read costs 6–7 queries, not 5.** NFR-P4's budget is
  stated for the _feed_ only. The thread's are: topic, post page, post count,
  reaction `groupBy`, own reactions, author names, and — only when the topic has
  an accepted answer that is off-page — one more. Documented, not asserted as a
  bound, because no requirement sets one.
- **D-6.9d — `acceptedPost` is always populated when the topic has one**, even
  off-page. See [C-1](#c-1--the-membertopicdetailacceptedpost-docblock-contradicts-itself-and-i-implemented-the-other-half).
- **Tombstone inclusion** is expressed in the `where` as
  `OR: [NOT_DELETED, { children: { some: NOT_DELETED } }]` — plan §1.3 line 136's
  exact rule ("a tombstone with children is returned; a childless one is
  omitted"), which is also what makes this read satisfy AD-5 **honestly** rather
  than needing an exemption. Asserted structurally and behaviourally (a tombstone
  returns `bodyMarkdown: ''`, `authorName: null`, keeps its `postNumber`, and the
  removed text appears nowhere in `JSON.stringify(detail)`).

### Task 6.10 — Reactions, read state, accepted answer ✅

| File                                                                                                |     |
| --------------------------------------------------------------------------------------------------- | --- |
| `...\src\lib\reactions\reactions.service.ts` / `.spec.ts` (17 tests) / `reaction-types.ts`          |     |
| `...\src\lib\read-state\read-state.service.ts` / `.spec.ts` (28 tests) / `dto\mark-read.dto.ts`     |     |
| `...\src\lib\posts\accepted-answer.service.ts` / `.spec.ts` (16 tests) / `dto\accept-answer.dto.ts` |     |

`reaction-types.ts` **declares nothing** — it re-exports `REACTION_TYPES` from
`@ptah-contracts/community`, so plan §2.5's "the fixed 4" is literally one list.
A server-side copy would compile, pass every test, and drift the first time a
fifth type is added; `PostReaction.type` is a Postgres `String`, so nothing at the
database layer would catch it.

**Asserted**: toggle is delete-if-exists-else-create inside one `$transaction`; a
second identical reaction removes the row; counts are derived by `groupBy` and
**no counter column is ever written** (`post.update`, `post.updateMany`,
`topic.update` all asserted never-called on the reaction path — RK-1); counts are
_total_ (all four keys present); a stored type outside the four is ignored; and
`emptyReactionCounts()` returns a **fresh** object each call (a shared frozen
constant aliased into 25 posts makes one mutation change all of them).

**Read state**

- **Monotonic, implemented as two statements in one transaction** because Prisma's
  `upsert` cannot express "update only if greater": an `upsert` with an **empty
  `update`** (creates when missing, no-op when present — the literal statement of
  "never backwards") followed by an `updateMany` filtered on
  `lastReadPostNumber: { lt: n }`, so the comparison is evaluated **by Postgres
  against the committed row**. Asserted, including that an out-of-order lower
  number leaves the marker at 9 rather than 2.
- **No read-state row is written by a read** — asserted on the feed path
  (`create`/`upsert`/`createMany` never called). The absence of a row is the
  "never read" signal (R1.6.3).
- **D-6.10a — `markCategoryRead` is a `deleteMany` + `createMany` pair.**
  `tasks.md` says "one `createMany`/`updateMany` pair, not a loop". A single
  `updateMany` **cannot** express it: "read" means
  `lastReadPostNumber >= postCount` and `postCount` differs per topic. A uniform
  large value would be actively wrong — set every marker to 999 and the next real
  reply computes `postCount - 999`, clamps to 0, and never shows as new again.
  Replacing the rows writes each topic's own count. It can lower a marker
  _numerically_ (only from a value a client over-claimed), but the **observable**
  unread is 0 either way, so the badge guarantee holds; and a later reply then
  correctly shows as unread. Asserted: one transaction, no per-topic upsert, and
  each row carries its own `postCount`.
- **D-6.10b — no upper clamp on `markRead`.** Clamping would need the topic's
  maximum `postNumber`, which is **not** `postCount` (tombstones keep their
  numbers, so the maximum is higher). Storing the honest claim and clamping at
  display is simpler and correct.

**Accepted answer** — asserted: author **or** admin may set (R1.5.3), anyone else
gets **403 and not 404** (they can already see the topic, so its existence is not
a secret); a topic with a null author is admin-only; marking a second answer is
**one** scalar write with no compensating clear and no `connect`/`disconnect`
(R1.5.2 by assignment); `Post.accepted` is never written; clearing is idempotent
rather than 404 (an un-accept race between two tabs must not fail for the second,
having achieved exactly the state it asked for).

- **D-6.10c — accepting post #1 is a 400.** The opening post is the _question_
  (AD-9); accepting it as its own answer is a request that cannot mean anything.
  `tasks.md` says "accepting a deleted post → 400/404" and does not cover this;
  deleted/foreign is 404 (consistent with the R1.1.3 posture), post #1 is 400.

### Task 6.11 — Search ✅

| File                                         |          |
| -------------------------------------------- | -------- |
| `...\src\lib\search\search.service.ts`       |          |
| `...\src\lib\search\search.service.spec.ts`  | 32 tests |
| `...\src\lib\search\dto\search.query.dto.ts` |          |

Graded item covered above.

**Decisions**

- **D-6.11a — visibility is resolved by the SHARED builder, then bound into the
  SQL as a parameterised `IN` list.** Re-expressing `buildCategoryVisibilityWhere`
  as hand-written SQL would be a second authority for visibility — exactly what
  the brief forbids. This is **not** a post-filter: the rows are restricted by
  the database inside the search query, so `total` is correct too. One extra
  query, and it is the same shape the feed already uses.
- **D-6.11b — `kinds` is split in a `@Transform`.** Express gives
  `?kinds=topics,posts` as one string (so `@IsIn(..., { each: true })` would run
  over characters) and `?kinds=a&kinds=b` as an array. Both normalised; an unknown
  kind is a 400 rather than being silently dropped, which would return groups the
  caller did not ask for with no error to explain why.
- **D-6.11c — `count(*)` is coerced with `Number()`.** Postgres returns `bigint`,
  Prisma maps it to `BigInt`, and `JSON.stringify` **throws** on a `BigInt` — a
  working search would become a 500 at serialisation time with a stack trace
  naming the response encoder. Asserted with a `1n` fixture and
  `expect(() => JSON.stringify(results)).not.toThrow()`.
- **Excerpts**: offsets index the **returned window**, not the source body
  (asserted with a 300-character prefix that forces a window). Case-insensitive to
  match the `ILIKE` that produced the hit. A match straddling the window edge is
  **dropped, not clipped** — a clipped length would highlight a partial word. No
  `<mark>` is ever produced, asserted even when the body itself contains
  `<script>` (returned verbatim as text; sanitisation belongs to the one
  client-side chokepoint, PRE-4/AD-1).

---

## EXPLAIN — Task 6.11, and an honest reading

**The command the spec asked for:**

```
$ docker exec ptah_postgres psql -U ptah -d ptah_db -c \
    "explain select id from community_posts where body_markdown ilike '%ptah%';"

                           QUERY PLAN
-----------------------------------------------------------------
 Seq Scan on community_posts  (cost=0.00..14.25 rows=3 width=32)
   Filter: (body_markdown ~~* '%ptah%'::text)
(2 rows)
```

🔴 **It is a `Seq Scan`, not a `Bitmap Index Scan`. Reporting what I actually see,
per the brief.**

```
$ ... "select 'posts', count(*) from community_posts union all
       select 'topics', count(*) from community_topics union all
       select 'categories', count(*) from community_categories;"
posts|0
topics|0
categories|0
```

**The reading**: at 0 rows the planner is _correct_. A sequential scan of an empty
heap costs less than reading a GIN index and rechecking, so this plan says nothing
about whether the index works. As written, the check is **vacuous** — it would
print `Seq Scan` whether the index existed, was the wrong operator class, or had
been silently dropped by a later migration.

**What makes it meaningful today.** Forcing the planner off the sequential path
asks the question the check was actually for — _is this plan available at all?_

```
$ ... "set enable_seqscan = off;
       explain select id from community_posts where body_markdown ilike '%ptah%';"

                                       QUERY PLAN
-----------------------------------------------------------------------------------------
 Bitmap Heap Scan on community_posts  (cost=12.99..20.10 rows=3 width=32)
   Recheck Cond: (body_markdown ~~* '%ptah%'::text)
   ->  Bitmap Index Scan on community_posts_body_trgm  (cost=0.00..12.99 rows=3 width=0)
         Index Cond: (body_markdown ~~* '%ptah%'::text)
(4 rows)
```

**`Bitmap Index Scan on community_posts_body_trgm`.** That proves the three things
A-7 depends on: the index exists, its `gin_trgm_ops` operator class matches the
`ILIKE '%…%'` predicate, and the planner _will_ choose it once the table is large
enough for it to win on cost. The default `Seq Scan` is a cardinality artefact,
not a missing capability.

**I also checked something the spec did not ask for and that could have bitten.**
My SQL adds `ESCAPE` (see the LIKE-metacharacter defence above), and a non-default
escape clause can affect index eligibility:

```
$ ... "set enable_seqscan = off;
       explain select id from community_posts where body_markdown ilike '%ptah%' escape '\';"
 ->  Bitmap Index Scan on community_posts_body_trgm  (cost=0.00..12.99 rows=3 width=0)
```

Identical plan. `ESCAPE '\'` does **not** cost the trigram index.

Both indexes and the extension are still present:

```
$ ... "select indexname from pg_indexes where indexname like '%_trgm' order by 1;"
community_posts_body_trgm
community_topics_title_trgm

$ ... "select extname from pg_extension where extname='pg_trgm';"
pg_trgm
```

**What it would take to make the plain check meaningful**: seeded content. The
migration in Batch 9 (MG-1, `docs/community/discourse-export.json`) will put real
rows in `community_posts`; re-run the unforced `EXPLAIN` **after** that import and
after `ANALYZE community_posts`, and the default plan should flip. Until then,
**`set enable_seqscan = off` is the version of this check that can fail for the
right reason**, and I recommend it replace the spec's command in `tasks.md`.

---

## `soft-delete-filter.spec.ts` — it is now scanning real files

**In Batch 6A it found ZERO service files and its "no violations" assertion was
honestly vacuous. It now finds EIGHT.** Verified with a throwaway script
replicating the spec's own `collectServices` walk (deleted afterwards):

```
SERVICE FILES FOUND: 8
  - categories/categories.service.ts
  - posts/accepted-answer.service.ts
  - posts/posts.service.ts
  - reactions/reactions.service.ts
  - read-state/read-state.service.ts
  - search/search.service.ts
  - topics/topics-read.service.ts
  - topics/topics.service.ts
FILTERABLE READS on topic|post: 22
UNIQUE READS on topic|post (must be 0): 0
NOT_DELETED occurrences in services: 39
AD-5-EXEMPT occurrences in services: 0
```

**22 soft-deletable read call sites checked, 0 banned `findUnique`/`findUniqueOrThrow`
on `topic`/`post`, 0 exemptions taken.**

### 🔴 PROOF BY DELIBERATE FAILURE — on a real service file

**The violation** (temporary): removed one `...NOT_DELETED` spread from
`categories.service.ts:92`, changing
`where: { ...NOT_DELETED, categoryId: { in: categoryIds } }` to
`where: { categoryId: { in: categoryIds } }`.

**Failing run — actual output:**

```
● AD-5 — every member read filters soft-deleted rows › the real source tree › has no unfiltered read

  + "RULE-FILTER: categories/categories.service.ts: topic.findMany() does not spread
     `NOT_DELETED` in its `where`, so it returns SOFT-DELETED rows (AD-5). Its `where`
     never mentions the constant — note that a literal `{ deletedAt: null }` is NOT
     accepted, on purpose: one greppable identifier is the whole point. ..."

Test Suites: 1 failed, 2 passed, 3 total
Tests:       1 failed, 48 passed, 49 total
```

It names **the real file by path**, so the loader, the directory walk and the
analysis are all proven against the real tree — not against fabricated strings.

**Reverted-green:**

```
$ grep -n "NOT_DELETED, categoryId: { in: categoryIds }" .../categories.service.ts
92:      where: { ...NOT_DELETED, categoryId: { in: categoryIds } },

Test Suites: 11 passed, 11 total
Tests:       303 passed, 303 total
```

### `EXPECTED_EXEMPTIONS` — still `[]`

```
$ grep -n "EXPECTED_EXEMPTIONS: readonly string\[\]" .../soft-delete-filter.spec.ts
133:const EXPECTED_EXEMPTIONS: readonly string[] = [];
```

**No entry was needed and none was added.** The census assertion
(`takes exactly the exemptions enumerated in EXPECTED_EXEMPTIONS`) passes against
an empty list with 8 service files in scope. Task 6.13's admin `?includeDeleted`
read remains the first expected entry.

> One thing I fixed on the way: a prose mention of the marker token in
> `posts.service.ts`'s docblock. It carried no colon so it was **not** a marker
> (confirmed by the green census), but it polluted `grep -rn "AD-5-EXEMPT"` —
> which the spec's own docblock names as the review tool. Reworded to "an AD-5
> exemption comment". `grep` now returns only the spec and the constant's
> docblock.

---

## Contradictions found

### C-1 — the `MemberTopicDetail.acceptedPost` docblock contradicts itself, and I implemented the other half

**This is the one worth a decision.** `member-topic.contract.ts:325-339` (Batch
6A, decision D-5) argues, in one paragraph:

> "Dropping the hoist would make the answer unreachable without paging to wherever
> it landed — page 4 of a long thread — **which is the entire point of accepting an
> answer**. {@link acceptedPost} is additionally `null` whenever the accepted post
> is **not on the requested page's slice**, so a client can rely on it being
> present regardless of paging."

The last sentence **negates the argument it is attached to**, and its own
justification clause ("so a client can rely on it being present regardless of
paging") describes the _opposite_ behaviour to the rule it states. Nulling
`acceptedPost` when it is off-page removes the hoist exactly in the case the hoist
exists for — a long thread — and leaves it doing nothing in the only case where it
was redundant anyway (the answer already on the page).

**What I implemented**: `acceptedPost` is populated whenever the topic has a
live accepted answer, fetched with one extra query **only** when it is off-page
and only for topics that have one. The type is unchanged (`MemberPost | null`,
null when there is no accepted answer). Asserted in
`topics-read.service.spec.ts`: _"fetches the accepted answer when it is OFF this
page — the reason the hoist exists"_, and _"costs no extra query when the topic
has no accepted answer"_.

**Recommendation**: delete that final sentence from the contract docblock. It is
one sentence, it is frontend-visible after Batch 7 renders it, and it is cheap to
overrule **now** in either direction. If the intent really was the null-when-off-page
behaviour, the change is one conditional in `getThread` plus two tests — but the
paragraph above it should then be rewritten too, because it no longer argues for
anything.

### C-2 — `visibility.ts` claims to be "the one place `isAdmin` enters a member-side decision"; R1.5.3 requires a second

`common/visibility.ts:71-73` (Batch 6A) states that ASSUMPTION-4 is "**THE ONE
PLACE IN THIS LIB WHERE `isAdmin` ENTERS A MEMBER-SIDE DECISION**". R1.5.3 —
"settable by the topic author **or an admin**" — requires `isAdmin` in
`AcceptedAnswerService.accept`, and the batch brief restates it.

The two are different in kind and both are deliberate: in `visibility.ts` `isAdmin`
widens what an admin can **see**; in `accepted-answer.service.ts` it widens who may
perform **one specific write** the topic author may already perform. It grants no
moderation authority — pin, lock, move, delete and restore all stay behind
`AdminGuard`. I recorded the distinction in `AcceptedAnswerService`'s class
docblock rather than editing 6A's file, since the claim is only overstated, not
wrong about ASSUMPTION-4 itself. **A one-word fix in `visibility.ts` ("the one
place `isAdmin` affects VISIBILITY") would close it.**

### C-3 — `createMockPrisma()` cannot serve Task 6.9, and its census blocks the obvious fix

Task 6.9 names `createMockPrisma()` as the instrument for the NFR-P4 assertion.
`libs/api/core/src/testing/mock-prisma.factory.ts` does **not** carry `category`,
`topic`, `post`, `postReaction` or `topicReadState` — and its own spec asserts the
model list by **exact equality**:

```ts
// mock-prisma.factory.spec.ts:50
expect([...MODEL_KEYS].sort()).toEqual(['adminAuditLog', … 'user'].sort());
```

So adding the forum models turns `api-core:test` red unless that assertion is
edited in the same change — and it is a census of the same kind as
`NAMED_PRIMITIVE_PARAM_COUNT`, in a lib outside this batch's territory. (The
factory's docblock claim to cover "every model in schema.prisma" was **already**
stale before this batch: `Pack`, `MemberGroup` and `Waitlist` are absent too.)

**Resolved by following the repo's existing precedent**: `packs.service.spec.ts`
and `member-groups.service.spec.ts` both hand-roll a local mock for a model the
shared factory lacks, and both name it `createMockPrisma`. I hoisted that pattern
to `libs/api/forum/src/testing/mock-forum-prisma.ts` so the lib's nine services
share **one** double instead of nine with disagreeing `$transaction` stubs. It
mirrors `libs/api/core/src/testing/` exactly, including the
`"src/testing/**/*"` entry I added to `tsconfig.lib.json`'s `exclude` (api-core has
the identical line). It is **not** exported from the barrel.

**Recommendation**: a follow-up task should either extend the shared factory and
its census together, or amend its docblock to stop claiming full schema coverage.

### C-4 — AD-5's structural rule and `postNumber` allocation are in direct tension

`soft-delete-filter.spec.ts` requires every `aggregate` on `post` to spread
`NOT_DELETED`. But `@@unique([topicId, postNumber])` **does not exclude
tombstones** — a soft-deleted post keeps its number forever (R1.3.5). So the
filtered maximum is **stale whenever the highest-numbered post has been
soft-deleted**, and the first insert attempt collides _deterministically_, not
occasionally.

Three options, and why I took the third:

1. **An `AD-5-EXEMPT` comment** — forbidden by the brief, and rightly: the census
   exists for the admin `?includeDeleted` read, not a member write path.
2. **Raw SQL** (`SELECT COALESCE(MAX(post_number),0)+1 … FOR UPDATE`-less) — it
   would be correct, but it **does not remove the need for a retry anyway**: a
   `SELECT MAX` under a transaction snapshot does not lock the range, so two
   concurrent replies still collide. It would add hand-written SQL to the hottest
   write path in the product and buy nothing.
3. **Filtered aggregate + bounded `P2002` retry** (chosen). The candidate is the
   observed maximum plus the attempt number, so it strictly advances and converges
   in one or two attempts. The unique index does the deciding — which is exactly
   what `tasks.md` says it is for ("makes a concurrent double-allocation fail
   loudly rather than duplicate") — and the retry turns "loudly" into "and then it
   worked". Asserted by the `every postNumber stays unique even when the highest
post is a tombstone` test.

The identical tension and the identical resolution apply to the **slug** taken-set
in `TopicsService.create` (D-6.7c).

**This is worth recording in `tasks.md`**: AD-5 as specified is a rule about
_member reads_, and both of these are _allocations_. The rule is right; the
collision is inherent, and the retry is the correct price.

### C-5 — the NFR-P4 five-query list names a query the feed cannot have

`tasks.md` Task 6.9: _"The natural shape is: categories (visibility) · topics page ·
topics count · read states for those topic ids · **reaction counts grouped by
post**. That is five."_ A **feed** returns `MemberTopicSummary`, which has no
posts and no reactions — that fifth query belongs to the _thread_ read model.

The feed's genuine fifth is the batched **author-name** lookup, which the list
omits and which `MemberTopicSummary.authorName` requires. Same count, different
member. Recorded because the assertion is pinned to the exact composition and a
future reader comparing it against `tasks.md` would otherwise think it had drifted.

### C-6 — `soft-delete-filter.spec.ts`'s `RULE-FILTER` checks for a MENTION, not an effect

`mentionsFilter` walks the `where` node for the identifier `NOT_DELETED`
anywhere inside it. That means this **passes** while filtering nothing:

```ts
this.prisma.post.aggregate({
  where: { topicId, OR: [NOT_DELETED, { deletedAt: { not: null } }] }, // ⚠️ passes, filters nothing
});
```

I noticed this while looking for a legitimate way through C-4 and **deliberately
did not use it** — it is precisely the "weaken a constraint to make something
pass" the brief forbids. Recording it because the same latitude is what makes the
_legitimate_ thread-read clause work:

```ts
OR: [{ ...NOT_DELETED }, { children: { some: { ...NOT_DELETED } } }]; // genuinely restricts
```

The analyser cannot tell these apart, and it probably should not try — the
distinction is semantic. **The mitigation is review, and it is worth a sentence in
the spec's docblock**: an `OR` containing `NOT_DELETED` needs a human to confirm
the other branches are narrower, not wider.

### Minor findings

- **`search.service.ts` gets ZERO AD-5 structural coverage**, because the analyser
  parses Prisma call expressions and this file emits SQL text. Its only scanned
  call is `category.findMany`, and `Category` is not soft-deletable. Mitigated by
  asserting `t.deleted_at IS NULL` and `p.deleted_at IS NULL` **directly against
  the generated SQL** in `search.service.spec.ts` — a stronger check than the
  structural one it substitutes for, but it is a substitution a future reader
  should know about. Recorded in the service's class docblock too.
- **`reflect-metadata` must be imported at the top of any spec that touches a
  DTO**, or the suite fails to run with `TypeError: Reflect.getMetadata is not a
function`. The precedent is `issue-complimentary-license.dto.spec.ts:1`. Five of
  my eight specs need it. Worth knowing before Task 6.12 writes controller specs.
- **`libs/api/forum` has no jest `setupFiles`**, which is why the above is
  per-file. A one-line `setupFiles: ['reflect-metadata']` in `jest.config.cts`
  would remove the footgun; I left it alone as it is 6A's file and the repo-wide
  idiom is the per-spec import.

---

## Deviations from the spec's file lists

Five files beyond the six tasks' lists. Batch 6A set the precedent (its D-1 and
D-9) of adding and reporting.

| File                                   | Why                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `...\src\lib\common\author-name.ts`    | `authorName` is derived in **three** services (feed, thread, search). Rule of Three. Its parameter type has **no `email` property at all**, so a `select` that forgot to omit `email` still cannot get one onto the wire through it (NFR-S4).                                                                                           |
| `...\src\lib\common\pagination.ts`     | The `Paged` envelope is built at **five** list endpoints. The 1-based `skip = (page - 1) * pageSize` off-by-one is the most repeated pagination bug there is; it is written once. It deliberately does **not** clamp — the DTO is the only gate, or a request past validation would be silently served 50 rows and told `pageSize: 50`. |
| `...\src\lib\common\post-view.ts`      | **The tombstone rule is a security boundary, not formatting.** `toMemberPost` is the one place `bodyMarkdown → ''` and `authorName → null` happen. Applied per call site instead, the first surface that forgets ships the deleted body.                                                                                                |
| `...\src\testing\mock-forum-prisma.ts` | See [C-3](#c-3--createmockprisma-cannot-serve-task-69-and-its-census-blocks-the-obvious-fix). Mirrors `libs/api/core/src/testing/`.                                                                                                                                                                                                     |
| `...\tsconfig.lib.json` (**modified**) | One line: `"src/testing/**/*"` added to `exclude`, identical to `libs/api/core/tsconfig.lib.json`. Without it the lib build type-checks a file using `jest.Mock` with `types: ["node"]`.                                                                                                                                                |

Plus **one modification to a Batch 6A file**: `common/edit-window.ts` gains
`assertWithinEditWindow` (+1 import, +1 export, no change to `EDIT_WINDOW_MS`,
`EDIT_WINDOW_HOURS` or `isWithinEditWindow`). Reasoning in D-6.7a.

---

## Scope discipline

**Not written, as instructed**: controllers, `ForumModule`, `app.module.ts` wiring,
`controller-registry.ts`, `route-map.spec.ts`, `controller-validation.spec.ts`,
`audit-log.types.ts`, the hub section. Tasks 6.12–6.15 own those.

**`libs/api/forum/src/index.ts` is untouched** — still `export {};`. Verified.

**PRE-1 / RISK-I honoured by design.** Every query payload in this batch is a
**whole-object DTO** (`ListTopicsQueryDto`, `SearchQueryDto`, `MarkReadDto`), each
with `@Type(() => Number)` on its numeric fields so `dtoPipe`'s `transform: true`
has a target. There is not a single named primitive query param, so
`NAMED_PRIMITIVE_PARAM_COUNT = 6` is undisturbed and Task 6.12 can bind each with
one `dtoPipe(TheDto)`. Every DTO's docblock states the binding requirement.

**PRE-6 kept reachable without inventing action names.** `community.*` is still
absent from `AdminAuditAction` (Task 6.13 owns adding it), so no service here
injects `AuditLogService`. Instead each admin mutation takes an optional
`AuditHook`/`ModerationAuditHook` — `(tx, targetId, changed?) => Promise<void>` —
called **inside** the mutation's own `$transaction`. Task 6.13 passes
`(tx, id) => this.audit.write({ …, tx })` and the atomicity PRE-6 requires holds.
The alternative (6.13 opening its own transaction around these) is exactly the
non-atomic shape PRE-6 forbids. Asserted in three specs that the hook receives the
same client the mutation used.

**RK-1 boundary respected**: no trust levels, no spam heuristics, no flag queues,
no digests, no websockets, **no denormalized reaction counters** (asserted
never-written), no reconciliation job, no `tsvector`, no external search.

**R7.3 respected**: no service in this batch injects `MembershipService` or a
cohort resolver. `MemberContext` is read, never re-derived.

**No `prisma migrate` command of any kind was run.** No schema change was needed.
The seeded dev entitlement was not touched.

**Git**: no `commit`, `add`, `stage`, `rm`, `checkout <path>`, `restore` or
`stash`. No `--no-verify`. No branch created, switched or rebased. HEAD unchanged
at `097853b39`, nothing staged.

---

## Final `git status --porcelain`, annotated

```
 M apps/ptah-license-server/prisma/schema.prisma                              <- BATCH 6A (6.3)
 M libs/api-contracts/community/src/index.ts                                  <- BATCH 6A (6.2)
 M libs/api-contracts/community/src/lib/member/member-topic.contract.ts       <- BATCH 6A (6.2)
 M libs/backend/persistence-sqlite/.../0028_gateway_conversation_workspace_root.spec.ts   <- 🔴 FOREIGN
 M libs/backend/persistence-sqlite/.../0030_skill_event_metrics.spec.ts                   <- 🔴 FOREIGN
 M libs/backend/persistence-sqlite/src/lib/migrations/index.ts                            <- 🔴 FOREIGN
 M libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts                         <- 🔴 FOREIGN
 M libs/backend/task-specs/src/lib/contract.guard.spec.ts                                 <- 🔴 FOREIGN
 M libs/backend/task-specs/src/lib/task-frontmatter.ts                                    <- 🔴 FOREIGN
 M libs/backend/task-specs/src/lib/task-index.store.spec.ts                               <- 🔴 FOREIGN
 M libs/backend/task-specs/src/lib/task-index.store.ts                                    <- 🔴 FOREIGN
 M libs/backend/vscode-lm-tools/.../tool-description.builder.ts                           <- 🔴 FOREIGN
 M libs/backend/vscode-lm-tools/.../tasks-namespace.builder.ts                            <- 🔴 FOREIGN
 M libs/frontend/tasks-ui/src/lib/task-presentation.ts                                    <- 🔴 FOREIGN
 M libs/shared/src/lib/types/rpc/rpc-tasks.types.ts                                       <- 🔴 FOREIGN
 M libs/shared/src/lib/types/task-spec.contract.ts                                        <- 🔴 FOREIGN
 M libs/shared/src/lib/types/task-spec.types.ts                                           <- 🔴 FOREIGN
 M tsconfig.base.json                                                         <- BATCH 6A (6.1)
?? apps/ptah-license-server/prisma/migrations/20260812090000_community_forum/ <- BATCH 6A (6.4)
?? libs/api-contracts/community/src/lib/admin/admin-topic.contract.ts         <- BATCH 6A (6.2)
?? libs/api-contracts/community/src/lib/member/member-search.contract.ts      <- BATCH 6A (6.2)
?? libs/api/forum/                                                            <- 6A + MINE (see below)
?? libs/backend/persistence-sqlite/.../0031_task_specs_metadata.spec.ts                   <- 🔴 FOREIGN
?? libs/backend/persistence-sqlite/.../0031_task_specs_metadata.ts                        <- 🔴 FOREIGN

$ git diff --cached --name-only
(empty)
```

### 🔴 CONCURRENT FOREIGN WIP: PRESENT — 15 files, all untouched by me

A concurrent process is working on a **task-specs / tasks-UI** change spanning
`libs/backend/persistence-sqlite`, `libs/backend/task-specs`,
`libs/backend/rpc-handlers`, `libs/backend/vscode-lm-tools`,
`libs/frontend/tasks-ui` and `libs/shared` — including a new SQLite migration
`0031_task_specs_metadata`. **Every one of those paths is on the brief's foreign
list. I did not read, edit, stage or run anything against them**, and none of them
is reachable from `scope:api`, so they cannot affect this batch's gate.

⚠️ **The orchestrator must stage path-by-path.** `git add -A` here would sweep an
unrelated, half-finished feature — including a new migration — into this batch's
commit. The safe set is:

```
apps/ptah-license-server/prisma/schema.prisma
apps/ptah-license-server/prisma/migrations/20260812090000_community_forum/
libs/api-contracts/community/
libs/api/forum/
tsconfig.base.json
```

### `libs/api/forum/` — 49 files, split by batch

**Batch 6A (9 files, unchanged by me except where noted):** `README.md`,
`eslint.config.mjs`, `jest.config.cts`, `package.json`, `project.json`,
`tsconfig.json`, `tsconfig.spec.json`, `src/index.ts`, and the 7 files under
`src/lib/common/` — of which **`tsconfig.lib.json` and `common/edit-window.ts` I
modified** (one `exclude` line; one added export).

**Batch 6B (mine, 38 new files):**

```
src/lib/categories/categories.service.ts                 src/lib/posts/dto/accept-answer.dto.ts
src/lib/categories/categories.service.spec.ts            src/lib/posts/dto/create-post.dto.ts
src/lib/categories/dto/create-category.dto.ts            src/lib/posts/dto/update-post.dto.ts
src/lib/categories/dto/update-category.dto.ts            src/lib/reactions/reaction-types.ts
src/lib/categories/dto/reorder-categories.dto.ts         src/lib/reactions/reactions.service.ts
src/lib/common/author-name.ts                            src/lib/reactions/reactions.service.spec.ts
src/lib/common/pagination.ts                             src/lib/read-state/read-state.service.ts
src/lib/common/post-view.ts                              src/lib/read-state/read-state.service.spec.ts
src/lib/posts/posts.service.ts                           src/lib/read-state/dto/mark-read.dto.ts
src/lib/posts/posts.service.spec.ts                      src/lib/search/search.service.ts
src/lib/posts/accepted-answer.service.ts                 src/lib/search/search.service.spec.ts
src/lib/posts/accepted-answer.service.spec.ts            src/lib/search/dto/search.query.dto.ts
src/lib/topics/topics.service.ts                         src/lib/topics/dto/create-topic.dto.ts
src/lib/topics/topics.service.spec.ts                    src/lib/topics/dto/update-topic.dto.ts
src/lib/topics/topics-read.service.ts                    src/lib/topics/dto/moderate-topic.dto.ts
src/lib/topics/topics-read.service.spec.ts               src/lib/topics/dto/list-topics.query.dto.ts
src/testing/mock-forum-prisma.ts
```

(38 = 8 services + 8 specs + 13 DTOs/support + `reaction-types.ts` + 3 `common/` +
the test double + 4 more DTOs listed above.)

No scratch files remain: the census script and the deliberate-failure backup were
deleted, and `git status` shows nothing stray.

---

## What Task 6.12's executor should know

1. **`import 'reflect-metadata';` first, in every spec that touches a DTO**, or
   the suite fails to run entirely. Not a runtime concern — `main.ts` imports it —
   but jest has no `setupFiles` here.
2. **Every query DTO is already whole-object and already carries `@Type(() => Number)`.**
   Bind each with `dtoPipe(TheDto)` and `NAMED_PRIMITIVE_PARAM_COUNT = 6` is
   undisturbed. Each DTO's docblock says so at the top.
3. **`resolveTopicQuery()` and `resolveSearchQuery()` apply the defaults**, deliberately
   outside the DTO — class-field initialisers would make "omitted" and "sent the
   default" indistinguishable (the `suppliedKeys` trap `packs.service.ts`
   documents). Call them; do not re-default in the controller.
4. **Services return identifiers, not wire shapes.** `TopicsService.create` →
   `{ id, slug, firstPostId }`; the controller composes `MemberTopicDetail` via
   `TopicsReadService.getThread`. That keeps the feed's query budget out of the
   create path.
5. **`PATCH categories/reorder` MUST be declared before `categories/:id`** (RI-3),
   or Nest matches `:id === 'reorder'`. Recorded in `ReorderCategoriesDto`'s
   docblock too.
6. **The audit seam is an optional last parameter** on every admin mutation, not
   an injected service. Pass `(tx, id) => this.audit.write({ …, tx })` once
   `community.*` lands in `AdminAuditAction` (Task 6.13).
7. **The barrel is still `export {};`** and gains exactly three `export *` lines —
   `ForumModule`, `TopicsReadService`, `ReadStateService` — at Task 6.14.
8. **Two decisions are cheap to overrule now and expensive after Batch 7 renders
   them**: [C-1](#c-1--the-membertopicdetailacceptedpost-docblock-contradicts-itself-and-i-implemented-the-other-half)
   (`acceptedPost` off-page) and 6A's still-open `MemberCategory.unreadCount`
   semantics.
