# Implementation Plan — TASK_2026_177

## Native community platform (replaces Discourse)

- **Architect pass**: structural. Requirements in `task-description.md` are approved and not reopened.
- **Inputs read**: `context.md`, `task-description.md`, and the source files listed under [Evidence Ledger](#evidence-ledger).
- **Mode**: autonomous. Every ambiguity is decided and recorded under [Architecture Decisions](#architecture-decisions).

---

## 0. Codebase investigation summary

### 0.1 A-9 is closed — all four blocked files verified

| Claim under A-9                     | Verified at                                                                 | Verdict                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PackResponse` shape                | `libs/api/community/src/lib/packs/packs.types.ts:27-40`                     | Confirmed exactly. `notes: string \| null` present; docblock at `:8-15` carries the "GATES NOTHING" + Discourse language R5.6 requires rewriting.                                                                                                                                                                      |
| `BuildersSession` / `AdminSession`  | `libs/api/community/src/lib/google-sessions/google-sessions.types.ts:27-80` | Confirmed, **and richer than quoted**: `AdminSession` also carries `isProtectedMaster` and `inProtectedSeries` (`:59-79`). The "separate type, not a widened member type" rationale is documented at `:43-49` and is the precedent NFR-S4 names.                                                                       |
| `@ptah-web/panel-ui` export surface | `libs/web/panel-ui/src/index.ts:1-8`                                        | Confirmed: 8 export lines yielding `PanelNavItem`, `PanelNavGroup`, `BadgeVariant`, `PanelLayout`, `StatTile`, `StatusBadge`, `EmptyState`, `DetailDrawer`, `SelectionToolbar`. `PanelLayout` inputs verified at `libs/web/panel-ui/src/lib/panel-layout/panel-layout.ts:47-68`; projection slots documented `:29-31`. |
| `ADMIN_ROUTES`                      | `libs/web/admin/src/lib/admin.routes.ts:29-186`                             | Confirmed: one `path: ''` + `AdminLayout`, lazy `loadComponent` children, bespoke routes before `:model` / `:model/:id` at `:175-183`.                                                                                                                                                                                 |

### 0.2 Findings that change the plan

Six discoveries materially shape the design. Each is expanded in the section named.

| #   | Finding                                                                                                                                                                                                                                                        | Evidence                                                                                                                                     | Where handled                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | **OQ-2 is already solved.** `libs/frontend/markdown` is tagged `["scope:shared","type:ui"]`, and `scope:web` is explicitly permitted to depend on `scope:shared`. The landing app _already imports it_.                                                        | `libs/frontend/markdown/project.json` tags; `eslint.config.mjs` `scope:web` constraint; `apps/ptah-landing-page/src/app/app.config.ts:14,43` | [AD-1](#ad-1--oq-2--the-markdown-chokepoint-is-already-reachable)                                                               |
| F-2 | **`raw` markdown is present on all 19 posts** (12,474 chars), and `cooked` HTML is present alongside it (18,690 chars). MG-1.9 is satisfiable exactly as written — the importer reads `raw` and must never touch `cooked`.                                     | `docs/community/discourse-export.json` (`a22b03eb6`), enumerated: `{posts: 19, nullRaw: 0, rawTotal: 12474, replacementChars: 0}`            | [AD-8](#ad-8--mg-19-is-satisfied-directly-cooked-is-quarantined) + [§7](#7-content-migration-design-mg-1)                       |
| F-3 | **`dtoPipe(Dto)` is mandatory, not optional.** esbuild emits no `emitDecoratorMetadata`, so a bare `@Body() dto: X` is silently unvalidated. A structural spec fails the build on an unbound param.                                                            | `libs/api/core/src/lib/common/dto-validation.pipe.ts:1-56`; `apps/ptah-license-server/src/common/controller-validation.spec.ts`              | [AD-7](#ad-7--a-3-confirmed-class-validator--dtopipe-is-the-server-wide-mechanism) + every controller in [§3](#3-api-contracts) |
| F-4 | **Two structural specs gate every new controller**: a route-map invariant suite (RI-1 prefix disjointness, RI-2 no cross-controller contest, RI-3 intra-controller specificity) and a controller census. New controllers must be added to one shared registry. | `apps/ptah-license-server/src/common/route-map.spec.ts:1-52`; `apps/ptah-license-server/src/testing/controller-registry.ts:1-79`             | [AD-12](#ad-12--member-route-namespacing-under-ri-1ri-2)                                                                        |
| F-5 | **`scope:api-contracts` exists in the lint config with zero member libs.** It is a pre-declared, unused seam whose only permitted dependency is itself — exactly the shape NFR-S4's member/admin type-pair rule needs.                                         | `eslint.config.mjs` `scope:api-contracts` constraint; `for f in libs/*/*/project.json` census returned no `scope:api-contracts` project      | [AD-6](#ad-6--backend-lib-split)                                                                                                |
| F-6 | **`/members` is already taken** by `@ptah-web/account`'s `MembersPageComponent`, which renders the Discourse topic list. It and its three child components are deleted, not extended.                                                                          | `apps/ptah-landing-page/src/app/app.routes.ts` `/members` entry; `libs/web/account/src/lib/members/`                                         | [§6](#6-discourse-removal-plan)                                                                                                 |

### 0.3 Patterns extracted and reused verbatim

| Pattern                                                                                                          | Source                                                                                                          | Applied to                                                      |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Feature-off posture (`isEnabled()`, log-once, stable empty contract, never throws, never surfaces upstream body) | `google-auth.provider.ts:1-24`; `sessions.service.ts:396-407`                                                   | `YouTubeMetadataProvider` (R2.2.6, NFR-R1)                      |
| Non-throwing result objects `{ ok, skipped?, status?, error? }`                                                  | `google-sessions.types.ts:134-163`                                                                              | `YouTubeFetchResult`                                            |
| Audit enlisted in the mutation's own `$transaction` via the `tx` param                                           | `packs.service.ts:98-141,257-275`; `audit-log.types.ts` `WriteAuditLogParams.tx`                                | Every admin mutation in this task (R8.5)                        |
| Prisma error → sanitized typed exception, never a raw message                                                    | `packs.service.ts:277-313`                                                                                      | Every new service (NFR-S7)                                      |
| Zod at the frontend HTTP boundary via a shared `validate()`                                                      | `libs/web/core/.../members-api.service.ts:78-90`, re-exported and consumed by `admin-builders-api.service.ts:6` | Every `libs/web/members` API service                            |
| `@Optional() @Inject(X)` for `@Global` collaborators, degrade never fail                                         | `members.controller.ts:48-50`; `sessions.service.ts:66-77`                                                      | Hub section composition (R6.4)                                  |
| Structural test as the enforcement mechanism for a design rule                                                   | `route-map.spec.ts`, `controller-validation.spec.ts`, packs "G6 no member endpoint"                             | R9.4 no-catch-all, NFR-S2 no-second-renderer, NFR-S5 no-`notes` |

---

## Architecture Decisions

Every open question is answered here. Each records the alternative rejected and why.

### AD-1 — OQ-2: the markdown chokepoint is already reachable

**Decision: option (a), and it requires no lint change at all.**

`libs/frontend/markdown/project.json` tags the lib `["scope:shared", "type:ui"]`. `eslint.config.mjs` permits `scope:web → scope:shared` and `type:feature → type:ui`. `apps/ptah-landing-page/src/app/app.config.ts:14` already does `import { provideMarkdownRendering } from '@ptah-extension/markdown'` and line 43 calls it. The `@ptah-extension/markdown` path is in `tsconfig.base.json:136`. `libs/web/members` (`scope:web`, `type:feature`) can import it on day one.

The lib needs **two changes, made inside it** — never a second renderer:

1. **A third preset, `'member'`.** The existing presets are `'full'` (permissive DOMPurify tuned for _AI-generated_ content — it deliberately allows SVG, `details`, `style`, custom elements) and `'basic'` (`provideMarkdown()` with no `SANITIZE` override, so it falls through to ngx-markdown's `DEFAULT_SECURITY_CONTEXT = SecurityContext.HTML` — Angular's `DomSanitizer`, **not DOMPurify**; verified at `node_modules/ngx-markdown/fesm2022/ngx-markdown.mjs:162,418-423`). Neither is right for member-authored UGC. `'member'` supplies a DOMPurify **allowlist** sanitizer (`ALLOWED_TAGS` / `ALLOWED_ATTR`, not `FORBID_*`) plus an `afterSanitizeAttributes` hook forcing `rel="noopener noreferrer nofollow"` and `target="_blank"` on anchors. NFR-S2 is satisfied by _one lib, one sanitizer module, one `DOMPurify` import in the repo's web tree_.

2. **`MarkdownBlockComponent`'s hardcoded `prose-invert`** (`markdown-block.component.ts:17`) breaks `operator-member-light` (NFR-U5). Add `variant = input<'invert' | 'auto'>('invert')`; `'auto'` emits `prose dark:prose-invert`. Default unchanged, so no existing consumer moves.

**Scoping the preset without disturbing the landing app**: `provideMarkdown()` returns plain providers (`MarkdownService` as a bare class provider — verified at `ngx-markdown.mjs:711-722`; it is _not_ `providedIn: 'root'`). Declaring `providers: [provideMarkdownRendering({ extensions: 'member' })]` on the `/members` route creates a route-level injector whose `MarkdownService` + `SANITIZE` shadow the app's `'basic'` pair for the entire member subtree. No app-config change, no cross-contamination.

**Rejected**: option (b), extracting the sanitizer into a new shared lib. It solves a boundary problem that does not exist and costs a lib, a build target and a migration of two existing consumers.

### AD-2 — OQ-1: `SessionRequest` ↔ Calendar linkage

**Decision: option (a) — nullable columns on `SessionRequest`.**

Four columns: `calendarEventId String? @unique`, `meetLink String?`, `durationMinutes Int?`, `declineReason String?`.

`@unique` on `calendarEventId` is the load-bearing part: it makes "two requests reconciled to one event" unrepresentable, which is the failure R4.6 calls a defect. Postgres treats multiple `NULL`s as distinct, so pending requests are unconstrained.

**Rejected**: option (b), a separate `ScheduledSession` record. A 1:1-optional child table adds a join to every read of a table that will hold a few hundred rows, and expresses no invariant the unique column does not. R4.10 also requires the existing payment fields stay in place on `SessionRequest`; splitting the scheduling half off would leave one row's lifecycle spread across two tables for no gain.

### AD-3 — OQ-3: live sessions vs Calendar sessions

**Decision: option (a) — one `LiveSession` entity with _both_ linkages optional, merged with the Calendar read at the service layer.**

`LiveSession` carries `youtubeVideoId?`, `replayYoutubeVideoId?`, and `calendarEventId? @unique`. The Live read model (`MemberLiveService`) fetches `LiveSession[]` from Postgres and `BuildersSession[]` from `SessionsService.listUpcomingSessions(userId)` in parallel, then folds them into a single discriminated list:

```ts
type LiveFeedItem = {
  id: string;
  source: 'ptah' | 'calendar';
  state: 'upcoming' | 'live' | 'replay';
  title: string;
  startsAt: string;
  endsAt: string | null;
  youtubeVideoId: string | null; // null when calendar-sourced with no stream
  meetLink: string | null; // null when ptah-sourced with no calendar event
  durationSeconds: number | null;
};
```

A Calendar event that a `LiveSession` row claims via `calendarEventId` is emitted **once**, from the `LiveSession` (`source: 'ptah'`), with the Calendar's `meetLink` merged in. That is precisely what makes R3.4 work: attaching a replay to a _past Calendar session_ requires our own row to hang the replay id on, and only a nullable `calendarEventId` gives us one without forcing an admin to pre-create a row for every calendar event.

**Rejected**: option (b), two entities merged only at read time with no linkage column. Replays would have nowhere to attach for calendar-sourced sessions, and de-duplication would have to key on a fuzzy `(title, startsAt)` match.

### AD-4 — OQ-4: hub composition

**Decision: option (a) — one composed service issuing parallel per-section queries via `Promise.allSettled`.**

`MemberHubService.compose(userId)` resolves entitlement + cohort keys once, then runs the section resolvers concurrently. Each resolver returns `HubSection<T> = { status: 'ok' | 'empty' | 'unavailable'; data: T }`. `allSettled` (not `all`) is what delivers R6.4: a rejected section becomes `{ status: 'unavailable', data: <empty shape> }` and the response is still `200`.

Per-section query budget, sized against NFR-P1 (<400 ms p95) and NFR-P4:

| Section         | Queries           | Notes                                                                                                |
| --------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `learning`      | 2                 | one `Lesson` join for the next incomplete lesson in course order; one `groupBy` for completed counts |
| `community`     | 2                 | one topic page (`take 5`) + one `topicReadState` fetch keyed by the returned ids                     |
| `sessions`      | 1 DB + 1 upstream | `LiveSession` next-upcoming; Calendar list is already cached-free and `@Optional`-degraded           |
| `packs`         | 1                 | `memberVisible: true` on a tens-of-rows table                                                        |
| `notifications` | 1                 | unread `count`                                                                                       |

Seven database round-trips issued in parallel, none of them N+1.

**Rejected**: option (b), a single denormalised read query. One SQL statement spanning six domains hard-couples them at the schema level, defeats R6.4 entirely (one failing join fails the whole statement, blanking the home screen — the exact outcome R6.4 forbids), and would have to be rewritten in each of Phases 2–5 as R6.6 extends the response.

### AD-5 — OQ-5: soft delete

**Decision: option (a) — nullable `deletedAt` plus explicit query filters, applied through one shared constant.**

```ts
// libs/api/forum/src/lib/common/soft-delete.ts
export const NOT_DELETED = { deletedAt: null } as const;
```

Every member-facing read spreads `...NOT_DELETED`. Admin reads take an explicit `includeDeleted` flag. `deletedBy String?` records the actor (R8.5).

**Rejected**: option (b), a global Prisma client extension. It is invisible at the call site, and the moment an admin restore/list path needs deleted rows the extension has to be _escaped_, which is both harder to reason about and easier to get silently wrong than a forgotten filter. This codebase's whole convention is explicit `where` objects (`packs.service.ts:64-82`).

**Compensating control** for the "forgotten filter" risk option (b) was meant to solve: a structural test in `libs/api/forum` asserting that every `findMany`/`findFirst`/`count` call in a `member-*.service.ts` file spreads `NOT_DELETED`, matching the repo's existing "a comment cannot fail a build; this can" idiom (`route-map.spec.ts:31`).

**Tombstones (R1.3.5)**: a soft-deleted `Post` that has children is _returned_ by the thread read with `deleted: true` and `bodyMarkdown: null`, so the conversation is not orphaned. A soft-deleted post with no children is omitted. Both are one query — the children are already loaded.

### AD-6 — Backend lib split

**Decision: five new libs, and `libs/api/community` keeps the session/pack/group/circle domains.**

`libs/api/community/README.md:9-38` documents _why_ the existing five directories are one Nx project: `discourse/` ↔ `member-groups/` have a bidirectional file-level dependency, and Nx forbids a project cycle. It also names the correct fix — "extract the shared piece (cohort resolution) into a lib both can depend on". Deleting `discourse/` removes half that cycle, which is what makes the split possible now.

| New lib                        | Path alias                  | Tags                               | Owns                                                                                                                                                  | Depends on                                                           |
| ------------------------------ | --------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `libs/api/membership`          | `@ptah-api/membership`      | `scope:api`, `type:util`           | R7 in full: `MembershipService` (entitlement, one implementation), `CohortResolver` (read-only `MemberGroupAssignment` → `cohortKeys`), `MemberGuard` | core, identity                                                       |
| `libs/api/youtube`             | `@ptah-api/youtube`         | `scope:api`, `type:util`           | `YouTubeMetadataProvider`, Zod schemas, ISO-8601 duration parser                                                                                      | core                                                                 |
| `libs/api/forum`               | `@ptah-api/forum`           | `scope:api`, `type:feature`        | R1 + R8 moderation subset + R1.7 search                                                                                                               | core, audit, identity, membership, notifications, contracts          |
| `libs/api/learning`            | `@ptah-api/learning`        | `scope:api`, `type:feature`        | R2 + R8 authoring subset                                                                                                                              | core, audit, identity, membership, youtube, notifications, contracts |
| `libs/api/notifications`       | `@ptah-api/notifications`   | `scope:api`, `type:feature`        | R10                                                                                                                                                   | core, identity, membership, contracts                                |
| `libs/api/member-hub`          | `@ptah-api/member-hub`      | `scope:api`, `type:feature`        | R6 aggregate + the entitlement probe                                                                                                                  | forum, learning, community, membership, notifications, contracts     |
| `libs/api-contracts/community` | `@ptah-contracts/community` | `scope:api-contracts`, `type:util` | Every member/admin wire type pair, type-only + Zod                                                                                                    | _(nothing)_                                                          |

**Why `membership` is its own lib, not a directory** — R7.5 and RK-4 require the membership definition to survive the deletion of the directory currently containing it (`discourse/builders-membership.service.ts`). Making it a lib makes that survival structural rather than procedural: the deletion of `libs/api/community/src/lib/discourse/` cannot take it, because it is not there. It is also the one thing every other new module depends on and nothing depends back on — the exact shape the README prescribes.

**Why `forum` and `learning` are separate libs** — NFR-M4 ("each new module owns one concern; no repeat of a monolith service") and the fact that they share no model, no service and no query. Nothing in `forum` reads `learning` or vice versa; the only cross-domain reader is `member-hub`, which is why _that_ is isolated too. `nx graph` stays a DAG.

**Why live/private sessions stay in `libs/api/community`** — R4 explicitly extends `SessionRequest` and `GoogleSessionsModule`, and R3.3 must merge with `SessionsService.listUpcomingSessions`. A new lib would need to import `GoogleSessionsModule` while `GoogleSessionsModule` would need the new lib's cohort scoping — reconstructing exactly the discourse↔member-groups cycle the README warns about. Rejected on that evidence.

**Why a contracts lib** — F-5: `scope:api-contracts` already exists in `eslint.config.mjs` with no project using it, and its constraint (`onlyDependOnLibsWithTags: ['scope:api-contracts']`) makes it a pure leaf. Declaring `MemberPack` and `AdminPack` in adjacent files with no `extends` between them turns RK-8 from a review discipline into a compile-time property. It is imported by both `libs/api/*` (`scope:api → scope:api-contracts` permitted) and `libs/web/members` (`scope:web → scope:api-contracts` permitted) — the one legitimate bridge, and the reason the seam was declared in the first place.

Boundary check against `eslint.config.mjs`, all clean: `type:feature → {feature, data-access, ui, util, core}`; `type:util → type:util` (so `membership` and `youtube`, being `type:util`, may depend only on core/identity/audit/email — all `type:util`. Verified: `api-core`, `api-audit`, `api-identity`, `api-email` are all `["scope:api","type:util"]`).

**Rejected**: putting everything in `libs/api/community`. It would produce a ~90-file lib spanning six unrelated domains — the monolith NFR-M4 names.
**Rejected**: a separate `libs/api/courses` _and_ `libs/api/lessons`. Lessons have no life outside a course; the aggregate root is the course.

### AD-7 — A-3 confirmed: class-validator + `dtoPipe` is the server-wide mechanism

RK-13 asked for a re-check against the in-flight `ak/license-server-validation-pipe` branch. That branch's work **is already merged into the working tree** and it did the opposite of a Zod migration: `libs/api/core/src/lib/common/dto-validation.pipe.ts:41-56` declares `dtoPipe` "the SERVER-WIDE input-validation mechanism" and records that TASK_2026_170 bound every remaining controller. A-3 stands, upgraded from convention to hard rule:

> Every `@Body()` / `@Query()` payload param in this task binds `dtoPipe(TheDto)`. A bare `@Body() dto: X` is silently unvalidated because esbuild does not implement `emitDecoratorMetadata`.

Zod remains mandatory and exclusive for: the YouTube Data API response, the Google Calendar response, the migration JSON, and the frontend HTTP boundary. The two mechanisms are not mixed within a module — Zod never appears in a `dto/` directory.

### AD-8 — MG-1.9 is satisfied directly; `cooked` is quarantined

An earlier read of the export found `raw: null` on all 19 posts, because the export script sourced bodies from Discourse's `/t/{id}.json`, which returns `cooked` HTML in `post_stream.posts[]` and omits `raw`. **That has been fixed at source** (`a22b03eb6`): the export now walks each topic for post ids and fetches `/posts/{id}.json` individually, which does carry `raw`.

Re-verified against the committed file:

| Check                         | Result                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| Posts with `raw`              | **19 / 19, zero nulls**                                                                         |
| `raw` total                   | 12,474 chars of real markdown (`**bold**`, prose, `- ` bullet lists)                            |
| U+FFFD replacement characters | 0 — em-dashes intact, valid UTF-8                                                               |
| Topic ordering                | sorted by `id` (stable diffs)                                                                   |
| `note` field                  | records why the per-post fetch is necessary, so the `/t/{id}.json` shortcut is not reintroduced |

**Decision**: **one artefact, not two.** The importer reads `raw` straight into `bodyMarkdown`. There is no HTML-to-markdown conversion, no intermediate normalised file, and no human review step, because there is nothing lossy to review. MG-1.9 and NFR-S10 are satisfied literally rather than in spirit.

**`cooked` stays in the export as a reference field and the importer must never read it.** This is worth stating as a rule rather than leaving to habit: `cooked` is precisely the field someone reaches for later "just to fix one formatting issue", and doing so would route stored HTML around the DOMPurify chokepoint — a second XSS path opened by a one-line convenience. Enforcement is a spec asserting the string `cooked` appears nowhere in the seed module ([§7.6](#76-migration-tests-mg-1-rk-9)), which is the same "a comment cannot fail a build; this can" idiom `route-map.spec.ts:31` uses.

**Rejected**: importing `cooked` and sanitizing at render — creates the HTML path NFR-S10 forbids and mixes two content representations in one column.
**Rejected**: retaining the offline normalisation artefact "for safety" now that `raw` exists — it would be a lossy transformation of a lossless source, a second file to keep in sync, and a review step protecting against a risk that no longer exists.

### AD-9 — The topic body _is_ post #1

**Decision**: `Topic` holds no body. `Post` with `postNumber = 1` is the opening post.

This is settled by three forces converging:

1. R1.4.1 requires reactions on "a topic body **or** a reply". With a body column on `Topic`, that is either a polymorphic reaction table or two reaction tables — and Checkpoint 0's rejection of polymorphic comment tables applies verbatim to reactions (A-8 says as much).
2. R1.2.3 (`editedAt`), R1.2.7 (soft delete), R1.3.5 (tombstones) and NFR-S2 (markdown rendering) all need identical treatment on the opening post and on replies. One table gives one implementation of each.
3. MG-1.7 requires preserving `postNumber` ordering, and the export already numbers the opening post `1` (`docs/community/discourse-export.json`, `posts[].postNumber`). The migration becomes a field copy.

Consequences: `parentId = null` + `postNumber = 1` is the opening post; `parentId = null` + `postNumber > 1` is a top-level reply; `parentId != null` is a child reply, indented exactly one level. No `depth` column is needed, and **depth 3 is unrepresentable by construction** because a valid `parentId` may only point at a post whose own `parentId` is null — which is what the write path enforces and repairs (RK-12).

### AD-10 — Category cohort gating uses `String[]`, not a join table

`Category.cohortKeys String[] @default([])`, queried with `hasSome`. Categories are a ~10-row table read on every feed, topic and search request; a join table adds a join to the hottest read path in the product to enforce referential integrity on a field that the admin DTO validates against `MemberGroup.key` at write time anyway. Same reasoning for `Course.cohortKeys` and `LiveSession.cohortKeys`.

**Tradeoff recorded**: there is no FK, so deleting a `MemberGroup` leaves a stale key in an array. That is _safe by direction_ — a stale key matches nobody, so content becomes more restricted, never less. An admin-side reconciliation warning on the group-delete path is a Phase 5 nicety, not a correctness requirement. Explicitly rejected as over-engineering at §1.3 scale: a nightly reconciliation job.

### AD-11 — Denormalised `Topic.postCount` is permitted; nothing else is

NFR-P4 caps a 25-topic feed at 5 queries. Reply counts and unread deltas are per-topic, so deriving them means either a `groupBy` (acceptable) or a correlated subquery per row (not). `Topic.postCount` (replies only, excluding soft-deleted) is maintained **inside the same transaction** as post create / soft-delete / restore, alongside `lastPostedAt`. R1.4.4 licenses exactly this ("permitted only if a test demonstrates it stays consistent"), so a consistency test ships with it.

**Reaction counts stay derived** (`groupBy` on `PostReaction`, one query per thread render), per R1.4.4's "not required at the §1.3 scale". **Rejected**: denormalised reaction counters, and any reconciliation job for either counter — §1.3 explicitly names both as over-engineering.

### AD-12 — Member route namespacing under RI-1/RI-2

`route-map.spec.ts` enforces prefix disjointness across controllers. The existing `MembersController` is `@Controller('v1/members')` with `@Get('sessions')` — a strict prefix of every new member route.

**Decision**: re-declare it as `@Controller('v1/members/sessions')` with a bare `@Get()`. The resolved URL is byte-identical (`/api/v1/members/sessions`), so no contract changes, and every member controller becomes a sibling at a fixed depth-3 **literal** segment. No member controller declares a route parameter at segment 3.

### AD-13 — Theme preference persistence (R9.6)

`localStorage['ptah.members.theme']`, read by `MemberThemeService` and bound to `PanelLayout`'s `theme` input. **Rejected**: a `User.themePreference` column and a round-trip. A per-device display preference on a device-local surface does not warrant a schema change, a migration, and an endpoint; R9.6 requires persistence across sessions, which `localStorage` provides.

### AD-14 — Notification transport

Poll `GET /api/v1/members/notifications/unread-count` every 60 s from `MemberNotificationsStore`, plus an eager fetch on every navigation (R10.5). Explicitly no websocket, no SSE — §5 names both as out of scope, and `libs/api/licensing`'s existing `@Sse` endpoint is not extended.

### AD-15 — Migration idempotency uses natural keys, not a `sourceRef` column

Upserts key on uniques the schema needs anyway: `Category.slug`, `Topic.slug`, `Post @@unique([topicId, postNumber])`, `Course.slug`, `CourseModule @@unique([courseId, slug])`, `Lesson @@unique([moduleId, slug])`. **Rejected**: a `sourceRef String? @unique` on six tables — six nullable columns and six indexes to express what six existing uniques already express.

---

## 1. Prisma schema

File: `apps/ptah-license-server/prisma/schema.prisma`. Conventions matched from the existing file: `@@map` to snake_case plurals, `@map` to snake_case columns, `String @id @default(cuid())` for content models, `@db.Uuid` on every `User` FK (because `User.id` is `@db.Uuid`), `@updatedAt` on `updatedAt`.

**Index discipline used throughout**: an index is declared only when a requirement names a query that scans without it _at §1.3 volume_. Indexes rejected for that reason are listed explicitly, because "why is there no index here" is the question a later reader will ask.

### 1.1 Removed

```prisma
model MemberGroup {
  // discourseGroup String? @map("discourse_group")   ← REMOVED (MG-2.4)
  ...
}
```

### 1.2 Modified

```prisma
model SessionRequest {
  // ... every existing field unchanged (R4.10) ...

  /// Google Calendar event id for the accepted session (OQ-1 / AD-2).
  /// @unique makes "two requests reconciled to one event" unrepresentable —
  /// the failure R4.6 calls a defect. Postgres treats NULLs as distinct, so
  /// pending requests are unconstrained.
  calendarEventId String? @unique @map("calendar_event_id")
  /// Meet URL resolved from the created event's hangoutLink/conferenceData.
  /// NEVER from a Meet API — none is called (R4.1).
  meetLink        String? @map("meet_link")
  /// Admin-supplied duration at accept time; needed to rebuild endsAt on reschedule.
  durationMinutes Int?    @map("duration_minutes")
  /// Optional admin reason, member-visible (R4.8).
  declineReason   String? @map("decline_reason")

  @@index([userId])              // existing — R4.3 "my requests"
  @@index([status, createdAt])   // REPLACES @@index([status]) — R4.4 pending queue, oldest first
  @@map("session_requests")
}

model Pack {
  // ... existing fields unchanged ...
  /// A-1: the single admin control over member visibility. cohortKey is NOT it
  /// and never becomes it. Default false so no existing pack becomes visible
  /// by migration.
  memberVisible Boolean @default(false) @map("member_visible")
  /// R5.5: how repo access is granted, shown to members before they hit a
  /// GitHub 404. Distinct from `notes`, which stays admin-internal (R5.2).
  accessNote    String? @map("access_note")
}
// Index on memberVisible REJECTED: tens of rows, always read in full.
```

### 1.3 Forum (Phase 2)

```prisma
/// Community category. ~10 rows. Visibility is enforced server-side on every
/// read; an invisible category yields 404, never 403 (R1.1.3).
model Category {
  id          String   @id @default(cuid())
  slug        String   @unique
  name        String
  description String?
  sortOrder   Int      @default(0) @map("sort_order")
  /// 'member' | 'cohort' | 'staff' (R1.1.1)
  visibility  String   @default("member")
  /// MemberGroup.key values, ANY-match. AD-10: array not join table.
  /// Empty while visibility != 'cohort'.
  cohortKeys  String[] @default([]) @map("cohort_keys")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  topics Topic[]

  @@index([sortOrder])   // R1.1.4 admin-defined display order
  @@map("community_categories")
}
// Index on visibility/cohortKeys REJECTED: ~10 rows, always read in full and
// filtered in memory-equivalent time.

/// A discussion thread. Carries NO body — post #1 is the body (AD-9).
model Topic {
  id             String    @id @default(cuid())
  categoryId     String    @map("category_id")
  /// Generated at creation, stable for life; a title edit never changes it (R1.2.2).
  slug           String    @unique
  title          String
  /// null for migrated/system content (A-4). Never a fabricated User row.
  authorId       String?   @map("author_id") @db.Uuid
  pinned         Boolean   @default(false)
  locked         Boolean   @default(false)
  /// At most one accepted answer (R1.5.2), enforced by @unique.
  acceptedPostId String?   @unique @map("accepted_post_id")
  /// AD-11. Replies only (excludes post #1 and soft-deleted posts).
  /// Maintained in the same transaction as every post write.
  postCount      Int       @default(0) @map("post_count")
  lastPostedAt   DateTime  @map("last_posted_at")
  editedAt       DateTime? @map("edited_at")
  deletedAt      DateTime? @map("deleted_at")
  deletedBy      String?   @map("deleted_by")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  category     Category @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  author       User?    @relation("TopicAuthor", fields: [authorId], references: [id], onDelete: SetNull)
  posts        Post[]
  acceptedPost Post?    @relation("AcceptedAnswer", fields: [acceptedPostId], references: [id], onDelete: SetNull)
  readStates   TopicReadState[]

  @@index([categoryId, pinned, lastPostedAt])  // category listing: pinned first, then recency (R1.2.5)
  @@index([pinned, lastPostedAt])              // cross-category feed, same ordering
  @@index([authorId])                          // "My Threads" (R9.2)
  @@map("community_topics")
}
// Index on deletedAt REJECTED: low thousands of rows, always filtered after a
// categoryId/pinned seek. Index on slug is implied by @unique.
```

`onDelete: Restrict` on `category` is deliberate: R8.2 permits _moving_ a topic between categories, so a category with topics must not be deletable out from under them. `onDelete: SetNull` on `author` keeps a thread readable after a user is deleted (the `User` cascade at `schema.prisma:151` would otherwise take the conversation with them).

```prisma
/// Every body in the forum: post #1 is the topic's opening body, post N>1 is a
/// reply. parentId non-null = a child reply, indented exactly one level.
/// Depth 3 is unrepresentable: a valid parentId points only at a post whose own
/// parentId is null, enforced and repaired on write (R1.3.3, RK-12).
model Post {
  id           String    @id @default(cuid())
  topicId      String    @map("topic_id")
  parentId     String?   @map("parent_id")
  postNumber   Int       @map("post_number")
  bodyMarkdown String    @map("body_markdown")
  authorId     String?   @map("author_id") @db.Uuid
  editedAt     DateTime? @map("edited_at")
  deletedAt    DateTime? @map("deleted_at")
  deletedBy    String?   @map("deleted_by")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  topic      Topic          @relation(fields: [topicId], references: [id], onDelete: Cascade)
  parent     Post?          @relation("PostChildren", fields: [parentId], references: [id], onDelete: Restrict)
  children   Post[]         @relation("PostChildren")
  author     User?          @relation("PostAuthor", fields: [authorId], references: [id], onDelete: SetNull)
  reactions  PostReaction[]
  acceptedOn Topic?         @relation("AcceptedAnswer")

  @@unique([topicId, postNumber])   // MG-1.7 ordering + blocks duplicate numbering
                                    // under concurrent replies (allocated in-transaction)
  @@index([topicId, createdAt])     // thread render — the hottest query in the product
  @@index([authorId])               // R10.2 self-notification suppression + "My Threads"
  @@map("community_posts")
}
```

`onDelete: Restrict` on `parent` is a safety net, not a workflow: nothing hard-deletes a post, and if something ever tried, Postgres would refuse rather than orphan the children R1.3.5 requires stay readable.

```prisma
/// R1.4. Fixed server-defined type set; a second identical reaction toggles off
/// by deleting the row (R1.4.1). No free-form emoji (R1.4.3).
model PostReaction {
  id        String   @id @default(cuid())
  postId    String   @map("post_id")
  userId    String   @map("user_id") @db.Uuid
  /// 'like' | 'insightful' | 'celebrate' | 'thanks' — 4 types, server-defined.
  type      String
  createdAt DateTime @default(now()) @map("created_at")

  post Post @relation(fields: [postId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([postId, userId, type])   // R1.4.1 one per member per target per type
  @@index([userId])                  // cascade on user delete
  @@map("community_post_reactions")
}
// A separate @@index([postId]) is REJECTED as redundant: the composite unique
// above is a btree leading with postId, which already serves the per-post
// groupBy that produces reaction counts.

/// A-6: one marker per member per topic. No per-post read receipts.
model TopicReadState {
  userId             String   @map("user_id") @db.Uuid
  topicId            String   @map("topic_id")
  lastReadPostNumber Int      @default(0) @map("last_read_post_number")
  lastReadAt         DateTime @updatedAt @map("last_read_at")

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  topic Topic @relation(fields: [topicId], references: [id], onDelete: Cascade)

  @@id([userId, topicId])
  @@map("community_topic_read_state")
}
// No surrogate id and no extra index. The composite PK leads with userId, which
// is exactly the feed query ("every read state for this member, for these topic
// ids"). Unread = Topic.postCount - lastReadPostNumber, clamped at 0 (R1.6.2).
```

### 1.4 Courses (Phase 3)

```prisma
model Course {
  id            String    @id @default(cuid())
  slug          String    @unique
  title         String
  description   String
  coverImageUrl String?   @map("cover_image_url")
  visibility    String    @default("member")   // 'member' | 'cohort' | 'staff'
  cohortKeys    String[]  @default([]) @map("cohort_keys")
  /// R2.1.2: a draft course is invisible to every member endpoint (404).
  published     Boolean   @default(false)
  /// R2.4.2: when true, a module unlocks only after every lesson in the
  /// preceding module is complete. When false only releaseAt applies (R2.4.3).
  sequential    Boolean   @default(false)
  sortOrder     Int       @default(0) @map("sort_order")
  createdBy     String?   @map("created_by")
  deletedAt     DateTime? @map("deleted_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  modules CourseModule[]

  @@index([published, sortOrder])   // the member course list, in one seek
  @@map("courses")
}

model CourseModule {
  id          String    @id @default(cuid())
  courseId    String    @map("course_id")
  slug        String
  title       String
  description String?
  /// Sparse ordering, gaps of 100 (AD: see R8.8 note below).
  sortOrder   Int       @map("sort_order")
  /// R2.4.1: future date ⇒ locked, lessons return 403.
  releaseAt   DateTime? @map("release_at")
  deletedAt   DateTime? @map("deleted_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  course  Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  lessons Lesson[]

  @@unique([courseId, slug])       // stable URLs + AD-15 migration idempotency key
  @@index([courseId, sortOrder])   // R2.1.4 strict sort order render
  @@map("course_modules")
}
// @@unique([courseId, sortOrder]) DELIBERATELY NOT DECLARED. R8.8 forbids
// renumbering siblings one request at a time; a uniqueness constraint would
// force the bulk reorder to sequence its UPDATEs to dodge transient collisions.
// Ties break deterministically on (sortOrder, createdAt, id) — R2.1.4.

model Lesson {
  id           String @id @default(cuid())
  moduleId     String @map("module_id")
  slug         String
  title        String
  bodyMarkdown String @map("body_markdown")
  sortOrder    Int    @map("sort_order")

  /// R2.2.1: the 11-char YouTube id, extracted server-side from an id or URL.
  youtubeVideoId         String?   @map("youtube_video_id")
  /// R2.2.2 + NFR-R2: fetched ONCE at authoring time and persisted. A member
  /// page view never calls YouTube.
  videoTitle             String?   @map("video_title")
  /// The number R2.3.2's 90% completion threshold is computed against — the
  /// reason the Data API was chosen over a manual checkbox at Checkpoint 0.
  videoDurationSeconds   Int?      @map("video_duration_seconds")
  videoThumbnailUrl      String?   @map("video_thumbnail_url")
  videoMetadataFetchedAt DateTime? @map("video_metadata_fetched_at")
  /// 'api' | 'manual' — 'manual' is the R2.2.6 feature-off path when
  /// YOUTUBE_API_KEY is unset and an admin typed the metadata.
  videoMetadataSource    String?   @map("video_metadata_source")

  deletedAt DateTime? @map("deleted_at")
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")

  module   CourseModule     @relation(fields: [moduleId], references: [id], onDelete: Cascade)
  progress LessonProgress[]
  comments LessonComment[]

  @@unique([moduleId, slug])
  @@index([moduleId, sortOrder])   // R2.1.5 prev/next across module boundaries
  @@map("course_lessons")
}

/// R2.3. Per member per lesson. Composite PK, no surrogate id.
model LessonProgress {
  userId                  String    @map("user_id") @db.Uuid
  lessonId                String    @map("lesson_id")
  /// R2.3.1. Monotonic — the server only ever advances it.
  furthestPositionSeconds Int       @default(0) @map("furthest_position_seconds")
  completedAt             DateTime? @map("completed_at")
  /// 'auto' (R2.3.2 threshold) | 'manual' (R2.3.3). Manual is reversible.
  completionSource        String?   @map("completion_source")
  updatedAt               DateTime  @updatedAt @map("updated_at")

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  lesson Lesson @relation(fields: [lessonId], references: [id], onDelete: Cascade)

  @@id([userId, lessonId])
  @@map("lesson_progress")
}
// @@index([lessonId]) REJECTED. The composite PK leads with userId, which
// serves every query this task issues ("this member's progress across these
// lessons" — R2.3.5, R2.3.6, R2.4.2, hub continue-learning). A lessonId-leading
// index would only serve cross-member analytics, which §5 does not ship.
// It also enforces NFR-S4/R2.3.7 by shape: there is no efficient way to ask
// "who else completed this lesson", so no member endpoint accidentally can.

/// R2.5 + Checkpoint 0: a DISTINCT model, never a polymorphic comment table
/// shared with Post. Same one-level nesting rule and same server enforcement
/// as R1.3.
model LessonComment {
  id           String    @id @default(cuid())
  lessonId     String    @map("lesson_id")
  parentId     String?   @map("parent_id")
  bodyMarkdown String    @map("body_markdown")
  authorId     String?   @map("author_id") @db.Uuid
  /// R2.5.3 "Answered" treatment. A-8: lesson comments get this INSTEAD of
  /// reactions, matching the course_learning screens.
  answeredAt   DateTime? @map("answered_at")
  answeredBy   String?   @map("answered_by")
  editedAt     DateTime? @map("edited_at")
  deletedAt    DateTime? @map("deleted_at")
  deletedBy    String?   @map("deleted_by")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  lesson   Lesson          @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  parent   LessonComment?  @relation("LessonCommentChildren", fields: [parentId], references: [id], onDelete: Restrict)
  children LessonComment[] @relation("LessonCommentChildren")
  author   User?           @relation("LessonCommentAuthor", fields: [authorId], references: [id], onDelete: SetNull)

  @@index([lessonId, createdAt])   // the lesson comment thread render
  @@map("lesson_comments")
}
```

### 1.5 Live sessions (Phase 4)

```prisma
/// R3 + OQ-3/AD-3. Both linkages optional: a Ptah-scheduled stream has a
/// youtubeVideoId and no calendarEventId; an existing Calendar cohort session
/// that later gains a replay has a calendarEventId and a replayYoutubeVideoId.
model LiveSession {
  id          String   @id @default(cuid())
  title       String
  description String?
  startsAt    DateTime @map("starts_at")
  endsAt      DateTime? @map("ends_at")
  visibility  String   @default("member")
  cohortKeys  String[] @default([]) @map("cohort_keys")

  /// The scheduled unlisted stream (R3.1).
  youtubeVideoId       String? @map("youtube_video_id")
  /// The recording (R3.4). Often the same id; separate so a re-uploaded
  /// recording does not overwrite the stream reference.
  replayYoutubeVideoId String? @map("replay_youtube_video_id")
  videoTitle           String? @map("video_title")
  videoDurationSeconds Int?    @map("video_duration_seconds")
  videoThumbnailUrl    String? @map("video_thumbnail_url")
  videoMetadataFetchedAt DateTime? @map("video_metadata_fetched_at")
  videoMetadataSource    String?   @map("video_metadata_source")

  /// AD-3: claims an existing Google Calendar event so a replay can attach to
  /// it and the Live feed de-duplicates deterministically rather than on a
  /// fuzzy (title, startsAt) match.
  calendarEventId String? @unique @map("calendar_event_id")

  createdBy String?   @map("created_by")
  deletedAt DateTime? @map("deleted_at")
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")

  @@index([startsAt])   // upcoming/live/replay split + hub "next session"
  @@map("live_sessions")
}
```

### 1.6 Notifications (Phase 5)

```prisma
/// R10. In-app only — no email, no websocket, no SSE (§5).
model Notification {
  id      String @id @default(cuid())
  userId  String @map("user_id") @db.Uuid
  /// 'topic.reply' | 'post.child_reply' | 'post.accepted' |
  /// 'session_request.status' | 'announcement'
  kind    String
  /// The member who caused it, for "X replied to your topic". null for system.
  actorId String? @map("actor_id") @db.Uuid
  /// 'Topic' | 'Post' | 'SessionRequest' | 'LiveSession'
  targetType  String  @map("target_type")
  targetId    String  @map("target_id")
  title       String
  bodyPreview String? @map("body_preview")
  /// The /members deep link opening one navigates to (R10.3). Stored rather
  /// than derived so a routing change never orphans historical notifications.
  route       String
  readAt      DateTime? @map("read_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  user  User  @relation("NotificationRecipient", fields: [userId], references: [id], onDelete: Cascade)
  actor User? @relation("NotificationActor", fields: [actorId], references: [id], onDelete: SetNull)

  @@index([userId, readAt, createdAt])  // serves BOTH the unread badge count
                                        // (R10.4) and the newest-first list (R10.3)
  @@index([createdAt])                  // R10.6 retention prune — a global sweep
                                        // the userId-leading index cannot serve
  @@map("member_notifications")
}
```

### 1.7 `User` back-relations added

```prisma
model User {
  // ... existing ...
  topics             Topic[]          @relation("TopicAuthor")
  posts              Post[]           @relation("PostAuthor")
  postReactions      PostReaction[]
  topicReadStates    TopicReadState[]
  lessonProgress     LessonProgress[]
  lessonComments     LessonComment[]  @relation("LessonCommentAuthor")
  notifications      Notification[]   @relation("NotificationRecipient")
  actedNotifications Notification[]   @relation("NotificationActor")
}
```

### 1.8 Migrations — names and order

Forward-only, one per phase, each independently deployable (NFR-M3).

| #   | Migration                                           | Phase | Contents                                                                                                                                                                                               |
| --- | --------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `20260805090000_drop_discourse_group`               | 1     | `ALTER TABLE "member_groups" DROP COLUMN "discourse_group";` (MG-2.4)                                                                                                                                  |
| 2   | `20260812090000_community_forum`                    | 2     | `community_categories`, `community_topics`, `community_posts`, `community_post_reactions`, `community_topic_read_state`; `CREATE EXTENSION IF NOT EXISTS pg_trgm;` and the three trigram indexes below |
| 3   | `20260819090000_courses`                            | 3     | `courses`, `course_modules`, `course_lessons`, `lesson_progress`, `lesson_comments`; lesson-title trigram index                                                                                        |
| 4   | `20260826090000_live_and_private_sessions`          | 4     | `live_sessions`; `session_requests` gains `calendar_event_id` (unique), `meet_link`, `duration_minutes`, `decline_reason`; `@@index([status])` → `@@index([status, created_at])`                       |
| 5   | `20260902090000_packs_visibility_and_notifications` | 5     | `packs.member_visible`, `packs.access_note`; `member_notifications`                                                                                                                                    |

**Trigram indexes (A-7)** — Prisma cannot express `gin_trgm_ops`, so these are hand-written into migrations 2 and 3 after the generated DDL:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX community_topics_title_trgm     ON community_topics USING gin (title gin_trgm_ops);
CREATE INDEX community_posts_body_trgm       ON community_posts  USING gin (body_markdown gin_trgm_ops);
-- migration 3:
CREATE INDEX course_lessons_title_trgm       ON course_lessons   USING gin (title gin_trgm_ops);
```

Because these are outside Prisma's model, `prisma migrate dev` must not be allowed to drop them on the next diff — each is added in a hand-edited migration and `prisma migrate diff` output is reviewed before every subsequent migration lands. **Rejected**: `tsvector` columns with triggers, and any external search service — A-7 and §1.3 both.

**Ordering constraint**: migration 1 must land before the `discourse/` directory is deleted in the same release, but _after_ `MembershipService` is proven by tests (MG-2.2 / RK-4). The build order in §8 sequences that.

---

## 2. Backend module architecture

### 2.1 Nx project registrations

Each new lib gets `project.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `jest.config.cts`, `README.md`, and a `tsconfig.base.json` path entry, matching `libs/api/community`.

```jsonc
// libs/api/membership/project.json
{ "name": "api-membership", "tags": ["scope:api", "type:util"], ... }
// libs/api/youtube/project.json
{ "name": "api-youtube", "tags": ["scope:api", "type:util"], ... }
// libs/api/forum/project.json
{ "name": "api-forum", "tags": ["scope:api", "type:feature"], ... }
// libs/api/learning/project.json
{ "name": "api-learning", "tags": ["scope:api", "type:feature"], ... }
// libs/api/notifications/project.json
{ "name": "api-notifications", "tags": ["scope:api", "type:feature"], ... }
// libs/api/member-hub/project.json
{ "name": "api-member-hub", "tags": ["scope:api", "type:feature"], ... }
// libs/api-contracts/community/project.json
{ "name": "api-contracts-community", "tags": ["scope:api-contracts", "type:util"], ... }
// libs/web/members/project.json
{ "name": "web-members", "tags": ["scope:web", "type:feature"], ... }
```

`tsconfig.base.json` additions:

```jsonc
"@ptah-api/membership":    ["./libs/api/membership/src/index.ts"],
"@ptah-api/youtube":       ["./libs/api/youtube/src/index.ts"],
"@ptah-api/forum":         ["./libs/api/forum/src/index.ts"],
"@ptah-api/learning":      ["./libs/api/learning/src/index.ts"],
"@ptah-api/notifications": ["./libs/api/notifications/src/index.ts"],
"@ptah-api/member-hub":    ["./libs/api/member-hub/src/index.ts"],
"@ptah-contracts/community": ["./libs/api-contracts/community/src/index.ts"],
"@ptah-web/members":       ["./libs/web/members/src/index.ts"],
```

### 2.2 Dependency graph (a DAG — verified acyclic)

```
                   @ptah-api/core (util)   @ptah-api/identity (util)   @ptah-api/audit (util)
                          │                        │                        │
                          └────────────┬───────────┴────────────┬───────────┘
                                       ▼                        │
                            @ptah-api/membership (util)         │
                                       │                        │
        ┌──────────────┬───────────────┼────────────────┐       │
        ▼              ▼               ▼                ▼       │
 @ptah-api/       @ptah-api/    @ptah-api/        @ptah-api/     │
 notifications    youtube       community ────────┐  forum ◄─────┘
   (feature)      (util)        (feature)         │ (feature)
        │              │              │           │      │
        │              └──────┬───────┘           │      │
        │                     ▼                   │      │
        │              @ptah-api/learning (feature)│      │
        │                     │                   │      │
        └─────────────────────┴───────────────────┴──────┘
                              ▼
                     @ptah-api/member-hub (feature)
                              │
                              ▼
                    apps/ptah-license-server

  @ptah-contracts/community (leaf, depended on by every box above and by libs/web/members)
```

### 2.3 `libs/api/membership` — R7, the Phase-1 prerequisite

```
libs/api/membership/
  src/index.ts
  src/lib/membership.module.ts            @Global() — mirrors DiscourseModule/MemberGroupsModule
  src/lib/membership.service.ts           THE one isBuildersMember implementation
  src/lib/membership.service.spec.ts      R7.4's five cases
  src/lib/cohort-resolver.service.ts      MemberGroupAssignment → readonly string[] cohort keys
  src/lib/cohort-resolver.service.spec.ts
  src/lib/guards/member.guard.ts          JwtAuthGuard-successor: 403 { reason: 'membership_required' }
  src/lib/guards/member.guard.spec.ts
  src/lib/membership.types.ts             MemberContext
```

```ts
/** Resolved once per request by MemberGuard and attached to req.memberContext. */
export interface MemberContext {
  readonly userId: string;
  readonly email: string;
  /** A-2: entitlement — may this person enter /members at all. From License/Subscription. */
  readonly entitled: boolean;
  /** A-2: cohort — which gated content they see. From MemberGroupAssignment.
   *  Empty array is normal and never an error (R7.8). */
  readonly cohortKeys: readonly string[];
  readonly isAdmin: boolean;
}
```

`MembershipService.isBuildersMember` is `builders-membership.service.ts:24-44` moved verbatim — the subscription-then-license query, DB-resolved never JWT-resolved. The duplicate at `members.controller.ts:106-129` is deleted, not merged; the surviving copy is the extracted one.

**`MemberGuard`** runs after `JwtAuthGuard`, resolves a `MemberContext`, and attaches it to the request. Every member controller declares `@UseGuards(JwtAuthGuard, MemberGuard)` at class level. Cohort resolution happens **in the guard**, once, so no service re-derives it (R7.3) and no controller can forget it.

R7.2's verification: after Phase 1, `rg 'isBuildersMember'` returns exactly one implementation plus its call sites.

### 2.4 `libs/api/youtube` — R2.2, R3.2

```
libs/api/youtube/
  src/index.ts
  src/lib/youtube.module.ts
  src/lib/youtube-metadata.provider.ts        fetch + AbortController, never throws
  src/lib/youtube-metadata.provider.spec.ts
  src/lib/youtube.schemas.ts                  Zod — the ONLY validation of this boundary
  src/lib/youtube.schemas.spec.ts
  src/lib/youtube.types.ts                    YouTubeVideoMetadata, YouTubeFetchResult
  src/lib/parse-iso8601-duration.ts           pure
  src/lib/parse-iso8601-duration.spec.ts
  src/lib/extract-video-id.ts                 URL | bare id → id, or null
  src/lib/extract-video-id.spec.ts
```

Design detail is in [§4](#4-youtube-integration-design).

### 2.5 `libs/api/forum` — R1, R1.7, R8 moderation

```
libs/api/forum/
  src/index.ts
  src/lib/forum.module.ts
  src/lib/common/soft-delete.ts                     NOT_DELETED (AD-5)
  src/lib/common/visibility.ts                      buildCategoryVisibilityWhere(ctx)
  src/lib/common/visibility.spec.ts
  src/lib/common/slug.ts                            deterministic, collision-suffixed
  src/lib/common/soft-delete-filter.spec.ts         AD-5 structural test

  src/lib/categories/member-categories.controller.ts        GET  v1/members/community/categories
  src/lib/categories/admin-categories.controller.ts         CRUD v1/admin/community/categories
  src/lib/categories/categories.service.ts
  src/lib/categories/categories.service.spec.ts
  src/lib/categories/dto/{create-category.dto.ts,update-category.dto.ts,reorder-categories.dto.ts}

  src/lib/topics/member-topics.controller.ts        v1/members/community  (topics + posts + reactions)
  src/lib/topics/admin-topics.controller.ts         v1/admin/community    (moderation)
  src/lib/topics/topics.service.ts                  create/edit/soft-delete/pin/lock/move
  src/lib/topics/topics-read.service.ts             feed + thread read models, query-budgeted
  src/lib/topics/topics.service.spec.ts
  src/lib/topics/topics-read.service.spec.ts
  src/lib/topics/dto/{create-topic.dto.ts,update-topic.dto.ts,list-topics.query.dto.ts,moderate-topic.dto.ts}

  src/lib/posts/posts.service.ts                    reply, depth repair, tombstones, postCount
  src/lib/posts/posts.service.spec.ts
  src/lib/posts/accepted-answer.service.ts
  src/lib/posts/accepted-answer.service.spec.ts
  src/lib/posts/dto/{create-post.dto.ts,update-post.dto.ts,accept-answer.dto.ts}

  src/lib/reactions/reactions.service.ts            toggle + groupBy counts
  src/lib/reactions/reactions.service.spec.ts
  src/lib/reactions/reaction-types.ts               the fixed 4 (R1.4.3)

  src/lib/read-state/read-state.service.ts          A-6 marker + mark-all-read upsert
  src/lib/read-state/read-state.service.spec.ts
  src/lib/read-state/dto/mark-read.dto.ts

  src/lib/search/search.controller.ts               GET v1/members/search
  src/lib/search/search.service.ts                  A-7 ILIKE + trigram, visibility IN the query
  src/lib/search/search.service.spec.ts
  src/lib/search/dto/search.query.dto.ts
```

`ForumModule` providers: the nine services above + `AdminGuard` and `AdminThrottlerGuard` declared **locally** rather than by importing `AdminModule` — the acyclicity idiom `discourse.module.ts:44-48` and `MemberGroupsModule` already use. Imports: `ConfigModule`, `PrismaModule`, `IdentityModule`, `MembershipModule`, `NotificationsModule`, `AuditModule`. Exports: `TopicsReadService` and `ReadStateService` only — the two things `member-hub` composes.

### 2.6 `libs/api/learning` — R2, R8 authoring

```
libs/api/learning/
  src/index.ts
  src/lib/learning.module.ts
  src/lib/courses/member-courses.controller.ts       v1/members/courses
  src/lib/courses/admin-courses.controller.ts        v1/admin/courses
  src/lib/courses/admin-modules.controller.ts        v1/admin/course-modules
  src/lib/courses/admin-lessons.controller.ts        v1/admin/lessons
  src/lib/courses/courses.service.ts                 CRUD + publish
  src/lib/courses/course-read.service.ts             member read model, lock evaluation
  src/lib/courses/course-read.service.spec.ts
  src/lib/courses/module-lock.service.ts             R2.4 — date + sequential, server-side
  src/lib/courses/module-lock.service.spec.ts
  src/lib/courses/reorder.service.ts                 R8.8 single-request bulk reorder
  src/lib/courses/reorder.service.spec.ts
  src/lib/courses/dto/{create-course.dto.ts,update-course.dto.ts,create-module.dto.ts,
                       update-module.dto.ts,create-lesson.dto.ts,update-lesson.dto.ts,
                       reorder.dto.ts,refresh-metadata.dto.ts}
  src/lib/lessons/lesson-video.service.ts            YouTube fetch-and-persist at authoring time
  src/lib/lessons/lesson-video.service.spec.ts
  src/lib/progress/progress.service.ts               R2.3, monotonic, threshold, resume
  src/lib/progress/progress.service.spec.ts
  src/lib/progress/dto/{update-progress.dto.ts,set-completion.dto.ts}
  src/lib/comments/member-lesson-comments.controller.ts   v1/members/lesson-comments
  src/lib/comments/lesson-comments.service.ts
  src/lib/comments/lesson-comments.service.spec.ts
  src/lib/comments/dto/{create-comment.dto.ts,update-comment.dto.ts}
```

Exports: `CourseReadService` and `ProgressService` for `member-hub`.

### 2.7 `libs/api/notifications` — R10

```
libs/api/notifications/
  src/index.ts
  src/lib/notifications.module.ts                @Global() — producers live in three libs
  src/lib/notifications.service.ts               create (self-suppressing), list, markRead, unreadCount
  src/lib/notifications.service.spec.ts
  src/lib/notification-retention.service.ts      @Cron — R10.6, 90-day prune of READ rows
  src/lib/notification-retention.service.spec.ts
  src/lib/member-notifications.controller.ts     v1/members/notifications
  src/lib/dto/{list-notifications.query.dto.ts,mark-read.dto.ts}
  src/lib/notification-kinds.ts
```

`NotificationsService.create()` takes `{ recipientId, actorId, ... }` and **returns without writing when `recipientId === actorId`** (R10.2). Suppression lives in one place so no producer can forget it.

### 2.8 `libs/api/member-hub` — R6

```
libs/api/member-hub/
  src/index.ts
  src/lib/member-hub.module.ts
  src/lib/member-hub.controller.ts               GET v1/members/hub
  src/lib/member-entitlement.controller.ts       GET v1/members/entitlement (JwtAuthGuard only)
  src/lib/member-hub.service.ts                  AD-4 Promise.allSettled composer
  src/lib/member-hub.service.spec.ts             incl. the R6.4 fault-injection case
  src/lib/sections/{learning,community,sessions,packs,notifications}.section.ts
  src/lib/sections/*.section.spec.ts
```

Each `*.section.ts` exports one `resolve(ctx: MemberContext): Promise<HubSection<T>>`. Adding a Phase-N section adds a file and one line in the composer — which is how R6.6 holds the client at one request across four phases.

### 2.9 `libs/api/community` — what stays and what is added

Retained: `circle/`, `member-groups/`, `google-sessions/`, `packs/`. Deleted: `discourse/` (§6).

Added:

```
libs/api/community/src/lib/live-sessions/
  live-sessions.module.ts
  member-live.controller.ts         v1/members/live
  admin-live-sessions.controller.ts v1/admin/live-sessions
  live-sessions.service.ts          CRUD + YouTube metadata persist
  live-sessions.service.spec.ts
  live-feed.service.ts              AD-3 merge of LiveSession[] + BuildersSession[]
  live-feed.service.spec.ts
  dto/{create-live-session.dto.ts,update-live-session.dto.ts,list-live.query.dto.ts}

libs/api/community/src/lib/google-sessions/
  member-session-requests.controller.ts   v1/members/session-requests
  admin-session-requests.controller.ts    v1/admin/session-requests
  session-requests.service.ts             R4 accept/reschedule/decline against Calendar
  session-requests.service.spec.ts
  dto/{create-session-request.dto.ts,accept-session-request.dto.ts,
       reschedule-session-request.dto.ts,decline-session-request.dto.ts}
  members.controller.ts                   → @Controller('v1/members/sessions') (AD-12);
                                            its private isBuildersMember DELETED (R7.1)

libs/api/community/src/lib/packs/
  member-packs.controller.ts        v1/members/packs
  member-packs.service.ts           memberVisible only; MemberPack mapper
  member-packs.service.spec.ts      incl. the NFR-S5 field-absence assertion
  packs.types.ts                    docblock rewritten (R5.6); toMemberPack added
```

`SessionRequestsService` uses `GoogleCalendarProvider` (already exported by `GoogleSessionsModule`) for `createEvent` / `patchEvent` / `deleteEvent` with `createMeetLink: true`, then reads `hangoutLink` / `conferenceData` from the returned event via the existing `google-event.mapper` — **no Meet API is called and none is built** (R4.1, §5).

### 2.10 `libs/api-contracts/community`

```
libs/api-contracts/community/src/
  index.ts
  lib/member/{member-hub.contract.ts,member-topic.contract.ts,member-course.contract.ts,
              member-live.contract.ts,member-pack.contract.ts,member-notification.contract.ts,
              member-session-request.contract.ts,paged.contract.ts}
  lib/admin/{admin-topic.contract.ts,admin-course.contract.ts,admin-live.contract.ts,
             admin-pack.contract.ts,admin-session-request.contract.ts}
  lib/shared/{visibility.ts,reaction-type.ts,notification-kind.ts}
```

**The rule this lib exists to enforce**: no `admin/*` type may `extend` a `member/*` type. Admin types re-declare their fields. This is the `AdminSession extends BuildersSession` precedent inverted — that inheritance was safe only because `BuildersSession` was frozen (`google-sessions.types.ts:43-49` explains it); for pairs we author fresh, redeclaration removes the widening hazard entirely (RK-8). A structural test in this lib asserts no `extends` crosses the `member/` ↔ `admin/` boundary.

### 2.11 `app.module.ts` wiring

```ts
imports: [
  ConfigModule.forRoot({ isGlobal: true }),
  SentryModule,
  ThrottlerModule.forRoot([...]),          // unchanged
  EventEmitterModule.forRoot(),
  PrismaModule,
  AuditModule,
  MembershipModule,        // @Global — MUST precede every consumer (R7.3)
  NotificationsModule,     // @Global — producers span three libs
  YoutubeModule,
  CircleModule,
  GoogleSessionsModule,
  // DiscourseModule,      ← DELETED (MG-2.3)
  MemberGroupsModule,
  PacksModule,
  LiveSessionsModule,
  ForumModule,
  LearningModule,
  MemberHubModule,
  LicenseModule, AuthModule, PaddleModule, EventsModule, SubscriptionModule,
  ContactModule, WaitlistModule, SessionModule, HealthModule, MarketingModule, AdminModule,
]
```

Array order no longer arbitrates routing (`app.module.ts` comment, TASK_2026_170 R2) — `route-map.spec.ts` does. Order here is for readability.

---

## 3. API contracts

### 3.1 Conventions applying to every endpoint below

| Aspect             | Rule                                                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Member guard chain | `@UseGuards(JwtAuthGuard, MemberGuard)` at **class** level. `MemberGuard` 403s `{ reason: 'membership_required' }`, matching the shape `isMembershipRequiredError()` in `libs/web/core/.../members-api.service.ts` already parses. |
| Admin guard chain  | `@UseGuards(JwtAuthGuard, AdminGuard)` at class level, `AdminThrottlerGuard` where a route needs it.                                                                                                                               |
| Validation         | Every `@Body()` / `@Query()` binds `dtoPipe(TheDto)` (AD-7 / F-3). No exceptions.                                                                                                                                                  |
| Pagination         | `?page` (1-based) `&pageSize` (default 25, **max 50**, `>50` → 400) — NFR-P5. Response `Paged<T> = { items: T[]; page: number; pageSize: number; total: number; hasMore: boolean }`.                                               |
| Invisible resource | `404`, never `403` (R1.1.3). `403` is reserved for _visible but forbidden_ — a locked module, a non-author edit.                                                                                                                   |
| Errors             | Typed Nest exceptions with fixed sanitized messages built from caller-supplied values only (`packs.service.ts:277-313` pattern). Raw dependency messages never reach a client (NFR-S7).                                            |
| Rate limits        | `@Throttle` per NFR-S9: content creation 10/min, reactions 30/min, progress writes 60/min, reads inherit the global 100/min.                                                                                                       |

### 3.2 Phase 1

| Method | Path                          | Guards                        | Request | Response                                                            | Errors   |
| ------ | ----------------------------- | ----------------------------- | ------- | ------------------------------------------------------------------- | -------- |
| GET    | `/api/v1/members/entitlement` | `JwtAuthGuard`                | —       | `{ entitled: boolean; cohorts: { key; name }[]; isAdmin: boolean }` | 401      |
| GET    | `/api/v1/members/hub`         | `JwtAuthGuard`, `MemberGuard` | —       | `MemberHubResponse`                                                 | 401, 403 |
| GET    | `/api/v1/members/sessions`    | `JwtAuthGuard`, `MemberGuard` | —       | `{ sessions: BuildersSession[]; memberGroups: UserMemberGroup[] }`  | 401, 403 |

`GET /members/entitlement` deliberately returns `200 { entitled: false }` rather than 403 — the frontend `MemberGuard` must distinguish "not logged in" (→ `/login`) from "logged in, not a member" (→ upgrade surface, R7.7) without reading an exception body. It is a two-query endpoint, unlike `AdminAuthGuard`'s probe, whose own docblock warns against probing heavy handlers (`admin-auth.guard.ts:31-33`).

`GET /members/sessions` drops `communityUrl` (Discourse-derived, MG-2.7). The frontend Zod schema loses the field in the same commit.

```ts
// @ptah-contracts/community — the hub envelope, stable across all five phases
export type HubSectionStatus = 'ok' | 'empty' | 'unavailable';
export interface HubSection<T> {
  status: HubSectionStatus;
  data: T;
}

export interface MemberHubResponse {
  member: { firstName: string | null; cohorts: { key: string; name: string }[] };
  sections: {
    learning: HubSection<ContinueLearning | null>; // Phase 1: {status:'empty', data:null}
    community: HubSection<HubTopicSummary[]>; // Phase 1: {status:'empty', data:[]}
    sessions: HubSection<HubSessionSummary | null>; // Phase 1: POPULATED from Calendar
    packs: HubSection<MemberPack[]>; // Phase 1: {status:'empty', data:[]}
    notifications: HubSection<{ unreadCount: number }>; // Phase 1: {status:'empty', data:{unreadCount:0}}
  };
}
```

**What each phase fills in** (R6.6 — the shape never changes, only which sections report `'ok'`):

| Section         | P1            | P2                     | P3                                        | P4                                                          | P5                   |
| --------------- | ------------- | ---------------------- | ----------------------------------------- | ----------------------------------------------------------- | -------------------- |
| `sessions`      | Calendar only | —                      | —                                         | + `LiveSession` next-upcoming and accepted private sessions | —                    |
| `community`     | `empty`       | recent + unread topics | —                                         | —                                                           | —                    |
| `learning`      | `empty`       | —                      | current course, next incomplete lesson, % | —                                                           | —                    |
| `packs`         | `empty`       | —                      | —                                         | —                                                           | member-visible packs |
| `notifications` | `empty`       | —                      | —                                         | —                                                           | unread count         |

R6.2's assertion ("exactly one data request for the initial render") is an e2e network-count test on `/members`, written in Phase 1 and re-run unchanged in every later phase.

### 3.3 Phase 2 — Community

**Member** — `@Controller('v1/members/community')`:

| Method | Path (after prefix)          | Request                                                               | Response                                                         | Errors                                      |
| ------ | ---------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| GET    | `categories`                 | —                                                                     | `MemberCategory[]` (incl. `topicCount`, `unreadCount`)           | 401/403                                     |
| GET    | `topics`                     | `?categoryId&page&pageSize&sort=recent\|unread`                       | `Paged<MemberTopicSummary>`                                      | 400 (pageSize>50), 404 (invisible category) |
| GET    | `topics/:slug`               | `?page&pageSize`                                                      | `MemberTopicDetail`                                              | 404                                         |
| POST   | `topics`                     | `CreateTopicDto { categoryId, title(3–200), bodyMarkdown(1–50_000) }` | `MemberTopicDetail` (201)                                        | 400, 404 (invisible category)               |
| PATCH  | `topics/:id`                 | `UpdateTopicDto { title?, bodyMarkdown? }`                            | `MemberTopicDetail`                                              | 403 (not author / window closed), 404       |
| DELETE | `topics/:id`                 | —                                                                     | `{ deleted: true }`                                              | 403, 404                                    |
| POST   | `topics/:id/posts`           | `CreatePostDto { bodyMarkdown, parentId? }`                           | `MemberPost` (201)                                               | 403 `{reason:'topic_locked'}`, 404          |
| PATCH  | `posts/:id`                  | `UpdatePostDto { bodyMarkdown }`                                      | `MemberPost`                                                     | 403, 404                                    |
| DELETE | `posts/:id`                  | —                                                                     | `{ deleted: true }`                                              | 403, 404                                    |
| PUT    | `posts/:id/reactions/:type`  | — (`:type` via `ParseEnumPipe`)                                       | `{ counts: Record<ReactionType, number>; mine: ReactionType[] }` | 400 (unknown type), 404                     |
| PUT    | `topics/:id/accepted-answer` | `AcceptAnswerDto { postId }`                                          | `{ acceptedPostId }`                                             | 403 (not author/admin), 404                 |
| DELETE | `topics/:id/accepted-answer` | —                                                                     | `{ acceptedPostId: null }`                                       | 403, 404                                    |
| POST   | `topics/:id/read`            | `MarkReadDto { lastReadPostNumber }`                                  | `{ unreadCount: 0 }`                                             | 404                                         |
| POST   | `categories/:id/read-all`    | —                                                                     | `{ topicsMarked: number }`                                       | 404                                         |

`PUT` on the reaction toggle (not `POST`) because the operation is idempotent-per-intent: the request expresses "my reaction of this type on this post should flip", and a retried request converges. R1.4.1's toggle semantics are implemented as delete-if-exists-else-create inside one transaction.

`GET topics/:slug` returns the accepted answer **twice** — once hoisted into `acceptedPost`, once in its chronological position with `accepted: true` (R1.5.1). The client renders the hoisted copy above the list and marks the in-line one.

`@Controller('v1/members/search')` (separate controller, RI-2):

| GET | `/api/v1/members/search` | `?q(2–200)&kinds=topics,posts,lessons&page&pageSize` | `{ topics: Paged<...>; posts: Paged<...>; lessons: Paged<...> }` | 400 |

Visibility is a `WHERE` clause built from `MemberContext` and applied **in the SQL** (R1.7.2). Highlighting is client-side over text nodes (R1.7.5) — the API returns plain excerpts with match offsets, never HTML.

**Admin** — `@Controller('v1/admin/community')` (the path freed by deleting the read-only `AdminCommunityController`):

| Method        | Path                              | Notes                                                                                                                                    |
| ------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| GET/POST      | `categories`                      | `CreateCategoryDto { slug, name, description?, visibility, cohortKeys[], sortOrder? }`; `cohortKeys` validated against `MemberGroup.key` |
| PATCH         | `categories/reorder`              | `{ ids: string[] }` — **declared before `categories/:id`** (RI-3), one transaction, sparse renumber (R8.8)                               |
| PATCH/DELETE  | `categories/:id`                  |                                                                                                                                          |
| GET           | `topics`                          | `?includeDeleted&categoryId&search`                                                                                                      |
| PATCH         | `topics/:id`                      | `ModerateTopicDto { pinned?, locked?, categoryId?, title?, bodyMarkdown? }` (R8.2)                                                       |
| DELETE        | `topics/:id`                      | soft, audited                                                                                                                            |
| POST          | `topics/:id/restore`              | R8.5, ≥30-day window                                                                                                                     |
| DELETE / POST | `posts/:id` , `posts/:id/restore` | soft + restore                                                                                                                           |

Every admin mutation writes an `AdminAuditLog` row **inside the mutation's transaction** (`packs.service.ts:98-141` pattern). New `AdminAuditAction` values: `community.category.create|update|delete|reorder`, `community.topic.pin|lock|move|update|delete|restore`, `community.post.delete|restore`. New `AdminAuditTargetType`: `Category`, `Topic`, `Post`. The stale `'discourse.group.sync'` action is removed and the "no `community.*` action because the surface is read-only" comment at `audit-log.types.ts:33-36` is rewritten.

### 3.4 Phase 3 — Courses

**Member** — `@Controller('v1/members/courses')`:

| Method | Path                                   | Response                                                                                          | Errors                              |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------- |
| GET    | ``                                     | `MemberCourseSummary[]` (`completedLessons`, `totalLessons`, `percent`)                           | 401/403                             |
| GET    | `:slug`                                | `MemberCourseDetail` — modules with `locked`, `lockReason`, `unlocksAt`; lessons with `completed` | 404 (draft / invisible)             |
| GET    | `:slug/lessons/:lessonSlug`            | `MemberLessonDetail` — body, video metadata, `progress`, `previous`/`next` (R2.1.5), `comments`   | 403 `{reason:'module_locked'}`, 404 |
| PUT    | `:slug/lessons/:lessonSlug/progress`   | `{ positionSeconds }` → `{ furthestPositionSeconds, completedAt }`                                | 403, 404                            |
| PUT    | `:slug/lessons/:lessonSlug/completion` | `{ complete: boolean }` → same                                                                    | 403, 404                            |

A locked module returns title and lesson titles but **omits `bodyMarkdown`, `youtubeVideoId` and `comments`** (R2.4.4) — the omission happens in the mapper, before serialization, not in the client.

`@Controller('v1/members/lesson-comments')` (separate, to avoid contesting `courses/:slug`):

| POST | ``|`CreateCommentDto { lessonId, bodyMarkdown, parentId? }`| 403 (locked/invisible), 404 |
| PATCH |`:id`|`{ bodyMarkdown }`| 403 |
| DELETE |`:id`| soft | 403 |
| PUT |`:id/answered`|`{ answered: boolean }` — admin or lesson author only (R2.5.3) | 403 |

**Admin** — three sibling literal prefixes so no `:id` ever contests a nested literal:

- `v1/admin/courses` — GET list, POST, GET/PATCH/DELETE `:id`, POST `:id/restore`, PATCH `reorder` _(before `:id`)_, PUT `:id/published`
- `v1/admin/course-modules` — POST, PATCH/DELETE `:id`, PATCH `reorder` _(before `:id`)_
- `v1/admin/lessons` — POST, PATCH/DELETE `:id`, PATCH `reorder` _(first)_, POST `refresh-metadata` _(bulk, `{ lessonIds: string[] }`, declared before `:id/...`)_, POST `:id/refresh-metadata`

`POST /admin/lessons` and `PATCH /admin/lessons/:id` accept `{ youtubeVideoIdOrUrl?, videoTitle?, videoDurationSeconds? }`. The service extracts the id, fetches metadata, and **either persists a fully-configured lesson or persists nothing** (R2.2.4) — the fetch happens before the write, inside the same transaction boundary.

### 3.5 Phase 4 — Live and private sessions

**Member**:

| Method | Path                                   | Response                                                                                                       |
| ------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/members/live`                 | `{ upcoming: LiveFeedItem[]; live: LiveFeedItem[]; replays: Paged<LiveFeedItem>; calendarAvailable: boolean }` |
| GET    | `/api/v1/members/session-requests`     | `MemberSessionRequest[]` — own only (R4.3)                                                                     |
| POST   | `/api/v1/members/session-requests`     | `CreateSessionRequestDto { sessionTopicId, additionalNotes? }` → 201 `MemberSessionRequest` (status `pending`) |
| DELETE | `/api/v1/members/session-requests/:id` | own + `pending` only → `{ canceled: true }`; 403 otherwise                                                     |

`calendarAvailable: false` when `GOOGLE_OAUTH_*` is unset — the surface still renders YouTube-sourced sessions and shows the member no error (R3.6).

`MemberSessionRequest` = `{ id, sessionTopicId, additionalNotes, status, scheduledAt, durationMinutes, meetLink, declineReason, createdAt }`. It **omits** `paddleTransactionId`, `paymentStatus` internals and `calendarEventId` (NFR-S4) and is a distinct type from the admin one.

**Admin**:

| Method            | Path                                            | Behaviour                                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET               | `/api/v1/admin/live-sessions`                   | `?includeDeleted&from&to`                                                                                                                                                                                 |
| POST/PATCH/DELETE | `/api/v1/admin/live-sessions[/:id]`             | YouTube metadata fetched at write, feature-off tolerant                                                                                                                                                   |
| POST              | `/api/v1/admin/live-sessions/:id/restore`       |                                                                                                                                                                                                           |
| GET               | `/api/v1/admin/session-requests`                | `?status=pending` → oldest first (R4.4), full `AdminSessionRequest` incl. requester identity                                                                                                              |
| POST              | `/api/v1/admin/session-requests/:id/accept`     | `{ startsAt, durationMinutes }` → creates Calendar event with `createMeetLink: true`, persists `calendarEventId` + `meetLink` + `scheduledAt` + `durationMinutes`, status → `scheduled`, notifies (R10.1) |
| POST              | `/api/v1/admin/session-requests/:id/reschedule` | `{ startsAt, durationMinutes }` → patches the event **by `calendarEventId`**                                                                                                                              |
| POST              | `/api/v1/admin/session-requests/:id/decline`    | `{ reason? }` → deletes the event if one exists, status → `canceled`, persists `declineReason`                                                                                                            |

Error semantics on accept, which R4.7 and R4.9 make load-bearing:

| Condition                                   | Status | Body                                   | State written                                                                 |
| ------------------------------------------- | ------ | -------------------------------------- | ----------------------------------------------------------------------------- |
| Google unset                                | `503`  | `{ reason: 'scheduling_unavailable' }` | none — request stays `pending`                                                |
| Calendar call fails                         | `502`  | `{ reason: 'calendar_event_failed' }`  | none — request stays `pending`                                                |
| Event created but response has no Meet link | `502`  | `{ reason: 'meet_link_unresolved' }`   | none; the created event is **deleted** in the same handler to avoid an orphan |
| Success                                     | `200`  | `AdminSessionRequest`                  | all four columns, in one transaction                                          |

The order is: create the Calendar event first, then write the DB row. A failed DB write after a successful event creation deletes the event before returning — the only sequence that satisfies "no partial state SHALL be persisted".

### 3.6 Phase 5 — Packs and notifications

| Method | Path                                         | Response                                                 |
| ------ | -------------------------------------------- | -------------------------------------------------------- |
| GET    | `/api/v1/members/packs`                      | `MemberPack[]`                                           |
| GET    | `/api/v1/members/notifications`              | `Paged<MemberNotification>`, newest first                |
| GET    | `/api/v1/members/notifications/unread-count` | `{ unreadCount: number }` — the 60 s poll target (AD-14) |
| POST   | `/api/v1/members/notifications/:id/read`     | `{ readAt }`                                             |
| POST   | `/api/v1/members/notifications/read-all`     | `{ marked: number }`                                     |

```ts
/** R5.3 + NFR-S4/S5. Declared standalone — it does NOT extend PackResponse,
 *  so `notes` cannot arrive by inheritance. A test asserts its absence (R5.2). */
export interface MemberPack {
  id: string;
  slug: string;
  title: string;
  description: string;
  repoUrl: string;
  tags: string[];
  /** Display label only. A-1: grants and revokes nothing. */
  cohortName: string | null;
  /** R5.5: how access is granted, so a GitHub 404 is not the first signal. */
  accessNote: string | null;
}
```

`GET /members/packs` filters on `memberVisible: true` **only** (A-1). It does not filter on `cohortKey`, and the service does not inject `CohortResolver` — the absence is the control, mirroring how `PacksService` refuses to inject `BuildersMembershipService` (`packs.service.ts:24-46`).

Admin `PATCH /api/v1/admin/packs/:id` gains `memberVisible?: boolean` and `accessNote?: string | null` on the existing DTO (R8.4).

### 3.7 Full member route table (RI-1 disjointness check)

Every member controller declares a **literal** segment 3. No parameter appears before segment 4.

```
v1/members/entitlement          MemberEntitlementController     (member-hub)
v1/members/hub                  MemberHubController             (member-hub)
v1/members/sessions             MembersController               (community)      ← AD-12 re-declared
v1/members/community            MemberCommunityController       (forum)
v1/members/search               MemberSearchController          (forum)
v1/members/courses              MemberCoursesController         (learning)
v1/members/lesson-comments      MemberLessonCommentsController  (learning)
v1/members/live                 MemberLiveController            (community)
v1/members/session-requests     MemberSessionRequestsController (community)
v1/members/packs                MemberPacksController           (community)
v1/members/notifications        MemberNotificationsController   (notifications)
```

All eleven, plus the seven new admin controllers, are added to `apps/ptah-license-server/src/testing/controller-registry.ts` in the same commit that creates them — the census in `controller-validation.spec.ts` fails the build otherwise (F-4).

---

## 4. YouTube integration design

### 4.1 Configuration and posture

Single variable `YOUTUBE_API_KEY`, read **once in the provider constructor** via `ConfigService` (NFR-S6) with the established `?.trim() || undefined` idiom (`google-auth.provider.ts:60-70`). Added to `.env.example` and `.env.prod.example` in the block vacated by the `DISCOURSE_*` removal.

`isEnabled(): boolean` returns `this.apiKey !== undefined`. When false — and this mirrors `GOOGLE_OAUTH_*` exactly (R2.2.6, NFR-R1):

- `fetchVideo()` returns `{ ok: false, skipped: true }` and logs **once** (`loggedDisabled` flag, `sessions.service.ts:396-407`).
- Admin lesson/live-session save proceeds, storing the video id plus whatever `videoTitle` / `videoDurationSeconds` the admin typed, with `videoMetadataSource: 'manual'`.
- `POST /admin/lessons/refresh-metadata` returns `200 { refreshed: 0, skipped: n, reason: 'youtube_disabled' }`.
- Every member endpoint returns its normal contract. Nothing `500`s.

The key never crosses to the client. The frontend receives only the persisted `youtubeVideoId` and metadata columns (RK-6).

### 4.2 Fetch

```
GET https://www.googleapis.com/youtube/v3/videos
    ?part=snippet,contentDetails,status&id=<id>&key=<key>
```

Native `fetch` + `AbortController` at 10,000 ms — no `googleapis` package, matching `GoogleAuthProvider`'s explicit "NO googleapis npm package" decision. Never throws; every failure folds into `{ ok: false, error: <short sanitized reason> }` and the raw upstream body is never surfaced (NFR-S7).

### 4.3 Zod at the boundary — mandatory (R2.2.3, NFR-S1)

```ts
// libs/api/youtube/src/lib/youtube.schemas.ts
const thumbnailSchema = z.object({ url: z.string().url() });

export const youtubeVideoListResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({
        title: z.string(),
        thumbnails: z.object({
          medium: thumbnailSchema.optional(),
          high: thumbnailSchema.optional(),
          default: thumbnailSchema.optional(),
        }),
      }),
      contentDetails: z.object({ duration: z.string() }), // ISO-8601, e.g. "PT1H2M3S"
      status: z.object({
        privacyStatus: z.enum(['public', 'unlisted', 'private']),
        embeddable: z.boolean(),
      }),
    }),
  ),
});
```

Not one field is persisted before `safeParse` succeeds. Failure → `{ ok: false, error: 'malformed_response' }`.

### 4.4 Outcome mapping (R2.2.4 — specific and actionable, never a half-configured lesson)

| Condition                     | `YouTubeFetchResult`                         | Admin HTTP response                                                   |
| ----------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| `items: []`                   | `{ ok: false, error: 'not_found' }`          | `422 { reason: 'youtube_video_not_found' }`                           |
| `privacyStatus === 'private'` | `{ ok: false, error: 'private' }`            | `422 { reason: 'youtube_video_private' }`                             |
| `embeddable === false`        | `{ ok: false, error: 'not_embeddable' }`     | `422 { reason: 'youtube_video_not_embeddable' }`                      |
| Zod failure                   | `{ ok: false, error: 'malformed_response' }` | `502 { reason: 'youtube_unavailable' }`                               |
| HTTP ≥ 400 / timeout          | `{ ok: false, status, error }`               | `502 { reason: 'youtube_unavailable' }`                               |
| `isEnabled() === false`       | `{ ok: false, skipped: true }`               | **not an error** — save proceeds with `videoMetadataSource: 'manual'` |
| Success                       | `{ ok: true, video }`                        | `200` with the lesson                                                 |

`privacyStatus: 'unlisted'` is **accepted** — unlisted is the Checkpoint 0 delivery model.

### 4.5 Caching: persistence _is_ the cache

There is no cache, no TTL and no Redis, because there is no read-path call to cache. Metadata is fetched **once at authoring time** and written onto `Lesson` / `LiveSession` (R2.2.2, NFR-R2). A member page view issues zero third-party calls (NFR-P6), asserted by a test that fails if `fetch` is invoked during a hub or lesson read.

`videoMetadataFetchedAt` records staleness so the admin UI can badge rows older than N days and offer `refresh-metadata` (R2.2.5) — a _manual_ action, deliberately, because an automatic refresh job would reintroduce the quota surface the authoring-time decision removed.

**Quota**: `videos.list` costs 1 unit against a 10,000/day default. Authoring is measured in tens of writes per month. **Explicitly rejected**: quota tracking, backoff scheduling, or a metadata refresh cron — all justified only above §1.3 scale (RK-6).

### 4.6 Embed and progress (NFR-S3, R2.3)

**Facade-then-player**, which is what makes "no YouTube script or cookie loads before a member plays" and "playback position drives progress" both true:

1. Initial render is a **poster**: the persisted `videoThumbnailUrl` in an `<img>` with a play button. Zero YouTube network activity.
2. On the member's first activation (click or `Enter`/`Space` — NFR-U4), `YouTubePlayerComponent` injects `https://www.youtube.com/iframe_api` and constructs a player whose `host` is `https://www.youtube-nocookie.com`, so the iframe origin is the nocookie domain (NFR-S3).
3. The iframe `src` is built from a **regex-validated** id — `/^[A-Za-z0-9_-]{11}$/` checked _before_ `bypassSecurityTrustResourceUrl`, with the id as the only interpolated value. Params: `rel=0&modestbranding=1&enablejsapi=1`.
4. A 1 s interval reads `getCurrentTime()`; the component `PUT`s progress **at most once per 15 s** (R2.3.1) and flushes on `pause`, `ended` and `DestroyRef` teardown.
5. The server clamps: `furthestPositionSeconds = max(stored, submitted)` — monotonic, so seeking backwards never regresses progress.
6. **Completion is computed server-side**: `furthest >= 0.9 * videoDurationSeconds` (R2.3.2). The client never sends a `completed` flag. A lesson with no `videoDurationSeconds` is manual-only (R2.3.4).

