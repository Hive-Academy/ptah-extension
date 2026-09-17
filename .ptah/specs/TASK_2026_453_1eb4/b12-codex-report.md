# Batch 12 Codex report — `TASK_2026_453_1eb4`

## Frontend implementation — `TASK_2026_453_1eb4`, batch 12

**Tasks completed**: 12.1 paging orchestration; 12.2 anchor hint and view handler; 12.3 rule 7 documentation; 12.4 B3/B4 ordering regressions.

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\history-paging.service.ts` — tail request, cursor state, in-flight deduplication and older-page RPC orchestration.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\history-paging.service.spec.ts` — paging outcomes, loading signal and shared-promise coverage.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.older-page.spec.ts` — claim/binding/cursor/admission/cache/replay-signal coverage.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.service.ts` — added admission-safe scratch replay and atomic prepend.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts` — requests the tail page and records its cursor.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.spec.ts` — tail request/cursor assertions and B3/B4 ordering specs.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-loader.cli-restore.spec.ts` — injection-only `HistoryPagingService` test double required by the loader's new collaborator; all existing assertions are unchanged.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\index.ts` — exports the paging service and outcome type.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts` — occurrence-from-end hint and older-history outcome UX.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\templates\chat-view.component.spec.ts` — anchor, stale and retryable failure coverage.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\CLAUDE.md` — one rule 7 Tail paging bullet.

## Stack observed

- Angular 21 standalone/OnPush UI (`package.json`; `chat-view.component.ts:98-122`) with signals and `inject()` (`chat-view.component.ts:123-166`).
- Chat orchestration remains in the `chat-store/` child-service slice (`libs/frontend/chat/CLAUDE.md:26-28,42-46,66-69`).
- Existing `ClaudeRpcService` typed RPC boundary, `TabManagerService` per-tab state, `SessionHistoryReplayer` admission, and `HistoryMessageBuilder` scratch-state builder are reused; no new framework, state library, sanitizer, primitive or token was added.
- Styling/template structure is unchanged in this batch.

## Line counts

- `HistoryPagingService`: 106 lines (new).
- `SessionHistoryReplayer`: 474 -> 552 lines, delta +78; remains below the 700-line ceiling.
- `SessionLoaderService`: 1,350 -> 1,354 lines, delta +4; within Task 12.1's approximately-five-line budget.

## Task 12.1 acceptance checklist

- [x] `tailRequest()` returns `{ maxEvents: HISTORY_TAIL_PAGE_EVENTS }` (`history-paging.service.ts:32-34`; spec `:67-81`).
- [x] The main `chat:resume` request includes `historyPage: this.historyPaging.tailRequest()` (`session-loader.service.ts:710`); the refresh-only resume path remains untouched.
- [x] `recordTail` runs after the current-claim check and beside stats application (`session-loader.service.ts:731-769`); it records `result.historyPage?.olderCursor ?? null` (`history-paging.service.ts:36-41`). Loader assertion: `session-loader.service.spec.ts:1636-1644`.
- [x] One in-flight request is shared per tab and exposed through a readonly signal (`history-paging.service.ts:25-30,43-63`; spec `:83-115`).
- [x] `undefined`/`null` cursor returns `none`, stale sets the cursor to `null`, ordinary RPC/build failure retains the cursor (`history-paging.service.ts:47-50,77-97`; specs `:117-169`). RPC failures are inspected through `RpcResult`; the catch logs and returns the predeclared outcome after the catch, not a literal-return catch.
- [x] Older-page replay refuses a held claim, rebind and cursor drift before/after admission and after yields (`session-history-replayer.service.ts:251-278,402-414`; specs `session-history-replayer.older-page.spec.ts:151-217`).
- [x] Older replay never calls `markReplayStarted` and therefore never mutates `replayingTabIds`; the synchronous spec samples an empty set before and after (`session-history-replayer.older-page.spec.ts:127-149`).
- [x] Admission is acquired at `session-history-replayer.service.ts:257` and released in the method's `finally` at `:287-290`. The accumulation-throw spec immediately completes a second page replay after the rejection (`session-history-replayer.older-page.spec.ts:219-250`).
- [x] `accumulate()` and `build()` are under one outer `try/finally`, which always calls `clearCache(cacheKey)` (`session-history-replayer.service.ts:258-290`). The accumulation-before-build throw is pinned at `session-history-replayer.older-page.spec.ts:219-250`.
- [x] No `tab.messages` snapshot is read across an await; commit is a direct `prependHistoryMessages(tabId, messages, nextCursor)` at `session-history-replayer.service.ts:286`, whose tab-state service reads current messages at commit time.
- [x] Replayer is 552 lines (<700); loader delta is +4.

## Task 12.2 acceptance checklist

- [x] `buildAnchorHint` counts identical later loaded prompts and returns `occurrenceFromEnd` (`chat-view.component.ts:957-981`; spec `chat-view.component.spec.ts:431-451`).
- [x] `onOlderHistoryRequested(tabId)` delegates to `loadOlder` (`chat-view.component.ts:176-177`).
- [x] Stale text explicitly tells the user to reopen the session and does not call `switchSession` (`chat-view.component.ts:178-184`; spec `chat-view.component.spec.ts:453-468`).
- [x] Failed load reports a retryable “Please try again” error (`chat-view.component.ts:185-190`; spec `chat-view.component.spec.ts:470-484`).
- [x] No component HTML was changed.

## Task 12.3 acceptance checklist

- [x] Exactly one Tail paging bullet was added to rule 7 (`libs/frontend/chat/CLAUDE.md:78`). It records the tail constant, no older-page `streamingState` writes, claim refusal, atomic id-deduplicated prepend, reopen-on-stale UX, and synchronous <=250-event Replay-boundary/retention behavior.
- [x] The existing Replay boundary bullet remains unchanged at `libs/frontend/chat/CLAUDE.md:77`.

## Task 12.4 acceptance checklist

- [x] B3 spec title: **“B3 — compaction reload supersedes an in-flight replay without stale writes and wins the fence”** (`session-loader.service.spec.ts:2389`). It uses a controlled `MessageChannel`, starts a compaction reload while the first replay is held after 250 events, asserts only those 250 stale events landed, the winning ten events land once, `clearPendingUpdates` precedes finalization, the old replay never finalizes, status ends loaded, and two held live events deliver once in order after the winning finalization.
- [x] B4 spec title: **“B4 — throw mid-replay exposes no loaded partial transcript before failure settles and releases once”** (`session-loader.service.spec.ts:2450`). It records `{ status, isReplaying, messages }` at every mocked state transition, pins `resuming/true/0` at the throw and `resuming/false/0` immediately before failure, asserts failure precedes the loaded status transition, asserts no finalization, one fence delivery, replay flag cleared, and proves admission release by completing the next resume.
- [x] B3 mutation proof: temporarily removed the post-yield `canContinueReplay` check. Targeted uncached run failed the B3 title at `session-loader.service.spec.ts:2436`: expected 250 old events, received 600. Mutation was immediately reverted.
- [x] B4 mutation proof: temporarily inserted `sessionManager.setStatus('loaded')` after `markReplayFinished` in the replayer `finally`. Targeted uncached run failed the B4 title at `session-loader.service.spec.ts:2512`; observed `status:loaded` before `before-failure`. Mutation was immediately reverted.
- [x] Current production code needed no B3/B4 fix: **B3/B4 not reproducible; pinned by specs**.

## States and accessibility

- Loading: readonly `loadingTabIds` signal includes the tab for the entire shared request/replay promise.
- Empty/no-page: `null` and `undefined` cursor return `none` without RPC.
- Error: stale hides further paging and instructs reopen; ordinary failure retains cursor for retry.
- Interactive: duplicate requests share one promise; no automatic resume/reopen was added. This batch changes no markup, focus behavior, roles or visual contrast.

## Verification

### Runner gate

- Before the final test run, the machine-wide `jest-worker|run-executor` count was 3 processes representing one active Nx runner; starting this lane kept the runner count at two or fewer. Earlier, when two/three concurrent Nx executors were present, this lane waited until the count drained instead of starting tests.

### Tests

Command:

```text
npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2
```

Literal result:

```text
NX   Running target test for project @ptah-extension/chat:
- @ptah-extension/chat
Test Suites: 80 passed, 80 total
Tests:       2 skipped, 1289 passed, 1291 total
Snapshots:   0 total
NX   Successfully ran target test for project @ptah-extension/chat
```

Batch 7 baseline was 78 suites, 1,269 passed, 2 skipped / 1,271 total. Batch 12 is +2 suites and +20 passing tests, with no increase in skipped tests.

### Typecheck

Command:

```text
npx nx run-many -t typecheck -p @ptah-extension/chat ptah-extension-webview --parallel=1
```

Literal result:

```text
NX   Running target typecheck for 2 projects:
- @ptah-extension/chat
- ptah-extension-webview
NX   Successfully ran target typecheck for 2 projects
```

### Lint

Command:

```text
npx nx run-many -t lint -p @ptah-extension/chat --parallel=1
```

Literal result:

```text
NX   Running target lint for project @ptah-extension/chat:
- @ptah-extension/chat
✖ 17 problems (0 errors, 17 warnings)
NX   Successfully ran target lint for project @ptah-extension/chat
```

No new warning is attributable to the new paging service or replayer. The warnings are the repository's existing max-lines, non-null assertion, unused import and empty-function warnings. The loader remains an existing max-lines warning; this batch adds only four lines to it.

### Builds

```text
npx nx run ptah-extension-webview:build:development
NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
Initial total: 8.60 MB
```

```text
npx nx run ptah-extension-webview:build:production
NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
Initial total: 2.92 MB
WARNING: bundle initial exceeded maximum budget by 423.53 kB (the allowed existing warning)
```

### Formatting

```text
npx prettier --check <11 Batch 12 chat files>
Checking formatting...
All matched files use Prettier code style!
```

### Degradation audit

Command (run twice):

```text
npx nx run degradation-audit:lint --skip-nx-cache
```

Observed result:

```text
libs/frontend/chat: 11 ok (baseline 11)
libs/backend/agent-sdk: 5 FAIL (baseline 4)
degradation-audit: TOTAL 304 unsuppressed site(s)
NX   Running target lint for project degradation-audit failed
```

The new finding is `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:331 [catch-return-sentinel]`, an uncommitted Batch 10 file explicitly outside this lane's ownership. Batch 12 adds no chat degradation and satisfies the “no literal-return catch” safeguard, but the workspace-wide 303 gate cannot pass until the concurrent lane resolves its finding.

### Diff safeguards

- `git diff --check`: clean.
- No hunk in `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation`, `lastScrollTop`, or `chat-transcript.component.css`.
- No `content-visibility`, `ALLOWED_METHOD_PREFIXES`, TODO or stub change.
- `git status --short` includes this batch's chat files plus the concurrent Batch 10 backend/shared/CLI-doc files; none of those other-lane files was edited by this batch.

## Design fidelity

No visual handoff applies. The implementation follows `implementation-plan.md` C12 and decisions D11/D14 exactly. The component HTML is deliberately untouched until Batch 13.

## Plan deviations

- `session-loader.cli-restore.spec.ts` required an injection-only `HistoryPagingService` double because its intentionally minimal `TabManagerService` stub does not implement the newly used cursor method. Existing assertions and behavior were not changed. This is the only deviation from Task 12.4's preference that the CLI-restore spec remain byte-for-byte unedited.
- No B3/B4 production fix landed because both regressions were not reproducible on current code.

## Blocking findings

- Workspace-wide degradation audit is blocked by the concurrent Batch 10 `agent-sdk` change described above. It is outside Batch 12 ownership; `libs/frontend/chat` remains at baseline.
- No claim-semantics, admission, UI-structure or paging-design blocker was found.

## Out-of-scope observations

- Existing lint warnings and the existing production initial-bundle budget warning remain unchanged in kind.
- No other out-of-scope chat issue was modified.

## Revise round 1

### Review findings and resolutions

1. **STYLE SERIOUS — raw `Injector.get(HistoryMessageBuilder)`**: resolved. `SessionHistoryReplayer` now field-injects the builder with `inject(HistoryMessageBuilder)` at `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:102`; every paging operation uses that field at `:265-288`, and the raw `Injector` import/field is gone. There is no DI cycle: `HistoryMessageBuilder` injects only streaming/state collaborators at `libs/frontend/chat-streaming/src/lib/history-message-builder.service.ts:92-98`, none of which imports or injects `SessionHistoryReplayer`; the established sibling precedent is `MessageFinalizationService` field-injecting the same builder at `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:104`. Eager field injection required narrow builder providers in legacy replayer/loader test harnesses that do not exercise older-page building (`session-history-replayer.admission.spec.ts:103`, `session-history-replayer.service.spec.ts:103`, `session-loader.service.spec.ts:188,1154,1284,1365,1568,2227`, and `session-loader.cli-restore.spec.ts:113`). The real streaming-pipeline harness deliberately retains the real builder.
2. **LOGIC MODERATE — pre-RPC claim/replay/cursor check**: resolved. The replayer exposes the existing eligibility predicate as `canReplayOlderPage` (`session-history-replayer.service.ts:401-411`), covering claim ownership, tab existence/binding, and cursor identity. `HistoryPagingService.loadOlder` calls it before loading state or RPC (`history-paging.service.ts:47-60`); the RPC is later at `:82`. Downstream checks remain before admission, after admission, and after each yield (`session-history-replayer.service.ts:251,259,274`). The new spec `does not send an RPC while a resume claim is held` proves the service makes neither RPC nor replay call (`history-paging.service.spec.ts:134-142`), while the real replayer claim spec proves a held claim makes the predicate false (`session-history-replayer.older-page.spec.ts:151-160`).
3. **LOGIC MODERATE — FU-20a/B5 re-read**: completed. The conclusion still holds and remains accepted: `replayOlderPage` now shares the same FIFO through `acquireReplayAdmission` (`session-history-replayer.service.ts:256`), while `canReplayOlderPage` does not publish or alter global session status (`:401-411`). Therefore a completed tail replay may publish global `loaded` while an unrelated older page is the later waiter; paging widens the set of waiters but does not change the accepted behavior or require claim/admission redesign. The Tail paging rule now adds one clause documenting that widened scope (`libs/frontend/chat/CLAUDE.md:78`); the existing Admission conclusion remains at `:75`.
4. **STYLE MINOR — chat-store documentation list**: resolved. `HistoryPagingService` is listed at `libs/frontend/chat/CLAUDE.md:27`.
5. **LOGIC MINOR — `recordTail` on failure**: resolved rather than merely documented as harmless. Cursor metadata is now recorded only after `replay()` returns successfully (`session-loader.service.ts:784-806`), so RPC failure, empty events, supersession, and replay exceptions do not write it. The empty-history failure is pinned by `session-loader.service.spec.ts:1196-1214`.
6. **STYLE MINOR — CLI-restore stub widening**: no production change was needed. The original injection-only `HistoryPagingService` widening remains accepted. This revision additionally supplies an injection-only empty `HistoryMessageBuilder` at `session-loader.cli-restore.spec.ts:113` because the requested eager field injection constructs the replayer during this minimal harness setup; no CLI-restore assertion or behavior changed.

### Files changed in revise round 1

- `libs/frontend/chat/CLAUDE.md`
- `libs/frontend/chat/src/lib/services/chat-store/history-paging.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/history-paging.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.older-page.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.admission.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.cli-restore.spec.ts`
- `.ptah/specs/TASK_2026_453_1eb4/b12-codex-report.md`

No backend, shared RPC, or CLI production/documentation file was edited.

### Line counts

- `session-history-replayer.service.ts`: **551 physical lines**, `HEAD` 474, delta **+77**; below the 700-line ceiling (and one line smaller than the pre-revision 552-line result after removing `Injector`).
- `session-loader.service.ts`: **1,354 physical lines**, `HEAD` 1,350, delta **+4**; unchanged from the original Batch 12 budget.

### Verification

Runner-cap checks before each full test attempt:

```text
RUNNER_COUNT=1
ProcessId   : 11512
Name        : node.exe
CommandLine : "C:\Program Files\nodejs\node.exe" D:\projects\ptah-extension\node_modules\nx\bin\run-executor.js

