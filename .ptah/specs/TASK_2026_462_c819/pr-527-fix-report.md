# PR #527 fix report

All 27 open SonarCloud findings were fixed. Seven CodeRabbit comments were fixed; one was verified as already addressed and skipped. API routes, response fields, statuses, and error codes remain unchanged.

## SonarCloud issues

|   # | Rule                                    | Status | Reason                                                                                         | Current file:line                                                                                                   |
| --: | --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
|   1 | `typescript:S3358`                      | FIXED  | Replaced the outcome-style nested ternary with an explicit outcome-to-style lookup.            | `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.ts:51,182`                         |
|   2 | `typescript:S3358`                      | FIXED  | Replaced nested error-code selection with independent `if`/`else if` statements.               | `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.ts:241`                            |
|   3 | `typescript:S5906`                      | FIXED  | Uses `toHaveLength(1)` for list data.                                                          | `libs/web/admin/src/lib/services/admin-api.service.spec.ts:99`                                                      |
|   4 | `typescript:S5906`                      | FIXED  | Uses `toHaveLength(1)` for audit data.                                                         | `libs/web/admin/src/lib/services/admin-api.service.spec.ts:290`                                                     |
|   5 | `typescript:S7763`                      | FIXED  | `WaitlistListRow` is directly type-re-exported.                                                | `libs/web/admin/src/lib/services/admin-api.service.ts:20`                                                           |
|   6 | `typescript:S7763`                      | FIXED  | `WaitlistSortField` is directly type-re-exported.                                              | `libs/web/admin/src/lib/services/admin-api.service.ts:20`                                                           |
|   7 | `typescript:S7763`                      | FIXED  | `WaitlistSource` is directly type-re-exported.                                                 | `libs/web/admin/src/lib/services/admin-api.service.ts:20`                                                           |
|   8 | `typescript:S7763`                      | FIXED  | `WaitlistStage` is directly type-re-exported.                                                  | `libs/web/admin/src/lib/services/admin-api.service.ts:20`                                                           |
|   9 | `typescript:S7763`                      | FIXED  | `WaitlistStageCounts` is directly type-re-exported.                                            | `libs/web/admin/src/lib/services/admin-api.service.ts:20`                                                           |
|  10 | `typescript:S7763`                      | FIXED  | `SortOrder` is directly type-re-exported.                                                      | `libs/web/admin/src/lib/services/admin-api.service.ts:20`                                                           |
|  11 | `typescript:S6582`                      | FIXED  | CSV filename capture uses optional chaining.                                                   | `libs/web/admin/src/lib/services/admin-api.service.ts:840`                                                          |
|  12 | `typescript:S6582`                      | FIXED  | Drawer approval eligibility uses optional chaining.                                            | `libs/web/admin/src/lib/waitlist/waitlist-details-drawer.ts:104`                                                    |
|  13 | `Web:S7927`                             | FIXED  | Source select derives its accessible name from the visible `Source` label.                     | `libs/web/admin/src/lib/waitlist/waitlist-filter-bar.html:25`                                                       |
|  14 | `Web:S7927`                             | FIXED  | Page-size select derives its accessible name from the visible `Show` label.                    | `libs/web/admin/src/lib/waitlist/waitlist-filter-bar.html:104`                                                      |
|  15 | `Web:S7927`                             | FIXED  | Clear action derives its accessible name from the visible `Clear filters` text.                | `libs/web/admin/src/lib/waitlist/waitlist-filter-bar.html:131`                                                      |
|  16 | `typescript:S7773`                      | FIXED  | Uses `Number.parseInt`.                                                                        | `libs/web/admin/src/lib/waitlist/waitlist-filter-bar.ts:110`                                                        |
|  17 | `Web:S7927`                             | FIXED  | Removed the conflicting export `aria-label`; visible `Export CSV` text supplies the name.      | `libs/web/admin/src/lib/waitlist/waitlist-pipeline.html:34`                                                         |
|  18 | `Web:S6819`                             | FIXED  | Selection announcement now uses semantic `<output aria-live="polite">`.                        | `libs/web/admin/src/lib/waitlist/waitlist-pipeline.html:93`                                                         |
|  19 | `typescript:S7762`                      | FIXED  | Temporary download anchor cleanup uses `a.remove()`.                                           | `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:509`                                                          |
|  20 | `typescript:S3776`                      | FIXED  | Query parsing was decomposed into named allowlist/date/pagination helpers.                     | `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:223`                                                       |
|  21 | `typescript:S7773`                      | FIXED  | Page parsing uses `Number.parseInt`.                                                           | `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:248`                                                       |
|  22 | `typescript:S7773`                      | FIXED  | Page-size parsing uses `Number.parseInt`.                                                      | `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:253`                                                       |
|  23 | `typescript:S4144`                      | FIXED  | Removed the duplicate query-parameter reader and reused `getQueryParam`.                       | `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:223,355`                                                   |
|  24 | `Web:ItemTagNotWithinContainerTagCheck` | FIXED  | Row root is a `div role="listitem"`, under the pipeline's `div role="list"`.                   | `libs/web/admin/src/lib/waitlist/waitlist-row.html:1`; `libs/web/admin/src/lib/waitlist/waitlist-pipeline.html:187` |
|  25 | `typescript:S7760`                      | FIXED  | CSV scalar helper uses a default parameter.                                                    | `libs/api/admin/src/lib/admin-waitlist.service.ts:647`                                                              |
|  26 | `typescript:S7781`                      | FIXED  | CSV quote escaping uses `replaceAll`, preserving doubled-quote output.                         | `libs/api/admin/src/lib/admin-waitlist.service.ts:649`                                                              |
|  27 | `typescript:S3776`                      | FIXED  | Flattened date-range validation and retained the same predicates and sanitized error contract. | `libs/api/admin/src/lib/waitlist-query.ts:256,283`                                                                  |

