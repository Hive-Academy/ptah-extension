# Batch B report

## Item 6 — focused needs-you count

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:274,335-340`: Injected the public `SessionInspectorStore` and used `modelFor(focusedId)().needsYouCount` in the closed details description.
- Spec: `includes the focused session needs-you count in the closed details description` (`canvas-rail-board.component.spec.ts:430`). It checks counts for two focused tabs.

## Item 7 — compact sheet focus boundary

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:43-49,739-755`: The Tab handler uses `event.currentTarget` as the sheet. The tabbable filter includes the inspector's direct dialog, while excluding a dialog nested within it.
- Spec: `traps Tab at the sheet boundary when the inspector contains another dialog` (`canvas-rail-board.component.spec.ts:1165`). It checks both Tab and Shift+Tab wrapping.

## Item 8 — canvas tile selector

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:160`: Added `data-testid="canvas-tile"` to the per-session pane section.
- Spec: `renders one canvas tile per visible session pane` (`canvas-rail-board.component.spec.ts:441`). It checks single and split pane counts.

## Verification

- Scoped Jest: **1 suite passed, 90 tests passed, 0 failed**. Used a command line `marked` mapper to the installed parent-checkout package because the worktree's preset resolves it under a nonexistent worktree `node_modules` path.
- `ptah_get_diagnostics` for the two edited files: **0 errors in requested files**. Seven errors were reported in unchanged sibling files (`orchestra-canvas.rail.spec.ts`, `mock-rpc-service.ts`, and `capability-id-codec.ts`).

## Decisions

- Used `SessionInspectorStore` from the public `@ptah-extension/chat` entry point. The transcript and chat view use `modelFor(tabId)().needsYouCount`; canvas already imports that library. The alternative was deriving the count from other public data, which would duplicate its aggregation. Reversible.
- Marked the rendered session pane as `canvas-tile`, following the plan's per-session pane definition and the showcase selectors that look for a tile header and close control within it. The alternative rail card is a navigation entry and does not contain the pane's controls. Reversible.
- The inspector itself renders a direct child dialog inside the compact sheet. Kept its buttons in the sheet trap and excluded nested dialogs, matching the sheet's focus boundary. Reversible.

## Not done

- No e2e scenes, chat sources, or chat-ui sources were edited, per batch ownership.
