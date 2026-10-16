# Batch FIX-2 report

## Items

### 1. Inspector lazy entry point

Created `libs/frontend/chat/src/inspector.ts:1` with the inspector component and presentation type, mapped `@ptah-extension/chat/inspector` in `tsconfig.base.json:37`, and removed the inspector re-export from `libs/frontend/chat/src/lib/components/index.ts` after the workflow badge export at line 159. `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:18` now imports the component through the secondary entry and uses it only in component `imports` and deferred templates. The board spec imports the same entry. This removes the board's eager barrel path to the inspector tree. The existing `tasks-ui/presentation` entry needed only a `tsconfig.base.json` path; its project, ESLint, and Jest configurations contain no entry-specific setup to mirror.

### 2. Overlay focus and Escape

`canvas-rail-board.component.ts:181,249,677-702` makes the split dialog and compact sheet wrapper programmatically focusable. Opening focuses the immediate shell, then a bounded `MutationObserver` moves focus to the deferred close button when it appears. The observer disconnects after focus moves, on close, and on board destruction. Escape now reaches the overlay's existing handler even while the deferred body is pending. A board regression spec at `canvas-rail-board.component.spec.ts:1093` covers Escape from the focused split dialog before the inspector renders.

### 3. Compact sheet Tab

`canvas-rail-board.component.ts:43-47,734-747` permits controls whose nearest overlay is the sheet dialog while still excluding nested overlays, hidden, disabled, and inert controls. Before the deferred dialog exists, Tab stays on the focused sheet wrapper. The board spec at `canvas-rail-board.component.spec.ts:1107` covers focus moving to the deferred close button and Tab wrapping inside the sheet.

### 4. Compact sheet lane choice

`canvas-rail-board.component.ts:251,729-732` selects the requested lane and closes the opaque compact sheet, revealing the pane. The same board spec checks the lane call and sheet removal.

### 5. Rail closed-state limit cue

`canvas-rail-board.component.ts:172-174,335-340` forwards the focused session's existing stats aggregate and description through `canvas-focus-area.component.ts:45-47,95-97`. `canvas-focus-header.component.ts:192-229,319-329` renders the same conditional limit text, context ring, limit-aware dot, and `aria-describedby` description used by the chat-view header, only while details are closed. It uses the public `@ptah-extension/chat-ui` helpers and tokens. The existing workflow badge remains in place. `canvas-focus-header.component.spec.ts:60` checks closed and open states.

## Eager-import trace

- `canvas-rail-board.component.ts` imports the inspector only from `@ptah-extension/chat/inspector`; its class uses the symbol only in Angular `imports`, with template references inside `@defer` blocks at lines 182, 200, 239, and 250.
- `chat/src/lib/components/index.ts` and the eager `chat/src/index.ts` no longer export the inspector component. The workflow badge export remains.
- `InspectorShellController` imports `SessionInspectorStore`, but neither imports the inspector component or `session-task-reader`. `SessionInspectorStore` imports `session-inspector.types` with `import type`; that types file imports `TaskStage` from `@ptah-extension/tasks-ui/presentation` with `import type`.
- `injectSessionStatsSource` uses chat UI stats helpers and does not import the inspector, `session-task-reader`, or the tasks UI presentation entry.
- `chat-view.component.ts:57,220` retains a relative inspector import solely for its Angular `imports` array; its inspector template references are deferred. No class method or field references the component symbol.
- The value imports of `session-task-reader` and `@ptah-extension/tasks-ui/presentation` remain inside the inspector TASK section tree, reached from the secondary entry.

## Files

- `tsconfig.base.json`
- `libs/frontend/chat/src/inspector.ts`
- `libs/frontend/chat/src/lib/components/index.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.spec.ts`

## Spec changes

Updated the existing board spec to import the inspector via its secondary entry and cover pre-defer Escape, post-defer focus, sheet Tab wrapping, and lane selection. Updated the existing focus header spec to cover closed limit text, ring, dot, description, and their removal while open. No new spec files. Jest/Nx execution was reserved for the orchestrator by the parallel-wave instruction.

## Diagnostics

`ptah_get_diagnostics` on the seven changed TypeScript files finished with **no diagnostics in requested files**. Its project-scope output reported 266 errors in sibling files outside FIX-2 ownership; those files were not edited. No build or test command was run. The initial bundle size remains for the orchestrator's measurement build to verify.

## Decisions

- **Secondary entry:** Chose a `tsconfig.base.json` alias and single `inspector.ts` export over a project/Jest/ESLint change. Evidence: the existing `tasks-ui/presentation` secondary entry has only the path mapping. Reversible.
- **Late focus:** Chose immediate shell focus plus one temporary observer over coupling the Rail board to the chat-view inspector controller's modal state. Evidence: the Rail board does not bind that controller, and the close control is deferred. Reversible.
- **Cue source:** Chose the board's session stats aggregate passed through the focus area over a second data source in the header. Evidence: `chat-view` uses the same `limitAwareDot` and `inspectorToggleDescription` helpers with the stats aggregate. Reversible.

## Clarifications Needed

None.

## Follow-up (test fix)

- **Cause:** The compact sheet already focuses its shell before the deferred inspector exists, then a `MutationObserver` moves focus to the close button. `fixture.whenStable()` does not wait for that observer callback, so the assertion sampled focus one task too early. The component focus behavior was correct; a render-hook replacement failed the early-focus checks and was reverted.
- **Change:** `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:1125` allows the observer callback to run before asserting that the close button has focus. At line 1129 the test now checks Shift+Tab wraps from the first button to the last, as well as Tab wrapping back to the first. The assertions still require focus to move into and stay within the sheet. No production file was changed in this follow-up.
- **Final checks:** `nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` passed: 22 suites, 373 tests. The orchestrator's earlier chat, chat-ui, canvas and e2e typecheck and lint passes remain applicable; this follow-up changed only the spec.
