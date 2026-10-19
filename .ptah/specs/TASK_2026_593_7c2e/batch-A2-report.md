# Batch A2 — chat attention source and action

## Files changed

- Created `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts` and `.spec.ts`.
- Created `libs/frontend/chat/src/lib/services/chat-attention-action-dispatcher.service.ts` and `.spec.ts`.
- Updated `libs/frontend/chat/src/lib/services/agent-permission-responder.ts` and `.spec.ts`.
- Updated `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts` and `.spec.ts`.

## Public API and integration

- `ChatAttentionSourceService` is root-provided. Inject it once in the shell to start its effect. It reconciles live chat permission, question, and lane permission queues with `NotificationService`; removal from authoritative state resolves the matching generation. `getLive(key, generation)` supplies the dispatcher with a checked target.
- `ChatAttentionActionDispatcherService` is root-provided and implements `AttentionActionDispatcher`. Register it for `ATTENTION_ACTION_DISPATCHER` in A7. It handles `allow`, `deny`, `answer`, and `open`; Answer focuses the existing question prompt. A7 needs an import path for this class: the chat public barrel is outside A2 ownership and was not changed.
- `AgentPermissionResponder.respondLane(agentId, requestId, decision, reason?)` retains its signature and answered-request guard. It also checks the authoritative lane queue before posting. `respondSession` now reports whether the request was still pending.
- Chat-streaming response handlers post before removing pending requests, so a transport throw leaves a request available for retry. Already withdrawn request IDs do nothing.
- No Finished notification is produced.

## Verification

- Scoped `ptah_get_diagnostics` found no errors in the changed chat source, dispatcher, or responder files. The chat-streaming diagnostic set reports pre-existing spec errors and many sibling errors; no new diagnostic was reported for the changed service. `permission-handler.service.spec.ts` already has errors at lines 16, 151, 554, and 810 outside the added tests.
- Nx, Jest, and tsc were not run because the orchestrator owns the single check slot. Specs cover source mapping, withdrawal, generation reuse, active voice mute, unmatched owner, stale dispatch, Open routing, action failure, and response delivery failure.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Resolve request owner from direct tab, routed target tabs, then session across workspaces | Using the selected workspace could misattribute a background request. `TabManagerService` provides cross-workspace lookups; the plan forbids substituting the current workspace. | Yes |
| Keep an unmatched request under an empty-workspace key with Open disabled | Dropping it would lose the required count. The plan requires counting once even without a tab. | Yes |
| Treat a moved unresolved request as the same sound lifecycle | Re-keying after its owner becomes known otherwise sounds twice. The source suppresses the second `soundEligible` flag. | Yes |
| Post responses before local removal | The previous order dropped a live request on transport failure. The plan requires retaining it and clearing the action guard. | Yes |
| Log a fixed failure message and emit a fixed notice title | Transport errors may contain prompt or tool details. The plan requires safe transient failure feedback. | Yes |

## Not done

- Shell injection of `ChatAttentionSourceService` and DI registration of `ChatAttentionActionDispatcherService` belong to A5/A7. The chat library public barrel is outside A2 ownership; A7 must arrange an allowed import/export for registration.
- Full scoped test execution is pending the orchestrator's check slot.
