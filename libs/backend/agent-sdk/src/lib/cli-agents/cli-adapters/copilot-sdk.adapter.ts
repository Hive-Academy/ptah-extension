/**
 * Copilot CLI Adapter (formerly Copilot SDK Adapter)
 *
 * History:
 * - TASK_2025_162: Original SDK-based integration via @github/copilot-sdk
 * - TASK_2025_169: Removed raw CLI fallback, SDK was sole adapter
 * - TASK_2026_FIX_COPILOT_SPAWN: Switched CLI-agent spawn path back to the
 *   official `@github/copilot` CLI binary because @github/copilot-sdk's
 *   transitive `vscode-jsonrpc/node` import fails in headless contexts (where
 *   vscode-jsonrpc is not hoisted by VS Code's extension host). The official
 *   CLI v1.0.26+ (GA March 2026) bundles its dependencies correctly and
 *   supports headless mode via `-p / --output-format json`.
 *
 * IMPORTANT: This adapter is used ONLY for the CLI-agent spawn path
 * (`ptah_agent_spawn { cli: 'copilot' }`). The "main agent" Copilot integration
 * runs through the Anthropic-compatible provider registry / translation proxy
 * (see `providers/copilot/copilot-provider-entry.ts`) and is unaffected.
 *
 * Architecture:
 * - Detect: resolve `copilot` binary on PATH, capture version
 * - runSdk(): spawn `copilot -p "<prompt>" --output-format json --allow-all-tools`
 *             and parse JSONL events line-by-line
 * - Permissions: `--allow-all-tools` (orchestrated context); the in-process
 *                CopilotPermissionBridge is kept for backwards compatibility
 *                with the constructor signature but is not invoked by this
 *                CLI-driven path
 *
 * CLI Event -> CliOutputSegment Mapping (matches the Copilot CLI's JSONL
 * stream-json output, which mirrors the SDK's event shapes):
 * - assistant.message_delta   -> text (deltaContent)
 * - assistant.message         -> text (full content, skip if streaming deltas received)
 * - assistant.reasoning_delta -> thinking (deltaContent)
 * - assistant.reasoning       -> thinking (full content, skip if deltas received)
 * - tool.execution_start      -> tool-call (toolName, arguments)
 * - tool.execution_complete   -> tool-result / tool-result-error / command / file-change
 * - assistant.usage           -> info (token usage summary)
 * - session.error             -> error
 * - result                    -> info (final stats); resolves done promise
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
  spawnCli,
} from './cli-adapter.utils';
import type { CopilotPermissionBridge } from './copilot-permission-bridge';

const execFileAsync = promisify(execFile);

// ========================================
// Tool Classification Helpers
// ========================================

/** Shell/command execution tool names across providers */
function isShellTool(toolName: string): boolean {
  return /^(run_shell_command|bash|shell|execute_command|terminal)$/i.test(
    toolName,
  );
}

/** File write/edit tool names across providers */
function isFileWriteTool(toolName: string): boolean {
  return /^(write_file|edit|replace|create_file|patch_file|write|insert)$/i.test(
    toolName,
  );
}

/**
 * Copilot CLI JSONL event shape.
 * Each line in `--output-format json` is a single JSON object with at least
 * a `type` discriminator. `data` carries the type-specific payload.
 */
interface CopilotCliEvent {
  type?: string;
  id?: string;
  timestamp?: string;
  parentId?: string;
  ephemeral?: boolean;
  /** Present on most event types */
  data?: Record<string, unknown>;
  /** `result` event puts these at the top level (no `data` wrapper) */
  sessionId?: string;
  exitCode?: number;
  usage?: {
    premiumRequests?: number;
    totalApiDurationMs?: number;
    sessionDurationMs?: number;
    codeChanges?: {
      linesAdded?: number;
      linesRemoved?: number;
      filesModified?: string[];
    };
  };
}

/** Copilot CLI model list (kept in sync with `copilot --help`).
 *  This list is shared with the provider-registry entry. */
