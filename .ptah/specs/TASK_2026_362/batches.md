# TASK_2026_362 — Batches (Phase 1: native conductor on pi-ai)

Author: team-leader (decomposition mode). Date: 2026-08-31.
Inputs: `task-description.md` (approved), `implementation-plan.md` (approved), `context.md`.
Execution mode: CLI agents only (user instruction in `context.md`). Executors are
recommended, never spawned by this document. Max 3 CLI agents concurrent.

## Plan verification (2026-08-31)

- **File-disjoint:** every create/edit path in plan section 13 was listed and compared.
  No path appears in two batches. The nine batches are kept, with the corrections below.
- **Template:** `libs/backend/task-specs/{project.json,jest.config.ts,tsconfig*.json}` is
  valid: `build` (`@nx/esbuild:esbuild`, `cjs`, `external` list), `test` (`@nx/jest:jest`),
  `lint` (root config), `typecheck` (`tsc --noEmit`). Root `jest.config.ts` uses
  `getJestProjectsAsync()`, so new libs are auto-discovered.
- **Tag edges (`eslint.config.mjs:117-265`):** `type:core → core|util`; `type:feature →
feature|data-access|ui|util|core`; `type:app → …|core`; `scope:cli|electron → …|extension`.
  `shared`, `platform-core`, `vscode-core`, `persistence-sqlite` are `type:util`; `agent-sdk`,
  `auth-providers`, `rpc-handlers`, `vscode-lm-tools`, `cli-engine` are `type:feature`; the
  apps are `type:app`. Every proposed edge is legal, including contracts → `platform-core` types.
- **Alias format:** `"@ptah-extension/<name>": ["./libs/backend/<name>/src/index.ts"]`
  under `compilerOptions.paths` in `tsconfig.base.json`.
- **Claims re-verified by grep:** the VS Code host registers no SQLite
  (`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:76-97`; Electron `:310` and
  `cli-engine/.../register-thoth-libraries.ts:81` do). Exactly five `rpc-handlers` files
  inject `SDK_TOKENS.SDK_AGENT_ADAPTER`; three services use `TOKENS.AGENT_ADAPTER`.
  `wireAgentAdapterAliases` is called at the three cited sites. Migrations end at
  `version: 41`. `ProviderId` is at `ai-provider.types.ts:12`. No forbidden package is in `package.json`.

### Plan corrections

1. **`deriveMessages` ownership.** Section 1 puts it in `agent-session`, section 2 declares
   it in contracts, section 4 has `agent-loop` calling it, and `agent-loop` may not import
   `agent-session`. It is a pure function over `SessionLogEvent[]`, so it lives in
   `agent-loop-contracts/src/lib/derive-messages.ts` (B1) with both its specs.
   `agent-session` (B3) owns only the two adapters and the contract spec.
2. **Engine API is missing from the port sketch.** B5 and B6 can only run apart if the
   engine surface is a contract. B1 adds `IAgentLoopEngine`, `IAgentLoopEngineFactory`,
   `AgentLoopSessionState`, `IInbox`, `InboxItem` (block below).
3. **Session-log payload schemas** are unnamed in the plan. B1 owns
   `session-log.schemas.ts` (one Zod schema per `SessionLogEventKind`, payloads per plan
   section 4); B3 validates on read, B5 emits.
4. **Tool argument schemas** live next to each tool in `agent-tools` (B4). Contracts owns
   only runtime-id, settings and session-log schemas.
5. **Settings key names** are read by B2, B5 and B7. B1 exports
   `NATIVE_RUNTIME_SETTING_KEYS` + `NativeRuntimeSettingsSchema`; B7 registers the keys in
   `file-settings-keys.ts`.
6. **`native-agent-adapter` and `agent-runtime` import only contracts** (tokens + ports),
   never sibling libs. B7 then depends on B1 alone. B6 still waits for B5 because its
   stream specs run the real engine against `FakeLlmStream`.
7. **`cli-engine/src/lib/container.spec.ts` does not exist** (plan section 10, P1-13).
   B8 covers the CLI root with the app smoke specs, an optional
   `container.native-runtime.spec.ts`, and the manual `--runtime native` check.
8. **Dirty working tree.** Three B7 targets carry uncommitted TASK_2026_361 hunks:
   `agent-sdk/src/lib/di/register.ts`, `agent-sdk/src/index.ts`,
   `rpc-handlers/src/lib/handlers/session-rpc.handlers.ts`. Precondition for B7: the user
   commits or stashes TASK_2026_361. The B7 executor never reverts hunks it did not write.
9. **Register function names are pinned** so B8 compiles against B2–B7 with no shared
   context: `registerLlmProviders`, `registerAgentSession`, `registerAgentTools`,
   `registerAgentLoop`, `registerNativeAgentAdapter`, `registerAgentRuntime`,
   `wireAgentRuntimeSelector`. Signature `(container: DependencyContainer, logger: ILogger): void`.

### B1 contract additions (binding for B2–B7)

