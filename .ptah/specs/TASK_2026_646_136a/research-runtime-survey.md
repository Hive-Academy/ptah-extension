# Runtime survey for the architect — TASK_2026_646_136a

Source: a survey sub-agent started by the software-architect on 2026-10-14 (the architect was stopped by the
user before it wrote `implementation-plan.md`; this survey completed). Paths are relative to
`D:/projects/ptah-extension/`. Facts not checked are marked UNVERIFIED. Re-verify line numbers before use:
they reflect `origin/main` at 4f571f8d1.

## 1. LaneCompletionNotifier (`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts`)

- Class `@injectable()` :243–244. Dedup state `signalledKeys: string[]` (:256), capped by
  `SIGNALLED_HISTORY_SIZE = 256` (:69); `remember()` (:738–746) splices the oldest entries.
- Constructor (:258–269): `@inject(TOKENS.LOGGER) logger: Logger`; `@inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
  fileSystem: IFileSystemProvider`; `@inject(TOKENS.AGENT_ADAPTER, { isOptional: true }) agentAdapter`. `TOKENS`
  and `Logger` come from `@ptah-extension/vscode-core` (:37); `PLATFORM_TOKENS` from `@ptah-extension/platform-core`
  (:38–41).
- `signal(info: AgentProcessInfo, context = { reportsDelivered: 0 }): Promise<LaneCompletionDelivery>` (:278–357):
  `running` refused as `already-signalled` (:282–290); dedup key `${agentId}:${completedAt}` (:292–297);
  `remember(key)` :297; `buildSignal` :299; refusals `no-parent-recorded` (:305–312), `chat-runtime-unavailable`
  (:314–320), `parent-session-not-active` (:322–326); `sendMessageToSession` (:328–); success return :356;
  `refuse()` (:719–736) returns the signal on every refusal.
- `signalSessionChild(subject, settle)` (:373–474); dedup key `${childSessionId}:turn:${turn}` (:377–380); types
  from `../session-children/session-spawner.port` (:52–58).
- `sessionChildVerdictOf(status, deliverables)` exported :132–145 (not completed → failed; no deliverables →
  unverified; all exist, non-empty, `writtenAfterSpawn !== false` → delivered; else no-deliverable). The lane path
  uses the private static `verdictOf` (:617–627), which ignores `writtenAfterSpawn`.
- `buildSignal` (:500–539) returns `agentId, cli, agentLabel, role?, status, exitCode?, startedAt, completedAt,
  durationMs, taskFolder?, taskHeadline, deliverables, verdict, reportsDelivered, cliSessionId?`; `agentLabel` =
  `ptahCliName ?? displayName ?? cli` (:81–83).
- Shared types, `libs/shared/src/lib/types/agent-process.types.ts`: `LaneCompletionVerdict` :538,
  `LaneCompletionSignal` :542 (`verdict` :559), `LaneCompletionDelivery` (`signal?` :590). `LaneDeliverableCheck`,
  `LaneCompletionRefusalReason` in the same block (exact lines UNVERIFIED).
- The signal does NOT carry `model`, `ptahCliId`, `providerId`, `modelScope` or a task id. All exist on
  `AgentProcessInfo` (shared :120–: `taskFolder` :125, `parentSessionId` :136, `displayName` :138, `model` :140,
  `ptahCliName` :142, `ptahCliId` :144, `role` :151, `failureKind` :163, `modelScope` :172). The process manager
  passes a copy in `signalLaneCompletion` (`agent-process-manager.service.ts:2529–2533`); it injects the notifier
  by class at :315–316.
- Candidate write points for an outcome store: inside `signal()` after `buildSignal` (:299) and before the parent
  checks (:305) — after dedup, captures refusals too; or before :356 (deliveries only); or in
  `signalLaneCompletion` (APM :2529–2533) where the full `info` is available but there is no dedup.

## 2. DI

