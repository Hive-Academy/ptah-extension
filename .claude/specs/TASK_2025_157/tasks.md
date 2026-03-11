# Development Tasks - TASK_2025_157: Async Agent Orchestration Integration

**Total Tasks**: 21 | **Batches**: 5 | **Status**: 5/5 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- Branded type pattern (AgentId): Verified at `branded.types.ts:15-66`
- DI token pattern (Symbol.for): Verified at `tokens.ts:116-120`
- DI registration function: Verified at `register.ts:45-89`
- Namespace builder pattern: Verified at `orchestration-namespace.builder.ts`
- MCP tool builder pattern: Verified at `tool-description.builder.ts:83-93`
- Protocol handler switch routing: Verified at `protocol-handlers.ts:194-311`
- PtahAPIBuilder injectable service: Verified at `ptah-api-builder.service.ts:83-236`
- uuid v4 dependency: Verified in `branded.types.ts:7`

### Risks Identified

| Risk                                          | Severity | Mitigation                                                                      |
| --------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| CLI headless flags may differ across versions | MED      | Encapsulated in CliAdapter.buildCommand(); adapter can be updated independently |
| Windows process termination differs from Unix | MED      | killProcess() uses taskkill on Windows, SIGTERM+SIGKILL on Unix                 |
| Shell injection via task descriptions         | HIGH     | sanitizeTask() strips backticks and $() patterns                                |
| Memory leak from output buffers               | LOW      | Rolling buffer with 1MB limit, trimming at newline boundaries                   |
| TrackedAgent.info is readonly but reassigned  | LOW      | Uses spread operator to create new object on status change                      |

### Edge Cases to Handle

- [x] No CLIs installed -> descriptive error with install instructions
- [x] Max concurrent agents reached -> clear error with running agent IDs
- [x] Agent timeout -> SIGTERM then SIGKILL after grace period
- [x] Extension deactivation -> shutdownAll() terminates all running agents
- [x] Working directory outside workspace -> validation error
- [x] Output buffer overflow -> rolling buffer with truncation flag

---

## Batch 1: Foundation (Types, Interfaces, DI Tokens) - COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None
**Commit**: 12718895

### Task 1.1: Create agent-process.types.ts - COMPLETE

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\agent-process.types.ts
**Action**: CREATE
**Spec Reference**: implementation-plan.md: File 1.1

Create the branded AgentId type and all agent process types. Follows the branded type pattern from `branded.types.ts:15-66`.

Types to create:

- `AgentId` branded type with `create()`, `validate()`, `from()` smart constructors
- `AgentStatus` type: `'running' | 'completed' | 'failed' | 'timeout' | 'stopped'`
- `CliType` type: `'gemini' | 'codex'`
- `AgentProcessInfo` interface (agentId, cli, task, workingDirectory, taskFolder?, status, startedAt, exitCode?, pid?)
- `SpawnAgentRequest` interface (task, cli?, workingDirectory?, timeout?, files?, taskFolder?)
- `AgentOutput` interface (agentId, stdout, stderr, lineCount, truncated)
- `SpawnAgentResult` interface (agentId, cli, status, startedAt)
- `CliDetectionResult` interface (cli, installed, path?, version?, supportsSteer)

Full implementation is provided in implementation-plan.md File 1.1.

---

### Task 1.2: Export agent-process types from shared index - COMPLETE

**File**: D:\projects\ptah-extension\libs\shared\src\index.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: File 1.2

Add barrel export for the new agent-process types file. Add after the existing exports:

```typescript
export * from './lib/types/agent-process.types';
```

---

### Task 1.3: Add DI tokens for Agent Orchestration - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: File 1.3

Add two new DI tokens after the `LLM_RPC_HANDLERS` token (around line 120):

```typescript
// ========================================
// Agent Orchestration Tokens (TASK_2025_157)
// ========================================
export const AGENT_PROCESS_MANAGER = Symbol.for('AgentProcessManager');
export const CLI_DETECTION_SERVICE = Symbol.for('CliDetectionService');
```

Add to the TOKENS const object (after LLM_RPC_HANDLERS around line 361):

