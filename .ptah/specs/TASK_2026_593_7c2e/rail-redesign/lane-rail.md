# Canvas rail Needs you queue

## Changed files

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`: passes the active workspace to the rail; accounts for expanded attention cards in geometry sampling and scroll anchoring.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts`: adds the compact, three-row queue, overflow route to the bell, and authoritative item/action projection.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts`: adds the Needs you chip, pending preview, inline Answer/Allow/Deny, and count link.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts`: covers local projection, dispatch identity, and resolution removal.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.spec.ts`: covers chip and inline action emission without session selection.

## Data and action wiring

- `canvas-rail-board.component.ts:115` supplies `workspacePath`; `canvas-rail.component.ts:329` reads `NotificationService.needsYou()` and retains items belonging to the active workspace and a current tile. `canvas-rail.component.ts:345` resolves session identity through `TabManagerService` because `CanvasTile` stores only `tabId`.
- `canvas-rail.component.ts:185` renders up to three oldest local requests with native list semantics, safe interpolated detail, and the item's authoritative actions. `canvas-rail.component.ts:329` opens the existing notification bell for overflow.
- `canvas-rail.component.ts:369` dispatches the item key, generation, and action ID through `ATTENTION_ACTION_DISPATCHER`. It guards duplicate submissions and stale generations, and reports stale/unavailable outcomes without copying request lifecycle state. The same `NotificationService` resolution removes the queue row and card chip. `canvas-rail.component.ts:341` restores focus to the next request action or Sessions heading after a direct response removes the active row.
- `canvas-rail.component.ts:256` passes each tile's items to `canvas-rail-card.component.ts:350`; the card emits its first request's inline action to the rail dispatcher. Question Answer remains a routing action, not an automatic answer.
- `canvas-rail-card.component.ts:72` expands an attended card and gives inline actions 44 px minimum height; `canvas-rail-board.component.ts:696` excludes that deliberate expansion from the geometry shift metric and uses the rendered card position when anchoring a mixed-height list.

## Module boundary check

`libs/frontend/canvas/project.json:7` marks canvas `scope:webview` and `type:feature`. New cross-library imports are `@ptah-extension/core` and the already used `@ptah-extension/chat` `TabManagerService`; there is no import from `notification-center` or a new dependency on chat UI implementation. Overflow locates the existing bell button in the same document.

## Removed queue parity

Restored oldest-first local pending list, session association, direct permission Allow/Deny, question routing, Show in canvas via the source action, and a duplicate-submit guard. The removed queue's own request builder, responder, open state, and independently maintained answering set were not restored; the authoritative core item and dispatcher now own those behaviors. Empty rail queue is hidden as requested. Requests without a reliable current tile remain in the global bell.

## Decisions

- **Workspace membership:** match both workspace path and current tile tab/session ID. Alternatives were path alone or rebuilding ownership from chat queues. The approved spec requires reliable local ownership and `CanvasTile` lacks a session ID. This is reversible.
- **Overflow:** click the existing bell control using its stable `data-testid`. Alternatives were a new cross-feature service or importing notification-center. The shell already owns the bell, and the requested boundary prohibits that import. This is reversible.
- **Card height:** expand only cards with requests and compensate in rail geometry. Alternatives were clipping the preview inside the fixed-height card or changing a shared chat UI primitive. The design calls for an inline preview and action. This is reversible.

## Verification and remaining limits

Scoped `ptah_get_diagnostics` reported no errors in the five changed files. Nine pre-existing diagnostics remain in untouched core testing and shared files. Nx, Jest, lint, build, and visual comparison were not run per task instruction. Focus restoration and narrow-width layout were checked in source and diagnostics only; browser behavior remains for CI or visual review to verify.
