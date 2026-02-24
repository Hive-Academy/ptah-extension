/**
 * Gemini CLI Adapter
 * TASK_2025_157: Headless Gemini CLI agent integration
 *
 * Uses --output-format stream-json for structured JSONL event streaming.
 * Events: init, message, tool_use, tool_result, error, result
 *
 * Implements runSdk() so AgentProcessManager uses the SDK path:
 * - Spawns gemini as a child process with structured output
 * - Parses JSONL events and emits human-readable output
 * - Uses --yolo for auto-approve (automated orchestration context)
 *
 * See: https://geminicli.com/docs/
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
import {
  stripAnsiCodes,
  buildTaskPrompt,
  resolveCliPath,
  spawnCli,
} from './cli-adapter.utils';

const execFileAsync = promisify(execFile);

/**
 * Gemini CLI stream-json event types.
 * See: https://geminicli.com/docs/ (--output-format stream-json)
 */
interface GeminiStreamEvent {
  type: 'init' | 'message' | 'tool_use' | 'tool_result' | 'error' | 'result';
  /** Session/model info (init event) */
  model?: string;
  session_id?: string;
  /** Message content (message event) */
  content?: string;
  role?: string;
  /** Tool invocation details (tool_use event) */
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_call_id?: string;
  /** Tool result (tool_result event) */
  output?: string;
  status?: string;
  /** Error details (error event) */
  message?: string;
  code?: number;
  /** Final result (result event) */
  response?: string;
  stats?: {
    input_tokens?: number;
    output_tokens?: number;
    duration_ms?: number;
  };
}

export class GeminiCliAdapter implements CliAdapter {
  readonly name = 'gemini' as const;
  readonly displayName = 'Gemini CLI';

  async detect(): Promise<CliDetectionResult> {
    try {
      const binaryPath = await resolveCliPath('gemini');
      if (!binaryPath) {
        return { cli: 'gemini', installed: false, supportsSteer: false };
      }

      // Try to get version using the resolved path
      let version: string | undefined;
      try {
        const { stdout: versionOutput } = await execFileAsync(
          binaryPath,
          ['--version'],
          { timeout: 5000 }
        );
        version = versionOutput.trim().split('\n')[0];
      } catch {
        // Version check failed, CLI still usable
      }

      return {
        cli: 'gemini',
        installed: true,
        path: binaryPath,
        version,
        supportsSteer: false,
      };
    } catch {
      return {
        cli: 'gemini',
        installed: false,
        supportsSteer: false,
      };
    }
  }

  /**
   * Build command for the raw CLI spawn fallback path.
   * Used only when runSdk() is not available.
   */
  buildCommand(options: CliCommandOptions): CliCommand {
    const taskPrompt = buildTaskPrompt(options);
    return {
      binary: 'gemini',
      args: ['-p', taskPrompt, '--output-format', 'text'],
    };
  }

