# Batch 11 Codex Report

## Outcome

Batch 11 is implemented. C11 adds a persisted tri-state older-history cursor
and a single-write, current-state prepend. C10 extracts history conversion into
`HistoryMessageBuilder` while retaining `MessageFinalizationService` and
`finalizeSessionHistory(tabId, resumableSubagents)` as the public facade.

No Batch 9 file was edited. The pre-existing/uncommitted `libs/shared/**`
changes and `b9-*.md` reports remained untouched.

## Files Created or Modified

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat-types\src\lib\chat-types.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat-state\src\lib\tab-manager.service.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat-state\src\lib\tab-manager.history-window.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat-streaming\src\lib\history-message-builder.service.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat-streaming\src\lib\history-message-builder.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat-streaming\src\lib\message-finalization.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat-streaming\src\index.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat-streaming\CLAUDE.md`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\b11-codex-report.md`

## Task 11.1 Evidence — Tab History Window

- Tri-state cursor: `TabState.olderHistoryCursor?: string | null` at
  `libs/frontend/chat-types/src/lib/chat-types.ts:548`. `undefined` remains the
  not-paged state, `null` means replayable start, and string means more history.
- Cursor writer: `TabManagerService.setOlderHistoryCursor` at
  `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1489`.
- Atomic prepend: `prependHistoryMessages` at
  `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1502` reads the
  current tab at call time, removes ids already present and repeats within the
  older page, then sends `messages` plus `olderHistoryCursor` through exactly
  one `updateTabInternal` call. It does not include `status`, `streamingState`,
  stats, or any other state field.
- Unknown tab: returns before a write. Empty older page: still writes the next
  cursor atomically.
- Resume reset: `applyResumingSession` writes
  `olderHistoryCursor: undefined` at `tab-manager.service.ts:2153`.
- Persistence: no strip was added. The existing spread in
  `projectTabForPersist` and `sanitizeRestoredTab` retains the optional cursor.
- Spec evidence: `tab-manager.history-window.spec.ts:82-159` covers a live
  append surviving the page request, duplicate removal, exactly one internal
  write, untouched status/streaming state, empty page, unknown tab, all cursor
  states, resume reset, and persist/restore round trip.

## V2 Seven-Site Atomicity Audit

No site has an `await` between reading the current `tab.messages` value and its
`setMessages` write. Therefore V2 is not blocking.

1. `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts:256`
   — reads `tab.messages` at line 256 in the same expression; synchronous write.
2. `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts:313`
   — reads `activeTab?.messages` at line 314; synchronous write.
3. `libs/frontend/chat/src/lib/services/message-sender.service.ts:642`
   — reads the resolved tab at lines 629-631 and writes at 642; the next
   `await` is later at line 655.
4. `libs/frontend/chat/src/lib/services/message-sender.service.ts:733`
   — reads the current tab at lines 731-732 and writes at 733; synchronous.
5. `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:393`
   — reads the tab/message array and writes the rebuilt copy synchronously.
6. `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:462`
   — reads the tab/message array and writes the rebuilt copy synchronously.
7. `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:645`
   — reads `tab.messages` at line 628 and writes at 645; synchronous.

These sites remain compatible with C11's current-state atomic prepend seam.

## Task 11.2 Evidence — History Message Builder

- Facade preserved: `finalizeSessionHistory(tabId, resumableSubagents)` remains
  at `message-finalization.service.ts:281`; it still calls `flushSync`, copies
  the tab state, delegates at line 294 with cache key `tab-${tabId}`, calls
  `applyFinalizedHistory`, and returns the built list.
- Extraction: `HistoryMessageBuilder` begins at
  `history-message-builder.service.ts:89`; `createPageState` is at 93,
  `accumulate` at 107, and `build` at 133.
- Scratch accumulation uses the real `StreamingAccumulatorCore` and real
  session/dedup/store context, with no `onAgentStart` hook and no call to
  `BatchedUpdateService.scheduleUpdate`.
