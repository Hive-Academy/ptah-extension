# Phase A fix F1 report

## Changes and evidence

| Finding | Fix | File:line | Covering spec |
| --- | --- | --- | --- |
| B1 | Empty workspace paths remain in the model; ownerless Open is disabled. | `libs/frontend/core/src/lib/services/notification.service.ts:72`; `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts:122` | `chat-attention-source.service.spec.ts` ownerless real-model case |
| B2, Moderate 10 | Reconciliation runs untracked, skips unchanged items, and updates suppression only when needed. | `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts:33,88`; `libs/frontend/core/src/lib/services/notification.service.ts:179` | `chat-attention-source.service.spec.ts` real-model loop case |
| S2 | Host-only Open routes through the host handler's snapshot guard. | `libs/frontend/chat/src/lib/services/chat-attention-action-dispatcher.service.ts:24`; `chat-attention-host-message-handler.service.ts:61` | `chat-attention-action-dispatcher.service.spec.ts` host-only case |
| S3, Minor 14 | Disabled Allow/Deny carries a reason; failed/stale actions set a short status. Optional typed `dispatchOutcome` retains the boolean API for existing callers. | `chat-attention-source.service.ts:142`; `chat-attention-action-dispatcher.service.ts:19,58`; `libs/frontend/core/src/lib/tokens/attention-action-dispatcher.token.ts:3` | dispatcher stale/host and source ownerless specs |
| S6 | Inline suppression has an independent reason and refreshes on request, active/visible tab, window focus and document visibility changes. | `notification.service.ts:179`; `chat-attention-source.service.ts:34,96` | core reason and chat focus specs |
| S7 | Shared safe request keys; core merges sources under one key with chat presentation priority and source-scoped resolve. | `libs/shared/src/lib/types/messages/attention-identity.ts:4`; `notification.service.ts:27,72,122` | shared identity and core both-resolve-orders specs |
| S8 | Shared path-free workspace hash, wire `surfaceKind`, focus router token, host target validation and surface routing. | `attention-identity.ts:27`; `attention.ts:7`; `schemas.ts:24`; `libs/frontend/core/src/lib/tokens/surface-focus-router.token.ts:1`; `chat-attention-host-message-handler.service.ts:164,198` | shared wire/identity and host Open specs |
| S9 | Catch sites classify error name only and use named failure handlers; audit returns to baseline. | `chat-attention-action-dispatcher.service.ts:63`; `chat-attention-host-message-handler.service.ts:113,117,244` | dispatcher failure, host retry/privacy specs; audit 294 |
| Moderate 1, 2, 4 | Host resolve accepts newer generation, failed snapshot retries after 2s, mismatch gives status. | `chat-attention-host-message-handler.service.ts:118,190,230` | host newer resolve, retry, mismatch specs |
| Moderate 3 | Incoming title is truncated at 120 characters after validation. | `libs/shared/src/lib/types/messages/schemas.ts:34` | `attention.spec.ts` long-title case |
| Moderate 5 | Chat generations use one sequence instead of a per-request map; responder prunes answered ids; host targets are removed on resolve and generation floors are bounded at 256 to reject stale pushes. | `chat-attention-source.service.ts:30,130`; `agent-permission-responder.ts:20`; `chat-attention-host-message-handler.service.ts:38,82,190` | source reincarnation, responder, host stale-push specs |
| Moderate 6, 9 | Core rejects local info/success entries and evicts hidden Recent notices first. | `notification.service.ts:73,105` | core transient-rejection and hidden-eviction specs |
| Minor 13 | Permission response returns a boolean for no-longer-pending requests. | `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:431` | `permission-handler.service.spec.ts` missing-request case |
| Wrong specs | Default bootstrap RPC returns no notices; bootstrap is flushed before mocks are cleared. | `chat-attention-host-message-handler.service.spec.ts:22,53` | host handler suite |

## API notes for F2 and B3a

- `attentionRequestKey(kind, requestId)` and `workspaceIdFromPath(path)` are exported from `@ptah-extension/shared`. Core re-exports `attentionRequestKey`; the old three-argument form is gone. B3a must use these same helpers for host projection.
- `NotificationService.resolve(key, generation?, source?)` accepts a source. Chat and host call it with `'chat'` and `'host'`. `setSnackbarSuppressed(key, suppressed, reason = 'panel')` supports `'inline'` independently; existing two-argument panel calls still work.
- `AttentionTarget.surfaceKind` is optional and restricted to `setup-wizard | harness-builder | mcp-apps`. `SURFACE_FOCUS_ROUTER` and `SurfaceFocusRouter` are exported from core. A surface registers a router and supplies `canFocus(sessionId)` plus `focus(sessionId)`.
- `AttentionActionDispatcher.dispatch` still returns `Promise<boolean>`. `dispatchOutcome` is an optional typed API (`completed | stale | unavailable`) for F2 to consume. Current failure feedback also uses `AppStateManager.setStatusMessage`.
- Host Open now verifies `workspaceIdFromPath(localPath) === target.workspaceId`; fixtures and B3a host producers must create matching IDs.

## Verification

- Shared attention spec: 12 passed.
- Core notification spec: 13 passed.
- Chat attention specs: 4 suites, 23 passed; subsequent focused source, host and dispatcher specs passed (6, 9 and 5 tests respectively).
- Chat-streaming permission handler spec: 64 passed, 1 pre-existing skip.
- Degradation audit: **294**, baseline **294**.
- `ptah_get_diagnostics` was called after edits, but its TypeScript worker timed out and later reported unavailable. The orchestrator's typecheck remains the type gate.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Keep boolean dispatch and add optional typed outcome | Changing the existing result would require an F2-owned bell store edit; status is surfaced now, and F2 can adopt `dispatchOutcome`. | Yes |
| Bound host generation tombstones to 256 | Immediate deletion lets an old push resurrect a resolved row (host regression spec); a bounded floor rejects recent stale pushes without unbounded per-request state. | Yes |
| Reject info/success in core | Decision #12 marks these local-only and the current core has no persistent Recent semantics for them. | Yes |

## Remaining integration work

- Surface components have not registered `SURFACE_FOCUS_ROUTER` or supplied conversation bindings; those files are outside F1 ownership. Surface Open remains disabled until they do.
- Host workspace resolution currently uses local tab/session lookups and VS Code's workspace root. Mapping partition keys without a tab is still needed in the owner integration outside this lane.
- F2 owns bell/snackbar consumption of `dispatchOutcome` and its own status presentation. The boolean dispatch path already sets a status for unavailable actions.
