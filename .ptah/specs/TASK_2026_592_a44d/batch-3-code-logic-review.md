# Code Logic Review — TASK_2026_592_a44d, Batch 3

Disclosure: same-side review (CLI lanes busy); a cross-side whole-diff review follows. Read-only. I did not re-run the test suites; I rely on the report's pass counts and on reading the tests.

## Summary

| Metric              | Value                                            |
| ------------------- | ------------------------------------------------ |
| Overall score       | 7/10                                             |
| Assessment          | APPROVED (with one Serious follow-up, see S1)    |
| Blocking issues     | 0                                                |
| Serious issues      | 1                                                |
| Moderate issues     | 3                                                |
| Failure modes found | 4                                                |

## Checks 1-9

1. **switchWorkspace never sends chat:abort. PASS.** `electron-layout.service.ts` `switchWorkspace` (l.445+) is untouched in the diff and calls no RPC abort. Proven by layout test "switchWorkspace sends no chat:abort and reads no session ids" (spec ~l.1980: `callsOf('chat:abort')` length 0, `getSessionIds` and `removeWorkspaceState` not called). The coordinator test "never calls closeTab or forceCloseTab on a switch and back" covers the chat side. `TabWorkspacePartitionService.switchWorkspace` (l.169-200) only parks and restores tab arrays and emits no close event. The Batch 2 ender hangs off `closedTab`, which is emitted only at tab-manager l.889/969/1055. I did not verify that those are the explicit close paths, but the switch path does not reach them.
2. **Idle aborts only after the removal succeeded. PASS.** The helper call is at `electron-layout.service.ts:406`, after the `isSuccess()` check (l.390-396) and the catch that returns false (l.397-403). The cancel path returns at l.371-373. Tests: idle-only (call order), cancel, backend rejection, and RPC throw, each with zero `chat:abort`.
3. **Ids captured before the tabs are destroyed. PASS.** The helper at l.406 runs before `cleanupWorkspaceState` at l.419, and test "reads the session ids before cleanup destroys the tabs" makes the mock `removeWorkspaceState` delete the tabs. It would fail if the read moved after cleanup. For a real active workspace, `TabManagerService.getWorkspaceTabs` (tab-manager.service.ts:725-730) passes the live `_tabs()` signal, so live tabs are read. Background partitions come from `_workspaceTabSets`. Parked tabs and canvas tiles are ordinary `TabState` entries (`canvas.store.ts:192` uses `openSessionTab`), so they are covered. Gap: see M1.
4. **No id aborted twice. PASS.** The skip set is seeded with the streaming ids (l.628-ish), each sent id is added, and `getSessionIds` de-duplicates. Test "mixed streaming + idle sends each exactly once". A repeated `removeFolder` call is a minor case (M3).
5. **Session shared with a staying workspace: confirmed for idle, NOT for streaming. See S1.** The new idle path skips ids found in any remaining folder's `getSessionIds` (helper, `for folder of remainingFolders`), proven by test "keeps a session that is also open in a workspace that stays". The pre-existing streaming loop (l.374-383) still aborts such a session. The helper seeds `skip` with `alreadyAborted`, so it does not protect the streaming ids.
6. **Active vs background removal, last workspace, path normalisation. PASS with a caveat.**
   - Active: the live-signal fast path applies, because `getWorkspaceTabs` is called with the active path while it is still active, before cleanup.
   - Background: reads the map.
   - Last workspace: `remainingFolders` is `[]`, test "removing the only workspace still ends its sessions".
   - Normalisation: not an issue. `removedFolder.path` and `folder.path` come from the same folder list that `coordinateWorkspaceSwitch` feeds into `partition.switchWorkspace`, so the map keys are the same strings. No case or trailing-slash comparison is introduced. The only equality check is `workspacePath === _activeWorkspacePath()` (partition l.215), which uses those same strings.
