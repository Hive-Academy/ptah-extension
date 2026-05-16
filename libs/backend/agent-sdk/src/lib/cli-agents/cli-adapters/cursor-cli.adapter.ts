/**
 * Cursor CLI Adapter
 *
 * Uses --output-format stream-json for structured JSONL event streaming.
 * Events: init, assistant, thinking, tool_call, result, error
 *
 * Invocation: cursor agent -p "<prompt>" --output-format stream-json --trust --force
 * Auth: handled by Cursor's logged-in account (--trust bypasses confirmations)
 * MCP: writes {workingDir}/.cursor/mcp.json before spawn; cleaned up on exit
 *
 * NOTE: Exact stream-json field names are based on community adapter
 * reverse-engineering. See // TODO comments in the JSONL parser.
 */
import { execFile } from 'child_process';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
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
  spawnCli,
} from './cli-adapter.utils';

const execFileAsync = promisify(execFile);

/**
 * Cursor agent CLI stream-json event types.
 * TODO: verify field names against live cursor agent output — these are based
 * on community adapter reverse-engineering and may differ in production builds.
 */
interface CursorStreamEvent {
  type: 'init' | 'assistant' | 'thinking' | 'tool_call' | 'result' | 'error';
  /** Session info (init event) */
  session_id?: string;
  model?: string;
  /** Main text output (assistant event) */
  content?: string;
  /** Reasoning delta (thinking event) */
  delta?: string;
  /** Tool invocation (tool_call event) */
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  status?: 'in_progress' | 'completed';
  output?: string;
  /** TODO: verify — may indicate tool error in completed tool_call events */
  error?: boolean | string;
  /** Error (error event) */
  message?: string;
  code?: number;
  /** Final stats (result event) */
  stats?: {
    input_tokens?: number;
    output_tokens?: number;
    duration_ms?: number;
  };
}

export class CursorCliAdapter implements CliAdapter {
  readonly name = 'cursor' as const;
  readonly displayName = 'Cursor Agent CLI';
  /** MCP is configured via {workingDir}/.cursor/mcp.json before each spawn */
  readonly supportsMcp = true;

  async detect(): Promise<CliDetectionResult> {
    try {
      // IMPORTANT: resolve 'cursor-agent' (headless CLI), NOT 'cursor' (GUI IDE).
      // On Windows, `cursor` on PATH points to the Cursor IDE Electron app;
      // passing CLI flags to it causes "not in list of known options" warnings
      // and launches the IDE instead of running headless.
      const binaryPath = await resolveCliPath('cursor-agent');
      if (!binaryPath) {
        return { cli: 'cursor', installed: false, supportsSteer: false };
      }

      let version: string | undefined;
      try {
        const { stdout: versionOutput } = await execFileAsync(
          binaryPath,
          ['--version'],
          { timeout: 5000 },
        );
        version = versionOutput.trim().split(/\r?\n/)[0];
      } catch {
        // Version check failed, CLI still usable
      }

      return {
        cli: 'cursor',
        installed: true,
        path: binaryPath,
        version,
        supportsSteer: false,
      };
    } catch {
      return {
        cli: 'cursor',
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
      binary: 'cursor-agent',
      args: [
        '--output-format',
        'stream-json',
        '--trust',
        '--force',
        '-p',
        taskPrompt,
      ],
    };
  }

  supportsSteer(): boolean {
    return false;
  }

  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }

  /** Curated Cursor Agent CLI model list */
  private static readonly CURSOR_MODELS: CliModelInfo[] = [
    { id: 'cursor-fast', name: 'Cursor Fast' },
    { id: 'cursor-slow', name: 'Cursor Slow' },
  ];

  async listModels(): Promise<CliModelInfo[]> {
    return CursorCliAdapter.CURSOR_MODELS;
  }

