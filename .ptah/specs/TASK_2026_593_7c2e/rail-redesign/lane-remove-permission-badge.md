# Permission badge preserve check

## Evidence

- `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:275-301` derives `unmatchedPermissions` from the full permission queue, excludes surface-only prompts, and retains a request when its target tab is no longer live. The regression case at `libs/frontend/chat-streaming/src/lib/permission-handler.service.spec.ts:498-506` explicitly expects fallback display after the only target tab closes. `libs/frontend/chat/src/lib/services/chat.store.ts:117` exposes that computed queue to the badge at `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:136-140`.
- `libs/shared/src/lib/types/permission.types.ts:69-73` makes both `sessionId` and `tabId` optional. `libs/frontend/chat-routing/src/lib/stream-router.service.ts:427-455` can return with no bound tab, including a request without `sessionId`; its comment and `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:353-360` describe the global fallback. A session ID by itself is not proof of a live tab: `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts:110-113` resolves it only through `findTabBySessionIdAcrossWorkspaces`.
- `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts:64-71` creates an attention item for every queued permission, but lines `156-159` disable Allow/Deny when `findTabId` returns no tab. `libs/frontend/chat/src/lib/services/chat-attention-action-dispatcher.service.ts:28-32,70-76` rejects the disabled action or missing tab. Thus the bell, snackbar, and rail display the request but cannot answer it in that state.
- For a live tab, the routes converge: the attention dispatcher calls `AgentPermissionResponder.respondSession` at `libs/frontend/chat/src/lib/services/chat-attention-action-dispatcher.service.ts:75-76`, which calls `PermissionHandlerService.handlePermissionResponse` at `libs/frontend/chat/src/lib/services/agent-permission-responder.ts:60-69`. The badge calls `ChatStore.handlePermissionResponse` at `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:137-140`, which reaches the same handler at `libs/frontend/chat/src/lib/services/chat.store.ts:482-484`. The handler posts `SDK_PERMISSION_RESPONSE` and accepts an omitted tab at `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:431-459`.

## Proposed Removals

- **Deferred:** remove the badge usage, component, imports, and exports only after attention Allow/Deny supports queued unmatched requests without a live tab. A narrow fix is to let the session permission responder pass the request ID and decision to `handlePermissionResponse` without a tab when ownership is still valid, then expose enabled actions for that case. Confirm routing and stale-request behavior before deleting the fallback.
- Repository search found one rendered use, at `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:137`; the component also appears as imports in `chat-view.component.ts:37,181` and exports in `libs/frontend/chat/src/lib/components/index.ts:89` and `libs/frontend/chat-ui/src/index.ts:104`. No VS Code-only component use was found. `tools/mcp-bench/questions/7910f34cf/{file-tools,dependents}.json` contains path metadata only.

## Blockers

- Preserve check failed: a queued unmatched permission may have no live tab, and attention Allow/Deny is disabled in that case. Removing the badge now would remove the only demonstrated answer path for that request. No source or spec was changed; no diagnostics or CI command was run.

## Decisions

- **Keep the badge for now.** Options were immediate removal or fixing the no-tab attention action first. The closed-tab regression test and the disabled action in the attention source establish a concrete behavior loss. This is reversible after the attention path can answer the same queue.
