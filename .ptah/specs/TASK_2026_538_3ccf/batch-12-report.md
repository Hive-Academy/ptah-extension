# Batch 12 report

Task: TASK_2026_538_3ccf — declarative surface contract v2.
Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2`.

## Completion and evidence

### 12.1 — v1 bridge

Implemented and exported `createDashboardSurfaceBridge(service): DashboardBroadcast`.
Scoped proposals call the existing facade's `recordV1Proposal` and return its observed delivery result. Anonymous proposals return `no-surface` without touching the service. A refused store commit maps to failed delivery with its original detail and zero delivered surfaces.

The new integration spec uses the real `SurfaceStateService`. It covers repeated upserts, decreasing agent revisions preserved verbatim, independent copies of one spec id in two tabs, rejection of a v2 mutation targeting `v1:summary`, anonymous isolation, failed delivery after commit, and store-budget rejection. Push assertions require `SURFACE_UPDATED`, routing id, tool call id and the host revision.

### 12.2 — surface namespace

Implemented `SurfaceNamespace`, `buildSurfaceNamespace`, `SurfaceCaller`, dependency and outcome types. Updates expose `accepted`, `delivery-failed`, `rejected`, `unavailable` and `render-only`. All update input passes through `validateSurfaceUpdateInput(input, jsonUtf8Bytes)` before caller/service checks. No update/component schema is parsed directly.

Reads use the exported, flat `SurfaceGetStateInputSchema` (the update validator accepts update operations only), then delegate bounded text and structure reads to `describeForAgent`. Read results are `found`, `not-found`, `rejected` or `unavailable`; defensive reader `too-large` results become `rejected`. This is the API handoff for Batch 13.

Scope is exclusively `caller.sessionId`; extra routing/session keys in tool arguments are rejected. Anonymous snapshots render without storage or pushes; revision 0 in their text is explicitly described as uncommitted. Anonymous patch/delete return the specified unavailable message and reads return the specified no-state message. Valid scoped operations with a missing service report host unavailability.

Applied results retain their committed revision and plain-text state even when delivery fails. Failure text explains that resending the same patch would be stale. Deletes name the removed surface and deletion revision. Namespace logging uses the existing non-throwing surface logger.

The new integration spec covers create/replace/patch/delete, text rendering, complete state and structure reads, scoped headless persistence, duplicate creates, mismatched revisions, cross-tab not-found for both tools, same-id creation in separate scopes, forged routing keys, deep/cyclic/oversized/invalid input, anonymous and missing-service ordering, hostile read getters, throwing loggers, and the false/throw/reject/partial/disposed delivery matrix. Each delivery-failure case verifies retained state, a stale retry, no second push and no unhandled rejection.

### 12.3 — exports and help

Exported the builder and public namespace types from the namespace-builders barrel. Added surface help covering operations, revision rules, scoped/bounded reads, outcomes, headless/anonymous cases and delivery recovery. Dashboard help now names `surface:updated` and describes the independent v1 agent/host revisions. A spec pins the key help statements.

### 12.4 — non-throwing delivery classification

Only the existing no-host `logger.debug` call in the delivery primitive was guarded. Host lookup/enumeration failures retain their previous failed classification. Appended two parameterized regression cases for a throwing logger with no host and no webview; both resolve `no-surface` and never attempt a send. Existing assertions were not edited.

## Risks and constraints

- R8 import rule: all new v2 runtime values use `@ptah-extension/shared/mcp-apps-contracts/surface`; plain surface types use `@ptah-extension/shared`. The existing v1 testing helper comes from the declared `@ptah-extension/shared/testing` entry point. No deep cross-library imports or shared barrel changes.
- Carried Batch 4 validation risk: recursive update input is walked and budgeted by the shared validator before schema parsing. Deep, cyclic and oversized inputs reject without mutation or delivery. Only the flat get-state schema is parsed directly.
- R4/R11 and Req 8.6: both adapters use the finished facade and observed delivery primitive. They create no parallel store or push path. All delivery failures retain the commit and distinguish delivery from state success; retries cannot apply twice.
- R12 scope/security: scope is never read from agent arguments. Cross-tab update/read tests, strict extra-key checks, reserved v1 ids and denied prototype paths exercise the boundary.
- Logger failure: new namespace logging is guarded by `nonThrowingSurfaceLog`; the primitive's classification log has its own catch. Logging cannot change those outcomes.
- R9 concurrent work: no shared, RPC handler, registration, submit-turn or other developer-owned source was edited. Verification runs only the requested vscode-lm-tools project. Later concurrent edits require the integrating reviewer to verify the final combined tree.
- No git write commands, no stubs, TODO markers, `as any` or `@ts-ignore` were introduced. Prettier was limited to the four new TypeScript files.
- New files are below 700 lines (bridge 25, bridge spec 136, namespace 182, namespace spec 424). All modified production files remain below 700. The existing dashboard spec was already 709 lines at HEAD; the required append-only regression brings it to 730. It was not shortened because the explicit append-only/no-existing-assertion-edits instruction takes precedence.
- Verification output is filtered to escape U+2028/U+2029 before stdout, retained in temporary logs and tailed. No raw characters were printed.

## Verification

Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools --outputStyle=static`.

First run: typecheck and lint passed; 61/62 suites and 1,354/1,355 tests passed. One new test used invalid base revision 0, so it exercised schema rejection instead of stale-revision rejection. Corrected the fixture to a valid mismatched revision (2); production behavior was correct.

