# Batch 5: sheet bar and sub-agent lane

## Files changed

- `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.ts` — hide the sheet host until its tab is open or has a surface or summary.
- `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.spec.ts` — cover all four visibility states and retain the existing bar interaction checks.
- `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts` — pass a lane-only height input to the top-level inline agent bubble and complete its flex path.
- `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts` — let the Canvas bubble and its scroll container fill the available height while keeping the default scroll limit.
- `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.spec.ts` — check both default and fill-height content classes.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` — give the sub-agent lane a bounded flex column and request a full-height execution node.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts` — check the lane passes `fillHeight=true` to its execution node.
- `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts` — seed display content for bar interaction checks and expect an empty switched tab to be hidden.
- `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts` — seed display content for the rail bar assertions.

## Decisions

- **Visibility source:** use `DisplayDockTabState.summaries.size`, alongside `surfaces.length` and `open`; `DisplaySheetState` stores height mode only. Options were the tab's summary map or the currently selected summary. The map represents any turn summary, as the requirement asks. Reversible.
- **Height propagation:** pass `fillHeight` from the Canvas sub-agent lane to its top-level `ExecutionNodeComponent` and bubble only. Recursive nodes omit the input, preserving their default inline size. Reversible.
- **Collapse sizing:** expand the bubble's grid wrapper within the flex column only while uncollapsed; keep the existing `0fr` collapse transition. Reversible.
- **Existing empty-session assertions:** seed a surface where the spec is testing bar interaction; assert a hidden host where it is testing an empty switched tab. Reversible.

## Verification and remaining work

- `ptah_ast_analyze` reported `parseStatus: ok` and zero error nodes for all nine edited TypeScript files.
- Tests, builds, typecheck, lint, and `ptah_get_diagnostics` were not run because the task explicitly prohibits test and typecheck execution. The orchestrator owns scoped checks.
- `chat-session-layout.component.spec.ts` already opens the sheet before asserting its bar, so it needed no edit.
