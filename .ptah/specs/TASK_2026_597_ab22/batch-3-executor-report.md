# Backend implementation — `TASK_2026_597_ab22`, batch 3

**Tasks completed**: 3.1, 3.2

## Files

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\agent-sdk\src\lib\types\settings-export.types.ts — the three Codex budget keys added to `KNOWN_CONFIG_KEYS` (after `copilotAutoApprove`), closing the Batch 2 M1 / follow-up 3 gap.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\agent-sdk\src\lib\types\settings-export.types.spec.ts — one case: the three keys are exportable.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts — `invalidCodexBudget` validator beside `invalidReasoningEffort`; called in the validate-before-write block; writes through `setAgentCfg`; `agent:getConfig` always fills the three fields through `getCodexBudgetTokens` / `getCodexWebSearch`.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.set-config.spec.ts — inherit, defaults, round-trip, rejection and catch-masking cases.

No `agent-rpc.handlers.spec.ts` exists. The batch names it "+ the existing set-config spec", so every case went into the existing set-config spec, which already has the get/set harness. I did not create a new spec file.

## Task 3.1 — `KNOWN_CONFIG_KEYS`

- Added `agentOrchestration.codexAutoCompactTokens`, `agentOrchestration.codexToolOutputTokenLimit` and `agentOrchestration.codexWebSearch`.
- Evidence: `settings-export.types.spec.ts` passes 5/5, including the existing no-duplicates case and the new arrayContaining case.

## Task 3.2 — get/set with validation

- Validator (`invalidCodexBudget`): the two token fields must be `typeof number`, `Number.isSafeInteger` and `>= 0`. `codexWebSearch` must be `typeof boolean`. It returns the first invalid field name. The handler then returns `{ success:false, error:'Unsupported <field> value' }` from the early-return block, right after the effort check and before any write.
- No clamping. Unlike `maxConcurrentAgents` and `mcpPort`, the value is written unchanged once it passes validation.
- Writes go through `setAgentCfg(field, value)` (placed after `codexReasoningEffort`).
- Reads in `agent:getConfig` always populate the three optional fields, through `getAgentCfg` (the routed `getConfiguration('ptah','agentOrchestration.<key>', default)` form, F17). A hand-edited invalid file value comes back as the default (plan :794-795).
- Defaults: `CODEX_BUDGET_DEFAULTS` (120000 / 2500 / true) is local to the handler. This follows the repository's existing "mirrors `FILE_BASED_SETTINGS_DEFAULTS`" practice (for example `skill-promotion.service.ts:57`). A spec compares it with `FILE_BASED_SETTINGS_DEFAULTS` from `platform-core`, so the two cannot drift.
- `inherit`: accepted for codex, copilot and pi with no handler change, through the shared arrays. The spec pins all three.
- Legacy migration list: not extended.

Spec cases added (set-config spec, now 41 tests, all passing):

- `inherit` is saved for each of the three effort fields.
- With nothing stored, `getConfig` returns values equal to `FILE_BASED_SETTINGS_DEFAULTS` for all three keys.
- Round-trip with `0`, `4000` and `false`. This proves 0 and false are kept and not replaced by defaults.
- 11 rejection cases: -1, 1.5, a numeric string, null, NaN, Infinity, a negative number, a boolean sent for a token field, and 'false', 0 and null for web search. Each returns its own `Unsupported <field> value` message and never the generic "Could not save the orchestration settings.". `setConfiguration` is never called, even when a valid `piModel` is in the same request.
- Masking proof: `setConfiguration` is set to reject every call and the request also carries a valid `codexWebSearch`. The response is still `Unsupported codexToolOutputTokenLimit value`, and `logger.error` (the catch path) is never called.
- Hand-edited invalid file values (-5, 'lots', 'yes') come back as the defaults.

## Stack observed

- tsyringe `@injectable` handler that registers methods on `RpcHandler` (`agent-rpc.handlers.ts:17,99-180`).
- Settings go through `IWorkspaceProvider` via `getAgentCfg`/`setAgentCfg`.
- Validation is hand-written guards in the early-return block (existing pattern at `:80-97`, `:282-295`). Zod is imported in this file but is not used for `setConfig`, so I followed the guard pattern.
- Jest specs use `createMockRpcHandler` + a Map-backed workspace.

## Verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/rpc-handlers @ptah-extension/agent-sdk --parallel=2 -- --maxWorkers=2`: test and lint passed for both projects. Typecheck failed only because the forwarded `--maxWorkers` reached `tsc` (TS5023). Re-run without the forwarded flag:
  - `npx nx run-many -t typecheck -p @ptah-extension/rpc-handlers @ptah-extension/agent-sdk --parallel=2` gave "Successfully ran target typecheck for 2 projects".
- Direct spec runs:
  - set-config spec: 41 passed, 41 total.
  - settings-export.types spec: 5 passed, 5 total.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1`: TOTAL 293 unsuppressed sites. Only one is in my files, `agent-rpc.handlers.ts:1144` [catch-return-sentinel]. It is the existing `resolveDefaultPtahCliId` catch, which I did not touch; its line number moved down because of the code I added. No new finding in my code: the validator and readers have no catch.

## Risks and edge cases

- **Invalid values are rejected, not clamped:** the validator runs before any write, and the value is stored exactly as sent.
- **The generic catch never masks a rejection:** the rejection returns from the early block, before the `try` body reaches any write. A spec proves this even when every write would throw.
- **Non-number and non-finite input (null, NaN, Infinity, strings, booleans across types):** `Number.isSafeInteger` plus the type guards reject all of them. This is covered by `it.each`.
- **The fields are optional on `AgentOrchestrationConfig`:** the handler fills all three on every response. A spec covers the empty-store case.
- **Hand-edited invalid file values:** they read as the default, as plan :794-795 requires.
- **Credential logging:** unchanged. The log still records field names only.

## Plan deviations

- The spec cases went into the existing set-config spec, because `agent-rpc.handlers.spec.ts` does not exist.
- Steer/stop/repeat range validation (plan :784-785) is not part of this batch. Those keys are S4 (Batches 16/35).

## Out-of-scope observations

- Forwarding `-- --maxWorkers=2` through `nx run-many` breaks the `typecheck` targets (they run `tsc`). Cap workers some other way when typecheck is in the same run.
- The settings import path does not validate per key. The read-side default in `agent:getConfig` covers display; the lane's own reader (Batch 4/6) should apply the same rule.
