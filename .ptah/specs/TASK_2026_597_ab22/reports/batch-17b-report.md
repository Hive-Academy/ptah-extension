# Batch 17b report — Tasks 17.4 + 17.5 (TASK_2026_597, S4 Wave D)

Verdict: DONE. Both tasks are implemented. Scoped test, lint and typecheck pass, the affected typecheck passes, and degradation-audit exits 0. di-lint fails on one existing finding that is not in a 17b file (details below).

## Changed files

- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
  - New `LANE_GUARD_FIELDS`, `LANE_GUARD_DEFAULTS` (40/60/20, same values as `FILE_BASED_SETTINGS_DEFAULTS`), `LANE_GUARD_MINIMUMS` (steer 1, stop 2, repeat 2), `isLaneGuardValue` (a safe integer at or above the minimum) and `invalidLaneGuard(params, readStored)`.
  - `invalidLaneGuard` first checks each field on its own. It then checks stop > steer whenever steer or stop is in the request. A field missing from the request is filled in from the stored value, read through `getLaneGuard`, so an invalid stored value counts as its default. The error names the field the request changed: `laneToolCallSteerAt` for a steer-only write, `laneToolCallStopAt` otherwise.
  - `agent:setConfig` calls it after `invalidCodexBudget` and before any write, with the same `Unsupported <field> value` error text. The three keys are then written through `setAgentCfg`.
  - `agent:getConfig` returns `laneToolCallSteerAt`, `laneToolCallStopAt` and `laneRepeatCallStopAt` through the new `getLaneGuard`. A hand-edited invalid value is reported as the default, the same way `getCodexBudgetTokens` works.
  - The Codex budget writes now go through `withoutNegativeZero`, so `-0` is stored as `0`.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.set-config.spec.ts`
  - F6-c: test title renamed to "refuses Pi-only values for Codex and Copilot (CLI_REASONING_EFFORT_VALUES, the lane-spawn-policy mapEffortToCli allowlist)".
  - Codex budget: added `MAX_SAFE_INTEGER + 1` / `+ 2` rejection cases (the field name is in the error, nothing is written), plus `-0` accepted and stored as `0` for both token keys.
  - New describe "lane tool-call guard settings": getConfig defaults pinned against `FILE_BASED_SETTINGS_DEFAULTS`, a round trip at the minimum values, 18 rejection cases (0, `-0`, negative, fraction, string, null, NaN, Infinity, boolean, above `MAX_SAFE_INTEGER`), stop <= steer in a single write, a steer-only write checked against the stored stop, a stop-only write checked against the stored steer and against the default when none is stored, a repeat-only write not checked against the pair, and hand-edited invalid values read back as defaults.
- MODIFIED `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`: `KNOWN_CONFIG_KEYS` gains `compaction.toolOutputBudgetTokens`, `compaction.subagentHandoffTokens`, `compaction.rotationSuggestTokens`, `compaction.subagentStopWeightedTokens` and the three `agentOrchestration.lane*` keys. `compaction.threshold` is unchanged.
- MODIFIED `libs/backend/agent-sdk/src/lib/types/settings-export.types.spec.ts`: one case checks that the 7 new keys are exported and that `compaction.threshold` is still there. This spec sits next to the owned source file (see deviation 2).

## Checks

- `npx nx run-many -t lint,typecheck -p @ptah-extension/rpc-handlers @ptah-extension/agent-sdk`: all 4 targets passed.
- `npx nx run @ptah-extension/rpc-handlers:test --maxWorkers=2`: 140 suites passed, 4168 tests passed, 7 skipped.
- `@ptah-extension/agent-sdk:test`, final run: 136 suites passed, 2 skipped, 0 failed (2819 tests passed).
  - The first combined run had 2 failures, neither in a 17b file. `session-control.service.spec.ts` would not compile against the `CompactionConfig` type that 17a is changing (17a has since modified that spec). `session-handoff-writer.spec.ts` failed once after 18 s under machine load.
  - Both passed on the rerun.
- Affected typecheck for `rpc-handlers/src/index.ts` and `agent-sdk/src/index.ts`: 18 projects passed. The affected list contained no `api-*`, `ptah-license-server` or `ptah-landing-page-e2e` project.
- `npx nx run degradation-audit:lint`: exit 0.
- `npx nx run di-lint:lint`: exit 1, one finding. `libs/backend/agent-sdk/src/lib/helpers/compaction/tool-output-capper.ts:93` injects `SDK_TOKENS.SDK_CODE_OUTLINER`, which no `register*.ts` registers.
  - That file is committed and unmodified in this working tree, so 17b did not cause this. The capper registration and the outliner bindings are scheduled for 25a/25b.
- `*.png`: none rewritten.

## Deviations

1. `agent-rpc.handlers.spec.ts` does not exist in this worktree. Only the `.list-rows`, `.migration`, `.resume-parent-session` and `.set-config` specs exist. All new cases are in `agent-rpc.handlers.set-config.spec.ts`, which already holds the Codex budget cases.
2. Added one case to `settings-export.types.spec.ts`. This spec is not named in the batch, but it sits next to the owned `settings-export.types.ts` and already holds the matching Codex and TTL export cases. Without it, nothing tests that 17.5 exports the keys.
3. The `-0` case for the lane-guard keys means rejection, not "stored as 0". `-0` normalises to `0`, and 0 is below every lane-guard minimum (steer >= 1, stop > steer, repeat >= 2). So for the lane-guard keys, `-0` is rejected with the field name. For the Codex keys, `-0` is accepted and stored as `0`, as specified.
4. When both steer and stop are in one write and stop <= steer, the error names `laneToolCallStopAt`. A steer-only write that reaches or exceeds the stored stop names `laneToolCallSteerAt`.

## Out-of-scope observations

- The di-lint `SDK_CODE_OUTLINER` finding described above.
