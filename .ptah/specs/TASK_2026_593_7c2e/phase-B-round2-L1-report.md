# Phase B round 2 L1 report

## Changes and evidence

| Finding | Change | Source | Spec |
| --- | --- | --- | --- |
| N1 | Added one exported allowlist predicate for the ten failure reasons; result handling also accepts `phase === 'failed'`. Neutral and aborted reasons no longer issue a failure notice. | `libs/backend/agent-sdk/src/lib/permission/host-attention-coordinator.ts:34-47`; `sdk-message-transformer.ts:330-335` | `host-attention-coordinator.spec.ts:12-40` exhaustively maps all 19 `SdkTerminalReason` members with `satisfies Record<SdkTerminalReason, boolean>`, so a new member fails type checking. |
| N2 | Injected the coordinator optionally into the CLI manager and called it only for a running lane's failed exit. The coordinator uses the recorded parent session metadata for workspace and title, and skips an unresolvable owner with a fixed debug message. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:335-336,2353`; `libs/backend/agent-sdk/src/lib/permission/host-attention-coordinator.ts:177-196`; `agent-sdk/src/index.ts:141` | `agent-process-manager.service.spec.ts:1814-1856` checks nonzero/rejected exits and `:1550-1575` checks user stop; coordinator spec `:269-280` checks routing and ownerless drop. |
| N3 | Added fixed debug lines for request metadata misses and session failure metadata misses; they contain no IDs, paths or payload. | `host-attention-coordinator.ts:166-168,256-258` | `host-attention-coordinator.spec.ts:251-268` checks both messages and the release-during-lookup race. |
| N6 | After TTL expiry, capacity eviction selects a failure `c:` key before an active request key. Live requests remain bounded by the existing two-hour TTL and 256-entry cap. | `host-attention-coordinator.ts:208-220` | `host-attention-coordinator.spec.ts:238-249` preserves the request at capacity. |
| N7 | Failure presentation drops its claimed key when the setting or eligibility gate is off, on a host error, or on preparation failure. | `host-attention-coordinator.ts:286-319` | `host-attention-coordinator.spec.ts:228-237` retries the same generation after enabling the setting. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Resolve lane failure from the tracked lane's `parentSessionId` and that session's metadata. | Search `cliSessions` for the agent; use the recorded parent ID. | `AgentProcessManager` stores `parentSessionId` at spawn; its comment at `:1195` says the CLI session reference is persisted on exit, so the reference can be absent at the failure boundary. The parent metadata supplies the workspace and title at that boundary. | Yes. |
| Keep session-close release under the existing TTL/cap. | Add a new close-event hook; retain bounded lazy cleanup. | The SDK result boundary has no session-close hook; new-turn release already exists and the cap/TTL bound stale keys. | Yes. |

## Not done

- No Nx, Jest, TypeScript, lint, build or other test command was run under the memory-safe instruction. The orchestrator owns scoped checks.
- A scoped `ptah_get_diagnostics` request timed out after 45 seconds with five files unchecked; it reported no diagnostic result.
