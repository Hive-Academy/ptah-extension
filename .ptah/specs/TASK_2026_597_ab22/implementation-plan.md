# Implementation Plan - TASK_2026_597_ab22

Revision: 2. This revision answers `implementation-plan-review.md` round 1 (REVISE, F1-F19) and is re-verified on
worktree HEAD `4e246388a`. Revision 1 was written on `4ad10d856`.

Verdict: buildable on HEAD `4e246388a` in five slices:

- S1a (Codex billing wins) runs on the existing SDK path and ships on its own. It changes no public contract outside
  `cli-agent-runtime` and the spawn settings it reads.
- S1b (the parse-fix runner) ships next and is independent of S1a.
- S2-S4 follow.
- S5 is a short follow-up. It runs only after the QA live runs (L) and E2 report back, and it holds every switch that
  depends on them.

## Changelog (revision 2)

| Finding                                          | Severity | Resolution                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 capture cannot load                           | Serious  | The capture is now opt-in Jest entries under the lib Jest configs, which map `vscode` to `__mocks__/vscode.ts` (`cli-agent-runtime/jest.config.ts:18`, `agent-sdk/jest.config.ts:17`). A small `scripts/lane-capture.mjs` launches them. No ts-node path is used (component 10, D1).                                                                                 |
| F2 version from the wrong binary                 | Serious  | The version comes from the `package.json` of the platform package that owns the resolved native binary, with a `--version` probe as fallback. There is a defined error when no native binary is found (components 1, 2, 3).                                                                                                                                          |
| F3 AS6 had no fallback                           | Serious  | S1a keeps sending the role on resume and `continue()` (today's behaviour, no regression). Omission is an S5 switch, gated on run C2 plus an offline rollout check in S2. R3.5 is met in S1a by recording the measured cost (components 1, 3; Sequencing).                                                                                                            |
| F4 runner in the urgent slice                    | Serious  | S1 is split. S1a ships components 1, 3a, 4, 5 and 6 on the SDK path, using raw `configOverrides` and a per-turn `Codex` instance. S1b ships component 2 (R9.8) and the switch to the runner (D2, Sequencing).                                                                                                                                                        |
| F5 L inputs for Claude-side and Ollama; U1 order | Serious  | An agent-sdk capture entry dumps the `SdkQueryOptionsBuilder` output for a Claude, a Codex-proxy and an Ollama Cloud route. U1 runs on a build of `4e246388a` (pre-S3), and its baseline is recorded before the task PR merges (component 10, Test strategy).                                                                                                        |
| F6 R3.4 partly covered                           | Serious  | Each R3.4 item now has an action or a justification backed by counts. Preambles are dropped on restored-context resume. Codex agent-listing blocks are removed by `agents.enabled=false`. The Ptah-CLI agent-listing delta and the first-turn preambles keep a measured justification (component 5).                                                                 |
| F7 no write path for `compaction.*`              | Serious  | The four `compaction.*` keys become file-based, with a one-shot migration of a VS Code-set threshold. New RPC methods `compaction:getConfig` / `compaction:setConfig` validate before any write. The host read path is `ConfigManager` → file store (component 6b).                                                                                                  |
| F8 "user set"                                    | Minor    | The write dialog has a checkbox per key, and only ticked keys are written or removed. Duplicate detection normalises quoted keys (component 8).                                                                                                                                                                                                                      |
| F9 R5.3 / R5.1 wording                           | Minor    | "Spawn fresh" is delegated to the parent model. The 88/88 proof is mapped to QA after S5 (components 17, 19).                                                                                                                                                                                                                                                        |
| F10 default model rejected                       | Minor    | Model-not-found on `ptah-default` emits an error naming `agentOrchestration.codexModel`. There is no silent fallback (component 3).                                                                                                                                                                                                                                  |
| F11 parallel wording                             | Minor    | Only new files are parallel. Shared files are serialised explicitly (handoff).                                                                                                                                                                                                                                                                                       |
| F12 retry definition                             | Minor    | The stderr pattern and fixture source are defined. The retry state appears in the `Lane policy` INFO line (component 2).                                                                                                                                                                                                                                             |
| F13 D9 deviates from an NFR                      | Minor    | Marked as a Gate 2 question for explicit user acceptance (D9).                                                                                                                                                                                                                                                                                                       |
| F14 translator unverified live                   | Minor    | A pinning spec is required. The QA notes list it as unverified against the backend (component 13).                                                                                                                                                                                                                                                                   |
| F15 citations and counts                         | Minor    | Originator cited at `index.js:254-255` (reviewer-verified). `node_modules/` exists only in the main checkout and is cited from research. The project count is 16, including the e2e harness (handoff).                                                                                                                                                               |
| F16 harness-sync barrel                          | Minor    | A declared deep-import path `@ptah-extension/harness-sync/codex-config` replaces barrel additions (component 8).                                                                                                                                                                                                                                                     |
| F17 settings key form; spec pins old precedence  | Serious  | Every new read uses `getConfiguration('ptah', 'agentOrchestration.<key>')`. Component 4 rewrites the spec case "still prefers the UI effort selection". Component 6 validates before the writes, inside the existing early-return block at `agent-rpc.handlers.ts:282-295`, so the generic catch at `:394-406` never masks its message. A D3 evidence note is added. |
| F18 deleted settings component                   | Serious  | Component 7 is re-anchored on `orchestration-settings.component.ts`, `cli-model-effort-popover.component.ts`, `cli-matrix-rows.ts`, the state services, and `providers-commit.service.ts`. The e2e matrix scenarios are added to verification.                                                                                                                       |
| F19 redact secrets in runner logs                | Minor    | The runner routes its bad-line log and stderr excerpts through `redactSecrets` (`sdk-error-summary.ts:34`) (component 2).                                                                                                                                                                                                                                            |

Rebase impact, summarised (`git diff 4ad10d856 4e246388a` on every plan-touched path):

- Unchanged:
  - `codex-cli.adapter.ts`, `cli-adapter.utils.ts`, `opencode-cli.adapter.ts`, `agent-process-manager.service.ts`;
  - vscode-lm-tools `code-execution/`;
  - harness-sync;
  - auth-providers `translation/` and `providers/local/`;
  - shared `utils/` and `agent-process.types.ts`;
  - agent-sdk, agent-generation, memory-curator, skill-synthesis, persistence-sqlite, tool-output-reducers;
  - `platform-core/src/file-settings-keys.ts`;
  - `scripts/`, root and VS Code `package.json`.
- Changed:
  - `agent-spawn-environment.service.ts`: key form only. Precedence and model resolution are untouched, so R2.1 and
    R2.3 remain fully open.
  - `agent-rpc.handlers.ts`: line drift, the generic catch, and the migration.
  - `rpc-agents.types.ts`: +4 lines.
  - `rpc-auth.types.ts`: line drift.
  - `rpc.types.ts`: line drift.
  - The frontend settings surface was rebuilt, and `ptah-cli-config.component.ts` was deleted.
  - `sdk-error-summary.ts`: adds `redactSecrets`.
  - antigravity and cursor adapters: compatible.
- Upstream did not complete any requirement. The only work it removed is the key-form fix in the spawn environment,
  which this plan no longer needs to make.

## Inputs and constraints

- Requirements used: `task-description.md` rev 2 (approved at Gate 1), `context.md` § Scope and § User Decisions 1-7,
  `research-report.md`, `task-description-review.md` § 2 (N1, N2, N4, N5, N6), `../TASK_2026_561_9e57/context.md`
  Track A (:39-83), `../TASK_2026_562_4b1d/context.md` Waves 2 and 4, `../TASK_2026_557_tokaudit/research-report.md`
  Wave 4 (:303-324), `../TASK_2026_438_a942/context.md` § 2 (blocking wait shape).
- Repository instruction files: `CONVENTIONS.md` (layer rule §8, DI tokens §4, barrel ≤150 lines §3, config discovery
  §10). No `CLAUDE.md` exists at the repo root or in any library touched here (checked).
- Corrections applied:
  - The installed Codex SDK has no extra-args option. `--ignore-user-config` and `--profile` are unreachable through
    it (research :18). This plan replaces the SDK exec path (decision D2).
  - `ptah_agent_wait` and `ptah_run_check` do NOT exist on `main`. Only the polling `ptah.agent.waitFor` exists in the
    `execute_code` namespace (`agent-namespace.builder.ts:415-450`). R9.2 is therefore new code, not a fix.
  - No `effort` argument exists on `ptah_agent_spawn` (`agent-spawn-args.schema.ts:15-33`, `SpawnAgentRequest` at
    `libs/shared/src/lib/types/agent-process.types.ts:151-209`). R2.3 step 1 adds it.
  - The "559 Batch 14 resume skip" is the `resumeRestoresContext` opt-in in `buildTaskPrompt`
    (`cli-adapter.utils.ts:497-505`). Only cursor and codex opt in. Codex still resends the role through
    `developer_instructions` on every spawn and every `continue()` turn (`codex-cli.adapter.ts:635-642`, `:790-791`).
  - `autoCompactWindow` is ALREADY forwarded when `ptah.compaction.threshold` is set
    (`auto-compact-control.ts:78-86`, `sdk-query-options-builder.ts:1099-1103`, `:377-399`). A1 only adds a default,
    logging with a source, and a visible rejection.
  - No platform port exposes a home directory, `CODEX_HOME` or `.ptah/tmp` (platform-core tokens
    `di/tokens.ts:13-48`; `IPlatformInfo` at `types/platform.types.ts:151-159`). See decision D9.
  - (Rebase) Spawn-environment reads now use `getConfiguration('ptah', 'agentOrchestration.<key>')`
    (`agent-spawn-environment.service.ts:124-127, 147-150, 158-160, 173-175`), pinned by the new
    `agent-spawn-environment.settings-routing.spec.ts`. Before `4e246388a`, a user-set `codexModel` may never have
    reached the store the reader used, so part of the "codexModel is empty" evidence may come from that routing bug. The
    `gpt-6-sol` default is still needed for every user with no setting.
  - (Rebase) The settings UI was rebuilt. `ptah-cli-config.component.ts` no longer exists, and per-CLI model and effort
    now live in `cli-orchestration-matrix` / `cli-model-effort-popover`, mounted through `orchestration-settings`
    (`settings.component.html:151`).
- Citation note: `node_modules/` exists only in the main checkout, not in this worktree. SDK citations
  (`@openai/codex-sdk`, `@anthropic-ai/claude-agent-sdk`) were read there on 2026-10-03, in revision 1 and in research.
  The originator line is `index.js:254-255` (the reviewer's correction).
- Design handoff used: none (no design-spec files in the task folder). UI work extends existing settings components and
  reuses their CONTROL/FIELD classes.
- Missing decision-critical input: none that blocks the plan. The live-only facts (E2, `tool_output_token_limit` in code
  mode, `spawn_agent` absence, `enabled_tools`, OpenCode `prune` and compaction trigger) are labelled Assumption with the
  run that resolves each. Their fallback is designed now and shipped in S5 only if L says so.
- CLI lanes: disabled for every phase. No executor below is a lane.

## Codebase evidence

All rows were read on `main` (4ad10d856). Paths are under `libs/` unless they start with `apps/`, `scripts/` or
`node_modules/`.

| Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Location                                                                                                                                                                                                                                                                                | Architectural implication                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runSdk` builds one `config` object; the `features.tool_search_always_defer_mcp_tools=false` line and its 0.150.1 comment sit inside `if (options.mcpPort)`                                                                                                                                                                                                                                                                                                                                                      | `backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:610-633`                                                                                                                                                                                                | Prefix keys must be emitted unconditionally, outside the port branch. The dead line goes.                                                                                                                                                                                       |
| Role is rendered into `developer_instructions` whenever `options.role` is set, resume included; `continue()` re-enters `runTurn` on the same thread with the same config                                                                                                                                                                                                                                                                                                                                         | `codex-cli.adapter.ts:635-642`, `:671-677`, `:790-791`                                                                                                                                                                                                                                  | B7 defect is on both resume and continuation. The config needs a first-turn and a resume variant.                                                                                                                                                                               |
| `handleTurnCompleted` reports `inputTokens: input_tokens` (cached included), no cached field                                                                                                                                                                                                                                                                                                                                                                                                                     | `codex-cli.adapter.ts:1113-1133`                                                                                                                                                                                                                                                        | R7.1 changes the emitted usage shape.                                                                                                                                                                                                                                           |
| Adapter is 1,158 lines, logs through `Logger` from `vscode-core` (constructor `:457`)                                                                                                                                                                                                                                                                                                                                                                                                                            | `codex-cli.adapter.ts:448-457`                                                                                                                                                                                                                                                          | New Codex logic goes into named collaborators that take a plain log sink, not `Logger`.                                                                                                                                                                                         |
| SDK `Codex` builds `CodexExec`, which spawns `codex exec --experimental-json`, reads stdout with `readline.createInterface`, and `Thread` throws `Failed to parse item` on any unparseable line                                                                                                                                                                                                                                                                                                                  | `node_modules/@openai/codex-sdk/dist/index.js:157-200, 243-262, 292-298, 78-85, 520-544`                                                                                                                                                                                                | The parse bug lives inside the SDK. `Codex.exec` is `private` in the types (`index.d.ts:266-268`).                                                                                                                                                                              |
| SDK sets `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` to `codex_sdk_ts` when unset; flattens config via `serializeConfigOverrides` (dotted keys unquoted); `configOverrides: string[]` is passed raw as `--config`                                                                                                                                                                                                                                                                                                       | `index.js:254-255, 317-383, 182-186`; `index.d.ts:234`                                                                                                                                                                                                                                  | A direct runner must set the same originator (R1.2) and quote keys itself.                                                                                                                                                                                                      |
| `resolveModel` returns the request model, else `codexModel`, else nothing                                                                                                                                                                                                                                                                                                                                                                                                                                        | `backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts:165-179`                                                                                                                                                                                               | D1 fix point.                                                                                                                                                                                                                                                                   |
| `resolveReasoningEffort`: in-chat effort first, then `codexReasoningEffort`; pi reads its setting raw; antigravity uses only in-chat. Reads use `getConfiguration('ptah', 'agentOrchestration.<key>')` since the rebase, and `agent-spawn-environment.settings-routing.spec.ts:104-111` pins both the key form and the old precedence ("still prefers the UI effort selection")                                                                                                                                  | `agent-spawn-environment.service.ts:118-153`; spec `:104, :111`                                                                                                                                                                                                                         | R2.3 reverses the order, so that spec case must be rewritten. New reads follow the routed key form. Pi and antigravity change behaviour (recorded below).                                                                                                                       |
| `detect()` probes `resolveCliPath('codex')`, the global binary on PATH (0.160.0 on the dev machine), while lanes run the bundled native binary that `resolveCodexNativeBinary` resolves from the `@openai/codex-<platform>` package (0.155.1). The resolver returns `undefined` when nothing is found                                                                                                                                                                                                            | `codex-cli.adapter.ts:459-469, 247-331`                                                                                                                                                                                                                                                 | The lane's Codex version must come from the resolved binary's package, not from `detect()` (F2).                                                                                                                                                                                |
| `doSpawnSdk` resolves model at `:296`, calls `runSdk` with `reasoningEffort: resolveReasoningEffort(cli)` at `:338-358`; stale warn "does not support session resume" for every CLI except copilot                                                                                                                                                                                                                                                                                                               | `backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:280-370, 332-336`                                                                                                                                                                                        | Single place to pass effort args, log R2.5, refuse blocked models, gate resume.                                                                                                                                                                                                 |
| `trackSdkHandle` subscribes to `onSegment`; `events` EventEmitter emits `agent:spawned` / `agent:exited`                                                                                                                                                                                                                                                                                                                                                                                                         | `agent-process-manager.service.ts:476-605`, `:143-144`, `:1269`, `:1653`                                                                                                                                                                                                                | Hook point for the lane budget guard and an event-based wait.                                                                                                                                                                                                                   |
| `buildTaskPrompt` puts `systemPrompt \|\| projectGuidance` first, then the role; skips both only on resume with `resumeRestoresContext`                                                                                                                                                                                                                                                                                                                                                                          | `cli-adapters/cli-adapter.utils.ts:490-549`                                                                                                                                                                                                                                             | Guidance-once and role cap land here.                                                                                                                                                                                                                                           |
| `renderRoleBlock(role, cli)` adds a header and the transformed body, no size cap                                                                                                                                                                                                                                                                                                                                                                                                                                 | `cli-adapter.utils.ts:465-477`                                                                                                                                                                                                                                                          | R3.6 cap goes here, so Codex and task-prompt adapters share it.                                                                                                                                                                                                                 |
| Namespace builder fetches `projectGuidance` (`:198`) AND the full `systemPrompt` (`:290-293`) and attaches both (`:312-313`)                                                                                                                                                                                                                                                                                                                                                                                     | `backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:198, 290-316`                                                                                                                                                                             | Because `buildTaskPrompt` prefers `systemPrompt`, the 4,000-byte guidance cap is bypassed for every lane.                                                                                                                                                                       |
| Guidance capped at `PROJECT_GUIDANCE_MAX_BYTES = 4000`; `getEnhancedPromptContent` returns the whole generated prompt                                                                                                                                                                                                                                                                                                                                                                                            | `backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:74, 86, 703-718, 767-777`                                                                                                                                                                       | Lanes should get the capped guidance only.                                                                                                                                                                                                                                      |
| Ptah CLI spawn options fetch guidance again and also append `## Project Guidance`                                                                                                                                                                                                                                                                                                                                                                                                                                | `backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts:183-206`                                                                                                                                                                                          | The duplicated Ptah-CLI guidance of R3.4.                                                                                                                                                                                                                                       |
| Role definitions carry `sourcePath` and `bytes`; resolver reads `.claude/agents/<role>.md`, max 64 KiB                                                                                                                                                                                                                                                                                                                                                                                                           | `libs/shared/src/lib/types/agent-process.types.ts:77-85`; `backend/cli-agent-runtime/src/lib/roles/agent-role-resolver.service.ts:15, 58, 104-120`                                                                                                                                      | A condensed role can point to the full file.                                                                                                                                                                                                                                    |
| Workspace role sizes: team-leader 24,830 B, visual-reviewer 15,509, software-architect 14,462, frontend-developer 13,444, backend-developer 12,719, code-style-reviewer 11,853, project-manager 11,649, code-logic-reviewer 11,517, others below 11,000                                                                                                                                                                                                                                                          | `.claude/agents/*.md` (`wc -c`)                                                                                                                                                                                                                                                         | Eight roles exceed 10,000 chars; the cap is binding.                                                                                                                                                                                                                            |
| `ptah_agent_spawn` zod schema is `.strict()`, fields `task, cli, ptahCliId, workingDirectory, timeout, files, taskFolder, deliverables, model, modelTier, resume_session_id, role`                                                                                                                                                                                                                                                                                                                               | `backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts:15-33`                                                                                                                                                                                              | `effort` must be added here, in the advertised schema (`tool-description.builder.ts:602-728`) and in both dispatchers (`protocol-dispatcher.ts:1058-1102`, `mcp-stdio/agent-tool.dispatcher.ts:350-364`). A parity spec exists (`mcp-core/agent-spawn-surface-parity.spec.ts`). |
| Tool result budget: 2,000 tokens / 8,000 chars default, spool under `<root>/.ptah/tmp/mcp-out`                                                                                                                                                                                                                                                                                                                                                                                                                   | `mcp-core/tool-result-budget.ts:20-24, 52-54, 162-215, 291`                                                                                                                                                                                                                             | Bounded MCP replies and the `.ptah/tmp` convention already exist. Wait/check summaries stay below this so they are never spooled twice.                                                                                                                                         |
| `ptah.agent.waitFor` polls every 2 s, single agent, rejects on timeout                                                                                                                                                                                                                                                                                                                                                                                                                                           | `agent-namespace.builder.ts:29-30, 415-450`                                                                                                                                                                                                                                             | Replaced by the event-based wait (same manager method).                                                                                                                                                                                                                         |
| `AgentMessageRouter.select` picks steer, interrupt-resume, queue-next-turn or unsupported; Codex declares `steer:false, continuation:true`                                                                                                                                                                                                                                                                                                                                                                       | `backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts:122-161`; `codex-cli.adapter.ts:492-494`                                                                                                                                                                  | A lane steer can reuse `sendToAgent`. On Codex it lands at the next turn boundary, which is the R9.3 fallback.                                                                                                                                                                  |
| OpenCode config is per-process `OPENCODE_CONFIG_CONTENT` with only `mcp.ptah`                                                                                                                                                                                                                                                                                                                                                                                                                                    | `cli-adapters/opencode-cli.adapter.ts:528-544, 604-611`                                                                                                                                                                                                                                 | R8.1/R8.2 extend this JSON.                                                                                                                                                                                                                                                     |
| OpenCode `step_finish` carries `tokens {input, output, reasoning}` and `cost`; usage emitted only on `reason === 'stop'`                                                                                                                                                                                                                                                                                                                                                                                         | `opencode-cli.adapter.ts:118-129, 768, 873-896`                                                                                                                                                                                                                                         | Per-step usage is in the stream, so the resume gate needs no `opencode.db` read in product code.                                                                                                                                                                                |
| Settings: `agentOrchestration.*` lane keys are file-based (`FILE_BASED_SETTINGS_KEYS`), defaults in `FILE_BASED_SETTINGS_DEFAULTS`                                                                                                                                                                                                                                                                                                                                                                               | `backend/platform-core/src/file-settings-keys.ts:154, 162-174, 453, 461-473`                                                                                                                                                                                                            | New lane keys go here so VS Code, Electron and `ptah-cli` all read them through `IWorkspaceProvider.getConfiguration` (`interfaces/workspace-provider.interface.ts:34, 51`).                                                                                                    |
| Orchestration RPC: `agent:getConfig` (`:181`) / `agent:setConfig` (`:272`). The effort allowlist `invalidReasoningEffort` is at `:80-93`. Validation-before-write is an early-return block at `:282-295`, and the generic catch at `:394-406` returns a fixed message. `getAgentCfg` / `setAgentCfg` use `('ptah', 'agentOrchestration.<name>')` (`:1089-1109`); the legacy migration is at `:1139`                                                                                                              | `backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` (HEAD `4e246388a`); `libs/shared/src/lib/types/rpc/rpc-agents.types.ts:87, 156-176, 181`                                                                                                                                  | New keys and `inherit` extend these contracts. Field validation goes in the early-return block.                                                                                                                                                                                 |
| RPC method registry `RPC_METHOD_ENTRIES` (every method must be listed) and the method map (`'agent:getConfig'` `:1240`)                                                                                                                                                                                                                                                                                                                                                                                          | `libs/shared/src/lib/types/rpc.types.ts:3665, 1240-1247`                                                                                                                                                                                                                                | New `codexConfig:*` and `compaction:*` methods are added in both places.                                                                                                                                                                                                        |
| Settings UI (rebuilt upstream): `orchestration-settings.component.ts` holds `ptah-agent-orchestration-config` and the deferred `ptah-cli-orchestration-matrix` (`:40-50`). The per-CLI model/effort popover is `cli-model-effort-popover.component.ts`; it has `EFFORT_LABELS` with `'' → 'Provider default'` (`:19-27`) and the help text "Provider default uses {{ cell.name }}'s own default" (`:82, :91`). Rows come from `cli-matrix-rows.ts` (codex spec `:117`). Mounted at `settings.component.html:151` | `libs/frontend/chat/src/lib/settings/ptah-ai/*`                                                                                                                                                                                                                                         | UI location for R4.4 and the R2.1 description.                                                                                                                                                                                                                                  |
| Settings state: `ProvidersOrchestrationField` union (`providers-settings.types.ts:63-73`) and patch type (`:89-94`). `ProvidersCommitService` loops over orchestration fields, writing with `agent:setConfig` and reading back with `agent:getConfig` (`providers-commit.service.ts:185-205`). `ProvidersSettingsStateService.saveSettings` is at `:596`                                                                                                                                                         | `libs/frontend/core/src/lib/services/*`                                                                                                                                                                                                                                                 | New fields join this union and the commit loop. Every write keeps the read-back confirmation.                                                                                                                                                                                   |
| e2e harness scenarios for the matrix                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-cli-matrix.entries.ts`                                                                                                                                                                                           | Added to verification.                                                                                                                                                                                                                                                          |
| `redactSecrets(text, secrets)` and `summarizeCliSdkError(error, vendor, secrets = [])`                                                                                                                                                                                                                                                                                                                                                                                                                           | `cli-adapters/sdk-error-summary.ts:34, 58`; used by cursor `cursor-cli.adapter.ts:37, 172-175`                                                                                                                                                                                          | Runner logs use it (F19).                                                                                                                                                                                                                                                       |
| `ConfigManager.get` routes a key to the file store when it is in the host's file-based key set; otherwise it reads VS Code configuration                                                                                                                                                                                                                                                                                                                                                                         | `backend/vscode-core/src/config/config-manager.ts:91-117`                                                                                                                                                                                                                               | Making `compaction.*` file-based gives Electron and `ptah-cli` the same read path (F7).                                                                                                                                                                                         |
| Lib Jest configs map `vscode` to the repo mock                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `backend/cli-agent-runtime/jest.config.ts:18`; `backend/agent-sdk/jest.config.ts:17`                                                                                                                                                                                                    | The capture runs as Jest entries (F1). The harness-sync barrel loads `vscode-core`, which value-imports `vscode` (review F1).                                                                                                                                                   |
| Codex curated model list is GPT-5.x only                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `codex-cli.adapter.ts:507-514`                                                                                                                                                                                                                                                          | The default `gpt-6-sol` must be selectable.                                                                                                                                                                                                                                     |
| Codex home resolved once: `$CODEX_HOME`, else `~/.codex`; exported with `parseMcpServerTables` and `atomicWriteWithRetry`; `cli-agent-runtime` already imports `harness-sync`                                                                                                                                                                                                                                                                                                                                    | `backend/harness-sync/src/lib/targets/mcp/codex-home.ts:44-59`; `harness-sync/src/index.ts:201-213, 298`; e.g. `cli-agent-runtime/.../capability-toggle-store.ts:46`                                                                                                                    | Reuse for reading user MCP server names and for the TOML writer. No new path owner.                                                                                                                                                                                             |
| Codex TOML facet: marker-fenced blocks, no TOML library preserves comments, `.bak` then atomic write, `withMcpConfigLock`, no diff preview                                                                                                                                                                                                                                                                                                                                                                       | `harness-sync/src/lib/targets/mcp/codex-toml-mcp-facet.ts:1-28, 205, 207-216, 277-289, 446`                                                                                                                                                                                             | R4.5 follows this backup/atomic/lock pattern and adds preview plus top-level key edits.                                                                                                                                                                                         |
| No TOML dependency in root `package.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `package.json` (grep)                                                                                                                                                                                                                                                                   | Hand-rolled, line-scoped edits only.                                                                                                                                                                                                                                            |
| `IOutputChannel` and `PLATFORM_TOKENS.OUTPUT_CHANNEL`                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `backend/platform-core/src/interfaces/output-channel.interface.ts:9-15`; `di/tokens.ts:36`                                                                                                                                                                                              | Logging port for new services.                                                                                                                                                                                                                                                  |
| `CLI_AGENT_RUNTIME_TOKENS`, `registerCliAgentRuntimeServices`                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `backend/cli-agent-runtime/src/lib/di/tokens.ts:1-25`; `di/register.ts:49, 77`                                                                                                                                                                                                          | New runtime services register here, not in `vscode-core` `TOKENS`.                                                                                                                                                                                                              |
| Auto-compact control is pure; bounds 100,000-1,000,000; out-of-range treated as unset with a warning                                                                                                                                                                                                                                                                                                                                                                                                             | `backend/agent-sdk/src/lib/helpers/auto-compact-control.ts:34-36, 78-86`; `helpers/compaction-config-provider.ts:58-76`                                                                                                                                                                 | A1 extends this module; header comment says 0.3.150 and is stale.                                                                                                                                                                                                               |
| Installed SDK 0.3.278: `Settings.autoCompactWindow` `sdk.d.ts:8578`; `getContextUsage` `:2852` returning `autoCompactThreshold?` `:3807`; `applyFlagSettings` `:2769`; `updatedToolOutput` `:2579`; `subagentPromptCacheTtl` `:8542`; `strictMcpConfig` `:2200`; `stopTask` `:3013`; `SDKTaskProgressMessage.usage.total_tokens` `:5678-5700`                                                                                                                                                                    | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`                                                                                                                                                                                                                                  | All Claude-side controls named in this plan exist in the pinned SDK.                                                                                                                                                                                                            |
| Session lifecycle `applyFlagSettings` interface accepts only `{effortLevel}`                                                                                                                                                                                                                                                                                                                                                                                                                                     | `agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:86`; used `helpers/session-lifecycle/session-control.service.ts:499`                                                                                                                                                            | Live threshold change needs this interface widened.                                                                                                                                                                                                                             |
| `PostToolUseHookHandler` fans out and returns `{continue:true}`; agent-sdk never imports `tool-output-reducers`                                                                                                                                                                                                                                                                                                                                                                                                  | `agent-sdk/src/lib/helpers/post-tool-use-hook-handler.ts:60-108`                                                                                                                                                                                                                        | A3 capper hooks here.                                                                                                                                                                                                                                                           |
| `tool-output-reducers` depends only on `platform-core`; exports `reduceOutput`, `createCodeReducer`, token measures                                                                                                                                                                                                                                                                                                                                                                                              | `backend/tool-output-reducers/src/index.ts:1-33`                                                                                                                                                                                                                                        | It can host the shared budget-and-spool engine for both callers.                                                                                                                                                                                                                |
| No-activity watchdog `arm()` re-arms forever while compaction is open; `NO_ACTIVITY_TIMEOUT_MS = 180_000`; created once                                                                                                                                                                                                                                                                                                                                                                                          | `agent-sdk/src/lib/helpers/no-activity-watchdog.ts:215-238, 249`; `helpers/session-lifecycle/session-query-executor.service.ts:259-268`                                                                                                                                                 | A8 bounded dwell fixes the indefinite re-arm.                                                                                                                                                                                                                                   |
| PreCompact/PostCompact handler fans out through `CompactionCallbackRegistry.notifyAll`                                                                                                                                                                                                                                                                                                                                                                                                                           | `agent-sdk/src/lib/helpers/compaction-hook-handler.ts:246, 353-387, 404-480`; `compaction-callback-registry.ts:23-60`                                                                                                                                                                   | Coordinator and curator guard subscribe here.                                                                                                                                                                                                                                   |
| `/compact` is streamed into the live session as a user message (no `endSession`)                                                                                                                                                                                                                                                                                                                                                                                                                                 | `agent-sdk/src/lib/helpers/slash-command-interceptor.ts:1-20, 77`                                                                                                                                                                                                                       | The coordinator reuses this path.                                                                                                                                                                                                                                               |
| Advisory pipeline: `SdkAdapterEvents.emitCompactionComplete` → `SessionLifecycleNotifier` → `MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE` → frontend `compaction-lifecycle.service.ts`                                                                                                                                                                                                                                                                                                                             | `agent-sdk/src/lib/helpers/sdk-adapter-events.service.ts:131-137`; `rpc-handlers/src/lib/handlers/session-lifecycle-notifier.ts:90-113`; `libs/shared/src/lib/types/messages/message-constants.ts:136`; `frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts:584` | Rotation advisory reuses this pipeline.                                                                                                                                                                                                                                         |
| Subagent stop exists: `SubagentMessageDispatcher` calls `query.stopTask(taskId)`                                                                                                                                                                                                                                                                                                                                                                                                                                 | `agent-sdk/src/lib/helpers/subagent-message-dispatcher.ts:7, 280`                                                                                                                                                                                                                       | A5 hand-off reuses it.                                                                                                                                                                                                                                                          |
| Resumable subagents recorded per session                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `agent-sdk/src/lib/session-metadata-store.ts:117, 464, 591-620`                                                                                                                                                                                                                         | Gate for selective `subagentPromptCacheTtl`.                                                                                                                                                                                                                                    |
| Curator PreCompact reactor runs on every PreCompact; `start()` never reads `triggers.preCompact`                                                                                                                                                                                                                                                                                                                                                                                                                 | `backend/memory-curator/src/lib/memory-curator.service.ts:218-276`; `triggers/memory-trigger-config.ts:19, 74-76, 175-180`                                                                                                                                                              | A7 coalesces inside the reactor (it keeps running).                                                                                                                                                                                                                             |
| MCP servers for a session: one `ptah` server; `capabilityIsolationOptions` already returns `{strictMcpConfig:true, skills:[]}` when policy unverified; localhost drops the user setting tier                                                                                                                                                                                                                                                                                                                     | `agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:505-510, 1145-1154, 1208, 1233-1237, 1781-1812`                                                                                                                                                                                 | R6.1 adds `strictMcpConfig:true` for proxied base URLs.                                                                                                                                                                                                                         |
| Proxy predicate lives in shared: `includesUserSettingSource`, `LOCALHOST_BASE_URL_RE`                                                                                                                                                                                                                                                                                                                                                                                                                            | `libs/shared/src/lib/utils/auth-env.utils.ts:3-38`                                                                                                                                                                                                                                      | New proxied predicate sits next to it.                                                                                                                                                                                                                                          |
| Ollama Cloud direct base URL `https://ollama.com`; Ollama entries are `AnthropicProvider` values; `AnthropicProvider` has `pricingModel?`                                                                                                                                                                                                                                                                                                                                                                        | `libs/shared/src/lib/providers/entries/local-provider-entry.ts:17, 34, 114`; `providers/provider-registry.ts:73-140`                                                                                                                                                                    | A `reportsCacheUsage` flag fits here (R7.4).                                                                                                                                                                                                                                    |
| Responses translator pushes the system prompt as a developer item AND sets `instructions`; no `prompt_cache_key` anywhere                                                                                                                                                                                                                                                                                                                                                                                        | `backend/auth-providers/src/lib/translation/responses-request-translator.ts:130-155`; usage at `translation-proxy-helpers.ts:25-39`; debug log `translation-proxy-base.ts:966-976`                                                                                                      | R6.2 changes.                                                                                                                                                                                                                                                                   |
| `DEFAULT_CLOUD_CONTEXT = 128_000` written into `maxTokens` at three sites                                                                                                                                                                                                                                                                                                                                                                                                                                        | `backend/auth-providers/src/lib/providers/local/ollama-cloud-metadata.service.ts:71, 382, 404, 426`                                                                                                                                                                                     | R1.5 removes it; `resolveContextCapacity` already returns `{tokens:null, source:'unknown'}` (`libs/shared/src/lib/utils/pricing.utils.ts:495-521`).                                                                                                                             |
| `ModelPricing.cacheReadCostPerToken?` / `cacheCreationCostPerToken?` optional; `findModelPricing` at `:221`; no `gpt-6-*` entry                                                                                                                                                                                                                                                                                                                                                                                  | `libs/shared/src/lib/utils/pricing.utils.ts:18-31, 221`                                                                                                                                                                                                                                 | R7.3 must treat a missing cache price as unknown (N4).                                                                                                                                                                                                                          |
| Ledger dedupes by `message.id` already; `UsageRecord` has no cost                                                                                                                                                                                                                                                                                                                                                                                                                                                | `agent-sdk/src/lib/session-stats/session-usage-ledger.ts:21-34, 124-133, 200-217`                                                                                                                                                                                                       | R7.3 adds a per-record cost; R7.2 targets the extractor, not the ledger.                                                                                                                                                                                                        |
| Subagent metrics extractor sums every assistant line without `message.id` dedupe                                                                                                                                                                                                                                                                                                                                                                                                                                 | `backend/skill-synthesis/src/lib/subagent-metrics-extractor.ts:137-179`                                                                                                                                                                                                                 | R7.2 fix point.                                                                                                                                                                                                                                                                 |
| Skill budget store counts input/output only; table created by migrations 0032/0035                                                                                                                                                                                                                                                                                                                                                                                                                               | `backend/skill-synthesis/src/lib/queue/skill-budget.store.ts:100-104, 193, 276-295`; `backend/persistence-sqlite/src/lib/migrations/0035_skill_synthesis_budget_stage.ts`; latest migration `0051_skill_lifecycle.ts`                                                                   | R7.3 needs migration 0052.                                                                                                                                                                                                                                                      |
| Agent card sums `usage.inputTokens` across segments                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts:37-66`                                                                                                                                                                                                        | Needs the cached field to stay honest.                                                                                                                                                                                                                                          |
| `scripts/agent-usage-report.mjs` (336 lines) already reads Codex rollouts and Claude transcripts; `scripts/jest.config.ts` + `npm run test:scripts`; Node 24 (`.nvmrc`)                                                                                                                                                                                                                                                                                                                                          | `scripts/agent-usage-report.mjs:1-30`; `scripts/jest.config.ts`; `package.json:53, 71-72`                                                                                                                                                                                               | M is a rewrite of this script, tested under `test:scripts`. `node:sqlite` is available for `opencode.db`.                                                                                                                                                                       |
| `compaction.threshold` declared integer-or-null 100,000-1,000,000 in the VS Code manifest                                                                                                                                                                                                                                                                                                                                                                                                                        | `apps/ptah-extension-vscode/package.json:254-268`                                                                                                                                                                                                                                       | Its description changes with A1.                                                                                                                                                                                                                                                |

## Architecture decision

### D1. Codex lane config is assembled by a named, pure collaborator

- Requirement: R3.1, R3.2, R3.5, R4.1, R4.2, R9.2 (`tool_timeout_sec`), R9.6; module boundary note in the brief.
- Chosen approach: `buildCodexLaneConfig(input)` in a new `codex/` folder under `cli-adapters/`. It returns the exact
  ordered list of `--config key=value` strings, plus `warnings`. Two variants: `first-turn` (carries
  `developer_instructions`) and `resume`. Whether `resume` also carries the role is controlled by the constant
  `CODEX_RESUME_RESENDS_ROLE`: `true` in S1a, flipped in S5 only on evidence (F3). The builder's own imports exclude
  `vscode-core` and `tsyringe`. Its transitive load still reaches `vscode` through the harness-sync barrel, so the QA
  capture runs it under Jest with the `vscode` mock (component 10, F1). The builder output is a `string[]` that the
  SDK accepts unchanged as `configOverrides` (S1a) and that the runner passes as `--config` (S1b).
- Evidence: the adapter is 1,158 lines; the SDK's flattener does not quote dotted keys (research :19, `index.js:344-352`).
- Rejected: growing `runSdk`. It would mix process, protocol and policy in one method again.
- Effect: `runSdk` shrinks; config logic gets its own spec that pins every key.

### D2. Replace the SDK exec path with a direct `codex exec` runner (research Option C), in its own slice S1b

- Requirement: R9.8 (no lane death on U+2028/U+2029/U+0085; log and skip unparseable lines), plus a defined failure path
  for rejected keys.
- Slice placement (F4): the billing wins do not need the runner. S1a runs on the SDK:
  - `new sdk.Codex({ configOverrides: builderOutput, env, codexPathOverride })`, built per turn so that the first turn
    uses the first-turn variant and every resume or `continue()` turn uses the resume variant;
  - `resumeThread(threadId)` for the later turns.
    S1b then swaps the SDK exec for the runner behind the same adapter seam. R9.8 is a reliability fix, so it ships
    second and can be reverted alone.
- Chosen approach: `CodexExecRunner` spawns the resolved native binary with
  `exec --experimental-json [--config ...] [--model] [--sandbox] [--cd] [--skip-git-repo-check] [resume <id>]`, writes
  the prompt to stdin, splits stdout on `\n` only, `JSON.parse`s each line, and logs and skips a line that does not
  parse. It sets `CODEX_INTERNAL_ORIGINATOR_OVERRIDE=codex_sdk_ts` exactly as the SDK does (`index.js:254-255`) so M
  and the existing rollout attribution keep working (R1.2). It yields the same `ThreadEvent` shapes the adapter already
  handles. The adapter keeps importing the SDK's TypeScript types only.
- Evidence: the SDK splits with `readline` (`index.js:292-298`) and throws on any bad line (`:78-85`); the arg grammar
  the runner must reproduce is visible at `index.js:178-262`.
- Rejected:
  - Patching `Codex.exec` or constructing `Thread` with a custom exec: both are `private`/`@internal`
    (`index.d.ts:266-268`, `index.js:43`). A minor SDK bump breaks them silently.
  - `codexPathOverride` shim that escapes stdout: research flags the Windows `.cmd`/EFTYPE problem
    (`codex-cli.adapter.ts:222`).
  - `patch-package`: no patch infrastructure exists (`package.json:82` postinstall has none), and a patch rots on
    every SDK bump.
- No-binary path (F2): S1a keeps the SDK fallback (`findCodexPath`) when `resolveCodexNativeBinary` returns
  `undefined`, as today. In S1b the runner has no such fallback, so the adapter fails the spawn with: "Codex native
  binary not found. Reinstall Ptah, or install `@openai/codex` globally." The message names the triple it searched for.
  It never falls back to the `.cmd` / `.js` shim, which produces EFTYPE (`codex-cli.adapter.ts:221-246`).
- Effect (S1b): `getCodexSdk()` (dynamic ESM import, `codex-cli.adapter.ts:164-171`) is deleted. `@openai/codex-sdk` stays a
  dependency for its types and for the bundled platform binary that `resolveCodexNativeBinary` prefers (`:246-330`).
  `--ignore-user-config` becomes reachable later, but this task does NOT use it: it would drop users' own
  `model_providers` and profiles (regression for API-key or custom-provider users).

### D3. Codex lane default model and reviewer default (Decision 4)

- Proposal for the user at Gate 2:
  - Lane default: `gpt-6-sol`, used when `codexModel` is empty and the spawn names no model.
  - Reviewer and tester default: the same `gpt-6-sol`. Effort comes from R2.3 step 4, so an unset effort becomes
    `medium` for `*-reviewer` and `senior-tester`.
  - No separate reviewer-model setting. `codexModel` and the spawn `model` argument still override everything (R2.2).
- Evidence (research :29-31, :59-68): all 9 burning lanes ran `gpt-6-astra`, the frontier tier. Third-party prices
  put Astra at 2.5x-5x Sol per token, and the cache marks Astra's service tier "increased usage". All GPT-6 models have
  the same 272k context and `code_mode_only` tool routing, so Sol changes cost, not tool behaviour.
- Rejected:
  - `gpt-6-luna` as the lane default: the cache calls it "for easier tasks"; developer lanes would lose quality.
    Users can still pick it per spawn.
  - Reviewer at `high` effort (research's suggestion): R2.3 step 4, approved at Gate 1, fixes `medium`. Higher effort
    raises reasoning output on every review turn.
  - Astra on opt-in only: that is already true through `codexModel` and the spawn `model` argument.
- Evidence note (F17): before `4e246388a`, a user-set `codexModel` may not have reached the store the reader used, so
  part of the "codexModel is empty" observation may come from that bug. The default is still required: a fresh user has
  no setting, and an empty setting today means the Codex frontier default.
- Failure (F10): if the account rejects `gpt-6-sol`, for example after the model is retired, there is no silent
  fallback to any other model. See component 3.
- Risk: Sol's quota weight is unpublished. The researcher's `used_percent` A/B is the decision test if the user wants to
  fund it. It is not part of this task's L budget.

### D4. Lane spawn policy is one pure module; the manager logs it

- Requirement: R2.1-R2.5, R9.5.
- Chosen approach: `lane-spawn-policy.ts` exports `resolveLaneModel`, `resolveLaneEffort`, `isReviewerOrTester` and
  `findBlockedLaneModel`, all pure. `AgentSpawnEnvironment` reads the settings and calls them. `doSpawnSdk` logs the
  result (model, model source, effort, R2.3 step) through its existing `Logger`; no new `vscode-core` import.
- Rejected: adding branches inside `resolveReasoningEffort`. The six-step order needs a unit test per step (R2.4),
  which is easiest on a pure function.
- Behaviour change, recorded on purpose: R2.3 applies to every CLI whose effort Ptah resolves. Pi now falls back to
  the in-chat effort when `piReasoningEffort` is empty (today: CLI default). Antigravity gains steps 1 and 4 (it has no
  setting, so step 2 never matches).

### D5. Role cap and guidance-once at the shared rendering seam

- Requirement: R3.4, R3.6, R9.7.
- Chosen approach:
  - Cap: `renderRoleBlock` (shared by Codex `developer_instructions` and every `buildTaskPrompt` adapter) passes the
    transformed body through `condenseLaneRole(header, body, sourcePath, 10_000)`. It keeps the text before the first
    `## ` heading and then whole `## ` sections in document order while the total stays within 10,000 chars, cutting a
    section that does not fit at its last paragraph break. It ends with one pointer line: the headings it omitted, and
    "the full definition is at `<sourcePath>`; read a section only when the task needs it". The Ptah CLI path renders
    its role through the same function.
  - Guidance once: the namespace builder stops attaching `systemPrompt` to system-CLI lanes. `buildTaskPrompt` then
    uses the capped `projectGuidance` (≤4,000 bytes, `enhanced-prompts.service.ts:74`). In
    `ptah-cli-spawn-options.service.ts:183-206` the second copy (`## Project Guidance`) is removed.
- What a condensed role keeps: its opening identity and contract text, then its sections in order up to the cap, plus
  the path to the full file. Agent definition files are not touched (Wave 4.5 OUT).
- Evidence: eight roles exceed 10,000 chars (table above). The full generated prompt bypasses the 4 KB cap today
  (`cli-adapter.utils.ts:500` with `agent-namespace.builder.ts:313`).
- Rejected:
  - Heading allow/deny lists: the files are user-owned and generated; their heading names are not a contract.
  - Hard truncation without a pointer: the lane cannot recover what it lost.
  - A smaller cap for Codex only: see N2 below; 10,000 fits the R3.7 arithmetic once guidance drops to 4,000.

### D6. OpenCode lane config by a pure builder, same pattern as Codex

- Requirement: R8.1, R8.2.
- Chosen approach: `buildOpencodeLaneConfig(input)` returns the `OPENCODE_CONFIG_CONTENT` JSON string (shape under
  Contracts). It replaces `buildMcpConfigContent` (`opencode-cli.adapter.ts:528-544`).

### D7. Claude-side compaction layer coordinates and observes; it never replaces native compaction

- Requirement: R5.1-R5.6. Design stance from 561 (:41-42).
- Chosen approach: five small collaborators under `agent-sdk/src/lib/helpers/compaction/`: `compaction-coordinator.ts`
  (state machine), `context-usage.port.ts`, `tool-output-capper.ts` (A3), `subagent-budget-monitor.ts` (A5),
  `session-rotation-advisor.ts` (A6). They are wired into existing hook and event seams. A1 extends
  `auto-compact-control.ts`.
- Rejected: fork/resume rollback. It ships only if E4 passes (R5.6). This plan does NOT schedule E4 inside the L budget
  and does not build rollback; BACKOFF is the failure answer. Recorded so E4 can be picked up later.

### D8. A3 reuses one budget engine, moved down to `tool-output-reducers`

- Requirement: R5.2 ("no second capper").
- Chosen approach: move the generic part of `applyToolResultBudget` (reduce, fit, spool, trailer;
  `tool-result-budget.ts:162-215, 291+`) into `tool-output-reducers` as `applyOutputBudget`. `vscode-lm-tools` keeps its
  Ptah-tool override tables and calls the moved engine. `agent-sdk` calls the same engine from the PostToolUse capper.
- Evidence: agent-sdk (L3) may not import vscode-lm-tools (L4, CONVENTIONS §8). `tool-output-reducers` depends only on
  `platform-core`.
- Rejected: duplicating the spool in agent-sdk (a second capper, forbidden by R5.2).

### D9. Paths: reuse the existing single owners; no new platform port

- Requirement: NFR "Platform boundary (F10)".
- Conflict, stated: the NFR says paths shall resolve through platform adapters. Source shows (a) no platform port
  exposes a home directory, `CODEX_HOME` or `.ptah/tmp`, and (b) the values involved are identical in all three hosts
  (environment plus `os.homedir()`), with ONE owner already: `harness-sync/.../codex-home.ts:44-59`, documented as "the
  one place that decides".
- Resolution: reuse `codexHomeDir()` / `codexHomeConfigFile()` / `parseMcpServerTables()` from `harness-sync` (already a
  `cli-agent-runtime` dependency), and the workspace-relative `.ptah/tmp/...` convention of
  `tool-result-budget.ts:20-24`. Settings DO go through the platform port (`IWorkspaceProvider.getConfiguration` via
  `FILE_BASED_SETTINGS_KEYS`). No path literal is added to `cli-agent-runtime` beyond what these owners return.
- Rejected: a new `IUserDirectories` port with three identical adapters. It would duplicate the harness-sync owner and
  give two answers to "where is `CODEX_HOME`". If the user wants the port anyway, it is a follow-up refactor that moves
  `codex-home.ts` behind it.
- Gate 2 question (F13): this changes the approved NFR "Platform boundary". The Gate 2 message must ask the user to
  accept D9 explicitly. If the user declines, the port refactor becomes a prerequisite batch before components 1, 8,
  10 and 14.

### D10. `~/.codex/config.toml` budget write: line-scoped edits with a preview built by construction

- Requirement: R4.5, decision 5.
- Chosen approach: `planCodexTopLevelKeyEdits(content, desired)` (pure, harness-sync) finds each managed top-level key
  before the first table header. It replaces the value on the user's own line and keeps any trailing comment. It inserts
  a missing key into a `# ptah:begin lane-budgets` / `# ptah:end lane-budgets` fence placed before the first table, and
  deletes the line when the desired value is empty. It returns the new text plus the exact list of line changes, which
  is the diff preview. No diff library is needed, because the writer knows every line it touches.
- Evidence: TOML forbids duplicate keys, so a fenced copy of a key the user already set would break the file. The
  existing facet already uses fences, `.bak` and an atomic write under a lock (`codex-toml-mcp-facet.ts:205, 277-289`).
- Rejected: a TOML parse/serialize round-trip (no comment-preserving library, `codex-toml-mcp-facet.ts:9-12`).

### D11. Measurement tool M: rewrite the existing usage script in TypeScript

- Requirement: R1.1-R1.3, the before/after tables of R3.4, R3.6, R8.2, R8.3.
- Chosen approach: replace `scripts/agent-usage-report.mjs` with `scripts/agent-usage-report.ts` plus readers under
  `scripts/agent-usage/`, keep the existing aggregate views, add a per-lane mode and an OpenCode reader (`node:sqlite`,
  read-only). Specs run under `npm run test:scripts`.
- Rejected:
  - A second script next to the old one: two tools that parse the same rollouts and drift apart.
  - Putting M in product code: M is a QA and developer tool, and it reads user stores the product never needs.

### D12. Lane guards live in `cli-agent-runtime`, observing segments the manager already receives

- Requirement: R9.1, R9.3, R9.4, R9.5.
- Chosen approach:
  - `LaneBudgetGuard` (one instance per tracked lane) counts `tool-call` segments and identical tool+argument keys.
  - `LaneResumeGate` decides resume or fresh from the last per-request context figure:
    - Codex: read from the rollout's last `token_count`;
    - OpenCode: read from the last `step_finish`;
    - otherwise a labelled estimate.
  - Both are owned by `AgentProcessManager` and do no I/O of their own beyond the rollout read.
- Rejected: enforcing inside each adapter. That gives six copies, and the stop or steer must go through the manager's
  router anyway.

### D13. Blocking waits are new MCP tools backed by an event-based manager wait

- Requirement: R9.2.
- Chosen approach:
  - `AgentProcessManager.waitForAgents(ids, mode, timeoutMs)` resolves on `agent:exited` events, with no polling.
  - The new `ptah_agent_wait` and `ptah_run_check` tools sit in `vscode-lm-tools` `mcp-core`, on both the HTTP and the
    stdio surfaces.
  - `ptah.agent.waitFor` is rewritten to call the same manager method.
- Summary size bound (open note F7): every response of both tools is at most **4,000 chars**. That is half the
  8,000-char MCP result budget (`tool-result-budget.ts:54`), so no reply is ever spooled again. Full logs go under
  `<workspace>/.ptah/tmp/checks/`. Codex sets `mcp_servers.ptah.tool_timeout_sec = 960`, above the 900 s maximum wait.

### Assumptions (each has the check that resolves it)

| ID   | Assumption                                                                                                                                                                                                                                           | Resolved by                                                                                                                                                                                                                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AS1  | `tool_output_token_limit` caps code-mode `exec_command` and MCP output on GPT-6                                                                                                                                                                      | Codex L run C1 (deliberate large read); fallback R4.2 wording                                                                                                                                                                                                                                                                                    |
| AS2  | `agents.enabled=false` removes the `spawn_agent` tool itself                                                                                                                                                                                         | C1 asks the model to list its tools; fallback `agents.max_depth=1` in S5                                                                                                                                                                                                                                                                         |
| AS3  | `mcp_servers.ptah.enabled_tools` has an effect inside code-mode `ALL_TOOLS`                                                                                                                                                                          | C1; ships UNSET (R3.1 fallback)                                                                                                                                                                                                                                                                                                                  |
| AS4  | `mcp_servers.<name>.enabled=false` for every user server name found in home and trusted-workspace `config.toml` disables it in a real run                                                                                                            | offline `codex mcp list --json` with the lane's overrides (R3.1 offline check), then C1                                                                                                                                                                                                                                                          |
| AS5  | Codex accepts `-c` keys it does not know without failing                                                                                                                                                                                             | offline: `codex exec --help`-level probe with an unknown key at QA (no model call); the runner's one-retry path covers a rejection either way                                                                                                                                                                                                    |
| AS6  | Omitting `developer_instructions` on `codex exec ... resume` keeps the original role in history (it is a history item)                                                                                                                               | S2 offline: M scans existing rollouts of resumed Ptah lanes and reports whether the developer message appears twice in a resumed request. Then run C2 (R3.5). S1a keeps resending the role, which is the fallback and today's behaviour; S5 flips `CODEX_RESUME_RESENDS_ROLE` to `false` only when both checks show the role survives in history |
| AS7  | OpenCode `step_finish.part.tokens` is per step, not cumulative, and carries `cache.read` on 2.x                                                                                                                                                      | developer: compare a captured `--format json` line with `opencode.db` `session_message.data.tokens` rows offline; O1 run                                                                                                                                                                                                                         |
| AS8  | OpenCode compaction fires when context passes (model window − `compaction.reserved`); sampled zero compactions are from unknown model windows or reserve size                                                                                        | developer: read the installed opencode source/docs offline before setting the constant; O1 proves it                                                                                                                                                                                                                                             |
| AS9  | `updatedToolOutput` for built-in tools must keep the tool's own output shape                                                                                                                                                                         | capper rewrites the text field inside the original shape (Bash `stdout`/`stderr`, Grep `content`, Read `file.content`, MCP `content[].text`) and leaves an unknown shape unchanged; Claude-side L run K4                                                                                                                                         |
| AS10 | Forwarded subagent assistant messages (`parent_tool_use_id` set) carry `message.usage`                                                                                                                                                               | developer: fixture from a `~/.claude/projects/**/subagents/*.jsonl` line, which the ledger already parses; if absent, the A5 monitor stays observe-only and logs it                                                                                                                                                                              |
| AS11 | The Anthropic request reaching the translator carries the session id (in `metadata.user_id` or a header)                                                                                                                                             | developer: open `AnthropicMessagesRequest` and the proxy request handler in `translation-proxy-base.ts`; fallback key = proxy routing id                                                                                                                                                                                                         |
| AS12 | Ollama exposes a model's true window (`/api/show` `model_info.*.context_length`) on the cloud and daemon endpoints                                                                                                                                   | developer reads Ollama docs; U1 run records the window applied; failure means "unknown"                                                                                                                                                                                                                                                          |
| AS13 | The tool-list token size of code-mode `ALL_TOOLS` is not observable                                                                                                                                                                                  | recorded as unknown (open note); no requirement depends on it                                                                                                                                                                                                                                                                                    |
| AS14 | Every host builds `ConfigManager` with `FILE_BASED_SETTINGS_KEYS` as its file-based key set, so adding `compaction.*` there reroutes `CompactionConfigProvider` reads in VS Code, Electron and `ptah-cli`                                            | developer: open each host's `ConfigManager` construction (the app DI phase files) before component 6b lands; if a host passes a different set, add the keys there too                                                                                                                                                                            |
| AS15 | A Codex config rejection exits non-zero before any JSON event, and its stderr matches `/(error loading config\|invalid configuration\|unknown (config(uration)? )?(key\|field)\|failed to (parse\|deserialize)[^\n]*(config\|toml)\|-c\/--config)/i` | developer: capture a real fixture with a command that makes no model call (for example `codex features list -c model_auto_compact_token_limit="x"` on the bundled binary) and store it as the runner spec fixture; adjust the pattern to the fixture                                                                                             |

## Contracts

### New and changed settings

File-based keys (added to `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS`,
`platform-core/src/file-settings-keys.ts:154, 453`; exposed through `agent:getConfig` / `agent:setConfig`;
`SCOPED_SETTING_KEYS` entries `appScopable:false, supportedTargets:['global']` like `codexModel` at
`rpc-auth.types.ts:346`):

| Key (`ptah.` prefix)                                   | Type                                                         | Default  | 0 / empty means                             | UI location                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------ | -------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| `agentOrchestration.codexModel` (existing)             | string                                                       | `''`     | Ptah lane default `gpt-6-sol` (NEW meaning) | existing select; help text "Leave empty to use Ptah's lane default (gpt-6-sol)" |
| `agentOrchestration.codexReasoningEffort` (existing)   | `'' \| inherit \| minimal \| low \| medium \| high \| xhigh` | `''`     | R2.3 steps 4-6                              | existing select gains "Inherit chat effort"                                     |
| `agentOrchestration.copilotReasoningEffort` (existing) | same set                                                     | `''`     | same                                        | existing select                                                                 |
| `agentOrchestration.piReasoningEffort` (existing)      | pi set + `inherit`                                           | `''`     | same                                        | existing select                                                                 |
| `agentOrchestration.codexAutoCompactTokens`            | integer ≥ 0                                                  | `120000` | 0 = Codex runtime default                   | new "Codex lane budgets" card                                                   |
| `agentOrchestration.codexToolOutputTokenLimit`         | integer ≥ 0                                                  | `2500`   | 0 = Codex runtime default                   | same card                                                                       |
| `agentOrchestration.codexWebSearch`                    | boolean                                                      | `true`   | off is a user choice                        | same card                                                                       |
| `agentOrchestration.laneToolCallSteerAt`               | integer ≥ 1                                                  | `40`     | —                                           | new "Lane guards" row                                                           |
| `agentOrchestration.laneToolCallStopAt`                | integer > steer                                              | `60`     | —                                           | same                                                                            |
| `agentOrchestration.laneRepeatCallStopAt`              | integer ≥ 2                                                  | `20`     | —                                           | same                                                                            |

The `inherit` value is added to `CLI_REASONING_EFFORT_VALUES` and `PI_REASONING_EFFORT_VALUES`
(`rpc-agents.types.ts:156-176`). The allowlist `invalidReasoningEffort` in `agent-rpc.handlers.ts:80-93` uses those
arrays, so it accepts `inherit` with no extra code. The popover's `EFFORT_LABELS`
(`cli-model-effort-popover.component.ts:19-21`) gains `inherit: 'Inherit chat effort'`. Every new read uses
`getConfiguration('ptah', 'agentOrchestration.<key>', default)`, the routed form (F17).

Compaction keys (F7). They become file-based: added to `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS`,
read by `CompactionConfigProvider` through `ConfigManager`, which routes file-based keys to the store
(`config-manager.ts:91-117`; AS14), and kept in `KNOWN_CONFIG_KEYS` (`settings-export.types.ts:59-60`).

| Key                                                                                   | Type                               | Default                                | Write path             | UI                                                      |
| ------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------- | ---------------------- | ------------------------------------------------------- |
| `compaction.threshold` (existing; moves from VS Code configuration to the file store) | integer \| null, 100,000-1,000,000 | null → A1 class default when E2 passed | `compaction:setConfig` | lane budgets card; numeric field with inline validation |
| `compaction.toolOutputBudgetTokens`                                                   | integer 500-50,000                 | `2500`                                 | same                   | same card                                               |
| `compaction.subagentHandoffTokens`                                                    | integer 50,000-1,000,000           | `150000`                               | same                   | same card                                               |
| `compaction.rotationSuggestTokens`                                                    | integer 100,000-2,000,000          | `300000`                               | same                   | same card                                               |

- `compaction.enabled` stays a VS Code-contributed key, unchanged.
- Migration: a one-shot step copies a VS Code-set `ptah.compaction.threshold` into the file store when the store has no
  value. It follows the guarded pattern of `migrateAgentOrchestrationSettings` (`agent-rpc.handlers.ts:1139`), with its
  own state flag.
- `apps/ptah-extension-vscode/package.json:259-268` drops the `compaction.threshold` declaration, so VS Code does not
  show a setting that is no longer read there.

Constants (not settings): `CODEX_LANE_DEFAULT_MODEL = 'gpt-6-sol'`; `BLOCKED_LANE_MODELS = ['mimo-v2.6-flash-free']`
(matched on the id after the last `/`, case-insensitive); `RESUME_GATE_MAX_CONTEXT_TOKENS = 60_000`;
`RESUME_GATE_MAX_IDLE_MS = 600_000`; `LANE_ROLE_MAX_CHARS = 10_000`; `WAIT_SUMMARY_MAX_CHARS = 4_000`;
`CODEX_PTAH_TOOL_TIMEOUT_SEC = 960`; `CODEX_RESUME_RESENDS_ROLE = true` (S5 may flip it);
`CODEX_VERIFIED_VERSIONS = ['0.155', '0.160']` (major.minor prefixes); `CURATOR_PRECOMPACT_MIN_INTERVAL_MS = 900_000`;
`COMPACTION_MAX_DWELL_MS = 180_000`; `A1_DEFAULT_WINDOW = { claude: null, proxied: null }`. S5 sets the A1 defaults
to `200_000` per class only after E2 passes for that class.

### New and changed types

- `libs/shared/src/lib/types/agent-process.types.ts`:
  - `SpawnAgentRequest.effort?: string` (caller-settable; validated by the zod schema).
  - `AgentProcessInfo.stopReason?: 'tool-call-budget' | 'repeat-call' | string` (status, card and completion signal
    read it).
  - `AgentProcessInfo.lastRequestContext?: { tokens: number; source: 'rollout' | 'stream' | 'estimate' }`.
  - `CliOutputSegment.usage` gains `cacheReadTokens?: number`, `cacheCreationTokens?: number` and
    `contextTokens?: number`. `inputTokens` now means NON-cached input for every adapter that reports cache.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts`: `CliCommandOptions` gains
  `laneBudgets?: { autoCompactTokens: number; toolOutputTokenLimit: number; webSearch: boolean }`. There is no
  `cliVersion` field (F2): the Codex adapter derives the version of the binary it actually runs (component 3).
- `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`: `AgentOrchestrationConfig` and `AgentSetConfigParams` gain the
  six new lane keys above.
- New `libs/shared/src/lib/types/rpc/rpc-compaction.types.ts` (F7):
  - `compaction:getConfig` returns `{ threshold: number | null; toolOutputBudgetTokens; subagentHandoffTokens; rotationSuggestTokens }`.
  - `compaction:setConfig` takes a partial of the same and returns `{ success: boolean; error?: string; field?: string }`.
  - Validation of the ranges in the table above runs before any write. A failure returns `field` and the message
    "Values outside A-B are not applied". Methods go in the method map and in `RPC_METHOD_ENTRIES`
    (`rpc.types.ts:3665`).
- New `libs/shared/src/lib/types/rpc/rpc-codex-config.types.ts`, registered in the method map (near `rpc.types.ts:1240`)
  and in `RPC_METHOD_ENTRIES` (`:3665`):
  - `codexConfig:previewLaneBudgetWrite` takes `{ keys: Array<'model_auto_compact_token_limit'|'tool_output_token_limit'|'model_reasoning_effort'|'web_search'> }`
    (the keys the user ticked; F8) and returns
    `{ path, exists, baseHash, changes: Array<{ key, op: 'set'|'insert'|'remove', line, before?, after? }>, refused?: string }`.
  - `codexConfig:applyLaneBudgetWrite` takes `{ keys, baseHash }` and returns `{ written: boolean; backupPath?; conflict?: true }`.
- `AnthropicProvider.reportsCacheUsage?: false` (`provider-registry.ts:73`), set on `OLLAMA_PROVIDER_ENTRY` (`:34`) and
  `OLLAMA_CLOUD_PROVIDER_ENTRY` (`:114`).
- `MESSAGE_TYPES.SESSION_CONTEXT_ADVISORY = 'session:contextAdvisory'` (`message-constants.ts` near `:136`). Payload:
  `{ sessionId, kind: 'rotation-suggested', contextTokens, threshold, seedPrompt }`.
- `UsageRecord.costUsd: number | null` (`session-usage-ledger.ts:21-34`). `null` means unknown.
- `SkillBudgetUsage` gains `cacheReadTokens?`, `cacheCreationTokens?` (`skill-budget.store.ts:100`). Migration
  `0052_skill_budget_cache_tokens` adds two `INTEGER NOT NULL DEFAULT 0` columns.

### New DI tokens

- `CLI_AGENT_RUNTIME_TOKENS.LANE_RESUME_GATE` (`Symbol.for('LaneResumeGate')`), registered in
  `cli-agent-runtime/src/lib/di/register.ts`. `LaneBudgetGuard` is a plain class the manager constructs per lane (no
  token; one instance per lane, no state shared across lanes).
- `SDK_TOKENS.SDK_COMPACTION_COORDINATOR`, `SDK_TOKENS.SDK_CONTEXT_USAGE_PORT`, `SDK_TOKENS.SDK_TOOL_OUTPUT_CAPPER`,
  `SDK_TOKENS.SDK_SUBAGENT_BUDGET_MONITOR`, `SDK_TOKENS.SDK_SESSION_ROTATION_ADVISOR`, `SDK_TOKENS.SDK_CODE_OUTLINER`
  (optional injection; the hosts register `TreeSitterCodeOutliner` from vscode-lm-tools
  `mcp-core/code-outliner.adapter.ts:338`; absent in a host means Read reduction falls back to the log reducer plus the
  path pointer). All are `Symbol.for(...)` in `agent-sdk/src/lib/di/tokens.ts` (pattern `:49`).
- harness-sync writer: `CodexConfigKeysWriter` is a plain class with no DI token. It is exported through a declared
  deep-import path, `@ptah-extension/harness-sync/codex-config`: a new `tsconfig.base.json` path entry pointing at
  `libs/backend/harness-sync/src/codex-config.ts`, per CONVENTIONS §3 (F16). The 341-line barrel is not widened.
  The rpc-handlers handler constructs it with the resolved path owner.
- New services log through `PLATFORM_TOKENS.OUTPUT_CHANNEL` (`IOutputChannel`). The Codex runner and the builders take
  a `(line: string) => void` sink that the adapter wires to its existing logger. No new file imports `vscode-core`.

### Generated Codex `--config` keys (order is the emitted order)

| Key                                 | Value                              | When                                                                                                                                                           | Requirement                                |
| ----------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `agents.enabled`                    | `false`                            | always                                                                                                                                                         | R3.2, R9.6                                 |
| `features.plugins`                  | `false`                            | always                                                                                                                                                         | R3.2, R3.1 (drops `codex_app`, `cua_repl`) |
| `features.apps`                     | `false`                            | always                                                                                                                                                         | R3.2                                       |
| `skills.include_instructions`       | `false`                            | always                                                                                                                                                         | R3.2, R3.4                                 |
| `model_auto_compact_token_limit`    | N                                  | `codexAutoCompactTokens > 0` (default 120000), first turn AND resume                                                                                           | R4.1                                       |
| `tool_output_token_limit`           | L                                  | `codexToolOutputTokenLimit > 0` (default 2500)                                                                                                                 | R4.2                                       |
| `web_search`                        | `"live"` / `"disabled"`            | from `codexWebSearch` (default live)                                                                                                                           | R4.4, NFR                                  |
| `approval_policy`                   | `"never"`                          | always (as today, `codex-cli.adapter.ts:651`)                                                                                                                  | no regression                              |
| `model_reasoning_effort`            | resolved effort                    | when R2.3 yields one                                                                                                                                           | R2.3                                       |
| `mcp_servers.ptah.url`              | scoped URL (`ptahMcpServerUrl`)    | MCP port present                                                                                                                                               | NFR TASK_2026_364                          |
| `mcp_servers.ptah.tool_timeout_sec` | `960`                              | MCP port present                                                                                                                                               | R9.2                                       |
| `mcp_servers."<name>".enabled`      | `false`                            | each user server name found in `codexHomeConfigFile()` and in a trusted workspace `.codex/config.toml`, except `ptah`; key quoted with TOML basic-string rules | R3.1                                       |
| `developer_instructions`            | condensed role block (JSON-quoted) | first turn always; on resume and `continue()` only while `CODEX_RESUME_RESENDS_ROLE` is `true` (S1a ships `true`; S5 flips it on AS6 evidence)                 | R3.5, R3.6                                 |

Flags beside `--config`: `--model <resolved>`, `--sandbox danger-full-access`, `--cd <workingDirectory>`,
`--skip-git-repo-check`, and `resume <threadId>` on resume and continuation turns.

Not emitted: `features.tool_search_always_defer_mcp_tools` (deleted), `mcp_servers.ptah.enabled_tools` (AS3, unset),
`agents.max_depth` (AS2 fallback, S5 only), `--ignore-user-config`, `--profile`.

### Generated `OPENCODE_CONFIG_CONTENT`

```json
{
  "mcp": {
    "ptah": { "type": "remote", "url": "<scoped url>", "enabled": true },
    "<userServer>": { "enabled": false }
  },
  "compaction": { "auto": true, "prune": false, "reserved": OPENCODE_COMPACTION_RESERVED_TOKENS }
}
```

- `<userServer>` entries appear only if R1.3 finds that lanes load user servers (R8.2). Names come from the user's
  OpenCode config directory (the reader opens it read-only).
- `prune` ships `false` and S5 flips it to `true` only if run O2 shows no regression (N6 definition below).
- The `reserved` constant is set after AS8 is checked offline.
- Plugins: no documented per-process disable exists in the fetched docs (research :40). If R1.3 finds lane-loaded
  plugins, they are recorded as a gap and not disabled by guesswork.

### `~/.codex/config.toml` write (R4.5)

- Path: `codexHomeConfigFile()` (honours `CODEX_HOME`).
- Managed keys, all top-level:
  - `model_auto_compact_token_limit`;
  - `tool_output_token_limit`;
  - `model_reasoning_effort`, written only when the user set a concrete level (never `inherit` or empty);
  - `web_search`.
- Opt-in only. The settings card has a "Write these values to the Codex config used outside Ptah" button. It opens a
  dialog with one checkbox per managed key, all unticked by default (F8: "user set" means the user ticked that key in
  this dialog). Preview runs for the ticked keys only, the change list is shown, and apply runs only on an explicit
  Confirm. An unticked key is neither written nor removed. Ptah never calls apply anywhere else.
- Key matching normalises bare and quoted forms (`web_search`, `"web_search"`, `'web_search'`) for both lookup and
  duplicate detection (F8).
- Apply:
  1. take `withMcpConfigLock`;
  2. re-read the file and compare its hash with `baseHash` (on a mismatch, return `conflict` and write nothing);
  3. write `<path>.bak` with the previous bytes;
  4. write the new bytes atomically with `atomicWriteWithRetry`.
- Every byte outside the edited lines is unchanged (pinned by a spec on a fixture that has comments, CRLF, tables,
  profiles and a user-set managed key).
- Refusals, returned by preview with nothing written:
  - a multi-line string (`'''` or `"""`) or an inline table spanning lines inside the top-level region;
  - a duplicate managed key already in the file.

## Component specifications

Requirement IDs in brackets.

### 1. CodexLaneConfigBuilder [R3.1, R3.2, R3.5, R4.1, R4.2, R4.4, R9.2, R9.6, R9.7]

- Purpose: produce the exact `--config` list for one Codex lane turn.
- Responsibilities:
  - Emit the key table above for the `first-turn` and `resume` variants.
  - Quote dotted and special-character keys.
  - Validate numbers (finite integers ≥ 0).
  - Add a warning when the `codexVersion` input (the version of the binary the lane will actually execute, supplied by
    component 3) is outside `CODEX_VERIFIED_VERSIONS`, or is unknown.
  - Emit `developer_instructions` on the resume variant only while `CODEX_RESUME_RESENDS_ROLE` is `true`.
  - Read user MCP server names through a separate helper, `codex-user-mcp-servers.ts`. It uses `parseMcpServerTables`
    on the home and trusted-workspace files and is read-only.
- Verified contracts: `ptahMcpServerUrl` (`cli-adapters/ptah-mcp-url.ts`); `parseMcpServerTables`, `codexHomeConfigFile`
  (`harness-sync/src/index.ts:201-213`); workspace trust reader `harness-sync/.../codex-project-trust.ts:176`.
- Dependencies: `harness-sync` (existing direction), `shared`. No DI, no `vscode-core`.
- Integration: called by the adapter (component 3) and by the capture script (component 10).
- Failure: an unreadable or unparsable user config yields no disable entries plus a warning. The lane still starts with
  `features.plugins=false`, so plugin servers are gone anyway.
- Quality: pure and deterministic; equal input gives byte-equal output.
- Verification seam: `codex-lane-config.builder.spec.ts`. It pins:
  - every key, the order and the quoting;
  - both variants, with resume carrying `developer_instructions` while the constant is `true` (and a case for `false`
    proving omission);
  - the absence of the dead flag;
  - numeric validation;
  - the version-out-of-range and version-unknown warnings.
- Slice: S1a.
- Files:
  - CREATE `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-config.builder.ts`
  - CREATE `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-user-mcp-servers.ts`
  - CREATE the matching `.spec.ts` files.

### 2. CodexExecRunner [R9.8, R1.2, failure path for rejected keys]

- Purpose: run one `codex exec --experimental-json` turn and yield parsed `ThreadEvent`s.
- Responsibilities:
  - Build argv (flags above), env (`process.env` + `FORCE_COLOR=0`, `NO_COLOR=1`,
    `CODEX_INTERNAL_ORIGINATOR_OVERRIDE=codex_sdk_ts` when unset), spawn with `shell:false`, write prompt to stdin.
  - Split stdout on `\n` only (a `jsonl-line-splitter.ts` helper; also strips a trailing `\r`), parse each line, log and
    skip any line that does not parse. The log holds the first 200 chars, never the whole line, passed through
    `redactSecrets(text, secrets)` (`sdk-error-summary.ts:34`). `secrets` holds the values of `CODEX_API_KEY` /
    `OPENAI_API_KEY` when they are in the child env (F19). Stderr excerpts follow the same rule.
  - Collect stderr; on non-zero exit raise the same shape of error the adapter already summarises with
    `summarizeCliSdkError`.
  - Kill the child on abort and when the consumer stops iterating (same guarantee as the SDK's `finally`, which
    `codex-cli.adapter.ts:738-746` relies on).
- Verified contracts: SDK arg grammar `index.js:178-262`; `resolveCodexNativeBinary` `codex-cli.adapter.ts:246-330`;
  `assertCommandLineWithinLimit` (imported at `codex-cli.adapter.ts`, from `cli-adapter.utils.ts`).
- Dependencies: `child_process`, `shared`. Log sink injected as a function.
- Integration: the adapter's `runTurn` replaces `thread.runStreamed` with `runner.run({ args, prompt, signal })`.
- Failure:
  - Unparseable line: logged and skipped; the turn continues.
  - Config rejection: exit ≠ 0 before any JSON event, with stderr matching the AS15 pattern (fixture captured with a
    no-model-call command). The adapter retries ONCE with only `mcp_servers.ptah.*`, `developer_instructions`,
    `approval_policy`, `web_search` and `--model`. No model call happened, so the retry is idempotent. On that retry:
    - a WARN carries the redacted stderr excerpt;
    - an `info` segment says: "Codex rejected a lane budget key; this run uses Codex defaults and the full Codex prefix";
    - the `Lane policy` INFO line for that lane is re-emitted with `prefixKeys: 'dropped (config rejected)'` (F12), so the
      grown-back prefix (about 31k chars) is visible in the log, not only in the stream.
      A second failure is a normal error segment.
  - S1a note: on the SDK path, the same detection and retry apply to the SDK's thrown error text ("Codex Exec exited
    with code ..." plus stderr; `index.js:298-303`).
  - No native binary (S1b): spawn refused with the D2 message.
  - Startup watchdog 30 s kept (`codex-cli.adapter.ts:684-716`).
- Quality: one child per turn; every listener removed in `finally`.
- Verification seam: `codex-exec.runner.spec.ts` with a fake child process emitting:
  - a fixture line whose `aggregated_output` contains U+2028, U+2029 and U+0085 (must parse as ONE event);
  - a garbage line (skipped and logged);
  - a split chunk boundary in the middle of a line;
  - abort;
  - non-zero exit;
  - config rejection (the captured AS15 fixture) followed by a successful retry;
  - a stderr containing a fake API key, which comes out redacted.
- Slice: S1b.
- Files:
  - CREATE `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-exec.runner.ts`
  - CREATE `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/jsonl-line-splitter.ts`
  - CREATE the matching specs.

### 3. CodexCliAdapter rewire [R2.1 (list), R3.1, R3.2, R3.5, R9.8]

- Purpose: keep the adapter as the event-to-segment mapper and handle owner.
- 3a (S1a, SDK path) responsibilities:
  - `runSdk` builds the first-turn variant (component 1) and constructs `new sdk.Codex({ configOverrides, env, codexPathOverride })`.
    Each `continue()` turn and each `resumeSessionId` spawn constructs a new `Codex` with the resume variant and calls
    `resumeThread(threadId)`. The SDK spawns one `codex exec` per turn anyway (`codex-cli.adapter.ts:745-746`), so a
    per-turn instance adds no process.
  - Delete the dead flag block (`:623-632`).
  - Version (F2): a new helper, `resolveCodexNativeBinaryInfo()`, returns `{ path, version }`. `version` is read from
    the `package.json` of the `@openai/codex-<platform>` package that owns the resolved binary: the package root is
    four levels above `vendor/<triple>/<layout>/<binary>`, matching `relsFromPkg` at `:259-261`. If that file is
    missing, a single cached `probeCliVersion(path)` is used. The version is passed to component 1 and logged.
    `detect()` is not used for this.
  - Default-model failure (F10): when `turn.failed` or `error` text matches a model-not-found or unsupported-model
    message and the model source was `ptah-default`, emit an error segment: "Codex rejected `gpt-6-sol`, Ptah's lane
    default. Set `agentOrchestration.codexModel` to a model your account offers." Never retry with another model. With
    a user- or request-chosen model, the message names that source instead.
  - Keep `buildTaskPrompt(..., resumeRestoresContext: true)` (`:674-677`).
  - Resume-site comment (R3.5): states that the role is resent while `CODEX_RESUME_RESENDS_ROLE` is `true`, and gives
    the measured extra chars per resume. The chars come from the capture; tokens are filled in from M on C2 in S5.
  - Update `SUPPORTED_MODELS` (`:507-514`) to the GPT-6 list (`gpt-6-sol`, `gpt-6-luna`, `gpt-6-astra`), noting that
    Ptah's default is `gpt-6-sol`.
- 3b (S1b) responsibilities: replace the SDK exec with component 2 behind the same turn seam; delete `getCodexSdk`;
  add the no-binary error (D2).
- Dependencies: component 1 (3a); component 2 (3b); existing utils.
- Failure: as component 2. `turn.failed` and `error` handling unchanged (`:1136-1156`) apart from the F10 message.
- Verification seam: update `codex-cli.adapter.spec.ts`. With an SDK double (3a) or a runner double (3b), assert:
  - first-turn overrides contain `developer_instructions`;
  - resume and `continue()` overrides follow the constant;
  - the dead flag never appears;
  - the ptah URL is still scoped per workspace and agent;
  - `web_search` is live by default;
  - the version comes from the platform package (fixture tree), and the probe fallback works;
  - the F10 message appears for `ptah-default`.
- Files: MODIFY `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts`,
  `codex-cli.adapter.spec.ts`, `cli-adapter.interface.ts` (`laneBudgets`).

### 4. LaneSpawnPolicy [R2.1-R2.5, R9.5]

- Purpose: decide model and effort for a lane, and refuse blocked models.
- Responsibilities:
  - `resolveLaneModel(cli, requestModel, settingModel)` returns `{model, source: 'request'|'setting'|'ptah-default'|'cli-default'}`.
    `ptah-default` applies only to Codex (`gpt-6-sol`).
  - `resolveLaneEffort({cli, spawnEffort, setting, chatEffort, roleName})` returns `{effort, step: 1..6}`, following
    R2.3 exactly. Per-CLI mapping: `mapEffortToCli` / `mapEffortToAgy` / pi raw (moved, not copied, from
    `agent-spawn-environment.service.ts:85-115`).
  - `isReviewerOrTester(roleName)`: ends with `-reviewer` or equals `senior-tester`; undefined means false.
  - `findBlockedLaneModel(model)`.
  - `AgentSpawnEnvironment.resolveModel` / `resolveReasoningEffort` read settings and delegate. They also return lane
    budgets (`codexAutoCompactTokens`, `codexToolOutputTokenLimit`, `codexWebSearch`) with the defaults above.
    - Every read, existing and new, uses the routed form `getConfiguration('ptah', 'agentOrchestration.<key>', default)`
      that upstream introduced (`agent-spawn-environment.service.ts:124-127, 147-150, 173-175`; F17).
    - Upstream already did the key-form fix; this component does not redo it.
    - The model string is passed through unchanged; the antigravity adapter keeps normalising `id<TAB>name` values
      itself (rebase note).
  - `doSpawnSdk`:
    - passes `effort: request.effort`, `roleDefinition.name` and `laneBudgets` (no CLI version; F2);
    - logs one INFO line `[AgentProcessManager] Lane policy` with model, modelSource, effort and effortStep (R2.5);
    - throws `LaneModelBlockedError` (rooted at the lib's error base) before `runSdk` when the model is blocked:
      "Model `<id>` is blocked for lanes because it is known to loop. Choose another model."
  - `effort` added to the spawn schema, the advertised schema and both dispatchers. The parity spec keeps them equal.
- Verified contracts: `agent-spawn-args.schema.ts:15-33`; `tool-description.builder.ts:602-728`;
  `protocol-dispatcher.ts:1058-1102`; `mcp-stdio/agent-tool.dispatcher.ts:350-364`;
  `SpawnAgentRequest` `agent-process.types.ts:151-209`.
- Dependencies: settings through `IWorkspaceProvider` (existing injection `agent-spawn-environment.service.ts:51-52`).
- Failure:
  - An unknown effort string in a setting or argument is ignored at its step and the next step applies; the log names
    the ignored value.
  - Blocked model: spawn refused, nothing started.
- Verification seam:
  - `lane-spawn-policy.spec.ts`: one case per R2.3 step, both identification cases (R2.4), the model sources, and a
    blocked match with and without a provider prefix.
  - `agent-process-manager` spec: the log line and the refusal.
  - `agent-spawn-environment.settings-routing.spec.ts`:
    - the case "still prefers the UI effort selection over the file-stored value" (`:111`) is REWRITTEN to assert the
      R2.3 order: a concrete setting wins over the UI effort, and `inherit` yields the UI effort;
    - the key-form cases stay as they are.
- Slice: S1a, except `findBlockedLaneModel` and the refusal (R9.5), which ship in S4 with the guards.
- Files:
  - CREATE `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.ts` and its spec.
  - MODIFY `agent-spawn-environment.service.ts`, `agent-spawn-environment.settings-routing.spec.ts`, `agent-process-manager.service.ts` (doSpawnSdk only), `libs/shared/src/lib/types/agent-process.types.ts` (`effort`), `vscode-lm-tools/.../mcp-core/agent-spawn-args.schema.ts`, `tool-description.builder.ts`, `protocol-dispatcher.ts`, `mcp-stdio/agent-tool.dispatcher.ts` and their specs.

### 5. Lane role and guidance rendering [R3.4, R3.6, R9.7]

- Purpose: every lane receives at most one copy of guidance and a role block ≤10,000 chars.
- Responsibilities:
  - `condenseLaneRole`, a new pure helper, as described in D5.
  - `renderRoleBlock` applies it.
  - The namespace builder no longer fetches or attaches `systemPrompt` for system-CLI spawns (`:290-293, 313`).
  - `ptah-cli-spawn-options.service.ts:197-206` drops the second guidance copy, and its role rendering (`:203`) uses
    `renderRoleBlock`.
  - Preambles on resume (F6): on a restored-context resume (`resumeSessionId && resumeRestoresContext`,
    `cli-adapter.utils.ts:497-498`), `buildTaskPrompt` also omits `NATIVE_AGENT_TOOL_POLICY` (`:409-415`) and
    `TWO_WAY_MESSAGING_GUIDANCE` (`:442-447`), because the thread history already holds them. It keeps the completion
    contract, which is meant to be the closest instruction (`:540-546`).
- R3.4 item by item (F6). The capture (component 10) records before and after chars for each row in the task folder.

  | R3.4 item                                                                     | Lane type                        | Action                                                                                                                                                                                                                                                                 |
  | ----------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Skill listing                                                                 | Codex                            | Absent: `skills.include_instructions=false` removes `<skills_instructions>` (21,070 chars in the sampled lane; research :24-25).                                                                                                                                       |
  | Skill listing                                                                 | Ptah-CLI (Claude SDK)            | Kept and measured. Ptah-CLI lanes get skills through `settingSources` (`ptah-cli-registry.ts:854`), and skills are a capability of those lanes; removing them is a policy change Wave 4.5 left OUT. Justified by the recorded count.                                   |
  | Agent listing (delta)                                                         | Codex                            | Absent: `agents.enabled=false` removes `<multi_agent_role>` and `<multi_agent_mode>` (about 2,700 chars; research :24-25).                                                                                                                                             |
  | Agent listing (delta)                                                         | Ptah-CLI                         | Kept and measured. No option in the pinned SDK was verified to suppress the `agent_listing_delta` attachment in this pass, and guessing one is refused. Recorded count plus an open note for the team-leader.                                                          |
  | Duplicated Ptah-CLI guidance                                                  | Ptah-CLI                         | Absent: second copy removed (`ptah-cli-spawn-options.service.ts:197-206`).                                                                                                                                                                                             |
  | Project guidance in lanes                                                     | all task-prompt adapters + Codex | Reduced: full `systemPrompt` (about 12.4k) replaced by capped `projectGuidance` (≤4,000 bytes).                                                                                                                                                                        |
  | Lane preambles (tool policy about 1 KB, messaging 826 B, completion contract) | all `buildTaskPrompt` adapters   | Reduced: tool policy and messaging are omitted on restored-context resume. First turn keeps all three. They carry pinned contracts (`cli-adapter.utils.ts:432-436` 826-byte pin; TASK_2026_515 completion contract) and total about 3k chars; the counts are recorded. |

- Verified contracts: `renderRoleBlock` `cli-adapter.utils.ts:465-477`; `AgentRoleDefinition.sourcePath`
  `agent-process.types.ts:81-82`.
- Dependencies: none new.
- Failure: a body with no `## ` headings is cut at the last paragraph break before the cap. The cap is never exceeded,
  including the header and the pointer line.
- Quality: ≤10,000 chars for every role, including team-leader (24,830 B source).
- Verification seam:
  - `cli-adapter.utils.spec.ts`: cap holds for synthetic 5k, 12k and 25k bodies; whole-section retention; the pointer
    names the omitted headings and the path.
  - A table spec that renders every `.claude/agents/*.md` present in the repo for Codex and opencode and asserts
    ≤10,000. It also prints the before/after table that R3.6 records.
  - A guidance-once spec on Codex `developer_instructions` plus task prompt and on the opencode prompt: the guidance
    string occurs at most once (R3.4 offline check).
  - A resume spec: with a restored context, the prompt carries neither the tool policy nor the messaging block, and
    keeps the completion contract.
- Slice: S1a.
- Files:
  - CREATE `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/lane-role-condenser.ts` and its spec.
  - MODIFY `cli-adapter.utils.ts` and its spec, `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts` and its spec, and `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts` and its spec.

### 6. Lane settings contract (backend) [R4.4 backend, R2.3 `inherit`, R9.3, R9.4 settings]

- Purpose: make the new keys readable in all three hosts and settable over RPC.
- Responsibilities:
  - Keys and defaults go in `file-settings-keys.ts`.
  - `AgentOrchestrationConfig` / `AgentSetConfigParams` fields.
  - `SCOPED_SETTING_KEYS` entries and `KNOWN_CONFIG_KEYS` entries.
  - `agent-rpc.handlers.ts` get (`:181`) and set (`:272`), with range validation for the numeric keys: integers,
    steer < stop, repeat ≥ 2.
    - The validation is a new function beside `invalidReasoningEffort` (`:80-93`), called inside the existing
      validate-before-write block (`:282-295`). It returns `{ success:false, error:'Unsupported <field> value' }` before
      any write, so the generic catch (`:394-406`, fixed message) can never mask it (F17).
    - Reads and writes use `getAgentCfg` / `setAgentCfg` (`:1089-1109`).
    - An invalid write is rejected with the field name, never clamped.
  - The `inherit` value is added to both effort arrays (`rpc-agents.types.ts:156-176`).
  - The legacy migration list (`:1144-1155`) is NOT extended: the new keys never lived in the legacy store.
- Verified contracts: listed in the evidence rows for settings and RPC.
- Failure: invalid writes are rejected at the RPC boundary. Hand-edited invalid file values are treated as the default
  by the reader (pattern `agent-spawn-environment.service.ts:196-210`).
- Verification seam: `agent-rpc.handlers.spec.ts` and the existing `set-config` spec: get/set round-trip, rejection
  cases, and a case proving a rejected field returns its own message and not "Could not save the orchestration
  settings."; `file-settings-keys` spec (defaults present).
- Slice: S1a for the three Codex budget keys and `inherit`; S4 for the three lane-guard keys.
- Files: MODIFY `libs/backend/platform-core/src/file-settings-keys.ts`, `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`, `libs/shared/src/lib/types/rpc/rpc-auth.types.ts` (`SCOPED_SETTING_KEYS` `:371`, beside `:409-416`), `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`, `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` and specs.

### 6b. Compaction settings contract (backend) [R5.1 visible rejection, R5.2-R5.4 settings; F7]

- Purpose: a defined, host-independent read and write path for `compaction.*`.
- Responsibilities:
  - Add the four keys to `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS`.
  - Remove the `compaction.threshold` declaration from `apps/ptah-extension-vscode/package.json:259-268`.
  - One-shot migration of a VS Code-set threshold, guarded by a state flag, in the new handler's `register()`. It
    follows `migrateAgentOrchestrationSettings` (`agent-rpc.handlers.ts:1139`).
  - New `CompactionRpcHandlers` with `compaction:getConfig` / `compaction:setConfig`. Validation runs before any write,
    and reads and writes go through `IWorkspaceProvider.getConfiguration` / `setConfiguration('ptah', 'compaction.<key>')`.
  - `CompactionConfigProvider` keeps reading through `ConfigManager`, which now routes these keys to the file store
    (`config-manager.ts:91-117`; AS14). It also reads the three new keys.
- Failure: out-of-range values are rejected with the field and the range; nothing is written. A hand-edited invalid
  value is treated as unset (existing behaviour, `compaction-config-provider.ts:62-76`).
- Verification seam: handler spec (validation, round-trip, migration runs once and never clobbers a store value);
  provider spec (new keys, defaults).
- Slice: S3 (with the UI).
- Files:
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/compaction-rpc.handlers.ts` and its spec.
  - CREATE `libs/shared/src/lib/types/rpc/rpc-compaction.types.ts`.
  - MODIFY `libs/shared/src/lib/types/rpc.types.ts` (method map, `RPC_METHOD_ENTRIES` `:3665`), `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`, `libs/backend/platform-core/src/file-settings-keys.ts`, `libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts`, `apps/ptah-extension-vscode/package.json`.

### 7. Settings UI: lane budgets card [R4.4, R4.5 UI, R2.1 description, R5.1 visible rejection, N6 hint]

Re-anchored on the rebuilt settings surface (F18). `ptah-cli-config.component.ts` was deleted upstream.

- Purpose: editable controls with suggested defaults, the opt-in TOML write, and the hints.
- Responsibilities:
  - A new `ptah-lane-budget-settings` component, mounted in the `orchestration-settings.component.ts` template right
    after the deferred `<ptah-cli-orchestration-matrix>` block (`:44-49`). It sits inside its own `@defer (on viewport)`
    block, because the orchestration template notes that the eager bundle is at its budget (`:44`). It holds:
    - Codex auto-compact tokens, tool-output limit and web search;
    - the three lane-guard numbers;
    - `compaction.threshold` with inline validation 100,000-1,000,000 and the message "Values outside 100,000-1,000,000
      are not applied";
    - `compaction.toolOutputBudgetTokens`, `subagentHandoffTokens` and `rotationSuggestTokens`;
    - a curator hint: "Background memory curation also spends tokens; choose its provider under Background Model
      Roles". It points at the existing `background-roles-details` section of the same template (`:63-82`);
    - the "Write to Codex config" button. It opens the per-key checkbox dialog (F8), then preview with Confirm/Cancel.
      The change list renders as plain rows (key, before, after).
  - Codex help text naming `gpt-6-sol`:
    - `cli-model-effort-popover.component.ts`: the model help line (`:82`) and the default label (`:91`) show "Ptah
      default (gpt-6-sol)" when the cell is Codex. Other CLIs keep "Provider default".
    - `cli-matrix-rows.ts`: `cliModelDisplay` / row building (`:159-164`, `:204`) shows "Ptah default (gpt-6-sol)" for
      an empty Codex model.
  - "Inherit chat effort": `EFFORT_LABELS` (`cli-model-effort-popover.component.ts:19-21`) gains `inherit`. The options
    come from the shared arrays, which component 6 extends.
  - No-cache hint (N6): `provider-connection-card.component.ts` takes a new `reportsCacheUsage` input. For `false`, the
    card shows: "This provider does not report prompt caching, so every request is charged for the full context."
    `providers-settings.component.ts` passes the flag from the provider entry.
  - State:
    - `providers-settings.types.ts`: a new `ProvidersLaneBudgetField` union (the six `agentOrchestration` keys), joined
      into the `orchestration` patch type (`:89-94`).
    - `ProvidersCommitService`: the field loop at `:185-205` is extended with these fields, keeping write plus read-back
      for each.
    - New patch member `compaction?` with its own write/read-back operations through `compaction:setConfig` /
      `compaction:getConfig`.
    - `ProvidersSettingsStateService` gains `compaction` and `codexConfigPreview` read states plus the two
      `codexConfig:*` calls. The commit feedback block in `orchestration-settings` (`:84-94`) reports saves as it does
      today.
- Dependencies: components 6, 6b and 8. Style: the local `CONTROL` constant pattern (`orchestration-settings.component.ts:18`).
- Failure: an RPC rejection shows the field-level message (the commit's `unsaved` list plus the returned message). A
  `conflict` from apply re-runs preview and says the file changed. A refused preview shows the refusal and disables
  Confirm.
- Quality: every control has a `<label for>`; errors use `role="alert"`, and status text uses `role="status"`
  (`orchestration-settings.component.ts:53, 58`).
- Verification seam:
  - component specs for each control's save and validation, and for the dialog → preview → confirm → apply sequence;
  - specs for the popover and matrix rows (Codex default label, inherit option);
  - `providers-commit.service.spec.ts` (new fields, read-back) and `providers-settings-state.service.spec.ts`;
  - `provider-connection-card` spec (hint);
  - webview e2e scenarios: extend `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-cli-matrix.entries.ts`
    (inherit option, Codex default label) and add a lane-budget scenario next to it.
- Slice: S3.
- Files:
  - CREATE `libs/frontend/chat/src/lib/settings/ptah-ai/lane-budget-settings.component.ts` and its spec.
  - MODIFY `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts`, `cli-model-effort-popover.component.ts`, `cli-matrix-rows.ts`, `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts`, `providers-settings.component.ts`, `libs/frontend/core/src/lib/services/providers-settings.types.ts`, `providers-commit.service.ts`, `providers-settings-state.service.ts`, `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-cli-matrix.entries.ts` and specs.

### 8. Codex config keys writer (harness-sync + RPC) [R4.5]

- Purpose: the only code that writes `~/.codex/config.toml` for this task.
- Responsibilities:
  - Pure `planCodexTopLevelKeyEdits(content, desired)`, as in D10. Key lookup and duplicate detection normalise bare,
    `"quoted"` and `'quoted'` key forms (F8).
  - Service `CodexConfigKeysWriter`:
    - `preview(keys)` reads the file. A missing file gives an empty plan with `exists:false`, and apply then creates
      it. It returns the changes for the ticked `keys` only, plus `baseHash`.
    - `apply(keys, baseHash)` follows the steps under Contracts.
  - Only ticked keys are touched (F8: "user set" means ticked in the dialog). For a ticked key the value comes from the
    current Ptah setting. Empty or 0 removes the key, and `inherit` or empty effort removes `model_reasoning_effort`.
    Unticked keys are left exactly as they are.
  - RPC handlers `codexConfig:previewLaneBudgetWrite` / `codexConfig:applyLaneBudgetWrite`.
- Verified contracts: `codexHomeConfigFile`, `atomicWriteWithRetry`, `withMcpConfigLock` (`harness-sync/src/index.ts:186, 211, 298`);
  backup pattern `codex-toml-mcp-facet.ts:277-289`. The deep-import entry re-exports the writer and the plan function only.
- Slice: S3.
- Dependencies: harness-sync internals; rpc-handlers → harness-sync (existing direction).
- Failure: conflict, refusal and write error are all returned as values, never thrown across RPC. A failed write leaves
  the original file intact (atomic).
- Security: the path comes only from `codexHomeConfigFile()`, never from the caller. Values are validated against the
  setting types before rendering. Strings are TOML basic strings.
- Verification seam: `codex-top-level-keys.spec.ts`, byte-identical outside edits, on fixtures for:
  - comments, CRLF, profiles and `[mcp_servers.*]` tables;
  - a user-set key with a trailing comment (value replaced, comment kept);
  - an absent key (inserted into the fence before the first table);
  - an empty value (line removed);
  - a multi-line string (refused);
  - a duplicate key, including one bare and one quoted spelling (refused);
  - unticked keys left untouched even when the setting differs.
    `codex-config-keys-writer.spec.ts`: hash conflict, `.bak` written, no write without apply. RPC handler spec.
- Files:
  - CREATE `libs/backend/harness-sync/src/lib/targets/codex-config/codex-top-level-keys.ts`, `codex-config-keys-writer.service.ts` and specs.
  - CREATE `libs/backend/harness-sync/src/codex-config.ts` (deep-import entry); MODIFY `tsconfig.base.json` (path `@ptah-extension/harness-sync/codex-config`, beside the existing `@ptah-extension/harness-sync` entry). `harness-sync/src/index.ts` is NOT modified (F16).
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/codex-config-rpc.handlers.ts` and its spec; MODIFY `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts` and `libs/shared/src/lib/types/rpc.types.ts` (method map + `RPC_METHOD_ENTRIES`).
  - CREATE `libs/shared/src/lib/types/rpc/rpc-codex-config.types.ts`.

### 9. Usage accounting and display [R7.1-R7.4]

- Purpose: honest, non-double-counted usage with cost or "unknown".
- Responsibilities:
  - Codex `handleTurnCompleted` emits `inputTokens = input - cached`, `cacheReadTokens = cached` and `outputTokens`. The
    text line keeps both figures.
  - OpenCode `handleStepFinish` does the same with `tokens.cache.read` when present (AS7). Every step emits
    `contextTokens` (input + cache read) for component 14. The `stop` step keeps the display line.
  - `stats-bar.utils.ts` sums `cacheReadTokens` separately and never adds it to input.
  - `session-usage-ledger.ts` computes `costUsd` per record with `findModelPricing`. The result is `null` when there is
    no entry, or when cache tokens > 0 and the matching cache price is missing (N4).
  - `skill-budget.store.ts` records and sums the cache columns (migration 0052).
  - `subagent-metrics-extractor.ts` dedupes by `message.id`, last line wins (same rule as the ledger
    `session-usage-ledger.ts:124-133`).
  - Displays (agent card, session stats summary) show "not reported" instead of 0 when the route's provider has
    `reportsCacheUsage === false`.
- Failure: a missing price means cost unknown; it is never estimated. Expected and recorded: every `gpt-6-*` lane reads
  "unknown" until the pricing catalogue gains entries. Adding prices is out of scope, since no vendor source gives them
  (research :31).
- Verification seam:
  - adapter specs (Codex and opencode usage shape);
  - `stats-bar.utils.spec.ts`;
  - ledger spec (cost, null cases);
  - store spec + migration spec (pattern `0035_*.spec.ts`);
  - extractor spec with duplicate `message.id` lines;
  - session-stats-summary spec for "not reported".
- Files: MODIFY `codex-cli.adapter.ts` (handleTurnCompleted only), `opencode-cli.adapter.ts` (handleStepFinish only), `libs/shared/src/lib/types/agent-process.types.ts` (usage fields), `libs/shared/src/lib/providers/provider-registry.ts`, `libs/shared/src/lib/providers/entries/local-provider-entry.ts`, `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts`, `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts`, `libs/backend/agent-sdk/src/lib/session-stats/session-usage-ledger.ts`, `libs/backend/skill-synthesis/src/lib/queue/skill-budget.store.ts`, `libs/backend/skill-synthesis/src/lib/subagent-metrics-extractor.ts`; CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0052_skill_budget_cache_tokens.ts` and its spec; MODIFY `migrations/index.ts`.

### 10. Measurement tool M and lane capture [R1.1, R1.2, R1.3 offline, R3.4/R3.6/R8.2/R8.3 tables, L inputs]

- Purpose: offline per-lane usage reports, and the exact adapter-generated inputs for L runs.
- Responsibilities:
  - `scripts/agent-usage-report.ts` replaces the `.mjs` and keeps its aggregate sections.
  - `--lanes` prints, per lane: model, effort, first-request input, peak per-request input, total input, cached,
    output, request count, largest single tool output, and compaction events.
  - Sources:
    - Codex: rollout `token_count` / `turn_context` / `session_meta` under `codexHomeDir()/sessions`, honouring
      `CODEX_HOME`;
    - OpenCode: `opencode.db`, `session_message.data.tokens` and `session_v2`, opened read-only with `node:sqlite`;
    - Claude-side: transcripts, as today.
  - Ptah lane identification (R1.2): `originator=codex_sdk_ts`, `source=exec`, AND the lane completion contract marker
    in the first user message. That marker is always appended by `buildTaskPrompt` (`cli-adapter.utils.ts:543-546`); a
    spec pins it against `renderLaneCompletionContract`.
  - `--opencode-config` lists the MCP servers and plugins declared in the user's OpenCode config directory (R1.3).
  - Lane capture (F1, F5). Opt-in Jest entries, not a ts-node script. The real code transitively loads `vscode` (via
    the harness-sync barrel and `vscode-core`), and the lib Jest configs map `vscode` to `__mocks__/vscode.ts`
    (`cli-agent-runtime/jest.config.ts:18`, `agent-sdk/jest.config.ts:17`). Each entry is `describe.skip` unless
    `PTAH_LANE_CAPTURE_DIR` is set, so CI runs never write files.
    - `cli-agent-runtime/src/lib/cli-agents/lane-capture.capture.spec.ts` calls components 1, 5 and 11 and
      `buildTaskPrompt` with a role name and settings taken from env (`PTAH_LANE_CAPTURE_ROLE`, `_CLI`, `_MODEL`,
      `_SETTINGS_JSON`). It writes `<dir>/<cli>-<ts>/{argv.json, env.json, developer_instructions.txt, prompt.txt}`,
      covering both the Codex first-turn and resume variants and the OpenCode `OPENCODE_CONFIG_CONTENT`.
    - `agent-sdk/src/lib/helpers/sdk-query-options-builder.capture.spec.ts` reuses the mock harness of
      `sdk-query-options-builder.spec.ts`. It builds options for three routes (direct Anthropic Claude model, Codex
      proxy on localhost, Ollama Cloud `https://ollama.com`) and writes `options.json` with `settings`
      (`autoCompactWindow`), `strictMcpConfig`, `mcpServers`, `settingSources`, the non-secret `env` keys, and the
      hooks list by name. Secrets are redacted with `redactSecrets` semantics before writing. The Claude-side and
      Ollama L runs (K1-K4, U2-U3) take their options from this file.
    - `scripts/lane-capture.mjs` sets the env and runs both entries through `nx test <project> --testFile=...`, using
      an argument array with no shell. npm script: `lane:capture`.
  - The senior-tester feeds the Codex and OpenCode outputs to `codex exec` / `opencode run`. The Claude-side outputs go
    to a headless SDK session (decision 6).
  - The sessions location (R1.2) is documented in the script header and in `apps/ptah-docs/src/content/docs/agents/cli-agents.md`.
- Failure: a missing store or unreadable line is reported as a skipped source; the report still prints.
- Verification seam: `scripts/agent-usage/*.spec.ts` under `npm run test:scripts`. R1.1 uses a sanitized fixture of the
  74-turn lane: `token_count` numbers and `session_meta` keys only, no content. The developer extracts it read-only from
  the user's rollout. The test asserts first 27,464, peak 183,759, total 9.59M ±0.01M. An opencode fixture DB is
  created in temp. An AS6 report mode (`--resumed`) lists, for every resumed Ptah lane in the store, whether the
  resumed request holds the developer role message once or twice. S2 runs it offline and records the result for S5.
- Slice: S2 (parallel with S1a and S1b). The agent-sdk capture entry can only cover the options that exist when it
  runs, so it is extended in S3 and S4 as components 13 and 17 land.
- Files:
  - REWRITE `scripts/agent-usage-report.mjs` → `scripts/agent-usage-report.ts` (delete the `.mjs`).
  - CREATE `scripts/agent-usage/codex-rollout.reader.ts`, `opencode-db.reader.ts`, `claude-transcript.reader.ts`, `lane-metrics.ts`, specs and `__fixtures__/`.
  - CREATE `scripts/lane-capture.mjs`, `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-capture.capture.spec.ts`, `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.capture.spec.ts`.
  - MODIFY `package.json` (scripts `usage:report`, `lane:capture`).
  - MODIFY `apps/ptah-docs/src/content/docs/agents/cli-agents.md`.

### 11. OpenCode lane config [R8.1, R8.2, R3.4/R3.6 apply via component 5]

- Purpose: compaction effective, user servers disabled per R1.3 finding.
- Responsibilities:
  - Pure `buildOpencodeLaneConfig({mcpUrl, userServerNames, reserved, prune})`.
  - A read-only reader for user OpenCode MCP names.
  - The adapter always sets `OPENCODE_CONFIG_CONTENT` (also without an MCP port, so compaction applies).
- Verified contracts: `opencode-cli.adapter.ts:528-544, 604-611`.
- Failure: an unreadable user config means no disables, plus one WARN log line (no stream segment).
- Verification seam: builder spec (shape, no user disables when the list is empty, prune flag); adapter spec (env set
  with and without a port).
- Files:
  - CREATE `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode/opencode-lane-config.builder.ts`, `opencode-user-mcp-servers.ts` and specs.
  - MODIFY `opencode-cli.adapter.ts` (`buildMcpConfigContent` removed; env assembly).

### 12. Ollama Cloud context window [R1.5]

- Purpose: never fabricate 128,000.
- Responsibilities:
  - Delete `DEFAULT_CLOUD_CONTEXT`; never write `maxTokens` from it or from OpenRouter's similarly named model.
  - When `/api/show` returns a context length (AS12; 5 s timeout, one attempt, no retry), register it as a discovered
    window for provider `ollama-cloud`, so `resolveContextCapacity` reports `provider-catalog`. Otherwise
    `resolveContextCapacity` reports `{tokens:null, source:'unknown'}` (`pricing.utils.ts:518-520`).
  - Pricing matches from OpenRouter stay as they are (cost only).
- Failure: an unreachable endpoint means the window is unknown and the log says why.
- Verification seam: `ollama-cloud-metadata.service.spec.ts` for unmatched, matched and `/api/show` success, failure
  and timeout. No case may yield 128000.
- Files: MODIFY `libs/backend/auth-providers/src/lib/providers/local/ollama-cloud-metadata.service.ts` and its spec.

### 13. Proxied sessions and Responses translator [R6.1, R6.2]

- Purpose: ptah-only MCP on proxied providers; the system prompt sent once and cache-keyed.
- Responsibilities:
  - Shared `isProxiedProviderBaseUrl(baseUrl)`: localhost, Ollama daemon, `ollama.com`, Moonshot. It sits next to
    `includesUserSettingSource`.
  - The options builder adds `strictMcpConfig: true` when it is true. Ptah's own `ptah` server, passed in
    `mcpServers`, stays.
  - The translator stops pushing `translateSystemToDeveloper` when it sets `instructions`, and adds
    `prompt_cache_key = <session id>` (AS11).
  - The proxy logs terminal input and cached tokens at INFO (it already captures them at
    `translation-proxy-base.ts:968-976`).
  - Any part PR #602 already fixed keeps a pinning spec.
  - Live proof gap (F14): dropping the developer item while keeping `instructions` is pinned only by specs. No L run in
    the budget exercises the Codex proxy translator end to end; QA records R6.2 as "unverified against the backend".
    Today both copies are sent and requests succeed, so `instructions` alone is the low-risk direction.
- Failure: no session id means the key falls back to the routing id. The fallback is logged once per session.
- Verification seam: options-builder spec (strict flag on each proxied URL and off for `api.anthropic.com`); translator
  spec (one system copy, key present, a fixture request shaped like a real Claude Code request); proxy-base spec (INFO
  line).
- Slice: S3. U1 (Ollama "before") runs on a pre-S3 build (F5).
- Files: MODIFY `libs/shared/src/lib/utils/auth-env.utils.ts`, `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (strict flag only), `libs/backend/auth-providers/src/lib/translation/responses-request-translator.ts`, `translation-proxy-base.ts` and specs.

### 14. Lane resume gate [R9.1]

- Purpose: never resume a large or stale lane.
- Responsibilities:
  - `LaneResumeGate.evaluate({cli, cliSessionId, lastActivityAt, lastRequestContext})` returns
    `{decision:'resume'|'fresh', reason, contextTokens, source}`.
  - Codex: `codex-rollout-usage.reader.ts` finds `rollout-*-<threadId>.jsonl` under `codexHomeDir()/sessions`, newest
    date directories first, and reads the last `token_count` per-request input (`info.last_token_usage`, field names
    taken from the existing parser in `scripts/agent-usage-report.mjs`).
  - OpenCode: `lastRequestContext` from the stream (component 9).
  - Other CLIs: an estimate labelled "estimate" in the log.
  - Never the `turn.completed` sum.
  - `AgentProcessManager`, on a `resumeSessionId` spawn or a continuation of an idle lane, consults the gate. On
    `fresh` it spawns a new lane with a handoff prompt instead: the new message, the original task, the previous lane's
    final text (last 2,000 chars), and the files it changed (from accumulated `file-change` segments). No git process.
  - The stale "does not support session resume" warning (`:332-336`) is corrected.
- Failure: a missing or unreadable rollout falls back to the estimate. The decision is always logged with its source.
- Verification seam: gate spec (60k boundary, 10-minute boundary, each source, estimate label); rollout reader spec with
  a fixture tail; manager spec: a fresh decision yields a new spawn with the handoff fields.
- Files:
  - CREATE `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts`, `cli-adapters/codex/codex-rollout-usage.reader.ts` and specs.
  - MODIFY `agent-process-manager.service.ts` (resume entry), `di/tokens.ts`, `di/register.ts`.

### 15. Blocking waits [R9.2]

- Purpose: one blocking call instead of polling.
- Responsibilities:
  - `AgentProcessManager.waitForAgents(ids, 'any'|'all', timeoutMs ≤ 900_000)` resolves on `agent:exited`, or on
    timeout with a partial result.
  - `ptah_agent_wait {agentIds, mode, timeoutSec ≤ 900}` returns, per lane: status, exit code, duration, stop reason,
    deliverable check if present, and the last output lines. The whole reply is ≤4,000 chars. The full output stays
    readable through `ptah_agent_read`.
  - `ptah_run_check {project, targets, timeoutSec ≤ 900}`:
    - `project` must match `^[A-Za-z0-9@/_.-]{1,120}$`;
    - `targets` must be a subset of `test`, `lint`, `typecheck`, `build`;
    - it runs `node <workspace>/node_modules/nx/bin/nx.js run-many -t <targets> -p <project> --outputStyle=static`
      from an argument array with `shell:false`, cwd = caller workspace root;
    - the full log goes to `.ptah/tmp/checks/<ts>-<project>.log`;
    - the summary (exit code, duration, per-target result, last failing lines) is ≤4,000 chars;
    - on timeout the process tree is killed and the summary says so.
  - `ptah.agent.waitFor` calls `waitForAgents`, removing its polling loop.
- Verified contracts: dispatcher surfaces and parity spec (component 4 row); tool budget `tool-result-budget.ts:52-54`.
- Failure:
  - Timeout: partial result, no error, safe to call again (438 § 2 contract).
  - Unknown agent id: reported per id.
  - `nx` missing: an error result naming the path.
- Security: argument validation at the MCP boundary (zod); no shell; the path is never taken from the caller.
- Verification seam: manager spec (resolves within one tick of the exit event, partial on timeout); tool specs (size
  bound ≤4,000 asserted, schema rejects a bad project or target, timeout); parity spec updated.
- Files:
  - MODIFY `agent-process-manager.service.ts` (`waitForAgents`).
  - CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-wait.tool.ts`, `run-check.tool.ts`, `wait-tools-args.schema.ts` and specs.
  - MODIFY `tool-description.builder.ts`, `protocol-dispatcher.ts`, `mcp-stdio/agent-tool.dispatcher.ts`, `namespace-builders/agent-namespace.builder.ts`, `system-namespace.builders.ts` (help text, `:508`) and specs.

### 16. Lane budget guard [R9.3, R9.4, R9.6 stop fallback]

- Purpose: bound runaway lanes.
- Responsibilities:
  - Per lane, the guard counts `tool-call` segments. At `laneToolCallSteerAt` it sends ONE steer through
    `sendToAgent`: "You have made N tool calls. Stop exploring, finish the deliverable now, and report." The router
    picks the mode; on Codex that is the next turn boundary (R9.3 fallback).
  - At `laneToolCallStopAt` the manager stops the lane with `stopReason:'tool-call-budget'`.
  - Identical tool+argument keys reaching `laneRepeatCallStopAt` stop the lane with `stopReason:'repeat-call'`. The key
    is the tool name plus normalised `toolInput` JSON, else `toolArgs`, else the tool name alone. Cursor's adapter now
    redacts or drops `toolInput` (rebase), so its keys can be coarser; that is accepted and recorded.
  - S5 only, if AS2 fails: a nested-agent item in the Codex event stream stops the lane.
- Dependencies: the manager's segment subscription (`:535-548`) and `stop` (`:1227`).
- Failure: an `unsupported` steer delivery is logged; the stop threshold still applies.
- Runtime cost: one counter map per lane, released on exit. No timers.
- Verification seam: guard spec (steer once at 40, stop at 60, repeat at 20, settings honoured); manager spec
  (stopReason surfaced in status).
- Files:
  - CREATE `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-budget-guard.ts` and its spec.
  - MODIFY `agent-process-manager.service.ts` (trackSdkHandle hook) and `libs/shared/src/lib/types/agent-process.types.ts` (`stopReason`, `lastRequestContext`).

### 17. A1 auto-compact budget resolver [R5.1]

- Purpose: a default window per model class (when E2 passes), effective-source logging, visible rejection, live
  threshold changes.
- Responsibilities:
  - `resolveAutoCompactControl` takes `{enabled, windowTokens, modelClass:'claude'|'proxied', envWindow}`. It returns
    keys plus `{effectiveWindow, source:'setting'|'env'|'default'|'runtime'}`. Precedence: env (the runtime honours it
    and it wins), then setting, then the class default, then runtime.
  - `CompactionConfigProvider` reads `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (read only, for the log). It rejects
    out-of-range values visibly: WARN plus the UI validation in component 7.
  - The builder logs one INFO line per session start with window and source.
  - On `compaction.threshold` change, active sessions get `applyFlagSettings({autoCompactWindow})`. That needs the
    lifecycle interface (`session-lifecycle-manager.ts:86`) widened.
  - The stale 0.3.150 header is corrected.
  - `package.json` and settings descriptions stop implying forwarding for a class whose E2 failed.
- Mapping (R5.1): Ptah forwards `autoCompactWindow = threshold` unchanged. The runtime computes `autoCompactThreshold`
  from `min(model window, autoCompactWindow)`. E2 records the observed function in `research-report.md`, and this
  module's header cites it.
- Gate: `A1_DEFAULT_WINDOW` values stay `null` (no behaviour change) until E2 passes for a class. S5 sets that class to
  200,000.
  - Why 200,000: it equals the runtime's "unrecognized model" default, so the proxied class sees no regression. For
    Claude 1M-context models it caps context at 200k instead of about 1M, and for 200k models it changes nothing.
  - It is the tokaudit figure (561 :48).
- Failure: E2 fails for a class means no default for that class and its descriptions are corrected. A user env var
  wins and is logged as `source=env`.
- Proof of "the 88/88 `autoCompact {}` result no longer reproduces" (F9): this holds only once S5 sets a default.
  It is mapped to QA after S5. The senior-tester re-runs the audit on session logs and confirms that sessions without a
  user window log `autoCompactWindow` with `source=default`, for each class whose E2 passed. A class whose E2 failed
  stays `{}` by design, and the audit result is recorded with that reason.
- Verification seam: pure spec of every precedence branch and bounds; provider spec (rejection warning, env read);
  builder spec (log line, unchanged output while defaults are null); control-service spec for `applyFlagSettings`.
- Slice: S4 (machinery, defaults `null`); S5 (defaults).
- Files: MODIFY `libs/backend/agent-sdk/src/lib/helpers/auto-compact-control.ts`, `compaction-config-provider.ts`, `sdk-query-options-builder.ts` (log + model class), `session-lifecycle-manager.ts`, `session-lifecycle/session-control.service.ts` and specs. `compaction.threshold` descriptions now live in the UI card and `FILE_BASED_SETTINGS` docs, since component 6b removes the VS Code declaration.

### 18. A3 entry-time capper [R5.2]

- Purpose: oversized built-in tool output is reduced in the same turn.
- Responsibilities:
  - Move the generic engine to `tool-output-reducers` as `applyOutputBudget` (D8). `vscode-lm-tools`'
    `applyToolResultBudget` becomes a thin wrapper that adds its override tables, with no behaviour change, pinned by its
    existing spec.
  - `ToolOutputCapper.cap(toolName, toolInput, toolResponse, cwd)` handles Bash, PowerShell, Grep, Read and non-`ptah`
    MCP tools. `mcp__ptah__*` is skipped because the server already budgeted it.
  - Budget comes from `compaction.toolOutputBudgetTokens`. A whole-file Read (no offset or limit) above the budget gets
    an outline (code reducer with the optional outliner, else markdown or log) and a trailer naming the file path and
    "read with offset/limit". Other tools get the reduced form plus the spool path.
  - The rewrite is shape-preserving (AS9).
  - `PostToolUseHookHandler` returns `hookSpecificOutput.updatedToolOutput` when the capper changed something.
- Failure: fail-open. Any capper error passes the original output through and logs one line.
- Verification seam:
  - engine move covered by the existing `tool-result-budget.spec.ts` (unchanged expectations) plus an engine spec in
    tool-output-reducers;
  - capper spec per tool shape (under budget means no rewrite; over budget means a rewrite with the spool path; Read
    gives an outline with the file path; `mcp__ptah__` is skipped);
  - hook handler spec.
- Files:
  - CREATE `libs/backend/tool-output-reducers/src/lib/output-budget/apply-output-budget.ts`, `spool.ts` and specs.
  - MODIFY `libs/backend/tool-output-reducers/src/index.ts`, `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts`.
  - CREATE `libs/backend/agent-sdk/src/lib/helpers/compaction/tool-output-capper.ts` and its spec.
  - MODIFY `libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.ts`, `agent-sdk/src/lib/di/tokens.ts`, the agent-sdk register file, and the host registrations that bind `SDK_CODE_OUTLINER` (VS Code and Electron app DI phase files).

### 19. A5 subagent budget monitor [R5.3]

- Purpose: hand off a Task subagent at `compaction.subagentHandoffTokens`.
- Responsibilities:
  - Track the per-request context of each subagent from forwarded assistant messages (AS10).
  - At or above the threshold, call the existing `stopSubagent` (`subagent-message-dispatcher.ts:280`).
  - Stream one parent message: "Subagent `<type>` was stopped at N context tokens. Start a fresh subagent with this
    handoff: <description>; its output so far is in the session transcript."
  - Mark the subagent not resumable.
  - Scope (F9): Ptah stops the subagent and hands the parent a ready handoff. The fresh spawn is delegated to the parent
    model, which decides whether and how to start the new subagent. The SDK gives the host no API to spawn a Task
    subagent itself, so R5.3's "spawn fresh" is met by delegation.
  - The options builder sets `subagentPromptCacheTtl: '1h'` only when the session's metadata lists resumable subagents
    (`session-metadata-store.ts:117`).
- Failure: no usage on the stream means observe-only, logged once per session.
- Verification seam: monitor spec on synthetic messages (below threshold no action; at threshold stop + message once);
  builder spec for the selective TTL.
- Files: CREATE `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts` and its spec; MODIFY `sdk-query-options-builder.ts` (TTL only), the session wiring that feeds stream messages (session-query-executor, shared with component 21).

### 20. A6 session rotation advisor + A7 curator guardrail [R5.4, R5.5]

- Purpose: offer rotation at `compaction.rotationSuggestTokens`; coalesce curator PreCompact.
- Responsibilities:
  - A6: when the context-usage port reports at or above the threshold, emit one `session:contextAdvisory` per session
    per threshold crossing. The payload `seedPrompt` holds the task folder paths if known, the latest compact summary or
    the last assistant text (≤4,000 chars), and "continue from here". The path is `SdkAdapterEvents` →
    `SessionLifecycleNotifier` → webview.
  - The chat shows a banner with "Rotate session" (opens a new session tab prefilled with `seedPrompt`; the user
    sends it) and "Keep this session" (dismiss; nothing changes).
  - A7: in the curator reactor (`memory-curator.service.ts:218-276`), keep a per-session watermark `{lastFiredAt}`. A
    PreCompact within `CURATOR_PRECOMPACT_MIN_INTERVAL_MS` is skipped and logged. The reactor stays registered (F12).
- Failure: an advisory broadcast failure is logged (existing pattern `session-lifecycle-notifier.ts:107-113`). Declining
  leaves the session untouched.
- Verification seam: advisor spec (fires once per crossing); notifier spec (new message type); frontend banner spec
  (accept opens prefilled tab, decline is a no-op); curator spec (two PreCompacts within the interval fire once; after
  the interval, fires again; reactor still registered).
- Files:
  - CREATE `libs/backend/agent-sdk/src/lib/helpers/compaction/session-rotation-advisor.ts` and its spec.
  - MODIFY `sdk-adapter-events.service.ts`, `libs/backend/rpc-handlers/src/lib/handlers/session-lifecycle-notifier.ts`, `libs/shared/src/lib/types/messages/message-constants.ts`, `libs/shared/src/lib/types/sdk-hook.types.ts` (payload), `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts`, `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`.
  - CREATE `libs/frontend/chat/src/lib/components/molecules/session-rotation-banner.component.ts` and its spec.
  - MODIFY `libs/backend/memory-curator/src/lib/memory-curator.service.ts` and its spec.

### 21. A8 compaction coordinator + context-usage port [R5.6]

- Purpose: one per-session owner of compaction state.
- Responsibilities:
  - States: IDLE, ARMED, TRIGGERED, COMPACTING, COOLDOWN, BACKOFF and OBSERVE_ONLY.
  - Transitions:
    - IDLE → ARMED at ≥80% of the effective window;
    - ARMED or IDLE → TRIGGERED on PreCompact auto or manual;
    - TRIGGERED → COMPACTING on `status:'compacting'`;
    - COMPACTING → COOLDOWN on `compact_boundary`, recording `pre_tokens` / `post_tokens`;
    - COOLDOWN → IDLE after the next turn;
    - TRIGGERED or COMPACTING → BACKOFF when no boundary arrives within `COMPACTION_MAX_DWELL_MS`;
    - BACKOFF → IDLE after one turn.
  - OBSERVE_ONLY applies to the Codex proxy path and to any class whose E2 failed.
  - Dedupe: a manual `/compact` while TRIGGERED or COMPACTING is not resent and the user sees "compaction already
    running".
  - A coordinator-initiated compact uses the streamed `/compact` path (no `endSession`). It rebinds to `session_id`
    from PostCompact when it differs.
  - `no-activity-watchdog.ts arm()` stops re-arming once compaction has been open for 180 s, then fires its timeout
    path.
  - `IContextUsagePort` returns `{totalTokens, maxTokens, autoCompactThreshold?, source:'sdk-getContextUsage'|'result-usage'|'estimate'}`.
    It calls `getContextUsage({detail:'summary'})` at most once per turn end.
  - Telemetry: `SdkAdapterEvents` emits `compactionStateChanged` (from, to, trigger, pre/post tokens), logged at INFO.
- Failure: BACKOFF on a stalled compaction; the watchdog timeout ends a hung turn as today.
- Verification seam: coordinator spec with synthetic SDK messages for every transition, the dedupe and the rebind;
  watchdog spec (bounded dwell); port spec (provenance).
- Files:
  - CREATE `libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.ts`, `compaction-state.types.ts`, `context-usage.port.ts` and specs.
  - MODIFY `no-activity-watchdog.ts`, `compaction-hook-handler.ts`, `session-lifecycle/session-query-executor.service.ts`, `sdk-adapter-events.service.ts`, `agent-sdk/src/lib/di/tokens.ts`, the agent-sdk register file.

## Requirement → component map

| Req                   | Owning lib / files (component)                                                                        | Proof                                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1.1                  | `scripts/agent-usage/*` (10)                                                                          | unit fixture test                                                                                                                                               |
| R1.2                  | runner originator (2) + M identification + docs (10)                                                  | unit + M on C1                                                                                                                                                  |
| R1.3                  | M opencode reader + `--opencode-config` (10); Ollama baseline                                         | M offline (OpenCode, S2); L U1 on a pre-S3 build (Ollama), recorded before the task PR merges                                                                   |
| R1.4                  | `research-report.md` appendix (senior-tester)                                                         | E2 K1-K3, E3 in U2; E4 not run (rollback not built)                                                                                                             |
| R1.5                  | auth-providers `ollama-cloud-metadata.service.ts` (12)                                                | unit; U1 records the applied window                                                                                                                             |
| R2.1                  | `lane-spawn-policy.ts`, adapter model list, UI text (4, 3, 7)                                         | unit + argv capture; optional C4                                                                                                                                |
| R2.2                  | (4)                                                                                                   | unit                                                                                                                                                            |
| R2.3                  | (4), effort values (6)                                                                                | unit per step                                                                                                                                                   |
| R2.4                  | (4)                                                                                                   | unit, both cases                                                                                                                                                |
| R2.5                  | `agent-process-manager.service.ts` log (4)                                                            | unit on the log call                                                                                                                                            |
| R3.1                  | (1) server disables, dead flag removed (3)                                                            | offline `codex mcp list --json`; C1 lists and calls a `ptah_*` tool                                                                                             |
| R3.2                  | (1)                                                                                                   | unit pins keys; offline `codex debug prompt-input` ≤7,000 chars, no blocked tags                                                                                |
| R3.3                  | no writer in lane path (1, 2)                                                                         | hash of `config.toml` + dir listings before/after C1                                                                                                            |
| R3.4                  | (5), Codex keys (1)                                                                                   | unit guidance-once + resume-preamble spec; per-item before/after table from capture (10)                                                                        |
| R3.5                  | (1, 3)                                                                                                | S1a: unit pins the shipped behaviour (role resent) and the resume-site comment records the measured chars; S2 offline AS6 report; C2; S5 flips only on evidence |
| R3.6                  | (5)                                                                                                   | table spec over every role; ≤10,000                                                                                                                             |
| R3.7                  | (1, 3, 5)                                                                                             | M on C1: first request < 18,000 tokens                                                                                                                          |
| R4.1                  | (1) + setting (6)                                                                                     | unit; C1 config                                                                                                                                                 |
| R4.2                  | (1) + setting (6)                                                                                     | unit; C1 large read (AS1)                                                                                                                                       |
| R4.3                  | (1)                                                                                                   | C1 with T = 40,000 (C3 spare)                                                                                                                                   |
| R4.4                  | (6, 6b, 7)                                                                                            | component specs; e2e matrix scenario                                                                                                                            |
| R4.5                  | harness-sync writer + RPC (8), UI (7)                                                                 | unit byte-identity; no write without apply                                                                                                                      |
| R5.1                  | agent-sdk (17), RPC rejection (6b), UI (7)                                                            | unit; E2 K1-K3, U2; 88/88 audit re-run at QA after S5                                                                                                           |
| R5.2                  | tool-output-reducers + agent-sdk (18)                                                                 | unit; K4                                                                                                                                                        |
| R5.3                  | agent-sdk (19); fresh spawn delegated to the parent model                                             | unit                                                                                                                                                            |
| R5.4                  | agent-sdk + rpc-handlers + chat (20)                                                                  | unit                                                                                                                                                            |
| R5.5                  | memory-curator (20)                                                                                   | unit                                                                                                                                                            |
| R5.6                  | agent-sdk (21)                                                                                        | unit per transition                                                                                                                                             |
| R6.1                  | shared + agent-sdk (13)                                                                               | unit; U2 vs U1 first request                                                                                                                                    |
| R6.2                  | auth-providers (13)                                                                                   | unit; recorded as unverified against the backend                                                                                                                |
| R7.1                  | codex adapter (9)                                                                                     | unit                                                                                                                                                            |
| R7.2                  | skill-synthesis extractor (9)                                                                         | unit                                                                                                                                                            |
| R7.3                  | ledger + store + migration (9)                                                                        | unit; gpt-6 reads unknown                                                                                                                                       |
| R7.4                  | provider flag + displays (9)                                                                          | unit                                                                                                                                                            |
| R8.1                  | (11)                                                                                                  | O1 shows a compaction                                                                                                                                           |
| R8.2                  | (11) + (5)                                                                                            | builder unit; O3 first request before/after                                                                                                                     |
| R8.3                  | M (10)                                                                                                | U1/U3 figures recorded                                                                                                                                          |
| R9.1                  | cli-agent-runtime gate (14)                                                                           | unit                                                                                                                                                            |
| R9.2                  | manager + vscode-lm-tools tools (15), `tool_timeout_sec` (1)                                          | unit (size bound)                                                                                                                                               |
| R9.3                  | guard (16)                                                                                            | unit                                                                                                                                                            |
| R9.4                  | guard (16)                                                                                            | unit                                                                                                                                                            |
| R9.5                  | policy (4)                                                                                            | unit                                                                                                                                                            |
| R9.6                  | (1) `agents.enabled=false`; S5 fallback (16)                                                          | C1 tool listing                                                                                                                                                 |
| R9.7                  | (1, 5): per-lane, stateless config                                                                    | unit: two concurrent builds are independent                                                                                                                     |
| R9.8                  | runner (2)                                                                                            | unit fixture                                                                                                                                                    |
| NFR compatibility     | settings via `FILE_BASED_SETTINGS_KEYS` (6, 6b; AS14); UI shared by VS Code and Electron webviews (7) | typecheck of the three apps                                                                                                                                     |
| NFR platform boundary | D9 (Gate 2 acceptance requested, F13)                                                                 | review                                                                                                                                                          |
| NFR no regression     | ptah URL scoping, web search live, resume (1, 3)                                                      | unit + C1/C2                                                                                                                                                    |
| NFR user-owned files  | (1, 8)                                                                                                | R3.3 check; writer spec                                                                                                                                         |

## Integration architecture

- Data flow (Codex lane):
  1. `ptah_agent_spawn` (schema with `effort`).
  2. `agent-namespace.builder` adds the capped guidance and the role definition, with no `systemPrompt`.
  3. `AgentProcessManager.doSpawn`.
  4. `doSpawnSdk`: lane policy (model, effort, block check), resume gate, budgets.
  5. `CodexCliAdapter.runSdk`: `renderRoleBlock` (condensed), `buildCodexLaneConfig` (first-turn), the SDK `Codex` with
     `configOverrides` (S1a) or `CodexExecRunner` (S1b).
  6. Events become segments; the manager feeds `LaneBudgetGuard`; usage segments carry split cache figures.
  7. `continue()` builds the resume variant and starts a new turn (a new `Codex` instance in S1a, a runner turn in S1b).
- Data flow (Claude session):
  1. Options builder: auto-compact keys and source, `strictMcpConfig` for proxied URLs, selective TTL.
  2. Hooks: PostToolUse → capper; PreCompact/PostCompact → coordinator + curator reactor (coalesced).
  3. Stream: `compact_boundary` → coordinator; subagent usage → budget monitor; turn end → context-usage port →
     rotation advisor → webview.
- State: lane counters and the gate decision live on the tracked lane record and are released on exit. Coordinator
  state is per session and released on session end (sync `dispose`, idempotent, CONVENTIONS §9). The curator watermark
  is a per-session map entry, deleted on session end. Settings persist in `~/.ptah/settings.json` (file-based) or the
  VS Code configuration.
- External boundaries:
  - MCP arguments are validated by zod (spawn `effort`, wait and check args).
  - RPC writes are validated in `agent-rpc.handlers.ts`, the compaction handlers and the codex-config handlers.
  - User config files (`~/.codex/config.toml`, the OpenCode config) are read-only on the lane path and written only by
    component 8 after an explicit apply.
  - Processes are started from argument arrays with `shell:false`.
  - No secret enters a log: the runner logs at most 200 chars of a bad line through `redactSecrets`, and `auth.json`
    is never read by new code.
- Failure and rollback:

| Mechanism                                                                                   | Failure                                    | Behaviour                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex version (of the resolved native binary's package) outside 0.155.x/0.160.x, or unknown | keys may be ignored                        | emit anyway; WARN once per version with "re-run `codex debug prompt-input` check"; R3.2 re-run is a QA step per bump                          |
| No native Codex binary                                                                      | —                                          | S1a: SDK fallback as today; S1b: spawn refused with the D2 message                                                                            |
| Account rejects `gpt-6-sol`                                                                 | —                                          | error segment naming `agentOrchestration.codexModel`; no fallback model                                                                       |
| Codex rejects a key                                                                         | exit before any event, stderr matches AS15 | one retry with essential keys only; WARN + info segment + `Lane policy` line marked `prefixKeys: dropped`; second failure is an error segment |
| Unparseable stdout line                                                                     | —                                          | logged (≤200 chars), skipped; turn continues                                                                                                  |
| User Codex/OpenCode config unreadable                                                       | —                                          | no per-server disables; WARN; plugin servers still off via `features.plugins=false`                                                           |
| Rollout missing (resume gate)                                                               | —                                          | labelled estimate; decision logged with source                                                                                                |
| E2 fails for a class                                                                        | —                                          | no default for that class; descriptions corrected; coordinator OBSERVE_ONLY for that class                                                    |
| Missing pricing / missing cache price                                                       | —                                          | `costUsd = null`, displayed "unknown"                                                                                                         |
| Runtime reports no cache fields                                                             | —                                          | "not reported", never 0                                                                                                                       |
| Ollama window probe fails                                                                   | —                                          | window unknown, source logged                                                                                                                 |
| TOML preview refused / hash conflict / write error                                          | —                                          | nothing written; message to UI; `.bak` only on a real write; atomic write keeps the original on error                                         |
| Compaction setting out of range                                                             | —                                          | `compaction:setConfig` rejects with field and range; nothing written                                                                          |
| Steer delivery unsupported                                                                  | —                                          | logged; stop threshold still enforced                                                                                                         |
| Capper throws                                                                               | —                                          | original output passes through; one log line                                                                                                  |
| Compaction stalls                                                                           | —                                          | BACKOFF after 180 s; watchdog timeout path                                                                                                    |
| `ptah_run_check` timeout                                                                    | —                                          | process tree killed; summary says timeout; log path returned                                                                                  |
| `ptah_agent_wait` timeout                                                                   | —                                          | partial result, no error                                                                                                                      |

- Observability:
  - INFO `Lane policy` line per spawn: model, source, effort, step, Codex binary version, prefix-key state.
  - Codex lane config warnings.
  - Resume gate decision with source.
  - Guard steer and stop with counts.
  - Auto-compact window and source per session.
  - Coordinator state changes.
  - Translator terminal input and cached tokens.
  - Curator skips.
  - M reports per lane, offline.

## Sequencing

| Slice                                       | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Depends on                                                                                                              | Ships alone?                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| S1a (urgent billing, SDK path)              | 1 CodexLaneConfigBuilder; 3a adapter on the SDK with `configOverrides` (dead flag gone, prefix keys, budgets, version from the platform package, F10 error, GPT-6 list; role still resent on resume per `CODEX_RESUME_RESENDS_ROLE = true`); 4 LaneSpawnPolicy minus R9.5 (default model, effort precedence, `effort` arg, R2.5 log, routing-spec rewrite); 5 role cap + guidance once + resume preambles; 6 settings contract for the Codex budget keys + `inherit` | nothing                                                                                                                 | yes. With empty settings, every lane already gets the new defaults. |
| S1b (reliability)                           | 2 CodexExecRunner (R9.8); 3b adapter swaps SDK exec for the runner, deletes `getCodexSdk`, adds the no-binary error                                                                                                                                                                                                                                                                                                                                                  | S1a (component 1 output format, adapter seam)                                                                           | yes; can be reverted alone                                          |
| S2 (measurement)                            | 10 M tool + capture entries; record R1.3 OpenCode baseline, R3.4/R3.6 before tables, AS6 offline report                                                                                                                                                                                                                                                                                                                                                              | nothing (file-disjoint; parallel with S1a and S1b)                                                                      | yes                                                                 |
| S3 (OpenCode, Ollama, accounting, UI, TOML) | 11 OpenCode config (after the R1.3 baseline is recorded); 12 Ollama window; 13 proxied MCP + translator; 9 usage accounting; 6b compaction settings + RPC; 8 TOML writer; 7 settings UI                                                                                                                                                                                                                                                                              | S1a (settings contract), S2 (baseline and capture)                                                                      | yes                                                                 |
| S4 (Claude-side layer + lane guards)        | 17 A1 machinery (defaults null); 18 A3; 19 A5; 20 A6/A7; 21 A8; 14 resume gate; 16 guard + R9.5 block + lane-guard keys (6); 15 waits                                                                                                                                                                                                                                                                                                                                | S1a (manager edits serialised after component 4), S3 (component 9 per-step context for component 14; 6b keys for 18-20) | yes                                                                 |
| QA (Gate 3)                                 | L runs + E2 by senior-tester (plan below). U1 runs on a build of `4e246388a` (pre-S3), the rest on the task branch                                                                                                                                                                                                                                                                                                                                                   | S1a-S4 on the task branch                                                                                               | —                                                                   |
| S5 (evidence follow-ups)                    | A1 defaults per passing class (200,000) and then the 88/88 audit re-run; `CODEX_RESUME_RESENDS_ROLE = false` only if the S2 AS6 report and C2 both show the role survives in history, plus the resume-site comment with the measured tokens; AS2 fallback `agents.max_depth=1` + nested-agent stop; AS3 `enabled_tools` only if proven useful; OpenCode `prune:true` if O2 passes; OpenCode `reserved` tune; R4.2 description gap text if AS1 fails                  | E2, L results                                                                                                           | yes                                                                 |

Depends on E2: component 17 defaults (S5), coordinator OBSERVE_ONLY classes, the R5.1 description text, the 88/88
proof. Depends on live L: AS1-AS4, AS6-AS9, AS12 outcomes; R3.1, R3.3, R3.5 (the omission switch), R3.7, R4.2, R4.3,
R8.1-R8.3, R9.6 acceptance. No capability-reducing switch in S1a-S4 rests on an unverified live assumption; each one
is a constant flipped in S5. The assumptions that do ship early fail safe:

- AS1: a `tool_output_token_limit` with no effect changes nothing.
- AS4: a disable that does not take effect leaves the server as it is today.
- AS9: the capper is shape-preserving and fail-open.

## Test strategy

Offline unit specs are listed per component. The Nx projects run scoped (see handoff).

L-run plan (senior-tester, QA only, never `ptah_agent_spawn`). Inputs:

- Codex and OpenCode runs use the cli-agent-runtime capture entry (`npm run lane:capture`).
- Claude-side and Ollama runs use the agent-sdk capture entry's `options.json` (F5).
- The Codex and OpenCode cheap model is a GPT-6 code-mode model, `gpt-6-luna` (N5).
- Every run has a hard turn cap.
- U1 (the Ollama "before") runs on a build of `4e246388a`, the plan's base and pre-S3. Its options are captured with
  the agent-sdk entry on that same commit, by checking out the entry file or running it from the S2 commit. The
  baseline is recorded in the task folder before the task PR merges, which satisfies R1.3's "no fix merges before its
  baseline".

| Runtime                                                                             | Run                                                                                                                                                                                                                                                                            | What it proves                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Codex (before = 2026-10-03 rollouts + offline `debug prompt-input` baseline 31,874) | C1: `backend-developer` role, `codexAutoCompactTokens=40000`, tool limit 2500, task: "list your tools (name any `spawn_agent`), call one `ptah_*` tool, read `<a >60 KB file>` whole, write a small file"; `config.toml` hash and plugin/skills dir listing before and after   | R3.1, R3.3, R3.7, R4.2 (AS1), R4.3 if context passes T, R9.6 (AS2), AS3, AS4, R1.2 |
|                                                                                     | C2: resume C1's thread with one short message, using the resume variant captured with `CODEX_RESUME_RESENDS_ROLE=false`; M checks that the role text appears exactly once (from history) in the resumed request, and the lane still acts in role                               | AS6 → decides the S5 switch; resume no-regression                                  |
|                                                                                     | C3: resume again with the shipped variant (role resent); M records the extra chars and tokens per resume for the R3.5 comment. If R4.3 was not reached in C1, C3 instead continues C1 past T, and the R3.5 cost comes from the capture's char count × 0.38 (labelled estimate) | R3.5 cost / R4.3                                                                   |
|                                                                                     | C4 (optional): one-turn "reply ok" with empty `codexModel`                                                                                                                                                                                                                     | R2.1 turn_context.model                                                            |
|                                                                                     | C5: reserve                                                                                                                                                                                                                                                                    | —                                                                                  |
| OpenCode (before = `opencode.db` offline)                                           | O1: compaction run, context driven past (window − reserved)                                                                                                                                                                                                                    | R8.1, AS7, AS8                                                                     |
|                                                                                     | O2: same task with `prune:true`                                                                                                                                                                                                                                                | N6 regression check                                                                |
|                                                                                     | O3: role + guidance first request, user servers disabled if R1.3 found any                                                                                                                                                                                                     | R8.2, R3.4/R3.6 on OpenCode                                                        |
|                                                                                     | O4-O5: reserve                                                                                                                                                                                                                                                                 | —                                                                                  |
| Claude-side (Claude quota)                                                          | K1: Claude model, `autoCompactWindow=150000`, one tiny request, `getContextUsage({detail:'summary'})`                                                                                                                                                                          | E2 (a)                                                                             |
|                                                                                     | K2: proxied Codex id, same                                                                                                                                                                                                                                                     | E2 (b)                                                                             |
|                                                                                     | K3: K1 with `CLAUDE_CODE_AUTO_COMPACT_WINDOW` set                                                                                                                                                                                                                              | E2 (c)                                                                             |
|                                                                                     | K4: built-in Bash with large output                                                                                                                                                                                                                                            | R5.2, AS9                                                                          |
|                                                                                     | K5: reserve                                                                                                                                                                                                                                                                    | —                                                                                  |
| Ollama Cloud (Claude-side session on Ollama Cloud)                                  | U1 (before): 3-5 turns; first-request input, growth, cache fields, applied window                                                                                                                                                                                              | R1.3, R1.5, AS12                                                                   |
|                                                                                     | U2 (after): same task with R6.1 strict MCP + autoCompactWindow, `getContextUsage` each turn                                                                                                                                                                                    | R6.1, E2 (b) for Ollama ids, E3                                                    |
|                                                                                     | U3: peak per-request after                                                                                                                                                                                                                                                     | R8.3                                                                               |
|                                                                                     | U4-U5: reserve                                                                                                                                                                                                                                                                 | —                                                                                  |

Offline QA checks (no quota): `codex debug prompt-input` with the lane overrides (R3.2 ≤7,000 chars, no blocked
tags); `codex mcp list --json` with the lane overrides (R3.1 offline half); M on all runs; the 88/88 `autoCompact {}`
audit re-run after S5 (R5.1).

Recorded as unverified at QA: R6.2 against the live Codex-proxy backend (F14), and the Ptah-CLI agent-listing delta
(F6, measured only).

## Review notes N1, N2, N4, N5, N6

- N1: the 20-call threshold source is `.ptah/specs/TASK_2026_557_tokaudit/research-report.md` Wave 4 item 4 (:318-320
  region, "20 identical tool+args calls per message"). It is a setting (component 16).
- N2: the lane figure is the rollout's permissions + collaboration + environment, about 1.8k chars. The 5,378-char
  permissions in the local render come from default sandbox and approval settings, while lanes run
  `approval_policy=never` and `danger-full-access` (`codex-cli.adapter.ts:651-652`). The R3.2 ≤7,000 render check is
  therefore conservative.
  - Label correction: the 10,000 budget follows from R3.7, not R3.4.
  - Recomputed budget with guidance cut to ≤4,000 (D5): 21.4k base + 1.8k + 10k role + 4k guidance + about 3k preambles
    - about 1.5k task ≈ 41.7k chars ≈ 15.8k tokens at 0.38.
  - Margin: about 2.2k tokens under 18k. AS13 (tool list size) is the unknown; R3.7 stays binding.
- N4: adopted in component 9. A missing cache price with cache tokens > 0 gives unknown cost. `gpt-6-*` lanes read
  "unknown" by design until pricing exists.
- N5: adopted (`gpt-6-luna` for every Codex L run).
- N6: an O2 regression means the fixed task did not complete, or total input was higher than O1. The Ollama no-cache
  hint is restored in the provider card (component 7).

## Architecture-level quality requirements

- Functional:
  - The Codex lane prefix render is ≤7,000 chars, and the first request is under 18,000 tokens.
  - Every role block is ≤10,000 chars.
  - Guidance appears at most once.
  - Role resend on resume is measured and recorded in S1a, and removed in S5 only on evidence (AS6).
  - Lanes default to `gpt-6-sol`.
  - Wait and check replies are ≤4,000 chars.
  - No fabricated 128k window.
  - Cost is never guessed.
- Performance:
  - No per-item timers.
  - The guard is O(1) per segment.
  - The rollout read happens only on a resume decision, reading from the file tail.
  - `getContextUsage` runs at most once per turn end.
- Security:
  - No shell strings.
  - Validated MCP and RPC input.
  - User config written only through component 8 after an explicit apply.
  - `auth.json` is untouched.
  - No secret or raw tool output beyond 200 chars in logs.
- Maintainability:
  - CONVENTIONS layer rule: tool-output-reducers is a util, used by L3 and L4.
  - No new `vscode-core` imports in new files.
  - Tokens use `Symbol.for`, in each lib's `di/tokens.ts`.
  - Barrels stay ≤150 lines. `harness-sync/src/index.ts` is already 341 lines (a pre-existing breach) and is NOT
    widened; the new writer uses the declared deep-import path `@ptah-extension/harness-sync/codex-config` (F16).
  - The adapter loses lines.
- Testability: every R has an offline spec except those whose proof is L by definition. Those are the runs above.

## Team-leader handoff

- Recommended executors: backend-developer for components 1-6, 6b and 8-21 (backend parts); frontend-developer for
  component 7 and the frontend parts of components 9 and 20; senior-tester for M-based baselines review, the QA L runs,
  E2/E3, the U1 pre-S3 build and the `research-report.md` appendix. No CLI lanes.
- Complexity: HIGH. Twenty-two components (1-21 plus 6b) across 16 Nx projects (the 15 libraries in the `-p` list plus
  `@ptah-extension/webview-e2e-harness`). The coordinator and the runner are the riskiest; the runner is isolated in
  S1b.
- Dependencies and ordering (component level):
  - 1 → 3a; 3a → 2/3b (S1b); 6 before 4's settings reads land in the UI (4 can ship with code defaults); 6b → 7, 17,
    18, 19, 20.
  - `codex-cli.adapter.ts` is touched by 3a, then 3b, then 9.
  - 10 before 11 (R1.3 baseline gate).
  - 9 before 14 (per-step context).
  - `agent-process-manager.service.ts` is touched by 4, 14, 15, 16. Serialise them in that order.
  - `opencode-cli.adapter.ts` is touched by 9 then 11. Merge both into one batch if convenient.
  - `sdk-query-options-builder.ts` is touched by 13, 17, 19. Serialise. The agent-sdk capture entry (10) only adds a
    spec file beside it.
  - `compaction-config-provider.ts` is touched by 6b then 17.
  - `rpc.types.ts` is touched by 6b and 8 (method map + `RPC_METHOD_ENTRIES`). Serialise.
  - `register-shared-rpc-handlers.ts` is touched by 6b and 8. Serialise.
  - `file-settings-keys.ts` is touched by 6 (S1a), 6b (S3) and 6 again for the lane-guard keys (S4). Serialise.
  - agent-sdk `di/tokens.ts` and the register file are touched by 18, 19, 20 and 21. Serialise.
  - `agent-process.types.ts` is touched by 4, 9, 16. Serialise or co-locate.
  - `tool-description.builder.ts`, `protocol-dispatcher.ts` and `agent-tool.dispatcher.ts` are touched by 4 then 15.
  - S5 waits for QA evidence.
- Parallel-safe groups (F11). A group is parallel only for the files listed. Any file that appears in the
  serialisation list above is never parallel, even when it sits in the same component.
  - S1a:
    - G-A: components 1 + 3a (`cli-agent-runtime/.../cli-adapters/codex/{codex-lane-config.builder,codex-user-mcp-servers}.ts`, `codex-cli.adapter.ts`, `cli-adapter.interface.ts`).
    - G-B: component 5 (`cli-adapter.utils.ts`, `lane-role-condenser.ts`, `agent-namespace.builder.ts`, `ptah-cli-spawn-options.service.ts`).
    - G-C: component 10 (S2; `scripts/*`, the two `*.capture.spec.ts` files, docs page, root `package.json` scripts).
    - G-D: component 6 (`file-settings-keys.ts`, `rpc-agents.types.ts`, `rpc-auth.types.ts`, `settings-export.types.ts`, `agent-rpc.handlers.ts`).
    - G-A, G-B, G-C and G-D are mutually file-disjoint. Component 4 follows G-A and G-D: it touches `agent-spawn-environment.service.ts`, its routing spec, `agent-process-manager.service.ts`, `agent-process.types.ts` and the vscode-lm-tools dispatchers.
  - S1b: component 2 new files (`codex/codex-exec.runner.ts`, `codex/jsonl-line-splitter.ts`) can be written in parallel with anything; 3b (`codex-cli.adapter.ts`) is serial after 3a.
  - S3:
    - New files only are parallel: 12 (`ollama-cloud-metadata.service.ts`); 8's new harness-sync files and the codex-config handler; 13's `auth-env.utils.ts` and translator files.
    - Serial: `rpc.types.ts`, `register-shared-rpc-handlers.ts` and `file-settings-keys.ts` (6b, 8); `sdk-query-options-builder.ts` (13).
    - 9 and 11 share `opencode-cli.adapter.ts`, so put them in one batch. 7 follows 6, 6b and 8.
  - S4:
    - New files only are parallel: `tool-output-reducers/src/lib/output-budget/*`; `agent-sdk/.../compaction/*.ts`; `lane-budget-guard.ts`; `lane-resume-gate.ts`; the vscode-lm-tools wait and check tool files.
    - Serial: `agent-process-manager.service.ts` (14 → 15 → 16, after 4); `agent-process.types.ts` (16 after 4 and 9); agent-sdk `di/tokens.ts` and register (18 → 19 → 20 → 21); `sdk-query-options-builder.ts` (17 → 19); the dispatchers (15 after 4).
    - `memory-curator.service.ts` (A7) is disjoint and parallel.
- Files affected:
  - CREATE:
    - `cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/{codex-lane-config.builder, codex-user-mcp-servers, codex-exec.runner, jsonl-line-splitter, codex-rollout-usage.reader}.ts`
    - `cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode/{opencode-lane-config.builder, opencode-user-mcp-servers}.ts`
    - `cli-agent-runtime/src/lib/cli-agents/cli-adapters/lane-role-condenser.ts`
    - `cli-agent-runtime/src/lib/cli-agents/{lane-spawn-policy, lane-resume-gate, lane-budget-guard}.ts`
    - `vscode-lm-tools/src/lib/code-execution/mcp-core/{agent-wait.tool, run-check.tool, wait-tools-args.schema}.ts`
    - `harness-sync/src/lib/targets/codex-config/{codex-top-level-keys, codex-config-keys-writer.service}.ts`
    - `rpc-handlers/src/lib/handlers/codex-config-rpc.handlers.ts`
    - `shared/src/lib/types/rpc/rpc-codex-config.types.ts`
    - `tool-output-reducers/src/lib/output-budget/{apply-output-budget, spool}.ts`
    - `agent-sdk/src/lib/helpers/compaction/{compaction-coordinator, compaction-state.types, context-usage.port, tool-output-capper, subagent-budget-monitor, session-rotation-advisor}.ts`
    - `persistence-sqlite/src/lib/migrations/0052_skill_budget_cache_tokens.ts`
    - `frontend/chat/src/lib/settings/ptah-ai/lane-budget-settings.component.ts`
    - `frontend/chat/src/lib/components/molecules/session-rotation-banner.component.ts`
    - `scripts/agent-usage-report.ts`, `scripts/agent-usage/*`, `scripts/lane-capture.mjs`
    - `cli-agent-runtime/src/lib/cli-agents/lane-capture.capture.spec.ts`, `agent-sdk/src/lib/helpers/sdk-query-options-builder.capture.spec.ts`
    - `rpc-handlers/src/lib/handlers/compaction-rpc.handlers.ts`, `shared/src/lib/types/rpc/rpc-compaction.types.ts`, `harness-sync/src/codex-config.ts`
    - a spec beside each of the above.
  - MODIFY:
    - cli-agent-runtime: `codex-cli.adapter.ts`, `opencode-cli.adapter.ts`, `cli-adapter.interface.ts`, `cli-adapter.utils.ts`, `agent-spawn-environment.service.ts`, `agent-process-manager.service.ts`, `ptah-cli-spawn-options.service.ts`, `di/tokens.ts`, `di/register.ts`
    - vscode-lm-tools: `agent-namespace.builder.ts`, `system-namespace.builders.ts`, `agent-spawn-args.schema.ts`, `tool-description.builder.ts`, `protocol-dispatcher.ts`, `mcp-stdio/agent-tool.dispatcher.ts`, `tool-result-budget.ts`
    - shared: `agent-process.types.ts`, `rpc-agents.types.ts`, `rpc-auth.types.ts`, `rpc.types.ts`, `auth-env.utils.ts`, `provider-registry.ts`, `entries/local-provider-entry.ts`, `messages/message-constants.ts`, `sdk-hook.types.ts`
    - platform-core: `file-settings-keys.ts`
    - agent-sdk: `settings-export.types.ts`, `auto-compact-control.ts`, `compaction-config-provider.ts`, `sdk-query-options-builder.ts`, `session-lifecycle-manager.ts`, `session-control.service.ts`, `post-tool-use-hook-handler.ts`, `no-activity-watchdog.ts`, `compaction-hook-handler.ts`, `session-query-executor.service.ts`, `sdk-adapter-events.service.ts`, `session-usage-ledger.ts`, `di/tokens.ts`, the register file
    - auth-providers: `ollama-cloud-metadata.service.ts`, `responses-request-translator.ts`, `translation-proxy-base.ts`
    - harness-sync: none (new files only; the deep-import entry is new)
    - root: `tsconfig.base.json` (deep-import path)
    - rpc-handlers: `agent-rpc.handlers.ts`, `session-lifecycle-notifier.ts`, `register-shared-rpc-handlers.ts`
    - cli-agent-runtime spec: `agent-spawn-environment.settings-routing.spec.ts` (precedence case rewritten)
    - memory-curator: `memory-curator.service.ts`
    - skill-synthesis: `skill-budget.store.ts`, `subagent-metrics-extractor.ts`
    - persistence-sqlite: `migrations/index.ts`
    - tool-output-reducers: `index.ts`
    - frontend chat: `orchestration-settings.component.ts`, `cli-model-effort-popover.component.ts`, `cli-matrix-rows.ts`, `provider-connection-card.component.ts`, `providers-settings.component.ts`, `stats-bar.utils.ts`, `compaction-lifecycle.service.ts`, `chat-message-handler.service.ts`
    - frontend core: `providers-settings.types.ts`, `providers-commit.service.ts`, `providers-settings-state.service.ts`
    - webview-e2e-harness: `scenarios/settings/settings-cli-matrix.entries.ts`
    - frontend chat-ui: `session-stats-summary.component.ts`
    - app and host DI phase files binding `SDK_CODE_OUTLINER` (VS Code, Electron)
    - `apps/ptah-extension-vscode/package.json` (removes the `compaction.threshold` declaration), root `package.json` (scripts), `apps/ptah-docs/src/content/docs/agents/cli-agents.md`
  - REWRITE / DELETE: `scripts/agent-usage-report.mjs` → `.ts`; in `codex-cli.adapter.ts`, delete the dead flag block (S1a) and `getCodexSdk` (S1b).
- Verification points:
  - Contracts to honour: the `--config` key table; the `OPENCODE_CONFIG_CONTENT` shape; the settings table; the 4,000-char reply bound; `tool_timeout_sec` 960 ≥ 900; spawn-surface parity (`agent-spawn-surface-parity.spec.ts`).
  - Data changes: migration 0052 (additive columns, default 0); the one-shot `compaction.threshold` migration to the
    file store (6b), which must never overwrite a store value.
  - Settings read form: every new `agentOrchestration.*` read uses `getConfiguration('ptah', 'agentOrchestration.<key>')`
    (F17), pinned by `agent-spawn-environment.settings-routing.spec.ts`.
  - Commands, scoped per slice. Run only the projects a batch touched, from this list:
    - `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/shared @ptah-extension/platform-core @ptah-extension/agent-sdk @ptah-extension/auth-providers @ptah-extension/harness-sync @ptah-extension/rpc-handlers @ptah-extension/memory-curator @ptah-extension/skill-synthesis @ptah-extension/persistence-sqlite @ptah-extension/tool-output-reducers @ptah-extension/chat @ptah-extension/core @ptah-extension/chat-ui`
    - `npx nx run-many -t test -p @ptah-extension/webview-e2e-harness` for component 7 (the `settings-cli-matrix` scenarios);
    - `npm run test:scripts` for M;
    - the apps' typecheck (`ptah-extension-vscode`, `ptah-electron`, `ptah-cli`) after shared or type changes, and after
      `tsconfig.base.json` gains the deep-import path.
  - S1a minimal set: `-p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/shared @ptah-extension/platform-core @ptah-extension/rpc-handlers @ptah-extension/agent-sdk` (agent-sdk only for `settings-export.types.ts`).
  - QA, offline: `codex debug prompt-input` and `codex mcp list --json` with the captured overrides.
- Open notes for the team-leader (deferred or carried):
  - F6: the Ptah-CLI `agent_listing_delta` is kept and measured; a verified SDK option to suppress it would be a
    follow-up.
  - F13: D9 needs explicit user acceptance at Gate 2. If refused, add a platform-port batch before components 1, 8, 10
    and 14.
  - F14: R6.2 is unverified against the live backend.
  - AS14 must be checked before 6b lands; AS15's fixture must be captured before component 2's spec is final.
  - E4 is not run and rollback is not built (D7).
