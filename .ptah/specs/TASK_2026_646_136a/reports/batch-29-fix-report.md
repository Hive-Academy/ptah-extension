# Batch 29 fix round

## Fixes

1. `mcp-core/route-tools.ts:120` now documents the 24,000 character result cap. `mcp-core/tool-result-budget.spec.ts:129` includes `ptah_route_decide` in the override names, removes it from the default-budget assertion, and pins its 24,000 character / 6,000 token budget at line 157.
2. `mcp-core/tool-description.builder.ts:739-749` advertises optional `taskKind` and `routingSource` with the shared task-kind enum and the schema's `model | ranking | pin` values. The stdio `agent_spawn` builder uses this same schema through `buildAgentSpawnTool` in `mcp-stdio/tool-builders.ts:95-97`; `agent-spawn-surface-parity.spec.ts` compares both transports' schemas.
3. `mcp-core/mcp-contract.sweep.spec.ts:1496` independently pins `ptah_route_decide` to 24,000 characters / 6,000 tokens.
4. `mcp-core/mcp-contract.sweep.spec.ts:3036-3054` expects all 12 served stdio names in order, including `route_decide` and `outcome_report`. The other stdio catalog assertion and its dispatcher count comment at lines 2026-2043 were already updated in the earlier Batch 29 edits; the stale comment is now corrected.

A search of code-execution specs found no other pinned stdio count or HTTP spawn-schema key list requiring an edit.

## Verification

- `npx prettier --write` on the four changed source/spec files: success. `npx prettier --check`: `All matched files use Prettier code style!`
- `npx eslint` on those four files: `✖ 22 problems (0 errors, 22 warnings)`. Warnings are in existing sweep spec code; no errors.
- Scoped `ptah_get_diagnostics`: `Errors: 0 | Warnings: 0 — No issues found.`
- Jest and Nx were not run, per decision #53. The orchestrator must rerun the failing tests.

## Decisions

- **Expose spawn fields in the shared builder.** Options were separate HTTP and stdio schema edits or one shared builder edit. `buildMcpAgentSpawnTool` calls `buildAgentSpawnTool({ transport: 'stdio' })` and renames its result, so one edit gives both transports identical accepted fields. Reversible.
- **Use the shared task-kind constant for the advertised enum.** Options were a copied literal list or `OUTCOME_TASK_KINDS`; `AgentSpawnArgsSchema` already uses that constant. Reversible.

## Not done

- No Jest or Nx run, as required by decision #53.
