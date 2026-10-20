# B3c authoritative host attention resolution

## Summary

Added generation-keyed host resolution to SDK permission and question completion paths, Copilot CLI lane response and cleanup, and the MCP approval response callback. Added focused specs for those paths. Verification commands were explicitly prohibited and were not run.

## Files

- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`
- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.spec.ts`
- `libs/backend/agent-sdk/src/lib/permission/ask-user-question.service.ts`
- `libs/backend/agent-sdk/src/lib/permission/ask-user-question.service.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts`
- `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/approval-prompt.handler.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/approval-prompt.handler.spec.ts`
- `.ptah/specs/TASK_2026_593_7c2e/batch-B3c-report.md`

## Resolution points

- SDK normal permission and SDK lane permission: `sdk-permission-handler.ts:263` records the original timestamp and kind; `:1257` resolves on an authoritative response, including a response from another surface and automatic sibling resolution. `:1229` and `:1246` resolve pre-abort and abort. Pending response callbacks also cover nondelivery, timeout, session cleanup, and disposal. `:328` removes the generation before calling the coordinator, so repeated completion cannot resolve twice.
- Ask-user question: `ask-user-question.service.ts:173` uses the original request timestamp; `:177` handles pre-abort, `:198` handles idle timeout, `:217` handles abort, and `:226` handles response, automatic recommended answer, session cleanup, or disposal through the pending resolver.
- CLI Copilot lane: `agent-events.ts:305` consumes the request timestamp recorded at `:324`; `:312` resolves before the bridge response; `:317` resolves every pending request before bridge cleanup.
- MCP approval: `approval-prompt.handler.ts:69` resolves with the original permission request timestamp before completing the response promise. The dependency is optional because the production MCP dispatcher does not currently pass a resolver.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Store SDK request kind and timestamp alongside the pending request, then resolve at the pending completion boundary. | Add separate calls to each response, failure, and cleanup branch. | `sdk-permission-handler.ts` funnels all those branches through `PendingRequest.resolve`; coordinator uses the request timestamp as generation. | Yes |
| Wrap Copilot bridge response and cleanup at the existing CLI composition wiring. | Edit the bridge, or listen for a completion event. | Bridge emits only `permission-request`; `resolvePermission` and `cleanup` own authoritative completion. CLI runtime already imports `SDK_TOKENS` from agent-sdk and its project tags permit that direction. | Yes |
| Use a small optional resolver dependency in the MCP handler. | Import agent-sdk directly or resolve from the global container in the handler. | Existing vscode-lm-tools code documents avoidance of a hard agent-sdk dependency; the MCP handler receives dependencies through `ApprovalPromptDependencies`. | Yes |

## Not done

- The production MCP dispatcher (`protocol-dispatcher.ts`) does not pass `hostAttention` to `handleApprovalPrompt`; that file and its HTTP service caller are outside B3c ownership. Thus MCP host resolution is covered by the handler and spec when supplied, but remains unwired in production. `PermissionPromptService.removePendingResolver` can also withdraw a prompt without invoking the handler callback; fixing that authoritative withdrawal requires an owned service or caller hook.
- No Nx, Jest, TypeScript, lint, build, diagnostics, or other verification command was run, per the B3c instruction. The new specs have not been executed.
