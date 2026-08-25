# Batch 6.1 report — the three backend defects Batch 7 found by driving the real API

**Executed** 2026-08-05 by `backend-developer`.
**Branch** `ak/license-server-validation-pipe` — never switched, never created, never rebased.
**Nothing was committed or staged.** No `git add`, `commit`, `rm`, `stash`, `reset`, `checkout <path>`
or `restore` was run. `--no-verify` was never used. No `prisma migrate` / `db push` / `reset` was
run — all three defects were code-level and no schema change was needed. No sub-agent or CLI
delegation was used.

---

## 0. Headline verdict

**All three fixed, each with a regression test proven red on the unfixed code and green after — and
F-1 and F-2 were both bigger than reported.**

| #       | As reported by Batch 7               | As verified here                                                                                                                                       |
| ------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F-1** | one wrong line in `unreadCount`      | **FOUR sites** mix the two units, and they were mutually consistent. **The proposed one-line fix would have created a new, louder defect** — see §1.2. |
| **F-2** | `CreatePostDto.parentId` returns 500 | **TWELVE fields across FIVE DTOs** return 500 on an explicit `null`. Measured, one request each.                                                       |
| **F-3** | no author filter on the member feed  | Confirmed exactly as reported. Shipped as `?mine=true` on the existing DTO.                                                                            |

Batch 7's analysis was correct everywhere it went; it just stopped one layer short on F-1 and F-2
because it was measuring from outside the server.

**Census constants are unmoved** (§5). **The gate is green with 0 errors** (§6). **The seed is
byte-for-byte as Batch 8 left it** (§7).

---

## 1. F-1 — `unreadCount` under-reports by one 🔴 FIXED

### 1.1 Root cause, as verified rather than inherited

Batch 7's diagnosis is right and I reproduced it live before touching anything:

```
== SQL truth ==                              == server (BEFORE) ==
title              post_count marker true    title                 replyCount unreadCount
B61 probe 2 replies     2       2      1      B61 probe 2 replies       2          0
B61 probe 3 replies     3       2      2      B61 probe 3 replies       3          1
B61 probe 4 replies     4       2      3      B61 probe 4 replies       4          2
```

`Topic.postCount` counts **replies** (`posts.service.ts` class docblock: `postCount ===
count({ postNumber > 1, deletedAt: null })`). `TopicReadState.lastReadPostNumber` is a **post
number**, written from `MarkReadDto.lastReadPostNumber` (a client-supplied `postNumber`) and from
`PostsService.createReply`'s `post.postNumber`. The read side then subtracted one from the other.

### 1.2 🔴 What Batch 7 missed: it is FOUR sites, and the proposed fix breaks one of them

The read side is not the only place the two units meet. I found four:

| #   | Site                                                                            | Direction | Before                                |
| --- | ------------------------------------------------------------------------------- | --------- | ------------------------------------- |
| 1   | `read-state.service.ts:29` `unreadCount()`                                      | read      | `postCount - marker`                  |
| 2   | `topics-read.service.ts:459` `buildUnreadWhere()` — the `sort=unread` filter    | read      | `postCount: { gt: lastRead }`         |
| 3   | `categories.service.ts:129` — the category rail's "topics with unread activity" | read      | `postCount > (marker ?? 0)`           |
| 4   | `read-state.service.ts:190` `markCategoryRead()`                                | **WRITE** | `lastReadPostNumber: topic.postCount` |

All four were **consistent with each other and all wrong**, which is why no single-site test could
see it — and why the query-level defects never surfaced as separate bug reports. Measured live,
before the fix:

```
== sort=unread (BEFORE) ==
probe topics returned: [ 'B61 probe 4 replies u=2', 'B61 probe 3 replies u=1' ]
                       ← the 2-reply topic, which HAS 1 unread reply, was FILTERED OUT

== category unreadCount (BEFORE) ==
general topicCount 5 unreadCount 2      ← should be 3
```

So `sort=unread` — the "show me what's new" control — **hid** a thread that the feed would have
badged, and the rail under-counted by one topic for every thread whose only unread post was its
newest.

**Site 4 is the one that matters for the proposed repair.** `markCategoryRead` writes a marker
_derived from_ `postCount`. Applying Batch 7's one-liner —

```ts
return Math.max(0, postCount - Math.max(0, lastReadPostNumber - 1));
```

— and nothing else would make `markCategoryRead` write `postCount` (a reply count) into a post-number
column, and every topic would then report `postCount - (postCount - 1) = 1` unread **immediately
after the member clicked "mark all read"**. That is a newer and far more visible defect than the one
being fixed. The conversion runs in **both directions** and both halves have to move together.

### 1.3 The fix, and why that shape

**New file** `libs/api/forum/src/lib/common/post-numbering.ts` — one named home for the two units and
the conversion between them, per the brief's instruction that "the units must be named in the code":

```ts
export const FIRST_POST_NUMBER = 1;

/** POST NUMBER → REPLY COUNT: how many REPLIES a read marker means have been read. */
export function repliesRead(lastReadPostNumber: number): number {
  return Math.max(0, lastReadPostNumber - FIRST_POST_NUMBER);
}

/** REPLY COUNT → POST NUMBER: the marker meaning "every reply read" (R1.6.5). */
export function markerForAllRepliesRead(postCount: number): number {
  return postCount + FIRST_POST_NUMBER;
}
```

**I rejected the bare `- 1` at the call site**, exactly as the brief anticipated: an unexplained `-1`
is what the next reader "corrects" back, and it cannot express the write direction at all. A named
function pair also makes the round trip stateable as a property (`repliesRead(markerForAllRepliesRead(n)) === n`),
which is what the regression test asserts instead of two independent expectations.

