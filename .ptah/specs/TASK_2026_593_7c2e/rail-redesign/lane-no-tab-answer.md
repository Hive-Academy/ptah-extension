# Closed-tab permission attention path

## Answer path

- Before: `chat-attention-source.service.ts:156-159` disabled Allow/Deny without a live tab; `chat-attention-action-dispatcher.service.ts:75` refused a missing `target.tabId`. The badge in `chat-view.component.html:137-140` called `ChatStore.handlePermissionResponse` directly.
- After: `chat-attention-source.service.ts:156-161` enables Allow/Deny for queued session permissions without a tab while keeping Unknown tool disabled and Show in canvas disabled when no session can open. `chat-attention-action-dispatcher.service.ts:33-37,80` checks the pending request and passes the optional tab to `AgentPermissionResponder.respondSession`; `agent-permission-responder.ts:60-74` rechecks the queue and calls `PermissionHandlerService.handlePermissionResponse`.
- The backend response is identical: the old badge went through `chat.store.ts:482-484` to `PermissionHandlerService.handlePermissionResponse`; the attention responder now calls that same method with `{ id, decision }`. `permission-handler.service.ts:431-436` sends `SDK_PERMISSION_RESPONSE` with that response and accepts an omitted tab. Its queue guard at line 432 sends nothing for a withdrawn request. `dispatchOutcome` returns `stale` for a queued item that has since left the handler queue.

## Removals and verification

- Removed the badge template block, the `ChatViewComponent` import and standalone dependency, both public exports, and `libs/frontend/chat-ui/src/lib/molecules/permissions/permission-badge.component.ts`. No badge spec existed. A repository search excluding documentation and JSON found no remaining `PermissionBadgeComponent`, `ptah-permission-badge`, or `permission-badge.component` references.
- Kept `unmatchedPermissions` in `PermissionHandlerService` and `ChatStore`; other specs still read it.
- Added closed-tab action coverage in `chat-attention-source.service.spec.ts:102`, Allow/Deny and stale dispatcher coverage in `chat-attention-action-dispatcher.service.spec.ts:69-78`, no-tab responder coverage in `agent-permission-responder.spec.ts:90`, and exact SDK payload coverage in `permission-handler.service.spec.ts:160`. Retargeted its closed-tab regression at line 508 to assert the request remains queued for attention.
- No Nx, Jest, tsc, lint, or build command ran, as requested. `ptah_get_diagnostics` completed with 379 errors across the affected projects; it reported no errors on new or changed lines. Reported errors in requested files were on preexisting lines (`permission-handler.service.spec.ts:16,149,566,822` and `chat-attention-source.service.spec.ts:315,337`). CI verification remains outstanding.

## Decisions

- Reused `AgentPermissionResponder` and the existing permission handler instead of adding a second transport path. The handler already accepts an optional tab and owns stale-request validation. Reversible.
- Kept `unmatchedPermissions` because existing specs and `ChatStore` still reference it. Reversible.
