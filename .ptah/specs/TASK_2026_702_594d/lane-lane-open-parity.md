# Lane permission Open parity

## Design

The bell and snackbar use `ChatAttentionActionDispatcherService.dispatch` for Open. It retains the existing `NOTIFICATION_FOCUS_ROUTER` session focus, then uses the `ATTENTION_LANE_OPENER` injection token (`libs/frontend/core/src/lib/tokens/attention-lane-opener.token.ts:8`) for a live lane-permission item. The token is bound to the canvas implementation in `apps/ptah-extension-webview/src/app/app.config.ts:223`. A mounted `CanvasDetailService` registers with that root bridge and unregisters on destroy (`libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.ts:20-22`). The bridge calls `CanvasDetailService.open(tabId, \`cli:${agentId}\`)`, the same argument shape as the deleted chip.

The owning session is focused first through `NotificationFocusCoordinator`. If the lane is gone, `CanvasDetailService.open` returns false, the dispatcher logs a safe warning, and the focused session remains available. The detail bridge is imported through the light `@ptah-extension/canvas/focus` secondary entry.

## Changes

- `libs/frontend/core/src/lib/tokens/attention-lane-opener.token.ts`, `libs/frontend/core/src/index.ts`: typed focus extension token.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-attention-lane-opener.service.ts`, `libs/frontend/canvas/src/focus.ts`: canvas implementation and secondary export.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.ts`: register each mounted detail service with cleanup.
- `libs/frontend/chat/src/lib/services/chat-attention-action-dispatcher.service.ts`: route live lane Open after session focus and log fallback.
- `apps/ptah-extension-webview/src/app/app.config.ts`, `tsconfig.base.json`: register the provider through the secondary entry.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.spec.ts`, `libs/frontend/chat/src/lib/services/chat-attention-action-dispatcher.service.spec.ts`: exact lane, unresolved lane, and non-lane Open coverage.

## Decisions

- Used a core injection token with a canvas provider, following the existing focus-router DI pattern. Core cannot import canvas under the Nx project tags (`type:core` versus `type:feature`); this is reversible by replacing the provider if the routing contract changes.
- Kept session focus as the first step, preserving workspace switch, tile adoption, and cap handling in `NotificationFocusCoordinator`; the detail service only opens a lane after focus succeeds. This is reversible.
- Registered component-scoped detail instances with a root canvas bridge because `CanvasDetailService` is provided on `OrchestraCanvasComponent`. This avoids editing that component and releases instances on destroy. This is reversible.
- Used `cli:${agentId}` as the lane key, matching the deleted chip's `laneKey('cli', agentId)` and the current lane-key implementation. This is reversible.
- Host-only projected notices do not include an agent ID in their public attention item; this change routes live chat lane-permission items, whose target includes it.

## Projects to check

- `@ptah-extension/core`
- `@ptah-extension/canvas`
- `@ptah-extension/chat`
- `ptah-extension-webview`

No Nx, Jest, build, or other test command was run as instructed. `ptah_get_diagnostics` was requested twice; TypeScript remained unavailable while indexing, so diagnostics did not verify these edits.
