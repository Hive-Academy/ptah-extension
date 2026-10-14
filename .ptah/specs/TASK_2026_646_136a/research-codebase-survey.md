# Research — Codebase survey for the routing decision model (TASK_2026_646_136a)

- **Decision this supports:** build `ptah_route_decide` (a decision model that picks task type, lanes, providers and models per phase) fed by a lane outcome record and a capability matrix — what already exists to reuse.
- **Question:** what does this repository already have for lane listing/limits, lane completion signals, per-agent telemetry, background model roles, MCP tool registration, the orchestration skill, and structured-output model calls?
- **Method:** read-only survey of `D:/projects/ptah-extension`. Every citation below was read unless marked `I` (inferred). No builds, tests, lint or state-changing git commands were run.
- **Bounds (deliberately not investigated):** outward facts about Ollama decision models (tev1/nimble/clef/clef-flash/laya) and the Jev API — other research lanes own them (decisions.md #4). Per-adapter internals beyond the cited lines, host wiring (VS Code/Electron/CLI DI beyond the cited registration), and the full body of `protocol-dispatcher.ts` / `tool-description.builder.ts` were not read.

## Answer

Everything the routing tool *consumes* already exists in production shape — the `ptah_agent_list` rows with per-lane limit state, the `<agent-lane-completed>` signal with verdict/duration/deliverables, the Background Model Roles settings surface, the MCP registration path, and the orchestration skill's Pre-flight/Gate 0.1 sections. What does not exist anywhere is the *record*: no lane outcome is persisted after the completion signal fires, there is no capability matrix as data, and the Agents tab's success figure carries no signal (100% for every agent). So the feature is additive — a new store + a new tool + one settings row + skill edits — with `skill-synthesis`'s invocation/verdict tables as the strongest precedent for the outcome record.

---

## 1. Lane listing and limits

**Short answer.** The `ptah_agent_list` tool is built by `buildAgentListTool()` (imported and renamed for the stdio surface in `mcp-stdio/tool-builders.ts`); its response's "Plan limits" / "Alternatives by limit state" sections are rendered by `mcp-response-formatter.ts` with limit-state reason text from `agent-limit.formatter.ts` and lane grouping from the shared `plan-limits/lane-state.ts`. Per-lane limit state is computed by `LaneLimitLookupService` in `cli-agent-runtime`, which resolves each lane's quota owner, reads its snapshot through `PlanUsageService` (auth-providers), and classifies with the shared engine. The four reader messages map to that engine's own statuses.

**Evidence (V = read).**

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/tool-builders.ts:28` (V) imports `buildAgentListTool`; `:117` (V) `return rename(buildAgentListTool(), 'agent_list')` — the stdio tool surface. The definition module of `buildAgentListTool` itself was not pinned (see Gaps).
- Response sections: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:1782` (V, doc) — "`### Plan limits` and `### Alternatives by limit state` sections follow the…"; `mcp-response-formatter.spec.ts:1913-1918` (V).
- Section builder: `mcp-core/agent-limit.formatter.ts:5, 499, 521` (V) — builds `### Alternatives by limit state`.
- Reason text (why readers report each state): `agent-limit.formatter.ts:86` (V) `limit lookup timed out`; `:107`, `:270`, `:287` (V) `limits not tracked`; `:254` (V) `reader failed, aged value`; `:282` (V) `reader failed`; `:441` (V) `limits not tracked, no limit recorded`.
- Lane grouping: `libs/shared/src/lib/utils/plan-limits/lane-state.ts:364` (V) — "Lanes grouped for the 'Alternatives by limit state' section (design §5)".
- Lookup engine: `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.ts:1-45` (V). Header: each lane "names the lane's quota owner, reads that owner's snapshot through `PlanUsageService`, narrows it to the lane's model scope and classifies the lane with the shared engine" (`:4-7`). Deadlines: 3 s normally, 12 s for Codex and Antigravity (`:11-14`); a slow reader "becomes `lookup: 'timeout'` ('limit lookup timed out') and every other lane is still returned" (`:12-14`); a thrown owner/snapshot read "becomes `lookup: 'failed'`" (`:17`); "`lookup` never rejects, so a tool never fails because of it" (`:21`). Statuses `'ok' | 'no-owner' | 'timeout' | 'failed'` at `:84`; `'no-owner' — the lane has no owner rule, so there is nothing to read` (`:80`). Row input carries `cliSessionId` ("CLI session id returned by a Ptah-started lane", `:54-55`) and `quotaOwner` (`:56-60`).
- Reader components (all in `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/`, file list V): `plan-owner-read.ts` (`planOwnerRead` / `snapshotWithoutRead`, imported at `lane-limit-lookup.service.ts:45`), `plan-limit-owner-discovery.service.ts`, `lane-owner.resolver.ts` (owner rules, `:44`), `lane-limit-classifier.ts` (+ shared `classifyLaneState`, `applicableLimits`, `NEAR_LIMIT_PERCENT` imported `:36`). The actual quota snapshot reader is `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts` (`:336` V logs `[PlanUsage] reader failed`; spec `:911` V: "unsupported auth after a cached read carries no windows, and a later failure is not stale"). Codex-specific reader: `cli-adapters/codex/codex-rollout-usage.reader.ts` (V, exists).
- `limits/lane-limit-lookup.service.spec.ts:4` (V): "One slow reader costs only its own lane ('limit lookup timed out')".
- Spawn-side gate: `mcp-core/agent-spawn-limit-gate.ts` + `agent-spawn-limit-gate.spec.ts:273, 281` (V) — refusal reasons `limits not tracked` / `limit lookup timed out`. Transport example: `agent-spawn-limits.transport.spec.ts:123, 413` (V) — `**Limit state:** unknown (limit lookup timed out)`; `ptah_agent_list` output contains `### Alternatives by limit state`.
- `$limits` host read (a consumer of the same rows): `libs/backend/vscode-lm-tools/src/index.ts:21` (V comment); `libs/shared/src/lib/types/rpc/rpc-lane-plan-limits.types.ts:6` (V) — "Read-only per-lane plan-limit rows, as `ptah_agent_list` prints them"; `libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts:81` (V); `libs/shared/src/lib/types/rpc.types.ts:1368` (V).

**Message → cause mapping** (V from the engine header unless noted):
- `limit lookup timed out` = per-lane deadline missed (`lane-limit-lookup.service.ts:11-14`, status `'timeout'` `:81`).
- `reader failed` = owner or snapshot read threw, or the caller cancelled (`:17-18`, `:82`; `plan-usage.service.ts:336`); stale aged-value variant at `agent-limit.formatter.ts:254`.
- `limits not tracked` = no owner rule / nothing recorded (`:80` `'no-owner'`; `agent-limit.formatter.ts:441`).
- `unsupported auth` = the quota read path cannot authenticate for that owner's provider, so no windows are recorded (`plan-usage.service.spec.ts:911`; `I`: its rendering into a row's limit-state text).