```ts
export interface AgentLoopSessionState {
  readonly sessionId: SessionId;
  readonly tabId: string | undefined;
  readonly workspaceRoot: string;
  readonly profile: ProviderProfile;
  model: string;
  effort: EffortLevel | undefined;
  thinking: ThinkingConfig | undefined;
  permissionLevel: AgentPermissionLevel;
  readonly maxStepsPerTurn: number;
  readonly cacheRetention: 'none' | 'short' | 'long';
  readonly systemPrompt: string;
}
export type InboxItem = { kind: 'steer' | 'followUp'; content: string } | { kind: 'command'; name: string };
export interface IInbox {
  push(item: InboxItem): void;
  takeSteer(): InboxItem[];
  takeFollowUp(): InboxItem | undefined;
}
export interface IAgentLoopEngine {
  runTurn(state: AgentLoopSessionState, inbox: IInbox, signal: AbortSignal): AsyncIterable<LoopEvent>;
}
export interface IAgentLoopEngineFactory {
  create(sessionId: SessionId): IAgentLoopEngine;
}
export type WireProtocol = 'anthropic-messages' | 'openai-completions' | 'openai-responses';
export interface LlmModelInfo {
  id: string;
  contextWindow: number;
  maxTokens: number;
  supportsThinking: boolean;
  wireProtocol: WireProtocol;
}
export const NATIVE_RUNTIME_SETTING_KEYS = { DEFAULT: 'agentRuntime.default', MAX_STEPS: 'agentRuntime.native.maxStepsPerTurn', CACHE_RETENTION: 'agentRuntime.native.cacheRetention' } as const;
```

**Standards for every batch** (executor prompts cite this block as "Standards"): hexagonal
rule (backend libs import `platform-core` ports, never `platform-vscode|electron|cli`);
`catch (error: unknown)` + `instanceof Error`; Zod 4.3.6 at boundaries only; `Symbol.for`
tokens in `tokens.ts`, registered in `register.ts`; `max-lines` 700, facade rule, no `utils`
file; no `@ts-ignore`; kebab-case files; `export type` for type re-exports; no
`import 'vscode'`; never `nx test a b c`; do not commit; touch only the batch file list.

**Lib scaffold set** = `project.json`, `jest.config.ts`, `tsconfig.json`,
`tsconfig.lib.json`, `tsconfig.spec.json`, `CLAUDE.md`, `src/index.ts`, copied from
`libs/backend/task-specs` with paths and `displayName` renamed.

---

### Batch 1 — Contracts lib, shared types, pi-ai pin, aliases

Status: PENDING
**Depends on**: none
**Recommended Executor**: `backend-developer`
**Execution Mode**: sequential (alone; every other batch imports it)

**Files created**

- `libs/backend/agent-loop-contracts/` scaffold set (tags `scope:extension`, `type:core`)
- `libs/backend/agent-loop-contracts/src/lib/tokens.ts`
- `libs/backend/agent-loop-contracts/src/lib/llm.types.ts`
- `libs/backend/agent-loop-contracts/src/lib/tool.types.ts`
- `libs/backend/agent-loop-contracts/src/lib/permission.types.ts`
- `libs/backend/agent-loop-contracts/src/lib/session-log.types.ts`
- `libs/backend/agent-loop-contracts/src/lib/session-log.schemas.ts`
- `libs/backend/agent-loop-contracts/src/lib/engine.types.ts`
- `libs/backend/agent-loop-contracts/src/lib/loop-event.types.ts`
- `libs/backend/agent-loop-contracts/src/lib/runtime.schemas.ts`
- `libs/backend/agent-loop-contracts/src/lib/errors.ts`
- `libs/backend/agent-loop-contracts/src/lib/derive-messages.ts` + `derive-messages.replay.spec.ts` + `derive-messages.repair.spec.ts`
- `libs/backend/agent-loop-contracts/src/lib/schemas.spec.ts`
- `libs/backend/agent-loop-contracts/src/testing/index.ts`
- `libs/backend/agent-loop-contracts/src/testing/fake-llm-stream.ts`
- `libs/backend/agent-loop-contracts/src/testing/fake-tool-registry.ts`
- `libs/backend/agent-loop-contracts/src/testing/fake-tool-permission-gate.ts`
- `libs/backend/agent-loop-contracts/src/testing/in-memory-session-log.ts`
- `libs/backend/agent-loop-contracts/src/testing/fake-platform-ports.ts`

**Files edited**

- `package.json` (`"@earendil-works/pi-ai": "0.84.4"`, no range prefix)
- `package-lock.json` (from `npm install`)
- `tsconfig.base.json` (seven aliases)
- `libs/shared/src/lib/types/ai-provider.types.ts` (`'native'` in `ProviderId`)
- `libs/shared/src/lib/types/provider-profile.types.ts` (`wireProtocol?`)
- `libs/shared/src/lib/types/provider-profile.schemas.ts` (`wireProtocol` optional enum)
- `libs/shared/src/lib/types/rpc/rpc-chat.types.ts` (`ChatStartParams.runtime?`)
- `libs/shared/src/lib/types/agent-adapter.types.ts` (`AgentSessionStartConfig.runtime?`)
- `libs/shared/src/lib/types/execution/node.ts` (`ChatSessionSummary.runtime?`)

