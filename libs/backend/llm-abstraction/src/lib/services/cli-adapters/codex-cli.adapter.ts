/**
 * Codex CLI Adapter
 * TASK_2025_157: Headless Codex CLI agent integration
 * TASK_2025_158: SDK-based execution via @openai/codex-sdk
 * TASK_2025_177: Session resume, progressive streaming, MCP/web_search/todo_list,
 *               toolCallId, reasoning→thinking, listModels
 *
 * CLI fallback: codex --quiet "task description"
 * SDK path: Codex SDK thread.runStreamed() for in-process execution
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
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
} from './cli-adapter.utils';

const execFileAsync = promisify(execFile);

/**
 * Minimal local types for the dynamically imported Codex SDK.
 * These mirror the actual SDK exports but avoid importing ESM at module level.
 */
interface CodexSdkModule {
  Codex: new (options?: {
    apiKey?: string;
    env?: Record<string, string>;
    config?: Record<string, unknown>;
    codexPathOverride?: string;
  }) => CodexClient;
}

interface CodexThreadOptions {
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  model?: string;
  approvalPolicy?: 'never' | 'on-request' | 'on-failure';
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
}

interface CodexClient {
  startThread(options?: CodexThreadOptions): CodexThread;
  resumeThread(threadId: string, options?: CodexThreadOptions): CodexThread;
}

interface CodexThread {
  runStreamed(
    input: string,
    turnOptions?: { signal?: AbortSignal }
  ): Promise<{ events: AsyncGenerator<CodexThreadEvent> }>;
}

/**
 * Union of SDK thread events we handle.
 * Matches the actual @openai/codex-sdk ThreadEvent type structure.
 */
type CodexThreadEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | {
      type: 'turn.completed';
      usage: {
        input_tokens: number;
        cached_input_tokens: number;
        output_tokens: number;
      };
    }
  | { type: 'turn.failed'; error: { message: string } }
  | { type: 'item.started'; item: CodexThreadItem }
  | { type: 'item.updated'; item: CodexThreadItem }
  | { type: 'item.completed'; item: CodexThreadItem }
  | { type: 'error'; message: string };

type CodexThreadItem =
  | { type: 'agent_message'; id: string; text: string }
  | { type: 'reasoning'; id: string; text: string }
  | {
      type: 'command_execution';
      id: string;
      command: string;
      aggregated_output: string;
      status: string;
      exit_code?: number;
    }
  | {
      type: 'file_change';
      id: string;
      changes: Array<{ path: string; kind: string }>;
      status: string;
    }
  | {
      type: 'mcp_tool_call';
      id: string;
      server: string;
      tool: string;
      arguments?: string;
      result?: string;
      error?: string;
      status: string;
    }
  | { type: 'web_search'; id: string; query: string }
  | {
      type: 'todo_list';
      id: string;
      items: Array<{ text: string; completed: boolean }>;
    }
  | { type: 'error'; id: string; message: string };

/**
 * Cached successful import of the ESM-only Codex SDK.
 * Only successful imports are cached; failures are not stored
 * so that a transient failure does not permanently break the SDK path.
 */
let codexSdkModule: CodexSdkModule | null = null;

/**
 * Lazily import the ESM-only @openai/codex-sdk package.
 * Only caches successful imports so a failed import can be retried.
 */
