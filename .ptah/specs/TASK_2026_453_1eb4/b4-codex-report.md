# Batch 4 Codex Report

## Outcome

Task 4.1, “Replay-tab signal and `motionSuppressed` gate,” is implemented and verified. The replay-owned signal now suppresses replay/finalization motion without using tab `resuming` status, and `execution-node.component.ts` remains unchanged for Batch 5.

## Files Created or Modified

- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\CLAUDE.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.admission.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.replay-motion.spec.ts` (created)
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\b4-codex-report.md` (created)

The pre-existing modification to `.ptah/specs/TASK_2026_453_1eb4/batches.md` was not touched.

## Acceptance-Criteria Evidence

1. **Replay-owned, claim-keyed signal.** The private writable signal, public readonly signal, and accessor are at `session-history-replayer.service.ts:115-117,155-156`. Replay entry marks the tab before admission at `:192-193`; every exit clears it in `finally` at `:221-223`. Claim-keyed removal is at `:227-239`, while successful finalization and fence close remain adjacent at `:218-219`. Specs cover entry/admission and successful clearing at `session-history-replayer.admission.spec.ts:211-243`, superseded clearing at `:373`, throwing replay clearing at `:412`, older/newer same-tab ownership at `:416-439`, and rejected hand-off clearing at `:442-475`.
2. **No `resuming` derivation.** The flag is written only by `SessionHistoryReplayer.markReplayStarted/markReplayFinished` (`session-history-replayer.service.ts:227-239`). Consumers call `isReplaying`; no new status comparison was added.
3. **Chat-view propagation.** `ChatViewComponent` adds only the replayer import/injection and accessor at `chat-view.component.ts:43,162,170-172`; each transcript receives `[historyReplaying]` at `chat-view.component.html:69`.
4. **Transcript gate.** `historyReplaying` and `motionSuppressed` are at `chat-transcript.component.ts:186,263-265`; the bubble binding uses `motionSuppressed()` at `chat-transcript.component.html:22`. The existing `isFinalizingTransition` implementation remains unchanged. The new spec proves replay suppression and the full 300 ms settle at `chat-transcript.replay-motion.spec.ts:132-159`, including the first finalized bubble render.
5. **Message badge motion.** Both badge sites use bound enter/leave values with `''` while suppressed at `message-bubble.component.html:129-130,159-160`. Coverage is at `message-bubble.component.spec.ts:229-282`; jsdom has no Web Animations API, so the spec pins the suppressed no-class/no-class-associated-frame branch and the enabled gate, while both AOT builds below validate the bound Angular syntax.
6. **Inline-agent motion.** The auto-animate container is disabled from `isFinalizing()` at `inline-agent-bubble.component.ts:450`; footer enter/leave are bound at `:513-514` (the sent toast remains the unchanged static binding at `:413`). The controller suppression spec is at `inline-agent-bubble.component.spec.ts:139-155`. `execution-node.component.ts` and `execution-node.render-throttle.spec.ts` have no diff.
7. **Required specs.** All replay-signal cases live only in `session-history-replayer.admission.spec.ts`; the new transcript replay-motion spec and the message/agent bubble cases are present. Focused result: `Test Suites: 4 passed, 4 total` and `Tests: 42 passed, 42 total`.
8. **Rule 7 documentation.** The single **Replay-tab signal** bullet is at `libs/frontend/chat/CLAUDE.md:76` and records entry-before-admission, claim-keyed `finally`, `isReplaying`, the combined gate, and the ban on deriving it from `resuming`.

## Batch 4 Risk Handling

- **Flag left set:** the clear is inside `replay()`'s unconditional `finally`, covering success, supersession, chunk/yield throws, and rejected admission hand-offs. The rejected hand-off assertion is at `session-history-replayer.admission.spec.ts:475`.
- **Superseding replay finally:** `replayingClaims` stores the publishing claim number. `markReplayFinished` returns unless the stored claim matches, and the same-tab test observes the flag still true after the older promise settles (`:416-439`).
- **Bound animate production AOT:** both `build:development` and `build:production` compiled the `[animate.enter]`/`[animate.leave]` bindings successfully.
- **Scroll/content-visibility:** `git diff --check` passed; searches found no `content-visibility`, no `isFinalizingTransition()` call in `chat-transcript.component.html`, and no diff/hunk in `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation`, `lastScrollTop`, or `chat-transcript.component.css`.
- **Execution-node ownership:** no change was made to `execution-node.component.ts`; its `isNodeStreaming()` throttle remains for Batch 5's `streamingBoundary` recovery.

## Verification Outputs

### 1. Chat tests

Command: `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2`

```text
NX   Running target test for project @ptah-extension/chat:
- @ptah-extension/chat
Test Suites: 77 passed, 77 total
Tests:       2 skipped, 1250 passed, 1252 total
NX   Successfully ran target test for project @ptah-extension/chat
```

This includes Gate A, the transcript scroll suites, `chat-transcript.component.spec.ts`, and the unchanged execution-node render-throttle spec.

### 2. Typecheck

Command: `npx nx run-many -t typecheck -p @ptah-extension/chat ptah-extension-webview --parallel=1`

```text
NX   Running target typecheck for 2 projects:
- @ptah-extension/chat
- ptah-extension-webview
NX   Successfully ran target typecheck for 2 projects
```

### 3. Lint

Command: `npx nx run-many -t lint -p @ptah-extension/chat ptah-extension-webview --parallel=1`

```text
NX   Running target lint for 2 projects:
- @ptah-extension/chat
- ptah-extension-webview
✖ 17 problems (0 errors, 17 warnings)
✔ All files pass linting
NX   Successfully ran target lint for 2 projects
```