Rendered inside `libs/web/members`, private to it (one consumer — see [§5.3](#53-what-goes-into-panel-ui-and-what-stays-private)).

---

## 5. Frontend architecture — `libs/web/members`

### 5.1 File layout

```
libs/web/members/
  project.json  jest.config.cts  tsconfig.{json,lib,spec}.json  README.md
  src/index.ts                                  ← exports MEMBER_ROUTES ONLY
  src/lib/members.routes.ts
  src/lib/members.routes.spec.ts                ← R9.4 / RK-11 no-catch-all assertion
  src/lib/member-nav.config.ts                  ← MEMBER_NAV_GROUPS: readonly PanelNavGroup[]
  src/lib/member-layout/{member-layout.ts,member-layout.html}
  src/lib/guards/member.guard.ts                ← probes GET /api/v1/members/entitlement
  src/lib/guards/member.guard.spec.ts

  src/lib/services/
    member-hub-api.service.ts                   member-community-api.service.ts
    member-courses-api.service.ts               member-live-api.service.ts
    member-session-requests-api.service.ts      member-packs-api.service.ts
    member-notifications-api.service.ts         member-search-api.service.ts
    member-theme.service.ts                     (+ one .spec.ts each)

  src/lib/state/
    member-notifications.store.ts               ← signal store, 60 s poll → badgeCount
    member-session.store.ts                     ← MemberContext signal, set once by the guard
    course-player.store.ts                      ← progress buffer + 15 s throttle

  src/lib/hub/hub-page.ts
  src/lib/hub/sections/{continue-learning-card,community-activity-card,
                        next-session-card,packs-card}.ts
  src/lib/community/{feed-page.ts,thread-page.ts,my-threads-page.ts}
  src/lib/community/components/{topic-composer,reply-composer,reaction-bar,
                                accepted-answer-badge,unread-pill}.ts
  src/lib/courses/{courses-page.ts,course-detail-page.ts,lesson-page.ts}
  src/lib/courses/components/{module-outline,lesson-comments,youtube-player,
                              locked-module-notice}.ts
  src/lib/live/{live-page.ts,replays-page.ts,request-session-page.ts}
  src/lib/packs/packs-page.ts
  src/lib/notifications/notifications-page.ts
  src/lib/search/search-page.ts
  src/lib/account/account-page.ts
  src/lib/shared/{highlight-text.pipe.ts,relative-time.pipe.ts}
```

`src/index.ts` exports `MEMBER_ROUTES` and nothing else. Components are reachable only through lazy `loadComponent`, mirroring `@ptah-web/admin`'s surface.

### 5.2 Routing (R9.4 — explicitly enumerated, no catch-all)

```ts
// apps/ptah-landing-page/src/app/app.routes.ts — replaces the current
// `/members` → @ptah-web/account MembersPageComponent entry (F-6)
{
  path: 'members',
  canActivate: [MemberGuard],
  loadChildren: () => import('@ptah-web/members').then((m) => m.MEMBER_ROUTES),
  providers: [provideMarkdownRendering({ extensions: 'member' })],   // AD-1
  data: { hideFromNav: true },
}
```

```ts
export const MEMBER_ROUTES: Routes = [{
  path: '', component: MemberLayout, children: [
    { path: '',                       pathMatch: 'full', redirectTo: 'hub' },
    { path: 'hub',                    loadComponent: … },
    { path: 'courses',                loadComponent: … },
    { path: 'courses/:slug',          loadComponent: … },
    { path: 'courses/:slug/lessons/:lessonSlug', loadComponent: … },
    { path: 'packs',                  loadComponent: … },
    { path: 'live',                   loadComponent: … },
    { path: 'live/replays',           loadComponent: … },
    { path: 'live/request',           loadComponent: … },
    { path: 'community',              loadComponent: … },   // feed
    { path: 'community/topics/:slug', loadComponent: … },   // thread
    { path: 'community/my-threads',   loadComponent: … },
    { path: 'notifications',          loadComponent: … },
    { path: 'search',                 loadComponent: … },
    { path: 'account',                loadComponent: … },
    { path: '**',                     redirectTo: 'hub' },
  ],
}];
```

**No `:model` / `:model/:id` catch-all.** `members.routes.spec.ts` walks the tree and asserts: (i) no route path's **first** segment begins with `:`; (ii) every parameter segment is drawn from the allowlist `{ ':slug', ':lessonSlug', ':id' }`; (iii) the literal strings `':model'` and `':model/:id'` appear nowhere. `admin.routes.ts:16-19` documents the catch-all the admin panel deliberately keeps — on an internal operator surface it is a feature; here it is a data-exposure hazard, which is the whole content of R9.4 and RK-11.

`MemberGuard` (frontend) probes `GET /api/v1/members/entitlement`: `401` → `/login?returnUrl=/members`; `200 { entitled: false }` → `/pricing` (R7.7 upgrade surface, never an empty panel or a raw 403); `200 { entitled: true }` → seeds `MemberSessionStore` and allows. Modelled on `admin-auth.guard.ts` but reading a body rather than a status, because the entitled/unentitled distinction is data, not an error.

### 5.3 What goes into `panel-ui`, and what stays private

The rule, taken from how `PanelLayout` itself was extracted in `5273fbdd0`: **a primitive earns a place in `@ptah-web/panel-ui` when a second panel actually renders it.** Speculative extraction produces a shell nobody's second consumer fits.

**Promote to `@ptah-web/panel-ui`** (each has a real admin consumer):

| Primitive       | Member consumer                     | Admin consumer                                                               | Notes                                                                             |
| --------------- | ----------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `TagChip`       | pack tags, category chips           | `builders/packs/packs-list.html` already renders tags inline                 | `input({ label, variant })`, reuses `BadgeVariant`                                |
| `ThreadRow`     | community feed, my-threads          | `builders/community/community-view` is rebuilt onto native topics in Phase 2 | title, author, reply count, `unreadCount`, `pinned`, `locked`, `accepted` markers |
| `SessionCard`   | live/upcoming/replays               | `builders/sessions/sessions-list`                                            | supersedes the deleted `libs/web/account/.../session-card.component.ts`           |
| `CalendarMonth` | Live month view                     | the `admin_sessions_calendar` screen is the admin surface's own target       | pure presentational month grid; day-cell content projected                        |
| `ProgressMeter` | course cards, hub continue-learning | admin course list completion column                                          | `value`/`max`, `border-hairline` track, `primary` fill                            |

Each ships with its own `.spec.ts` and is added to `libs/web/panel-ui/src/index.ts`.

**Stays private to `libs/web/members`** (one consumer, or member-semantics-only):

`YouTubePlayerComponent` (IFrame API lifecycle, heavy, single consumer), `TopicComposer` / `ReplyComposer` (markdown authoring — no admin equivalent), `ReactionBar` (A-8: reactions are a member surface; admin does not react), `LockedModuleNotice`, `UnreadPill`, `HighlightTextPipe`.

**Reused unchanged** (R9.7): `PanelLayout`, `StatTile` (hub metrics), `StatusBadge` (session status, request status, "Answered"), `EmptyState` (every empty section — R1.7.3, R6.3), `DetailDrawer` (session detail, notification detail), `SelectionToolbar` (bulk mark-read).

### 5.4 Nav configuration (R9.2, R9.3)

```ts
// libs/web/members/src/lib/member-nav.config.ts — mirrors ADMIN_NAV_GROUPS exactly
export const MEMBER_NAV_GROUPS: readonly PanelNavGroup[] = [
  { label: 'Home', icon: Home, flat: true, items: [{ label: 'Hub', route: '/members/hub', primary: true, icon: Home, exact: true }] },
  {
    label: 'Learn',
    icon: GraduationCap,
    items: [
      { label: 'Courses', route: '/members/courses', primary: true, icon: GraduationCap },
      { label: 'Artifacts', route: '/members/courses', primary: false },
    ],
  },
  { label: 'Build', icon: Package, flat: true, items: [{ label: 'Packs', route: '/members/packs', primary: true, icon: Package }] },
  {
    label: 'Live',
    icon: Radio,
    items: [
      { label: 'Sessions', route: '/members/live', primary: true, icon: Radio, exact: true },
      { label: 'Replays', route: '/members/live/replays', primary: false },
      { label: 'Request a session', route: '/members/live/request', primary: false },
    ],
  },
  {
    label: 'Community',
    icon: MessagesSquare,
    items: [
      { label: 'Feed', route: '/members/community', primary: true, icon: MessagesSquare, exact: true },
      { label: 'My Threads', route: '/members/community/my-threads', primary: false },
      { label: 'Notifications', route: '/members/notifications', primary: false },
    ],
  },
  { label: 'Account', icon: UserCircle, flat: true, items: [{ label: 'Account', route: '/members/account', primary: true, icon: UserCircle }] },
];
```

`badgeCount` on the Notifications item is bound in `MemberLayout` from `MemberNotificationsStore.unreadCount()` — a `computed()` recomputing `MEMBER_NAV_GROUPS` with that one item's `badgeCount` replaced. `PanelNavItem.badgeCount` (`panel-nav.types.ts:36`) gets its intended first consumer, and **no parallel badge mechanism is introduced** (R9.3).

`MemberLayout` binds `theme` from `MemberThemeService` (`operator-member` | `operator-member-light`, `localStorage`-persisted per AD-13), `title="Ptah Builders"`, `drawerId="member-drawer"` (distinct from the admin's, per `panel-layout.ts:64-67`), the cohort name as `badgeLabel`, and projects the email + theme toggle into `[panelTopBar]` and the membership card into `[panelSidebarFooter]`.

### 5.5 Non-negotiables enforced by test, not by review

| Rule                                                        | Enforcement                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-U1 — `OnPush` + signals + `inject()` on every component | ESLint `@angular-eslint/prefer-on-push-component-change-detection` scoped to `libs/web/members/**`; no constructor injection                                                                                                                                                                 |
| NFR-S2 — one renderer, one sanitizer                        | A spec globbing `libs/web/members/**/*.{ts,html}` asserting **zero** occurrences of `innerHTML`, `bypassSecurityTrustHtml`, `from 'marked'`, `from 'dompurify'`, `from 'ngx-markdown'`. Every body renders via `<ptah-markdown-block>`. Lands in Phase 2 with the first rendered post (RK-2) |
| NFR-U2 — tokens only                                        | ESLint `no-restricted-syntax` on raw hex, `ink-*`, `amber-*`, Material-3 token names, and `border-base-300` (the `base-300`-as-border error `panel-theme-spec.md` §2 exists to prevent), scoped to `libs/web/members/**`                                                                     |
| R9.4 — no catch-all                                         | `members.routes.spec.ts` (§5.2)                                                                                                                                                                                                                                                              |
| R6.2 — one hub request                                      | Playwright network-count assertion on `/members` in `ptah-landing-page-e2e`                                                                                                                                                                                                                  |
| NFR-S3 — no YouTube script before play                      | Playwright network assertion: no `youtube.com` request until the poster is activated                                                                                                                                                                                                         |
| NFR-U5 — both themes clean                                  | Visual pass on every screen in `operator-member` and `operator-member-light`                                                                                                                                                                                                                 |

Search highlighting (R1.7.5) is a `HighlightTextPipe` returning a `{ text, match }[]` array the template renders as sibling `<span>`s — **text nodes only**, never injected into sanitized markdown output.

---

## 6. Discourse removal plan

### 6.1 Delete outright

**Backend** — `libs/api/community/src/lib/discourse/` in full (MG-2.1), 17 files:

```
admin-community.controller.ts            admin-community.controller.spec.ts
admin-community.service.ts               builders-membership.service.ts   ← logic relocated FIRST (MG-2.2)
community.controller.ts                  community.controller.spec.ts
discourse-admin.provider.ts              discourse-admin.provider.spec.ts
discourse-provisioning.service.ts        discourse-provisioning.service.spec.ts
discourse-sso.service.ts                 discourse-sso.service.spec.ts
discourse.controller.ts                  discourse.controller.spec.ts
discourse.module.ts                      discourse.types.ts
dto/admin-community.dto.ts
```

Routes removed with it: `GET /api/v1/sso/discourse`, `GET /api/v1/community/summary`, `GET /api/v1/admin/community/topics`, `GET /api/v1/admin/community/review-queue`.

**Theme app** (MG-3):

```
apps/ptah-discourse-theme/                     (about.json, common/header.html,
                                                locales/en.yml, project.json, README.md, …)
.github/workflows/deploy-community-theme.yml
```

**Frontend** — the old members surface (F-6):

```
libs/web/account/src/lib/members/members-page.component.ts   (+ .spec.ts)
libs/web/account/src/lib/members/components/builders-pitch.component.ts
libs/web/account/src/lib/members/components/community-topic-list.component.ts
libs/web/account/src/lib/members/components/session-card.component.ts
```

**Docs**: `docs/deploy/discourse-digitalocean.md`.

**Runtime** (MG-5, gated on MG-1 verification in production): the `discourse_dev` service block in `docker-compose.yml`.

### 6.2 Edit

| File                                                                                                           | Change                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/api/community/src/index.ts`                                                                              | remove lines 6-16 (11 discourse exports); add `live-sessions/*`, `member-packs*`, `session-requests*`                                                                        |
| `libs/api/community/README.md`                                                                                 | rewrite "Why these five directories are ONE lib" for the post-split reality                                                                                                  |
| `apps/ptah-license-server/src/app/app.module.ts`                                                               | remove the `DiscourseModule` import and registration (MG-2.3); add the seven new modules                                                                                     |
| `apps/ptah-license-server/src/testing/controller-registry.ts`                                                  | remove `AdminCommunityController`, `CommunityController`, `DiscourseController`; add 18 new controllers                                                                      |
| `apps/ptah-license-server/src/common/route-map.spec.ts`                                                        | update `EXPECTED_ROUTES`; delete the `@Redirect` quirk note at `:49-51` (it exists only for `discourse.controller.ts`)                                                       |
| `apps/ptah-license-server/src/common/controller-validation.spec.ts`                                            | census follows the registry                                                                                                                                                  |
| `apps/ptah-license-server/src/admin/admin-guards.spec.ts`                                                      | drop discourse controller cases                                                                                                                                              |
| `libs/api/audit/src/lib/audit-log.types.ts`                                                                    | remove `'discourse.group.sync'`; rewrite the `:33-36` comment; add the new actions + `Category`/`Topic`/`Post`/`Course`/`Lesson`/`LiveSession`/`SessionRequest` target types |
| `libs/api/billing/src/lib/paddle/paddle.service.ts` + `.spec.ts`                                               | remove the `DiscourseProvisioningService` fan-out call                                                                                                                       |
| `libs/api/community/src/lib/member-groups/member-groups.service.ts`                                            | drop `discourseGroup` from `MemberGroupWithCount`, `CreateMemberGroupInput`, `UpdateMemberGroupInput`, and `AssignManyResult`                                                |
| `.../member-groups/dto/member-group.dto.ts`, `.../member-groups.controller.ts`                                 | drop the field + the best-effort sync call                                                                                                                                   |
| `libs/api/community/src/lib/packs/packs.types.ts`                                                              | **rewrite the `:1-16` docblock** — remove "posted inside that cohort's Discourse group", describe the new `/members/packs` channel and A-1 (R5.6)                            |
| `libs/api/community/src/lib/packs/admin-packs.controller.ts`                                                   | same docblock treatment                                                                                                                                                      |
| `apps/ptah-license-server/prisma/schema.prisma`                                                                | drop `MemberGroup.discourseGroup` (`:61`); rewrite the `Pack` docblock (`:93-116`) and the `MemberGroup` docblock (`:44-55`)                                                 |
| `libs/api/licensing/.../license.controller.ts` + `.spec.ts`                                                    | remove discourse references                                                                                                                                                  |
| `libs/web/core/src/lib/services/members-api.service.ts`                                                        | delete `getCommunitySummary`, `communityTopicSchema`, `communitySummaryResponseSchema`; drop `communityUrl` from `membersSessionsResponseSchema`                             |
| `libs/web/core/src/lib/models/license-data.interface.ts`, `subscription-state.service.ts`                      | drop discourse fields                                                                                                                                                        |
| `libs/web/ui/src/lib/navigation.component.ts`                                                                  | repoint the community link to `/members/community` (MG-2.7)                                                                                                                  |
| `libs/web/auth/src/lib/auth-page.component.ts`                                                                 | remove the discourse return-url branch                                                                                                                                       |
| `libs/web/admin/src/lib/builders/community/{community-view.ts,.html,.spec.ts}`                                 | rebuild against native topics (Phase 2)                                                                                                                                      |
| `libs/web/admin/src/lib/services/admin-builders-api.service.ts`                                                | community methods repointed; packs gain `memberVisible`/`accessNote`                                                                                                         |
| `libs/web/admin/src/lib/groups/components/group-form-modal/{.ts,.html}`, `groups/groups-list/groups-list.html` | remove the `discourseGroup` field                                                                                                                                            |
| `libs/web/admin/src/lib/builders/packs/{packs-list.ts,.html}`, `components/pack-form-modal/*`                  | member-visible toggle + access-note field                                                                                                                                    |
| `apps/ptah-landing-page/src/app/app.routes.ts`                                                                 | `/members` → `MEMBER_ROUTES` behind `MemberGuard` with the markdown provider                                                                                                 |
| `apps/ptah-landing-page-e2e/src/specs/{members-content,members-gate}.spec.ts`                                  | rewritten against `/members`                                                                                                                                                 |
| `apps/ptah-landing-page-e2e/src/support/{auth,db,env,global-setup}.ts`, `playwright.config.ts`                 | drop discourse fixtures/env                                                                                                                                                  |
| `.env.example` (`:261-316`), `.env.prod.example` (`:60-79`), `.env`                                            | remove all eight `DISCOURSE_*` vars; add `YOUTUBE_API_KEY`                                                                                                                   |
| `package.json`                                                                                                 | remove the discourse-theme deploy scripts                                                                                                                                    |
| `tools/migration/manifest.json`                                                                                | drop the discourse entries                                                                                                                                                   |
| `CLAUDE.md` (root)                                                                                             | remove `ptah-discourse-theme` from the module index; add the six new libs (MG-3.2)                                                                                           |
| `docs/deploy/{e2e-test-handoff,founder-setup-checklist,local-testing-setup}.md`                                | remove discourse setup sections                                                                                                                                              |
| `docs/handoff-admin-builders-content-view.md`, `docs/handoff-license-server-validation-pipe.md`                | remove discourse references (NFR-M5's search is normative; historical accuracy is preserved in git)                                                                          |

### 6.3 Environment variables dropped

`DISCOURSE_URL`, `DISCOURSE_SSO_SECRET`, `DISCOURSE_API_KEY`, `DISCOURSE_API_USERNAME`, `DISCOURSE_BUILDERS_GROUP`, `DISCOURSE_THEME_API_KEY`, `DISCOURSE_THEME_API_USERNAME`, `DISCOURSE_THEME_ID`. Added: `YOUTUBE_API_KEY`.

### 6.4 Prisma fields removed

`MemberGroup.discourseGroup` → migration `20260805090000_drop_discourse_group`.

### 6.5 Verification (NFR-M5, MG-3.3)

```bash
rg -i discourse --glob '!node_modules' --glob '!.nx' --glob '!coverage' \
                --glob '!dist' --glob '!.ptah/specs' \
                --glob '!docs/community/discourse-export.json'
# expected: zero hits
nx graph   # no orphaned project, no broken dependency
```

### 6.6 MG-4 — Seshat harness (out of repo)

`D:/projects/seshat` is outside this repository and outside this task's test coverage. Deliverable: an inventory of its community skills, each **rewritten against the new API or deleted**, with an explicit changed/removed list produced by hand (MG-4.3). Sequenced in Phase 5 so the API surface it targets is final. Any rewritten skill contains no Discourse endpoint, admin-API call, or SSO reference.

---

## 7. Content migration design (MG-1)

### 7.1 What the export actually contains (verified)

Re-verified against `a22b03eb6`.

| Fact               | Value                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Top-level keys     | `exportedFrom`, `note`, `categories`, `topics`                                                                   |
| Categories         | 4 — `4:General(open)`, `5:Builders Lounge(read_restricted)`, `2:Site Feedback(open)`, `3:Staff(read_restricted)` |
| Topics             | 17 ✓, sorted by `id`: 4, 5, 6, 8, 9, 10, 13, 14, 15…22, 23                                                       |
| Posts              | 19 ✓ (15 topics × 1 post, 2 topics × 2 posts — ids **4 and 13**)                                                 |
| `raw` populated    | **19 of 19. Zero nulls.** 12,474 chars of markdown                                                               |
| `cooked`           | 18,690 chars — **reference only; the importer never reads it** (AD-8)                                            |
| Encoding           | valid UTF-8, em-dashes intact, 0 × U+FFFD                                                                        |
| Distinct usernames | **one: `system`**                                                                                                |
| Pinned             | topics 5 and 13                                                                                                  |
| Week topics        | ids 15…22 → Weeks 1…8, **all in category 5 (Builders Lounge)**                                                   |

**Correction to MG-1.6, recorded not silently applied**: MG-1.6 places "Start here" and "Questions" in _General_. The export has both (ids 13, 14) in **Builders Lounge** (category 5), and General holds two different topics (ids 5, 23). The 9-topic total is unaffected. The importer maps **by source `categoryId`**, which yields the correct placement and satisfies MG-1.4's mapping table without hard-coding the misremembered breakdown.

**Observation, no action taken**: topics 5 ("Welcome to Discourse!"), 4 ("Guidelines") and 6 ("Admin Guide: Getting Started") are Discourse's own seed content, not Ptah's. MG-1.6 asserts all 17 are imported, so all 17 are imported; the admin can soft-delete the three after verification in one action each (R8.2).

### 7.2 One artefact (AD-8)

`apps/ptah-license-server/prisma/seed/community-seed.ts`, invoked by a new Nx target:

```jsonc
// apps/ptah-license-server/project.json
"seed-community": {
  "executor": "nx:run-commands",
  "options": { "command": "npx tsx apps/ptah-license-server/prisma/seed/community-seed.ts" }
}
```

A target, **not a migration**: MG-1.3 requires re-runnability and a Prisma migration runs once.

- Reads **only** `docs/community/discourse-export.json` — never the `discourse_dev` container or a live instance (MG-1.1).
- Reads **only** each post's `raw` field. `cooked` is not destructured, not referenced, not logged. It has no HTML code path at all (MG-1.9, NFR-S10, AD-8).
- Zod-validates the whole file before a single write; a malformed file aborts with a clear error and writes nothing (MG-1.2).

```ts
// The schema is the content-integrity check. Because `raw` is now the source
// of truth, every property that used to depend on a human reviewing an
// HTML→markdown conversion is instead asserted here, mechanically.
const exportPostSchema = z.object({
  postNumber: z.number().int().positive(),
  username: z.string().min(1),
  createdAt: z.string().datetime(),
  /** MG-1.9. `.min(1)` is what makes the /t/{id}.json regression — which
   *  produced `raw: null` on all 19 posts — a loud abort rather than 19 empty
   *  bodies silently written to the database. */
  raw: z
    .string()
    .min(1)
    // No U+FFFD: a mojibake'd em-dash would otherwise be imported verbatim
    // and survive review, because the body still "looks like markdown".
    .refine((s) => !s.includes('�'), 'raw contains a U+FFFD replacement character'),
  /** Present in the export, deliberately typed as `unknown` and never read.
   *  Typing it `string` would invite `post.cooked` at a call site; `unknown`
   *  makes any use a compile error. */
  cooked: z.unknown(),
});

const exportTopicSchema = z.object({
  id: z.number().int(),
  title: z.string().min(1),
  slug: z.string().min(1),
  categoryId: z.number().int(),
  categoryName: z.string(),
  pinned: z.boolean(),
  createdAt: z.string().datetime(),
  posts: z.array(exportPostSchema).min(1),
});

export const discourseExportSchema = z
  .object({
    exportedFrom: z.string(),
    /** Why the per-post fetch is necessary. Kept so the shortcut is not
     *  reintroduced; validated as present so it cannot be dropped silently. */
    note: z.string().min(1),
    categories: z
      .array(
        z.object({
          id: z.number().int(),
          name: z.string(),
          slug: z.string(),
          description: z.string().nullable(),
          color: z.string(),
          read_restricted: z.boolean(),
          topic_count: z.number().int(),
        }),
      )
      .length(4),
    topics: z.array(exportTopicSchema).length(17),
  })
  // MG-1.6's 19-post total, asserted before any write rather than counted after one.
  .refine((d) => d.topics.reduce((n, t) => n + t.posts.length, 0) === 19, 'export must contain exactly 19 posts');
```

`.length(4)` / `.length(17)` / the 19-post refinement move MG-1.6's assertions to the earliest possible point. `cooked: z.unknown()` is the type-level half of AD-8's quarantine; §7.5's grep assertion is the other half.

### 7.3 Mapping

**Categories (MG-1.4)** — upsert on `slug`:

| Source            | Native slug       | `visibility` | `cohortKeys`                  | `sortOrder` |
| ----------------- | ----------------- | ------------ | ----------------------------- | ----------- |
| 4 General         | `general`         | `member`     | `[]`                          | 10          |
| 5 Builders Lounge | `builders-lounge` | `cohort`     | `[<default MemberGroup.key>]` | 20          |
| 2 Site Feedback   | `site-feedback`   | `member`     | `[]`                          | 30          |
| 3 Staff           | `staff`           | `staff`      | `[]`                          | 40          |

The cohort key resolves from `MemberGroup where isDefault: true`. If none exists the seed **aborts with an actionable message** rather than seeding an ungated cohort category.

`Category.description` is the one field the source carries as HTML (`"<p>Create topics here that don't fit…</p>"`) — Discourse has no `raw` counterpart for it. Four rows, one sentence each, so the seed strips tags with a fixed regex and stores **plain text**. `Category.description` is typed and rendered as plain text everywhere in this task; it never reaches `libs/frontend/markdown` and never reaches `[innerHTML]`. That keeps the "no HTML in the pipeline" property total rather than nearly-total.

**The 8 Week topics → a course (MG-1.5)** — upsert on `Course.slug`:

```
Course  slug=ptah-builders-cohort-1  title="Ptah Builders — Cohort 1"
        visibility=cohort  cohortKeys=[<default key>]  published=true  sequential=false

CourseModule (8)   slug=week-1 … week-8      sortOrder = 100, 200, … 800
  Lesson (1 each)  slug = the module slug    sortOrder = 100
                   title = source topic title (the "Week N build thread — …" prefix retained
                           so the curriculum reads as it was authored)
                   bodyMarkdown = the topic's post #1 `raw`, copied verbatim — no transform,
                           no re-wrap, no entity decoding. The one Week-N body is already
                           `**bold**` + prose + a `- ` bullet list; it renders correctly
                           through `libs/frontend/markdown` as-is.
                   youtubeVideoId = null  ⇒  manual completion only (R2.3.4)
```

Module titles are the descriptive halves MG-1.5 enumerates: Foundation — workspace, boundaries, CI · The domain — modelling and migrations · Authentication and tenancy · Billing and entitlements · The first vertical slice · Agents, memory and skills · Hardening · Deploy and launch.

`sequential: false` — the source has no completion gate and MG-1.5 asks to preserve _ordering_, not to invent gating. **One module per week, not one module of eight lessons**: R2.4.1's date-based unlock operates on modules, so per-week modules are what makes weekly release expressible later without a restructure.

**The remaining 9 topics (MG-1.6)** — ids 5, 23 (General), 13, 14 (Builders Lounge), 8, 9, 10 (Site Feedback), 4, 6 (Staff). Upsert on `Topic.slug`; `pinned` carried (5, 13); posts upserted on `(topicId, postNumber)` with `bodyMarkdown = raw` and the source `createdAt` written explicitly (MG-1.7). The two multi-post topics (ids 4 and 13) import both posts, post #1 becoming the opening body per AD-9 and post #2 a top-level reply (`parentId: null`, `postNumber: 2`). `Topic.postCount` and `lastPostedAt` are computed from the imported posts in the same transaction (AD-11).

**Authorship (MG-1.8 / A-4)** — every post's `username` is `system`, which matches no `User`. So `authorId = null` on all 19, rendered as the "Ptah Team" system author. **No `User` row is fabricated** — A-4's reasoning is that placeholder users would pollute the one table entitlement derives from (A-2). The summary reports `unmatchedUsernames: ['system'] (19 posts)`.

### 7.4 Idempotency and re-runnability (MG-1.3, AD-15)

Every write is `prisma.upsert` on a natural unique — `Category.slug`, `Topic.slug`, `Post @@unique([topicId, postNumber])`, `Course.slug`, `CourseModule @@unique([courseId, slug])`, `Lesson @@unique([moduleId, slug])`. The whole import runs in **one `$transaction`**: a mid-run failure leaves the database untouched.

A second run produces zero creates and reports `updated` counts. `update` payloads **exclude `bodyMarkdown` by default when the row already exists** — a re-run must not clobber a member's or admin's subsequent edit. That exclusion is what makes the seed safe to run against production twice.

**One change the `raw` fix earns**: an explicit `--refresh-bodies` flag, default off. Under the earlier HTML-only reading, re-importing a body meant re-running a lossy conversion, so overwriting was never safe at any time and the exclusion was unconditional. With `raw` as a lossless source of truth, "re-import the authored markdown, discarding in-product edits" becomes a coherent, occasionally correct operation — for instance if the export is corrected again, as it just was. It stays **opt-in and logged per row**, because the default must be the safe one and an operator should have to type the destructive intent rather than inherit it.

`Category.slug`, `Topic.slug` and the post/module/lesson composites are all stable in the source, so re-running against the corrected export updates rows in place rather than orphaning the first import's rows — which is the practical reason the natural-key choice (AD-15) survived the export fix unchanged.

### 7.5 Summary output (MG-1.10)

```
Community seed complete
  categories:  created 4  updated 0
  topics:      created 9  updated 0
  posts:       created 11 updated 0
  courses:     created 1  updated 0
  modules:     created 8  updated 0
  lessons:     created 8  updated 0
  unmatched usernames: system (19 posts) → attributed to the system author (A-4)
  bodies: 19/19 imported from `raw`; 0 from `cooked`; 0 transformed
  assertions: source topics 17 = 8 curriculum + 9 topics ✓ ; source posts 19 = 11 + 8 ✓
```

(9 non-curriculum topics carry 11 posts — topics 4 and 13 have two each; the 8 curriculum topics contribute 8 lesson bodies. 11 + 8 = 19 ✓.)

### 7.6 Migration tests (MG-1, RK-9)

`community-seed.spec.ts`:

- the count assertions (4 categories, 17 topics, 19 posts, 8 lessons + 9 topics);
- a malformed file aborts and writes nothing;
- **a fixture with `raw: null` on one post aborts** — the regression that produced the original defect must fail loudly rather than write an empty body;
- **a fixture containing U+FFFD in `raw` aborts** — mojibake that still "looks like markdown" must not pass;
- a second run produces zero creates;
- a run without `--refresh-bodies` does not overwrite an edited body; a run with it does, and logs each overwrite;
- **the string `cooked` appears nowhere in the seed module** — AD-8's quarantine, enforced as a source-text assertion (NFR-S10);
- an imported body round-trips through `libs/frontend/markdown`'s `'member'` preset without content loss;
- no `User` row is created (A-4).

---

## 8. Build order and dependency graph

### 8.1 What genuinely blocks what

```
                    ┌──────────────────────────────────────┐
                    │ P1a  libs/api/membership (R7)         │  ← blocks EVERYTHING
                    │      MembershipService + MemberGuard   │     (RK-3, RK-4)
                    └───────────────┬──────────────────────┘
                                    │  tests green
                    ┌───────────────▼──────────────────────┐
                    │ P1b  Delete discourse/ + theme app    │
                    │      + migration 1 (MG-2, MG-3)       │
                    └───────────────┬──────────────────────┘
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐   ┌──────────────────────────┐   ┌────────────────────────┐
│ P1c contracts │   │ P1d member-hub (skeleton) │   │ P1e libs/web/members    │
│ lib (leaf)    │──▶│      GET /members/hub      │◀──│  shell + nav + guard    │
└───────────────┘   └───────────┬──────────────┘   │  + markdown 'member'    │
                                │                   └────────────┬───────────┘
                                │ ◄─── R6.6: every later phase ──┘
                                │      EXTENDS this response
        ┌───────────────────────┼───────────────────────┬───────────────────┐
        ▼                       ▼                       ▼                   ▼
┌───────────────┐   ┌────────────────────┐   ┌──────────────────┐  ┌──────────────┐
│ P2 forum      │   │ P3 learning        │   │ P4 live+private  │  │ P5 packs +   │
│  + migration 2│   │  + youtube lib     │   │  + migration 4   │  │  notifications│
│  + MG-1 (9    │   │  + migration 3     │   │  (OQ-1 columns)  │  │  + migration 5│
│    topics)    │   │  + MG-1 (course)   │   │                  │  │  + MG-4       │
│  + NFR-S2 test│   │                    │   │                  │  │              │
│  + MG-5       │   │                    │   │                  │  │              │
└───────────────┘   └────────────────────┘   └──────────────────┘  └──────────────┘
     P2 → P3? NO      P3 → P4? NO              P4 → P5? NO           needs P2 (forum
     independent      independent (youtube      independent           notification
                      lib is P3-owned)                                producers)
```

**Real blockers, and only these:**

| Blocks                   | Blocked                                             | Why                                                                                     |
| ------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| P1a `membership`         | every member controller in P2–P5                    | R7 is a stated prerequisite; RK-3 says no member controller merges before consolidation |
| P1a `membership`         | P1b discourse deletion                              | MG-2.2 / RK-4: relocate and test first, delete second                                   |
| P1c contracts lib        | every backend member surface and `libs/web/members` | both sides import the wire types                                                        |
| P1d hub skeleton         | P2/P3/P4/P5 hub extensions                          | R6.6 — later phases extend, they do not re-invent                                       |
| P1e shell + routes       | every member screen                                 | screens mount inside `MemberLayout`                                                     |
| AD-1 markdown preset     | first rendered post (P2)                            | RK-2: the NFR-S2 test lands in the same phase as the first rendered content             |
| P2 `forum`               | P5 notifications _producers_                        | `topic.reply` / `post.accepted` notifications need topics and posts to exist            |
| P2 MG-1 verified in prod | MG-5 decommission                                   | MG-5.3: never before                                                                    |
| P3 `youtube` lib         | P4 live-session metadata                            | R3.2 reuses R2.2's provider verbatim                                                    |
| migration N              | migration N+1                                       | forward-only, sequential                                                                |

**Explicitly NOT blockers** (so they can run in parallel if capacity allows):

- P2 ↮ P3. `forum` and `learning` share no model, no service and no route prefix. Their only meeting point is the hub composer, which takes one new file each.
- P3 ↮ P4 beyond the `youtube` lib, which P3 delivers first because R2.2 specifies it in more detail than R3.2.
- Frontend ↮ backend within a phase — §7 of the requirements says the frontend builds against stubbed endpoints, and the contracts lib is what makes the stub type-accurate.

### 8.2 Per-phase exit gates

| Phase  | Gate                                                                                                                                                                                                                                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | `rg 'isBuildersMember'` → one implementation. `rg -i discourse` (excluding the export) → zero hits. `/members` renders with `PanelLayout` in both themes. Hub responds in **one** request (asserted). `members.routes.spec.ts` green. `nx lint`, `typecheck`, `test`, `nx graph` clean.                           |
| **P2** | A member creates a topic, replies one level, reacts, sees accurate unread counts. A depth-3 reply attempt attaches at depth 2 (server-side). Migrated topics render with original timestamps. The NFR-S2 no-second-renderer test is green. MG-5 executed after production verification.                           |
| **P3** | The 8 week threads render as an ordered course. Completion derives from persisted duration. A locked module returns **403 from the API**, not a CSS state. With `YOUTUBE_API_KEY` unset nothing `500`s and an admin can save manual metadata. No YouTube request fires on a member lesson read.                   |
| **P4** | An accepted request produces a Calendar event whose Meet link is persisted and whose id reconciles on reschedule and cancel. With `GOOGLE_OAUTH_*` unset: members submit, admins see, accept returns `503 { reason: 'scheduling_unavailable' }`, nothing `500`s. The Live surface renders with Calendar disabled. |
| **P5** | Members reach every pack repo link without Discourse. `MemberPack` serialization test asserts `notes` absent. Unread count accurate on the nav `badgeCount`. Retention prune verified. Seshat changed/removed list delivered. Full NFR-P / NFR-U / axe pass; e2e for every member surface.                        |

---

## 9. Risk mitigations mapped to structure

| Risk                                               | Structural mitigation in this plan                                                                                                                                                                                                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RK-1 scope inflation                               | §5 of the requirements is normative here: every rejected mechanism is named in an AD with its reason (denormalised counters, reconciliation jobs, `tsvector`, external search, quota infrastructure, websockets, `sourceRef` columns, join tables for cohort keys, `@@index([lessonId])`) |
| RK-2 second markdown path                          | AD-1 shows the chokepoint is _already_ reachable and already wired; the preset is added **inside** that lib; the enforcing test lands with the first rendered post                                                                                                                        |
| RK-3 membership drift                              | `libs/api/membership` is P1a and blocks every controller; `MemberGuard` resolves the context so no service re-derives it                                                                                                                                                                  |
| RK-4 deletion removes surviving logic              | The logic moves to a **different Nx project** before `discourse/` is deleted — survival is structural, not procedural                                                                                                                                                                     |
| RK-5 packs regression                              | R5 ships in P5; MG-5 (decommission) is gated on MG-1 verification in P2, and the pack `accessNote` field carries the access story into the product                                                                                                                                        |
| RK-6 YouTube quota / key                           | Authoring-time fetch only; key read once via `ConfigService`, never serialized; feature-off posture; `refresh-metadata` is manual                                                                                                                                                         |
| RK-7 design drift                                  | `panel-theme-spec.md` is authoritative; NFR-U2 lint rule scoped to `libs/web/members/**`, including the `border-base-300` prohibition                                                                                                                                                     |
| RK-8 admin field leakage                           | `libs/api-contracts/community` forbids `admin/*` extending `member/*`; a structural test asserts it; `MemberPack`, `MemberSessionRequest` and `LiveFeedItem` are all standalone declarations                                                                                              |
| RK-9 migration against live container / double-run | Seed reads only the committed export, and only its `raw` field (`cooked` typed `unknown`); one `$transaction`; natural-key upserts; bodies not overwritten without `--refresh-bodies`; count, `raw`-non-null and U+FFFD assertions in the Zod schema                                      |
| RK-10 concurrent-agent interference                | Each phase is one migration + one lib set; `TASK_2026_176`'s folder is never written to; no `--no-verify`                                                                                                                                                                                 |
| RK-11 catch-all route                              | `members.routes.spec.ts` param allowlist                                                                                                                                                                                                                                                  |
| RK-12 nesting cap in UI only                       | AD-9 makes depth 3 unrepresentable by construction; the write path repairs a bad `parentId` server-side; the thread renderer indents on `parentId != null` only, so pre-existing data is safe                                                                                             |
| RK-13 validation seam                              | AD-7: the branch already landed and standardised on `dtoPipe`; A-3 is confirmed, not partially applied                                                                                                                                                                                    |

---

## 10. Team-leader handoff

**Recommended developers**: `backend-developer` and `frontend-developer`, both needed in every phase. Backend leads P1a–P1d, P2–P5 API. Frontend leads P1e and every screen. The contracts lib is the seam that lets them run concurrently within a phase.

**Complexity**: XL, phased. Rough shape — P1 ≈ 20–26 h, P2 ≈ 34–44 h, P3 ≈ 30–38 h, P4 ≈ 20–26 h, P5 ≈ 22–28 h.

**Verification points a developer must confirm before writing code in each area:**

1. `dtoPipe(Dto)` on **every** `@Body()`/`@Query()` — `libs/api/core/src/lib/common/dto-validation.pipe.ts`.
2. New controllers added to `apps/ptah-license-server/src/testing/controller-registry.ts` **in the same commit**.
3. `@ptah-web/panel-ui` exports exactly the nine symbols at `libs/web/panel-ui/src/index.ts` — anything else must be added there first.
4. `provideMarkdownRendering` presets live at `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts` — the `'member'` preset is added there, never re-implemented.
5. `GoogleCalendarProvider` / `GoogleAuthProvider` already exist and already resolve the Meet link — no Meet API is called (`google-sessions.types.ts:121-128`, `:169-189`).
6. `AuditLogService.write` accepts a `tx` (`audit-log.types.ts` `WriteAuditLogParams.tx`) — admin mutations enlist their audit row.

**Files affected — summary**

- **CREATE**: 8 new Nx projects (`libs/api/{membership,youtube,forum,learning,notifications,member-hub}`, `libs/api-contracts/community`, `libs/web/members`), 5 Prisma migrations, `apps/ptah-license-server/prisma/seed/community-seed.ts` + its spec, 5 new `panel-ui` primitives.
- **MODIFY**: `schema.prisma`, `app.module.ts`, `controller-registry.ts`, `route-map.spec.ts`, `controller-validation.spec.ts`, `audit-log.types.ts`, `paddle.service.ts`, `member-groups.*`, `packs.*`, `members.controller.ts`, `libs/frontend/markdown/*`, `libs/web/{core,ui,auth,admin}/*`, `app.routes.ts`, `tsconfig.base.json`, `.env*.example`, `CLAUDE.md`, e2e specs and support.
- **DELETE**: `libs/api/community/src/lib/discourse/` (17 files), `apps/ptah-discourse-theme/`, `.github/workflows/deploy-community-theme.yml`, `libs/web/account/src/lib/members/` (4 files), `docs/deploy/discourse-digitalocean.md`, the `discourse_dev` compose service.

---

## Evidence Ledger

Every file read during this pass. No read was denied at the permission layer; A-9's gap is closed.

| Area                     | Files                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Task                     | `.ptah/specs/TASK_2026_177/{context,task-description}.md`                                                                                                                                                                                                                                                                                                                                                          |
| Schema                   | `apps/ptah-license-server/prisma/schema.prisma`; `prisma/migrations/` (15 existing, naming convention)                                                                                                                                                                                                                                                                                                             |
| Community lib            | `src/index.ts`; `packs/{packs.types.ts,packs.service.ts}`; `google-sessions/{google-sessions.types.ts,sessions.service.ts,google-auth.provider.ts,members.controller.ts}`; `member-groups/member-groups.service.ts`; `discourse/{builders-membership.service.ts,discourse.module.ts}` + route enumeration across `discourse/*.ts`; `README.md`                                                                     |
| Server                   | `app/app.module.ts`; `common/route-map.spec.ts`; `testing/controller-registry.ts`; `CLAUDE.md`                                                                                                                                                                                                                                                                                                                     |
| Core / audit / marketing | `core/src/lib/common/dto-validation.pipe.ts`; `audit/src/lib/audit-log.types.ts`; `marketing/src/lib/session/{session.service.ts,session.controller.ts}`                                                                                                                                                                                                                                                           |
| Web                      | `panel-ui/src/index.ts`, `src/lib/panel-nav.types.ts`, `src/lib/panel-layout/panel-layout.ts`, `project.json`; `admin/src/lib/{admin.routes.ts,admin-layout/admin-layout.ts,admin-layout/admin-nav.config.ts,services/admin-builders-api.service.ts}`, `project.json`; `core/src/index.ts`, `guards/{auth,admin-auth}.guard.ts`, `services/members-api.service.ts`; `account/src/index.ts` + `lib/members/` census |
| Markdown                 | `libs/frontend/markdown/{project.json,src/index.ts,src/lib/provide-markdown-rendering.ts,src/lib/markdown-block.component.ts}`; `node_modules/ngx-markdown/fesm2022/ngx-markdown.mjs:107,162,185,418-423,711-722`                                                                                                                                                                                                  |
| Landing app              | `src/app/{app.routes.ts,app.config.ts}`; `tailwind.config.js` (`operator-member`, `operator-member-light`)                                                                                                                                                                                                                                                                                                         |
| Boundaries               | `eslint.config.mjs` (`@nx/enforce-module-boundaries`, all `depConstraints`); `tsconfig.base.json:136,164-183`; `project.json` tag census across `libs/{api,web}/*`                                                                                                                                                                                                                                                 |
| Design                   | `docs/design-system/panel-theme-spec.md`; `docs/design-system/stitch_ptah_builders_member_home/` (8 screens + 3 reference sets)                                                                                                                                                                                                                                                                                    |
| Migration data           | `docs/community/discourse-export.json` @ `a22b03eb6` — full enumeration of 4 categories, 17 topics, 19 posts; `raw` populated 19/19 (12,474 chars), `cooked` 18,690 chars, 0 × U+FFFD, single author `system`, multi-post topics 4 and 13, `note` field present. Re-verified after the coordinator's per-post `/posts/{id}.json` fix superseded the earlier `raw: null` finding.                                   |
| Removal census           | repo-wide `discourse` grep across `*.{ts,json,md,yml,yaml,example,html,css}` excluding `node_modules`, `.nx`, `coverage`, `dist`, `.ptah/specs`; `.env.example:261-316`; `.env.prod.example:60-79`                                                                                                                                                                                                                 |