async function getCodexSdk(): Promise<CodexSdkModule> {
  if (codexSdkModule) {
    return codexSdkModule;
  }
  try {
    const mod = (await import('@openai/codex-sdk')) as CodexSdkModule;
    codexSdkModule = mod;
    return mod;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to load @openai/codex-sdk: ${message}. ` +
        `Ensure the package is installed: npm install @openai/codex-sdk`
    );
  }
}

export class CodexCliAdapter implements CliAdapter {
  readonly name = 'codex' as const;
  readonly displayName = 'Codex CLI';

  async detect(): Promise<CliDetectionResult> {
    try {
      const binaryPath = await resolveCliPath('codex');
      if (!binaryPath) {
        return { cli: 'codex', installed: false, supportsSteer: false };
      }

      let version: string | undefined;
      try {
        const { stdout: versionOutput } = await execFileAsync(
          binaryPath,
          ['--version'],
          { timeout: 5000 }
        );
        version = versionOutput.trim().split('\n')[0];
      } catch {
        // Version check failed
      }

      // Also verify the SDK npm package is importable (needed for runSdk path)
      let sdkAvailable = false;
      try {
        await getCodexSdk();
        sdkAvailable = true;
      } catch {
        // SDK not available - CLI binary exists but npm package is missing
      }

      return {
        cli: 'codex',
        installed: true,
        path: binaryPath,
        version: sdkAvailable
          ? version
          : version
          ? `${version} (SDK unavailable - install @openai/codex-sdk)`
          : 'SDK unavailable - install @openai/codex-sdk',
        supportsSteer: false,
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
    const taskPrompt = buildTaskPrompt(options);

    // Use `exec` subcommand for non-interactive mode
    // Flags: --full-auto (auto-approve + sandbox), --ephemeral (no session persistence)
    const args = ['exec', '--full-auto', '--ephemeral', taskPrompt];

    if (options.model) {
      args.push('--model', options.model);
    }

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

  /**
   * List available models for Codex.
   * Static list of known Codex-compatible models.
   */
  async listModels(): Promise<CliModelInfo[]> {
    return [
      { id: 'o4-mini', name: 'O4 Mini' },
      { id: 'codex-mini', name: 'Codex Mini' },
      { id: 'o3', name: 'O3' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
    ];
  }

  /**
   * Run task via Codex SDK instead of CLI subprocess.
   *
   * Uses the @openai/codex-sdk to create a thread and stream events.
   * The SDK is ESM-only so we use a cached dynamic import().
   * Abort is achieved via AbortSignal passed to thread.runStreamed().
   *
   * TASK_2025_177: Supports session resume via resumeThread(), progressive
   * streaming via item.started/updated, toolCallId emission, and
   * reasoning→thinking mapping.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    const sdk = await getCodexSdk();

    // Pass MCP server config and codexPathOverride through Codex SDK
    const codexOptions: {
      config?: Record<string, unknown>;
      codexPathOverride?: string;
    } = {};
    if (options.mcpPort) {
      codexOptions.config = {
        mcp_servers: {
          ptah: {
            url: `http://localhost:${options.mcpPort}`,
          },
        },
      };
    }
    if (options.binaryPath) {
      codexOptions.codexPathOverride = options.binaryPath;
    }

    const codex = new sdk.Codex(codexOptions);

    // Thread options with model and approval policy
    const threadOptions: CodexThreadOptions = {
      workingDirectory: options.workingDirectory,
      approvalPolicy: 'never', // Auto-approve in Ptah trusted context
    };
    if (options.model) {
      threadOptions.model = options.model;
    }

    // Session resume or new thread
    const thread = options.resumeSessionId
      ? codex.resumeThread(options.resumeSessionId, threadOptions)
      : codex.startThread(threadOptions);

    // Codex SDK has no native system message channel (unlike Gemini's GEMINI_SYSTEM_MD
    // or Copilot's sessionConfig.systemMessage). The systemPrompt is intentionally
    // included in buildTaskPrompt() as the only way to inject system context.
    const taskPrompt = buildTaskPrompt(options);
    const abortController = new AbortController();

    // Captured thread ID for session resume
    let capturedThreadId: string | undefined;

    // Delta tracking: track last-seen text per item.id for progressive streaming
    const itemTextTracker = new Map<string, string>();
    // Track which item IDs have emitted deltas (skip full text on completion)
    const itemsWithDeltas = new Set<string>();

    // Output buffering: buffer output until callbacks are registered,
    // then flush buffered data and switch to direct delivery.
    const outputBuffer: string[] = [];
    const outputCallbacks: Array<(data: string) => void> = [];

    const onOutput = (callback: (data: string) => void): void => {
      outputCallbacks.push(callback);
      // Flush any buffered output to the newly registered callback
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

    // Structured segment buffering (same pattern as output)
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

    // Start streamed execution and iterate events
    const done = (async (): Promise<number> => {
      try {
        const streamedTurn = await thread.runStreamed(taskPrompt, {
          signal: abortController.signal,
        });

        for await (const event of streamedTurn.events) {
          if (abortController.signal.aborted) {
            return 1;
          }

          // Capture thread ID from thread.started event
          if (event.type === 'thread.started') {
            capturedThreadId = event.thread_id;
          }

          this.handleStreamEvent(
            event,
            emitOutput,
            emitSegment,
            itemTextTracker,
            itemsWithDeltas
          );
        }

        return 0;
      } catch (error: unknown) {
        // AbortError is expected when we cancel - treat as non-error exit
        if (
          error instanceof Error &&
          (error.name === 'AbortError' || abortController.signal.aborted)
        ) {
          return 1;
        }

        const errorMessage =
          error instanceof Error ? error.message : String(error);
        emitOutput(`\n[Codex SDK Error] ${errorMessage}\n`);
        emitSegment({
          type: 'error',
          content: `Codex SDK Error: ${errorMessage}`,
        });
        return 1;
      }
    })();

    return {
      abort: abortController,
      done,
      onOutput,
      onSegment,
      getSessionId: () => capturedThreadId,
      setAgentId: () => {
        // No-op: Codex SDK has no permission hooks that need agentId routing
      },
    };
  }

  /**
   * Process a single SDK stream event and emit relevant output + structured segments.
   *
   * TASK_2025_177: Handles item.started (early tool-call segments), item.updated
   * (progressive text/thinking deltas), and enhanced item.completed with toolCallId,
   * MCP tool calls, web_search, and todo_list.
   */
  private handleStreamEvent(
    event: CodexThreadEvent,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
    itemTextTracker: Map<string, string>,
    itemsWithDeltas: Set<string>
  ): void {
    switch (event.type) {
      case 'item.started': {
        const item = event.item;
        switch (item.type) {
          case 'command_execution':
            // Emit early tool-call for progressive rendering.
            // Use generic 'Shell' as toolName; full command goes in toolArgs.
            emitSegment({
              type: 'tool-call',
              toolName: 'Shell',
              toolArgs: item.command,
              content: '',
              toolCallId: item.id,
            });
            break;
          case 'mcp_tool_call':
            emitSegment({
              type: 'tool-call',
              toolName: `${item.server}:${item.tool}`,
              content: item.arguments ?? '',
              toolCallId: item.id,
            });
            break;
          default:
            break;
        }
        break;
      }

      case 'item.updated': {
        const item = event.item;
        switch (item.type) {
          case 'agent_message': {
            const previousText = itemTextTracker.get(item.id) ?? '';
            if (item.text.startsWith(previousText)) {
              // Normal append — emit only the new delta
              const delta = item.text.slice(previousText.length);
              if (delta) {
                emitOutput(delta);
                emitSegment({ type: 'text', content: delta });
                itemTextTracker.set(item.id, item.text);
                itemsWithDeltas.add(item.id);
              }
            } else {
              // Text was replaced (not appended) — emit full text as replacement
              emitOutput(item.text);
              emitSegment({ type: 'text', content: item.text });
              itemTextTracker.set(item.id, item.text);
              itemsWithDeltas.add(item.id);
            }
            break;
          }
          case 'reasoning': {
            const previousText = itemTextTracker.get(item.id) ?? '';
            if (item.text.startsWith(previousText)) {
              const delta = item.text.slice(previousText.length);
              if (delta) {
                emitOutput(delta);
                emitSegment({ type: 'thinking', content: delta });
                itemTextTracker.set(item.id, item.text);
                itemsWithDeltas.add(item.id);
              }
            } else {
              // Text was replaced — emit full text as replacement
              emitOutput(item.text);
              emitSegment({ type: 'thinking', content: item.text });
              itemTextTracker.set(item.id, item.text);
              itemsWithDeltas.add(item.id);
            }
            break;
          }
          default:
            break;
        }
        break;
      }

      case 'item.completed': {
        const item = event.item;
        switch (item.type) {
          case 'agent_message':
            // Skip full text emission if deltas were sent via item.updated
            if (!itemsWithDeltas.has(item.id)) {
              if (item.text) {
                emitOutput(item.text + '\n');
                emitSegment({ type: 'text', content: item.text });
              }
            }
            // Clean up trackers
            itemTextTracker.delete(item.id);
            itemsWithDeltas.delete(item.id);
            break;
          case 'reasoning':
            // Skip full text emission if deltas were sent via item.updated
            if (!itemsWithDeltas.has(item.id)) {
              if (item.text) {
                emitOutput(`[Thinking] ${item.text}\n`);
                emitSegment({ type: 'thinking', content: item.text });
              }
            }
            // Clean up trackers
            itemTextTracker.delete(item.id);
            itemsWithDeltas.delete(item.id);
            break;
          case 'command_execution': {
            emitOutput(`$ ${item.command}\n`);
            if (item.aggregated_output) {
              emitOutput(item.aggregated_output);
              if (!item.aggregated_output.endsWith('\n')) {
                emitOutput('\n');
              }
            }
            if (item.exit_code !== undefined && item.exit_code !== 0) {
              emitOutput(`[exit code: ${item.exit_code}]\n`);
            }
            emitSegment({
              type: 'command',
              content: item.aggregated_output ?? '',
              toolName: item.command,
              exitCode: item.exit_code,
              toolCallId: item.id,
            });
            break;
          }
          case 'file_change':
            for (const change of item.changes) {
              emitOutput(`[${change.kind}] ${change.path}\n`);
              emitSegment({
                type: 'file-change',
                content: change.path,
                changeKind: change.kind,
                toolCallId: item.id,
              });
            }
            break;
          case 'mcp_tool_call':
            if (item.error) {
              emitOutput(
                `[MCP Error] ${item.server}:${item.tool}: ${item.error}\n`
              );
              emitSegment({
                type: 'tool-result-error',
                content: item.error,
                toolCallId: item.id,
              });
            } else if (item.result) {
              emitOutput(`[MCP Result] ${item.server}:${item.tool}\n`);
              emitSegment({
                type: 'tool-result',
                content: item.result,
                toolCallId: item.id,
              });
            } else {
              // Completed with neither result nor error (e.g., cancelled/timed out)
              emitOutput(
                `[MCP] ${item.server}:${item.tool} (${
                  item.status || 'completed'
                })\n`
              );
              emitSegment({
                type: 'tool-result',
                content: `(${item.status || 'completed'})`,
                toolCallId: item.id,
              });
            }
            break;
          case 'web_search':
            emitOutput(`[Web Search] ${item.query}\n`);
            emitSegment({
              type: 'info',
              content: `Web search: ${item.query}`,
            });
            break;
          case 'todo_list': {
            const formatted = item.items
              .map((i) => `${i.completed ? '[x]' : '[ ]'} ${i.text}`)
              .join('\n');
            emitOutput(`[Todo List]\n${formatted}\n`);
            emitSegment({
              type: 'info',
              content: `Todo list:\n${formatted}`,
            });
            break;
          }
          case 'error':
            emitOutput(`[Error] ${item.message}\n`);
            emitSegment({ type: 'error', content: item.message });
            break;
          default:
            break;
        }
        break;
      }
      case 'turn.completed':
        if (event.usage) {
          const usageStr = `Usage: ${event.usage.input_tokens} input, ${event.usage.output_tokens} output tokens`;
          emitOutput(`\n[${usageStr}]\n`);
          emitSegment({ type: 'info', content: usageStr });
        }
        break;
      case 'turn.failed':
        emitOutput(`[Turn Failed] ${event.error.message}\n`);
        emitSegment({
          type: 'error',
          content: `Turn Failed: ${event.error.message}`,
        });
        break;
      case 'error':
        emitOutput(`[Stream Error] ${event.message}\n`);
        emitSegment({ type: 'error', content: event.message });
        break;
      default:
        // thread.started handled in runSdk() for thread ID capture
        break;
    }
  }
}
