# Batch 8b: Electron IPC approval ownership

## Files changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/ipc/ipc-bridge.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/ipc/ipc-bridge.codex-permission.spec.ts (new)
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/frontend/chat/src/lib/services/chat-message-handler.service.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/shared/src/lib/types/messages/payload-map.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8b-report.md

## Reply routing

Electron validates the four permission wire decisions before routing. It resolves SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS and narrows its optional handlePermissionResponse method with object/in/typeof checks, without casts. A true result consumes the reply. Null, a missing/non-callable method, or false falls through to the existing registered Claude handler. Exceptions retain the real Error in console.error; non-Error thrown values are normalized to Error. Unknown decisions are logged and refused before either handler.

The existing Codex mapping is unchanged and mirrors Batch 8c: allow -> accept; always_allow -> acceptForSession; deny_with_message -> decline; deny -> cancel.

## Pending-map cleanup (D4)

handlePermissionResponse now calls settle(id) before forwarding a known decision. This deletes the pending entry and releases its host notice with the original timestamp. Duplicate responses return false. A later cancelPrompt has no entry to cancel or broadcast; dismiss still publishes PERMISSION_AUTO_RESOLVED while settle performs no second release. The host-attention-ingress source guard's hostAttention?.resolve(attentionRequestKey(...)) emission-owner pattern remains intact.

## Prompt-cancelled handling

Registered PERMISSION_PROMPT_CANCELLED in both the handler's advertised types and message switch. The handler validates sessionId/requestId, finds the pending prompt matching both fields, and reuses handlePermissionAutoResolved to remove it and its routing targets locally. It never calls handlePermissionResponse. Added the missing typed payload-map entry referencing PermissionPromptCancelledPayload. Backend cancellation keeps using the original PERMISSION_REQUEST correlation id.

## Spec cases

- New Electron suite: all four decisions reach Codex first; owned replies do not reach Claude; null/missing/non-callable Codex handlers and unowned ids fall through; legacy response and payload envelopes; invalid decisions reach neither handler; thrown Error identity is preserved.
- Codex host ports: decision releases attention once; duplicate response returns false and does not call approvals.respond again; cancel after decision emits nothing; dismiss after decision still emits auto-resolved without a second release. Existing cancellation spec now also asserts no approvals response is sent.
- Frontend: cancellation is registered, matching session/correlation removes through the local auto-resolution path without a response, and unrelated sessions/ids and malformed payloads do not remove prompts or respond.

## Decisions

1. Decision: check session ownership before invoking existing prompt-id removal. Options: broaden ChatStore/PermissionHandlerService APIs or guard in the scoped message handler. Evidence: existing auto-resolution API only accepts id/toolName, and the writable scope excludes those store files. Codex correlation ids encode session identity. Reversible: yes, a future store API can accept a session explicitly.
2. Decision: resolve the Codex token directly and treat null as native-off. Options: direct resolution or an isRegistered fallback. Evidence: the task's DI contract guarantees the token resolves to null when native Codex is off. Reversible: yes; missing registration currently logs an Error and refuses the reply rather than silently hiding a composition defect.
3. Decision: settle before approvals.respond and preserve its boolean return. Options: settle before or after forwarding. Evidence: settle deletes correlation before downstream callbacks can dismiss/reenter; this preserves one attention release and the existing ownership result. Reversible: yes.
4. Decision: use a new Electron spec with a real child tsyringe container. Options: extend the existing agent permission spec or isolate the new SDK reply tests. Evidence: the existing fixture uses a prohibited double cast; the new suite needs no casts. Reversible: yes.

## Not verified

No Nx, Jest, TypeScript, lint, build, package, serve, development, or e2e commands were run, per lane instructions. No diagnostics tool was run. The team leader must run the focused Electron, rpc-handlers and chat specs, the host-attention-ingress source guard, and the required four-host typechecks under its machine-wide lock. Runtime/UI behavior and actual compiler acceptance remain unverified.

Reviewed the scoped diff and ran git diff --check successfully. No DI, bootstrap, shutdown, or other host files were edited; pre-existing parallel-lane DI modifications were left intact. Applied the local angular-frontend-patterns skill for the frontend change.