  /**
   * Configure Ptah MCP server in {workingDir}/.cursor/mcp.json.
   * Cursor reads workspace-level MCP config from this file at startup.
   * Non-fatal: errors are silently caught.
   */
  private async configureMcpServer(
    workingDirectory: string,
    port: number,
  ): Promise<void> {
    try {
      const cursorDir = join(workingDirectory, '.cursor');
      const mcpPath = join(cursorDir, 'mcp.json');

      let config: Record<string, unknown> = {};
      try {
        const content = await readFile(mcpPath, 'utf8');
        config = JSON.parse(content) as Record<string, unknown>;
      } catch {
        // File doesn't exist or invalid JSON — start fresh
      }

      const mcpServers =
        (config['mcpServers'] as Record<string, unknown>) || {};

      // Idempotency: skip write if already configured with the same port
      const existing = mcpServers['ptah'] as
        | Record<string, unknown>
        | undefined;
      if (existing?.['url'] === `http://localhost:${port}`) {
        return;
      }

      mcpServers['ptah'] = {
        url: `http://localhost:${port}`,
      };
      config['mcpServers'] = mcpServers;

      await mkdir(cursorDir, { recursive: true });
      await writeFile(mcpPath, JSON.stringify(config, null, 2), 'utf8');
    } catch {
      // Non-fatal — MCP tools won't be available but agent still runs
    }
  }

  /**
   * Remove ptah MCP entry from {workingDir}/.cursor/mcp.json.
   * Called after process exits to avoid stale port references.
   * Non-fatal: errors are silently caught.
   */
  private async cleanupMcpEntry(workingDirectory: string): Promise<void> {
    try {
      const mcpPath = join(workingDirectory, '.cursor', 'mcp.json');
      const content = await readFile(mcpPath, 'utf8');
      const config = JSON.parse(content) as Record<string, unknown>;
      const mcpServers = config['mcpServers'] as
        | Record<string, unknown>
        | undefined;
      if (!mcpServers?.['ptah']) return;

      delete mcpServers['ptah'];
      if (Object.keys(mcpServers).length === 0) {
        delete config['mcpServers'];
      }
      await writeFile(mcpPath, JSON.stringify(config, null, 2), 'utf8');
    } catch {
      // Non-fatal — file may not exist or never had a ptah entry
    }
  }

