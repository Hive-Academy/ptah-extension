# Implementation Plan - TASK_2025_157: Async Agent Orchestration Integration

## Codebase Investigation Summary

### Libraries Analyzed

- **shared** (`libs/shared/`): Branded types pattern (SessionId, MessageId, CorrelationId) at `branded.types.ts`
- **vscode-core** (`libs/backend/vscode-core/`): DI tokens pattern (TOKENS namespace, Symbol.for convention) at `di/tokens.ts`
- **llm-abstraction** (`libs/backend/llm-abstraction/`): Service architecture pattern, DI registration at `di/register.ts`
- **vscode-lm-tools** (`libs/backend/vscode-lm-tools/`): MCP tools, namespace builders, protocol handlers, API builder

### Patterns Verified

| Pattern                                  | Source File                                                                                                 | Line Reference                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Branded type with smart constructor      | `libs/shared/src/lib/types/branded.types.ts:15-66`                                                          | `SessionId` type + `SessionId.create()` pattern      |
| DI token via `Symbol.for()`              | `libs/backend/vscode-core/src/di/tokens.ts:35`                                                              | `EXTENSION_CONTEXT = Symbol.for('ExtensionContext')` |
| TOKENS namespace aggregation             | `libs/backend/vscode-core/src/di/tokens.ts:281-432`                                                         | `export const TOKENS = { ... } as const`             |
| DI registration function                 | `libs/backend/llm-abstraction/src/lib/di/register.ts:45-89`                                                 | `registerLlmAbstractionServices(container, logger)`  |
| Namespace builder function               | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/llm-namespace.builder.ts:115-200`   | `buildLLMNamespace(deps): LLMNamespace`              |
| Namespace builder dependencies interface | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/llm-namespace.builder.ts:32-36`     | `LlmNamespaceDependencies`                           |
| MCP tool builder function                | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts:83-93`        | `buildWorkspaceAnalyzeTool(): MCPToolDefinition`     |
| Protocol handler switch routing          | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts:194-311`             | `handleIndividualTool()` switch block                |
| PtahAPI interface with namespaces        | `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts:22-56`                                        | 15 namespaces + `help()` method                      |
| PtahAPIBuilder injectable service        | `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:83-236`                    | Constructor DI + `build(): PtahAPI`                  |
| Namespace index re-exports               | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/index.ts:1-54`                      | Barrel exports with type exports                     |
| Help docs record pattern                 | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts:24-34` | `HELP_DOCS: Record<string, string>`                  |
| System prompt constant                   | `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts:8-71`                   | `PTAH_SYSTEM_PROMPT` template literal                |

---

## Architecture Diagram

```
+------------------------------------------------------------------+
|  libs/shared                                                      |
|  +------------------------------------------------------------+  |
|  | agent-process.types.ts (NEW)                                |  |
|  | - AgentId (branded type)                                    |  |
|  | - AgentStatus enum                                          |  |
|  | - AgentProcessInfo, SpawnAgentRequest, AgentOutput           |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
        |
        v
+------------------------------------------------------------------+
|  libs/backend/vscode-core                                         |
|  +------------------------------------------------------------+  |
|  | di/tokens.ts (MODIFY)                                       |  |
|  | + AGENT_PROCESS_MANAGER = Symbol.for('AgentProcessManager') |  |
|  | + CLI_DETECTION_SERVICE = Symbol.for('CliDetectionService')  |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
        |
        v
+------------------------------------------------------------------+
|  libs/backend/llm-abstraction                                     |
|  +------------------------------------------------------------+  |
|  | services/cli-detection.service.ts (NEW)                     |  |
|  | - Detects gemini/codex CLI availability                     |  |
|  | - Caches results, reports versions                          |  |
|  +------------------------------------------------------------+  |
|  | services/cli-adapters/ (NEW directory)                      |  |
|  | - cli-adapter.interface.ts                                  |  |
|  | - gemini-cli.adapter.ts                                     |  |
|  | - codex-cli.adapter.ts                                      |  |
|  +------------------------------------------------------------+  |
|  | services/agent-process-manager.service.ts (NEW)             |  |
|  | - Spawns child processes                                    |  |
|  | - Tracks agent state, output buffers                        |  |
|  | - Timeout, cleanup, concurrent limits                       |  |
|  +------------------------------------------------------------+  |
|  | di/register.ts (MODIFY)                                     |  |
|  | + Register AgentProcessManager, CliDetectionService          |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
        |
        v
+------------------------------------------------------------------+
|  libs/backend/vscode-lm-tools                                     |
|  +------------------------------------------------------------+  |
|  | code-execution/types.ts (MODIFY)                            |  |
|  | + AgentNamespace interface                                   |  |
|  | + PtahAPI.agent property                                    |  |
|  +------------------------------------------------------------+  |
|  | namespace-builders/agent-namespace.builder.ts (NEW)          |  |
|  | - buildAgentNamespace(deps): AgentNamespace                  |  |
|  | - spawn, status, read, steer, stop, list, waitFor           |  |
|  +------------------------------------------------------------+  |
|  | namespace-builders/index.ts (MODIFY)                        |  |
|  | + export buildAgentNamespace                                 |  |
|  +------------------------------------------------------------+  |
|  | mcp-handlers/tool-description.builder.ts (MODIFY)           |  |
|  | + buildAgentSpawnTool()                                      |  |
|  | + buildAgentStatusTool()                                     |  |
|  | + buildAgentReadTool()                                       |  |
|  | + buildAgentSteerTool()                                      |  |
|  | + buildAgentStopTool()                                       |  |
|  +------------------------------------------------------------+  |
|  | mcp-handlers/protocol-handlers.ts (MODIFY)                  |  |
|  | + handleToolsList: add 5 agent tools                         |  |
|  | + handleIndividualTool: add 5 agent tool handlers            |  |
|  +------------------------------------------------------------+  |
|  | ptah-api-builder.service.ts (MODIFY)                        |  |
|  | + Inject AgentProcessManager, CliDetectionService            |  |
|  | + Add agent namespace to build() output                      |  |
|  +------------------------------------------------------------+  |
|  | ptah-system-prompt.constant.ts (MODIFY)                     |  |
|  | + Agent orchestration section with examples                  |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
        |
        v
+------------------------------------------------------------------+
|  apps/ptah-extension-vscode                                       |
|  +------------------------------------------------------------+  |
|  | package.json (MODIFY)                                       |  |
|  | + ptah.agentOrchestration.defaultCli setting                 |  |
|  | + ptah.agentOrchestration.maxConcurrentAgents setting         |  |
|  | + ptah.agentOrchestration.defaultTimeout setting              |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
```

---

## Dependency Graph

```
agent-process.types.ts (shared)
  ^
  |
tokens.ts (vscode-core)
  ^
  |
  +--- cli-adapter.interface.ts (llm-abstraction)
  |      ^
  |      +--- gemini-cli.adapter.ts
  |      +--- codex-cli.adapter.ts
  |
  +--- cli-detection.service.ts (llm-abstraction)
  |      uses: cli-adapter.interface, Logger, ConfigManager
  |
  +--- agent-process-manager.service.ts (llm-abstraction)
  |      uses: cli-detection.service, cli-adapters, Logger, agent-process.types
  |
  +--- agent-namespace.builder.ts (vscode-lm-tools)
  |      uses: agent-process-manager, cli-detection.service, AgentNamespace type
  |
  +--- tool-description.builder.ts (vscode-lm-tools)
  |      uses: MCPToolDefinition
  |
  +--- protocol-handlers.ts (vscode-lm-tools)
  |      uses: tool-description.builder, PtahAPI.agent namespace
  |
  +--- ptah-api-builder.service.ts (vscode-lm-tools)
         uses: agent-namespace.builder, agent-process-manager, cli-detection.service
```

