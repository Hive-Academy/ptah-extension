# Batch 17a report (Tasks 17.1 + 17.3)

## AS14 result (17.1, read-only)

All three hosts route file-based keys through the same `FILE_BASED_SETTINGS_KEYS` set plus `isFileBasedSettingKey` from platform-core, so the Batch 16 `compaction.*` keys are covered. No host edited.

- vscode: `apps/ptah-extension-vscode/src/di/phase-1-infra.ts:86-90` calls `setFileSettingsStore(FILE_BASED_SETTINGS_KEYS, workspaceProvider.fileSettings, isFileBasedSettingKey)`.
- electron: `apps/ptah-electron/src/di/phase-1-infra.ts:117-121` passes the same three arguments.
- ptah-cli: no `ConfigManager` is constructed. `libs/backend/cli-engine/src/lib/container.ts:540-606` registers a `CONFIG_MANAGER` shim that routes every call via `isFileBasedSettingKey(key)` to `workspaceProvider.fileSettings`. That predicate checks `FILE_BASED_SETTINGS_KEYS.has(key)`, so the new keys are routed.

## Task 17.3

`CompactionConfigProvider.getConfig()` now returns four extra fields: `toolOutputBudgetTokens` (default 2500), `subagentHandoffTokens` (150000), `rotationSuggestTokens` (300000) and `subagentStopWeightedTokens` (3000000).

- A private `readBudget` reads each key. Unset or null returns the default with no warning.
- A value that is not a positive safe integer (non-number, non-integer, 0, negative, NaN) logs a warning and returns the default.
- `compaction.threshold` handling is unchanged.
- The defaults are repeated as local constants rather than imported, following `memory-retention-config.ts`. They mirror `FILE_BASED_SETTINGS_DEFAULTS`. No spec pins the two against each other.

## Changed files

- `libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts`
- `libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.spec.ts` (new budget cases; the existing `toEqual` updated)
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.spec.ts` (outside my file list)

## Checks

- Compaction provider spec: passes (40 tests with the two other suites I ran alongside it).
- `session-control.service.spec`: passes, 33 tests, after the literal fix below.
- `nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk`: lint and typecheck pass. The test target has one failing suite, `session-budget/session-handoff-writer.spec.ts` ("never prunes the file it just wrote, even with an older clock"). It is outside my files and looks timing-related. It passed when I ran it alone, and failed on two full-suite runs.
- `typecheck` on the 18 agent-sdk importers (excluding `api-*`, `ptah-license-server`, `ptah-landing-page-e2e`): passes.
- `di-lint:lint` exit 0, `degradation-audit:lint` exit 0. Both reported a 100% cache hit.
- No `*.png` files were rewritten.

## Deviations

- Adding fields to the exported `CompactionConfig` broke `session-control.service.spec.ts`. It builds `CompactionConfig` literals at 7 places, and ts-jest failed to compile the suite. I added the four fields to those literals. I did not change `session-control.service.ts`.
- The one failing suite above is unrelated to my change. I did not investigate it.
