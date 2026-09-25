# Batch 10 report - `SurfaceStateService` facade, mutations and registration

Executor: backend-developer subagent. Nothing was staged, committed or branched. The only git commands run were `status` and `diff` (to inspect), plus one `checkout --` that restored two Batch 9 files after an accidental Prettier run (see "Out-of-scope observations"). The working tree is left dirty for the team-leader.

## Tasks

| Task | Status | Evidence |
| --- | --- | --- |
| 10.1 `surface-agent-mutations.ts` | Done | `planAgentUpdate`: create rejects an existing id (`already-exists`, with `currentRevision`); replace, patch and delete require `baseRevision === current` through `checkSurfaceConflict(..., { kind: 'agent' })`. `planV1Proposal` upserts `v1:<specId>` with a structure footprint (`prepareReplaceCommit` appends `{ kind: 'structure' }`) and stores the envelope verbatim in `content.spec`. `agentOperationId` returns `'mcp:' + toolCallId`, which is stamped on the push payload and on the result. |
| 10.2 `surface-ui-mutations.ts` | Done | `planChange` resolves the input from the stored copy and writes only `input.path` (Req 6.7). `planSelect` requires a declared `dashboard.select` and validates against the host copy (Req 7.5). `planBeginSubmit` resolves the scope, requires the exact base, runs `checkSubmitValues` (every failing path is named), freezes the values, and formats with the injected nonce (`crypto.randomUUID` by default). `planSubmitSettlement` writes last-submit only on the same incarnation. The facade does reservation and replay (see 10.3). |
| 10.3 facade and spec | Done | `surface-state.service.ts` (687 lines). The spec is split into `surface-state.service.spec.ts` (agent, UI, races) and `surface-state.service.submit.spec.ts` (submit, eviction pushes). There are 23 cases. |
| 10.4 folder barrel | Done | `surface/index.ts` exports the facade, its option token, and the result and request types. |
| 10.5 registration | Done | `SURFACE_PUSH_HOST` is a `useValue` provider. Its `getHost()` resolves `TOKENS.WEBVIEW_MANAGER` on every call (the `mcpStatusShim` precedent, A1). `SURFACE_STATE_SERVICE` is registered with `registerSingleton`. `register.spec.ts` has an appended describe block with 4 cases: both tokens, singleton identity, lazy and replaced host resolution, and one end-to-end delivery through the resolved host. |
| 10.6 public barrel | Done | `src/index.ts` exports `SurfaceStateService` plus the request and result types that Batches 11-13 consume. |

## Files (absolute)

- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-agent-mutations.ts` (306 lines)
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-ui-mutations.ts` (509)
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-commit.ts` (184). The shared commit pipeline: apply, full re-validation, selection revalidation, `current + 1`, log append.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-operation-gate.ts` (177). Ledger reserve, replay, reject and apply for UI operations. It never pushes.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-state.service.ts` (687)
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-state.service.spec.ts` (671)
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-state.service.submit.spec.ts` (484)
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\index.ts` (31)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\di\register.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\di\register.spec.ts`. The block is appended. The only other edit adds a `WEBVIEW_MANAGER` key to the existing `jest.mock` of vscode-core. No existing assertion changed.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\index.ts`

## Stack observed

- tsyringe 4.10 DI with `@injectable`/`@inject`. `isOptional` is supported (`node_modules/tsyringe` `resolve(..., isOptional)`), with precedent at `cron-scheduler/src/lib/job-runner.ts:101`.
- Logging uses `TOKENS.LOGGER` / `Logger` from `@ptah-extension/vscode-core`, as in `diagnostics-cache-invalidator.service.ts:117`. The prefix is `[Surface]`: info for commits, deletions, evictions and reserved submits; warn for rejections, refusals, delivery failures and orphaned settlements.
- Validation comes from the contract validators only: `validateSurfaceDocument` (v2) and `validateDashboardSpec` (v1), with `jsonUtf8Bytes`.
- Imports follow the R8 rule: v2 values from `@ptah-extension/shared/mcp-apps-contracts/surface`, v1 values from `@ptah-extension/shared/mcp-apps-contracts`, and plain types from `@ptah-extension/shared`. Nothing was added to `surface.index.ts`.