- `libs/backend/cli-agent-runtime/src/lib/di/register.ts:53` `registerCliAgentRuntimeServices(container, logger)`:
  notifier by class `container.registerSingleton(LaneCompletionNotifier)` (:91);
  `CLI_AGENT_RUNTIME_TOKENS.LANE_LIMIT_LOOKUP` → `LaneLimitLookupService` (:111–115);
  `TOKENS.CLI_DETECTION_SERVICE` → `CliDetectionService` (:77–80); `TOKENS.AGENT_PROCESS_MANAGER` →
  `AgentProcessManager` (:121–124); `SDK_PTAH_CLI_REGISTRY` → `PtahCliRegistry` (:71–75);
  `SDK_PTAH_CLI_CONFIG_PERSISTENCE` → `PtahCliConfigPersistence` (:59–63).
- `di/tokens.ts`: `SDK_PTAH_CLI_REGISTRY` :4, `AGENT_REPORT_ROUTER` :10, `SESSION_SPAWNER` :17, `LANE_RESUME_GATE` :29,
  `LANE_OWNER_RESOLVER` :33, `LANE_LIMIT_LOOKUP` :35, `PLAN_LIMIT_OWNER_DISCOVERY` :37.
- `AGENT_PROCESS_MANAGER`, `CLI_DETECTION_SERVICE` in `libs/backend/vscode-core/src/di/tokens.ts:85–86`.
- Callers of `registerCliAgentRuntimeServices`: `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:216`,
  `apps/ptah-electron/src/di/phase-2-libraries.ts:305`, `libs/backend/cli-engine/src/lib/container.ts:736`.

## 3. Limits and failure classification

- `libs/shared/src/lib/utils/plan-limits/lane-state.ts`: `LaneLimitState = 'at-limit'|'near-limit'|'confirmed-room'|
  'unknown'` (:158–159); `LaneLookupFailure` :162; `LaneStateReason` :171–199; `LaneStateResult {state, reasons,
  windows}` :207–217; `classifyLaneState(limits, ctx)` :314; `LaneAlternatives<T>` :365; `groupAlternatives` :376;
  `applicableLimits` :142.
- `limits/lane-limit-classifier.ts`: `USAGE_LIMIT_REGEX` :37, `RETRY_AT_REGEX` :40, `LaneLimitPattern` :84–90
  (claude, codex, antigravity, opencode, ollama, grok), `LaneLimitClassification` (`failureKind: 'quota'`) :92–102,
  `LaneLimitInput` :104, `laneLimitWording` :187, `classifyLaneLimit(input)` :202–215, `LaneLimitEvidence` /
  `laneLimitEvidence` :218/:222, `laneWindowDescriptor` :294.
- Shared `AgentFailureKind = 'quota'` only (`agent-process.types.ts:55`); set at `agent-process-manager.service.ts:2336`.
- No auth-failure classifier exists in cli-agent-runtime.
- `cli-adapters/sdk-error-summary.ts`: `redactSecrets(text, secrets)` :34; `summarizeCliSdkError(error, vendor,
  secrets=[])` :58 recognises usage limits only (:80–90).
- `LaneLimitLookupService` (`limits/lane-limit-lookup.service.ts:117`): `lookup<R extends LaneLimitLookupRow>(rows)`
  :129; `LaneLimitLookupRow` :48 (`cli, ptahCliId, providerId, cliSessionId, quotaOwner, modelScope, model`);
  `LaneLimitResult<R> {row, lookup, owner?, snapshot?, state}` :86–91.

## 4. `ptah_agent_list`

- Definition `buildAgentListTool()` `vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:909–924`
  (no input properties, `readOnlyHint`).
- HTTP handler `protocol-dispatcher.ts:1402–1423`: `ptahAPI.agent.list()` → `lookupAgentLimits(ptahAPI, agents)`
  (:252–269) → `ptahAPI.agent.listRoles()` → `formatAgentList` (`mcp-response-formatter.ts:1786`).
