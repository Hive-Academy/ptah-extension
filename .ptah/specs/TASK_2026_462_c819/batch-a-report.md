# Batch A Report: TASK_2026_462_c819

## Overview

Completed Batch A (backend) for TASK_2026_462_c819 in the ptah-extension monorepo. Implemented Components 1–4 of the implementation plan covering waitlist stage/query policy, `AdminWaitlistService` (list, eligible-ids, audited CSV export, details), validated HTTP surface on `AdminWaitlistController`, disjoint stage stats in `AdminService.getStats`, and approval claim hardening (`already_paid` on converted rows).

## Files Changed

### Created

- `D:\projects\ptah-extension\libs\api\admin\src\lib\waitlist-query.ts` — Pure waitlist stage resolution (Converted > Approved > Invited > New), disjoint stage predicates, and query/order builders with id tie-breaker.
- `D:\projects\ptah-extension\libs\api\admin\src\lib\waitlist-query.spec.ts` — Unit tests for stage precedence across all 8 timestamp combinations, disjoint predicates, combined filters, and deterministic sorting.
- `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.dto.ts` — Query and path parameter validation DTOs with class-validator decorators and policy-based allowlists.
- `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.types.ts` — Wire response interfaces for list, stage counts, eligible-ids, CSV export, and details (with credential/PII exclusion).
- `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.service.ts` — Read service providing paginated list, eligible-ids resolution, formula-safe audited CSV export, and account context details.
- `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.service.spec.ts` — Unit tests for list pagination/counts, eligible-ids resolution, CSV export security/audit fail-closed, and details aggregation.
- `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.controller.spec.ts` — Unit tests asserting class guards, dtoPipe expectedType parameter bindings, CSV headers/filename, and shadow-prevention route ordering.

### Modified

- `D:\projects\ptah-extension\libs\api\admin\src\lib\admin-waitlist.controller.ts` — Added GET routes for list, eligible-ids, export.csv, and :id/details with `dtoPipe` bindings and actor extraction, keeping POST approve intact.
- `D:\projects\ptah-extension\libs\api\admin\src\lib\admin.module.ts` — Registered `AdminWaitlistService` in module providers.
- `D:\projects\ptah-extension\libs\api\admin\src\lib\admin.service.ts` — Updated `AdminStatsResponse` and `getStats` with disjoint stage predicates from `waitlist-query` and set `attention.waitlistUninvited = newCount`.
- `D:\projects\ptah-extension\libs\api\admin\src\lib\admin.service.spec.ts` — Updated `getStats` tests to verify disjoint stage predicates, sum-to-total invariants, and attention uninvited matching new count.
- `D:\projects\ptah-extension\libs\api\admin\src\lib\waitlist-approval\waitlist-approval.service.ts` — Hardened claim handling to throw `SkipRow('already_paid')` when claim indicates row paid.
- `D:\projects\ptah-extension\libs\api\admin\src\lib\waitlist-approval\waitlist-approval.service.spec.ts` — Added test verifying converted claim maps to `already_paid` without license creation, cohort assignment, audit write, or email.
- `D:\projects\ptah-extension\libs\api\marketing\src\lib\waitlist\waitlist.service.ts` — Hardened `claimForApproval` to require `approvedAt: null` AND `convertedAt: null`, returning `already_paid` on converted rows.
- `D:\projects\ptah-extension\libs\api\marketing\src\lib\waitlist\waitlist.service.spec.ts` — Added test verifying `claimForApproval` reports `already_paid` for converted rows.
- `D:\projects\ptah-extension\libs\api\audit\src\lib\audit-log.types.ts` — Added `waitlist.export` to audit action union.
- `D:\projects\ptah-extension\apps\ptah-license-server\src\common\route-map.spec.ts` — Registered 4 GET waitlist routes in `EXPECTED_ROUTES` and updated total route count to 146.
- `D:\projects\ptah-extension\apps\ptah-license-server\src\common\controller-validation.spec.ts` — Documented 80 -> 83 payload param transition and updated `MIN_TOTAL_PAYLOAD_PARAMS` floor to 83.

## Fixes Made to Earlier Agent's Files

1. **Prisma OrderBy Type**: Fixed `libs/api/admin/src/lib/waitlist-query.ts` where `Prisma.WaitlistOrderByWithRelationAndAggregatesInput` was non-existent in generated client; replaced with `Prisma.WaitlistOrderByWithRelationInput`.
2. **Missing Interface Export**: In `libs/api/admin/src/lib/admin-waitlist.service.ts`, added `export` to `WaitlistRecordRow` interface imported by `admin-waitlist.service.spec.ts`.
3. **Audit Row Type Narrowing**: In `libs/api/admin/src/lib/admin-waitlist.service.ts`, explicitly typed `targetType: 'Waitlist' as const` and `targetId: row.targetId ?? entry.id` to satisfy `WaitlistDetailsAudit` interface.
4. **Approval Spec Helper**: In `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.spec.ts`, updated `waitlistRow` default helper to include `convertedAt: null` (required for accurate mock claim evaluation).
5. **Approval Spec Assertions**: Updated the happy-path `where` expectation in `waitlist-approval.service.spec.ts` to include `convertedAt: null` matching the hardened conditional update.

## Deviations from Plan with Reason

None. Implementation strictly adheres to the contracts, error codes, HTTP statuses, and architectural guidelines defined in `implementation-plan.md`.

## Test and Typecheck Result Summary

### Test Execution

Command: `npx nx run-many -t test -p api-admin api-marketing api-audit ptah-license-server`

- `api-admin`: 5 test suites passed, 127 tests passed, 0 failed
- `api-audit`: 1 test suite passed, 5 tests passed, 0 failed
- `api-marketing`: 5 test suites passed, 46 tests passed, 0 failed
- `ptah-license-server`: 7 test suites passed, 172 tests passed, 0 failed
- **Total: 18 test suites passed, 350 tests passed, 0 failed**

### Typecheck Execution

Command: `npx nx run-many -t typecheck -p api-admin api-marketing api-audit ptah-license-server`

- All 4 projects passed `tsc --noEmit` cleanly with 0 type errors.

## Known Gaps

None. Components 1–4 are complete and all backend acceptance criteria are satisfied.