```typescript
  // Agent Orchestration (TASK_2025_157)
  AGENT_PROCESS_MANAGER,
  CLI_DETECTION_SERVICE,
```

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build shared && npx nx build vscode-core`
- code-logic-reviewer approved
- No stubs, placeholders, or TODOs

---

## Batch 2: Core Services (CLI Adapters, Detection, Process Manager) - COMPLETE

**Developer**: backend-developer
**Tasks**: 8 | **Dependencies**: Batch 1
**Commit**: defed016

### Task 2.1: Create CliAdapter interface - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\cli-adapter.interface.ts
**Action**: CREATE
**Spec Reference**: implementation-plan.md: File 2.1

Create the extensible CLI adapter interface with:

- `CliCommandOptions` interface (task, workingDirectory, files?, taskFolder?)
- `CliCommand` interface (binary, args, env?)
- `CliAdapter` interface with methods: detect(), buildCommand(), supportsSteer(), parseOutput()

Full implementation in implementation-plan.md File 2.1.

---

### Task 2.2: Create GeminiCliAdapter - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\gemini-cli.adapter.ts
**Action**: CREATE
**Spec Reference**: implementation-plan.md: File 2.2

Gemini CLI adapter implementing headless invocation via `gemini -p "task"`.
Includes:

- detect() using which/where + version check
- buildCommand() with -p flag for non-interactive prompt
- supportsSteer() returns false
- parseOutput() strips ANSI codes
- stripAnsiCodes() helper function

Full implementation in implementation-plan.md File 2.2.

---

### Task 2.3: Create CodexCliAdapter - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\codex-cli.adapter.ts
**Action**: CREATE
**Spec Reference**: implementation-plan.md: File 2.3

Codex CLI adapter implementing headless invocation via `codex --quiet "task"`.
Includes:

- detect() using which/where + version check
- buildCommand() with --quiet flag
- supportsSteer() returns false
- parseOutput() strips ANSI codes

Full implementation in implementation-plan.md File 2.3.

---

### Task 2.4: Create CLI adapters barrel export - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\index.ts
**Action**: CREATE
**Spec Reference**: implementation-plan.md: File 2.4

Barrel export for CLI adapters:

```typescript
export type { CliAdapter, CliCommand, CliCommandOptions } from './cli-adapter.interface';
export { GeminiCliAdapter } from './gemini-cli.adapter';
export { CodexCliAdapter } from './codex-cli.adapter';
```

---

### Task 2.5: Create CliDetectionService - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-detection.service.ts
**Action**: CREATE
**Spec Reference**: implementation-plan.md: File 2.5

Injectable singleton service that:

- Registers built-in adapters (GeminiCliAdapter, CodexCliAdapter) in constructor
- detectAll() runs all adapters and caches results
- getDetection(cli) returns result for specific CLI
- getInstalledClis() returns only installed CLIs
- getAdapter(cli) returns adapter instance
- invalidateCache() forces re-detection

Uses @inject(TOKENS.LOGGER) for logging. Full implementation in implementation-plan.md File 2.5.

---

### Task 2.6: Create AgentProcessManager - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts
**Action**: CREATE
**Spec Reference**: implementation-plan.md: File 2.6

Core process management service (largest file in this task). Injectable singleton that:

- spawn(request) - spawns CLI agent child processes with concurrent limit check, CLI detection, command building, output capture, timeout handling
- getStatus(agentId?) - returns agent info for one or all agents
- readOutput(agentId, tail?) - reads output through adapter parseOutput, supports tail
- steer(agentId, instruction) - writes to stdin if CLI supports it
- stop(agentId) - graceful SIGTERM then SIGKILL after 5s
- shutdownAll() - terminates all running agents

Private helpers: appendBuffer (rolling 1MB), handleTimeout, handleExit, killProcess (cross-platform), getRunningCount, getMaxConcurrentAgents (VS Code config), getDefaultCli, getWorkspaceRoot, validateWorkingDirectory, sanitizeTask, tailLines.

Full implementation in implementation-plan.md File 2.6.

---

### Task 2.7: Export new services from llm-abstraction index - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\index.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: File 2.7

Add after existing exports (around line 63):

```typescript
// ========================================
// Agent Orchestration (TASK_2025_157)
// ========================================
export { CliDetectionService } from './lib/services/cli-detection.service';
export { AgentProcessManager } from './lib/services/agent-process-manager.service';
export type { CliAdapter, CliCommand, CliCommandOptions } from './lib/services/cli-adapters';
```

---

### Task 2.8: Register services in DI container - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\di\register.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: File 2.8

Add imports for CliDetectionService and AgentProcessManager. Add registrations after LlmService (after line 79):

```typescript
// 5. CliDetectionService - needs LOGGER
container.registerSingleton(TOKENS.CLI_DETECTION_SERVICE, CliDetectionService);

