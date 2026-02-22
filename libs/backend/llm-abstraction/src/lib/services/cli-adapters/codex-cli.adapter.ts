/**
 * Codex CLI Adapter
 * TASK_2025_157: Headless Codex CLI agent integration
 * TASK_2025_158: SDK-based execution via @openai/codex-sdk
 *
 * CLI fallback: codex --quiet "task description"
 * SDK path: Codex SDK thread.runStreamed() for in-process execution
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { CliDetectionResult } from '@ptah-extension/shared';
import type {
  CliAdapter,
  CliCommand,
  CliCommandOptions,
  SdkHandle,
} from './cli-adapter.interface';
import { stripAnsiCodes, buildTaskPrompt } from './cli-adapter.utils';

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
  }) => CodexClient;
}

interface CodexClient {
  startThread(options?: {
    workingDirectory?: string;
    skipGitRepoCheck?: boolean;
  }): CodexThread;
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
  | { type: 'mcp_tool_call'; id: string; server: string; tool: string }
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
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const { stdout: pathOutput } = await execFileAsync(whichCmd, ['codex'], {
        timeout: 5000,
      });
      const binaryPath = pathOutput.trim().split('\n')[0];

      let version: string | undefined;
      try {
        const { stdout: versionOutput } = await execFileAsync(
          'codex',
          ['--version'],
          {
            timeout: 5000,
          }
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
    const args: string[] = [];
    const taskPrompt = buildTaskPrompt(options);

    // Use --quiet for non-interactive mode (CLI fallback path)
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

  /**
   * Run task via Codex SDK instead of CLI subprocess.
   *
   * Uses the @openai/codex-sdk to create a thread and stream events.
   * The SDK is ESM-only so we use a cached dynamic import().
   * Abort is achieved via AbortSignal passed to thread.runStreamed().
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    const sdk = await getCodexSdk();
    const codex = new sdk.Codex();

    const thread = codex.startThread({
      workingDirectory: options.workingDirectory,
    });

    const taskPrompt = buildTaskPrompt(options);
    const abortController = new AbortController();

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

          this.handleStreamEvent(event, emitOutput);
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
        return 1;
      }
    })();

    return { abort: abortController, done, onOutput };
  }

  /**
   * Process a single SDK stream event and emit relevant output.
   */
  private handleStreamEvent(
    event: CodexThreadEvent,
    emitOutput: (data: string) => void
  ): void {
    switch (event.type) {
      case 'item.completed': {
        const item = event.item;
        switch (item.type) {
          case 'agent_message':
            if (item.text) {
              emitOutput(item.text + '\n');
            }
            break;
          case 'reasoning':
            if (item.text) {
              emitOutput(`[Reasoning] ${item.text}\n`);
            }
            break;
          case 'command_execution':
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
            break;
          case 'file_change':
            for (const change of item.changes) {
              emitOutput(`[${change.kind}] ${change.path}\n`);
            }
            break;
          case 'error':
            emitOutput(`[Error] ${item.message}\n`);
            break;
          default:
            // Other item types (mcp_tool_call, web_search, todo_list) - no output needed
            break;
        }
        break;
      }
      case 'turn.completed':
        if (event.usage) {
          emitOutput(
            `\n[Usage: ${event.usage.input_tokens} input, ${event.usage.output_tokens} output tokens]\n`
          );
        }
        break;
      case 'turn.failed':
        emitOutput(`[Turn Failed] ${event.error.message}\n`);
        break;
      case 'error':
        emitOutput(`[Stream Error] ${event.message}\n`);
        break;
      default:
        // thread.started, turn.started, item.started, item.updated - no output
        break;
    }
  }
}