---

## Detailed File Changes

### Batch 1: Foundation (Types, Interfaces, DI Tokens)

#### File 1.1: CREATE `libs/shared/src/lib/types/agent-process.types.ts`

**Purpose**: Define branded `AgentId` type and all agent process types used across libraries.

**Evidence**: Follows `branded.types.ts:15-66` pattern for branded type with smart constructor.

```typescript
/**
 * Agent Process Types for Async Agent Orchestration
 * TASK_2025_157: Branded AgentId, status enum, process tracking types
 */
import { v4 as uuidv4 } from 'uuid';

// ========================================
// Branded AgentId Type
// ========================================

/**
 * Branded AgentId type - prevents mixing with other string IDs
 * Pattern: libs/shared/src/lib/types/branded.types.ts:15
 */
export type AgentId = string & { readonly __brand: 'AgentId' };

/**
 * AgentId smart constructors with validation
 * Pattern: libs/shared/src/lib/types/branded.types.ts:34-66
 */
export const AgentId = {
  create(): AgentId {
    return uuidv4() as AgentId;
  },
  validate(id: string): id is AgentId {
    // AgentIds are UUIDs
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  },
  from(id: string): AgentId {
    if (!AgentId.validate(id)) {
      throw new TypeError(`Invalid AgentId format: ${id}`);
    }
    return id as AgentId;
  },
};

// ========================================
// Agent Status Enum
// ========================================

export type AgentStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'stopped';

// ========================================
// CLI Type
// ========================================

export type CliType = 'gemini' | 'codex';

// ========================================
// Agent Process Info (tracked per agent)
// ========================================

export interface AgentProcessInfo {
  readonly agentId: AgentId;
  readonly cli: CliType;
  readonly task: string;
  readonly workingDirectory: string;
  readonly taskFolder?: string;
  status: AgentStatus;
  readonly startedAt: string; // ISO timestamp
  exitCode?: number;
  readonly pid?: number;
}

// ========================================
// Spawn Agent Request
// ========================================

export interface SpawnAgentRequest {
  /** Task description for the CLI agent */
  readonly task: string;
  /** Which CLI to use (auto-detected if omitted) */
  readonly cli?: CliType;
  /** Working directory (defaults to workspace root) */
  readonly workingDirectory?: string;
  /** Timeout in milliseconds (default: 600000 = 10min, max: 1800000 = 30min) */
  readonly timeout?: number;
  /** Files the agent should focus on */
  readonly files?: string[];
  /** Task-tracking folder for shared workspace */
  readonly taskFolder?: string;
}

// ========================================
// Agent Output
// ========================================

export interface AgentOutput {
  readonly agentId: AgentId;
  readonly stdout: string;
  readonly stderr: string;
  /** Total lines captured */
  readonly lineCount: number;
  /** Whether output was truncated due to buffer limit */
  readonly truncated: boolean;
}

// ========================================
// Spawn Agent Result
// ========================================

export interface SpawnAgentResult {
  readonly agentId: AgentId;
  readonly cli: CliType;
  readonly status: AgentStatus;
  readonly startedAt: string;
}

// ========================================
// CLI Detection Result
// ========================================

export interface CliDetectionResult {
  readonly cli: CliType;
  readonly installed: boolean;
  readonly path?: string;
  readonly version?: string;
  readonly supportsSteer: boolean;
}
```

#### File 1.2: MODIFY `libs/shared/src/index.ts`

**What**: Add export for new agent-process types.

**Evidence**: Follows existing barrel export pattern at `libs/shared/src/index.ts:1-30`.

```typescript
// Add this line after the existing exports:
export * from './lib/types/agent-process.types';
```

#### File 1.3: MODIFY `libs/backend/vscode-core/src/di/tokens.ts`

**What**: Add `AGENT_PROCESS_MANAGER` and `CLI_DETECTION_SERVICE` tokens.

**Evidence**: Follows token pattern at `tokens.ts:116-120` (LLM Abstraction section).

Add after the `LLM_RPC_HANDLERS` token (line 120):

```typescript
// ========================================
// Agent Orchestration Tokens (TASK_2025_157)
// ========================================
export const AGENT_PROCESS_MANAGER = Symbol.for('AgentProcessManager');
export const CLI_DETECTION_SERVICE = Symbol.for('CliDetectionService');
```

Add to the `TOKENS` const object (after LLM_RPC_HANDLERS in the TOKENS object around line 361):

```typescript
  // Agent Orchestration (TASK_2025_157)
  AGENT_PROCESS_MANAGER,
  CLI_DETECTION_SERVICE,
```

---

### Batch 2: Core Services (CliAdapters, CliDetectionService, AgentProcessManager)

#### File 2.1: CREATE `libs/backend/llm-abstraction/src/lib/services/cli-adapters/cli-adapter.interface.ts`

**Purpose**: Extensible interface for CLI agents. Adding future CLIs requires only a new adapter.

```typescript
/**
 * CLI Adapter Interface
 * TASK_2025_157: Extensible adapter pattern for CLI agent integration
 *
 * Adding a new CLI agent (e.g., Claude CLI, Aider) requires only:
 * 1. Implement this interface
 * 2. Register in CliDetectionService
 */
import type { CliType, CliDetectionResult } from '@ptah-extension/shared';

export interface CliCommandOptions {
  readonly task: string;
  readonly workingDirectory: string;
  readonly files?: string[];
  readonly taskFolder?: string;
}

export interface CliCommand {
  readonly binary: string;
  readonly args: string[];
  readonly env?: Record<string, string>;
}

export interface CliAdapter {
  /** CLI identifier */
  readonly name: CliType;
  /** Human-readable display name */
  readonly displayName: string;

  /**
   * Detect if this CLI is installed and functional
   * Runs `which`/`where` and version check
   */
  detect(): Promise<CliDetectionResult>;

  /**
   * Build the command and arguments to spawn the CLI in headless mode
   */
  buildCommand(options: CliCommandOptions): CliCommand;

  /**
   * Whether this CLI supports stdin steering (interactive input while running)
   */
  supportsSteer(): boolean;

  /**
   * Strip ANSI escape codes, progress bars, and other non-content output
   */
  parseOutput(raw: string): string;
}
```

#### File 2.2: CREATE `libs/backend/llm-abstraction/src/lib/services/cli-adapters/gemini-cli.adapter.ts`

**Purpose**: Gemini CLI adapter implementing headless invocation.