`FIRST_POST_NUMBER` **moved** here from `posts.service.ts` (its only other consumer,
`accepted-answer.service.ts`, was repointed). One declaration, one home; `common/` has no dependency
on any service so there is no cycle, and `common/` is not barrel-exported (`forum.module.spec.ts`
asserts that), so the lib's public surface is unchanged.

All four sites now go through it. The file's docblock carries the measured table and states
explicitly why a one-line fix is wrong.

**Boundary cases, each verified (`unread-units.spec.ts`, and by hand):**

| Marker            | Meaning                        | Reported            | Requirement                              |
| ----------------- | ------------------------------ | ------------------- | ---------------------------------------- |
| `0` (no row)      | never opened                   | whole reply count   | R1.6.3 ✅                                |
| `1`               | body read, no replies          | whole reply count   | R1.6.3 ✅ — the case no test asked about |
| `2 … postCount`   | N-1 replies read               | `postCount - (N-1)` | ✅                                       |
| `postCount + 1`   | fully caught up                | `0`                 | ✅                                       |
| `> postCount + 1` | over-claimed / replies deleted | `0`, never negative | R1.6.2 ✅                                |

### 1.4 The regression test, and what changed about its SHAPE

**New** `libs/api/forum/src/lib/read-state/unread-units.spec.ts`.

The brief asked what made F-1 invisible to unit tests. It was not the mock alone. The two existing
cases were:

```ts
// read-state.service.spec.ts
it('is postCount minus lastReadPostNumber', () => { expect(unreadCount(10, 4)).toBe(6); });
// topics-read.service.spec.ts
it('unread is postCount - lastReadPostNumber', ...) expect(page.items[0]?.unreadCount).toBe(6);
```

Both **restated the implementation's arithmetic as the expectation, over two independent integers
whose units never appear**. `10` and `4` are just numbers; any subtraction of them looks as right as
any other. Those tests were not merely blind to the defect — they were its accomplices, and they had
to change (§1.5).

Three shape changes, all of them the point:

1. **One source of truth per case.** The fixture is a `Thread` — a real list of post numbers plus a
   marker — and _both_ `postCount` and the expected answer are derived from it:

   ```ts
   const postCountOf = (t) => t.postNumbers.filter((n) => n > BODY_POST_NUMBER).length;
   const trueUnreadOf = (t) => t.postNumbers.filter((n) => n > BODY_POST_NUMBER && n > t.marker).length;
   ```

   The expected value is a **count of posts obtained by filtering the thread**, never a subtraction.
   Two operands derived from one model cannot silently be in different units.

2. **The domain fact is restated independently.** `BODY_POST_NUMBER = 1` is declared _in the spec_,
   not imported from `post-numbering.ts`. Importing it would make the spec inherit the assumption it
   exists to check — a spec that derives its expectation from the implementation's constants can only
   confirm the implementation is self-consistent, which is precisely the state F-1 shipped in.

3. **It covers all four sites against the same threads**, including the write path. The
   `markCategoryRead` round trip feeds the written marker straight back through `unreadCount` and
   demands `0` — that case is what refuses the one-line fix.

**RED on the unfixed code** (`npx nx test api-forum --testPathPatterns=unread-units`):

```
Tests: 14 failed, 9 passed, 23 total

● unreadCount() › read the BODY only — post #1 is not a reply, so nothing is read
● unreadCount() › read one reply of four
● unreadCount() › read three replies of four
● unreadCount() › one reply, one unread — the case that rendered NO badge at all
● unreadCount() › the LIVE F-1 table now reads correctly
● listFeed — the badge a member actually sees › every row reports the replies above its marker
● listFeed — the badge a member actually sees › a thread with exactly ONE unread reply reports 1, not 0
● sort=unread — the FILTER must agree with the COUNT › selects exactly the threads whose unread count is > 0
● CategoriesService.listForMember › counts exactly the topics whose unread reply count is > 0
● markCategoryRead — the round trip that refuses a one-line fix › the written marker is a POST NUMBER…
● markRead — the count it echoes back matches the feed › (×4 markers)

  ● markRead › one reply, one unread — the case that rendered NO badge at all
    - Expected  "unreadCount": 1
    + Received  "unreadCount": 0
```

Note which case _passed_ red: `markCategoryRead › leaves EVERY topic at 0 unread` — because the old
write and the old read were wrong in matching directions. That pairing is the whole reason the
round-trip case exists.

**GREEN after the fix:**

```
$ npx nx test api-forum --skip-nx-cache --testPathPatterns=unread-units
Test Suites: 1 passed, 1 total
Tests:       23 passed, 23 total
```

### 1.5 Three existing tests had to change — stated plainly, not slipped in

These were **not weakened**; they asserted the defect and were rewritten to assert the requirement,
each with a comment recording that it was an accomplice:

| File                          | Was                                                                                  | Now                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `read-state.service.spec.ts`  | `unreadCount(10, 4) === 6` under the title _"is postCount minus lastReadPostNumber"_ | `=== 7`, retitled _"a marker of N means the N-1 replies below it are read (AD-9)"_; plus a **new** case for marker `1` |
| `read-state.service.spec.ts`  | `markCategoryRead` writes `[4, 0, 9]`; `markRead(…, 10)` clears a 10-reply topic     | writes `[5, 1, 10]`; `markRead(…, 11)` clears it                                                                       |
| `topics-read.service.spec.ts` | `unreadCount === 6` under _"unread is postCount - lastReadPostNumber"_               | `=== 7`, retitled _"unread is the replies ABOVE the marker, and the marker counts post #1"_                            |
| `categories.service.spec.ts`  | _"a fully read category"_ fixture set markers to `postCount`                         | markers are `postCount + 1` — the fixture was in the wrong unit                                                        |

