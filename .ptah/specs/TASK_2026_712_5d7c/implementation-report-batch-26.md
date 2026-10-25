# Backend implementation — `TASK_2026_712_5d7c`, batch 26

**Verdict**: Code is complete in the 5 owned files, and their diagnostics are clean. The activation boundary is NOT compile-clean across the workspace. Three consumers outside this batch's ownership fail to compile, and one shared spec pins the old roster. A compatibility batch is required before Batch 26 can be accepted (see "Exhaustiveness inventory").

**Tasks completed**: 26.1

**Files** (worktree `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e`; I did not touch `register.ts` or `agent-rpc.handlers.ts`, which belong to Batch 26b)

- MODIFIED `libs/shared/src/lib/types/agent-process.types.ts` — added `'claude'` as the 8th, last member of `SYSTEM_CLI_TYPES`. Because it is appended, the auto-detect fallback order of the previous seven is unchanged. Updated the doc comment: the stale `AgentProcessManager.getPreferredCli` reference is now `AgentSpawnEnvironment.preferredCli`, and the comment explains `claude` vs `ptah-cli`.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts` — new 5th constructor parameter `@inject(ClaudeCliAdapter) claudeAdapter: ClaudeCliAdapter | null = null`. It is registered last (`adapters.set('claude', …)`). The init log now lists the registered keys instead of a hard-coded string. A direct `new CliDetectionService(4 args)` keeps the seven-adapter roster, so the existing `cli-detection.service.spec.ts` stays valid.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts` — `MODEL_CONFIG_KEYS.claude = 'claudeModel'` and `EFFORT_CONFIG_KEYS.claude = 'claudeReasoningEffort'`. `preferredCli`, the disabled set and the cap 1..100 are unchanged. They are tuple-driven, so claude takes part automatically.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.ts` — `effortMapperFor('claude')` now returns `mapEffortToClaude`. It is an allowlist over `CLAUDE_REASONING_EFFORT_VALUES` minus `''`/`inherit`, passed through as-is: no Codex `max→xhigh`, and no `minimal→low`. Without this, `resolveLaneEffort` returned step 6 for claude. That threw away the spawn effort and the configured `claudeReasoningEffort` before they reached `ClaudeCliAdapter.resolveEffort` (which the manager feeds via `reasoningEffort: laneEffort.effort`, `agent-process-manager.service.ts:749`). `resolveLaneModel` is unchanged: claude gets no hard-coded default model.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.account-binding.spec.ts` — `const CLAUDE: CliType = 'claude'`, with no cast. The seven binary adapter modules are now `jest.mock`ed so detection does no real I/O. (`jest.mock` only; no `jest.spyOn` on module namespaces, no `process.cwd()`.) Two new describes:
  - **Roster activation**:
    - the tuple order is the previous seven plus `claude`, and `ptah-cli` is not in it;
    - the real `ClaudeCliAdapter` is detected beside the seven, with no query invoked and no model catalog read;
    - a missing SDK (`getQueryFunction` rejects) makes claude uninstalled while all seven stay installed, and nothing goes to Sentry;
    - an absent bundled executable means not installed;
    - a signed-out or unadmitted account still detects as installed, and admission is never consulted;
    - a null adapter gives the old seven-adapter roster.
  - **Typed policy**:
    - `claudeModel` is read (trimmed); a request model wins over it; claude gets `cli-default` with no default model; codex still gets `ptah-default`;
    - `claudeReasoningEffort`: `max` stays `max` while Codex `max` still becomes `xhigh`; `minimal` is ignored at step 2, not coerced; `inherit` resolves to the chat effort; a spawn effort is step 1; the reviewer default is `medium`;
    - preferred order skips an unknown ID and `ptah-cli`, picks claude, and respects a disabled claude; if claude is not installed it falls back to auto-detect; with everything installed, auto-detect still picks `codex`;
    - the cap clamps 0 and -3 to 1, 500 to 100, NaN to 5, keeps 42, and is unset 5.