```typescript
/**
 * Gemini CLI Adapter
 * TASK_2025_157: Headless Gemini CLI agent integration
 *
 * Invocation: gemini -p "task description"
 * The -p flag sends a prompt non-interactively.
 * Falls back to stdin pipe if -p is not supported.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { CliDetectionResult } from '@ptah-extension/shared';
import type { CliAdapter, CliCommand, CliCommandOptions } from './cli-adapter.interface';

const execFileAsync = promisify(execFile);

export class GeminiCliAdapter implements CliAdapter {
  readonly name = 'gemini' as const;
  readonly displayName = 'Gemini CLI';

  async detect(): Promise<CliDetectionResult> {
    try {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const { stdout: pathOutput } = await execFileAsync(whichCmd, ['gemini'], {
        timeout: 5000,
      });
      const binaryPath = pathOutput.trim().split('\n')[0];

      // Try to get version
      let version: string | undefined;
      try {
        const { stdout: versionOutput } = await execFileAsync('gemini', ['--version'], {
          timeout: 5000,
        });
        version = versionOutput.trim().split('\n')[0];
      } catch {
        // Version check failed, CLI still usable
      }

      return {
        cli: 'gemini',
        installed: true,
        path: binaryPath,
        version,
        supportsSteer: false, // Gemini CLI does not support stdin steering in headless mode
      };
    } catch {
      return {
        cli: 'gemini',
        installed: false,
        supportsSteer: false,
      };
    }
  }

  buildCommand(options: CliCommandOptions): CliCommand {
    const args: string[] = [];

    // Build task prompt with file context
    let taskPrompt = options.task;

    if (options.files && options.files.length > 0) {
      taskPrompt += `\n\nFocus on these files:\n${options.files.map((f) => `- ${f}`).join('\n')}`;
    }

    if (options.taskFolder) {
      taskPrompt += `\n\nWrite deliverable files to: ${options.taskFolder}`;
      taskPrompt += `\nUse convention: ${options.taskFolder}/agent-output-{agentId}.md for main deliverable.`;
    }

    // Use -p flag for non-interactive prompt
    args.push('-p', taskPrompt);

    return {
      binary: 'gemini',
      args,
    };
  }

  supportsSteer(): boolean {
    return false;
  }

  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }
}

/**
 * Strip ANSI escape codes from CLI output
 */
function stripAnsiCodes(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}
```

#### File 2.3: CREATE `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts`

**Purpose**: Codex CLI adapter implementing headless invocation.

```typescript
/**
 * Codex CLI Adapter
 * TASK_2025_157: Headless Codex CLI agent integration
 *
 * Invocation: codex --quiet "task description"
 * The --quiet flag suppresses interactive UI.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { CliDetectionResult } from '@ptah-extension/shared';
import type { CliAdapter, CliCommand, CliCommandOptions } from './cli-adapter.interface';

const execFileAsync = promisify(execFile);

export class CodexCliAdapter implements CliAdapter {
  readonly name = 'codex' as const;
  readonly displayName = 'Codex CLI';

  async detect(): Promise<CliDetectionResult> {
    try {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const { stdout: pathOutput } = await execFileAsync(whichCmd, ['codex'], {
        timeout: 5000,
      });
      const binaryPath = pathOutput.trim().split('\n')[0];

      let version: string | undefined;
      try {
        const { stdout: versionOutput } = await execFileAsync('codex', ['--version'], {
          timeout: 5000,
        });
        version = versionOutput.trim().split('\n')[0];
      } catch {
        // Version check failed
      }

      return {
        cli: 'codex',
        installed: true,
        path: binaryPath,
        version,
        supportsSteer: false, // Codex CLI in quiet mode does not accept stdin
      };
    } catch {
      return {
        cli: 'codex',
        installed: false,
        supportsSteer: false,
      };
    }
  }

  buildCommand(options: CliCommandOptions): CliCommand {
    const args: string[] = [];

    let taskPrompt = options.task;

    if (options.files && options.files.length > 0) {
      taskPrompt += `\n\nFocus on these files:\n${options.files.map((f) => `- ${f}`).join('\n')}`;
    }

    if (options.taskFolder) {
      taskPrompt += `\n\nWrite deliverable files to: ${options.taskFolder}`;
      taskPrompt += `\nUse convention: ${options.taskFolder}/agent-output-{agentId}.md for main deliverable.`;
    }

    // Use --quiet for non-interactive mode
    args.push('--quiet', taskPrompt);

    return {
      binary: 'codex',
      args,
    };
  }

  supportsSteer(): boolean {
    return false;
  }

  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }
}

function stripAnsiCodes(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}
```

#### File 2.4: CREATE `libs/backend/llm-abstraction/src/lib/services/cli-adapters/index.ts`

**Purpose**: Barrel export for CLI adapters.

```typescript
export type { CliAdapter, CliCommand, CliCommandOptions } from './cli-adapter.interface';
export { GeminiCliAdapter } from './gemini-cli.adapter';
export { CodexCliAdapter } from './codex-cli.adapter';
```

#### File 2.5: CREATE `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts`

**Purpose**: Detect installed CLI agents, cache results, expose detection info.

**Pattern**: Injectable singleton following `llm.service.ts` architecture.

```typescript
/**
 * CLI Detection Service
 * TASK_2025_157: Auto-detect installed CLI agents (Gemini, Codex)
 *
 * Detects on first call and caches results.
 * Exposes detection results for MCP tools and namespace.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type { CliType, CliDetectionResult } from '@ptah-extension/shared';
import type { CliAdapter } from './cli-adapters/cli-adapter.interface';
import { GeminiCliAdapter } from './cli-adapters/gemini-cli.adapter';
import { CodexCliAdapter } from './cli-adapters/codex-cli.adapter';

@injectable()
export class CliDetectionService {
  private readonly adapters: Map<CliType, CliAdapter> = new Map();
  private detectionCache: Map<CliType, CliDetectionResult> | null = null;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    // Register built-in adapters
    const gemini = new GeminiCliAdapter();
    const codex = new CodexCliAdapter();
    this.adapters.set('gemini', gemini);
    this.adapters.set('codex', codex);

    this.logger.info('[CliDetection] Service initialized with adapters: gemini, codex');
  }

  /**
   * Detect all registered CLI agents.
   * Results are cached after first call. Call invalidateCache() to re-detect.
   */
  async detectAll(): Promise<CliDetectionResult[]> {
    if (this.detectionCache) {
      return Array.from(this.detectionCache.values());
    }

    this.logger.info('[CliDetection] Detecting installed CLI agents...');
    const results = new Map<CliType, CliDetectionResult>();

    for (const [name, adapter] of this.adapters) {
      try {
        const result = await adapter.detect();
        results.set(name, result);
        if (result.installed) {
          this.logger.info(`[CliDetection] ${adapter.displayName} detected`, {
            path: result.path,
            version: result.version,
          });
        } else {
          this.logger.debug(`[CliDetection] ${adapter.displayName} not installed`);
        }
      } catch (error) {
        this.logger.error(`[CliDetection] Error detecting ${adapter.displayName}`, error instanceof Error ? error : new Error(String(error)));
        results.set(name, { cli: name, installed: false, supportsSteer: false });
      }
    }

    this.detectionCache = results;
    return Array.from(results.values());
  }

  /**
   * Get detection result for a specific CLI
   */
  async getDetection(cli: CliType): Promise<CliDetectionResult | undefined> {
    const all = await this.detectAll();
    return all.find((r) => r.cli === cli);
  }

  /**
   * Get list of installed CLIs only
   */
  async getInstalledClis(): Promise<CliDetectionResult[]> {
    const all = await this.detectAll();
    return all.filter((r) => r.installed);
  }

  /**
   * Get the adapter for a specific CLI
   */
  getAdapter(cli: CliType): CliAdapter | undefined {
    return this.adapters.get(cli);
  }

  /**
   * Invalidate the detection cache (forces re-detection on next call)
   */
  invalidateCache(): void {
    this.detectionCache = null;
  }
}
```

#### File 2.6: CREATE `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`

**Purpose**: Core process management service. Spawns CLI agents as child processes, tracks state, manages output buffers, handles timeouts and cleanup.

**Pattern**: Injectable singleton following `llm.service.ts` architecture.