### 1.6 Live re-measurement — Batch 7's table, re-run against the fixed server

Same fixtures, same markers, same rows in Postgres:

```
== SQL truth (unchanged) ==
B61 probe unread 2 replies | post_count 2 | marker 2 | true unread 1
B61 probe unread 3 replies | post_count 3 | marker 2 | true unread 2
B61 probe unread 4 replies | post_count 4 | marker 2 | true unread 3

BATCH 7 (before)                        BATCH 6.1 (after)
TRUE | server | post_count | marker     TRUE | server | post_count | marker
  1  |   0    |     2      |   2          1  |   1    |     2      |   2
  2  |   1    |     3      |   2          2  |   2    |     3      |   2
  3  |   2    |     4      |   2          3  |   3    |     4      |   2
```

The other three sites, live:

```
== sort=unread (AFTER) ==       [ '4 replies u=3', '3 replies u=2', '2 replies u=1' ]
                                 ← the 2-reply topic is back in the unread feed
== categories (AFTER) ==        general topicCount 5 unreadCount 3   (was 2)

== mark-all-read round trip (the case a one-line fix breaks) ==
POST categories/:id/read-all -> {"topicsMarked":5}
  post_count 2 -> marker 3      GET topics -> unreadCount 0
  post_count 3 -> marker 4      GET topics -> unreadCount 0
  post_count 4 -> marker 5      GET topics -> unreadCount 0
```

**Batch 7's `test.fail()` in `members-community.spec.ts:209` can now be promoted to a normal test**,
which closes the last §8.2 gate clause. I did not touch it — `libs/web/**` and
`apps/ptah-landing-page-e2e/**` are Batch 7's uncommitted work and were out of bounds.

---

## 2. F-2 — an explicit `null` returns 500 🔴 FIXED (all twelve of them)

### 2.1 Root cause, as verified

Confirmed live, and traced to the exact line. `resolveParentId` (`posts.service.ts:257`) reads:

```ts
if (requestedParentId === undefined) return null;
```

An explicit `null` falls through to `post.findFirst({ where: { id: null, … } })`, which Prisma
rejects with a `PrismaClientValidationError`. **That call is at line 149, OUTSIDE the retry loop's
`try`/`catch`** — so it is never seen by `mapPrismaError`, propagates unhandled, and becomes a 500.
`@IsOptional()` is what let it get that far: class-validator skips the property entirely for `null`
as well as `undefined`, so `@IsString()`, `@MinLength(1)` and `@MaxLength(64)` never ran.

### 2.2 🔴 The `@IsOptional()` sweep — the deliverable, and it is twelve, not one

I enumerated every `@IsOptional()` in `libs/api/forum` (28 occurrences across 12 DTO files) and
**sent one live request per field**. Results below are measured HTTP status codes, not inference.

| DTO                                         | Field                                                        | Declared type    | `null` BEFORE | Why                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------ | ---------------- | ------------- | ------------------------------------------------------------------------------------------- |
| `posts/dto/create-post.dto.ts`              | `parentId`                                                   | `string`         | **500**       | `post.findFirst({ where: { id: null } })` outside the catch                                 |
| `topics/dto/update-topic.dto.ts`            | `title`                                                      | `string`         | **500**       | `!== undefined` passes → `topic.update({ data: { title: null } })` on a non-nullable column |
| `topics/dto/update-topic.dto.ts`            | `bodyMarkdown`                                               | `string`         | **500**       | same, on post #1                                                                            |
| `topics/dto/moderate-topic.dto.ts`          | `pinned`                                                     | `boolean`        | **500**       | `data.pinned = null`                                                                        |
| `topics/dto/moderate-topic.dto.ts`          | `locked`                                                     | `boolean`        | **500**       | `data.locked = null`                                                                        |
| `topics/dto/moderate-topic.dto.ts`          | `categoryId`                                                 | `string`         | **500**       | `category.findUnique({ where: { id: null } })`                                              |
| `topics/dto/moderate-topic.dto.ts`          | `title`                                                      | `string`         | **500**       | `data.title = null`                                                                         |
| `topics/dto/moderate-topic.dto.ts`          | `bodyMarkdown`                                               | `string`         | **500**       | `post.updateMany({ data: { bodyMarkdown: null } })`                                         |
| `categories/dto/update-category.dto.ts`     | `name`                                                       | `string`         | **500**       | `data.name = null`                                                                          |
| `categories/dto/update-category.dto.ts`     | `visibility`                                                 | `Visibility`     | **500**       | `data.visibility = null`                                                                    |
| `categories/dto/update-category.dto.ts`     | `cohortKeys`                                                 | `string[]`       | **500**       | `cohortKeys.length` on `null` → TypeError                                                   |
| `categories/dto/update-category.dto.ts`     | `sortOrder`                                                  | `number`         | **500**       | `data.sortOrder = null`                                                                     |
| `categories/dto/update-category.dto.ts`     | `description`                                                | `string \| null` | **200**       | ✅ **intended** — `null` clears the stored value                                            |
| `categories/dto/create-category.dto.ts`     | `description`                                                | `string \| null` | **201**       | ✅ **intended** — same contract                                                             |
| `categories/dto/create-category.dto.ts`     | `cohortKeys`                                                 | `string[]`       | 201           | survived by luck: `input.cohortKeys ?? []`                                                  |
| `categories/dto/create-category.dto.ts`     | `sortOrder`                                                  | `number`         | 201           | survived by luck: `input.sortOrder ?? nextSortOrder()`                                      |
| `topics/dto/list-topics.query.dto.ts`       | `categoryId`, `sort`, `page`, `pageSize`                     | —                | n/a           | query strings; `null` unreachable over HTTP, and `resolveTopicQuery` uses `??`              |
| `topics/dto/list-admin-topics.query.dto.ts` | `includeDeleted`, `categoryId`, `search`, `page`, `pageSize` | —                | n/a           | same                                                                                        |
| `topics/dto/thread.query.dto.ts`            | `page`, `pageSize`                                           | —                | n/a           | same                                                                                        |
| `search/dto/search.query.dto.ts`            | `kinds`, `page`, `pageSize`                                  | —                | n/a           | same                                                                                        |

