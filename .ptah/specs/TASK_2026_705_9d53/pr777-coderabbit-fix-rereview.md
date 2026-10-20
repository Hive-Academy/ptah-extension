# PR #777 CodeRabbit fix: round 1 code logic re-review

Verdict: REVISE
Score: 7/10
Review family: codex (implementer: Claude)

## Findings

1. **Serious — workspace mismatch still leaves the failed launch's empty tab behind.** `task-prompt-bridge.service.ts:88-96` deliberately returns failure without closing the tab when the active workspace differs from the captured one. `TabManagerService.createTab` adds a fresh tab to the active workspace (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1091-1125`), and a workspace switch parks that tab in the previous workspace (`:847-859`). The canvas drops its queued adoption on mismatch (`libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:460-464`). Thus: Start a board task in workspace A, switch to B before canvas adoption, then return to A. The caller received failure, but A still contains the unprefilled fresh tab. The new test at `task-prompt-bridge.service.spec.ts:209-239` asserts `closeTab` is *not* called; its mocked workspace path cannot verify partition cleanup. **Fix:** remove the tab from its captured workspace after a mismatch, or provide a deferred cleanup mechanism that runs when that workspace becomes active. Keep the distinct workspace-change error and skip the board link/prefill.

## Scope and evidence

- **Finding 1 closed:** `chat-view.component.ts:1471-1480` races session adoption with a 10 s timer and clears the timer on settlement; `:1493-1496` clears the action guard even on rejection. The queue's 5 s timeout resolves an undrained request as false (`libs/frontend/core/src/lib/services/app-state.service.ts:1220-1231`). A drained request creates the tile before awaiting session load (`libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:349-369`), so a later branch timeout does not claim a missing tile opened. `chat-view.component.spec.ts:1379-1403` exercises a never-settling load and retries the same message after the bound.
- **Finding 2 remains:** the changed path and test above leave an empty tab in workspace A after a failed launch. This is the same user-visible state described in the first review, though the new error now names the workspace change correctly.
- **Finding 3 closed:** `chat-view.component.ts:1481-1486` now says the branch did not open, without claiming that no tile was created. This accommodates a session-load rejection after tile creation (`libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:355-372`). `chat-view.component.spec.ts:1359-1376` verifies the new false-result message. The test still mocks the Boolean outcome, so it does not prove tile visibility after a real load rejection.

## Five logic questions

1. **Silent failure:** A workspace-mismatch failure leaves an unprefilled tab in the previous workspace (`task-prompt-bridge.service.ts:88-96`); the user sees that tab only after switching back.
2. **User action:** Starting a task in A and switching to B before adoption produces finding 1 (`task-prompt-bridge.service.ts:84-96`).
3. **Wrong-answer input:** A false adoption result after a workspace change is correctly reported as a workspace-change failure (`task-prompt-bridge.service.ts:88-96`), but the message's promise that the tab stays in the previous workspace also exposes the unresolved cleanup.
4. **Dependency failure:** A hung branch load is bounded at 10 s and releases the guard (`chat-view.component.ts:1471-1496`). A late settlement is ignored by `Promise.race`.
5. **Missing requirement:** The failed-launch contract needs to specify who removes an empty tab parked in a nonactive workspace; the new test instead codifies retaining it (`task-prompt-bridge.service.spec.ts:209-239`).

The new branch timeout test exercises real asynchronous behavior. The workspace test exercises the branch condition and message but uses only a mutable mock path, so it cannot establish that the tab is removed from the previous workspace. I reviewed the working-tree diff against HEAD and the relevant queue, canvas, tab, and spec paths. The orchestrator reports chat typecheck, test, and lint passing; I did not rerun them under this read-only brief. One serious user-visible gap keeps the score below the sound 8 band; the bounded branch path, revised message, and distinct workspace outcome lift it above the previous 6/10 review.
