# Context — TASK_2026_462_c819

## User intent

"Enhance the admin page so I can do bulk actions, have a proper differentiator between
already-approved users and new ones, advanced filtering, and proper user details."
Page: `/admin/waitlist` (Waitlist Pipeline).

Lanes: codex = planning (project-manager, software-architect); ollama cloud + antigravity =
execution.

## Diagnosis (verified against code on main @ 97239e814)

1. New tab sends `notified:false` (`libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:159`).
   Approval never stamps `notifiedAt`, so every approved row stays in New. Recorded follow-up in
   the component doc comment (line 72).
2. `summaryNew = total - notified` (line 235) counts approved rows — screenshot shows New 410 with
   Approved 50.
3. New tab renders Approve for already-approved rows (`waitlist-pipeline.html:147`).
4. `AdminService.buildFilterWhere` (`libs/api/admin/src/lib/admin.service.ts:461`) accepts exactly
   one `field:value`; no combined filters.
5. Backend already supports `search` (email, source) and 5 sortable fields; the UI exposes neither.
6. No detail view: row shows email, source, join date only.

## Proposed scope (not yet user-confirmed in detail)

1. Stage separation: a `stage` relationPreset-style filter (new / invited / approved / converted),
   correct `pending` stat, approved-row visual treatment, no Approve on approved rows.
2. Advanced filters: multiple AND-ed filters (allowlisted), `source` and created-date range, UI
   filter bar (search, source, date range, sort, page size), URL-synced.
3. Bulk actions: select page, select all matching (chunks of 50 — `ApproveWaitlistDto` cap),
   bulk approve, CSV export. "Remove entries" is an OPEN decision — destructive; plan it as
   optional and flag it.
4. Details drawer (`@ptah-web/panel-ui` detail drawer): timeline, linked user/license/cohort/
   subscription by email, audit rows, actions. New `GET /v1/admin/waitlist/:id/details`
   (controller → service → Prisma).

## Constraints

- `libs/api/**` + `libs/web/**` only; bridge via `libs/api-contracts/**` if a shared wire type is needed.
- Every `@Body()`/`@Query()` binds `dtoPipe(Dto)`. Filter fields stay allowlisted.
- Angular: signals, OnPush, `inject()`. NestJS: no Prisma in controllers, `ConfigService` for env.
