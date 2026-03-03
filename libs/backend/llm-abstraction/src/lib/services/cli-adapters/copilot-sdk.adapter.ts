/**
 * Copilot SDK Adapter
 * TASK_2025_162: SDK-based Copilot integration using @github/copilot-sdk
 *
 * Uses the Copilot SDK for structured event streaming, permission hooks,
 * session management, and crash recovery. This is the sole Copilot adapter
 * (TASK_2025_169 removed the raw CLI fallback).
 *
 * Architecture:
 * - CopilotClient is singleton (one CLI process per extension lifetime)
 * - Each task creates a new CopilotSession with unique sessionId
 * - SDK events map to CliOutputSegment types for the agent monitor UI
 * - Permission hooks route through CopilotPermissionBridge
 * - Auth via VS Code GitHub auth API (fallback: useLoggedInUser)
 *
 * SDK Event -> CliOutputSegment Mapping:
 * - assistant.message_delta   -> text (deltaContent)
 * - assistant.message         -> text (full content, skip if streaming deltas received)
 * - tool.execution_start      -> tool-call (toolName, arguments)
 * - tool.execution_complete   -> tool-result / tool-result-error
 * - session.error             -> error
 * - session.start             -> info
 * - session.idle              -> resolves done promise
 * - assistant.usage           -> info (token usage summary)
 *
 * NOTE: SDK types are defined locally to avoid ESM/CJS module resolution issues.
 * The @github/copilot-sdk package is `"type": "module"` (ESM) while this library
 * builds as CommonJS with `module: node16`. TypeScript cannot resolve type exports
 * from ESM packages in this configuration. The SDK is imported dynamically at
 * runtime in ensureClient(). This follows the same pattern as CodexCliAdapter.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import type {
  CliDetectionResult,
  CliOutputSegment,
} from '@ptah-extension/shared';
import type {
  CliAdapter,
  CliCommand,
  CliCommandOptions,
  CliModelInfo,
  SdkHandle,
} from './cli-adapter.interface';
import {
  stripAnsiCodes,
  buildTaskPrompt,
  resolveCliPath,
  resolveWindowsCmd,
} from './cli-adapter.utils';
import type { CopilotPermissionBridge } from './copilot-permission-bridge';

const execFileAsync = promisify(execFile);

// ========================================
// Local SDK Type Definitions
// These mirror @github/copilot-sdk types to avoid ESM import issues.
// See: node_modules/@github/copilot-sdk/dist/types.d.ts
// See: node_modules/@github/copilot-sdk/dist/session.d.ts
// See: node_modules/@github/copilot-sdk/dist/client.d.ts
// ========================================

/** Mirrors CopilotClientOptions from @github/copilot-sdk */
interface SdkClientOptions {
  cliPath?: string;
  cliArgs?: string[];
  cwd?: string;
  port?: number;
  useStdio?: boolean;
  cliUrl?: string;
  logLevel?: 'none' | 'error' | 'warning' | 'info' | 'debug' | 'all';
  autoStart?: boolean;
  autoRestart?: boolean;
  env?: Record<string, string | undefined>;
  githubToken?: string;
  useLoggedInUser?: boolean;
}

/** Mirrors SessionConfig from @github/copilot-sdk */
interface SdkSessionConfig {
  sessionId?: string;
  model?: string;
  streaming?: boolean;
  workingDirectory?: string;
  systemMessage?:
    | { mode?: 'append'; content?: string }
    | { mode: 'replace'; content: string };
  onPermissionRequest?: SdkPermissionHandler;
  hooks?: SdkSessionHooks;
  mcpServers?: Record<string, SdkMcpServerConfig>;
  tools?: unknown[];
  [key: string]: unknown;
}

/** Mirrors ResumeSessionConfig (subset of SessionConfig) */
interface SdkResumeConfig {
  model?: string;
  streaming?: boolean;
  workingDirectory?: string;
  onPermissionRequest?: SdkPermissionHandler;
  hooks?: SdkSessionHooks;
  systemMessage?:
    | { mode?: 'append'; content?: string }
    | { mode: 'replace'; content: string };
  mcpServers?: Record<string, SdkMcpServerConfig>;
  [key: string]: unknown;
}

