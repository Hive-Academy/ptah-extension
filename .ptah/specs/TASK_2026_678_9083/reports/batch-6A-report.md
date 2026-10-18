# Batch 6A report

## Task 6A.1 — release lock on confirmed close

- Added `CommandCenterSendLockService.clearForRoot(tabId)` at `libs/frontend/chat-state/src/lib/command-center-send-lock.service.ts:26`. It clears only a matching root, including its SDK ID lock. A later token-gated owner `release` sees no state and does nothing.
- `TabManagerService.closeTab` rechecks that the tab remains in the active list after confirmation (`tab-manager.service.ts:1370-1372`), removes it (`:1402`), then clears the lock for a marked tab (`:1403-1405`). A cancelled close or a workspace switch that parks the tab returns before that hook. Another root's lock is unchanged.
- Coverage: `command-center-send-lock.service.spec.ts:30-42` checks non-root, root, SDK ID, and late owner release; `tab-manager.command-center.spec.ts:64-103` checks cancelled and confirmed close, another root, and workspace switch during confirmation.

## Task 6A.2 — surface record write failures

- Added readonly `TabManagerService.commandCenterRecordWriteFailure` at `tab-manager.service.ts:270-273`. Shape: `{ workspacePath: string; record: 'activeTabId' | 'lastSession' } | null`. The record strings match the stored record fields in `command-center-records.ts`.
- A small result hook at `tab-manager.service.ts:1007-1020` warns with workspace and record kind on `false`, without raw exception text, and clears the signal after any successful Command Center record write. Create (`:1002-1003`), close (`:1378-1379`), and SDK bind (`:1964-1967`) use it. Each lifecycle operation continues after a failed write. Unmarked tabs do not call it.
- Coverage: `tab-manager.command-center.spec.ts:105-160` makes storage writes throw on bind, create, and close; checks the warning, signal, continuing lifecycle, clearing on later success, and an unmarked tab leaving an existing failure untouched.

## Verification and limits

- Scoped `ptah_get_diagnostics` after edits: no diagnostics in the four changed TypeScript files. It reported 20 errors in sibling files outside this batch's ownership; those files were not changed.
- Nx and Jest were not run in this lane under the parallel-mode instruction. The orchestrator owns the one-project scoped check and the existing `tab-manager.*.spec.ts` suites.

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-send-lock.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-send-lock.service.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/tab-manager.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/tab-manager.command-center.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-6A-report.md`

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Clear the lock directly after confirmed removal. | Release by owner token; wait for page teardown; clear by root ID. | `release` requires the owner token, while `closeTab` has the root ID and can return when the tab was parked. Review L3 and plan line 29 require a real release path. | Yes |
| Expose one signal with the stored field names and clear it on any successful marked write. | Per-operation booleans; one last-failure signal. | The page needs a safe notice; `CommandCenterRecordsService` returns booleans for `activeTabId` and `lastSession` writes. Review L4 requires lifecycle continuation. | Yes |
