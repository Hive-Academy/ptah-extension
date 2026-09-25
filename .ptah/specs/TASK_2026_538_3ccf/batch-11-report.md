# Batch 11 report — `surface:*` RPC registry, schema, handlers (including submit) and manifest

Executor: backend-developer subagent. Worktree `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2`. No git commands were run.

## Tasks

### Task 11.1: RPC types and registry entries — COMPLETE

- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\lib\types\rpc\rpc-surface.types.ts` (200 lines)
  - Params:
    - `SurfaceReadParams {routingId, surfaceId?}`.
    - `SurfaceMutationParamsBase {routingId, surfaceId, revision, operationId}`.
    - `SurfaceChangeParams` (+ `componentId`, `value`), `SurfaceSelectParams` (+ `selection | null`) and `SurfaceActionParams` (+ `actionId`, and no params field).
    - `SurfaceOperationParams {routingId, operationId}`.
  - Results:
    - `SurfaceReadResult` exactly as in Component 8.
    - `SurfaceMutationResult` (change/select) = `applied {operationId, revision}` (revision REQUIRED) | `rejected` | `not-found {operationId?}` (no revision) | `pending`.
    - `SurfaceActionResult` (action) = `applied {operationId, surfaceState}` | `indeterminate {operationId, detail, surfaceState}` | `rejected` | `not-found` | `pending` | `unsupported {operationId, action}`.
    - `SurfaceOperationResult {status, reason?, detail?, revision?, currentRevision?}`.
  - Batch 10 deviation 4 carry-forward: an explicit disposition `SurfaceSubmitSurfaceState = {kind: 'updated', revision} | {kind: 'not-recorded'}`.
    - `applied` and `indeterminate` submits carry the disposition, never a bare optional revision.
    - `change` and `select` results stay revision-bearing.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\lib\types\rpc.types.ts`
  - `export * from './rpc/rpc-surface.types'` beside the peer-session re-export.
  - An `import type` block.
  - Five `RpcMethodRegistry` entries after `peerSession:send`.
  - Five `RPC_METHOD_ENTRIES` entries after `'peerSession:send': true`.

### Task 11.2: `surface-rpc.schema.ts` — COMPLETE

- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\handlers\surface-rpc.schema.ts` (96 lines)
  - Five `.strict()` schemas, composed only from the leaf contract schemas `SurfaceAnyIdSchema`, `SurfaceOperationIdSchema`, `SurfaceDataValueSchema` and `SurfaceSelectionSchema`. Nothing is built from `SurfaceComponentSchema` or `SurfaceEnvelopeSchema`.
  - Component and action ids reuse the contract rule via `SurfaceSelectionSchema.shape.componentId`, so no private contract helper had to be exported.
  - Mutations require `routingId`, `surfaceId`, `revision` (positive integer) and `operationId` (Req 6.2).
  - `routingId` is bounded at 256 characters.
  - Bytes are measured in the handler before any parse (see 11.3).

### Task 11.3: `SurfaceRpcHandlers` — COMPLETE

- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\handlers\surface-rpc.handlers.ts` (519 lines)
  - `@injectable`, with `METHODS` `satisfies readonly RpcMethodName[]`.
  - Injects `TOKENS.LOGGER` and `TOKENS.RPC_HANDLER`, plus two optional collaborators:
    - `VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE`;
    - `CHAT_TOKENS.SURFACE_SUBMIT_TURN`.
  - Each call runs in this order:
    1. `jsonUtf8Bytes(params)` against `SURFACE_LIMITS.maxRpcRequestBytes`. A request that cannot be serialized (a cycle or a BigInt) is also `INVALID_PARAMS`.
    2. The strict zod parse.
    3. `RpcUserError(..., 'INVALID_PARAMS')`, which names at most 5 issue paths and messages, each capped at 200 characters, and never a submitted value.
    4. Delegation to `SurfaceStateService`.
  - `surface:action` resolves the action with `resolveAction` (deviation 5), from the stored declaration only:
    - `surface.submit` runs `beginSubmit`. The operation then reads `pending` until `SurfaceSubmitTurnService.dispatch` returns, and `settleSubmit` runs after it. `dispatchTicket` never throws, so settlement always runs.
    - `dashboard.select` is rejected as `undeclared` with a detail pointing to `surface:select`.
    - Every other `dashboard.*` action is `unsupported`, with no reservation and no side effect.
    - An undeclared action is `undeclared`, or `stale-revision` with `currentRevision` when the UI rendered an older revision.
  - An operation id the ledger already holds is routed through `beginSubmit`, whatever the surface now declares. The ledger then answers with a replay or an `operation-conflict`, and a recorded id never reaches dispatch. So a retry of a submit whose surface was deleted or recreated returns its terminal outcome and never starts a second turn.
  - Missing state service: `Error('surface state unavailable on this host')`, which becomes an RPC error response.
  - Missing submit-turn service: the submit settles `rejected: session-unavailable`, so the operation still reaches a terminal state.
  - Logging goes through `safeLog`, which uses `try` / `catch (error: unknown)`. No log call sits between a reservation and its settlement.
  - The `indeterminate` detail is the fixed `SURFACE_SUBMIT_INDETERMINATE_DETAIL`. Raw error text never crosses the boundary: the spec asserts that "pipe closed" does not appear.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\chat\session\surface-submit-turn.service.ts` (Batch 5 reject-reason note)
  - `SURFACE_SUBMIT_TURN_REJECT_REASONS = ['busy', 'session-unavailable'] as const satisfies readonly SurfaceRejectReason[]`.
  - `SurfaceSubmitTurnRejectReason` is derived from it.
- CREATED specs (split for the 700-line rule):
  - `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\handlers\surface-rpc.handlers.spec.ts` (434 lines), which covers:
    - registration;
    - INVALID_PARAMS with state and pushes unchanged: unknown key, wrong type, oversize id, over 16 KiB, missing operation id, missing revision, forged action `params`, malformed operation id, non-serializable request;
    - the byte budget named in the error;
    - missing service;
    - cross-routing and unknown surface `not-found` with no revision and no state created;
    - `change` applied, pushed, with `sendMessageToSession` never called (Req 9.4);
    - a forged value for a non-input gives `undeclared`;
    - stale change;
    - select validated on the host copy;
    - each unsupported action (6 cases, Req 6.8) with operation `unknown` and no push;
    - `dashboard.select` pointed to `surface:select`;
    - undeclared and stale action;
    - operation-id reuse gives `operation-conflict`;
    - read equals the `get_state` revision, data model, selection and lastSubmit; read of the whole routing id.
  - `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\handlers\surface-rpc.handlers.submit.spec.ts` (271 lines), which covers:
    - one dispatch through the real `SurfaceSubmitTurnService` with a spy;
    - `pending` while the dispatch is unresolved, through both `surface:operation` and a concurrent duplicate;
    - a later duplicate gives the same result, and `sendMessageToSession` is called once with `admission: 'require-idle'`;
    - form values are not cleared;
    - two submit actions: only the invoked scope in the content and in `lastSubmit`;
    - invalid submit names `form.name` and leaves values unchanged;
    - stale submit;
    - busy;
    - indeterminate without leaking error text, and no resend;
    - no runtime gives `session-unavailable`.
  - Deviation 4 is pinned at the wire boundary:
    - delete before settlement: `applied` with `surfaceState: {kind: 'not-recorded'}` and no `revision`; the replay is identical; `surface:operation` is `{status: 'applied'}`; one dispatch;
    - delete, then a dispatch failure: `indeterminate` with `not-recorded`;
    - recreate before settlement: `not-recorded`, the new incarnation has `lastSubmit: null`, and replays against the same declaration and against a replaced surface without the action both return the recorded outcome, with one dispatch.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\test-utils\surface-rpc-harness.ts` (251 lines). It is the shared wiring for both specs:
  - the real `RpcHandler`, `SurfaceStateService` and `SurfaceSubmitTurnService`;
  - fakes for the adapter, lifecycle and broadcaster.
  - The `test-utils/` folder is excluded from the lib build by `tsconfig.lib.json`.

