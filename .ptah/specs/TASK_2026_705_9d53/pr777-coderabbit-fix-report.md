# PR #777 CodeRabbit fixes — report

Worktree: `D:\projects\ptah-extension\.claude-worktrees\remove-single-layout` (no git run).
The pre-existing `.gitignore` change in the tree is not from this work.

## FIX 1 — branch reports a tile that never opened

**Files:lines**
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1464-1476` —
  `onBranchRequested` now `await`s `requestCanvasSession(newSessionId, 'Branch')` inside the
  existing `try`, so `_actionInFlight` is still cleared in `finally`.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:1355-1376`.

**Behavior**
- `true` → `showActionInfo('Branch created.')` (unchanged).
- `false` (tile cap, 5 s canvas timeout, load failure) → `showActionError('Branch created, but it
  could not open as a tile (the canvas may be full). Open it from Previous sessions.')`.

**Tests**
- Existing "opens the forked session as a canvas tile" case now also checks that no error shows.
- New "reports a created branch that could not open as a tile (canvas full / timeout)": the mock
  returns `false`, so no info is shown and the error message above is shown.

## FIX 2 — task-prompt bridge prefills a tab the canvas refused

**Files:lines**
- `libs/frontend/core/src/lib/services/app-state.service.ts:216-246` — `CanvasTabRequest` gets
  an optional `resolve?: (adopted: boolean) => void` (same shape as `CanvasSessionRequest.resolve`).
  Doc updated: no removal timeout.
- `libs/frontend/core/src/lib/services/app-state.service.ts:1300-1339` —
  `requestCanvasTab(...)` returns `Promise<boolean>` and attaches a settle-once resolver to the
  queued request. Queue semantics are unchanged: FIFO, and no timer. A request still waits until
  the canvas mounts.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:450-476` — the
  `canvasTabRequests` drain effect settles `false` on a workspace-mismatch drop. After
  `adoptTab` it settles `true` when `adoptTab` returned the tab id, or when the tab is already in
  `canvasStore.tiles()`, and `false` otherwise. The second check exists because `adoptTab` tests
  the cap before its dedup (`canvas.store.ts:328-334`). On a fresh mount, hydration can tile the
  tab and fill the grid to the cap. `adoptTab` then returns null even though the tab is tiled.
  The old "KNOWN GAP (TASK_2026_471)" comment is replaced.
- `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts:6-11, 76-104,
  119-133`:
  - `consume` awaits `awaitCanvasTile(requestCanvasTab(...))`. This is a `Promise.race` against
    a 5 s timer, and the timer is cleared in `finally`.
  - `false` → `await tabManager.closeTab(tabId)`, no prefill, and the outcome is
    `{ success: false, error: 'The canvas is full. Close a session and try again.' }`.
  - `true` → prefill and success, as before.
  - `'timeout'` → prefill and success, as before. A code comment explains why: the request stays
    queued and is adopted when the canvas mounts.
  - `boardTaskLinkCapture.expect(tabId, taskId)` moved to after the canvas outcome, so it runs
    only when the tab is kept (see Decisions).
- Other `requestCanvasTab` callers are unchanged and ignore the promise:
  `harness-builder-view.component.ts:436`, `workflow-tab-launcher.service.ts:45` and
  `agent-session-adoption.service.ts:363`. `@typescript-eslint/no-floating-promises` is not
  enabled (`eslint.config.mjs:505`), so they need no `void`.

**Tests**
- `libs/frontend/core/src/lib/services/app-state.service.spec.ts:1753-1826`:
  - The two existing queue tests now expect `resolve: expect.any(Function)`.
  - New: the promise settles once, with the first value the callback reports (true and false).
  - New: no removal timeout. With fake timers advanced 60 s, the request is still queued.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts:447-560`:
  - Adopt → `resolve(true)`.
  - `adoptTab` null → `resolve(false)`.
  - New: `adoptTab` null at the cap but the tab is already in `tiles()` → `resolve(true)`.
  - Workspace mismatch → `resolve(false)`.
- `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.spec.ts`:
  - The mock `requestCanvasTab` resolves `true`, `closeTab` is mocked, and `flush` drains 10
    microtasks.
  - The success case also checks that `closeTab` is not called.
  - New cap-refusal case: no prefill, `closeTab('tab-refused')`, no `expect` link and a failure
    outcome.
  - New 5 s timeout case (fake timers, a promise that never settles): prefill and success, and
    the tab is not closed.

## Check output

```
npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/services/app-state.service.spec.ts --coverage=false --maxWorkers=2
Test Suites: 1 passed, 1 total
Tests:       140 passed, 140 total

npx jest -c libs/frontend/canvas/jest.config.ts libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts --coverage=false --maxWorkers=2
Test Suites: 1 passed, 1 total
Tests:       32 passed, 32 total

npx jest -c libs/frontend/chat/jest.config.ts .../task-prompt-bridge.service.spec.ts .../chat-view.component.spec.ts --coverage=false --maxWorkers=2
Test Suites: 2 passed, 2 total
Tests:       95 passed, 95 total
```

`ptah_get_diagnostics` did not run: it returned "TypeScript check still running after 45s" on
three tries. No typecheck or lint was run, as the brief asked. The orchestrator still needs to run
typecheck and lint for `core`, `canvas`, `chat` and `harness-builder`. `harness-builder` is a
caller whose return type changed.