---

## 2. Lane completion signal

**Short answer.** `LaneCompletionNotifier` (`cli-agent-runtime`) pushes ONE turn into the spawning session the moment a lane reaches terminal status, using the same `IAgentAdapter.sendMessageToSession` transport as `ptah_agent_report`. The signal carries status, a disk-derived verdict (`delivered` / `no-deliverable` / `failed` / `unverified`), duration, exit code, per-deliverable checks, role and report count. **Nothing is persisted** — no store dependency exists; the only durable trace is the pushed chat message itself plus a log line. `lane-reporting-contract.ts` is the prompt-side twin: the "## Before you exit" block appended to every lane prompt.

**Evidence.**

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-reporting-contract.ts:1-64` (V). Two prompt-assembly points so the contract cannot drift: `buildTaskPrompt` (`cli-adapters/cli-adapter.utils.ts`) for rival CLIs and the `ptahCliId` branch of `agent-namespace.builder.ts` for Ptah CLI lanes (`:7-11`). `renderLaneCompletionContract` `:30-64`: write every declared deliverable, then "call `ptah_agent_report` once", "Never end a turn claiming success for a file you did not write" (`:60`).
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts` (V):
  - Design header `:1-35`: same transport as `ptah_agent_report`; "reports the WORK, not the exit" — exit 0 with no deliverable produces `no-deliverable`, not success (`:19-23`); every refusal returns `delivered: false` with a reason (`:24-28`).
  - `signal()` `:278-357`; dedup key `${agentId}:${completedAt}` in `signalledKeys` (`:256`, `:293-297`), history capped at `SIGNALLED_HISTORY_SIZE = 256` (`:69`).
  - `buildSignal()` `:499-530` — fields: `agentId`, `cli`, `agentLabel`, `role?`, `status`, `exitCode?`, `startedAt`, `completedAt`, `durationMs` (computed `:505-510`), `deliverables` (disk-checked `:512-520`). Signal types (`LaneCompletionSignal`, `LaneCompletionVerdict`, `LaneDeliverableCheck`, `LaneCompletionDelivery`, `LaneCompletionRefusalReason`) come from `@ptah-extension/shared` (`:43-51`). Lines past `:530` (verdict/reports fields) were not read.
  - Verdict rules: `sessionChildVerdictOf` `:132-145` — status ≠ completed → `failed`; no deliverables declared → `unverified`; all written → `delivered` else `no-deliverable`. Deliverable state rendering (MISSING / EMPTY / bytes / "NOT written by this run") `:109-120`.
  - Envelope: `<agent-lane-completed agent-id=… agent=… cli=… status=… verdict=… turn=…>` `:232-234`; session-child variant `buildSessionChildCompletionEnvelope` `:188-236` (duration, branch, worktree, task folder, deliverable lines, "Reports sent by this child so far", last recap, next action).
  - Delivery: `sendMessageToSession(parentSessionId, …)` `:329-339`; refusals `no-parent-recorded` / `chat-runtime-unavailable` / `parent-session-not-active` / `delivery-failed` `:305-345`; log line `:347-354`.
  - Constructor deps `:258-269`: logger, file-system provider (deliverable checks), optional `IAgentAdapter` — **no store, no persistence service**.
