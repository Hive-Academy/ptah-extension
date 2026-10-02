# Test Report - TASK_2026_592_a44d

## Item 1 verdict: REAL (small, edge-case regression from 573f0fa54; plus a pre-existing sibling)

Trace. `wireAbortDispatch` is called from exactly two places: `startNewConversation` (message-sender.service.ts:412) and `continueConversation` (:491). Every caller of `createAbortController` goes through those (the queue flush uses `getAbortSignal` and never creates one). `createAbortController` aborts a still-live controller (tab-manager.service.ts:2618-2621), which fires the OLD listener. Since 573f0fa54 that listener falls back to the tab id, so a replaced controller now sends `chat:abort {sessionId: tabId}`.

Which callers can reach `createAbortController` while a controller is live:
- Normal second send / queued message / steer / retry / regenerate during turn 1: NOT reachable. All go through `sendOrQueueMessage`, which queues when the tab is busy (`markTabStreaming` runs before the RPC); the queue flush reuses the signal. Steer goes through the same dispatch path.
- REAL path A: `continueConversation` wires a controller, then `session:validate` says the file is gone, `detachSessionAndMarkLoaded` clears the session id, and `startNewConversation` calls `createAbortController` again. The old listener now fires `chat:abort {tabId}` (before 573f0fa54 it was a no-op because the tab had no session id). That abort races the new `chat:start`, which registers under the same tab id. The new turn can be ended.
- REAL path B (pre-existing, same cause): double send while the first `continueConversation` is still awaiting `session:validate` (status not yet `resuming`, so the busy check passes). The second send replaces the controller, and the stale listener sends `chat:abort {realSessionId}`, ending the live turn. Turn 1 can hit the same window via the tab-id fallback.

Fix applied (smallest, keeps the MOD-3 benefit): `createAbortController` now aborts a replaced controller with reason `ABORT_REASON_SUPERSEDED` (exported from chat-state); the `wireAbortDispatch` listener returns early when `signal.reason` is that value. `closeTab`/`abortStreamingForTab` abort with no reason, so a turn-1 close still sends `chat:abort {tabId}`. The in-flight RPC is still cancelled by the signal.
- `libs/frontend/chat-state/src/lib/tab-manager.service.ts` (constant + `abort(ABORT_REASON_SUPERSEDED)` in `createAbortController`)
- `libs/frontend/chat-state/src/index.ts` (export)
- `libs/frontend/chat/src/lib/services/message-sender.service.ts` (import + guard at the top of the listener)

Proof the tests catch it: with the guard line temporarily removed, 3 of the 12 new integration tests fail (turn-1 replace, later-turn replace, continue->start fallback); guard restored afterwards.

Files are changed but NOT committed (team-leader commits).

## Tests added

- `D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session\libs\frontend\chat\src\lib\services\tab-close-session-end.integration.spec.ts` (new, 12 tests). Real TabManagerService, TabWorkspacePartitionService, MessageSenderService, ClosedTabSessionEnderService; mocked ClaudeRpcService, ConfirmationDialogService and the unrelated sender collaborators.
  - Replacement does not abort the new turn: turn 1 same-tab second send; later-turn second send; continue falling back to start (session file gone).
  - Close paths: idle tab = exactly 1 abort with session id; streaming tab = 1 with session id (listener only, ender skips); turn-1 tab = 1 with tab id; background `awaiting-background` and `sleeping`: cancel = 0, confirm = 1; workspace switch = 0; forceCloseTab (streaming) = 0; resetTabToFresh (idle) = 0; session shared by two tabs = 0 on the first close, 1 on the last.
- `libs\frontend\chat\src\lib\services\message-sender.service.spec.ts`: added a unit test that a superseded abort sends no `chat:abort`.

## Execution

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/core @ptah-extension/canvas`: success for all 4 projects.
- `npx nx run-many -t test -p chat chat-state core canvas -- --maxWorkers=2`: success for all 4 projects (core served from the Nx cache, unchanged). Per-test counts are not printed by `run-many`; the new integration file alone, run directly, gave 12 passed / 0 failed.
- `npx nx run-many -t test -p @ptah-extension/rpc-handlers -- --maxWorkers=2 --testPathPatterns=chat-session`: success.
- Not executed: nothing skipped.

## Acceptance criteria (context.md)

| Requirement | Evidence | Status |
|---|---|---|
| Workspace switching never ends sessions | integration "workspace switch sends no chat:abort" (real partition) | Proven (unit/integration) |
| Closing a tab ends its session: idle / streaming / turn-1 / background | integration close-path tests, exactly one `chat:abort` each | Proven at mocked-RPC level |
| Shared session in another tab is kept | integration shared-session test | Proven |
| pop-out (forceCloseTab) and /clear (idle) do not end sessions | integration | Proven (a streaming `/clear` still aborts via the listener, pre-existing, not changed) |
| No regression from the tab-id fallback | integration replacement tests + unit test + fix | Proven after the fix |
| claude.exe actually exits on close | manual check below | NOT RUN |

## Manual claude.exe check (from visual-review.md Part B) - NOT RUN

Use a throwaway profile and a separate workspace; never touch the real Ptah.exe.
1. Launch a dev instance with an isolated profile (`$env:PTAH_SHOWCASE_USER_DATA_DIR='C:\Temp\ptah-592-profile'`, `--user-data-dir=C:\Temp\ptah-592-profile`). Note its PID.
2. List its children: `Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object ParentProcessId -eq <DEV_PID> | Select ProcessId,ParentProcessId,CreationDate`
3. In tab A send "hi", wait for idle, note the PID, close tab A. Within ~10 s that PID must be gone.
4. Open two workspace folders with one idle session each; record PIDs; switch several times; both PIDs must remain.
5. Close a sleeping/awaiting-background tab: the "Close Tab?" dialog must show; confirming ends its claude.exe within ~10 s.
6. Also close a tab during its first turn (while streaming) and confirm the process exits.
7. Stop only the dev instance (`Stop-Process -Id <DEV_PID>`).

## Risks

- The backend registration race for a turn-1 close (abort arriving before the record is registered) is untested here and still open (logged as accepted in context.md).
- The path-A abort race with the backend registry is only reasoned from the code; the tests assert the frontend sends nothing.