**Acceptance**: P1-1, P1-7 and P1-17 pure part (`derive-messages.*.spec.ts`), P1-19 (`schemas.spec.ts`).
Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-loop-contracts @ptah-extension/shared`, then `npm run typecheck:all` (`ProviderId` has 68 importers).

**Definition of done**

- Every symbol in plan section 2 and in "B1 contract additions" is exported from `src/index.ts`; types with `export type`; `AGENT_LOOP_TOKENS` has the nine `Symbol.for` tokens.
- `deriveMessages` implements the five rules of plan section 4 and returns `{messages, repairs}`.
- `session-log.schemas.ts` has one schema per `SessionLogEventKind` plus `SessionLogEventSchema`; `runtime.schemas.ts` has `AgentRuntimeIdSchema`, `NativeRuntimeSettingsSchema`, `NATIVE_RUNTIME_SETTING_KEYS`.
- `npm run typecheck:all` is green; `npm ls @earendil-works/pi-ai` shows `0.84.4`.

**Executor prompt**

```
Task folder: .ptah/specs/TASK_2026_362. Read implementation-plan.md sections 0, 1, 2, 4, 5,
12 and batches.md "Plan corrections", "B1 contract additions", "Standards", "Lib scaffold
set", "Batch 1". Create libs/backend/agent-loop-contracts (alias
@ptah-extension/agent-loop-contracts, tags ["scope:extension","type:core"]). Allowed
imports: @ptah-extension/shared, @ptah-extension/platform-core (types only, for fakes), zod.
Write exactly the Batch 1 files: tokens.ts (Symbol.for), ports in *.types.ts, Zod in
*.schemas.ts, the pure deriveMessages, and the fakes under src/testing (FakeLlmStream
records every LlmRequest and its AbortSignal; InMemorySessionLog; FakeToolRegistry;
FakeToolPermissionGate with a decision queue; fake platform ports; FakeTokenCounter =
ceil(len/4)). Re-export src/testing from src/index.ts. Edit the six libs/shared files as plan sections 5, 7 and 12 state (optional
fields only). Add the exact pi-ai pin, run npm install, add the seven aliases
(agent-loop-contracts, llm-providers, agent-loop, agent-tools, agent-session,
native-agent-adapter, agent-runtime). Write the lib CLAUDE.md. Apply "Standards".
Verify: npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-loop-contracts
@ptah-extension/shared ; then npm run typecheck:all. Report files, commands, results.
```

---

### Batch 2 — `llm-providers` (pi-ai wrapper)

Status: PENDING
**Depends on**: 1
**Recommended Executor**: `backend-developer`
**Execution Mode**: parallel (beside 6 and 7)

**Files created**

- `libs/backend/llm-providers/` scaffold set (esbuild `external` adds `@earendil-works/pi-ai`)
- `libs/backend/llm-providers/src/lib/pi-ai-llm-stream.ts` + `pi-ai-llm-stream.spec.ts`
- `libs/backend/llm-providers/src/lib/route-resolver.ts` + `route-resolver.spec.ts`
- `libs/backend/llm-providers/src/lib/thinking-map.ts` + `thinking-map.spec.ts`
- `libs/backend/llm-providers/src/lib/usage-map.ts` + `usage-map.spec.ts`
- `libs/backend/llm-providers/src/lib/pin.spec.ts`
- `libs/backend/llm-providers/src/lib/di/register.ts`

**Files edited**: none

**Acceptance**: P1-1 (`pin.spec.ts`), P1-10 route half (`route-resolver.spec.ts`).
Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/llm-providers`

**Definition of done**

- `PiAiLlmStream implements ILlmStream`; `@earendil-works/pi-ai` is imported in this lib only; `registerLlmProviders` registers `AGENT_LOOP_TOKENS.LLM_STREAM` as a singleton.
- `resolveRoute` follows plan section 7: `wireProtocol` → `ANTHROPIC_API_KEY` → `baseUrl` + `ANTHROPIC_AUTH_TOKEN`; API key goes in `options.apiKey`; `process.env` is never read.
- Thinking/effort map uses `clampThinkingLevel`; usage map yields `LlmUsage` with null cost for zero-rate models.
- pi-ai `error` events become `LlmStreamEvent{type:'error'}` with HTTP status classified (401/403, 429, 5xx).

**Executor prompt**

```
Task folder: .ptah/specs/TASK_2026_362. Read implementation-plan.md sections 0 (pi-ai API
notes), 1, 2 (ILlmStream, LlmRequest, LlmStreamEvent, LlmModelInfo), 7 and batches.md
"Plan corrections", "Standards", "Lib scaffold set", "Batch 2". Batch 1 is done: import
ports and tokens from @ptah-extension/agent-loop-contracts; read
NATIVE_RUNTIME_SETTING_KEYS.CACHE_RETENTION via PLATFORM_TOKENS.WORKSPACE_PROVIDER
getConfiguration('ptah', key, 'short'). Create libs/backend/llm-providers (alias
@ptah-extension/llm-providers, tags ["scope:extension","type:feature"]). Allowed imports:
agent-loop-contracts, platform-core, vscode-core (ILogger), shared, @earendil-works/pi-ai.
Every pi-ai type stays here. Write exactly the Batch 2 files. Use
createModels/createProvider/envApiKeyAuth and the lazy api modules; cache one provider per
(providerId, baseUrl, wire); streamSimple with {reasoning}; options.sessionId =
request.cacheSessionId; options.signal = request.signal; synthesize a Model for custom
routes per plan section 7. Specs use pi-ai fauxProvider. pin.spec.ts reads root package.json and asserts the
exact "0.84.4" and the absence of pi-agent-core, @langchain/*, deepagents, cordis. Write
CLAUDE.md. Apply "Standards".
Verify: npx nx run-many -t test,lint,typecheck -p @ptah-extension/llm-providers
Report files, commands, results.
```

---

### Batch 3 — `agent-session` (session log adapters) + migration 0042

Status: PENDING
**Depends on**: 1
**Recommended Executor**: `backend-developer`
**Execution Mode**: parallel (beside 4 and 5)

**Files created**

- `libs/backend/agent-session/` scaffold set (esbuild `external` keeps `better-sqlite3`)
- `libs/backend/agent-session/src/lib/sqlite-session-log.ts`
- `libs/backend/agent-session/src/lib/jsonl-session-log.ts`
- `libs/backend/agent-session/src/lib/session-log.contract.ts` + `session-log.contract.spec.ts`
- `libs/backend/agent-session/src/lib/di/register.ts`
- `libs/backend/persistence-sqlite/src/lib/migrations/0042_native_session_log.ts` + `0042_native_session_log.spec.ts`

