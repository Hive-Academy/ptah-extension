# Batch 2B — canvas board and rail

## Files changed

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts` and `.spec.ts`: added the empty-board Aurora hero, shared Get ready card, up to three recent-session cards, one in-flow board notice, and focused coverage.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts` and `.spec.ts`: made the footer New session action secondary and emit its actual button, with a payload spec.

## Public contract for 2C

`CanvasRailBoardComponent` has `notice = input<CanvasBoardNotice | null>(null)`, `noticeDismissed = output<string>()`, and `newSessionRequested = output<HTMLElement>()`. The exported `CanvasBoardNotice` interface has `kind: 'write-failure' | 'read-only' | 'cap'`, `text: string`, and `key: string`; dismissal emits `key`. `write-failure` and `read-only` render `role=alert`; `cap` renders `role=status`. The shell should supply the exact notice text and a key that changes when its source instance refreshes. The hero emits its button as the New session anchor; the board forwards the rail button unchanged.

`CanvasRailComponent` now has `newSession = output<HTMLElement>()`. Its footer action carries `data-testid="canvas-footer-new-session"`, remains focusable at a limit, and emits only when permitted. The hero has `data-testid="canvas-hero-new-session"` and the same cap guard. The existing previous-session action remains in the rail.

The board calls `RecentSessionsStore.load(workspacePath)` while visible, reads its confirmed three-session list, and passes a selected session to `SessionRowActionsService.openSession`. A failed or rejected open announces a safe error and leaves the card visible. Empty-board DOM places main before the rail while CSS keeps the rail left; populated DOM retains rail before the pane. Both views scroll within the board viewport.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use one `ng-template` for the rail in both DOM orders | Duplicate rail markup; shared template | Plan allows empty main before aside and requires populated order; one template keeps rail bindings identical | Yes |
| Give `CanvasBoardNotice.kind` explicit source classes | Generic alert/status; source-specific union | Plan distinguishes write failure, read-only, and cap with two ARIA severities | Yes |
| Use the shared setup card without copying readiness state | Board-local checklist; shared card | Batch 1A confirms the card derives readiness, count, and Ready strip from its store | Yes |

## Verification and limits

Scoped `ptah_get_diagnostics` reported no diagnostics in the four requested files; it reported seven existing errors in sibling files outside this batch. No Nx, Jest, TypeScript CLI, build, or e2e command was run, per the orchestrator's single-check-slot instruction. The Angular template and runtime specs still need the orchestrator's check. Shell wiring, notice selection and source-key generation belong to 2C.
