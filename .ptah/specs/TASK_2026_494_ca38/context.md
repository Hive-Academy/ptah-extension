# Context

Parent research: `.ptah/specs/TASK_2026_490_583c/research-report.md`. Read Revision 4 and Revision 5 first. They replace the earlier revisions
where they disagree.

Lane A. Depends on: TASK_2026_492 (design), TASK_2026_493 (contract).

## Deliverables

1. Frontend feature lib for the page (`scope:webview`, `type:feature`) and a UI lib for the catalog renderer (`scope:webview`, `type:ui`). Signals, standalone, OnPush.
2. New `ViewType` and one tab in `electron-shell.component.ts`. The VS Code shell must not reach the view.
3. The page registers an interactive surface in `StreamingSurfaceRegistry`, as the harness builder does (`harness-builder-view.component.ts:306,315`).
4. Sort, filter and page operate in the component and do not call the model.
5. The app sends its selection state to the host, so the agent context has it.
6. Accessibility from the design specification. Invalid, oversized or old specs show the text fallback.

## Gate

Cold start time does not change when the page is not open (lazy load).

## Source

`.ptah/specs/TASK_2026_490_583c/research-report.md` Revision 4 Track A and Revision 5. `.ptah/specs/TASK_2026_490_583c/ptah-integration-seams.md` sections 3, 4, 6.