## CodeRabbit inline comments

| Comment ID   | Status  | Reason                                                                                                                                                        | Current file:line                                                                                                                    |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `4034441075` | FIXED   | Export route now composes `AdminThrottlerGuard` with a route-specific 5/minute throttle; metadata is regression-tested.                                       | `libs/api/admin/src/lib/admin-waitlist.controller.ts:92`; `libs/api/admin/src/lib/admin-waitlist.controller.spec.ts:77`              |
| `4034441100` | FIXED   | All statistics counts run in one array-form Prisma transaction at `RepeatableRead`, preserving the response shape.                                            | `libs/api/admin/src/lib/admin.service.ts:354`; `libs/api/admin/src/lib/admin.service.spec.ts:495`                                    |
| `4034441108` | FIXED   | Authoritative `attention.waitlistUninvited` fixture is 42 while fallback `waitlist.new` remains 45; both paths are asserted distinctly.                       | `libs/web/admin/src/lib/overview/overview.spec.ts:31,72,87`                                                                          |
| `4034441115` | FIXED   | Visible `Show` and `Clear filters` text now supplies each accessible name; specs enforce the association/no-conflicting-label behavior.                       | `libs/web/admin/src/lib/waitlist/waitlist-filter-bar.html:104,131`; `libs/web/admin/src/lib/waitlist/waitlist-filter-bar.spec.ts:35` |
| `4034441130` | FIXED   | Removed conflicting export `aria-label`; the visible `Export CSV` label supplies the accessible name.                                                         | `libs/web/admin/src/lib/waitlist/waitlist-pipeline.html:34`                                                                          |
| `4034441143` | FIXED   | Debounced search compares with URL-owned query state, so re-entering the same term after clearing navigates correctly; regression test added.                 | `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:343`; `libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts:254`          |
| `4034441156` | SKIPPED | Already addressed in current code: successful responses canonicalize an out-of-range page with `replaceUrl: true`; the existing regression test was retained. | `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:330`; `libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts:280`          |
| `4034706812` | FIXED   | Runtime response schema rejects duplicate eligible IDs before selected-count consistency checks; regression coverage added.                                   | `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:112`; `libs/web/admin/src/lib/services/admin-api.service.spec.ts:172`       |

## Verification

Command: `npx nx run-many -t typecheck,test -p api-admin api-marketing api-audit ptah-license-server web-admin`

Header confirmed **5 projects**. Exit code 0. All typechecks passed.

| Project               | Typecheck      |   Test suites |          Tests |
| --------------------- | -------------- | ------------: | -------------: |
| `api-admin`           | PASS           |      5 passed |     138 passed |
| `api-marketing`       | PASS           |      5 passed |      48 passed |
| `api-audit`           | PASS           |      1 passed |       5 passed |
| `ptah-license-server` | PASS           |      7 passed |     172 passed |
| `web-admin`           | PASS           |     23 passed |     285 passed |
| **Total**             | **5/5 passed** | **41 passed** | **648 passed** |

Command: `npx nx run-many -t lint -p web-admin api-admin`

| Project     | Result         | Errors | Warnings | Notes                                                                                                |
| ----------- | -------------- | -----: | -------: | ---------------------------------------------------------------------------------------------------- |
| `web-admin` | PASS           |      0 |        8 | Existing warnings are in unrelated admin-detail/delete-user/issue-license files.                     |
| `api-admin` | NOT APPLICABLE |      — |        — | Nx reports that this project has no `lint` target. Focused ESLint over the changed API files passed. |

## Constraint note

No new file exceeds 700 lines. Three touched files were already above the repository's documented soft ceiling before this review fix: `admin-api.service.ts` (845), `admin.service.ts` (762), and `admin-waitlist.service.ts` (714). They were not split because doing so would require unnamed companion files outside the explicitly allowed review scope; all other touched files remain below 700 lines.
