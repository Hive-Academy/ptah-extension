## Fix report — `TASK_2026_592_a44d`, MOD-3 and MIN-2

Source: code-logic-review.md (cross-side review), MOD-3 and MIN-2. Base head: c01099880. Nothing was committed or staged. I did not touch the webview build, Playwright, `libs/frontend/webview-e2e-harness`, `.ptah/specs/.../e2e-tmp/` or `test-results/`.

### 1. MOD-3: backend trace (read only). Result: a tab id resolves the live record.

Paths are under `D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session\libs\`.

1. **Tab id format.**
   - The frontend creates tab ids with `TabId.create()` (`frontend\chat-state\src\lib\tab-manager.service.ts:2735-2737`).
   - That is `uuidv4()` (`shared\src\lib\types\branded.types.ts:189-195`).
2. **RPC schema.**
   - `chat:abort` is wired at `backend\rpc-handlers\src\lib\handlers\chat-rpc.handlers.ts:274-280`; it calls `ChatAbortParamsSchema.parse(params)`, then `session.abortSession(params)`.
   - The schema (`backend\rpc-handlers\src\lib\handlers\chat-rpc.schema.ts:103-107`) is `sessionId: uuidString('sessionId')`, a UUID v4 regex check (`:42-47`).
   - The tab id is UUID v4, so it is **not rejected**.
3. **Live record registered under the tab id.**
   - `chat:start` calls `sdkAdapter.startChatSession({ tabId, ... })` (`backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts:555-556`).
   - The adapter runs `sessionLifecycle.executeQuery({ sessionId: trackingId = tabId, sessionConfig })` (`backend\agent-sdk\src\lib\sdk-agent-adapter.ts:693, 735-737`).
   - The executor registers `registerKey = sessionConfig?.tabId ?? sessionId`, which is the tab id in both cases (`backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.ts:215-219`).
   - `SessionRegistry.register` always fills `byTabId` (`session-registry.service.ts:226-253`). The real id is added later to `bySessionId` by `bindRealSessionId` (`:331-337`).
4. **Abort path.**
   - `abortSession` (`chat-session.service.ts:966-1010`) first calls `ptahCli.handleAbort(params)`. That looks up `ptahCliSessions.get(sessionId)`. Ptah CLI sessions are also stored under the tab id (`backend\rpc-handlers\src\lib\chat\ptah-cli\chat-ptah-cli.service.ts:182`), so a CLI-backed turn 1 ends there too (`:278-298`).
   - Then `hadLiveRecord = sdkAdapter.isSessionActive(sessionId)`, which is `sessionLifecycle.find(id) !== undefined` (`sdk-agent-adapter.ts:1061-1063`).
   - Then `sdkAdapter.interruptSession(sessionId)` → `sessionLifecycle.endSession` (`sdk-agent-adapter.ts:1337-1343`, `session-lifecycle-manager.ts:484-486`) → `SessionControl.endSession`. That calls `registry.find(sessionId)`, ends the record found, and returns `'already-ended'` if none is found (`session-control.service.ts:160-171`).
   - `SessionRegistry.find(idOrTabId)` = `byTabId.get(id) ?? bySessionId.get(id)` (`session-registry.service.ts:346-348`).
   - **So the tab id resolves the record before and after the real id is bound.**
5. **Batch 4 guard.**
   - `isSessionActive` uses the same `find()`, so `hadLiveRecord` is true for a live turn-1 record, and `saveResumeState(tabId, …)` runs.
   - No session metadata exists under a tab id, so the store logs "Cannot save resume state for missing session" and returns without writing (`backend\agent-sdk\src\lib\session-metadata-store.ts:594-601`). That is harmless, and no durable list is overwritten.
   - `getResumableBySession(tabId)` returns `[]`, because subagent records carry the real parent id (`backend\vscode-core\src\services\subagent-registry.service.ts:508-511`).

**Frontend change**
- File: `frontend\chat\src\lib\services\message-sender.service.ts`, in `wireAbortDispatch`.
- `const sessionId = tab?.claudeSessionId ?? (tabId as SessionId);` replaces the early return when no session id is bound, with a comment citing the backend registration.
- The Batch 2 ender is unaffected: on a turn-1 close the event has `sessionId: null` and `streamAbortDispatched: true`, so it skips. There is still exactly one `chat:abort` in total.

**Specs**
- File: `frontend\chat\src\lib\services\message-sender.service.spec.ts`, new `describe('abort listener (tab close)')`.
- A turn-1 close (null `claudeSessionId`) sends exactly one `chat:abort` with `{ sessionId: <tabId> }`.
- With a bound session id, it still sends exactly one, carrying the session id.

**Residual risks (not fixed; noted)**
- **Close before the backend registers the record.** The webview awaits `chat:start` while the backend is still inside `startChatSession`, before `register()`. A close then gets `'already-ended'`, and the process that starts afterwards is not ended. The window is small. Closing it would need the backend to remember aborted tab ids, which is a backend change and outside this step.
- **Subagent resumability on turn 1.** A turn-1 abort does not persist resumable subagents, because there is no metadata keyed by tab id. This matches what a mid-stream close of a first turn could ever persist.
- **Re-arming during turn 1.** `createAbortController` aborts an existing live controller when it re-arms. That now also sends `chat:abort` with the tab id during turn 1, where it previously sent nothing. Before this change it already sent `chat:abort` once a session id was bound, and the queue-flush path avoids re-arming on purpose (`message-sender.service.spec.ts` `continueExistingSessionForQueueFlush`). So turn 1 now behaves the same as later turns.

### 2. MIN-2: the folder-removal confirm counts only sessions that will be aborted

- File: `frontend\core\src\lib\services\electron-layout.service.ts`, `removeFolder`.
- It now computes `openElsewhere = sessionIdsOpenIn(remaining folders)` before the confirm, the same shared rule as before, and `toAbort = streaming ids not open elsewhere`.
- The confirm is shown only when `toAbort.length > 0`, and its count and wording use `toAbort.length`. The streaming abort sends `toAbort` through `dispatchSessionAbort`.
- The idle path is unchanged: shared ids are still skipped, and streaming ids are passed as already handled.

Specs in `frontend\core\src\lib\services\electron-layout.service.spec.ts`:
- The existing shared or only-B test now also asserts that the confirm message says "has 1 active streaming session.".
- New: when every streaming session is open in a workspace that stays, there is no confirm and no `chat:abort`, and the removal completes.

### Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session\libs\frontend\chat\src\lib\services\message-sender.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session\libs\frontend\chat\src\lib\services\message-sender.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session\libs\frontend\core\src\lib\services\electron-layout.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session\libs\frontend\core\src\lib\services\electron-layout.service.spec.ts`

