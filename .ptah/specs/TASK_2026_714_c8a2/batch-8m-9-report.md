# Batch 8m-9 — Deny with message reaches the Codex model

Plain Deny still maps to Codex `cancel` and Allow still maps to `accept`. A typed "Deny with message" still answers the approval with `decline` first. The typed reason is then delivered on the same thread and turn with `turn/steer`.

## Schema evidence

The methods this runtime answers have no response field for a user reason.

- `#/definitions/CommandExecutionRequestApprovalResponse` (`protocol/codex-app-server-protocol.schema.json:2873-2884`) has one property, `decision`, required. `#/definitions/CommandExecutionApprovalDecision` (`:2669-2746`) is a oneOf of bare strings `accept`, `acceptForSession`, `decline`, `cancel`, plus two accept-amendment objects. `decline` (`:2732-2737`) is the string `"decline"`: "User denied the command. The agent will continue the turn." No reason, message, or feedback property.
- `#/definitions/FileChangeRequestApprovalResponse` (`:3144-3155`) is the same shape. `#/definitions/FileChangeApprovalDecision` (`:3071-3101`) `decline` (`:3088-3091`) is the bare string `"decline"`.
- `reason` on those requests is server-to-client only: `#/definitions/CommandExecutionRequestApprovalParams/properties/reason` (`:2845-2850`) and `#/definitions/FileChangeRequestApprovalParams/properties/reason` (`:3116-3121`). The bridge already copies that into the prompt text (`codex-approval-bridge.ts` request `message`). It is not a place to send the user's reply.
- Hand-written boundary: `codex-protocol-schemas.ts:13-18` `decision` is `z.enum(['accept','acceptForSession','decline','cancel'])`. `codex-protocol-methods.ts:197` and `:205` validate both approval results with `z.strictObject({ decision })`. An extra reason key would fail `validateCodexResult`.
- `#/definitions/v2/TurnSteerParams` (`:25233-25262`) is `threadId`, `expectedTurnId`, `input` (`#/definitions/v2/UserInput` items), and optional `clientUserMessageId`. No reason field. The text user-input item is the native channel. `codex-protocol-methods.ts:99-107` matches that. `turn/start` (`codex-protocol-methods.ts:72-98`) takes the same `input` array and no denial field. `CodexRuntime.steer` already sends `turn/steer` with `input: [{ type: 'text', text }]` (`codex-runtime.ts`).

Legacy `#/definitions/ReviewDecision` (`:4439-4530`), used only by `#/definitions/ExecCommandApprovalResponse` (`:2988-2999`) for method `execCommandApproval` (`:6446`), has `denied.rejection` (string, required on that variant). That method is not in `codexServerRequestSchemas`. File-change decline has no equivalent. Putting the reason there would not validate on the v2 approval results this bridge returns.

## Chosen path

After the decline result is returned from `onRequest` (the process writes it before the next check phase), the runtime sends:

```json
{
  "method": "turn/steer",
  "params": {
    "threadId": "<thread>",
    "expectedTurnId": "<active turn>",
    "input": [
      {
        "type": "text",
        "text": "The user denied this <tool> request with the message: \"<reason>\". Respect this decision, do not retry the same call, and adjust your approach."
      }
    ]
  }
}
```

`<tool>` is `command`, `file change`, `permissions`, or `MCP elicitation`. Quotes and backslashes in the reason are escaped. The user's text is not logged.

Blank or whitespace reasons add nothing. `accept` / `acceptForSession` add nothing. `cancel` (plain Deny) adds nothing, even if a reason string was passed.

