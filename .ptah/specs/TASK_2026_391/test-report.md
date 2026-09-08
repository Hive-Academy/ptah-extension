# Test Report - TASK_2026_391

## Scope

- User request: Independently verify the effective Batch 4 worktree, run the focused regression and all three exact Nx gates, and judge whether the regression proves restored assistant history on the targeted tab.
- Criteria tested: a targeted compaction reload clears queued writes for its exact `TabId` before resume; replay is invoked for that tab; the focused regression passes; tests, typecheck, and lint each run for all three named projects. These criteria were extracted from the Batch 4 verification request and `batches.md` because this task folder has no `context.md`, `task-description.md`, or `implementation-plan.md`.
- Regressions covered: stale live `/compact` state replacing replayed state during targeted reload, nominally covered by `drops stale live-stream updates before replay so restored assistant history remains visible on the target tab` in `D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`.
- Review findings covered: `code-logic-review.md` approves the scoped fix and identifies the same deferred-over-pending overwrite as fixed. Its two adjacent pre-existing findings—null-session fallback ownership rejection and lack of transcript rollback when reload RPC fails—are not part of Batch 4 and were not added to this focused suite.
- Deliberately not tested: the secondary CTX gauge defect, because Batch 4 reports it as a distinct unresolved issue; browser DOM rendering in the Electron shell, because the requested verification is service-level and unit-suite based.

## Current-state assessment

- The effective worktree clears pending/deferred streaming writes only when `targetTabId` is present, at `session-loader.service.ts:588-590`, and does so immediately before `applyResumingSession` at lines 591-596. This preserves the ordinary untargeted reopen path while cleaning the in-place compaction target.
- The subsequent replay loop supplies `resolvedTabId` to every `processStreamEvent` call and uses `{ isReplay: true, fanOut: false }` at `session-loader.service.ts:690-697`; finalization receives the same tab at lines 699-702.
- `MessageFinalizationService.finalizeSessionHistory` performs an unscoped `flushSync()` before reading the target tab (`message-finalization.service.ts:206-216`). `BatchedUpdateService.flushSync` promotes deferred entries back into pending entries (`batched-update.service.ts:181-196`), while `clearPendingUpdates` deletes the target from all three queues (`batched-update.service.ts:205-209`). The production ordering therefore supports the reported race and the target-scoped cleanup.
- The revised focused test now composes the production services that own the race: real `TabManagerService`, `BatchedUpdateService`, `StreamingHandlerService`, `StreamingAccumulatorCore`, `EventDeduplicationService`, `MessageFinalizationService`, and `SessionLoaderService` (`session-loader.service.spec.ts:1282-1316`). Only unrelated edges and the execution-tree projection are replaced with narrow doubles.
- It creates an actual hidden-tab deferred entry by feeding the two observed stale user bubbles through the real `StreamingHandlerService` and confirms `batchedUpdate.hasPendingUpdates(targetTabId)` before reload (`session-loader.service.spec.ts:1332-1358`). It then makes the document visible without draining that entry and invokes the real targeted `switchSession` path (`session-loader.service.spec.ts:1360-1371`).
- The test genuinely reaches the production replay/finalization seam. Real replay events are processed, the real finalizer flushes the batched queue, and the assertion reads `target.messages` from the real tab manager. It requires user + assistant messages containing restored assistant text and excludes both stale compaction stubs (`session-loader.service.spec.ts:1373-1383`).
- The test would fail without the conditional target queue clear. Replay first places the newer state in the pending queue; finalization's unscoped `flushSync()` then promotes the older deferred state into the same tab key, overwriting the pending replay state at `batched-update.service.ts:186-196`. With no clear at `session-loader.service.ts:588-590`, the real finalizer reads the stale user-only state, so the required restored assistant message is absent. The revised test therefore pins the race rather than merely asserting that a mock method was called.
- Verdict on regression strength: sufficient service-level regression evidence for the queue/replay/finalization/tab-state defect. It does not render an Angular component, but `target.messages` is the state consumed by the transcript UI and is the appropriate cheapest seam for this bug.

