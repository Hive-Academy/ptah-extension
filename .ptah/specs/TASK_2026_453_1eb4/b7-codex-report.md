# Batch 7 Codex Report — C5 replay scroll retention

## Result

PASS. `TranscriptRenderWindow` now keeps replay mounts monotonic at the tail, records retained bubble heights, and releases retention after replay through an independent rAF/50 ms race. The Angular component remains exactly 700 lines. No clarification was required.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-render-window.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-render-window.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.replay-mount.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\CLAUDE.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\b7-codex-report.md`

Pre-existing task-document changes were preserved and not edited by this lane: `batches.md`, `implementation-plan.md`, and the untracked `scroll-regression-analysis.md`.

## Acceptance-criterion evidence

1. `setReplayRetention(active)` and idempotence: `transcript-render-window.ts:71-72,149-161`. The active-state equality return prevents repeated signal writes; rising seeds `tail ∪ intersecting`, and falling clears a non-empty retained set.
2. Monotonic tail union and absent-id eviction: `transcript-render-window.ts:138-145,235-263`. Both tail and retained writes retain `sameSet` short-circuits. Covered at `transcript-render-window.spec.ts:202-214,254-270`.
3. Replay mount policy: `transcript-render-window.ts:170-176` uses `tail ∪ retained` during retention and `tail ∪ intersecting` otherwise. The no-`IntersectionObserver` path still returns true at `:171`, covered by `transcript-render-window.spec.ts:109-121`; never-mounted intersection behavior is covered at `:215-223`.
4. Retained height capture and measured release: `transcript-render-window.ts:199-222` includes retained ids in `wasMounted` while continuing to update intersections. Policy coverage is `transcript-render-window.spec.ts:225-239`; component coverage is `chat-transcript.replay-mount.spec.ts:352-377`.
5. Raw replay rising edge and ordering: `chat-transcript.component.ts:530-546` reads `historyReplaying()` directly, enables retention at `:538`, and calls `syncMessages` at `:544`; it does not read `replayMotionHold` or `motionSuppressed` in this effect.
6. Deferred falling edge and race: `chat-transcript.component.ts:539-540,674-690` schedules a private retention release through separate rAF and 50 ms timer handles; the shared release callback clears both before disabling retention. Restart cancellation is covered by `chat-transcript.replay-mount.spec.ts:433-455`.
7. Destroy cleanup: `chat-transcript.component.ts:657-671` invokes the release-handle cancellation independently of `scrollRafId`; coverage is `chat-transcript.replay-mount.spec.ts:407-431`.
8. Safeguards: there is no diff in the transcript HTML/CSS, `chat-transcript.component.spec.ts`, replay-motion spec, or execution-node files. `git diff --check` is clean; no added/removed line contains `content-visibility` or changes `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation`, `lastScrollTop`, `replayMotionHold`, or `motionSuppressed`.
9. Pure render-window specs (a)-(e): `transcript-render-window.spec.ts:202-270` covers tail leavers without callbacks, never-mounted intersections, retained non-intersection plus measured release, rising-edge seeding, pruning, and restoration of the normal policy. The pre-change policy would fail (a), because a tail leaver with no observer callback was in neither `tail` nor `intersecting`.
10. Component specs (f)-(i): monotonic 50 → 98 → 146 replay mounts are covered at `chat-transcript.replay-mount.spec.ts:320-350`; queued-frame release at measured height at `:352-377`; hidden-window timer fallback at `:379-405`; destroy and restart cancellation at `:407-455`; the former intersecting-slot case is rewritten, not removed, at `:289-318`. Existing settled replay, live-throttle, and live-exempt cases remain at `:457-506`.
11. Rule 7 was extended in place at `libs/frontend/chat/CLAUDE.md:77` with the monotonic tail, raw flag, deferred rAF/timer release, and cancellation rules; no duplicate bullet was added.

## Risk handling

- Hidden window: rAF is raced with `window.setTimeout(..., 50)` so retention cannot remain active indefinitely when a hidden surface receives no frame. The timer-path test leaves both retention handles null.
- rAF separation: `retentionReleaseRafId` is distinct from `scrollRafId` (`chat-transcript.component.ts:208-210`); release code never reads, cancels, or reuses the scroll handle.
- Destroy/restart: `cleanup()` and a new raw replay rising edge cancel both release handles. The pending release therefore cannot fire after destroy or disable retention during a newer replay.
- H1: retained mounts only grow from successive synced tails; observer-reported never-mounted slots remain placeholders during replay. This removes the bubble/120 px-placeholder swaps above the anchor while chunks grow below.
- H2: retention is not cleared in the finalize change-detection pass. Release happens in the next rAF or a later 50 ms macrotask, allowing the finalize layout pass to settle first.
- A4 remains an Electron validation assumption: if Batch 8 reports small-distance failures, the documented escalation is release after the replay motion hold. This batch deliberately does not read that hold.
- jsdom cannot model layout, native scroll anchoring, or the resulting scroll event. These tests pin the H1/H2 preconditions; Batch 8's 23-attempt Electron re-check remains the end-to-end proof.
- U1 remains open: an unrelated future live-stream growth coinciding with a post-replay placeholder correction can only be fully hardened by the forbidden anchoring-aware `onScroll` change.

## Verification output

The mandated final sequence completed in order. Two preliminary Gate 1 runs exposed test-only fake-timer assertions (first three, then one); those assertions were corrected without changing production behavior, and Gate 1 was restarted and passed before later gates ran.

### 1. Tests

Command:

```text
npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2
```

Literal final output lines:

```text
NX   Running target test for project @ptah-extension/chat:
- @ptah-extension/chat
Test Suites: 78 passed, 78 total
Tests:       2 skipped, 1269 passed, 1271 total
NX   Successfully ran target test for project @ptah-extension/chat
```

Nx renders the one-project header in singular form rather than the expected `for 1 project` wording; the sole listed project is `@ptah-extension/chat`. Compared with Batch 5, suites remain 78 and skipped tests remain 2; passed tests increase from 1,259 to 1,269 (+10 replay-retention regression tests).

### 2. Typecheck

Command:

```text
npx nx run-many -t typecheck -p @ptah-extension/chat ptah-extension-webview --parallel=1
```

Literal output lines:

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

Literal output lines:

```text
NX   Running target lint for project @ptah-extension/chat:
✖ 17 problems (0 errors, 17 warnings)
NX   Successfully ran target lint for project @ptah-extension/chat
```

All 17 warnings are the documented pre-existing warnings; this batch adds none. `chat-transcript.component.ts` is exactly 700 lines and produces no max-lines warning.

### 4. Production build

Command:

```text
npx nx run ptah-extension-webview:build:production
```

Literal output lines:

```text
Application bundle generation complete. [44.886 seconds] - 2026-09-16T17:42:59.249Z
Output location: D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\dist\apps\ptah-extension-webview
NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
▲ [WARNING] bundle initial exceeded maximum budget. Budget 2.50 MB was not met by 419.35 kB with a total of 2.92 MB.
```

The initial-bundle budget warning is the explicitly allowed existing warning.

### 5. Degradation audit

Command:

```text
npx nx run degradation-audit:lint --skip-nx-cache
```

Literal output lines:

```text
libs/frontend/chat: 11 ok (baseline 11)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