Live evidence, before:

```
POST   …/topics/:id/posts            {"bodyMarkdown":"…","parentId":null}  -> 500
PATCH  …/members/community/topics/:id {"title":null}                       -> 500
PATCH  …/admin/community/topics/:id   {"pinned":null}                      -> 500
PATCH  …/admin/community/categories/:id {"visibility":null}                -> 500
… twelve in total, each measured individually
```

**Not one field, twelve.** The brief's warning was right: fixing `parentId` alone would have made the
pattern look inspected while eleven more sat behind it.

### 2.3 The fix, and the `null`-means-absent decision

**New file** `libs/api/forum/src/lib/common/optional-field.ts` with two decorators:

```ts
/** Optional, but an explicit `null` is a 400 — not a 500 four layers down. */
export function IsOptionalNotNull(): PropertyDecorator {
  return ValidateIf((_object: unknown, value: unknown) => value !== undefined) as PropertyDecorator;
}

/** `null` MEANS "not supplied" for this field, so normalise it at the boundary. */
export function NullMeansAbsent(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => (value === null ? undefined : value)) as PropertyDecorator;
}
```

`@ValidateIf` rather than a "not null" validator, because `@IsOptional()` short-circuits the property
_before_ any sibling validator is consulted — a sibling would never run. `@ValidateIf` gates the whole
property: omitted → vacuous, present (including `null`) → judged by the `@IsString()` / `@IsInt()` /
`@IsBoolean()` already on the field, so the refusal message **names the property and the expected
type**. Whitelisting is unaffected: `@ValidateIf` registers its own metadata, so `whitelist: true`
does not strip the field.

**26 of the 28 `@IsOptional()` occurrences became `@IsOptionalNotNull()`.** The two survivors are the
`description` fields, where `null` is a deliberate part of the PATCH contract.

**`CreatePostDto.parentId` is the one field treated as "null means absent"**, and I chose that over a 400. Reasoning, as the brief asked:

- `MemberPost.parentId` is `string | null` on the wire. A client that holds one and hands it straight
  back is doing a **reasonable** thing, not a malformed one.
- It is the literal truth of the request: a post with no parent **is** a top-level reply, which is
  exactly what omitting the key means. `undefined` is how JSON says "unspecified"; `null` is how a
  typed client says it. Refusing one and accepting the other would be a distinction the wire format
  does not have, paid for by discarding a member's written reply.
- It is normalised **once, at the boundary**, so nothing below the DTO ever sees a value it is not
  typed for — the `resolveParentId` signature stays honest at `string | undefined`.
- `@IsOptionalNotNull()` still sits beside it, so a _wrong-typed_ `parentId` (a number, an empty
  string) is a 400 exactly as before. Normalising `null` did not open the field.

Batch 7's client-side workaround (omitting the key when nullish) remains correct client behaviour and
needs no change.

### 2.4 The regression test — behavioural **and** structural

**New** `libs/api/forum/src/lib/common/nullable-dto.spec.ts`.

Behavioural alone would pin today's twelve and let a thirteenth in tomorrow, so the file has a
structural half built on the `soft-delete-filter.spec.ts` idiom:

- **The rule**: `@IsOptional()` is permitted only on a property whose declared type includes `null`.
  Enforced by a TypeScript AST walk over every `*.dto.ts` in the lib. The failure message names the
  file, the property and what to write instead.
- **The census**: `EXPECTED_NULLABLE_OPTIONALS` lists the two legitimate uses by `<file>:<property>`.
  Adding a third fails the build until the constant is edited in the same change — so "accept null
  here" becomes a line a reviewer reads, not a decorator nobody looks at twice.
- **Anti-vacuity**: a floor of 30 decorated properties (33 today), plus a probe running fabricated
  DTOs through the same `violationsIn()` to prove it flags a violation _and_ clears the legal shapes.
- **Behavioural**: one `it.each` case per field measured at 500, plus the two intended `description`
  cases, plus six cases for `parentId`'s normalisation.

**RED on the unfixed code:**

```
● the structural rule over every DTO in the lib › no @IsOptional() sits on a field whose type cannot be null
    - Expected  -  1
    + Received  + 30              ← 28 violations, named
● the structural rule over every DTO in the lib › takes exactly the nullable optionals enumerated in the census
    - Expected  -  0
    + Received  + 28
● [UpdateTopicDto].title: null is a validation error, not an unhandled exception
    - Expected  - 3               ← ['title']
    + Received  + 1               ← []
… one per field, twelve in total
● CreatePostDto.parentId › normalises an explicit null to undefined at the DTO boundary
```

**GREEN after the fix:**

