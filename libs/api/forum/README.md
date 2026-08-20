# api-forum

`@ptah-api/forum` — the native community forum that replaced Discourse
(TASK_2026_177, Phase 2). It owns **categories, topics, posts, reactions, read
state and search**, and nothing else.

| Surface                                        | Guards                              |
| ---------------------------------------------- | ----------------------------------- |
| `v1/members/community/*`                       | `JwtAuthGuard`, `MemberGuard`       |
| `v1/members/search`                            | `JwtAuthGuard`, `MemberGuard`       |
| `v1/admin/community/{categories,topics,posts}` | `AdminGuard`, `AdminThrottlerGuard` |

Wire types come from `@ptah-contracts/community` and are **not** re-declared or
re-exported here. Entitlement and cohort resolution come from
`@ptah-api/membership` and are **not** re-implemented here.

## The barrel exports three symbols, and that is the point

`src/index.ts` exports `ForumModule`, `TopicsReadService` and
`ReadStateService`. Those last two are exactly what `@ptah-api/member-hub`
composes for the hub's `community` section (plan §2.5).

It does **not** export `TopicsService`, `PostsService`, `CategoriesService`,
`ReactionsService`, `SearchService` or anything under `src/lib/common/`. Those
hold the write paths and the visibility where-builder, and the only sanctioned
route to them is this lib's own controllers — which sit behind the guard chain
in the table above. A wider barrel does not disable that chain; it offers a path
that never enters it, which is worse, because the guards still look present in
review.

## The four invariants this lib is responsible for

### 1. Post #1 **is** the topic body (AD-9)

`Topic` has no `body` column. Creating a topic creates a `Post` with
`postNumber = 1`; editing "the topic body" edits that post. Adding
`Topic.body` later would create two sources of truth for one piece of text and
every renderer would have to pick one.

### 2. Reply depth is capped at 2, server-side (R1.3.3, RK-12)

`parentId` may only name a post whose own `parentId` is `null`. A depth-3
attempt is not rejected — it is **repaired**: the reply attaches to the depth-1
ancestor. The client cannot construct a deeper thread by any request sequence,
because the check is on the server and reads the parent's own `parentId`.

### 3. Soft delete is a filter the reader can see (AD-5, OQ-5 option a)

`NOT_DELETED = { deletedAt: null }` is one exported constant, spread at every
member read site. Prisma middleware was rejected precisely because it works:
it hides the filter from the person reading the query, and from any structural
check. `common/soft-delete-filter.spec.ts` parses every service in this lib and
fails the build on a member read that neither spreads `NOT_DELETED` nor carries
an `// AD-5-EXEMPT: <reason>` comment — and it fails again if the exemption
count grows beyond the ones it enumerates, so a new unfiltered read cannot be
waved through by writing a comment.

A deleted post is a **tombstone**, not a hole: its children stay readable, and
its body never reaches the wire (R1.3.5).

### 4. Invisible means `404`, never `403` (R1.1.3)

`common/visibility.ts` builds the category `where` from `MemberContext`, and the
member endpoints apply it **inside** the query. An invisible category therefore
produces "no row found", which the controller turns into `404` because that is
the honest answer to the query it ran. Nothing has to remember to translate a
`403` — and `403` is the answer that would confirm the resource exists.

`visibility: 'staff'` resolves visible to **admins only** (ASSUMPTION-4). See
`common/visibility.ts` for the full argument and its limits: that is the one
place in this lib where `isAdmin` participates in a member-side decision, and it
grants no write authority and no cohort content.

## What this lib deliberately does not do (RK-1)

No trust levels, no spam heuristics, no flag queues, no digests, no websockets,
no denormalised reaction counters, no reconciliation job, no `tsvector`, no
external search service. §5 of the requirements is normative on that list.

`Topic.postCount` is the **single** denormalisation permitted (AD-11), and it is
maintained inside the same transaction as every post write — never repaired by a
background job, because there is no background job.

## Search is Postgres, and it needs an extension

`SearchService` is `ILIKE` accelerated by two GIN trigram indexes
(`community_topics_title_trgm`, `community_posts_body_trgm`). They are created
by hand in `20260812090000_community_forum/migration.sql` because Prisma cannot
express `gin_trgm_ops`, which means **`prisma migrate diff` will never mention
them and a future migration can silently drop them**. Read the diff output
before every subsequent migration in this app.

Visibility is part of the search `WHERE` clause, in the SQL (R1.7.2) — never a
post-filter over a wider result set, which would leak `total` counts for rows
the member cannot read (R1.1.2).

## Dependencies

`type:feature` under `scope:api`, so it may depend on `api-core`, `api-identity`,
`api-audit` and `api-membership` (all `type:util`) and on
`api-contracts-community` (`scope:api-contracts`).

`ForumModule` declares `AdminGuard` and `AdminThrottlerGuard` **locally** rather
than importing `AdminModule` — the acyclicity idiom `MemberGroupsModule` already
uses.