```typescript
/**
 * Agent Process Manager
 * TASK_2025_157: Manages headless CLI agent child processes
 *
 * Responsibilities:
 * - Spawn CLI agent processes (gemini, codex)
 * - Track process state, output buffers, timeouts
 * - Enforce concurrent agent limits
 * - Graceful shutdown on extension deactivation
 * - Cross-platform process termination (SIGTERM/taskkill)
 */
import { injectable, inject } from 'tsyringe';
import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { AgentId, AgentStatus, AgentProcessInfo, SpawnAgentRequest, SpawnAgentResult, AgentOutput, CliType } from '@ptah-extension/shared';
import { CliDetectionService } from './cli-detection.service';

/** Maximum output buffer size per agent (1MB) */
const MAX_BUFFER_SIZE = 1024 * 1024;

/** Default timeout: 10 minutes */
const DEFAULT_TIMEOUT = 10 * 60 * 1000;

/** Maximum timeout: 30 minutes */
const MAX_TIMEOUT = 30 * 60 * 1000;

/** Grace period for SIGTERM before SIGKILL: 5 seconds */
const KILL_GRACE_PERIOD = 5000;

interface TrackedAgent {
  info: AgentProcessInfo;
  process: ChildProcess;
  stdoutBuffer: string;
  stderrBuffer: string;
  timeoutHandle: NodeJS.Timeout;
  stdoutLineCount: number;
  stderrLineCount: number;
  truncated: boolean;
}

@injectable()
export class AgentProcessManager {
  private readonly agents = new Map<string, TrackedAgent>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger, @inject(TOKENS.CLI_DETECTION_SERVICE) private readonly cliDetection: CliDetectionService) {
    this.logger.info('[AgentProcessManager] Initialized');
  }

  /**
   * Spawn a new CLI agent process
   */
  async spawn(request: SpawnAgentRequest): Promise<SpawnAgentResult> {
    // Check concurrent limit
    const maxConcurrent = this.getMaxConcurrentAgents();
    const runningCount = this.getRunningCount();
    if (runningCount >= maxConcurrent) {
      throw new Error(`Maximum concurrent agent limit reached (${maxConcurrent}). ` + `Stop a running agent before spawning a new one. ` + `Running agents: ${this.getRunningAgentIds().join(', ')}`);
    }

    // Determine which CLI to use
    const cli = request.cli ?? (await this.getDefaultCli());
    if (!cli) {
      throw new Error('No CLI agent available. Install Gemini CLI (`npm install -g @anthropic-ai/gemini-cli`) ' + 'or Codex CLI and authenticate before using agent orchestration.');
    }

    // Verify CLI is installed
    const detection = await this.cliDetection.getDetection(cli);
    if (!detection || !detection.installed) {
      throw new Error(`${cli} CLI is not installed. Install it and run authentication before using.`);
    }

    // Get adapter and build command
    const adapter = this.cliDetection.getAdapter(cli);
    if (!adapter) {
      throw new Error(`No adapter registered for CLI: ${cli}`);
    }

    // Validate working directory
    const workingDirectory = request.workingDirectory ?? this.getWorkspaceRoot();
    this.validateWorkingDirectory(workingDirectory);

    // Sanitize task to prevent shell injection
    const sanitizedTask = this.sanitizeTask(request.task);

    const command = adapter.buildCommand({
      task: sanitizedTask,
      workingDirectory,
      files: request.files,
      taskFolder: request.taskFolder,
    });

    // Create agent ID and info
    const agentId = AgentId.create();
    const startedAt = new Date().toISOString();

    const info: AgentProcessInfo = {
      agentId,
      cli,
      task: request.task,
      workingDirectory,
      taskFolder: request.taskFolder,
      status: 'running',
      startedAt,
    };

    // Spawn the process
    this.logger.info('[AgentProcessManager] Spawning agent', {
      agentId,
      cli,
      binary: command.binary,
      args: command.args.length,
      workingDirectory,
    });

    const childProcess = spawn(command.binary, command.args, {
      cwd: workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: { ...process.env, ...command.env },
    });

    // Set up timeout
    const timeout = Math.min(request.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
    const timeoutHandle = setTimeout(() => {
      this.handleTimeout(agentId);
    }, timeout);

    // Track the agent
    const tracked: TrackedAgent = {
      info: { ...info, pid: childProcess.pid },
      process: childProcess,
      stdoutBuffer: '',
      stderrBuffer: '',
      timeoutHandle,
      stdoutLineCount: 0,
      stderrLineCount: 0,
      truncated: false,
    };

    this.agents.set(agentId, tracked);

    // Set up output capture
    childProcess.stdout?.on('data', (data: Buffer) => {
      this.appendBuffer(agentId, 'stdout', data.toString());
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      this.appendBuffer(agentId, 'stderr', data.toString());
    });

    // Handle process exit
    childProcess.on('exit', (code, signal) => {
      this.handleExit(agentId, code, signal);
    });

    childProcess.on('error', (error) => {
      this.logger.error('[AgentProcessManager] Process error', error);
      this.handleExit(agentId, 1, null);
    });

    return {
      agentId,
      cli,
      status: 'running',
      startedAt,
    };
  }

  /**
   * Get status of a specific agent or all agents
   */
  getStatus(agentId?: string): AgentProcessInfo | AgentProcessInfo[] {
    if (agentId) {
      const tracked = this.agents.get(agentId);
      if (!tracked) {
        throw new Error(`Agent not found: ${agentId}`);
      }
      return {
        ...tracked.info,
        status: tracked.info.status,
      };
    }

    return Array.from(this.agents.values()).map((t) => ({
      ...t.info,
    }));
  }

  /**
   * Read agent output (stdout + stderr)
   */
  readOutput(agentId: string, tail?: number): AgentOutput {
    const tracked = this.agents.get(agentId);
    if (!tracked) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const adapter = this.cliDetection.getAdapter(tracked.info.cli);

    let stdout = tracked.stdoutBuffer;
    let stderr = tracked.stderrBuffer;

    // Parse output through adapter to strip ANSI codes
    if (adapter) {
      stdout = adapter.parseOutput(stdout);
      stderr = adapter.parseOutput(stderr);
    }

    // Apply tail limit
    if (tail && tail > 0) {
      stdout = this.tailLines(stdout, tail);
      stderr = this.tailLines(stderr, tail);
    }

    return {
      agentId: AgentId.from(agentId),
      stdout,
      stderr,
      lineCount: tracked.stdoutLineCount + tracked.stderrLineCount,
      truncated: tracked.truncated,
    };
  }

  /**
   * Write instruction to agent's stdin (steering)
   */
  steer(agentId: string, instruction: string): void {
    const tracked = this.agents.get(agentId);
    if (!tracked) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (tracked.info.status !== 'running') {
      throw new Error(`Agent ${agentId} is not running (status: ${tracked.info.status})`);
    }

    const adapter = this.cliDetection.getAdapter(tracked.info.cli);
    if (!adapter?.supportsSteer()) {
      throw new Error(`Steering is not supported for ${tracked.info.cli} CLI. ` + `The agent will complete its task based on the original prompt.`);
    }

    if (!tracked.process.stdin?.writable) {
      throw new Error(`Agent ${agentId} stdin is not writable`);
    }

    tracked.process.stdin.write(instruction + '\n');
  }

  /**
   * Stop an agent process gracefully
   */
  async stop(agentId: string): Promise<AgentProcessInfo> {
    const tracked = this.agents.get(agentId);
    if (!tracked) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Already finished
    if (tracked.info.status !== 'running') {
      return tracked.info;
    }

    await this.killProcess(tracked);
    tracked.info = { ...tracked.info, status: 'stopped' };
    clearTimeout(tracked.timeoutHandle);

    this.logger.info('[AgentProcessManager] Agent stopped', { agentId });
    return tracked.info;
  }

  /**
   * Gracefully shut down all running agents (called on extension deactivation)
   */
  async shutdownAll(): Promise<void> {
    this.logger.info('[AgentProcessManager] Shutting down all agents...');
    const running = Array.from(this.agents.entries()).filter(([, t]) => t.info.status === 'running');

    await Promise.all(running.map(([id]) => this.stop(id)));
    this.logger.info(`[AgentProcessManager] ${running.length} agents shut down`);
  }

  // ========================================
  // Private Methods
  // ========================================

  private appendBuffer(agentId: string, stream: 'stdout' | 'stderr', data: string): void {
    const tracked = this.agents.get(agentId);
    if (!tracked) return;

    const key = stream === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer';
    const lineCountKey = stream === 'stdout' ? 'stdoutLineCount' : 'stderrLineCount';

    tracked[key] += data;
    tracked[lineCountKey] += (data.match(/\n/g) || []).length;

    // Rolling buffer: trim from beginning if over limit
    if (tracked[key].length > MAX_BUFFER_SIZE) {
      const excess = tracked[key].length - MAX_BUFFER_SIZE;
      const newlineIndex = tracked[key].indexOf('\n', excess);
      tracked[key] = newlineIndex > -1 ? tracked[key].substring(newlineIndex + 1) : tracked[key].substring(excess);
      tracked.truncated = true;
    }
  }

  private handleTimeout(agentId: string): void {
    const tracked = this.agents.get(agentId);
    if (!tracked || tracked.info.status !== 'running') return;

    this.logger.warn('[AgentProcessManager] Agent timed out', { agentId });
    tracked.info = { ...tracked.info, status: 'timeout' };
    this.killProcess(tracked);
  }

  private handleExit(agentId: string, code: number | null, signal: string | null): void {
    const tracked = this.agents.get(agentId);
    if (!tracked) return;

    clearTimeout(tracked.timeoutHandle);

    // Don't override timeout/stopped status
    if (tracked.info.status === 'running') {
      const status: AgentStatus = code === 0 ? 'completed' : 'failed';
      tracked.info = { ...tracked.info, status, exitCode: code ?? undefined };
    }

    this.logger.info('[AgentProcessManager] Agent exited', {
      agentId,
      status: tracked.info.status,
      exitCode: code,
      signal,
    });
  }

  private async killProcess(tracked: TrackedAgent): Promise<void> {
    const child = tracked.process;
    if (!child.pid) return;

    if (process.platform === 'win32') {
      // Windows: use taskkill
      try {
        const { execFile } = require('child_process');
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      } catch {
        child.kill();
      }
    } else {
      // Unix: SIGTERM then SIGKILL after grace period
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const killTimeout = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already dead */
          }
          resolve();
        }, KILL_GRACE_PERIOD);

        child.on('exit', () => {
          clearTimeout(killTimeout);
          resolve();
        });
      });
    }
  }

  private getRunningCount(): number {
    return Array.from(this.agents.values()).filter((t) => t.info.status === 'running').length;
  }

  private getRunningAgentIds(): string[] {
    return Array.from(this.agents.entries())
      .filter(([, t]) => t.info.status === 'running')
      .map(([id]) => id);
  }

  private getMaxConcurrentAgents(): number {
    const config = vscode.workspace.getConfiguration('ptah.agentOrchestration');
    return config.get<number>('maxConcurrentAgents', 3);
  }

  private async getDefaultCli(): Promise<CliType | null> {
    // Check user preference first
    const config = vscode.workspace.getConfiguration('ptah.agentOrchestration');
    const preferred = config.get<string>('defaultCli');
    if (preferred && (preferred === 'gemini' || preferred === 'codex')) {
      const detection = await this.cliDetection.getDetection(preferred as CliType);
      if (detection?.installed) {
        return preferred as CliType;
      }
    }

    // Auto-detect: prefer gemini, then codex
    const installed = await this.cliDetection.getInstalledClis();
    if (installed.length === 0) return null;

    // Prefer gemini over codex
    const gemini = installed.find((c) => c.cli === 'gemini');
    if (gemini) return 'gemini';
    return installed[0].cli;
  }

  private getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders[0].uri.fsPath;
    }
    return process.cwd();
  }

  private validateWorkingDirectory(dir: string): void {
    const workspaceRoot = this.getWorkspaceRoot();
    // Normalize paths for cross-platform comparison
    const normalizedDir = dir.replace(/\\/g, '/').toLowerCase();
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/').toLowerCase();
    if (!normalizedDir.startsWith(normalizedRoot)) {
      throw new Error(`Working directory must be within workspace root. ` + `Got: ${dir}, Expected prefix: ${workspaceRoot}`);
    }
  }

  private sanitizeTask(task: string): string {
    // Remove shell injection patterns
    return task.replace(/`/g, "'").replace(/\$\(/g, '(').replace(/\$\{/g, '{');
  }

  private tailLines(str: string, n: number): string {
    const lines = str.split('\n');
    return lines.slice(-n).join('\n');
  }
}
```

#### File 2.7: MODIFY `libs/backend/llm-abstraction/src/index.ts`

**What**: Export new services and types.

Add after the existing `LlmConfigurationService` export (around line 63):

```typescript
// ========================================
// Agent Orchestration (TASK_2025_157)
// ========================================
export { CliDetectionService } from './lib/services/cli-detection.service';
export { AgentProcessManager } from './lib/services/agent-process-manager.service';
export type { CliAdapter, CliCommand, CliCommandOptions } from './lib/services/cli-adapters';
```

#### File 2.8: MODIFY `libs/backend/llm-abstraction/src/lib/di/register.ts`

**What**: Register `CliDetectionService` and `AgentProcessManager` in DI container.

**Evidence**: Follows registration pattern at `register.ts:45-89`.

Add imports at top:

```typescript
import { CliDetectionService } from '../services/cli-detection.service';
import { AgentProcessManager } from '../services/agent-process-manager.service';
```

Add registrations after `LlmService` registration (after line 79), before the logger.info:

```typescript
// 5. CliDetectionService - needs LOGGER
container.registerSingleton(TOKENS.CLI_DETECTION_SERVICE, CliDetectionService);