Final run: **PASS, exit 0**. Typecheck passed; all **62 test suites and 1,355 tests passed**; lint passed with **0 errors and 44 warnings** elsewhere in the project. Total Nx duration: 37.4 seconds; Jest duration: 20.881 seconds. The tracked-file whitespace check (`git diff --check` limited to this batch's paths) also passed.

Non-failing tooling notices: Jest reported a worker that required force exit and a configuration ESM-load warning; Nx Cloud could not upload artifacts because the organization's free plan is disabled (401). None failed the requested local targets. These notices were recorded rather than changing unrelated tooling or rerunning a passing suite.

No cross-review or commit was performed; those remain with the integrating reviewer. Batch 13 API/dispatcher wiring is outside this batch.

## Absolute paths written

1. `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\dashboard-surface-bridge.ts` — created.
2. `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\dashboard-surface-bridge.spec.ts` — created.
3. `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\index.ts` — modified.
4. `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\surface-namespace.builder.ts` — created.
5. `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\surface-namespace.builder.spec.ts` — created.
6. `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\index.ts` — modified.
7. `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\system-namespace.builders.ts` — modified.
8. `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\dashboard-namespace.builder.ts` — modified only around the no-host debug call.
9. `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\dashboard-namespace.builder.spec.ts` — appended only.
10. `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\.ptah\specs\TASK_2026_538_3ccf\batch-12-report.md` — created.

Temporary verification captures (outside the repository): `%TEMP%\ptah-batch12-verification.log` and `%TEMP%\ptah-batch12-verification-final.log`.

## Revision 1

Read the complete `code-logic-review-batch-12.md` and addressed its serious, moderate and wording findings. This section supersedes the original store-refusal mapping and the original two-case logger-test description above.

### Changes

- **Store refusal is distinct from delivery failure.** `DashboardBroadcast` now permits the small `{ status: 'refused', reason }` result in addition to the existing `DashboardDeliveryOutcome`. The transport-only delivery type remains unchanged, so v2 pushes and committed delivery results cannot acquire a pre-commit refusal variant. The bridge returns `refused` when the facade refuses a v1 write. `buildDashboardNamespace` maps it to the existing tool-level `rejected` variant with the reason and explicit text that the proposal was not stored and nothing was sent to the UI. Accepted and delivery-failed variants, text and fields remain unchanged.
- **Scope widening explicitly authorized in revision instructions:** `dashboard-namespace.builder.ts` now also changes the broadcast return type and handles refusal in `proposeSpec`, beyond the original no-host debug guard at lines 133–136. No dispatcher, shared, facade, RPC or registration changes were needed.
- **Integration evidence:** the bridge budget-refusal test now checks `refused`, then calls the real dashboard namespace through the bridge and checks the exact `rejected` text including the budget reason. It checks that no state exists and no send occurred. Throwing logger methods supplied to that namespace cannot change the refusal outcome.
- **Non-vacuous logger regression:** removed the no-webview parameter. The sole no-host case uses a throwing `debug` spy, checks the resolved `no-surface` result and asserts exactly one debug call. The original pre-Batch-12 assertions remain untouched. The appended block shrank rather than growing.
- **Operation-specific retry wording:** v2 delivery failure now explains that create already created the surface, replace would be stale, patch would be stale, and delete already deleted the surface. Added create/replace/delete cases; the existing five-case patch delivery matrix retains its exact patch wording assertion.
- **Deferred dead branch, unchanged as instructed:** `planV1Proposal`'s conflict-rejection branch is unreachable with the current `checkSurfaceConflict` behavior, which always accepts `kind: 'v1-proposal'`. It remains harmless defensive code in the previously committed facade/mutation implementation. Reachable store-budget refusal is now reported separately by this revision.

### Verification and non-vacuity

Non-vacuity proven: temporarily removed only the nested logger guard and ran `npx nx run @ptah-extension/vscode-lm-tools:test --runInBand --testFile=libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/dashboard-namespace.builder.spec.ts --testNamePattern="createDashboardBroadcast with a throwing logger" --skipNxCache --outputStyle=static`. The selected test **failed as expected (exit 1)**: expected `{ status: 'no-surface' }`, received `{ status: 'failed', delivered: 0, surfaces: 0, reason: 'log channel closed' }`. One test failed, 35 were skipped; Jest duration 7.112 seconds. The original guarded source was restored in `finally` before full verification. This establishes that the regression detects removal of the guard. The dashboard spec shrank from 730 to **720 lines**, with its original 709-line prefix untouched.

Final verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools --outputStyle=static` **passed, exit 0**. Typecheck passed; **62 suites and 1,357 tests passed**, including the restored no-host logger regression; lint passed with **0 errors and 44 warnings**. Nx duration 1m 0s; Jest duration 45.206 seconds. `git diff --check` passed for the revision paths. A normalized-text comparison confirmed the original 709-line dashboard spec prefix is preserved, and a source check confirmed the logger guard was restored.

The same non-failing Jest configuration/worker-exit notices and Nx Cloud upload 401 appeared; unrelated tooling was not changed. No git write commands, shared/RPC/app edits or new agents were used. All requested revision fixes are complete; independent re-review remains with the caller.

Sanitized temporary evidence: `%TEMP%\ptah-batch12-r1-mutant.log` (expected regression failure) and `%TEMP%\ptah-batch12-r1-verification.log` (all final targets passed).

### Files written this round

- `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\dashboard-surface-bridge.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\dashboard-surface-bridge.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\dashboard-namespace.builder.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\dashboard-namespace.builder.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\surface-namespace.builder.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\surface-namespace.builder.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\.ptah\specs\TASK_2026_538_3ccf\batch-12-report.md`
