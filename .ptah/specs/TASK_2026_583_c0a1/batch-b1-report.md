# Batch B1 report — tab height state (component 4)

Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-583-compact-polish`.
Nothing committed.

## Files changed

B1-owned:

- `libs/frontend/chat-types/src/lib/chat-types.ts` — `TabViewMode = 'full' | 'compact'`;
  `isCompactViewMode(mode)` is now `mode === 'compact'` (same signature);
  new `TabState.compactHeightUnits?: number`; docs rewritten.
- `libs/frontend/chat-state/src/lib/tab-persistence.ts` — `sanitizeRestoredTab`
  now validates view mode and height (`restoredCompactView`):
  `'compact-tall'` -> `compact` at `LEGACY_COMPACT_TALL_HEIGHT_UNITS = 3`;
  `compact` without a valid height -> `LEGACY_COMPACT_HEIGHT_UNITS = 2`;
  a valid stored height always wins; a height that is not a positive integer
  is dropped. No storage-version bump.
- `libs/frontend/chat-state/src/lib/tab-manager.service.ts` — new
  `setCompactHeight`, `getTabCompactHeightUnits`; toggle stays binary (doc updated).
- Specs: `tab-restore-sanitize.spec.ts` (migration on both readers, invalid
  values, valid height kept), `tab-manager.service.spec.ts`,
  `tab-manager.intent-mutators.spec.ts` (compact-tall cases replaced by
  `setCompactHeight` cases; toggle returns to last height),
  `tab-manager.persistence.spec.ts` (height persists, a height-only change
  writes, and it restores through `loadTabState`).
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
  (doc comment only) and `chat-view.component.spec.ts` (compact-tall case
  folded into the compact case).

Minimal compile fixes in B2-owned canvas files (B2 replaces all three):

- `canvas-layout-intent.ts` — dropped the `@ptah-extension/chat-types`
  import; the four `isCompactViewMode(tier)` calls use a private
  `isCompactTier` (the canvas `TileHeightTier` union still has `compact-tall`).
- `canvas-workspace-grid.component.ts` — dropped the `isCompactViewMode`
  import; two calls became `heightTier !== 'full'`.
- `canvas-tile.component.ts` — removed the `compact-tall` entry from
  `VIEW_MODE_OPTIONS` and `NEXT_VIEW_MODE_LABEL`.

## API exposed for B2

- `TabManagerService.setCompactHeight(tabId: string, units: number): void` —
  ignores non-integer or non-positive `units` and missing tabs; sets
  `viewMode: 'compact'` and `compactHeightUnits`; no-op if both are already equal.
  It does not clamp, so canvas must clamp to `[2, 5]` before calling.
- `TabManagerService.getTabCompactHeightUnits(tabId: string): number | undefined`.
- `TabState.compactHeightUnits?: number` (read it in `viewConstraints`, then clamp).
- `setViewMode(tabId, 'full')` keeps the stored height.

## Verification

- `nx test chat-state`: 19/19 suites, 468/468 tests passed.
- `nx test chat --testFile=chat-view.component.spec.ts`: 1/1 suite, 54/54 passed.
- `nx test canvas`: 8/9 suites passed, 184/189 tests. The 5 failures are in
  `canvas-tile.component.spec.ts` (`selects full|compact|compact-tall directly…`,
  `includes height choices in keyboard navigation…`, `labels the view-mode
  toggle…`). They assert the three-item `compact-tall` menu, which B2 replaces
  with presets and a stepper. These failures are expected until B2 lands.
- `nx run-many -t lint -p chat-types chat-state chat canvas`: all 4 passed.
- `tsc --noEmit` on the lib configs for canvas, chat-state, chat-types and
  tribunal-panel: clean. The spec configs show only errors that already existed
  in files outside this batch. The canvas grid spec's `compact-tall`
  arguments (lines 467, 567, 1384) now fail the type check, and B2 rewrites
  those cases.
- The remaining `compact-tall` references are the migration (`tab-persistence.ts`),
  its spec, the doc in `chat-types.ts`, and the B2-owned canvas files and specs.