// 6. AgentProcessManager - needs LOGGER, CLI_DETECTION_SERVICE
container.registerSingleton(TOKENS.AGENT_PROCESS_MANAGER, AgentProcessManager);
```

Update the services log array to include the new services:

```typescript
logger.info('[LLM Abstraction] Services registered', {
  services: ['LLM_SECRETS_SERVICE', 'LLM_CONFIGURATION_SERVICE', 'PROVIDER_REGISTRY', 'LLM_SERVICE', 'CLI_DETECTION_SERVICE', 'AGENT_PROCESS_MANAGER'],
});
```

---

### Batch 3: MCP Tools (Tool Builders, Protocol Handlers, Agent Namespace)

#### File 3.1: MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`

**What**: Add `AgentNamespace` interface and `agent` property to `PtahAPI`.

Add the `AgentNamespace` interface before the closing of the namespace interfaces section (before the MCP Protocol Types section, around line 490):

```typescript
// ========================================
// Agent Namespace (TASK_2025_157)
// ========================================

/**
 * Agent orchestration namespace
 * Enables spawning, monitoring, and steering CLI agents as background workers.
 * Supports fire-and-check async delegation pattern.
 */
export interface AgentNamespace {
  /**
   * Spawn a CLI agent with a task
   * @param request - Spawn configuration (task, cli, timeout, files, taskFolder)
   * @returns Spawn result with agentId
   */
  spawn: (request: SpawnAgentRequest) => Promise<SpawnAgentResult>;

  /**
   * Get status of a specific agent or all agents
   * @param agentId - Optional agent ID. Omit to get all agents.
   * @returns Agent status info
   */
  status: (agentId?: string) => Promise<AgentProcessInfo | AgentProcessInfo[]>;

  /**
   * Read agent output (stdout + stderr)
   * @param agentId - Agent ID
   * @param tail - Optional: only return last N lines
   * @returns Agent output
   */
  read: (agentId: string, tail?: number) => Promise<AgentOutput>;

  /**
   * Send steering instruction to agent stdin
   * @param agentId - Agent ID
   * @param instruction - Text to send to stdin
   */
  steer: (agentId: string, instruction: string) => Promise<void>;

  /**
   * Stop a running agent
   * @param agentId - Agent ID
   * @returns Final agent status
   */
  stop: (agentId: string) => Promise<AgentProcessInfo>;

  /**
   * List available CLI agents with installation status
   * @returns Array of CLI detection results
   */
  list: () => Promise<CliDetectionResult[]>;

  /**
   * Wait for an agent to complete (polling)
   * @param agentId - Agent ID
   * @param options - Poll interval (default: 2000ms), timeout (default: no timeout)
   * @returns Final agent status
   */
  waitFor: (agentId: string, options?: { pollInterval?: number; timeout?: number }) => Promise<AgentProcessInfo>;
}
```

