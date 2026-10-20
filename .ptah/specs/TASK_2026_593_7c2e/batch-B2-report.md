# B2a + B2b attention snapshot RPC

## Summary

Added `attention:getSnapshot` as a shared host RPC handler. It reads the coordinator's current pending request notices, maps only approved renderer fields, validates the result, and serves the method on Electron, VS Code and CLI. Added the runtime prefix and guard coverage for the shared registry and all three host surfaces.

## Files

- `libs/backend/agent-sdk/src/lib/permission/host-attention-coordinator.ts` — additive pending safe-notice projection and read-only copy accessor; resolution and generation replacement remove stale entries.
- `libs/backend/agent-sdk/src/lib/permission/host-attention-coordinator.spec.ts` — pending snapshot and privacy case.
- `libs/backend/rpc-handlers/src/lib/handlers/attention-rpc.schema.ts` — strict request and response schemas.
- `libs/backend/rpc-handlers/src/lib/handlers/attention-rpc.handlers.ts` — injected coordinator reader and snapshot handler.
- `libs/backend/rpc-handlers/src/lib/handlers/attention-rpc.handlers.spec.ts` — registration, input, output and privacy cases.
- `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`, `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`, `libs/backend/rpc-handlers/src/lib/handlers/index.ts`, `libs/backend/rpc-handlers/src/index.ts` — registration and exports.
- `libs/backend/vscode-core/src/messaging/rpc-handler.ts`, `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts` — allowlist and manifest guard.
- `apps/ptah-electron/src/di/rpc-surface.spec.ts`, `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`, `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts` — expected method on each host.

## Schema

Request accepts exactly `{}`. Response accepts exactly `{ notices: AttentionNotice[] }`, using the shared strict `AttentionNoticeSchema` for each entry. Mapping emits key, generation, request kind, approved session title, generation timestamp and routing target; it omits source request text, prompt, arguments and raw errors. An invalid projection fails with a fixed error message and logs only the error name.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep a safe pending projection in the coordinator and expose copies. | Reconstruct from generations; store safe notices. | Generations alone contain no title or routing target; the coordinator already constructs `SafeHostAttentionNotice` after metadata lookup. | Yes |
| Register snapshot on all three hosts without a capability gate. | Gate by host; universal read. | The manifest and host RPC surface specs require `attention:getSnapshot` on Electron, VS Code and CLI. | Yes |
| Reuse the shared notice schema for the RPC response. | Duplicate fields locally; reuse the wire schema. | `AttentionNoticeSchema` already validates the renderer push contract and is public from `@ptah-extension/shared`. | Yes |

## Not done

- No Nx, Jest, TypeScript CLI, lint, build or test command was run, per batch instruction. The scoped Ptah diagnostics service was unavailable after 45 seconds; no verification result was returned. The orchestrator owns scoped verification.
- Host transport attachment, native adapters and authoritative resolution call sites belong to other batches.