**Stack observed**
- tsyringe wiring with class-token `@inject`. The precedent is `@inject(AgentSpawnEnvironment)` in `agent-process-manager.service.ts:327`.
- `ClaudeCliAdapter` is already registered by class token through `instanceCachingFactory` in `cli-agent-runtime/src/lib/di/register.ts:102-188`, before `CliDetectionService` (`:208`). No new token was needed; the adapter's own spawn-time resolvers avoid the manager/detection cycle.
- Config is read through `IWorkspaceProvider.getConfiguration('ptah', 'agentOrchestration.*')`.
- Config keys and the effort scale come from Batch 25 (`rpc-agents.types.ts:370-392`, `rpc-auth.types.ts:478-485`).

**Acceptance mapping**
- **Previous seven unchanged**: same constructors and same order. Their spawn path is untouched apart from the two `Partial<Record>` key additions.
- **Missing SDK isolated**: `ClaudeCliAdapter.detect()` already catches loader failures (`claude-cli.adapter.ts:83-96`), and `doDetectAll` has a per-adapter try/catch. Tested.
- **Signed-out is not uninstalled**: detection never consults admission. Tested.
- **Cap, preference and unknown ID**: tested.
- **Native route safe env**: not changed here. The adapter passes native auth `{}` to `assembleSpawnOptions`, and that is already pinned by `cli-adapters/claude-cli.adapter.spec.ts:195-196`. This batch adds no env path.
- **No named live query**: detection only resolves `getCliJsPath` and `getQueryFunction`, never calls the query, and never calls admission. Release hold D7 is untouched.
  - Caveat: `CliDetectionService.listModelsForAll()` will now call `ClaudeCliAdapter.listModels()`, which calls `getNativeClaudeModels()` for an installed claude. That is the existing ambient native model service. It is not a named-account query and not inference, but it is a new caller.

**Verification**
- `ptah_get_diagnostics` (errors) on the 5 changed files: **0 errors**, after fixing two fixture typing errors in the spec. Sibling files in the same projects were included.
- I did not run nx, jest, tsc, lint or build, as instructed. The orchestrator runs `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/shared','@ptah-extension/cli-agent-runtime') -Hosts $H`.

## Exhaustiveness inventory (consumers outside this batch)

These compile errors were confirmed with `ptah_get_diagnostics` after the tuple change. They need a compatibility batch:

1. `apps/ptah-cli/src/cli/commands/agent-cli.ts:447` — TS7053: `'claude'` cannot index `AgentListCliModelsResult`. The type has no `claude` key, so the shared `AgentListCliModelsResult` type (likely `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`) needs `claude` or a tuple-derived key.
2. `libs/frontend/chat/src/lib/settings/ptah-ai/cli-permission-notes.ts:26-28` — TS2741: `FIXED_NOTES: Record<Exclude<CliType,'copilot'>, …>` is missing `claude`.
3. `libs/frontend/tribunal-panel/src/lib/services/tribunal-run-framing.ts:244-268` — TS2366: the `spawnArgsFor` switch has no `case 'claude'`.

This spec now fails at runtime because it pins the old roster:

4. `libs/shared/src/lib/types/provider-account-binding.spec.ts:174` — `expect(SYSTEM_CLI_TYPES).not.toContain('claude')`. It must be flipped. The file is shared-owned and was not edited. It will fail the `@ptah-extension/shared` test target in this batch's own verify command.

Already covered elsewhere, per the orchestrator: `tasks-ui task-agent-discovery.service.ts:19` and `chat-ui agent-marks.ts:34` (Batch 30, both already `CliType | 'claude'`), and `chat cli-matrix-rows.ts:184` plus `session-stats-source.ts` (Batch 24).