**Files edited**

- `libs/backend/persistence-sqlite/src/lib/migrations/index.ts` (append `version: 42`)

**Acceptance**: P1-7 store half (both adapters pass the contract spec; `read` returns `seq`-ordered events that `deriveMessages` accepts). Supports P1-17.
Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-session @ptah-extension/persistence-sqlite`

**Definition of done**

- Migration `0042` matches the DDL of plan section 4 (`native_sessions`, `native_session_events`, index), `CREATE … IF NOT EXISTS`.
- `SqliteSessionLog.append` allocates `seq` inside one `BEGIN IMMEDIATE` transaction; `JsonlSessionLog` writes `<globalStoragePath>/native-sessions/<id>.jsonl` through a per-session promise chain.
- Both adapters validate payloads on read with the B1 schemas and pass one shared contract spec (in-memory SQLite and a temp dir).
- `registerAgentSession` picks SQLite when `container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)` (guard style of `task-specs/src/lib/di/register.ts:75`), else JSONL.

**Executor prompt**

```
Task folder: .ptah/specs/TASK_2026_362. Read implementation-plan.md sections 1, 2
(ISessionLog, SessionLogEvent), 4, 9, 12 item 1 and batches.md "Plan corrections" items 1
and 3, "Standards", "Lib scaffold set", "Batch 3". Batch 1 is done: ports, per-kind
payload schemas and deriveMessages come from @ptah-extension/agent-loop-contracts. Create
libs/backend/agent-session (alias @ptah-extension/agent-session, tags
["scope:extension","type:feature"]). Allowed imports: agent-loop-contracts,
persistence-sqlite (PERSISTENCE_TOKENS, connection type), platform-core
(PLATFORM_TOKENS.PLATFORM_INFO.globalStoragePath), vscode-core (ILogger), shared. Write
exactly the Batch 3 files. Migration: follow 0041_skill_md_migration_state.ts and its
spec; append { version: 42, … } to MIGRATIONS and change nothing else in index.ts. Write
session-log.contract.ts as runSessionLogContract(factory) (style of
platform-core/src/testing/contracts) and run it for both adapters. Write CLAUDE.md. Apply
"Standards" (Zod on read only).
Verify: npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-session
@ptah-extension/persistence-sqlite. Report files, commands, results.
```

---

### Batch 4 — `agent-tools` + in-process `ptah_*` catalog extraction

Status: PENDING
**Depends on**: 1
**Recommended Executor**: `backend-developer`
**Execution Mode**: parallel (beside 3 and 5)

**Files created**

- `libs/backend/agent-tools/` scaffold set
- `libs/backend/agent-tools/src/lib/core/read.tool.ts`
- `libs/backend/agent-tools/src/lib/core/write.tool.ts`
- `libs/backend/agent-tools/src/lib/core/edit.tool.ts` + `edit.tool.concurrency.spec.ts`
- `libs/backend/agent-tools/src/lib/core/glob.tool.ts`
- `libs/backend/agent-tools/src/lib/core/grep.tool.ts`
- `libs/backend/agent-tools/src/lib/core/bash.tool.ts`
- `libs/backend/agent-tools/src/lib/core/workspace-path.ts`
- `libs/backend/agent-tools/src/lib/core/core-tools.spec.ts`
- `libs/backend/agent-tools/src/lib/ptah-tool-registry.adapter.ts` + `ptah-tool-registry.adapter.spec.ts`
- `libs/backend/agent-tools/src/lib/composite-tool-registry.ts` + `composite-tool-registry.spec.ts`
- `libs/backend/agent-tools/src/lib/di/register.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/ptah-tool-catalog.ts` + `ptah-tool-catalog.spec.ts`

**Files edited**

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (`handleToolsList` / `dispatchToolsCall` become envelope wrappers)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/index.ts` (export catalog)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts` (`createInProcessInvoker()`)
- `libs/backend/vscode-lm-tools/src/lib/di/register.ts` (register `PTAH_TOOL_INVOKER`)
- `libs/backend/vscode-lm-tools/src/index.ts`

**Acceptance**: P1-6 (`ptah-tool-catalog.spec.ts`), P1-16 tool half (`edit.tool.concurrency.spec.ts` with a minimal in-spec FIFO; the real `PathMutex` is B5).
Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-tools @ptah-extension/vscode-lm-tools`

**Definition of done**

- Six core tools implement `IAgentTool` with a Zod schema beside each tool and `inputSchema = z.toJSONSchema(schema)`; `write`/`edit` set `mutatesPath`; paths resolve against `ctx.workspaceRoot` and are rejected outside it; `bash` spawns with timeout, 64 KB cap and `ctx.signal` kill.
- `listPtahTools`/`callPtahTool` are the single source for the HTTP handler and the invoker; `callPtahTool` wraps `runWithMcpRequestContext({callerSessionId})`; the catalog spec shows `callPtahTool('ptah_ast_analyze', …)` deep-equals `handleMCPRequest(tools/call).result` and the stub `ptahAPI` saw the caller id.
- `PtahToolRegistryAdapter` resolves `PTAH_TOOL_INVOKER` with `isOptional: true` (absent → empty list + warning); `CompositeToolRegistry.definitions()` is name-sorted and rejects duplicates.
- `registerAgentTools` registers `AGENT_LOOP_TOKENS.TOOL_REGISTRY`; `vscode-lm-tools` gains no `import 'vscode'`; `protocol-dispatcher.spec.ts` still passes.

**Executor prompt**