## Decisions

- **Undoing `boardTaskLinkCapture.expect`.** `BoardTaskLinkCaptureService` has no cancel API
  (`board-task-link-capture.service.ts:30-39`).
  - Options: add a cancel method; leave the pair to age out of the 20-entry cap; or register
    later.
  - Chosen: call `expect` only after the canvas outcome, and only on the paths that prefill.
  - Evidence: the link resolves on `session:id-resolved`, and that needs a user send after the
    prefill, so registering later loses nothing.
  - Reversible.
- **Closing the refused tab.** Used `TabManagerService.closeTab` (`tab-manager.service.ts:1489`),
  not `forceCloseTab`, which is documented for pop-out session transfer. A freshly created tab is
  not dirty or streaming, so `closeTab` shows no confirmation. Reversible.
- **Already-tiled at the cap settles `true`** (canvas). Without this, a fresh mount whose hydration
  filled the grid would report a refusal for a tab that is visible. The bridge would then close a
  tiled tab. Reversible.
- **Error copy.** Bridge: "The canvas is full. Close a session and try again." Branch: "Branch
  created, but it could not open as a tile (the canvas may be full). Open it from Previous
  sessions." Both follow the brief. Reversible.

## Out-of-scope observations

- `TaskPromptBridgeService.consume` now awaits for up to 5 s, and only when the canvas does not
  drain the request at once. If a second `requestChatPrompt` arrives in that window, the
  `processing` guard returns early. The `finally` then clears the signal, and the second request
  is dropped without its `resolve`. Before this change the same race existed, but its window was
  synchronous. In Electron, `setCurrentView('chat')` mounts the canvas almost at once, so the
  window is normally tiny. A queue or a re-check of the signal after `finally` would close it.
  This was not changed.

## Fix round 1

Review: `pr777-coderabbit-fix-review.md` (REVISE 6/10). The orchestrator's own changes are kept:
the `finally` re-run in `task-prompt-bridge.service.ts:121-130`, and the spec case "runs a launch
that arrives during the canvas wait…".

### 1. Branch wait is now bounded (Serious)

**Files:lines**
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1464-1487`
  (`onBranchRequested`): `requestCanvasSession` now races a 10 s timer, and the timer is cleared
  in `.finally`. The constant is `BRANCH_OPEN_TIMEOUT_MS = 10_000` at `:1744`.

**Behavior**
- Only `false` shows the error.
- `true` or `'timeout'` shows `showActionInfo('Branch created.')`. A timeout means the canvas has
  already drained the request and created the tile.
- `_actionInFlight` always clears in `finally`.
- A late settle after the timeout does nothing: the race has already settled, and nothing else
  listens to that promise.

**Test**
- `chat-view.component.spec.ts:1379`, "bounds a hung tile load…": fake timers and a promise that
  never settles. `advanceTimersByTimeAsync(10_000)` → 'Branch created.' is shown and no error is
  shown.
- A second `onBranchRequested` for the same message then calls `forkSession` again, which proves
  the in-flight guard cleared.

### 2. Workspace-mismatch drop no longer orphans the tab or claims the canvas is full (Serious)

**Files:lines**
- `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts:84-97`: the
  workspace path sent to `requestCanvasTab` is captured.
- On `false`, if `tabManager.activeWorkspacePath !== captured`, there is no `closeTab`, no
  prefill and no link. The outcome is `{ success: false, error: WORKSPACE_CHANGED_ERROR }`, where
  the message is "The workspace changed before the session opened. It stays in the previous
  workspace." (`:12-13`).
- With the same workspace, the cap path is unchanged: `closeTab` and the canvas-full error.

**Test**
- `task-prompt-bridge.service.spec.ts:209`, "workspace changed during the wait…": the mock
  `requestCanvasTab` switches `activeWorkspacePath` from `/ws/a` to `/ws/b` and resolves `false`.
- Asserts: the request carried `/ws/a`, `closeTab`, prefill and the link were not called, and the
  outcome is the workspace-changed failure.

### 3. Neutral branch failure text (Moderate)

- `chat-view.component.ts:1483` now says "Branch created, but it did not open. Open it from
  Previous sessions." The spec at `chat-view.component.spec.ts:1374` is updated.

### Check output

```
npx jest -c libs/frontend/chat/jest.config.ts .../task-prompt-bridge.service.spec.ts .../chat-view.component.spec.ts --coverage=false --maxWorkers=2
Test Suites: 2 passed, 2 total
Tests:       98 passed, 98 total
```

98 tests = the earlier 95, plus the 2 cases added in this round, plus the orchestrator's 1. The
core and canvas specs were not touched in this round and were not re-run. Typecheck and lint
remain with the orchestrator.

### Decisions (round 1)

- **Timeout = success.** The canvas takes a session request off the queue before it awaits the
  load, so a timeout means the tile exists. Reporting an error would be wrong. Reversible.
- **Mismatch check.** The bridge compares the live `activeWorkspacePath` with the captured path.
  It does not add a reason code to the `CanvasTabRequest` resolver. This keeps the contract
  boolean, as the brief asked. Reversible.