## Suites

### SessionLoaderService focused regression — composed service unit/integration

- Requirement: targeted reload clears stale queued state before replay and retains restored assistant history on the intended tab.
- Cases: explicit branded target tab; two stale live compaction bubbles held in the real deferred queue; replayed user and assistant events through the real streaming pipeline; finalized target messages contain restored assistant content and exclude both stale bubbles.
- Files: `D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
- Independent result: 1 passed, 35 skipped.
- Evidence strength: the state-producing collaborators are real; the test asserts the final real `TabManagerService` message state. The custom tree builder is a deterministic projection double and does not control queue ordering or tab writes.

### Three-project Nx test gate — unit

- Requirement: all affected project suites remain green.
- Cases: every configured Jest suite for chat, chat-state, and chat-streaming.
- Files: project-owned test suites under `D:/projects/ptah-extension/libs/frontend/chat`, `chat-state`, and `chat-streaming`.
- Result: 1,788 passed, 3 skipped, 0 failed across 102 suites. Nx used cached output for all three projects.

### Three-project Angular typecheck gate — static

- Requirement: all affected projects compile under their project TypeScript/Angular configurations.
- Result: all 3 projects passed, 0 failed.

### Three-project lint gate — static

- Requirement: all affected projects lint successfully.
- Result: all 3 projects passed with 0 errors. Existing output reports 22 warnings total (chat-state 3, chat-streaming 2, chat 17).

## Execution

ANSI colour-control bytes are omitted below. The focused output is from the latest re-verification. The broad gate blocks retain the prior full capture (same effective implementation and same counts); each gate also records the latest re-run header and outcome below its block.

### Focused regression

- Command run: `npx nx test @ptah-extension/chat --testPathPatterns=session-loader.service.spec.ts --testNamePattern="discards a deferred live compaction state before replaying assistant history into that exact tab" --runInBand`
- Result: 1 passed, 0 failed, 35 skipped.

```text
> nx run @ptah-extension/chat:test --testPathPatterns=session-loader.service.spec.ts --testNamePattern=discards a deferred live compaction state before replaying assistant history into that exact tab --runInBand

  console.warn
    [compaction-diag] switchSession reload target {
      requestedSessionId: 'e411387c-8e9c-4724-ab17-58bd4515c62c',
      resolvedTabId: 'f8bf90af-094d-4d2e-9615-2e37d7be522c',
      existingTabId: 'f8bf90af-094d-4d2e-9615-2e37d7be522c',
      openTabsForSession: [ 'f8bf90af-094d-4d2e-9615-2e37d7be522c' ]
    }

      572 |       // ownership-drifted tile can be correlated with the lifecycle fan-out.
      573 |       if (opts?.reason === 'compaction') {
    > 574 |         console.warn('[compaction-diag] switchSession reload target', {
          |                 ^
      575 |           requestedSessionId: sessionId,
      576 |           resolvedTabId,
      577 |           existingTabId: existingTab?.id ?? null,

      at SessionLoaderService.<anonymous> (src/lib/services/chat-store/session-loader.service.ts:574:17)
      at fulfilled (../../../node_modules/tslib/tslib.js:167:62)
      at _ZoneDelegate.invoke (../../../node_modules/zone.js/bundles/zone.umd.js:409:168)
      at _ProxyZoneSpec.onInvoke (../../../node_modules/zone.js/bundles/zone-testing.umd.js:1079:43)
      at _ZoneDelegate.invoke (../../../node_modules/zone.js/bundles/zone.umd.js:409:56)
      at _ZoneImpl.run (../../../node_modules/zone.js/bundles/zone.umd.js:162:47)
      at ../../../node_modules/zone.js/bundles/zone.umd.js:2174:42
      at _ZoneDelegate.invokeTask (../../../node_modules/zone.js/bundles/zone.umd.js:438:181)
      at _ProxyZoneSpec.onInvokeTask (../../../node_modules/zone.js/bundles/zone-testing.umd.js:1110:43)
      at _ZoneDelegate.invokeTask (../../../node_modules/zone.js/bundles/zone.umd.js:438:64)
      at _ZoneImpl.runTask (../../../node_modules/zone.js/bundles/zone.umd.js:204:51)
      at drainMicroTaskQueue (../../../node_modules/zone.js/bundles/zone.umd.js:615:39)

NX   Successfully ran target test for project @ptah-extension/chat

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.

(node:44868) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
Test Suites: 1 passed, 1 total
Tests:       35 skipped, 1 passed, 36 total
Snapshots:   0 total
Time:        1.882 s, estimated 6 s
Ran all test suites matching session-loader.service.spec.ts with tests matching "discards a deferred live compaction state before replaying assistant history into that exact tab".
```

### Test gate

- Command run: `npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-streaming`
- Header confirmation: `Running target test for 3 projects`.
- Result: 1,788 passed, 0 failed, 3 skipped.

```text
NX   Running target test for 3 projects:

- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming

> nx run @ptah-extension/chat-state:test  [existing outputs match the cache, left as is]

A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.

Test Suites: 15 passed, 15 total
Tests:       338 passed, 338 total
Snapshots:   0 total
Time:        23.977 s
Ran all test suites.

> nx run @ptah-extension/chat-streaming:test  [existing outputs match the cache, left as is]

(node:25524) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32444) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:33352) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:18896) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:13508) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:26348) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:51884) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:40964) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:44128) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:26272) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:6904) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:19120) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:42344) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:49640) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32288) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:43804) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.

