# Backend implementation — `TASK_2026_597_ab22`, batch 6

**Tasks completed**: 6.1, 6.2, 6.3, 6.4, 6.5. Nothing is committed.

## Files

All paths are under `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\`.

### Created

- `libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-spawn-policy.ts`
  - `CODEX_LANE_DEFAULT_MODEL = 'gpt-6-sol'`.
  - `resolveLaneModel` returns `{model, source}`.
  - `resolveLaneEffort` returns `{effort, step, ignored[]}`.
  - `isReviewerOrTester`.
  - `mapEffortToCli` and `mapEffortToAgy` were moved here from the spawn environment. Pi gets its own allowlisted raw mapping.
  - `findBlockedLaneModel` is not added; it belongs to Batch 35.
- `libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-spawn-policy.spec.ts`
  - Covers each of the six R2.3 steps.
  - Covers both identification cases plus near misses (`reviewer`, `senior-tester-2`, undefined).
  - Covers all four model sources.
  - Covers values that are ignored at each step.
  - Covers the per-CLI mapping, including Pi `inherit` and antigravity steps 1 and 4.

### Modified

- `libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-spawn-environment.service.ts`
  - The private mappers are removed.
  - `resolveModel(cli, requestModel)` now returns `LaneModelResolution`.
  - `resolveReasoningEffort(cli, {effort, roleName})` now returns `LaneEffortResolution`. It reads the per-CLI setting (codex, copilot and pi; antigravity has none) and the chat effort, then delegates to the policy.
  - New `resolveLaneBudgets()` reads the three `agentOrchestration.codex*` keys in routed form, with defaults from `CODEX_DEFAULT_LANE_BUDGETS`.
- `libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-spawn-environment.settings-routing.spec.ts`
  - The case at `:111` is rewritten: a concrete setting now wins over the UI effort, at step 2.
  - New cases:
    - `inherit` yields the UI effort (step 3).
    - Codex and Copilot `inherit` never reach argv.
    - Pi `inherit` resolves to the UI effort, to undefined, or to the reviewer's `medium`; it is never passed raw.
    - Lane budgets are read from the file store, and the defaults apply when keys are unset.
  - The key-form cases are kept. Only their assertions changed, to the new return shape. Note that `codex` with no setting now resolves to `ptah-default`.
- `libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-spawn-environment.service.spec.ts`
  - The effort and model cases are updated to the new return shapes and the R2.3 order.
  - New cases: the spawn effort wins, the reviewer default applies, Pi uses the chat effort when its setting is empty, and Codex falls back to `ptah-default`.
- `libs\shared\src\lib\types\agent-process.types.ts`
  - Adds `SpawnAgentRequest.effort?: string` (6.2).
  - Removes `SpawnAgentRequest.systemPrompt` (6.5).
- `libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`
  - `SdkSpawnOptions.cliVersion` is set from `detection.version`. It is used only for the log and is never sent to the adapter (F2).
  - `doSpawnSdk` resolves the model, its source and the effort (using `request.effort` and `roleDefinition?.name`). For Codex only, it also resolves the lane budgets.
  - It passes `modelSource`, `reasoningEffort` and `laneBudgets` to `runSdk`.
  - It logs `[AgentProcessManager] Lane policy` before `runSdk` with these fields:
    - `agentId`, `cli`, `model`, `modelSource`, `effort`, `effortStep`
    - `ignoredEfforts`, only when a value was ignored
    - `codexVersion` and `prefixKeys: 'applied'`, for Codex only
  - It subscribes to `sdkHandle.onLaneConfigRejected` and re-emits the same line with `prefixKeys: 'dropped (config rejected)'`.
  - The `systemPrompt` pass-through is removed. The resume warning (`:332-336` originally) is untouched.
- `libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.spec.ts`
  - The effort block is rewritten for R2.3: the setting wins, the spawn effort wins, the reviewer gets `medium` by role name, and Pi `inherit` resolves to the UI effort.
  - A new `lane policy (TASK_2026_597, R2.5)` block asserts:
    - the log fields;
    - the ignored value and the step it was offered at;
    - the request source with step 6;
    - that `modelSource` and `laneBudgets` reach the adapter, and `systemPrompt` does not;
    - that the line is re-emitted on config rejection;
    - that Codex-only fields and budgets are absent for Pi.
- `libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.interface.ts`: removes `CliCommandOptions.systemPrompt`.
- `libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.utils.ts`: `buildTaskPrompt` now uses `projectGuidance` only, and its doc comment is updated.
- `libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\antigravity-cli.adapter.ts`: comment-only edits at `:47` and `:650`.
- `libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.utils.spec.ts`
  - Fixtures move from `systemPrompt` to `projectGuidance`.
  - The resume-context base now uses `projectGuidance: 'S'.repeat(1000)`, so the inline snapshot is unchanged.
  - The "prefers systemPrompt" assertion is dropped.
- `copilot-sdk.adapter.spec.ts`, `opencode-cli.adapter.spec.ts` and `pi-cli.adapter.spec.ts` (all in `cli-adapters\`): change `systemPrompt: 'HARNESS CONTEXT'` to `projectGuidance: 'HARNESS CONTEXT'`. These are fixtures only; the assertions are unchanged.

## How each risk and edge case was handled

- **Unknown effort.** It is ignored at its step and recorded in `ignored` as `{step, value}`. Resolution continues with the next step, and the manager logs it as `ignoredEfforts: ['step N: value']`.
  - An unaccepted setting counts as empty, so steps 4 and 5 still apply.
  - If the setting is `inherit` and no chat effort is usable, resolution goes to step 4 for a reviewer or tester. Otherwise it ends at step 6; step 5 is not re-offered because it is the same value.
  - These choices are documented in the JSDoc and covered by specs.
- **Batch 2 follow-up 1 (Pi `inherit` passed raw).** Closed. Pi now goes through `resolveLaneEffort`, and `mapEffortToPi` rejects both `''` and `inherit`.
  - Routing-spec and manager-spec cases pin that `inherit` resolves to the UI effort, or to nothing, and never to `inherit` itself.
  - Pi now also validates against `PI_REASONING_EFFORT_VALUES`. Before, any string passed through raw. The RPC already enforces the same list.
- **Codex and Copilot `inherit`.** A routing-spec case (`it.each` over codex and copilot) proves it resolves to undefined at step 6 and never reaches argv.
- **Recorded behaviour changes, as planned in D4.** All of these are pinned by specs:
  - Pi uses the in-chat effort when its setting is empty.
  - Antigravity gains steps 1 and 4.
  - A concrete Codex or Copilot setting now wins over the UI effort.
  - An unset Codex model becomes `gpt-6-sol` with source `ptah-default`.
- **Model string.** It is passed through unchanged, including `id<TAB>name`; there is a spec case for this.
- **Budgets.** They are read in routed form (`getConfiguration('ptah', 'agentOrchestration.<key>', default)`) and passed on as read. The adapter's `resolveCodexLaneBudgets` still validates them and warns once per key, as Batch 4 decision 4 intended. Budgets are passed only when `cli === 'codex'`.
- **No new `vscode-core` import.** The manager log uses the existing `Logger`.
- **6.5 producer check.** I re-grepped before removing anything.
  - No producer sets `SpawnAgentRequest.systemPrompt`. Since Batch 5, `agent-namespace.builder.ts` fetches `projectGuidance` only.
  - The `...requestFields` spread could carry a `systemPrompt` key from an `execute_code` caller. It is not a supported caller field: the removed doc said "Injected by MCP server, NOT set by callers". It is also not advertised in any spawn schema or tool description; the grep found none in `vscode-lm-tools`.
  - Such a stray key is now simply unread by the manager. The existing namespace spec (`agent-namespace.builder.spec.ts:188, 293`) already asserts that it is absent. I therefore removed the field and did not touch the namespace surface.
  - The chat-session `systemPrompt` paths (`chat-session.service.ts`, `chat-ptah-cli.service.ts`, `ptah-cli-registry.ts`) are not touched.

## Verification

All commands were run in the worktree, with output tailed.

| Command                                                                                                                              | Result                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/cli-agent-runtime @ptah-extension/shared --parallel=2`                         | Successfully ran typecheck and lint for 2 projects                            |
| `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli --parallel=2`                                          | Successfully ran typecheck for 3 projects (exit 0)                            |
| `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/shared --parallel=1 --skip-nx-cache -- --maxWorkers=2` | See the two rows below                                                        |
| — shared                                                                                                                             | 83/83 suites, 2277/2277 tests passed                                          |
| — cli-agent-runtime                                                                                                                  | 84/84 suites, 1714 passed, 1 skipped (the skip was already there), 1715 total |
| `npx nx run-many -t typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers --parallel=2`                          | Successfully ran typecheck for 2 projects                                     |