- The moved build remains index based: one boundary index pass, one tree index
  pass, and one message-id pass, preserving O(E + M), first-match semantics,
  inbound-peer/image metadata, token/cost/duration metadata, resumable-agent
  interruption, streaming-agent cleanup, and finalized-tree retention caps.
- Page cache lifecycle: `history-page-*` builds clear their cache in `finally`
  at `history-message-builder.service.ts:223`; `clearCache` at line 98 supports
  the caller's outer `finally` when event accumulation throws before build.
- Export: public barrel at `chat-streaming/src/index.ts:29`.
- Documentation: `chat-streaming/CLAUDE.md:53` records ownership, facade, scratch
  semantics, and cache-key lifecycle.
- New spec: `history-message-builder.service.spec.ts:126-223` proves page output
  equals tail output, page cache cleanup, no batched schedule, idempotent agent
  store registration, event-error propagation with no partial result and outer
  cleanup, and build-error cleanup.
- The unedited `message-finalization.session-history.spec.ts` equivalence oracle
  and 2 × E visit-budget spec passed in the full chat-streaming test run, as did
  the unedited finalization, retention, and streaming-handler specs.

## Edge Cases and Risk Handling

- Live append during page request: C11 reads the current message array only at
  commit time; covered by the history-window spec.
- Duplicate ids: ids in current messages and duplicates inside the older page
  are removed while preserving first older-page order.
- Empty page and unknown tab: empty page advances the cursor; missing tab does
  nothing.
- State isolation: prepend never writes status, streaming state, usage, or
  stats. Scratch accumulation never installs state on a tab or schedules UI
  work.
- Throwing event/build: exceptions propagate, no partial message list is
  returned, and the scratch cache key is cleared from the caller/build
  `finally` paths.
- Agent events: the real accumulator/dedup path is used; repeated agent and
  background-agent events leave one logical store entry in the new spec.
- R-ii-1 performance: the extracted loop retains the O(E + M) indexes and the
  unedited 2 × E budget passes. No per-message scan was introduced.
- R-ii-2/R-ii-3 scroll ownership: this batch adds no scroll write and changes no
  transcript component, scroll method, render window, or transcript CSS.
- R-ii-4 perf mock fidelity, R-ii-5 oversized whole turns, R-ii-6 paged stats
  fallback, R-ii-8 stale random ids, and R-ii-9 prepend enter motion are owned
  by later/backend/UI batches; this foundation neither changes nor obscures
  those behaviours.
- R-ii-7 repeated page projection remains the accepted design; scratch state
  and cache are bounded to one page and released after use.
- V5: older-page scratch work does not mark a tab replaying and cannot touch a
  tab's streaming boundary.

## Verification — Literal Output

### 1. Tests

Command:

```text
npx nx run-many -t test -p @ptah-extension/chat-types @ptah-extension/chat-state @ptah-extension/chat-streaming @ptah-extension/chat --parallel=1 --maxWorkers=2
```

Project-count check exposed a pre-existing target mismatch in the batch plan:

```text
NX   The following projects do not have a configuration for any of the provided targets ("test")

- @ptah-extension/chat-types

NX   Running target test for 3 projects:

- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/chat
```

No `project.json` change was authorized (and `nx reset` was forbidden), so the
test-enabled projects were allowed to run. Literal successful results:

```text
Test Suites: 18 passed, 18 total
Tests:       391 passed, 391 total

Test Suites: 24 passed, 24 total
Tests:       1 skipped, 505 passed, 506 total

Test Suites: 78 passed, 78 total
Tests:       2 skipped, 1271 passed, 1273 total

NX   Successfully ran target test for 3 projects
```

The chat run emitted the existing Jest teardown warning:

```text
A worker process has failed to exit gracefully and has been force exited.
```

### 2. Typecheck

