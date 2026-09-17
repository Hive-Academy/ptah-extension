# TASK_2026_391 Batch 4 — frontend developer report

## Outcome

Fixed and reproduced the remaining Electron in-place compaction reload race.
The Batch 1 tab target was correct. The target still retained an older
pending/deferred `BatchedUpdateService` write from the live `/compact` stream.
`finalizeSessionHistory()` flushed that queue after replay, allowing the stale
two-user-message state to replace the newer replay state immediately before
the finalizer read it.

The minimal production fix clears queued writes for the exact resolved target
tab before `applyResumingSession`. Untargeted close/reopen behavior is
unchanged. Batch 1 targeting, pair-keyed in-flight identity, `fanOut: false`,
and all `[compaction-diag]` logging remain intact.

## Root cause and line evidence

- Live event mutations go through the real batching queue in
  `libs/frontend/chat-streaming/src/lib/batched-update.service.ts:84-93`.
  Hidden/non-visible target writes are retained in `deferredTabUpdates`.
- `applyCompactionComplete` clears the tab's visible transcript/state at
  `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1730`, but it does
  not own or clear the streaming library's queue.
- The targeted reload installs a fresh empty replay state through
  `applyResumingSession` at
  `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:591`.
  Replay still writes to the explicit primary tab through
  `StreamingHandlerService.processEventForTab` at
  `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:184`;
  `fanOut: false` only suppresses siblings at line 191.
- `MessageFinalizationService.finalizeSessionHistory` calls the unscoped
  `flushSync()` before reading the tab at
  `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:210`.
  `flushSync` moves deferred entries into `pendingTabUpdates` at
  `batched-update.service.ts:186-196`. For the same tab ID, the old deferred
  live state overwrites the newer replay pending state. The finalizer therefore
  sees only the two compaction user stubs and has no assistant tree to promote.
- Close/reopen renders because `StreamRouter` already invokes
  `clearPendingUpdates(evt.tabId)` at
  `libs/frontend/chat-routing/src/lib/stream-router.service.ts:955` before the
  later untargeted load. An in-place reload does not pass through close
  teardown.
- The fix exposes the same target-scoped deletion through
  `StreamingHandlerService.clearPendingUpdates` at
  `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:76-77`
  and calls it only when `targetTabId` exists at
  `session-loader.service.ts:588-590`, immediately before resume
  initialization.

## Required path audit

- The targeted path does call `applyResumingSession`; it was not skipped.
- The explicit target is processed as `primaryTab` even with `fanOut: false`.
- The `session:compactionComplete` push only stamps completion/marker state;
  it does not invoke a second reload. The in-stream `compaction_complete`
  result is the reload trigger.
- Stream-exit `markTabIdle` clears spinner/abort state, not transcript
  messages. It does not overwrite the replay. The overwrite occurs earlier in
  the frontend batching flush.
- The untargeted path works because closing the tile clears its queued writes;
  the targeted in-place path previously omitted that teardown step.

## Genuine composed regression: RED then GREEN

The regression is at
`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts:1221`.
It uses the real `SessionLoaderService`, `TabManagerService`,
`BatchedUpdateService`, `StreamingHandlerService`,
`StreamingAccumulatorCore`, `EventDeduplicationService`,
`MessageFinalizationService`, and `SessionManager`. Only peripheral RPC/UI
dependencies and the execution-tree builder are deterministic doubles.

The test processes the exact two stub user messages through the real streaming
handler while the document is hidden, proving an actual deferred target entry
exists with `hasPendingUpdates(targetTabId)`. It then makes the document visible
without firing the queue's drain event, executes the actual
`switchSession(sessionId, { reason: 'compaction', targetTabId })`, replays valid
user and assistant events, and asserts the real target `TabState.messages`
contains the restored assistant text and neither stub.

The earlier local-boolean/local-map test rejected by independent review was
deleted. It was a Batch 4 test, not a Batch 1 test. No Batch 1 test or assertion
was weakened or removed.

### RED — production cleanup removed only

Command:

```text
npx nx test @ptah-extension/chat --runInBand --testPathPatterns=session-loader.service.spec.ts
```

Verbatim failure:

```text
FAIL chat libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts
  ● SessionLoaderService targeted replay with the real streaming state pipeline › discards a deferred live compaction state before replaying assistant history into that exact tab

    expect(received).toEqual(expected) // deep equality

    - Expected  - 1
    + Received  + 1

      Array [
        "user",
    -   "assistant",
    +   "user",
      ]

      1376 |
      1377 |     const target = tabManager.tabs().find((tab) => tab.id === targetTabId);
    > 1378 |     expect(target?.messages.map((message) => message.role)).toEqual([
           |                                                             ^
      1379 |       'user',
      1380 |       'assistant',
      1381 |     ]);

Test Suites: 1 failed, 1 total
Tests:       1 failed, 2 skipped, 33 passed, 36 total
Snapshots:   0 total
Time:        4.149 s
Ran all test suites matching session-loader.service.spec.ts.
```