### Task 11.4: Handler barrel and manifest entry — COMPLETE

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\handlers\index.ts`: exports `SurfaceRpcHandlers`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\host-profile\manifest.ts`: adds `{ key: 'surface', methods: SurfaceRpcHandlers.METHODS, requires: [], handler: SurfaceRpcHandlers }` after `peerSession`, with a comment explaining `requires: []`.
  - All three hosts call `registerVsCodeLmToolsServices`: `phase-2-libraries.ts`, `phase-3-storage.ts` and `cli-engine/container.ts`.
- `rpc-allowlist.spec.ts`, `verify-and-report.spec.ts`, `resolve-handler-plan.spec.ts` and the three host `rpc-surface.spec.ts` are green, none of them edited.

## Verification

1. `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers` gave exit 0.
   - shared: 77 of 77 suites and 2,097 tests passed. Lint: 0 errors, 5 warnings, all pre-existing. One of them is the `rpc.types.ts` max-lines warning, which was already over 700 lines before this batch.
   - rpc-handlers: 107 of 107 suites passed; 3,212 tests passed and 4 skipped. Lint: 0 errors, 41 warnings, none in any file this batch created or changed.
   - The two new specs pass 38 of 38 tests.
2. `npx nx run-many -t test -p ptah-electron ptah-extension-vscode @ptah-extension/cli-engine --testPathPattern=rpc-surface` gave exit 1. The only failures are the two known Electron environment suites, `better-sqlite3-packaging` and `shell-csp`, with 8 tests failing and no Electron binary.
   - Everything else passed: Electron 50 suites, VS Code 19 suites (192 tests), cli-engine 7 suites (93 tests).
   - Jest 30 ignores `--testPathPattern` here, so the full host suites ran.
   - Run one by one with `--testPathPatterns=rpc-surface`, each host `rpc-surface.spec.ts` passes: VS Code 2 of 2, Electron 2 of 2, cli-engine 12 of 12.
3. The first run of command 2 exposed a regression from this batch, which is now fixed. `rpc-surface.types.ts` had a type-only import of `SurfaceSubmitIssue` from `surface-bindings.ts`. That pulled the module into the main-barrel graph of `@ptah-extension/settings-core:build`, which compiles without `strictNullChecks`, so the build failed with TS2339 on union narrowing and the VS Code test target could not start. The issue shape is now restated as `SurfaceRpcSubmitIssue`, and the module reaches only `surface.types.ts`. Both commands were then re-run and the results above are from that re-run.
4. Hygiene:
   - Every new file is under 700 lines, and the handler file is 519.
   - No TODO, `as any` or `@ts-ignore`.
   - Every catch is `catch (error: unknown)`.
   - No raw U+2028/U+2029 in the new files.
   - Prettier ran only on the files this batch created. The four modified files already pass `prettier --check`.

## Risks, assumptions and edge cases

- R1: the registry entries, the types, the handler and the manifest entry land in this one batch. The allowlist, verify-and-report, resolve-handler-plan and three host specs pass unedited.
- R5: `surface:action` implements the whole submit branch with no stub. The order is reserve, then `pending`, then dispatch, then settle.
- R8: imports follow the rule:
  - v2 values (`SURFACE_LIMITS`, the leaf schemas, `SURFACE_ACTIONS`) come from `@ptah-extension/shared/mcp-apps-contracts/surface`;
  - plain types come from `@ptah-extension/shared`;
  - the service and tokens come from `@ptah-extension/vscode-lm-tools`.
  - No deep imports and no `surface.index.ts` edit were needed.
- R9: Batch 12 runs concurrently in vscode-lm-tools, which rpc-handlers typechecks through path mapping. Both commands passed on the current tree. The team-leader should re-run command 1 after Batch 12 commits.
- R12 (security):
  - strict schemas;
  - bytes measured before parsing;
  - forged `value` and forged action `params` rejected;
  - actions, inputs and scope resolved only from the stored copy;
  - cross-routing ids give `not-found`;
  - no raw error text in results;
  - issue messages are capped and never include submitted values.
- R13: idempotency comes from the ledger. A duplicate, concurrent or later, dispatches once, and a recorded id never reaches dispatch.
- Edge cases from the plan validation list:
  - A duplicate submit op id gives one dispatch.
  - A missing store on a supported host gives the error response.
  - A submit settling after delete or recreate keeps its terminal outcome with no revision, and its replay does not dispatch a second time.
  - Cross-routing reads give `not-found`.