```text
NX   Running target typecheck for 5 projects:
- @ptah-extension/chat-types
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/chat
- ptah-extension-webview

NX   Successfully ran target typecheck for 5 projects
```

### 3. Lint

```text
NX   Running target lint for 3 projects:
- @ptah-extension/chat-types
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming

✔ All files pass linting
✖ 2 problems (0 errors, 2 warnings)
✖ 2 problems (0 errors, 2 warnings)

NX   Successfully ran target lint for 3 projects
```

No new lint warning class was introduced. Reported warnings are the existing
`tab-manager.cross-workspace.spec.ts:115` non-null assertion,
`tab-manager.service.ts` max-lines warning, `agent-monitor.store.ts` max-lines
warning, and `streaming-event-cascade-clean.spec.ts:8` unused type.

### 4. Webview Development Build

```text
Initial total              |   8.60 MB
Application bundle generation complete. [21.269 seconds]
NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
```

### 5. Degradation Audit

```text
degradation-audit: scanned 2844 file(s)
  libs/frontend/chat-state: 2 ok (baseline 2)
  libs/frontend/chat-streaming: 2 ok (baseline 2)
  libs/frontend/chat: 11 ok (baseline 11)
  libs/shared/src: 3 ok (baseline 3)

degradation-audit: TOTAL 303 unsuppressed site(s)

NX   Successfully ran target lint for project degradation-audit
```

`chat-types` has no audit finding row (zero sites). TOTAL remains exactly 303.

### 6. Prettier

```text
Checking formatting...
All matched files use Prettier code style!
```

### 7. Diff Safeguards

```text
scroll-method-hunks: PASS (empty)
content-visibility: PASS (empty)
allowed-prefixes: PASS (empty)
todo-stub: PASS (empty)
transcript-css: PASS (no diff)
allowed-prefix-file: PASS (no diff)
```

`git diff --check` produced no output. `git status --short` contains only the
Batch 11 files listed above plus the protected pre-existing Batch 9 files and
Batch 9 review reports. No git write, `nx reset`, transcript CSS edit, scroll
method edit, or `content-visibility` addition was made.

## Revise round 1

### Findings resolved

1. **STYLE SERIOUS — explicit Angular dependencies**
   - `libs/frontend/chat-streaming/src/lib/history-message-builder.service.ts:92-97`
     now declares `StreamingAccumulatorCore`, `SessionManager`,
     `EventDeduplicationService`, `BatchedUpdateService`,
     `BackgroundAgentStore`, and `AgentMonitorStore` as field-level `inject()`
     dependencies. The raw `Injector` import/field and every `Injector.get(...)`
     call were removed.
   - `accumulate` at lines 117-143 constructs `AccumulatorContext` from those
     explicit fields, matching `StreamingHandlerService`.
   - DI-cycle check: repository search shows `HistoryMessageBuilder` is
     referenced only by its own spec and `MessageFinalizationService`; none of
     the six collaborators imports or injects it or the facade. Eager injection
     therefore introduces no reverse edge or cycle. The full test/typecheck
     runs confirm resolution.

2. **LOGIC MODERATE — typed cache-release intent**
   - `HistoryMessageBuildOptions.releaseCacheAfterBuild: boolean` is required at
     `history-message-builder.service.ts:30`.
   - `build` tests the typed option at line 234. The removed
     `cacheKey.startsWith('history-page-')` convention no longer controls
     behaviour.
   - The existing tail facade explicitly passes `false` at
     `message-finalization.service.ts:296`, preserving its long-lived
     `tab-${tabId}` cache behaviour exactly.
   - Scratch-page specs pass `true` at
     `history-message-builder.service.spec.ts:133,207,226` and retain the
     `finally` cleanup assertions.

3. **LOGIC MODERATE — partial-overlap ordering regression spec**
   - `tab-manager.history-window.spec.ts:115-141` now prepends an older page
     whose first, middle, and later positions partially overlap two current
     messages. It asserts exact ordered ids
     `[older-a, older-b, older-c, current-a, current-b]`, exact length 5, and
     the next cursor.

