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
import { readFile, writeFile, mkdir } from 'fs/promises';
import { homedir } from 'os';
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

  /** Curated Gemini CLI model list */
  private static readonly GEMINI_MODELS: CliModelInfo[] = [
    { id: 'auto', name: 'Auto (recommended)' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
    { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (preview)' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (preview)' },
  ];

  /**
   * Return available models for Gemini CLI.
   * Uses a curated list (Gemini CLI has no `models` subcommand).
   */
  async listModels(): Promise<CliModelInfo[]> {
    return GeminiCliAdapter.GEMINI_MODELS;
  }

  /**
   * Ensure the workspace folder is trusted by Gemini CLI.
   * Prevents the interactive "Do you trust this folder?" prompt from blocking headless execution.
   * Writes to ~/.gemini/trustedFolders.json (creates if missing).
   * Non-fatal: errors are silently caught.
   */
  private async ensureFolderTrusted(folder: string): Promise<void> {
    try {
      const geminiDir = join(homedir(), '.gemini');
      const trustedPath = join(geminiDir, 'trustedFolders.json');

      // Normalize folder path for comparison (backslashes on Windows)
      const normalizedFolder = folder.replace(/\//g, '\\');

      let trustedFolders: Record<string, string> = {};
      try {
        const content = await readFile(trustedPath, 'utf8');
        trustedFolders = JSON.parse(content) as Record<string, string>;
      } catch {
        // File doesn't exist or invalid JSON — start fresh
      }

      // Check if already trusted (try both slash styles)
      if (
        trustedFolders[folder] === 'TRUST_FOLDER' ||
        trustedFolders[normalizedFolder] === 'TRUST_FOLDER'
      ) {
        return;
      }

      // Add trust entry using backslash style (matches Gemini CLI's own format on Windows)
      trustedFolders[normalizedFolder] = 'TRUST_FOLDER';

      // Ensure ~/.gemini directory exists
      await mkdir(geminiDir, { recursive: true });
      await writeFile(
        trustedPath,
        JSON.stringify(trustedFolders, null, 2),
        'utf8'
      );
    } catch {
      // Non-fatal — worst case, --yolo flag handles it
    }
  }

  /**
   * Configure Ptah MCP server in ~/.gemini/settings.json.
   * Merges ptah server entry with existing user config (preserves other settings).
   * When mcpPort is not provided, removes the ptah entry for clean state.
   * Non-fatal: errors are silently caught.
   */
  private async configureMcpServer(mcpPort?: number): Promise<void> {
    try {
      const geminiDir = join(homedir(), '.gemini');
      const settingsPath = join(geminiDir, 'settings.json');

      // Read existing settings (preserve user's other servers/config)
      let settings: Record<string, unknown> = {};
      try {
        const content = await readFile(settingsPath, 'utf8');
        settings = JSON.parse(content) as Record<string, unknown>;
      } catch {
        // File doesn't exist or invalid JSON — start fresh
      }

      // Ensure mcpServers object exists
      const mcpServers = (settings['mcpServers'] ?? {}) as Record<
        string,
        unknown
      >;

      if (mcpPort) {
        // Add/update ptah MCP server entry
        mcpServers['ptah'] = {
          httpUrl: `http://localhost:${mcpPort}`,
          trust: true,
          timeout: 30000,
        };
      } else {
        // Remove ptah entry (user is not premium or server not running)
        delete mcpServers['ptah'];
      }

      settings['mcpServers'] = mcpServers;

      await mkdir(geminiDir, { recursive: true });
      await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    } catch {
      // Non-fatal — worst case, Gemini runs without MCP tools
    }
  }

  /**
   * Run task via Gemini CLI with structured JSONL output.
   *
   * Spawns: gemini --prompt= --output-format stream-json --yolo
   * Writes the task prompt to stdin (avoids Windows shell quoting issues).
   * Parses JSONL events line-by-line and emits readable output.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    // Auto-trust workspace folder before spawning (prevents trust prompt)
    if (options.workingDirectory) {
      await this.ensureFolderTrusted(options.workingDirectory);
    }

    // Configure Ptah MCP server (or clean up if no port)
    await this.configureMcpServer(options.mcpPort);

    const taskPrompt = buildTaskPrompt(options);
    const abortController = new AbortController();

    // Session ID captured from init event (closure scoped per invocation)
    let capturedSessionId: string | undefined;

    const args = [
      '--output-format',
      'stream-json',
      '--yolo', // Auto-approve all tool calls (orchestrated context)
    ];

    // Resume mode: use --resume <id> instead of --prompt=
    if (options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId);
    } else {
      args.push('--prompt='); // Headless mode trigger — actual prompt comes from stdin
    }

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

    // Spawn using cross-spawn — transparent .cmd handling on Windows
    const binary = options.binaryPath ?? 'gemini';
    const child = spawnCli(binary, args, {
      cwd: options.workingDirectory,
    });

    // Explicit UTF-8 encoding prevents Buffer concatenation issues
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    // Write prompt to stdin then close.
    // Fresh mode: stdin IS the prompt (--prompt= is empty, Gemini appends stdin).
    // Resume mode: Gemini loads existing session context; stdin provides a new follow-up prompt.
    if (!options.resumeSessionId) {
      child.stdin?.write(taskPrompt + '\n');
      child.stdin?.end();
    } else {
      // Resume mode: write new prompt if present, then close stdin
      if (taskPrompt.trim()) {
        child.stdin?.write(taskPrompt + '\n');
      }
      child.stdin?.end();
    }

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
        const sessionId = this.handleJsonLine(trimmed, emitOutput, emitSegment);
        if (sessionId) {
          capturedSessionId = sessionId;
        }
      }
    });

    // Stderr: emit as-is (error output, warnings) + structured segments
    child.stderr?.on('data', (data: string) => {
      // Filter out ANSI noise but keep meaningful errors
      const cleaned = stripAnsiCodes(data).trim();
      if (cleaned) {
        emitOutput(`[stderr] ${cleaned}\n`);
        // Classify: error keywords → error segment, otherwise info
        const isError =
          /\b(error|fail(ed)?|exception|denied|unauthorized|refused|timeout|abort|crash|panic|fatal)\b/i.test(
            cleaned
          );
        emitSegment({ type: isError ? 'error' : 'info', content: cleaned });
      }
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
            emitSegment
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
        emitOutput(`\n[Gemini CLI Error] ${err.message}\n`);
        emitSegment({
          type: 'error',
          content: `Gemini CLI Error: ${err.message}`,
        });
        resolve(1);
      });
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
   * Parse a single JSONL line from Gemini's stream-json output
   * and emit human-readable text + structured segments.
   */
  private handleJsonLine(
    line: string,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void
  ): string | undefined {
    let event: GeminiStreamEvent;
    try {
      event = JSON.parse(line) as GeminiStreamEvent;
    } catch {
      // Not valid JSON — could be plain text fallback or partial output
      // Emit as-is if it looks meaningful
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
        if (event.session_id) {
          sessionId = event.session_id;
          emitOutput(`[Session: ${event.session_id}]\n`);
          emitSegment({
            type: 'info',
            content: `Session: ${event.session_id}`,
          });
        }
        return sessionId;
      }

      case 'message':
        // Main content from the model
        if (event.content) {
          emitOutput(event.content);
          emitSegment({ type: 'text', content: event.content });
        }
        break;

      case 'tool_use':
        // Agent is calling a tool
        if (event.tool_name) {
          const inputSummary = event.tool_input
            ? ` ${this.summarizeToolInput(event.tool_name, event.tool_input)}`
            : '';
          emitOutput(`\n**Tool:** \`${event.tool_name}\`${inputSummary}\n`);
          emitSegment({
            type: 'tool-call',
            content: '',
            toolName: event.tool_name,
            toolArgs: event.tool_input
              ? this.summarizeToolInput(event.tool_name, event.tool_input)
              : undefined,
          });
        }
        break;

      case 'tool_result': {
        // Tool execution result
        const isError =
          event.status !== undefined && event.status !== 'success';
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
          emitSegment({
            type: isError ? 'tool-result-error' : 'tool-result',
            content: output,
          });
        }
        break;
      }

      case 'error':
        if (event.message) {
          emitOutput(
            `\n**Error${event.code ? ` (${event.code})` : ''}:** ${
              event.message
            }\n`
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