There is no FAIL row.

### 6. Prettier

Command:

```text
npx prettier --check libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.ts libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.spec.ts libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.replay-mount.spec.ts libs/frontend/chat/CLAUDE.md .ptah/specs/TASK_2026_453_1eb4/b7-codex-report.md
```

Literal output lines:

```text
Checking formatting...
All matched files use Prettier code style!
```

### 7. Diff safeguards

Literal checks/results:

```text
git diff --check
<no output>

Protected path diff list:
<no output>

Forbidden added/removed tokens (content-visibility and protected scroll/motion symbols):
<no output>

chat-transcript.component.ts line count:
700
```

`git status --short` contains the five Task 7.1 product/doc files plus the pre-existing team-leader/architect task documents and this report. No git write operation was performed.

## Revise round 1

Both `b7-code-logic-review.md` and `b7-code-style-review.md` were APPROVED. This round addressed their two moderate logic findings and two minor documentation findings without changing production behavior or adding lines to `chat-transcript.component.ts`.

### Per-finding changes

1. Logic Moderate 1 — H2 effect ordering: added `chat-transcript.replay-mount.spec.ts:376-402`. The spec intercepts `scheduleReplayRetentionRelease()` at the falling edge and asserts `replayMotionHold()` is already true at the instant scheduling begins. Its comment at `:378-379` records that the motion-hold effect is declared first and that the order is load-bearing for H2. Reordering the two constructor effects now fails this spec.
2. Logic Moderate 2 — admission-queued replay with zero trees: added `chat-transcript.replay-mount.spec.ts:352-374`. It starts with `historyReplaying: true` and no trees, delivers 50 and then 98 trees, interleaves an observer intersection for a never-mounted middle slot, and proves the first tail remains mounted, the mount count grows only by tails, and the unmeasured middle slot never mounts.
3. Style Minor 1 — raw-versus-gated rationale: replaced the one-line feed-effect comment in place at `chat-transcript.component.ts:530` with `Read replay raw across hides; vm/active keep hidden content work gated.` The component remains exactly 700 lines.
4. Style Minor 2 — policy class documentation: extended the existing class doc at `transcript-render-window.ts:27-28` to name the monotonic replay mount set as the third policy beside mount decisions and measured heights.
5. Logic Serious — release-window live-event race: no code change, as required. A live event can still grow content below during the single rAF/50 ms interval in which retained bubbles release, recreating the H1 layout shape at lower probability. This remains explicitly covered by Batch 8's 23-attempt Electron scroll re-check and the U1 anchoring-aware `onScroll` escalation; `onScroll` remains forbidden and untouched in this batch.

