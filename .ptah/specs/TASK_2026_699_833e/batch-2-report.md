# Batch 2 report — TASK_2026_699_833e (chat inspector services)

Executor: Claude frontend-developer subagent. Worktree `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock`
(branch `feat/inspector-side-dock`). No git commands run; working tree left dirty for the team-leader.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\services\session-inspector\inspector-shell.controller.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\services\session-inspector\index.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\services\session-inspector\inspector-dock-width.store.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\services\session-inspector\inspector-dock-width.store.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\services\session-inspector\inspector-shell.controller.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\services\session-inspector\inspector-open-state.service.spec.ts`

`inspector-open-state.service.ts` is unchanged. No peer-owned file (chat-transcript, message-bubble, chat-input) was touched.

## Task evidence

### Task 2.1 — constants, pure functions, `shellWidth`, `toggle(opener?)`, barrel

- Constants next to `INSPECTOR_DOCKED_MIN_WIDTH`, verbatim from design-spec.md §2: `INSPECTOR_MIN_WIDTH = 300`,
  `INSPECTOR_MAX_WIDTH = 560`, `INSPECTOR_MAIN_MIN_WIDTH = 624`, `INSPECTOR_LARGE_SHELL_MIN_WIDTH = 1100`,
  `INSPECTOR_WIDE_SHELL_MIN_WIDTH = 1500`, `INSPECTOR_DEFAULT_WIDTH = 336`, `INSPECTOR_LARGE_DEFAULT_WIDTH = 400`,
  `INSPECTOR_WIDE_DEFAULT_WIDTH = 448`.
- Pure functions `inspectorMaxWidthFor`, `inspectorDefaultWidthFor`, `inspectorDockWidth` (non-finite preference
  falls back to the default; result rounded and clamped to `[300, maxFor(shell)]`).
- `readonly shellWidth: Signal<number>` (initial 0) set in `applyWidth` only for `width > 0`; the
  no-`ResizeObserver` branch of `attach` seeds it from `getBoundingClientRect().width` when > 0. No new
  observer or timer.
- `toggle(opener: HTMLElement | null = null)`: docked open remembers `opener`; docked close via toggle clears
  the remembered opener (focus stays on the activated control); sheet open uses
  `opener ?? this.opener() ?? active`. `closeInsp`/`restoreFocus` unchanged.
- `index.ts` exports all 8 new constants, the 3 functions and `InspectorDockWidthStore`
  (`INSPECTOR_DOCK_WIDTH_STORAGE_KEY` stays file-local to the store module; specs import it relatively).

### Task 2.2 — `InspectorDockWidthStore`

- `@Injectable({ providedIn: 'root' })`, `inject(LoggingService)` from `@ptah-extension/core`.
- Key `ptah.inspector-dock-width.v1`, value `String(integer)`.
- `preference` is a read-only view of a private signal and changes only in `commit`, `reset` and the
  `storage` handler.
- One shared parser `parseStoredWidth` for restore and the handler: `null`/blank/non-finite → `null`, else
  rounded and clamped to [300, 560].
- Constructor: restore, then (only when `typeof window !== 'undefined'`) adds the one `storage` listener;
  `inject(DestroyRef).onDestroy` removes it.
- Handler ignores other keys, `key === null`, and non-`localStorage` areas; `newValue === null` → `null`;
  malformed → current preference kept; never writes storage.
- `commit` ignores non-finite, rounds, clamps, sets, writes. `reset` sets `null` and removes the key.

### Task 2.3 — specs for store and controller

- `inspector-dock-width.store.spec.ts`: restore table (`"420"`→420, `"9999"`→560, `"12"`→300, `"400.6"`→401,
  `"abc"`/`""`/`"   "`/`"NaN"`/`"Infinity"`/missing → `null`); throwing `getItem` → `null`, one `logger.warn`, no
  `console.warn`; `commit(448)` writes `"448"`; clamp/round on commit; `commit(NaN|±Infinity)` changes nothing and
  never calls `setItem`; throwing `setItem` → no throw, in-memory value kept, `logger.warn` exactly once across
  two failing commits with context `'InspectorDockWidth'`, no `console.warn`; `reset` removes the key; throwing
  `removeItem` warns once; reload persistence via `TestBed.resetTestingModule()`; live sync (valid 480, 9999→560,
  malformed keeps 420, `newValue: null` → `null`, other key and `key: null` ignored, `sessionStorage` area
  ignored, handler makes no `setItem`/`removeItem` call); after `resetTestingModule()` the old instance no
  longer reacts (listener removed).
- `inspector-shell.controller.spec.ts`: bands 960/959/640/639 and zero-width keep; `shellWidth` initial,
  updates, zero keep, unmeasured 0, seeded without `ResizeObserver`; docked↔sheet (AC 5.4) incl. the sheet never
  writing the docked choice; sheet focuses close button, `closeReady` only while pending, Tab/Shift+Tab trap, Esc
  closes and returns focus, `defaultPrevented` Esc leaves it open (AC 5.3); tab switch closes the sheet (AC 5.5);
  AC 1.6 `toggle(tabButton)` then `closeInsp('opener')` focuses the tab in docked and sheet; docked toggle-close
  forgets the opener; `toggle()` with no argument uses the header toggle (Rail board path); fallback to the title,
  never `body`; `showDot` `need`; pure-function tables (960 → max 336/default 336; 1099 → 336, 1100/1124 → 400,
  max 500 at 1124; 1499 → 400, 1500 → 448; preference 900 → max, 100 → 300, NaN/Infinity → default, 0 shell →
  default 336 / max 560).

### Task 2.4 — `inspector-open-state.service.spec.ts`

Test only: default `initialOpen ?? mode === 'full'` (full open, compact closed, workflow tab open in any mode,
`initialOpen false` closed); `setDocked` per tab and per mode (a choice in another mode counts as absent);
overrides a workflow default; reactive through `computed`; a closed tab is forgotten (via the `onTabClosed`
listener); unknown `forget` is a no-op; unsubscribes on destroy.

## Risks and edge cases

- R3: `toggle(opener: HTMLElement | null = null)` is additive; the Rail board keeps calling `toggle()`. Its sheet
  path is unchanged (`null ?? this.opener() ?? active`). One docked-path nuance: a docked open via `toggle()` now
  sets the remembered opener to `null`, so a later `closeInsp('opener')` falls back to `this.opener()` (the
  header toggle) — the same element the Rail board would have reached before, except in the rare case where a
  sheet opener survived an overlay→docked transition. Canvas rail-board regression spec passes (below).
- R5: no `console.*` in the store (grep: 0 hits). Every failure goes through
  `logger.warn('InspectorDockWidth', '<kind> failed; width kept in memory only', error)`, once per kind
  (`read`, `write`, `remove`) via a private `Set`. The read catch returns `null` and its first lines are
  `// degradation-audit: reported - storage read failure is logged via LoggingService.warn;` /
  `// the default width is used`. The write/remove catches return nothing. The `isLocalStorage` guard's catch
  assigns nothing and returns nothing (not a sentinel site), so it needs no marker. `baseline.json` has 0 entries
  for the file.
