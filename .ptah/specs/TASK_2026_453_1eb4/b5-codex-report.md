# Batch 5 Codex Report — C5 Replay Render-Window Fence

## Outcome

Task 5.1 is implemented and all required verification gates pass. During history replay, streaming execution trees now use the settled boundary for both render-window membership and the bubble `isStreaming` input. Outside replay, the boundary remains `finalizedCount`, preserving live typing throttling.

## Files Changed

- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.replay-mount.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\agent-output-root.md` (this report)

No git write was performed.

## Acceptance-Criteria Evidence

1. `TranscriptViewModel.streamingBoundary` and the default value are at `chat-transcript.component.ts:99` and `:110`. The active view model derives it directly from raw `this.historyReplaying()` as `totalCount` during replay and `finalized.length` otherwise at `:421-428`. Neither `replayMotionHold` nor `motionSuppressed` participates in that expression.
2. The render-window effect passes `view.streamingBoundary` to `syncMessages` at `chat-transcript.component.ts:531-534`.
3. The template binds `[isStreaming]="i >= vm().streamingBoundary"` at `chat-transcript.component.html:21`.
4. `vm().isStreaming`, `TranscriptRenderWindow`, all scroll methods, `lastScrollTop`, and `chat-transcript.component.css` are unchanged. No `content-visibility` code was added. The new spec contains no `isAdjusting` reference. The component remains below the ceiling at 669 lines.
5. `chat-transcript.replay-mount.spec.ts` uses a file-local fake `IntersectionObserver` at `:82-118` and proves:
   - A 50-message replay initially mounts exactly `ALWAYS_MOUNTED_TAIL` (6), observer-reported slots mount, and an intersecting slot remains mounted after growth moves it out of the tail at `:288-309` (A7).
   - Every rendered replay bubble receives `isStreaming = false` at `:311-319`.
   - With replay false, the live bubble at an index greater than or equal to `finalizedCount` receives `isStreaming = true` at `:321-335`.
   - After replay clears and status settles to `loaded`, a subsequent live stream exempts all ten live messages from the window; the first is outside the trailing six and remains mounted at `:337-365`.

`execution-node.component.ts` and `execution-node.render-throttle.spec.ts` are unchanged, and their existing tests are included in the passing full chat suite.

## Risk Handling

- **Tail-shift placeholder drop versus scroll:** A7 is unit-pinned for an observer-reported slot, but the pre-first-observer timing case depends on real layout and native scroll anchoring. As specified, it is only provable in the M1 Electron scroll sanity check; no scroll logic was changed here.
- **Live streaming throttle:** Outside replay, `streamingBoundary` returns to `finalizedCount`. The dedicated test at `chat-transcript.replay-mount.spec.ts:321-335` proves the live bubble still receives `isStreaming = true`, preserving the execution-node rAF throttle.
- **A7:** The local observer test reports a current-tail slot intersecting, grows the transcript until that slot leaves the tail, and proves it remains mounted through the observer set.
- **A8 residual:** C5 removes the transcript-provided streaming flag during replay, but a message execution node whose own status remains `streaming` can still schedule a frame until its `message_complete` event. This bounded residual is intentionally unchanged and must be assessed from the M1 rAF histogram.

## Verification Evidence

### 1. Full chat tests

Command:

```text
npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2
```

Literal output:

```text
NX   Running target test for project @ptah-extension/chat:
Test Suites: 78 passed, 78 total
Tests:       2 skipped, 1259 passed, 1261 total
Snapshots:   0 total
Time:        33.304 s
Ran all test suites.
NX   Successfully ran target test for project @ptah-extension/chat
```

The header names exactly one project. Gate A, scroll specs, replay-motion, the new replay-mount spec, and execution-node render-throttle all ran in this suite.

### 2. Typecheck

Command:

```text
npx nx run-many -t typecheck -p @ptah-extension/chat ptah-extension-webview --parallel=1
```

Literal output:

```text
NX   Running target typecheck for 2 projects:
- @ptah-extension/chat
- ptah-extension-webview
NX   Successfully ran target typecheck for 2 projects
```

### 3. Lint

Command:

```text
npx nx run-many -t lint -p @ptah-extension/chat --parallel=1
```

Literal output:

```text
NX   Running target lint for project @ptah-extension/chat:
✖ 17 problems (0 errors, 17 warnings)
NX   Successfully ran target lint for project @ptah-extension/chat
```

There are no warnings in any changed Task 5.1 file and therefore no new warnings. The 17 existing warnings are in `chat-input.component.ts` (1), `inline-agent-bubble.component.ts` (2), `app-shell.component.ts` (2), `chat-view.component.spec.ts` (1), `chat-view.component.ts` (1), `chat-view.keepalive.spec.ts` (4), `session-loader.service.ts` (2), `agent-orchestration-config.component.ts` (1), and `ptah-cli-config.component.ts` (3).

### 4. Production webview build

Command:

```text
npx nx run ptah-extension-webview:build:production
```

Literal output:

```text
Application bundle generation complete. [23.129 seconds] - 2026-09-16T15:34:55.188Z
Output location: D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\dist\apps\ptah-extension-webview
NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
```

The existing bundle-budget warning remains: `bundle initial exceeded maximum budget. Budget 2.50 MB was not met by 417.86 kB with a total of 2.92 MB.`

### 5. Degradation audit

Command:

```text
npx nx run degradation-audit:lint --skip-nx-cache
```

Literal output:

```text
libs/frontend/chat: 11 ok (baseline 11)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