### Files changed in revise round 1

- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts` — comment replacement only; net zero lines.
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.replay-mount.spec.ts` — two regression specs.
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-render-window.ts` — class-doc extension only; net zero lines.
- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\b7-codex-report.md` — this appended review response.

The other Task 7.1 changes from the original round remain intact. The two review files and pre-existing task/planning documents were read only.

### Revise verification output

The full required sequence was rerun after the revise edits.

#### 1. Tests

```text
npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2

NX   Running target test for project @ptah-extension/chat:
- @ptah-extension/chat
Test Suites: 78 passed, 78 total
Tests:       2 skipped, 1271 passed, 1273 total
NX   Successfully ran target test for project @ptah-extension/chat
```

Nx again renders the one-project header in singular form and lists exactly one project. The revise round adds two passing tests over the prior 1,269-pass result.

#### 2. Typecheck

```text
npx nx run-many -t typecheck -p @ptah-extension/chat ptah-extension-webview --parallel=1

NX   Running target typecheck for 2 projects:
- @ptah-extension/chat
- ptah-extension-webview
NX   Successfully ran target typecheck for 2 projects
```

#### 3. Lint

```text
npx nx run-many -t lint -p @ptah-extension/chat --parallel=1

NX   Running target lint for project @ptah-extension/chat:
✖ 17 problems (0 errors, 17 warnings)
NX   Successfully ran target lint for project @ptah-extension/chat
```

The 17 warnings are pre-existing; the revised component remains at exactly 700 lines and has no max-lines warning.

#### 4. Production build

```text
npx nx run ptah-extension-webview:build:production

Application bundle generation complete. [23.429 seconds] - 2026-09-16T18:05:40.587Z
Output location: D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\dist\apps\ptah-extension-webview
NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
▲ [WARNING] bundle initial exceeded maximum budget. Budget 2.50 MB was not met by 419.35 kB with a total of 2.92 MB.
```

The initial-bundle budget warning is the allowed existing warning.

#### 5. Degradation audit

```text
npx nx run degradation-audit:lint --skip-nx-cache

libs/frontend/chat: 11 ok (baseline 11)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

There is no FAIL row.

#### 6. Prettier

```text
npx prettier --check libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.ts libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.spec.ts libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.replay-mount.spec.ts libs/frontend/chat/CLAUDE.md .ptah/specs/TASK_2026_453_1eb4/b7-codex-report.md

Checking formatting...
All matched files use Prettier code style!
```

#### 7. Diff safeguards

```text
git diff --check
<no output>

Protected HTML/CSS/component/replay-motion/execution-node path diff list:
<no output>

Forbidden product diff tokens (content-visibility and protected scroll/motion symbols):
<no output>

chat-transcript.component.ts line count:
700
```

No git write operation was performed. `chat-transcript.component.html`, `chat-transcript.component.css`, `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation`, `lastScrollTop`, replay-motion code, and execution-node files remain untouched.
