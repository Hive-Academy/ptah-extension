# TASK_2026_272 — "Send to messaging" hand-off rework

## User intent

"Send to message feature doesn't have any predictable workflow." Audit
2026-08-17 (sibling of TASK_2026_271).

## What it actually does today

1. Mounted only in the Orchestra Canvas tile header
   (`libs/frontend/canvas/src/lib/canvas-tile.component.ts:73`). Not in
   chat-input, not on message bubbles. Renders nothing outside Electron
   (`send-to-messaging.component.ts:40`).
2. Icon appears only when Electron + tab exists + not already attached +
   `tab.claudeSessionId` set (`:194-200`). Before the first turn it is absent —
   no tooltip, no disabled state.
3. Click → `gateway:listBindings({status:'approved'})` → spinner → list or
   "No approved bindings. Approve one in the Gateway tab first."
4. Pick binding → `gateway:attachSession({bindingId, sessionUuid,
workspaceRoot, externalConversationId:'default'})` (`:287-292`). **Sends no
   content.** `GatewayService.attachSession` (`gateway.service.ts:440-498`)
   stamps workspace on binding + a `'default'` conversation, links session →
   binding in `AttachedSessionRegistry`, emits `session-attached`.
5. Push `gateway:sessionAttached` flips `tab.attachedBinding`
   (`tab-manager.service.ts:1605`); composer goes read-only; tab is now driven
   only by inbound platform messages.
6. Undo = "Resolve back to webview" → `gateway:detachSession`.

Net: a session hand-off / remote-control toggle mislabeled as a send action.

## Findings

| #   | Sev      | Where                                                  | Problem                                                                                                                                                                       | Direction                                                                                           |
| --- | -------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Critical | component `:37-75`                                     | Label "Send to messaging" + `Share2` icon promise content share; reality is control hand-off that makes the tab read-only. No confirm, no consequence text.                   | Rename ("Hand off session to…"), consequence line in picker header, inline confirm.                 |
| 2   | Critical | `gateway.service.ts:440-498`                           | No check that binding's adapter is running. Attach returns ok, tab read-only, nothing ever arrives.                                                                           | Reject/warn when adapter offline; grey out row.                                                     |
| 3   | Serious  | component `:194-200`                                   | Button unmounted rather than disabled-with-reason.                                                                                                                            | Disabled + tooltip (no session yet / Electron only / already attached).                             |
| 4   | Serious  | `gateway.service.ts:463-473`, component `:347-358`     | `session-not-resumable` → "This session can't be resumed for messaging", no next step.                                                                                        | State the concrete condition (needs a saved turn) or link docs.                                     |
| 5   | Serious  | component `:291`, `gateway.service.ts:444/476/950-953` | Frontend hardcodes `externalConversationId:'default'`; inbound routing uses platform `msg.conversationId` when present. Attach may create a row inbound never targets.        | Surface the real channel/thread, or pin `'default'` correctness for all three adapters with a test. |
| 6   | Moderate | component                                              | No outside-click / Escape close on picker.                                                                                                                                    | Reuse `ui` Native\* popover primitives.                                                             |
| 7   | Moderate | tests                                                  | No spec for `send-to-messaging.component.ts`; backend attach/detach handlers are covered (`gateway-rpc.handlers.spec.ts:333-460`).                                            | Add component spec.                                                                                 |
| 8   | Minor    | component `:280-283`                                   | "Could not resolve this tab's workspace" — no recovery guidance.                                                                                                              | Add guidance / log context.                                                                         |
| 9   | Minor    | vs `gateway-platform-pane.component.ts:70-86`          | Gateway tab's "Send test" has clear verb, inline ok/error result, `canSendTest()` disabled pattern; this component reinvents a 4 s error-only toast, no success confirmation. | Reuse that result-signal pattern.                                                                   |

Already good: double-click guarded via `_attaching` / detach in-flight signals
(`:272`, `:317`).

## Target workflow

1. Rename affordance to "Hand off session to…"; drop `Share2` icon.
2. Disabled-but-visible button when unavailable, tooltip states the exact reason.
3. Picker lists only bindings whose adapter is running; offline shown greyed
   with "platform offline — start it in Gateway tab", unselectable.
4. On pick, one-line inline confirm: "This tab becomes read-only and is driven
   from {platform} · {name}. Continue?"
5. Spinner during attach; brief positive confirmation ("Attached to
   {platform}") before flipping to the read-only indicator.
6. Error keeps picker open, shows mapped error inline next to the row.
7. Resolve-back is confirm-free but also shows a transient success line.
8. `externalConversationId` surfaced or pinned by test.
9. Component spec: empty/loading/error picker, attach success/error, in-flight
   guard, detach success/error, VS Code no-render gate.

## Key files

- `libs/frontend/chat/src/lib/components/molecules/send-to-messaging/send-to-messaging.component.ts`
- `libs/backend/messaging-gateway/src/lib/gateway.service.ts` (440-541, 855-960)
- `libs/backend/rpc-handlers/src/lib/handlers/gateway-rpc.handlers.ts` (354-403)
- `libs/frontend/canvas/src/lib/canvas-tile.component.ts` (mount)
- `libs/frontend/messaging-gateway-ui/src/lib/components/gateway-platform-pane.component.ts` (pattern to reuse)