These consumers are not yet type-checked. They use `SYSTEM_CLI_TYPES`; the orchestrator should include them in the host typecheck/test sweep:
- `libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.ts`
- `libs/frontend/chat-state/src/lib/command-center-persona.ts`
- `libs/backend/vscode-lm-tools/.../ptah-system-prompt.constant.ts`
- `libs/backend/vscode-lm-tools/.../system-namespace.builders.ts`
- `libs/backend/vscode-lm-tools/.../agent-namespace.builder.ts`
- `libs/backend/vscode-lm-tools/.../tool-description.builder.ts` (diagnostics showed no error)
- `libs/backend/vscode-lm-tools/.../agent-spawn-args.schema.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.schema.ts`
- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts`
- `apps/ptah-cli/src/cli/router.ts`

Other switches on `cli` in cli-agent-runtime (`limits/plan-owner-read.ts:168`, `limits/lane-owner.resolver.ts:126`) compiled clean as siblings.

## Existing specs that pin members changed here

- `cli-agent-runtime/.../cli-detection.service.spec.ts:68-76,114-119,170` — 7-entry `CHANNELS` with 4-argument construction and `toHaveLength(CHANNELS.length)`. It still holds because of the default `null`. It does not `jest.mock('./cli-adapters/claude-cli.adapter')`, but the real module is pure on import.
- `cli-agent-runtime/.../lane-spawn-policy.spec.ts` — no claude cases. Unaffected, except that claude was previously at step 6.
- `cli-agent-runtime/.../agent-spawn-environment.service.spec.ts` and `agent-spawn-environment.settings-routing.spec.ts` — may iterate model/effort keys. Run them.
- `cli-agent-runtime/.../agent-process-manager.service.spec.ts` — uses `SYSTEM_CLI_TYPES`.
- `cli-agent-runtime/.../cli-adapters/cli-adapter.utils.spec.ts` — uses `SYSTEM_CLI_TYPES`.
- `libs/shared/src/lib/types/provider-account-binding.spec.ts:174` — will fail (item 4 above).
- `apps/ptah-cli/src/cli/commands/agent-cli.spec.ts:147-166,461,788,1099-1105` — tuple-driven `it.each`, so claude now becomes a case for every one of these.
- `libs/backend/vscode-lm-tools/.../vendor-roster-drift.spec.ts:108-126` — spawn description must advertise every tuple member, and `cli.enum` must equal the tuple. That likely needs Batch 28's `tool-description.builder.ts` text to name `claude`.
- `libs/backend/vscode-lm-tools/.../tool-description.builder.spec.ts`, `agent-spawn-args.schema.spec.ts`, `mcp-stdio/agent-tool.dispatcher.spec.ts`.
- `libs/backend/lane-routing/src/lib/matrix/seed-matrix.spec.ts:100` — system-CLI coverage of the seed matrix may now require claude.
- `libs/frontend/chat/.../cli-permission-notes.spec.ts:7` — `ALL_IDS` from the tuple.
- `libs/frontend/command-center/.../tribunal-roster-proposal.contract.spec.ts:57` — joined roster string.
- `libs/backend/rpc-handlers/.../agent-rpc.handlers.resume-parent-session.spec.ts`.

## Decisions

- **How detection gets the adapter.** I used class-token injection of the already-registered `ClaudeCliAdapter`. The other options were a new Symbol token, which would mean editing `register.ts` (owned by 26b), or `delay()`. Evidence: the `register.ts:100` comment ("Class tokens keep these runtime-local until the Batch 26 roster activation") and the `@inject(AgentSpawnEnvironment)` precedent. Reversible.
- **The default `null` parameter.** tsyringe `isOptional` only covers string/symbol tokens (`dependency-container.js:104`), so an unregistered class token is not optional. The default keeps direct constructors and old specs on the seven-adapter roster. Every host that runs `registerCliAgentRuntime` registers the adapter. Reversible.
- **The Claude effort allowlist.** Claude gets a pass-through allowlist in the policy, not "no mapper". Without it the configured `claudeReasoningEffort` would never reach the adapter. Per-model support is still checked in the adapter ("Not applied" log). Reversible.

**Plan deviations**: none. The policy path `lane-spawn-policy.ts` exists exactly as assigned.

**Out-of-scope observations**
- The exhaustiveness items 1-4 above.
- The `listModelsForAll` caveat above.
- The pre-existing harness fixture `resolveReasoningEffort: … { step: 'default' }` in the account-binding spec (`:93` before my edit) is not a valid `LaneEffortStep`. I left it untouched.