```
Task folder: .ptah/specs/TASK_2026_362. Read implementation-plan.md sections 1, 2
(IAgentTool, IToolRegistry, IPtahToolInvoker, AgentToolContext, AgentToolResult), 6, 9, 11
and batches.md "Plan corrections" item 4, "Standards", "Lib scaffold set", "Batch 4".
Batch 1 is done. Part A: create libs/backend/agent-tools (alias @ptah-extension/agent-tools, tags
["scope:extension","type:feature"]). Allowed imports: agent-loop-contracts, platform-core
(FILE_SYSTEM_PROVIDER, WORKSPACE_PROVIDER), vscode-core, shared, zod, node:child_process,
node:path. Never import vscode-lm-tools.
Part B: in libs/backend/vscode-lm-tools extract mcp-core/ptah-tool-catalog.ts from
protocol-dispatcher.ts (handleToolsList body ~:257-345 → listPtahTools(deps);
dispatchToolsCall + handleIndividualTool ~:471-560 → callPtahTool(name, args, deps,
callerSessionId) returning the MCP result object). Keep handleToolsList/dispatchToolsCall
as thin envelope wrappers. Add CodeExecutionMCP.createInProcessInvoker(): IPtahToolInvoker
closing over the deps built at http-mcp-server.service.ts:352-366 (no start() needed).
In vscode-lm-tools di/register.ts register AGENT_LOOP_TOKENS.PTAH_TOOL_INVOKER with
useFactory c => c.resolve(TOKENS.CODE_EXECUTION_MCP).createInProcessInvoker(). Export the
catalog from mcp-core/index.ts and src/index.ts. Write exactly the Batch 4 files and
CLAUDE.md for agent-tools. Apply "Standards" (Zod at tool.parse only).
Verify: npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-tools
@ptah-extension/vscode-lm-tools. Report files, commands, results.
```

---

### Batch 5 — `agent-loop` (turn/step engine)

Status: PENDING
**Depends on**: 1
**Recommended Executor**: `backend-developer`
**Execution Mode**: parallel (beside 3 and 4)

**Files created**

- `libs/backend/agent-loop/` scaffold set
- `libs/backend/agent-loop/src/lib/agent-loop-engine.ts`
- `libs/backend/agent-loop/src/lib/step-runner.ts`
- `libs/backend/agent-loop/src/lib/tool-executor.ts`
- `libs/backend/agent-loop/src/lib/path-mutex.ts` + `path-mutex.spec.ts`
- `libs/backend/agent-loop/src/lib/inbox.ts` + `inbox.spec.ts`
- `libs/backend/agent-loop/src/lib/request-builder.ts`
- `libs/backend/agent-loop/src/lib/engine.replay.spec.ts`
- `libs/backend/agent-loop/src/lib/engine.max-steps.spec.ts`
- `libs/backend/agent-loop/src/lib/engine.resume-repair.spec.ts`
- `libs/backend/agent-loop/src/lib/engine.tool-turn.spec.ts`
- `libs/backend/agent-loop/src/lib/cache-prefix.spec.ts`
- `libs/backend/agent-loop/src/lib/di/register.ts`

**Files edited**: none

**Acceptance**: P1-7 engine half, P1-15, P1-16 mutex half, P1-17 engine half, P1-18, P1-5 engine half (denied tool → error result, denial text in the next request).
Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-loop`

**Definition of done**

- `AgentLoopEngine implements IAgentLoopEngine` with plan section 3 steps 4–8 and the failure table of section 8; every message in an `LlmRequest` was read from the log; repairs are appended as `tool_result{synthetic:true}` before the request.
- Tool calls run in parallel except colliding `mutatesPath` keys (`PathMutex` FIFO); `parse` failure and gate denial give `isError` results without execution.
- `model_changed`/`effort_changed` log `cache_reset`; system prompt and tool array are reused across requests (cache-prefix spec); max steps ends with `turn_end{reason:'max_steps'}`; abort logs `interrupt`.
- `registerAgentLoop` registers `AGENT_LOOP_TOKENS.ENGINE_FACTORY`; the lib imports no sibling lib.

**Executor prompt**

```
Task folder: .ptah/specs/TASK_2026_362. Read implementation-plan.md sections 2, 3 (steps
4-8), 4, 6 (PathMutex), 8, 11 (seams 1 and 4) and batches.md "Plan corrections" items 1,
2, 5, "B1 contract additions", "Standards", "Lib scaffold set", "Batch 5". Batch 1 is done:
import IAgentLoopEngine, IAgentLoopEngineFactory, AgentLoopSessionState, IInbox, LoopEvent,
ILlmStream, IToolRegistry, IToolPermissionGate, ISessionLog, deriveMessages, errors,
AGENT_LOOP_TOKENS and the src/testing fakes from @ptah-extension/agent-loop-contracts.
Create libs/backend/agent-loop (alias @ptah-extension/agent-loop, tags
["scope:extension","type:feature"]). Allowed imports: agent-loop-contracts, platform-core
(WORKSPACE_PROVIDER for MAX_STEPS), vscode-core, shared. Do not import agent-session,
agent-tools or llm-providers; resolve every collaborator by token. Write exactly the Batch 5
files. The engine yields LoopEvent only, never FlatStreamEventUnion. Keep a
beforeRequest(messages) seam for Phase 2 compaction. Specs use FakeLlmStream,
InMemorySessionLog, FakeToolRegistry, FakeToolPermissionGate. Write CLAUDE.md. Apply
"Standards" (no Zod inside the loop; engine + step-runner + tool-executor is the split).
Verify: npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-loop
Report files, commands, results.
```

---

### Batch 6 — `native-agent-adapter`

Status: PENDING
**Depends on**: 1, 5 (stream specs run the real engine)
**Recommended Executor**: `backend-developer`
**Execution Mode**: parallel (beside 2 and 7)

**Files created**

- `libs/backend/native-agent-adapter/` scaffold set
- `libs/backend/native-agent-adapter/src/lib/native-agent-adapter.ts` + `native-agent-adapter.contract.spec.ts`
- `libs/backend/native-agent-adapter/src/lib/session-record-registry.ts`
- `libs/backend/native-agent-adapter/src/lib/loop-event-mapper.ts` + `loop-event-mapper.spec.ts`
- `libs/backend/native-agent-adapter/src/lib/turn-state.ts`
- `libs/backend/native-agent-adapter/src/lib/callback-registry.ts`
- `libs/backend/native-agent-adapter/src/lib/prompt/system-prompt.ts` + `system-prompt.spec.ts`
- `libs/backend/native-agent-adapter/src/lib/streams/text-turn.spec.ts`
- `libs/backend/native-agent-adapter/src/lib/streams/tool-turn.spec.ts`
- `libs/backend/native-agent-adapter/src/lib/interrupt.spec.ts`
- `libs/backend/native-agent-adapter/src/lib/session-controls.spec.ts`
- `libs/backend/native-agent-adapter/src/lib/di/register.ts`

**Files edited**: none

**Acceptance**: P1-3, P1-4, P1-5 adapter half, P1-8, P1-9, P1-14, P1-15 (`terminalReason:'max_turns'`).
Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/native-agent-adapter @ptah-extension/agent-loop`