const COPILOT_MODELS: CliModelInfo[] = [
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4.7', name: 'Claude Opus 4.7' },
  { id: 'claude-opus-4.7-fast', name: 'Claude Opus 4.7 Fast' },
  { id: 'claude-opus-4.6', name: 'Claude Opus 4.6' },
  { id: 'claude-opus-4.6-fast', name: 'Claude Opus 4.6 Fast' },
  { id: 'claude-opus-4.5', name: 'Claude Opus 4.5' },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
  { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5' },
  { id: 'gpt-5.4', name: 'GPT 5.4' },
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

/**
 * Actionable error message used when the `copilot` binary cannot be found.
 * Surfaced into the agent monitor so the user knows exactly what to do.
 */
const COPILOT_NOT_INSTALLED_MESSAGE =
  '[Copilot CLI Error] The `copilot` binary is not installed or not on PATH. ' +
  'Install it via `npm install -g @github/copilot` (>=1.0.26) and re-run ' +
  'agent detection (Ptah: Detect CLI Agents).';

export class CopilotSdkAdapter implements CliAdapter {
  readonly name = 'copilot' as const;
  readonly displayName = 'Copilot CLI';
  /**
   * The Copilot CLI supports MCP via `--additional-mcp-config` JSON. This
   * adapter wires the Ptah MCP server when `mcpPort` is provided in options.
   */
  readonly supportsMcp = true;

  /**
   * Permission bridge retained for constructor compatibility with
   * CliDetectionService. The CLI-driven path uses --allow-all-tools and
   * does not route permission requests through this bridge — but keeping
   * it here means the bridge stays available for any future in-process
   * permission integration without churning the registration site.
   */
  readonly permissionBridge: CopilotPermissionBridge;

  constructor(permissionBridge: CopilotPermissionBridge) {
    this.permissionBridge = permissionBridge;
  }

  /**
   * Detect if the Copilot CLI binary is installed.
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
          ['--version'],
          { timeout: 5000 },
        );
        version = versionOutput.trim().split(/\r?\n/)[0];
      } catch {
        // Version check failed -- CLI still usable
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
   * Build command for the raw CLI spawn fallback path.
   * Used only when runSdk() is not available (it always is here, but the
   * interface requires this method).
   */
  buildCommand(options: CliCommandOptions): CliCommand {
    const taskPrompt = buildTaskPrompt(options);
    return {
      binary: 'copilot',
      args: ['-p', taskPrompt, '--allow-all-tools', '--no-color'],
    };
  }

  supportsSteer(): boolean {
    return false;
  }

  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }

  /**
   * Return available models for Copilot CLI.
   * Uses the static COPILOT_MODELS list (the CLI itself has no machine-
   * readable model listing endpoint; the list is curated in sync with
   * `copilot --help`).
   */
  async listModels(): Promise<CliModelInfo[]> {
    return COPILOT_MODELS;
  }

  /**
   * Run task by spawning the official `@github/copilot` CLI in headless mode
   * and streaming its JSONL events.
   *
   * Spawns: copilot -p <prompt> --output-format json --allow-all-tools --no-color
   * Resume: copilot --resume=<id> -p <prompt> ...
   *
   * Mirrors the GeminiCliAdapter pattern (binary detection via resolveCliPath,
   * spawn via spawnCli, line-buffered JSONL parsing).
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    const abortController = new AbortController();

    // Output and segment buffering (matches Gemini/Codex pattern).
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

    // Resolve the binary path. Use options.binaryPath if AgentProcessManager
    // already resolved it; otherwise probe PATH ourselves.
    let binaryPath = options.binaryPath;
    if (!binaryPath) {
      const resolved = await resolveCliPath('copilot');
      if (resolved) {
        binaryPath = resolved;
      }
    }

    if (!binaryPath) {
      emitOutput(`${COPILOT_NOT_INSTALLED_MESSAGE}\n`);
      emitSegment({ type: 'error', content: COPILOT_NOT_INSTALLED_MESSAGE });
      return {
        abort: abortController,
        done: Promise.resolve(1),
        onOutput,
        onSegment,
        getSessionId: () => undefined,
      };
    }

    // Build task prompt -- buildTaskPrompt() handles systemPrompt /
    // projectGuidance / files / taskFolder appending.
    const taskPrompt = buildTaskPrompt(options);

    const args: string[] = [
      '-p',
      taskPrompt,
      '--output-format',
      'json',
      '--allow-all-tools',
      '--no-color',
    ];

    // Resume mode: append --resume=<id>. Copilot's --resume accepts a session
    // UUID; the CLI loads prior context before processing the new prompt.
    if (options.resumeSessionId) {
      args.push(`--resume=${options.resumeSessionId}`);
    }

    if (options.model) {
      args.push('--model', options.model);
    }

    if (options.reasoningEffort) {
      args.push('--effort', options.reasoningEffort);
    }

    // Wire Ptah MCP server via --additional-mcp-config (JSON inline).
    // The CLI accepts either a JSON string or a file path prefixed with `@`.
    // Inline JSON keeps the implementation stateless (no temp files to clean).
    if (options.mcpPort) {
      const mcpConfig = JSON.stringify({
        mcpServers: {
          ptah: {
            type: 'http',
            url: `http://localhost:${options.mcpPort}`,
          },
        },
      });
      args.push('--additional-mcp-config', mcpConfig);
    }

    // Spawn. needsConsole on Windows because Copilot CLI uses node-pty
    // internally for shell execution -- same gotcha as Gemini.
    const child = spawnCli(binaryPath, args, {
      cwd: options.workingDirectory,
      needsConsole: true,
    });

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    // Abort handler: kill the child process.
    const onAbort = (): void => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };
    abortController.signal.addEventListener('abort', onAbort);

    // Per-invocation parsing state.
    let receivedDeltas = false;
    let receivedReasoningDeltas = false;
    const toolCallIdToName = new Map<string, string>();
    let capturedSessionId: string | undefined;

    // JSONL line buffer. Copilot can emit very long lines (full encrypted
    // reasoning blobs) so we accumulate until a newline.
    let lineBuf = '';

    child.stdout?.on('data', (data: string) => {
      lineBuf += data;
      // Cross-platform line splitting: handle both \n (Unix) and \r\n (Windows).
      const lines = lineBuf.split(/\r?\n/);
      lineBuf = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const sessionId = this.handleJsonLine(
          trimmed,
          emitOutput,
          emitSegment,
          {
            getReceivedDeltas: () => receivedDeltas,
            setReceivedDeltas: () => {
              receivedDeltas = true;
            },
            getReceivedReasoningDeltas: () => receivedReasoningDeltas,
            setReceivedReasoningDeltas: () => {
              receivedReasoningDeltas = true;
            },
            toolCallIdToName,
          },
        );
        if (sessionId) {
          capturedSessionId = sessionId;
        }
      }
    });

    // Stderr: surface meaningful errors. Copilot's stderr is generally quiet
    // when --output-format json is set, but auth/network failures still land
    // here.
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

    // Done promise: resolves when the process exits.
    const done = new Promise<number>((resolve) => {
      child.on('close', (code, signal) => {
        abortController.signal.removeEventListener('abort', onAbort);
        // Flush any remaining buffered line.
        if (lineBuf.trim()) {
          const sessionId = this.handleJsonLine(
            lineBuf.trim(),
            emitOutput,
            emitSegment,
            {
              getReceivedDeltas: () => receivedDeltas,
              setReceivedDeltas: () => {
                receivedDeltas = true;
              },
              getReceivedReasoningDeltas: () => receivedReasoningDeltas,
              setReceivedReasoningDeltas: () => {
                receivedReasoningDeltas = true;
              },
              toolCallIdToName,
            },
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
        emitOutput(`\n[Copilot CLI Error] ${err.message}\n`);
        emitSegment({
          type: 'error',
          content: `Copilot CLI Error: ${err.message}`,
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
   * Parse a single JSONL event line from the Copilot CLI's stream-json output
   * and emit human-readable text + structured segments.
   *
   * Returns the session ID if the line is a `result` event (which carries the
   * final session UUID). Returns undefined otherwise.
   */
  private handleJsonLine(
    line: string,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void,
    state: {
      getReceivedDeltas: () => boolean;
      setReceivedDeltas: () => void;
      getReceivedReasoningDeltas: () => boolean;
      setReceivedReasoningDeltas: () => void;
      toolCallIdToName: Map<string, string>;
    },
  ): string | undefined {
    let event: CopilotCliEvent;
    try {
      event = JSON.parse(line) as CopilotCliEvent;
    } catch {
      // Plain-text fallback: emit non-JSON lines that look meaningful.
      if (line.length > 0 && !line.startsWith('{')) {
        emitOutput(line + '\n');
        emitSegment({ type: 'text', content: line });
      }
      return undefined;
    }

    const data = event.data ?? {};

    switch (event.type) {
      case 'session.start':
      case 'session.tools_updated': {
        const model = data['model'] as string | undefined;
        if (model) {
          emitOutput(`[Copilot CLI] Model: ${model}\n`);
          emitSegment({ type: 'info', content: `Model: ${model}` });
        }
        return undefined;
      }

      case 'assistant.message_delta': {
        state.setReceivedDeltas();
        const delta = data['deltaContent'] as string | undefined;
        if (delta) {
          emitOutput(delta);
          emitSegment({ type: 'text', content: delta });
        }
        return undefined;
      }

      case 'assistant.message': {
        const content = data['content'] as string | undefined;
        if (!state.getReceivedDeltas() && content) {
          emitOutput(content);
          emitSegment({ type: 'text', content });
        }
        return undefined;
      }

      case 'assistant.reasoning_delta': {
        state.setReceivedReasoningDeltas();
        const delta = data['deltaContent'] as string | undefined;
        if (delta) {
          emitSegment({ type: 'thinking', content: delta });
        }
        return undefined;
      }

      case 'assistant.reasoning': {
        const content = data['content'] as string | undefined;
        if (!state.getReceivedReasoningDeltas() && content) {
          emitSegment({ type: 'thinking', content });
        }
        return undefined;
      }

      case 'tool.execution_start': {
        const toolName = data['toolName'] as string | undefined;
        const toolArgs = data['arguments'];
        const toolCallId = data['toolCallId'] as string | undefined;
        if (!toolName) return undefined;

        const argsStr =
          toolArgs !== undefined && toolArgs !== null
            ? this.summarizeToolArgs(toolName, toolArgs)
            : undefined;

        if (toolCallId) {
          state.toolCallIdToName.set(toolCallId, toolName);
        }

        emitOutput(
          `\n**Tool:** \`${toolName}\`${argsStr ? ` ${argsStr}` : ''}\n`,
        );
        emitSegment({
          type: 'tool-call',
          content: '',
          toolName,
          toolArgs: argsStr,
          toolInput:
            toolArgs && typeof toolArgs === 'object'
              ? (toolArgs as Record<string, unknown>)
              : undefined,
          toolCallId,
        });
        return undefined;
      }

      case 'tool.execution_complete': {
        const success = data['success'] as boolean | undefined;
        const result = data['result'] as
          | { content?: string; detailedContent?: string }
          | undefined;
        const error = data['error'] as
          | { message?: string; code?: string }
          | undefined;
        const toolCallId = data['toolCallId'] as string | undefined;
        const exitCode = data['exitCode'] as number | undefined;
        const toolName = toolCallId
          ? state.toolCallIdToName.get(toolCallId)
          : undefined;

        if (success && result) {
          const content = result.content ?? '';
          const truncated =
            content.length > 2000
              ? content.substring(0, 2000) + '\n... [truncated]'
              : content;

          if (toolName && isShellTool(toolName)) {
            emitOutput(`\n$ ${toolName}\n${truncated}\n`);
            emitSegment({
              type: 'command',
              content: truncated,
              toolName,
              exitCode: exitCode ?? 0,
              toolCallId,
            });
          } else if (toolName && isFileWriteTool(toolName)) {
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
              toolCallId,
            });
          } else {
            emitOutput(
              `\n<details><summary>Tool result</summary>\n\n\`\`\`\n${truncated}\n\`\`\`\n</details>\n\n`,
            );
            emitSegment({
              type: 'tool-result',
              content: truncated,
              toolCallId,
            });
          }
        } else if (error) {
          const errorMsg = error.message ?? 'Unknown error';
          emitOutput(`\n**Tool Error:** ${errorMsg}\n`);
          emitSegment({
            type: 'tool-result-error',
            content: errorMsg,
            toolCallId,
          });
        } else if (success === false) {
          emitOutput('\n**Tool Error:** Execution failed\n');
          emitSegment({
            type: 'tool-result-error',
            content: 'Execution failed',
            toolCallId,
          });
        }
        return undefined;
      }

      case 'session.error': {
        const errorMsg = (data['message'] as string) ?? 'Unknown session error';
        emitOutput(`\n[Copilot CLI Error] ${errorMsg}\n`);
        emitSegment({ type: 'error', content: errorMsg });
        return undefined;
      }

      case 'assistant.usage': {
        const model = data['model'] as string | undefined;
        const inputTokens = data['inputTokens'] as number | undefined;
        const outputTokens = data['outputTokens'] as number | undefined;
        const cost = data['cost'] as number | undefined;
        const duration = data['duration'] as number | undefined;

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
        return undefined;
      }

      case 'session.compaction_start': {
        emitOutput('\n[Copilot CLI] Context compaction started...\n');
        emitSegment({
          type: 'info',
          content: 'Context compaction started...',
        });
        return undefined;
      }

      case 'session.compaction_complete': {
        const tokensBefore = data['tokensBefore'] as number | undefined;
        const tokensAfter = data['tokensAfter'] as number | undefined;
        const parts: string[] = ['Context compaction complete'];
        if (tokensBefore !== undefined && tokensAfter !== undefined) {
          parts.push(`${tokensBefore} -> ${tokensAfter} tokens`);
        }
        const msg = parts.join(': ');
        emitOutput(`\n[Copilot CLI] ${msg}\n`);
        emitSegment({ type: 'info', content: msg });
        return undefined;
      }

      case 'result': {
        // Final event: { type: 'result', sessionId, exitCode, usage }.
        // No `data` wrapper -- fields are top-level.
        const sessionId =
          typeof event.sessionId === 'string' && event.sessionId.trim()
            ? event.sessionId.trim()
            : undefined;
        const usage = event.usage;
        if (usage) {
          const parts: string[] = [];
          if (usage.totalApiDurationMs)
            parts.push(`${(usage.totalApiDurationMs / 1000).toFixed(1)}s api`);
          if (usage.sessionDurationMs)
            parts.push(`${(usage.sessionDurationMs / 1000).toFixed(1)}s total`);
          if (usage.premiumRequests !== undefined)
            parts.push(`${usage.premiumRequests} premium`);
          if (usage.codeChanges) {
            const { linesAdded, linesRemoved } = usage.codeChanges;
            if (linesAdded || linesRemoved) {
              parts.push(`+${linesAdded ?? 0}/-${linesRemoved ?? 0} lines`);
            }
          }
          if (parts.length > 0) {
            const usageStr = `Final: ${parts.join(', ')}`;
            emitOutput(`\n[${usageStr}]\n`);
            emitSegment({ type: 'info', content: usageStr });
          }
        }
        return sessionId;
      }

      default:
        // Unknown / informational event types (mcp_server_status_changed,
        // skills_loaded, user.message, turn_start, turn_end, etc.) -- ignore.
        return undefined;
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
        return obj['path'] ? `\`${obj['path'] as string}\`` : '';
      case 'run_shell_command':
      case 'bash':
      case 'shell':
        return obj['command'] ? `\`${obj['command'] as string}\`` : '';
      case 'search_file_content':
      case 'grep':
        return obj['pattern'] ? `pattern: "${obj['pattern'] as string}"` : '';
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
        // Generic: show first string value, truncated.
        const firstStr = Object.entries(obj).find(
          ([, v]) => typeof v === 'string',
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
   * No-op disposal. The CLI-driven path has no singleton client to tear
   * down; child processes are owned by AgentProcessManager and killed on
   * abort. Permission bridge is cleaned up to drop any pending requests.
   */
  async dispose(): Promise<void> {
    this.permissionBridge.cleanup();
  }
}