- R8: the `storage` handler sets only `preferenceState` and never touches storage or any view draft.
- Unmeasured shell width 0 → `inspectorDefaultWidthFor(0) = 336`, `inspectorMaxWidthFor(0) = 560`,
  `inspectorDockWidth(null, 0) = 336` (spec-covered); NaN shell also covered.
- Malformed / out-of-range stored value → `null` or clamped to [300, 560] (spec-covered for restore and live sync).
- Storage throws → in-memory only, one warn per kind (spec-covered for read, write, remove).
- `typeof window === 'undefined'` → the constructor returns before `addEventListener` and before registering
  the `DestroyRef` callback. Not unit-tested: jsdom always defines `window`, so the branch is reviewed by reading.

## Verification

1. `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat --parallel=1`

   ```
   NX  Running targets typecheck, test, lint for project @ptah-extension/chat:
   NX  Successfully ran targets typecheck, test, lint for project @ptah-extension/chat
   NX  Nx Cloud encountered some problems
   ```
   (The Nx Cloud line is the remote-cache connection notice, not a target failure.)

   Before it, the three new specs alone:
   `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/session-inspector --coverage=false --maxWorkers=2`
   → `Test Suites: 3 passed, 3 total` / `Tests: 88 passed, 88 total`.

2. `npx jest -c libs/frontend/canvas/jest.config.ts libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts --coverage=false --maxWorkers=2`

   ```
   Test Suites: 1 passed, 1 total
   Tests:       104 passed, 104 total
   ```

All runs were sequential and in the foreground. Not run: the `degradation-audit:lint` target, because it scans
the whole workspace (`libs/**`, `apps/**`) and belongs to a project this batch did not change. The marker
follows the checker's grammar (`check-degradation.ts:102-107`, `optional-capability|reported` + separator).

## Decisions

- Controller spec uses the real `InspectorOpenStateService` (with a stubbed `TabManagerService.onTabClosed`)
  instead of a stub, so the docked-choice assertions exercise the real per-mode rule. Options: stub / real.
  Evidence: the service is root-provided and side-effect free besides the tab-close subscription. Reversible.
- `INSPECTOR_DOCK_WIDTH_STORAGE_KEY` is exported from the store file but not from the barrel (no consumer
  outside the folder). Reversible if Batch 3 specs need it through `@ptah-extension/chat`.

## Deviations

- None from the plan's behaviour. Batch text says "stub `InspectorOpenStateService`"; see Decisions.

## Out-of-scope findings

- None new.
