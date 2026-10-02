## Frontend implementation — `TASK_2026_592_a44d`, batch 3

**Tasks completed**: 3.1, 3.2 and 3.3. I did not edit batches.md and changed no file outside the five listed. The only other `IWorkspaceCoordinator` implementer is the real service, provided in `apps/ptah-extension-webview/src/app/app.config.ts`, which needed no change. The only coordinator mock is in `electron-layout.service.spec.ts`, which is one of the listed files.

**Files** (all paths are under `D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session`):

- MODIFIED `libs\frontend\core\src\lib\tokens\workspace-coordinator.token.ts` — `IWorkspaceCoordinator.getSessionIds(workspacePath): SessionId[]`, with a doc comment. `getStreamingSessionIds` is kept and still drives the confirm.
- MODIFIED `libs\frontend\chat\src\lib\services\workspace-coordinator.service.ts` — `getSessionIds` returns every non-null `claudeSessionId` of `tabManager.getWorkspaceTabs(path)`, de-duplicated with a Set in insertion order.
- MODIFIED `libs\frontend\core\src\lib\services\electron-layout.service.ts`. The `removeFolder` doc comment is updated, and:
  - the streaming confirm and the streaming abort loop are unchanged; `streamingSessionIds` is only lifted to function scope so later steps can read it;
  - after `workspace:removeFolder` succeeds, and before the folder list update and `cleanupWorkspaceState`, it calls the new private `abortIdleSessionsOfRemovedFolder(removedPath, streamingSessionIds, remainingFolders)`;
  - that helper reads `coordinator.getSessionIds(removedPath)` at that moment, while the tabs still exist;
  - it skips ids already aborted as streaming, and ids returned by `getSessionIds` for any folder that stays open;
  - it sends `chat:abort` without awaiting it, with `.catch` logging `console.error`, matching the existing loop;
  - its whole body sits in try/catch, so a failure there cannot stop the local removal from completing.

  `switchWorkspace` is unchanged.
- MODIFIED `libs\frontend\core\src\lib\services\electron-layout.service.spec.ts` — `getSessionIds` added to the `buildCoordinator()` mock (default `[]`), plus a new `describe('ends the sessions of the removed workspace')` with 10 tests inside the removeFolder describe.
- MODIFIED `libs\frontend\chat\src\lib\services\workspace-coordinator.service.spec.ts` — 2 tests for `getSessionIds`, 1 test for switching with no closes, and a header coverage line.

**Stack observed**:
- Angular signals services. `ElectronLayoutService` lives in core and depends only on the `WORKSPACE_COORDINATOR` token (`workspace-coordinator.token.ts`: core defines the interface, chat implements it).
- Jest specs with TestBed mocks, following the existing removeFolder describe (`setup`, `rpcThatRemoves`).

**Design fidelity**: no UI change. The confirm dialog text and behaviour are unchanged; it still appears only when tabs are streaming, per decision (a).

### Task evidence

- **3.1**: coordinator spec `getSessionIds (TASK_2026_592)`.
  - An unknown workspace returns `[]`.
  - A mix of streaming, loaded, fresh (null id), sleeping and a duplicate id returns `['sess-A','sess-B','sess-C']`.
- **3.2 / 3.3**: layout spec `ends the sessions of the removed workspace`:
  1. Idle-only removal sends one `chat:abort` per id, each after `workspace:removeFolder` in call order, and shows no confirm.
  2. Ids are read before cleanup destroys the tabs: the mock's `removeWorkspaceState` deletes the tabs, and `s-1` is still aborted.
  3. Mixed streaming and idle sends each id exactly once. The streaming abort comes before the removal call and the idle abort after it.
  4. A cancelled confirm sends no `chat:abort` and no `workspace:removeFolder`.
  5. A backend rejection sends no idle abort and no cleanup.
  6. A removal RPC that throws sends no idle abort.
  7. Removing the only workspace still ends its session, and `clearWorkspace` is called.
  8. A session also open in a workspace that stays open is kept; only the unshared id is aborted.
  9. A failing idle `chat:abort` is logged and the removal still completes: folders become `['/b']` and cleanup runs.
  10. `switchWorkspace(1)` then `switchWorkspace(0)` sends no `chat:abort`, never calls `getSessionIds`, and never calls `removeWorkspaceState`.
- **Coordinator switch**: `switchWorkspace never closes tabs` switches a → b → a with `closeTab` and `forceCloseTab` spies on the TabManager mock. Neither spy and `removeWorkspaceState` are ever called. PROVES (together with test 10): a workspace switch sends no chat:abort.

These tests fail on the pre-batch code:
- tests 1, 2, 3, 7, 8 and 9 expect idle aborts that the old code never sent;
- the coordinator `getSessionIds` tests call a method that did not exist (typecheck fails).

Following the instruction this time, I did not run a mutation check by editing production files.

### Edge cases and risks

