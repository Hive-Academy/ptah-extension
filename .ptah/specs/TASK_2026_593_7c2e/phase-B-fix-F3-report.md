# Phase B fix F3 report

## Findings

- **M8, partial snapshot:** `libs/backend/rpc-handlers/src/lib/handlers/attention-rpc.handlers.ts:49-72` validates each projected notice, drops invalid entries, and emits one fixed warning with only `errorName` and rejected count. The valid notices remain in the snapshot. `attention-rpc.handlers.spec.ts:72-98` covers mixed and all-invalid input, the safe warning, and the returned projection.
- **m5, coded snapshot failure:** `libs/backend/rpc-handlers/src/lib/handlers/attention-rpc.handlers.ts:74-77` converts coordinator or snapshot construction failures to `RpcUserError` with `PERSISTENCE_UNAVAILABLE`, while logging only the original error name. `attention-rpc.handlers.spec.ts:100-114` covers the code, fixed message, and log privacy.
- **M10, resolution census:** `libs/backend/vscode-core/src/api-wrappers/host-attention-ingress.spec.ts:52-62` extends the existing static emission census to require each producer file to call `hostAttention?.resolve(attentionRequestKey(...))`. The MCP exception explicitly checks that `protocol-dispatcher.ts` passes `hostAttention` to `handleApprovalPrompt`; this wiring is present at `protocol-dispatcher.ts:1036`. The existing exact emission list remains the census boundary.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use the existing `PERSISTENCE_UNAVAILABLE` RPC code for snapshot construction failure. | `PERSISTENCE_UNAVAILABLE`; an unrelated user or session code; add a new wire code. | The shared `RpcUserErrorCode` union has no snapshot-specific code; `agent-outcome-rpc.handlers.ts` uses this code for an unavailable read dependency. | Yes |
| Keep aggregate invalid-notice logging. | One warning per notice; one warning with count. | M8 asks for a count-only log; aggregate logging avoids exposing notice data and keeps one fixed line. | Yes |
| Check MCP resolver supply at the dispatcher call site. | Check only the handler's optional resolver use; also check the caller. | The Phase B review found the handler's optional resolve hook inert because the dispatcher did not pass the dependency. | Yes |

## Not done

- No Nx, Jest, tsc, lint, build, or test was run, per the memory-safe instruction. Scoped Ptah diagnostics returned unavailable after 45 seconds; no type-check result was obtained. Ptah AST analysis parsed the three edited TypeScript files without syntax errors.
- `attention-rpc.schema.ts` needed no change because `AttentionNoticeSchema` already validates each item and `AttentionGetSnapshotResultSchema` still validates the final result.