// 6. AgentProcessManager - needs LOGGER, CLI_DETECTION_SERVICE
container.registerSingleton(TOKENS.AGENT_PROCESS_MANAGER, AgentProcessManager);
```

Update services log array to include new services.

---

**Batch 2 Verification**:

- All files exist at paths
- Build passes: `npx nx build llm-abstraction`
- code-logic-reviewer approved
- No stubs, placeholders, or TODOs

---

## Batch 3: MCP Tools (Tool Builders, Protocol Handlers, Agent Namespace) - COMPLETE

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 2
**Commit**: a9eac76c

### Task 3.1: Add AgentNamespace to types.ts and PtahAPI interface - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: File 3.1

Add imports for shared agent types. Add AgentNamespace interface with spawn, status, read, steer, stop, list, waitFor methods. Add `agent: AgentNamespace` to PtahAPI interface after orchestration property.

Full interface definition in implementation-plan.md File 3.1.

---

### Task 3.2: Create agent-namespace.builder.ts - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts
**Action**: CREATE
**Spec Reference**: implementation-plan.md: File 3.2

Build the ptah.agent namespace. Includes:

- AgentNamespaceDependencies interface (agentProcessManager, cliDetectionService)
- buildAgentNamespace(deps) function returning AgentNamespace
- All 7 methods: spawn, status, read, steer, stop, list, waitFor
- waitFor uses polling with configurable interval and timeout

Full implementation in implementation-plan.md File 3.2.

---

### Task 3.3: Export agent namespace builder from index - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\index.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: File 3.3

Add at end of file:

```typescript
// Agent namespace (TASK_2025_157 - async agent orchestration)
export { buildAgentNamespace, type AgentNamespaceDependencies } from './agent-namespace.builder';
```

---

### Task 3.4: Add 5 agent tool builder functions - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\tool-description.builder.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: File 3.4

Add 5 tool builder functions:

- buildAgentSpawnTool() - spawn a CLI agent
- buildAgentStatusTool() - check agent status
- buildAgentReadTool() - read agent output
- buildAgentSteerTool() - steer agent via stdin
- buildAgentStopTool() - stop a running agent

Each returns MCPToolDefinition with name, description, and inputSchema. Full implementations in implementation-plan.md File 3.4.

---

### Task 3.5: Add agent tool handlers to protocol-handlers.ts - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: File 3.5

Add imports for the 5 agent tool builders. Add 5 agent tools to handleToolsList array. Add 5 case handlers in handleIndividualTool switch block:

- ptah_agent_spawn -> ptahAPI.agent.spawn(args)
- ptah_agent_status -> ptahAPI.agent.status(agentId)
- ptah_agent_read -> ptahAPI.agent.read(agentId, tail)
- ptah_agent_steer -> ptahAPI.agent.steer(agentId, instruction)
- ptah_agent_stop -> ptahAPI.agent.stop(agentId)

Full handler implementations in implementation-plan.md File 3.5.

---

**Batch 3 Verification**:

- All files exist at paths
- Build passes: `npx nx build vscode-lm-tools`
- code-logic-reviewer approved
- No stubs, placeholders, or TODOs

---

## Batch 4: Integration (API Builder, System Prompt, Help Docs) - COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 3
**Commit**: 9b96f184

### Task 4.1: Wire agent namespace into PtahAPIBuilder - COMPLETE (committed with Batch 3)

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: File 4.1

Add imports for AgentProcessManager, CliDetectionService, buildAgentNamespace. Add constructor parameters with @inject decorators. Add agentDeps construction in build(). Add `agent: buildAgentNamespace(agentDeps)` to return object. Update namespace count log to 16.

---

### Task 4.2: Update system prompt with agent orchestration section - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-system-prompt.constant.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: File 4.2

Add "Multi-Agent Delegation - Fire-and-Check Pattern" section to PTAH_SYSTEM_PROMPT. Includes when to delegate, agent tools table, and workflow example (spawn, continue, check, read, use).

---

### Task 4.3: Add agent help docs to system-namespace.builders.ts - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\system-namespace.builders.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: File 4.3

Add `agent` entry to HELP_DOCS record with full documentation for all agent methods (spawn, status, read, steer, stop, list, waitFor). Also update the `overview` help doc to include "AGENT: ptah.agent.\*" namespace.

---

### Task 4.4: Update execute_code tool description with agent namespace - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\tool-description.builder.ts
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: File 4.4

Update buildExecuteCodeDescription() to mention agent namespace. Add in "Other Namespaces" section:

```
- ptah.agent.* - CLI agent orchestration (spawn, monitor, steer Gemini/Codex)
```

---

**Batch 4 Verification**:

- All files exist at paths
- Build passes: `npx nx build vscode-lm-tools`
- code-logic-reviewer approved
- No stubs, placeholders, or TODOs

---

## Batch 5: VS Code Settings - COMPLETE

**Developer**: backend-developer
**Tasks**: 1 | **Dependencies**: Batch 4
**Commit**: 87527cf0

### Task 5.1: Add VS Code settings for agent orchestration - COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: File 5.1

Add to `contributes.configuration.properties`:

- `ptah.agentOrchestration.defaultCli` - enum: ["gemini", "codex"], default: "gemini"
- `ptah.agentOrchestration.maxConcurrentAgents` - number, default: 3, min: 1, max: 10
- `ptah.agentOrchestration.defaultTimeout` - number, default: 600000, min: 60000, max: 1800000

---

**Batch 5 Verification**:

- package.json is valid JSON
- Build passes: `npx nx build ptah-extension-vscode`
- code-logic-reviewer approved

---