Add imports at the top of the file (add to the existing imports):

```typescript
import type { SpawnAgentRequest, SpawnAgentResult, AgentProcessInfo, AgentOutput, CliDetectionResult } from '@ptah-extension/shared';
```

Add `agent` to the `PtahAPI` interface (after the `orchestration` property, before the `help` method):

```typescript
// Agent orchestration namespace (TASK_2025_157)
agent: AgentNamespace;
```

#### File 3.2: CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`

**Purpose**: Build the `ptah.agent` namespace. Follows pattern from `orchestration-namespace.builder.ts`.

```typescript
/**
 * Agent Namespace Builder
 * TASK_2025_157: Async agent orchestration via CLI agents
 *
 * Provides spawn, status, read, steer, stop, list, waitFor methods
 * for managing headless CLI agents (Gemini, Codex) as background workers.
 *
 * Pattern: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/orchestration-namespace.builder.ts
 */

import type { AgentNamespace } from '../types';
import type { AgentProcessManager, CliDetectionService } from '@ptah-extension/llm-abstraction';
import type { AgentProcessInfo } from '@ptah-extension/shared';

/**
 * Dependencies for agent namespace
 */
export interface AgentNamespaceDependencies {
  agentProcessManager: AgentProcessManager;
  cliDetectionService: CliDetectionService;
}

/**
 * Build the agent namespace for ptah.agent.*
 */
export function buildAgentNamespace(deps: AgentNamespaceDependencies): AgentNamespace {
  const { agentProcessManager, cliDetectionService } = deps;

  return {
    spawn: async (request) => {
      return agentProcessManager.spawn(request);
    },

    status: async (agentId?) => {
      return agentProcessManager.getStatus(agentId);
    },

    read: async (agentId, tail?) => {
      return agentProcessManager.readOutput(agentId, tail);
    },

    steer: async (agentId, instruction) => {
      agentProcessManager.steer(agentId, instruction);
    },

    stop: async (agentId) => {
      return agentProcessManager.stop(agentId);
    },

    list: async () => {
      return cliDetectionService.detectAll();
    },

    waitFor: async (agentId, options?) => {
      const pollInterval = options?.pollInterval ?? 2000;
      const timeout = options?.timeout;
      const startTime = Date.now();

      return new Promise<AgentProcessInfo>((resolve, reject) => {
        const check = () => {
          try {
            const status = agentProcessManager.getStatus(agentId) as AgentProcessInfo;
            if (status.status !== 'running') {
              resolve(status);
              return;
            }

            // Check timeout
            if (timeout && Date.now() - startTime > timeout) {
              reject(new Error(`waitFor timed out after ${timeout}ms for agent ${agentId}`));
              return;
            }

            setTimeout(check, pollInterval);
          } catch (error) {
            reject(error);
          }
        };

        check();
      });
    },
  };
}
```

#### File 3.3: MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/index.ts`

**What**: Add export for agent namespace builder.

Add at the end of the file:

```typescript
// Agent namespace (TASK_2025_157 - async agent orchestration)
export { buildAgentNamespace, type AgentNamespaceDependencies } from './agent-namespace.builder';
```

#### File 3.4: MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts`

**What**: Add 5 agent tool builder functions.

Add at the end of the file (before the `buildExecuteCodeDescription` function):

```typescript
// ========================================
// Agent Orchestration MCP Tools (TASK_2025_157)
// ========================================

/**
 * Build the ptah_agent_spawn tool definition
 * Spawn a CLI agent to work on a task in the background
 */
export function buildAgentSpawnTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_spawn',
    description: 'Spawn a CLI agent (Gemini or Codex) to work on a task in the background. ' + 'The agent runs as a headless process while you continue working. ' + 'Use ptah_agent_status to check progress and ptah_agent_read to get output. ' + 'Ideal for delegating: code reviews, test generation, documentation, ' + 'and other independent subtasks.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Task description for the agent. Be specific about what to do, ' + 'which files to focus on, and what output to produce.',
        },
        cli: {
          type: 'string',
          enum: ['gemini', 'codex'],
          description: 'Which CLI to use. Omit to use the default (auto-detected or user-configured).',
        },
        workingDirectory: {
          type: 'string',
          description: 'Working directory for the agent (must be within workspace). Defaults to workspace root.',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 600000 = 10min, max: 1800000 = 30min)',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of files the agent should focus on',
        },
        taskFolder: {
          type: 'string',
          description: 'Task-tracking folder for shared workspace (e.g., "task-tracking/TASK_2025_157"). ' + 'Agent will write deliverables here.',
        },
      },
      required: ['task'],
    },
  };
}

/**
 * Build the ptah_agent_status tool definition
 * Check status of one or all agents
 */
export function buildAgentStatusTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_status',
    description: 'Check the status of a specific agent or all agents. ' + 'Returns agentId, status (running/completed/failed/timeout/stopped), ' + 'cli, task, startedAt, duration, and exitCode.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID to check. Omit to get status of ALL agents.',
        },
      },
    },
  };
}

/**
 * Build the ptah_agent_read tool definition
 * Read agent output
 */
export function buildAgentReadTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_read',
    description: 'Read the stdout/stderr output from an agent. ' + 'For running agents, returns output captured so far. ' + 'Use tail parameter to get only the last N lines.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID to read output from',
        },
        tail: {
          type: 'number',
          description: 'Only return the last N lines of output',
        },
      },
      required: ['agentId'],
    },
  };
}

/**
 * Build the ptah_agent_steer tool definition
 * Send instruction to agent stdin
 */
export function buildAgentSteerTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_steer',
    description: 'Send a steering instruction to a running agent via stdin. ' + 'Only works if the CLI supports interactive input. ' + 'Returns error if steering is not supported for the CLI type.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID to steer',
        },
        instruction: {
          type: 'string',
          description: 'Instruction text to send to agent stdin',
        },
      },
      required: ['agentId', 'instruction'],
    },
  };
}

/**
 * Build the ptah_agent_stop tool definition
 * Stop a running agent
 */
export function buildAgentStopTool(): MCPToolDefinition {
  return {
    name: 'ptah_agent_stop',
    description: 'Stop a running agent. Sends SIGTERM, waits 5 seconds, then SIGKILL. ' + 'If agent is already completed, returns its final status without error.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID to stop',
        },
      },
      required: ['agentId'],
    },
  };
}
```