- **Persistence: none structured.** The signal exists only as a chat message in the parent session and a log line; dedup history is in-memory. `TASK_2026_646_136a/context.md:94-95` (V): "Ptah does not record lane outcomes (success, failure class, task kind) today". (`I`: the parent session's transcript persists wherever the host persists chat sessions — not verified here.)
- Wiring: `session-children/session-spawner.service.ts:68, 164-165` (V) uses the notifier; `di/register.ts:25, 91` (V) registers it as a singleton in every host; `session-children/session-spawner.port.ts:193` (V) — "Completion push (child → parent), built by `LaneCompletionNotifier`".
- CLI session id: tracked on the lane row (`LaneLimitLookupRow.cliSessionId`, `lane-limit-lookup.service.ts:54-55` V) rather than asserted as a completion field; `tracked-agent.ts` holds live `AgentProcessInfo` (`I` from its name and the type imports).

---

## 3. Agent telemetry (Thoth "Library → Agents")

**Short answer.** The Agents tab is the skill-synthesis clones UI (`skill-clones-view.component.ts`) backed by `skill-clones-state.service.ts` for the list and `agent-models.store.ts` for per-agent models; the backend store is skill-synthesis's SQLite (`skill_candidates`, `skill_invocations`, `skill_invocation_events`, `skill_session_verdicts`). Success is a per-clone reconciled rate from graded runs, shown only when invocation count > 0. The `skillSynthesis:getAgentModels` handler is `SkillsSynthesisRpcHandlers.registerGetAgentModels` — it awaits a provider model-list read on every call, the likely timeout cause. Why every agent shows 100% was **not** pinned.

**Evidence.**

- Agents tab: `TASK_2026_611/context.md:19` (V) — "`skill-clones-view.component.ts` is 967 lines; … Split the Agents-tab harness wiring out". Component folder `libs/frontend/skill-synthesis-ui/src/lib/components/clones/` (V).
- UI stores: `clones/agent-models.store.ts:154` (V) — `attempt(() => this.rpc.getAgentModels())`; snapshot signal `:76-88`. Clones list state: `libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts` (V via `skill-clones-state.service.spec.ts:14`, `successRate: 1` fixture).
- RPC client: `services/skill-synthesis-rpc.service.ts:687-689` (V) — `getAgentModels()` → `'skillSynthesis:getAgentModels'`; spec `:496-513` (V).
- RPC contract: `libs/shared/src/lib/types/rpc.types.ts:2051` (V) method declaration; `:4054` (V) capability map `true`. Also `'skillSynthesis:invocations'` `:1951` (V) and `SkillSynthesisInvocationEntry[]` `:2926` (V).
- Handler: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:328` (V, registration list) and `:1612-1661` (V) `registerGetAgentModels` — returns machine + workspace stored agent-model layers (`settings.layersForPath(workspaceRoot)` `:1640`, `toStoredAgentModelLayer` `:1641-1642`), `await this.loadAgentModelLists()` `:1643`, and classifies every stored value against the server's lists (`classifyAgentModelLayer` `:1649-1652`; lists come from `CliModelListService.listForClassification`, doc `:1604-1606`). A `workspaceRoot` that is not the active workspace is refused `:1610`, `:1626`. **Timeout cause (`I`):** the per-call provider model-list read (`:1643`) is the plausible slow step behind the UI timeout — not verified end-to-end.
- Per-agent model write: `registerSetAgentModel` `:1673-1704` (V) — one `[slug][provider]` value per layer; unsupported providers refused `:1687-1691`; reconcile never started here `:1671`.
- What the tab shows per agent: `clones/scorecard-badge.component.ts:14-16` (V) — "reconciled success-rate badge, invocation count, avg tokens, avg cost… explicit 'no data yet' — never a fabricated zero (R6.3)"; tokens label `:113-117`; cost label `:122-125` (`~$${cost.toFixed(...)}`); `clones/scorecard-detail.component.ts:30` (V) — "runs for that agent (task, verdict, tokens, cost, duration). Each run is a…".
- Success computation: display `clones/clone-action-gating.ts:241-244` (V) — `null` when `invocationCount <= 0` or non-finite, else `${Math.round(clone.successRate * 100)}%`. Backend reconciled rate: `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:1053, 1072` (V) ("Reconciled success rate: …"; spec `:1154` V: "71% (5/7 graded runs"). Scorecard: `skill-scorecard.service.ts:99, 262-266` (V) — zero invocations → `winRate: null`, never `0`. Type: `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts:25` (V) `successRate: number`.
- **Why 100% for every agent — not pinned.** Verified only that the badge is a wins/invocations-derived rate gated on invocation count. (`I`: if every recorded run is graded a win, every row shows 100%.) `skill-trigger.service.ts:497` (V) — "for agent runs. Without this, every authored agent shows 0 invocations in…" (invocation counting for agent runs is wired through the trigger service). Smallest experiment: read the scorecard aggregation in `skill-scorecard.service.ts` / its store and query one agent's graded-run rows (wins vs invocations).
- Tables/schema: `skill-candidate.store.ts:3` (V) — "skill_candidates_vec + skill_invocations"; `skill-candidate.store.spec.ts:110, 129, 139` (V) — `CREATE TABLE skill_candidates` / `skill_invocations` / `skill_invocation_events`; `skill-curator.service.spec.ts:684, 702` (V); `archaeology/session-verdict.store.spec.ts:63` (V) — `skill_session_verdicts`; `types.ts:364-367` (V) — `invocations` field + "Row shape for `skill_invocations`"; `skill-invocation-tracker.ts:2` (V) — "SkillInvocationTracker — records per-session skill invocations and drives…".
- Per-provider copy state: `clones/agent-sync-chips.ts:31` (V) — a sync report with per-file failures "is never announced as success" (the claude-source / codex / copilot / opencode sync chips).

---

## 4. Settings — "Background Model Roles"

**Short answer.** The section is a closed `<details>` in `orchestration-settings.component.ts` rendering `ProviderConsumerAssignmentsComponent` for six fixed consumer ids (`BACKGROUND_CONSUMERS`); row derivation is pure in `provider-consumer-rows.ts`, state via `ProvidersSettingsStateService`. Per-agent (skill-synthesis) models are stored as `[slug][provider]` values in machine/workspace layers (`agentGeneration.models`), classified against provider-reported lists. An Ollama provider exists as a provider id (`provider ollama` CLI command; `ollama-cloud` registry id, one live lane runs on it), but no Ollama-specific background-role code surfaced.

**Evidence.**

- `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts` (V): Background Model Roles `<details>` `:114-168`; summary title `:138`; role-count badge `:142`; helper text "Memory curator, archaeologist, synthesis, judge, replay, judging" `:148-149`; `BACKGROUND_CONSUMERS` ids `:30-37` — `'memory-curator'`, `'archaeologist'`, `'synthesis'`, `'judge'`, `'replay'`, `'judging-enhancement'`; focus targets `'background-models' | 'cli-agents' | BackgroundConsumerId` `:27-28`; the section renders `ProviderConsumerAssignmentsComponent` `:158-165`; state service `:230` `inject(ProvidersSettingsStateService)`; read/retry states for `CLI agents`, `CLI instance models`, `delegated CLI models` `:244-263`; the deferred `CliOrchestrationMatrixComponent` `:19`, `:75`.
- `../providers/provider-consumer-assignments.component.ts:77, 80-92` (V) — selector `ptah-provider-consumer-assignments`, "Row derivation is pure, in `provider-consumer-rows.ts`", `data-testid="provider-consumer-assignments"`; `BackgroundConsumerId` type from `provider-consumer-rows` `:24`; `connection-usage.ts:2` imports it too. E2E: `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/skills-lane-pickers.e2e.spec.ts:392` (V).
- How a role resolves to provider/model (`V` for the per-agent path, gap for the consumer-assignment storage key): per-agent models are `[slug][provider]` in machine/workspace layers — `skills-synthesis-rpc.handlers.ts:1640-1652, 1673-1704` (get/set, `settings.layersForPath`, server-side classification). The consumer→provider assignment RPC key and its backing settings key were **not** pinned (see Gaps).
- Ollama: `apps/ptah-cli/src/cli/router.ts:1342-1383` (V) — `provider ollama` subcommand, "manage the local/remote Ollama endpoint (alias for `provider base-url --provider ollama`)", set/get/clear, notifications `provider.ollama.endpoint.set` / `.cleared` (`formatter.ts:137-138, 304` V). Provider ids `ollama` and `ollama-cloud` are registry values — `apps/ptah-cli/src/test-utils/agent-sdk-mock.ts:16` (V); `tools/mcp-bench/.../rubric-panel-manifest.spec.ts:100` (V) `provider: 'ollama-cloud'`. A live Ptah CLI lane runs on Ollama Cloud — `context.md:38` (V) "available (Ollama Cloud, pc-355b645d-…)". **No Ollama-specific code in the frontend settings surfaced in the search window** (`I`; the grep window was truncated — whether a background consumer can be assigned an Ollama provider is untested).

---

## 5. MCP tool registration

**Short answer.** A `ptah_*` tool is a definition produced through the mcp-core tool builders (`tool-description.builder.ts`, per-tool modules like `agent-wait.tool.ts`), assembled by `buildToolDefinitions` and served by `protocol-dispatcher.ts`, which stamps `_meta['anthropic/alwaysLoad']` for the eager sets and a result-size budget per tool, validates args with zod schemas at the boundary, and is exposed on the stdio surface via `mcp-stdio/tool-builders.ts` (with renames). Consumer-side toolsets filter by namespace.

**Evidence.**

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (V):
  - `ALWAYS_EAGER_TOOLS` `:634-640` — `ptah_search_files`, `ptah_ast_analyze`, `ptah_context_enrich_file`, `ptah_get_diagnostics`, `ptah_workspace_analyze`.
  - `IDE_EAGER_TOOLS` `:643-647` — `ptah_lsp_references`, `ptah_lsp_definitions`, `ptah_get_dirty_files` (only with IDE capabilities). `SQLITE_EAGER_TOOLS` `:650-653` — `ptah_code_search_symbols`, `ptah_memory_search` (Electron SQLite layer).
  - `markEagerTools` `:735-756` stamps `_meta['anthropic/alwaysLoad'] = true`; the `'apps'` profile adds `APPS_ONLY_TOOL_NAMES` `:741-743`; unmarked tools "stay deferred" `:730-733`.
  - `declareResultBudgets` `:771-781` stamps `_meta['anthropic/maxResultSizeChars']` from `getToolResultBudget` (same table that enforces, `tool-result-budget.ts`).
  - `buildToolDefinitions({ hasIDECapabilities: true })` referenced `:620`; registered-name telemetry `:608-625`.
  - Boundary zod schemas `:667-721` (`WebSearchArgsSchema`, `AgentMessageArgsSchema`, `AgentReportArgsSchema`, `AgentReadArgsSchema`, with `strict()` discipline) and `describeZodIssues` `:724-728`. Slow-tool warn env `:783-795`.
- Tool definition builder / profiles / budgets (V, file existence + roles): `mcp-core/tool-description.builder.ts`, `mcp-core/mcp-tool-profile.ts` (profile type incl. `'apps'`), `mcp-core/tool-result-budget.ts`.
- Stdio exposure: `mcp-stdio/tool-builders.ts:28, 117` (V) — `buildAgentListTool` imported, `rename(buildAgentListTool(), 'agent_list')`.
- Namespace filtering: `libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts:834` (V) — memory-curator's `buildToolSet(caller, deps)` = `ALWAYS_EAGER_TOOLS.concat(IDE_EAGER_TOOLS)` filtered by `deps.disabledMcpNamespaces.has(t.namespace)`.
- System-prompt tool table: `code-execution/ptah-system-prompt.constant.ts:231-234, 246, 250, 258, 263` (V) — e.g. `:234` "`ptah_agent_list` | List available agents, their status and their plan-limit state", `:263` "skip lanes whose Limit state is AT LIMIT"; `agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:98, 144, 283-285` (V).
- **Files a new tool touches** (V for existence; pattern taken from `agent-wait.tool.ts`, `run-check.tool.ts`, `dashboard-propose-spec.tool.ts`): the tool module itself; `tool-description.builder.ts` (definition); `protocol-dispatcher.ts` (assembly, eager set if eager, zod args schema, budget); `tool-result-budget.ts` (result ceiling); `mcp-tool-profile.ts` (profile gating); `mcp-core/index.ts` (barrel); `mcp-stdio/tool-builders.ts` (stdio exposure/rename); `ptah-system-prompt.constant.ts` (tool table row); consumer `buildToolSet` namespace filters (e.g. memory-curator); specs following `protocol-dispatcher.spec.ts` / `mcp-contract.sweep.spec.ts` / `agent-spawn-limits.transport.spec.ts`.

---

## 6. Orchestration skill — plug points

**Short answer.** The shipped skill lives in `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/` (SKILL.md + 8 references) with the lane-running detail in `.../skills/agent-lanes/SKILL.md`. A routing tool plugs into: the Pre-flight classify table + depth pick (SKILL.md:14-29), Gate 0.1 (SKILL.md:82, 91-96; `lane-assignment.md:18-37`), and the live-roster block / role handoff table in `lane-assignment.md`.

**Evidence.**

- `skills/orchestration/SKILL.md` (V): `## Pre-flight (run first)` `:12` — classify table `:14-25` (keywords → SAAS_INIT / DEVOPS / CREATIVE / FEATURE / BUGFIX / REFACTORING / DOCUMENTATION / RESEARCH); "Pick depth: Full / Partial / Minimal" `:27-29`; announce `:30`; flow table `:32-41`; Gate 0.1 row `:82` ("Start; search execution preference with `ptah_memory_search`, then read request, settings and `ptah_agent_list`… no-preference default `enabled`"); Gate 0.1 preference rules + "Record the preference source, mode, approval mode and `ptah_agent_list` rows in `context.md`" `:91-96`; "CLI lanes: Gate 0.1 decides whether they are used… lane-assignment.md" `:126-128`; Never list `:130-140`.
- `skills/orchestration/references/lane-assignment.md` (V): who spawns `:10-16`; `## Gate 0.1 outcome` `:18-37` — record in `context.md` under `## CLI Lanes`, and the block appended to every subagent prompt with "Discovered lanes: <the ptah_agent_list rows>" `:26-30`; "The live `ptah_agent_list` rows decide capability and availability; `AT LIMIT` is unavailable even if its reset reads `reset unknown`" `:36-37`; "A CLI lane is the default executor for every bounded batch" `:39-44`; role handoff table `:46-58` (researcher-expert `:56`: "Separate aspects of one question in parallel"); never-on-a-lane list `:60-70`.
- `skills/orchestration/references/checkpoints.md` (V): approval mode set at Gate 0.1 `:96`; `lane-review` condition `:102` ("`ptah_agent_list` shows a spawnable lane **and** Gate 0.1 left lanes `enabled` or `auto`"); `:206` sub-agents per Gate 0.1 outcome.
- `skills/agent-lanes/SKILL.md` (V): `:151` — "re-check with `ptah_agent_list` only at the next Gate 0.1"; `:180` — same-side fallback reasons.
- Skill file inventory (V, glob): `orchestration/` has `SKILL.md` plus references `agent-catalog.md`, `checkpoints.md`, `fleet.md`, `git-standards.md`, `lane-assignment.md`, `strategies.md`, `task-tracking.md`, `team-leader-modes.md`; `agent-lanes/` has `SKILL.md`.
- Context of this task (V): `TASK_2026_646_136a/context.md:29-38` shows the Gate 0.1 lane table with limit states, and `:85` the agreed shape — the skill calls the tool at Pre-flight and Gate 0.1 and shows the result as a table "the user can override".

---

## 7. Structured-output LLM calls (reuse candidates)

**Short answer.** Two production patterns exist: `InternalQueryService` (agent-sdk) — the governed background-query path skill-synthesis and the memory curator already use, with lane concurrency gates and (per its spec) `json_schema` output; and the agent-generation pattern — `outputSchema` built as JSON Schema and passed to the model as `type: 'json_schema'` (prompt-designer, enhanced-prompts, agentic-analysis). Zod-at-the-boundary with readable issue rendering is the established validation idiom (`protocol-dispatcher.ts`).

**Evidence.**

- `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts:1-95` (V): `InternalQueryService` runs headless queries via `SdkQueryRunner` `:13, :65-66` under `InternalQueryConcurrencyGate` / `GOVERNED_BACKGROUND_LANES` `:20-27, :76-84`; settings keys `ptah.internalQuery.maxConcurrent` / `queueTimeoutMs` / `maxConcurrentPerLane` `:33-41`; "Headless callers (`skill-synthesis`'s lane runner, the memory curator)" `:90-92`. Structured output exercised: `internal-query.service.spec.ts:129` (V) — `type: 'json_schema'`.
- `libs/backend/agent-generation/src/lib/services/prompt-designer/prompt-designer-agent.ts:82-122` (V) — returns `systemPrompt`, `userPrompt`, `outputSchema` (`buildJsonSchema()` `:117`); spec asserts the shape `:98-176` (V).
- `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:818, 860-861` (V) — `outputSchema` passed with `type: 'json_schema'`.
- `libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts:193` (V) — `type: 'json_schema'`.
- Boundary validation idiom: `protocol-dispatcher.ts:667-721` (zod schemas, `strict()`), `:724-728` (`describeZodIssues`).
- (`I`) The memory curator's own model calls route through `InternalQueryService` (named at `:90-92`); its schema definitions were not read.

---

## Reuse candidates

| Candidate | Why it fits | Evidence |
| --- | --- | --- |
| `LaneCompletionNotifier.signal()` / `signalSessionChild()` | The natural write point for the lane outcome record: it already has verdict, duration, deliverable checks, exit code and role in hand at the terminal transition — only a store call is missing. | `lane-completion-notifier.service.ts:278-357, 499-530` |
| skill-synthesis SQLite run-row precedent | `skill_invocation_events` / `skill_session_verdicts` already store per-run task, verdict, tokens, cost, duration rows and aggregate them (scorecard) — the closest existing schema for a lane outcome record. | `skill-candidate.store.spec.ts:110-139`; `session-verdict.store.spec.ts:63`; `scorecard-detail.component.ts:30` |
| `SkillInvocationTracker` + scorecard service | Counting and rate aggregation over invocation rows, with the "null, never 0" discipline the routing model needs for low-data lanes. | `skill-invocation-tracker.ts:2`; `skill-scorecard.service.ts:262-266` |
| `LaneLimitLookupService` + `agent-limit.formatter.ts` + `$limits` host read | The limit-state input the decision model consumes is already computed per-lane and readable from the host side. | `lane-limit-lookup.service.ts:1-95`; `rpc-lane-plan-limits.types.ts:6`; `capabilities.ts:81` |
| Background Model Roles UI (`BACKGROUND_CONSUMERS` + `ProviderConsumerAssignmentsComponent`) | Where a "Decision model" role would be added — one id in the array plus a row; deep links and fold behavior already work. | `orchestration-settings.component.ts:30-37, 114-168` |
| `InternalQueryService` (+ `SdkQueryRunner`) | Governed background model call from backend libs, with lanes, timeouts, degradation reporting — the call path for the decision model (SDK-based models). | `internal-query.service.ts:1-95` |
| agent-generation `outputSchema` / `json_schema` pattern | Schema-enforced model output with zod-style validation at the boundary. | `enhanced-prompts.service.ts:818-861`; `prompt-designer-agent.ts:117-122` |
| MCP registration path (`ALWAYS_EAGER_TOOLS`, `markEagerTools`, `tool-result-budget`, `tool-builders.ts`) | The exact route a `ptah_route_decide` tool takes, including eager-vs-deferred and result budgets. | `protocol-dispatcher.ts:634-656, 735-781`; `mcp-stdio/tool-builders.ts:28, 117` |
| Orchestration skill plug points | Pre-flight classify table, Gate 0.1, and `lane-assignment.md`'s Discovered-lanes block are where the tool's result renders. | `orchestration/SKILL.md:12-30, 82, 91-96`; `lane-assignment.md:18-37` |
| `agent-sync-chips` per-provider copy state | Existing per-provider sync-state display pattern if lane capability state is surfaced in the UI. | `agent-sync-chips.ts:31` |

## Gaps (does not exist yet)

1. **No persisted lane outcome record.** No store, table or service records lane outcomes (verdict, failure class, task kind, duration, tokens, cost) after the completion signal — the notifier has no persistence dependency and `context.md:94-95` confirms the gap.
2. **No capability matrix as data.** No file or table holds per-lane-family / per-model strengths by task kind with `source`/`asOf`. The closest existing "matrix" is the CLI orchestration matrix settings UI (`cli-orchestration-matrix.component.ts` — instance/tier/model *configuration*, `orchestration-settings.component.ts:19, 75, 244-263`), not capability scoring.
3. **`buildAgentListTool`'s definition module was not pinned** (imported at `mcp-stdio/tool-builders.ts:28`); the row-building body of the list tool was read only through its formatter/spec neighbors.
4. **Success % carries no signal** — why every agent shows 100% is not pinned (see §3); the aggregation behind the badge needs one read.
5. **No failure-class classifier** (`usage-limit` / `auth` / `crash` / `timeout` / `bad-output`). Nearest existing: `LaneLimitLookupService` statuses (`'timeout'`, `'failed'`, `'no-owner'`) and `cli-adapters/sdk-error-summary.ts` (exists, unread).
6. **Provider-consumer assignment RPC/storage key not pinned** — the component and pure rows exist, but which RPC method persists a role's provider/model was not found in this pass.
7. **No decision-model consumer id** — `BACKGROUND_CONSUMERS` has six fixed ids, none for routing (`orchestration-settings.component.ts:30-37`).
8. **No `ptah_route_decide` tool or Ollama/Jev decision-model client anywhere** — no hits in any search; and no Ollama-specific code in the frontend settings surfaced in the (truncated) search window.

## Decisions (left to the architect)

1. **Where the lane outcome record lives** — new table in `cli-agent-runtime`'s owner (where the notifier fires, but no store exists there today) vs the skill-synthesis SQLite store (precedent: `skill_invocation_events` / `skill_session_verdicts` with verdict/tokens/cost/duration rows) vs the memory-curator DB. The notifier is the write point either way; only the store differs.
2. **Whether the decision model is a seventh `BackgroundConsumerId`** in the existing roles table (one array entry + one row) or a separate setting — the roles surface already handles provider/model assignment and deep links.
3. **Call path for an Ollama/Jev decision model** — `InternalQueryService` is SDK-runner-based; Ollama Cloud / Jev REST are different transports, so either a provider-agnostic runner behind the same gate or a parallel client.
4. **Tool surface for `ptah_route_decide`** — namespace, eager (`ALWAYS_EAGER_TOOLS`) vs deferred, result budget, system-prompt table row, and stdio rename in `tool-builders.ts`.
5. **Fix or drop the 100% success figure** so the scorecard carries signal before it feeds the routing model.
6. **How the tool's result binds into the skill** — advisory table at Pre-flight and Gate 0.1, user-overrideable, with the low-confidence fallback to the rule tables logged in `decisions.md` (the shape already agreed in `context.md:73-85`).
