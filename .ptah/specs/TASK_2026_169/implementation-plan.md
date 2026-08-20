# Implementation Plan — TASK_2026_169

**Admin-dashboard management of Builders member content (packs / sessions / cohorts / community)**

**Architect:** software-architect
**Date:** 2026-08-01
**Branch:** `ak/elevate-video-and-tasks`
**Scope source:** `.ptah/specs/TASK_2026_169/context.md` (Checkpoint 0 decisions are FINAL)

---

## 0. Verdict

**Extend each existing feature module with a co-located admin controller. Do NOT build a monolithic `admin-builders` module.** Add exactly one new feature module (`packs`) carrying both an admin CRUD controller and a member-gated read controller. This mirrors the already-shipped `MemberGroupsController` precedent exactly, keeps the module graph acyclic, and — critically — places each new admin controller in the _same directory_ as the member-facing controller it parallels, so a reviewer verifying "the member gate is untouched" sees both gates in a single diff.

Total new backend surface: **12 endpoints**, 1 Prisma model (admin-only registry), 1 migration, 4 provider method additions.
Total new frontend surface: **3 lazy routes**, 1 nav group, 1 API service, 6 components.

Three Checkpoint-1 decisions are folded in (see §11):

1. **Discourse write moderation is dropped entirely** — the admin community view is a read-only triage surface that deep-links into Discourse's own admin panel for any action.
2. ~~Packs are cohort-scoped~~ — **SUPERSEDED by Decision 3.**
3. **Packs are an admin-only registry with no member-facing surface at all.** Distribution happens on GitHub (collaborator invites, or the repo link posted inside that cohort's Discourse group). Ptah never serves pack content and never gates pack access; the `Pack` table is the admin's bookkeeping record of which repo belongs to which cohort.

**Consequence worth stating up front:** packs now touch _no_ member-facing code path whatsoever. The feature's entire footprint is behind `AdminGuard`, which makes the §7.1 invariant proof strictly stronger than in either earlier revision.
**Initial bundle impact: zero** (every new route is `loadComponent`-lazy under the already-lazy `/admin` subtree).

---

## 1. Codebase Investigation Summary

### 1.1 Libraries / modules examined

| Module                      | Path                                                                         | What it gave us                                                                                |
| --------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Admin authz                 | `apps/ptah-license-server/src/admin/admin.guard.ts`                          | `AdminGuard`, fail-closed `ADMIN_EMAILS` allowlist                                             |
| Admin throttle              | `apps/ptah-license-server/src/admin/admin-throttler.guard.ts`                | Per-admin-email rate bucket (extends `ThrottlerGuard`, tracker = `req.user.email`)             |
| Generic admin CRUD          | `apps/ptah-license-server/src/admin/admin.controller.ts`                     | `@Controller('v1/admin')` + `:model`/`:model/:id` wildcards, literal-route-first ordering rule |
| Model allowlist             | `apps/ptah-license-server/src/admin/admin-models.config.ts`                  | `ADMIN_MODELS` — the sort/search/edit field allowlist between HTTP and Prisma                  |
| **Feature-admin precedent** | `apps/ptah-license-server/src/member-groups/member-groups.controller.ts`     | **THE pattern to copy** — see §1.2                                                             |
| Member gate                 | `apps/ptah-license-server/src/discourse/builders-membership.service.ts`      | `isBuildersMember(userId)` — single source of truth, MUST NOT CHANGE                           |
| Gated member endpoints      | `google-sessions/members.controller.ts`, `discourse/community.controller.ts` | The two endpoints under invariant protection                                                   |
| Calendar client             | `apps/ptah-license-server/src/google-sessions/google-calendar.provider.ts`   | `request()` typed `'GET' \| 'PATCH'` — must widen                                              |
| OAuth minter                | `apps/ptah-license-server/src/google-sessions/google-auth.provider.ts`       | Refresh-token grant; response `scope` field currently discarded                                |
| Discourse client            | `apps/ptah-license-server/src/discourse/discourse-admin.provider.ts`         | `request()` typed `'GET' \| 'PUT' \| 'DELETE'`; non-throwing result objects                    |
| Audit                       | `apps/ptah-license-server/src/audit/audit-log.types.ts`                      | `AdminAuditAction` / `AdminAuditTargetType` string unions — extend, no migration needed        |
| Frontend admin client       | `apps/ptah-landing-page/src/app/services/admin-api.service.ts`               | Zod-at-the-boundary + `validate()` helper                                                      |
| Frontend CRUD precedent     | `apps/ptah-landing-page/src/app/pages/admin/groups/**`                       | Signals + modal-per-mutation + `fetch()` refresh                                               |
| Shared admin components     | `apps/ptah-landing-page/src/app/pages/admin/components/**`                   | `DataTable`, `StatusBadge`, `EmptyState`, `StatTile`, `DetailDrawer`, `SelectionToolbar`       |

### 1.2 The load-bearing precedent — `MemberGroupsModule`

`apps/ptah-license-server/src/member-groups/member-groups.controller.ts:56-57`:

```ts
@Controller('v1/admin/groups')
@UseGuards(JwtAuthGuard, AdminGuard)
export class MemberGroupsController {
```

…and `member-groups.module.ts:24-31`:

```ts
@Global()
@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [MemberGroupsController],
  providers: [MemberGroupsService, AdminGuard, AdminThrottlerGuard],
  exports: [MemberGroupsService],
})
export class MemberGroupsModule {}
```

Its own docblock (lines 18-21) states the rationale verbatim: _"Guard providers (`AdminGuard`, `AdminThrottlerGuard`) are declared locally (rather than importing `AdminModule`) to keep the module graph acyclic — both are stateless and only depend on `ConfigService` / the global ThrottlerModule providers."_

This is decisive: **admin controllers for a domain live in that domain's module**, not in `AdminModule`.

### 1.3 Gaps discovered during investigation

1. **`MemberGroupsService` has no "list members of a group" method.** Verified: the service exposes `listWithCounts`, `getDefaultGroup`, `getGroupsForUser`, `create`, `update`, `assignMany`, `unassign` — no member listing. The frontend already flags this in a docblock at `groups-list.ts:25-28`: _"No group-members drill-down: the backend only exposes `DELETE /groups/:id/members/:userId` (remove-by-id), not a 'list members of group X' endpoint, so there is nothing to browse to pick a user to unassign from. Flagged for the server owner."_ → this plan closes that gap (§3.4).

2. **`MembersController` carries its own inline duplicate of the Builders check** (`members.controller.ts:103-126`) rather than injecting `BuildersMembershipService`. **Do NOT refactor it.** DRY-ing it is a tempting cleanup that would touch the exact file under invariant protection for zero functional gain.

3. **`google-auth.provider.ts:103-106` discards the `scope` field** from the token response. That field is the cheapest possible scope verification and is currently thrown away (§4.2).

4. **Module import order in `app.module.ts` is load-bearing** (§7.2) — this is a correctness landmine, not just a style point.

---

## 2. Module / Route Topology

### 2.1 Decision + justification

**Chosen: per-domain admin controllers, co-located in existing feature modules, plus one new `PacksModule`.**

| Option                                                                                  | Verdict       |
| --------------------------------------------------------------------------------------- | ------------- |
| **A. One new `admin-builders` module** with a fat controller importing all four domains | ❌ Rejected   |
| **B. Per-domain admin controller in each feature module** (+ new `PacksModule`)         | ✅ **Chosen** |

**Why B:**

1. **Established precedent.** `MemberGroupsController` already does exactly this (`member-groups.controller.ts:56`). Adding a second, contradictory convention for the same problem is architectural drift.
2. **Acyclic module graph.** `AdminModule` already needs `forwardRef(() => LicenseModule)` (`admin.module.ts:30`) — a sign it is at its coupling limit. A new module importing `GoogleSessionsModule` + `DiscourseModule` + `MemberGroupsModule` + `PacksModule` compounds that. (All four are `@Global()`, so injection would technically work without imports, but that makes the dependency invisible rather than absent.)
3. **Security reviewability — the strongest argument.** Placing `admin-sessions.controller.ts` next to `members.controller.ts` in `src/google-sessions/`, and `admin-community.controller.ts` next to `community.controller.ts` in `src/discourse/`, means the reviewer verifying the invariant opens ONE directory and sees the member gate and the admin gate side by side. A separate `admin-builders/` folder would hide that relationship.
4. **One concern per module** (root `CLAUDE.md` → Coding Standards → SOLID).

**Cost accepted:** "where are all the admin endpoints?" is less obvious. Mitigated by (a) a docblock in each new controller pointing at the sibling member controller, and (b) `admin-nav.config.ts` being the single frontend index of the admin surface.

### 2.2 File topology

```
apps/ptah-license-server/src/
├── packs/                                  ← NEW MODULE — 100% behind AdminGuard
│   ├── packs.module.ts
│   ├── packs.service.ts                    (admin registry only — NO member read path)
│   ├── packs.types.ts
│   ├── admin-packs.controller.ts           @Controller('v1/admin/packs')   JwtAuthGuard + AdminGuard
│   ├── dto/pack.dto.ts
│   ├── packs.service.spec.ts               ← NEW
│   └── admin-packs.controller.spec.ts      ← NEW
│   ⛔ NO member-facing controller. Distribution happens on GitHub (Decision 3).
│
├── google-sessions/
│   ├── members.controller.ts               ← ⛔ UNTOUCHED (invariant)
│   ├── admin-sessions.controller.ts        ← NEW  @Controller('v1/admin/sessions')
│   ├── admin-sessions.service.ts           ← NEW  (write path; keeps SessionsService read path clean)
│   ├── dto/admin-session.dto.ts            ← NEW
│   ├── google-calendar.provider.ts         ← MODIFY (widen verbs + create/patch/delete)
│   ├── google-auth.provider.ts             ← MODIFY (surface granted `scope`)
│   ├── google-sessions.types.ts            ← MODIFY (add write-path types)
│   ├── google-sessions.module.ts           ← MODIFY (register controller + service + guards)
│   ├── google-calendar.provider.spec.ts    ← NEW
│   └── admin-sessions.controller.spec.ts   ← NEW
│
├── discourse/
│   ├── community.controller.ts             ← ⛔ UNTOUCHED (invariant)
│   ├── builders-membership.service.ts      ← ⛔ UNTOUCHED (invariant)
│   ├── admin-community.controller.ts       ← NEW  @Controller('v1/admin/community')  READ-ONLY
│   ├── admin-community.service.ts          ← NEW
│   ├── dto/admin-community.dto.ts          ← NEW  (query DTOs only — no write DTO)
│   ├── discourse-admin.provider.ts         ← MODIFY (add review-queue GET only — NO verb widening)
│   ├── discourse.types.ts                  ← MODIFY (review-queue result types)
│   ├── discourse.module.ts                 ← MODIFY (register controller + service + guards)
│   └── admin-community.controller.spec.ts  ← NEW
│
├── member-groups/
│   ├── member-groups.controller.ts         ← MODIFY (add GET /:id/members)
│   └── member-groups.service.ts            ← MODIFY (add listMembers)
│
├── audit/audit-log.types.ts                ← MODIFY (extend action/target unions)
└── app/app.module.ts                       ← MODIFY (import PacksModule BEFORE AdminModule — see §7.2)

apps/ptah-license-server/prisma/
├── schema.prisma                                        ← MODIFY (add Pack model)
└── migrations/20260801120000_add_packs/migration.sql    ← NEW
```

### 2.3 Endpoint table

**Prefix for every row: `/api/v1`** (global prefix `api` set in `main.ts` + controller prefix).

Guard legend:

- **A** = `@UseGuards(JwtAuthGuard, AdminGuard)` at CLASS level
- **A+T** = A, plus route-level `@UseGuards(AdminThrottlerGuard)` + `@Throttle`
- **M** = `@UseGuards(JwtAuthGuard)` + `BuildersMembershipService.isBuildersMember()` in the handler

#### Packs — `PacksModule` (NEW) — **admin-only registry, no member endpoint**

| #   | Method | Path               | Guard      | Request DTO                                   | Response                                              | Audit            |
| --- | ------ | ------------------ | ---------- | --------------------------------------------- | ----------------------------------------------------- | ---------------- |
| 1   | GET    | `/admin/packs`     | A          | `ListPacksQueryDto` (`search?`, `cohortKey?`) | `{ packs: PackResponse[] }` — every pack, all cohorts | no               |
| 2   | GET    | `/admin/packs/:id` | A          | —                                             | `PackResponse` (404 if missing)                       | no               |
| 3   | POST   | `/admin/packs`     | A+T 20/min | `CreatePackDto`                               | `PackResponse` (201)                                  | ✅ `pack.create` |
| 4   | PATCH  | `/admin/packs/:id` | A+T 20/min | `UpdatePackDto`                               | `PackResponse`                                        | ✅ `pack.update` |
| 5   | DELETE | `/admin/packs/:id` | A+T 10/min | —                                             | `{ deleted: boolean }`                                | ✅ `pack.delete` |

> ⛔ **There is no `GET /members/packs` and no member-facing pack endpoint of any kind** (Decision 3). Members receive packs through GitHub — a collaborator invite, or the repo link posted inside their cohort's Discourse group. Ptah stores the bookkeeping row and nothing else.

#### Sessions — `GoogleSessionsModule` (extend)

| #   | Method | Path                       | Guard      | Request DTO                                             | Response                                                     | Audit                      |
| --- | ------ | -------------------------- | ---------- | ------------------------------------------------------- | ------------------------------------------------------------ | -------------------------- |
| 7   | GET    | `/admin/sessions`          | A          | `ListSessionsQueryDto` (`daysAhead?` 1–365, default 60) | `{ sessions: BuildersSession[], calendarWritable: boolean }` | no                         |
| 8   | POST   | `/admin/sessions`          | A+T 20/min | `CreateSessionDto`                                      | `BuildersSession` (201)                                      | ✅ `sessions.event.create` |
| 9   | PATCH  | `/admin/sessions/:eventId` | A+T 20/min | `UpdateSessionDto`                                      | `BuildersSession`                                            | ✅ `sessions.event.update` |
| 10  | DELETE | `/admin/sessions/:eventId` | A+T 10/min | —                                                       | `{ deleted: boolean }` · **409 if master recurring event**   | ✅ `sessions.event.delete` |

> ⛔ `GET /members/sessions` is **not in this table and not modified.**

#### Community — `DiscourseModule` (extend) — **READ-ONLY**

| #   | Method | Path                            | Guard | Request DTO                                      | Response                                                                 | Audit |
| --- | ------ | ------------------------------- | ----- | ------------------------------------------------ | ------------------------------------------------------------------------ | ----- |
| 11  | GET    | `/admin/community/topics`       | A     | `ListTopicsQueryDto` (`limit?` 1–50, default 20) | `{ communityUrl, topics: CommunityTopic[], enabled: boolean }`           | no    |
| 12  | GET    | `/admin/community/review-queue` | A     | —                                                | `{ items: ReviewQueueItem[], count: number, reviewUrl: string \| null }` | no    |

> ⛔ `GET /community/summary` is **not in this table and not modified.**
> ⛔ **No write endpoints.** Per Checkpoint-1 Decision 1 (§11), all Discourse moderation stays in Discourse's own admin panel. This controller contains **only `@Get` handlers** — a structural test asserts that (§8.2 G5).

#### Cohorts — `MemberGroupsModule` (extend; endpoints 14–17 already exist)

| #   | Method  | Path                                | Guard      | Request DTO                                                       | Response                                                    | Audit         |
| --- | ------- | ----------------------------------- | ---------- | ----------------------------------------------------------------- | ----------------------------------------------------------- | ------------- |
| 14  | GET     | `/admin/groups`                     | A          | —                                                                 | `{ groups: MemberGroupResponse[] }`                         | no _(exists)_ |
| 15  | POST    | `/admin/groups`                     | A+T 20/min | `CreateMemberGroupDto`                                            | `MemberGroupResponse`                                       | ✅ _(exists)_ |
| 16  | PATCH   | `/admin/groups/:id`                 | A+T 20/min | `UpdateMemberGroupDto`                                            | `MemberGroupResponse`                                       | ✅ _(exists)_ |
| 17  | POST    | `/admin/groups/:id/assign`          | A+T 20/min | `AssignMembersDto`                                                | `{ assigned, skipped }`                                     | ✅ _(exists)_ |
| 18  | DELETE  | `/admin/groups/:id/members/:userId` | A+T 20/min | —                                                                 | `{ removed: boolean }`                                      | ✅ _(exists)_ |
| 19  | **GET** | **`/admin/groups/:id/members`**     | **A**      | `ListGroupMembersQueryDto` (`page?`, `pageSize?` ≤100, `search?`) | `{ members: GroupMemberResponse[], total, page, pageSize }` | no            |

**Net new endpoints: 11** (rows 1–5, 7–12) **+ 1** (row 19) = **12** — every one behind `AdminGuard`.

### 2.4 Audit action union extension

`apps/ptah-license-server/src/audit/audit-log.types.ts` — additive, no migration (the union is deliberately strings, per its own docblock at line 8-9):

```ts
export type AdminAuditAction =
  | /* …existing 16… */
  | 'pack.create'
  | 'pack.update'
  | 'pack.delete'
  | 'sessions.event.create'
  | 'sessions.event.update'
  | 'sessions.event.delete';

export type AdminAuditTargetType =
  | /* …existing 6… */
  | 'Pack'
  | 'CalendarEvent';
```

> No `community.*` audit action and no `DiscourseTopic` target type — the admin community surface performs **zero mutations** (Decision 1). Discourse writes its own moderation history in its own admin panel, which is where those actions now live.

All admin mutations write audit via `AuditLogService.write({ actorEmail: req.user?.email ?? null, … , ipAddress: req.ip, userAgent })`, following `admin.controller.ts:231-251` (best-effort, wrapped in `try/catch (error: unknown)`, an audit failure never fails the mutation — **except** for pack create/update/delete, where the audit write is enlisted in the same `prisma.$transaction` via the `tx` param that `WriteAuditLogParams` already supports (`audit-log.types.ts:68`), since both are DB writes and atomicity is free).

---

## 3. Data Model — Packs

### 3.1 Prisma model

Append to `apps/ptah-license-server/prisma/schema.prisma`:

```prisma
// TASK_2026_169: A "pack" is a Ptah-authored source-code deliverable — a GitHub
// repository containing a production-shaped codebase plus its Claude plugins and
// MCP servers — shared with a Builders cohort.
//
// DELIVERY HAPPENS ENTIRELY ON GITHUB. The admin invites the cohort's members as
// collaborators (or posts the repo link inside that cohort's Discourse group) by
// hand. There is deliberately NO GitHub App integration, no collaborator-invite
// automation, and no storage of members' GitHub handles (excluded in Checkpoint 0
// / Q1; distribution moved out of Ptah entirely in Checkpoint 1 / D3). `notes`
// records whichever manual step was taken, for the admin's own reference.
//
// ONE PACK = ONE REPO. `repoUrl` is the pack's own dedicated GitHub repository;
// packs never share a repo. Adding a second deliverable means adding a second Pack
// row, not a second URL on this one.
//
// ⚠️ THIS TABLE IS AN ADMIN-ONLY REGISTRY. IT GATES NOTHING.
// There is no member-facing endpoint that reads it. Ptah never serves pack content
// and never decides who may access a pack. Access is administered ENTIRELY on
// GitHub — the admin invites the cohort's members as collaborators, or posts the
// repo link inside that cohort's Discourse group. This table exists so the admin
// has one place recording which repo belongs to which cohort.
//
// `cohortKey` is therefore a BOOKKEEPING LABEL, NOT AN ACCESS CONTROL:
//   null     → the repo is not tied to a particular cohort.
//   non-null → the repo was shared with that MemberGroup cohort (on GitHub).
// Changing this field grants and revokes nothing.
model Pack {
  id          String   @id @default(cuid())
  slug        String   @unique                  // stable lowercase slug, e.g. 'saas-starter'
  title       String
  description String
  repoUrl     String   @map("repo_url")         // https://github.com/<owner>/<repo> — one repo per pack
  notes       String?                            // freeform ADMIN note (e.g. "invites sent 2026-08-01")
  tags        String[] @default([])
  cohortKey   String?  @map("cohort_key")       // bookkeeping label only — gates nothing
  createdBy   String?  @map("created_by")       // admin email at creation time
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  cohort MemberGroup? @relation(fields: [cohortKey], references: [key], onDelete: SetNull)

  @@index([cohortKey])
  @@map("packs")
}
```

And the back-relation on the existing model (`schema.prisma:49-62`):

```prisma
model MemberGroup {
  // …existing fields unchanged…
  assignments MemberGroupAssignment[]
  packs       Pack[]                    // ← ADD (bookkeeping back-relation; grants nothing)
}
```

**Design notes with evidence:**

- **`cuid()` not `uuid()`** — matches the two most recently added models, `MemberGroup` (`schema.prisma:50`) and `Waitlist` (`schema.prisma:238`). `uuid() @db.Uuid` is used only by the older user-linked models.
- **`String[] @default([])` for tags** — precedent: `MarketingCampaignTemplate.variables` (`schema.prisma:196`) and `MarketingCampaign.skippedUserIds` (`schema.prisma:220`). Postgres native array; no join table needed for a handful of tags.
- **No `userId`** — packs are registry rows labelled with a _cohort_, never with an individual user. `User` is untouched, so no cascade concerns on the user side.

**Dropped: the `published` column.** It existed solely as the member-visibility flag; with no member surface it has no consumer and no meaning. A draft/live distinction would be speculative machinery — an admin who isn't ready to record a repo simply doesn't create the row yet, and the freeform `notes` field covers "repo exists but invites not sent." Removing it also removes leak risk L6 (draft visibility) at the root rather than defending against it. `ListPacksQueryDto` loses its `published` filter accordingly.

**Renamed: `accessNote` → `notes`.** It was "private-repo access instructions shown to members." With no member surface it is an internal admin note, so **keep the column but rename it** — it earns its place in the new manual-distribution workflow (recording _"invited @founding-cohort as a GitHub team on 2026-08-01"_ is exactly the bookkeeping this table now exists for). Keeping the old name would imply it is still shown to someone.

**Renamed: `requiredGroupKey` → `cohortKey`.** `required*` asserts a precondition that no longer exists. After Decision 3 the field grants and revokes nothing, so a name implying enforcement would actively mislead the next contributor — who could reasonably assume some query somewhere honours it and build on that assumption. `cohortKey` is descriptive and makes no promise. The docblock states the "gates nothing" fact in the schema itself, where anyone reading the model will see it.

**Indexes — deliberately just one.** `@@index([cohortKey])` backs the admin cohort filter and the `ON DELETE SET NULL` path (Postgres does _not_ auto-index the referencing side of a FK). No `createdAt` index: the expected row count is one repo per cohort — a handful to low dozens — so Postgres will sequential-scan for the default ordering regardless, and an index there would be pure maintenance cost with no read benefit. `slug` gets a B-tree free from `@unique`; a second explicit `@@index([slug])` would be redundant. Revisit only if this table ever reaches thousands of rows, which the product shape makes unlikely.

**Why the FK targets `MemberGroup.key`, not `MemberGroup.id`** (this was a real fork in the road; the reasoning survives Decision 3 largely intact, minus the query-shape argument):

`MemberGroupAssignment` references `MemberGroup.id` (`schema.prisma:75`), so `id` looks like the conventional choice. Targeting `key` is nonetheless correct here, for three reasons:

1. **`key` is what a human reads and writes.** The cohort label is displayed in the admin table, chosen in a dropdown, and cross-referenced by hand against the Discourse group name — all of which speak in slugs (`founding`, `builders-founding`), not cuids. Storing the slug makes the row self-describing: `SELECT * FROM packs` is readable without a join. An opaque `id` would make the registry's single purpose — _"which repo went to which cohort?"_ — unanswerable at a glance.
2. **`key` is a genuinely stable natural key.** `MemberGroup.key` is `@unique` (`schema.prisma:51`) — so it is a legal Prisma `references` target — and it is _deliberately immutable_: `UpdateMemberGroupDto` omits it, with the docblock stating _"`key` is intentionally NOT patchable (stable slug)"_ (`member-group.dto.ts:53`). A mutable natural key would be a bad FK target; this one cannot drift.
3. **Referential integrity is preserved either way.** This is a real Postgres FK, not a loose string column — a pack can never name a cohort that does not exist. This matters _more_ now, not less: with no query enforcing anything, the FK is the only thing keeping the label honest.

**`onDelete: SetNull`** — deleting a cohort unlabels its packs rather than destroying them. Reasoning: a pack row is the record of a real repository; a cohort is an organizational grouping. Losing the grouping must never destroy the record, and `Cascade` would silently delete the only bookkeeping trace of a live repo when an admin reorganizes cohorts. `SetNull` is also the precedent already set for exactly this "keep the record, drop the association" case — `MarketingCampaign.template` uses `onDelete: SetNull` with the comment _"so historical campaign rows survive template deletion"_ (`schema.prisma:208, 225`). `MemberGroupsController` exposes **no DELETE route** today, so this path is currently unreachable — it is defensive proofing so a future cohort-delete feature cannot quietly erase the registry. Post-Decision-3 this is purely a bookkeeping consideration: unlabelling a pack changes **no one's access**, because Ptah controls no access. The admin list still renders `cohortKey: null` distinctly (§6.4) so an unlabelled row is visible rather than silently blank.

### 3.2 Migration

`apps/ptah-license-server/prisma/migrations/20260801120000_add_packs/migration.sql` — hand-authored SQL with a leading comment block, matching every existing migration in the repo (verified against `20260719160000_add_member_groups/migration.sql`):

```sql
-- TASK_2026_169: Builders "packs" — an ADMIN-ONLY REGISTRY of the GitHub repos
-- shared with each cohort. One pack = one dedicated repo.
--
-- THIS TABLE GATES NOTHING. No member-facing endpoint reads it. Access to a pack
-- is administered entirely on GitHub (collaborator invites, or the repo link posted
-- inside that cohort's Discourse group). `cohort_key` is a bookkeeping label, not an
-- access control; it FKs to member_groups(key) — a stable, immutable natural key —
-- purely so the label cannot name a cohort that does not exist. ON DELETE SET NULL
-- so deleting a cohort unlabels its packs rather than erasing the registry row.

-- CreateTable
CREATE TABLE "packs" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "repo_url" TEXT NOT NULL,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cohort_key" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "packs_slug_key" ON "packs"("slug");

-- CreateIndex
CREATE INDEX "packs_cohort_key_idx" ON "packs"("cohort_key");

-- AddForeignKey
ALTER TABLE "packs" ADD CONSTRAINT "packs_cohort_key_fkey"
    FOREIGN KEY ("cohort_key") REFERENCES "member_groups"("key")
    ON DELETE SET NULL ON UPDATE CASCADE;
```

> The FK requires `member_groups(key)` to carry a unique constraint — it does, created as `member_groups_key_key` by `20260719160000_add_member_groups/migration.sql`. `ON UPDATE CASCADE` is belt-and-braces: `key` is not patchable through the API, but if it ever were, referencing packs would follow rather than break.

**No seed row.** Unlike the member-groups migration (which seeded the `founding` cohort because provisioning depends on a default existing), packs have no such dependency and the admin creates the first one through the UI. Shipping an empty table also makes the `EmptyState` path get exercised on day one.

**Commands** (per `apps/ptah-license-server/CLAUDE.md` → Build & Run):

```
nx prisma:migrate ptah-license-server     # dev — generates + applies
nx prisma:generate ptah-license-server    # regenerates src/generated-prisma-client/ (adds models/Pack.ts)
nx prisma:deploy ptah-license-server      # CI/prod
```

### 3.3 How packs reach members — **they don't go through Ptah at all**

**Decision 3: there is no member-facing pack endpoint.** Distribution happens on GitHub.

The workflow the admin actually performs:

1. Create the repo on GitHub (one repo per pack).
2. Grant the cohort's members access **on GitHub** — invite them as collaborators, or add the cohort as a GitHub team, or simply post the repo link inside that cohort's Discourse group (which already has its own gated forum access via the existing `syncNamedGroupMembership` fan-out).
3. Record the row in `/admin/builders/packs` so there is one place answering _"which repo went to which cohort, and when?"_ — with `notes` capturing the manual step taken.

**What this removes from the plan** (all of it deleted, not deferred):

| Removed                                                           | Was                         |
| ----------------------------------------------------------------- | --------------------------- |
| `GET /api/v1/members/packs`                                       | endpoint #6                 |
| `packs/packs.controller.ts` (`MemberPacksController`)             | member-gated controller     |
| `packs/member-packs.controller.spec.ts`                           | its spec                    |
| `PacksService.listVisibleTo(userId)` + the cohort `OR` predicate  | the cohort-visibility query |
| `PacksModule` → `BuildersMembershipService` dependency            | the membership gate         |
| `PacksModule` → `MemberGroupsService.getGroupsForUser` dependency | the cohort lookup           |
| `memberPackSchema`, `MembersApiService.getPacks()`                | frontend member client      |
| The packs section in `members-page.component.ts`                  | frontend member surface     |

`PacksService` is left with exactly two read methods, both admin-only and both trivially auditable:

```ts
// packs.service.ts — no member-facing read path exists.
// PacksModule needs NO @Global() service injections at all: just PrismaService
// (@Global PrismaModule) and AuditLogService (@Global AuditModule).
async listAll(q: ListPacksQuery): Promise<PackResponse[]> {
  return this.prisma.pack.findMany({
    where: {
      ...(q.cohortKey ? { cohortKey: q.cohortKey } : {}),
      ...(q.search
        ? { OR: [
            { title: { contains: q.search, mode: 'insensitive' } },
            { slug:  { contains: q.search, mode: 'insensitive' } },
          ] }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: { cohort: { select: { name: true } } },
  }).then((rows) => rows.map(toPackResponse));
}

async getById(id: string): Promise<PackResponse> { /* 404 when missing */ }
```

`search` targets _fixed_ columns (`title`, `slug`) — never a caller-supplied field name — satisfying the `assertAllowedField` discipline (`admin-models.config.ts:313`) by construction. `cohortKey` is a value filter on an FK-constrained column, so an unknown cohort simply returns an empty list.

**Why this is architecturally better, not just smaller:** the member gate and the cohort gate were two things that could be got wrong. Both are now gone rather than defended. Ptah stores a URL and a label; GitHub — a system purpose-built for repository access control, which the admin already operates — decides who may read the code.

### 3.4 Group-members listing (closes the flagged gap)

`MemberGroupsService.listMembers(groupId, query)` — paginated join read:

```ts
// Mirrors AdminService.list() pagination envelope + member-groups.service.ts:100-106 shape.
async listMembers(groupId: string, q: ListGroupMembersQuery): Promise<GroupMembersPage> {
  const group = await this.prisma.memberGroup.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!group) throw new NotFoundException(`Member group ${groupId} not found`);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 25;
  const where: Prisma.MemberGroupAssignmentWhereInput = {
    groupId,
    ...(q.search ? { user: { email: { contains: q.search, mode: 'insensitive' } } } : {}),
  };
  const [rows, total] = await this.prisma.$transaction([
    this.prisma.memberGroupAssignment.findMany({
      where, orderBy: { assignedAt: 'desc' },
      skip: (page - 1) * pageSize, take: pageSize,
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    }),
    this.prisma.memberGroupAssignment.count({ where }),
  ]);
  return { members: rows.map(toGroupMember), total, page, pageSize };
}
```

`search` is a _fixed_ field (`user.email`) — never a caller-supplied field name — so the `assertAllowedField` allowlist discipline (`admin-models.config.ts:313`) is satisfied by construction.

---

## 4. Google Calendar Write Path

### 4.1 Provider changes — `google-calendar.provider.ts`

**Change 1 — widen the verb union** (currently `google-calendar.provider.ts:127`):

```ts
private async request(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',   // was: 'GET' | 'PATCH'
  path: string,
  body?: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<GoogleApiResult>
```

No other change to `request()` is needed:

- `body ? JSON.stringify(body) : undefined` (line 151) already handles the body-less DELETE.
- `safeParseJson` (line 196-203) already returns `undefined` for an empty body, so Calendar's **`204 No Content`** on DELETE folds cleanly into `{ ok: true, status: 204, json: undefined }`.
- Non-2xx already folds to `{ ok:false, status, error }` with a sanitized message (lines 155-166) — raw Google bodies are never surfaced. ✅ matches the "never leak `error.message`" standard.

**Change 2 — three new methods:**

```ts
/**
 * Create a calendar event. `conferenceDataVersion=1` is REQUIRED for Google to
 * honour a `conferenceData.createRequest` and actually mint a Meet link;
 * without it the field is silently dropped. `sendUpdates=none` keeps event
 * creation from emailing the whole standing attendee list.
 */
async createEvent(input: CalendarEventInput): Promise<GoogleApiResult> {
  const query = new URLSearchParams({ conferenceDataVersion: '1', sendUpdates: 'none' });
  return this.request(
    'POST',
    `/calendars/${encodeURIComponent(this.calendarId)}/events?${query}`,
    this.toGoogleEventBody(input),
  );
}

/** Patch mutable fields of an event (summary / description / start / end). */
async patchEvent(eventId: string, input: Partial<CalendarEventInput>): Promise<GoogleApiResult> {
  return this.request(
    'PATCH',
    `/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    this.toGoogleEventBody(input),
  );
}