/** Mirrors MCPRemoteServerConfig */
interface SdkMcpServerConfig {
  type: 'http' | 'sse';
  url: string;
  tools: string[];
  headers?: Record<string, string>;
  timeout?: number;
}

/** Mirrors PermissionRequest */
interface SdkPermissionRequest {
  kind: 'shell' | 'write' | 'mcp' | 'read' | 'url';
  toolCallId?: string;
  [key: string]: unknown;
}

/** Mirrors PermissionRequestResult */
interface SdkPermissionRequestResult {
  kind:
    | 'approved'
    | 'denied-by-rules'
    | 'denied-no-approval-rule-and-could-not-request-from-user'
    | 'denied-interactively-by-user';
  rules?: unknown[];
}

/** Mirrors PermissionHandler */
type SdkPermissionHandler = (
  request: SdkPermissionRequest,
  invocation: { sessionId: string }
) => Promise<SdkPermissionRequestResult> | SdkPermissionRequestResult;

/** Mirrors PreToolUseHookInput */
interface SdkPreToolUseInput {
  timestamp: number;
  cwd: string;
  toolName: string;
  toolArgs: unknown;
}

/** Mirrors PreToolUseHookOutput */
interface SdkPreToolUseOutput {
  permissionDecision?: 'allow' | 'deny' | 'ask';
  permissionDecisionReason?: string;
  modifiedArgs?: unknown;
  additionalContext?: string;
  suppressOutput?: boolean;
}

/** Mirrors SessionHooks */
interface SdkSessionHooks {
  onPreToolUse?: (
    input: SdkPreToolUseInput,
    invocation: { sessionId: string }
  ) => Promise<SdkPreToolUseOutput | void> | SdkPreToolUseOutput | void;
  [key: string]: unknown;
}

/** Mirrors ModelInfo from @github/copilot-sdk */
interface SdkModelInfo {
  id: string;
  name: string;
  [key: string]: unknown;
}

/** Minimal session event type with discriminated union subset */
interface SdkSessionEvent {
  id: string;
  timestamp: string;
  type: string;
  data: Record<string, unknown>;
}

/** Mirrors CopilotSession (subset of methods we use) */
interface SdkSession {
  readonly sessionId: string;
  on(eventType: string, handler: (event: SdkSessionEvent) => void): () => void;
  send(options: { prompt: string }): Promise<string>;
  sendAndWait(options: { prompt: string }, timeout?: number): Promise<unknown>;
  abort(): Promise<void>;
  destroy(): Promise<void>;
}

/** Mirrors CopilotClient (subset of methods we use) */
interface SdkClient {
  start(): Promise<void>;
  stop(): Promise<Error[]>;
  forceStop(): Promise<void>;
  createSession(config?: SdkSessionConfig): Promise<SdkSession>;
  resumeSession(
    sessionId: string,
    config?: SdkResumeConfig
  ): Promise<SdkSession>;
  listModels(): Promise<SdkModelInfo[]>;
  getState(): string;
}

/** SDK module shape for dynamic import */
interface CopilotSdkModule {
  CopilotClient: new (options?: SdkClientOptions) => SdkClient;
}

// ========================================
// End Local SDK Types
// ========================================

// ========================================
// Tool Classification Helpers
// ========================================

/** Shell/command execution tool names across providers */
function isShellTool(toolName: string): boolean {
  return /^(run_shell_command|bash|shell|execute_command|terminal)$/i.test(
    toolName
  );
}

/** File write/edit tool names across providers */
function isFileWriteTool(toolName: string): boolean {
  return /^(write_file|edit|replace|create_file|patch_file|write|insert)$/i.test(
    toolName
  );
}

