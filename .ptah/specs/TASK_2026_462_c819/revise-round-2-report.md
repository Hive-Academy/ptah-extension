# Revise Round 2 Report — `TASK_2026_462_c819`

## Outcome

All seven requested defects are **FIXED**. Routes, response field names, HTTP statuses, and API error codes remain unchanged. The approval modal is 257 lines and the waitlist pipeline is 586 lines, both below the 700-line ceiling.

## Defect results

### 1. Per-entry approval outcomes — FIXED

- Change: retained the aggregate tally and added one rendered row for every `result.results` entry, showing email or id, a fixed outcome label, and only the allowlisted warning/error code. `failed` and `not_found` rows have distinct error/warning border and background treatments.
- Change locations: `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.ts:169`; `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.html:48`.
- Pinning test: `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.spec.ts:86` verifies a mixed five-result response renders each identifier, the safe `GRANT_FAILED` code, and identifiable `failed`/`not_found` rows while preserving the tally.

### 2. Out-of-range page — FIXED

- Change: after a successful empty response with a positive total, the pipeline compares the requested page to `totalPages` and replace-navigates to the last valid page. The strict greater-than guard prevents a loop after the canonical page loads.
- Change location: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:324`.
- Pinning test: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts:254` verifies `?page=99` with two pages replace-navigates to page 2 exactly once.

### 3. Raw error strings — FIXED

- Change: export errors map only `WAITLIST_EXPORT_LIMIT_EXCEEDED`, `WAITLIST_EXPORT_UNAVAILABLE`, and `WAITLIST_EXPORT_AUDIT_FAILED` to fixed copy; every other object/string uses a generic fixed fallback. Approval maps `COHORT_NOT_CONFIGURED` and the contract's validation 400 to fixed copy; unknown errors use the generic fallback. No server or transport `message` is rendered.
- Change locations: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:67`; `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:517`; `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.ts:54`; `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.ts:233`.
- Pinning tests: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts:411` and `:433` cover known and unknown export errors; `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.spec.ts:125` and `:161` cover known and unknown approval errors and assert raw messages are absent.

### 4. Loose schemas — FIXED

- Change: stats `pending`, `new`, `invited`, and `approved` are required non-negative integers. Eligible-id responses cap `ids` at 50, require non-negative integer counts, and refine `selected === ids.length`, `eligibleMatching >= selected`, and `truncated === (eligibleMatching > selected)`. Selection state also slices matching ids to 50 defensively.
- Change locations: `libs/web/admin/src/lib/services/admin-api.service.ts:383`; `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:109`; `libs/web/admin/src/lib/waitlist/waitlist-selection.state.ts:147`.
- Fixture audit: every existing web-admin stats fixture already supplied the four required fields; no fixture changes outside the scoped specs were needed.
- Pinning tests: `libs/web/admin/src/lib/services/admin-api.service.spec.ts:152` covers oversized/inconsistent/negative eligible-id payloads; `:406` and `:422` cover missing, negative, and fractional stats fields; `libs/web/admin/src/lib/waitlist/waitlist-selection.state.spec.ts:149` verifies the defensive slice.

### 5. Audit metadata value types — FIXED

- Change: `WaitlistDetailsAuditMetadata` is constructed field by field. String, boolean, and `expiresAt: string | null` guards admit only contract-valid values; malformed known values and unknown keys are omitted without casting a generic projected record.
- Change location: `libs/api/admin/src/lib/admin-waitlist.service.ts:697`.
- Pinning test: `libs/api/admin/src/lib/admin-waitlist.service.spec.ts:674` supplies object, number, array, and wrong-scalar values for known keys alongside valid fields and verifies only valid allowlisted fields survive.

### 6. Export cap race — FIXED

- Change: the existing pre-read count gate remains. The row read now requests 50,001 rows and throws the existing 413 `WAITLIST_EXPORT_LIMIT_EXCEEDED` when the sentinel row is present, before CSV encoding and before the audit write.
- Change locations: `libs/api/admin/src/lib/admin-waitlist.service.ts:317`; `libs/api/admin/src/lib/admin-waitlist.service.ts:329`.
- Pinning test: `libs/api/admin/src/lib/admin-waitlist.service.spec.ts:588` makes the pre-count return 50,000 and `findMany` return 50,001, then verifies 413, `take: 50_001`, and no audit write.

### 7. Weak tests — FIXED

- CSV cases: table-driven coverage at `libs/api/admin/src/lib/admin-waitlist.service.spec.ts:532` covers leading `=`, `+`, `-`, `@`, tab, carriage return, embedded quote, and embedded newline.
- Stats behavior: `libs/api/admin/src/lib/admin.service.spec.ts:640` drives `getStats` through mocked counts and asserts returned `new`, `invited`, `approved`, `converted`, `pending`, and attention values for approved-without-notified and converted-stage cases.
- Route metadata: `libs/api/admin/src/lib/admin-waitlist.controller.spec.ts:149` replaces prototype property-order inference with `PATH_METADATA` assertions for `eligible-ids`, `export.csv`, and `:id/details`, including path distinctness.

## Verification

Command: `npx nx run-many -t typecheck,test -p api-admin api-marketing api-audit ptah-license-server web-admin`

- Header: **Running targets typecheck, test for 5 projects**.
- `api-admin`: typecheck passed; 5 suites, 137 tests passed.
- `api-marketing`: typecheck passed; 5 suites, 48 tests passed.
- `api-audit`: typecheck passed; 1 suite, 5 tests passed.
- `ptah-license-server`: typecheck passed; 7 suites, 172 tests passed.
- `web-admin`: typecheck passed; 23 suites, 283 tests passed.
- Total: 41 suites, 645 tests passed; 5/5 typecheck targets passed. Nx used the local cache for 2 of 10 targets.

Command: `npx nx run-many -t lint -p web-admin`

- `web-admin`: lint passed with 0 errors and 8 warnings. All eight warnings are pre-existing in untouched `admin-detail.html`, `delete-user-modal.ts`, and `issue-comp-license-modal.ts` files.

## Plan deviations

None. No route, response field, status, or error code changed, and no file outside the authorized scope was modified.
