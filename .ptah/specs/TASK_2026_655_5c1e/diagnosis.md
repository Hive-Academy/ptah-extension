## Root cause

`WorkspaceCoordinatorService.switchWorkspace` swaps the tab partition and active tab synchronously at `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:178`, before the retained canvas grids have necessarily updated their visibility inputs. `TabManagerService.switchWorkspace` replaces `_tabs` and `_activeTabId` at `libs/frontend/chat-state/src/lib/tab-manager.service.ts:773-785`, but does not change `_visibleTabIds` (registration methods at :2844-2859). Retained grids pass the active workspace state to tiles at `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:185-190` and `canvas-workspace-grid.component.ts:126-130`; their tile effects register and unregister at `canvas-tile.component.ts:549-563`. Thus an old workspace tile can remain registered until Angular processes the new input. The conductor also registers only in `ngOnInit` and unregisters only in `ngOnDestroy` (`libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.ts:210-239`).

Content events reach `BatchedUpdateService.scheduleUpdate` via `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:498-503`. The old `canFlush` at `batched-update.service.ts:174-179` chose *only* the visible set whenever it was nonempty. During A → B, a nonempty registration for A therefore rejected B's active main tab, while accepting A even though A's workspace was hidden. Rejected B states stayed deferred at :127-132 and :223-253. Status and other direct tab writes could still update, producing the reported partial UI. The same inversion could recur on B → A. This is a visibility selection error, not a missing Angular change detection tick: no state is published to the active tab for change detection to display.

`SURFACE_ACTIVE` comes from the chat route in `apps/ptah-extension-webview/src/app/app.config.ts:147`; it gates the whole chat surface, not workspace selection. The queued-state container check at `batched-update.service.ts:213-220` runs only after the visibility check. `updateTabInternal` publishes a new tab for a new streaming-state object (`tab-manager.service.ts:1358-1375`). Those paths do not explain this failure.

## Fix

- `libs/frontend/chat-streaming/src/lib/batched-update.service.ts:169-182`: make the active tab eligible even when a tile set exists. A registered tile is eligible only if its ID belongs to the current workspace's `tabs()` signal. The RAF and deferred queue remain unchanged. Hidden workspace tiles cannot flush from a stale registration; deferred state drains when their tab becomes active again.
- `libs/frontend/chat-streaming/src/lib/batched-update.service.spec.ts:17-23,43-75,268-299`: expose active tab, visible IDs, and current workspace tabs as controllable signals; add the A → B → A regression.

## Regression test

`libs/frontend/chat-streaming/src/lib/batched-update.service.spec.ts:268-299` starts with A, switches to B while A remains registered, and verifies on the next RAF that B's main tab and visible B tile flush while background A does not. It switches back to A, keeps B registered, and verifies A's deferred state drains on the next RAF while B stays deferred. Before the service change, the test failed: expected a call for `b`, but the only `setStreamingState` call was for `a` (suite: 1 failed; tests: 1 failed, 14 passed).

## Verification

- Before fix: `npx jest -c libs/frontend/chat-streaming/jest.config.ts libs/frontend/chat-streaming/src/lib/batched-update.service.spec.ts --coverage=false --maxWorkers=2` → 1 failed, 14 passed; expected B, received A.
- After fix: same command → 1 suite passed, 15 tests passed.
- `npx nx lint @ptah-extension/chat-streaming --parallel=1` → target passed, 0 errors, 2 warnings in unchanged files (`agent-monitor.store.ts`, `streaming-event-cascade-clean.spec.ts`). Nx Cloud reported a disabled organization after the local lint target succeeded.
- Scoped `ptah_get_diagnostics` on the two changed files → no diagnostics in requested files; the project has 131 diagnostics in sibling spec files.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Correct eligibility in the batcher | Clear all registrations on switch; change tile lifecycle; correct the flush predicate | Both a stale ID and a visible tile alongside the main chat cause the old predicate to reject the active tab. The batcher already owns the visibility rule. | Yes; one predicate change. |
| Require current workspace membership for registered tiles | Trust the registration set; check `tabs()` before flushing | Retained workspace grids can remain mounted, and conductor registration follows component lifetime. Membership blocks a stale background ID without depending on effect timing. | Yes. |

## Open risks

- The exact live source of a stale registration (retained grid timing versus a persistent conductor) was not observed in Electron. The regression reproduces the failing gate inputs and verifies both cases the fix must handle.
- The batcher retains its existing no-active-tab/no-visible-tile fallback behavior. This change does not alter that pre-existing case.

## Revision 1

- Changed `libs/frontend/chat-streaming/src/lib/batched-update.visibility.spec.ts:11,114-118`: the TabManager mock now exposes a `tabs` signal containing the active tab and both canvas tile IDs that the spec registers as visible. This supplies the current-workspace membership used by `canFlush` without changing the service or weakening assertions.
- Reviewed `visibleTabIds` references in `libs/frontend/chat-streaming` and `libs/frontend/chat` specs. The other batcher spec already provides `tabs`; the chat specs with visible tab mocks either provide `tabs` or keep the visible set empty. No other spec changes were needed.
- Requested grep pipeline could not execute in PowerShell because `grep` is unavailable. Ran its PowerShell equivalent once: `npx nx test @ptah-extension/chat-streaming --parallel=1 --maxWorkers=2 2>&1 | Select-String -Pattern 'Tests:|Test Suites:|FAIL' | Select-Object -Last 10`.

```text
Test Suites: 25 passed, 25 total
Tests:       1 skipped, 624 passed, 625 total
```