### 6. Prettier

Command:

```text
npx prettier --check libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.replay-mount.spec.ts
```

Literal output:

```text
Checking formatting...
All matched files use Prettier code style!
```

### 7. Diff safeguards

Literal results:

```text
SAFEGUARD: git diff --check passed
SAFEGUARD: no added content-visibility
SAFEGUARD: transcript CSS unchanged
SAFEGUARD: execution-node files unchanged
SAFEGUARD: no scroll-method hunk
SAFEGUARD: streamingBoundary uses raw historyReplaying only
LINECOUNT: 669
```

The only product/test paths in `git status --short` are the three Task 5.1 files listed above.

## Revise round 1

### Findings addressed

1. **STYLE SERIOUS 1 — dead `TranscriptViewModel.finalizedCount`: fixed.** Removed the unread interface field, empty-view default, and per-recompute assignment. The view model now exposes only the authoritative `streamingBoundary`; see `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:105,115,429`. A safeguard grep confirms no `finalizedCount` reference remains in the transcript component or template.
2. **STYLE SERIOUS 2 — stale `syncMessages` parameter semantics: fixed.** Renamed the parameter from `finalizedCount` to `streamingBoundary`, updated its loop variable use, and rewrote the method documentation to cover replay and live behavior without changing policy; see `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.ts:113-128`. The existing unit-spec helper and explanatory comment use the same name at `transcript-render-window.spec.ts:82-98,191`.
3. **STYLE MINOR — boundary rationale missing: fixed.** Added the field documentation at `chat-transcript.component.ts:98-104`: replay uses `totalCount` to window replayed trees and make settled execution nodes publish synchronously without per-node rAF; live mode uses the finalized count to preserve typing throttling; the derivation reads raw `historyReplaying()`, never the motion hold.
4. **STYLE MINOR — library replay contract missing: fixed.** Added exactly one `Replay boundary` bullet to rule 7 at `libs/frontend/chat/CLAUDE.md:77`.
5. **LOGIC informational follow-ups: recorded, no code change.** These pre-existing races are outside Batch 5's permitted implementation scope:
   - A compaction-targeted reload can race an in-flight replay because it skips the up-front `applyResumingSession` reset (`session-loader.service.ts:677-691`). This needs a focused ordering regression test in a future task.
   - A mid-replay throw leaves a short window between the replayer's `finally` clearing the replay flag and the caller applying `applyResumeFailure`. This needs a focused throw-path state-transition test in a future task.

### Files changed in revise round 1

- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-render-window.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-render-window.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\CLAUDE.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\b5-codex-report.md` (this appended section)

The existing Task 5.1 changes in `chat-transcript.component.html` and `chat-transcript.replay-mount.spec.ts` remain unchanged in this revision.

### Verification — revise round 1

#### 1. Full chat tests

```text
NX   Running target test for project @ptah-extension/chat:
Test Suites: 78 passed, 78 total
Tests:       2 skipped, 1259 passed, 1261 total
Snapshots:   0 total
Time:        30.06 s
Ran all test suites.
NX   Successfully ran target test for project @ptah-extension/chat
```

#### 2. Typecheck

```text
NX   Running target typecheck for 2 projects:
- @ptah-extension/chat
- ptah-extension-webview
NX   Successfully ran target typecheck for 2 projects
```

#### 3. Lint

```text
NX   Running target lint for project @ptah-extension/chat:
✖ 17 problems (0 errors, 17 warnings)
NX   Successfully ran target lint for project @ptah-extension/chat
```

No revised file has a lint warning. The 17 warnings are the unchanged project baseline listed in the initial report.

#### 4. Production webview build

```text
Application bundle generation complete. [19.663 seconds] - 2026-09-16T16:03:09.610Z
Output location: D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\dist\apps\ptah-extension-webview
NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
```

The existing bundle-budget warning remains: `bundle initial exceeded maximum budget. Budget 2.50 MB was not met by 417.82 kB with a total of 2.92 MB.`

#### 5. Degradation audit

```text
libs/frontend/chat: 11 ok (baseline 11)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

#### 6. Prettier

```text
Checking formatting...
All matched files use Prettier code style!
```

#### 7. Diff safeguards

```text
SAFEGUARD: git diff --check passed
SAFEGUARD: no added content-visibility
SAFEGUARD: transcript CSS unchanged
SAFEGUARD: execution-node files unchanged
SAFEGUARD: no scroll-method hunk
SAFEGUARD: transcript VM/template has no finalizedCount reference
```

`rg -n "syncMessages\(" libs/frontend/chat` reports one production caller (`chat-transcript.component.ts:535`), the declaration (`transcript-render-window.ts:119`), and calls contained only in `transcript-render-window.spec.ts`. The transcript component remains below the soft ceiling at 673 lines.