/** Copilot CLI model list (from `copilot --help` output) */
const COPILOT_MODELS: CliModelInfo[] = [
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4.6', name: 'Claude Opus 4.6' },
  { id: 'claude-opus-4.6-fast', name: 'Claude Opus 4.6 Fast' },
  { id: 'claude-opus-4.5', name: 'Claude Opus 4.5' },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
  { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5' },
  { id: 'gpt-5.3-codex', name: 'GPT 5.3 Codex' },
  { id: 'gpt-5.2-codex', name: 'GPT 5.2 Codex' },
  { id: 'gpt-5.2', name: 'GPT 5.2' },
  { id: 'gpt-5.1-codex-max', name: 'GPT 5.1 Codex Max' },
  { id: 'gpt-5.1-codex', name: 'GPT 5.1 Codex' },
  { id: 'gpt-5.1-codex-mini', name: 'GPT 5.1 Codex Mini' },
  { id: 'gpt-5.1', name: 'GPT 5.1' },
  { id: 'gpt-5-mini', name: 'GPT 5 Mini' },
  { id: 'gpt-4.1', name: 'GPT 4.1' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' },
];

export class CopilotSdkAdapter implements CliAdapter {
  readonly name = 'copilot' as const;
  readonly displayName = 'Copilot SDK';

  /** Singleton client instance shared across all sessions */
  private client: SdkClient | null = null;

  /** Permission bridge for routing tool approval to the webview UI */
  readonly permissionBridge: CopilotPermissionBridge;

  constructor(permissionBridge: CopilotPermissionBridge) {
    this.permissionBridge = permissionBridge;
  }

  /**
   * Detect if Copilot CLI binary is installed (required by the SDK).
   */
  async detect(): Promise<CliDetectionResult> {
    try {
      const binaryPath = await resolveCliPath('copilot');
      if (!binaryPath) {
        return { cli: 'copilot', installed: false, supportsSteer: false };
      }

      let version: string | undefined;
      try {
        const { stdout: versionOutput } = await execFileAsync(
          binaryPath,
          ['version'],
          { timeout: 5000 }
        );
        version = versionOutput.trim().split('\n')[0];
      } catch {
        // Version check failed, CLI still usable
      }

      return {
        cli: 'copilot',
        installed: true,
        path: binaryPath,
        version,
        supportsSteer: false,
      };
    } catch {
      return {
        cli: 'copilot',
        installed: false,
        supportsSteer: false,
      };
    }
  }

  /**
   * Required by CliAdapter interface. Not used at runtime — this adapter
   * always uses runSdk() which routes through the Copilot SDK session API.
   */
  buildCommand(_options: CliCommandOptions): CliCommand {
    return { binary: 'copilot', args: [] };
  }

  supportsSteer(): boolean {
    return false;
  }

  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }

  /**
   * Return available models for Copilot.
   * Uses the SDK's listModels() if the client is initialized, else falls back
   * to the static COPILOT_MODELS list.
   */
  async listModels(): Promise<CliModelInfo[]> {
    if (this.client) {
      try {
        const models = await this.client.listModels();
        return models.map((m) => ({ id: m.id, name: m.name }));
      } catch {
        // Fall through to static list
      }
    }
    return COPILOT_MODELS;
  }

  /**
   * Run task via the Copilot SDK with structured event streaming.
   *
   * Creates (or resumes) a CopilotSession, wires SDK events to SdkHandle
   * callbacks, sends the task prompt, and returns the handle for
   * AgentProcessManager consumption.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    await this.ensureClient(options.binaryPath);

    const sessionId = `ptah-${Date.now()}`;
    const abortController = new AbortController();

    // Output buffering (same pattern as Gemini/Codex adapters)
    const outputBuffer: string[] = [];
    const outputCallbacks: Array<(data: string) => void> = [];

    const onOutput = (callback: (data: string) => void): void => {
      outputCallbacks.push(callback);
      if (outputBuffer.length > 0) {
        for (const buffered of outputBuffer) {
          callback(buffered);
        }
        outputBuffer.length = 0;
      }
    };

    const emitOutput = (data: string): void => {
      if (outputCallbacks.length === 0) {
        outputBuffer.push(data);
      } else {
        for (const cb of outputCallbacks) {
          cb(data);
        }
      }
    };

    // Structured segment buffering (same pattern as Gemini adapter)
    const segmentBuffer: CliOutputSegment[] = [];
    const segmentCallbacks: Array<(segment: CliOutputSegment) => void> = [];

    const onSegment = (callback: (segment: CliOutputSegment) => void): void => {
      segmentCallbacks.push(callback);
      if (segmentBuffer.length > 0) {
        for (const buffered of segmentBuffer) {
          callback(buffered);
        }
        segmentBuffer.length = 0;
      }
    };

    const emitSegment = (segment: CliOutputSegment): void => {
      if (segmentCallbacks.length === 0) {
        segmentBuffer.push(segment);
      } else {
        for (const cb of segmentCallbacks) {
          cb(segment);
        }
      }
    };

    // Track whether we received streaming deltas (to skip full assistant.message)
    let receivedDeltas = false;
    // Track whether we received reasoning deltas (to skip full assistant.reasoning)
    let receivedReasoningDeltas = false;
    // Track toolCallId -> toolName for enriched tool.execution_complete handling
    const toolCallIdToName = new Map<string, string>();
    // Track the actual session ID (may differ from our requested one)
    let actualSessionId: string = sessionId;

    // The agentId for permission routing is the sessionId we generate
    // (AgentProcessManager will replace this with the real agentId)
    const agentIdForPermissions = sessionId;

    // Build hooks and permission handler for the session config
    const sessionHooks: SdkSessionHooks = {
      onPreToolUse: async (
        input: SdkPreToolUseInput,
        _invocation: { sessionId: string }
      ): Promise<SdkPreToolUseOutput | void> => {
        return this.permissionBridge.requestToolPermission({
          agentId: agentIdForPermissions,
          toolName: input.toolName,
          toolArgs: input.toolArgs,
        });
      },
    };

    const permissionHandler: SdkPermissionHandler = async (
      request: SdkPermissionRequest,
      _invocation: { sessionId: string }
    ): Promise<SdkPermissionRequestResult> => {
      const { kind, toolCallId, ...details } = request;
      return this.permissionBridge.requestFilePermission({
        agentId: agentIdForPermissions,
        kind,
        toolCallId,
        details: details as Record<string, unknown>,
      });
    };

    // Create or resume session
    let session: SdkSession;
    try {
      if (options.resumeSessionId) {
        // resumeSession(sessionId: string, config?) -- first arg is string
        const resumeConfig: SdkResumeConfig = {
          streaming: true,
          hooks: sessionHooks,
          onPermissionRequest: permissionHandler,
          workingDirectory: options.workingDirectory,
        };

        if (options.model) {
          resumeConfig.model = options.model;
        }

        // Re-provide system message on resume so the SDK has project context
        // even after a session reconnect (ResumeSessionConfig supports this)
        if (options.projectGuidance) {
          resumeConfig.systemMessage = {
            mode: 'append',
            content: options.projectGuidance,
          };
        }

        // Re-provide MCP server config on resume so tools remain available
        // (ResumeSessionConfig supports mcpServers)
        if (options.mcpPort) {
          resumeConfig.mcpServers = {
            ptah: {
              type: 'http',
              url: `http://localhost:${options.mcpPort}`,
              tools: ['*'],
            },
          };
        }

        session = await this.client!.resumeSession(
          options.resumeSessionId,
          resumeConfig
        );
        actualSessionId = session.sessionId;
      } else {
        const sessionConfig: SdkSessionConfig = {
          sessionId,
          streaming: true,
          hooks: sessionHooks,
          onPermissionRequest: permissionHandler,
          workingDirectory: options.workingDirectory,
        };

        if (options.model) {
          sessionConfig.model = options.model;
        }

        // Add system message if project guidance is available
        if (options.projectGuidance) {
          sessionConfig.systemMessage = {
            mode: 'append',
            content: options.projectGuidance,
          };
        }

        // Configure MCP server if port is available
        if (options.mcpPort) {
          sessionConfig.mcpServers = {
            ptah: {
              type: 'http',
              url: `http://localhost:${options.mcpPort}`,
              tools: ['*'],
            },
          };
        }

        session = await this.client!.createSession(sessionConfig);
        actualSessionId = session.sessionId;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitOutput(`[Copilot SDK Error] Failed to create session: ${message}\n`);
      emitSegment({
        type: 'error',
        content: `Failed to create session: ${message}`,
      });

      // Return a failed handle
      return {
        abort: abortController,
        done: Promise.resolve(1),
        onOutput,
        onSegment,
        getSessionId: () => actualSessionId,
      };
    }

    // Wire SDK events -> SdkHandle callbacks
    // session.start -> info segment
    session.on('session.start', (event: SdkSessionEvent) => {
      const model = (event.data['selectedModel'] as string) ?? 'unknown';
      emitOutput(`[Copilot SDK] Session started (model: ${model})\n`);
      emitSegment({
        type: 'info',
        content: `Session started: ${actualSessionId} (model: ${model})`,
      });
    });

    // assistant.message_delta -> text segment (streaming content)
    session.on('assistant.message_delta', (event: SdkSessionEvent) => {
      receivedDeltas = true;
      const delta = event.data['deltaContent'] as string | undefined;
      if (delta) {
        emitOutput(delta);
        emitSegment({ type: 'text', content: delta });
      }
    });

    // assistant.message -> text segment (full message, skip if streaming)
    session.on('assistant.message', (event: SdkSessionEvent) => {
      const content = event.data['content'] as string | undefined;
      if (!receivedDeltas && content) {
        emitOutput(content);
        emitSegment({ type: 'text', content });
      }
    });

    // tool.execution_start -> tool-call segment
    session.on('tool.execution_start', (event: SdkSessionEvent) => {
      const toolName = event.data['toolName'] as string;
      const toolArgs = event.data['arguments'] as unknown;
      const toolCallId = event.data['toolCallId'] as string | undefined;
      const argsStr =
        toolArgs !== undefined && toolArgs !== null
          ? this.summarizeToolArgs(toolName, toolArgs)
          : undefined;

      // Track toolCallId -> toolName for enriched completion handling
      if (toolCallId) {
        toolCallIdToName.set(toolCallId, toolName);
      }

      emitOutput(
        `\n**Tool:** \`${toolName}\`${argsStr ? ` ${argsStr}` : ''}\n`
      );
      emitSegment({
        type: 'tool-call',
        content: '',
        toolName,
        toolArgs: argsStr,
      });
    });

    // tool.execution_complete -> tool-result, command, file-change, or tool-result-error segment
    session.on('tool.execution_complete', (event: SdkSessionEvent) => {
      const success = event.data['success'] as boolean;
      const result = event.data['result'] as
        | { content?: string; detailedContent?: string }
        | undefined;
      const error = event.data['error'] as
        | { message?: string; code?: string }
        | undefined;
      const toolCallId = event.data['toolCallId'] as string | undefined;
      const exitCode = event.data['exitCode'] as number | undefined;

      // Look up tool name from tracking map for enriched segment types
      const toolName = toolCallId
        ? toolCallIdToName.get(toolCallId)
        : undefined;

      if (success && result) {
        const content = result.content ?? '';
        const truncated =
          content.length > 2000
            ? content.substring(0, 2000) + '\n... [truncated]'
            : content;

        // Emit enriched segment types based on tool name
        if (toolName && isShellTool(toolName)) {
          emitOutput(`\n$ ${toolName}\n${truncated}\n`);
          emitSegment({
            type: 'command',
            content: truncated,
            toolName,
            exitCode: exitCode ?? 0,
          });
        } else if (toolName && isFileWriteTool(toolName)) {
          // Detect change kind from content heuristics
          const changeKind = /\b(created|new file)\b/i.test(content)
            ? 'added'
            : /\b(deleted|removed)\b/i.test(content)
            ? 'deleted'
            : 'modified';
          emitOutput(`\n[${changeKind}] ${truncated}\n`);
          emitSegment({
            type: 'file-change',
            content: truncated,
            changeKind,
          });
        } else {
          emitOutput(
            `\n<details><summary>Tool result</summary>\n\n\`\`\`\n${truncated}\n\`\`\`\n</details>\n\n`
          );
          emitSegment({ type: 'tool-result', content: truncated });
        }
      } else if (error) {
        const errorMsg = error.message ?? 'Unknown error';
        emitOutput(`\n**Tool Error:** ${errorMsg}\n`);
        emitSegment({ type: 'tool-result-error', content: errorMsg });
      } else if (!success) {
        emitOutput('\n**Tool Error:** Execution failed\n');
        emitSegment({
          type: 'tool-result-error',
          content: 'Execution failed',
        });
      }
    });

    // session.error -> error segment
    session.on('session.error', (event: SdkSessionEvent) => {
      const errorMsg =
        (event.data['message'] as string) ?? 'Unknown session error';
      emitOutput(`\n[Copilot SDK Error] ${errorMsg}\n`);
      emitSegment({ type: 'error', content: errorMsg });
    });

    // assistant.usage -> info segment (token usage)
    session.on('assistant.usage', (event: SdkSessionEvent) => {
      const model = event.data['model'] as string | undefined;
      const inputTokens = event.data['inputTokens'] as number | undefined;
      const outputTokens = event.data['outputTokens'] as number | undefined;
      const cost = event.data['cost'] as number | undefined;
      const duration = event.data['duration'] as number | undefined;

      const parts: string[] = [];
      if (model) parts.push(`model: ${model}`);
      if (inputTokens) parts.push(`${inputTokens} input`);
      if (outputTokens) parts.push(`${outputTokens} output`);
      if (cost !== undefined) parts.push(`$${cost.toFixed(4)}`);
      if (duration !== undefined)
        parts.push(`${(duration / 1000).toFixed(1)}s`);
      if (parts.length > 0) {
        const usageStr = `Usage: ${parts.join(', ')}`;
        emitOutput(`\n[${usageStr}]\n`);
        emitSegment({ type: 'info', content: usageStr });
      }
    });

    // assistant.reasoning_delta -> thinking segment (streaming reasoning content)
    session.on('assistant.reasoning_delta', (event: SdkSessionEvent) => {
      receivedReasoningDeltas = true;
      const delta = event.data['deltaContent'] as string | undefined;
      if (delta) {
        emitSegment({ type: 'thinking', content: delta });
      }
    });

    // assistant.reasoning -> thinking segment (full reasoning, skip if streaming deltas received)
    session.on('assistant.reasoning', (event: SdkSessionEvent) => {
      const content = event.data['content'] as string | undefined;
      if (!receivedReasoningDeltas && content) {
        emitSegment({ type: 'thinking', content });
      }
    });

    // session.compaction_start -> info segment
    session.on('session.compaction_start', () => {
      emitOutput('\n[Copilot SDK] Context compaction started...\n');
      emitSegment({ type: 'info', content: 'Context compaction started...' });
    });

    // session.compaction_complete -> info segment with token stats
    session.on('session.compaction_complete', (event: SdkSessionEvent) => {
      const tokensBefore = event.data['tokensBefore'] as number | undefined;
      const tokensAfter = event.data['tokensAfter'] as number | undefined;
      const parts: string[] = ['Context compaction complete'];
      if (tokensBefore !== undefined && tokensAfter !== undefined) {
        parts.push(`${tokensBefore} → ${tokensAfter} tokens`);
      }
      const msg = parts.join(': ');
      emitOutput(`\n[Copilot SDK] ${msg}\n`);
      emitSegment({ type: 'info', content: msg });
    });

    // Done promise: resolves when session becomes idle or errors out.
    // `doneResolve` is hoisted so abort/send-error handlers can also resolve it.
    let doneResolved = false;
    let doneResolve: (code: number) => void;
    const done = new Promise<number>((resolve) => {
      doneResolve = resolve;

      session.on('session.idle', () => {
        if (!doneResolved) {
          doneResolved = true;
          resolve(0);
        }
      });

      session.on('session.error', () => {
        if (!doneResolved) {
          doneResolved = true;
          resolve(1);
        }
      });

      // Also resolve on session.shutdown (graceful exit with stats)
      session.on('session.shutdown', (event: SdkSessionEvent) => {
        if (!doneResolved) {
          doneResolved = true;
          const exitCode =
            (event.data['shutdownType'] as string) === 'error' ? 1 : 0;
          resolve(exitCode);
        }
      });
    });

    // Send the task prompt
    const taskPrompt = buildTaskPrompt({
      ...options,
      // Project guidance is already in the system message, don't duplicate
      projectGuidance: options.resumeSessionId
        ? options.projectGuidance
        : undefined,
    });

    // Fire and forget -- errors are caught by the session error handler
    session.send({ prompt: taskPrompt }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      emitOutput(`\n[Copilot SDK Error] Failed to send prompt: ${message}\n`);
      emitSegment({
        type: 'error',
        content: `Failed to send prompt: ${message}`,
      });
      if (!doneResolved) {
        doneResolved = true;
        doneResolve(1);
      }
    });

    // Abort handler: abort the session and cleanup
    const onAbort = (): void => {
      this.permissionBridge.cleanup();
      session.abort().catch(() => {
        // Ignore abort errors -- session may already be destroyed
      });
      session.destroy().catch(() => {
        // Ignore destroy errors
      });
      if (!doneResolved) {
        doneResolved = true;
        doneResolve(1);
      }
    };
    abortController.signal.addEventListener('abort', onAbort);

    return {
      abort: abortController,
      done,
      onOutput,
      onSegment,
      getSessionId: () => actualSessionId,
    };
  }

  /**
   * Ensure the singleton CopilotClient is initialized.
   * Gets GitHub auth token via VS Code auth API, creates the client,
   * and starts it if needed.
   */
  private async ensureClient(binaryPath?: string): Promise<void> {
    if (this.client) return;

    const token = await this.getGitHubToken();

    // Dynamic import to handle the ESM @github/copilot-sdk package.
    // The SDK is imported at runtime (not statically) to:
    // 1. Avoid ESM/CJS module resolution issues at compile time
    // 2. Gracefully handle the case where the SDK is not installed
    // 3. Follow the same pattern as CodexCliAdapter
    const sdkModule = (await import(
      '@github/copilot-sdk'
    )) as unknown as CopilotSdkModule;

    const clientOptions: SdkClientOptions = {
      autoStart: true,
      autoRestart: true,
      logLevel: 'warning',
    };

    if (binaryPath) {
      // On Windows, npm wraps CLIs in .cmd batch scripts that can't be
      // executed by bare spawn() (EINVAL). Resolve to the actual binary.
      clientOptions.cliPath = await resolveWindowsCmd(binaryPath);
    }

    if (token) {
      clientOptions.githubToken = token;
    } else {
      // Fall back to logged-in user authentication (gh CLI or stored tokens)
      clientOptions.useLoggedInUser = true;
    }

    this.client = new sdkModule.CopilotClient(clientOptions);
    await this.client.start();
  }

  /**
   * Get GitHub token via VS Code authentication API.
   * Returns null if no session exists (user hasn't authenticated).
   * Does NOT create a session -- we don't want to prompt the user.
   */
  private async getGitHubToken(): Promise<string | null> {
    try {
      const session = await vscode.authentication.getSession(
        'github',
        ['copilot'],
        { createIfNone: false }
      );
      return session?.accessToken ?? null;
    } catch {
      // Auth API failed -- fall back to useLoggedInUser
      return null;
    }
  }

  /**
   * Summarize tool arguments for concise display in the agent monitor.
   * Extracts key values based on known tool names.
   */
  private summarizeToolArgs(toolName: string, args: unknown): string {
    if (typeof args === 'string') return args;
    if (!args || typeof args !== 'object') return '';

    const obj = args as Record<string, unknown>;
    switch (toolName) {
      case 'read_file':
      case 'write_file':
        return obj['path'] ? `\`${obj['path']}\`` : '';
      case 'run_shell_command':
      case 'bash':
      case 'shell':
        return obj['command'] ? `\`${obj['command']}\`` : '';
      case 'search_file_content':
      case 'grep':
        return obj['pattern'] ? `pattern: "${obj['pattern']}"` : '';
      case 'glob':
      case 'list_directory':
        return obj['pattern'] || obj['path']
          ? `"${(obj['pattern'] ?? obj['path']) as string}"`
          : '';
      case 'edit':
      case 'replace':
        return obj['file_path'] || obj['path']
          ? `\`${(obj['file_path'] ?? obj['path']) as string}\``
          : '';
      default: {
        // Generic: show first string value, truncated
        const firstStr = Object.entries(obj).find(
          ([, v]) => typeof v === 'string'
        );
        if (firstStr) {
          const val = String(firstStr[1]).substring(0, 60);
          return `${firstStr[0]}: "${val}"`;
        }
        return '';
      }
    }
  }

  /**
   * Stop the singleton client. Called on extension deactivation.
   * Cleans up pending permissions and stops the CLI server process.
   */
  async dispose(): Promise<void> {
    this.permissionBridge.cleanup();
    if (this.client) {
      try {
        await this.client.stop();
      } catch {
        // Force stop if graceful shutdown fails
        try {
          await this.client.forceStop();
        } catch {
          // Ignore -- process may already be gone
        }
      }
      this.client = null;
    }
  }
}