### Verify

The nx typecheck and lint pass for both projects. That run happened after all edits and before the nx graph broke:

```
npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core
> nx run @ptah-extension/core:lint        (0 errors, 13 warnings)
> nx run @ptah-extension/core:typecheck
> nx run @ptah-extension/chat:lint        (0 errors, 31 warnings)
> nx run @ptah-extension/chat:typecheck
 NX   Successfully ran targets typecheck, lint for 2 projects
```

Running eslint on the changed files alone shows 2 pre-existing warnings, at `electron-layout.service.ts:314-315` (non-null assertions). None are on changed lines.

**nx test is blocked.** Every `nx run-many` now fails with `NX Failed to process project graph`. `nx show projects` names the cause: "The projects in the following directories have no name provided: .ptah/specs/TASK_2026_592_a44d/e2e-tmp". That is an untracked Playwright scratch folder from the visual review. As team-leader instructed, I left it alone and ran jest directly from the workspace root, the same as the nx jest executor does. Several chat specs read repo-root-relative paths, so running jest from inside the lib folder makes 3 of them fail with ENOENT for that reason alone.

```
npx jest -c libs/frontend/core/jest.config.ts --maxWorkers=2
Test Suites: 33 passed, 33 total
Tests:       972 passed, 972 total

npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2
Test Suites: 110 passed, 110 total
Tests:       2 skipped, 1694 passed, 1696 total
```

The new tests account for the increase: +1 in core, +2 in chat.

**tsc, as team-leader requested**

- `npx tsc -p libs/frontend/core/tsconfig.lib.json --noEmit`: no errors.
- `npx tsc -p libs/frontend/chat/tsconfig.lib.json --noEmit`: no errors.

The repo's `typecheck` target is `ngc --noEmit --project <lib>/tsconfig.lib.json` (`libs/frontend/core/project.json:20-24`), so these runs match the gate.

`tsc -p <lib>/tsconfig.spec.json` is not a repo gate. It reports 99 errors in core and 269 in chat, and they are in existing code throughout:
- `libs/shared/.../capability-id-codec.ts` BigInt target errors;
- branded `TabId`/`SessionId` string literals across `message-sender.service.spec.ts`;
- `as never` private access across `electron-layout.service.spec.ts`;
- and similar.

The new spec lines use the same literal patterns as their neighbours.
