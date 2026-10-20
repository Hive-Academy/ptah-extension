## Summary

The "This session" inspector in the Electron canvas is now a resizable side dock (TASK_2026_699_833e).

- **Stats side dock in canvas single-focus mode** (`canvas-rail-board.component.ts`). A vertical
  "Stats" `ptah-sidebar-tab` sits on the dock's left (inner) edge, between the chat tile and the
  dock, and opens and closes it (decision 13). It keeps `aria-expanded`, the badge cue and focus
  return. The dock is open by default at md and wider, and closed by default at sm.
- **Grip resize, 300-560 px**, by drag or arrow keys (Shift for a bigger step). Esc cancels a
  drag and a double-click resets to the band default. The width is persisted in
  `localStorage['ptah.inspector-dock-width.v1']` and clamped on read. Defaults are 336 / 400 / 448
  px by band. The dock maximum keeps the single-focus tile at least **360 px** wide, the same
  minimum split panes use (decision 18). Width math is in
  `@ptah-extension/chat` (`inspector-dock-width.ts`, `InspectorDockWidthStore`,
  `InspectorDockController`).
- **Plan Limits inspector cards**: each plan window is a card (`variant="inspector"`), so the
  usage line, bar and reset time no longer squeeze against the state chip.
- **chat-ui atom fixes**: `ptah-split-handle` gets a grip appearance, inverted mode,
  `draggingChange` / `sizeCancel`, a Shift step, a body cursor that is restored afterwards, and a
  readout that no longer covers the dock title. `ptah-sidebar-tab` gets open-label contrast
  (`text-base-content`) and an inset focus ring.
- **Lane plan-limits RPC timeout 10 s -> 15 s** (`LANE_PLAN_LIMITS_TIMEOUT_MS`), above the 12 s
  backend deadline.
- **Review fixes**: L1, the open inspector and focus now move between the dock and the compact
  sheet across the 400 px threshold, including a direct md-to-compact resize. V-F2, the
  `@defer` blocks trigger `when` the dock is open instead of `on idle`. The body appears in 55-92 ms
  instead of 4.5-6.5 s.
- `chat-view.component.*` and `inspector-shell.controller.ts` have no diff against `main`.

**Merge order:** merge this PR before `refactor/remove-single-layout` (TASK_2026_705_9d53).

### Follow-ups (not fixed here)

- **V-F1**: the composer toolbar overlaps at a tile width of 360 px or less (the "+" and approval
  buttons overlap the model picker). `chat-input.component.ts` is owned by another team, and the
  same overlap shows in an unchanged composer at 360 px. Decision 20.
- **R2-M1**: when the board is hidden at 0 px, the dock choice resets (760 -> 0 -> 760). This
  comes from the `linkedSignal` reset in `canvas-rail-board.component.ts`. Decision 22.
- **R-1**: after a split close and then a resize to 800 px, a stale dock stays for about 1.6 s.
  It is likely the same delayed-measurement problem. Decision 23.
- **V-F3**: the compact sheet does not appear at 420-440 px. At 760 px the tile is 308 px.
- **Minors**: the split-handle readout covers the Model label. The barrel exports extra width
  helpers. Overlapping drags show the wrong cursor. Long plan-window labels are truncated. The
  open indicator has low contrast in the light theme.
- **TASK_2026_704_8918**: the NG0956 warning, filed separately.

## Test plan

- [x] `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/canvas --parallel=1`
  passes for 3 projects on `c0a523197` (the last code commit)
- [x] Unit specs: `split-handle`, `sidebar-tab`, `plan-limit-tile`, `inspector-dock-width`,
  `inspector-dock-width.store`, `inspector-dock.controller`, `canvas-rail-board`. The board
  specs include the dock-to-compact handoff in both directions and a direct 1200 -> 390 -> 1200
  resize. The `canvas-rail` spec checks the rail width against `railWidthPx`.
- [x] Code-logic review by codex, a different family from the implementer. Serious findings are
  fixed. One Moderate (R2-M1) is deferred, see above. Code-style review APPROVED.
- [x] Visual re-check in Electron, APPROVED 8/10, dark and light
  (`.ptah/specs/TASK_2026_699_833e/screenshots/recheck/`). Bands at 1440 / 1200 / 1100 / 900 /
  800 were checked, along with the clamp at 560 / 300, Esc during a drag and the double-click
  reset.
- [ ] Manual: in the Electron canvas with one focused tile, toggle Stats, drag the grip, restart
  the app and confirm that the width is restored.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
