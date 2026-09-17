# Implementation Plan - TASK_2026_462_c819

## Inputs and constraints

- Requirements used: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_462_c819\context.md`; `D:\projects\ptah-extension\.ptah\specs\TASK_2026_462_c819\task-description.md`; `D:\projects\ptah-extension\CLAUDE.md`; `D:\projects\ptah-extension\apps\ptah-license-server\CLAUDE.md`; the backend, Prisma, frontend, and panel UI sources named by the request.
- Corrections applied: the four open decisions in `task-description.md` are superseded by the caller's resolved decisions: no bulk removal; matching approval selection is capped at 50 eligible ids and reports the eligible match count; CSV is server-generated, formula-safe, and audited; clearing optional filters retains the lifecycle stage.
- Design handoff used: none. There is no visual design artifact in the task folder; the existing `DetailDrawer`, `SelectionToolbar`, and `StatusBadge` contracts are the design source.
- Missing decision-critical input: none. The requested public contracts and dependency direction can be derived from the requirements and established repository patterns.
- Scope boundary: production source remains split between a backend executor and a frontend executor. `libs/web/panel-ui/**` is read-only reuse; no Prisma schema or migration is required; no `libs/api-contracts/**` file changes.

## Codebase evidence

| Evidence                                                                                                                                                                                                    | Location                                                                                                                                                                                                                                                                                                                                                                                        | Architectural implication                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verified:** web product API and web UI may share contracts only through `libs/api-contracts`, but existing admin waitlist contracts intentionally use backend-local interfaces plus frontend Zod mirrors. | `CLAUDE.md:73`; `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.types.ts:10`; `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.types.ts:17`                                                                                                                                                                                                                              | Keep the new admin waitlist wire shapes duplicated: backend TypeScript interfaces beside the handler, frontend Zod schemas at the HTTP boundary. Do not broaden the community contracts library into a waitlist contract package.         |
| **Verified:** the generic list endpoint uses one `ListQueryDto.filter` string and combines only search plus that one filter; every model shares this parser.                                                | `libs/api/admin/src/lib/admin.dto.ts:25`; `libs/api/admin/src/lib/admin.dto.ts:53`; `libs/api/admin/src/lib/admin.service.ts:163`; `libs/api/admin/src/lib/admin.service.ts:429`; `libs/api/admin/src/lib/admin.service.ts:461`                                                                                                                                                                 | Do not extend the generic parser with waitlist-only stage/date semantics. A dedicated waitlist query surface has lower blast radius and leaves existing single-filter clients unchanged.                                                  |
| **Verified:** generic model field names are security-critical allowlists, and the current waitlist generic config exposes historical timestamp-presence filters that overlap.                               | `libs/api/admin/src/lib/admin-models.config.ts:1`; `libs/api/admin/src/lib/admin-models.config.ts:346`; `libs/api/admin/src/lib/admin-models.config.ts:365`                                                                                                                                                                                                                                     | Preserve the generic config for existing generic CRUD, but stop using it from the Waitlist Pipeline. Dedicated DTO enums and literal Prisma predicates become authoritative for the pipeline.                                             |
| **Verified:** the current list query performs `findMany` and `count` in one transaction, defaults to page 1/page size 25, and caps page size at 100.                                                        | `libs/api/admin/src/lib/admin.service.ts:159`; `libs/api/admin/src/lib/admin.service.ts:188`; `libs/api/admin/src/lib/admin.dto.ts:25`; `libs/api/admin/src/lib/admin.dto.ts:32`                                                                                                                                                                                                                | The dedicated waitlist list keeps server pagination and the same default/max posture, but narrows selectable page sizes to 10/25/50/100 for a stable UI contract.                                                                         |
| **Verified:** waitlist lifecycle facts are three independent nullable timestamps; `convertedAt` is paid, `approvedAt` is a free grant, and `notifiedAt` is historical.                                      | `apps/ptah-license-server/prisma/schema.prisma:459`; `apps/ptah-license-server/prisma/schema.prisma:462`; `apps/ptah-license-server/prisma/schema.prisma:471`; `apps/ptah-license-server/prisma/schema.prisma:474`; `apps/ptah-license-server/prisma/schema.prisma:478`                                                                                                                         | Define stage once using Converted > Approved > Invited > New and reuse its literal predicates for listing, stage counts, eligible-id resolution, details, and export.                                                                     |
| **Verified:** current stats count raw timestamp presence independently and derive attention as total minus raw notified.                                                                                    | `libs/api/admin/src/lib/admin.service.ts:341`; `libs/api/admin/src/lib/admin.service.ts:356`; `libs/api/admin/src/lib/admin.service.ts:372`; `libs/api/admin/src/lib/admin.service.ts:375`                                                                                                                                                                                                      | Replace pipeline-facing stage counts with disjoint predicates. Keep raw `notified` only as a separately named historical metric because the existing Overview funnel consumes it; it is explicitly excluded from the stage-sum invariant. |
| **Verified:** approval accepts 1-50 explicit string ids, always returns all five outcome totals, and reports per-row results under HTTP 200 after validation.                                               | `libs/api/admin/src/lib/admin.dto.ts:130`; `libs/api/admin/src/lib/admin.dto.ts:155`; `libs/api/admin/src/lib/admin-waitlist.controller.ts:63`; `libs/api/admin/src/lib/admin-waitlist.controller.ts:69`; `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.types.ts:98`                                                                                                              | Matching selection resolves at most 50 explicit ids, and bulk approval continues through the existing endpoint/modal instead of adding a second mutation path.                                                                            |
| **Verified:** the current approval claim guards only `approvedAt`, while the product requirement makes `convertedAt` ineligible too.                                                                        | `libs/api/marketing/src/lib/waitlist/waitlist.service.ts:229`; `libs/api/marketing/src/lib/waitlist/waitlist.service.ts:242`; `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.ts:297`                                                                                                                                                                                       | Harden the claim predicate to require both `approvedAt: null` and `convertedAt: null`; a converted row maps to the already-existing `already_paid` outcome so the public five-outcome contract does not expand.                           |
| **Verified:** waitlist ingestion's canonical normalization is `trim().toLowerCase()`, and signup persists that normalized address.                                                                          | `libs/api/marketing/src/lib/waitlist/waitlist.service.ts:73`; `libs/api/marketing/src/lib/waitlist/waitlist.service.ts:77`; `libs/api/marketing/src/lib/waitlist/waitlist.service.ts:90`; `libs/api/marketing/src/lib/waitlist/waitlist.service.ts:254`                                                                                                                                         | Details lookup normalizes the waitlist email with the same rule before a case-insensitive user lookup; no raw email is used as a dynamic field.                                                                                           |
| **Verified:** users own license, subscription, and group-assignment relations; assignments expose their group and assignment metadata.                                                                      | `apps/ptah-license-server/prisma/schema.prisma:25`; `apps/ptah-license-server/prisma/schema.prisma:34`; `apps/ptah-license-server/prisma/schema.prisma:37`; `apps/ptah-license-server/prisma/schema.prisma:101`; `apps/ptah-license-server/prisma/schema.prisma:122`; `apps/ptah-license-server/prisma/schema.prisma:129`                                                                       | Details can load the linked account graph in one on-demand user query with nested selects, avoiding per-list-row relationship reads.                                                                                                      |
| **Verified:** successful approval writes `waitlist.approve` with `targetType: 'Waitlist'` and `targetId: row.id`; its metadata contains user, license, duration, cohort, and notification facts.            | `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.ts:347`; `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.ts:354`; `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.ts:357`; `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.ts:358`; `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.ts:359` | Drawer audit history queries the directly attributable `Waitlist`/waitlist-id rows newest-first and projects an allowlisted metadata view.                                                                                                |
| **Verified:** the complimentary-license core also writes `license.complimentary.issue`, but omits `targetId` because it audits before license creation.                                                     | `libs/api/licensing/src/lib/license/services/license.service.ts:571`; `libs/api/licensing/src/lib/license/services/license.service.ts:644`; `libs/api/licensing/src/lib/license/services/license.service.ts:647`; `libs/api/licensing/src/lib/license/services/license.service.ts:648`; `libs/api/licensing/src/lib/license/services/license.service.ts:649`                                    | Do not guess-link those audit rows to a waitlist entry. Licenses are returned from the user relation; audit history remains the reliable `Waitlist` target stream.                                                                        |
| **Verified:** `AuditLogService.write` supports non-transactional compliance events and stores safe metadata without logging snapshots.                                                                      | `libs/api/audit/src/lib/audit-log.service.ts:25`; `libs/api/audit/src/lib/audit-log.service.ts:39`; `libs/api/audit/src/lib/audit-log.service.ts:52`; `libs/api/audit/src/lib/audit-log.service.ts:73`                                                                                                                                                                                          | Add `waitlist.export` to the closed action union and fail the export closed if its audit write fails, so PII cannot be downloaded without attribution.                                                                                    |
| **Verified:** controller body/query DTO validation requires an explicit `dtoPipe(Dto)` because runtime type metadata is absent; a structural server spec enforces it.                                       | `libs/api/core/src/lib/common/dto-validation.pipe.ts:20`; `libs/api/core/src/lib/common/dto-validation.pipe.ts:39`; `libs/api/core/src/lib/common/dto-validation.pipe.ts:69`; `libs/api/admin/src/lib/admin-waitlist.controller.ts:37`; `apps/ptah-license-server/src/common/controller-validation.spec.ts:543`                                                                                 | Every new `@Query()` and whole-object `@Param()` binding names its DTO explicitly, and the structural census floor is updated for the three new query bindings plus one param binding.                                                    |
| **Verified:** the waitlist component is standalone, OnPush, URL-driven only for `tab`, signal-based, and currently derives overlapping filters and incorrect New totals.                                    | `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:83`; `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:120`; `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:155`; `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:232`                                                                                                                                                   | Keep `WaitlistPipeline` as the smart orchestrator, replace local stage derivation with validated server fields, and move the expanded filter/row/drawer concerns into named OnPush components/state.                                      |
| **Verified:** the admin API client is stateless, uses Observables, and validates server responses with Zod schemas local to the service.                                                                    | `libs/web/admin/src/lib/services/admin-api.service.ts:147`; `libs/web/admin/src/lib/services/admin-api.service.ts:440`; `libs/web/admin/src/lib/services/admin-api.service.ts:457`; `libs/web/admin/src/lib/services/admin-api.service.ts:475`; `libs/web/admin/src/lib/services/admin-api.service.ts:622`                                                                                      | Add waitlist-specific methods and closed Zod schemas here; Batch B depends on the documented wire contract, not backend implementation files.                                                                                             |
| **Verified:** shared drawer chrome provides modal role, accessible label, initial focus, Escape/backdrop close, and inert closed content, but it does not restore focus to the opener.                      | `libs/web/panel-ui/src/lib/detail-drawer/detail-drawer.ts:13`; `libs/web/panel-ui/src/lib/detail-drawer/detail-drawer.ts:21`; `libs/web/panel-ui/src/lib/detail-drawer/detail-drawer.ts:43`; `libs/web/panel-ui/src/lib/detail-drawer/detail-drawer.html:24`; `libs/web/panel-ui/src/lib/detail-drawer/detail-drawer.html:40`                                                                   | Reuse it read-only. The waitlist parent records the triggering element and restores focus after the drawer emits `closed`.                                                                                                                |
| **Verified:** shared selection toolbar is dumb projected chrome, and status badge already supplies text plus semantic icon rather than color alone.                                                         | `libs/web/panel-ui/src/lib/selection-toolbar/selection-toolbar.ts:9`; `libs/web/panel-ui/src/lib/selection-toolbar/selection-toolbar.ts:33`; `libs/web/panel-ui/src/lib/status-badge/status-badge.ts:19`; `libs/web/panel-ui/src/lib/status-badge/status-badge.ts:90`                                                                                                                           | Reuse both unchanged; selection scope/disclosure remains waitlist-owned state, and lifecycle badges remain accessible without widening panel-ui.                                                                                          |

## Architecture decision

- Chosen approach: add a dedicated guarded `v1/admin/waitlist` read surface backed by `AdminWaitlistService`, while retaining `POST v1/admin/waitlist/approve`. Centralize disjoint stage predicates in a backend waitlist query module; expose list, eligible-id resolution, server CSV export, and details routes from the existing waitlist controller. Keep the generic `AdminService.list` parser unchanged.
- Rationale: **Verified** the generic parser is shared by nine admin models and accepts only one `field:value` filter (`libs/api/admin/src/lib/admin.service.ts:429`, `libs/api/admin/src/lib/admin-models.config.ts:111`). Waitlist needs compound date/source/stage semantics, cross-model details, export, and capped id resolution that do not generalize to the other models. A dedicated service also follows the existing decision to keep multi-domain approval orchestration out of generic `AdminService` (`libs/api/admin/src/lib/admin.module.ts:43`).
- Rejected alternatives:
  - Extending `ListQueryDto` and `AdminModelConfig` with generic filter arrays/date operators: rejected because it changes the dynamic Prisma boundary for every model, forces unrelated callers to understand operator syntax, and still does not cover details/export/audit cleanly.
  - Client-side filtering/export/select-matching: rejected because the current endpoint is paginated and requirements demand all filtered matches; current code intentionally performs pagination server-side (`libs/api/admin/src/lib/admin.service.ts:188`).
  - Adding waitlist types to `libs/api-contracts/community`: rejected because the existing approval contract explicitly documents the admin convention of backend types plus frontend Zod mirrors (`libs/api/admin/src/lib/waitlist-approval/waitlist-approval.types.ts:10`).
  - Adding a second approval endpoint accepting filters: rejected because the existing explicit-id endpoint already owns throttling, per-row transactions, and the five-outcome response (`libs/api/admin/src/lib/admin-waitlist.controller.ts:82`, `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.ts:136`).
- Assumptions: none.
- Effect on existing code: the Waitlist Pipeline replaces its use of `GET /v1/admin/records/waitlist`; all other generic list callers and their single filters remain unchanged. Generic waitlist CRUD remains available only as existing infrastructure, but no new waitlist behavior is added to it. The approval endpoint and modal are extended in place; no V2 route, compatibility flag, or duplicate approval workflow is introduced.

### Exact API contracts

All paths below are under the application's global `/api` prefix. The controller remains class-guarded by `JwtAuthGuard` then `AdminGuard`, matching the existing class contract at `libs/api/admin/src/lib/admin-waitlist.controller.ts:50`.

#### Shared query vocabulary

```ts
type WaitlistStage = 'all' | 'new' | 'invited' | 'approved' | 'converted';
type WaitlistSource = 'landing' | 'pricing' | 'profile' | 'vscode' | 'early-adopter' | 'unknown'; // maps to source IS NULL
type WaitlistSortField = 'createdAt' | 'notifiedAt' | 'approvedAt' | 'convertedAt' | 'source';
type SortOrder = 'asc' | 'desc';
```

**Verified:** the five non-null source values mirror the current web join contract (`libs/web/core/src/lib/services/waitlist.service.ts:17`); `unknown` is the API's explicit null bucket, not a stored value. Unknown historical sources remain discoverable through search but cannot become an unbounded dropdown/query value.

`WaitlistFilterQueryDto` fields and decorators:

- `stage?: WaitlistStage = 'all'`: `@IsOptionalNotNull() @IsIn(['all','new','invited','approved','converted'])`.
- `search?: string`: `@IsOptionalNotNull() @IsString() @MaxLength(256)`; trimmed in service; matches email OR source, case-insensitive.
- `source?: WaitlistSource`: `@IsOptionalNotNull() @IsIn([...six values])`.
- `createdFrom?: string`: `@IsOptionalNotNull() @IsISO8601({ strict: true }) @MaxLength(32)`.
- `createdTo?: string`: same decorators. Both are inclusive instants. The Angular date inputs serialize UTC day bounds (`00:00:00.000Z` / `23:59:59.999Z`).
- `sortBy?: WaitlistSortField = 'createdAt'`: `@IsOptionalNotNull() @IsIn([...five fields])`.
- `sortOrder?: SortOrder = 'desc'`: `@IsOptionalNotNull() @IsIn(['asc','desc'])`.

`WaitlistListQueryDto extends WaitlistFilterQueryDto` adds:

- `page?: number = 1`: `@IsOptionalNotNull() @Type(() => Number) @IsInt() @Min(1)`.
- `pageSize?: 10 | 25 | 50 | 100 = 25`: `@IsOptionalNotNull() @Type(() => Number) @IsInt() @IsIn([10,25,50,100])`.

`WaitlistIdParamsDto` has `id!: string` with `@IsString() @MaxLength(64) @Matches(/^[A-Za-z0-9_-]+$/)` and is bound as `@Param(dtoPipe(WaitlistIdParamsDto))`.

All list-like operations build one base `AND` from stage, search, source, and date range. User input never becomes a Prisma key. Sorting selects from a literal map and always appends `{ id: 'asc' }` as a deterministic tie-breaker.

#### Stage predicate contract

```ts
converted = { convertedAt: { not: null } }
approved  = { convertedAt: null, approvedAt: { not: null } }
invited   = { convertedAt: null, approvedAt: null, notifiedAt: { not: null } }
new       = { convertedAt: null, approvedAt: null, notifiedAt: null }
eligible  = { convertedAt: null, approvedAt: null } // new OR invited
pending   = new + invited                          // aggregate, not a fifth stage
```

The four stages are exhaustive and mutually exclusive; `new + invited + approved + converted === total`. Raw `notified` remains a historical fact for the existing Overview funnel and is not included in that equation.

#### `GET /v1/admin/waitlist`

- Binding: `@Query(dtoPipe(WaitlistListQueryDto)) query`.
- Success: HTTP 200.

```ts
interface WaitlistListRow {
  id: string;
  email: string;
  source: string | null;
  createdAt: string;
  notifiedAt: string | null;
  approvedAt: string | null;
  convertedAt: string | null;
  stage: Exclude<WaitlistStage, 'all'>;
  stageAt: string; // converted/approved/notified timestamp, else createdAt
  approvalEligible: boolean; // approvedAt === null && convertedAt === null
}

interface WaitlistStageCounts {
  all: number;
  pending: number;
  new: number;
  invited: number;
  approved: number;
  converted: number;
}

interface WaitlistListResponse {
  data: WaitlistListRow[];
  total: number; // active stage + optional filters
  page: number;
  pageSize: number;
  totalPages: number;
  counts: WaitlistStageCounts; // optional filters applied, stage omitted
}
```

The paired page/count and all five stage counts run in one Prisma array transaction. If page is beyond the final page, an empty `data` array with accurate metadata is returned; the frontend canonicalizes back to the last valid page only after receiving it.

#### `GET /v1/admin/waitlist/eligible-ids`

- Binding: `@Query(dtoPipe(WaitlistFilterQueryDto)) query`.
- The same filter and sort contract applies, with the eligibility predicate ANDed after filters.
- Success: HTTP 200.

```ts
interface WaitlistEligibleIdsResponse {
  ids: string[]; // ordered, explicit ids, length <= 50
  selected: number; // ids.length
  eligibleMatching: number; // all eligible rows matching current filters
  limit: 50;
  truncated: boolean; // eligibleMatching > selected
}
```

The service performs an eligible `count` plus `findMany({ take: 50, select: {id:true} })` under one array transaction. This is the only select-matching route; it never mutates or approves by filter.

#### `GET /v1/admin/waitlist/export.csv`

- Binding: `@Query(dtoPipe(WaitlistFilterQueryDto)) query`, `@Req()` for actor/IP/user-agent, and passthrough response headers.
- Success: HTTP 200, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="waitlist-YYYY-MM-DD.csv"`.
- Fixed header/order: `id,email,source,stage,createdAt,notifiedAt,approvedAt,convertedAt`.
- Rows use the same filter/stage predicates and requested sort plus id tie-breaker. Nulls serialize as empty fields; timestamps serialize as ISO-8601 UTC.
- Every scalar is CSV-quoted with embedded quotes doubled. Before quoting, any value matching `/^[\t\r ]*[=+\-@]/` is prefixed with `'` so spreadsheet applications treat it as text.
- A defensive maximum of 50,000 matches is checked before data retrieval. Over-limit exports return 413 `WAITLIST_EXPORT_LIMIT_EXCEEDED` with the safe message `Narrow the filters before exporting.` This bound protects server memory while being far above the current 400+ row dataset.
- Before bytes are returned, `AuditLogService.write` records `action: 'waitlist.export'`, `targetType: 'Waitlist'`, no `targetId`, actor/IP/user-agent, and metadata `{ stage, source: source ?? null, createdFrom: createdFrom ?? null, createdTo: createdTo ?? null, sortBy, sortOrder, searchApplied: boolean, exportedCount }`. The search string/email itself is not copied into audit metadata. Audit failure returns 503 `WAITLIST_EXPORT_AUDIT_FAILED`; no CSV is sent.

#### `GET /v1/admin/waitlist/:id/details`

- Static `eligible-ids` and `export.csv` handlers are declared before `:id/details`.
- Binding: `@Param(dtoPipe(WaitlistIdParamsDto)) params`.
- Success: HTTP 200.

```ts
interface WaitlistDetailsResponse {
  entry: WaitlistListRow;
  user: null | {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    createdAt: string;
    licenses: Array<{
      id: string;
      plan: string;
      status: string;
      source: string;
      expiresAt: string | null;
      createdAt: string;
      createdBy: string;
    }>;
    subscriptions: Array<{
      id: string;
      status: string;
      priceId: string;
      currentPeriodEnd: string;
      trialEnd: string | null;
      canceledAt: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
    groups: Array<{
      id: string;
      key: string;
      name: string;
      assignedAt: string;
      source: string;
    }>;
  };
  audit: Array<{
    id: string;
    actorEmail: string | null;
    action: string;
    targetType: 'Waitlist';
    targetId: string;
    createdAt: string;
    metadata: {
      userId?: string;
      userWasCreated?: boolean;
      licenseId?: string;
      durationPreset?: string;
      expiresAt?: string | null;
      groupKey?: string;
      wasNotified?: boolean;
      cohortAlreadyAssigned?: boolean;
    };
  }>;
}
```

The user match is at most one row: normalize the waitlist email with `trim().toLowerCase()` and query email case-insensitively. Nested `select` excludes `licenseKey`, Paddle customer identifiers, audit IP/user-agent, snapshots, and unknown metadata. Missing user/licenses/subscriptions/groups return `null` or empty arrays, never 404. Audit is limited to 100 newest rows with `targetType: 'Waitlist'` and `targetId: entry.id`.

#### Stats contract update

`GET /v1/admin/stats` keeps its route and adds/redefines the waitlist block:

```ts
waitlist: {
  total: number;
  pending: number;   // new + invited
  new: number;
  invited: number;
  approved: number;
  converted: number;
  notified: number;  // historical raw timestamp-presence metric, not a stage
  last7Days: number;
}
```

`attention.waitlistUninvited` now equals `waitlist.new`, not `total - notified`. Existing Overview inputs remain valid because `notified`, `total`, `converted`, and `last7Days` remain present for their distinct historical funnel use.

#### Error contract

- DTO/unknown-field/enum/range syntax errors: HTTP 400, Nest validation body `{ statusCode: 400, error: 'Bad Request', message: string[] }`; validation occurs before a service call.
- `createdFrom > createdTo`: HTTP 400 `{ statusCode: 400, code: 'INVALID_DATE_RANGE', message: 'createdFrom must be before or equal to createdTo' }`.
- Missing details id: HTTP 404 `{ statusCode: 404, code: 'WAITLIST_NOT_FOUND', message: 'Waitlist entry not found' }`.
- Export above 50,000: HTTP 413 `WAITLIST_EXPORT_LIMIT_EXCEEDED` as above.
- List/id-resolution unexpected dependency failure: HTTP 503 with `WAITLIST_QUERY_UNAVAILABLE` or `WAITLIST_SELECTION_UNAVAILABLE` and a fixed safe message.
- Details unexpected dependency failure: HTTP 503 `{ code: 'WAITLIST_DETAILS_UNAVAILABLE', message: 'Waitlist details are temporarily unavailable' }`.
- Export query/audit failure: HTTP 503 `WAITLIST_EXPORT_UNAVAILABLE` or `WAITLIST_EXPORT_AUDIT_FAILED`; raw Prisma/audit messages are logged server-side only.
- Approval errors remain unchanged: invalid body 400; missing founding cohort sanitized 500; otherwise HTTP 200 with the five per-row outcomes (`libs/api/admin/src/lib/admin-waitlist.controller.ts:69`).

## Component specifications

### 1. Waitlist stage and query policy

- Purpose: own the one authoritative mapping from lifecycle facts and validated query values to literal Prisma predicates/order.
- Responsibilities: define closed stage/source/sort/page-size constants; build disjoint stage and eligibility predicates; combine search/source/date filters with AND semantics; validate reversed ranges; derive `stage`, `stageAt`, and `approvalEligible`; append id sort tie-breaker.
- Verified contracts and entry points: waitlist timestamps and indexes (`apps/ptah-license-server/prisma/schema.prisma:478`); generic allowlist security posture (`libs/api/admin/src/lib/admin-models.config.ts:1`); existing search semantics (`libs/api/admin/src/lib/admin.service.ts:412`).
- Dependencies: Prisma input types from `@ptah-api/core`; no controller, response, audit, or Angular dependency. Dependency direction is controller/service -> query policy -> Prisma types.
- Integration points: consumed by `AdminWaitlistService` and `AdminService.getStats`; its exported constants are also used by DTO decorators so allowlists cannot drift within the backend.
- Failure behaviour: throws only a safe `BadRequestException` with `INVALID_DATE_RANGE`; all syntactic and enum failures are rejected by DTOs before entry.
- Quality requirements: no user string is used as an object key; stage predicates satisfy the exhaustive sum invariant; list and export ordering is deterministic.
- Verification seam: pure unit tests over all eight combinations of notified/approved/converted presence plus combined-filter snapshots.
- Files:
  - CREATE `D:\projects\ptah-extension\libs\api\admin\src\lib\waitlist-query.ts`
  - CREATE `D:\projects\ptah-extension\libs\api\admin\src\lib\waitlist-query.spec.ts`

### 2. Admin waitlist read/export/details service

- Purpose: own waitlist-specific read aggregation and compliance-safe export, separate from generic admin CRUD and approval mutation orchestration.
- Responsibilities: paginated list plus filtered stage counts; capped eligible-id resolution; details aggregation; CSV encoding/formula protection; export audit; safe response mapping; server-side logging/error translation.
- Verified contracts and entry points: array-transaction list shape (`libs/api/admin/src/lib/admin.service.ts:188`); user relations (`apps/ptah-license-server/prisma/schema.prisma:34`); audit writer (`libs/api/audit/src/lib/audit-log.service.ts:39`); direct approval audit target (`libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.ts:354`).
- Dependencies: inject `PrismaService` and `AuditLogService`; depend on Component 1 pure policy. It does not depend on `WaitlistApprovalService` and does not send email or mutate lifecycle timestamps.
- Integration points: called only by `AdminWaitlistController`; response interfaces live in `admin-waitlist.types.ts`; export receives an actor context shaped like the existing approval actor.
- Failure behaviour: missing details row -> safe 404; expected range/limit errors keep their 4xx codes; unexpected dependency failures are logged with cause and rethrown as route-specific sanitized 503 codes. Export audit failure is fail-closed.
- Quality requirements: details use nested selects and load on demand; no license key or arbitrary audit JSON reaches the client; export handles up to 50,000 filtered rows and uses the exact list predicates/order; no per-row relationship query.
- Verification seam: service tests with mocked Prisma/audit prove query arguments, response projection, formula-safe CSV, audit payload, missing relations, and safe failures.
- Files:
  - CREATE `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.types.ts`
  - CREATE `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.service.ts`
  - CREATE `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.service.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\audit\src\lib\audit-log.types.ts` (add `waitlist.export` only)

### 3. Validated waitlist HTTP surface

- Purpose: translate guarded HTTP requests into Components 2 and the existing approval service without owning Prisma or business logic.
- Responsibilities: bind exact DTOs; expose four GET routes plus existing POST; set CSV headers; construct actor context from `Request`; preserve guard and approval throttle behavior; register `AdminWaitlistService` in the module.
- Verified contracts and entry points: controller guard/path and approval handler (`libs/api/admin/src/lib/admin-waitlist.controller.ts:50`, `libs/api/admin/src/lib/admin-waitlist.controller.ts:88`); module registration (`libs/api/admin/src/lib/admin.module.ts:62`); explicit validation mechanism (`libs/api/core/src/lib/common/dto-validation.pipe.ts:69`); route registry structural tests (`apps/ptah-license-server/src/common/route-map.spec.ts:720`).
- Dependencies: controller -> `AdminWaitlistService` for reads/export/details and -> `WaitlistApprovalService` for mutation. Controllers never inject Prisma.
- Integration points: exact contracts above; `AdminModule.providers`; existing app controller registry entry remains the same because no new controller class is created.
- Failure behaviour: lets typed `HttpException`s pass through; the service has already sanitized dependency failures. No raw exception message is constructed in the controller.
- Quality requirements: all GET routes remain class-guarded; every whole-object query/param uses `dtoPipe`; static routes precede `:id/details`; CSV filename is server-controlled.
- Verification seam: controller metadata/unit tests assert route paths, DTO `expectedType`, guard metadata, CSV headers, service delegation, and actor propagation; server route-map/validation structural specs catch registration drift.
- Files:
  - CREATE `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.dto.ts`
  - CREATE `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.controller.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.controller.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\admin\src\lib\admin.module.ts`
  - MODIFY `D:\projects\ptah-extension\apps\ptah-license-server\src\common\route-map.spec.ts`
  - MODIFY `D:\projects\ptah-extension\apps\ptah-license-server\src\common\controller-validation.spec.ts`

### 4. Stats and approval eligibility hardening

- Purpose: make lifecycle counts disjoint and make the mutation boundary enforce the same converted/approved eligibility rule as the UI.
- Responsibilities: replace raw-stage stats with Component 1 predicates; add `pending/new/invited`; keep historical `notified`; set attention count to `new`; extend the waitlist claim row with `convertedAt`; claim only unapproved/unconverted rows; map a converted claim to existing `already_paid`.
- Verified contracts and entry points: current raw counts (`libs/api/admin/src/lib/admin.service.ts:341`); claim ownership in marketing (`libs/api/marketing/src/lib/waitlist/waitlist.service.ts:47`); existing `already_paid` outcome (`libs/api/admin/src/lib/waitlist-approval/waitlist-approval.types.ts:29`); approval service's `SkipRow` already accepts `already_paid` (`libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.ts:55`).
- Dependencies: `AdminService` imports only Component 1; `WaitlistApprovalService` continues to depend on `WaitlistService`'s claim contract. No new circular module edge.
- Integration points: `GET /stats`; `POST /waitlist/approve`; frontend stats Zod mirror.
- Failure behaviour: concurrency remains conditional-update based. Converted rows are non-events with `already_paid`, no license/cohort/audit/email. A later transaction failure still rolls the claim back as today.
- Quality requirements: exactly one stage per row; no duplicate approval of converted rows even if the UI is stale; existing five-outcome approval response stays stable.
- Verification seam: stats tests assert exhaustive disjoint predicates and an approved-without-notified fixture; marketing tests assert converted claim is rejected and update `where` has both null guards; approval tests assert converted maps to `already_paid` with no writes/email/audit.
- Files:
  - MODIFY `D:\projects\ptah-extension\libs\api\admin\src\lib\admin.service.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\admin\src\lib\admin.service.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\marketing\src\lib\waitlist\waitlist.service.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\marketing\src\lib\waitlist\waitlist.service.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\admin\src\lib\waitlist-approval\waitlist-approval.service.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\admin\src\lib\waitlist-approval\waitlist-approval.service.spec.ts`

### 5. Angular admin HTTP boundary

- Purpose: give the frontend executor a typed, runtime-validated implementation of the exact API contracts without importing backend source.
- Responsibilities: add Zod schemas/types for list rows/counts, eligible ids, details, and stats additions; add `listWaitlist`, `resolveEligibleWaitlistIds`, `getWaitlistDetails`, and `exportWaitlistCsv`; build allowlisted `HttpParams`; validate CSV content type/filename before download handling.
- Verified contracts and entry points: current local-Zod pattern (`libs/web/admin/src/lib/services/admin-api.service.ts:147`); generic param construction (`libs/web/admin/src/lib/services/admin-api.service.ts:475`); approval method (`libs/web/admin/src/lib/services/admin-api.service.ts:622`).
- Dependencies: inject `HttpClient`; depend only on web core `validate`, RxJS, and Zod. No `libs/api/**` import.
- Integration points: Components 6-8 call these methods. Query type names and response schemas mirror the API contracts section exactly.
- Failure behaviour: Zod mismatch errors surface at the named HTTP boundary; invalid CSV MIME or missing body produces a client-safe export error; HTTP status bodies flow to the component's safe error mapper.
- Quality requirements: no `unknown` response reaches templates; export object URLs are created, clicked, and revoked in the pipeline rather than stored; approval schema remains closed over five outcomes.
- Verification seam: `HttpTestingController` tests exact URL/query serialization, Zod rejection, eligible-id/detail parsing, and CSV response header/body handling.
- Files:
  - MODIFY `D:\projects\ptah-extension\libs\web\admin\src\lib\services\admin-api.service.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\services\admin-api.service.spec.ts`

### 6. URL-owned pipeline and selection state

- Purpose: keep `WaitlistPipeline` the smart screen coordinator while making all shareable filter state URL-authoritative and all approval selection semantics explicit.
- Responsibilities: parse/normalize query params; request list data; debounce search; navigate filter/page changes; preserve stage on clear; coordinate page and matching selection; open approval and details; refresh list/counts after response; download CSV; restore drawer-trigger focus.
- Verified contracts and entry points: current smart component uses signals/RxJS and `ActivatedRoute` (`libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:99`, `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:184`); current mutation refreshes list and stats (`libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:329`); existing selection toolbar projects business actions (`libs/web/panel-ui/src/lib/selection-toolbar/selection-toolbar.ts:10`).
- Dependencies: Component 5 client; presentational Components 7-8; existing approval modal and read-only panel-ui primitives.
- Integration points:
  - URL keys: `stage`, `search`, `source`, `createdFrom`, `createdTo`, `sortBy`, `sortOrder`, `page`, `pageSize`. Missing keys have documented defaults: `stage=new`, empty optional filters, `sortBy=createdAt`, `sortOrder=asc` for New and `desc` otherwise, `page=1`, `pageSize=25`. Every non-default value is represented in the URL; invalid values normalize to defaults with a single `replaceUrl` canonicalization.
  - Narrowing changes (`stage`, debounced search, source, dates, sort) navigate with `page=1` and clear selection. Page changes retain selection across pages. Clear removes search/source/dates and resets sort/order/page/pageSize, but retains `stage`.
  - `WaitlistSelectionState` is component-scoped and signal-based: `{ ids: ReadonlySet<string>, scope: 'explicit' | 'matching', eligibleMatching: number | null, limit: 50 }`. Select-page toggles only rows whose server field `approvalEligible` is true. Select-matching replaces ids with the eligible-id response and labels `50 selected of N matching` when truncated.
  - After an approval response, retain only `failed` and `not_found` ids for retry/identification; remove `approved`, `already_approved`, and `already_paid`; refresh authoritative list/counts. Transport failure does not emit `submitted`, so the state is unchanged.
- Failure behaviour: list failure leaves filters and selection intact with retry; eligible-id failure leaves explicit selection intact; export failure produces an error toast; drawer failure is isolated in Component 8; details close does not change URL/list/selection.
- Quality requirements: signals for local state, Observables for HTTP/router streams, `OnPush`, zoneless-safe; no effect writes router state in a loop; all selection count changes use an `aria-live="polite"` status; no approval request over 50.
- Verification seam: router-harness tests for deep links/back-forward/default normalization/page reset/clear-stage preservation; component tests for mixed eligibility, indeterminate page checkbox, cross-page selection, 50-of-N disclosure, partial outcomes, transport preservation, refresh, export, and focus restoration.
- Files:
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-query-state.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-selection.state.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-selection.state.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-pipeline.ts`
  - MODIFY `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-pipeline.html`
  - MODIFY `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-pipeline.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\web\admin\src\lib\components\approve-waitlist-modal\approve-waitlist-modal.ts`
  - MODIFY `D:\projects\ptah-extension\libs\web\admin\src\lib\components\approve-waitlist-modal\approve-waitlist-modal.html`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\components\approve-waitlist-modal\approve-waitlist-modal.spec.ts`

### 7. Waitlist filter bar and row presentation

- Purpose: keep filter control rendering and per-row rendering out of the orchestration component, under the 700-line soft ceiling.
- Responsibilities:
  - `WaitlistFilterBar`: render search/source/date/sort/direction/page-size controls; emit typed partial query changes and clear; expose accessible labels and invalid-date server feedback.
  - `WaitlistRowComponent`: render email/source/stage badge/relevant `stageAt`; expose eligible checkbox, per-row approve, and details trigger; emit the trigger HTMLElement for later focus restoration; never derive eligibility from active tab.
- Verified contracts and entry points: presentational signal inputs/outputs and OnPush are the repository skill pattern; existing row currently renders badges and timestamp branches inline (`libs/web/admin/src/lib/waitlist/waitlist-pipeline.html:102`, `libs/web/admin/src/lib/waitlist/waitlist-pipeline.html:133`, `libs/web/admin/src/lib/waitlist/waitlist-pipeline.html:144`); `StatusBadge` supports direct semantic variants (`libs/web/panel-ui/src/lib/status-badge/status-badge.ts:39`).
- Dependencies: Angular core/common; read-only `StatusBadge`; Lucide icons already used by the pipeline. Neither component injects router or HTTP.
- Integration points: typed signal inputs and outputs only. Stage mapping is `new -> ghost`, `invited -> neutral`, `approved -> info`, `converted -> success`; label and relevant timestamp are server-supplied.
- Failure behaviour: absent source renders `Unknown`; timestamps are non-null for `stageAt` by contract; a malformed row never gets past Component 5 Zod validation.
- Quality requirements: every checkbox has `Select <email> for approval`; page checkbox in parent exposes true/false/mixed; stage has text/icon, not color only; details and approve are keyboard buttons with visible focus.
- Verification seam: focused shallow specs assert output payloads, ineligible rows have neither checkbox nor Approve, correct stage/timestamp rendering, and accessible labels.
- Files:
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-filter-bar.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-filter-bar.html`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-filter-bar.spec.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-row.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-row.html`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-row.spec.ts`

### 8. Waitlist details drawer content

- Purpose: load and render one entry's account context inside the existing shared drawer without disturbing the list.
- Responsibilities: accept `entryId` and `open`; fetch details on open/id change; render loading/not-found/error/retry; show identity/timeline, linked user, licenses, subscription state, groups, and newest-first audit events; emit close and eligible approve id; render navigation to `/admin/users/:userId` for the linked user-and-license surface.
- Verified contracts and entry points: shared drawer projection/footer contract (`libs/web/panel-ui/src/lib/detail-drawer/detail-drawer.ts:15`, `libs/web/panel-ui/src/lib/detail-drawer/detail-drawer.html:65`); users and licenses are intentionally merged under `/admin/users/:id` and legacy license routes redirect to users (`libs/web/admin/src/lib/admin.routes.ts:78`, `libs/web/admin/src/lib/admin.routes.ts:102`, `libs/web/admin/src/lib/admin.routes.ts:107`).
- Dependencies: Component 5 API client, `DetailDrawer`, `StatusBadge`, Angular `DatePipe`/`RouterLink`; no direct list/selection state.
- Integration points: parent controls open/id and focus restoration. The drawer's Approve action is present only when `entry.approvalEligible`; successful approval continues through the single shared confirmation modal. `View linked user & licenses` uses the merged user-profile route.
- Failure behaviour: 404 shows `Entry no longer exists` with Close; validation/dependency errors show a fixed safe message with Retry and Close; absent user/licenses/subscriptions/groups each render separate explicit empty text; underlying list remains interactive after close.
- Quality requirements: standalone/OnPush/signals; on-demand only; no `[innerHTML]`; safe audit metadata rendered as labelled values, never raw JSON; drawer retains shared Escape/backdrop/inert behavior.
- Verification seam: component spec covers loading, full/empty relation variants, 404, retry, valid-action gating, audit order/metadata, close emission, and link targets. Parent spec covers focus return.
- Files:
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-details-drawer.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-details-drawer.html`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-details-drawer.spec.ts`

## Integration architecture

- Data flow:
  1. Router query params are normalized into one `WaitlistQueryState`; the pipeline passes it to `AdminApiService.listWaitlist`.
  2. The controller DTO pipe transforms/validates the query, then `AdminWaitlistService` asks Component 1 for literal predicates/order and executes page/count/stage-count queries.
  3. Backend maps database rows to explicit stage/eligibility wire rows; frontend Zod validates before signals/templates see data.
  4. Page selection stores explicit eligible ids. Matching selection sends the same filter/sort state to `eligible-ids`, receives at most 50 explicit ids plus the full eligible count, then uses the unchanged approval endpoint.
  5. Approval results update selection by per-row outcome and trigger a list/count refresh; server claim enforcement protects against stale eligibility.
  6. Export sends the same non-pagination query state; server queries, encodes, audits, then returns CSV; browser downloads and revokes the object URL.
  7. Details trigger supplies id plus opener element; drawer fetches the aggregate on demand; close clears only drawer state and restores opener focus.
- State or persistence: URL owns shareable filter/page state for the route lifetime. Component-scoped signals own transient selection, approval result, drawer id/opener, loading, and toasts. No new database table/column/migration and no browser persistence.
- External boundaries: HTTP query/path/body values are explicitly DTO-bound and allowlisted; responses are frontend-Zod validated; CSV values are formula-neutralized and quoted; details omit credentials and unknown audit metadata.
- Failure and rollback: reads do not mutate. Export fails closed on audit failure. Approval retains its per-row interactive transaction and post-commit email behavior (`libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.ts:93`); converted/approved claim losers write nothing. Frontend preserves explicit selection on transport failure and retains failed/not-found ids on mixed HTTP-200 results.
- Observability: unexpected list/details/export errors log route code and server cause without returning it; approval keeps its per-row/wave logs (`libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.ts:169`); every successful export has a `waitlist.export` audit row.

## Architecture-level quality requirements

- Functional: all waitlist rows satisfy exactly one stage; list tabs, filtered counts, global stats, details, selection, and export use the same stage policy; no approved/converted row is selectable or approvable; export has one deterministic row per match; details preserves list/filter/selection state.
- Performance: normal list remains page-bounded at 10/25/50/100; eligible resolution reads at most 50 ids plus a count; details uses one waitlist query, one nested user query, and one bounded audit query; export rejects more than 50,000 rows and never asks the browser to fetch pages for aggregation.
- Security: guard chain on every route; explicit DTO pipes; closed stage/source/sort/page-size sets; literal Prisma keys; sanitized errors; no license keys; CSV formula protection; audit-before-download.
- Accessibility: OnPush standalone controls; unique checkbox names; mixed page select state; polite selection/result counts; keyboard buttons; text/icon stage differentiation; shared modal drawer semantics; explicit opener focus restoration.
- Maintainability: generic admin parser and unrelated models remain untouched; one backend stage-policy module; one smart pipeline plus named presentational/state collaborators; no panel-ui fork, V2 route, compatibility flag, or shared-contract boundary expansion.
- Testability: backend proves predicates and query arguments without a database; frontend proves URL restoration and DOM interaction with router/TestBed harnesses; structural license-server specs prove routes and DTO binding; tests assert behavior, not coverage percentage.

## Test plan per side

### Backend verification

- `libs/api/admin/src/lib/waitlist-query.spec.ts`
  - all eight timestamp-presence combinations resolve by Converted > Approved > Invited > New;
  - stage predicates are disjoint and exhaustive;
  - eligibility requires both approved/converted absent;
  - combined stage/search/source/date filters form AND with search's email/source OR;
  - invalid/reversed dates and unknown sort/source/stage never create dynamic keys;
  - deterministic order includes id tie-breaker.
- `libs/api/admin/src/lib/admin-waitlist.service.spec.ts`
  - list pagination and filtered counts use identical optional filters with stage removed only for count tabs;
  - eligible resolver returns first 50, full eligible count, and truncation flag;
  - export reuses filters/order, emits fixed headers/ISO/null values, escapes quotes/newlines, neutralizes `=`, `+`, `-`, `@`, tab/CR prefixes, records safe `waitlist.export`, and fails closed on audit error;
  - details normalizes email, returns null/empty relations, omits license keys and unknown audit JSON, queries `Waitlist`/id audit rows newest-first, and maps 404/dependency failure safely.
- `libs/api/admin/src/lib/admin-waitlist.controller.spec.ts`
  - guard metadata remains class-level;
  - each query/param binding has the correct `dtoPipe.expectedType`;
  - routes delegate exact DTOs and actor metadata;
  - CSV headers/filename/content are correct and static routes are not shadowed.
- `libs/api/admin/src/lib/admin.service.spec.ts`
  - stats count approved-without-notified only as Approved;
  - a converted+approved row counts only Converted;
  - `pending === new + invited`, stage sum equals total, raw notified remains historical, and attention equals New.
- `libs/api/marketing/src/lib/waitlist/waitlist.service.spec.ts`
  - approval claim selects convertedAt, requires both null in update, and returns already-paid for a converted row without stamping approvedAt.
- `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.spec.ts`
  - converted claim maps to `already_paid`; no license/cohort/audit/email; existing concurrency and rollback tests remain green.
- `apps/ptah-license-server/src/common/route-map.spec.ts`
  - add the four GET routes to the exact route ledger and update its documented/count invariant.
- `apps/ptah-license-server/src/common/controller-validation.spec.ts`
  - update the payload binding floor/commentary for list, eligible, export queries and details params; no named-primitive carve-out grows.
- Commands (read the run-many header and verify all five projects are included):
  - `npx nx run-many -t test -p api-admin api-marketing api-audit ptah-license-server web-admin`
  - `npx nx run-many -t typecheck -p api-admin api-marketing api-audit ptah-license-server web-admin`
  - `npx nx run-many -t lint -p web-admin`

### Frontend verification

- `libs/web/admin/src/lib/services/admin-api.service.spec.ts`: exact serialized params; response Zod acceptance/rejection; eligible/detail methods; CSV MIME/body/filename handling.
- `libs/web/admin/src/lib/waitlist/waitlist-selection.state.spec.ts`: eligible-only page selection; mixed/all/none state; cross-page explicit selection; matching 50-of-N scope; clear; partial-result retention; transport no-op.
- `libs/web/admin/src/lib/waitlist/waitlist-filter-bar.spec.ts`: typed output for every control; date values; page-size allowlist; clear output does not include stage.
- `libs/web/admin/src/lib/waitlist/waitlist-row.spec.ts`: four badges/relevant timestamps; approved/converted have no checkbox/Approve; eligible All-view row does; unique accessible names; detail output carries opener.
- `libs/web/admin/src/lib/waitlist/waitlist-details-drawer.spec.ts`: loading/full/empty/404/dependency/retry states; audit newest-first safe fields; eligible action only; merged user/license navigation; close.
- `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.spec.ts`: blocks 0/>50, renders all totals and per-entry outcomes, preserves request on transport failure, emits full response.
- `libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts`: all URL keys restore on deep link/reload/back-forward; invalid values canonicalize; narrowing resets page; pagination does not clear selection; clear keeps stage and resets other defaults; list call receives combined filters; select matching discloses 50/N; partial approval retains retry ids and refreshes; transport failure preserves ids; export downloads/revokes; drawer close returns focus without changing query/selection.

## Team-leader handoff

- Recommended executors:
  - **Batch A — backend-developer:** Components 1-4. Reason: NestJS DTO/controller/service/Prisma query design plus audit and transactional approval safety form one backend contract implementation.
  - **Batch B — frontend-developer:** Components 5-8. Reason: Angular signals, router state, Zod HTTP boundary, presentational components, accessibility, and shared panel-ui reuse form one UI implementation.
- Complexity: HIGH. The task crosses pagination, compound validated queries, lifecycle invariants, transaction eligibility, compliance export, URL state, partial bulk outcomes, cross-model details, and accessibility. The public contract is fixed above to make execution parallel-safe.
- Dependencies and ordering: Batch A and Batch B may start simultaneously. Batch B depends only on the **Exact API contracts** section, not Batch A source or shared context. Integration verification happens after both land. Within Batch A, Component 1 precedes service/stats use; claim hardening precedes approval regression acceptance. Within Batch B, Component 5 types/schemas precede component compilation.
- Parallel-safe work: the batches are file-disjoint. **No file appears in both lists.** `libs/web/panel-ui/**`, `libs/api-contracts/**`, and Prisma schema/migrations are read-only/not touched.
- Batch A file ownership:
  - CREATE `D:\projects\ptah-extension\libs\api\admin\src\lib\waitlist-query.ts`
  - CREATE `D:\projects\ptah-extension\libs\api\admin\src\lib\waitlist-query.spec.ts`
  - CREATE `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.dto.ts`
  - CREATE `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.types.ts`
  - CREATE `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.service.ts`
  - CREATE `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.service.spec.ts`
  - CREATE `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.controller.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.controller.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\admin\src\lib\admin.module.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\admin\src\lib\admin.service.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\admin\src\lib\admin.service.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\admin\src\lib\waitlist-approval\waitlist-approval.service.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\admin\src\lib\waitlist-approval\waitlist-approval.service.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\marketing\src\lib\waitlist\waitlist.service.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\marketing\src\lib\waitlist\waitlist.service.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\api\audit\src\lib\audit-log.types.ts`
  - MODIFY `D:\projects\ptah-extension\apps\ptah-license-server\src\common\route-map.spec.ts`
  - MODIFY `D:\projects\ptah-extension\apps\ptah-license-server\src\common\controller-validation.spec.ts`
- Batch B file ownership:
  - MODIFY `D:\projects\ptah-extension\libs\web\admin\src\lib\services\admin-api.service.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\services\admin-api.service.spec.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-query-state.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-selection.state.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-selection.state.spec.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-filter-bar.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-filter-bar.html`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-filter-bar.spec.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-row.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-row.html`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-row.spec.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-details-drawer.ts`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-details-drawer.html`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-details-drawer.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-pipeline.ts`
  - MODIFY `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-pipeline.html`
  - MODIFY `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-pipeline.spec.ts`
  - MODIFY `D:\projects\ptah-extension\libs\web\admin\src\lib\components\approve-waitlist-modal\approve-waitlist-modal.ts`
  - MODIFY `D:\projects\ptah-extension\libs\web\admin\src\lib\components\approve-waitlist-modal\approve-waitlist-modal.html`
  - CREATE `D:\projects\ptah-extension\libs\web\admin\src\lib\components\approve-waitlist-modal\approve-waitlist-modal.spec.ts`
- Verification points: exact contract names/fields/statuses; all controller payloads explicitly DTO-bound; static route ordering; stage sum invariant; converted claim guard; no license keys; export formula protection and audit fail-closed; URL back/forward; 50-of-N disclosure; mixed approval retry; drawer focus restoration; `npx nx run-many` commands above must report the requested project count and pass.

## Risks

- A frontend/backend source allowlist drift can reject a valid dropdown value. Mitigation: backend DTO constants are single-source within Batch A, frontend Zod/query constants single-source within Batch B, and HTTP tests assert every value from this contract.
- Historical free-form waitlist sources may not belong to the six filter values. Mitigation: they remain visible in All/search/export and render their stored label; only exact dropdown filtering is limited to current product sources plus Unknown.
- Nullable sort fields can produce database-specific null placement. Mitigation: contract guarantees deterministic order by adding id as the final key; it does not promise nulls-first/nulls-last.
- A stale page may select a row that converts before approval. Mitigation: UI state is advisory; the strengthened transactional claim rejects converted rows as `already_paid` with no writes.
- Export auditing is not atomic with a read-only file response. Mitigation: audit is written after successful query/encoding and before returning bytes; a write failure prevents download. The row records intended successful delivery, while transport disconnects remain observable only in HTTP infrastructure logs.
- Details audit cannot reliably join the complimentary-license audit because that writer has no `targetId`. Mitigation: show directly attributable Waitlist-target audit rows and independently show linked licenses; do not infer a false join from email/time.
- URL search updates can flood browser history. Mitigation: debounce search and use `replaceUrl` for search text canonicalization; stage/filter/page actions remain navigable history entries.
- Splitting UI can become fragment sprawl. Mitigation: only four named responsibilities are extracted (query/selection state, filter bar, row, details drawer); approval modal stays in place and panel-ui is reused read-only.