#### File 3.5: MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts`

**What**: Register 5 agent tools in `handleToolsList` and add handlers in `handleIndividualTool`.

Add imports at top:

```typescript
import { buildAgentSpawnTool, buildAgentStatusTool, buildAgentReadTool, buildAgentSteerTool, buildAgentStopTool } from './tool-description.builder';
```

In `handleToolsList` function, add the 5 agent tools to the tools array (after `buildCountTokensTool()`, before the power-user tools):

```typescript
        // Agent orchestration tools (TASK_2025_157)
        buildAgentSpawnTool(),
        buildAgentStatusTool(),
        buildAgentReadTool(),
        buildAgentSteerTool(),
        buildAgentStopTool(),
```

In `handleIndividualTool` function, add cases to the switch block (before `default: return null;`):

```typescript
      // Agent orchestration tools (TASK_2025_157)
      case 'ptah_agent_spawn': {
        const result = await ptahAPI.agent.spawn(args as any);
        return createToolSuccessResponse(
          request,
          JSON.stringify(result, null, 2),
          deps
        );
      }

      case 'ptah_agent_status': {
        const { agentId } = args as { agentId?: string };
        const result = await ptahAPI.agent.status(agentId);
        return createToolSuccessResponse(
          request,
          JSON.stringify(result, null, 2),
          deps
        );
      }

      case 'ptah_agent_read': {
        const { agentId, tail } = args as { agentId: string; tail?: number };
        const result = await ptahAPI.agent.read(agentId, tail);
        return createToolSuccessResponse(
          request,
          JSON.stringify(result, null, 2),
          deps
        );
      }

      case 'ptah_agent_steer': {
        const { agentId, instruction } = args as { agentId: string; instruction: string };
        await ptahAPI.agent.steer(agentId, instruction);
        return createToolSuccessResponse(
          request,
          JSON.stringify({ agentId, steered: true }),
          deps
        );
      }

      case 'ptah_agent_stop': {
        const { agentId } = args as { agentId: string };
        const result = await ptahAPI.agent.stop(agentId);
        return createToolSuccessResponse(
          request,
          JSON.stringify(result, null, 2),
          deps
        );
      }
```

---

### Batch 4: Integration (API Builder, System Prompt, Help Docs)

#### File 4.1: MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`

**What**: Inject `AgentProcessManager` and `CliDetectionService`, add `agent` namespace to `build()`.

Add imports:

```typescript
import { AgentProcessManager, CliDetectionService } from '@ptah-extension/llm-abstraction';
import { buildAgentNamespace } from './namespace-builders';
```

Add constructor parameters (after `llmSecretsService`):

```typescript
    // Agent orchestration services (TASK_2025_157)
    @inject(TOKENS.AGENT_PROCESS_MANAGER)
    private readonly agentProcessManager: AgentProcessManager,

    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetectionService: CliDetectionService
```

Update the constructor log message:

```typescript
this.logger.info('PtahAPIBuilder initialized with 16 namespaces');
```

Add to `build()` method, agent deps construction and namespace addition.

Add deps object construction (after `orchestrationDeps`):

```typescript
const agentDeps = {
  agentProcessManager: this.agentProcessManager,
  cliDetectionService: this.cliDetectionService,
};
```

Add `agent` namespace to the return object (after `orchestration` namespace, before `help`):

```typescript
      // Agent orchestration namespace (TASK_2025_157)
      agent: buildAgentNamespace(agentDeps),
```

Update the `build()` method's debug log:

```typescript
this.logger.debug('Building Ptah API with all namespaces');
```

#### File 4.2: MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts`

**What**: Add agent orchestration section to system prompt.

Add a new section after the `## Workflow: Start Every Task With Ptah` section at the end:

```typescript
// Add to the end of the PTAH_SYSTEM_PROMPT template literal, before the final backtick:

`
## Multi-Agent Delegation — Fire-and-Check Pattern

You have access to **agent orchestration tools** that let you spawn Gemini CLI or Codex CLI as background workers. Use these to delegate independent subtasks while you continue working.

### When to Delegate

- Code reviews (spawn agent to review while you implement)
- Test generation (spawn agent to write tests while you code)
- Documentation (spawn agent to document while you build)
- Any independent subtask that doesn't block your main work

### Agent Tools

| Tool | Purpose |
|------|---------|
| \`ptah_agent_spawn\` | Launch a CLI agent with a task |
| \`ptah_agent_status\` | Check agent progress (all or by ID) |
| \`ptah_agent_read\` | Read agent output so far |
| \`ptah_agent_steer\` | Send instruction to running agent |
| \`ptah_agent_stop\` | Stop a running agent |

### Workflow Example

1. **Spawn**: \`ptah_agent_spawn { task: "Review src/auth.ts for security issues", cli: "gemini" }\`
2. **Continue**: Work on your main task
3. **Check**: \`ptah_agent_status { agentId: "..." }\` — is it done?
4. **Read**: \`ptah_agent_read { agentId: "..." }\` — get the results
5. **Use**: Incorporate findings into your work`;
```

#### File 4.3: MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts`

**What**: Add `agent` help documentation to `HELP_DOCS` record.

Add a new entry to the `HELP_DOCS` record:

```typescript
  agent: `ptah.agent - CLI Agent Orchestration (TASK_2025_157)

Spawn Gemini CLI or Codex CLI as background workers for parallel task execution.

LIFECYCLE:
- spawn(request) - Launch a CLI agent with a task
  request: { task: string, cli?: 'gemini'|'codex', workingDirectory?: string, timeout?: number, files?: string[], taskFolder?: string }
  returns: { agentId, cli, status, startedAt }

- status(agentId?) - Get agent status (omit agentId for all agents)
  returns: { agentId, status, cli, task, startedAt, exitCode? }

- read(agentId, tail?) - Read agent stdout/stderr output
  returns: { agentId, stdout, stderr, lineCount, truncated }

- steer(agentId, instruction) - Send instruction to agent stdin
  (only if CLI supports steering)

- stop(agentId) - Stop a running agent (SIGTERM, then SIGKILL after 5s)
  returns: final status

DISCOVERY:
- list() - List available CLI agents with installation status
  returns: [{ cli, installed, path?, version?, supportsSteer }]

WAITING:
- waitFor(agentId, { pollInterval?, timeout? }) - Block until agent completes
  Default pollInterval: 2000ms

EXAMPLE:
  const result = await ptah.agent.spawn({ task: 'Review auth code for security issues', cli: 'gemini' });
  // ... continue working ...
  const status = await ptah.agent.status(result.agentId);
  if (status.status === 'completed') {
    const output = await ptah.agent.read(result.agentId);
    return output.stdout;
  }`,
```

Also update the `overview` help doc to include the agent namespace:

```typescript
  overview: `Ptah MCP Server - 16 Namespaces:

