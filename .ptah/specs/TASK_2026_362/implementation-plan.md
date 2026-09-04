# TASK_2026_362 — Implementation Plan, Phase 1 (native conductor on pi-ai)

Status: design. Author: software-architect. Date: 2026-08-31.
Inputs: `task-description.md` (approved), `research-report.md`, `context.md`, root `CLAUDE.md`.
Scope: task-description section 2.1 and criteria P1-1..P1-19. Phase 2/3 appear only as seams (section 11).

Every contract below was checked against the code on 2026-08-31. Citations are `path:line`.

## 0. Verified facts the design rests on

| Fact                                                                                                                                                                                                                                   | Evidence                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IAgentAdapter extends IAIProvider`; the port has 20 own methods plus the 9 `IAIProvider` members                                                                                                                                      | `libs/shared/src/lib/types/agent-adapter.types.ts:190-276`, `ai-provider.types.ts:238-298`                                                                                                            |
| `ProviderId` is `'claude-cli' \| 'vscode-lm' \| 'ptah-cli'` — no native member                                                                                                                                                         | `ai-provider.types.ts:12`                                                                                                                                                                             |
| `FlatStreamEventUnion` has 20 variants; `TurnStateEvent` carries `phase, revision, backgroundTasks, sessionCrons, terminalReason`                                                                                                      | `stream-background.ts:266-286`, `:237-261`                                                                                                                                                            |
| `SdkTerminalReason` includes `completed`, `max_turns`, `aborted_streaming`, `aborted_tools`, `model_error`                                                                                                                             | `sdk-hook.types.ts:61-73`                                                                                                                                                                             |
| `SdkAgentAdapter` publishes the session id through `createSessionIdCallback` → `metadataStore.create` → `callbacks.emitSessionIdResolved` → `sessionIdResolvedRegistry.notifyAll`                                                      | `sdk-agent-adapter.ts:876-923`                                                                                                                                                                        |
| Result stats and turn end reach the adapter as callbacks handed to the stream transformer                                                                                                                                              | `sdk-agent-adapter.ts:711-724`, `:1201-1221`                                                                                                                                                          |
| `turn_state` events are built by `toTurnStateEvent` from `SessionTurnStateRegistry`; `session:status` reads that registry                                                                                                              | `helpers/session-turn-state.registry.ts:64-80`, `session-rpc.handlers.ts:1121-1127`                                                                                                                   |
| `SdkPermissionHandler.createCallback(sessionId?, cliAgentResolver?, tabId?, levelResolver?, routingHint?, sessionIdResolver?)` returns `CanUseTool = (toolName, input, {signal, toolUseID, agentID?, …}) => Promise<PermissionResult>` | `sdk-permission-handler.ts:370-432`; `PermissionResult` at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1953-1965`                                                                           |
| `handleMCPRequest` routes `tools/list` → `handleToolsList` and `tools/call` → `runWithMcpRequestContext({callerSessionId: request._callerSessionId}, () => handleToolsCall)`                                                           | `protocol-dispatcher.ts:151-180`                                                                                                                                                                      |
| The caller id is parsed from the URL only in the HTTP handler                                                                                                                                                                          | `mcp-http/http-server.handler.ts:245,311-313`                                                                                                                                                         |
| `ProtocolHandlerDependencies` = `{ptahAPI, permissionPromptService, webviewManager?, logger, onToolResult?, hasIDECapabilities?, hasSqliteLayer?, disabledMcpNamespaces?}`                                                             | `protocol-dispatcher.ts:135-145`; built in `http-mcp-server.service.ts:352-366`                                                                                                                       |
| `ChatStartParams` has no `runtime`; `ChatStartParamsSchema` is `.passthrough()` on `tabId`                                                                                                                                             | `rpc-chat.types.ts:37-102`, `rpc-handlers/.../chat-rpc.schema.ts:47-52`                                                                                                                               |
| `TOKENS.AGENT_ADAPTER` is bound to the SDK adapter by `wireAgentAdapterAliases`, called from all three roots                                                                                                                           | `agent-sdk/src/lib/di/register.ts:500-504`; `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:191`; `apps/ptah-electron/src/di/phase-2-libraries.ts:260`; `cli-engine/src/lib/container.ts:692` |
| Five files inject `SDK_TOKENS.SDK_AGENT_ADAPTER` directly                                                                                                                                                                              | `chat-ptah-cli.service.ts:73`, `auth-rpc.handlers.ts:242`, `config-rpc.handlers.ts:78`, `provider-rpc.handlers.ts:111`, `session-rpc.handlers.ts:116`                                                 |
| Three services already use `TOKENS.AGENT_ADAPTER`                                                                                                                                                                                      | `chat-session.service.ts:122`, `chat-slash-command-router.service.ts:43`, `chat-stream-broadcaster.service.ts:92`                                                                                     |
| Next migration is `0042`; the list ends at `version: 41`                                                                                                                                                                               | `persistence-sqlite/src/lib/migrations/index.ts:316-320`                                                                                                                                              |
| **The VS Code host registers no SQLite connection**; only Electron and `cli-engine` (`registerThothLibraries`) do                                                                                                                      | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:78-80`; `apps/ptah-electron/src/di/phase-2-libraries.ts:310`; `cli-engine/src/lib/thoth/register-thoth-libraries.ts:81`                       |
| `PLATFORM_TOKENS` has `FILE_SYSTEM_PROVIDER`, `WORKSPACE_PROVIDER`, `TOKEN_COUNTER`, `PLATFORM_INFO`, `MCP_SERVER_STATUS`, `PTY_HOST`; there is no process/shell port                                                                  | `platform-core/src/di/tokens.ts:11-105`                                                                                                                                                               |
| `IFileSystemProvider`: `readFile, writeFile, readDirectory, stat, exists, delete, createDirectory, findFiles(pattern, exclude?, maxResults?, cwd?)`                                                                                    | `interfaces/file-system-provider.interface.ts:17-140`                                                                                                                                                 |
| `ProviderProfile = {providerId, authEnv: ProviderProfileAuthEnv, model, baseUrl?, cliJsPath?, defaultMaxTokens?}`; `authEnv` has only `ANTHROPIC_*` keys                                                                               | `provider-profile.types.ts:8-25`, `provider-profile.schemas.ts:38-52`                                                                                                                                 |
| `PTAH_CORE_SYSTEM_PROMPT` lives in `agent-sdk` and is exported                                                                                                                                                                         | `agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:26`, `agent-sdk/src/index.ts:207`                                                                                                               |
| `~/.ptah/settings.json` keys are routed by `FILE_BASED_SETTINGS_KEYS` + `FILE_BASED_SETTINGS_DEFAULTS`                                                                                                                                 | `platform-core/src/file-settings-keys.ts:154,426`                                                                                                                                                     |
| Tag rules: `type:core` → `type:core\|util` only; `type:feature` → `feature\|data-access\|ui\|util\|core`; `scope:extension` → `shared\|extension`; `scope:cli` may depend on `extension`                                               | `eslint.config.mjs` depConstraints                                                                                                                                                                    |

pi-ai `0.84.4` (tarball `registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-0.84.4.tgz`) public API, from `dist/types.d.ts`, `dist/models.d.ts`, `dist/api/*.d.ts` and the README:

- `createModels(options?) → MutableModels`; `models.setProvider(provider)`; `models.getModel(provider, id)`; `models.stream(model, context, options?)` and `models.streamSimple(model, context, {reasoning?: ThinkingLevel, …})` return `AssistantMessageEventStream` (async iterable + `result()`); `models.complete/completeSimple` return `AssistantMessage` (`models.d.ts:49-78`).
- `createProvider({id, name?, baseUrl?, auth, models, api, fetchModels?})` (`models.d.ts:90`); `envApiKeyAuth(name, envVars)` (`auth/helpers.d.ts:2`); API modules `@earendil-works/pi-ai/api/anthropic-messages.lazy`, `openai-completions.lazy`, `openai-responses.lazy`.
- `Context = {systemPrompt?, messages: Message[], tools?: Tool[]}`; `Message = UserMessage | AssistantMessage | ToolResultMessage`; `AssistantMessage.content: (TextContent|ThinkingContent|ToolCall)[]`, `.usage: Usage {input, output, cacheRead, cacheWrite, totalTokens, cost:{total,…}}`, `.stopReason: 'pending'|'stop'|'length'|'toolUse'|'error'|'aborted'|'deferred'`; `ToolResultMessage = {role:'toolResult', toolCallId, toolName, content:(Text|Image)[], isError, timestamp}`.
- `Tool<TSchema> = {name, description, parameters: TSchema, constrainedSampling?}` (TypeBox `TSchema`; plain JSON Schema objects satisfy it at runtime).
- Events: `start | text_start | text_delta | text_end | thinking_start | thinking_delta | thinking_end | toolcall_start | toolcall_delta | toolcall_end | done{reason,message} | error{reason:'aborted'|'error', error: AssistantMessage}`; each delta carries `contentIndex` and `partial`. Requests never throw; failures arrive as `error` events.
- `StreamOptions`: `signal`, `apiKey`, `headers`, `env`, `maxTokens`, `cacheRetention: 'none'|'short'|'long'` (default `short`), `sessionId`, `timeoutMs`, `maxRetries`. `AnthropicOptions` adds `thinkingEnabled, thinkingBudgetTokens, effort: 'low'|'medium'|'high'|'xhigh'|'max', interleavedThinking`; `OpenAICompletionsOptions` adds `reasoningEffort`.
- `Model<TApi> = {id, name, api, provider, baseUrl, reasoning, input, cost, contextWindow, maxTokens, compat?, thinkingLevelMap?}`; `clampThinkingLevel(model, level)`, `calculateCost(model, usage)`, `validateToolCall(tools, call)`.
- `fauxProvider()` + `fauxAssistantMessage/fauxText/fauxToolCall` for tests (README "Faux Provider for Tests").

## 1. Lib inventory (Phase 1)

All under `libs/backend/`. Alias pattern `@ptah-extension/<name>` in `tsconfig.base.json`. Every `project.json` mirrors `libs/backend/task-specs/project.json` (esbuild `cjs`, `external` incl. `vscode`, `tsyringe`, `zod`, plus `@earendil-works/pi-ai` for `llm-providers`, `better-sqlite3` for `agent-session`). Jest config mirrors `task-specs/jest.config.ts`.

| Lib                    | Path / alias                                                                 | Tags                              | Responsibility (one sentence)                                                                                                                                                                                | Allowed imports                                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent-loop-contracts` | `libs/backend/agent-loop-contracts` / `@ptah-extension/agent-loop-contracts` | `scope:extension`, `type:core`    | Ports, DI tokens, loop event union, error classes, Zod schemas for tool arguments and runtime settings, test fakes.                                                                                          | `@ptah-extension/shared`, `zod`. No other lib.                                                                                                                                                               |
| `llm-providers`        | `libs/backend/llm-providers` / `@ptah-extension/llm-providers`               | `scope:extension`, `type:feature` | The only importer of `@earendil-works/pi-ai`; implements `ILlmStream`, resolves a `ProviderProfile` to a pi-ai `Model` + wire API, maps thinking/effort/usage.                                               | `agent-loop-contracts`, `platform-core`, `vscode-core` (Logger), `shared`, `@earendil-works/pi-ai`.                                                                                                          |
| `agent-loop`           | `libs/backend/agent-loop` / `@ptah-extension/agent-loop`                     | `scope:extension`, `type:feature` | Turn/step engine: inbox, step runner, tool executor with per-path mutex, request assembly, cache-stable prefix, dangling tool-call repair (the `agent-context` concern is merged here for Phase 1, per Q12). | `agent-loop-contracts`, `platform-core`, `vscode-core`, `shared`.                                                                                                                                            |
| `agent-tools`          | `libs/backend/agent-tools` / `@ptah-extension/agent-tools`                   | `scope:extension`, `type:feature` | Core tools `read/write/edit/bash/glob/grep` on `PLATFORM_TOKENS` ports, plus the in-process `ptah_*` registry adapter over `IPtahToolInvoker`.                                                               | `agent-loop-contracts`, `platform-core`, `vscode-core`, `shared`, Node `child_process`. **Not** `vscode-lm-tools`.                                                                                           |
| `agent-session`        | `libs/backend/agent-session` / `@ptah-extension/agent-session`               | `scope:extension`, `type:feature` | `ISessionLog` with two adapters (`SqliteSessionLog`, `JsonlSessionLog`), `deriveMessages()` projection, session-id minting.                                                                                  | `agent-loop-contracts`, `persistence-sqlite`, `platform-core`, `vscode-core`, `shared`.                                                                                                                      |
| `native-agent-adapter` | `libs/backend/native-agent-adapter` / `@ptah-extension/native-agent-adapter` | `scope:extension`, `type:feature` | `NativeAgentAdapter implements IAgentAdapter`: session records, loop-event → `FlatStreamEventUnion` mapper, turn-state, callback registry, system prompt.                                                    | `agent-loop-contracts`, `agent-loop`, `agent-tools`, `agent-session`, `llm-providers`, `platform-core`, `vscode-core`, `shared`.                                                                             |
| `agent-runtime`        | `libs/backend/agent-runtime` / `@ptah-extension/agent-runtime`               | `scope:extension`, `type:feature` | `AgentRuntimeSelector implements IAgentAdapter` on `TOKENS.AGENT_ADAPTER`, session → runtime map, settings default, metadata persistence of the choice, `wireAgentRuntimeSelector()`.                        | `agent-sdk` (SDK_TOKENS, `SessionMetadataStore`, `SessionTurnStateRegistry`, `SessionIdResolvedCallbackRegistry`), `native-agent-adapter`, `agent-loop-contracts`, `platform-core`, `vscode-core`, `shared`. |

`agent-sdk` gains one small file, `src/lib/permission/sdk-tool-permission-gate.ts`, that adapts `SdkPermissionHandler` to `IToolPermissionGate` and is registered in `registerSdkServices`. `agent-sdk` → `agent-loop-contracts` is a new one-way edge (feature → core, allowed). Native libs never import `agent-sdk`.

Estimated sizes: contracts ~350 lines, llm-providers ~600, agent-loop ~900 (3 files), agent-tools ~800 (7 files), agent-session ~700, native-agent-adapter ~700, agent-runtime ~300. None under 150.

## 2. Port contracts (signatures only)

```ts
// agent-loop-contracts/src/lib/tokens.ts
export const AGENT_LOOP_TOKENS = {
  LLM_STREAM: Symbol.for('AgentLoopLlmStream'),
  TOOL_REGISTRY: Symbol.for('AgentLoopToolRegistry'),
  SESSION_LOG: Symbol.for('AgentLoopSessionLog'),
  TOOL_PERMISSION_GATE: Symbol.for('AgentLoopToolPermissionGate'),
  PTAH_TOOL_INVOKER: Symbol.for('AgentLoopPtahToolInvoker'),
  ENGINE_FACTORY: Symbol.for('AgentLoopEngineFactory'),
  NATIVE_AGENT_ADAPTER: Symbol.for('NativeAgentAdapter'),
  AGENT_RUNTIME_SELECTOR: Symbol.for('AgentRuntimeSelector'),
  CORE_PROMPT_APPENDIX: Symbol.for('NativeCorePromptAppendix'), // useValue: string (PTAH_CORE_SYSTEM_PROMPT)
} as const;

// llm types (pi-ai-shaped, but owned here so pi-ai stays inside llm-providers)
export interface LlmTextBlock {
  type: 'text';
  text: string;
}
export interface LlmThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}
export interface LlmToolCallBlock {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
export interface LlmImageBlock {
  type: 'image';
  data: string;
  mimeType: string;
}
export interface LlmUserMessage {
  role: 'user';
  content: string | (LlmTextBlock | LlmImageBlock)[];
  timestamp: number;
}
export interface LlmAssistantMessage {
  role: 'assistant';
  content: (LlmTextBlock | LlmThinkingBlock | LlmToolCallBlock)[];
  model: string;
  stopReason: LlmStopReason;
  usage: LlmUsage;
  errorMessage?: string;
  timestamp: number;
}
export interface LlmToolResultMessage {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: (LlmTextBlock | LlmImageBlock)[];
  isError: boolean;
  timestamp: number;
}
export type LlmMessage = LlmUserMessage | LlmAssistantMessage | LlmToolResultMessage;
export type LlmStopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';
export interface LlmUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number | null;
}
export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
} // JSON Schema

export interface LlmRequest {
  readonly systemPrompt: string;
  readonly messages: readonly LlmMessage[];
  readonly tools: readonly LlmToolDefinition[];
  readonly model: string;
  readonly thinking?: ThinkingConfig; // from @ptah-extension/shared
  readonly effort?: EffortLevel; // from @ptah-extension/shared
  readonly maxTokens?: number;
  readonly cacheSessionId: string; // pi-ai `sessionId`
  readonly signal: AbortSignal;
}
export type LlmStreamEvent = { type: 'text_delta'; blockIndex: number; delta: string } | { type: 'thinking_start'; blockIndex: number } | { type: 'thinking_delta'; blockIndex: number; delta: string } | { type: 'toolcall_start'; blockIndex: number; toolCallId: string; toolName: string } | { type: 'toolcall_delta'; blockIndex: number; toolCallId: string; delta: string } | { type: 'toolcall_end'; blockIndex: number; toolCall: LlmToolCallBlock } | { type: 'done'; message: LlmAssistantMessage } | { type: 'error'; reason: 'aborted' | 'error'; message: LlmAssistantMessage };

export interface ILlmStream {
  stream(profile: ProviderProfile, request: LlmRequest): AsyncIterable<LlmStreamEvent>;
  describeModel(profile: ProviderProfile, model: string): Promise<LlmModelInfo>; // {id, contextWindow, maxTokens, supportsThinking, wireProtocol}
  listModels(profile: ProviderProfile): Promise<readonly AgentModelInfo[]>;
}

export interface AgentToolContext {
  readonly sessionId: SessionId;
  readonly turn: number;
  readonly toolCallId: string;
  readonly workspaceRoot: string;
  readonly signal: AbortSignal;
}
export interface AgentToolResult {
  readonly content: (LlmTextBlock | LlmImageBlock)[];
  readonly isError: boolean;
  readonly display?: unknown;
}
export interface IAgentTool<TArgs = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>; // JSON Schema (core tools: z.toJSONSchema(zodSchema))
  readonly mutatesPath?: (args: TArgs) => string | undefined; // per-path mutex key
  parse(raw: unknown): TArgs; // Zod at the model boundary
  execute(args: TArgs, ctx: AgentToolContext): Promise<AgentToolResult>;
}
export interface IToolRegistry {
  list(): readonly IAgentTool[];
  get(name: string): IAgentTool | undefined;
  definitions(): readonly LlmToolDefinition[]; // stable, name-sorted (cache prefix)
}
export interface IPtahToolInvoker {
  // implemented in vscode-lm-tools (section 6)
  listTools(): readonly LlmToolDefinition[];
  callTool(name: string, args: Record<string, unknown>, callerSessionId: string): Promise<AgentToolResult>;
}

export type ToolPermissionDecision = { behavior: 'allow'; updatedInput?: Record<string, unknown> } | { behavior: 'deny'; message: string; interrupt?: boolean };
export interface ToolPermissionRequest {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly toolUseId: string;
  readonly sessionId: SessionId | undefined;
  readonly tabId: string | undefined;
  readonly level: AgentPermissionLevel;
  readonly signal: AbortSignal;
}
export interface IToolPermissionGate {
  decide(request: ToolPermissionRequest): Promise<ToolPermissionDecision>;
}

export type SessionLogEventKind = 'session_start' | 'turn_start' | 'user_message' | 'assistant_message' | 'tool_result' | 'model_changed' | 'effort_changed' | 'permission_changed' | 'cache_reset' | 'interrupt' | 'turn_end' | 'error';
export interface SessionLogEvent {
  readonly seq: number;
  readonly turn: number;
  readonly kind: SessionLogEventKind;
  readonly at: number;
  readonly payload: unknown;
}
export interface ISessionLog {
  create(meta: { sessionId: SessionId; workspaceRoot: string; model: string; runtime: 'native' }): Promise<void>;
  append(sessionId: SessionId, event: Omit<SessionLogEvent, 'seq' | 'at'>): Promise<SessionLogEvent>;
  read(sessionId: SessionId): Promise<readonly SessionLogEvent[]>;
  head(sessionId: SessionId): Promise<{ turn: number; model: string; effort?: EffortLevel; permissionLevel: AgentPermissionLevel } | null>;
  exists(sessionId: SessionId): Promise<boolean>;
}
export function deriveMessages(events: readonly SessionLogEvent[]): { messages: LlmMessage[]; repairs: LlmToolResultMessage[] };

export type LoopEvent =  // engine → adapter
{ type: 'turn_start'; turn: number } | { type: 'step_start'; turn: number; step: number; messageId: string } | { type: 'llm'; step: number; messageId: string; event: LlmStreamEvent } | { type: 'tool_start'; toolCallId: string; toolName: string; input: Record<string, unknown> } | { type: 'tool_result'; toolCallId: string; result: AgentToolResult; denied: boolean } | { type: 'step_end'; step: number; message: LlmAssistantMessage; durationMs: number } | { type: 'turn_end'; turn: number; reason: 'completed' | 'max_steps' | 'aborted' | 'error' | 'denied_interrupt'; usage: LlmUsage; durationMs: number; error?: string };
export class SessionNotActiveError extends Error {}
export class MaxStepsExceededError extends Error {}
```

`NativeAgentAdapter` method mapping (`IAgentAdapter` + `IAIProvider`):

| Method                                                          | Native behavior                                                                                                                                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providerId`, `info`                                            | `'native'` (added to `ProviderId`, section 12), static `ProviderInfo` with `streaming: true, functionCalling: true, sessionPersistence: true`                                      |
| `initialize()`                                                  | Resolves `ILlmStream` and `ISessionLog`; returns `true` when a session log adapter exists. Never spawns a process.                                                                 |
| `dispose()` / `reset()`                                         | Aborts every active turn, clears records. `reset()` also re-runs `initialize()`.                                                                                                   |
| `verifyInstallation()`                                          | `true` (no binary). `getHealth()` → `{status:'available'}` after init.                                                                                                             |
| `preloadSdk()`                                                  | Warms the pi-ai lazy API module for the active profile; resolves. (P1-3)                                                                                                           |
| `getCliJsPath()`                                                | `null`. (P1-3)                                                                                                                                                                     |
| `getSupportedModels()` / `getApiModels()` / `getDefaultModel()` | `ILlmStream.listModels(profile)`; default = `profile.model`.                                                                                                                       |
| `startChatSession(config)`                                      | Mints `SessionId.create()`, `sessionLog.create`, registers record, fires `sessionIdResolved(tabId, id)` synchronously, returns the turn stream (section 3).                        |
| `resumeSession(id, config)`                                     | `sessionLog.exists(id)` else throw `SessionNotActiveError`; `deriveMessages`; if `config.prompt` runs a turn, else returns an empty completed stream.                              |
| `isSessionActive(id)`                                           | record present. `getSessionToken(id)` opaque token per record. `endSessionIfTokenMatches` atomic compare + teardown.                                                               |
| `endSession(id)`                                                | Abort + drop record (does not delete the log).                                                                                                                                     |
| `sendMessageToSession(id, content, opts)`                       | Inbox `followUp` if a turn is running, else starts a new turn on the live record's stream.                                                                                         |
| `executeSlashCommand(id, cmd, cfg)`                             | Phase 1: throws `Error('Slash commands are not available on the native runtime yet')` (Phase 2 seam).                                                                              |
| `interruptCurrentTurn(id)`                                      | Aborts the turn controller; returns `true` when a turn was running; record stays. (P1-8)                                                                                           |
| `interruptSession(id)`                                          | Abort + drop record; `isSessionActive` becomes `false`.                                                                                                                            |
| `setSessionPermissionLevel(id, level)`                          | Updates record; logs `permission_changed`; next gate call reads it. (P1-9)                                                                                                         |
| `setSessionModel(id, model)`                                    | Updates record; logs `model_changed` and `cache_reset`; next request uses it. (P1-9, P1-18)                                                                                        |
| `setSessionEffort(id, effort)`                                  | Updates record; logs `effort_changed` and `cache_reset`.                                                                                                                           |
| `set*Callback(cb)`                                              | Stored in `NativeCallbackRegistry` (same single-slot semantics as `SdkAdapterCallbackRegistry`). `setCompactionStartCallback`, worktree callbacks: stored, never fired in Phase 1. |
| `getAvailableModels?`, `attemptRecovery?`, `on?`, `off?`        | Omitted (optional on `IAIProvider`).                                                                                                                                               |

## 3. Data flow for one turn

1. Webview/CLI sends `chat:start {tabId, prompt, runtime:'native', …}`. `ChatRpcHandlers` parses `ChatStartParamsSchema` (`runtime` added). `ChatSessionService.startSession` resolves the provider profile with `{ transport: 'native' }` and calls `this.sdkAdapter.startChatSession(...)` — the field now resolves to `AgentRuntimeSelector`.
2. `AgentRuntimeSelector.startChatSession` reads `config.runtime ?? settingsDefault`, records `tabId → 'native'`, delegates to `NativeAgentAdapter`, and wraps the returned stream (section 5).
3. `NativeAgentAdapter` mints the session id, creates the log, appends `session_start` and `user_message`, fires `onSessionIdResolved(tabId, id)` (the selector's wrapper writes `SessionMetadata{runtime:'native'}` and calls `SessionIdResolvedCallbackRegistry.notifyAll`), builds a `TurnRunner` from `AgentLoopEngineFactory`, and returns an async generator that maps `LoopEvent` → `FlatStreamEventUnion`.
4. `AgentLoopEngine.runTurn(session, inbox)`: `turn_start`; loop `step = 1..maxSteps`: build `LlmRequest` = `{systemPrompt (fixed), tools = registry.definitions() (name-sorted), messages = deriveMessages(log).messages ⊕ pending steer messages, model/effort from record, cacheSessionId = sessionId, signal}`; every message in the request was read from the log (invariant).
5. `ILlmStream.stream(profile, request)` (pi-ai `streamSimple` under the hood) yields events; the engine forwards them as `LoopEvent{type:'llm'}` and accumulates the `AssistantMessage`. On `done` the engine appends `assistant_message` (full content incl. tool calls, usage, stopReason) to the log.
6. If `stopReason === 'toolUse'`: for each tool call, in parallel except calls whose `mutatesPath` keys collide (`PathMutex` serializes those in call order): `tool.parse(args)` (Zod; parse failure → error result), then `IToolPermissionGate.decide(...)`.
7. Allowed → `tool.execute(args, ctx)` with the turn signal; denied → result `{isError:true, content:[text: decision.message]}` and no execution. Each result is appended as `tool_result` **before** it is emitted, then `LoopEvent{tool_result}`.
8. If `stopReason === 'stop' | 'length'` or the inbox has no `followUp`, the turn ends with `turn_end{reason:'completed'}`; `turn_end` is logged; a `followUp` in the inbox starts the next turn on the same stream.
9. `NativeAgentAdapter` maps each `LoopEvent` (table below), fires `ResultStatsCallback` once per turn from `turn_end.usage`, and emits `turn_state{phase:'idle'}` last.
10. `ChatStreamBroadcaster.streamEventsToWebview` forwards the events unchanged (no frontend change).

LoopEvent → FlatStreamEventUnion mapping (all events carry `sessionId`, `timestamp`, `id = uuid`, `source`):

| LoopEvent                               | Emitted                                                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| first `step_start` of a turn            | preceded by `turn_state{phase:'generating'}`                                                                                                    |
| `step_start`                            | `message_start{role:'assistant', messageId}` (`source:'stream'`)                                                                                |
| `llm.text_delta`                        | `text_delta{delta, blockIndex, messageId}`                                                                                                      |
| `llm.thinking_start` / `thinking_delta` | `thinking_start{blockIndex}` / `thinking_delta{delta, blockIndex}`                                                                              |
| `llm.toolcall_start`                    | `tool_start{toolCallId, toolName, toolInput:{}, isTaskTool:false, source:'stream'}`                                                             |
| `llm.toolcall_delta`                    | `tool_delta{toolCallId, delta}`                                                                                                                 |
| `tool_start` (after parse)              | `tool_start{…, toolInput: full, source:'complete'}` (overwrites the stream copy by priority)                                                    |
| `tool_result`                           | `tool_result{toolCallId, output, isError}`                                                                                                      |
| `step_end`                              | `message_complete{stopReason, tokenUsage:{input,output}, cost, duration, model}`                                                                |
| `turn_end`                              | `turn_state{phase:'idle', revision++, backgroundTasks:[], sessionCrons:[], terminalReason}`; for `reason:'error'` `phase:'failed'` with `error` |

Exact sequences:

- (a) text-only turn: `turn_state(generating)`, `message_start`, `text_delta`+, `message_complete{stopReason:'stop'}`, `turn_state(idle, terminalReason:'completed')`. P1-4 lists the sequence without the leading `turn_state`; the spec asserts the ordered subsequence `message_start … turn_state(idle)` and that the last event is `turn_state` with `phase:'idle'` (see Deviations, item 4).
- (b) one tool call allowed: `turn_state(generating)`, `message_start(m1)`, `tool_start(stream)`, `tool_delta`\*, `tool_start(complete)`, `message_complete(m1, 'toolUse')`, `tool_result{isError:false}`, `message_start(m2)`, `text_delta`+, `message_complete(m2,'stop')`, `turn_state(idle,'completed')`.
- (c) one tool call denied: as (b) up to `message_complete(m1)`, then `tool_result{isError:true, output: denial text}`; the next request contains a `toolResult{isError:true}` with the denial text; then `message_start(m2)`, deltas, `message_complete(m2)`, `turn_state(idle)`. If `decision.interrupt` is true the turn ends after the result with `turn_state(idle, terminalReason:'aborted_tools')`.
- (d) interrupt mid-stream: `turn_state(generating)`, `message_start`, `text_delta`\*, `message_complete{stopReason:'aborted'}`, `turn_state(idle, terminalReason:'aborted_streaming')`. The partial assistant message and an `interrupt` event are logged. Record stays active.

## 4. Session log

Migration `0042_native_session_log.ts` (static SQL, `CREATE TABLE IF NOT EXISTS`, appended to `MIGRATIONS` as `version: 42`):

```
native_sessions(session_id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL, runtime TEXT NOT NULL,
                model TEXT NOT NULL, created_at INTEGER NOT NULL, parent_id TEXT NULL, fork_seq INTEGER NULL)
native_session_events(session_id TEXT NOT NULL REFERENCES native_sessions(session_id),
                seq INTEGER NOT NULL, turn INTEGER NOT NULL, kind TEXT NOT NULL,
                payload TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (session_id, seq))
CREATE INDEX IF NOT EXISTS idx_native_session_events_turn ON native_session_events(session_id, turn)
```

`payload` is JSON validated by a per-kind Zod schema on read (file I/O boundary). `seq` is allocated inside one `BEGIN IMMEDIATE` transaction (`MAX(seq)+1`), so concurrent appends from parallel tools stay ordered. `parent_id`/`fork_seq` exist now so fork (Phase 2) is a row, not a migration.

`JsonlSessionLog` (VS Code host, no SQLite): one file per session at `<IPlatformInfo.globalStoragePath>/native-sessions/<sessionId>.jsonl`, one JSON object per line with the same fields; appends go through a per-session promise chain; `seq` = line count. Both adapters pass one shared contract spec (`session-log.contract.spec.ts`, same style as `platform-core/src/testing/contracts`).

Event payloads: `session_start{workspaceRoot, model, permissionLevel, effort?, systemPromptHash, toolsHash}`; `user_message{content, images?, files?}`; `assistant_message{LlmAssistantMessage}`; `tool_result{LlmToolResultMessage, synthetic?: true, denied?: true}`; `model_changed{from,to}`; `effort_changed{from,to}`; `permission_changed{from,to}`; `cache_reset{cause:'model'|'effort'|'tools'}`; `interrupt{step}`; `turn_start{turn, steer?: string}`; `turn_end{reason, usage, durationMs}`; `error{message, code}`.

`deriveMessages(events)` rules:

1. Walk in `seq` order. `user_message` → `LlmUserMessage`; `assistant_message` → the stored `LlmAssistantMessage` (thinking blocks and signatures kept); `tool_result` → `LlmToolResultMessage`. Control kinds are skipped.
2. Assistant messages with `stopReason:'aborted'` are kept with their partial content (pi-ai supports continuation after abort).
3. Dangling repair: after the walk, for every `toolCall` block whose `id` has no `toolResult` message after it, insert `LlmToolResultMessage{toolCallId, toolName, isError:true, content:[text:'Tool call was interrupted before a result was recorded.']}` directly after that assistant message. The function returns them in `repairs`; the engine appends each as a `tool_result{synthetic:true}` event **before** the next request, so the log again equals what the model sees. (P1-17)
4. Two consecutive user messages are allowed (steer). A `toolResult` with no preceding call is dropped and logged as a warning.
5. Cache-stable prefix: the request is `[system, tools, messages]`; system text and the tool array are computed once per session record and reused until `model_changed`, `effort_changed` or a tool-list change, each of which logs `cache_reset` and recomputes. The message list is never reordered. (P1-18)

## 5. Runtime selection

- `AgentRuntimeId = 'sdk' | 'native'`; Zod `AgentRuntimeIdSchema = z.enum(['sdk','native'])` in contracts.
- `ChatStartParams.runtime?: AgentRuntimeId` (`rpc-chat.types.ts:37`); `ChatStartParamsSchema` gains `runtime: AgentRuntimeIdSchema.optional()`; `AgentSessionStartConfig.runtime?: AgentRuntimeId` (`agent-adapter.types.ts:96`). `chat:continue` and `chat:resume` carry no runtime; the persisted choice wins.
- Persistence: `SessionMetadata.runtime?: AgentRuntimeId` (`session-metadata-store.ts:51`); absent means `sdk`. The selector writes it in its wrapped `sessionIdResolved` callback via `metadataStore.save({...existing, runtime})` (`:295`). `ChatSessionSummary.runtime?: AgentRuntimeId` (`execution/node.ts:168`) and `session:list` copies it (`session-rpc.handlers.ts:305-330`). (P1-11)
- `AgentRuntimeSelector` (in `agent-runtime`) holds `Map<string /*tabId or sessionId*/, AgentRuntimeId>`. Resolution order for a session-scoped call: map hit → `metadataStore.get(id)?.runtime` → `'sdk'`. `startChatSession` sets the map from `config.runtime ?? default`. `resumeSession` looks up metadata before delegating. The wrapped `sessionIdResolved` callback copies the tab entry to the real id. `interruptSession`/`endSessionIfTokenMatches` remove entries.
- Fan-out methods (`initialize`, `dispose`, `reset`, `preloadSdk`, `set*Callback`) call both adapters; `getHealth` returns the SDK result (the UI contract today). `getCliJsPath`, `getSupportedModels`, `getApiModels`, `getDefaultModel` delegate to the SDK adapter (model catalog stays SDK-owned in Phase 1; a native catalog through `provider:*` RPC is a Phase 2 seam).
- Turn-state bridge: the selector wraps the native stream and mirrors `turn_state` events into `SessionTurnStateRegistry` (`markGenerating` on `generating`, `forceIdle` on `idle`) so `session:status` (`session-rpc.handlers.ts:1121`) and the broadcaster's idle fallback stay correct without frontend change.
- Settings: key `agentRuntime.default` (`'sdk'` default) added to `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS` (`file-settings-keys.ts:154,426`); read via `IWorkspaceProvider.getConfiguration<string>('ptah','agentRuntime.default','sdk')` and validated with `AgentRuntimeIdSchema.catch('sdk')`. Nothing in `package.json contributes.configuration`. Also `agentRuntime.native.maxStepsPerTurn` (default 200) and `agentRuntime.native.cacheRetention` (`'short'`).
- Handler moves (direct `SDK_AGENT_ADAPTER` → `TOKENS.AGENT_ADAPTER`): `config-rpc.handlers.ts:200,377,678` (`setSessionModel`, `setSessionPermissionLevel`, `setSessionEffort`) and `session-rpc.handlers.ts:999,1125` (`isSessionActive`). These handlers keep the SDK token as a second injection for SDK-only members: `getActiveSessionIds` (`config-rpc:371`), `forkSession` (`session-rpc:931`), `rewindFiles` (`:1021`), `getSupportedModels/getApiModels` (`config-rpc:473-474`). `auth-rpc` (`getHealth`, `reset` on SDK auth), `provider-rpc` (`getNativeClaudeModels`, `clearModelCache`) and `chat-ptah-cli` (Ptah CLI agents are SDK sessions) stay on the SDK token unchanged.
- `wireAgentAdapterAliases` is replaced in the three roots by `wireAgentRuntimeSelector(container)` from `agent-runtime`, which binds `TOKENS.AGENT_ADAPTER` → `AGENT_LOOP_TOKENS.AGENT_RUNTIME_SELECTOR`. `wireAgentAdapterAliases` stays exported for specs that build SDK-only containers.
- CLI: `ptah session start --runtime <sdk|native>` adds `runtime` to `buildParams()` in `apps/ptah-cli/src/cli/commands/session.ts:341-346`. (P1-13 manual check)

## 6. In-process tool registry

Extraction in `vscode-lm-tools` (no `vscode` import added):

- New file `mcp-core/ptah-tool-catalog.ts` with `listPtahTools(deps: ProtocolHandlerDependencies): MCPToolDefinition[]` (the array now in `handleToolsList`, `protocol-dispatcher.ts:260-345`, plus `markEagerTools`) and `callPtahTool(name, args, deps, callerSessionId): Promise<MCPToolCallResult>` (the body of `dispatchToolsCall` + `handleIndividualTool`, `:468-560`, returning the MCP `result` object instead of an envelope). `handleToolsList` and `dispatchToolsCall` become wrappers that build the JSON-RPC envelope. `callPtahTool` runs inside `runWithMcpRequestContext({callerSessionId})` itself, so `getCallerSessionId()` keeps working for path resolution.
- `CodeExecutionMCP` gains `createInProcessInvoker(): IPtahToolInvoker` that closes over the same deps it passes at `http-mcp-server.service.ts:352-366` (`webviewManager` included when present, so `approval_prompt` behaves as over HTTP). It does not require `start()`; the HTTP server stays for external CLIs. (P1-6: same deps, same functions, so results are equal by construction; the spec asserts it.)
- `registerVsCodeLmToolsServices` registers `AGENT_LOOP_TOKENS.PTAH_TOOL_INVOKER` with `useFactory: c => c.resolve(TOKENS.CODE_EXECUTION_MCP).createInProcessInvoker()`. `vscode-lm-tools` → `agent-loop-contracts` is a new feature → core edge.
- `IIDECapabilities` stays behind `IDE_CAPABILITIES_TOKEN` (`isOptional`) exactly as today; `hasIDECapabilities` already filters the list. The native registry never touches `ide-capabilities.vscode.ts`.
- `agent-tools`: `PtahToolRegistryAdapter` resolves `PTAH_TOOL_INVOKER` with `isOptional: true`; absent → zero `ptah_*` tools and a logged warning. Each MCP definition becomes an `IAgentTool` whose `parse` is a permissive `z.record(z.string(), z.unknown())` (the MCP handlers validate their own args) and whose `execute` calls `invoker.callTool(name, args, ctx.sessionId)`. `CompositeToolRegistry` = core tools ⊕ ptah tools, name-sorted, duplicate names rejected at construction.

Core tools (`agent-tools/src/lib/core/*.tool.ts`, Zod arg schemas, JSON Schema via `z.toJSONSchema`):

| Tool                                                | Port                                             | Notes                                                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read {path, offset?, limit?}`                      | `IFileSystemProvider.readFile`                   | 2,000-line default window, `cat -n` style, 100 KB cap, relative paths resolved against `ctx.workspaceRoot` and rejected outside it.                                                         |
| `write {path, content}`                             | `exists` + `createDirectory` + `writeFile`       | `mutatesPath = args.path`.                                                                                                                                                                  |
| `edit {path, old_string, new_string, replace_all?}` | `readFile` + `writeFile`                         | Exact match; 0 or >1 matches (without `replace_all`) → error result. `mutatesPath = args.path`.                                                                                             |
| `glob {pattern, cwd?}`                              | `findFiles(pattern, DEFAULT_EXCLUDES, 500, cwd)` |                                                                                                                                                                                             |
| `grep {pattern, glob?, path?, maxResults?}`         | `findFiles` + `readFile`                         | In-process regex scan, 2,000-file / 200-match cap, binary skip by NUL check. Ripgrep spawn is a Phase 2 optimization, not a Phase 1 requirement.                                            |
| `bash {command, timeout_ms?, cwd?}`                 | Node `child_process.spawn` (`shell: true`)       | `cwd` defaults to `IWorkspaceProvider.getWorkspaceRoot()`, 120 s default / 600 s max timeout, 64 KB stdout+stderr cap with truncation marker, kill on `ctx.signal`. `PTY_HOST` is not used. |

`PathMutex` (`agent-loop/src/lib/path-mutex.ts`): `run<T>(key: string | undefined, fn): Promise<T>`; same normalized absolute path → FIFO chain; different keys → concurrent. (P1-16)

## 7. Provider lib (`llm-providers`)

- `ProviderProfile` gains `wireProtocol?: 'anthropic-messages' | 'openai-completions' | 'openai-responses'` (`provider-profile.types.ts:18`, schema `:38`). `WorkspaceProviderProfileResolver.resolveProviderProfileForWorkspace(workspacePath, model, options?: { transport?: 'sdk' | 'native' })`: for `transport:'native'` the proxy-backed providers (OpenRouter, LM Studio, custom OpenAI gateways) do **not** acquire a translation proxy; they return `{providerId, authEnv:{ANTHROPIC_AUTH_TOKEN: key}, baseUrl: providerUrl, wireProtocol:'openai-completions'}`. Direct Anthropic keeps `ANTHROPIC_API_KEY` and no `wireProtocol`. The SDK path ignores the field. (P1-10; the resolver spec asserts `ProviderProxyPool.acquire` is not called.)
- `PiAiLlmStream implements ILlmStream`: `resolveRoute(profile)` picks the wire API: `profile.wireProtocol` if set; else `ANTHROPIC_API_KEY` present → `anthropic-messages` against `api.anthropic.com`; else `baseUrl` present → `anthropic-messages` against that URL with `apiKey = ANTHROPIC_AUTH_TOKEN` (Ollama/Moonshot/Z.AI speak it directly, `workspace-provider-profile-resolver.ts:199-247`). It builds one `createProvider({id: profile.providerId, baseUrl, auth: envApiKeyAuth(...) or resolve-to-empty for keyless, models:[model], api: <lazy api module>})` per `(providerId, baseUrl, wire)` and caches it in a `createModels()` collection. Auth never touches `process.env`: the key is passed as `options.apiKey` on every request.
- Model descriptor: for Anthropic ids the built-in catalog (`anthropicProvider()` models) supplies `contextWindow`/`cost`; for custom routes a `Model` is synthesized with `contextWindow` from `profile.defaultMaxTokens ?? 128000`, zero cost, `reasoning: false`, `compat: {supportsDeveloperRole:false, supportsReasoningEffort:false}` for `openai-completions` base URLs that are local (`localhost`, `127.0.0.1`).
- Thinking/effort → `streamSimple({ reasoning })`: `thinking.type === 'disabled'` → no `reasoning`; `'enabled'` or `'adaptive'` → `clampThinkingLevel(model, effort ?? 'medium')`; `effort` alone (no `thinking`) → same. `EffortLevel` values (`low|medium|high|xhigh|max`) are a subset of pi-ai `ThinkingLevel`, so the map is identity plus clamp.
- Caching: `options.sessionId = request.cacheSessionId`, `cacheRetention` from settings (`'short'` default). The engine keeps prefix order stable; the provider lib does not reorder.
- Usage → `ResultStatsPayload` (`agent-adapter.types.ts:29-48`): sum of step usages in the turn → `tokens:{input, output, cacheRead, cacheCreation: cacheWrite}`, `cost = usage.cost.total` when the model has non-zero cost rates else `null`, `duration = turn ms`, `modelUsage = [{model, inputTokens, outputTokens, contextWindow, costUSD, cacheReadInputTokens, lastTurnContextTokens: input+cacheRead}]` (one entry per distinct model in the turn). Consumers treat it as an estimate (task risk table).
- `error` events map to `LlmStreamEvent{type:'error'}` with `message.errorMessage`; the lib classifies HTTP 401/403 → `authentication_failed`, 429 → `rate_limit`, 5xx → `server_error`, else `unknown` for the `turn_state.error` field.

## 8. Failure behavior

| Failure                                                              | Logged                                                                                                                                                  | Emitted                                                                                                                          | Session state                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Provider `error` mid-stream                                          | `assistant_message` (partial, `stopReason:'error'`), `error{message, code}`, `turn_end{reason:'error'}`                                                 | `message_complete{stopReason:'error'}`, `turn_state{phase:'failed', error, terminalReason:'model_error'}`                        | Record stays active; next `chat:continue` runs a new turn; the partial message is in the history.           |
| Tool throws / `parse` fails                                          | `tool_result{isError:true, content: error.message}`                                                                                                     | `tool_result{isError:true}` then the next step                                                                                   | Turn continues; the model sees the error text.                                                              |
| Permission denied                                                    | `tool_result{isError:true, denied:true, content: decision.message}`                                                                                     | `tool_result{isError:true}`                                                                                                      | Continue; `decision.interrupt` → `turn_end{reason:'denied_interrupt'}`, `terminalReason:'aborted_tools'`.   |
| Permission timeout (60 s unroutable, `sdk-permission-handler.ts:69`) | as denied, message states the timeout                                                                                                                   | as denied                                                                                                                        | Continue.                                                                                                   |
| `interruptCurrentTurn` / `chat:abort`                                | `interrupt{step}`, partial `assistant_message{stopReason:'aborted'}`, unfinished tool calls repaired as synthetic results, `turn_end{reason:'aborted'}` | `message_complete{stopReason:'aborted'}`, `turn_state{idle, 'aborted_streaming'}` (or `'aborted_tools'` when tools were running) | Active.                                                                                                     |
| Max steps (`maxStepsPerTurn`, default 200)                           | `turn_end{reason:'max_steps'}`                                                                                                                          | last `message_complete`, `turn_state{idle, terminalReason:'max_turns'}`                                                          | Active. (P1-15)                                                                                             |
| `ISessionLog.append` throws                                          | nothing more; the engine aborts the step                                                                                                                | `turn_state{failed, error:'unknown'}`                                                                                            | Record ended (`interruptSession`) — the invariant cannot hold, so the session is not continued silently.    |
| Resume with no log row                                               | —                                                                                                                                                       | —                                                                                                                                | `resumeSession` throws `SessionNotActiveError`; `ChatSessionService` reports `session-not-active` as today. |

## 9. Registration plan

Order inside each root: after `registerSdkServices` and after `registerVsCodeLmToolsServices`/`CodeExecutionMCP` registration, before RPC handlers resolve.

- `registerLlmProviders(container, logger)` → `AGENT_LOOP_TOKENS.LLM_STREAM` (singleton `PiAiLlmStream`).
- `registerAgentTools(container, logger)` → `AGENT_LOOP_TOKENS.TOOL_REGISTRY` (factory: core tools + `PtahToolRegistryAdapter`; `PTAH_TOOL_INVOKER` resolved lazily on first `list()`).
- `registerAgentSession(container, logger)` → `AGENT_LOOP_TOKENS.SESSION_LOG`: `SqliteSessionLog` when `container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)` (same guard as `task-specs/src/lib/di/register.ts:75`), else `JsonlSessionLog` on `IPlatformInfo.globalStoragePath`.
- `registerAgentLoop(container, logger)` → `AGENT_LOOP_TOKENS.ENGINE_FACTORY`.
- `registerNativeAgentAdapter(container, logger)` → `AGENT_LOOP_TOKENS.NATIVE_AGENT_ADAPTER` (singleton) and `CORE_PROMPT_APPENDIX` `useValue: PTAH_CORE_SYSTEM_PROMPT` — the **root** imports the constant from `@ptah-extension/agent-sdk` and passes it in; the native lib never imports `agent-sdk`.
- `registerSdkServices` additionally registers `AGENT_LOOP_TOKENS.TOOL_PERMISSION_GATE` → `SdkToolPermissionGate` (wraps `SdkPermissionHandler.createCallback(sessionId, undefined, tabId, () => level, tabId, () => sessionId)`).
- `registerAgentRuntime(container, logger)` + `wireAgentRuntimeSelector(container)` replace `wireAgentAdapterAliases(container)` at `phase-2-libraries.ts:191` (VS Code), `:260` (Electron), `container.ts:692` (CLI).
- `expected-resolvable.ts` in both apps: add `NativeAgentAdapter` and `AgentRuntimeSelector` classes. The smoke specs' minimal containers must register `LLM_STREAM`, `TOOL_REGISTRY`, `SESSION_LOG`, `ENGINE_FACTORY`, `TOOL_PERMISSION_GATE`, `CORE_PROMPT_APPENDIX`, `SDK_AGENT_ADAPTER`, `SDK_SESSION_METADATA_STORE`, `SDK_SESSION_TURN_STATE_REGISTRY`, `SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY` stubs. (P1-13)
- `package.json`: `"@earendil-works/pi-ai": "0.84.4"` exact. pi-ai is pure JS (deps: `@anthropic-ai/sdk`, `openai`, `typebox`, `partial-json`); no native rebuild for Electron. VSIX: pi-ai ships inside `main.mjs`; the marketplace scanner rule applies to non-JS files only.

## 10. Test plan

Fakes live in `agent-loop-contracts/src/testing/` and are re-exported from the lib barrel (same layout as `platform-core/src/testing`): `FakeLlmStream` (scripted `LlmStreamEvent[][]` per request, records every `LlmRequest`, exposes the `AbortSignal` it received), `FakeToolRegistry` (map of `IAgentTool` with call log), `FakeToolPermissionGate` (queue of decisions), `InMemorySessionLog`, `FakeFileSystemProvider` (map-backed `IFileSystemProvider`), `FakeWorkspaceProvider`, `FakeTokenCounter` (`Math.ceil(text.length / 4)`).

| Criterion | Spec file                                                                                                                | Assertion                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| P1-1      | `libs/backend/llm-providers/src/lib/pin.spec.ts`                                                                         | reads root `package.json`, exact `0.84.4`, forbidden packages absent                                                         |
| P1-2      | lint target                                                                                                              | `npx nx run-many -t lint -p` the seven libs                                                                                  |
| P1-3      | `native-agent-adapter/src/lib/native-agent-adapter.contract.spec.ts`                                                     | constructs with fakes, calls all 29 members, `getCliJsPath() === null`, `preloadSdk()` resolves                              |
| P1-4      | `native-agent-adapter/src/lib/streams/text-turn.spec.ts`                                                                 | exact ordered sequence (a)                                                                                                   |
| P1-5      | `native-agent-adapter/src/lib/streams/tool-turn.spec.ts`                                                                 | sequences (b) and (c); `FakeFileSystemProvider` has no write on deny; second `LlmRequest` contains the denial text           |
| P1-6      | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/ptah-tool-catalog.spec.ts`                                 | `callPtahTool('ptah_ast_analyze', …)` equals `handleMCPRequest(tools/call).result`; `ptahAPI` stub records `callerSessionId` |
| P1-7      | `agent-session/src/lib/derive-messages.replay.spec.ts` + `agent-loop/src/lib/engine.replay.spec.ts`                      | three turns, two tools, one model switch; `deriveMessages(log)` deep-equals every `FakeLlmStream` request's `messages`       |
| P1-8      | `native-agent-adapter/src/lib/interrupt.spec.ts`                                                                         | signal aborted, `turn_state` follows, `isSessionActive` true, then `interruptSession` → false                                |
| P1-9      | `native-agent-adapter/src/lib/session-controls.spec.ts`                                                                  | next request `model`/`effort` changed; `FakeToolPermissionGate` receives new level                                           |
| P1-10     | `llm-providers/src/lib/route-resolver.spec.ts` + `auth-providers/.../workspace-provider-profile-resolver.native.spec.ts` | route selection; proxy pool not called                                                                                       |
| P1-11     | `agent-runtime/src/lib/agent-runtime-selector.spec.ts` + `rpc-handlers/.../chat-session.service.runtime.spec.ts`         | two adapter fakes; `session:list` shows `runtime:'native'`; `chat:continue` reaches native fake                              |
| P1-12     | existing suites                                                                                                          | `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers`                                          |
| P1-13     | `apps/*/src/di/container.smoke.spec.ts` (both), `cli-engine/src/lib/container.spec.ts`                                   | tokens resolve; manual `ptah session start --runtime native`                                                                 |
| P1-14     | `native-agent-adapter/src/lib/prompt/system-prompt.spec.ts`                                                              | `FakeTokenCounter` count < 2000 before appendix                                                                              |
| P1-15     | `agent-loop/src/lib/engine.max-steps.spec.ts`                                                                            | tool-forever model stops at cap; `turn_end.reason:'max_steps'`; adapter spec asserts `terminalReason:'max_turns'`            |
| P1-16     | `agent-loop/src/lib/path-mutex.spec.ts` + `agent-tools/src/lib/core/edit.tool.concurrency.spec.ts`                       | same file serialized in order; different files overlap                                                                       |
| P1-17     | `agent-session/src/lib/derive-messages.repair.spec.ts` + `agent-loop/src/lib/engine.resume-repair.spec.ts`               | synthetic error result present in the next request and appended to the log                                                   |
| P1-18     | `agent-loop/src/lib/cache-prefix.spec.ts`                                                                                | identical `systemPrompt` and `tools` across two requests; `model_changed` → `cache_reset` logged                             |
| P1-19     | reviewer grep + `agent-loop-contracts/src/lib/schemas.spec.ts`                                                           | every Zod schema rejects a malformed sample                                                                                  |

Run: `npx nx run-many -t test -p @ptah-extension/agent-loop-contracts @ptah-extension/llm-providers @ptah-extension/agent-loop @ptah-extension/agent-tools @ptah-extension/agent-session @ptah-extension/native-agent-adapter @ptah-extension/agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/auth-providers @ptah-extension/agent-sdk @ptah-extension/rpc-handlers` and check that the header reports 11 projects.

## 11. Risks and Phase 2/3 seams

Design-specific risks:

- **Two session-log adapters.** The VS Code host has no SQLite; the JSONL adapter is the only way P1 runs there. Mitigation: one contract spec for both; `SqliteSessionLog` is the primary and the JSONL adapter is a thin file-per-session store with no query surface.
- **Turn-state registry lives in `agent-sdk`.** The selector bridge (section 5) is the only writer for native sessions. If a native stream ends without `turn_state` (thrown generator), the broadcaster's existing `forceIdle` fallback (`chat-stream-broadcaster.service.ts:349-350`) still fires.
- **`tool_start` twice per call** (stream + complete). The frontend dedups by `source` priority (`stream.ts:16-22`); spec P1-5 asserts the final node has the full input.
- **pi-ai `streamSimple` hides provider options.** If a route needs `interleavedThinking` or `thinkingBudgetTokens`, the lib must switch to `stream()` with `hasApi()` narrowing; keep `resolveRoute` the single place.
- **Custom-route context windows are guesses.** `contextWindow` from settings; a wrong value only affects Phase 2 compaction thresholds.
- **`SdkToolPermissionGate` still needs `WEBVIEW_MANAGER`.** The CLI registers a push adapter (`container.ts:342`), so the gate resolves in all three hosts; unroutable prompts deny after 60 s.

Phase 2/3 seams Phase 1 must leave open:

1. Compaction: the engine's `beforeRequest(messages)` hook is the insertion point for an `ICompactor`; the `CompactionStartCallback` slot already exists in the callback registry.
2. `ISubagentProvider`: `IAgentTool` + `AgentToolContext.sessionId` are enough; the `Task` tool is a registry entry.
3. Hooks: `LoopEvent` already names `tool_start`/`tool_result`/`turn_start`/`turn_end`; a `hooks.json` bridge subscribes to the engine's event bus.
4. Slash commands: `executeSlashCommand` throws now; the inbox reserves a `command` lane (`Inbox.push({kind})`).
5. Fork: `native_sessions.parent_id`/`fork_seq` columns exist; `deriveMessages` accepts a `seqLimit`.
6. Memory injection: a `pre_step` kind is added to `SessionLogEventKind` when used; `deriveMessages` maps it to a user message.
7. Tool search / deferred loading: `IToolRegistry.definitions()` is the only place the model-visible list is built.
8. JSONL export: `JsonlSessionLog` uses a Ptah-native layout, not the Claude layout; Phase 3 adds an exporter over `ISessionLog.read`.
9. Checkpoint/rewind: `AgentToolContext.turn` + `mutatesPath` give the copy-on-write snapshot its keys.

## 12. Deviations from task-description.md

1. **Session log store (2.1.5).** "Append-only event log in `persistence-sqlite`" is met on Electron and CLI. The VS Code host registers no SQLite connection (`phase-2-libraries.ts:78-80`), so a JSONL adapter behind the same `ISessionLog` port is required there. Alternative rejected: registering `persistence-sqlite` in the VS Code host (native `better-sqlite3` inside the VSIX; out of scope for this task).
2. **`ProviderId` union (shared).** `IAIProvider.providerId` must be a `ProviderId`; `'native'` is added to the union at `ai-provider.types.ts:12`. Blast radius: 68 files import the type; the added member breaks no exhaustive switch (checked: `SdkAgentAdapter` casts, `auth-providers` compares strings).
3. **`PTAH_CORE_SYSTEM_PROMPT` (2.1.9)** is exported from `agent-sdk`; the native lib receives it by `useValue` token from the composition root instead of importing it.
4. **P1-4 sequence** starts with a `turn_state{generating}` before `message_start`, mirroring the SDK path (`stream-event.transformer.ts:173`). The spec asserts the ordered subsequence the criterion lists and that the final event is `turn_state{idle}`.
5. **`message_start` per step**, not per turn, because each provider response is one assistant message and the frontend already renders SDK multi-message turns this way.

## 13. Handoff to team-leader

Batches are file-disjoint. B1 first. B2–B5 in parallel after B1. B6 and B7 in parallel after B2–B5 (both consume the token names fixed in B1). B8 after B6+B7. B9 last.

| #   | Batch                                                 | Creates / edits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Depends on                                            |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| B1  | Contracts + shared types + pin                        | create `libs/backend/agent-loop-contracts/**` (tokens, ports, `LoopEvent`, errors, Zod schemas, `src/testing/*` fakes); edit `libs/shared/src/lib/types/ai-provider.types.ts` (`'native'`), `provider-profile.types.ts` + `.schemas.ts` (`wireProtocol`), `rpc/rpc-chat.types.ts` (`runtime`), `agent-adapter.types.ts` (`AgentSessionStartConfig.runtime`), `execution/node.ts` (`ChatSessionSummary.runtime`); `package.json` pin; `tsconfig.base.json` aliases for all seven libs                                                         | —                                                     |
| B2  | `llm-providers`                                       | create `libs/backend/llm-providers/**` (`pi-ai-llm-stream.ts`, `route-resolver.ts`, `thinking-map.ts`, `usage-map.ts`, `di/*`)                                                                                                                                                                                                                                                                                                                                                                                                               | B1                                                    |
| B3  | `agent-session` + migration                           | create `libs/backend/agent-session/**`; create `persistence-sqlite/src/lib/migrations/0042_native_session_log.ts` (+spec); edit `migrations/index.ts`                                                                                                                                                                                                                                                                                                                                                                                        | B1                                                    |
| B4  | `agent-tools` + catalog extraction                    | create `libs/backend/agent-tools/**`; create `vscode-lm-tools/.../mcp-core/ptah-tool-catalog.ts` (+spec); edit `protocol-dispatcher.ts` (wrappers), `mcp-core/index.ts`, `http-mcp-server.service.ts` (`createInProcessInvoker`), `vscode-lm-tools/src/lib/di/register.ts`, `vscode-lm-tools/src/index.ts`                                                                                                                                                                                                                                   | B1                                                    |
| B5  | `agent-loop`                                          | create `libs/backend/agent-loop/**` (`agent-loop-engine.ts`, `step-runner.ts`, `tool-executor.ts`, `path-mutex.ts`, `inbox.ts`, `request-builder.ts`, `di/*`)                                                                                                                                                                                                                                                                                                                                                                                | B1                                                    |
| B6  | `native-agent-adapter`                                | create `libs/backend/native-agent-adapter/**` (adapter, `session-record-registry.ts`, `loop-event-mapper.ts`, `turn-state.ts`, `system-prompt.ts`, `callback-registry.ts`, `di/*`)                                                                                                                                                                                                                                                                                                                                                           | B2–B5 (integration specs); may start on B1 with fakes |
| B7  | Selector + handler moves + resolver + settings + gate | create `libs/backend/agent-runtime/**`; create `agent-sdk/src/lib/permission/sdk-tool-permission-gate.ts` (+spec); edit `agent-sdk/src/lib/di/register.ts`, `agent-sdk/src/lib/session-metadata-store.ts` (`runtime`), `agent-sdk/src/index.ts`; edit `rpc-handlers/.../chat-rpc.schema.ts`, `chat-session.service.ts` (pass `runtime`, resolver `transport`), `config-rpc.handlers.ts`, `session-rpc.handlers.ts`; edit `auth-providers/.../workspace-provider-profile-resolver.ts` (+spec); edit `platform-core/src/file-settings-keys.ts` | B1                                                    |
| B8  | Composition roots + CLI flag                          | edit `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, `expected-resolvable.ts`, `container.smoke.spec.ts`; `apps/ptah-electron/src/di/phase-2-libraries.ts`, `expected-resolvable.ts`, `container.smoke.spec.ts`; `libs/backend/cli-engine/src/lib/container.ts`; `apps/ptah-cli/src/cli/commands/session.ts`, `apps/ptah-cli/src/cli/router.ts` (flag)                                                                                                                                                                             | B6, B7                                                |
| B9  | Verification gate (senior-tester)                     | run the P1 matrix (section 10), `npm run typecheck:all`, lint on new libs; write `test-report.md`                                                                                                                                                                                                                                                                                                                                                                                                                                            | B8                                                    |

Executor recommendation: B1–B7 `backend-developer` via CLI agents (one agent per batch, `context.md` execution mode); B8 `backend-developer`; B9 `senior-tester`. Each lib batch ends with a lib `CLAUDE.md` (excluded from the VSIX by `.vscodeignore`).