This is the real failure mode: after actual replay and actual finalization, the
target contains two users (the two stale stubs) and no assistant.

### GREEN — target cleanup restored

Command:

```text
npx nx test @ptah-extension/chat --runInBand --testPathPatterns=session-loader.service.spec.ts --skipNxCache
```

Verbatim result:

```text
NX   Successfully ran target test for project @ptah-extension/chat

Test Suites: 1 passed, 1 total
Tests:       2 skipped, 34 passed, 36 total
Snapshots:   0 total
Time:        4.033 s
Ran all test suites matching session-loader.service.spec.ts.
```

## Production/test files

- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
  — target-only queue cleanup immediately before resume reset.
- `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts`
  — facade for the existing target-scoped batching cleanup.
- `libs/frontend/chat-streaming/src/lib/streaming-handler.service.spec.ts`
  — facade delegation coverage (absorbed into shared HEAD externally).
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
  — genuine composed queue/replay/finalization regression; removed the
  constructed local-map test.
- `.ptah/specs/TASK_2026_391/agent-output-frontend-developer.md` — this report.

`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` was not touched.

## Secondary CTX status

Not changed because it is not the same root cause. The batching queue contains
only `StreamingState`; it cannot change lifetime `preloadedStats.tokens` or the
context gauge source. `TOKENS 896.3k` is lifetime/cumulative data, while CTX
must use a post-compaction context snapshot. Fixing that needs a separate
ordering regression spanning session stats, compaction marker state, and resume
stats. Blanket zeroing of lifetime tokens was not reintroduced.

## Adjacent findings deliberately not fixed

Independent logic review found two separate pre-existing issues:

1. A conversation-bound fan-out tab with `claudeSessionId === null` can be
   selected by lifecycle fallback and then rejected by the loader's strict
   ownership check (`compaction-lifecycle.service.ts:388-415` versus
   `session-loader.service.ts:740-747`).
2. If `session:load` or `chat:resume` fails after the lifecycle clears the tab,
   the catch logs the failure but does not roll back the transcript or expose
   an in-UI retry (`compaction-lifecycle.service.ts:381-421`).

Per revision scope, neither issue was changed in this batch.

## Required verification gates

All commands ran against the final working tree, returned exit code 0, and each
Nx header explicitly said `for 3 projects`. ANSI color bytes and repeated
per-worker `NO_COLOR` warnings are omitted below; the command/result text is
otherwise verbatim.

### Tests

```text
NX   Running target test for 3 projects:

- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming

> nx run @ptah-extension/chat-state:test  [existing outputs match the cache, left as is]

Test Suites: 15 passed, 15 total
Tests:       338 passed, 338 total
Snapshots:   0 total
Time:        30.606 s
Ran all test suites.

> nx run @ptah-extension/chat-streaming:test  [existing outputs match the cache, left as is]

Test Suites: 22 passed, 22 total
Tests:       1 skipped, 450 passed, 451 total
Snapshots:   0 total
Time:        36.953 s
Ran all test suites.

> nx run @ptah-extension/chat:test

Test Suites: 65 passed, 65 total
Tests:       2 skipped, 1000 passed, 1002 total
Snapshots:   0 total
Time:        22.54 s
Ran all test suites.

NX   Successfully ran target test for 3 projects

Nx read the output from the cache instead of running the command for 2 out of 3 tasks.
```

### Typecheck

```text
NX   Running target typecheck for 3 projects:

- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming

> nx run @ptah-extension/chat-state:typecheck
> npx ngc --noEmit --project libs/frontend/chat-state/tsconfig.lib.json

> nx run @ptah-extension/chat-streaming:typecheck
> npx ngc --noEmit --project libs/frontend/chat-streaming/tsconfig.lib.json

> nx run @ptah-extension/chat:typecheck
> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json

NX   Successfully ran target typecheck for 3 projects
```

### Lint

```text
NX   Running target lint for 3 projects:

- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming

> nx run @ptah-extension/chat-state:lint  [existing outputs match the cache, left as is]
✖ 3 problems (0 errors, 3 warnings)

> nx run @ptah-extension/chat-streaming:lint  [existing outputs match the cache, left as is]
✖ 2 problems (0 errors, 2 warnings)

> nx run @ptah-extension/chat:lint
✖ 17 problems (0 errors, 17 warnings)

NX   Successfully ran target lint for 3 projects

Nx read the output from the cache instead of running the command for 2 out of 3 tasks.
```

The warnings are existing repository warnings; the new regression has no lint
warning. The test gate repeated the suite's existing forced-worker-exit warning.

## Worktree / commit status

I did not commit, stage, push, reset, or rewrite history. During the earlier
shared-worktree run, another process advanced HEAD through `e405a2e42`, which
absorbed the initial production facade/fix, and then through unrelated commit
`0a7f59fef` and `bf16def22`. I followed the orchestrator instruction to preserve
that history. The final revision remains in the aggregate working tree. The
index is empty; no task file is staged by this agent.