```
$ npx nx test api-forum --skip-nx-cache --testPathPatterns=nullable-dto
Test Suites: 1 passed, 1 total
Tests:       24 passed, 24 total
```

### 2.5 Live re-measurement — all twelve, after

```
--- UpdateTopicDto ---
member topic title:null          400  {"message":["title must be shorter than or equal to 200 characters",…]}
member topic bodyMarkdown:null   400  {"message":["bodyMarkdown must be shorter than or equal to 50000 characters",…]}
--- ModerateTopicDto ---
admin topic pinned:null          400  {"message":["pinned must be a boolean value"],…}
admin topic locked:null          400  {"message":["locked must be a boolean value"],…}
admin topic categoryId:null      400  {"message":["categoryId must be shorter than or equal to 64 characters",…]}
admin topic title:null           400
admin topic bodyMarkdown:null    400
--- UpdateCategoryDto ---
admin category name:null         400  {"message":["name must be shorter than or equal to 120 characters",…]}
admin category visibility:null   400  {"message":["visibility must be one of: member, cohort, staff"],…}
admin category cohortKeys:null   400  {"message":["each cohortKey must be a lowercase slug (2-40 chars of a-z, 0-9, -)",…]}
admin category sortOrder:null    400  {"message":["sortOrder must not be less than 0","sortOrder must be an integer number"],…}
--- the two DELIBERATE cases still work ---
admin category description:null  200  {"…","description":null,…}
create   description:null        201  {"…","description":null,…}
--- CreatePostDto.parentId ---
POST …/posts {"bodyMarkdown":"…","parentId":null}  ->  201  {…,"parentId":null,…}
```

Every 500 became a 400 that **names the offending property** — which is also NFR-S7 satisfied rather
than merely un-violated: no raw library message reaches the client on any of these paths.

**Client-compatibility check before shipping the stricter rule.** I read (did not modify)
`libs/web/admin/.../admin-builders-api.service.ts` and
`libs/web/members/.../member-community-api.service.ts`: both build community payloads and query
params conditionally and send no explicit `null` to the forum. The `cohortKey: string | null` nulls
in the admin service belong to the **packs** endpoints in `@ptah-api/admin`, a different lib. So the
tightening breaks no existing caller.

---

## 3. F-3 — no author filter on the member feed 🔴 FIXED

### 3.1 Root cause, as verified

Confirmed exactly as reported. Measured before:

```
GET …/topics?mine=true      ->  400 {"message":["property mine should not exist"],…}
GET …/topics?authorId=<id>  ->  400 {"message":["property authorId should not exist"],…}
```

`ListTopicsQueryDto` accepted `categoryId`, `sort`, `page`, `pageSize` and nothing else, and the
global pipe runs `forbidNonWhitelisted: true`. `implementation-plan.md:350`'s `@@index([authorId])`
had no reader anywhere in the lib.

### 3.2 The fix, and why that shape

**`mine?: boolean` on the existing whole-object `ListTopicsQueryDto`**, plus one conditional spread in
`TopicsReadService.listFeed`:

```ts
const where: Prisma.TopicWhereInput = {
  ...NOT_DELETED,
  categoryId: categoryFilter,
  ...unreadClause,
  ...(resolved.mine ? { authorId: ctx.userId } : {}),
};
```

Every constraint in the brief is met, and each is asserted:

- **`mine=true`-shaped, not `authorId=<id>`-shaped.** The author id comes from
  `req.memberContext.userId`, resolved once by `MemberGuard` (R7.3). There is no identity in the
  request to forge. An `?authorId=` parameter would let any entitled member enumerate any other
  member's threads, and _no downstream visibility filtering would refuse it_ — those topics genuinely
  are visible to them. It is an authorisation hole dressed as a filter, and the DTO simply has no
  such field.
- **A property of the existing DTO, not `@Query('mine')`.** `NAMED_PRIMITIVE_PARAM_COUNT` stays at
  **6** (§5).
- **Composes, never replaces.** All three clauses go into one `where`, so Postgres ANDs them. The
  spread is conditional rather than `authorId: mine ? ctx.userId : undefined` — Prisma treats
  `undefined` as "no filter" so both behave the same, but only one makes the absence visible in a
  `where` a spec can read.
- **Inside NFR-P4.** It is a clause, not a query. Asserted at ≤ 5 with the identical breakdown.
- **No new route.** `GET v1/members/community/topics` is unchanged, so `EXPECTED_ROUTES` and
  `controller-registry.ts` need no edit — and I did not touch them (§5).

The transform mirrors `ListAdminTopicsQueryDto.includeDeleted` exactly: only `true` / `'true'` / `'1'`
are affirmative, because Express hands query values over as strings and `'false'` is a truthy string.
`resolveTopicQuery` defaults it to `false` outside the class, matching the existing rule for
`page`/`pageSize`/`sort`.

`libs/web/**` was out of bounds, so no client change was made. The panel needs one line —
`if (q.mine) params = params.set('mine', 'true')` — and Task 7.6's page is then the feed with that
flag, as Batch 7's §6 predicted.

### 3.3 The regression test

**New** `libs/api/forum/src/lib/topics/my-threads.spec.ts` — 21 cases: the DTO transform (including
that `?mine=false` is not truthy), the where clause, composition, the budget, the authorisation
property, and the no-new-route property read off the controller's own metadata.

**The composition case the brief asked for specifically:**

```
it('a member does NOT see their own topic in a category they can no longer see')
```

**RED on the unfixed code** — the honest red for "this parameter does not exist" is that it does not
compile:

```
● Test suite failed to run
    my-threads.spec.ts:135:67 - error TS2339: Property 'mine' does not exist on type 'ListTopicsQueryDto'.
    my-threads.spec.ts:162:45 - error TS2339: Property 'mine' does not exist on type '{ categoryId: … }'.
    my-threads.spec.ts:173:47 - error TS2353: Object literal may only specify known properties,
                                and 'mine' does not exist in type 'Partial<ListTopicsQueryDto>'.
    … 18 errors
Test Suites: 1 failed, 1 total
Tests:       0 total
```

paired with the runtime red measured live: `?mine=true -> 400 property mine should not exist`.

**GREEN after the fix:**

```
$ npx nx test api-forum --skip-nx-cache --testPathPatterns=my-threads
Test Suites: 1 passed, 1 total
Tests:       21 passed, 21 total
```

_(Two of those 21 were red on my first green run because of bugs in **my spec**, not the code:
`plainToInstance` copies unknown keys onto the instance by design — rejecting them is
`forbidNonWhitelisted`'s job — and `POST topics` shares a path with `GET topics` so the route filter
needed the verb. Both assertions were corrected to say the true thing; neither was weakened.)_

### 3.4 Live verification

```
== ?mine=true ==                 total 3   (my three probe topics)
== no filter ==                  total 10
== ?mine=false ==                total 10  (identical to unfiltered)
== ?mine=true&categoryId=… ==    site-feedback mine total 0   (composes)
== ?mine=true&sort=unread ==     200                          (composes)
== ?authorId=<my own id> ==      400 property authorId should not exist
== GET …/community/my-threads == 404                          (no new route)
```

**And the composition property, proven live end-to-end:**

```
1) create MY topic in a category with visibility=member      topic=cmsflifrw00029eqq99nxz970
2) ?mine=true sees it                                        visible: true
3) admin narrows the category to cohort ['founding'] (I am in no group)   PATCH -> 200
4) ?mine=true must NOT return my own topic any more          visible: false | total 3
5) the row is still there and still mine
   B61 visibility composition probe | 674888a2-…-…-…-8c30d971edc1 | deleted_at NULL
```

The topic is unchanged, still authored by me, not deleted — and the author filter does not hand it
back, because it ADDs a restriction to the visibility clause rather than standing in for it.

---

## 4. Anything else I found

**🟡 A-1 — `sort=unread` and the category rail were silently wrong too, and nobody had noticed.**
Covered in §1.2. Worth calling out separately because they were never reported as symptoms: `sort=unread`
_hid_ threads with exactly one unread reply, and the rail under-counted topics. Both were invisible
from the frontend because they look like "there is nothing new", which is indistinguishable from the
truth.

**🟡 A-2 — `resolveParentId` is called outside the retry loop's `catch`.**
`posts.service.ts:149`. Everything inside the `for` loop routes failures through `mapPrismaError`
(NFR-S7); this one call does not, so any Prisma failure it produces reaches the client raw. F-2's DTO
fix closes today's only known trigger, but the asymmetry remains and is worth a look if another
`parentId`-shaped input ever appears. I did not move it — it would change the depth-repair 404
semantics and is out of this batch's scope.

**🟢 A-3 — `PREFIX_EXCEPTIONS` is not an empty array, and was not before this batch.**
The brief said it must remain empty. It contains one pre-existing entry
(`marketing/PublicMarketingController`, empty prefix, with a written reason). `KNOWN_PREFIX_DEBT`
**is** `[]`. I did not touch `route-map.spec.ts` at all — `git diff` on it is empty (§5) — so whatever
its state, it is exactly the state Batch 6/8 left it in. Flagging the discrepancy rather than
silently accepting it.

**🟢 A-4 — Jest 30's flag is `--testPathPatterns`.** Batch 6C's and Batch 7's note is right and still
live; every command in this report uses it.

**🟢 A-5 — the dev license server hot-reloads from the bind mount.**
`docker-compose.yml` mounts `./libs` into the container and runs `npx nx serve ptah-license-server`,
so edits to `libs/api/forum` are picked up without a restart. Every "AFTER" measurement in this report
was taken against a server that had recompiled the fixed source (verified: `?mine=true` returned 200
before I measured anything else).

---

## 5. Census constants — unmoved, and verified by `git diff`

```
apps/ptah-license-server/src/common/controller-validation.spec.ts:78   const UNVALIDATED_DEBT: readonly string[] = [];
apps/ptah-license-server/src/common/controller-validation.spec.ts:156  const MIN_TOTAL_PAYLOAD_PARAMS = 51;
apps/ptah-license-server/src/common/controller-validation.spec.ts:182  const NAMED_PRIMITIVE_PARAM_COUNT = 6;
apps/ptah-license-server/src/common/route-map.spec.ts:450              const KNOWN_PREFIX_DEBT: readonly string[] = [];
libs/api/forum/src/lib/common/soft-delete-filter.spec.ts:152           EXPECTED_EXEMPTIONS — 2 entries, unchanged

$ git diff --stat -- apps/ptah-license-server/src/common/controller-validation.spec.ts \
                     apps/ptah-license-server/src/common/route-map.spec.ts \
                     apps/ptah-license-server/src/testing/controller-registry.ts
(empty)
```

- **`NAMED_PRIMITIVE_PARAM_COUNT = 6`** — held. `mine` is a property of a whole-object DTO, not a
  named primitive. The exact-equality assertion passes (`ptah-license-server:test` 111/111).
- **`MIN_TOTAL_PAYLOAD_PARAMS = 51`** — held, and unchanged. It counts **params**, not DTO fields;
  adding `mine` to an existing DTO moves neither number. No edit was needed and none was made.