**Definition of done**

- `NativeAgentAdapter implements IAgentAdapter` per the plan section 2 table; `getCliJsPath()` is `null`; `preloadSdk()` resolves; `executeSlashCommand` throws the Phase 2 message.
- `loop-event-mapper.ts` produces the exact sequences (a)–(d) of plan section 3; the last event of every turn is `turn_state`; `ResultStatsCallback` fires once per turn.
- Session id is minted once at turn 0 and published through the stored `sessionIdResolved` callback before the first event; `system-prompt.spec.ts` counts under 2,000 tokens before the `CORE_PROMPT_APPENDIX` value.
- `registerNativeAgentAdapter` registers `AGENT_LOOP_TOKENS.NATIVE_AGENT_ADAPTER` (singleton); `CORE_PROMPT_APPENDIX` is resolved, never defined, here; production imports are contracts, platform-core, vscode-core, shared only.

**Executor prompt**

```
Task folder: .ptah/specs/TASK_2026_362. Read implementation-plan.md sections 0, 2 (the
NativeAgentAdapter method table), 3 (data flow, mapping table, sequences a-d), 8, 9, 11,
12 items 3-5 and batches.md "Plan corrections" items 2 and 6, "Standards", "Lib scaffold
set", "Batch 6". Batches 1 and 5 are done. Create libs/backend/native-agent-adapter
(alias @ptah-extension/native-agent-adapter, tags ["scope:extension","type:feature"]).
Production imports: @ptah-extension/agent-loop-contracts, platform-core (TOKEN_COUNTER,
WORKSPACE_PROVIDER), vscode-core (ILogger), shared (IAgentAdapter, FlatStreamEventUnion,
SessionId, ResultStatsPayload). Resolve every collaborator by token. Specs may import
registerAgentLoop from @ptah-extension/agent-loop to run the real engine against
FakeLlmStream. Read agent-sdk/src/lib/sdk-agent-adapter.ts:876-923, :1201-1221 and
helpers/session-turn-state.registry.ts:64-80 for event shapes; do not import agent-sdk. Write exactly the Batch 6 files and CLAUDE.md. Apply "Standards" (adapter +
mapper + record registry is the split; no re-validation of AgentSessionStartConfig).
Verify: npx nx run-many -t test,lint,typecheck -p @ptah-extension/native-agent-adapter
@ptah-extension/agent-loop. Report files, commands, results.
```

---

### Batch 7 — `agent-runtime` selector, permission gate, handler moves, resolver, settings

Status: PENDING
**Depends on**: 1. Precondition: TASK_2026_361 hunks in the three dirty files are committed or stashed by the user (Plan correction 8).
**Recommended Executor**: `backend-developer`
**Execution Mode**: parallel (beside 2 and 6)

**Files created**

- `libs/backend/agent-runtime/` scaffold set
- `libs/backend/agent-runtime/src/lib/agent-runtime-selector.ts` + `agent-runtime-selector.spec.ts`
- `libs/backend/agent-runtime/src/lib/runtime-settings.ts`
- `libs/backend/agent-runtime/src/lib/di/register.ts`
- `libs/backend/agent-sdk/src/lib/permission/sdk-tool-permission-gate.ts` + `sdk-tool-permission-gate.spec.ts`
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.runtime.spec.ts`
- `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.native.spec.ts`

**Files edited**

- `libs/backend/agent-sdk/src/lib/di/register.ts` (register `TOOL_PERMISSION_GATE`)
- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` (`SessionMetadata.runtime?`)
- `libs/backend/agent-sdk/src/index.ts` (export the gate)
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts` (`runtime` in `ChatStartParamsSchema`)
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (pass `runtime`; `{transport}` to resolver)
- `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts` (`:200,377,678` → `TOKENS.AGENT_ADAPTER`)
- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts` (`isSessionActive` → `TOKENS.AGENT_ADAPTER`; `session:list` copies `runtime`)
- `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts` (`options.transport`, `wireProtocol`)
- `libs/backend/platform-core/src/file-settings-keys.ts` (three keys + defaults)

