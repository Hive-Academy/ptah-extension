# Batch B3b report

## Summary
Implemented VS Code transport ingress for host attention. `WebviewManager` registers a disposable observer, calls it once before targeted or broadcast delivery (including no view), isolates observer exceptions to error-name logging, and broadcasts to panels through an unobserved private send path. It also emits a visibility-change event for B5a on view registration, disposal, and actual visibility changes.

## Files
- `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts` — ingress, private send path, visibility event.
- `libs/backend/vscode-core/src/api-wrappers/webview-manager.spec.ts` — observer order, detachment, error isolation, mock support.
- `libs/backend/vscode-core/src/api-wrappers/host-attention-ingress.spec.ts` — dynamic backend emission census, zero-view ingress, one observation per broadcast.

## Census result
The production-source census finds five direct emission sites, all calling a webview manager `sendMessage` or `broadcastMessage` with the request type directly and without a `BATCH` wrapper:
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/approval-prompt.handler.ts:77` — `PERMISSION_REQUEST`, sendMessage.
- `libs/backend/agent-sdk/src/lib/permission/ask-user-question.service.ts:91` — `ASK_USER_QUESTION_REQUEST`, sendMessage.
- `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:327` — `AGENT_MONITOR_PERMISSION_REQUEST`, broadcastMessage.
- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:280` — `PERMISSION_REQUEST`, sendMessage.
- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:360` — `AGENT_MONITOR_PERMISSION_REQUEST`, sendMessage.

`libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:983` names `PERMISSION_REQUEST` in a log field and then calls the existing `sendPermissionRequest` path; it is not a separate emission. The census explicitly excludes that log field and fails on any added direct constant use.

## Decisions
- Kept a single active observer slot with registration identity, so disposing an older registration cannot detach a newer one, even when both use the same observer object. This follows the port's disposable contract and is reversible.
- Exposed `onDidChangeVisibility` as a `vscode.Event<void>` so B5a can requery all registered views on any change. The B5a row requires the event before its subscription; the existing metrics already hold visibility. Reversible.
- Preserved the existing sidebar broadcast post path and panel delivery logging; only panel broadcast switched from public `sendMessage` to private `sendToWebview` to avoid duplicate observation. Reversible.

## Not done
- No Nx, Jest, tsc, lint, build, or other test command was run, per instruction. Scoped `ptah_get_diagnostics` reported no errors in the three requested files. It also reported 34 errors in `platform-core/src/testing/contracts/run-host-attention-contract.ts` about missing Jest globals; that file is outside B3b ownership.