- **`KNOWN_PREFIX_DEBT` / `UNVALIDATED_DEBT`** — still `[]`.
- **`EXPECTED_ROUTES`** — untouched. No route was added; `GET …/my-threads` is a 404 live.
- **`EXPECTED_EXEMPTIONS`** — untouched. No new unfiltered read; `post-numbering.ts` and
  `optional-field.ts` are not `*.service.ts` and contain no Prisma call.

**One census I added rather than moved:** `EXPECTED_NULLABLE_OPTIONALS` in the new
`nullable-dto.spec.ts` — two entries, both `description`, each with its reason.

---

## 6. Final gate

```
$ npx nx run-many -t eslint:lint,typecheck,test \
    -p api-forum,api-member-hub,api-contracts-community,ptah-license-server --skip-nx-cache

> nx run api-contracts-community:eslint:lint      ✔
> nx run api-contracts-community:typecheck        ✔
> nx run api-contracts-community:test             Test Suites: 1 passed  | Tests:  23 passed

> nx run api-forum:eslint:lint                    ✖ 5 problems (0 errors, 5 warnings)
> nx run api-forum:typecheck                      ✔
> nx run api-forum:test                           Test Suites: 21 passed | Tests: 505 passed

> nx run api-member-hub:eslint:lint               ✔
> nx run api-member-hub:typecheck                 ✔
> nx run api-member-hub:test                      Test Suites: 6 passed  | Tests:  72 passed

> nx run ptah-license-server:eslint:lint          ✖ 2 problems (0 errors, 2 warnings)
> nx run ptah-license-server:typecheck            ✔
> nx run ptah-license-server:test                 Test Suites: 5 passed  | Tests: 111 passed

 NX   Successfully ran targets eslint:lint, typecheck, test for 4 projects
```

**0 errors. 711 tests passing.** All 7 warnings are pre-existing in files this batch did not touch:

```
api-forum (5)
  categories/categories.service.ts:500      'id' is defined but never used
  read-state/read-state.service.spec.ts:259 Forbidden non-null assertion
  search/search.service.spec.ts:346 (×3)    Forbidden non-null assertion
ptah-license-server (2)
  jest.config.ts:1     Unused eslint-disable directive
  src/instrument.ts:1  Unused eslint-disable directive
```

