# Code Style Review: S4b Wave D public API (base ccd8a8a9c)

Verdict: REVISE. Blocking 0, Serious 2, Moderate 2, Minor 3. Score 7/10.

Scope: diffs of the listed public-surface files, plus export lists and imports of the new compaction/*.ts and lane-budget-guard.ts. I did not read the implementation bodies; they belong to the logic review.

## Serious

### S1. `AgentProcessInfo.stopReason` type collapses to `string`
- `libs/shared/src/lib/types/agent-process.types.ts` (new field, ~line 172): `'tool-call-budget' | 'repeat-call' | string`.
- Problem: a union with `string` widens to `string`, so the literals give no checking or autocomplete. The same union already exists as `LaneBudgetStopReason` in `cli-agent-runtime/.../lane-budget-guard.ts:21`, so there are now two definitions.
- Fix: define `LaneStopReason = 'tool-call-budget' | 'repeat-call'` in shared and use it in both places. If open-ended values are intended, say so in the JSDoc and use the `(string & {})` idiom. The shared type is the better home because it is the contract the UI and status readers see.

### S2. Compaction budget defaults are written in three places
- `platform-core/src/file-settings-keys.ts` (`FILE_BASED_SETTINGS_DEFAULTS`: 2500 / 150000 / 300000 / 3000000).
- `agent-sdk/src/lib/helpers/compaction-config-provider.ts:61-64` repeats all four as `*_DEFAULT` constants. Its comment admits the duplication ("repeated here so a hand-edited invalid value falls back to the same number").
- The JSDoc in `file-settings-keys.ts` and the RPC types follows the rule (it points at `FILE_BASED_SETTINGS_DEFAULTS`), so the policy is respected there.
- Problem: this is duplication that will drift. One of the four values is already marked "Provisional" (`subagentStopWeightedTokens`, to be set by the Batch 36 p95), so there are now two edit sites for it.
- Fix: have the provider read the fallback from `FILE_BASED_SETTINGS_DEFAULTS` (agent-sdk already depends on platform-core types), or add a spec that fails when the two disagree. The same applies to `lane*` thresholds if `LaneBudgetThresholds` carries its own defaults. I did not find them; verify.

## Moderate

### M1. `LaneModelBlockedError` is not exported from the cli-agent-runtime barrel
- Defined at `agent-process-manager.service.ts:205`. `cli-agents/index.ts:10-25` exports `AgentContinueError` and its code type, but not the new error or `LaneBudgetGuard`. No other library references the new error today.
- Impact: the error is thrown at spawn, so callers outside the library (RPC handlers, MCP tools) can only match it by `.name` or message. The sibling `AgentContinueError` is exported for exactly this reason.
- Fix: export it from `cli-agents/index.ts`. Keep `LaneBudgetGuard` internal unless a host needs it.

### M2. Barrel reaches into a sub-path and exports only part of the new surface
- `agent-sdk/src/index.ts:210-215` imports from `./lib/helpers/compaction/subagent-budget-monitor` directly. Every neighbouring export goes through `./lib/helpers` (index.ts:207-209). There is no `compaction/index.ts`.
- `SubagentBudgetMonitor` is exported as `type` only, although it is a DI class, while `ToolOutputCapper`, `CompactionCoordinator`, `ContextUsagePort` and `SessionRotationAdvisor` are not exported at all. The hosts bind tokens, so they need the tokens plus the class types, or none of the classes.
- Fix: add `helpers/compaction/index.ts`, re-export it from `helpers/index.ts`, and choose one rule for which names leave the lib. Only `adviseSubagentResume` appears to be needed externally (the injector); say so in a comment if that is the intent.

## Minor
- `agent-sdk/src/lib/di/tokens.ts:57-84`: the new tokens sit in `SDK_TOKENS` and use `Symbol.for`, which is correct. The JSDoc gives each one a TASK id, but the older tokens have none. Cosmetic.
- `compaction-state.types.ts:24,34`: `CompactionState` is a const and a type with the same name. That is a common pattern, but check whether siblings do it (`SessionBudgetStage` does). Fine if so.
- `IContextUsagePort` has the `I` prefix but `SessionRotationAdvisor` and `SubagentBudgetMonitor` have no port interface, and they are used through `Pick<>` source types. This is consistent with the "port only at real boundaries" rule. Note only.

## Checks that pass
- Tokens use `Symbol.for` inside the `SDK_TOKENS` object.
- `type` exports are used for type-only names in the barrels (`index.ts:210-214`; `SessionBudgetRotation` is imported with `import type`).
- File names are kebab-case with role suffixes (`.port.ts`, `.types.ts`). `tool-output-capper.ts`, `session-rotation-advisor.ts` and `subagent-budget-monitor.ts` read like their neighbours.
- No new `vscode-core` host-type import. The capper, port and advisor import `Logger` and `TOKENS` from `@ptah-extension/vscode-core`, exactly as sibling helpers do (compaction-config-provider, the hook handlers). That is judged consistent, not a violation.
- Module boundaries: agent-sdk (`type:feature`) depends on `tool-output-reducers` (`type:util`), which is allowed, and it is declared in `package.json` and mapped in `tsconfig.base.json:257`. `TreeSitterCodeOutliner` is exported from vscode-lm-tools (`type:feature, domain:vscode`) and bound by the hosts, so there is no feature-to-feature import. No deep cross-lib relative imports found.
- Setting keys are registered in `FILE_BASED_SETTINGS_KEYS`, the defaults, `KNOWN_CONFIG_KEYS` and `SCOPED_SETTING_KEYS` (lane keys). The `compaction.*` keys are not in `SCOPED_SETTING_KEYS`, which is consistent with the existing `compaction.*` keys; the comment explains that `compaction.threshold` is excluded.
- JSDoc does not restate the numeric defaults in `rpc-agents.types.ts`, and it removed the old "default 120000" and "default 2500" text. A comment in `file-settings-keys.ts` (e.g. `'Lane tool-call guards: steer at N...'`) also avoids numbers.
- `agent-generation/tsconfig.lib.json` now matches the preserve/bundler settings in agent-sdk, with no other change.
- `SessionBudgetRotation` and `rotation?` are optional and readonly, matching the neighbouring types. `tokenUsage.contextTokens` is optional and documented. `additionalProperties?: boolean` (`mcp-protocol.types.ts:118`) was already present in the range, so there is no new diff there.

## Progress note
All listed scope was covered within budget. Not examined: the private bodies of the compaction classes and `LaneBudgetThresholds` defaults (confirm S2 for the lane thresholds).