| Edge case / risk | Handling |
| --- | --- |
| Capture before `cleanupWorkspaceState` destroys tabs | Ids are read inside the helper, called before the folder list update and before cleanup. Test 2 proves the order. They are read after the RPC rather than before the confirm, so a session id bound while the dialog or RPC was pending is still included. |
| Idle aborts only after `workspace:removeFolder` succeeds | The helper is called only after `result.isSuccess()`. Tests 1, 3 (order), 5 and 6 (rejection or throw: none). |
| Never abort an id twice | The skip set is seeded with the streaming ids; each id is added once sent; the coordinator de-duplicates. Test 3. |
| Nothing on cancel or backend rejection | Early `return false` comes before the helper. Tests 4, 5, 6. |
| `switchWorkspace` sends no chat:abort | Untouched. Layout test 10 and the coordinator switch test. |
| Session also open in another workspace that stays open | **Possible**: `TabManagerService.openSessionTab` de-duplicates within the active workspace only (`tab-manager.service.ts:769-772`, "active workspace only"), so the same session can be open in two workspaces' partitions. Handled by skipping any id that `getSessionIds` returns for a remaining folder; test 8. Only in-memory partitions count (`getWorkspaceTabs` reads `_workspaceTabSets`). A workspace never visited in this webview has no loaded tabs and so no live stream from this window. |
| Interaction with the closed-tab ender (Batch 2) | Folder removal emits no `closedTab` (`TabManagerService.removeWorkspaceState` only clears signals), so there is no double abort from the ender. |
| Interaction with the abort listener | The streaming loop calls RPC directly and does not abort TabManager's controllers, so the MessageSender listener does not fire. The idle path also skips the streaming ids. There is no double abort. |
| Abort failure blocking removal | The RPC is not awaited and has a `.catch`. A synchronous throw from the coordinator or the RPC is caught by the helper's try/catch. Test 9. |

### Verification

```
npx nx run-many -t typecheck,lint -p @ptah-extension/core @ptah-extension/chat
> nx run @ptah-extension/core:lint        (0 errors, 13 warnings)
> nx run @ptah-extension/core:typecheck
> nx run @ptah-extension/chat:lint        (0 errors, 31 warnings)
> nx run @ptah-extension/chat:typecheck
 NX   Successfully ran targets typecheck, lint for 2 projects

npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat -- --maxWorkers=2
> nx run @ptah-extension/core:test --maxWorkers=2
Test Suites: 33 passed, 33 total
Tests:       969 passed, 969 total
> nx run @ptah-extension/chat:test --maxWorkers=2
Test Suites: 110 passed, 110 total
Tests:       2 skipped, 1692 passed, 1694 total
 NX   Successfully ran target test for 2 projects
```

Linting the 5 changed files alone shows 4 warnings, all `no-non-null-assertion` on lines I did not change (`electron-layout.service.ts:314-315`, `electron-layout.service.spec.ts:677,848`). All 5 files pass the Prettier check.

**Plan deviations**:
- The ids are read after the backend success instead of before the confirm. This still meets the plan's constraint (before `cleanupWorkspaceState`) and also covers sessions bound during the dialog or RPC.
- The shared-session guard is computed in `ElectronLayoutService` from `getSessionIds` of the remaining folders. This avoids adding a second interface method.

**Out-of-scope observations**:
- The existing streaming abort loop (unchanged) also aborts a streaming session that happens to be open in another workspace's tab as well. This is pre-existing, rare, and not part of this batch.
- The streaming loop has no try/catch around a synchronous throw from `rpcService.call`. This is also pre-existing.

## Review fixes

Source: batch-3-code-logic-review.md (APPROVED 7/10). Production changes are confined to `D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session\libs\frontend\core\src\lib\services\electron-layout.service.ts`, and tests to `...\electron-layout.service.spec.ts`. I made no experiments on production files.

1. **S1: a shared streaming session was being ended.**
   - New private helper `sessionIdsOpenIn(folders)` returns the session ids shown by the tabs of the staying folders. Both removal paths now use it:
     - the streaming loop filters `streamingSessionIds` against it before sending `chat:abort` (the confirm and its count are unchanged, per decision (a));
     - the idle helper seeds its skip set from it.
   - New private `dispatchSessionAbort(sessionId)` sends every removal abort for both paths. It never rejects.
   - Test: `s-shared` streams in the removed `/b` and is open in the staying `/a`, while `s-only` streams only in `/b`. Result: exactly one `chat:abort`, for `s-only`, sent before `workspace:removeFolder`, and none for `s-shared`.
2. **M2: a failed `chat:abort` result was not logged.**
   - `dispatchSessionAbort` logs a resolved result with `isSuccess() === false` via `console.warn('[ElectronLayout] Backend did not abort session <id>:', result)`.
   - A rejected call still logs via `console.error('... Failed to abort session <id>:', error)`, so the existing test is unchanged.
   - Test: `chat:abort` resolves `RpcResult(false, ..., 'session busy')` for a streaming id and an idle id. Both are warned, and the removal still completes.
3. **Minor**: the orphaned JSDoc "Clean up workspace state via the coordinator." is back on `cleanupWorkspaceState`.
4. **M1**: no code change. The `sessionIdsOpenIn` doc says that only in-memory partitions count. A workspace never visited in this app run has none and cannot own a live process, because a process exists only for a session sent to or resumed in this run, which requires a visit.

Verify (tail):

```
npx nx run-many -t typecheck,lint -p @ptah-extension/core @ptah-extension/chat
> nx run @ptah-extension/core:lint        (0 errors, 13 warnings)
> nx run @ptah-extension/core:typecheck
> nx run @ptah-extension/chat:lint        (0 errors, 31 warnings)
> nx run @ptah-extension/chat:typecheck
 NX   Successfully ran targets typecheck, lint for 2 projects

npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat -- --maxWorkers=2
> nx run @ptah-extension/core:test --maxWorkers=2
Test Suites: 33 passed, 33 total
Tests:       971 passed, 971 total
> nx run @ptah-extension/chat:test --maxWorkers=2
Test Suites: 110 passed, 110 total
Tests:       2 skipped, 1692 passed, 1694 total
 NX   Successfully ran target test for 2 projects
```