/** Delete an event. Google responds 204 with an empty body on success. */
async deleteEvent(eventId: string): Promise<GoogleApiResult> {
  return this.request(
    'DELETE',
    `/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
  );
}
```

`toGoogleEventBody` maps the internal `CalendarEventInput` (`{ title, description?, startsAt: ISO, endsAt: ISO, createMeetLink?: boolean }`) to Google's `{ summary, description, start: { dateTime }, end: { dateTime }, conferenceData?: { createRequest: { requestId: <uuid>, conferenceSolutionKey: { type: 'hangoutsMeet' } } } }`.

**Change 3 — `isWritable()` accessor** returning the cached scope verdict from §4.2, consumed by endpoint #7's `calendarWritable` flag.

### 4.2 Verifying the granted scope — two independent mechanisms

The context's pre-architecture finding is correct that a write scope must exist (PATCH succeeds today), but "PATCH works" does **not** by itself prove insert/delete work — Google's scope ladder distinguishes read from write, though not write-verbs from each other. The two write-capable scopes are `https://www.googleapis.com/auth/calendar` (full) and `https://www.googleapis.com/auth/calendar.events`; **both permit `events.insert` and `events.delete`.** So the real question is binary: _is the grant one of those two, or is it a `.readonly` variant?_ (A `.readonly` grant would already have broken `patchEventAttendees`, so the expected answer is yes — but we verify rather than assume.)

**Mechanism 1 — read the `scope` field off the refresh-token grant (cheap, always-on).**

`google-auth.provider.ts:103-106` currently discards it:

```ts
const json = (await response.json()) as {
  access_token?: string;
  expires_in?: number;
};
```

Change to:

```ts
const json = (await response.json()) as {
  access_token?: string;
  expires_in?: number;
  scope?: string; // space-delimited granted scopes
};
```

Then cache `this.grantedScopes = (json.scope ?? '').split(' ').filter(Boolean)` alongside the token, expose:

```ts
/** Write scopes that permit events.insert / events.patch / events.delete. */
private static readonly CALENDAR_WRITE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

/**
 * Whether the refresh-token grant carries a scope permitting event writes.
 * `undefined` = not yet determined (no successful refresh since boot).
 * A `true`/`false` verdict is only meaningful after `getAccessToken()` has
 * succeeded at least once.
 */
hasCalendarWriteScope(): boolean | undefined { … }
```

Log the verdict **once** at startup-equivalent (first successful refresh) — scopes are not secrets, but log only the boolean plus the matched scope name, never the token.

**Mechanism 2 — live create+delete smoke (authoritative, BLOCKING).**

`scripts/google-calendar-write-smoke.mjs`, modelled on `scripts/community-gate-smoke.mjs`'s cookie-minting (HMAC over `header.payload` with `JWT_SECRET`, per `community-gate-smoke.mjs:39-45`):

1. Seed/reuse an `ADMIN_EMAILS` user; mint a `ptah_auth` cookie.
2. `POST /api/v1/admin/sessions` with `{ title: '[PTAH SMOKE] delete me', startsAt: <now + 10 years>, endsAt: <+1h>, createMeetLink: false }` → assert **201** and capture `id`.
3. `GET /api/v1/admin/sessions?daysAhead=365` → (event is 10y out, so not expected in the window; instead) `GET /api/v1/admin/sessions/:id` is not exposed — so assert step 2's returned body has a non-empty `id` and matching `title`.
4. `DELETE /api/v1/admin/sessions/:id` → assert **200 `{ deleted: true }`**.
5. Re-`DELETE` → assert the idempotent/`404`-tolerant path (Google returns 410 Gone for an already-deleted event; the provider folds it to `ok:false, status:410`, which the controller maps to `{ deleted: false }` rather than a 500).
6. Non-zero exit on any assertion failure.

**Why 10 years out:** a far-future event can never appear in the members' 60-day `listUpcomingSessions()` window (`sessions.service.ts:12`, `LOOKAHEAD_DAYS = 60`), so a smoke run against a live calendar can never leak a `[PTAH SMOKE]` row into the real members' area, even if cleanup fails.

**This smoke is a hard gate on Batch B3** (§9): no session-write UI is built until it passes.

### 4.3 Fallback if the scope turns out to be insufficient

If Google returns **403 `insufficientPermissions`** on insert/delete:

1. **Backend degrades, never 500s.** The provider already folds it to `{ ok:false, status:403 }`. `AdminSessionsService` maps upstream `403`/`401` to a NestJS **`ServiceUnavailableException({ reason: 'calendar_write_unavailable' })`** (503). Google's body is never forwarded — consistent with the provider's existing sanitization contract (`google-calendar.provider.ts:19-20` docblock).
2. **Read path is unaffected.** `GET /api/v1/admin/sessions` uses the same `listEvents` GET that already works, so admins still _see_ every session.
3. **Frontend degrades gracefully.** Endpoint #7 returns `calendarWritable: boolean` (from `hasCalendarWriteScope()`); when false the sessions view renders read-only, hides the New/Edit/Delete controls, and shows a `<div class="alert alert-warning">` explaining that re-consent is required. No dead buttons.
4. **Re-consent runbook (documented, not built).** Re-run the Google OAuth consent for the founder account with
   `scope=https://www.googleapis.com/auth/calendar&access_type=offline&prompt=consent`,
   then replace `GOOGLE_OAUTH_REFRESH_TOKEN` in the environment and restart. **Do NOT build an in-app OAuth consent flow** — that is a separate feature and out of scope here.
5. **Ship-order guarantee.** Because B2 (provider + smoke) precedes B3 (session UI), a scope failure costs one batch of rework, not a feature.

### 4.4 ⚠️ Recurring-master-event guard (footgun)

`BUILDERS_SESSION_EVENT_ID` names the **master recurring event** whose attendee list the Paddle provisioning fan-out maintains (`sessions.service.ts:45-50, 103-131`). Deleting it would silently destroy every provisioned member's standing invite and break `addMemberToSessions` for all future signups.

**Required guard on `DELETE /api/v1/admin/sessions/:eventId`:**

```ts
const protectedId = this.configService.get<string>('BUILDERS_SESSION_EVENT_ID')?.trim();
if (protectedId && (eventId === protectedId || resolved?.recurringEventId === protectedId)) {
  throw new ConflictException({
    reason: 'protected_recurring_event',
    message: 'This is the recurring Builders session series that member provisioning depends on. Manage it in Google Calendar directly.',
  });
}
```

The `recurringEventId` check matters because `listUpcomingSessions` expands recurrences (`singleEvents=true`, `google-calendar.provider.ts:60`), so the admin UI shows _instances_ whose ids differ from the master's — deleting an instance is safe, deleting the master is not, and the instance carries `recurringEventId` pointing at the master (already typed at `google-sessions.types.ts:81`). The same 409 applies to `PATCH` when targeting the master directly.

---

## 5. Community Scope — Read-Only Visibility (no moderation writes)

### 5.1 Decision

**All Discourse moderation stays in Discourse's own admin panel. This surface performs zero writes.** (Checkpoint-1 Decision 1 — §11.)

The reasoning that supports it: the admin is **already a full Discourse admin** — auto-admin from `ADMIN_EMAILS` shipped in commit `061a19ab7` (per the handoff's background). Discourse's moderation UI is one click away, shows the full context an action needs (post body, author history, prior flags, trust level), and has undo. Proxying moderation through a thin license-server shim would duplicate a better tool while stripping the context that makes moderation decisions correct.

**What remains, and why it remains:** the user removed _moderation_, not _visibility_. Surfacing Builders member content in the admin dashboard is the founding premise of this whole task — an admin with no Builders membership should be able to _see_ the community without one. So the community view stays as a **triage / awareness surface**: it answers "is anything happening?" and "does anything need me?", then hands off to Discourse for every action.

### 5.2 Exposed — read-only

| Capability                        | Discourse call                                                                    | Notes                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **List recent topics** (#11)      | `GET /latest.json` — reuses `getLatestTopics` (`discourse-admin.provider.ts:163`) | The same call the member endpoint makes, but **admin-authorized instead of Builders-gated**. This is the task's premise in one line. |
| **Read the review queue** (#12)   | `GET /review.json?status=pending`                                                 | Surfaces "N items need a human" so the admin knows _whether_ to open Discourse. Count + titles only.                                 |
| **Cohort → Discourse group sync** | already shipped (`syncNamedGroupMembership`, `discourse-admin.provider.ts:115`)   | Existing behaviour, unchanged by this task.                                                                                          |

**Every row carries an "Open in Discourse" deep link** (`{DISCOURSE_URL}/t/{slug}/{id}`), and the view carries a top-level link to `{DISCOURSE_URL}/review`. Those links are now the _only_ path from this surface to any action.

**Provider impact: no verb widening.** `DiscourseAdminProvider.request()` (`discourse-admin.provider.ts:419`) stays exactly `'GET' | 'PUT' | 'DELETE'`. The single addition is a `getReviewQueue()` method issuing a **`GET`** — a verb the provider already supports. `PUT`/`DELETE` remain used only by the pre-existing group-sync paths.

### 5.3 Not built — everything that mutates Discourse

Close/reopen, pin/unpin, list/unlist, delete topic or post, suspend or silence a user, edit a post, approve/reject review items, category configuration. All of it lives in Discourse's admin panel.

This is a **stronger** boundary than the conservative "reversible actions only" shape originally proposed: the admin community controller now contains only `@Get` handlers, so there is no write path to review, no moderation DTO to validate, no audit action to define, and no injection surface from an interpolated `status` value. Enforced by structural test G5 (§8.2).

### 5.4 Degradation contract

`DiscourseAdminProvider` never throws (`discourse-admin.provider.ts:20-23, 456-469`). The admin controller preserves that:

- Feature-off (`isEnabled() === false`) → `{ communityUrl: null, topics: [], enabled: false }` / `{ items: [], count: 0, reviewUrl: null }`; the UI shows an `EmptyState` reading "Discourse is not configured on this server."
- Any transport/upstream failure → empty list + `enabled: true`, never a 500, never an upstream body forwarded.
- With no write path, there is no write-failure mode to specify.

---

## 6. Frontend Structure

### 6.1 Routes

`apps/ptah-landing-page/src/app/pages/admin/admin.routes.ts` — insert **before** the `':model'` catch-all (line 132). This ordering is mandatory and already documented in that file's comment at lines 64-66: _"Bespoke workflow views MUST precede the generic ':model' / ':model/:id' catch-all."_ `builders` is not an `AdminModelKey`, so a mis-ordered route resolves to `AdminList` and 400s with "Unknown admin model".

```ts
// TASK_2026_169 — Builders content management. MUST precede ':model'.
{ path: 'builders', pathMatch: 'full', redirectTo: 'builders/packs' },
{
  path: 'builders/packs',
  loadComponent: () => import('./builders/packs/packs-list').then((m) => m.PacksList),
},
{
  path: 'builders/sessions',
  loadComponent: () => import('./builders/sessions/sessions-list').then((m) => m.SessionsList),
},
{
  path: 'builders/community',
  loadComponent: () => import('./builders/community/community-view').then((m) => m.CommunityView),
},
```

### 6.2 Nav entry

`admin-layout/admin-nav.config.ts` — a new `AdminNavGroup` inserted between **Operations** and **People & Community** (Builders content is operational-adjacent but member-facing):

```ts
{
  label: 'Builders Content',
  icon: Package,
  items: [
    { label: 'Packs',     route: '/admin/builders/packs',     primary: true, icon: Package },
    { label: 'Sessions',  route: '/admin/builders/sessions',  primary: true, icon: CalendarDays },
    { label: 'Community', route: '/admin/builders/community', primary: true, icon: MessagesSquare },
  ],
},
```

New lucide imports: `Package`, `CalendarDays`, `MessagesSquare` (named imports from `lucide-angular`, tree-shaken — the file already imports 12 icons this way at lines 15-28).

**Member Groups stays under "People & Community"** (`admin-nav.config.ts:164-168`) — cohorts are people-shaped and moving it churns muscle memory for zero gain. The group-members drill-down (§6.4) enhances the existing `/admin/groups` view in place.

### 6.3 API client — new service

**New file:** `apps/ptah-landing-page/src/app/services/admin-builders-api.service.ts`.

`admin-api.service.ts` is already 614 lines; folding ~14 more methods + ~10 Zod schemas in would push it past 850 and mix two concerns. A sibling service matches the "new units own one concern" standard and keeps the generic-model CRUD client stable.

**Shared helper extraction (small, safe):** move `validate()` (`admin-api.service.ts:355-364`) verbatim into `apps/ptah-landing-page/src/app/services/validate-response.ts` and import it from both services. Net change to `admin-api.service.ts`: delete 10 lines, add 1 import.

Schemas (Zod at the boundary, types inferred — mirrors `admin-api.service.ts:134-141`):

```ts
const packSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  repoUrl: z.string(),
  /** Freeform internal admin note — never shown to a member (no member surface exists). */
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  /** Bookkeeping label only — gates nothing. null = not tied to a cohort. */
  cohortKey: z.string().nullable(),
  /** Denormalised cohort display name for the admin table (null when unlabelled). */
  cohortName: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Pack = z.infer<typeof packSchema>;

const adminSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  meetLink: z.string().nullable(),
  recurring: z.boolean(),
});
const adminSessionsEnvelopeSchema = z.object({
  sessions: z.array(adminSessionSchema),
  calendarWritable: z.boolean(),
});

const communityTopicsEnvelopeSchema = z.object({
  communityUrl: z.string().nullable(),
  topics: z.array(communityTopicSchema), // reuse the shape from members-api.service.ts
  enabled: z.boolean(),
});

const reviewQueueItemSchema = z.object({
  id: z.number(),
  type: z.string(),
  topicTitle: z.string().nullable(),
  createdAt: z.string(),
});
const reviewQueueEnvelopeSchema = z.object({
  items: z.array(reviewQueueItemSchema),
  count: z.number(),
  reviewUrl: z.string().nullable(),
});

const groupMemberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  assignedAt: z.string(),
  source: z.string(),
});
```

Methods (all `Observable<T>`, all relative URLs so `apiInterceptor` supplies base + credentials) — **12, all read or packs/sessions writes; no community write method exists**:
`listPacks`, `getPack`, `createPack`, `updatePack`, `deletePack`, `listSessions`, `createSession`, `updateSession`, `deleteSession`, `listCommunityTopics`, `getReviewQueue`, `listGroupMembers`.

**`members-api.service.ts` is NOT modified.** Decision 3 removes the member-facing pack surface, so there is no `getPacks()` and no `memberPackSchema`. `members-api.service.ts` and `members-page.component.ts` both drop off this task's MODIFY list entirely — **no frontend file on the member path is touched by this feature.**

### 6.4 Components

All standalone, `ChangeDetectionStrategy.OnPush`, signals + `inject()` — mirroring `GroupsList` (`groups-list.ts:30-59`) which is the closest existing CRUD-with-modals precedent.

| Component                | Path (under `pages/admin/builders/`)      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PacksList`              | `packs/packs-list.{ts,html}`              | Table + New/Edit/Delete. `signal<Pack[]>`, `loading`, `error`, `fetch()` on construct. **Cohort column** rendering `cohortName`, or a muted "No cohort" chip when `cohortKey === null` — the unlabelled case must read as a deliberate state, never as blank/missing data. Optional cohort filter bound to `ListPacksQueryDto.cohortKey`. `repoUrl` renders as an `<a [href] target="_blank" rel="noopener noreferrer">`. **Copy the header/intro copy carefully:** this view must read as a _registry_, not a distribution tool — a one-line subtitle stating "Access is granted on GitHub; this list is a record." prevents an operator assuming that editing the cohort field re-shares anything.                                                                                                                                                                     |
| `PackFormModal`          | `packs/components/pack-form-modal/`       | Create/edit. Direct copy of `GroupFormModal`'s shape: `open = input<boolean>(false)`, `pack = input<Pack \| null>(null)` (null = create), `closeModal = output<void>()`, `saved = output<Pack>()`, `effect()` resetting fields on open, `computed()` validity. **Cohort `<select>`** with a first option labelled **"Not tied to a cohort"** mapping to `null` (NOT "All Builders" — that phrasing implies a visibility scope this field does not have), then one option per member group, plus helper text: _"Label only — sharing is done on GitHub."_ ⚠️ **Dependency:** populated from the existing `AdminApiService.listGroups()` (`GET /api/v1/admin/groups`) — so this modal injects **both** `AdminApiService` (groups) and `AdminBuildersApiService` (packs). Fetch the group list lazily on first open and cache it in a signal; do not refetch per keystroke. |
| `DeletePackModal`        | `packs/components/delete-pack-modal/`     | Typed-slug confirmation, mirroring the `delete-user-modal` precedent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `SessionsList`           | `sessions/sessions-list.{ts,html}`        | Reads `calendarWritable`; when false renders read-only + `alert alert-warning` and hides mutation controls. Recurring-master rows render a `StatusBadge` "series" chip with delete disabled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `SessionFormModal`       | `sessions/components/session-form-modal/` | `title`, `description`, `startsAt`, `endsAt` (datetime-local), `createMeetLink` checkbox.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `CommunityView`          | `community/community-view.{ts,html}`      | **Read-only.** Topic list, each row with an "Open in Discourse" external link; a `StatTile` for the pending review-queue count linking to `{DISCOURSE_URL}/review`. **No toggles, no mutation controls, no confirmation modals** — there is no write endpoint to call. `EmptyState` when Discourse is unconfigured. (Named `CommunityView`, not `CommunityModeration` — the name should not imply a capability the surface does not have.)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| _(enhance)_ `GroupsList` | existing `groups/groups-list.ts`          | Add a `DetailDrawer` members drill-down: `membersOpen`/`membersTarget` signals, `listGroupMembers()` fetch, per-row Remove calling the existing `unassignGroupMember`. Closes the gap its own docblock flags at lines 25-28.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Shared-component reuse:**

- `EmptyState` (`ptah-admin-empty-state`, `input<LucideIconData>`, `input<string>` message/hint, default `<ng-content>` slot) — every list's zero-state.
- `StatusBadge` (`ptah-admin-status-badge`, `[variant]` or `[badgeMap]`+`[value]`) — the cohort chip on packs (`neutral` when unlabelled), Recurring/One-off on sessions.
- `DetailDrawer` (`ptah-admin-detail-drawer`, `[open]`/`[title]`/`(closed)`, `<ng-content>` + `<ng-content select="[drawerFooter]">`) — the group-members drill-down.
- `StatTile` — optional review-queue count on the community view.
- **`DataTable` NOT used.** It requires `columns = input.required<readonly FieldSpec[]>()` from `admin-models.config` and emits `rowClick(id)` with no action-column slot. These views are action-column-heavy with small row counts, so hand-rolled `<table class="table">` markup mirroring `groups-list.html` is the better fit — the same call `GroupsList` already made (`groups-list.ts:20-23` docblock).
- **`SelectionToolbar` NOT used** — no bulk operations in v1.

### 6.5 Bundle-budget impact

- Every new route is `loadComponent`-lazy, and the whole `/admin` subtree is already lazy behind `AdminAuthGuard` (`app.routes.ts`). **Nothing new lands in the initial bundle.**
- **No new npm dependencies.** `zod`, `lucide-angular`, `@angular/common/http` are all already in use.
- Per-chunk estimate: packs ≈ 14 kB, sessions ≈ 16 kB, community ≈ 12 kB (raw, pre-gzip) — well inside the 4 kB _per-component-style_ budget (these are TS/template, not styles) and irrelevant to the 1 mb warn / 2 mb error **initial** budget.
- `admin-builders-api.service.ts` is `providedIn: 'root'` but only imported by lazy components, so it lands in whichever admin chunk loads first — not the initial bundle.
- **Verification step:** `nx build ptah-landing-page --configuration=production` and confirm no budget warning appears (Batch F4).

---

## 7. Security Analysis

### 7.1 Proof the member gate is untouched

**Files that MUST NOT appear in the diff:**

| File                                                                    | Contains                                      |
| ----------------------------------------------------------------------- | --------------------------------------------- |
| `apps/ptah-license-server/src/discourse/builders-membership.service.ts` | `isBuildersMember()` — single source of truth |
| `apps/ptah-license-server/src/discourse/community.controller.ts`        | `GET /api/v1/community/summary` gate          |
| `scripts/community-gate-smoke.mjs`                                      | regression proof                              |
| `scripts/discourse-e2e.mjs`                                             | regression proof                              |

**File that may be touched only by strict addition:**
`apps/ptah-license-server/src/google-sessions/members.controller.ts` — **zero changes required.** Nothing in this plan edits it. If a developer proposes touching it, that is a design deviation requiring re-review.

**Decision 3 strengthens this proof.** In the two earlier revisions packs added a _new member-facing endpoint_ — which meant a new gate to write, a new gate to review, and a new way to get the invariant wrong. After Decision 3 the feature adds **no member-facing endpoint, no member-facing frontend change, and no new use of `BuildersMembershipService` anywhere.** `members-api.service.ts` and `members-page.component.ts` leave the MODIFY list. The entire feature now lives behind `AdminGuard`, so the invariant is preserved not by careful gating but by the member path being untouched in the first place — the strongest form the proof can take.

**Mechanical check (add to the verification batch):**

```
git diff --name-only main...HEAD -- \
  apps/ptah-license-server/src/discourse/builders-membership.service.ts \
  apps/ptah-license-server/src/discourse/community.controller.ts \
  apps/ptah-license-server/src/google-sessions/members.controller.ts \
  scripts/community-gate-smoke.mjs \
  scripts/discourse-e2e.mjs
# → MUST print nothing.
```

**Explicitly forbidden patterns** (grep-assertable in review):

- `isBuildersMember || isAdmin` — anywhere
- any `AdminGuard` import inside `community.controller.ts` or `members.controller.ts`
- any change making `isBuildersMember` consult `ADMIN_EMAILS`
- issuing a comp Builders license to admins as a workaround

### 7.2 ⚠️ Module import order in `app.module.ts` — correctness landmine

`AdminController` is `@Controller('v1/admin')` with wildcards `@Get(':model')` and `@Get(':model/:id')` (`admin.controller.ts:256, 265`). A sibling `@Controller('v1/admin/packs')` only wins the route match if **its module is registered before `AdminModule`.**

This is why `MemberGroupsModule` sits at `app.module.ts:64` while `AdminModule` sits at line 75 — and why `/api/v1/admin/groups` works today.

**Requirement:** `PacksModule` must be added to the `imports` array **before `AdminModule`** (alongside the other member-content modules at lines 61-64). `GoogleSessionsModule` (line 62) and `DiscourseModule` (line 63) are already correctly ordered.

**Failure mode if violated:** `GET /api/v1/admin/packs` falls through to `AdminController.list('packs')` → `assertModel` → **400 "Unknown admin model: packs"**. This is a confusing, non-obvious failure — call it out in the task description and add a regression test (§8.2, test G3).

### 7.3 Authorization enumeration — every new endpoint

| #     | Endpoint                    | Auth                      | Anonymous | Authenticated non-admin | Admin w/o Builders |
| ----- | --------------------------- | ------------------------- | --------- | ----------------------- | ------------------ |
| 1–5   | `/admin/packs*`             | JwtAuthGuard + AdminGuard | 401       | **403**                 | ✅ 200             |
| 7–10  | `/admin/sessions*`          | JwtAuthGuard + AdminGuard | 401       | **403**                 | ✅ 200             |
| 11–12 | `/admin/community*`         | JwtAuthGuard + AdminGuard | 401       | **403**                 | ✅ 200             |
| 19    | `/admin/groups/:id/members` | JwtAuthGuard + AdminGuard | 401       | **403**                 | ✅ 200             |

**Every new endpoint is `AdminGuard`-gated.** Decision 3 removed the one member-path row this table used to carry, so the feature's authorization story is now uniform: authenticated + on the `ADMIN_EMAILS` allowlist, or nothing.

**Where the "admin without a Builders membership" proof now lives.** It used to rest on the packs row (admin refused by `/members/packs`, served by `/admin/packs`). It now rests on the **sessions and community pairs**, which demonstrate exactly the same thing and are in fact the better demonstration because both sides read the _same underlying data_:

- `GET /members/sessions` → **403** for an admin without a Builders membership (unchanged, still gated by the inline DB check at `members.controller.ts:103-126`), while `GET /admin/sessions` → **200** with the same Google Calendar events.
- `GET /community/summary` → **degrades to `{ communityUrl: null, topics: [] }`** for that same admin (unchanged, `community.controller.ts:51-54`), while `GET /admin/community/topics` → **200** with the same Discourse topics.

Both pairs are already covered live: the members side by `community-gate-smoke.mjs` (which asserts precisely the non-Builders degradation) and the admin side by the V4 manual pass as `abdallah@miramarstaffing.com` — an `ADMIN_EMAILS` account holding a `community` license and no Builders membership.

### 7.4 Enumerated leak risks and mitigations

| #       | Risk                                                                                                                                       | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1**  | A future method added to a new admin controller lands unguarded                                                                            | `@UseGuards(JwtAuthGuard, AdminGuard)` is applied at **CLASS** level on every new admin controller (never method-only), mirroring `admin.controller.ts:81` and `member-groups.controller.ts:57`. Structural test G1 asserts this reflectively.                                                                                                                                                                                                                                                                                                                                     |
| **L2**  | Admin community endpoints use the system Discourse `Api-Key` (the exact privilege the member gate protects)                                | Intended: this is the _separate authorized path_. `AdminGuard`-gated and **read-only** (Decision 1) — with no write path, the blast radius is bounded to disclosure to an already-authorized admin. Documented in the controller docblock.                                                                                                                                                                                                                                                                                                                                         |
| **L3**  | Module ordering silently routes `/admin/packs` into the generic wildcard                                                                   | §7.2 + regression test G3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **L4**  | Stored `repoUrl` rendered as `<a [href]>` in the **admin** packs table could carry a `javascript:` URI (stored-XSS-into-the-admin-console) | **Still live, restated for the admin surface.** Server-side `@Matches(/^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/?$/)` on `CreatePackDto.repoUrl` / `UpdatePackDto.repoUrl`. The audience is now admins rather than members, but the mitigation is unchanged and still worth having: an admin console is a high-value target, and the field is attacker-influenced if an admin session is ever compromised. Angular's `DomSanitizer` also strips it client-side; the server remains the boundary. `notes` is rendered by plain interpolation, never `[innerHTML]`. |
| ~~L5~~  | ~~`accessNote` leaking to non-members~~                                                                                                    | **Removed by Decision 3** — no member-facing endpoint exists, and the field is renamed `notes` and is admin-only. No residual form.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ~~L6~~  | ~~Draft packs visible to members~~                                                                                                         | **Removed by Decision 3** — the `published` column is dropped entirely (§3.1). Eliminated at the root rather than defended.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ~~L7~~  | ~~Cross-cohort pack leakage~~                                                                                                              | **Removed by Decision 3** — Ptah performs no pack access control at all; `cohortKey` is a label that gates nothing. Repository access is enforced by GitHub. No residual form on the Ptah side.                                                                                                                                                                                                                                                                                                                                                                                    |
| ~~L7b~~ | ~~Cohort topology inferred from the member response~~                                                                                      | **Removed by Decision 3** — there is no member response.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **L12** | **Mis-operation risk (new, non-technical but real):** an admin edits a pack's `cohortKey` and assumes access changed                       | The field grants and revokes nothing — real access lives on GitHub. Mitigated by naming (`cohortKey`, not `requiredGroupKey`), the schema docblock stating it plainly (§3.1), and UI copy on both the list subtitle and the form's helper text (§6.4). Worth tracking as a risk because a silent no-op that an operator _believes_ revoked access is more dangerous than a visible failure.                                                                                                                                                                                        |
| **L8**  | Admin write endpoints abused (compromised admin session / runaway script)                                                                  | `AdminThrottlerGuard` per-admin-email budget on every mutation (10–30/min per §2.3), plus a full audit trail with `ipAddress` + `userAgent`.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **L9**  | Deleting the recurring master event breaks member provisioning                                                                             | §4.4 — 409 `protected_recurring_event` guard on both `id` and `recurringEventId`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **L10** | Frontend `AdminAuthGuard` mistaken for the security boundary                                                                               | It is a UX shortcut only (per `apps/ptah-landing-page/CLAUDE.md` → Guidelines). The server `AdminGuard` is the boundary; every new endpoint is independently guarded and tested.                                                                                                                                                                                                                                                                                                                                                                                                   |
| **L11** | Raw upstream errors reaching clients                                                                                                       | Both providers already sanitize (`google-calendar.provider.ts:155-166`, `discourse-admin.provider.ts:438-452`). New services map upstream failure to typed Nest exceptions with fixed `reason` codes — never `error.message` from an upstream body. All catches are `catch (error: unknown)` narrowed via `instanceof Error`.                                                                                                                                                                                                                                                      |

### 7.5 Standards compliance

- `ConfigService` only — `AdminGuard`, both providers, and all new services read config through DI. No `process.env` anywhere in new code.
- Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` (`main.ts`) applies to all new DTOs; every field carries an explicit `class-validator` decorator with a length/range cap, mirroring `member-group.dto.ts`.
- `catch (error: unknown)` + `instanceof Error` narrowing throughout.

---

## 8. Test Plan

### 8.1 New unit specs (Jest, alongside the existing 6 admin/member specs)

| Spec                                                   | Asserts                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packs/packs.service.spec.ts`                          | `listAll` orders `createdAt` desc and includes the cohort name; `cohortKey` filter narrows correctly and an unknown cohort yields `[]`; `search` targets only `title`/`slug`; `create` rejects a duplicate slug (P2002 → 409); `create`/`update` reject an unknown `cohortKey` (FK violation P2003 → 400); `cohortKey: null` accepted; `update`/`delete` 404 on missing id; audit written inside the transaction |
| `packs/admin-packs.controller.spec.ts`                 | CRUD happy paths; `repoUrl` regex rejects non-GitHub URLs and `javascript:` (L4); audit called with `actorEmail`/`ip`/`userAgent`                                                                                                                                                                                                                                                                                |
| _(no member-packs spec)_                               | **Decision 3 — there is no member-facing pack controller to test.** Its absence is asserted structurally by G6.                                                                                                                                                                                                                                                                                                  |
| `google-sessions/google-calendar.provider.spec.ts`     | `createEvent` issues POST with `conferenceDataVersion=1`; `deleteEvent` issues DELETE and folds **204 empty body** to `ok:true`; upstream 403 folds to `ok:false, status:403` with no upstream body in the message                                                                                                                                                                                               |
| `google-sessions/admin-sessions.controller.spec.ts`    | **409 `protected_recurring_event`** when `eventId === BUILDERS_SESSION_EVENT_ID` **and** when `recurringEventId` matches; upstream 403 → 503 `calendar_write_unavailable`; `calendarWritable` reflects `hasCalendarWriteScope()`                                                                                                                                                                                 |
| `discourse/admin-community.controller.spec.ts`         | feature-off → `{topics:[],enabled:false}` and `{items:[],count:0,reviewUrl:null}`; provider error → empty list not 500, no upstream body forwarded; **read-only** — no mutation is reachable                                                                                                                                                                                                                     |
| `member-groups/member-groups.service.spec.ts` (extend) | `listMembers` pagination + email search + 404 on unknown group                                                                                                                                                                                                                                                                                                                                                   |

### 8.2 Structural guard tests — `admin-guards.spec.ts` (NEW, high value)

Cheap reflective assertions that survive refactors and catch L1/L3 directly:

- **G1** — for each of `AdminPacksController`, `AdminSessionsController`, `AdminCommunityController`, `MemberGroupsController`: `Reflect.getMetadata('__guards__', Controller)` contains **both** `JwtAuthGuard` and `AdminGuard`.
- **G2** — ~~`MemberPacksController` guard assertion~~ — **dropped with Decision 3**; that controller is never created. Its non-existence is instead asserted by **G6** below, which is the stronger check.
- **G3** — module-order regression: instantiate a `Test.createTestingModule` app from `AppModule` and assert `GET /api/v1/admin/packs` resolves to `AdminPacksController`, not `AdminController`. (Fails loudly if `PacksModule` is registered after `AdminModule`.)
- **G4** — source-level assertion that `builders-membership.service.ts` contains no reference to `ADMIN_EMAILS` / `AdminGuard` / `isAdmin`.
- **G5** — **`AdminCommunityController` exposes only `@Get` handlers.** Enumerate its prototype methods and assert every one carries `RequestMethod.GET` metadata (`Reflect.getMetadata('method', handler) === RequestMethod.GET`). This is the executable form of Decision 1: a future contributor adding a moderation write to this controller fails the build rather than quietly reopening the surface.
- **G6** — **`PacksModule` registers no member-facing controller.** Assert every controller in `PacksModule`'s metadata has a `path` beginning `v1/admin/`. This is the executable form of Decision 3, and it is the cheapest possible guard on the whole architecture: packs may never acquire a member endpoint by accident.

### 8.3 ~~New integration smoke — `scripts/packs-gate-smoke.mjs`~~ — **dropped**

**Decision: do NOT write this script. It is removed from the plan.**

It was justified when packs had a member-facing endpoint: it proved a _pack-specific_ gate (membership) and later a second one (cohort isolation). Decision 3 deleted both gates — Ptah now performs no pack access control whatsoever, so **there is no pack gate left to prove.**

What the script would have degenerated into is "an admin can reach `/admin/packs`; a non-admin gets 403." That assertion is already covered three times over, and better:

- **G1** (§8.2) asserts `AdminPacksController` carries `JwtAuthGuard` + `AdminGuard` at class level — structurally, at build time, with no docker stack required.
- **`admin-packs.controller.spec.ts`** covers the handler behaviour in unit tests.
- `AdminGuard` itself is already exercised against nine existing admin models by `admin.service.spec.ts` and the existing admin surface; it is not new code and does not need per-feature live re-proof.

Shipping a near-empty integration smoke that duplicates a structural test would add a docker-dependent, seed-and-cleanup-heavy script to the repo's maintenance surface in exchange for zero marginal signal — and a low-signal test is worse than no test, because it invites the assumption that packs _have_ a gate under test.

**What still proves the feature's premise live:** `community-gate-smoke.mjs` (unchanged) plus the V4 manual pass (§8.6). Per §7.3, the "admin without a Builders membership" demonstration now rests on the sessions and community pairs, where both sides read the same underlying data — a strictly better demonstration than the packs pair ever was.

> Consequence: `scripts/packs-gate-smoke.mjs` is removed from the CREATE list (§10) and verification step **V3** is deleted (§9). `scripts/google-calendar-write-smoke.mjs` is unaffected and remains a blocking gate.

### 8.4 New integration smoke — `scripts/google-calendar-write-smoke.mjs`

Per §4.2 Mechanism 2. **Blocking gate on Batch B3.** Also asserts the §4.4 guard: `DELETE /api/v1/admin/sessions/{BUILDERS_SESSION_EVENT_ID}` → **409**.

### 8.5 Regression proof — the two existing scripts, unchanged

Run **verbatim, with zero edits to either file**, after backend work lands and again after frontend work lands:

```
node scripts/community-gate-smoke.mjs     # → must exit 0
node scripts/discourse-e2e.mjs            # → must exit 0
```

Prerequisites (per `context.md` → Dev Environment): `npm run docker:up` (postgres :5432, license-server :3000, Discourse :3001) and `JWT_SECRET` present in `.env`.

Combined with the §7.1 `git diff --name-only` check printing nothing, this is the complete invariant proof: _the gated files did not change, and the tests over them still pass._

### 8.6 Frontend verification

- `nx lint ptah-landing-page`, `nx test ptah-landing-page`
- `nx build ptah-landing-page --configuration=production` → **no budget warning** (§6.5)
- Manual, per `context.md` dev notes: log in as `abdallah@miramarstaffing.com` (user `674888a2-b28b-4d83-87c8-8c30d971edc1`, holds a `community` license and **no** Builders membership) and confirm all three of:
  1. `/admin/builders/sessions` lists the Google Calendar sessions, and `/admin/builders/community` lists the Discourse topics — **without a Builders membership**;
  2. `/members` still shows the Builders gate for that same account;
  3. `/admin/builders/packs` supports full CRUD.

  Items 1 + 2 together are the feature's entire premise, demonstrated on the same account in the same session — the admin sees Builders content through the admin path while the member path still refuses them.

---

## 9. Batched Task Breakdown

Dependencies are strict; batches with the same letter+number may run in parallel.

### Backend

| Batch                                    | Tasks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Depends on     | Notes                                                                                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1 — Packs foundation**                | Prisma `Pack` model (admin registry: `cohortKey` FK → `MemberGroup.key`, `onDelete: SetNull`, **no `published` column**) + `MemberGroup.packs` back-relation → migration `20260801120000_add_packs` → `nx prisma:generate` → `packs.types.ts`, `dto/pack.dto.ts` (incl. `repoUrl` GitHub regex + optional `cohortKey`), `packs.service.ts` (`listAll` + `getById` — **admin only, no member read path**), `admin-packs.controller.ts`, `packs.module.ts` → register in `app.module.ts` **before `AdminModule`** → extend `AdminAuditAction`/`AdminAuditTargetType` | —              | Highest-value, fully independent. Start here. ⛔ **No member-facing controller** (Decision 3). `PacksModule` needs only the `@Global()` `PrismaService` + `AuditLogService` — no `BuildersMembershipService`, no `MemberGroupsService`. |
| **B2 — Calendar write plumbing** ⚠️ gate | Widen `request()` verbs; add `createEvent`/`patchEvent`/`deleteEvent`; surface `scope` + `hasCalendarWriteScope()` in `google-auth.provider.ts`; add `scripts/google-calendar-write-smoke.mjs` → **run it**                                                                                                                                                                                                                                                                                                                                                        | —              | **BLOCKING.** If the smoke fails on scope, execute the §4.3 re-consent runbook before B3. Runs in parallel with B1.                                                                                                                     |
| **B3 — Admin sessions API**              | `dto/admin-session.dto.ts`, `admin-sessions.service.ts` (incl. §4.4 recurring-master 409 + upstream-403 → 503 mapping), `admin-sessions.controller.ts`; register in `google-sessions.module.ts` (+ local `AdminGuard`/`AdminThrottlerGuard` providers)                                                                                                                                                                                                                                                                                                             | **B2 green**   | ⛔ `members.controller.ts` untouched.                                                                                                                                                                                                   |
| **B4 — Admin community API (read-only)** | `dto/admin-community.dto.ts` (query DTOs only), `admin-community.service.ts`, `admin-community.controller.ts` (**`@Get` handlers only**); add `getReviewQueue()` GET to `DiscourseAdminProvider` — **no verb widening, no write method, no moderation DTO, no audit action**                                                                                                                                                                                                                                                                                       | —              | Parallel with B1/B2. Materially smaller than originally scoped (Decision 1). ⛔ `community.controller.ts` + `builders-membership.service.ts` untouched.                                                                                 |
| **B5 — Group members listing**           | `MemberGroupsService.listMembers` + `ListGroupMembersQueryDto` + `GET /admin/groups/:id/members`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —              | Small; closes the gap flagged at `groups-list.ts:25-28`. Parallel.                                                                                                                                                                      |
| **B6 — Backend tests**                   | All specs in §8.1 + §8.2 (incl. structural tests **G5** and **G6**)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | B1, B3, B4, B5 | No `packs-gate-smoke.mjs` — dropped with justification in §8.3.                                                                                                                                                                         |

### Frontend

| Batch                              | Tasks                                                                                                                                                                                                                                                              | Depends on                                   | Notes                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **F1 — API client**                | Extract `validate()` → `services/validate-response.ts`; new `admin-builders-api.service.ts` (schemas + **12** methods, no community write)                                                                                                                         | B1 (packs contract), B3, B4, B5 for the rest | Can begin against the §2.3 endpoint table before the backend merges. ⛔ `members-api.service.ts` **not touched** (Decision 3).   |
| **F2 — Routes + nav**              | 4 route entries **before `':model'`** in `admin.routes.ts`; `Builders Content` nav group in `admin-nav.config.ts`                                                                                                                                                  | —                                            | Tiny; unblocks F3.                                                                                                               |
| **F3a — Packs UI**                 | `PacksList` (cohort column + "No cohort" chip + cohort filter + "access is granted on GitHub" subtitle), `PackFormModal` (**cohort `<select>` fed by `AdminApiService.listGroups()`**, "Not tied to a cohort" default + label-only helper text), `DeletePackModal` | F1, F2                                       | Mirrors `GroupsList` + `GroupFormModal`. The only new frontend cross-service coupling in the plan. Copy matters here (risk L12). |
| **F3b — Sessions UI**              | `SessionsList`, `SessionFormModal` (incl. `calendarWritable` read-only degradation + recurring-master delete disabled)                                                                                                                                             | F1, F2, **B2 green**                         |                                                                                                                                  |
| **F3c — Community UI**             | `CommunityView` — **read-only**: topic list, per-row "Open in Discourse" links, review-queue `StatTile` linking to `{DISCOURSE_URL}/review`, `EmptyState` when unconfigured. No toggles, no modals.                                                                | F1, F2                                       | Smaller than originally scoped (Decision 1).                                                                                     |
| **F3d — Groups drill-down**        | `DetailDrawer` members panel in existing `GroupsList` + per-row Remove                                                                                                                                                                                             | F1, F2, B5                                   | Smallest of the four.                                                                                                            |
| ~~**F4 — Members packs surface**~~ | **DROPPED (Decision 3).** No member-facing pack surface exists. `members-page.component.ts` and `members-api.service.ts` are not modified by this task at all.                                                                                                     | —                                            | The `artifactPlaceholders` grid (lines 323-339) stays exactly as it is.                                                          |
| **F5 — Frontend verification**     | lint, test, prod build + budget check                                                                                                                                                                                                                              | F3a–d                                        |                                                                                                                                  |

### Verification (final)

| Batch      | Tasks                                                                                                                                                                             | Depends on |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **V1**     | `git diff --name-only` over the 5 protected paths → must print nothing (§7.1)                                                                                                     | all        |
| **V2**     | `node scripts/community-gate-smoke.mjs` → exit 0 · `node scripts/discourse-e2e.mjs` → exit 0 (both files unmodified)                                                              | all        |
| ~~**V3**~~ | ~~`node scripts/packs-gate-smoke.mjs`~~ — **dropped**, see §8.3 (no pack gate remains to prove; G1 + G6 + the controller spec cover it structurally)                              | —          |
| **V4**     | Manual pass as `abdallah@miramarstaffing.com` — the 3-part check in §8.6: admin sessions **and** community visible without a membership, `/members` still gated, packs CRUD works | all        |
| **V5**     | `nx lint ptah-license-server`, `nx test ptah-license-server`, `npm run typecheck:all`                                                                                             | all        |

**Suggested critical path:** B1 ∥ B2 ∥ B4 ∥ B5 → B3 → B6 ∥ F1 → F2 → F3a ∥ F3b ∥ F3c ∥ F3d → F5 → V1, V2, V4, V5.

---

## 10. Team-Leader Handoff

**Developer split:** `backend-developer` (B1–B6) ∥ `frontend-developer` (F1–F5). Overlap only in the §2.3 endpoint table, which is the contract between them — freeze it before both start.

**Complexity:** MEDIUM-HIGH. **Estimate:** 16–22 hours (backend 10–13, frontend 6–9), excluding a Google re-consent detour if B2's smoke fails on scope. Decision 1 removed ~2h of moderation write work; Decision 3 removed a further ~3h (member controller + its spec + the cohort query + the gate smoke + the members-page surface) and simplified the model.

**Files affected summary**

_CREATE (backend, 13):_ `packs/{packs.module,packs.service,packs.types,admin-packs.controller}.ts`, `packs/dto/pack.dto.ts`, `packs/{packs.service,admin-packs.controller}.spec.ts`, `google-sessions/{admin-sessions.controller,admin-sessions.service}.ts` + `dto/admin-session.dto.ts` + 2 specs, `discourse/{admin-community.controller,admin-community.service}.ts` + `dto/admin-community.dto.ts` + 1 spec, `admin/admin-guards.spec.ts`, `prisma/migrations/20260801120000_add_packs/migration.sql`.
_CREATE (scripts, 1):_ `scripts/google-calendar-write-smoke.mjs`.
_CREATE (frontend, 8):_ `services/{validate-response,admin-builders-api.service}.ts`, `pages/admin/builders/packs/{packs-list, components/pack-form-modal, components/delete-pack-modal}`, `pages/admin/builders/sessions/{sessions-list, components/session-form-modal}`, `pages/admin/builders/community/community-view`.

_MODIFY (backend, 11):_ `prisma/schema.prisma`, `app/app.module.ts`, `audit/audit-log.types.ts`, `google-sessions/{google-calendar.provider,google-auth.provider,google-sessions.types,google-sessions.module}.ts`, `discourse/{discourse-admin.provider,discourse.types,discourse.module}.ts`, `member-groups/{member-groups.service,member-groups.controller}.ts`.
_MODIFY (frontend, 4):_ `admin.routes.ts`, `admin-layout/admin-nav.config.ts`, `services/admin-api.service.ts` (import extracted `validate`), `pages/admin/groups/groups-list/groups-list.{ts,html}`.

_⛔ MUST NOT MODIFY (5):_ `discourse/builders-membership.service.ts`, `discourse/community.controller.ts`, `google-sessions/members.controller.ts`, `scripts/community-gate-smoke.mjs`, `scripts/discourse-e2e.mjs`.

_✅ No longer touched at all (Decision 3):_ `services/members-api.service.ts`, `pages/members/members-page.component.ts`. **This task now modifies zero files on the member path, front or back.**

**Critical verification points for the developer**

1. `PacksModule` registered in `app.module.ts` **before** `AdminModule` — otherwise `/api/v1/admin/packs` 400s (§7.2).
2. New admin routes declared **before** `':model'` in `admin.routes.ts` (§6.1).
3. `@UseGuards(JwtAuthGuard, AdminGuard)` at **class** level on every new admin controller — verified against `member-groups.controller.ts:57`.
4. Every new feature module declares `AdminGuard` + `AdminThrottlerGuard` in its own `providers` array — verified against `member-groups.module.ts:28`.
5. B2's calendar smoke passes **before** any session-write UI is built.
6. §4.4 recurring-master 409 guard checks **both** `eventId` and `recurringEventId`.
7. Zero diff on the five protected files.
8. `AdminCommunityController` contains **only `@Get` handlers** — no moderation writes (Decision 1, test G5).
9. `PacksModule` registers **no member-facing controller** and injects neither `BuildersMembershipService` nor `MemberGroupsService` (Decision 3, test G6).
10. The `Pack` model has **no `published` column**, and `cohortKey` is named as the label it is — not `requiredGroupKey` (§3.1, risk L12). UI copy on `PacksList` and `PackFormModal` must state that access is granted on GitHub.

---

## 11. Resolved Decisions (Checkpoint 1)

Both open questions were answered by the user. The plan above is fully revised to match; nothing here is outstanding.

### Decision 1 — Discourse moderation: dropped entirely

> _"for the discourse moderation lets leave that through discourse admin panel only"_

**Resolved: no write actions.** All Discourse moderation lives in Discourse's own admin panel, which the admin already reaches as a full Discourse admin (`061a19ab7`).

- **Removed:** endpoint #13 (`PUT /admin/community/topics/:topicId/status`), the `TopicStatusDto`, the `community.topic.status` audit action, the `DiscourseTopic` audit target type, the per-row toggles in the community view, and leak risk L7-as-originally-written (`status` injection surface — now non-existent).
- **Kept:** endpoints #11 (recent topics) and #12 (review queue), both read-only. The user removed _moderation_, not _visibility_ — surfacing member community content to a non-Builders admin is the founding premise of this task. The view is now a pure triage/awareness surface.
- **Handoff to Discourse:** every topic row carries an "Open in Discourse" deep link; the view carries a top-level link to `{DISCOURSE_URL}/review`. These are the only paths to an action.
- **Knock-on simplifications:** `DiscourseAdminProvider` needs **no verb widening** (only one new `GET`); no moderation DTO; no audit wiring; the component is renamed `CommunityView` so its name cannot imply a capability it lacks; and structural test **G5** asserts the controller exposes only `@Get` handlers, so the surface cannot be quietly reopened later.
- **Sections revised:** §0, §2.2, §2.3, §2.4, §5 (rewritten), §6.1, §6.3, §6.4, §7.4 (L2), §8.1, §8.2 (G5 added), §9 (B4, F3c), §10.

### ~~Decision 2 — Packs are cohort-scoped~~ — ⚠️ **SUPERSEDED BY DECISION 3**

> **This decision is no longer in effect.** Jump to **Decision 3** below for the design that ships. The text is retained verbatim so the reasoning trail survives — in particular the FK-targets-`key` analysis, which Decision 3 keeps (the field remains a `MemberGroup.key` FK with `onDelete: SetNull`), and the cohort-scoping analysis, which Decision 3 discards entirely. Where the two conflict, **Decision 3 wins**: there is no member-facing pack endpoint, no `published` column, no cohort-visibility query, and the field is named `cohortKey`, not `requiredGroupKey`.

> _"packs will be shared individually with each cohort and each one will get its own repo"_

~~**Resolved: Option B — a nullable FK from `Pack` to `MemberGroup`.**~~

- **Column shape chosen: `requiredGroupKey String?` as a real FK to `MemberGroup.key`** (not `id`). Justified at length in §3.1: `MemberGroupsService.getGroupsForUser()` already returns `{ key, name }[]`, so a key-targeted FK lets the caller's cohort list drop straight into the `WHERE` clause with no translation query and no change to a method consumed by four other call sites; `key` is `@unique` and _deliberately immutable_ (`member-group.dto.ts:53`), making it a sound natural key; and it is a genuine Postgres FK, so integrity is preserved either way.
- **`onDelete: SetNull`** — deleting a cohort demotes its packs to general-purpose rather than destroying authored content backed by a real repository. Follows the `MarketingCampaign.template` precedent (`schema.prisma:225`). Currently unreachable (no cohort DELETE route exists), so it is defensive proofing for a future feature.
- **`null` = visible to every active Builder** — an explicit escape hatch for a general-purpose pack, surfaced in the UI as a deliberate "All Builders" chip rather than blank data.
- **One pack = one repo** — `repoUrl` already delivers this; recorded explicitly in the model docblock so the intent survives.
- **Security-critical query change (§3.3):** `listPublished()` becomes `listVisibleTo(userId)`, reusing `getGroupsForUser` and filtering **in SQL** — `published = true AND (requiredGroupKey IS NULL OR requiredGroupKey IN <caller's keys>)` — never a JS post-filter. `published` sits outside the `OR` so it ANDs against both branches. The method takes only a `userId` and has no parameter that can widen the result set.
- **Admin path unaffected:** `GET /admin/packs` still returns every pack across every cohort including drafts, with a `groupKey` filter and a cohort column added.
- **Frontend:** `PackFormModal` gains a cohort `<select>` with an explicit "All Builders (no cohort)" option, fed by the existing `AdminApiService.listGroups()` — the one new cross-service dependency, flagged in §6.4 and batch F3a.
- **Proof:** `packs-gate-smoke.mjs` (§8.3) now asserts a second matrix — a Builder in cohort A sees A's pack and the unscoped pack but **never** B's pack; a Builder in no cohort sees only the unscoped pack (also covering the empty-`IN ()` edge). New leak risks **L7** (cross-cohort visibility) and **L7b** (cohort topology inference) added to §7.4, with matching `packs.service.spec.ts` assertions.
- ~~**Sections revised:** §0, §2.3, §3.1, §3.2, §3.3, §6.3, §6.4, §7.4, §8.1, §8.3, §9 (B1, F1, F3a), §10.~~ _(All since re-revised by Decision 3.)_

### Decision 3 — Packs are an admin-only registry; distribution moves to GitHub

> _"i think we are complicating the cohort scoped packs, i think its easier i would be sharing the repo for each cohort inside the cohort so each member will get their pack through github not through us"_

**Resolved: Ptah stores a bookkeeping record and nothing else.** The admin grants cohort members access **on GitHub** — collaborator invites, a GitHub team, or the repo link posted inside that cohort's Discourse group (which already has gated forum access via the existing `syncNamedGroupMembership` fan-out). Ptah never serves pack content and never decides who may access a pack.

This supersedes Decision 2's cohort-scoping design in full.

**Removed entirely** (deleted, not deferred):

| Removed                                                                                          | Was                                                       |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `GET /api/v1/members/packs`                                                                      | endpoint #6                                               |
| `packs/packs.controller.ts` (`MemberPacksController`) + its spec                                 | the member-gated controller                               |
| `PacksService.listVisibleTo(userId)` + the cohort `OR` predicate                                 | the cohort-visibility query                               |
| `PacksModule` → `BuildersMembershipService` and → `MemberGroupsService`                          | both gate dependencies                                    |
| `published` column + `@@index([published, …])` + the `published` list filter                     | the member-visibility flag                                |
| `memberPackSchema`, `MembersApiService.getPacks()`, the members-page packs section, batch **F4** | the entire frontend member surface                        |
| `scripts/packs-gate-smoke.mjs` + verification step **V3**                                        | the pack gate smoke — **see the justification in §8.3**   |
| Leak risks **L5, L6, L7, L7b**                                                                   | all four were member-path risks; none has a residual form |

**Changed:**

- **`requiredGroupKey` → `cohortKey`.** The old name asserted a precondition that no longer exists; after Decision 3 the field grants and revokes nothing, so a name implying enforcement would mislead the next contributor into building on a guarantee that isn't there. The FK to `MemberGroup.key` and `onDelete: SetNull` are **kept** — still correct, now purely for label integrity and so a cohort deletion unlabels rather than erases the registry row.
- **`accessNote` → `notes`, kept.** It was "private-repo instructions shown to members"; with no member surface it becomes an internal admin note — and it genuinely earns its place in the new manual workflow (recording _"invited @founding-cohort as a GitHub team on 2026-08-01"_ is exactly the bookkeeping this table exists for). Renamed so it can't imply it's shown to anyone.
- **`published` dropped, not repurposed.** Its only consumer was the member gate. A draft/live distinction would be speculative machinery; an admin who isn't ready simply doesn't create the row, and `notes` covers "repo exists, invites pending." Dropping it eliminates leak risk L6 at the root.
- **Indexes reduced to one** (`@@index([cohortKey])`). No `createdAt` index: one repo per cohort means a handful to low dozens of rows, which Postgres seq-scans regardless — an index there would be maintenance cost with no read benefit. Justified in §3.1.
- **`repoUrl` validation kept**, restated as **L4** for the admin surface: the URL renders as an `<a [href]>` in the admin console, so the GitHub regex still guards a stored-XSS path — the audience changed, the mitigation didn't.
- **New risk L12 (mis-operation).** An admin could edit `cohortKey` believing it changed access. It doesn't. Mitigated by the field name, the schema docblock, and explicit UI copy on both the list subtitle and the form helper text (§6.4). Tracked because a silent no-op an operator _believes_ revoked access is more dangerous than a visible failure.
- **§7.3's authorization table loses its member row.** The "admin without a Builders membership" proof now rests on the **sessions and community pairs**, which demonstrate the same property _better_ — both sides read the same underlying data, and the member side is already covered live by the unmodified `community-gate-smoke.mjs`.

**Why this is the right call architecturally, not merely simpler:** the member gate and the cohort gate were two things that could be got wrong, in a feature whose defining constraint is "do not weaken the member gate." Both are now gone rather than defended. Ptah stores a URL and a label; GitHub — a system purpose-built for repository access control, which the admin already operates — decides who may read the code. The feature's entire footprint is behind `AdminGuard`, and this task now modifies **zero files on the member path**, front or back.

- **Sections revised:** §0, §2.2, §2.3, §3.1, §3.2, §3.3, §6.3, §6.4, §7.1, §7.3, §7.4, §8.1, §8.2 (G6 added), §8.3, §8.6, §9 (B1, B6, F1, F3a, F4 dropped, V3 dropped), §10.

### Unchanged by these decisions

The module topology decision (§2.1–2.2), the §7.2 module-registration-order landmine (still applies to `PacksModule` — it must be imported before `AdminModule`), the §4.4 recurring-master-event guard, the two-mechanism Google Calendar scope verification (§4.2), its fallback (§4.3), the blocking B2 calendar smoke, and the five MUST-NOT-MODIFY files (§7.1) all stand exactly as originally planned.

Decision 1 (community read-only + the G5 structural test) is also unaffected by Decision 3 — the two are independent.