- Stdio twin `mcp-stdio/agent-tool.dispatcher.ts:775–800` (also returns structured `{agents, total, roles}`).
- Row type `CliDetectionResult` (`libs/shared/src/lib/types/agent-process.types.ts:364–395`); limit rows
  `AgentLimit = LaneLimitResult<CliDetectionResult>` (`mcp-core/agent-limit.formatter.ts:31`).
- Cells `agentListRow` (`mcp-response-formatter.ts:1742–1775`): ptah-cli status is the literal "available" (:1747);
  others disabled / installed / not installed (:1761–1767); capabilities show `messagingMode`, provider,
  `ptahCliId`; "Limit state" column :1807–1812.
- Programmatic source `agent.list` (`namespace-builders/agent-namespace.builder.ts:440–497`) merges
  `cliDetectionService.detectAll()` (`cli-detection.service.ts:87`), `disabledClis`, `PtahCliRegistry.listAgents()`
  (`ptah-cli/ptah-cli-registry.ts:237`, filtered `enabled && hasApiKey`) and preferred-rank sorting.
  `agent.limits(rows)` (:499–518) wraps `getLaneLimits` → `laneLimitLookup.lookup` (`ptah-api-builder.service.ts:748`;
  injections :373, :376, :411, :517).
- No standalone "agent list service": a new tool should call `ptahAPI.agent.list()` + `ptahAPI.agent.limits()`.
- No lane "family" field anywhere. Prose only (`ptah-system-prompt.constant.ts:244`; `tool-description.builder.ts:612`).
  In code "family" means a Claude model family (`claudeModelFamily`, `agent-sdk/.../claude-rate-limit.mapper.ts:248`;
  `CLAUDE_FAMILY_REGEX` `lane-limit-classifier.ts:77`, :284–286). The routing family must be defined new.

## 5. Models and Ptah CLI configs

- `CliDetectionService.listModelsForAll(): Promise<Record<string, CliModelInfo[]>>` (`cli-detection.service.ts:182–222`):
  sequential over installed adapters with `listModels`, NO timeout, cached in `modelCache` until `invalidateCache()`
  (:227); errors → Sentry + warn, CLI skipped.
- `CliModelListService` (`rpc-handlers/src/lib/services/cli-model-list.service.ts:18–29`) injects
  `CLI_DETECTION_SERVICE`, `MODEL_DISCOVERY`, `SDK_CODEX_AUTH`, `SDK_COPILOT_AUTH`; `listAll()` :31;
  `listForClassification()` :36 flags `isFallback` when no live source reported (provenance). Codex order: CLI
  catalog → auth → adapter (:62–67). Copilot: host LM API → auth → adapter (:71–76). No timeout. Injected by class
  in `agent-rpc.handlers.ts:308` (explicit registration UNVERIFIED).
- `ptah-cli.types.ts`: `PtahCliConfig` :13–34 (`tierMappings` :23–27, `selectedModel` :29, `reasoningEffort` :31);
  `PtahCliSummary` :48–64 (`modelCount` :61).
- `PtahCliRegistry.listAgents()` (:237–275) returns summaries without `selectedModel` / `tierMappings`; full configs
  via `PtahCliConfigPersistence.loadConfigs()` (`ptah-cli/helpers/ptah-cli-config-persistence.service.ts:37`,
  token `SDK_PTAH_CLI_CONFIG_PERSISTENCE`).

## 6. MCP tool pattern

- Builder returns `MCPToolDefinition` (`mcp-core/types/mcp-protocol.types.ts:115–148`). Example `agent-wait.tool.ts`:
  `AGENT_WAIT_TOOL_NAME` :36, deps `AgentWaitDependencies` :48–70, `buildAgentWaitTool({transport})` :72–123,
  runner `runAgentWait(args, deps)` :129.
- Args: zod `.strict()` (e.g. `AgentWaitArgsSchema`, `wait-tools-args.schema.ts:47–61`); inline dispatcher schemas
  :667–721; `describeZodIssues` :724.
- Listing: `handleToolsList` (:454) → `buildToolSet` (:479) → `buildToolDefinitions` (:494–602; `agent` group
  :530–553) → `markEagerTools` (:735) → `declareResultBudgets` (:771).