If the turn is no longer `running` on that id, or `turn/steer` is rejected, or the steer call fails, the runtime logs `logger.warn('Codex denial feedback was not delivered.', { code: 'codex-denial-feedback-undelivered', cause })` with `cause` of `turn-ended`, `refused`, or `failed`. It does not start a new turn, does not call `onFailure`, and does not throw into the approval reply.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-approval-bridge.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-approval-bridge.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-approval-sink.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-approval-sink.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8m-9-report.md`

Not changed, and not required: `codex-runtime.types.ts`, `codex-chat-host-ports.ts`. The host already passes `reason: response.reason` into `approvals.respond` (`codex-chat-host-ports.ts:537`). The sink schema already accepts `reason`.

## Decisions

- Decision: deliver the typed reason with `turn/steer` after the unchanged `decline` result.
- Options: (1) add a reason property on the v2 decline decision; (2) send legacy `ReviewDecision.denied.rejection` on `execCommandApproval`; (3) `turn/steer` a short user message on the same turn.
- Evidence: v2 command and file responses are `strictObject({ decision })` and `decline` is a bare enum string (`schema.json:2732-2737`, `:3088-3091`, `:2873-2884`, `:3144-3155`; `codex-protocol-methods.ts:197`, `:205`). `denied.rejection` exists only on legacy `ReviewDecision` (`schema.json:4511-4529`), which this runtime does not answer, and file-change decline has no such field. `TurnSteerParams` (`schema.json:25233-25262`) is the native same-turn user-text API, and `CodexRuntime` already writes it after an approval response for edit follow-ups.
- Reversible: yes. A future protocol pin that adds a decline reason can replace the steer without a frontend or host-contract change. Widening `ApprovalSink['request']` in `codex-runtime-ports.ts` can replace the `denialReason` carrier (see risks).

## Risks

- `ApprovalSink` in `codex-runtime-ports.ts` was not edited (not in this batch's file list). Its only object result is `{ decision: 'decline', editNotSupported: true }`. The chat sink puts the trimmed user reason on `denialReason` beside that marker so the value stays assignable. The bridge treats `denialReason` as deny-with-message text and does not take the edit path, so it does not also steer `followUpMessage` or call the sink's `followUp.post`. A later reader can mistake the marker for an edit unless they see `denialReason`.
- The steer is a real user message on the turn. `codex-event-translator.ts` drops `userMessage` items (`:299-300`), so this does not add a chat bubble by itself. The model still receives the text.
- If the turn ends in the gap after the decline write and before the check-phase steer, the model never sees the reason. That is logged as `cause: 'turn-ended'` and the decline still stands.
- Tests were not executed here. The batch instructions forbid test, lint, and typecheck runs.

## Not done

- No test, lint, or typecheck run.
- `codex-runtime-ports.ts` was not given a first-class reason field.
- Legacy `execCommandApproval` / `denied.rejection` was not wired.
- No frontend change and no second proxy.

## Continuation (items 1-3)

### Item 1 — typed deny carrier

`CodexApprovalOutcome` (`codex-runtime.types.ts:137-144`) is `CodexApprovalDecision` or `{ decision: 'decline', editNotSupported?: true, denialReason?: string }`. `ApprovalSink.request` now returns that type (`codex-runtime-ports.ts:28`). The chat sink returns `{ decision: 'decline', denialReason }` with no edit marker (`codex-chat-approval-sink.ts:254`). The bridge still treats `editNotSupported` as the only edit marker (`codex-approval-bridge.ts:325-333`) and reads `denialReason` on its own. Specs expect the new shape. D19 steer behaviour is unchanged.

`codex-runtime-ports.ts` was not on the edit list. The sink cannot return the new object unless `ApprovalSink` uses it, so that one signature change was required.

### Item 2 — question backstop

Approvals still use `timeoutMs` or `DEFAULT_APPROVAL_TIMEOUT_MS` (240_000) (`codex-approval-bridge.ts:423-426`). `item/tool/requestUserInput` uses `USER_INPUT_BACKSTOP_MS` (330_000), which must stay above `HOST_QUESTION_IDLE_TIMEOUT_MS` (300_000). This package does not import agent-sdk. `expiresAt` and the interact timer both use `approvalTimeout(kind)` (`:279`, `:449`).

Decision: `timeoutMs` does not scale questions. A configured approval timeout of 100ms or 240s must not decline a question before the host's 300s auto-pick. A longer `timeoutMs` does not extend questions either; 330s is the question backstop.

### Item 3 — elicitation audit

`formContent` (`codex-approval-bridge.ts:183`) previously invented values: the first enum entry matching `once|accept|approve|allow`, and `true` for every required boolean. Unknown keys other than type/title/description/default/enum failed closed.

Now the only values sent are:

- schema `const`, else schema `default`, when the value matches `type` and `enum`
- `approve: true` for a required boolean property named `approve` with no `const` or `default` (the Codex MCP tool-approval grant already used by this bridge)

`const` is an understood key. Any other key (`minimum`, `format`, and so on) on a required field still makes the form unanswerable. Optional fields that cannot be filled are omitted, not invented. `url`, `openai/form`, and `openaiForm` are unanswerable because they are not this form shape.

Unanswerable elicitations return `{ action: 'decline' }` before policy, the sink, and the timer (`:288-304`). The warning is `code: 'codex-elicitation-unanswerable'` with `serverName` and `mode` only. The runtime passes its logger (`codex-runtime.ts:410`). Tool-approval forms (`approve: true`) and forms whose required fields are all `const`/`default` still present one card. Accept sends only that content. Decline is `{ action: 'decline' }`. Cancel stays `{ action: 'cancel' }`.

### Decisions

- Deny text is a field on the decline outcome, not the edit marker. Reversible by folding it back; the steer path does not change.
- Question timeout is fixed at 330s and ignores `timeoutMs`. Alternative was `max(timeoutMs, 330_000)`, which would let a long approval timeout hold a question open past the host auto-pick. Rejected so the host remains the one that answers.
- Tool-approval content is the named `approve` boolean, not "any required boolean" and not an enum scan. A required free-text or enum field without `const`/`default` declines the whole elicitation with no card.

### Risks

- A tool-approval form that does not use a required boolean named `approve` is declined immediately and the user never sees a card. The bridge's existing fixture and the accept path both use that name.
- `logger` is optional on the bridge so callers outside this batch (the native-contract spec) still typecheck. The runtime always passes it. A bridge built without a logger declines unanswerable elicitations and does not emit the warning.
- Tests, lint, and typecheck were not run.
