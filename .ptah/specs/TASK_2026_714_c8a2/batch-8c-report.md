# Batch 8c report — Codex approval decisions in the permission prompt

Executor: frontend-developer subagent (Claude family). Team-leader verified on disk and ran the
deciding verify. Visual review (Electron, dark + light) is pending an approved live run.

## Files (6; team-leader approved 6 instead of 4 — the dispatcher had to accept Codex ids)

- libs/frontend/chat-streaming/src/lib/permission-handler.service.ts (+ .spec.ts)
- libs/frontend/chat/src/lib/services/chat-attention-source.service.ts (+ .spec.ts)
- libs/frontend/chat/src/lib/services/chat-attention-action-dispatcher.service.ts (+ .spec.ts)

## Acceptance

- Only allowed decisions render, in fixed order Accept, Accept for session, Decline, Cancel:
  chat-attention-source.service.ts filters APPROVAL_DECISION_ACTIONS by `allowedDecisions`.
- No edit control: "Deny with message" is skipped for native requests; the handler rejects any
  `modifiedInput` or `reason` on a request with `allowedDecisions`; the dispatcher refuses a
  message action on a native item.
- Each button posts its decision: dispatcher -> `PermissionHandlerService.handleApprovalDecision`
  -> checks `allowedDecisions` -> posts SDK_PERMISSION_RESPONSE.
- Claude prompts unchanged (no `allowedDecisions`): same actions, route and response.

## Decisions

1. Wire mapping over the existing PermissionResponse (shared type has only Claude vocabulary):
   accept -> allow, acceptForSession -> always_allow, decline -> deny_with_message (no reason,
   turn continues), cancel -> deny (hard deny, stops the turn). No backend code maps a
   PermissionResponse back to a Codex decision yet (session-approval-router.ts:35-37 expects a
   CodexChatApprovalReply; codex-chat-approval-sink.ts:28 takes only the Codex enum). 8a-1/8b MUST
   mirror this table. Reversible.
2. Accept and Decline reuse the `allow` / `deny` action ids so they show outside the "More" menu;
   Cancel uses a new `cancel` id. Codex ids resolve only through APPROVAL_DECISION_ACTIONS.
3. Cancel goes out as `deny`, so it enters the hard-deny list and may mark a sub-agent node
   interrupted; that matches "cancel stops the turn".

## Open findings

- The inline card `ptah-permission-request-card` (libs/frontend/chat-ui, out of scope) still shows
  Claude buttons if a Codex request ever matches a tool node by toolUseId. The handler guard blocks
  disallowed decisions, but the buttons render. Follow-up in chat-ui.

## Verification (team-leader)

- `npm run verify -- -p ptah-electron,@ptah-extension/chat-streaming,@ptah-extension/chat`:
  chat-streaming lint/test/typecheck pass; chat test/typecheck pass; chat lint fails only on
  pre-existing "Static imports of lazy-loaded libraries" errors (known noise; the changed
  chat-attention-source.service.ts has the same 2 errors + 1 warning on main). ptah-electron
  results in that run were invalid (a concurrent 8a-1 lane had in-progress rpc-handlers edits)
  and are re-run under 8a.