  supportsSteer(): boolean {
    return false;
  }

  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }

  /**
   * Run task via Gemini CLI with structured JSONL output.
   *
   * Spawns: gemini --prompt= --output-format stream-json --yolo
   * Writes the task prompt to stdin (avoids Windows shell quoting issues).
   * Parses JSONL events line-by-line and emits readable output.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    const taskPrompt = buildTaskPrompt(options);
    const abortController = new AbortController();

    // Prompt is piped via stdin to avoid Windows shell quoting issues.
    // Gemini CLI: "-p ... Appended to input on stdin (if any)."
    // So we use --prompt="" for headless mode and write the real prompt to stdin.
    const args = [
      '--prompt=', // Headless mode trigger — actual prompt comes from stdin
      '--output-format',
      'stream-json',
      '--yolo', // Auto-approve all tool calls (orchestrated context)
    ];

    // Add model if specified
    if (options.model) {
      args.push('--model', options.model);
    }

    // Output buffering (same pattern as Codex/VS Code LM adapters)
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

    // Spawn using cross-spawn — transparent .cmd handling on Windows
    const binary = options.binaryPath ?? 'gemini';
    const child = spawnCli(binary, args, {
      cwd: options.workingDirectory,
    });

    // Explicit UTF-8 encoding prevents Buffer concatenation issues
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    // Write prompt to stdin then close — Gemini CLI reads stdin and appends
    // it to the -p prompt. Since we pass -p without a value, stdin IS the prompt.
    child.stdin?.write(taskPrompt + '\n');
    child.stdin?.end();

    // Abort handler: kill the child process
    const onAbort = (): void => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };
    abortController.signal.addEventListener('abort', onAbort);

    // JSONL line buffer for incremental parsing
    let lineBuf = '';

    child.stdout?.on('data', (data: string) => {
      lineBuf += data;
      const lines = lineBuf.split('\n');
      // Keep the last incomplete line in the buffer
      lineBuf = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        this.handleJsonLine(trimmed, emitOutput);
      }
    });

    // Stderr: emit as-is (error output, warnings)
    child.stderr?.on('data', (data: string) => {
      // Filter out ANSI noise but keep meaningful errors
      const cleaned = stripAnsiCodes(data).trim();
      if (cleaned) {
        emitOutput(`[stderr] ${cleaned}\n`);
      }
    });

    // Done promise: resolves when the process exits
    const done = new Promise<number>((resolve) => {
      child.on('close', (code, signal) => {
        abortController.signal.removeEventListener('abort', onAbort);
        // Flush remaining line buffer
        if (lineBuf.trim()) {
          this.handleJsonLine(lineBuf.trim(), emitOutput);
          lineBuf = '';
        }
        resolve(code ?? (signal ? 1 : 0));
      });

      child.on('error', (err) => {
        abortController.signal.removeEventListener('abort', onAbort);
        emitOutput(`\n[Gemini CLI Error] ${err.message}\n`);
        resolve(1);
      });
    });

    return { abort: abortController, done, onOutput };
  }

  /**
   * Parse a single JSONL line from Gemini's stream-json output
   * and emit human-readable text.
   */
  private handleJsonLine(
    line: string,
    emitOutput: (data: string) => void
  ): void {
    let event: GeminiStreamEvent;
    try {
      event = JSON.parse(line) as GeminiStreamEvent;
    } catch {
      // Not valid JSON — could be plain text fallback or partial output
      // Emit as-is if it looks meaningful
      if (line.length > 0 && !line.startsWith('{')) {
        emitOutput(line + '\n');
      }
      return;
    }

    switch (event.type) {
      case 'init':
        if (event.model) {
          emitOutput(`[Model: ${event.model}]\n`);
        }
        break;

      case 'message':
        // Main content from the model
        if (event.content) {
          emitOutput(event.content);
        }
        break;

      case 'tool_use':
        // Agent is calling a tool
        if (event.tool_name) {
          const inputSummary = event.tool_input
            ? ` ${this.summarizeToolInput(event.tool_name, event.tool_input)}`
            : '';
          emitOutput(`\n**Tool:** \`${event.tool_name}\`${inputSummary}\n`);
        }
        break;

      case 'tool_result':
        // Tool execution result
        if (event.output) {
          // Truncate long tool output for readability
          const output =
            event.output.length > 2000
              ? event.output.substring(0, 2000) + '\n... [truncated]'
              : event.output;
          const status =
            event.status && event.status !== 'success'
              ? ` (${event.status})`
              : '';
          emitOutput(
            `\n<details><summary>Tool result${status}</summary>\n\n\`\`\`\n${output}\n\`\`\`\n</details>\n\n`
          );
        }
        break;

      case 'error':
        if (event.message) {
          emitOutput(
            `\n**Error${event.code ? ` (${event.code})` : ''}:** ${
              event.message
            }\n`
          );
        }
        break;

      case 'result':
        // Final result with stats
        if (event.stats) {
          const { input_tokens, output_tokens, duration_ms } = event.stats;
          const parts: string[] = [];
          if (input_tokens) parts.push(`${input_tokens} input`);
          if (output_tokens) parts.push(`${output_tokens} output`);
          if (duration_ms) parts.push(`${(duration_ms / 1000).toFixed(1)}s`);
          if (parts.length > 0) {
            emitOutput(`\n[Usage: ${parts.join(', ')}]\n`);
          }
        }
        break;

      default:
        // Unknown event type — ignore silently
        break;
    }
  }

  /**
   * Summarize tool input for concise display.
   * Shows key details without dumping full JSON.
   */
  private summarizeToolInput(
    toolName: string,
    input: Record<string, unknown>
  ): string {
    switch (toolName) {
      case 'read_file':
      case 'write_file':
        return input['path'] ? `\`${input['path']}\`` : '';
      case 'run_shell_command':
        return input['command'] ? `\`${input['command']}\`` : '';
      case 'search_file_content':
        return input['pattern'] ? `pattern: "${input['pattern']}"` : '';
      case 'glob':
        return input['pattern'] ? `"${input['pattern']}"` : '';
      case 'list_directory':
        return input['path'] ? `\`${input['path']}\`` : '';
      case 'web_fetch':
        return input['url'] ? `${input['url']}` : '';
      case 'google_web_search':
        return input['query'] ? `"${input['query']}"` : '';
      case 'replace':
        return input['file_path'] ? `\`${input['file_path']}\`` : '';
      default: {
        // Generic: show first string value
        const firstStr = Object.entries(input).find(
          ([, v]) => typeof v === 'string'
        );
        return firstStr
          ? `${firstStr[0]}: "${String(firstStr[1]).substring(0, 60)}"`
          : '';
      }
    }
  }
}
