# Batch FIX-4 report

## Defects

### 1. Compact inspector sheet

- Root cause: `canvas-rail-board.component.ts:246` sized the absolute sheet to the board, which begins after the shell rail. The shell's `min-w-[400px]` focus host at `electron-shell.component.ts:308` made that board wider than the remaining visible area at 400 px. Escape was handled only on the sheet, so a key event outside its focus subtree could miss it. The supplied Escape screenshot actually shows the sheet closed, but the handler was still focus dependent.
- Change: `canvas-rail-board.component.ts:77,246,726,736` positions the sheet against the viewport with `fixed inset-0`, handles Escape at document level while the compact sheet is open, and keeps the Tab trap on the inspector's inner dialog after its deferred content loads. The shell width stays intact for other content.
- Result: the sheet's width and close control fit the visible 400 px viewport; Escape also closes it when focus is outside the sheet.

### 2. Empty wide inspector

- Root cause: `canvas-rail-board.component.ts:238-244` displayed the `@defer (on idle)` placeholder. The screenshot's “Session details” heading is that placeholder, which proves a focused id was present; the focus pane was rendering the selected session. Idle scheduling had not replaced the placeholder in the rich-session capture.
- Change: `canvas-rail-board.component.ts:238-240` renders the wide inspector immediately for `focusedId()`. The existing focus id fallback at lines 318-324 still selects the focused tile or first tile.
- Result: the rich session's SESSION, PLAN LIMITS and LANES sections can appear as soon as the aside mounts, as they do for lane sessions.

### 3. Dock card escapes its pane

- Root cause: `canvas-lane-tabs.component.ts:392-397` positioned against the viewport because `FloatingUIService` exposed no element boundary.
- Change: `floating-ui.service.ts:41-43,140-146` accepts an optional element boundary for both flip and shift. `canvas-lane-tabs.component.ts:392-397` passes the enclosing `[data-pane-side]` focus pane.
- Result: the hover or focus card shifts inside its 400 or 760 px pane instead of overlapping Sessions.

## Files

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts`
- `libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts`

## Spec changes

- Updated the existing wide aside assertion to require the focused inspector immediately.
- Updated the existing compact sheet spec to check viewport positioning, and added an Escape regression case in that same spec file.
- No new spec files.

## Checks

All commands ran from the worktree root through `.ptah/tmp/check-run.mjs`; `-p` named only changed projects. Logs are in `%TEMP%/629-check-<label>.log`.

| Target | Command arguments after `--` | Exit | Nx header | Result |
| --- | --- | ---: | --- | --- |
| typecheck, round 1 | `npx nx run-many -t typecheck -p @ptah-extension/canvas @ptah-extension/ui --parallel=1 --skip-nx-cache` | 1 | 2 projects | Angular host listener typed `$event` as `Event`; corrected signature. |
| typecheck, final (`fix4-typecheck-r3`) | Same | 0 | 2 projects | Passed. |
| lint, final (`fix4-lint-r2`) | `npx nx run-many -t lint -p @ptah-extension/canvas @ptah-extension/ui --parallel=1 --skip-nx-cache` | 0 | 2 projects | Passed. |
| test, round 1 (`fix4-test`) | `npx nx run-many -t test -p @ptah-extension/canvas @ptah-extension/ui --parallel=1 --skip-nx-cache --coverage=false --maxWorkers=2` | 1 | 2 projects | 21 suites passed; one compact Tab trap test failed because the wrapper became the first dialog. Corrected selector. |
| test, final (`fix4-test-r2`) | `npx nx run-many -t test -p @ptah-extension/canvas --parallel=1 --skip-nx-cache --coverage=false --maxWorkers=2` | 0 | 1 project | Canvas passed; UI had passed in round 1. |

`ptah_get_diagnostics` was unavailable after its 45 second compiler timeout. Nx typecheck passed. A separate visual recheck is still needed to confirm the screenshots at 400, 760 and 1440 px.

## Decisions

- Keep the shell's minimum width. Options were changing shell layout or sizing this overlay to the viewport. The overflow is confined to the sheet's absolute containing block, and changing the shell could affect all 400, 760 and 1440 px content. Reversible.
- Render the wide inspector eagerly. Options were retaining idle deferral or mounting immediately. The screenshot shows the idle placeholder for a focused session; eager rendering removes that scheduling dependency. Reversible.
- Add a boundary option to the existing FloatingUI service. Options were a local position calculation or using the existing middleware. The service already owns flip and shift, so a boundary belongs there. Reversible.

## Clarifications Needed

None.