7. **RPC rejection never throws out of removeFolder. PASS.** The abort is not awaited and has `.catch`. A synchronous throw from `getSessionIds` or `rpc.call` lands in the helper's try/catch. Test "a failing idle chat:abort is logged and never blocks the removal". Caveat: a resolved-but-failed `RpcResult` (isSuccess false) from `chat:abort` is not logged, so it is silent (M2).
8. **Contract change. PASS.** Grep of `*.ts` across the worktree for `IWorkspaceCoordinator|getStreamingSessionIds` finds 6 files: the token, the chat service, the layout service, its spec (mock updated), the chat spec, and `core/index.ts`. No other implementer or mock exists in libs/ or apps/.
9. **Tests fail without the fix. PASS.** The idle, shared, only-workspace and abort-failure tests expect aborts that the old code never sent. The coordinator tests call a missing method. The one weak test is the switch test, which passes both before and after the change. That is correct for a guard against regression.

## Five logic questions

1. **Silent failure.** A resolved-but-failed `chat:abort` result is ignored (`electron-layout.service.ts` helper, `.catch` sees only throws). The workspace disappears while the backend session may live on. It is logged nowhere.
2. **Unexpected user action.** Removing workspace B while the same session is open in A: idle copy survives (good), streaming copy is killed (S1). A double-click on remove can issue two removals (M3).
3. **Wrong-answer input.** A never-visited workspace has no in-memory partition, so `getSessionIds` returns `[]` even though its persisted tabs hold session ids (M1).
4. **Dependency failure.** The backend rejecting or throwing on `workspace:removeFolder` leaves everything intact (tests). An IPC failure on the abort leaves an orphaned session, logged only on throw.
5. **Missing.** There is no test for a streaming session also open in a staying workspace, and no handling of the `_sessionToWorkspace` index (M2b below).

## Failure modes

### Streaming session shared with a staying workspace is ended (S1)
- Trigger: session X is open in workspace A (staying) and B (removed), and B's tab for X is streaming.
- Symptom: the confirm dialog appears and X is aborted, although A still shows it. This contradicts the requirement that a session still shown elsewhere is not ended.
- Evidence: `electron-layout.service.ts:352-383`. The guard exists only in the helper.
- Current handling: pre-existing loop, untouched.
- Recommendation: see S1 below.

### Never-visited workspace: persisted sessions not ended (M1)
- Trigger: a workspace is registered but not switched to in this webview run. `_workspaceTabSets` is filled lazily from storage on first switch (`tab-workspace-partition.service.ts:182-200`).
- Symptom: `getSessionIds` returns `[]`, no abort is sent, then `removeWorkspaceState` deletes the persisted tab data. Any backend session for it is orphaned.
- Evidence: partition l.182-200 and l.214-218.
- Current handling: none, and the report notes the limit. This is plausibly acceptable because a window that never loaded the tabs has no live stream, but sessions can live in the backend across a webview reload.
- Recommendation: accept and document, or read persisted ids via the partition's storage loader.

### Resolved-failure abort result silent (M2)
- Trigger: `chat:abort` returns `isSuccess() === false`.
- Evidence: the helper's `.catch` only. Compare Batch 2's ender, which logs failure at `closed-tab-session-ender.service.ts:62-86`.
- Recommendation: inspect the result and `console.warn`.

### Repeated removal (M3)
- Trigger: a double-click while `workspace:removeFolder` is in flight. Both calls capture the same `folders`/`index`.
- Symptom: possible duplicate `chat:abort` (benign, idempotent) and index-shift hazards. The index-shift hazard is pre-existing.

## Blocking issues

None.

## Serious issues