_(One warning was mine — a non-null assertion in `unread-units.spec.ts`. I removed it by zipping the
written markers by topic id instead of by index, which also makes the assertion survive a reordering
of `markCategoryRead`'s rows.)_

```
$ npx prettier --check "libs/api/forum/src/lib/**/*.ts"
All matched files use Prettier code style!
```

`npx nx affected` was **not** used anywhere — explicit project lists only, per the brief. I confirmed
the concurrent `tasks-ui` breakage is untouched by anything here: no `libs/frontend/**`,
`libs/backend/**`, `libs/shared/**` or `libs/web/**` file appears in my diff.

---

## 7. Live-verification residue — the seed is exactly as Batch 8 left it

**Everything I created was removed, by id, in one transaction. Nothing that was not mine was
touched.**

Created and removed: 4 probe topics (`B61 %`), 14 posts inside them, 3 probe categories
(`b61-probe-cat%`), 4 read-state rows on probe topics, 2 read-state rows my
`POST categories/:id/read-all` wrote onto **seeded** topics, and 6 `admin_audit_log` rows naming
probe categories.

**On the audit rows I deviated from Batch 7's precedent, deliberately.** Batch 7 and 6C kept theirs
because they recorded moderation of real seeded content. Mine recorded creates and updates of scratch
categories that no longer exist — dangling references, not history — so I deleted exactly those six
(matched by `target_id IN (probe category ids)`). The count is back to **18**, which is precisely the
number Batch 7's report recorded.

```
$ docker exec -i ptah_postgres psql -U ptah -d ptah_db -tAc "…"
B61 topics remaining:      0
b61 categories remaining:  0
read-state rows remaining: 0
SEED: categories=4  topics=9  posts=10
community.* audit rows:    18

$ select slug, visibility from community_categories order by sort_order;
general|member
builders-lounge|cohort
site-feedback|member
staff|staff
```

Matches Batch 8's seed (`categories=4 topics=9 posts=10`) and Batch 7's audit count (18) exactly.

**The headless token was written to `%TEMP%\b61.tok`, used for every probe, and deleted:**

```
$ ls "$TEMP/b61.tok"
ls: cannot access '…/b61.tok': No such file or directory
```

It was signed with the documented `JWTPayload` shape against `JWT_SECRET` from the workspace-root
`.env`, for the dev user's real `users.id`, with a 2-hour expiry, and sent as the `ptah_auth`
**cookie** (`-b "ptah_auth=$TOKEN"`) — 6C's correction is right, a Bearer header returns 401. No token
was written into the repo.

---

## 8. Annotated `git status --porcelain`

```
### MINE — Batch 6.1, entirely within libs/api/forum/**
 M libs/api/forum/src/lib/categories/categories.service.ts             F-1 site 3
 M libs/api/forum/src/lib/categories/categories.service.spec.ts        F-1 fixture in the wrong unit
 M libs/api/forum/src/lib/categories/dto/create-category.dto.ts        F-2 sweep
 M libs/api/forum/src/lib/categories/dto/update-category.dto.ts        F-2 sweep (4 of the 12)
 M libs/api/forum/src/lib/posts/accepted-answer.service.ts             FIRST_POST_NUMBER repointed
 M libs/api/forum/src/lib/posts/dto/create-post.dto.ts                 F-2, parentId null-means-absent
 M libs/api/forum/src/lib/posts/posts.service.ts                       FIRST_POST_NUMBER moved out
 M libs/api/forum/src/lib/read-state/read-state.service.ts             F-1 sites 1 and 4
 M libs/api/forum/src/lib/read-state/read-state.service.spec.ts        F-1 accomplice tests rewritten
 M libs/api/forum/src/lib/search/dto/search.query.dto.ts               F-2 sweep
 M libs/api/forum/src/lib/topics/dto/list-admin-topics.query.dto.ts    F-2 sweep
 M libs/api/forum/src/lib/topics/dto/list-topics.query.dto.ts          F-2 sweep + F-3 `mine`
 M libs/api/forum/src/lib/topics/dto/moderate-topic.dto.ts             F-2 sweep (5 of the 12)
 M libs/api/forum/src/lib/topics/dto/thread.query.dto.ts               F-2 sweep
 M libs/api/forum/src/lib/topics/dto/update-topic.dto.ts               F-2 sweep (2 of the 12)
 M libs/api/forum/src/lib/topics/member-community.controller.ts        F-3 docblock only
 M libs/api/forum/src/lib/topics/topics-read.service.ts                F-1 site 2 + F-3 where clause
 M libs/api/forum/src/lib/topics/topics-read.service.spec.ts           F-1 accomplice test rewritten
?? libs/api/forum/src/lib/common/post-numbering.ts                     F-1 the named units
?? libs/api/forum/src/lib/common/optional-field.ts                     F-2 the two decorators
?? libs/api/forum/src/lib/read-state/unread-units.spec.ts              F-1 regression test
?? libs/api/forum/src/lib/common/nullable-dto.spec.ts                  F-2 regression test + census
?? libs/api/forum/src/lib/topics/my-threads.spec.ts                    F-3 regression test

### BATCH 8 — STAGED IN THE INDEX BY THE ORCHESTRATOR. NOT TOUCHED.
M  .prettierignore
M  apps/ptah-license-server/project.json
A  apps/ptah-license-server/prisma/seed/…  (11 files: community-seed, mappers, fixtures, tsconfig)

### BATCH 7 — uncommitted, out of bounds. NOT TOUCHED.
 M apps/ptah-landing-page-e2e/src/specs/{admin-crud,members-content}.spec.ts
 M apps/ptah-landing-page-e2e/src/support/db.ts
 M libs/web/admin/src/lib/{admin-layout/admin-nav.config.ts,admin.routes.ts,services/admin-builders-api.service.ts}
 M libs/web/members/{jest.config.cts,src/lib/members.routes.ts}
 M libs/web/panel-ui/src/index.ts
?? apps/ptah-landing-page-e2e/src/specs/members-community.spec.ts
?? libs/web/admin/src/lib/builders/community/
?? libs/web/members/src/lib/{community,search,shared}/ , markdown-chokepoint.spec.ts,
   services/member-{community,search}-api.service{,.spec}.ts
?? libs/web/panel-ui/src/lib/{tag-chip,thread-row}/

### FOREIGN — the unrelated task-specs/settings process. NOT TOUCHED.
 M libs/frontend/tasks-ui/src/index.ts
 M libs/frontend/tasks-ui/src/lib/components/filter/task-filter-bar.component{,.spec}.ts
 M libs/frontend/tasks-ui/src/lib/components/tasks-view.component{,.spec}.ts
 M libs/frontend/tasks-ui/src/lib/services/tasks-store.service.spec.ts     ← new since batch start
 M libs/shared/src/lib/types/task-filter.spec.ts                           ← new since batch start
?? libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.views-durability.spec.ts
?? libs/frontend/tasks-ui/src/lib/components/filter/task-view-menu.component{,.spec}.ts
?? libs/frontend/tasks-ui/src/lib/services/task-views.service{,.spec}.ts
```

**My set is exactly `libs/api/forum/**`— 18 modified, 5 new — and is disjoint from Batch 7's,
Batch 8's staged index, and the foreign WIP.** No shared-registry file was touched:`tsconfig.base.json`, `nx.json`, `eslint.config.mjs`, `app.module.ts`, `route-map.spec.ts`,
`controller-validation.spec.ts`and`controller-registry.ts`are all unmodified.`apps/ptah-license-server/src/**`
was **not\*\* needed and was not touched.

The foreign process wrote two more files during this batch
(`tasks-store.service.spec.ts`, `task-filter.spec.ts`); neither is in any project on my gate list, and
I never ran `nx affected`, so its broken `task-filter-bar.component.ts` never entered a command I ran.

---

## 9. Carried forward

1. **Batch 7's `test.fail()` at `members-community.spec.ts:209` can be promoted to a normal test.**
   The server now returns the accurate unread count; that closes the fifth §8.2 graded clause. It is
   in `libs/web/**`, which was out of bounds for this batch.
2. **The panel needs one line for "My Threads":** `if (q.mine) params = params.set('mine', 'true')` in
   `member-community-api.service.ts`, then Task 7.6's page is the feed with that flag and the route
   swap in `members.routes.ts`. No further backend work.
3. **`libs/api/forum` now has two structural build gates** (`soft-delete-filter.spec.ts` and
   `nullable-dto.spec.ts`) plus two censuses (`EXPECTED_EXEMPTIONS`, `EXPECTED_NULLABLE_OPTIONALS`).
   A new DTO field or a new unfiltered read is now a diff in a list a reviewer reads.
4. **A-2 (`resolveParentId` outside the retry `catch`) is unfixed and reported**, not smuggled into
   this batch.