**Acceptance**: P1-10 resolver half, P1-11, P1-12.
Verify: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-runtime @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/auth-providers @ptah-extension/platform-core` (header must say 5 projects).

**Definition of done**

- `AgentRuntimeSelector implements IAgentAdapter` with the resolution order and fan-out rules of plan section 5; it mirrors native `turn_state` into `SessionTurnStateRegistry` and writes `SessionMetadata.runtime` in its wrapped `sessionIdResolved` callback; `wireAgentRuntimeSelector` binds `TOKENS.AGENT_ADAPTER` → `AGENT_LOOP_TOKENS.AGENT_RUNTIME_SELECTOR`; `wireAgentAdapterAliases` stays exported.
- `SdkToolPermissionGate implements IToolPermissionGate` over `SdkPermissionHandler.createCallback(...)`, registered under `AGENT_LOOP_TOKENS.TOOL_PERMISSION_GATE` in `registerSdkServices`.
- Handler moves keep `SDK_AGENT_ADAPTER` for `getActiveSessionIds`, `forkSession`, `rewindFiles`, `getSupportedModels`, `getApiModels`; `auth-rpc`, `provider-rpc`, `chat-ptah-cli` untouched.
- Resolver spec asserts `ProviderProxyPool.acquire` is not called for `transport:'native'` and the profile carries `wireProtocol:'openai-completions'`; existing `agent-sdk` and `rpc-handlers` suites pass unchanged.

**Executor prompt**

```
Task folder: .ptah/specs/TASK_2026_362. Read implementation-plan.md sections 0 (handler
facts), 2 (IToolPermissionGate), 5, 7 (first bullet), 9, 11 and batches.md "Plan
corrections" items 5, 6, 8, 9, "Standards", "Lib scaffold set", "Batch 7". Batch 1 is
done: AgentRuntimeId, AgentRuntimeIdSchema, NATIVE_RUNTIME_SETTING_KEYS,
IToolPermissionGate and AGENT_LOOP_TOKENS come from @ptah-extension/agent-loop-contracts;
the runtime and wireProtocol fields exist in @ptah-extension/shared. Run git status first:
agent-sdk/src/lib/di/register.ts, agent-sdk/src/index.ts and
rpc-handlers/src/lib/handlers/session-rpc.handlers.ts may carry hunks from another task —
add your hunks beside them and never revert or reformat lines you did not write.
Create libs/backend/agent-runtime (alias @ptah-extension/agent-runtime, tags
["scope:extension","type:feature"]). Allowed imports: agent-loop-contracts, agent-sdk
(SDK_TOKENS, SessionMetadataStore, SessionTurnStateRegistry, SessionIdResolvedCallbackRegistry),
platform-core, vscode-core, shared. Resolve NATIVE_AGENT_ADAPTER by token typed
IAgentAdapter; do not import native-agent-adapter. Export registerAgentRuntime(container, logger) and
wireAgentRuntimeSelector(container). Make the "Files edited" changes exactly as plan
section 5 describes and write the four new specs (P1-10 resolver; P1-11 selector and
chat-session service with two adapter fakes; gate). Write CLAUDE.md. Apply "Standards"
(Zod at chat-rpc.schema.ts and AgentRuntimeIdSchema.catch('sdk') only; nothing in
package.json contributes.configuration).
Verify: npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-runtime
@ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/auth-providers
@ptah-extension/platform-core (header must report 5 projects). Report files, commands, results.
```

---

### Batch 8 — Composition roots, manifests, CLI flag, module index

Status: PENDING
**Depends on**: 2, 3, 4, 5, 6, 7
**Recommended Executor**: `backend-developer`
**Execution Mode**: sequential (alone)

**Files created**

- `libs/backend/cli-engine/src/lib/container.native-runtime.spec.ts` (optional; skip and say so if the CLI container cannot build under Jest without real adapters)

**Files edited**

- `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts` (`:191` → six `register*` calls + `wireAgentRuntimeSelector`; `CORE_PROMPT_APPENDIX` `useValue: PTAH_CORE_SYSTEM_PROMPT`)
- `apps/ptah-extension-vscode/src/di/expected-resolvable.ts` (add `NativeAgentAdapter`, `AgentRuntimeSelector`)
- `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts` (stubs listed in plan section 9)
- `apps/ptah-electron/src/di/phase-2-libraries.ts` (`:260`; `registerAgentSession` placed after `registerPersistenceSqliteServices` at `:310`)
- `apps/ptah-electron/src/di/expected-resolvable.ts`
- `apps/ptah-electron/src/di/container.smoke.spec.ts`
- `libs/backend/cli-engine/src/lib/container.ts` (`:692`; `registerAgentSession` after `registerThothLibraries`)
- `apps/ptah-cli/src/cli/commands/session.ts` (`runtime` in `buildParams()` at `:342`)
- `apps/ptah-cli/src/cli/router.ts` (`.option('--runtime <sdk|native>')` in the `session start` block at `:2341`)
- `CLAUDE.md` (root Module Index: seven backend-lib lines)

**Acceptance**: P1-13 (smoke specs resolve both classes; CLI registers the selector; manual `ptah session start --runtime native --task "say hi"` streams a reply), P1-12 regression.
Verify: `npx nx run-many -t test -p ptah-extension-vscode ptah-electron @ptah-extension/cli-engine`, then `npm run typecheck:all`, then `npx nx run-many -t lint -p ptah-extension-vscode ptah-electron ptah-cli @ptah-extension/cli-engine`.

**Definition of done**

- `wireAgentAdapterAliases(container)` is no longer called in the three roots; `wireAgentRuntimeSelector` runs after `registerSdkServices` and `registerVsCodeLmToolsServices`.
- `registerAgentSession` runs after any SQLite registration in Electron and CLI (the `isRegistered` guard sees the connection); VS Code falls back to JSONL.
- Both `EXPECTED_RESOLVABLE` lists include `NativeAgentAdapter` and `AgentRuntimeSelector`; both smoke specs pass.
- `ptah session start --runtime native` forwards `runtime` in `chat:start`; `--runtime` absent sends no field; root `CLAUDE.md` lists the seven libs.

**Executor prompt**

```
Task folder: .ptah/specs/TASK_2026_362. Read implementation-plan.md sections 5 (last two
bullets), 9, 11 and batches.md "Plan corrections" items 7 and 9, "Standards", "Batch 8".
Batches 1-7 are done; the register functions named in "Plan corrections" item 9 are
exported from their libs and take (container, logger). PTAH_CORE_SYSTEM_PROMPT is
exported by @ptah-extension/agent-sdk; register it in each root as
AGENT_LOOP_TOKENS.CORE_PROMPT_APPENDIX { useValue }. Edit exactly the Batch 8 files (the
smoke specs get the stub registrations plan section 9 lists). Keep phase-order comments
accurate. Then run the manual check: npm run cli:dev -- session start --runtime
native --task "say hi" (or the JSON-RPC equivalent) with an ANTHROPIC_API_KEY profile and
paste the first five stream events in your report. Apply "Standards" (apps may import
adapters; libs may not).
Verify: npx nx run-many -t test -p ptah-extension-vscode ptah-electron
@ptah-extension/cli-engine ; npm run typecheck:all ; npx nx run-many -t lint -p
ptah-extension-vscode ptah-electron ptah-cli @ptah-extension/cli-engine.
Report files, commands, results.
```

---

### Batch 9 — Verification gate

Status: PENDING
**Depends on**: 8
**Recommended Executor**: `senior-tester`
**Execution Mode**: sequential (alone)

**Files created**

- `.ptah/specs/TASK_2026_362/test-report.md`

**Files edited**: none (a spec gap is reported; the owning batch fixes it in a follow-up wave).

**Acceptance**: the full P1-1..P1-19 matrix of plan section 10.
Verify: `npx nx run-many -t test -p @ptah-extension/agent-loop-contracts @ptah-extension/llm-providers @ptah-extension/agent-loop @ptah-extension/agent-tools @ptah-extension/agent-session @ptah-extension/native-agent-adapter @ptah-extension/agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/auth-providers @ptah-extension/agent-sdk @ptah-extension/rpc-handlers` (header: 11 projects); `npx nx run-many -t lint -p` the seven new libs; `npm run typecheck:all`.

**Definition of done**

- `test-report.md` has one row per P1 criterion: spec file, command, pass/fail, evidence line.
- Grep evidence: zero `@ts-ignore`, zero `catch` without `: unknown`, zero `platform-*`/`agent-sdk` imports in the six native libs (`agent-runtime` may import `agent-sdk`).
- Any failing criterion names the owning batch and file so the team-leader can reopen it.

**Executor prompt**

```
Task folder: .ptah/specs/TASK_2026_362. Read task-description.md section 4 (Phase 1),
implementation-plan.md section 10 and batches.md "Batch 9". Batches 1-8 are done. Run the
three verification commands in Batch 9; confirm each run-many header reports the expected
project count (a misspelled name is dropped silently). For each P1 criterion open the spec
named in plan section 10, confirm its assertion matches the criterion text, and record
pass/fail with the evidence line. Run the P1-19 and hexagonal greps over the seven new
libs. Write only .ptah/specs/TASK_2026_362/test-report.md. If a criterion has no spec or a
weaker spec, name the owning batch; do not edit production code or specs. Do not commit.
```

---

## Execution schedule

Max 3 CLI agents concurrent. A wave starts when every batch of the previous wave is
COMPLETE (verified, reviewed where gated, committed).

| Wave | Batches    | Concurrent | Why this cut                                                                       |
| ---- | ---------- | ---------- | ---------------------------------------------------------------------------------- |
| 1    | B1         | 1          | Every other batch imports the contracts, aliases and pin.                          |
| 2    | B3, B4, B5 | 3          | Need only B1. B5 is on the critical path for B6, so it goes first.                 |
| 3    | B2, B6, B7 | 3          | B6 needs B5. B2 and B7 need only B1. B7 also needs the TASK_2026_361 precondition. |
| 4    | B8         | 1          | Needs the B2–B7 register functions.                                                |
| 5    | B9         | 1          | Gate over the whole Phase 1 matrix.                                                |

Code review gates before commit:

| Batch      | Gate                                          | Reason                                                                                                   |
| ---------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| B1         | `code-style-reviewer`                         | Contracts are the foundation of six libs; a wrong port shape costs every later batch.                    |
| B4         | `code-logic-reviewer`                         | The extraction inside `vscode-lm-tools` must not change HTTP MCP behavior; `bash` is a process boundary. |
| B5         | `code-logic-reviewer`                         | Engine invariant (model-visible means logged), abort paths, mutex.                                       |
| B6         | `code-logic-reviewer`                         | Event sequences are the frontend contract.                                                               |
| B7         | `code-logic-reviewer` + `code-style-reviewer` | Handler token moves and SDK regression risk; touches four existing libs.                                 |
| B8         | `code-style-reviewer`                         | Phase order in three composition roots and both manifests.                                               |
| B2, B3, B9 | none (verify + commit)                        | Self-contained libs with contract specs; B9 writes no code.                                              |

Commit rule: one commit per batch after its gate, staged by explicit path from the batch
file list. B7 is not committed while TASK_2026_361 hunks share its files (correction 8).