I did not run the `vscode-lm-tools` or `rpc-handlers` tests because I did not touch their files. I ran their typecheck because they consume `SpawnAgentRequest`.

## Plan deviations

1. **`resolveModel` and `resolveReasoningEffort` return structured results** instead of strings, so the manager can log the source and step without resolving twice. `resolveReasoningEffort` takes an optional second argument, `{effort, roleName}`. The only production caller is `doSpawnSdk`.
2. **The Codex binary version in the log comes from `detection.version`.** This is the adapter's `detect()` probe of the same binary, carried in a new internal `SdkSpawnOptions.cliVersion`. It is never passed to the adapter, so F2 is respected. The adapter's own `[CodexCliAdapter] Codex lane config` line still logs the native-binary version.
3. **The `Lane policy` line is logged before `runSdk`.** That way it is present even when the adapter refuses the spawn, for example on an argv-limit or F10 failure. The rejection re-emit is subscribed after `runSdk` returns; `onLaneConfigRejected` is buffered, so no event is missed.
4. **`agent-spawn-environment.service.spec.ts` and three adapter specs were edited** although the batch did not list them. They asserted the old return shape, the old precedence or `systemPrompt` fixtures, and would otherwise fail.

## Out-of-scope observations (not touched)

These are stale comments that still name `AgentSpawnEnvironment.mapEffortToCli`, which has moved to `lane-spawn-policy.ts`. All are comments only:

- `libs\shared\src\lib\types\rpc\rpc-agents.types.ts:160`
- `libs\frontend\chat\src\lib\settings\ptah-ai\cli-model-effort-popover.component.ts:24`
- `libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.set-config.spec.ts:153` (test title)
