# Phase B fix F1 — coordinator, MCP approval, failure producer

## Changes and evidence

| Finding | Change | Source | Spec |
| --- | --- | --- | --- |
| S1 MCP resolver | Pass optional host-attention resolver from HTTP server through dispatcher to approval handler. Withdrawn pending resolvers also resolve their notice by original request timestamp. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts:311,394`; `mcp-core/protocol-dispatcher.ts:304,1036`; `permission/permission-prompt.service.ts:162-168` | `protocol-dispatcher.spec.ts` approval path; `permission-prompt.service.spec.ts:285`; existing `approval-prompt.handler.spec.ts` covers response resolution. |
| S1 ownerless MCP request | Skip host claim for requests with no session, tab, or lane owner. MCP approval remains in-app; it creates no stuck generation or false Open target. | `libs/backend/agent-sdk/src/lib/permission/host-attention-coordinator.ts:96-102` | `host-attention-coordinator.spec.ts:154` |
| S2 failed SDK turn | At the SDK `result` turn boundary, use settled phase/reason to present a session failure. Exclude `aborted_*`; resolve its `c:` generation on the next non-replay user turn. Metadata supplies the workspace target. | `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts:138,168,243,327-337`; `permission/host-attention-coordinator.ts:148-169` | `host-attention-coordinator.spec.ts:185` covers present and release. |
| S3 retained state | Cap generations at 256, evict oldest, and lazily expire requests after two hours on observation and snapshot reads. Eviction resolves host presentation. Bound the failure-release version map too. | `libs/backend/agent-sdk/src/lib/permission/host-attention-coordinator.ts:34-35,173-195` | `host-attention-coordinator.spec.ts:196` |
| M9 wrong workspace | Use the metadata record's workspace only. A request without trustworthy owner metadata is dropped and its generation released; it cannot borrow the active workspace in a multi-workspace host. | `libs/backend/agent-sdk/src/lib/permission/host-attention-coordinator.ts:216-221` | Ownerless and race specs at `host-attention-coordinator.spec.ts:154,174` |
| Minor setting and title | Malformed setting values use each setting's default. Replace title control characters before truncation, preserving Unicode code points and the 120 UTF-16 unit schema limit. | `libs/backend/agent-sdk/src/lib/permission/host-attention-coordinator.ts:276,283-292` | `host-attention-coordinator.spec.ts:217` |
| Spec gaps | Added lane-permission routing and resolution-during-metadata-lookup cases. | `libs/backend/agent-sdk/src/lib/permission/host-attention-coordinator.spec.ts:163,174` | Same files. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep MCP approval in-app when it has no owner; do not claim it for host attention. | Synthetic/ownerless host target; skip host claim. | `PermissionPromptService.createRequest` supplies neither sessionId nor tabId; decision #29 requires a trustworthy path-free workspace and decision #30 requires a real owner for Open. | Yes |
| Drop a metadata-missing request instead of borrowing the active workspace. | Active workspace; nullable/ownerless target; drop. | `AttentionTarget` requires workspaceId and sessionId; the current payload has no workspace hint. Borrowing the active workspace can route to the wrong Electron workspace. | Yes |
| Derive failure from the settled SDK result and release it on the next user turn. | StopFailure hook; settled result. | `StopFailureHookHandler` records a snapshot only; `ResultMessageTransformer` settles phase and terminal reason at the actual boundary. Renderer excludes aborted reasons. | Yes |
| Use lazy TTL expiry with a 256-entry bound. | Per-request timers; sweep on observation/snapshot. | MCP approval can block indefinitely; `pendingNotices()` is the renderer snapshot point and per-request timers add unbounded resources. | Yes |

## Not done

- CLI lane terminal failure is outside this lane's ownership: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:2332-2350` classifies a running lane's nonzero exit as failed. No lane failure notice was added there.
- SDK session-close release was not wired; the new-turn release and capped, expiring coordinator state bound retained failure generations. A session-close event is not exposed at the `SdkMessageTransformer` result boundary.
- No Nx, Jest, TypeScript, lint, build, diagnostics, or other verification command was run under the memory-safe instruction. Specs were added but not executed.