Test Suites: 22 passed, 22 total
Tests:       1 skipped, 450 passed, 451 total
Snapshots:   0 total
Time:        34.007 s
Ran all test suites.

> nx run @ptah-extension/chat:test  [local cache]

(node:2400) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:40112) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:36300) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:1260) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:39968) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:18636) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:28896) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:17188) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:45096) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:41428) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:15136) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:9916) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:4580) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:34056) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:40784) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:38744) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.

Test Suites: 65 passed, 65 total
Tests:       2 skipped, 1000 passed, 1002 total
Snapshots:   0 total
Time:        28.532 s, estimated 34 s
Ran all test suites.

NX   Successfully ran target test for 3 projects

Nx read the output from the cache instead of running the command for 3 out of 3 tasks.

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

Latest re-run confirmation (verbatim terminal summary):

```text
NX   Running target test for 3 projects:

- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming

Test Suites: 15 passed, 15 total
Tests:       338 passed, 338 total

Test Suites: 22 passed, 22 total
Tests:       1 skipped, 450 passed, 451 total

Test Suites: 65 passed, 65 total
Tests:       2 skipped, 1000 passed, 1002 total

NX   Successfully ran target test for 3 projects

Nx read the output from the cache instead of running the command for 3 out of 3 tasks.
```

### Typecheck gate

- Command run: `npx nx run-many -t typecheck -p @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-streaming`
- Header confirmation: `Running target typecheck for 3 projects`.
- Result: all 3 passed.

```text
NX   Running target typecheck for 3 projects:

- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming

> nx run @ptah-extension/chat-state:typecheck

> npx ngc --noEmit --project libs/frontend/chat-state/tsconfig.lib.json

(node:39844) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:2556) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

> nx run @ptah-extension/chat-streaming:typecheck

> npx ngc --noEmit --project libs/frontend/chat-streaming/tsconfig.lib.json

(node:28608) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:31808) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

> nx run @ptah-extension/chat:typecheck

> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json

(node:38068) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12756) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

NX   Successfully ran target typecheck for 3 projects

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

Latest re-run confirmation (verbatim terminal summary):

```text
NX   Running target typecheck for 3 projects:

- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming

NX   Successfully ran target typecheck for 3 projects
```

### Lint gate

- Command run: `npx nx run-many -t lint -p @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-streaming`
- Header confirmation: `Running target lint for 3 projects`.
- Result: all 3 passed; 0 errors and 22 warnings.

```text
NX   Running target lint for 3 projects:

- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming

> nx run @ptah-extension/chat-state:lint  [existing outputs match the cache, left as is]

