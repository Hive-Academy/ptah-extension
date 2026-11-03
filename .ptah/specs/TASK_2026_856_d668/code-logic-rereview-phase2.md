# Code Logic Re-review, Phase 2 fix round (M1-M3)

Verdict: APPROVED (0 blocking, 0 serious, 2 minor). Source read only; no tests run.

## M1: fixed
- session-inspector.store.ts:139 and compact-session-card.component.ts:273 now gate on `sessionContextCue(live).known`, the same gate as session-stats-view.ts:42. This adds the used/percent finiteness and trusted-window checks.
- Both specs use a live window of 100k against a trusted 200k and expect a null percent, so they pin the behaviour.

## M2: fixed, no real count hidden
- session-inspector.store.ts:102 returns null only when there is no host `turnCount` (that case returns earlier at lines 94-100), `claudeSessionId` is set, and `messages` is empty.
- A new empty session has no `claudeSessionId` and still gets 0.
- The `turns` computed (line 276) reads the current tab, so it re-runs when messages load. Once they load it falls through to `loadedTurns`, or to null if an older-history cursor is set, as before.
- The spec at store.spec.ts:34 sets `claudeSessionId` by default, so the new "unknown turns" case does exercise the branch.

## M3: fixed
- system-prompt-drawer.component.ts:407-422: the background path skips `isLoading`, so the status body stays mounted. The initial load, the isOpen effect and the "Check again" button call `loadStatus()` with the default and keep the loading state.
- On a background failure, `statusLoadFailed` and `error` are still set (lines 424-425), and the "Check again" button shows because `!isLoading()` holds (line 107). A success clears both.
- The spec asserts that `isLoading` stays false, that the status body node is unchanged and that the loading element is absent.

## Minor
- system-prompt-drawer.component.ts:408-409: a background poll clears `error` before the RPC returns, so a visible load error disappears for the length of the request. It comes back if the poll fails again, and nothing is lost. Optionally clear it only on success.
- session-inspector.store.ts:102: a session whose `claudeSessionId` is set while `messages` is still empty, before the first message lands, shows an unknown turn count for a moment. This is acceptable and matches the intent.
