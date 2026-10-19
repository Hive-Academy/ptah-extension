# PR #777 CodeRabbit fix: code logic review

Verdict: REVISE
Score: 6/10
Review family: codex (implementer: Claude)

## Findings

1. **Serious — a drained branch request can leave the action locked indefinitely.** `chat-view.component.ts:1466-1485` awaits `requestCanvasSession` and clears `_actionInFlight` only in `finally`. The 5 s timer in `app-state.service.ts:1220-1229` settles `false` only while the request remains in the queue. The canvas removes it at `orchestra-canvas.component.ts:349-354` before awaiting `chatStore.switchSession` at `:361-369`. If that load never settles, the timer sees no queued request, the awaited promise remains pending, and the same message cannot be branched again. **Fix:** give the caller or the request a deadline that also settles an in-flight load, or bound the wait in `onBranchRequested`; make the late load outcome harmless.

2. **Serious — workspace mismatch reports a failure but may leave the new tab open.** The canvas explicitly settles `false` on a workspace mismatch (`orchestra-canvas.component.ts:460-464`). The bridge then calls `closeTab(tabId)` and reports a canvas-full error (`task-prompt-bridge.service.ts:81-94`). If the user changes workspace before the queued request drains, `TabManagerService.closeTab` searches only the active workspace's `_tabs()` and returns when the tab is absent (`tab-manager.service.ts:1489-1492`); the newly created tab remains in the previous workspace. The board link was not registered, but the caller receives failure with an empty orphan tab. **Fix:** close the tab in its captured workspace, or defer cleanup until that workspace is active; return a distinct workspace-change outcome. Add a bridge test using real workspace-partition behavior, since the current `closeTab` mock always succeeds (`task-prompt-bridge.service.spec.ts:38,187-207`).

3. **Moderate — branch failure text can say no tile opened when one was created.** `CanvasStore.addTileFromSession` opens a tab and appends its tile before the session load (`canvas.store.ts:290-304`); the canvas reports `false` if `switchSession` rejects (`orchestra-canvas.component.ts:355-372`). The new branch path then displays “could not open as a tile” (`chat-view.component.ts:1466-1475`), although a tile can already be visible. **Fix:** distinguish tile creation from session-load failure, or remove the created tile on load failure before returning `false`; test the rejection after tile creation. The changed branch spec only mocks a Boolean return (`chat-view.component.spec.ts:1359-1376`).

## Five logic questions

1. **Silent failure:** A timed-out task launch reports success and prefills even though its queued adoption can later be refused (`task-prompt-bridge.service.ts:96-106,124-135`). That timeout policy is deliberate in this fix, but it leaves an eventual false result unobserved. The workspace-mismatch case in finding 2 also leaves a tab after reporting failure.
2. **User action:** Switching workspace while a task launch waits can cause finding 2. Branching while session loading stalls causes finding 1.
3. **Wrong-answer input:** A valid branch session whose load rejects after tile creation triggers finding 3. A tab already present at the cap is correctly recognized by the `tiles()` check (`orchestra-canvas.component.ts:470-475`).
4. **Dependency failure:** The bridge's 5 s race resets `processing` and settles its caller when canvas adoption never responds (`task-prompt-bridge.service.ts:112-137`); the branch's in-flight session load lacks that bound. A synchronous canvas-drain exception after `takeCanvasTabRequests()` would also strand its promises because no `finally` settles the remaining requests (`orchestra-canvas.component.ts:456-476`).
5. **Unspecified requirement:** Define whether a timed-out task adoption that later fails should revoke success or present a recoverable tab, and define cleanup of tabs in a workspace that is no longer active.

## Coverage and decisions

- The new tests exercise settle-once resolution (`app-state.service.spec.ts:1800-1813`), cap refusal and already-tiled resolution (`orchestra-canvas.component.spec.ts:464-508`), timeout and one deferred replacement request (`task-prompt-bridge.service.spec.ts:187-252`), and the branch Boolean responses (`chat-view.component.spec.ts:1341-1376`). They do not exercise the cross-workspace close or a hung/rejected branch load.
- The bridge's explicit rerun is safe for the one pending request it observes: `processing` is reset before `consume(next)`, and that request later clears itself by identity (`task-prompt-bridge.service.ts:112-120`). `AppStateManager.requestCanvasTab` guards its resolver against repeat calls (`app-state.service.ts:1322-1338`). The three other production callers ignore the returned promise and keep their prior fire-and-forget behavior (`workflow-tab-launcher.service.ts:45`, `agent-session-adoption.service.ts:363`, `harness-builder-view.component.ts:436`).
- **Decision:** Treat workspace mismatch as a separate failure from capacity. Options were to keep the current generic error, distinguish it, or retry in the original workspace. The canvas has an explicit mismatch branch (`orchestra-canvas.component.ts:462-464`) and closing the tab is workspace scoped (`tab-manager.service.ts:1489-1492`); distinct handling is reversible.
- I reviewed the working-tree diff excluding `.gitignore`, the changed methods and specs, their queue/tab/link/prefill dependencies, the task notes, and repository instructions. The orchestrator reports scoped typecheck, test and lint passes. `ptah_get_diagnostics` was unavailable because its TypeScript check exceeded 45 s; no build or test was rerun in this read-only review.

The score is below the sound 7–8 band because two user-visible failure paths remain. It is above the 3–4 band because the normal adoption, cap refusal, deduplication, single deferred rerun, and caller compatibility are supported by the cited code and tests.
