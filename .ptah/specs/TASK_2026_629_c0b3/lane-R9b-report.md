# Lane R9b report — Rail New session uses the named popover; Grid host removed

Executor: Claude frontend-developer (completion of a stopped writer's partial work). No git state changed.

## Changed files (all under `libs/frontend/canvas/src/lib/`)

- MODIFIED `orchestra-canvas.component.ts` — Grid host removed (workspace-grid, detail-panel,
  detail-keyboard, layout-controls, board-toggle, live-budget, empty-state imports and markup gone).
  The one named `ptah-native-popover` is anchored to the dock New Session button and opened by
  `openNewSessionPopover()` from the dock, the Rail footer and the zero-tile empty board
  (`(newSessionRequested)`). `handleCreateSession()` trims the name, uses `defaultSessionName()` for an
  empty name (keeps first-prompt rename), checks `canStartRunningSession()` and `canAddTile()`, handles a
  null `addTile`, announces the refusal in the dock `role="status"` line, and on success calls the
  visible board's `sessionCreated(id)`.
- MODIFIED `canvas-rail/canvas-rail-board.component.ts` — the board no longer creates a session; footer
  and zero-tile empty board emit `newSessionRequested`. `sessionCreated(id)` resets `geometryBaseline`,
  focuses the tile and anchors the rail scroll. `CanvasLayoutService` use kept (`band()`).
  This pass: `newSession()` no longer repeats the cap checks and silently drops the request; it always
  emits, and the host refuses and announces (one source of cap logic, R9-D1).
- MODIFIED `orchestra-canvas.rail.spec.ts` — footer and empty board open the same popover; typed name;
  empty-name default (DEFAULT_SESSION_NAME_PATTERN); running cap blocks create; null add; cancel; new
  `it.each` for blocked board requests at the running cap (9) and the tile bound (announced reason,
  no popover, no tile). This pass also routes the host's `activeRailBoards` query to the board stubs so
  the post-add `sessionCreated` path is asserted (two cases were failing without it).
- MODIFIED `orchestra-canvas.component.spec.ts` — Grid cases removed; dock, cap-9 disabled reason
  (`disables the New Session trigger and exposes its reason at nine running sessions`) and Rail-only
  viewport cases kept. This pass removed a stray `});` at line 679 (lint parse error; Jest tolerated it).
- MODIFIED `canvas-rail/canvas-rail-board.component.spec.ts` — popover request, `sessionCreated` baseline
  reset/focus/anchor, empty-board trigger and its running-cap reason, footer routing. Blocked cases now
  assert the request is forwarded and no tile is added.
- DELETED `orchestra-canvas.detail.spec.ts` — see below.

## Checks (all through `node .ptah/tmp/check-run.mjs`)

| Check | Result |
| --- | --- |
| `nx test canvas --testFile=orchestra-canvas.rail.spec.ts` | first 12/14 (2 failed: sessionCreated not reached via stub); after fix 14/14 passed |
| `nx test canvas --testFile=orchestra-canvas.component.spec.ts` | 30/30 passed (re-run 30/30 after the syntax fix) |
| `nx test canvas --testFile=canvas-rail-board.component.spec.ts` | 26/26 passed |
| `nx test canvas` (full, once) | 34 suites, 421/421 passed |
| `nx typecheck canvas` | Successfully ran |
| `nx lint canvas` | first run 1 error (stray `});` in component spec); after fix 0 errors, 22 warnings, none in R9b files |
| `rg orchestra-canvas.detail.spec` (excluding `.ptah/`) | no matches; nothing imports the deleted spec |

Note: the full suite ran before the one-line `});` removal; the changed spec was re-run alone afterwards
(30/30). The check lock was held by a dead run of the stopped writer (`R9b-2`, no live jest/nx process,
log idle 27 min); I removed that stale lock before my runs.

## Parity rows

- 45 (board mode toggle) and 46 (Grid presets/layout menu): host no longer imports or renders them;
  `stored grid board renders Rail` and `shares reserved dock ... with no Grid controls` assert absence.
- 62 (Grid detail spec K1): spec deleted with the Grid host; popover and cap assertions live in
  `orchestra-canvas.rail.spec.ts`.
- 67 (Grid empty-state named trigger): moved to the Rail zero-tile empty board, same popover; covered by
  typed name, empty board, cap, null add cases.

## Why the detail spec was deleted

`orchestra-canvas.detail.spec.ts` tested the Grid detail panel through Gridstack mocks and the Grid host
(implementation plan, Proposed Removals; R9-D13; row 62). With the Grid host removed it has no subject.
Its only shared concern, the named popover and cap behaviour, is covered in `orchestra-canvas.rail.spec.ts`.

## Deviations from the plan

- Plan text says the board checks `canStartRunningSession()`/`canAddTile()` before opening. The checks
  live only in the host (`createBlockReason()`); the board forwards every request. Reason: R9-D1 forbids
  duplicated cap logic, and a silent board-side drop could not announce the failure.
- When the tile bound is reached the dock popover is not rendered (`@if (canvasStore.canAddTile())`),
  so a blocked request announces in the dock status line instead of opening an anchored popover.

## Open risks

- The empty-board button stays clickable with `aria-disabled` at the running cap; its visible reason
  is local, but the refusal announcement is in the dock status line, not the board's own live region.
- `TILE_BOUND_MESSAGE` is duplicated between `orchestra-canvas.component.ts` and
  `canvas-rail/canvas-rail.component.ts` (R9c-owned); a shared export would remove the drift risk.
- Grid-only files (`canvas-workspace-grid*`, `canvas-empty-state`, `canvas-live-budget`, etc.) still
  exist and are still linted/tested; R9p and later batches delete them.
- Jest accepted a file with a stray `});` that ESLint rejected; spec syntax errors may not surface in
  test runs alone.

## Fix round (codex-review-R9b.md)

Scope: the four assigned files only. The Decisions section was not acted on (dock = R9f; the
duplicated tile-bound text is the recorded Minor).

### Finding 1 (Serious): popover silently reopened after a tile-bound transition

- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:413-420`: a new constructor
  `effect` watches `canvasStore.canAddTile()`. When it turns false it runs
  `untracked(() => this.handleCancelSession())`, which sets `sessionPopoverOpen` to false and
  clears `sessionNameInput`. The `@if (canAddTile())` unmount sends no `closed` event, so the host
  now clears this state itself. The effect announces nothing (`headerMessage` is untouched). A
  later tile close mounts the popover closed, with an empty name.
- New spec `orchestra-canvas.rail.spec.ts:436`, "reaching the tile bound closes the open popover;
  a later tile close does not reopen it". It opens from the footer, types "Epsilon", sets
  `canAddTile` false (popover unmounted, dock status text unchanged), then sets `canAddTile` true.
  It asserts the popover is mounted but `isOpen` is false, the Session name input is `''`, and
  `addTile` was not called.

### Finding 2 (Moderate): `aria-disabled` empty-board trigger still activated

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:99`: the empty-board
  button's `(click)` now calls `emptyBoardNewSession()`.
- `canvas-rail-board.component.ts:371-381`: `emptyBoardNewSession()` returns early while
  `newSessionBlockReason()` is set. Otherwise it calls `newSession()`. The button is still not
  natively disabled, so it stays focusable and keeps `aria-describedby` and its visible reason.
  A native button turns Enter and Space into this click, so the same guard covers the keyboard.
  The footer path (`(newSession)="newSession()"`) is unchanged, and the host's
  `createBlockReason()` is still the final cap gate (R9-D1). The `newSession()` doc comment was
  updated to match.
- The spec `canvas-rail-board.component.spec.ts:530` replaces the case that encoded the mismatch:
  "0 tiles: at the running cap the aria-disabled trigger keeps its reason and does not emit".
  At the cap it checks `aria-disabled="true"`, `disabled === false`, the `aria-describedby` and
  the reason text. Then it clicks and dispatches Enter and Space keydown, and expects no emit.
  After `canStart` is set to true, `aria-disabled` is gone and a click emits once. Note: jsdom
  does not turn keydown into a click, so the keyboard part of this case only proves that no
  separate key handler emits. The click guard is the real keyboard protection in a browser.
- The stub in `orchestra-canvas.rail.spec.ts` still emits from its empty board without a guard,
  so the host's refusal at both caps stays covered there.

### Spec results (lock runner `node .ptah/tmp/check-run.mjs fix-R9b -- npx nx test canvas
--testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`)

- `orchestra-canvas.rail.spec.ts`: 1 suite passed, 15/15 tests (was 14).
- `orchestra-canvas.component.spec.ts`: 1 suite passed, 30/30 tests.
- `canvas-rail-board.component.spec.ts`: 1 suite passed, 26/26 tests (one case replaced).
- Not run in this round: typecheck, lint, full canvas suite. The brief did not allow them.