### S1. Streaming session shared with a staying workspace is still aborted
- File: `libs/frontend/core/src/lib/services/electron-layout.service.ts:352-383`.
- Impact: contradicts "a session still shown elsewhere is not ended". It is rare, because `openSessionTab` de-duplicates within a workspace, so it needs the same session open in two workspaces.
- Whether it must be fixed now: the requirement was written as a user rule (switch never ends sessions; removal ends only that workspace's sessions). It is a narrow corner, and pre-existing behaviour for streaming sessions. I recommend fixing it now because the fix is about 8 lines and the new helper already encodes the rule, so the two paths would otherwise disagree. It does not block approval.
- Smallest fix: before the streaming block, compute `sharedElsewhere` (the union of `getSessionIds(folder.path)` for `folders` other than `index`). Then derive `abortIds = streamingSessionIds.filter(id => !sharedElsewhere.has(id))`. Use `abortIds` for the abort loop only, keep `streamingSessionIds` for the confirm count if a warning is still wanted (better: use `abortIds` for the count too), and pass `streamingSessionIds` into the helper unchanged so the skip logic stays intact. Add a test with a streaming id also returned for the staying workspace expecting no abort.

## Moderate and minor issues

- M1, M2, M3 as above.
- M4 (secondary, out of scope): `partition.removeWorkspaceState` (l.376-380) deletes `_sessionToWorkspace` entries for every session of the removed workspace, including a session also held by a staying workspace, so stream routing for the staying copy can lose its reverse index until `findTab`'s scan repairs it (l.257-273). It looks self-repairing, so low risk.
- Minor: the JSDoc "Clean up workspace state via the coordinator." is orphaned above the new helper (about `electron-layout.service.ts:610-613`) and no longer sits on `cleanupWorkspaceState`. Route to the style reviewer.
- Minor: the second `getSessionIds` read (the guard) iterates every remaining folder, so it is O(W*T), which is fine at this scale.

## Data flow

1. `removeFolder(index)`: validate index. OK.
2. Read streaming ids and confirm. OK; cancel returns false before any effect.
3. Abort streaming ids, awaited and settled. OK; a resolved-failed result is silent (pre-existing).
4. `workspace:removeFolder` RPC. OK; failure or throw returns false.
5. Idle helper: read `getSessionIds` (live, tabs still exist), skip set, fire-and-forget abort. OK; a shared streaming id is not protected (S1) and unvisited workspaces are invisible (M1).
6. Update the folder list, then `cleanupWorkspaceState`, then switch or clear. OK.

## Requirements fulfilment

| Requirement                                          | Status   | Gap                                      |
| ---------------------------------------------------- | -------- | ---------------------------------------- |
| Switch never ends sessions                           | COMPLETE | None                                     |
| Removal ends all sessions of the removed workspace   | PARTIAL  | Unvisited workspaces (M1)                |
| Only after the backend accepted removal              | COMPLETE | None                                     |
| A session still shown elsewhere is not ended         | PARTIAL  | Streaming path (S1)                      |
| Cancel or rejection ends nothing                     | COMPLETE | None                                     |
| Removal UI always completes                          | COMPLETE | None                                     |

Implicit requirements not addressed: logging of a failed abort result (M2).

## Edge cases

| Case                         | Handled | How                              | Concern                     |
| ---------------------------- | ------- | -------------------------------- | --------------------------- |
| Active workspace removed     | YES     | Live signal read before cleanup  | None                        |
| Background workspace removed | YES     | Map read                         | None                        |
| Last workspace               | YES     | Test                             | None                        |
| Duplicate ids                | YES     | Set + skip set                   | None                        |
| Shared idle session          | YES     | Remaining-folder guard           | None                        |
| Shared streaming session     | NO      | Pre-existing loop                | S1                          |
| Never-visited workspace      | NO      | Nothing in memory                | M1                          |
| Abort throws or rejects      | YES     | try/catch and `.catch`           | Result failure silent (M2)  |
| Path case/trailing slash     | YES     | Same source strings              | None                        |

## Verdict

- Recommendation: APPROVE, with S1 fixed in this batch or tracked.
- Confidence: MEDIUM-HIGH. I did not run the suites or the real app.
- Top risk: a streaming session shared with a staying workspace is still aborted by the old loop.
- A robust implementation would add: the S1 filter plus a test, a warning on a failed abort result, and a documented decision for unvisited workspaces.