- F1 lesson: handler logging cannot throw into a transition. Its only log lines are the registration debug and the dispatch-throw warn, both through `safeLog`. The service's own logging is already non-throwing.

## Plan deviations

1. Result shapes (the carried deviation 4, going further than Component 8):
   - The submit's `applied` and `indeterminate` carry `surfaceState` instead of `revision`.
   - `SurfaceActionResult` is separate from `SurfaceMutationResult`, so change and select keep a required revision.
   - There are two dispositions, `updated` and `not-recorded`, not three. The ledger does not record WHY a revision is absent, so a replay cannot tell "gone" from "recreated" from "refused". Since the F2 fix, a refusal is only defensive. `not-recorded` documents all three causes.
2. `SurfaceOperationResult` adds `detail?`, and splits the ledger's one revision into `revision` (applied or indeterminate) and `currentRevision` (a stale rejection).
3. `surface:read` and `surface:operation` do not take `revision` or `surfaceId`. Req 6.2 covers mutations, and neither method has a rendered revision.
4. The following are not reserved in the ledger, because they have no side effect, so `surface:operation` reports `unknown` for them:
   - unsupported actions;
   - `dashboard.select` through `surface:action`;
   - undeclared actions.
5. With no submit-turn service, the submit is settled `rejected: session-unavailable` instead of throwing, so the reservation reaches a terminal state.
6. File count: 7 production files (6 plus the accepted Batch 5 type edit). The single planned spec became 2 specs plus a `test-utils` harness, to keep each file under 700 lines.
7. An applied `change` or `select` without a revision, or a `pending` / `indeterminate` outcome for either, cannot happen: the ledger fingerprints the operation kind. `toMutationResult` throws a fixed internal error for it instead of reporting a revision that was never committed.

## Out-of-scope observations

- Jest 30 ignores the `--testPathPattern` flag given in the batch's verification command (it expects `--testPathPatterns`), so command 2 runs whole host suites.
- A "worker process has failed to exit gracefully" warning appears in the combined rpc-handlers and shared runs. It is not attributed to this batch; the new specs pass in isolation.
- Nx Cloud prints a 401 "organization disabled" notice on every run. It has no effect on the results.

## Revision 1

Responds to `code-logic-review-batch-11.md` (6/10 NEEDS_REVISION): F1 SERIOUS, F2 and F3 MODERATE, and the eviction coverage note. The Batch 13 files (protocol-dispatcher, `mcp-core/surface-tools*`, `ptah-api-builder.service*`, `code-execution/types.ts`, `message-constants.ts`) and the Batch 12 files were not edited.

### F1: a dispatch that never settles held the operation, the ticket and the guard

- Fix location: `SurfaceSubmitTurnService.dispatch` in rpc-handlers, the submit path's only dispatcher. It is now bounded by `SURFACE_SUBMIT_DISPATCH_DEADLINE_MS = 120_000`.
  - Specs inject a different value through the optional, never-registered `SURFACE_SUBMIT_TURN_OPTIONS` token (the same pattern as `SURFACE_STATE_SERVICE_OPTIONS`). A non-positive or non-finite value falls back to the default.
- Why 120 s. The plan and requirements state no timeout: Revision 6 item 3 only makes a UI-side timeout non-final. The constant's comment gives three reasons for the value:
  - The awaited step is acceptance only (message preparation, then a synchronous admission check and enqueue), so a healthy send takes milliseconds.
  - It is above the renderer's 30 s RPC budget, so a UI that has already timed out polls `surface:operation` and sees `pending` first.
  - It is well inside `operationRetentionMs` (10 min), so the `indeterminate` record remains queryable afterwards.
- At the deadline:
  - `dispatch` resolves `{ status: 'indeterminate', detail: SURFACE_SUBMIT_DEADLINE_DETAIL }`. It never invents a failure and never resends.
  - The handler then calls `settleSubmit` exactly once, which releases the ticket and records `indeterminate`. The last-submit is written if the incarnation still matches, otherwise it is `not-recorded`.
