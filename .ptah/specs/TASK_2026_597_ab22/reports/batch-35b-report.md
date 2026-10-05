# Batch 35b (Task 35.3) report

## Changed files (all under libs/backend/cli-agent-runtime/src/lib/cli-agents/)
- lane-spawn-policy.ts: added `BLOCKED_LANE_MODELS` and `findBlockedLaneModel(model)`. It matches the id after the last `/`, case-insensitively, and returns the blocked entry or `undefined`. `isReviewerOrTester` is unchanged.
- lane-spawn-policy.spec.ts: findBlockedLaneModel specs with and without a provider prefix, mixed case, near-miss ids and empty input.
- agent-spawn-environment.service.ts: added `resolveLaneGuardThresholds(): LaneBudgetThresholds`. It reads the three keys through `workspace.getConfiguration('ptah', 'agentOrchestration.<key>', default)`. Defaults are 40/60/20. Validation: each value must be an integer >= 1, `repeatAt` >= 2, and `stopAt` > `steerAt`. A bad repeat value falls back to its default. A bad steer or stop value, or `stop <= steer`, resets both steer and stop to 40/60. `LaneBudgetThresholds` is imported as a type from `lane-budget-guard` (35a).
- agent-spawn-environment.service.spec.ts: specs for the defaults, valid values, non-integer, string, below 1, stop <= steer, and repeat below 2 or non-integer.

## Checks
- `nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime`: passed, exit 0.
- Typecheck of the affected set for `cli-agent-runtime/src/index.ts`: passed for 11 projects, exit 0. My grep filter did not work on the JSON output, so no project was excluded and every affected project ran. The `api-*` projects were not in the list, so no Prisma failure appeared.
- `nx run di-lint:lint`: exit 0.
- `nx run degradation-audit:lint`: exit 0.
- No `*.png` files were rewritten.

## Deviations
- The task says an invalid file value falls back to its default. For the steer/stop pair, `stop <= steer` has no single culprit, so I reset both to their defaults.
- The defaults are duplicated as a local constant in the service rather than read from `FILE_BASED_SETTINGS_DEFAULTS`. They match the values in `file-settings-keys.ts`. The Codex budget keys use the same pattern, which carries a local defaults constant.
- Nothing is committed.