Linting "@ptah-extension/chat-state"...
D:\projects\ptah-extension\libs\frontend\chat-state\src\lib\tab-manager.cross-workspace.spec.ts
  115:29  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
D:\projects\ptah-extension\libs\frontend\chat-state\src\lib\tab-manager.service.ts
    40:10  warning  'ClaudeSessionId' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  1513:1   warning  File has too many lines (1190). Maximum allowed is 700                             max-lines
✖ 3 problems (0 errors, 3 warnings)

> nx run @ptah-extension/chat-streaming:lint  [existing outputs match the cache, left as is]

(node:33348) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

Linting "@ptah-extension/chat-streaming"...
D:\projects\ptah-extension\libs\frontend\chat-streaming\src\lib\agent-monitor.store.ts
  1155:1  warning  File has too many lines (1057). Maximum allowed is 700  max-lines
D:\projects\ptah-extension\libs\frontend\chat-streaming\src\lib\streaming-event-cascade-clean.spec.ts
  8:11  warning  'SeedTextDelta' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
✖ 2 problems (0 errors, 2 warnings)

> nx run @ptah-extension/chat:lint  [existing outputs match the cache, left as is]

(node:11864) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

Linting "@ptah-extension/chat"...
D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input\chat-input.component.ts
  885:1  warning  File has too many lines (978). Maximum allowed is 700  max-lines
D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.spec.ts
  253:7  warning  Unused eslint-disable directive (no problems were reported from '@typescript-eslint/dot-notation')
D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.ts
  807:1   warning  File has too many lines (932). Maximum allowed is 700  max-lines
  936:37  warning  Forbidden non-null assertion                           @typescript-eslint/no-non-null-assertion
D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts
   70:35  warning  'SessionId' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  369:22  warning  Unexpected empty arrow function                                              @typescript-eslint/no-empty-function
D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.spec.ts
  1045:5  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
  1062:1  warning  File has too many lines (906). Maximum allowed is 700  max-lines
D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.keepalive.spec.ts
  200:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  212:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  213:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  221:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts
  926:43  warning  Unexpected empty async method 'createNewSession'  @typescript-eslint/no-empty-function
D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\agent-orchestration-config.component.ts
  739:1  warning  File has too many lines (988). Maximum allowed is 700  max-lines
D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\ptah-cli-config.component.ts
   787:49  warning  Unexpected empty arrow function                         @typescript-eslint/no-empty-function
   789:1   warning  File has too many lines (1034). Maximum allowed is 700  max-lines
  1014:49  warning  Unexpected empty arrow function                         @typescript-eslint/no-empty-function
✖ 17 problems (0 errors, 17 warnings)

  0 errors and 1 warning are potentially fixable with the `--fix` option.

NX   Successfully ran target lint for 3 projects

Nx read the output from the cache instead of running the command for 3 out of 3 tasks.

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

Latest re-run confirmation (verbatim terminal summary):

```text
NX   Running target lint for 3 projects:

- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming

NX   Successfully ran target lint for 3 projects

Nx read the output from the cache instead of running the command for 3 out of 3 tasks.
```

## Verdict

- Criteria proven: the effective worktree calls target-scoped queue cleanup before resume initialization; a real deferred stale state exists before reload; real replay/finalization produces restored assistant messages on the exact target tab; the focused regression would fail if target cleanup were absent; all exact Nx gates identify and pass all 3 requested projects.
- Criteria not proven: browser-level DOM rendering in the Electron shell and the independent secondary CTX gauge defect.
- Risks a reader should know about: all three broad test outputs came from Nx cache; Jest reports existing forced-worker-exit warnings; lint is green with 22 warnings; the unresolved CTX gauge defect remains outside this fix. The logic review also records pre-existing null-session fan-out ownership and reload-failure rollback gaps, neither introduced by this target-only cleanup.
- Overall verdict: **pass**. The revised composed regression exercises the production queue, replay, finalization, and tab-state path at the relevant seam, independently passes, and all three required project gates are green.