- Late results are fenced:
  - The race resolves once and `dispatch` returns once, so a late resolve or reject of the stalled send cannot settle again or send again.
  - `fenceLateOutcome` logs it only, through `safeLog`, so a logger failure cannot throw.
  - The timer is cleared as soon as the send settles first.
- Runtime admission. The per-tab guard is released at the deadline, which is safe only because the Batch 3 `require-idle` admission is the authoritative protection. I checked the source:
  - `session-stream-pump.service.ts:241-247` re-runs `assertAdmissible` (`turnInFlight || messageQueue.length > 0` gives `busy`) synchronously after `createUserMessage` and immediately before `messageQueue.push`.
  - The method returns synchronously after the push.
  - So of two live sends, whichever reaches the push second is refused `SessionAdmissionRefusedError('busy')` and pushes nothing. A stalled first send that later wakes behind an admitted second one is refused, and the reverse also holds.
  - The guard map now holds a per-dispatch token (`Map<tabId, symbol>`), so only the dispatch that set an entry can release it. A spec pins that a late settlement leaves a newer dispatch's guard in place.
  - This reasoning is recorded in the service's doc comment.
- Specs:
  - `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\chat\session\surface-submit-turn.deadline.spec.ts` (NEW, 192 lines, fake timers):
    - default value;
    - still pending at deadline-1 and `indeterminate` at the deadline;
    - the guard is released at the deadline, so the next dispatch sends;
    - a late resolution and a late rejection are logged only, with one send;
    - a late settlement does not release a newer dispatch's guard (the third dispatch is `busy`, 2 sends);
    - the timer is cleared on a normal send;
    - invalid option values fall back to the default.
  - `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\handlers\surface-rpc.handlers.deadline.spec.ts` (NEW, 131 lines, the real RPC stack with fake timers):
    - still `pending` at deadline-1;
    - at the deadline, `indeterminate` with `surfaceState: updated`;
    - `ticketBytes` 0;
    - `surface:operation` reports `indeterminate` with the fixed detail;
    - the replay is identical;
    - the next submit is `applied`, not `busy`;
    - a late resolution and a late rejection (`it.each`): the status is unchanged, the replay is unchanged, no extra revision, no push, one send, and no error text leaks;
    - deletion during the wait gives `indeterminate` with `not-recorded` and `ticketBytes` 0.
  - `surface-rpc.handlers.submit.spec.ts` gains the reviewer's eviction regression:
    - eight newer surfaces evict `profile`;
    - the `deleted/evicted` push is observed;
    - the submit settles `applied` with `not-recorded`;
    - the replay is identical;
    - `ticketBytes` 0 and one send.

### F2: action refusals were not ledgered — chosen fix: record them (the preferred option)

- `SurfaceStateService.refuseAction(routingId, request, refusal)` (NEW) reserves the operation id with the same fingerprint as a submit, `fingerprintSubmit({surfaceId, revision, actionId})`, then settles it as a terminal rejection. No ticket is reserved.
  - An existing record answers first: an identical request replays the recorded outcome, and other content gets `operation-conflict`.
  - So every `surface:action` operation id is now ledgered, and `surface:operation` reports refusals.
- To keep Req 6.8's explicit result, an unsupported action is recorded as `rejected` with the new reason `'unsupported'` (added to `SurfaceRejectReason` in `libs\shared\src\mcp-apps-contracts\surface.types.ts`).
  - It maps back to the wire `unsupported` result on the first answer and on every replay.
  - `surface:operation` reports it as `{ status: 'rejected', reason: 'unsupported', detail }`.
  - No existing consumer switches over `SurfaceRejectReason` exhaustively; I checked with a grep.
- Contract change: `SurfaceUnsupportedResult` now carries `detail` (which names the action) instead of `action`. The ledger keeps only the reason and detail, and a replay must be identical. The renderer already holds the declaration it invoked.
- The handler is simpler: the `operationStatus` pre-check and `undeclaredOrStale` (with its extra `read`) are removed.
  - An absent surface or a declared `surface.submit` goes to `beginSubmit`.
  - Everything else goes to `refuseAction`.
