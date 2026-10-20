# Code Logic Review — TASK_2026_705_9d53

Verdict: REVISE  
Score: 4/10  
Review family: codex (implementer: Claude)

## Summary

| Metric | Value |
| --- | --- |
| Assessment | NEEDS_REVISION |
| Blocking | 2 |
| Serious | 1 |
| Moderate | 1 |
| Failure modes | 4 |

The stored `single` value is ignored and the notification cap result keeps the panel open. The removal also makes canvas-only routing mandatory, exposing four paths that leave a requested session or tab invisible. The score is below the 5–6 band because two user actions report success or finish without an opened surface. It is above the 1–2 band because the main canvas and notification paths remain functional.

## Numbered findings

1. **Blocking — Tasks “Open session” silently loses a failed canvas open.** `libs/frontend/chat/src/lib/services/chat-store/session-open-bridge.service.ts:30-34` clears the request, navigates, and discards the `Promise<boolean>`. At the 20-tile cap, an invalid session ID, or an unmounted canvas, `AppStateManager.requestCanvasSession` returns `false` (`libs/frontend/core/src/lib/services/app-state.service.ts:1180-1196,1211-1222`), while the bridge has already acknowledged the request. The new spec explicitly accepts this (`session-open-bridge.service.spec.ts:92-101`). The Tasks caller cannot tell the user that nothing opened. **Fix:** preserve the result through the request/bridge contract and show or return a failure; keep the request until it is handled or explicitly failed.

2. **Blocking — Branch reports success when no tile opens.** `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1462-1465` starts `requestCanvasSession` without awaiting it, then immediately displays “Branch created.” A full canvas, missing consumer, or session load failure resolves the request `false` (`libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:354-373`; `libs/frontend/core/src/lib/services/app-state.service.ts:1180-1192`). The backend may have created the fork, but the user sees success with no accessible branch tile. **Fix:** await the tile result and distinguish “fork created but could not open” from a fully opened branch; offer a way to open the created session later.

3. **Serious — New workflow/task tabs can become invisible while launch reports success.** `libs/frontend/chat/src/lib/services/workflow-tab-launcher.service.ts:40-53` creates a tab, queues a tile, scopes the composer prefill to that tab, and returns `landed`. `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts:59-84,90-93` likewise resolves success after queuing. The canvas silently drops the request on a workspace mismatch or `adoptTab` refusal (`libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:450-464`); `requestCanvasTab` has no result channel (`libs/frontend/core/src/lib/services/app-state.service.ts:1291-1315`). At the tile cap, the prompt is attached to a tab with no rendered composer. This is an existing grid limitation that becomes the only VS Code route after removal. **Fix:** make tile adoption acknowledge success/failure, then gate `landed`/prompt success and prefill on an actual tile or present a recoverable cap error. Apply the same acknowledgment to the harness-builder request at `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:434-445`.

4. **Moderate — Keyboard tab actions no longer match the visible canvas.** `libs/frontend/chat/src/lib/services/keyboard-shortcuts.service.ts:42-57,66-69,74-95` creates, closes, and cycles bare `TabManagerService` tabs; the app shell installs those shortcuts at `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:132-133`. The canvas adopts existing tabs at initial hydration, but newly created tabs require a tile request (`libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:343-347,434-464`). Ctrl/Cmd+T therefore selects a tab without a tile; Ctrl/Cmd+Tab can select another unseen tab while the canvas focus remains elsewhere. The parity inventory identifies this existing grid gap at `parity-inventory.md:91`, but the removed single view was the visible fallback in VS Code. **Fix:** route keyboard creation and selection through canvas tile operations, or disable shortcuts that cannot produce a visible tile; cover the cap case.

## Five logic questions

1. **Silent failure:** findings 1 and 3; the result is discarded or unavailable after the UI action is accepted (`session-open-bridge.service.ts:30-34`; `orchestra-canvas.component.ts:454-464`).
2. **Unexpected user action:** Branch from a message at tile cap reports “Branch created” without opening it (finding 2, `chat-view.component.ts:1462-1465`); Ctrl/Cmd+T makes an invisible tab (finding 4, `keyboard-shortcuts.service.ts:66-69`).
3. **Wrong answer from input data:** A valid session ID presented while 20 tiles exist yields a success-looking Branch or Tasks flow despite `false` from the canvas (`app-state.service.ts:1180-1196`; findings 1–2).
4. **Dependency failure/timeout/shape:** When canvas is absent for five seconds, `requestCanvasSession` settles `false` (`app-state.service.ts:1211-1222`), which findings 1–2 ignore. Notification focus does settle a missing result after five seconds (`app-state.service.ts:1252-1263`), and its caller retains the panel (`notification-center.component.ts:271-283`).
5. **Unstated requirement:** Every user-facing tab opener needs a visible tile or a recoverable failure now that there is no single view (`workflow-tab-launcher.service.ts:40-53`; `keyboard-shortcuts.service.ts:66-69`).

## Risk audit

| Risk | Evidence | Result |
| --- | --- | --- |
| 1. Each batch stands alone | `git show --stat` for 56451fc0b, 8e4fc7cb3, 56fccb725, 1264d3d41; batch 1 deletes tab-bar consumer/export before batch 4 removes chat-ui leaves; batch 2 deletes the header with its chat-view consumer; batch 3 removes the remaining layout API/callers. Static import/export inspection found no dangling reference. | Static OK; compilation unverified because commands were prohibited. |
| 2. Stale `single` lands on canvas | `app-state.service.spec.ts:198-208`; `app-shell.component.html:330-347` mounts canvas unconditionally. | OK. |
| 3. Notification cap and callers | `notification-focus-coordinator.service.ts:39-47` returns canvas result; `orchestra-canvas.component.ts:533-556` returns `cap-reached`; `notification-center.store.ts:43-56` and `notification-center.component.ts:271-283` close only on success. | OK. |
| 4. Chat routing and no invisible tab | `session-open-bridge.service.ts:30-34`; `chat-view.component.ts:1462-1465`; `workflow-tab-launcher.service.ts:40-53`; `keyboard-shortcuts.service.ts:66-95`. | Findings 1–4. |
| 5. Harness builder tile | `harness-builder-view.component.ts:434-445` always queues the tile. | Queue OK; refusal shares finding 3. |
| 6. Capability parity | `parity-inventory.md:44-116`, `decisions.md:2-9`; approved deletions include `focusQuestionCard`/`openLaneFromInspector`. Rail remains mounted in canvas (`app-shell.component.html:330-347`). | Approved removals respected; visible-tab parity gap in findings 3–4. |
| 7. Stubs/placeholders | Added lines in `git diff 15fe6031a..HEAD` contain no TODO/PLACEHOLDER/STUB or mock replacement. Existing `app.config.ts:179` TODO is unchanged. | OK in changed lines. |

## Decisions and limits

- **Decision:** Treat the canvas-only tab routes as requiring visibility or an explicit failure. Options were to accept the existing grid-only gaps or close them in this removal. Evidence: `context.md` requires both hosts always use the canvas; `parity-inventory.md:91` acknowledges the shortcut gap; `orchestra-canvas.component.ts:450-464` acknowledges silent refusal. This is reversible and does not expand the approved removals.
- No Nx, Jest, build, e2e, or diagnostics command was run, per the review request. Risk 1 is a static boundary check, not a compilation claim. The four findings rely on code paths and existing specs rather than a runtime reproduction.

## Verdict

**REVISE.** Return tile adoption/session-open outcomes to the initiating UI and align keyboard tab actions with canvas focus. Then verify the four failure cases at the changed-project level.