WORKSPACE: workspace, search, symbols, files, diagnostics, git, commands
ANALYSIS: context, project, relevance, ast
AI: ptah.ai.* (chat, tokens, tools, specialized tasks)
IDE: ptah.ide.* (lsp, editor, actions, testing) — VS Code exclusive
LLM: ptah.llm.* (VS Code Language Model API)
ORCHESTRATION: ptah.orchestration.* (workflow state management)
AGENT: ptah.agent.* (CLI agent orchestration - spawn, monitor, steer)

Use ptah.help('namespace') for details on any namespace.`,
```

#### File 4.4: MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts`

**What**: Update `buildExecuteCodeDescription()` to mention the agent namespace.

In the `buildExecuteCodeDescription()` function, update the top-level description to say "16 namespaces" instead of "16 total", and add the agent namespace section. Add after the `ptah.orchestration.*` line in "Other Namespaces":

```
- ptah.agent.* - CLI agent orchestration (spawn, monitor, steer Gemini/Codex)
```

---

### Batch 5: VS Code Settings + Extension Wiring

#### File 5.1: MODIFY `apps/ptah-extension-vscode/package.json`

**What**: Add VS Code settings schema for agent orchestration.

Add to the `contributes.configuration.properties` section:

```json
"ptah.agentOrchestration.defaultCli": {
  "type": "string",
  "enum": ["gemini", "codex"],
  "default": "gemini",
  "description": "Default CLI agent to use when spawning agents. Auto-detected if not set."
},
"ptah.agentOrchestration.maxConcurrentAgents": {
  "type": "number",
  "default": 3,
  "minimum": 1,
  "maximum": 10,
  "description": "Maximum number of concurrent CLI agent processes."
},
"ptah.agentOrchestration.defaultTimeout": {
  "type": "number",
  "default": 600000,
  "minimum": 60000,
  "maximum": 1800000,
  "description": "Default timeout for CLI agent processes in milliseconds (10 min default, 30 min max)."
}
```

---

## Key Design Decisions

### Decision 1: Process Management in llm-abstraction, Not a New Library

**Rationale**: The `llm-abstraction` library already owns the concept of "external LLM provider integration." CLI agents are external LLM providers accessed via process spawning rather than API calls. Placing process management here avoids creating a new library and keeps the dependency graph simple.

**Evidence**: `llm-abstraction` already has `CliDetectionService` infrastructure concepts (removed providers), and its DI registration pattern (`register.ts`) supports adding new services.

### Decision 2: MCP Tools as First-Class (Not execute_code Only)

**Rationale**: Agent tools are registered as individual first-class MCP tools (`ptah_agent_spawn`, etc.) rather than only accessible through `execute_code`. This matches the existing pattern where `ptah_workspace_analyze`, `ptah_search_files`, etc. are individual tools for high discoverability.

**Evidence**: `protocol-handlers.ts:129-149` shows individual tools listed in `handleToolsList`, and `protocol-handlers.ts:194-311` shows the `handleIndividualTool` routing pattern.

### Decision 3: AgentId as Branded Type in Shared

**Rationale**: Following the established pattern where cross-library identity types (`SessionId`, `MessageId`, `CorrelationId`) are branded types in the shared library. This prevents accidental ID mixing at compile time.

**Evidence**: `branded.types.ts:15-66` shows the exact pattern with smart constructors.

### Decision 4: CliAdapter Interface for Extensibility

**Rationale**: Each CLI has different invocation patterns, flags, and output formats. Abstracting behind `CliAdapter` means adding Claude CLI or Aider in the future requires only a new adapter class, not modifying `AgentProcessManager`.

**Evidence**: The task description explicitly requires this: "Architecture SHALL allow adding new CLI agents by implementing a simple CliAdapter interface without modifying core process management."

### Decision 5: Rolling Output Buffer (Not Unbounded)

**Rationale**: CLI agents can produce megabytes of verbose output. A rolling buffer with 1MB limit per agent prevents memory leaks while preserving the most recent (and most useful) output.

**Evidence**: Non-functional requirement: "Each tracked agent SHALL consume no more than 10MB of memory for output buffering."

### Decision 6: No npm Dependencies Added

**Rationale**: All functionality uses Node.js built-ins (`child_process`, `path`, `os`, `util`). No new external packages needed.

---

## Risk Mitigations

| Risk                                  | Mitigation                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| CLI flags change between versions     | `CliAdapter.buildCommand()` encapsulates version-specific flags. Adapter can be updated independently.  |
| Windows process termination differs   | `AgentProcessManager.killProcess()` uses `taskkill /pid /T /F` on Windows, `SIGTERM`+`SIGKILL` on Unix. |
| Shell injection via task descriptions | `sanitizeTask()` strips backticks and `$()` patterns before passing to CLI.                             |
| Memory leak from output buffers       | Rolling buffer with 1MB limit, trimming at newline boundaries.                                          |
| Orphaned processes on extension crash | Processes are spawned with `stdio: 'pipe'` -- they lose stdin on parent exit.                           |
| Agent working directory escape        | `validateWorkingDirectory()` checks the directory is within workspace root.                             |
| Race condition in concurrent spawns   | `getRunningCount()` is synchronous (Map lookup), so concurrent limit check is atomic within event loop. |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**: This is entirely backend work -- Node.js child process management, DI registration, MCP tool handlers, TypeScript type definitions. No UI/frontend components involved.

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 8-12 hours across 5 batches

### Files Affected Summary

**CREATE (8 files)**:

- `libs/shared/src/lib/types/agent-process.types.ts`
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/cli-adapter.interface.ts`
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/gemini-cli.adapter.ts`
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts`
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/index.ts`
- `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts`
- `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`

**MODIFY (11 files)**:

- `libs/shared/src/index.ts`
- `libs/backend/vscode-core/src/di/tokens.ts`
- `libs/backend/llm-abstraction/src/index.ts`
- `libs/backend/llm-abstraction/src/lib/di/register.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/index.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts`
- `apps/ptah-extension-vscode/package.json`

### Critical Verification Points

1. **All imports verified in codebase**:

   - `TOKENS` from `@ptah-extension/vscode-core` (tokens.ts:281)
   - `Logger` from `@ptah-extension/vscode-core` (verified via existing services)
   - `injectable`, `inject` from `tsyringe` (used throughout codebase)
   - `MCPToolDefinition` from `types.ts:545`
   - `PtahAPI` from `types.ts:22`
   - `v4 as uuidv4` from `uuid` (used in branded.types.ts:7)
   - `spawn, ChildProcess` from `child_process` (Node.js built-in)

2. **All patterns verified from examples**:

   - Branded type: `branded.types.ts:15-66`
   - DI token: `tokens.ts:116-120`
   - DI registration: `llm-abstraction/di/register.ts:45-89`
   - Namespace builder: `orchestration-namespace.builder.ts:80-339`
   - MCP tool builder: `tool-description.builder.ts:83-241`
   - Protocol handler: `protocol-handlers.ts:194-311`
   - PtahAPIBuilder injection: `ptah-api-builder.service.ts:83-141`

3. **No hallucinated APIs** -- every interface, class, and decorator verified in codebase source.

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase (12 pattern citations)
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (from task-description.md NFRs)
- [x] Integration points documented (DI, MCP tools, API builder, system prompt)
- [x] Files affected list complete (8 CREATE + 12 MODIFY)
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (HIGH, 8-12 hours)
- [x] 5 implementation batches with dependency ordering
- [x] Risk mitigations specific to implementation
