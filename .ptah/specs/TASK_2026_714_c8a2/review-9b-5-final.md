## Verdict

APPROVE — 9.5/10. Batch 9b-5 and both revise rounds satisfy the requested Claude parity, timer safety, lifecycle, consumer routing, and fail-closed behavior. No remaining code-logic or security findings.

## Findings

No findings.

## Checked

- Compared the gateway card with Claude's request payload in `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:957-968`. The Codex payload in `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:580-596` carries the same permission fields for an unroutable prompt. It omits UUID routing fields and preserves the Codex presentation mapping.
- Confirmed `timeoutAt` uses `min(request.expiresAt, now + 60_000)` at `codex-chat-host-ports.ts:557-562`. An absent bridge expiry uses the full 60-second window. A past expiry produces an immediate decline rather than an allow.
- Compared the timeout reason with Claude's reason at `sdk-permission-handler.ts:1279-1285`. Codex sends native `decline` with that reason and the shared system-abort message at `codex-chat-host-ports.ts:610-619`. The timeout path never allows the request.
- Compared lifecycle fields and outcome mapping with `sdk-permission-handler.ts:932-940` and `sdk-permission-handler.ts:1014-1028`. Codex emits the raw tab id as `routingHint`, `routable: false`, the bounded `timeoutMs`, and `allowed`, `denied`, `timed-out`, or `aborted` outcomes.
- Verified the extracted constant remains `60_000`. The template in `libs/backend/agent-sdk/src/lib/system-abort-permission-message.ts:14-18` is byte-for-byte equivalent to the removed Claude template, including punctuation and interpolation. Claude still supplies `response.reason || 'Session aborted'` and `interrupt: false` at `sdk-permission-handler.ts:1089-1096`. The extraction does not change Claude's behavior.
- Traced answer, timeout, dismiss, cancel, replacement, and delivery-failure settlement. `takePrompt` clears the timer and removes both map entries before any native reply or `resolved` event at `codex-chat-host-ports.ts:308-315`. No double-settle or late timer reply path remains.
- Verified publisher errors are isolated at `codex-chat-host-ports.ts:282-291`. A throwing publisher cannot prevent timer creation, native decline, or lifecycle resolution.
- Verified the revise-round-2 guard at `codex-chat-host-ports.ts:597-609`. A `requested` publisher that settles the prompt reentrantly prevents the late `PERMISSION_REQUEST` broadcast.
- Confirmed the UUID branch retains its prior payload, original `timeoutAt`, lack of a timer, and lack of lifecycle events at `codex-chat-host-ports.ts:580-589`. Lifecycle publication is a no-op for routable entries.
- Confirmed `config.consumer ?? 'chat'` reaches profile resolution in `libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts:129-136` and the Codex session profile in `codex-chat-host-ports.ts:371-375,426-429,493-496`. The Ptah MCP server remains attached with the raw `gw-` routing id when `mcpServerRunning` is true.
- Reviewed the specs for absent, shorter, and longer bridge expiries, all answer outcomes, timeout, dismiss, cancel, replacement, delivery failure, publisher failure, reentrant settlement, missing publisher, teardown calls, and the unchanged UUID path. The unroutable suite restores real timers in `afterEach`. The reentrant spec explicitly proves that no late card is broadcast.
- Read-only review only. I did not run tests, lint, typecheck, builds, Nx, or diagnostics, as required. I did not change source files.