RUNNER_COUNT=0
RUNNER_COUNT=0
```

The first full attempt exposed 35 legacy-harness failures because eager builder injection constructed the real builder against intentionally minimal `TabManagerService` doubles (`visibleTabIds` / `activeTabId` missing). After adding injection-only builder providers, the second attempt had two failures because the real-pipeline harness was also overridden; removing that override preserved its real builder. These were test-harness fixes only. Final required test output:

```text
NX   Running target test for project @ptah-extension/chat:

- @ptah-extension/chat

With additional flags:
  --maxWorkers=2

> nx run @ptah-extension/chat:test --maxWorkers=2

Test Suites: 80 passed, 80 total
Tests:       2 skipped, 1290 passed, 1292 total
Snapshots:   0 total
Time:        41.398 s
Ran all test suites.

NX   Successfully ran target test for project @ptah-extension/chat
```

Typecheck:

```text
NX   Running target typecheck for 2 projects:

- @ptah-extension/chat
- ptah-extension-webview

> nx run @ptah-extension/chat:typecheck
> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json

> nx run ptah-extension-webview:typecheck
> tsc --noEmit --project apps/ptah-extension-webview/tsconfig.app.json

NX   Successfully ran target typecheck for 2 projects
```

Lint:

```text
> nx run @ptah-extension/chat:lint

Linting "@ptah-extension/chat"...
✖ 17 problems (0 errors, 17 warnings)

NX   Successfully ran target lint for project @ptah-extension/chat
```

The 17 warnings are the existing max-lines, non-null-assertion, unused-variable, and empty-function warnings; this revision introduced no lint error.

Development build:

```text
NX   Running target build for project ptah-extension-webview and 3 tasks it depends on:

> nx run @ptah-extension/shared:build  [existing outputs match the cache, left as is]
> nx run @ptah-extension/markdown:build:development  [local cache]
> nx run @ptah-extension/ui:build:development  [local cache]
> nx run ptah-extension-webview:build:development

Initial total | 8.60 MB
Application bundle generation complete. [27.455 seconds]
Output location: D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\dist\apps\ptah-extension-webview

NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
Nx read the output from the cache instead of running the command for 3 out of 4 tasks.
```

Final `git diff --check -- libs/frontend/chat` output was empty (clean).

### Deviations and blocking findings

- Test-only builder providers were added where eager field injection made previously lazy construction visible; this is the minimum harness adaptation needed for the requested style fix. The production DI graph has no cycle.
- FU-20a remains accepted and documented; no claim-semantics or admission redesign was attempted.
- No blocking finding remains for revise round 1.
