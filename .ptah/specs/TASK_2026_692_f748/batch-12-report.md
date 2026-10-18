# Batch 12 report

## Delivered

- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\rpc-handlers\src\lib\chat\session\chat-slash-command-router.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\rpc-handlers\src\lib\chat\session\chat-slash-command-router.idle-coalesce.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\rpc-handlers\src\lib\register-shared-rpc-handlers.activation.spec.ts`

## Evidence

- Optional last constructor parameter typed as the public `ManualCompactAdmission`: `chat-slash-command-router.service.ts:22,62-63`.
- Fast `requestManualCompact` check before awaited preparation; `coalesced` and `deduped` return success without sending: `chat-slash-command-router.service.ts:125-144`.
- Authoritative `admitManualCompact` after provider resolution and immediately before `executeSlashCommand`, with no intervening await: `chat-slash-command-router.service.ts:168-189`. A throwing coordinator is logged and the command continues: `:140-144,184-189`.
- Every acquired reservation is released in `finally`, covering command resolution, rejection, and pre-call argument failure: `chat-slash-command-router.service.ts:243-258`.
- Spec uses the real coordinator registered through `registerSdkServices`: `chat-slash-command-router.idle-coalesce.spec.ts:94-111`. Its 10 cases cover send, held claim, claim acquired during provider resolution, dedupe, absent or throwing coordinator, both failure paths, overlapping sends, and PreCompact → PostCompact → late compacting status → manual send: `:116-240`. Both overlapping sends settle with the reservation cleared (`:210-228`), so no L4 finding from this case.

## Activation regression root cause and fix

- The failure was introduced by this branch. Main's activation spec passes 3/3. The branch's `SDK_IDLE_COMPACTION` factory (`agent-sdk/src/lib/di/register.ts:499-545`) is reached when activation resolves `PlanLimitsBroadcaster` through its snapshot/discovery dependency graph. The new service subscribes through `workspace.onDidChangeConfiguration` in its constructor (`agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts:116-128`).
- The activation spec's host `WORKSPACE_PROVIDER` mock lacked that standard port. DI threw `workspace.onDidChangeConfiguration is not a function` while constructing `CompactionHookHandler`; `activateSessionLifecycleNotifier` caught the broadcaster failure, leaving `PlanLimitLedgerService.onChange` uncalled. This is a newly invalid test fixture assumption, not a production behavior defect.
- Added the configuration listener mock with a disposable at `register-shared-rpc-handlers.activation.spec.ts:154`. Moved the existing `logger.error` assertion ahead of the subscription assertion at `:231`, so future DI failures report the original error. The activation spec now passes 3/3 and the full project gate passes.

## Checks

- `npx nx test @ptah-extension/rpc-handlers --parallel=1 -- --maxWorkers=2`: **passed**, 163 suites; 4,599 tests passed, 7 skipped.
- Targeted activation spec: **passed**, 3 tests.
- Targeted new spec: **passed**, 10 tests.
- `npx nx typecheck @ptah-extension/rpc-handlers --parallel=1`: **passed** after final source edits.
- `ptah_get_diagnostics` on changed source: **0 errors, 0 warnings**.
- `npx eslint` on all changed source/spec files: **passed, 0 errors**; two pre-existing unused `SetupRpcHandlers` warnings in host smoke specs.
- `npx prettier --check` on all changed source/spec files: **passed**.

## Decisions

- The real coordinator is resolved through the agent-sdk's production DI registration in the spec. Direct relative imports across Nx project boundaries fail `@nx/enforce-module-boundaries`; production DI provides the same instance and keeps the test inside the assigned files. Reversible within the spec.
- The activation test fixture was expanded to match the platform workspace port now used by the idle service. This is reversible within the spec and keeps production subscription behavior covered.
