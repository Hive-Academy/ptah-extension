# Batch 16 report (S4 Wave D, tasks 16.2 and 16.3)

## Changed files
- libs/backend/platform-core/src/file-settings-keys.ts: added 7 keys to `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS`: `compaction.toolOutputBudgetTokens` 2500, `compaction.subagentHandoffTokens` 150000, `compaction.rotationSuggestTokens` 300000, `compaction.subagentStopWeightedTokens` 3000000 (provisional), `agentOrchestration.laneToolCallSteerAt` 40, `laneToolCallStopAt` 60, `laneRepeatCallStopAt` 20. `compaction.threshold` is not moved (R-W1).
- libs/backend/platform-core/src/file-settings-keys.spec.ts: new describe block covering routing and defaults for the 7 keys, plus a check that `compaction.threshold` stays out of the file-based set.
- libs/shared/src/lib/types/rpc/rpc-agents.types.ts: added `laneToolCallSteerAt`, `laneToolCallStopAt` and `laneRepeatCallStopAt` to `AgentConfig` (the result interface) and `AgentSetConfigParams`, with no numeric defaults in the JSDoc. The restated 120000/2500 in the Codex budget field JSDoc now points at `FILE_BASED_SETTINGS_DEFAULTS`. The stale `mapEffortToCli` comment now names `lane-spawn-policy.ts` (F6-c).
- libs/shared/src/lib/types/rpc/rpc-auth.types.ts: 3 scoped entries (`appScopable:false`, global only) for the lane-guard keys.

## Checks
- `nx run-many -t test,lint,typecheck -p shared platform-core`: pass (6 tasks).
- Affected typecheck (80 projects): all pass except the 11 `api-*` projects. They fail with TS2307, missing `libs/api/core/src/lib/generated-prisma-client/client`, which is an unrelated missing generated Prisma client and not caused by this batch.
- `nx run di-lint:lint`: pass.
- `nx run degradation-audit:lint`: reports `catch-return-sentinel` findings in `apps/ptah-cli/**` (analyze.ts, doctor.ts, harness*.ts). I did not touch those files. I did not confirm whether the target exits non-zero, because I only grepped its output.
- PNG restore: no PNGs were rewritten.

## Deviations
- The compaction keys got no scoped entries in `rpc-auth.types.ts`. The task body asked for three scoped entries, and those are the lane-guard ones.
- The affected-set command needed `--json` instead of `--sep=,`, because this nx version prints a JSON array.
