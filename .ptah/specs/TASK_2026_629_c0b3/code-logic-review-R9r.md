# Code Logic Review — TASK_2026_629_c0b3 — Batch R9r

Review family: Claude (reviewer) vs opencode (implementer)

## Summary

| Metric | Value |
| --- | --- |
| Score | 9/10 |
| Verdict | APPROVED |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 0 |
| Minor | 2 |

Scope: `git diff HEAD -- libs/frontend/chat-state` (4 files, +11 / -123), read in full, plus `tab-persistence.ts` (projection and restore), `loadTabState` in `tab-manager.service.ts`, and repo-wide `rg` for the removed names. No tests, tsc or nx were run (read-only, per the batch brief).

## Findings

### 1. [Minor] The rewritten reload case cannot tell a real restore from a no-op `loadTabState`
File: `libs/frontend/chat-state/src/lib/tab-manager.persistence.spec.ts` ("persists viewMode and restores it after a reload").

`service.loadTabState()` is a real read. It runs `localStorage.getItem`, `JSON.parse`, `sanitizeRestoredTabs`, then `_tabs.set(...)` (`tab-manager.service.ts:2785-2800`). So the case does exercise the restore path. But the in-memory tab is already `compact` when `loadTabState()` runs, so `restored.viewMode === 'compact'` would also pass if the restore read nothing.

The old case had the same shape (height 5 in memory and in storage), so this is not a regression. The writer did improve it in one way. The final `compact` is set after a `full` write, so the last write must be the one that gets restored. To make the case discriminating, flip the in-memory mode to `full` without flushing, or `_tabs.set([])`, before `loadTabState()`. Optional.

### 2. [Minor] Restore still injects `compactHeightUnits` into in-memory tabs
File: `tab-persistence.ts:188-208` and `:272`. Out of scope for R9r; this is R9s work.

Nothing writes `compactHeightUnits` any more. But `sanitizeRestoredTab` still stamps `compactHeightUnits: 2` onto every restored compact tab, and `projectTabForPersist` (`tab-persistence.ts:110-125`, a spread) writes it back on the next save. The field therefore keeps circulating in stored blobs until R9s lands. This is harmless and expected. R9s must delete both the restore injection and the legacy constants, or the field will persist indefinitely.

## Focus areas

1. **viewMode preserved.**
   - `setViewMode` is unchanged except for its doc comment (`tab-manager.service.ts:2957-2961`). It still no-ops on an equal mode or a missing tab, and writes `{ viewMode: mode }` via `updateTabInternal`.
   - `toggleTabViewMode` body is untouched. Only the paragraph about `compactHeightUnits` was removed from its doc. It is still binary, which `canvas.spec.ts` relies on.
   - `getTabViewMode` (`:2967`) and the `:484` active-tab read are unchanged.
   - The retained specs still cover the toggle (independent per tab, no cycling), `setViewMode` (idempotent, missing tab), and the persistence case.
   - One behaviour changed on purpose. `setCompactHeight` used to force `viewMode: 'compact'` as a side effect. With it gone, nothing implicitly switches a tab to compact, which is correct for Grid removal.

2. **Persisted write path.**
   - R9r changed no write path. The only production change is deleting `setCompactHeight`, which was the sole writer of `compactHeightUnits` (it called `updateTabInternal` with `{ viewMode, compactHeightUnits }`).
   - The serialization side (`projectTabForPersist`) is a spread. It drops no field and keeps no field by name, so there was nothing to trace or edit there.
   - The reader (`restoredCompactView`) is untouched. A stored record carrying `compactHeightUnits` (valid, invalid, or legacy `'compact-tall'`) still restores. This remains covered by `tab-restore-sanitize.spec.ts:216-275`, which is not modified.
   - Old stored tabs and newly created tabs both restore without error.

3. **Deleted specs.** I checked each removed case for coverage of non-height behaviour.
   - `intent-mutators.spec` "toggleTabViewMode stays binary and keeps the last compact height": the binary round-trip is still covered by `tab-manager.service.spec` "toggles full and compact independently per tab, without cycling". The only extra assertion lost was the height.
   - `intent-mutators.spec` "setCompactHeight writes the tab once...": height only. The "no-write on a repeated call" idea is covered for `setViewMode` by "ignores repeated selections or missing tabs".
   - `service.spec` "returns a tall compact tab to full on toggle, then back": height only.
   - `service.spec` "setCompactHeight switches a full tab to compact...", "is a no-op for equal height/invalid/missing", "re-enters compact from full": all height-specific. The missing-tab no-op for `setViewMode` is still covered.
   - `persistence.spec`: rewritten rather than deleted. It asserts the stored `viewMode`, a write on a mode-only change (`setItem` called once), and a restore through `loadTabState`.
   - No cases were found whose only coverage was non-height behaviour. See Finding 1 for the strength of the reload assertion.

4. **Consumers of the removed methods.** `rg "setCompactHeight|getTabCompactHeightUnits|compactHeightUnits"` over the whole worktree, excluding node_modules, dist, .nx and .ptah, finds:
   - Zero references to `setCompactHeight` or `getTabCompactHeightUnits` anywhere. That covers libs and apps, `.ts` and `.html`, mocks and test doubles, and the canvas specs.
   - The chat-state barrel did not name them separately. They were class methods only.
   - `compactHeightUnits` remains only in `tab-persistence.ts`, `tab-restore-sanitize.spec.ts` and `chat-types.ts` (`:447`, `:464`, `:737`). These are R9s files and are expected to stay.
   - Within the four contracted files there are zero residual `compactHeightUnits`, `CompactHeight` or "compact height" strings, comments included.
   - The other `viewMode` consumers (`canvas-focus-area`, `tab-bar`, `chat-view`, `conductor-tile`, `harness-builder`) use only `getTabViewMode`, `toggleTabViewMode` or `setViewMode`, which are all retained.

## Five logic questions (brief)

1. Silent failure: none introduced. Deletion only.
2. Unexpected user action: none. The one-click toggle is unchanged.
3. Wrong-answer input: none new. A stored `compactHeightUnits` is still sanitised on restore.
4. Dependency failure: not applicable. localStorage handling is unchanged.
5. Missing: R9s must also remove `restoredCompactView` and the legacy constants (Finding 2), and update the `chat-types.ts` doc comments.

## Verdict

APPROVED, 9/10, confidence HIGH. The change is purely subtractive. The surviving `viewMode` API is intact, no persisted-write behaviour changed, the removed methods have zero consumers, and the contract's "every reference incl. comments" holds in all four files. The residual points are an optional strengthening of the reload test (Finding 1) and R9s carry-over (Finding 2).