- Dispatch: `handleMCPRequest` (:340–364) → `handleToolsCall` (:835) → `dispatchToolsCall` (:933; apps-only gate
  :955) → `handleIndividualTool` (:1020) `switch (name)` (:1029), e.g. `case AGENT_WAIT_TOOL_NAME:` :1425–1458
  with deps built inline from `ptahAPI`. `tools/call` has no `disabledMcpNamespaces` check (namespaces gate only
  `tools/list`).
- Deps `ProtocolHandlerDependencies` (:291–317) passed from `http-mcp-server.service.ts:389–405`.
- Budget `tool-result-budget.ts`: `TOOL_RESULT_BUDGET_OVERRIDES` :83–89, `TOOL_CONTENT_HINTS` :103–123
  (`ptah_agent_list: 'preformatted'` :113), `getToolResultBudget` :144.
- Profile `mcp-tool-profile.ts`: `APPS_ONLY_TOOL_NAMES` :9–13, `resolveMcpToolProfile` :16, `appsOnlyToolMessage` :27.
- Barrel `mcp-core/index.ts` exports types, execute/approval builders, `handleMCPRequest` /
  `ProtocolHandlerDependencies` (:30–34) and the request context; individual tools are not exported.
- Stdio: `mcp-stdio/tool-builders.ts` `agentToolBudgetName` :53, `MCP_MVP_TOOL_NAMES` :58–69, `rename()` :77–90,
  builders :92–126 (`buildMcpAgentListTool` :116); stdio switch `agent-tool.dispatcher.ts:284–301`.
- System prompt table `ptah-system-prompt.constant.ts:224–234` (agent_list :234); lane-completion prose :236–240.
- Spawn args `AgentSpawnArgsSchema` (`agent-spawn-args.schema.ts:22–45`): `model` :35, `modelTier` :36; dispatcher
  uses them :1147–1184 (`modelTier ?? 'sonnet'` log :1166; `model` to the limit lookup :1182).

## 7. Hosts and runtime

- `registerVsCodeLmToolsServices` (`vscode-lm-tools/src/lib/di/register.ts:65`) registers `PTAH_API_BUILDER` (:90)
  and `CODE_EXECUTION_MCP → CodeExecutionMCP` (:91). Called from `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:120`,
  `apps/ptah-electron/src/di/phase-3-storage.ts:134`, `libs/backend/cli-engine/src/lib/container.ts:833`.
- `mcp-core` is runtime-agnostic: no `import 'vscode'` (only a comment at `protocol-dispatcher.ts:803`; type-only
  vscode-core import :15). Real `vscode` import: `namespace-builders/ide-capabilities.vscode.ts:12`.
- Only the HTTP server runs `protocol-dispatcher` (`CodeExecutionMCP`, `mcp-http/http-mcp-server.service.ts:166`,
  call :389), registered in all three containers; Electron starts it in `apps/ptah-electron/src/activation/wire-runtime.ts:391–393`
  (VS Code and CLI start call sites UNVERIFIED).
- Stdio (`ptah mcp serve`, `apps/ptah-cli/src/cli/commands/mcp-serve.ts`) uses `StdioMcpServerService` →
  `AgentToolDispatcher` (`mcp-stdio/agent-tool.dispatcher.ts:210`), NOT `handleMCPRequest`: a new tool needs wiring
  in BOTH dispatchers.

## Implications the architect should carry (orchestrator notes)

- The outcome-record write point and the full `AgentProcessInfo` are in cli-agent-runtime, which imports
  `vscode-core` for `TOKENS`/`Logger` — a new store must not deepen that leak (CLAUDE.md "known leak").
- Model discovery (Requirement 11) has no timeout today in either `listModelsForAll` or `CliModelListService`.
- "Family" for cross-family review does not exist in code and must be defined.
- `ptah_route_decide` needs registration in the HTTP dispatcher AND the stdio `AgentToolDispatcher`.
