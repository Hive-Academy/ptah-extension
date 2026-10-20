# Batch A7 — renderer host consumer

## Files changed

- Created `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.ts` and its spec.
- Updated `apps/ptah-extension-webview/src/app/app.config.ts` to register the handler, action dispatcher, root focus router, and one source initializer.
- Updated `libs/frontend/chat/src/lib/services/index.ts` to export the three A7 integration services and `NotificationFocusCoordinator` for root routing.

## Routing and reconciliation

- The handler validates `attention:changed` with `AttentionChangedPayloadSchema`. An upsert projects the safe notice into `NotificationService`; a matching resolve removes it. Older generations and a replay after resolve are ignored.
- The handler validates `attention:openTarget` with `AttentionOpenTargetPayloadSchema`, then reads `attention:getSnapshot` with a five-second RPC timeout. Only a still-pending matching key, generation, and target can reach the focus router. A stale click reports “Already answered”. Invalid payloads and RPC failures are logged with fixed messages, without private payloads or raw errors.
- Bootstrap, window focus, and document reveal reconcile against the validated snapshot. Missing host projections are removed; missed pushes are added. If a push arrives while the snapshot is in flight, reconciliation repeats so the older response cannot overwrite it.
- A target is mapped to a local workspace through its matching tab or session. In the VS Code single-workspace view, a matching tab/session permits the configured workspace root. An unresolved owner remains counted with Open disabled. `surfaceMode` is marked as surface-owned and has Open disabled because the current wire has no owning surface identifier.
- The root `NOTIFICATION_FOCUS_ROUTER` binding uses the existing `NotificationFocusCoordinator`; the shell's local binding continues to serve its own children.

## Verification

- `ptah_ast_analyze` parsed the new handler, spec, and app config without syntax errors.
- Scoped `ptah_get_diagnostics` was requested after edits, but the TypeScript check remained in progress past its 45-second service limit and returned **unavailable**. It did not report a pass or errors.
- Nx, Jest, and tsc were not run because the orchestrator owns the shared check slot. The spec is written but unexecuted.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Bind the existing focus coordinator at the root as well as in the shells | The message handler is created by root `MESSAGE_HANDLERS` and cannot see a component-scoped token. `NotificationFocusCoordinator` is already root-provided and implements the token contract. | Yes |
| Resolve local workspace from a matching tab/session and disable Open when no owner is found | The A6 wire carries an opaque `workspaceId`, while current renderer workspace APIs expose paths and tab/session ownership, with no opaque ID lookup. Using the active workspace could open the wrong project. | Yes |
| Keep `surfaceMode` requests visible with Open disabled | The wire supplies only a boolean, no surface route ID; the existing focus coordinator always selects chat. Selecting an arbitrary surface would misroute a request. | Yes |
| Recheck a host click against a fresh snapshot | A queued native click can outlive the request; the authoritative snapshot is the available pending check. | Yes |

## Not done / integration gaps

- A6/B producer must define how opaque `workspaceId` maps to a renderer workspace and identify the owning surface for `surfaceMode` navigation. Until then, tab/session lookup is the only safe local path and surface Open remains disabled.
- Host and local chat source use independently supplied keys. Their identity agreement needs integration review to ensure one bell row per authoritative request when both projections are active.
- The orchestrator still needs to run the chat/webview checks and address any diagnostics they report.
