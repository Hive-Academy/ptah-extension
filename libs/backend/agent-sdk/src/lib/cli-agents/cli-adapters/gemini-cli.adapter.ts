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
import { unlinkSync, writeFileSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { homedir, tmpdir } from 'os';
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
  /** MCP is configured via ~/.gemini/settings.json before each spawn */
  readonly supportsMcp = true;

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
          { timeout: 5000 },
        );
        version = versionOutput.trim().split(/\r?\n/)[0];
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

      // Normalize folder path for comparison.
      // On Windows, Gemini CLI stores trusted-folder keys with backslashes;
      // on Unix, paths use forward slashes natively, so leave them alone.
      const normalizedFolder =
        process.platform === 'win32' ? folder.replace(/\//g, '\\') : folder;

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
        'utf8',
      );
    } catch {
      // Non-fatal — worst case, --yolo flag handles it
    }
  }

  /**
   * Configure Ptah MCP server in ~/.gemini/settings.json.
   * Gemini CLI reads MCP config from this file at startup.
   * Uses httpUrl (Streamable HTTP transport) since our MCP server
   * is a standard HTTP POST JSON-RPC endpoint.
   * Non-fatal: errors are silently caught.
   */
  private async configureMcpServer(port: number): Promise<void> {
    try {
      const geminiDir = join(homedir(), '.gemini');
      const settingsPath = join(geminiDir, 'settings.json');

      let settings: Record<string, unknown> = {};
      try {
        const content = await readFile(settingsPath, 'utf8');
        settings = JSON.parse(content) as Record<string, unknown>;
      } catch {
        // File doesn't exist or invalid JSON — start fresh
      }

      const mcpServers =
        (settings['mcpServers'] as Record<string, unknown>) || {};
      mcpServers['ptah'] = {
        httpUrl: `http://localhost:${port}`,
      };
      settings['mcpServers'] = mcpServers;

      await mkdir(geminiDir, { recursive: true });
      await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    } catch {
      // Non-fatal — MCP tools won't be available but agent still runs
    }
  }

  /**
   * Remove ptah MCP entry from ~/.gemini/settings.json.
   * Called after process exits to avoid stale port references.
   * Non-fatal: errors are silently caught.
   */
  private async cleanupMcpEntry(): Promise<void> {
    try {
      const settingsPath = join(homedir(), '.gemini', 'settings.json');
      const content = await readFile(settingsPath, 'utf8');
      const settings = JSON.parse(content) as Record<string, unknown>;
      const mcpServers = settings['mcpServers'] as
        | Record<string, unknown>
        | undefined;
      if (!mcpServers?.['ptah']) return;

      delete mcpServers['ptah'];
      if (Object.keys(mcpServers).length === 0) {
        delete settings['mcpServers'];
      }
      await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    } catch {
      // Non-fatal — file may not exist or never had a ptah entry
    }
  }

  /**
   * Write project guidance to a temp file for GEMINI_SYSTEM_MD env var.
   * Gemini CLI reads system instructions from the file path in this env var.
   */
  private writeSystemPromptFile(content: string): string {
    const tmpPath = join(tmpdir(), `ptah-gemini-system-${Date.now()}.md`);
    writeFileSync(tmpPath, content, 'utf8');
    // Normalize to forward slashes for the env var. Gemini CLI parses backslashes
    // in env-var paths as escape sequences on some platforms; forward slashes
    // are accepted on every supported platform (including Windows).
    return tmpPath.replace(/\\/g, '/');
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

    // Configure Ptah MCP server in ~/.gemini/settings.json before spawning.
    // Gemini CLI reads MCP config from this file at startup.
    if (options.mcpPort) {
      await this.configureMcpServer(options.mcpPort);
    }

    // Handle system prompt via Gemini's native mechanism (GEMINI_SYSTEM_MD env var).
    // Prefers full systemPrompt (premium prompt harness) over projectGuidance.
    // This avoids polluting the task prompt and uses the model's system instruction slot.
    const spawnEnv: Record<string, string> = {};
    if (process.platform === 'win32') {
      // Hint node-pty to skip ConPTY on Windows. ConPTY's AttachConsole() fails
      // when Gemini is spawned as a child process (no real console), causing
      // harmless but noisy "AttachConsole failed" errors in stderr.
      // This env var is respected by some node-pty versions/forks to fall back
      // to winpty, which doesn't need AttachConsole.
      spawnEnv['NODE_PTY_USE_CONPTY'] = '0';
    }
    let systemPromptTmpPath: string | undefined;
    const systemContent = options.systemPrompt || options.projectGuidance;
    if (systemContent) {
      systemPromptTmpPath = this.writeSystemPromptFile(systemContent);
      spawnEnv['GEMINI_SYSTEM_MD'] = systemPromptTmpPath;
    }

    // Build task prompt WITHOUT system content (handled via env var above)
    const taskPrompt = buildTaskPrompt({
      ...options,
      systemPrompt: undefined,
      projectGuidance: undefined,
    });
    const abortController = new AbortController();

    // Session ID captured from init event (closure scoped per invocation)
    let capturedSessionId: string | undefined;

    const args = [
      '--output-format',
      'stream-json',
      '--yolo', // Auto-approve all tool calls (orchestrated context)
    ];

    // --prompt= is the headless mode trigger — actual prompt comes from stdin.
    // Required in BOTH fresh and resume modes, otherwise Gemini enters interactive
    // mode and exits immediately when stdin closes (ENODATA / exit code 0).
    args.push('--prompt=');

    // Resume mode: additionally pass --resume <id> to load prior session context
    if (options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId);
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

    // Spawn using cross-spawn — transparent .cmd handling on Windows.
    // needsConsole: Gemini CLI uses node-pty/ConPTY for run_shell_command.
    // ConPTY's AttachConsole() fails on Windows when the process has no console
    // (caused by CREATE_NO_WINDOW flag). This ensures a console is allocated.
    const binary = options.binaryPath ?? 'gemini';
    const child = spawnCli(binary, args, {
      cwd: options.workingDirectory,
      env: Object.keys(spawnEnv).length > 0 ? spawnEnv : undefined,
      needsConsole: true,
    });

    // Explicit UTF-8 encoding prevents Buffer concatenation issues
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    // Write prompt to stdin then close.
    // Fresh mode: stdin IS the full task prompt (--prompt= is empty, Gemini reads stdin).
    // Resume mode: Gemini loads existing session context from the resumed session.
    //   The original task is already in that context, so re-sending it is redundant
    //   and may cause Gemini to believe the work is already done. Instead, send a
    //   short continuation prompt that tells it to pick up where it left off.
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

      // Cap lineBuf at 64KB to defend against pathological JSONL streams
      // that never emit a newline (e.g., a runaway tool result without LF).
      // Without this guard, lineBuf could grow unboundedly and OOM the process.
      const LINE_BUF_CAP = 64 * 1024;
      if (lineBuf.length > LINE_BUF_CAP) {
        emitOutput(
          `[Gemini CLI Warning] Line buffer exceeded ${LINE_BUF_CAP} bytes without a newline; resetting.\n`,
        );
        emitSegment({
          type: 'info',
          content: `Line buffer exceeded ${LINE_BUF_CAP} bytes without a newline; resetting.`,
        });
        lineBuf = '';
      }

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const sessionId = this.handleJsonLine(trimmed, emitOutput, emitSegment);
        if (sessionId) {
          capturedSessionId = sessionId;
        }
      }
    });

    // Stderr: emit meaningful errors, filter known Windows ConPTY noise.
    // Gemini CLI uses node-pty/ConPTY internally for run_shell_command.
    // On Windows, the conpty_console_list_agent.js sub-process frequently
    // fails with "AttachConsole failed" — this is cosmetic (non-blocking)
    // and clutters output. We suppress it along with the associated stack trace.
    let suppressConptyLines = 0;
    child.stderr?.on('data', (data: string) => {
      const cleaned = stripAnsiCodes(data).trim();
      if (!cleaned) return;

      // Suppress ConPTY console attachment errors (Windows-only cosmetic noise)
      if (cleaned.includes('conpty_console_list_agent')) {
        suppressConptyLines = 5; // Suppress this + next few stack trace lines
        return;
      }
      if (cleaned.includes('AttachConsole failed')) {
        suppressConptyLines = 3;
        return;
      }
      if (suppressConptyLines > 0) {
        suppressConptyLines--;
        return;
      }

      emitOutput(`[stderr] ${cleaned}\n`);
      // Classify: error keywords → error segment, otherwise info
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
        emitOutput(`\n[Gemini CLI Error] ${err.message}\n`);
        emitSegment({
          type: 'error',
          content: `Gemini CLI Error: ${err.message}`,
        });
        resolve(1);
      });
    });

    // Clean up temporary resources after the process exits
    done.then(() => {
      // Remove temp system prompt file
      if (systemPromptTmpPath) {
        try {
          unlinkSync(systemPromptTmpPath);
        } catch {
          // Ignore — file may already be deleted
        }
      }
      // Remove ptah MCP entry to avoid stale port references
      if (options.mcpPort) {
        this.cleanupMcpEntry();
      }
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
    emitSegment: (segment: CliOutputSegment) => void,
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
        if (event.session_id && typeof event.session_id === 'string') {
          const trimmed = event.session_id.trim();
          if (trimmed) {
            sessionId = trimmed;
            emitOutput(`[Session: ${trimmed}]\n`);
            emitSegment({
              type: 'info',
              content: `Session: ${trimmed}`,
            });
          }
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
            toolInput:
              event.tool_input && typeof event.tool_input === 'object'
                ? (event.tool_input as Record<string, unknown>)
                : undefined,
            toolCallId: event.tool_call_id,
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
            `\n<details><summary>Tool result${status}</summary>\n\n\`\`\`\n${output}\n\`\`\`\n</details>\n\n`,
          );
          emitSegment({
            type: isError ? 'tool-result-error' : 'tool-result',
            content: output,
            toolCallId: event.tool_call_id,
          });
        }
        break;
      }

      case 'error':
        if (event.message) {
          emitOutput(
            `\n**Error${event.code ? ` (${event.code})` : ''}:** ${
              event.message
            }\n`,
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
    input: Record<string, unknown>,
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
          ([, v]) => typeof v === 'string',
        );
        return firstStr
          ? `${firstStr[0]}: "${String(firstStr[1]).substring(0, 60)}"`
          : '';
      }
    }
  }
}
