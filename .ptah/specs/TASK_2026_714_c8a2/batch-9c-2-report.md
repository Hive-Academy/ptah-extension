# Batch 9c-2 report

## Changes

- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:726`: failed or thrown approval delivery now publishes `aborted`; the existing auto resolve card and timer cleanup remain. Its lifecycle binding comment was corrected at line 84.
- `libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-identity.ts:31`: added the shared legacy Claude identity factory. Exported it at `libs/backend/agent-sdk/src/index.ts:175`.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts:81` and `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:1022,1034`: use the shared identity factory, preserving stored provider and workspace fallbacks. Removed the gateway local factory.
- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:229`: documented lifecycle publisher, outcomes, and caller idempotency responsibility.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.ts:79,102` and `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:481`: replaced the two trailing positional arguments with named options, preserving explicit `systemRoot: undefined` behavior in the adapter.

## Specs

- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:1269`: added false and throw router cases for an allow response; both require `aborted`, one auto resolve card, and no later timeout settlement.
- `libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-identity.spec.ts:25`: added default and stored provider factory cases.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.spec.ts:44`: updated the sink fixture to named options.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:422`: clarified the gateway read approval coverage for the named option.

## Risks and verification

- Tests, typecheck, lint, diagnostics, and builds were not run, per lane instructions. Coordinator verification remains required.
- Ptah reference lookup could not resolve this worktree path; a PowerShell source search found only the adapter and the two sink spec constructor call sites.
- No matching coding skill loader was available in this lane's tool list; no skill was loaded.