No new warning was introduced. The 17 warnings are pre-existing: max-lines warnings in chat-input, inline-agent-bubble, chat-view, session-loader, agent-orchestration-config, and ptah-cli-config; existing non-null-assertion warnings in inline-agent-bubble, chat-view specs, and keepalive specs; and existing unused/empty-function warnings in app-shell, session-loader, and ptah-cli-config.

### 4. Development and production AOT builds

Commands:

- `npx nx run ptah-extension-webview:build:development`
- `npx nx run ptah-extension-webview:build:production`

```text
Application bundle generation complete. [25.786 seconds]
NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
Application bundle generation complete. [25.774 seconds]
NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
```

Production retained the pre-existing initial-bundle budget warning (`2.92 MB`, 417.08 kB over the 2.50 MB warning budget) but succeeded.

### 5. Degradation audit

Command: `npx nx run degradation-audit:lint --skip-nx-cache`

```text
libs/frontend/chat: 11 ok (baseline 11)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

### 6. Prettier

Command: `npx prettier --check <all 12 changed product/test/doc files>`

```text
Checking formatting...
All matched files use Prettier code style!
```

The report itself was subsequently included in a final Prettier check.

### 7. Diff safeguards

```text
git diff --check: exit 0
execution-node.component.ts diff: empty
chat-transcript.component.css diff: empty
forbidden scroll-method/content-visibility search: no matches
rg -n "isFinalizingTransition\(\)" chat-transcript.component.html: no matches
```

## Revise round 1

### Review findings resolved

1. **Logic Serious — zoneless replay-clear gap.** `ChatTranscriptComponent` now detects the `historyReplaying` falling edge and owns a local 300 ms `replayMotionHold` (`chat-transcript.component.ts:235,265-274,440-462`). `motionSuppressed` includes that hold, so a change-detection pass between the replayer clearing its flag and `SessionLoaderService` setting status `loaded` stays suppressed without Zone coalescing. A new replay cancels the pending hold (`:447-450,656-662`), and component cleanup clears its timer (`:653`). `chat-transcript.replay-motion.spec.ts:159-231` pins the real write order in separate change-detection passes, the unchanged live `resuming → loaded` path, new-replay cancellation, and destroy cleanup.
2. **Style Serious — class-header contract.** The `SessionHistoryReplayer` header now includes a **Replay-tab signal** bullet with `{@link replay}` and `{@link isReplaying}` at `session-history-replayer.service.ts:21-23`.
3. **Logic M1 / style minor — enabled badge bindings.** `message-bubble.component.spec.ts:272-285` reads the production template and asserts the exact enabled values `bubble-fade-enter` and `bubble-fade-leave`, catching inverted ternaries or wrong class names. The suppressed branch continues to assert no class and no binding-owned rAF.
4. **Logic M2 — auto-animate re-enable.** `inline-agent-bubble.component.spec.ts:155-173` mounts with `isFinalizing=true`, flips it false, and asserts `autoAnimate()` is created exactly once.
5. **Logic M3 — per-tab ChatView propagation.** `chat-view.component.spec.ts:427-446` takes the actual first `transcriptTabIds()` value and proves `isHistoryReplaying` queries the replayer with that same id, returning true and false as the replay set changes. The harness now provides the replayer stub at `:166-169,361-364`.
6. **Style minor — unrelated eslint disable.** The comment was not restored: the first-round lint run with it present emitted `Unused eslint-disable directive (no problems were reported from '@typescript-eslint/dot-notation')` at the bracket-access line. Removing it was therefore the lint-proven resolution allowed by the review brief; revise-round lint reports no warning there.

The directory contract bullet was also updated at `libs/frontend/chat/CLAUDE.md:76` to document the transcript-local falling-edge hold and its zoneless continuity guarantee.

### Files changed in revise round 1

- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\CLAUDE.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.replay-motion.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\templates\chat-view.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\b4-codex-report.md`

### Revise-round verification

Focused review specs:

```text
Test Suites: 4 passed, 4 total
Tests:       77 passed, 77 total
NX   Successfully ran target test for project @ptah-extension/chat
```

Required full test gate:

```text
NX   Running target test for project @ptah-extension/chat:
- @ptah-extension/chat
Test Suites: 77 passed, 77 total
Tests:       2 skipped, 1255 passed, 1257 total
NX   Successfully ran target test for project @ptah-extension/chat
```

Typecheck:

```text
NX   Running target typecheck for 2 projects:
- @ptah-extension/chat
- ptah-extension-webview
NX   Successfully ran target typecheck for 2 projects
```

Lint:

```text
NX   Running target lint for 2 projects:
- @ptah-extension/chat
- ptah-extension-webview
✖ 17 problems (0 errors, 17 warnings)
✔ All files pass linting
NX   Successfully ran target lint for 2 projects
```

The 17 warnings are the same pre-existing set documented above; no revise-round warning was added.

Development and production AOT builds:

```text
Application bundle generation complete. [26.218 seconds]
NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
Application bundle generation complete. [27.442 seconds]
NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
```

Production again succeeded with the existing initial-bundle budget warning (`2.92 MB`, 417.78 kB over the 2.50 MB warning budget).

Degradation audit:

```text
libs/frontend/chat: 11 ok (baseline 11)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

Final Prettier and diff-safeguard outputs are recorded after the report append below.

Prettier:

```text
Checking formatting...
All matched files use Prettier code style!
```

Diff safeguards:

```text
git diff --check: exit 0
execution-node.component.ts diff: empty
execution-node.render-throttle.spec.ts diff: empty
chat-transcript.component.css diff: empty
forbidden scroll-method hunk search: no matches
added content-visibility search: no matches
rg -n "isFinalizingTransition\(\)" chat-transcript.component.html: no matches
```