  /**
   * Run task via Cursor agent CLI with structured JSONL output.
   *
   * Spawns: cursor agent --output-format stream-json --trust --force -p <prompt>
   * System prompt is prepended to the task prompt (no native env-var mechanism).
   * Parses JSONL events line-by-line and emits readable output.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    // Configure Ptah MCP server in {workingDir}/.cursor/mcp.json before spawning.
    if (options.mcpPort && options.workingDirectory) {
      await this.configureMcpServer(options.workingDirectory, options.mcpPort);
    }

    // Build full task prompt including system prompt/guidance (prepended).
    // Cursor has no native system-prompt env-var mechanism, so we use the
    // standard buildTaskPrompt() path which prepends systemPrompt/projectGuidance.
    const taskPrompt = buildTaskPrompt(options);
    const abortController = new AbortController();

    // Session ID captured from init event (closure scoped per invocation)
    let capturedSessionId: string | undefined;

    const args = [
      '--output-format',
      'stream-json',
      '--trust', // Bypass workspace confirmation prompts
      '--force', // Force non-interactive execution
      '-p',
      '', // Prompt delivered via stdin — avoids Windows 8191-char argument limit
    ];

    // Resume mode: pass --resume <id> to load prior session context
    if (options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId);
    }

    // Add model if specified
    if (options.model) {
      args.push('--model', options.model);
    }

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

    // Spawn using cross-spawn — transparent .cmd handling on Windows.
    // No `needsConsole: true` because Cursor does not use node-pty/ConPTY
    // internally for shell execution (Gemini is the only adapter that does).
    // Cursor's tool execution goes through its own internal subprocess machinery
    // that does not call AttachConsole(), so the default piped stdio with
    // CREATE_NO_WINDOW is fine on Windows. Setting `needsConsole: true`
    // unnecessarily would allocate an extra (hidden) console window per spawn.
    const binary = options.binaryPath ?? 'cursor-agent';
    const child = spawnCli(binary, args, {
      cwd: options.workingDirectory,
    });

    // Explicit UTF-8 encoding prevents Buffer concatenation issues
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    // Deliver prompt via stdin then close (avoids Windows 8191-char argument limit).
    // Resume mode: Cursor loads session context via --resume; send a short continuation
    // prompt to avoid re-triggering the full original task.
    if (options.resumeSessionId) {
      child.stdin?.write(
        'Continue working on the previous task. Pick up where you left off.\n',
      );
    } else {
      child.stdin?.write(taskPrompt + '\n');
    }
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
      // Cross-platform line splitting: handle both \n (Unix) and \r\n (Windows).
      const lines = lineBuf.split(/\r?\n/);
      // Keep the last incomplete line in the buffer
      lineBuf = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const sessionId = this.handleJsonLine(trimmed, emitOutput, emitSegment);
        if (sessionId) {
          capturedSessionId = sessionId;
        }
      }
    });

    child.stderr?.on('data', (data: string) => {
      const cleaned = stripAnsiCodes(data).trim();
      if (!cleaned) return;

      emitOutput(`[stderr] ${cleaned}\n`);
      const isError =
        /\b(error|fail(ed)?|exception|denied|unauthorized|refused|timeout|abort|crash|panic|fatal)\b/i.test(
          cleaned,
        );
      emitSegment({ type: isError ? 'error' : 'info', content: cleaned });
    });

    // Done promise: resolves when the process exits
    const done = new Promise<number>((resolve) => {
      child.on('close', (code, signal) => {
        abortController.signal.removeEventListener('abort', onAbort);
        // Flush remaining line buffer
        if (lineBuf.trim()) {
          const sessionId = this.handleJsonLine(
            lineBuf.trim(),
            emitOutput,
            emitSegment,
          );
          if (sessionId) {
            capturedSessionId = sessionId;
          }
          lineBuf = '';
        }
        resolve(code ?? (signal ? 1 : 0));
      });

      child.on('error', (err) => {
        abortController.signal.removeEventListener('abort', onAbort);
        emitOutput(`\n[Cursor CLI Error] ${err.message}\n`);
        emitSegment({
          type: 'error',
          content: `Cursor CLI Error: ${err.message}`,
        });
        resolve(1);
      });
    });

    // Clean up workspace MCP config after process exits
    done
      .then(() => {
        if (options.mcpPort && options.workingDirectory) {
          void this.cleanupMcpEntry(options.workingDirectory);
        }
      })
      .catch(() => {
        /* non-fatal */
      });

    return {
      abort: abortController,
      done,
      onOutput,
      onSegment,
      getSessionId: () => capturedSessionId,
    };
  }

  /**
   * Parse a single JSONL line from Cursor's stream-json output
   * and emit human-readable text + structured segments.
   *
   * TODO: verify all field names against live cursor agent output — based on
   * community adapter reverse-engineering and may differ in production builds.
   */
  private handleJsonLine(
    line: string,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
  ): string | undefined {
    let event: CursorStreamEvent;
    try {
      event = JSON.parse(line) as CursorStreamEvent;
    } catch {
      // Not valid JSON — emit as-is if it looks meaningful
      if (line.length > 0 && !line.startsWith('{')) {
        emitOutput(line + '\n');
        emitSegment({ type: 'text', content: line });
      }
      return undefined;
    }

    switch (event.type) {
      case 'init': {
        let sessionId: string | undefined;
        if (event.model) {
          emitOutput(`[Model: ${event.model}]\n`);
          emitSegment({ type: 'info', content: `Model: ${event.model}` });
        }
        if (event.session_id && typeof event.session_id === 'string') {
          const trimmed = event.session_id.trim();
          if (trimmed) {
            sessionId = trimmed;
            emitOutput(`[Session: ${trimmed}]\n`);
            emitSegment({ type: 'info', content: `Session: ${trimmed}` });
          }
        }
        return sessionId;
      }

      case 'assistant':
        // Main text output from the model
        if (event.content) {
          emitOutput(event.content);
          emitSegment({ type: 'text', content: event.content });
        }
        break;

      case 'thinking':
        // Reasoning delta — emit as faint info (not surfaced as primary text)
        if (event.delta) {
          emitSegment({ type: 'info', content: `[thinking] ${event.delta}` });
        }
        break;

      case 'tool_call':
        // Tool invocation — handles both in_progress and completed phases
        if (event.name) {
          if (event.status === 'in_progress' || event.status === undefined) {
            const inputSummary = event.input
              ? ` ${this.summarizeToolInput(event.name, event.input)}`
              : '';
            emitOutput(`\n**Tool:** \`${event.name}\`${inputSummary}\n`);
            emitSegment({
              type: 'tool-call',
              content: '',
              toolName: event.name,
              toolArgs: event.input
                ? this.summarizeToolInput(event.name, event.input)
                : undefined,
              toolInput:
                event.input && typeof event.input === 'object'
                  ? (event.input as Record<string, unknown>)
                  : undefined,
              toolCallId: event.id,
            });
          } else if (event.status === 'completed') {
            if (event.output) {
              const output =
                event.output.length > 2000
                  ? event.output.substring(0, 2000) + '\n... [truncated]'
                  : event.output;
              emitOutput(
                `\n<details><summary>Tool result</summary>\n\n\`\`\`\n${output}\n\`\`\`\n</details>\n\n`,
              );
              emitSegment({
                type: event.error ? 'tool-result-error' : 'tool-result',
                content: output,
                toolCallId: event.id,
              });
            }
          }
          // Unknown status values are silently ignored
        }
        break;

      case 'error':
        if (event.message) {
          emitOutput(
            `\n**Error${event.code ? ` (${event.code})` : ''}:** ${event.message}\n`,
          );
          emitSegment({
            type: 'error',
            content: event.code
              ? `Error (${event.code}): ${event.message}`
              : event.message,
          });
        }
        break;

      case 'result':
        // Some Cursor versions emit direct text content on the result event
        if (event.content) {
          emitOutput(event.content);
          emitSegment({ type: 'text', content: event.content });
        }
        // Final result with stats
        if (event.stats) {
          const { input_tokens, output_tokens, duration_ms } = event.stats;
          const parts: string[] = [];
          if (input_tokens) parts.push(`${input_tokens} input`);
          if (output_tokens) parts.push(`${output_tokens} output`);
          if (duration_ms) parts.push(`${(duration_ms / 1000).toFixed(1)}s`);
          if (parts.length > 0) {
            const usageStr = `Usage: ${parts.join(', ')}`;
            emitOutput(`\n[${usageStr}]\n`);
            emitSegment({ type: 'info', content: usageStr });
          }
        }
        break;

      default:
        // Unknown event type — ignore silently
        break;
    }
    return undefined;
  }

  /**
   * Summarize tool input for concise display.
   * Shows key details without dumping full JSON.
   */
  private summarizeToolInput(
    toolName: string,
    input: Record<string, unknown>,
  ): string {
    switch (toolName) {
      case 'read_file':
      case 'write_file':
        return input['path'] ? `\`${input['path']}\`` : '';
      case 'run_terminal_command':
      case 'run_shell_command':
        return input['command'] ? `\`${input['command']}\`` : '';
      case 'search_files':
      case 'search_file_content':
        return input['pattern'] ? `pattern: "${input['pattern']}"` : '';
      case 'list_directory':
        return input['path'] ? `\`${input['path']}\`` : '';
      case 'web_fetch':
        return input['url'] ? `${input['url']}` : '';
      default: {
        const firstStr = Object.entries(input).find(
          ([, v]) => typeof v === 'string',
        );
        return firstStr
          ? `${firstStr[0]}: "${String(firstStr[1]).substring(0, 60)}"`
          : '';
      }
    }
  }
}