4. **STYLE MINOR — orphaned complexity comment**
   - The stale O(E + M) comment was deleted from
     `message-finalization.service.ts` between the delegated `build` call and
     `applyFinalizedHistory`. Complexity documentation remains beside the real
     indexing code in `HistoryMessageBuilder` and in `chat-streaming/CLAUDE.md`.

5. **STYLE MINOR — cache cleanup documentation**
   - `history-message-builder.service.ts:103-109` now states that `clearCache`
     covers accumulation failures before `build`, while successful builds use
     the typed `releaseCacheAfterBuild` option in their own `finally`.

### Batch 12 lane requirement

`HistoryPagingService` **must wrap `accumulate()` and `build()` in one outer
`try/finally` that calls `HistoryMessageBuilder.clearCache(cacheKey)`**. The
typed `releaseCacheAfterBuild: true` cleanup protects a build that is reached,
but an event can throw during `accumulate()` before `build()` begins. The outer
finally is therefore mandatory even though successful scratch builds also
release idempotently in their own finally.

### Revise files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat-streaming\src\lib\history-message-builder.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat-streaming\src\lib\history-message-builder.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat-streaming\src\lib\message-finalization.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat-state\src\lib\tab-manager.history-window.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\b11-codex-report.md`

No `libs/shared/**` file was touched; the concurrent Batch 9 revise lane remains
isolated.

### Revise verification — literal output

#### 1. Tests

```text
NX   The following projects do not have a configuration for any of the provided targets ("test")

- @ptah-extension/chat-types

NX   Running target test for 3 projects:
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/chat

Test Suites: 18 passed, 18 total
Tests:       392 passed, 392 total

Test Suites: 24 passed, 24 total
Tests:       1 skipped, 505 passed, 506 total

Test Suites: 78 passed, 78 total
Tests:       2 skipped, 1271 passed, 1273 total

NX   Successfully ran target test for 3 projects
```

The requested four-project header remains impossible because
`@ptah-extension/chat-types` has no `test` target. All three test-enabled
projects ran; no project configuration or Nx state was changed.

#### 2. Typecheck

```text
NX   Running target typecheck for 5 projects:
- @ptah-extension/chat-types
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/chat
- ptah-extension-webview

NX   Successfully ran target typecheck for 5 projects
```

#### 3. Lint

```text
NX   Running target lint for 3 projects:
- @ptah-extension/chat-types
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming

✔ All files pass linting
✖ 2 problems (0 errors, 2 warnings)
✖ 2 problems (0 errors, 2 warnings)

NX   Successfully ran target lint for 3 projects
```

Warnings are unchanged: one pre-existing non-null assertion, two pre-existing
max-lines warnings, and one pre-existing unused type. No new warning or error.

#### 4. Webview development build

```text
Initial total              |   8.60 MB
Application bundle generation complete. [18.834 seconds]
NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
```

#### 5. Degradation audit

```text
degradation-audit: scanned 2844 file(s)
  libs/frontend/chat: 11 ok (baseline 11)
  libs/frontend/chat-state: 2 ok (baseline 2)
  libs/frontend/chat-streaming: 2 ok (baseline 2)
  libs/shared/src: 3 ok (baseline 3)

degradation-audit: TOTAL 303 unsuppressed site(s)

NX   Successfully ran target lint for project degradation-audit
```

#### 6. Prettier

```text
Checking formatting...
All matched files use Prettier code style!
```

#### 7. Scroll and diff safeguards

```text
scroll-method-hunks: PASS (empty)
content-visibility: PASS (empty)
allowed-prefixes: PASS (empty)
todo-stub: PASS (empty)
transcript-css: PASS (no diff)
allowed-prefix-file: PASS (no diff)
```

`git diff --check` produced no output. No git write or `nx reset` was run.
