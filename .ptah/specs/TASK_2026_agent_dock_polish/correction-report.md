# Agent dock overflow correction

## Changes

- `libs/frontend/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts:176`: Menu rows now sort only `hidden()` agents. The trigger count and rows therefore use the same set; inline agents are absent. The existing flat status order remains running, waiting, failed, queued, done, stopped.
- `libs/frontend/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts:177`: Roving focus falls back to a remaining hidden agent when the active row disappears. Open state is reported to the parent at line 285.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:230`: The parent passes only its computed hidden set. At line 414, it closes a disappearing menu and restores focus to the selected inline tab when overflow becomes empty.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts:859`: Checks row order, count equality, and exclusion of the inline orchestrator. At line 928, checks focus after a row disappears and after overflow empties. At line 991, updates menu selection expectations for the shorter list.

## Decisions

- Used the dock's existing `layout().hidden` set rather than recomputing overflow in the menu. The parent already applies width, selection, finished-agent, and keyboard-focus rules to that set. Reversible by changing the menu input if dock semantics change.
- Kept the menu conditional in the parent and tracked its open state there for focus recovery. The parent owns the condition that removes the menu, so it can restore focus after removal. Reversible within these two components.

## Verification

- Command: `npm run verify -- -p @ptah-extension/canvas` (one foreground run at a time, output filtered to its final 120 lines).
- Final Nx summary: **3 tasks: 3 succeeded** (lint, test, typecheck); exit code 0. Cache: 0/3 hit. An earlier run failed two tests while the correction was in progress; those failures were fixed before the passing run.
- Scoped `ptah_get_diagnostics` returned unavailable after 45 seconds; the passing Nx typecheck supplies the typecheck result.

## Not done

- No new Electron render or screenshot was made because the task forbids launching Electron. The existing `visual-review.md` documents the prior visual pass, not this correction.