## Verification

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools --skip-nx-cache --output-style=static` exited 0:

- Test Suites: 59 passed, 59 total.
- Tests: 1320 passed, 1320 total.
- Lint: 0 errors and 44 warnings. None of the warnings is in `lib/surface`, `lib/di` or `src/index.ts`. The warnings are in files this batch did not touch, for example `protocol-dispatcher.ts` and the web-search providers.
- The changed files contain no raw U+2028/U+2029, no `as any`, no `@ts-ignore` and no TODO. Every `catch` is `catch (error: unknown)`, or a promise `.catch((error: unknown) => ...)`.

## Commit discipline (plan 567-570, 576-578)

- Plans are pure. Every function in `surface-agent-mutations.ts`, `surface-ui-mutations.ts` and `surface-commit.ts` returns the next record plus the change. None of them touches the store, the ledger or the push.
- The facade `commitRecord` is the only swap site: `store.commit`, which is an atomic swap plus eviction. It then pushes the committed change, then pushes that commit's evictions. The only push site is the facade's private `publish`. Nothing is awaited on the commit path. The delivery primitive enumerates the host and queues its sends synchronously in call order.
- Spec "pushes two back-to-back commits in revision order, from inside the call": host enumeration is called twice before any await, and the host receives `[2, 3]`.
- Every accepted commit is `current + 1`. The spec "accepts a UI change on an older, non-conflicting base as current + 1, never base + 1" gives revision 4 for base 1.
- New surfaces start at `max(store.highWaterRevision, retiredRevision) + 1`. The next section explains `retiredRevision`.

## Batch 9 carry-forward

- The store is built with `charges: this.ledger` (`surface-state.service.ts`, constructor).
- The ledger admission callback is `store.makeRoom(charge, protect)`, answered as documented. It makes no nested reservation and no workaround. Its evictions are collected and pushed right after `reserve` returns, even when the ledger refuses after admission.
- All three eviction lists are pushed from the single push site, in order:
  - `commit`: spec "pushes evictions caused by a commit". The order is `a:snapshot, b:snapshot, c:snapshot, a:deleted`, and the recreated `a` starts at `highWaterRevision + 1 = 4`.
  - `makeRoom`: spec "pushes evictions caused by the ledger admission". A byte cap sized from a probe gives `a:deleted` before `profile:ops`.
  - `reserveTicket`: spec "pushes evictions caused by a submit ticket reservation". The cap is sized so that only the ticket forces the eviction. The next create gets `highWaterRevision + 1`.

## Risks and edge cases

- R11 (push order): single push site, synchronous. Pinned by the back-to-back spec above.
- R12 (security):
  - Prototype pollution and forged values: a change writes only the stored input's bound path, and `checkDraftValue` plus full document re-validation apply.
  - A forged component (non-input) is `undeclared`.
  - A selection on a component without `dashboard.select` is `undeclared`. An out-of-range index is `invalid-value`.
  - Spoofing labels: submit text comes from `formatSurfaceSubmitMessage` with a host nonce.
  - Cross-routing reads: `read`, `describeForAgent`, `change` and `resolveAction` under another routing id all give `not-found`. No state is created, and `usage().routingIds` stays 1 (spec "returns the same not-found ...").
- R13 (idempotency and settlement):
  - The operation id is reserved before any side effect.
  - An identical replay returns the recorded outcome with no second commit. A different fingerprint is `operation-conflict`, and an expired id is `operation-expired`.
  - An absent surface answers from an existing ledger record, else `not-found` with nothing reserved.
  - Busy rule: a second pending submit per routing id is `busy`.
  - Settlement after a change and after a replace writes last-submit on the same incarnation. Settlement after delete-then-recreate and after eviction settles the ledger, writes no last-submit, and logs a warn line. A double settle returns the recorded outcome. Ticket bytes are released at settlement (`usage().ticketBytes` returns to 0).
- Races (Req 5.7), both orders in the spec:
  - UI change against agent patch: the same path is stale either way. A disjoint path is accepted for UI and rejected for the agent.
  - UI change against replace.
  - UI change against delete: delete first gives the UI `not-found`, change first makes the delete stale.
- Recreate after delete: the recreated surface starts at 4, above the deletion revision 3. Both an old UI revision and an old agent base are `stale-revision`.
- Selection: cleared by replace-component with fewer rows, by a whole replace, and by remove-component. It is never remapped.
- An invalid patch changes nothing and pushes nothing: a missing id is named, a wrong type is `invalid-value`, and a data-model overflow is `budget` naming `maxDataModelBytes`. The spec asserts the view is unchanged and the push count is unchanged.
- Coding tab without `surfaceMode`: the service has no precondition. The spec creates and changes under a plain routing id.
- Delivery failure: the commit stands, `delivery` resolves `failed`, and a warn line is logged. The promise never rejects.

## Plan deviations

1. Two extra helper files, split under the facade rule to keep every file under 700 lines. Both are named by responsibility and neither pushes.
   - `surface-commit.ts`: the commit pipeline that agent and UI writes share.
   - `surface-operation-gate.ts`: ledger reservation, replay and settlement.
2. `SURFACE_STATE_SERVICE_OPTIONS` is a module-local `Symbol.for` token in the service file, injected with `{ isOptional: true }`. It is never registered, so production runs the documented defaults. Specs use it to pass small bounds, a fixed clock and a fixed nonce. It is not added to `tokens.ts`, which is not in this batch.
3. Deletion revision. Req 8.1 wants a deletion revision, so a delete reports `current + 1`. The store's `highWaterRevision` only sees committed records, so the facade keeps `retiredRevision`, and new incarnations start above both (Req 5.8). `deleted/evicted` pushes carry the high-water mark, because the evicted record's own revision is not returned by the store.
4. `SurfaceMutationOutcome.applied.revision` is optional. It is absent when a submit settled `applied` after its surface was deleted, evicted or recreated, where no last-submit is written. It is also absent if the settlement commit is refused. As first submitted, that refusal was reachable on a live surface under a tight `maxStoreBytes` (review F2), so the original claim that revision is absent "only" for gone surfaces was inaccurate. Revision 1 reserves settlement headroom, so a live same-incarnation surface now always gets its revision; the refusal branch stays only as a defensive log line. Batch 11's `SurfaceMutationResult` must allow `applied` and `indeterminate` with no revision (plan Component 8 lists `applied {operationId, revision}`), and must never redispatch because a revision is absent.
5. Two read methods were added for Batch 11 and diagnostics:
   - `resolveAction(routingId, surfaceId, actionId)` resolves `surface:action` from the stored declaration.
   - `usage()` returns the store accounting.
6. `register.ts` keeps the existing "Services registered" list byte-identical, because the existing spec pins it with `objectContaining` on the whole array. It adds a separate `"[VS Code LM Tools] Surface state registered"` info line.
7. `SurfaceActionId` is not in the zod-free main barrel, so the facade types it as `SurfaceAction['action']` (same type).

## Out-of-scope observations

- `surface-push.ts` and `surface-push.spec.ts` (Batch 9) are not Prettier-formatted. A Prettier run from this batch touched them by accident. Both were restored with `git checkout`, so they are unchanged from their committed state.
- A jest worker "failed to exit gracefully" warning appeared once during a combined run. It did not reproduce when the new specs ran alone. It is not attributed to this batch.

## Revision 1

Responds to `code-logic-review-batch-10.md` F1 (SERIOUS) and F2 (MODERATE).

### F1: a synchronous logging failure interrupted transitions

- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-log.ts` (37 lines). `nonThrowingSurfaceLog(logger)` wraps `info`, `warn` and `debug` in `try { ... } catch (error: unknown)` and drops a failed write. The wrapper lives in its own file, not the facade, so the facade stays under 700 lines (692).
- MODIFIED `surface-state.service.ts`. The injected `Logger` is wrapped once in the constructor (`this.log`). Every facade log call, the operation gate's logger and the delivery primitive's `debug` logger now go through it. No log call can throw between a committed effect and its bookkeeping:
  - ledger settlement after `commitRecord`;
  - the ticket return after `reserveTicket`;
  - orphan settlement;
  - each eviction push.
  `publishEvictions` also pushes before it logs, so every eviction is published whatever the log line does. Because the effect completes, no path returns `rejected` after an effect has happened.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-state.service.failure.spec.ts` (282 lines). A logger whose `info`, `warn` and `debug` all throw is used for:
  - `change`: `applied` at revision 2, `operationStatus` applied at 2, the replay gives the same result, a rejection is terminal, and the pushes are `[1, 2]`.
  - `beginSubmit`: returns the ticket. Then `settleSubmit`: `applied` at revision 2, the operation is terminal, the ticket bytes are released, `lastSubmit` is written, and the next submit dispatches (not busy).
  - Orphaned settlement after a delete: terminal `indeterminate`, ticket released.
  - Eviction log failure: `a:snapshot, b:snapshot, a:deleted` are all pushed.

### F2: ticket admission did not cover settlement growth

Chosen fix: guarantee the settlement commit, rather than add a metadata-unavailable disposition.

- MODIFIED `surface-ui-mutations.ts`. `submitSettlementHeadroom(ticket)` is the JSON bytes of the worst-case last-submit record (status `indeterminate`, `submittedAt = Number.MAX_SAFE_INTEGER`), plus one `submit-record` write-log entry with a maximal revision, plus its comma. Those are the only parts of the record that change at settlement: content and selection are untouched, and a log entry dropped by the 32-entry bound only shrinks the record. The ticket's reserved bytes are now values + message + headroom.
- Why this holds through intervening writes:
  - The store keeps `record + non-evictable charges <= maxStoreBytes` for the live record after every `commit`, `makeRoom` and `reserveTicket`. Those charges include this ticket.
  - `settleSubmit` releases the ticket before its commit.
  - So the same-incarnation commit, which grows the record by at most the headroom, always fits. The refusal branch remains only as a defensive warn.
- Regression specs are in `surface-state.service.failure.spec.ts`:
  - The reviewer's fixture (128-character card id, one checkbox, empty model). The cap is the probed total after `beginSubmit`. Settlement gives `{ status: 'applied', revision: 2 }`, and the surface holds `lastSubmit`.
  - A variant where an intervening `surface:change` fills the cap exactly. Settlement still commits, giving `indeterminate` at revision 3.
  - With the headroom term replaced by `0`, both specs fail (2 failed, 4 passed). With the fix restored, both pass.

### Verification

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools --skip-nx-cache --output-style=static` exited 0:

- 60 of 60 suites and 1,326 of 1,326 tests passed.
- Lint: 0 errors and 44 warnings, none of them in `lib/surface`, `lib/di` or `src/index.ts`.
- No raw U+2028/U+2029 in the changed files. Prettier ran only on this batch's files, and `git status` shows no Batch 9 file modified.

### Batch 11 handoff (review recommendation for deviation 4)

- Define the submit result so that `applied` and `indeterminate` may carry no committed surface revision. Preferably add an explicit surface-state disposition: updated with a revision, gone or recreated, or metadata unavailable.
- Keep the terminal outcome and the operation id through `surface:action`, `operationStatus` and replay.
- Keep `change` and `select` results revision-bearing.
- Never redispatch because a revision is absent.
