# Batch B6a: remove `subagent:transcript` RPC

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\shared\src\lib\types\rpc.types.ts` — removed the method registry contract, method entry, and unused transcript type imports.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-rpc.schema.ts` — removed the transcript schema and inferred input type.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-rpc.handlers.ts` — removed the transcript method listing, registration, handler, comments, and unused imports.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-rpc.handlers.spec.ts` — removed transcript-specific tests and dispatcher mock member; registration now expects six methods.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B6a.md` — this report.

## Evidence and risks

- Task B6a.1: `SubagentRpcHandlers.METHODS` and `register()` contain the six remaining methods. The transcript schema, registration method, contract and explicit method-list entry are gone. The handler spec's registration assertion expects six methods, and transcript-specific tests are gone.
- Risk 9: checked every literal `subagent:transcript` entry in `rpc.types.ts`, including `RpcMethodRegistry` and `RPC_METHOD_ENTRIES`; both were removed. An exact-string search across `libs apps` found no other DI guard expected-method entry to change.
- Risk 11: `SubagentTranscriptProbe` and `probeSubagentTranscript` were left intact. The dispatcher method and `subagent-registry.types.ts` transcript types belong to B6b and were left intact. `host-source-registry.baseline.ts` was not edited.
- Verification: `rg -n 'subagent:transcript' libs/frontend` returned no hits. AST analysis of the edited handler and spec returned `parseStatus: ok` and zero error nodes. Scoped `ptah_get_diagnostics` was attempted twice, but each call reported TypeScript checking still running after 45 seconds, with all four files unchecked. No tests, typecheck, lint, build, or git commands were run, per lane instructions.

## Final `rg -n "subagent:transcript" libs apps`

```text
libs\shared\src\lib\types\subagent-registry.types.ts:276: * Parameters for the subagent:transcript RPC method.
libs\shared\src\lib\types\subagent-registry.types.ts:293: * Result of the subagent:transcript RPC method.
libs\shared\src\lib\types\rpc\host-source-registry.baseline.ts:361:  'subagent:transcript',
```

The two `subagent-registry.types.ts` comments accompany B6b-owned types. The baseline entry is intentionally stale under P4 and D12, and was not edited.

## Decisions

- Removed the transcript-specific mock member while retaining the dispatcher mock for the four remaining dispatcher-backed operations. Evidence: the handler no longer calls `getSubagentTranscript`; the remaining mock members still support the other handlers. Reversible: yes.
- Left the B6b transcript types and protected baseline untouched. Evidence: the batch boundary and P4/D12 explicitly assign or protect them. Reversible: yes.