- Specs in `surface-rpc.handlers.spec.ts` (new describe, "review F2"), including both of the reviewer's reproductions:
  - An unsupported id reused for `send` gives `operation-conflict`, with no send and no lastSubmit, and the original replay stays `unsupported`.
  - An identical undeclared request after an unrelated change replays `undeclared` unchanged, and `surface:operation` reports it.
  - A `dashboard.select` refusal replays identically, and reusing its id for another action gives a conflict.
  - The existing per-action case now asserts the recorded status and an identical replay.

### F3: declared dashboard actions ignored the revision

- `resolveAction` now returns the current `revision` on the `undeclared` variant too.
- After the ledger has answered for an existing id, `actionRefusal` compares it with the request first. Any mismatch gives `stale-revision` with `currentRevision`, and that result is ledgered as well.
- Only a current request learns `undeclared`, the `dashboard.select` pointer or `unsupported`. Current-revision dashboard actions stay unsupported and have no side effect.
- Specs (new describe, "review F3"):
  - A stale unsupported action gives `stale-revision` with `currentRevision`; its replay is identical; the current-revision call is `unsupported`; the revision is unchanged.
  - A stale `dashboard.select` gives `stale-revision` with `currentRevision`; the selection is untouched and there is no send.

### Files (Revision 1)

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\chat\session\surface-submit-turn.service.ts` (441 lines): deadline, token guard, `send`, `fenceLateOutcome`, options token.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\handlers\surface-rpc.handlers.ts` (531 lines): ledgered refusals, revision-first `actionRefusal`, `unsupported` mapping, `submitRequest`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-state.service.ts` (700 lines, at the limit): adds `refuseAction`. There is now one private `reserve` helper shared by change, select, submit and refusal. The `resolveAction` body moved out.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-operation-gate.ts` (211 lines): `reserveOn` (answers an absent surface, otherwise reserves).
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\surface\surface-ui-mutations.ts` (581 lines): the pure `resolveStoredAction` and the `SurfaceActionResolution` type (re-exported from the facade, so the barrels are unchanged).
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface.types.ts`: adds the `'unsupported'` reject reason.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\lib\types\rpc\rpc-surface.types.ts`: `SurfaceUnsupportedResult` carries `detail`, with the ledger semantics documented.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\test-utils\surface-rpc-harness.ts`: `dispatchDeadlineMs` option, and exposes `logger`.
- MODIFIED specs: `surface-rpc.handlers.spec.ts` (534 lines) and `surface-rpc.handlers.submit.spec.ts` (312 lines). CREATED `surface-rpc.handlers.deadline.spec.ts` and `surface-submit-turn.deadline.spec.ts`. The existing `surface-submit-turn.service.spec.ts` and the vscode-lm-tools surface specs are unedited and pass.

### Verification (Revision 1, combined tree including the uncommitted Batch 13)

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/vscode-lm-tools` gave exit 0.
  - shared: 77 of 77 suites, 2,097 tests.
  - vscode-lm-tools: 63 of 63 suites, 1,380 tests.
  - rpc-handlers: 109 of 109 suites, 3,230 passed and 4 skipped.
  - Lint: 0 errors in all three projects. Warnings are 5, 44 and 41, the same baselines as before, and none of them is in a file this revision changed.
- `npx nx run <host>:test --testPathPatterns=rpc-surface` passes on each host: ptah-extension-vscode 2 of 2, @ptah-extension/cli-engine 12 of 12, ptah-electron 2 of 2. The two known Electron environment suites are outside this pattern.
- Hygiene:
  - every changed file is at or under 700 lines;
  - no raw U+2028/U+2029;
  - every catch is `catch (error: unknown)`;
  - no raw error text reaches clients: the deadline and failure details are fixed strings, and a spec asserts that "late" does not leak;
  - logging goes through `safeLog` / `nonThrowingSurfaceLog`, so no log call can break a transition.

### Notes for the architect

- `SurfaceRejectReason` gained `'unsupported'`, and `SurfaceUnsupportedResult` changed from `action` to `detail`. Batch 13 and the TASK_2026_494 renderer should use these shapes.
- `surface-state.service.ts` is now at exactly 700 lines. The next addition to the facade should first move another pure plan into a helper.
